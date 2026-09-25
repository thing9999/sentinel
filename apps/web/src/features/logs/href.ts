/**
 * `/logs` 화면의 URL 쿼리 **읽기** (docs/api/logs.md 11.4 "`/logs` 쿼리 파라미터", docs/design/logs.md 0절).
 *
 * **이 파일은 링크를 만들지 않는다.** 로그 화면으로 가는 링크는 전부 서버가 준 `logHref`를 그대로 쓴다
 * (파드·워크로드·이벤트·컨트롤 플레인·알림 — 계약 11.4. 서버 링크가 없는 자리는 이제 없다).
 * 통합 1차에 두었던 `logsHref()`·`logsHrefFromPodKey()`는 통합 3차에서 지웠다 — 서버 규칙(`log-href.ts`)과
 * 겹치는 두 번째 규칙이었고, `follow`·`LOG_DENY_NAMESPACES`가 한쪽만 먹을 수 있었다.
 *
 * - 서버 링크가 쓰는 이름: `namespace`·`pod`·`workload`·`follow=1`·`at`
 * - 화면 상태용(서버 링크에는 붙지 않는다): `container`·`source`·`range`·`lines`·`prev`
 * - **찾기 입력값은 URL에 없다**(명세 3.3.4 — 사용자가 검색칸에 비밀값을 칠 수 있다).
 * - 디자인 옛 문구의 `ns=`도 읽는다(옛 링크 호환).
 */

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

export interface WorkloadRef {
  /** `<Kind>/<namespace>/<name>` — `PodItem.owner.workloadKey`와 같은 형식 */
  key: string;
  kind: WorkloadKind;
  namespace: string;
  name: string;
}

const WORKLOAD_KINDS: readonly string[] = ["Deployment", "StatefulSet", "DaemonSet"];

/** `Deployment/prod/api` → 워크로드. 형식이 다르거나 종류가 셋 중 하나가 아니면 `null` */
export function parseWorkloadKey(key: string | null | undefined): WorkloadRef | null {
  if (!key) return null;
  const parts = key.split("/");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  const [kind, namespace, name] = parts;
  if (!WORKLOAD_KINDS.includes(kind)) return null;
  return { key, kind: kind as WorkloadKind, namespace, name };
}

/**
 * 서버 `logHref`에 **`container` 하나만** 덧붙인다(PM 결정 4 — 파드 상세 `로그 화면에서 열기`).
 * 막는 것은 **정책**(링크를 줄 수 있나·`follow`·`at`)이고 컨테이너는 사용자가 방금 고른 **화면 상태**다.
 * 링크를 줄 수 있는지는 여전히 서버 `logHref`가 있느냐로만 정한다. 다른 파라미터는 붙이지 않는다.
 */
export function withContainer(logHref: string, container: string | null | undefined): string {
  if (!container) return logHref;
  const u = new URL(logHref, "http://local");
  u.searchParams.set("container", container);
  return `${u.pathname}?${u.searchParams.toString()}`;
}

/** URL 쿼리 읽기. 서버가 만든 `namespace=`를 먼저 보고, 디자인 문구의 `ns=`도 받는다 */
export function readLogsQuery(get: (name: string) => string | null) {
  return {
    namespace: get("namespace") ?? get("ns"),
    pod: get("pod"),
    workload: parseWorkloadKey(get("workload")),
    container: get("container"),
    follow: get("follow") === "1",
    /** 그 시각(계약 2.2.1). 화면은 비교하지 않고 `anchorAt`으로 넘긴다 */
    at: get("at"),
    previous: get("prev") === "1",
    source: get("source"),
    range: get("range"),
    lines: get("lines"),
  };
}
