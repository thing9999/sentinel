# kops-support · DBA 작업 보고

> 파일 위치: `docs/reports/kops-support/dba.md`
> 같은 기능에서 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다.

## 2026-09-24 07:05 · 비용 기록 컬럼 kOps 전환 (`eks_usd_per_hour` → `control_plane_usd_per_hour`)

### 1. 요청 내용

PM이 넘긴 범위(명세 7절 "역할별 전달 사항 > DBA", 수용 기준 **AC-KOPS34**):

1. `cost_rate_samples.eks_usd_per_hour` → `control_plane_usd_per_hour` 마이그레이션. **기존 행을 지우지 않는다**(급증 판단의 7일 중앙값·90일 추이 기준선). 컬럼 드롭+재생성이 아니라 **값이 보존되는 이름 변경**이어야 한다.
2. EKS 컨트롤 플레인 "관리 요금"과 kOps 컨트롤 플레인 "실비"는 성격이 다른 금액이다. 과거 행 값을 새 정의와 어떻게 다룰지 판단하고 근거를 남긴다. 전환 시점 오탐(급증/급감)을 막을 방법이 있으면 제안한다. **스키마를 크게 늘리지 않는다.**
3. `docs/db/schema.md`의 환경 문구(EKS 기준)와 컬럼 설명 갱신.
4. 마이그레이션이 실제로 도는지, 기존 행이 보존되는지 검증하고 방법·결과를 남긴다.

범위 밖(건드리지 않음): 모니터링 대상 Postgres(모니터링 계정·상태 조회 쿼리·`docs/db/health.md`), 다른 스키마 변경, `apps/api/src/cost/**` 등 백엔드 영역.

### 2. 참고한 문서

- `docs/specs/kops-support.md` — 1.2(EKS↔kOps 차이), 3.5(비용 모델 재정의: 카테고리 `eks` → `controlPlane`, 하위 종류 `master_ec2`·`etcd_ebs`·`master_root_ebs`·`api_lb`·`master_ipv4`), 5절 P4 수용 기준(AC-KOPS27~35, 특히 **AC-KOPS34**), 7절 DBA
- `docs/reports/kops-support/README.md` — PM 결정 기록(D1~D9, 사용자 결정 Q1~Q9, "planner → dba: 기존 행 보존 필수")
- `docs/reports/kops-support/planner.md` — DBA 요청 원문
- `docs/db/schema.md`(2.2·3·4·5절), `apps/api/prisma/schema.prisma`, 기존 마이그레이션 3종과 down SQL(특히 `20260919150000_advisor_contract`의 손으로 고친 SQL 선례, `20260919180000_advisor_limits_defaults`의 데이터 마이그레이션 선례)
- 읽기만 한 백엔드 코드(영향 파악용): `apps/api/src/cost/store/cost-store.ts`, `apps/api/src/cost/status/cost-status.ts`, `apps/api/src/cost/cost.service.ts`, `apps/api/src/cost/estimate/allocation.ts`, `apps/api/src/cost/cost.types.ts`

### 3. 작업 내용

**(1) 마이그레이션 `20260924120000_control_plane_cost_column`** — 세 단계, 모두 한 트랜잭션.

1. `ALTER TABLE cost_rate_samples RENAME COLUMN eks_usd_per_hour TO control_plane_usd_per_hour;`
   Prisma가 필드 이름 변경에 기본으로 만드는 SQL은 `DROP COLUMN` + `ADD COLUMN`(값 소실)이라 **쓰지 않고 손으로 RENAME을 썼다**. 행·값·인덱스·UNIQUE 제약을 하나도 건드리지 않는다.
2. 같은 행의 `resources` jsonb 안 `kind: 'eks'` → `'controlPlane'`. **금액(`usdPerHour`)과 배열 순서는 그대로**다. 열 이름만 바꾸면 한 행 안에서 금액 열(`control_plane_usd_per_hour`)과 `resources[].kind='eks'`가 어긋나 화면이 모르는 카테고리를 만난다.
3. settings `cost.spike.rate.baselineFrom`에 **적용 시각(UTC ISO8601)**을 기록(값이 없거나 `null`일 때만 — 운영자가 넣어 둔 값은 덮어쓰지 않음). 전환 앞뒤 표본을 한 기준선으로 섞지 않기 위한 표시다(5절 결정 C 참고).

**(2) 되돌리기 SQL** `docs/db/migrations/20260924120000_control_plane_cost_column.down.sql` — 열 이름 복원(값 보존), `resources[].kind` 복원, `baselineFrom` 제거, `_prisma_migrations` 기록 삭제. `kind` 복원은 **전환 이전에 생긴 행만**(`created_at < 마이그레이션 finished_at`, 기록이 없으면 `now()`) 대상으로 한다 — 전환 이후 행의 `controlPlane`은 kOps 실비라 `eks`로 되돌리면 뜻이 틀려지기 때문이다.

**(3) `apps/api/prisma/schema.prisma`** — 필드 `eksUsdPerHour` → `controlPlaneUsdPerHour @map("control_plane_usd_per_hour")`. 새 정의와 "전환 이전 행은 옛 정의"라는 사실을 `///` 주석으로 남겼다. 필드 위치는 물리 컬럼 순서(RENAME이라 자리가 그대로)와 맞추려고 원래 자리를 유지했다. `prisma format` + `prisma validate` + `prisma generate` 완료.

**(4) `apps/api/src/database/settings-defaults.ts`** — `cost.spike.rate`에 `baselineFrom: null as string | null` 추가(기준선 표본 하한 시각, `null`이면 제한 없음 = 지금 동작 그대로). 새 DB는 시드가 `null`로 넣고, 기존 DB는 위 마이그레이션 3단계가 전환 시각을 넣는다(`mergeSetting`은 얕은 병합이라 중첩 객체 `rate`는 통째로 교체된다 → 코드 기본값만 바꾸면 기존 행에 반영되지 않아 데이터 마이그레이션이 필요하다).

**(5) `docs/db/schema.md`** — ① 머리말에 대상 환경 줄 추가(**kOps 클러스터(컨트롤 플레인도 사용자 소유 EC2) + 모니터링 대상 Postgres는 클러스터 안 StatefulSet**), ② 2.2 컬럼 표의 `eks_…` → `control_plane_…`, ③ 2.2에 **"정의가 바뀐 열"** 항목 신설(보존 이유, 과거 값의 의미, 합계 불변식, `baselineFrom`, 추이 그래프의 계단), ④ settings key 표의 `cost.spike`에 `rate.baselineFrom` 명시, ⑤ 5절 마이그레이션 표·설명·되돌리기 명령에 새 마이그레이션 추가.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/prisma/migrations/20260924120000_control_plane_cost_column/migration.sql` | 추가 | RENAME COLUMN + `resources[].kind` 이름 변경 + `cost.spike.rate.baselineFrom` 기록 |
| `docs/db/migrations/20260924120000_control_plane_cost_column.down.sql` | 추가 | 되돌리기(열·kind 복원, baselineFrom 제거, 마이그레이션 기록 삭제) |
| `apps/api/prisma/schema.prisma` | 수정 | `CostRateSample.eksUsdPerHour` → `controlPlaneUsdPerHour`(+ 정의 변경 주석) |
| `apps/api/src/database/settings-defaults.ts` | 수정 | `cost.spike.rate.baselineFrom`(기본 `null`) 추가 |
| `docs/db/schema.md` | 수정 | 대상 환경 문구(kOps), 컬럼 표, "정의가 바뀐 열" 신설, settings 표, 5절 마이그레이션 목록·설명·되돌리기 명령 |

생성물(gitignore): `apps/api/src/database/generated/prisma` 재생성.

### 5. 주요 결정과 이유

**결정 A. DROP+ADD가 아니라 RENAME COLUMN.**
대안 ① Prisma `migrate dev`가 만드는 기본 SQL(DROP+ADD) → 과거 값이 전부 `0`이 되어 급증 판단의 7일 기준선과 90일 추이가 무너진다(AC-KOPS34 위반). 대안 ② 새 열 추가 후 `UPDATE`로 복사하고 옛 열 드롭 → 결과는 같지만 대용량 UPDATE + 테이블 재작성이 생기고 중간 상태가 늘어난다. **RENAME은 카탈로그만 바꾸는 즉시 연산**이고 값·인덱스·UNIQUE가 그대로 살아 있어 가장 안전하다. `20260919150000_advisor_contract`에서 Prisma 기본 SQL을 손으로 고친 선례가 이미 있다.

**결정 B. 과거 행의 값을 0으로 밀거나 지우지 않는다.**
- 지우면 기준선이 끊긴다(요청의 핵심 금지사항).
- 0으로 밀면 **행 단위 합계 불변식 `total = ec2 + ebs + lb + controlPlane + ipv4`가 깨진다.** 지금 모든 행에서 이 식이 성립하고, `aws-cost` 5절의 "배분 합계 = 추정 소모율 합계" 수용 기준과 화면의 카테고리 표가 이 불변식에 기대고 있다. 과거 `total`에는 EKS 관리 요금이 실제로 포함돼 있었으므로 그 금액을 지우려면 `total`도 함께 바꿔야 하는데, 그것은 과거 기록의 위조다.
- 과거 행을 새 정의로 다시 계산하는 것도 불가능하다(그 시점에는 마스터 EC2·etcd 볼륨이 존재하지 않았다).
→ **값은 그대로 두고, "이 열은 전환 시점 앞뒤로 의미가 다르다"를 문서·스키마 주석·설정 값으로 명시**하는 쪽을 택했다.

**결정 C. 오탐(전환 시점의 가짜 급증·급감) 대책 = 기준선 하한 시각 한 줄.**
급증 판단은 `total_usd_per_hour`의 7일 중앙값을 쓴다(`cost-status.ts` `computeRateBaseline`). EKS 관리 요금(클러스터당 $0.10/h 고정)과 kOps 컨트롤 플레인 실비(마스터 EC2 3대 + etcd 볼륨 6개 + API LB ≈ $0.29/h, 명세 S4 예시)는 성격이 다른 금액이라, 전환 앞뒤 표본을 한 중앙값에 섞으면 **아무 일도 없었는데 최대 7일 동안 급증/급감 판정이 흔들린다.**
- 검토한 대안 ① 열을 하나 더 만들어 전환 전후를 분리 → 스키마가 늘고, 모든 조회가 두 열을 합쳐야 한다. 요청의 "스키마를 크게 늘리지 마라"에 어긋난다.
- 대안 ② 행에 "정의 버전" 컬럼 추가 → 역시 스키마 증가. 게다가 판단 로직이 버전 분기를 계속 안고 가야 한다.
- 대안 ③ 급증 판단을 그냥 며칠 꺼 둔다 → 사람이 다시 켜는 것을 잊는다.
- **채택: settings `cost.spike.rate.baselineFrom`(ISO8601 UTC, 기본 `null`)**. 스키마 변경 0, 새 테이블·열 0. 마이그레이션이 적용 시각을 넣어 두면 backend는 기준선 표본을 `sampled_at >= baselineFrom`으로만 잡는다. 전환 직후 24시간(`minBaselineHours`)은 기준선이 **"수집 중"**이 되는데, 이는 가짜 급증 경보보다 정직한 상태다. 값이 `null`이면 지금과 완전히 같게 동작하므로 backend가 아직 반영하지 않아도 **깨지는 것이 없다**(다만 반영 전까지는 오탐 방지 효과도 없다 — 8절 요청 5).
- 일별 급증(`cost.spike.daily`)에는 손대지 않았다. 그쪽은 Cost Explorer의 실제 청구액이고, 전환으로 실제 요금 구조가 바뀐 것은 숨길 일이 아니다.

**결정 D. `resources` jsonb의 `kind`도 함께 바꾼다.**
열 이름만 바꾸면 같은 행 안에서 금액 열과 리소스 요약의 카테고리 이름이 어긋난다. 급증 원인 비교(`pickCausesBaseline`)와 내역 표가 `kind`로 라벨을 찾으므로, 옛 `'eks'`가 남으면 화면에 "모르는 카테고리"가 생긴다. 금액·키·순서는 건드리지 않고 **문자열 하나만** 바꿨다(최대 25,920행 전량 재작성이지만 1회성, 이 규모에서는 문제 없음).

**결정 E. 90일 추이 그래프의 계단은 그대로 둔다.**
`total_usd_per_hour`는 전환 시점에 실제로 값이 달라진다(관리 요금 소멸 + 마스터 실비 등장). 이것은 진짜 변화이므로 데이터로 감추지 않고, 화면 안내 문구로 설명할 일이다(backend·frontend 몫 — 8절).

### 6. 검증 결과

로컬에 Docker·psql이 없어(`docker`, `psql` 모두 PATH에 없음) **PGlite(Postgres 17.5 엔진) + pglite-socket**으로 검증했다. 기존 마이그레이션 검증과 같은 방식이다(`docs/db/schema.md` 5절 검증 기록). 포트는 지시대로 **3111**을 썼고, 검증 프로세스는 스크립트가 끝나면서 자기 자신만 종료한다(별도 서버·PID 남기지 않음, 이미지 이름 일괄 종료 없음).

시나리오: ① 새 마이그레이션을 잠시 빼고 `migrate deploy` + 시드로 **전환 이전 DB**를 만든다 → ② 옛 정의 표본 4건 삽입(live 3 + mock 1, `eks_usd_per_hour = 0.1`, `resources`에 `kind:'eks'`) → ③ 새 마이그레이션 `migrate deploy` → ④ 보존·변환 확인 → ⑤ 전환 이후(kOps) 행 1건 추가 → ⑥ down SQL → ⑦ 재적용.

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `prisma migrate deploy` (전환 이전 3종) → `ts-node prisma/seed.ts` | 성공 | 기준 상태 구성 |
| `prisma migrate deploy` (새 마이그레이션) | 성공 | 4 migrations applied |
| 행 수 보존 | **통과** | 4행 → 4행 |
| `eks_usd_per_hour` 값이 `control_plane_usd_per_hour`에 그대로 | **통과** | 행별 값·`total` 모두 동일 |
| 행 합계 `total = ec2+ebs+lb+controlPlane+ipv4` | **통과** | 전 행 |
| `resources[].kind` `'eks'` → `'controlPlane'` (금액·순서·key 유지) | **통과** | 배열 순서 `i-1, eks:cluster, ip-1` 그대로 |
| 옛 열(`eks_usd_per_hour`) 없음 | **통과** | `information_schema.columns` |
| `cost.spike.rate.baselineFrom` 기록 | **통과** | 예: `2026-09-23T22:00:14.170Z`(UTC) |
| `cost.spike`의 다른 값 유지 | **통과** | `baselineDays` 7, `warnRatio` 1.3, `daily.critAbsUsd` 10 |
| `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | **드리프트 없음** | `-- This is an empty migration.` |
| 시드 재실행(멱등) 후 `baselineFrom` 유지 | **통과** | 시드가 덮어쓰지 않음 |
| down SQL 실행 (`docs/db/migrations/…down.sql`) | 성공 | 행 5건 그대로(전환 이후 행 포함) |
| down: 열 이름·값 복원 / 전환 이전 행 `kind:'eks'` 복원 | **통과** | |
| down: 전환 **이후** 행은 `kind:'controlPlane'` 유지 | **통과** | `created_at < finished_at` 필터가 의도대로 동작 |
| down: `baselineFrom` 제거 / 마이그레이션 기록 삭제 | **통과** | 다시 `migrate deploy` 가능 |
| 재적용 후 행 수·값 유지, 드리프트 없음 | **통과** | 5행, `sum(control_plane_usd_per_hour) = 0.69` |
| `prisma migrate status` | `Database schema is up to date!` | |
| `prisma format` / `validate` / `generate` | 성공 | 클라이언트 재생성 |
| `npx tsc -p tsconfig.json --noEmit` (apps/api) | 성공(에러 0) | **주의**: 타입 검사가 `cost-store.ts`의 옛 컬럼 사용을 못 잡는다 — 8절 요청 1 |
| `jest database cost` (apps/api) | 12 suites / 157 passed, 1 skipped | |
| `eslint src/database/settings-defaults.ts` | 통과 | |

검증 자동화 스크립트는 세션 스크래치패드(`…/scratchpad/verify-cp-migration.cjs`)에 있고 저장소에는 넣지 않았다. 18개 확인 항목 전부 통과(18/18).

**하지 않은 검증(그대로 적는다)**
- **실제 Postgres 16(docker compose `db`)에서는 실행하지 못했다.** 이 환경에 Docker·psql이 없다. 쓴 문법(`ALTER TABLE … RENAME COLUMN`, `jsonb_agg`/`jsonb_array_elements … WITH ORDINALITY`, `jsonb_set`, `#-`, `@>`)은 모두 Postgres 9.5~12 이후 기능이라 16에서 문제될 것이 없지만, **실기 검증은 backend나 PM이 로컬 `docker compose up` 때 `npm run db:migrate --prefix apps/api` 한 번으로 확인해 주기 바란다**(요청 6).
- 대용량(90일 = 25,920행) 상태에서의 2단계 `resources` 재작성 소요 시간은 재지 않았다. 4행 기준 즉시 끝났다.
- 백엔드 코드(`src/cost/**`)는 내 영역이 아니라 고치지 않았으므로, "실제 API가 새 컬럼에 값을 기록하는지"는 검증 범위 밖이다(요청 1이 처리돼야 확인 가능).

### 7. 남은 이슈·한계

1. **전환 이전 행의 `control_plane_usd_per_hour`는 옛 정의(EKS 관리 요금)다.** 값은 살아 있지만 의미가 다르다. 5절 결정 B·C대로 문서화 + `baselineFrom`으로 기준선을 끊는 방식으로 다뤘다. 90일 추이 그래프에는 전환 시점 계단이 그대로 보인다(의도).
2. **`baselineFrom`은 backend가 반영해야 효과가 난다.** 지금은 DB에 값만 들어 있고 아무도 읽지 않는다(요청 5).
3. **down SQL의 한계 2가지**: ① 전환 이후 행은 `resources[].kind`가 `controlPlane`인 채 열 이름만 `eks_usd_per_hour`로 돌아간다(테이블 전체가 함께 돌아가므로 불가피). 배포 직후 롤백이면 그런 행이 거의 없어 실질 손실이 없다. ② `baselineFrom`은 운영자가 나중에 바꾼 값과 구분할 수 없어 **무조건 지운다**(`20260919180000_advisor_limits_defaults` down과 같은 성격의 한계).
4. 명세 7절이 가리킨 **`docs/db/schema.md:35`의 "환경: EKS + 클러스터 안의 Postgres" 문구는 실제로 존재하지 않았다.** 파일 전체에서 `EKS`는 `eks_…` 컬럼 이름 한 곳뿐이었다(줄 번호가 오래된 참조로 보인다). 요청 의도대로 **머리말에 대상 환경 줄을 새로 추가**해 kOps 기준임을 못 박았다. planner가 줄 번호를 인용할 때 참고 바란다.
5. 모니터링 대상 DB 쪽(`docs/db/health.md`, `docs/db/monitor-account.sql`, `apps/api/src/database/health/**`)은 지시대로 **한 글자도 건드리지 않았다.** kOps 전환으로 대상 Postgres(클러스터 안 StatefulSet)는 달라지는 것이 없다.

### 8. 다른 담당 요청

**backend 요청 1 (중요 · 지금 상태면 소모율 기록이 조용히 멈춘다).**
`apps/api/src/cost/store/cost-store.ts:258`의 `eksUsdPerHour: s.byCategory.eks`를 `controlPlaneUsdPerHour: s.byCategory.controlPlane`으로 바꿔야 한다. Prisma는 모르는 인자를 **런타임에 거부**하는데, 이 값은 변수(`const data = {...}`)로 만들어 `create`/`update`에 펼쳐 넣기 때문에 **TypeScript가 잡지 못한다**(실제로 `tsc --noEmit` 에러 0으로 통과했다). 그대로 두면 `saveRateSample`의 `try/catch`가 예외를 삼켜 경고 로그(`소모율 기록 저장`)만 남고 **표본이 한 건도 저장되지 않는다.**

**backend 요청 2.** `cost-store.ts:29-35` `StoredRateSample.byCategory`의 `eks: number` → `controlPlane: number`(3.5.1 카테고리 교체와 함께).

**backend 요청 3.** 네임스페이스 배분 breakdown의 `eksUsdPerHour` → `controlPlaneUsdPerHour`: `apps/api/src/cost/cost.types.ts:330`, `apps/api/src/cost/estimate/allocation.ts:208`, 테스트 `apps/api/src/cost/estimate/allocation.spec.ts:218`, 문서 예시 `docs/api/aws-cost.md:361`. (프론트 `apps/web/src/features/aws-cost/types.ts:204`, `apps/web/src/features/__fixtures__/fixtures.ts:598`도 같은 필드 — PM이 frontend에 배분해 주기 바란다.)

**backend 요청 4.** 과거 표본을 읽을 때 `resources[].kind`에 옛 값 `'eks'`는 **더 이상 없다**(마이그레이션이 `'controlPlane'`으로 바꿨다). 다만 그 행들의 **금액 의미는 EKS 관리 요금**이다. 급증 원인 비교에서 전환 이전 행을 기준 시점으로 고르면 "마스터 EC2가 새로 생겼다"는 식의 사실과 다른 원인 문장이 나올 수 있으니, 요청 5의 `baselineFrom` 반영으로 함께 해결하기 바란다.

**backend 요청 5 (오탐 방지 · 설계는 이미 DB 쪽에 있음).** settings `cost.spike.rate.baselineFrom`(ISO8601 UTC 문자열 또는 `null`)을 읽어 기준선 표본의 하한으로 쓴다.
- `apps/api/src/cost/status/cost-status.ts:31` `RateSpikeSettings`에 `baselineFrom?: string | null` 추가.
- `computeRateBaseline`(같은 파일 `:64`)의 `since`를 `Math.max(now - baselineDays*86400000, Date.parse(baselineFrom))`로. `collectedHours`도 그 하한 기준으로 계산해야 "기준 수집 중 (N/24시간)"이 맞게 나온다.
- `apps/api/src/cost/cost.service.ts:1001`의 `since7`도 같은 하한을 적용하면 불필요한 조회가 준다.
- 설정 PATCH DTO(`apps/api/src/cost/dto/cost.dto.ts:105` `RateSpikePatchDto`)에 노출할지는 backend 판단에 맡긴다(운영자가 손으로 지울 일이 거의 없으면 굳이 열지 않아도 된다).
- 값이 `null`이면 **지금과 완전히 같은 동작**이어야 한다.

**backend/PM 요청 6 (검증 보완).** 실제 Postgres 16에서 `npm run db:migrate --prefix apps/api`(= `prisma migrate deploy`)를 한 번 돌려 주기 바란다. 가능하면 **기존 `cost_rate_samples` 행이 있는 DB**에서 돌리고 행 수·값이 그대로인지 확인해 주면 좋다. 이 환경에는 Docker·psql이 없어 PGlite로만 확인했다.

**backend/designer 요청 7 (문구).** 비용 화면에 "전환 이전 기록은 EKS 관리 요금 기준이라 추이 그래프에 계단이 보인다" + "전환 직후 24시간은 급증 기준선을 다시 모은다"는 안내가 있으면 사용자가 그래프를 오해하지 않는다. 명세 3.5.4의 상단 도움말 문구와 같은 자리에 넣으면 된다.

### 9. 다음 담당이 알아야 할 점

- **적용 방법**: `apps/api`에서 `npx prisma migrate deploy`(또는 `npm run db:setup`). 새 마이그레이션 1건만 추가로 적용된다. 이미 마이그레이션된 DB에서 시드를 다시 돌려도 `baselineFrom`은 덮어쓰지 않는다.
- **되돌리기**: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924120000_control_plane_cost_column.down.sql` (최신부터 역순, `docs/db/schema.md` 5절).
- **Prisma 클라이언트 재생성 필요**: 필드 이름이 바뀌었으므로 `npm ci`(postinstall) 또는 `npm run prisma:generate --prefix apps/api`를 한 번 돌리고 백엔드 코드를 고쳐야 한다.
- **불변식**: `total_usd_per_hour = ec2 + ebs + lb + controlPlane + ipv4`는 전환 앞뒤 모든 행에서 성립한다. 새 코드도 이 식을 깨지 않게 기록해야 한다(`aws-cost` 5절 수용 기준의 근거).
- **`resources` jsonb에는 이제 `kind: 'eks'`가 없다.** 새 카테고리 문자열은 `'controlPlane'`(camelCase) 하나다. 하위 종류(`master_ec2`·`etcd_ebs`·`api_lb` 등)를 남기고 싶으면 `resources[].type`/`label` 같은 기존 필드를 쓰면 되고, **컬럼을 더 만들 필요는 없다**(필요하면 DBA에 요청).
- 이번 작업으로 모니터링 대상 DB 쪽은 아무것도 바뀌지 않았다. `docs/db/health.md`의 쿼리·`sentinel_monitor` 계정·`statement_timeout` 설정은 그대로 쓰면 된다.
