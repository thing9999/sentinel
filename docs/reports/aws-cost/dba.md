# aws-cost · dba 작업 보고

## 2026-09-19 11:30 · 대시보드 자체 DB 스키마: 비용 저장소 (2단계 설계)

### 1. 요청 내용
- PM이 `/feature` 2단계(DBA)를 요청. 이 보고서는 **스키마 부분 중 aws-cost 관련**을 다룬다(공통 초기 마이그레이션·설정·시드 포함).
- 범위: 설정(경고 기준 오버라이드, 월 예산 등), 비용 스냅샷 이력(시간당 추정 소모율 시계열, Cost Explorer 결과 캐시와 조회 시각), 필요한 기타 저장소. Prisma 모델, 초기 마이그레이션 SQL, down SQL, 시드(기본 설정값만), 보존 정책·인덱스 근거 문서.
- 조건: 로컬에 Postgres 없음 → `prisma migrate diff`로 SQL 생성, `prisma validate`로 검증. `package.json` 수정 금지. datasource/generator 블록은 backend가 만든 Prisma 7 형식 유지(작업 중 PM 추가 지시).

### 2. 참고한 문서
- `CLAUDE.md` 확정된 결정 2번(Cost Explorer 캐시 6시간, 호출당 $0.01)
- `docs/specs/aws-cost.md` (0절 C4~C6·C9, 3.1, 3.5, 3.6, 4절 갱신 주기·보관, 5절 수용 기준, 7절 DBA 전달 사항)
- `docs/specs/cluster-status.md` (기준값 설정화: "기준값은 한곳에 모아 설정으로")
- `docs/reports/aws-cost/planner.md`, `docs/reports/bootstrap/backend.md`
- 기존 파일: `apps/api/prisma/schema.prisma`, `apps/api/prisma.config.ts`, `apps/api/src/database/prisma.service.ts`

### 3. 작업 내용
1. 명세 7절의 저장 대상을 테이블로 정리: CE 결과 캐시, 추정 소모율 5분 기록(90일), 단가 캐시(선택), CE 호출 로그(일일 상한 계산) + 공통 설정.
2. `schema.prisma`에 모델 추가(기존 generator `prisma-client`/CJS, datasource postgresql 블록은 그대로):
   - `Setting`(`settings`): key-value(jsonb). 월 예산·급증 기준·CE 설정·보존 기간 등.
   - `CostRateSample`(`cost_rate_samples`): 5분 소모율 기록 — 합계와 카테고리별(EC2/EBS/LB/EKS/IPv4) `numeric(14,6)`, 노드 수, 단가 없음 수, 리소스 요약 jsonb(급증 원인 비교). UNIQUE(`data_source`, `sampled_at`).
   - `CostExplorerCache`(`cost_explorer_cache`): 요청 키(sha256)당 최신 1건 upsert, 종류 enum, 기간(date), 지표, 상태(ok/error), 결과 jsonb, 반영 기준일, 조회·만료 시각.
   - `CostExplorerCallLog`(`cost_explorer_call_logs`): 실제 호출 1회당 1행 — 작업·트리거(scheduled/manual/startup)·성공·소요·추정 비용($0.01).
   - `PriceCache`(`price_cache`): Pricing API(24시간)·스팟 시세(1시간) 단가, 못 찾은 단가 음성 캐시(`found=false`).
   - 공통 enum `data_source_mode`(mock/live)로 mock 데이터가 live 중앙값·캐시를 오염시키지 않게 분리.
3. 초기 마이그레이션 생성(Prisma 7 문법): `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script -o prisma/migrations/20260919120000_init/migration.sql`, `migration_lock.toml` 추가.
4. down SQL 생성: `--from-schema ... --to-empty --script` 결과를 `BEGIN/COMMIT`으로 감싸고 `_prisma_migrations` 기록 삭제를 추가 → `docs/db/migrations/20260919120000_init.down.sql`.
5. 설정 기본값(`src/database/settings-defaults.ts`): 명세 기본값을 key별로 정의(`cost.budget`, `cost.spike`, `cost.explorer`, `cost.estimation`, `retention` 등), `mergeSetting()` 제공.
6. 시드(`prisma/seed.ts`): settings 기본값만 `INSERT ... ON CONFLICT DO NOTHING`(멱등, 기존 값 보존). Prisma 생성 클라이언트는 `.js` 확장자 import 때문에 ts-node로 직접 실행이 안 돼서 `pg`를 사용.
7. 보존 정리(`src/database/retention.ts`): `purgeExpiredData()`(소모율 90일, CE 캐시 35일, 호출 로그 90일, 만료 단가 7일 + 어드바이저), `computeRetentionCutoffs()`(순수).
8. `docs/db/schema.md`: 테이블·컬럼, settings key 목록, 보존 정책, 인덱스 근거, 마이그레이션 명령.
9. 검증: `prisma validate`에 더해, `prisma` 의존성에 들어 있는 PGlite(Postgres 17.5 엔진) + pglite-socket으로 임시 wire 서버를 띄워 `migrate deploy` → 시드 2회 → drift 확인 → down → 재적용, Prisma 클라이언트로 보존 정리 통합 테스트까지 실행.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 수정 | 모델 7개·enum 11개 추가 (generator/datasource 블록 유지) |
| `apps/api/prisma/migrations/20260919120000_init/migration.sql` | 추가 | 초기 마이그레이션 |
| `apps/api/prisma/migrations/migration_lock.toml` | 추가 | provider = postgresql |
| `apps/api/prisma/seed.ts` | 추가 | settings 기본값 시드 (pg, 멱등) |
| `apps/api/src/database/settings-defaults.ts` | 추가 | 설정 key별 기본값, `mergeSetting()` |
| `apps/api/src/database/retention.ts` | 추가 | 보존 정리, 중단된 어드바이저 실행 정리 |
| `apps/api/src/database/retention.spec.ts` | 추가 | 단위 + 통합(`DB_IT_URL` 있을 때만) 테스트 |
| `docs/db/migrations/20260919120000_init.down.sql` | 추가 | 되돌리기 SQL |
| `docs/db/schema.md` | 추가 | 스키마·보존·인덱스 문서 |
| `apps/api/src/database/generated/**` | 재생성 | `prisma generate` 결과 (gitignore) |

### 5. 주요 결정과 이유
- **CE 캐시는 요청 키당 최신 1건(upsert)** / 대안: 호출마다 이력 누적 / 이유: 명세는 "캐시와 조회 시각"만 요구, 일별 추이는 결과 자체에 들어 있다. 호출 이력은 별도 호출 로그가 담당.
- **CE 오류 결과도 캐시** / 이유: 권한 없음·CE 미활성화 상태에서 매 주기 재호출하면 호출 수만 늘어난다(수용 기준 "재호출하지 않는다").
- **호출 로그를 캐시와 분리** / 이유: 일일 상한(40회)·수동 새로고침 1시간 제한·이번 달 CE 비용은 "호출 사실" 기준이어야 하고, 실패 호출도 과금된다.
- **소모율은 카테고리별 컬럼 + 리소스 요약 jsonb** / 대안: 리소스별 정규화 테이블 / 이유: 급증 판단(중앙값)은 합계 컬럼만 쓰고, 원인 목록은 기준 시점 한 행과 현재를 비교하면 된다. 90일 × 288행이라 정규화 이득이 작다.
- **금액은 `numeric`** / 이유: float 누적 오차 방지, 배분 합계 = 소모율 합계(±$0.01) 수용 기준.
- **`data_source` 분리** / 이유: mock 모드에서 쌓인 값이 live 전환 후 7일 중앙값을 오염시키지 않게.
- **설정은 key-value jsonb** / 대안: 설정별 컬럼 테이블 / 이유: 편집 UI가 범위 밖이고 기준값이 기능마다 계속 늘어난다. 모양은 TS(`settings-defaults.ts`)로 고정.
- **시드는 pg로** / 대안: Prisma 클라이언트 + tsx / 이유: 생성 클라이언트가 `.js` 확장자로 import해 ts-node(CJS)에서 해석 불가, tsx 설치는 `package.json` 수정이 필요.
- **enum은 Postgres enum 타입** / 이유: 값 제약을 DB가 보장. 값 추가는 `ALTER TYPE ... ADD VALUE` 마이그레이션(PG16은 트랜잭션 안에서 가능).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npx prisma validate` | 통과 | Prisma 7.10.0 |
| `npx prisma format` | 통과 | |
| `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` | 생성됨 | `migration.sql` |
| `npx prisma migrate diff --from-schema prisma/schema.prisma --to-empty --script` | 생성됨 | down SQL 원본 |
| `npx prisma generate` | 통과 | `src/database/generated/prisma` |
| PGlite 서버 + `npx prisma migrate deploy` | 통과 | Postgres 17.5 엔진 |
| `npx ts-node prisma/seed.ts` 2회 | 통과 | 1회차 9건 추가, 2회차 0건 추가(멱등) |
| `npx prisma migrate status` | 통과 | "Database schema is up to date" |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | 빈 마이그레이션 | 적용된 DB와 스키마 사이 drift 없음 |
| down SQL 실행 → `migrate deploy` 재실행 | 통과 | 테이블·enum 0개, `_prisma_migrations` 기록 삭제 확인 후 재적용 |
| `DB_IT_URL=... NODE_OPTIONS=--experimental-vm-modules npx jest src/database/retention.spec.ts` | 통과 (2건) | 소모율 90일 정리, 어드바이저 50건/90일, 실행 중 보존 |
| `npx eslint "src/database/**/*.ts"`, `npx tsc --noEmit` | 통과 | |
| `NODE_OPTIONS=--experimental-vm-modules npx jest` (전체) | 통과 (41건, 1 skip) | skip = DB 통합 테스트 |
| 실제 Postgres 16(docker compose `db`)에서 적용 | **건너뜀** | 로컬에 Docker 없음. PGlite(17.5)로 대체 |
| `npx prisma db seed` | **건너뜀** | `prisma.config.ts`에 seed 명령 미등록(backend 파일). 직접 실행으로 대체 |

### 7. 남은 이슈·한계
- 실제 Postgres 16에서 마이그레이션을 적용해 보지 않았다(PGlite는 17.5). 사용한 기능(enum, jsonb, text[], timestamptz, numeric)은 16과 차이 없음.
- CE 결과 `result` jsonb의 모양은 backend의 정규화 형식에 맡겼다(DB는 형식 무관).
- `cost_rate_samples.resources` 크기에 따라 90일 용량이 수십~100MB가 될 수 있다. 노드 수백 대 규모면 요약을 줄이거나 보존 기간 조정.
- 일일 호출 상한의 "하루" 기준 시간대는 backend가 정해야 한다(UTC 권장, Cost Explorer도 UTC 날짜).

### 8. 다른 담당 요청
- `backend 요청`: `apps/api/prisma.config.ts`에 시드 등록 — `migrations: { path: 'prisma/migrations', seed: 'ts-node prisma/seed.ts' }` (그러면 `npx prisma db seed`가 동작).
- `backend 요청`: `package.json`에 편의 스크립트(선택): `"prisma:migrate": "prisma migrate deploy"`, `"db:seed": "ts-node prisma/seed.ts"`. `Dockerfile.dev`/compose에서 api 시작 전 `prisma migrate deploy && ts-node prisma/seed.ts` 실행 여부 결정.
- `backend 요청`: `.env.example`에 `COST_MONTHLY_BUDGET_USD=`(비우면 예산 숨김) 등 명세의 비용 설정 항목. DB 설정과의 우선순위는 "env(명시) > settings 테이블 > 코드 기본값" 권장.

### 9. 다음 담당이 알아야 할 점 (backend)
- 생성 클라이언트: `import { PrismaClient, Prisma } from '../database/generated/prisma/client'`, 서비스는 기존 `PrismaService`(전역, 연결 실패 시 경고만 — `isConnected` 확인 후 사용, DB 없으면 메모리 캐시로 대체).
- 마이그레이션 적용: `cd apps/api && npx prisma migrate deploy && npx ts-node prisma/seed.ts`. 되돌리기: `psql "$DATABASE_URL" -f docs/db/migrations/20260919120000_init.down.sql`.
- 설정 읽기: `const row = await prisma.setting.findUnique({ where: { key: 'cost.budget' } }); const v = mergeSetting('cost.budget', row?.value);` → env가 있으면 env 우선.
- 소모율 기록(5분): `prisma.costRateSample.create({ data: { dataSource, sampledAt: <5분 경계로 내린 시각>, totalUsdPerHour, ec2UsdPerHour, ..., nodeCount, unpricedCount, resources } })`. 같은 시각 재기록은 P2002 → 무시하거나 `upsert`(where `dataSource_sampledAt`).
- 7일 중앙값: `prisma.$queryRaw\`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total_usd_per_hour) AS median, min(sampled_at) AS first FROM cost_rate_samples WHERE data_source = ${ds}::data_source_mode AND sampled_at >= now() - interval '7 days'\`` (first가 24시간 이전이 아니면 "기준 수집 중").
- CE 캐시: `requestKey = sha256(JSON.stringify(정렬된 요청 파라미터))`. 조회 `findUnique({ where: { dataSource_requestKey: { dataSource, requestKey } } })` → `expiresAt > now`면 사용. 갱신 `upsert`. 오류도 `status: 'error'`로 저장(만료는 짧게).
- CE 호출 로그: 실제 AWS 호출마다(실패 포함) `costExplorerCallLog.create`. 오늘 호출 수 `count({ where: { calledAt: { gte: todayStartUtc } } })`, 마지막 수동 `findFirst({ where: { trigger: 'manual' }, orderBy: { calledAt: 'desc' } })`. mock 모드는 기록하지 않는다.
- 단가 캐시: `priceCache.upsert({ where: { source_region_productKey: {...} } })`, 못 찾으면 `found: false, usdPerUnit: null`.
- Decimal 컬럼은 Prisma `Decimal`(decimal.js)로 온다 → 계산 전 `.toNumber()` 또는 Decimal 연산.
- 보존 정리: 하루 1회 + 시작 시 `purgeExpiredData(prisma, new Date(), mergeSetting('retention', row?.value))`.
- 자세한 컬럼·인덱스: `docs/db/schema.md`.
