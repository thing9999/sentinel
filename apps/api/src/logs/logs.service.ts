/**
 * logs 조회 (docs/api/logs.md 2절).
 *
 * 이 파일이 지키는 것:
 * - **가림은 서버에서.** 원문이 응답에 실리는 경로가 없다 — 모든 본문은
 *   `createLineRedactor()`를 거친 `segments[]`로만 나간다 (P1·P3).
 * - **로그를 어디에도 저장하지 않는다**: DB·디스크·응답 캐시·API 자체 로그 (P5, AC-LOG11).
 *   조회 결과를 필드에 담아두지 않고 응답을 만든 뒤 버린다.
 * - **`capabilities`는 서버가 내려준다.** 화면이 출처 이름으로 능력을 추론하지 않는다.
 * - **원문 보기 API가 없다.**
 */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ApiException } from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { LogLinkPolicy } from '../common/log-link-policy.service';
import { ClusterStore } from '../cluster/state/cluster-store';
import { componentKindOf } from '../cluster/state/control-plane';
import { resolveOwner } from '../cluster/state/evaluate';
import { podKey, workloadKey } from '../cluster/model';
import type { RawPod } from '../cluster/model';
import type { DataSourceMode } from '../config/env.validation';
import { DirectLogError, DirectLogSource } from './direct-source';
import { LogBackendService } from './backend/log-backend.service';
import {
  LogBackendError,
  type LogBackendEntry,
} from './backend/log-backend.port';
import {
  anchorNotice,
  ANCHOR_LEAD_SEC,
  ANCHOR_WINDOW_SEC,
  locateAnchor,
  type LogAnchor,
} from './anchor';
import { processLines } from './line-processor';
import { LogsOptions } from './logs.options';
import { createLineRedactor, REDACTION_RULES } from './redact';
import {
  mockLogLines,
  LOG_SCENARIOS,
  LOG_SCENARIO_OPTIONS,
  type LogScenario,
} from './mock/mock-logs';
import type {
  LogCapabilities,
  LogLine,
  LogNotice,
  LogSelector,
  LogSourceId,
  LogSourceInfo,
  LogStats,
} from './logs.types';

/** 스택의 기간 선택지 (보관 기간 안). `direct`의 `현재 파일 전체`와 성격이 다르다 */
const STACK_RANGE_OPTIONS = [
  { id: '15m', label: '최근 15분', sec: 900 },
  { id: '1h', label: '최근 1시간', sec: 3600 },
  { id: '6h', label: '최근 6시간', sec: 21600 },
  { id: '24h', label: '최근 24시간', sec: 86400 },
  { id: '7d', label: '최근 7일', sec: 604800 },
  { id: 'custom', label: '직접 지정', sec: null },
];

const DIRECT_RANGE_OPTIONS = [
  { id: '5m', label: '최근 5분', sec: 300 },
  { id: '15m', label: '최근 15분', sec: 900 },
  { id: '1h', label: '최근 1시간', sec: 3600 },
  { id: 'file', label: '현재 파일 전체', sec: null },
];

/** `direct`의 한계 4줄 — 접어도 한 줄 요약이 남는다 (AC-LOG19) */
const DIRECT_LIMITATIONS = {
  summary: '직접 조회 · 지난 로그·검색 없음',
  lines: [
    {
      code: 'LOG_DIRECT_LIVE_ONLY',
      text: '직접 조회는 지금 살아 있는 컨테이너의 현재 로그 파일만 읽습니다.',
    },
    {
      code: 'LOG_DIRECT_ROTATED',
      text: '노드가 로그 파일을 돌리면(보통 10MiB마다) 그 이전 내용은 남아 있어도 조회할 수 없습니다.',
      hint: '노드(kubelet) 설정에 따라 다릅니다. 기본값이 10MiB입니다.',
    },
    {
      code: 'LOG_DIRECT_ONE_GENERATION',
      text: '재시작한 컨테이너는 직전 1세대까지만 볼 수 있습니다. 2세대 전 로그는 없습니다.',
    },
    {
      code: 'LOG_DIRECT_POD_GONE',
      text: '파드가 사라지면 그 로그는 볼 수 없습니다. 장애 조사에 가장 필요한 순간에 가장 약한 지점입니다 — 외부 로그 스택이 있으면 그쪽에 남습니다.',
    },
  ],
};

/** 출처가 무엇이든 줄 처리 파이프라인에 들어가는 모양 (아직 원문이다) */
interface FetchedLines {
  lines: string[];
  /** 줄마다의 파드·컨테이너 (합쳐보기). 단일 파드면 null */
  prefixes: ({ pod: string; container: string } | null)[] | null;
  streams: ('stdout' | 'stderr' | null)[] | null;
  bytesLimitReached: boolean;
  dropped?: number;
  notices: LogNotice[];
  /** stack 워크로드 합쳐보기에서 서버가 푼 파드 */
  resolvedPods?: string[] | null;
  /** 실제 조회 기간 (stack은 from·to를 서버가 확정한다). direct는 undefined */
  rangeFromMs?: number | null;
  rangeToMs?: number;
  /** 줄 수·바이트 상한에 걸리지 않고 기간 안의 줄을 **다** 가져왔는가 (그 시각 찾기용) */
  complete?: boolean;
  /**
   * 줄이 0개인 **이유를 안내가 이미 말한다**(출처 실패·이전 세대 없음·시작 전 등).
   * 이때는 `LOG_EMPTY`("조회 성공, 줄 0개")를 붙이지 않는다 — 성공한 것이 아니다
   */
  explained?: boolean;
}

export interface QueryInput {
  source?: 'direct' | 'stack';
  selector: LogSelector;
  range?: { sinceSec?: number; from?: string; to?: string; whole?: boolean };
  limit?: number;
  search?: { text: string; caseSensitive?: boolean } | null;
  /** 그 시각으로 열기 (알림·이벤트 링크의 `at`, 계약 2.2.1). 정지 조회 전용 */
  anchorAt?: string | null;
}

/** stack 합쳐보기 최대 파드 수 (계약 1.4 `pods` 최대 20) */
export const MAX_MULTI_PODS = 20;

@Injectable()
export class LogsService {
  private scenario: LogScenario = 'direct';

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly options: LogsOptions,
    private readonly store: ClusterStore,
    private readonly direct: DirectLogSource,
    private readonly backend: LogBackendService,
    private readonly linkPolicy: LogLinkPolicy,
  ) {
    // mock에서 시나리오가 스택의 유무를 정한다 (AC-LOG48·42)
    this.backend.bindScenario(() => this.scenario);
  }

  // --- mock 시나리오 --------------------------------------------------------

  readonly scenarios = LOG_SCENARIOS;
  readonly scenarioOptions = LOG_SCENARIO_OPTIONS;

  currentScenario(): string {
    return this.scenario;
  }

  /** mock `container-starting`: 시나리오를 고른 뒤 이 시각에 컨테이너가 "시작"된다 */
  private mockStartsAt = 0;

  /** mock `container-starting`에서 컨테이너가 시작됐는가 (그 밖의 시나리오는 항상 true) */
  mockContainerStarted(): boolean {
    return (
      this.scenario !== 'container-starting' || Date.now() >= this.mockStartsAt
    );
  }

  setScenario(name: string): void {
    this.scenario = name as LogScenario;
    this.mockStartsAt =
      name === 'container-starting' ? Date.now() + MOCK_CONTAINER_START_MS : 0;
    // `disabled`면 **링크도 함께** 사라져야 한다(디자인 15절 "메뉴·탭·링크가 사라진 것까지").
    // 링크는 cluster·alerts가 만들므로 공용 정책 값에 알린다 (logs.md 11.4)
    this.linkPolicy.setMockDisabled(name === 'disabled');
  }

  // --- 공통 -----------------------------------------------------------------

  /**
   * `LOGS_ENABLED=false`이거나 mock `disabled` 시나리오면 false.
   * 링크 규칙(`log-href.ts`)과 **같은 값**을 본다 — API는 403인데 링크가 남는 일이 없게
   */
  get enabled(): boolean {
    return this.linkPolicy.enabled;
  }

  private ensureEnabled(): void {
    if (this.enabled) return;
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'LOG_DISABLED',
      '로그 기능이 꺼져 있습니다 (LOGS_ENABLED=false).',
    );
  }

  private ensureNamespace(namespace: string): void {
    if (!this.options.denied(namespace)) return;
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'LOG_NAMESPACE_DENIED',
      `이 네임스페이스의 로그는 조회할 수 없습니다 (LOG_DENY_NAMESPACES): ${namespace}`,
      { namespace },
    );
  }

  private get sourceState(): LogSourceInfo['state'] {
    if (this.dataSource === 'mock') return 'mock';
    return this.direct.available ? 'ok' : 'unavailable';
  }

  directCapabilities(): LogCapabilities {
    return {
      follow: true,
      // direct는 서버 검색이 없다 — "될 것 같다"고 보내지 못하게 계약이 400으로 막는다
      serverSearch: false,
      searchScope: 'fetched',
      range: 'current_file',
      rangeOptions: DIRECT_RANGE_OPTIONS,
      previousGeneration: true,
      gonePods: false,
      multiPod: false,
      // stdout/stderr 미분리 (1.32+ 알파 게이트가 필요하다)
      streamSplit: false,
      retentionHours: null,
      labels: {
        search: '화면 안에서 찾기',
        searchHint: `가져온 ${this.options.limits.defaultLines}줄 안에서만 찾습니다. 지난 로그 검색은 외부 로그 스택이 필요합니다.`,
      },
    };
  }

  /**
   * 스택의 능력. **화면이 출처 이름으로 추론하지 않는다** — 서버가 내려준다 (AC-LOG47).
   * `direct`와 다른 것은 능력이지 응답 모양이 아니다.
   */
  stackCapabilities(): LogCapabilities {
    const retention = this.backend.retentionHours;
    return {
      follow: true,
      serverSearch: true,
      searchScope: 'server',
      range: 'retention',
      rangeOptions: STACK_RANGE_OPTIONS,
      // 기간으로 충분하다 (이전 세대라는 개념이 없다)
      previousGeneration: false,
      gonePods: true,
      multiPod: true,
      streamSplit: true,
      retentionHours: retention,
      labels: {
        search: '검색',
        searchHint: retention
          ? `보관 기간(${Math.round(retention / 24)}일) 안의 로그를 서버에서 찾습니다.`
          : '보관 기간 안의 로그를 서버에서 찾습니다.',
      },
    };
  }

  capabilitiesOf(source: LogSourceId): LogCapabilities {
    return source === 'stack'
      ? this.stackCapabilities()
      : this.directCapabilities();
  }

  /**
   * 서버가 고른 기본 출처. **자동 전환은 절대 하지 않는다** —
   * 스택이 죽어도 이 값은 `stack`으로 남고 안내만 붙는다 (AC-LOG42).
   */
  activeSource(): LogSourceId {
    return this.backend.configured ? 'stack' : 'direct';
  }

  sourceInfo(source: LogSourceId = this.activeSource()): LogSourceInfo {
    if (source === 'stack') {
      const st = this.backend.currentState();
      return {
        id: 'stack',
        label: '로그 스택',
        state: st === 'not_configured' ? 'not_configured' : st,
      };
    }
    return { id: 'direct', label: '직접 조회', state: this.sourceState };
  }

  // --- 2.1.1 capabilities ---------------------------------------------------

  capabilities(openStreams: number): Record<string, unknown> {
    // 로그 화면을 보고 있을 때만 스택을 확인한다 (30초에 한 번 이하)
    void this.backend.ensureChecked();
    const notices: LogNotice[] = [];
    const stackOn = this.backend.configured;
    const backendState = this.backend.currentState();
    const active = this.activeSource();
    if (stackOn && backendState === 'unavailable') {
      // **자동으로 직접 조회로 내려가지 않는다.** 전환 버튼은 화면이 그린다.
      // 코드는 실제 실패 종류대로(연결 실패 / 인증 실패) — 조회 응답의 안내와 같은 코드다
      const e = this.backend.error;
      notices.push({
        code: e?.code ?? 'LOG_BACKEND_UNAVAILABLE',
        level: 'warn',
        text:
          e?.message ??
          '로그 스택에 연결하지 못했습니다. 직접 조회로 전환할 수 있습니다.',
        details: { fallbackSource: 'direct' },
      });
    }
    if (this.dataSource === 'live' && !stackOn && !this.direct.available) {
      notices.push({
        code: 'LOG_SOURCE_NOT_CONFIGURED',
        level: 'warn',
        // mock 로그를 대신 보여주지 않는다 (AC-LOG24)
        text: '클러스터 연결도 로그 스택도 없습니다. 로그를 가져올 수 없습니다.',
      });
    }
    return {
      dataSource: this.dataSource,
      generatedAt: new Date().toISOString(),
      enabled: this.enabled,
      activeSource: active,
      autoSelect: stackOn
        ? {
            source: 'stack',
            code: 'LOG_BACKEND_CONFIGURED',
            text: '외부 로그 스택이 설정돼 있어 자동 선택했습니다.',
          }
        : {
            source: 'direct',
            code: 'LOG_BACKEND_NOT_CONFIGURED',
            text: '외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)',
          },
      sources: [
        {
          id: 'stack',
          label: '로그 스택',
          productLabel: this.backend.productLabel,
          selectable: stackOn,
          // 스택이 없는 것은 **오류가 아니다** (AC-LOG45)
          state: backendState,
          disabledReason: stackOn
            ? null
            : '외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)',
          // 비활성이어도 포커스를 받아 툴팁을 읽을 수 있어야 한다
          tooltip: stackOn
            ? null
            : '로그 스택을 쓰면 가능해지는 것: 지난 로그 검색 · 기간 선택 · 사라진 파드 · 여러 파드 합쳐보기',
          chips: stackOn ? this.stackChips() : [],
          capabilities: stackOn ? this.stackCapabilities() : null,
          limitations: null,
        },
        {
          id: 'direct',
          label: '직접 조회',
          productLabel: null,
          selectable: true,
          state: this.sourceState,
          disabledReason: null,
          tooltip: null,
          // 없는 능력을 회색 칩으로 나열하지 않는다
          chips: [],
          capabilities: this.directCapabilities(),
          limitations: DIRECT_LIMITATIONS,
        },
      ],
      limits: { ...this.options.limits },
      streams: { open: openStreams, max: this.options.limits.maxStreams },
      redaction: {
        // **끄는 설정이 없다** (AC-LOG09)
        alwaysOn: true,
        notice:
          '비밀값 가림은 흔한 형태만 잡습니다. 완벽하지 않습니다 — 화면 공유·스크린샷 전에 직접 확인하세요.',
        // 목록이 정본이다. 화면·문서에 개수를 숫자로 박지 않는다
        rules: REDACTION_RULES.map((r) => ({ ...r })),
        sourceNote:
          '원문은 대시보드에서 볼 수 없습니다. 필요하면 터미널에서 kubectl logs로 확인하세요.',
      },
      denyNamespaces: [...this.options.denyNamespaces],
      notices,
    };
  }

  // --- 2.1.2 targets --------------------------------------------------------

  targets(namespace: string, name: string): Record<string, unknown> {
    this.ensureEnabled();
    this.ensureNamespace(namespace);
    const gone =
      this.dataSource === 'mock' && this.scenario === 'pod-gone'
        ? true
        : !this.store.pods.has(podKey(namespace, name));
    const pod = this.store.pods.get(podKey(namespace, name));
    const deletedAtMs = this.store.history.deletedAtOf(namespace, name);
    const notices: LogNotice[] = [];

    if (gone || !pod) {
      const deletedAt = deletedAtMs
        ? new Date(deletedAtMs).toISOString()
        : this.dataSource === 'mock' && this.scenario === 'pod-gone'
          ? new Date(Date.now() - 18 * 60_000).toISOString()
          : null;
      notices.push({
        code: 'LOG_POD_NOT_FOUND',
        level: 'info',
        text: '이 파드는 더 이상 존재하지 않습니다. 쿠버네티스는 파드 객체가 사라지면 그 컨테이너 로그를 더 이상 제공하지 않습니다.',
        ...(deletedAt ? { details: { deletedAt } } : {}),
      });
      // **404가 아니라 200이다.** "파드가 없다"는 화면이 그려야 할 사실이다 (AC-LOG26)
      return {
        dataSource: this.dataSource,
        generatedAt: new Date().toISOString(),
        pod: {
          ref: { kind: 'Pod', namespace, name },
          exists: false,
          deletedAt,
          phase: null,
          nodeName: null,
          nodeReporting: null,
          isControlPlaneComponent: this.isControlPlaneComponent(
            namespace,
            name,
            null,
          ),
        },
        containers: [],
        defaultContainer: null,
        links: {
          // 마지막으로 알던 소속 워크로드 (최근 삭제 캐시). 디자인 10절 `소속 워크로드에서 새 파드 보기`
          workload: workloadLink(
            this.store.history.lastOwner(podKey(namespace, name)),
          ),
          events: `/cluster/events?target=${namespace}/${name}`,
          node: null,
        },
        stackSearch: {
          // **서버 값이다.** 화면이 출처 상태를 추측하지 않는다
          available:
            this.backend.configured &&
            this.backend.currentState() !== 'unavailable',
          hint: '로그 스택에서 이 파드 찾기',
        },
        notices,
      };
    }

    const containers = describeContainers(pod);
    const isCp = this.isControlPlaneComponent(namespace, name, pod.nodeName);
    const nodeReady = pod.nodeName
      ? (this.store.nodes
          .get(pod.nodeName)
          ?.conditions.find((c) => c.type === 'Ready')?.value ?? 'Unknown') ===
        'True'
      : null;
    if (nodeReady === false) {
      notices.push({
        code: 'LOG_NODE_NOT_REPORTING',
        level: 'warn',
        // **조회를 막지 않는다** (성공할 수도 있다, AC-LOG32)
        text: '대상 노드가 NotReady 상태입니다. 로그 조회가 실패할 수 있지만 막지는 않습니다.',
        details: { nodeName: pod.nodeName },
      });
    }
    if (isCp) {
      notices.push({
        code: 'LOG_APISERVER_SELF_DEPENDENCY',
        level: 'info',
        // 스택이 있으면 한 문장을 잇는다 (디자인 11.2, 계약 11.3)
        text: this.backend.configured
          ? 'kube-apiserver 로그는 kube-apiserver를 통해 읽습니다. apiserver가 멈추면 그 로그도 볼 수 없습니다. 외부 로그 스택이 있으면 그쪽에는 남아 있을 수 있습니다.'
          : 'kube-apiserver 로그는 kube-apiserver를 통해 읽습니다. apiserver가 멈추면 그 로그도 볼 수 없습니다.',
        // 첫 줄의 도움말 툴팁 (디자인 11.2). 화면은 문구를 만들지 않고 이 값을 쓴다
        details: {
          hint: 'etcd가 멈추면 apiserver도 멈추므로 etcd-manager 로그도 같은 한계가 있습니다.',
        },
      });
      notices.push({
        code: 'LOG_CONTROL_PLANE_SENSITIVE',
        level: 'warn',
        text: '컨트롤 플레인 로그에는 클러스터 사용자 이름·요청 경로·인증 실패 내역이 나올 수 있습니다.',
      });
    }

    return {
      dataSource: this.dataSource,
      generatedAt: new Date().toISOString(),
      pod: {
        ref: { kind: 'Pod', namespace, name },
        exists: true,
        deletedAt: null,
        phase: pod.phase,
        nodeName: pod.nodeName,
        nodeReporting: nodeReady,
        isControlPlaneComponent: isCp,
      },
      containers,
      defaultContainer: pickDefaultContainer(containers),
      links: {
        // 소유자를 **해석한 뒤** 링크를 만든다. 원시 소유자(ReplicaSet)로 만들면
        // `focus=ReplicaSet/prod/api-7f9c8d6b5`가 되어 워크로드 화면에서 찾을 수 없다
        workload: workloadLink(
          resolveOwner(pod, this.store.workloads)?.workloadKey ?? null,
        ),
        events: `/cluster/events?target=${namespace}/${name}`,
        node: pod.nodeName ? `/cluster/nodes/${pod.nodeName}` : null,
      },
      stackSearch: {
        // **서버 값이다.** 화면이 출처 상태를 추측하지 않는다
        available:
          this.backend.configured &&
          this.backend.currentState() !== 'unavailable',
        hint: '로그 스택에서 이 파드 찾기',
      },
      notices,
    };
  }

  // --- 2.2 query ------------------------------------------------------------

  async query(
    input: QueryInput,
    openStreams: number,
  ): Promise<Record<string, unknown>> {
    this.ensureEnabled();
    const sel = input.selector;
    this.ensureNamespace(sel.namespace);
    const limits = this.options.limits;
    const requested = input.limit ?? limits.defaultLines;
    const applied = Math.min(Math.max(1, requested), limits.maxLines);
    const notices: LogNotice[] = [];
    if (requested > limits.maxLines) {
      // 넘으면 400이 아니라 상한으로 자르고 알린다 (AC-LOG14)
      notices.push({
        code: 'LOG_LIMIT_CLAMPED',
        level: 'info',
        text: `요청한 줄 수가 상한(${limits.maxLines}줄)으로 잘렸습니다.`,
        details: { requested, applied },
      });
    }

    const queryId = `q-${randomBytes(3).toString('hex')}`;
    const source: LogSourceId = input.source ?? this.activeSource();
    const container = sel.container ?? this.defaultContainerOf(sel);
    const nowMs = Date.now();
    // 그 시각으로 열기 (계약 2.2.1). 화면이 기간을 고르지 않았으면 **서버가 그 시각을 덮는 기간을 고른다**
    const anchorMs = input.anchorAt ? Date.parse(input.anchorAt) : null;
    const range = input.range ?? this.anchorRange(source, anchorMs, nowMs);
    const sinceSec = range?.sinceSec ?? null;
    const fetched =
      source === 'stack'
        ? await this.readFromStack({ ...input, range }, applied, notices)
        : await this.readLines({
            namespace: sel.namespace,
            pod: sel.pod ?? '',
            container,
            previous: sel.previous === true,
            tailLines: applied,
            sinceSeconds: range?.whole ? null : sinceSec,
            notices,
          });

    // **가림은 두 출처 모두에 같은 규칙으로** 적용된다 (AC-LOG41).
    // 스택에서 온 줄이라고 건너뛰지 않는다 — 규칙은 하나다.
    const redact = createLineRedactor(this.options.extraPatterns);
    const processed = processLines(fetched.lines, {
      idPrefix: queryId,
      startSeq: 0,
      maxLineBytes: limits.maxLineBytes,
      redact,
      prefixes: fetched.prefixes,
      streams: fetched.streams,
    });
    const lines: LogLine[] = processed.lines;
    const stats: LogStats = { ...processed.stats, requested };

    if (fetched.dropped && fetched.dropped > 0) {
      stats.droppedLines = fetched.dropped;
      notices.push({
        code: 'LOG_DROPPED_LINES',
        level: 'warn',
        text: `초당 상한(${limits.maxLinesPerSec}줄)으로 ${fetched.dropped}줄이 생략됐습니다.`,
        details: { droppedLines: fetched.dropped },
      });
    }
    if (fetched.bytesLimitReached) {
      notices.push({
        code: 'LOG_BYTES_LIMIT_REACHED',
        level: 'warn',
        text: `바이트 상한(${limits.maxBytes})에 걸려 더 가져오지 못했습니다.`,
      });
    }
    if (lines.length === 0 && !fetched.explained) {
      notices.push({
        code: 'LOG_EMPTY',
        level: 'info',
        // 조회 성공, 줄 0개. **오류가 아니다**
        text: '이 기간에 출력된 로그가 없습니다.',
      });
    }
    if (stats.truncatedLines > 0) {
      notices.push({
        code: 'LOG_TRUNCATED_LINE',
        level: 'info',
        text: `${stats.truncatedLines}줄이 길이 상한(${limits.maxLineBytes}바이트)에서 잘렸습니다.`,
      });
    }
    if (stats.binaryLines > 0) {
      notices.push({
        code: 'LOG_BINARY_LINE',
        level: 'info',
        text: `바이너리로 판정된 줄 ${stats.binaryLines}개를 접었습니다.`,
      });
    }
    if (stats.redactedCount > 0) {
      notices.push({
        code: 'LOG_REDACTED',
        level: 'info',
        text: `가림 ${stats.redactedCount}건`,
        details: { lines: stats.redactedLines, count: stats.redactedCount },
      });
    }
    if (stats.redactFailedLines > 0) {
      notices.push({
        code: 'LOG_REDACT_FAILED',
        level: 'error',
        text: `가림 처리에 실패한 줄 ${stats.redactFailedLines}개를 생략했습니다. 원문은 보내지 않습니다.`,
      });
    }
    notices.push(...fetched.notices);

    let anchor: LogAnchor | null = null;
    if (anchorMs !== null && Number.isFinite(anchorMs)) {
      const at = new Date(anchorMs).toISOString();
      const located = locateAnchor({
        lines,
        anchorMs,
        rangeFromMs:
          fetched.rangeFromMs !== undefined
            ? fetched.rangeFromMs
            : sinceSec && !range?.whole
              ? nowMs - sinceSec * 1000
              : null,
        complete:
          fetched.complete ??
          (fetched.lines.length < applied && !fetched.bytesLimitReached),
        // 이전 세대를 보는 중이면 "지금 세대 시작 전" 판단을 하지 않는다
        generationStartMs:
          source === 'direct' && sel.previous !== true
            ? this.generationStartOf(sel.namespace, sel.pod, container)
            : null,
      });
      anchor = { at, state: located.state, lineId: located.lineId };
      const n = anchorNotice(located, {
        at,
        source,
        appliedLines: applied,
        maxLines: limits.maxLines,
      });
      if (n) notices.push(n);
    }

    // `direct`는 `serverSearch: false`다. 검색어가 오면 컨트롤러가 이미 400으로 막았다
    // (화면이 "될 것 같다"고 보내는 일을 막는다). 여기서 조용히 무시하지 않는다.
    const now = new Date(nowMs);
    return {
      dataSource: this.dataSource,
      generatedAt: now.toISOString(),
      queryId,
      source: this.sourceInfo(source),
      capabilities: this.capabilitiesOf(source),
      selector: {
        namespace: sel.namespace,
        pod: sel.pod ?? null,
        pods: sel.pods ?? null,
        workload: sel.workload ?? null,
        container,
        previous: sel.previous === true,
        // stack 합쳐보기에서 서버가 워크로드를 풀어 실제로 조회한 파드 (계약 1.4). 그 밖에는 null
        resolvedPods: fetched.resolvedPods ?? null,
      },
      range:
        fetched.rangeFromMs !== undefined
          ? {
              from:
                fetched.rangeFromMs === null
                  ? null
                  : new Date(fetched.rangeFromMs).toISOString(),
              to: new Date(fetched.rangeToMs ?? nowMs).toISOString(),
              whole: false,
            }
          : {
              from: sinceSec
                ? new Date(nowMs - sinceSec * 1000).toISOString()
                : null,
              to: now.toISOString(),
              whole: range?.whole === true,
            },
      lines,
      stats,
      streams: { open: openStreams, max: limits.maxStreams },
      // 그 시각으로 열었을 때만. 화면은 `lineId` 줄로 스크롤하고 표식을 그린다 (계약 2.2.1)
      anchor,
      notices,
    };
  }

  /**
   * `anchorAt`만 오고 기간이 없을 때 서버가 고르는 기간 (계약 2.2.1).
   * - direct: 그 시각 **2분 앞부터 지금까지** (`sinceSec`). 쿠버네티스는 끝 시각을 받지 않고
   *   **최근 N줄**을 주므로, 그 뒤에 줄이 많으면 그 시각까지 닿지 않을 수 있다 → 안내가 붙는다
   * - stack: 그 시각 **앞뒤 5분** (`from`·`to`)
   */
  private anchorRange(
    source: LogSourceId,
    anchorMs: number | null,
    nowMs: number,
  ): QueryInput['range'] {
    if (anchorMs === null || !Number.isFinite(anchorMs)) return undefined;
    if (source === 'stack') {
      return {
        from: new Date(anchorMs - ANCHOR_WINDOW_SEC * 1000).toISOString(),
        to: new Date(
          Math.min(nowMs, anchorMs + ANCHOR_WINDOW_SEC * 1000),
        ).toISOString(),
      };
    }
    return {
      sinceSec: Math.max(
        1,
        Math.ceil((nowMs - anchorMs) / 1000) + ANCHOR_LEAD_SEC,
      ),
    };
  }

  /** direct 현재 세대 컨테이너가 시작된 시각 (informer 캐시). 실행 중이 아니거나 모르면 null */
  private generationStartOf(
    namespace: string,
    pod: string | undefined,
    container: string,
  ): number | null {
    if (!pod) return null;
    const raw = this.store.pods.get(podKey(namespace, pod));
    const c = [...(raw?.containers ?? []), ...(raw?.initContainers ?? [])].find(
      (x) => x.name === container,
    );
    const st = c?.status?.state;
    if (st?.type !== 'running' || !st.since) return null;
    const ms = Date.parse(st.since);
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * 워크로드 → 소속 파드 (stack 합쳐보기, 계약 1.4). **쿠버네티스를 새로 부르지 않는다**:
   * 지금 있는 파드는 informer 캐시, 사라진 파드는 최근 삭제 캐시(1시간)에서 온다.
   * 지금 파드 먼저(이름순), 사라진 파드는 최근 것 먼저. 최대 `MAX_MULTI_PODS`.
   */
  resolveWorkloadPods(
    namespace: string,
    workload: NonNullable<LogSelector['workload']>,
  ): { pods: string[]; total: number } {
    const key = workloadKey(workload.kind, namespace, workload.name);
    const current: string[] = [];
    for (const p of this.store.pods.values()) {
      if (p.namespace !== namespace) continue;
      if (resolveOwner(p, this.store.workloads)?.workloadKey === key)
        current.push(p.name);
    }
    current.sort();
    const seen = new Set(current);
    const gone = this.store.history
      .deletedPodsOf(key)
      .map((d) => d.name)
      .filter((n) => !seen.has(n));
    const all = [...current, ...gone];
    return { pods: all.slice(0, MAX_MULTI_PODS), total: all.length };
  }

  /** 능력 칩. **서버가 준 그대로** 화면이 그린다 (없는 능력을 회색으로 나열하지 않는다) */
  stackChips(): { id: string; label: string }[] {
    const chips = [
      { id: 'search', label: '검색' },
      { id: 'range', label: '기간' },
      { id: 'gonePods', label: '사라진 파드' },
      { id: 'multiPod', label: '합쳐보기' },
    ];
    const h = this.backend.retentionHours;
    if (h) {
      chips.push({
        id: 'retention',
        label: h >= 24 ? `보관 ${Math.round(h / 24)}일` : `보관 ${h}시간`,
      });
    }
    return chips;
  }

  /** 스택 조회 기간 상한(시간). 넘는 요청은 컨트롤러가 400으로 막는다 */
  get stackMaxRangeHours(): number {
    return this.backend.maxRangeHours;
  }

  /**
   * 외부 로그 스택 조회. **여기서 LogQL을 만들지 않는다** — 어댑터가 만든다.
   * 돌아오는 줄은 **아직 원문**이고 호출부가 `processLines`(→ 가림)를 거친다.
   */
  private async readFromStack(
    input: QueryInput,
    limit: number,
    notices: LogNotice[],
  ): Promise<FetchedLines> {
    const port = this.backend.port;
    if (!port) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'LOG_BACKEND_UNAVAILABLE',
        '외부 로그 스택이 설정돼 있지 않습니다.',
      );
    }
    const sel = input.selector;
    const now = Date.now();
    const sinceSec = input.range?.sinceSec ?? 3600;
    const from = input.range?.from
      ? new Date(input.range.from)
      : new Date(now - sinceSec * 1000);
    const to = input.range?.to ? new Date(input.range.to) : new Date(now);

    // 워크로드 합쳐보기: 서버가 소속 파드를 푼다. 풀지 않고 넘기면 어댑터가 **네임스페이스 전체**를
    // 조회하게 된다(2026-09-25 수정 전 결함)
    let pods = sel.pods?.length ? sel.pods : sel.pod ? [sel.pod] : [];
    let resolvedPods: string[] | null = null;
    if (!pods.length && sel.workload) {
      const r = this.resolveWorkloadPods(sel.namespace, sel.workload);
      pods = r.pods;
      resolvedPods = r.pods;
      if (r.total > r.pods.length) {
        notices.push({
          code: 'LOG_PODS_CLAMPED',
          level: 'info',
          text: `소속 파드가 ${r.total}개라 ${r.pods.length}개만 합쳐 봅니다. 나머지는 파드를 골라 보세요.`,
          details: { total: r.total, applied: r.pods.length },
        });
      }
      if (pods.length === 0) {
        notices.push({
          code: 'LOG_WORKLOAD_NO_PODS',
          level: 'info',
          text: '이 워크로드의 파드를 찾지 못했습니다(지금 있는 파드도, 최근 1시간 안에 사라진 파드도 없습니다). 더 오래전에 사라진 파드는 이름으로 조회하세요.',
        });
        return {
          lines: [],
          prefixes: null,
          streams: null,
          bytesLimitReached: false,
          notices: [],
          resolvedPods,
          rangeFromMs: from.getTime(),
          rangeToMs: to.getTime(),
          complete: true,
          explained: true,
        };
      }
    }

    const retention = this.backend.retentionHours;
    if (retention && now - from.getTime() > retention * 3_600_000) {
      // **오류가 아니라 안내다.** 결과는 그대로 준다 (AC-LOG38)
      notices.push({
        code: 'LOG_RETENTION_EXCEEDED',
        level: 'info',
        text: `요청한 기간의 일부가 보관 기간(${Math.round(retention / 24)}일) 밖입니다. 그 구간은 남아 있지 않을 수 있습니다.`,
        details: { retentionHours: retention },
      });
    }

    let entries: LogBackendEntry[];
    try {
      entries = await port.query({
        selector: {
          namespace: sel.namespace,
          pods,
          containers: sel.container ? [sel.container] : [],
          workload: sel.workload ?? null,
        },
        from,
        to,
        limit,
        search: input.search
          ? {
              text: input.search.text,
              caseSensitive: input.search.caseSensitive === true,
            }
          : null,
      });
      this.backend.reportSuccess();
    } catch (err) {
      if (err instanceof LogBackendError) {
        this.backend.reportFailure(err);
        // 계약 6절: 스택 실패는 **안내(notice)**다 — 200 + 줄 0개 (PM 결정 2026-09-25, mock·live 같은 모양).
        // **자동으로 직접 조회로 내려가지 않는다**(AC-LOG42): `source`는 stack 그대로, 전환은 사용자 클릭
        notices.push(backendErrorNotice(err));
        return {
          lines: [],
          prefixes: null,
          streams: null,
          bytesLimitReached: false,
          notices: [],
          resolvedPods,
          // 요청한 기간을 그대로 돌려준다 — 서버가 조용히 범위를 줄이지 않는다(AC-LOG43)
          rangeFromMs: from.getTime(),
          rangeToMs: to.getTime(),
          complete: true,
          explained: true,
        };
      }
      throw err;
    }

    // 여러 파드를 볼 때만 줄마다 파드·컨테이너를 붙인다
    const multi = pods.length > 1 || Boolean(sel.workload);
    return {
      lines: entries.map((e) => `${e.at} ${e.line}`),
      prefixes: multi
        ? entries.map((e) => ({ pod: e.pod, container: e.container }))
        : null,
      streams: entries.map((e) => e.stream),
      bytesLimitReached: false,
      // 안내는 위에서 받은 배열에 **직접** 넣었다. 여기서 또 돌려주면 두 번 실린다
      notices: [],
      resolvedPods,
      rangeFromMs: from.getTime(),
      rangeToMs: to.getTime(),
      complete: entries.length < limit,
    };
  }

  /** 기본 컨테이너는 **서버가 고른다** (명세 3.8.2). 화면이 고르지 않는다 */
  defaultContainerOf(sel: LogSelector): string {
    const pod = sel.pod
      ? this.store.pods.get(podKey(sel.namespace, sel.pod))
      : undefined;
    if (!pod) return sel.container ?? '';
    return pickDefaultContainer(describeContainers(pod)) ?? '';
  }

  /** 파드가 informer 캐시에 있는지 (스트림 준비 단계에서 404를 미리 돌려주기 위해) */
  podExists(namespace: string, name: string): boolean {
    // `pod-gone` 시나리오는 어떤 파드든 "사라졌다"로 재현한다
    if (this.dataSource === 'mock' && this.scenario === 'pod-gone')
      return false;
    return this.store.pods.has(podKey(namespace, name));
  }

  /** 외부 로그 스택을 지금 쓸 수 있는가 (설정 여부. 연결 상태와 별개다) */
  get stackAvailable(): boolean {
    return this.backend.configured;
  }

  /**
   * 스트림 준비 단계의 사전 검사. **연결 전에** 읽을 수 있는 JSON 오류로 돌려준다
   * (EventSource는 오류 본문을 못 읽는다 — 계약 2.3.1).
   */
  assertStreamable(source: LogSourceId, namespace: string, pod: string): void {
    this.ensureEnabled();
    this.ensureNamespace(namespace);
    if (source === 'stack') {
      // 스택은 **사라진 파드도** 읽을 수 있다 (AC-LOG40) — 존재 검사를 하지 않는다
      return;
    }
    if (this.dataSource === 'mock' && this.scenario === 'forbidden') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'LOG_FORBIDDEN',
        'pods/log 권한이 없습니다. deploy/rbac.yaml을 다시 적용하세요.',
      );
    }
    if (!this.podExists(namespace, pod)) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'LOG_POD_NOT_FOUND',
        '이 파드는 더 이상 존재하지 않습니다.',
      );
    }
  }

  /**
   * 컨트롤 플레인 구성요소(미러 파드)인가 — **2중 조건**(cluster-status 계약 1.6):
   * ① `kube-system` + (노드를 알면) 마스터 노드, ② 이름이 필수 5종 접두어.
   * 이름만 보면 다른 네임스페이스의 `kube-apiserver-…`에도 자기참조 안내가 붙는다.
   */
  isControlPlaneComponent(
    namespace: string,
    name: string,
    nodeName: string | null,
  ): boolean {
    if (namespace !== 'kube-system' || componentKindOf(name) === null)
      return false;
    if (!nodeName) return true;
    const node = this.store.nodes.get(nodeName);
    return !node || node.role === 'control_plane';
  }

  /**
   * 원본 줄 읽기 (mock·live 공통 입구). **반환값은 아직 원문이다** —
   * 호출부가 반드시 `processLines`(→ 가림)를 거친다.
   */
  private async readLines(args: {
    namespace: string;
    pod: string;
    container: string;
    previous: boolean;
    tailLines: number;
    sinceSeconds: number | null;
    notices: LogNotice[];
  }): Promise<FetchedLines> {
    const notices: LogNotice[] = [];
    if (this.dataSource === 'mock') {
      // mock에서도 **없는 파드는 404**다 — live(쿠버네티스 404)와 같은 동작이어야
      // "스택은 사라진 파드를 읽고 직접 조회는 못 읽는다"는 차이를 확인할 수 있다
      if (!this.podExists(args.namespace, args.pod)) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'LOG_POD_NOT_FOUND',
          '이 파드는 더 이상 존재하지 않습니다.',
        );
      }
      if (this.scenario === 'kubelet-unreachable') {
        // live와 같은 경로: 쿠버네티스 오류 → 안내 (directErrorAsNotice 한 곳)
        const notice = this.directErrorAsNotice(
          new DirectLogError(
            'LOG_KUBELET_UNREACHABLE',
            '노드에 연결할 수 없어 로그를 읽지 못했습니다.',
          ),
          args,
        );
        return {
          lines: [],
          prefixes: null,
          streams: null,
          bytesLimitReached: false,
          notices: notice ? [notice] : [],
          explained: true,
        };
      }
      if (
        this.scenario === 'container-starting' &&
        !this.mockContainerStarted()
      ) {
        // live와 같은 모양: 200 + 줄 0개 + 안내 (정지 조회는 자동으로 다시 부르지 않는다)
        return {
          lines: [],
          prefixes: null,
          streams: null,
          bytesLimitReached: false,
          notices: [CONTAINER_NOT_STARTED_QUERY],
          explained: true,
        };
      }
      const res = mockLogLines(this.scenario, {
        previous: args.previous,
        limit: args.tailLines,
        controlPlane: this.isControlPlaneComponent(
          args.namespace,
          args.pod,
          this.store.pods.get(podKey(args.namespace, args.pod))?.nodeName ??
            null,
        ),
      });
      if (res.outcome === 'forbidden') {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'LOG_FORBIDDEN',
          'pods/log 권한이 없습니다. deploy/rbac.yaml을 다시 적용하세요.',
        );
      }
      if (res.outcome === 'gone') {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'LOG_POD_NOT_FOUND',
          '이 파드는 더 이상 존재하지 않습니다.',
        );
      }
      if (args.previous && this.scenario === 'empty') {
        notices.push({
          code: 'LOG_PREVIOUS_NOT_AVAILABLE',
          level: 'info',
          // 스위치를 자동으로 되돌리지 않고 안내만 한다
          text: '이전 세대 로그가 없습니다.',
        });
      }
      return {
        lines: res.lines,
        prefixes: null,
        streams: null,
        bytesLimitReached: false,
        dropped: res.dropped,
        notices,
        explained: notices.length > 0,
      };
    }

    try {
      const res = await this.direct.fetch({
        namespace: args.namespace,
        pod: args.pod,
        container: args.container,
        previous: args.previous,
        tailLines: args.tailLines,
        sinceSeconds: args.sinceSeconds,
        maxBytes: this.options.limits.maxBytes,
      });
      return {
        lines: res.lines,
        prefixes: null,
        // 직접 조회는 stdout/stderr를 구분하지 못한다 (1.32+ 알파 게이트 필요)
        streams: null,
        bytesLimitReached: res.bytesLimitReached,
        notices,
      };
    } catch (err) {
      // 계약 6절: "이전 세대 없음"·"컨테이너 시작 전"은 **안내(notice)**다. 오류(503)로 올리면
      // 화면이 오류 화면을 그린다 — mock(`logs=empty` + previous)과 같은 모양으로 맞춘다 (AC-LOG15)
      const notice = this.directErrorAsNotice(err, args);
      if (notice) {
        return {
          lines: [],
          prefixes: null,
          streams: null,
          bytesLimitReached: false,
          notices: [notice],
          explained: true,
        };
      }
      throw toApiError(err);
    }
  }

  /**
   * 쿠버네티스 오류 중 **안내로 내려야 하는 것**을 고른다 (2026-09-25, 테스트로 드러난 결함 수정).
   * - `LOG_PREVIOUS_NOT_AVAILABLE`: 스위치를 되돌리지 않고 안내만 (AC-LOG15)
   * - `LOG_CONTAINER_NOT_STARTED`: 오류가 아니다. 파드 watch가 Running을 알리면 다시 조회한다
   * - previous가 아닌 **400**: client-node 2.0이 400 본문을 넘기지 않아 메시지로 가를 수 없다
   *   (`direct-source.ts` `mapError` 주석) → informer 캐시상 그 컨테이너가 **한 번도 돌지 않은 대기**면 "시작 전"
   * - `LOG_KUBELET_UNREACHABLE`: apiserver가 그 노드의 kubelet에 못 닿았다. 로그 출처가 죽은 것이 아니다 —
   *   오류 화면으로 가리면 "다른 길(로그 스택)"을 안내할 자리를 잃는다 (PM 결정, 계약 6절 `details.nodeName`)
   */
  private directErrorAsNotice(
    err: unknown,
    args: {
      namespace: string;
      pod: string;
      container: string;
      previous: boolean;
    },
  ): LogNotice | null {
    if (!(err instanceof DirectLogError)) return null;
    if (err.code === 'LOG_PREVIOUS_NOT_AVAILABLE') {
      return {
        code: err.code,
        level: 'info',
        text: '이전 세대 로그가 없습니다.',
      };
    }
    const notStarted = CONTAINER_NOT_STARTED_QUERY;
    if (err.code === 'LOG_CONTAINER_NOT_STARTED') return notStarted;
    if (err.code === 'LOG_SOURCE_NOT_CONFIGURED') {
      // 계약 6절 notice — 화면 전체 `알 수 없음`. **mock 로그를 대신 보여주지 않는다**(AC-LOG24)
      return {
        code: err.code,
        level: 'warn',
        text: '클러스터 연결도 로그 스택도 없습니다. 로그를 가져올 수 없습니다.',
      };
    }
    if (err.code === 'LOG_KUBELET_UNREACHABLE') {
      const nodeName =
        this.store.pods.get(podKey(args.namespace, args.pod))?.nodeName ?? null;
      return {
        code: err.code,
        level: 'warn',
        // 문구 정본: 명세 3.4 · 디자인 8.7 (노드 링크는 화면이 `details.nodeName`으로 붙인다)
        text: '노드에 연결할 수 없어 로그를 읽지 못했습니다.',
        details: { nodeName },
      };
    }
    if (
      err.code === 'LOG_UPSTREAM_ERROR' &&
      err.details?.status === 400 &&
      !args.previous &&
      this.containerNeverStarted(args.namespace, args.pod, args.container)
    ) {
      return notStarted;
    }
    return null;
  }

  /**
   * informer 캐시상 그 컨테이너가 아직 한 번도 돌지 않았는가 (상태 없음, 또는 대기 + 재시작 0).
   * 스트림이 "시작될 때까지 기다린다"(계약 6절 `LOG_CONTAINER_NOT_STARTED`)의 판단에도 쓴다
   */
  containerNeverStarted(
    namespace: string,
    pod: string,
    container: string,
  ): boolean {
    const raw = this.store.pods.get(podKey(namespace, pod));
    const c = [...(raw?.containers ?? []), ...(raw?.initContainers ?? [])].find(
      (x) => x.name === container,
    );
    if (!c) return false;
    if (!c.status) return true;
    return c.status.state?.type === 'waiting' && c.status.restartCount === 0;
  }
}

/** mock `container-starting`: 시나리오를 고른 뒤 컨테이너가 시작되기까지 (계약 9절) */
export const MOCK_CONTAINER_START_MS = 30_000;

/**
 * 정지 조회의 "시작 전" 안내. 정지 조회는 **자동으로 다시 부르지 않으므로** 약속하지 않고
 * 따라가기를 권한다 (PM 결정 2026-09-25). 스트림 문구는 `log-stream.service.ts`에 따로 있다.
 */
export const CONTAINER_NOT_STARTED_QUERY: LogNotice = {
  code: 'LOG_CONTAINER_NOT_STARTED',
  level: 'info',
  text: '컨테이너가 아직 시작되지 않았습니다. 따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.',
};

/**
 * 로그 스택 실패 → 안내 (계약 6절). 문구는 어댑터가 만든 것(토큰·주소 없음) 그대로다.
 * - 연결·인증 실패는 `details.fallbackSource: 'direct'` — 화면의 `직접 조회로 전환` 버튼 자리. **자동 전환은 없다**
 * - 쿼리 거부는 스택이 준 사유를 **가림 처리한 채** `details.reason`에 (AC-LOG43)
 */
export function backendErrorNotice(err: LogBackendError): LogNotice {
  if (err.code === 'LOG_BACKEND_QUERY_REJECTED') {
    return {
      code: err.code,
      level: 'warn',
      text: err.message,
      details: { reason: err.detail },
    };
  }
  return {
    code: err.code,
    level: 'warn',
    text: err.message,
    details: { fallbackSource: 'direct' },
  };
}

/** 워크로드 화면 링크 (`/cluster/workloads?focus=<kind>/<ns>/<name>`). 모르면 null */
function workloadLink(key: string | null): string | null {
  return key ? `/cluster/workloads?focus=${key}` : null;
}

/** notice로 내려도 되는 것과 HTTP 오류로 올려야 하는 것을 나눈다 (계약 6절) */
export function toApiError(err: unknown): ApiException {
  if (err instanceof ApiException) return err;
  if (err instanceof DirectLogError) {
    if (err.code === 'LOG_FORBIDDEN')
      return new ApiException(HttpStatus.FORBIDDEN, err.code, err.message);
    if (err.code === 'LOG_POD_NOT_FOUND')
      return new ApiException(HttpStatus.NOT_FOUND, err.code, err.message);
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      err.code,
      err.message,
      err.details,
    );
  }
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'LOG_UPSTREAM_ERROR',
    '로그를 가져오지 못했습니다.',
  );
}

export interface ContainerInfo {
  name: string;
  init: boolean;
  ready: boolean;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
  waitingReason: string | null;
  restarts: { total: number; last1h: number };
  hasPrevious: boolean;
  recommended: boolean;
}

function describeContainers(pod: RawPod): ContainerInfo[] {
  const all = [
    ...pod.containers.map((c) => ({ c, init: false })),
    ...pod.initContainers.map((c) => ({ c, init: true })),
  ];
  const infos: ContainerInfo[] = all.map(({ c, init }) => ({
    name: c.name,
    init,
    ready: c.status?.ready ?? false,
    state: c.status?.state?.type ?? 'unknown',
    waitingReason:
      c.status?.state?.type === 'waiting'
        ? (c.status.state.reason ?? null)
        : null,
    restarts: {
      total: c.status?.restartCount ?? 0,
      last1h: 0,
    },
    hasPrevious: (c.status?.restartCount ?? 0) > 0,
    recommended: false,
  }));
  const pick = pickDefaultContainer(infos);
  for (const i of infos) i.recommended = i.name === pick;
  return infos;
}

/** ① 준비되지 않았거나 재시작 중인 컨테이너, ② 없으면 첫 번째 일반 컨테이너 */
function pickDefaultContainer(list: ContainerInfo[]): string | null {
  const normal = list.filter((c) => !c.init);
  const trouble = normal.find(
    (c) => !c.ready || c.state === 'waiting' || c.restarts.total > 0,
  );
  return trouble?.name ?? normal[0]?.name ?? list[0]?.name ?? null;
}
