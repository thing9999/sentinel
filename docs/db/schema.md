# 대시보드 자체 DB 스키마 (Prisma)

- 작성: dba, 2026-09-19
- DB: Postgres 16 (로컬: docker compose `db` 서비스, 이름·계정 `dashboard`)
- ORM: Prisma 7.10.0 (`apps/api/prisma/schema.prisma`, URL은 `apps/api/prisma.config.ts`의 `DATABASE_URL`)
- 생성 클라이언트: `apps/api/src/database/generated/prisma` (gitignore, import `./generated/prisma/client`)
- 근거 명세: `docs/specs/aws-cost.md`(4절, 7절 DBA), `docs/specs/architecture-advisor.md`(0절 D5, 7절 DBA), `docs/specs/cluster-status.md`(기준값 설정화)
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
| `cost.spike` | 소모율 급증(7일 중앙값 ×1.3 & +$0.5/h, ×2.0 & +$1/h), 일별 급증(×1.3 & +$5, ×2.0 & +$10) |
| `cost.explorer` | 지표(UnblendedCost), 캐시 6시간, 수동 새로고침 1시간, 일일 호출 상한 40, 호출당 $0.01, 태그 필터 |
| `cost.estimation` | 리소스 갱신 5분, 소모율 기록 5분, Pricing 24시간, 스팟 1시간, 730시간/월 |
| `advisor.limits` | 지연 `slowAfterSec` 300초, 시간 초과 600초, 브리지 확인 30초/3초, 워크로드 300·노드 100, 결과 신선도 7일, 비용 상한 `maxBudgetUsd` 2.0 USD, `maxTurns` 5 (API 계약 B.5, PM 결정 2026-09-19로 3→5·180→300) |
| `advisor.prechecks` | 사전 점검 기준값 (R-RESTART 5회, R-OVERREQ 20%, R-NODEIDLE 30%, R-UNALLOC 40% 등) |
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
| `ec2_usd_per_hour`, `ebs_…`, `lb_…`, `eks_…`, `ipv4_…` | numeric(14,6) | 카테고리별 |
| `node_count` | int | 노드 수 |
| `unpriced_count` | int | 단가 없음으로 빠진 리소스 수 |
| `resources` | jsonb | `[{kind, key, type, option, az, usdPerHour}]` — 급증 원인(기준 시점 대비 새로 생긴/바뀐 리소스) 비교용 |
| `created_at` | timestamptz | |

- UNIQUE(`data_source`, `sampled_at`): 같은 시각 중복 기록 방지(재시작 직후 등). backend는 `sampled_at`을 5분 경계로 내려 쓰기를 권장(예: 12:05:00).
- 7일 중앙값: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total_usd_per_hour) FROM cost_rate_samples WHERE data_source=$1 AND sampled_at >= now() - interval '7 days'` (최대 2,016행).
- 기준 수집 중 판단: 같은 조건에서 `min(sampled_at)`이 24시간 이전인지.
- 용량: 90일 × 288건 = 25,920행. `resources`가 행당 수 KB면 수십~100MB 수준.

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

## 3. 데이터 보존 정책

| 테이블 | 보존 | 근거 | 정리 기준 |
|---|---|---|---|
| `cost_rate_samples` | **90일** | aws-cost 4절 "5분 간격 저장, 90일 보관". 급증 판단은 7일만 쓰지만 추이 확인용 | `sampled_at < now - 90d` |
| `cost_explorer_cache` | 조회 후 **35일** | 요청 키당 최신 1건이라 커지지 않음. 월이 바뀌며 남는 옛 키(지난달 기간 등)만 정리 | `fetched_at < now - 35d` |
| `cost_explorer_call_logs` | **90일** | 일일 상한·이번 달 CE 비용 계산에 최대 31일 필요. 호출 추이 확인용 여유 | `called_at < now - 90d` |
| `price_cache` | 만료 후 **7일** | 만료된 단가도 조회 실패 시 참고 가능하게 잠시 유지 | `expires_at < now - 7d` |
| `advisor_runs` (+ `advisor_suggestions` CASCADE) | **최근 50건 또는 90일** 중 먼저 닿는 쪽 | architecture-advisor 가정 D5. (PM 예시의 180일이 아니라 **명세 값을 따름**, 바꾸려면 `retention.advisorRunDays`) | `requested_at < now - 90d` 또는 최신순 51번째부터, **`active_lock IS NULL`인 것만** |
| `settings` | 영구 | | - |

- 정리 함수: `apps/api/src/database/retention.ts`의 `purgeExpiredData(prisma, now?, policy?)`. backend가 **하루 1회**(예: 04:00, `@nestjs/schedule`)와 API 시작 시 호출한다. 반환값은 테이블별 삭제 건수.
- 보존 기간은 `settings.retention`으로 바꿀 수 있다(`mergeSetting('retention', row.value)`를 policy로 넘김).
- 삭제는 모두 인덱스 범위 삭제다. 이 규모(수만 행)에서는 배치 분할이 필요 없다. 삭제 후 autovacuum이 공간을 회수한다(별도 VACUUM 불필요).

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

의도적으로 만들지 않은 것: JSONB GIN 인덱스(스냅샷·결과 내부 검색 요구 없음), `advisor_suggestions (category, severity)`(한 실행 안에서 수십 건이라 필터는 메모리로 충분).

## 5. 마이그레이션

| 이름 | 파일 | 되돌리기 |
|---|---|---|
| `20260919120000_init` | `apps/api/prisma/migrations/20260919120000_init/migration.sql` | `docs/db/migrations/20260919120000_init.down.sql` |
| `20260919150000_advisor_contract` | `apps/api/prisma/migrations/20260919150000_advisor_contract/migration.sql` | `docs/db/migrations/20260919150000_advisor_contract.down.sql` |
| `20260919180000_advisor_limits_defaults` | `apps/api/prisma/migrations/20260919180000_advisor_limits_defaults/migration.sql` | `docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql` |

`20260919150000_advisor_contract` (API 계약 3단계): `advisor_failure_reason`에 `budget_exceeded` 추가(`interrupted` 앞), `advisor_runs.stage_timings jsonb NULL` 추가, `advisor_suggestions.steps` text → jsonb. steps는 Prisma 기본 SQL(DROP+ADD, 기존 행이 있으면 실패)을 손으로 고쳐 `USING` 변환한다: 유효한 JSON 배열 문자열은 그대로, 그 외는 `[{"text": <원문>, "code": null}]`. down은 `budget_exceeded` → `other`, `stage_timings` 삭제, steps를 텍스트(단계 사이 빈 줄, 코드는 ``` 블록)로 합친다 — 손실 있음.

`20260919180000_advisor_limits_defaults` (데이터만, 스키마 변경 없음): settings `advisor.limits`에서 `maxTurns`가 정확히 3이면 5로, `slowAfterSec`가 정확히 180이면 300으로 필드별로 올린다. 다른 값(운영자 설정)·행 없음은 그대로. down은 5→3, 300→180으로 되돌린다 — 마이그레이션 뒤 운영자가 일부러 5/300으로 둔 값도 구분할 수 없어 함께 되돌려진다.

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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919150000_advisor_contract.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260919120000_init.down.sql
```

init down SQL은 한 트랜잭션에서 모든 테이블·enum을 지우고 `_prisma_migrations`의 해당 기록을 삭제한다(다시 `migrate deploy` 가능). **데이터가 모두 삭제**되므로 필요하면 먼저 `pg_dump`.

검증 기록: PGlite(Postgres 17.5 엔진) + pglite-socket으로 `migrate deploy` → 시드 2회(멱등) → `migrate diff --from-config-datasource`(빈 결과 = drift 없음) → down SQL → 다시 `migrate deploy` 성공. 실제 Postgres 16(docker compose)에서는 아직 실행하지 않았다.
`20260919150000_advisor_contract`: init만 적용 → text steps 4종(평문·JSON 배열·JSON 객체·깨진 JSON) 삽입 → deploy(변환 확인) → drift 없음 → `budget_exceeded`·`stage_timings` 저장 → 시드 → down(텍스트 복원·`other` 변환, 이전 스키마와 drift 없음) → 재적용 → drift 없음 → `DB_IT_URL` 보존 통합 테스트 통과.
`20260919180000_advisor_limits_defaults`: 새 DB deploy(행 없음 → 변화 없음) → down → 옛 기본값 행(3/180) 삽입 → deploy(5/300, `timeoutSec` 600·`maxBudgetUsd` 2 유지) → down(3/180, 기록 삭제) → `maxTurns` 4로 바꾼 뒤 deploy(4 유지, 300만 변경) → drift 없음 → 시드(기존 행 유지) → 행 삭제 후 시드(5/300).
