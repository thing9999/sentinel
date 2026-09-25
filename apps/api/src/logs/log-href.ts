/**
 * "로그 화면으로 가는 링크를 줄 수 있는가"와 "어떤 모양으로 주는가"를 정하는 **한 곳**
 * (docs/api/logs.md 11.4, docs/api/alerts.md 2.2.1).
 *
 * 의존성이 없는 잎 모듈로 둔 이유: 이 규칙을 쓰는 곳이 여러 모듈이다 —
 * `alerts`의 `logHref`(LogsModule)와 `cluster`의 `PodItem`·`WorkloadItem`·`EventItem`·
 * `ControlPlaneComponent`의 `logHref`(ClusterModule, 평가 단계). 두 모듈은 서로를 import할 수 없다
 * (LogsModule → ClusterModule 방향이라 반대로 걸면 순환이 된다).
 *
 * 규칙을 두 벌로 만들면 `LOG_DENY_NAMESPACES`를 켰을 때 한쪽만 막히는 일이 생긴다.
 * **화면은 링크 규칙을 갖지 않는다** — 서버가 준 `logHref`가 `null`이면 링크를 그리지 않을 뿐이다.
 */

export type LogHrefBlockedReason = 'logs_disabled' | 'namespace_denied';

/** 링크 가능 여부를 정하는 설정 (env `LOGS_ENABLED`·`LOG_DENY_NAMESPACES` + mock `logs=disabled`) */
export interface LogLinkPolicyValue {
  enabled: boolean;
  denyNamespaces: readonly string[];
}

/**
 * 링크가 그려지는 자리 (명세 3.8.1 진입점). **자리마다 `follow`/`at`을 여기서 정한다**
 * — 호출부가 파라미터를 고르지 않는다(PM 결정 D3, 2026-09-25).
 */
export type LogHrefEntry =
  | 'pod' //          진입점 1·2·7: 파드 상세·파드 목록 행·DB 파드 (+ 워크로드 상세의 소속 파드 행)
  | 'controlPlane' // 진입점 3: 컨트롤 플레인 매트릭스 칸
  | 'workload' //     진입점 5: 워크로드 상세 → 소속 파드 선택기가 붙은 로그 화면
  | 'event' //        진입점 4: Warning 이벤트 행 (대상이 파드일 때만)
  | 'alert'; //       진입점 8: 알림 항목

/**
 * 자리별 규칙.
 * - **지금 상태**에서 들어오는 자리(파드·매트릭스·워크로드)는 `follow=1` — 디자인 6.2
 *   "파드 상세·매트릭스에서 들어오면 따라가기 켬".
 * - **기록**에서 들어오는 자리(알림·이벤트)는 `at=<그 시각>`이고 `follow`를 붙이지 않는다 —
 *   따라가기를 켜면 맨 아래로 스크롤돼 그 시각을 잃는다(PM 결정 D3).
 * - `follow`와 `at`은 **동시에 붙지 않는다**(아래 테스트가 전수로 고정한다).
 */
export const LOG_HREF_ENTRY_RULES: Readonly<
  Record<LogHrefEntry, { follow: boolean; at: boolean }>
> = {
  pod: { follow: true, at: false },
  controlPlane: { follow: true, at: false },
  workload: { follow: true, at: false },
  event: { follow: false, at: true },
  alert: { follow: false, at: true },
};

interface PodTarget {
  entry: 'pod' | 'controlPlane';
  namespace: string;
  pod: string;
  container?: string | null;
}

interface WorkloadTarget {
  entry: 'workload';
  namespace: string;
  /** `Deployment/prod/api` (= `PodItem.owner.workloadKey`, `GET /api/cluster/pods?workload=`와 같은 형식) */
  workloadKey: string;
}

interface MomentTarget {
  entry: 'event' | 'alert';
  namespace: string;
  pod: string;
  container?: string | null;
  /** 그 기록의 시각 (ISO). 모르면 null → `at`을 붙이지 않는다 */
  at: string | null;
}

export type LogHrefTarget = PodTarget | WorkloadTarget | MomentTarget;

export interface LogHrefResult {
  href: string | null;
  blocked: LogHrefBlockedReason | null;
}

/** 링크를 줄 수 없는 이유. 줄 수 있으면 null */
export function logLinkBlocked(
  policy: LogLinkPolicyValue,
  namespace: string,
): LogHrefBlockedReason | null {
  if (!policy.enabled) return 'logs_disabled';
  if (policy.denyNamespaces.includes(namespace)) return 'namespace_denied';
  return null;
}

export function buildLogHref(
  policy: LogLinkPolicyValue,
  target: LogHrefTarget,
): LogHrefResult {
  const blocked = logLinkBlocked(policy, target.namespace);
  if (blocked) return { href: null, blocked };
  const rule = LOG_HREF_ENTRY_RULES[target.entry];
  const params = new URLSearchParams({ namespace: target.namespace });
  if (target.entry === 'workload') {
    params.set('workload', target.workloadKey);
  } else {
    params.set('pod', target.pod);
    if (target.container) params.set('container', target.container);
  }
  if (rule.follow) params.set('follow', '1');
  if (rule.at && 'at' in target && target.at) params.set('at', target.at);
  return { href: `/logs?${params.toString()}`, blocked: null };
}

/** `podKey`(`<ns>/<name>`)로 파드 링크를 만든다. 형식이 다르면 null */
export function buildPodKeyLogHref(
  policy: LogLinkPolicyValue,
  entry: 'pod' | 'controlPlane',
  podKey: string | null,
): string | null {
  if (!podKey) return null;
  const slash = podKey.indexOf('/');
  if (slash <= 0 || slash === podKey.length - 1) return null;
  return buildLogHref(policy, {
    entry,
    namespace: podKey.slice(0, slash),
    pod: podKey.slice(slash + 1),
  }).href;
}
