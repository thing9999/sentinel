/**
 * 디스코드 웹훅으로 나가는 **유일한 지점** (docs/api/alerts.md 3.2).
 *
 * 이 파일을 따로 둔 이유: 1단계에서는 "`src/alerts/`에 HTTP 클라이언트가 없다"는 것으로
 * 아웃바운드 0건을 보였다. P2에서 발송기가 생기므로 그 성질이 깨진다 —
 * 대신 **나가는 문을 하나로 좁히고 주입 가능하게** 만들어, 테스트가
 * "mock 모드에서 이 함수가 한 번도 불리지 않았다"를 직접 검사할 수 있게 했다.
 *
 * 지키는 것:
 * - 호스트 검증을 **한 번 더** 한다(저장 단계에서 이미 걸렀지만, 여기서도 막는다).
 *   그 밖의 주소로는 **요청을 만들지 않는다** (SSRF 성격 위험 차단, PM 결정 Q9).
 * - 실패 메시지에 **URL·토큰·요청 본문을 넣지 않는다.** 반환 전에 `redactSecrets`를 태운다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { redactSecrets, truncateText } from '../database/health';
import { DEFAULT_WEBHOOK_HOSTS } from '../database/secret-settings';

export const DISCORD_SENDER = Symbol('DISCORD_SENDER');

export interface DiscordSendResult {
  ok: boolean;
  status: number | null;
  retryAfter: string | null;
  /** 가림 처리된 한 줄. 성공이면 null */
  detail: string | null;
}

export interface DiscordSenderPort {
  send(
    url: string,
    content: string,
    allowedHosts: readonly string[],
  ): Promise<DiscordSendResult>;
}

function hostAllowed(url: string, allowedHosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some(
    (h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`),
  );
}

/** 오류 문구는 **항상** 이 함수를 거친다 (DBA 요청: 웹훅 URL이 메시지에 섞여 나간다) */
export function safeDetail(text: string): string {
  return truncateText(redactSecrets(text).replace(/\s+/g, ' ').trim(), 300);
}

@Injectable()
export class HttpDiscordSender implements DiscordSenderPort {
  private readonly logger = new Logger(HttpDiscordSender.name);

  async send(
    url: string,
    content: string,
    allowedHosts: readonly string[] = DEFAULT_WEBHOOK_HOSTS,
  ): Promise<DiscordSendResult> {
    if (!hostAllowed(url, allowedHosts)) {
      // **요청을 만들지 않는다.** URL을 메시지에 넣지도 않는다
      return {
        ok: false,
        status: null,
        retryAfter: null,
        detail: '허용되지 않은 웹훅 호스트입니다 (디스코드 도메인만 허용).',
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, status: res.status, retryAfter: null, detail: null };
      }
      // 응답 본문은 요청 URL을 되비추는 경우가 있어 **가림 처리 후** 한 줄로 줄인다
      let body = '';
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        body = '';
      }
      return {
        ok: false,
        status: res.status,
        retryAfter: res.headers.get('retry-after'),
        detail: safeDetail(`디스코드 응답 ${res.status} ${body}`),
      };
    } catch (err) {
      const name = err instanceof Error ? err.name : 'error';
      return {
        ok: false,
        status: null,
        retryAfter: null,
        // 예외 메시지에 URL이 들어 있을 수 있다
        detail: safeDetail(
          name === 'AbortError'
            ? '디스코드 요청 시간 초과 (10초)'
            : `디스코드 요청 실패 (${name})`,
        ),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 테스트·mock 검증용. 실제로 아무것도 보내지 않고 호출만 센다 */
@Injectable()
export class RecordingDiscordSender implements DiscordSenderPort {
  readonly calls: { url: string; content: string }[] = [];

  send(url: string, content: string): Promise<DiscordSendResult> {
    this.calls.push({ url, content });
    return Promise.resolve({
      ok: true,
      status: 204,
      retryAfter: null,
      detail: null,
    });
  }
}
