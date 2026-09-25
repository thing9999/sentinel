import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export const DATA_SOURCE_VALUES = ['mock', 'live'] as const;
export type DataSourceMode = (typeof DATA_SOURCE_VALUES)[number];

/**
 * 환경 변수 스키마. 선택 값은 비어 있어도(빈 문자열 포함) 부팅된다.
 * 로컬(Docker 없음)에서는 DATABASE_URL·KUBECONFIG·AWS 값이 없을 수 있다.
 */
export class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsIn(DATA_SOURCE_VALUES)
  DATA_SOURCE: DataSourceMode = 'mock';

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:3000';

  /** 대시보드 자체 DB (Prisma). 없거나 연결 실패여도 앱은 경고만 남기고 뜬다. */
  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsOptional()
  @IsString()
  KUBECONFIG?: string;

  /**
   * 모니터링 대상 DB 접속 (모니터링 전용 계정 sentinel_monitor, docs/db/monitor-account.sql).
   * 예: postgres://sentinel_monitor:<password>@host.docker.internal:15432/postgres?application_name=sentinel-monitor
   */
  @IsOptional()
  @Matches(/^postgres(ql)?:\/\/.+/, {
    message:
      'MONITOR_DB_URL은 postgres:// 또는 postgresql:// 형식이어야 합니다',
  })
  MONITOR_DB_URL?: string;

  /** 모니터링 대상 DB StatefulSet (명세 cluster-status 가정 A2). 둘 다 있거나 둘 다 없어야 한다 */
  @IsOptional()
  @Matches(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message:
      'DB_TARGET_NAMESPACE는 쿠버네티스 네임스페이스 이름 형식이어야 합니다',
  })
  DB_TARGET_NAMESPACE?: string;

  @IsOptional()
  @Matches(/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/, {
    message: 'DB_TARGET_STATEFULSET은 쿠버네티스 리소스 이름 형식이어야 합니다',
  })
  DB_TARGET_STATEFULSET?: string;

  /**
   * 기대 standby 수 (normalizePgHealth expectedStandbys). 비우면 DB StatefulSet replicas - 1로 자동 계산,
   * StatefulSet도 모르면 판단하지 않는다(연결된 standby만 본다).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32)
  MONITOR_DB_EXPECTED_STANDBYS?: number;

  /** DB 상태 조회 간격(초). 기본 15 */
  @IsInt()
  @Min(5)
  @Max(300)
  DB_HEALTH_INTERVAL_SEC: number = 15;

  /** metrics.k8s.io 조회 간격(초). 기본 15 */
  @IsInt()
  @Min(5)
  @Max(300)
  METRICS_INTERVAL_SEC: number = 15;

  /** 선택: Prometheus 주소 (예: http://prometheus-server.monitoring:80) */
  @IsOptional()
  @Matches(/^https?:\/\/.+/, {
    message: 'PROMETHEUS_URL은 http:// 또는 https:// 주소여야 합니다',
  })
  PROMETHEUS_URL?: string;

  /**
   * kOps 클러스터 이름(보통 FQDN, 예: prod.k8s.example.com).
   * 상단바 표시 이름이자 **EC2 태그 필터 값**(`kubernetes.io/cluster/<이름>`).
   * 없으면 kubeconfig 현재 context의 cluster 이름으로 표시 이름만 채운다.
   * 구 이름 `EKS_CLUSTER_NAME`은 읽지 않는다 (하위 호환 없음, AC-KOPS06).
   */
  @IsOptional()
  @IsString()
  K8S_CLUSTER_NAME?: string;

  /**
   * 마스터 대수(단일·짝수) 판단을 켜고 끈다 (kops-support 3.2.1).
   * false면 표시만 하고 컨트롤 플레인 상태에 넣지 않는다.
   * 어드바이저 R-CP-HA는 이 값과 무관하게 계속 지적한다.
   */
  @IsIn([true, false])
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const v = obj[key];
    if (v === undefined || v === true) return true;
    if (v === false) return false;
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (t === '') return true;
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off'].includes(t)) return false;
    return v; // IsIn이 거부
  })
  CONTROL_PLANE_HA_EXPECTED: boolean = true;

  /** 시스템 네임스페이스 (쉼표 구분, 명세 가정 A6) */
  @IsString()
  SYSTEM_NAMESPACES: string = 'kube-system,kube-public,kube-node-lease';

  /** SSE 동시 연결 상한 */
  @IsInt()
  @Min(1)
  @Max(1000)
  SSE_MAX_CLIENTS: number = 20;

  @IsOptional()
  @IsString()
  AWS_REGION?: string;

  @IsOptional()
  @IsString()
  AWS_PROFILE?: string;

  @IsString()
  AGENT_BRIDGE_URL: string = 'http://localhost:3002';

  /** agent-bridge의 BRIDGE_TOKEN과 같은 값. 비어 있으면 헤더를 보내지 않는다. */
  @IsOptional()
  @IsString()
  AGENT_BRIDGE_TOKEN?: string;

  /** Cost Explorer 결과 캐시 (호출당 $0.01). 기본 6시간, 최소 1시간 */
  @IsInt()
  @Min(3600)
  COST_EXPLORER_CACHE_TTL_SEC: number = 21600;

  /** 월 예산(USD). 설정하면 settings `cost.budget`보다 우선. 비우면 settings 값(기본 없음) */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  COST_MONTHLY_BUDGET_USD?: number;

  /** Cost Explorer 지표. 비우면 settings `cost.explorer.metric`(기본 UnblendedCost) */
  @IsOptional()
  @IsIn(['UnblendedCost', 'AmortizedCost'])
  COST_EXPLORER_METRIC?: 'UnblendedCost' | 'AmortizedCost';

  /** Cost Explorer 일일 호출 상한. 비우면 settings `cost.explorer.dailyCallLimit`(기본 40) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  COST_EXPLORER_DAILY_CALL_LIMIT?: number;

  /**
   * 어드바이저 브리지 호출 방식 (advisor 모듈). mock | live.
   * DATA_SOURCE=mock + ADVISOR_BRIDGE=live면 mock 스냅샷으로 로컬 Claude Code에 실제 분석 요청.
   */
  @IsOptional()
  @IsIn(['mock', 'live'])
  ADVISOR_BRIDGE?: 'mock' | 'live';

  /** 어드바이저 출력 방식 structured | text (비우면 advisor 기본 structured) */
  @IsOptional()
  @IsIn(['structured', 'text'])
  ADVISOR_OUTPUT_MODE?: 'structured' | 'text';

  /**
   * 어드바이저 지연 기준(초). 비우면 settings `advisor.limits` → 코드 기본값.
   * (env > settings > 기본값 우선순위를 advisor가 판단하므로 여기서는 기본값을 넣지 않는다)
   */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(3600)
  ADVISOR_SLOW_AFTER_SEC?: number;

  /** 어드바이저 시간 초과(초). 비우면 settings → 기본값 */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(7200)
  ADVISOR_TIMEOUT_SEC?: number;

  /** 어드바이저 1회 비용 상한(USD, Agent SDK maxBudgetUsd). 비우면 advisor 기본값 */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(100)
  ADVISOR_MAX_BUDGET_USD?: number;

  /**
   * 어드바이저 1회 최대 턴 수(Agent SDK maxTurns, 1~5). 비우면 settings `advisor.limits` → 코드 기본값(5).
   * 기본값을 여기서 넣지 않는다 (advisor가 env → settings → 기본값 순서로 판단).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ADVISOR_MAX_TURNS?: number;

  /**
   * aws-snapshot-manager: 스냅샷 루트 (deploy/aws-snapshot/snapshots). 비우면 live에서 not_configured.
   * 상대 경로는 api 작업 폴더 기준 (Docker 없이: ../../deploy/aws-snapshot/snapshots)
   */
  @IsOptional()
  @IsString()
  AWS_SNAPSHOT_DIR?: string;

  /** CLI 스캐너 lib 위치. 비우면 작업 폴더 기준 ../../deploy/aws-snapshot/lib */
  @IsOptional()
  @IsString()
  AWS_SNAPSHOT_LIB_DIR?: string;

  /** 쓰기 기능 전체 스위치 (기본 켜짐) */
  @IsIn([true, false])
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const v = obj[key];
    if (v === undefined || v === true) return true;
    if (v === false) return false;
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off'].includes(t)) return false;
    return v; // IsIn이 거부
  })
  AWS_SNAPSHOT_WRITE_ENABLED: boolean = true;

  /** "내보내기 진행 중일 수 있음" 기준(분) */
  @IsInt()
  @Min(1)
  @Max(1440)
  AWS_SNAPSHOT_IN_PROGRESS_MIN: number = 30;

  /** 편집 상한(바이트, 기본 5 MB) */
  @IsInt()
  @Min(1024)
  @Max(64 * 1024 * 1024)
  AWS_SNAPSHOT_EDIT_MAX_BYTES: number = 5 * 1024 * 1024;

  /** 보기 상한(바이트, 기본·최소 20 MB) */
  @IsInt()
  @Min(1024)
  @Max(512 * 1024 * 1024)
  AWS_SNAPSHOT_VIEW_MAX_BYTES: number = 20 * 1024 * 1024;

  /** 변경 감지 주기(초) */
  @IsInt()
  @Min(5)
  @Max(25)
  AWS_SNAPSHOT_POLL_INTERVAL_SEC: number = 10;

  /** 화면 표시용 경로 */
  @IsOptional()
  @IsString()
  AWS_SNAPSHOT_DISPLAY_PATH?: string;

  /**
   * k8s-snapshot: 스냅샷 루트 (deploy/k8s-snapshot/snapshots). 비우면 live에서 not_configured (docs/api/k8s-snapshot.md 15절).
   * 상대 경로는 api 작업 폴더 기준 (Docker 없이: ../../deploy/k8s-snapshot/snapshots)
   */
  @IsOptional()
  @IsString()
  K8S_SNAPSHOT_DIR?: string;

  /** k8s 규칙 lib 위치. 비우면 작업 폴더 기준 ../../deploy/k8s-snapshot/lib (스캐너는 AWS_SNAPSHOT_LIB_DIR) */
  @IsOptional()
  @IsString()
  K8S_SNAPSHOT_LIB_DIR?: string;

  /** 쓰기 기능 전체 스위치 (기본 켜짐) */
  @IsIn([true, false])
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const v = obj[key];
    if (v === undefined || v === true) return true;
    if (v === false) return false;
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off'].includes(t)) return false;
    return v;
  })
  K8S_SNAPSHOT_WRITE_ENABLED: boolean = true;

  @IsInt()
  @Min(1)
  @Max(1440)
  K8S_SNAPSHOT_IN_PROGRESS_MIN: number = 30;

  @IsInt()
  @Min(1024)
  @Max(64 * 1024 * 1024)
  K8S_SNAPSHOT_EDIT_MAX_BYTES: number = 5 * 1024 * 1024;

  @IsInt()
  @Min(1024)
  @Max(512 * 1024 * 1024)
  K8S_SNAPSHOT_VIEW_MAX_BYTES: number = 20 * 1024 * 1024;

  @IsInt()
  @Min(5)
  @Max(25)
  K8S_SNAPSHOT_POLL_INTERVAL_SEC: number = 10;

  @IsOptional()
  @IsString()
  K8S_SNAPSHOT_DISPLAY_PATH?: string;

  /** 클러스터 변경 후 드리프트 재계산 조절(초) */
  @IsInt()
  @Min(5)
  @Max(20)
  K8S_DRIFT_THROTTLE_SEC: number = 10;

  /** 변경이 없어도 드리프트를 다시 계산하는 주기(초) */
  @IsInt()
  @Min(60)
  @Max(900)
  K8S_DRIFT_RECOMPUTE_SEC: number = 300;

  /** 3D 구성 그래프 캐시 개수 (docs/api/snapshot-3d.md 14절) */
  @IsInt()
  @Min(1)
  @Max(64)
  K8S_GRAPH_CACHE_SIZE: number = 8;

  /** 넘으면 묶어 보기 (summary.grouped) */
  @IsInt()
  @Min(500)
  @Max(20000)
  K8S_GRAPH_GROUP_THRESHOLD: number = 3000;

  /** 그래프 블록 안전 상한 */
  @IsInt()
  @Min(1000)
  @Max(200000)
  K8S_GRAPH_MAX_BLOCKS: number = 20000;

  /** 그래프 선 안전 상한 */
  @IsInt()
  @Min(1000)
  @Max(400000)
  K8S_GRAPH_MAX_EDGES: number = 40000;

  // --- alerts (docs/api/alerts.md 9절) ---------------------------------------

  /**
   * 디스코드 발송 방식. 비우면 `DATA_SOURCE`를 따른다.
   * `mock`이면 **아웃바운드 요청이 0건**이다 (DATA_SOURCE=live + ALERTS_DISPATCH=mock = 비상 차단).
   */
  @IsOptional()
  @IsIn(['mock', 'live'])
  ALERTS_DISPATCH?: 'mock' | 'live';

  /**
   * 디스코드 웹훅 주소. **비밀값이다** — 주소 자체가 그 채널에 글을 쓸 수 있는 권한이다.
   * 설정되면 DB 값을 읽지 않고 이 값이 이기며 화면 입력이 잠긴다(저장 시도는 409).
   * 이 값을 응답·로그·SSE·알림 본문에 넣지 않는다. 읽기는 `secret-settings.ts`의 전용 함수로만.
   * (형식 검증은 저장 계층 `checkWebhookUrl()` 하나로 한다 — 여기서 정규식을 두지 않는다.
   *  틀린 값이 들어와도 부팅은 막지 않고 발송 단계에서 걸린다)
   */
  @IsOptional()
  @IsString()
  ALERTS_DISCORD_WEBHOOK_URL?: string;

  /** 선택: 알림 본문에 붙일 대시보드 주소. 설정됐을 때만 링크를 붙인다 */
  @IsOptional()
  @Matches(/^https?:\/\/.+/, {
    message: 'ALERTS_PUBLIC_BASE_URL은 http:// 또는 https:// 주소여야 합니다',
  })
  ALERTS_PUBLIC_BASE_URL?: string;

  // --- logs (docs/api/logs.md 10절) ------------------------------------------

  /**
   * 로그 기능 스위치. `false`면 `GET /api/logs/capabilities`만 200(`enabled:false`)이고
   * 나머지 `/api/logs/*`는 403 `LOG_DISABLED`다.
   * **클러스터 안 배포(deploy/app.example.yaml)는 false가 기본**이다 (PM 결정 Q4).
   */
  @IsIn([true, false])
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const v = obj[key];
    if (v === undefined || v === true) return true;
    if (v === false) return false;
    const t = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (t === '') return true;
    if (['1', 'true', 'yes', 'on'].includes(t)) return true;
    if (['0', 'false', 'no', 'off'].includes(t)) return false;
    return v;
  })
  LOGS_ENABLED: boolean = true;

  /** 로그 조회를 막을 네임스페이스 (쉼표 구분). 비밀이 아니라 설정값이라 응답에 그대로 나간다 */
  @IsOptional()
  @IsString()
  LOG_DENY_NAMESPACES?: string;

  /** 첫 조회 줄 수 */
  @IsInt()
  @Min(1)
  @Max(50000)
  LOG_DEFAULT_LINES: number = 500;

  /** 한 번에 가져올 줄 수 상한. 넘는 요청은 400이 아니라 상한으로 자른다 */
  @IsInt()
  @Min(1)
  @Max(50000)
  LOG_MAX_LINES: number = 5000;

  /** 한 번에 가져올 바이트 상한 */
  @IsInt()
  @Min(65536)
  @Max(268435456)
  LOG_MAX_BYTES: number = 5 * 1024 * 1024;

  /** 한 줄 길이 상한 (넘으면 자르고 truncatedBytes) */
  @IsInt()
  @Min(256)
  @Max(1048576)
  LOG_MAX_LINE_BYTES: number = 8192;

  /**
   * 동시 로그 스트림 상한. **`SSE_MAX_CLIENTS`와 별도 카운터다** (AC-LOG23).
   * 로그 스트림이 가득 차도 공용 스트림과 다른 화면은 영향을 받지 않는다.
   */
  @IsInt()
  @Min(1)
  @Max(50)
  LOG_MAX_STREAMS: number = 3;

  /** 따라가기 초당 줄 수 상한. 넘으면 버리고 생략 구간을 한 줄로 알린다 */
  @IsInt()
  @Min(10)
  @Max(100000)
  LOG_STREAM_MAX_LPS: number = 2000;

  /** touch 신호가 이만큼 없으면 위쪽 연결을 끊고 log.paused */
  @IsInt()
  @Min(30)
  @Max(3600)
  LOG_STREAM_IDLE_PAUSE_SEC: number = 300;

  /** 한 스트림 최대 지속(분). 넘으면 log.closing */
  @IsInt()
  @Min(1)
  @Max(240)
  LOG_STREAM_MAX_MIN: number = 30;

  /**
   * 가림 규칙 **추가**용 정규식 (줄바꿈 구분). 규칙을 **끄는** 설정은 만들지 않는다 (AC-LOG09).
   * 잘못된 정규식은 무시하고 경고만 남긴다(부팅을 막지 않는다).
   */
  @IsOptional()
  @IsString()
  LOG_REDACT_EXTRA_PATTERNS?: string;

  // --- 외부 로그 스택 (docs/api/logs.md 10절) ----------------------------------
  //
  // **비어 있는 것이 정상이다** — `not_configured`는 `degraded`가 아니다 (AC-LOG45).
  // 회사 클러스터에 스택이 있는지는 월요일에 확인한다. 없으면 직접 조회로 계속 동작한다.

  /** 로그 스택 제품. 지금 붙어 있는 어댑터는 `loki` 하나다 */
  @IsOptional()
  @IsIn(['loki'])
  LOG_BACKEND?: 'loki';

  @IsOptional()
  @Matches(/^https?:\/\/.+/, {
    message: 'LOG_BACKEND_URL은 http:// 또는 https:// 주소여야 합니다',
  })
  LOG_BACKEND_URL?: string;

  /** 멀티테넌트 헤더 (Loki `X-Scope-OrgID`) */
  @IsOptional()
  @IsString()
  LOG_BACKEND_TENANT?: string;

  /** **비밀값**. 응답·오류 메시지에 넣지 않는다 (AC-LOG44) */
  @IsOptional()
  @IsString()
  LOG_BACKEND_TOKEN?: string;

  /** **비밀값**. `user:password` 형식 */
  @IsOptional()
  @IsString()
  LOG_BACKEND_BASIC_AUTH?: string;

  @IsInt()
  @Min(1)
  @Max(300)
  LOG_BACKEND_TIMEOUT_SEC: number = 20;

  /** 이 시간을 넘는 기간 요청은 400 (스택 보호) */
  @IsInt()
  @Min(1)
  @Max(8760)
  LOG_BACKEND_MAX_RANGE_HOURS: number = 168;

  /** 보관 기간(시간). 알면 채운다 — 화면이 "보관 7일" 칩과 안내에 쓴다 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(87600)
  LOG_BACKEND_RETENTION_HOURS?: number;

  /**
   * 라벨 이름. 회사 Loki가 다른 이름을 쓰면 여기서 바꾼다 (AC-LOG46, U2 대응).
   * **라벨 이름은 응답에 노출하지 않는다** (출처 중립).
   */
  @IsString()
  LOG_BACKEND_LABEL_NAMESPACE: string = 'namespace';

  @IsString()
  LOG_BACKEND_LABEL_POD: string = 'pod';

  @IsString()
  LOG_BACKEND_LABEL_CONTAINER: string = 'container';

  @IsString()
  LOG_BACKEND_LABEL_NODE: string = 'node_name';

  @IsString()
  LOG_BACKEND_LABEL_STREAM: string = 'stream';
}

/** 빈 문자열은 "설정 안 됨"으로 본다 (docker compose의 `${VAR:-}` 대응). */
function dropEmpty(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    result[key] = value;
  }
  return result;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, dropEmpty(config), {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  const details = errors.map(
    (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
  );
  if (
    Boolean(validated.DB_TARGET_NAMESPACE) !==
    Boolean(validated.DB_TARGET_STATEFULSET)
  ) {
    details.push(
      'DB_TARGET_NAMESPACE, DB_TARGET_STATEFULSET: 둘 다 설정하거나 둘 다 비워야 합니다',
    );
  }
  if (validated.LOG_BACKEND && !validated.LOG_BACKEND_URL) {
    details.push(
      'LOG_BACKEND, LOG_BACKEND_URL: 로그 스택을 쓰려면 주소도 설정해야 합니다',
    );
  }
  if (validated.LOG_DEFAULT_LINES > validated.LOG_MAX_LINES) {
    details.push(
      'LOG_DEFAULT_LINES, LOG_MAX_LINES: 기본 줄 수가 상한보다 클 수 없습니다',
    );
  }
  if (details.length > 0) {
    throw new Error(`환경 변수 검증 실패: ${details.join('; ')}`);
  }
  return validated;
}
