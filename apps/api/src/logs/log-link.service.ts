/**
 * 알림 → 로그 **링크만** 만든다 (docs/api/alerts.md 2.2.1).
 * **로그 줄은 여기서도, 알림 응답 어디에서도 나가지 않는다** (계약 0.3).
 *
 * 파드가 살아 있는지는 **서버가 말한다** — 화면이 추측하지 않는다.
 * 판정은 informer 캐시 + 최근 삭제 캐시로만 하고 쿠버네티스 API를 새로 부르지 않는다.
 */
import { Injectable } from '@nestjs/common';
import { LogLinkPolicy } from '../common/log-link-policy.service';
import { ClusterStore } from '../cluster/state/cluster-store';
import { podKey } from '../cluster/model';
import type { ResourceRef } from '../cluster/types';
import { LogBackendService } from './backend/log-backend.service';
import { buildLogHref } from './log-href';

export interface LogLinkResult {
  href: string | null;
  target: {
    ref: ResourceRef;
    gone: boolean;
    deletedAt: string | null;
    stackSearch: boolean;
    unavailableReason:
      'not_a_pod' | 'logs_disabled' | 'namespace_denied' | null;
  } | null;
}

@Injectable()
export class LogLinkService {
  constructor(
    private readonly store: ClusterStore,
    private readonly policy: LogLinkPolicy,
    private readonly backend: LogBackendService,
  ) {}

  /**
   * 알림 한 건의 로그 링크. `atIso`는 **그 알림의 시각**(`occurredAt`)이다 —
   * 알림 링크는 그 시각을 보러 가는 링크라 `follow=1`을 붙이지 않는다(PM 결정 D3).
   * `follow`/`at`을 붙일지는 여기서 정하지 않는다: `log-href.ts`의 자리별 규칙(`alert`)이 정한다.
   * 링크에 컨테이너를 붙이지 않는다 — 로그 화면이 서버 기본 선택 규칙으로 고른다.
   */
  linkFor(ref: ResourceRef, atIso?: string | null): LogLinkResult {
    if (ref.kind !== 'Pod' || !ref.namespace) {
      return {
        href: null,
        target: {
          ref,
          gone: false,
          deletedAt: null,
          stackSearch: false,
          unavailableReason: 'not_a_pod',
        },
      };
    }
    const base = {
      ref,
      // 외부 로그 스택이 있어 **사라진 파드도** 찾을 수 있는가. `GET /api/logs/targets/*`의
      // `stackSearch.available`과 같은 판단이다 (연결 실패 중이면 false)
      stackSearch:
        this.backend.configured &&
        this.backend.currentState() !== 'unavailable',
    };
    // 링크를 줄 수 있는지는 **공용 규칙 하나**로 정한다 (`log-href.ts`).
    // 파드·이벤트·워크로드·컨트롤 플레인도 같은 함수를 쓴다 — 규칙이 두 벌이 되면 한쪽만 막힌다
    const { href, blocked } = buildLogHref(this.policy.value(), {
      entry: 'alert',
      namespace: ref.namespace,
      pod: ref.name,
      at: atIso ?? null,
    });
    if (blocked) {
      return {
        href: null,
        target: {
          ...base,
          gone: false,
          deletedAt: null,
          unavailableReason: blocked,
        },
      };
    }
    const alive = this.store.pods.has(podKey(ref.namespace, ref.name));
    const deletedAt = this.store.history.deletedAtOf(ref.namespace, ref.name);
    return {
      // **파드가 사라져도 링크를 지우지 않는다.** 링크를 그리는 시점과 누르는 시점 사이에
      // 파드가 사라질 수 있어, 존재할 때만 주면 새로고침마다 링크가 나타났다 사라진다.
      // 사라졌다는 사실은 로그 화면이 LOG_POD_NOT_FOUND 전용 화면으로 말한다.
      href,
      target: {
        ...base,
        // 캐시에 없고 삭제 기록도 없으면 `false`로 둔다 (모르면 링크를 살린다)
        gone: !alive && deletedAt !== null,
        deletedAt: deletedAt ? new Date(deletedAt).toISOString() : null,
        unavailableReason: null,
      },
    };
  }
}
