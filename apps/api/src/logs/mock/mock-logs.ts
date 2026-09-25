/**
 * mock 로그 픽스처 (docs/api/logs.md 9절).
 *
 * **픽스처에는 원문을 그대로 넣는다.** 서버가 가려서 내보내는 것을 눈으로·테스트로
 * 확인하기 위해서다 (AC-LOG04·05). 응답을 그대로 검색해 원문이 없으면 통과다.
 *
 * 여기 값은 전부 **가짜**다 (실제 키·토큰·계정이 아니다).
 */
export const LOG_SCENARIOS = [
  'direct',
  'stack',
  'stack-down',
  'secrets',
  'empty',
  'noisy',
  'binary',
  'forbidden',
  'pod-gone',
  'control-plane',
  'disabled',
  // 전용 스트림 이벤트를 수십 초 안에 보는 시나리오 (계약 9절, 2026-09-25).
  // 기준값만 줄이고 **서버 경로는 실제와 같다**(push·flush·checkLimits)
  'stream-notice',
  'idle-pause',
  'max-duration',
  // 따라가기에 초당 상한 가까이 줄을 흘린다 → 화면 링버퍼(2만 줄)가 수십 초 안에 찬다 (AC-LOG51)
  'flood',
  // 컨테이너가 30초 뒤에 시작된다 → 스트림은 기다렸다가 붙고, 정지 조회는 안내만 (계약 6절)
  'container-starting',
  // 로그 스택 인증 실패·쿼리 거부 — live(Loki 어댑터)와 **같은 문구·같은 모양** (PM 결정: mock = live)
  'stack-auth-failed',
  'stack-rejected',
  // apiserver가 그 노드의 kubelet에 못 닿음 — live와 같은 200 + notice (details.nodeName)
  'kubelet-unreachable',
] as const;
export type LogScenario = (typeof LOG_SCENARIOS)[number];

export const LOG_SCENARIO_OPTIONS: readonly {
  id: string;
  label: string;
  description?: string;
}[] = [
  {
    id: 'direct',
    label: '직접 조회 (기본)',
    description: '스택 없음, 여러 줄 스택 트레이스, 이전 세대가 다른 내용',
  },
  {
    id: 'stack',
    label: '로그 스택 있음 (Loki)',
    description: '검색·기간·합쳐보기·사라진 파드가 실제 Loki 없이 동작',
  },
  {
    id: 'stack-down',
    label: '로그 스택 연결 실패',
    description: '설정은 있는데 연결 실패 — 자동 전환 없음',
  },
  {
    id: 'secrets',
    label: '비밀값 섞인 로그',
    description: '토큰·접속 문자열·PEM·환경 변수 덤프 + Postgres 실패 SQL',
  },
  { id: 'empty', label: '출력 없음', description: 'LOG_EMPTY (오류가 아니다)' },
  { id: 'noisy', label: '초당 수천 줄', description: '생략 구간 표시' },
  {
    id: 'binary',
    label: 'ANSI·제어문자·바이너리',
    description: '긴 줄 자르기, 깨진 UTF-8',
  },
  { id: 'forbidden', label: 'pods/log 403', description: 'RBAC 미적용' },
  {
    id: 'pod-gone',
    label: '사라진 파드',
    description: 'exists:false + 삭제 시각',
  },
  {
    id: 'control-plane',
    label: '컨트롤 플레인 로그',
    description: 'kube-apiserver 자기참조 안내',
  },
  {
    id: 'disabled',
    label: '로그 기능 꺼짐',
    description: 'LOGS_ENABLED=false (링크도 함께 사라진다)',
  },
  {
    id: 'stream-notice',
    label: '따라가기 중 안내 (10초)',
    description:
      '따라가기 연결 10초 뒤 초당 상한을 넘는 폭주 1회 → log.notice(LOG_DROPPED_LINES) + 생략 줄',
  },
  {
    id: 'idle-pause',
    label: '유휴 일시정지 (20초)',
    description:
      'touch가 20초 없으면 log.paused (실제 기준 LOG_STREAM_IDLE_PAUSE_SEC=300)',
  },
  {
    id: 'max-duration',
    label: '최대 지속 종료 (30초)',
    description:
      '연결 30초 뒤 log.closing(max_duration) (실제 기준 LOG_STREAM_MAX_MIN=30분)',
  },
  {
    id: 'container-starting',
    label: '컨테이너 시작 전 (30초)',
    description:
      '고른 뒤 30초 동안 시작 전. 따라가기는 안내 후 기다렸다가 붙고, 정지 조회는 200 + LOG_CONTAINER_NOT_STARTED',
  },
  {
    id: 'stack-auth-failed',
    label: '로그 스택 인증 실패',
    description: '조회 200 + LOG_BACKEND_AUTH_FAILED (자동 전환 없음)',
  },
  {
    id: 'stack-rejected',
    label: '로그 스택 쿼리 거부',
    description: '조회 200 + LOG_BACKEND_QUERY_REJECTED + details.reason',
  },
  {
    id: 'kubelet-unreachable',
    label: '노드(kubelet)에 못 닿음',
    description: '조회 200 + LOG_KUBELET_UNREACHABLE (warn, details.nodeName)',
  },
  {
    id: 'flood',
    label: '대량 흐름 (초당 상한의 80%)',
    description:
      '따라가기에 초당 약 1,600줄 → 2만 줄이 약 13초에 찬다. 40줄마다 가림 대상 1줄',
  },
];

/** `flood`: 초당 상한의 이 비율로 흘린다. 상한을 넘기지 않아야 생략 줄 없이 "순수한 대량"이 된다 */
export const FLOOD_RATE_OF_MAX = 0.8;

/**
 * `flood`의 줄 (AC-LOG51). **40줄마다 가림 대상이 섞인다** — 대량 흐름에서도 가림이 되는지 본다.
 * 값은 전부 가짜이고 줄마다 달라서(일련번호) 가림이 한 번만 되고 끝나는 것이 아님을 확인할 수 있다.
 */
export function mockFloodLines(startSeq: number, count: number): string[] {
  const at = new Date().toISOString();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = startSeq + i;
    if (n % 40 === 0) {
      const k = (n / 40) % 3;
      out.push(
        k === 0
          ? `${at} WARN  [auth] retry login password=Fl00d-${n}-s3cret-pw`
          : k === 1
            ? `${at} DEBUG [http] upstream Authorization: Bearer flood${n}tokenABCDEFGHIJKLMNOP`
            : `${at} ERROR [db] connect failed: postgres://app:flood-${n}-hunter2@postgres.db.svc:5432/app`,
      );
    } else {
      out.push(
        `${at} INFO  [ingest] event seq=${n} shard=${n % 16} took=${(n % 13) + 1}ms`,
      );
    }
  }
  return out;
}

/**
 * 전용 스트림의 **기준값만** 줄이는 mock 시나리오 (계약 9절).
 * 실제 기준(5분·30분)을 기다리지 않고 `log.notice`·`log.paused`·`log.closing` 화면을 확인한다.
 * 경로는 실제와 같다 — 이 값이 `checkLimits`·`push`·`flush`에 들어갈 뿐이다.
 */
export function mockStreamTiming(scenario: LogScenario): {
  idlePauseMs?: number;
  maxDurationMs?: number;
  burstAfterMs?: number;
} | null {
  switch (scenario) {
    case 'stream-notice':
      return { burstAfterMs: 10_000 };
    case 'idle-pause':
      return { idlePauseMs: 20_000 };
    case 'max-duration':
      return { maxDurationMs: 30_000 };
    default:
      return null;
  }
}

/** `stream-notice`의 폭주 줄 (초당 상한을 넘기려고 한 번에 넣는다) */
export function mockBurstLines(count: number): string[] {
  const at = new Date().toISOString();
  return Array.from(
    { length: count },
    (_, i) =>
      `${at} WARN  [batch] retry storm ${i + 1}/${count} order=${10_000 + i}`,
  );
}

function ts(offsetSec: number, base = Date.now()): string {
  return new Date(base - offsetSec * 1000).toISOString();
}

function stamp(lines: string[], base = Date.now()): string[] {
  const n = lines.length;
  return lines.map((l, i) => `${ts((n - i) * 2, base)} ${l}`);
}

const DIRECT_LINES = [
  'INFO  [main] starting api 1.4.2 (commit 9f2c1d8a7b3e4f5061728394a5b6c7d8e9f01234)',
  'INFO  [main] listening on :8080',
  'INFO  [http] GET /healthz 200 1ms',
  'WARN  [db] pool exhausted, waiting 120ms (active=20 idle=0)',
  'ERROR [http] POST /orders 500 812ms',
  'java.lang.RuntimeException: order service unavailable',
  '\tat com.example.order.OrderService.place(OrderService.java:142)',
  '\tat com.example.http.Handler.handle(Handler.java:87)',
  'Caused by: java.net.ConnectException: Connection refused',
  '\tat java.base/sun.nio.ch.Net.pollConnect(Native Method)',
  'INFO  [http] GET /healthz 200 1ms',
  'WARN  [mem] container memory 471MiB / 512MiB (92%)',
  'ERROR [runtime] OOM killer may terminate this container soon',
];

const PREVIOUS_LINES = [
  'INFO  [main] starting api 1.4.1 (previous generation)',
  'INFO  [main] listening on :8080',
  'ERROR [runtime] terminating: OOMKilled',
];

/**
 * `secrets` — 가림이 실제로 동작하는지 눈으로 확인하는 시나리오.
 * 마지막 4줄이 **AC-LOG49**(Postgres 실패 SQL)다: 값만 `?`가 되고
 * **타임스탬프·PID·심각도·제약 이름·테이블·컬럼은 남아야 한다.**
 */
const SECRET_LINES = [
  'INFO  [boot] env AWS_REGION=ap-northeast-2 NODE_ENV=production DB_PASSWORD=s3cr3t-p4ssw0rd APP_NAME=api LOG_LEVEL=info',
  'DEBUG [auth] upstream call Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  'INFO  [aws] using access key AKIAIOSFODNN7EXAMPLE for s3 upload',
  'ERROR [db] connect failed: postgres://appuser:hunter2hunter2@postgres.db.svc:5432/app',
  'WARN  [cfg] api_key=sk-ant-api03-EXAMPLEEXAMPLEEXAMPLEEXAMPLE0123 loaded from configmap',
  'INFO  [ko] 주문 처리 중 오류가 발생했습니다 (주문번호 20260925-0042)',
  '2026-09-25 14:02:10.412 UTC [1834] ERROR:  duplicate key value violates unique constraint "users_email_key"',
  '2026-09-25 14:02:10.412 UTC [1834] DETAIL:  Key (email)=(a@b.com) already exists.',
  '2026-09-25 14:02:10.413 UTC [1834] DETAIL:  Failing row contains (1, alice, a@b.com, 2026-09-25).',
  `2026-09-25 14:02:10.413 UTC [1834] STATEMENT:  INSERT INTO users (email, name) VALUES ('a@b.com', 'alice')`,
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEAwT7Xq0mZ1xKv8Yh2Jp3Lr4Ns5Ot6Pu7Qv8Rw9Sx0Ty1Uz2Va3Wb4',
  'Xc5Yd6Ze7Af8Bg9Ch0Di1Ej2Fk3Gl4Hm5In6Jo7Kp8Lq9Mr0Ns1Ot2Pu3Qv4Rw5Sx6Ty7',
  '-----END RSA PRIVATE KEY-----',
  'INFO  [http] GET /healthz 200 1ms',
];

const BINARY_LINES = [
  '\u001B[31mERROR\u001B[0m \u001B[1mred and bold\u001B[0m normal text',
  '\u001B[38;5;208mINFO\u001B[0m 256-color output',
  `progress ${'\u0007'.repeat(4)} bell characters ${'\u0001\u0002\u0003'}`,
  `PK\u0003\u0004\u0000\u0000\u0000\u0000\u0008\u0000${'\u0000\u0001\u0002\u0003\u0004'.repeat(12)}`,
  `LONG ${'x'.repeat(9000)} END`,
  'INFO  한국어가 깨지지 않습니다 · 정상 출력 � (깨진 바이트 1개)',
];

const CONTROL_PLANE_LINES = [
  'I0925 14:02:10.412345       1 trace.go:236] Trace[123]: "List" url:/api/v1/pods',
  'W0925 14:02:11.001122       1 authentication.go:73] Unable to authenticate the request',
  'I0925 14:02:12.334455       1 healthz.go:261] etcd check passed',
];

export interface MockLogResult {
  lines: string[];
  /** `LOG_EMPTY`·`LOG_FORBIDDEN` 같은 특수 결과 */
  outcome: 'ok' | 'empty' | 'forbidden' | 'gone' | 'disabled';
  /** 초당 상한으로 생략된 줄 수 (noisy) */
  dropped?: number;
}

/**
 * 시나리오별 원본 줄. `previous`면 다른 내용을 준다 (AC-LOG15).
 * 컨트롤 플레인 파드는 시나리오와 무관하게 kube-apiserver 로그를 준다.
 */
export function mockLogLines(
  scenario: LogScenario,
  opts: { previous?: boolean; limit: number; controlPlane?: boolean } = {
    limit: 500,
  },
): MockLogResult {
  if (scenario === 'disabled') return { lines: [], outcome: 'disabled' };
  if (scenario === 'forbidden') return { lines: [], outcome: 'forbidden' };
  if (scenario === 'pod-gone') return { lines: [], outcome: 'gone' };
  if (scenario === 'empty') return { lines: [], outcome: 'empty' };
  if (opts.controlPlane || scenario === 'control-plane') {
    return { lines: stamp(CONTROL_PLANE_LINES), outcome: 'ok' };
  }
  if (opts.previous) return { lines: stamp(PREVIOUS_LINES), outcome: 'ok' };
  if (scenario === 'secrets')
    return { lines: stamp(SECRET_LINES), outcome: 'ok' };
  if (scenario === 'binary')
    return { lines: stamp(BINARY_LINES), outcome: 'ok' };
  if (scenario === 'noisy') {
    const wanted = Math.min(opts.limit, 400);
    const lines = stamp(
      Array.from(
        { length: wanted },
        (_, i) => `INFO  [worker] processed item ${i} in 0.${i % 10}ms`,
      ),
    );
    return { lines, outcome: 'ok', dropped: 5000 };
  }
  const repeat = Math.max(1, Math.ceil(opts.limit / DIRECT_LINES.length));
  const lines: string[] = [];
  for (let i = 0; i < repeat && lines.length < opts.limit; i += 1) {
    lines.push(...DIRECT_LINES);
  }
  return { lines: stamp(lines.slice(0, opts.limit)), outcome: 'ok' };
}

/** 따라가기에서 250ms마다 붙는 새 줄 (초당 1~3줄) */
export function mockTailLine(scenario: LogScenario, n: number): string {
  if (scenario === 'secrets' && n % 5 === 0) {
    return `${new Date().toISOString()} WARN  [cfg] rotating token=ghp_EXAMPLEEXAMPLEEXAMPLEEXAMPLE01`;
  }
  if (scenario === 'noisy') {
    return `${new Date().toISOString()} INFO  [worker] processed item ${n}`;
  }
  return `${new Date().toISOString()} INFO  [http] GET /healthz 200 ${1 + (n % 3)}ms`;
}
