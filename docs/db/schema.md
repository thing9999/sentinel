# 대시보드 자체 DB 스키마 (Prisma)

- 작성: dba, 2026-09-19 (2026-09-24 kOps 전환 반영)
- 대상 환경: **kOps 클러스터(컨트롤 플레인도 사용자 소유 EC2)** + 모니터링 대상 Postgres는 그 클러스터 안 StatefulSet. (2026-09-24 이전에는 EKS였다 — `docs/specs/kops-support.md` 1.2)
- DB: Postgres 16 (로컬: docker compose `db` 서비스, 이름·계정 `dashboard`)
- ORM: Prisma 7.10.0 (`apps/api/prisma/schema.prisma`, URL은 `apps/api/prisma.config.ts`의 `DATABASE_URL`)
- 생성 클라이언트: `apps/api/src/database/generated/prisma` (gitignore, import `./generated/prisma/client`)
- 근거 명세: `docs/specs/aws-cost.md`(4절, 7절 DBA), `docs/specs/architecture-advisor.md`(0절 D5, 7절 DBA), `docs/specs/cluster-status.md`(기준값 설정화), `docs/specs/alerts.md`(3.7 A~E, 7절 DBA + `docs/reports/alerts/README.md` PM·사용자 결정)
- 이 DB는 **대시보드가 쓰는** DB다. 모니터링 대상 DB(클러스터 안 Postgres)와 다르다. 대상 DB 조회는 `docs/db/health.md`.

## 1. 원칙

- 스키마 변경은 **항상 마이그레이션**으로 한다. `prisma db push` 금지.
- 마이그레이션마다 되돌리는 SQL을 `docs/db/migrations/<이름>.down.sql`로 함께 둔다.
- 이름: 모델·필드는 camelCase, 테이블·컬럼·enum 타입은 snake_case(`@map`/`@@map`).
- 시각은 모두 `timestamptz(3)`(UTC 저장). 날짜 단위(Cost Explorer 기간)는 `date`.
- 금액은 `numeric`(`Decimal`). float 금지. 단가는 소수 10자리, 시간당 금액은 6자리, 절감액은 2자리.
- mock과 live 데이터를 `data_source` 컬럼으로 분리한다(mock 값이 live의 7일 중앙값·캐시를 오염시키지 않게).
- 비밀값(자격 증명, 계정 ID, ARN, 환경 변수, 쿼리 원문)은 저장하지 않는다. 어드바이저 스냅샷은 명세 3.4 제외 규칙과 비밀값 검사를 통과한 것만 저장한다.

## 2. 테이블

### 2.1 `settings` (모델 `Setting`)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `key` PK | varchar(100) | 설정 키 |
| `value` | jsonb | 값 (모양은 `src/database/settings-defaults.ts`) |
| `description` | varchar(500) | 설명 |
| `created_at`, `updated_at` | timestamptz | |

key 목록 (시드가 기본값을 넣음, 이미 있으면 유지):

| key | 내용 |
|---|---|
| `cluster.thresholds` | 노드·파드·PVC 판단 기준, 연속 조건(3회) — cluster-status 3.2~3.7 |
| `db.thresholds` | 대상 DB 판단 기준 (`DEFAULT_PG_THRESHOLDS`) — cluster-status 3.7 |
| `cost.budget` | `monthlyBudgetUsd`(기본 null = 예산 숨김), `warnPct` 90, `overPct` 100 |
| `cost.spike` | 소모율 급증(7일 중앙값 ×1.3 & +$0.5/h, ×2.0 & +$1/h), 일별 급증(×1.3 & +$5, ×2.0 & +$10), `rate.baselineFrom`(기준선 표본 하한 시각, 기본 null — 2.2 "정의가 바뀐 열") |
| `cost.explorer` | 지표(UnblendedCost), 캐시 6시간, 수동 새로고침 1시간, 일일 호출 상한 40, 호출당 $0.01, 태그 필터 |
| `cost.estimation` | 리소스 갱신 5분, 소모율 기록 5분, Pricing 24시간, 스팟 1시간, 730시간/월 |
| `advisor.limits` | 지연 `slowAfterSec` 300초, 시간 초과 600초, 브리지 확인 30초/3초, 워크로드 300·노드 100, 결과 신선도 7일, 비용 상한 `maxBudgetUsd` 2.0 USD, `maxTurns` 5 (API 계약 B.5, PM 결정 2026-09-19로 3→5·180→300) |
| `advisor.prechecks` | 사전 점검 기준값 (R-RESTART 5회, R-OVERREQ 20%, R-NODEIDLE 30%, R-UNALLOC 40% 등) |
| `alerts` | 알림 전이·억제·플래핑·워밍업 기준 (억제 15분, 플래핑 30분·4회, 워밍업 120초, unknown 5분, 출처 억제 3분, heartbeat 60초) — alerts 3.2, PM 결정 Q5 |
| `alerts.discord` | 디스코드 발송 설정 (켜기, 심각도 하한 `critical`, `sendUnknown`, 속도 상한, 백오프, 테스트 쿨다운, 허용 호스트) — alerts 3.3.2·3.4.2 |
| **`alerts.discord.webhookUrl`** | **비밀값.** 웹훅 주소 `{ "url": "https://discord.com/api/webhooks/…" \| null }`. 시드가 만들지 않고 설정 저장으로만 생긴다 → 2.12 |
| `retention` | 보존 기간 (3절) |

적용 우선순위(권장): **환경 변수(명시된 경우) > settings 테이블 > 코드 기본값**. `mergeSetting(key, stored)`가 저장값을 기본값 위에 얕게 덮어쓴다. 설정 편집 UI는 범위 밖이라 현재는 시드 값 = 코드 기본값이고, 운영자가 SQL로 바꿀 수 있다.

**시드의 한계 (기본값 변경 시)**: 시드는 `ON CONFLICT ("key") DO NOTHING`(없을 때만 추가)이라 이미 시드된 DB는 코드 기본값을 바꿔도 **값이 바뀌지 않는다**. 저장된 행에 없는 필드만 `mergeSetting`이 새 코드 기본값으로 채운다. 이미 있는 필드의 기본값을 바꿀 때는 옛 기본값과 정확히 같은 필드만 새 값으로 올리는 데이터 마이그레이션을 함께 둔다(운영자가 바꾼 값은 유지). 예: `20260919180000_advisor_limits_defaults`.

### 2.2 `cost_rate_samples` (모델 `CostRateSample`) — aws-cost

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | bigserial | |
| `data_source` | enum `data_source_mode` | mock / live |
| `sampled_at` | timestamptz | 5분 간격 기록 시각 |
| `total_usd_per_hour` | numeric(14,6) | 추정 시간당 소모율 합계 (단가 없는 리소스 제외) |
| `ec2_usd_per_hour`, `ebs_…`, `lb_…`, `control_plane_…`, `ipv4_…` | numeric(14,6) | 카테고리별. `control_plane_usd_per_hour`는 kOps 컨트롤 플레인 실비(마스터 EC2 + etcd·루트 EBS + API LB + 마스터 퍼블릭 IPv4) — 아래 "정의가 바뀐 열" 참고 |
| `node_count` | int | 노드 수 |
| `unpriced_count` | int | 단가 없음으로 빠진 리소스 수 |
| `resources` | jsonb | `[{kind, key, type, option, az, usdPerHour}]` — 급증 원인(기준 시점 대비 새로 생긴/바뀐 리소스) 비교용 |
| `created_at` | timestamptz | |

- UNIQUE(`data_source`, `sampled_at`): 같은 시각 중복 기록 방지(재시작 직후 등). backend는 `sampled_at`을 5분 경계로 내려 쓰기를 권장(예: 12:05:00).
- 7일 중앙값: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total_usd_per_hour) FROM cost_rate_samples WHERE data_source=$1 AND sampled_at >= now() - interval '7 days'` (최대 2,016행).
- 기준 수집 중 판단: 같은 조건에서 `min(sampled_at)`이 24시간 이전인지.
- 용량: 90일 × 288건 = 25,920행. `resources`가 행당 수 KB면 수십~100MB 수준.

**정의가 바뀐 열: `control_plane_usd_per_hour` (2026-09-24, kOps 전환)**

- `eks_usd_per_hour`를 **RENAME**한 열이다(`20260924120000_control_plane_cost_column`). 열을 지우고 새로 만들지 않았으므로 **행과 값이 모두 그대로 남아 있다** — 급증 판단의 7일 중앙값과 90일 추이 기준선이 끊기지 않는다(AC-KOPS34).
- 다만 **전환 이전 행의 값은 옛 정의**(EKS 컨트롤 플레인 관리 요금, 클러스터당 $0.10/h 고정)이고, **이후 행은 새 정의**(kOps 마스터 EC2 + etcd·루트 EBS + API LB + 마스터 퍼블릭 IPv4 실비)다. 같은 열에 성격이 다른 두 금액이 이어져 있다.
  - 값을 0으로 밀거나 행을 지우지 않는다. 그러면 ① 기준선이 끊기고 ② `total_usd_per_hour = ec2+ebs+lb+controlPlane+ipv4`라는 행 단위 합계가 깨진다. **모든 행에서 이 합계는 지금도 맞는다.**
  - 과거 행을 새 정의로 다시 계산하는 것도 불가능하다(그 시점에 마스터 EC2·etcd 볼륨이 존재하지 않았다).
- 같은 행의 `resources` jsonb 안 `kind: 'eks'`도 같은 마이그레이션에서 `'controlPlane'`으로 바꿨다(**금액·순서는 그대로**). 열 이름만 바꾸면 한 행 안에서 금액 열과 `resources[].kind`가 어긋나 화면이 모르는 카테고리를 만나기 때문이다.
- **전환 앞뒤를 한 기준선으로 섞지 않는다**: settings `cost.spike.rate.baselineFrom`(ISO8601 UTC, 기본 `null`)에 마이그레이션 적용 시각이 기록된다. backend는 소모율 기준선 표본을 `sampled_at >= baselineFrom`으로 제한한다(`null`이면 제한 없음). 섞으면 전환 순간에 없던 급증·급감이 잡힌다(관리 요금 $0.10/h ↔ 마스터 실비 ≈$0.29/h). 전환 직후 `minBaselineHours`(24시간) 동안은 기준선이 "수집 중"이고, 이는 오탐보다 정직한 상태다.
- 90일 추이 그래프는 `total_usd_per_hour`를 그대로 쓰므로 전환 시점에 계단이 보인다. 이는 실제로 요금 구조가 바뀐 것이라 숨기지 않는다(화면 문구는 backend·frontend 몫).

### 2.3 `cost_explorer_cache` (모델 `CostExplorerCache`) — aws-cost

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | bigserial | |
| `data_source` | enum | |
| `kind` | enum `cost_explorer_query_kind` | month_to_date / service_breakdown / daily / last_month / forecast |
| `request_key` | varchar(64) | 요청 파라미터(기간·지표·granularity·groupBy·필터)를 정규화한 sha256 hex |
| `request` | jsonb | 요청 요약 (계정 ID·자격 증명 없음) |
| `period_start`, `period_end` | date | 조회 기간 |
| `metric` | varchar(32) | UnblendedCost / AmortizedCost |
| `status` | enum `fetch_status` | ok / error |
| `result` | jsonb | 정규화된 결과 (error면 null) |
| `data_through` | date | "N월 N일까지 반영" |
| `error_code`, `error_message` | varchar | 실패 사유 (가림 처리 후 500자) |
| `fetched_at` | timestamptz | 조회 시각 (화면의 "마지막 조회 시각") |
| `expires_at` | timestamptz | `fetched_at + cacheTtlSec`(기본 6시간) |

- **요청 키마다 최신 1건**만 둔다: `upsert where { dataSource_requestKey }`. 월이 바뀌면 키가 바뀌어 새 행이 생기고, 옛 행은 보존 정리로 지운다.
- 오류 결과도 캐시한다(권한 없음·CE 미활성화 반복 호출 방지). 오류 행의 `expires_at`은 짧게(예: 1시간) 권장.
- 조회: `findUnique({ dataSource_requestKey })` → `expires_at > now()`면 캐시 사용.

### 2.4 `cost_explorer_call_logs` (모델 `CostExplorerCallLog`) — aws-cost

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | bigserial | |
| `called_at` | timestamptz | |
| `operation` | enum | GetCostAndUsage / GetCostForecast |
| `trigger` | enum | scheduled / manual / startup |
| `request_key` | varchar(64) | 캐시 행과 연결 |
| `success` | bool | |
| `error_code` | varchar(100) | |
| `duration_ms` | int | |
| `estimated_cost_usd` | numeric(8,4) | 기본 0.01 |

- 실제 AWS 호출 1회마다 1행(실패 포함, 과금되므로). mock 모드는 호출이 0회라 기록하지 않는다.
- 일일 상한: `count(*) WHERE called_at >= <오늘 0시>` — **기준 시간대(UTC 또는 로컬)를 backend가 정해 일관되게** 쓴다.
- 수동 새로고침 제한: `max(called_at) WHERE trigger='manual'`(또는 전체 마지막 호출) + 1시간.
- 이번 달 CE 비용: `sum(estimated_cost_usd) WHERE called_at >= <이번 달 1일>`.

### 2.5 `price_cache` (모델 `PriceCache`) — aws-cost (선택)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | bigserial | |
| `source` | enum `price_source` | pricing_api / spot_price_history |
| `region` | varchar(32) | |
| `product_key` | varchar(200) | 예: `ec2:m6i.large:linux:shared`, `ebs:gp3:storage`, `spot:m6i.large:ap-northeast-2a` |
| `unit` | varchar(32) | Hrs, GB-Mo 등 |
| `usd_per_unit` | numeric(18,10) | 못 찾으면 null |
| `found` | bool | false = "단가 없음" 음성 캐시 |
| `attributes` | jsonb | 요금 조건 요약 (원본 응답 전체 저장 안 함) |
| `fetched_at`, `expires_at` | timestamptz | Pricing 24시간, 스팟 1시간 |

- UNIQUE(`source`, `region`, `product_key`) → upsert. API 재시작 후에도 단가 재조회를 줄인다.

### 2.6 `advisor_runs` (모델 `AdvisorRun`) — architecture-advisor

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | uuid | |
| `status` | enum `advisor_run_status` | queued / running / succeeded / failed / cancelled |
| `failure_reason` | enum `advisor_failure_reason` | bridge_unavailable / login_required / usage_limit / timeout / invalid_response / budget_exceeded / interrupted / other |
| `error_message` | varchar(500) | 사용자 표시용 (비밀값 가림) |
| `active_lock` | varchar(16) UNIQUE | 실행 중이면 `'active'`, 끝나면 NULL — **동시 1건 보장** |
| `data_source` | enum | |
| `is_example` | bool | mock "예시 응답" |
| `stage` | varchar(32) | 진행(또는 마지막) 단계 = API `StageId`: `snapshot` / `precheck` / `request` / `receiving` / `finalizing` (페이지 재진입 시 표시) |
| `stage_timings` | jsonb NULL | 단계별 시각·소요 `StageTiming[]` (아래). 실행이 끝날 때 한 번 저장. NULL이면 이력에서 단계별 소요를 비운다 |
| `requested_at`, `started_at`, `finished_at` | timestamptz | |
| `duration_ms` | int | 소요 시간 |
| `snapshot_hash` | char(64) | 전송한 스냅샷 전문 sha256 |
| `snapshot_summary` | jsonb | 노드 수, 추정 월 비용, 관측 구간, 생략 건수 (이력 목록용) |
| `snapshot` | jsonb | 전송한 스냅샷 전문 |
| `snapshot_bytes` | int | |
| `redacted_count` | int | 비밀값 검사로 가린 건수 ("가림 N건") |
| `precheck_results` | jsonb | 실행 시점 사전 점검 결과 전체 |
| `precheck_summary` | jsonb | `{high, medium, low}` |
| `suggestion_count`, `high_count`, `medium_count`, `low_count` | int | 이력 목록의 "제안 수(심각도별)" |
| `dropped_count` | int | 형식 오류로 제외한 제안 수 |
| `raw_response` | text | **응답 형식 오류일 때만** 원문 (최대 256KB 권장, `retention.advisorRawResponseMaxBytes`) |
| `model` | varchar(100) | 브리지가 알려주면 |
| `usage` | jsonb | 토큰 사용량 등 (선택) |

- 취소는 `status = cancelled`(failure_reason 없음). 명세의 실패 사유 목록 중 "취소됨"은 status로 표현한다.
- 동시 1건: 새 실행을 `create({ activeLock: 'active', ... })` → 이미 실행 중이면 **P2002(unique 위반)** → 진행 중 실행을 `findUnique({ where: { activeLock: 'active' } })`로 찾아 연결. 끝날 때 `activeLock: null`로 업데이트(완료·실패·취소 모두).
- API 재시작 시 `closeInterruptedAdvisorRuns(prisma)`로 남은 잠금을 `failed/interrupted`로 닫는다(분석이 프로세스 메모리에서 진행되므로 이어갈 수 없음).

### 2.7 `advisor_suggestions` (모델 `AdvisorSuggestion`) — architecture-advisor

명세 3.5 필드를 그대로 컬럼으로 둔다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | uuid | |
| `run_id` FK | uuid → `advisor_runs.id` ON DELETE CASCADE | |
| `priority` | int | 1..N, UNIQUE(`run_id`, `priority`) |
| `title` | varchar(300) | |
| `category` | enum `suggestion_category` | cost / reliability / performance / security / database |
| `severity` | enum `severity` | high / medium / low |
| `targets` | jsonb | 대상 리소스 `TargetRef[]` (아래) |
| `evidence` | jsonb | `Evidence[]` = `[{field, value, text, verified}]` |
| `precheck_ids` | text[] (기본 `{}`) | 연결된 사전 점검 ID |
| `estimated_monthly_savings_usd` | numeric(12,2) | 추정 절감액 |
| `savings_formula` | varchar(500) | 계산식 |
| `savings_source` | enum `savings_source` | server / llm |
| `steps` | jsonb | 실행 방법 `Step[]` (아래). 텍스트로만 렌더링 |
| `risk_level` | enum `severity` | 적용 위험도 |
| `risk_reason` | varchar(300) | |
| `verification` | text | 확인 방법 |
| `unverified` | bool | "근거 확인 불가" (목록 맨 아래) |

- "근거 확인 불가" 제안은 `unverified = true`이고 priority를 가장 뒤로 매긴다. 목록 정렬: `ORDER BY unverified, priority`.
- jsonb 모양 (TS 타입: `apps/api/src/database/advisor-json.ts`, API 타입 `docs/api/architecture-advisor.md` A.1.3과 같은 구조). DB는 모양을 강제하지 않으므로 api가 검증·길이 제한 후 저장한다.
  ```ts
  // targets
  { kind: string; namespace: string | null; name: string; snapshotName: string; inSnapshot: boolean;
    ref: { kind: string; namespace: string | null; name: string } | null }[]
  // steps
  { text: string; code: { language: string; content: string } | null }[]
  // advisor_runs.stage_timings (5개 고정 순서)
  { id: 'snapshot'|'precheck'|'request'|'receiving'|'finalizing';
    state: 'pending'|'active'|'done'|'error'|'skipped';
    startedAt: string | null; finishedAt: string | null; durationMs: number | null }[]
  ```
- 사전 점검 결과는 LLM 제안과 성격이 달라(항상 재계산, 실행과 무관) 별도 테이블 대신 실행 시점 사본을 `advisor_runs.precheck_results`에 둔다. 현재 사전 점검은 저장하지 않는다(메모리 계산).

### 2.8 `alerts` (모델 `Alert`) — alerts

명세 `docs/specs/alerts.md` 3.7 A. 알림 1건 = **영역/출처 단위**이지 리소스 1개가 아니다(3.1).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | uuid | |
| `data_source` | enum `data_source_mode` | mock / live. **모든 조회가 이 열로 먼저 거른다** (mock 알림이 live 이력에 섞이면 안 된다) |
| `alert_key` | varchar(320) | `area:controlPlane\|nodes\|workloads\|pods\|events\|db\|cost`, `source:kube`, `system:restart`, `system:test` |
| `kind` | enum `alert_kind` | transition / escalation / resolve / flapping / restart_summary / test |
| `severity` | enum `alert_severity` | critical / warning / unknown / **resolved**(해제) |
| `from_status`, `to_status` | enum `alert_state_value` | ok / warning / critical / unknown. 기준선이 없으면 null |
| `reason_code`, `reason_text` | varchar(100) / varchar(500) | `reasons[0]`. text는 서버가 이미 `redactSecrets` + 길이 제한을 거친 값 |
| `targets` | jsonb `[]` | 영향 객체 **최대 3개** `[{kind, namespace, name}]` |
| `target_count` | int | 전체 개수(3보다 크면 "외 N개") |
| `occurred_at`, `last_event_at` | timestamptz | 발생 / 억제 창에 합쳐진 마지막 사건 |
| `resolved_at` | timestamptz null | 정상으로 돌아온 시각("해결됨 · 지속 N분") |
| `closed_at` | timestamptz null | **진행 중 판정의 유일한 기준.** NULL = 진행 중 |
| `parent_alert_id` | uuid null → `alerts.id` **ON DELETE SET NULL** | 해제·격상 알림이 가리키는 발생 알림 |
| `repeat_count` | int (기본 1) | 억제 창 합산 ("반복 N회") |
| `flapping` | bool | 플래핑 묶음 |
| `suppressed_keys` | text[] | 출처 억제로 묶인 영역 키 (`source:kube` 알림에만, "영향 영역 5개") |
| `acknowledged_at` | timestamptz null | 확인(읽음) 시각. NULL = 미확인. 서버에 하나(로그인 없음, 가정 N2) |
| `context` | jsonb null | 종류별 구조화 부가 정보 (`AlertContextJson`) |
| `created_at` | timestamptz | |

- **본문 문자열을 저장하지 않는다.** 디스코드·화면에 나가는 문장은 위 구성요소로 **표시할 때 조립**한다. 이렇게 하면 "알림 본문"이라는 자유 텍스트 칸이 아예 없어서 **로그 줄·쿼리 원문·환경 변수가 흘러들어올 자리가 구조적으로 없다**(logs PM 결정: 알림에 로그 줄을 넣지 않는다).
- **상태 전이 표의 `critical → warning`(완화)은 새 행을 만들지 않는다.** 기존 행의 `severity`를 낮추고 `last_event_at`만 갱신한다(명세 3.2.1).
- **격상(`warning → critical`)은 새 행**을 만들고 이전 행을 `closed_at`으로 닫은 뒤 `parent_alert_id`로 잇는다. 닫지 않으면 진행 중 알림이 키마다 여러 개가 되어 보관 정리가 영원히 못 지운다.
- `closed_at` 규칙: `resolve` / `restart_summary` / `test`는 **만들 때** `closed_at = occurred_at`을 넣는다(종결형). 진행 중일 수 있는 것은 `transition` / `escalation` / `flapping` 뿐이다.
- `data_source` 분리 덕분에 `POST /api/mock/reset`은 `DELETE FROM alerts WHERE data_source='mock'` 한 줄이면 된다(live 이력은 그대로).

**`i-0…`(EC2 인스턴스 ID)가 이 테이블에 남는 것에 대한 판단** — 문제 없다고 본다. 근거:

1. 인스턴스 ID는 **식별자이지 자격 증명이 아니다.** 알아도 AWS API를 부르려면 자격 증명이 따로 필요하다. 비밀값(키·토큰·접속 문자열)과 같은 선반에 두지 않는다.
2. **이미 같은 값이 이 DB에 있다.** `cost_rate_samples.resources[].key`가 EC2 인스턴스 키를 그대로 담는다(2.2). 이번 결정이 **새로운 종류의 노출을 만드는 것이 아니다.**
3. 대시보드 DB는 관측 대상과 **같은 신뢰 경계** 안에 있다. 이 DB를 읽을 수 있는 사람은 이미 클러스터 상태를 다 볼 수 있다.
4. 진짜로 조심할 곳은 DB가 아니라 **밖으로 나가는 경로**다: ① 디스코드 채널(외부·회수 불가 — 설정 화면 안내로 다룬다, PM 결정 Q3), ② 어드바이저 스냅샷(가명 규칙 — **알림 이력은 스냅샷에 넣지 않는다**, 8절 backend 요청), ③ DB 덤프.
5. 보관 한도(90일 / 2,000건)가 자동으로 지우므로 **영구 누적이 아니다.**

### 2.9 `alert_deliveries` (모델 `AlertDelivery`) — alerts

명세 3.7 B. **알림 1건 × 채널당 1행**이고, 재시도는 새 행이 아니라 `attempts`로 센다(UNIQUE `alert_id, channel`).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` PK | bigserial | |
| `alert_id` | uuid → `alerts.id` **ON DELETE CASCADE** | 알림이 정리되면 함께 사라진다 |
| `channel` | enum `alert_channel` | ui / discord |
| `status` | enum `alert_delivery_status` (12) | pending / sent / failed / skipped_disabled / skipped_not_configured / skipped_severity / skipped_unknown_off / **skipped_no_pair** / skipped_mock / skipped_restart / skipped_flapping / **skipped_circuit_open** |
| `attempts` | int | 시도 횟수 (백오프 3회) |
| `last_attempt_at` | timestamptz | |
| `next_attempt_at` | timestamptz null | 다음 시도 예정(백오프·429 `Retry-After`). 발송 큐 조회 키 |
| `response_code` | int null | 디스코드 HTTP 응답 코드 |
| `error_message` | varchar(500) null | **가림 처리된** 사유 한 줄 |
| `created_at`, `updated_at` | timestamptz | |

- **`failed`와 `skipped_*`를 섞지 않는다.** 특히 뒤에 추가한 두 값(`20260924200000_alert_delivery_skip_reasons`):
  - `skipped_no_pair` — 발생 알림을 이 채널로 보내지 않았으므로 해제 알림도 보내지 않았다(AC-ALERT32). 앞뒤 없는 "복구됨"이 채널에 뜨는 것을 막은 **정상 동작**이지 실패가 아니다.
  - `skipped_circuit_open` — 연속 실패가 `alerts.discord.failureCircuitCount`(10)를 넘어 `failureCooldownMin`(60분) 동안 발송을 멈춘 상태에서 건너뛰었다. `failed`와 같은 값이면 "왜 안 갔나"를 나중에 추적할 수 없다.
- **웹훅 URL 원문을 이 표에 넣지 않는다.** 오류 메시지를 만들 때 `redactDiscordWebhookUrls()`(2.12)를 통과시킨다.
- `ui` 채널 행은 **선택**이다. 화면 알림 센터는 끌 수 없고 항상 도달하므로(3.3) 행을 만들지 않아도 정보가 없어지지 않는다. 만들면 알림 수만큼 행이 두 배가 된다 → backend 판단에 맡기되 **권장은 discord 행만**.

### 2.10 `alert_key_states` (모델 `AlertKeyState`) — alerts

명세 3.7 C. PK = (`data_source`, `alert_key`). 키마다 1행이고 **억제·플래핑 판정에 필요한 것이 전부 이 한 행에 있다.**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `status` | enum `alert_state_value` | **직전 상태** |
| `status_since` | timestamptz | 마지막 전이 시각 |
| `open_alert_id` | uuid null → `alerts.id` **ON DELETE SET NULL** | 진행 중 알림. 해제·격상 대상 |
| `dedupe_started_at`, `dedupe_count` | timestamptz / int | 억제 창(3.2.2) |
| `recent_transitions` | jsonb `[]` | **최근 전이 목록** `[{at, from, to}]`, 플래핑 창 밖은 쓸 때 잘라낸다(상한 50) |
| `flapping`, `flapping_since` | bool / timestamptz | 플래핑(3.2.3) |
| `unknown_since` | timestamptz null | unknown 5분 지속 판정(3.2.4) |
| `suppressed_by` | varchar(320) null | 출처 억제 중이면 억제한 키 |
| `last_notified_targets` | text[] | 마지막으로 알린 영향 객체 `"Kind/ns/name"` (상한 200) — "새 객체 추가" 판정 |
| `updated_at` | timestamptz | |

- **"직전 상태"와 "최근 N분 이력"을 한 번의 PK 조회로 얻는다.** 전이 이력을 `alerts`에서 세지 않는 이유: 억제 창에 합쳐진 전이는 알림 행을 만들지 않으므로 `alerts`는 전이 로그가 **아니다**. 별도 `alert_transitions` 표를 두는 대안도 검토했으나, 15초마다 INSERT가 생기고(하루 5,760행 × 8키) 판정 때마다 범위 조회가 붙는다. 창 길이만큼만 들고 있으면 되는 값이라 **같은 행의 jsonb 배열**이 더 싸고 단순하다.
- **매 15초마다 쓰지 않는다.** 15초 루프는 PK로 읽고, `status`·창·플래핑 값이 **실제로 바뀐 키만** upsert한다. 평상시 쓰기는 0이다.
- `open_alert_id`가 있어서 "진행 중 알림 찾기"에 `alerts` 검색이 필요 없다.
- 워밍업(3.2.5)은 이 표를 **기준선으로만** 쓴다. 재시작 후 "직전 종료 상태와 비교해 알림을 만드는" 동작은 명세가 금지한다.

### 2.11 `dashboard_heartbeats` (모델 `DashboardHeartbeat`) — alerts

명세 3.7 D. PK `scope`(현재 `'alerts'` 하나)의 **단일 행**. 60초마다 upsert 1건.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `scope` PK | varchar(32) | `'alerts'` |
| `started_at` | timestamptz | 지금 프로세스가 시작한 시각 |
| `observed_at` | timestamptz | 마지막 갱신. 재시작 후 `지금 - observed_at` = **정지 구간** |
| `data_source` | enum | 기록 당시 모드 |

- `INSERT … ON CONFLICT (scope) DO UPDATE SET observed_at = EXCLUDED.observed_at` — 행이 늘지 않는다.
- `fillfactor = 70`(마이그레이션에서 지정). 한 행을 계속 갱신하므로 같은 페이지 안에서 HOT 갱신이 되게 여유를 둔다. 인덱스가 PK 하나뿐이라 부담이 거의 없다.
- **`settings`에 넣지 않은 이유**: settings는 사람이 바꾸는 설정이고 부팅 때 읽어 캐시한다. 60초마다 바뀌는 런타임 값이 섞이면 설정 화면·캐시·시드의 의미가 흐려진다.
- 행이 없으면 "이전 실행 기록 없음"으로 표시한다(대시보드 DB가 없을 때와 같은 문구).

### 2.12 비밀값 설정 `alerts.discord.webhookUrl` (저장 계층 보장)

디스코드 웹훅 URL은 **사실상 비밀값**이다(주소를 아는 사람이 그 채널에 글을 쓸 수 있다). PM 결정 Q4에 따라 **DB에 평문**으로 두되, 저장 계층에서 다음을 보장한다. 구현은 `apps/api/src/database/secret-settings.ts`.

| 보장 | 방법 |
|---|---|
| 일반 설정 읽기 경로로 못 읽는다 | 이 key를 **`SETTING_DEFAULTS`에 넣지 않았다.** `SettingsService.get('alerts.discord.webhookUrl')`은 **컴파일되지 않는다**(`SettingKey`에 없다). 그래서 60초 설정 캐시(누구나 `peek()` 가능)에 비밀값이 들어갈 수 없다 |
| 화면·API에 원문이 안 나간다 | `readWebhookStatus()`가 `{configured, hint: "…****7f3a", length, source, lockedByEnv, updatedAt}`만 돌려준다. **원문을 반환하는 함수는 `loadWebhookUrlForDispatch()` 하나**이고 발송기 전용이다 |
| 목록 응답에 섞이지 않는다 | `listPublicSettings()`가 `SECRET_SETTING_KEYS`를 제외한다(where + 반환 직전 한 번 더 필터). `prisma.setting.findMany()`를 직접 응답에 싣지 않는다 |
| 이상한 값이 저장되지 않는다 | `checkWebhookUrl()`: https + `discord.com`/`discordapp.com` + `/api/webhooks/<숫자>/<토큰>` + 500자. 실패 시 `InvalidWebhookUrlError(code)` — **오류 객체·메시지에 입력값을 담지 않는다**(AC-ALERT21) |
| 환경 변수가 이긴다 | `ALERTS_DISCORD_WEBHOOK_URL`이 있으면 DB를 읽지 않고, 저장·삭제는 `SettingLockedByEnvError`(→ 409 `SETTING_LOCKED_BY_ENV`)로 막는다. 기존 `COST_MONTHLY_BUDGET_USD` 잠금과 같은 방식 |
| 로그·오류에 안 새어 나간다 | `DISCORD_WEBHOOK_URL_PATTERN` / `redactDiscordWebhookUrls()`를 내보낸다. backend의 공용 `redactSecrets`에 이 패턴을 얹어 쓰면 된다 |
| 시드에 예시 값이 없다 | 이 key는 **시드가 만들지 않는다.** 설정 저장으로만 행이 생긴다 |

- 저장 모양은 `{"url": "https://…" | null}` 객체다. 스칼라가 아니라 객체로 감싼 이유: ① 다른 설정과 모양이 같고 ② 나중에 `{"url": "enc:v1:…"}`처럼 **암호화로 갈아탈 때 스키마·마이그레이션이 필요 없다.**
- **평문 저장의 실제 한계(반드시 알고 있어야 한다)**: `pg_dump`·볼륨 스냅샷·지원용 덤프에 **URL이 그대로 들어간다.** `.env`는 호스트에 남지만 덤프는 밖으로 나가기 쉽다 — 이 한 가지는 "보호 수준이 같다"가 성립하지 않는 지점이다. 다만 이 값은 ① **즉시 폐기 가능**하고(디스코드에서 웹훅 삭제 = 완전 무효화, 클러스터·AWS에 영향 0) ② 유출 시 피해가 "그 채널에 글을 쓸 수 있다"로 한정되며 ③ 읽기 권한을 주지 않는다. 그래서 평문 + 원문 미노출 + `.env` 선택지로 충분하다고 본다. 덤프를 외부에 공유해야 하는 운영이라면 `.env` 경로(`ALERTS_DISCORD_WEBHOOK_URL`)를 쓰고 DB 행을 비워 두면 된다.

### 2.13 알림 조회 패턴 (backend용 요약)

명세 7절 DBA 항목의 ①~⑤. 모두 4절 인덱스를 탄다. `$ds` = `data_source`.

> **호출 빈도가 다르다** (2026-09-24 계약 변경: `alerts.snapshot` SSE에서 목록을 뺐다).
> ①은 **`/alerts` 화면을 연 사람만** 부른다. ②는 **모든 탭·모든 SSE 재연결마다** 부르는 유일한 조회다.
> 그래서 ②만 전용 인덱스와 질의 형태를 맞춰 뒀다(4절).

| # | 쓰는 곳 | 질의 |
|---|---|---|
| ① | 최근 N건 (**`/alerts` 화면 전용**) | `WHERE data_source=$ds ORDER BY occurred_at DESC LIMIT $n` |
| ② | **배지** (안 읽은 수 + 최악 심각도, **가장 잦음**) | `SELECT count(*) AS unread, min(severity) AS worst … WHERE data_source=$ds AND acknowledged_at IS NULL AND severity < 'resolved'` — **1행으로 끝난다.** 근거·측정은 4절 |
| ③ | `/alerts` 필터 | `WHERE data_source=$ds [AND severity IN (…)] [AND alert_key IN (…)] [AND occurred_at >= $from] [AND closed_at IS NULL] ORDER BY occurred_at DESC` |
| ④ | 진행 중 목록 | `WHERE data_source=$ds AND closed_at IS NULL ORDER BY occurred_at DESC` |
| ⑤ | 상태 머신 (15초) | `findUnique({ dataSource_alertKey })` → 바뀐 것이 있을 때만 `upsert`. **진행 중 알림은 `open_alert_id`로 바로 찾는다**(alerts 검색 없음) |
| — | 억제 창 안 사건 합치기 | `update alerts set repeat_count = repeat_count + 1, last_event_at = $now where id = $openAlertId` |
| — | 모두 확인 | `updateMany where data_source=$ds AND acknowledged_at IS NULL set acknowledged_at = $now` |
| — | 발송 큐 | `WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $n` |
| — | heartbeat (60초) | `upsert { scope:'alerts' } update { observedAt }` |
| — | mock 초기화 | `DELETE FROM alerts WHERE data_source='mock'` + `alert_key_states` 같은 조건 (live 이력은 그대로) |

- **대시보드 DB가 없을 때**: 명세 3.7대로 메모리 최근 200건(`settings alerts.memoryFallbackMax`)으로 동작한다. `PrismaService.isConnected`가 false면 위 질의를 부르지 않는다(기존 어드바이저 폴백과 같은 결).
- 알림 1건의 크기는 대략 0.3~0.6KB(본문을 저장하지 않으므로 작다). 2,000건 = 1MB 남짓이고 인덱스를 합쳐도 수 MB다.

## 3. 데이터 보존 정책

| 테이블 | 보존 | 근거 | 정리 기준 |
|---|---|---|---|
| `cost_rate_samples` | **90일** | aws-cost 4절 "5분 간격 저장, 90일 보관". 급증 판단은 7일만 쓰지만 추이 확인용 | `sampled_at < now - 90d` |
| `cost_explorer_cache` | 조회 후 **35일** | 요청 키당 최신 1건이라 커지지 않음. 월이 바뀌며 남는 옛 키(지난달 기간 등)만 정리 | `fetched_at < now - 35d` |
| `cost_explorer_call_logs` | **90일** | 일일 상한·이번 달 CE 비용 계산에 최대 31일 필요. 호출 추이 확인용 여유 | `called_at < now - 90d` |
| `price_cache` | 만료 후 **7일** | 만료된 단가도 조회 실패 시 참고 가능하게 잠시 유지 | `expires_at < now - 7d` |
| `advisor_runs` (+ `advisor_suggestions` CASCADE) | **최근 50건 또는 90일** 중 먼저 닿는 쪽 | architecture-advisor 가정 D5. (PM 예시의 180일이 아니라 **명세 값을 따름**, 바꾸려면 `retention.advisorRunDays`) | `requested_at < now - 90d` 또는 최신순 51번째부터, **`active_lock IS NULL`인 것만** |
| `alerts` (+ `alert_deliveries` CASCADE) | **90일 또는 data_source별 2,000건** 중 먼저 닿는 쪽 | alerts 3.7, PM 결정 Q12 (`retention.alertDays` / `alertMaxRows`) | `occurred_at < now - 90d` 또는 data_source별 최신순 2,001번째부터, **`closed_at IS NOT NULL`인 것만** |
| `alert_key_states`, `dashboard_heartbeats` | 영구(행이 늘지 않음) | 키 8개 × 2 모드, heartbeat 1행이 전부다 | - |
| `settings` | 영구 | | - |

- 정리 함수: `apps/api/src/database/retention.ts`의 `purgeExpiredData(prisma, now?, policy?)`. backend가 **하루 1회**(예: 04:00, `@nestjs/schedule`)와 API 시작 시 호출한다. 반환값은 테이블별 삭제 건수.
- 보존 기간은 `settings.retention`으로 바꿀 수 있다(`mergeSetting('retention', row.value)`를 policy로 넘김).
- 삭제는 모두 인덱스 범위 삭제다. 이 규모(수만 행)에서는 배치 분할이 필요 없다. 삭제 후 autovacuum이 공간을 회수한다(별도 VACUUM 불필요).

**알림 정리가 화면을 멈추지 않게 하는 방법** (`purgeAlerts(prisma, now?, policy?)`, AC-ALERT18)

- **읽기는 쓰기에 막히지 않는다.** Postgres는 MVCC라 `DELETE`가 잡는 행 잠금이 `SELECT`를 막지 않는다. 배지·목록 질의는 정리 중에도 평소대로 응답한다. 이것이 "화면이 멎지 않는다"의 실제 근거다.
- 그래서 **`TRUNCATE`를 쓰지 않는다.** `TRUNCATE`는 `ACCESS EXCLUSIVE` 잠금이라 읽기까지 막힌다. `VACUUM FULL`도 같은 이유로 쓰지 않는다(autovacuum에 맡긴다).
- 그래도 **`alertPurgeBatchSize`(기본 500)행씩 나눠** 지우고 **트랜잭션으로 묶지 않는다.** 한 번에 수만 행을 한 트랜잭션에서 지우면 잠금·WAL·죽은 튜플이 한꺼번에 몰리고, 중간에 실패하면 전부 되돌아간다. 배치는 한 회 호출에서 200번까지만 돌고 남은 것은 다음 주기에 지운다.
- **진행 중(`closed_at IS NULL`) 알림은 어느 기준으로도 지우지 않는다.** 지우면 나중에 오는 해제 알림이 짝을 잃는다. `kind`가 종결형(`resolve`/`restart_summary`/`test`)인데 `closed_at`이 비어 있는 행도 지울 수 있게 조건을 OR로 둬서, backend가 `closed_at`을 빠뜨려도 이력이 무한정 쌓이지 않게 했다.
- 건수 상한은 **data_source별로 따로** 센다. mock에서 만든 알림(`burst` 시나리오는 3초에 1건)이 live 이력을 밀어내면 안 된다.
- 알림은 `burst` 같은 상황에서 하루 만에 상한에 닿을 수 있으므로, backend는 하루 1회 외에 **한 시간에 한 번 정도 `purgeAlerts`만 따로** 호출하는 것을 권한다(그래서 함수를 따로 내보냈다).

## 4. 인덱스와 근거

| 인덱스 | 쓰는 쿼리 |
|---|---|
| `cost_rate_samples (data_source, sampled_at)` UNIQUE | 7일 중앙값·24시간 수집 여부(`data_source = ? AND sampled_at >= ?`), 기준 시점 리소스 조회, 중복 방지 |
| `cost_rate_samples (sampled_at)` | 보존 정리(data_source 무관 범위 삭제) |
| `cost_explorer_cache (data_source, request_key)` UNIQUE | 캐시 조회·upsert (가장 잦은 조회) |
| `cost_explorer_cache (data_source, kind, fetched_at DESC)` | 화면용 "종류별 최신 결과", 마지막 조회 시각 |
| `cost_explorer_cache (fetched_at)` | 보존 정리 |
| `cost_explorer_call_logs (called_at)` | 오늘 호출 수, 이번 달 CE 비용, 보존 정리 |
| `cost_explorer_call_logs (trigger, called_at DESC)` | 마지막 수동 새로고침 시각(1시간 제한) |
| `price_cache (source, region, product_key)` UNIQUE | 단가 조회·upsert |
| `price_cache (expires_at)` | 보존 정리 |
| `advisor_runs (active_lock)` UNIQUE | 동시 1건 보장, 진행 중 실행 찾기 (NULL 다수 허용) |
| `advisor_runs (requested_at DESC)` | 이력 목록(최신순 페이지), 보존 정리(90일·50건) |
| `advisor_runs (status)` | 상태별 필터(실패만 보기 등). 행 수가 적어 선택적이지만 비용이 거의 없음 |
| `advisor_suggestions (run_id, priority)` UNIQUE | 실행별 제안 목록(우선순위 순), FK CASCADE 삭제 시 run_id 조회 |
| **`alerts (data_source, acknowledged_at, severity)`** | **배지(안 읽은 개수 + 최악 심각도).** 모든 탭·모든 SSE 재연결마다 도는 **가장 잦은 조회** — 세 열이 다 인덱스 조건이 된다 |
| `alerts (data_source, occurred_at DESC)` | `/alerts` 화면의 최근 N건·기간 필터, 보존 정리(90일·2,000건 오프셋) |
| `alerts (data_source, alert_key, occurred_at DESC)` | 키별 이력(영역 필터), 최근 N분 확인, 플래핑 타임라인 |
| `alerts (data_source, closed_at, occurred_at DESC)` | 진행 중(미해제)만 보기 |
| `alerts (parent_alert_id)` | 해제↔발생 역참조. **없으면 보존 정리의 `ON DELETE SET NULL`이 행마다 alerts 전체를 훑는다** |
| `alert_deliveries (alert_id, channel)` UNIQUE | 채널별 1행 upsert, 알림 상세의 발송 상태 |
| `alert_deliveries (status, next_attempt_at)` | 발송 큐(`pending` + 시도 시각 도래) |
| `alert_key_states (data_source, alert_key)` PK | 15초 루프의 상태 머신 읽기·쓰기 |
| `alert_key_states (open_alert_id)` | FK `ON DELETE SET NULL` 스캔 방지 |

**배지 질의 — 가장 잦은 조회 (모든 탭·모든 SSE 재연결마다)**

```sql
SELECT count(*) AS unread, min(severity) AS worst
  FROM alerts
 WHERE data_source = $1 AND acknowledged_at IS NULL AND severity < 'resolved';
```

**집계 한 방으로 1행만 돌려준다.** 숫자 = 배지 값, `worst` = 배지 색.

- **`min(severity)`가 곧 "최악 심각도"다.** `alert_severity` enum을 `critical, warning, unknown, resolved` 순으로 선언했고 enum 정렬 순서가 곧 심각도 순서(`docs/api/common.md` 2.1)이기 때문이다. 백엔드에서 정렬·비교 코드를 쓰지 않는다.
- **`<> 'resolved'`가 아니라 `< 'resolved'`를 쓴다.** `resolved`가 enum의 **마지막** 값이라 뜻은 같지만, `<`는 **인덱스 경계**가 되고 `<>`는 스캔 후 버리는 **필터**가 된다. 차이는 "안 읽은 해제 알림이 쌓였을 때" 드러난다(해제 알림은 화면 이력의 완결성 때문에 항상 만들지만 배지에는 안 센다 — 자연히 쌓인다).
- **이 두 가지는 enum 선언 순서에 기대는 불변식**이다. 순서를 바꾸면 질의가 조용히 틀린 답을 낸다 → `src/database/alerts-json.spec.ts`가 선언 순서를 테스트로 고정한다.

측정 (PGlite, 미확인 2,000건 중 1,990건이 `resolved`인 최악 상황, `VACUUM ANALYZE` 후):

| 질의 형태 | 읽은 인덱스 항목 | buffers | 시간 |
|---|---|---|---|
| `GROUP BY severity` + `<>` | 2,000 (1,990 버림) | 5 | 0.53 ms |
| 집계 1행 + `<>` | 2,000 (1,990 버림) | 5 | 0.33 ms |
| **집계 1행 + `<`** | **10** | **3** | **0.094 ms** |
| 집계 1행 + `IN (critical,warning,unknown)` | 10 | 3 | 0.103 ms |

- **`VACUUM` 전(=방금 쓰기가 몰린 상태)에는 `<>` 형태가 아예 `Seq Scan`으로 떨어졌다**(2,490행 필터). `<` 형태는 그 상태에서도 Bitmap Index Scan을 유지했다. 알림 표는 계속 쓰이는 표라 이 상태가 드물지 않다.
- `IN` 형태도 같은 성능이고 **enum 순서에 기대지 않는다.** `<`를 고른 이유는 "해제를 뺀 나머지"라는 뜻을 그대로 옮기고, 나중에 심각도 값이 하나 늘어도 자동으로 포함되기 때문이다. 순서 의존이 싫으면 `IN` 형태로 바꿔도 인덱스·성능은 같다.
- 인덱스는 `(data_source, acknowledged_at, severity)` 그대로 쓴다. 세 열이 모두 인덱스 조건이 되어 **Index Only Scan(Heap Fetches 0)**으로 끝난다. **빈도 전제가 바뀐 뒤에도 이 인덱스가 맞다**(열을 더하거나 순서를 바꿀 이유가 없었다).
- 부분 인덱스(`WHERE acknowledged_at IS NULL`)는 **쓰지 않는다.** Prisma 스키마로 표현할 수 없어 raw SQL이 필요하고, 그러면 `migrate diff`가 매번 "인덱스를 지우라"는 드리프트를 낸다 — 상시 드리프트는 진짜 드리프트를 놓치게 만든다. 위 측정대로 성능 이득도 없다.
- 행이 0건이어도 **항상 1행**(`unread=0, worst=null`)이 온다. 백엔드가 빈 결과를 따로 다루지 않아도 된다.
- `모두 확인`은 `UPDATE alerts SET acknowledged_at = now() WHERE data_source=$1 AND acknowledged_at IS NULL`. 사람이 누를 때만 도는 드문 조작이라 계획을 맞추지 않았다(대상이 많으면 Seq Scan이 정상이다).
- **권고**: 배지 값은 알림 생성·확인 때만 바뀐다. 백엔드가 이 결과를 메모리에 들고 있다가 변화 때만 다시 계산하면 재연결이 몰려도 질의가 1회로 끝난다(질의 자체가 싸므로 필수는 아니다).

의도적으로 만들지 않은 것: JSONB GIN 인덱스(스냅샷·결과 내부 검색 요구 없음), `advisor_suggestions (category, severity)`(한 실행 안에서 수십 건이라 필터는 메모리로 충분), `alerts (severity)`(전체가 2,000건이라 심각도 필터는 위 인덱스 + 필터로 충분하다. 인덱스를 늘리면 삽입·삭제만 느려진다).

## 5. 마이그레이션

| 이름 | 파일 | 되돌리기 |
|---|---|---|
| `20260919120000_init` | `apps/api/prisma/migrations/20260919120000_init/migration.sql` | `docs/db/migrations/20260919120000_init.down.sql` |
| `20260919150000_advisor_contract` | `apps/api/prisma/migrations/20260919150000_advisor_contract/migration.sql` | `docs/db/migrations/20260919150000_advisor_contract.down.sql` |
| `20260919180000_advisor_limits_defaults` | `apps/api/prisma/migrations/20260919180000_advisor_limits_defaults/migration.sql` | `docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql` |
| `20260924120000_control_plane_cost_column` | `apps/api/prisma/migrations/20260924120000_control_plane_cost_column/migration.sql` | `docs/db/migrations/20260924120000_control_plane_cost_column.down.sql` |
| `20260924180000_alerts` | `apps/api/prisma/migrations/20260924180000_alerts/migration.sql` | `docs/db/migrations/20260924180000_alerts.down.sql` |
| `20260924200000_alert_delivery_skip_reasons` | `apps/api/prisma/migrations/20260924200000_alert_delivery_skip_reasons/migration.sql` | `docs/db/migrations/20260924200000_alert_delivery_skip_reasons.down.sql` |

`20260919150000_advisor_contract` (API 계약 3단계): `advisor_failure_reason`에 `budget_exceeded` 추가(`interrupted` 앞), `advisor_runs.stage_timings jsonb NULL` 추가, `advisor_suggestions.steps` text → jsonb. steps는 Prisma 기본 SQL(DROP+ADD, 기존 행이 있으면 실패)을 손으로 고쳐 `USING` 변환한다: 유효한 JSON 배열 문자열은 그대로, 그 외는 `[{"text": <원문>, "code": null}]`. down은 `budget_exceeded` → `other`, `stage_timings` 삭제, steps를 텍스트(단계 사이 빈 줄, 코드는 ``` 블록)로 합친다 — 손실 있음.

`20260919180000_advisor_limits_defaults` (데이터만, 스키마 변경 없음): settings `advisor.limits`에서 `maxTurns`가 정확히 3이면 5로, `slowAfterSec`가 정확히 180이면 300으로 필드별로 올린다. 다른 값(운영자 설정)·행 없음은 그대로. down은 5→3, 300→180으로 되돌린다 — 마이그레이션 뒤 운영자가 일부러 5/300으로 둔 값도 구분할 수 없어 함께 되돌려진다.

`20260924120000_control_plane_cost_column` (kops-support, AC-KOPS34): ① `cost_rate_samples.eks_usd_per_hour` → `control_plane_usd_per_hour` **RENAME COLUMN**. Prisma가 필드 이름 변경에 기본으로 내는 `DROP COLUMN` + `ADD COLUMN`은 **값이 사라져** 급증 판단 기준선이 끊기므로 쓰지 않는다(SQL을 손으로 쓴다). ② 같은 행 `resources` jsonb의 `kind: 'eks'` → `'controlPlane'`(금액·배열 순서 그대로). ③ settings `cost.spike.rate.baselineFrom`에 적용 시각(UTC)을 기록(없거나 null일 때만). down은 열·`kind`를 되돌리고 `baselineFrom`을 지운다 — `kind` 되돌리기는 **전환 이전에 생긴 행만**(`created_at < 마이그레이션 finished_at`) 대상으로 하고, `baselineFrom`은 운영자가 바꾼 값과 구분할 수 없어 무조건 지운다.

`20260924180000_alerts` (alerts P1·P2): **추가만 하는 마이그레이션이다.** enum 5개(`alert_severity`·`alert_kind`·`alert_state_value`·`alert_channel`·`alert_delivery_status`)와 표 4개(`alerts`·`alert_deliveries`·`alert_key_states`·`dashboard_heartbeats`), 인덱스·FK를 만든다. **기존 표·열·행을 하나도 읽거나 쓰지 않는다** — `settings` 값도 건드리지 않는다(새 key `alerts`·`alerts.discord`는 시드가 넣고, 시드를 안 돌려도 `mergeSetting`이 코드 기본값으로 채운다. `retention`의 새 필드도 같은 방식이라 데이터 마이그레이션이 필요 없다). 마지막에 `dashboard_heartbeats`(70)·`alert_key_states`(85)에 `fillfactor`를 건다 — Prisma 스키마로 표현할 수 없는 저장 파라미터이고, `migrate diff`가 이를 보지 않아 **드리프트가 생기지 않는 것을 확인했다**. down은 만든 표·enum·마이그레이션 기록만 지우고 `data_source_mode`와 `settings`는 그대로 둔다(웹훅 주소를 지우지 않는다 — 다시 적용하면 그대로 쓸 수 있어야 한다).

`20260924200000_alert_delivery_skip_reasons` (backend 계약 작성 중 발견): `alert_delivery_status`에 **`skipped_no_pair`**(AC-ALERT32 짝 없는 해제)와 **`skipped_circuit_open`**(연속 실패 1시간 차단 중 건너뜀)을 추가한다. 없으면 둘 다 "안 보냄"인지 "실패"인지 기록에서 구분되지 않는다. `ALTER TYPE … ADD VALUE`는 카탈로그에 값만 덧붙이므로 **테이블을 다시 쓰지 않고 기존 행·값이 하나도 바뀌지 않는다**(열 재작성·`USING` 캐스팅·타입 교체가 없다. 이 마이그레이션은 어떤 테이블도 읽거나 쓰지 않는다). Postgres 12+부터 트랜잭션 안에서 실행할 수 있고(Prisma migrate가 감싼다) 제약은 "같은 트랜잭션에서 그 값을 쓸 수 없다"뿐인데 여기서는 쓰지 않는다. 정렬 위치를 `schema.prisma` 선언 순서와 맞추려고 `AFTER`를 붙여 손으로 썼다(그냥 `ADD VALUE`만 하면 맨 뒤에 붙어 파일과 DB의 순서가 어긋난다). down은 **손실이 있다** — Postgres에 enum 값 삭제가 없어 타입을 다시 만들며, `skipped_no_pair` → `skipped_severity`, `skipped_circuit_open` → `failed`로 옮긴 뒤 10개짜리 타입으로 되돌린다(구분이 사라지는 것이 되돌리기의 본질이다. 다른 열·표는 그대로).

명령 (`apps/api`에서, Prisma 7 문법):

```bash
npx prisma validate
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script          # 초기 SQL 확인
npx prisma migrate deploy                     # 적용 (DATABASE_URL 필요)
npx prisma migrate status
npx ts-node prisma/seed.ts                    # 기본 설정값 (멱등)
# 다음 변경부터: 스키마 수정 → npx prisma migrate dev --name <이름> (로컬 DB 필요)
#   down SQL: npx prisma migrate diff --from-schema prisma/schema.prisma --to-schema <이전 스키마 사본> --script
```

되돌리기:

```bash
# 최신부터 역순으로
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924200000_alert_delivery_skip_reasons.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924180000_alerts.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924120000_control_plane_cost_column.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919150000_advisor_contract.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919120000_init.down.sql
```

init down SQL은 한 트랜잭션에서 모든 테이블·enum을 지우고 `_prisma_migrations`의 해당 기록을 삭제한다(다시 `migrate deploy` 가능). **데이터가 모두 삭제**되므로 필요하면 먼저 `pg_dump`.

검증 기록: PGlite(Postgres 17.5 엔진) + pglite-socket으로 `migrate deploy` → 시드 2회(멱등) → `migrate diff --from-config-datasource`(빈 결과 = drift 없음) → down SQL → 다시 `migrate deploy` 성공. 실제 Postgres 16(docker compose)에서는 아직 실행하지 않았다.
`20260919150000_advisor_contract`: init만 적용 → text steps 4종(평문·JSON 배열·JSON 객체·깨진 JSON) 삽입 → deploy(변환 확인) → drift 없음 → `budget_exceeded`·`stage_timings` 저장 → 시드 → down(텍스트 복원·`other` 변환, 이전 스키마와 drift 없음) → 재적용 → drift 없음 → `DB_IT_URL` 보존 통합 테스트 통과.
`20260919180000_advisor_limits_defaults`: 새 DB deploy(행 없음 → 변화 없음) → down → 옛 기본값 행(3/180) 삽입 → deploy(5/300, `timeoutSec` 600·`maxBudgetUsd` 2 유지) → down(3/180, 기록 삭제) → `maxTurns` 4로 바꾼 뒤 deploy(4 유지, 300만 변경) → drift 없음 → 시드(기존 행 유지) → 행 삭제 후 시드(5/300).
`20260924200000_alert_delivery_skip_reasons` (18개 확인 전부 통과): 추가 이전 DB 구성(기존 10개 상태를 하나씩 쓰는 발송 기록 10건 + 알림 10건 + `cost_rate_samples` + 시드) → deploy → **발송 기록 10건의 상태·시도 횟수·응답 코드·오류 메시지가 전부 그대로**(다른 표도 그대로) → enum 12개이고 **순서가 `schema.prisma` 선언과 일치** → 새 값 2개로 실제 저장 → 드리프트 없음 → down(`skipped_no_pair`→`skipped_severity`, `skipped_circuit_open`→`failed`, 나머지 10건은 무변경, enum 10개 복귀, 기록 삭제) → 재적용 → 드리프트 없음 → `migrate status` 최신. 배지 질의는 별도로 최악 상황(미확인 2,000건 중 1,990이 `resolved`)에서 네 가지 형태를 비교 측정했다(4절 표). **실제 Postgres 16 미검증**은 그대로다.

`20260924180000_alerts` (29개 확인 전부 통과): 알림 도입 이전 DB 구성(기존 3종 deploy + 시드 + `cost_rate_samples` 2행 + `advisor_runs` 1건 + 운영자가 손으로 바꾼 `retention.advisorRunMaxCount=77`) → 새 마이그레이션 deploy → **기존 행·합계·설정값 모두 그대로** → 표 4개·enum 5개 생성, `fillfactor` 70/85 적용 → drift 없음 → 시드 재실행(새 key `alerts`·`alerts.discord`만 추가, `retention` 77 유지, 비밀값 key 생성 안 함) → 제약 확인(발송 기록 채널당 1행, 상태 머신 키당 1행) → FK 동작 확인(부모 삭제 시 해제 알림 행 유지·연결 NULL, 발송 기록 CASCADE, 상태 머신 `open_alert_id` SET NULL) → **2,000건 삽입 후 배지 질의가 `alerts_data_source_acknowledged_at_severity_idx`로 Index Only Scan**(목록·키별 조회도 인덱스 사용) → heartbeat 단일 행 upsert → `purgeAlerts` 통합 테스트(`DB_IT_URL`) → down(표·enum·기록만 삭제, `data_source_mode`·설정·기존 데이터 유지) → 재적용 → drift 없음 → `migrate status` 최신. **실제 Postgres 16에서는 아직 실행하지 않았다**(이 PC에 Docker·psql 없음).
