# architecture-advisor · dba 작업 보고

## 2026-09-19 11:30 · 대시보드 자체 DB 스키마: 어드바이저 실행 이력 (2단계 설계)

### 1. 요청 내용
- PM이 `/feature` 2단계(DBA)를 요청. 이 보고서는 **스키마 부분 중 architecture-advisor 관련**을 다룬다.
- 범위: 어드바이저 실행 이력(상태, 입력 스냅샷 요약/해시, 규칙 기반 점검 결과, LLM 제안 목록, 소요 시간, 에러) 저장 구조, 보존 정책, 인덱스 근거.
- 초기 마이그레이션·설정·시드·검증 과정은 `docs/reports/aws-cost/dba.md`와 같은 작업이다(한 번의 `init` 마이그레이션).

### 2. 참고한 문서
- `CLAUDE.md` 확정된 결정 3번(조언만, 브리지 호스트 실행)
- `docs/specs/architecture-advisor.md` (0절 D1·D2·D5·D6, 3.2 사전 점검, 3.3·3.4 스냅샷 허용/제외, 3.5 제안 형식·결과 정리, 3.6 실행 상태, 5절 수용 기준, 7절 DBA)
- `docs/reports/architecture-advisor/planner.md`

### 3. 작업 내용
1. `AdvisorRun`(`advisor_runs`) 모델: 상태 enum(queued/running/succeeded/failed/cancelled), 실패 사유 enum(bridge_unavailable/login_required/usage_limit/timeout/invalid_response/interrupted/other), 사용자 표시용 오류 메시지(500자), 진행 단계, 요청·시작·종료 시각, 소요 ms, 스냅샷 sha256·요약·전문·바이트 수, 가림 건수, 사전 점검 결과 전체·심각도별 요약, 제안 수(전체·심각도별), 형식 오류 제외 수, 원문 응답(형식 오류일 때만), 모델·사용량(선택), mock "예시 응답" 여부, `data_source`.
2. **동시 1건 보장**: `active_lock varchar(16) UNIQUE` — 실행 중에만 `'active'`, 끝나면 NULL. Postgres UNIQUE는 NULL을 여러 개 허용하므로 끝난 실행은 제한이 없다. Prisma가 부분 인덱스를 표현하지 못해 이 방식을 택했다.
3. `AdvisorSuggestion`(`advisor_suggestions`) 모델: 명세 3.5 필드를 컬럼으로(우선순위, 제목, 카테고리 enum, 심각도 enum, 대상 jsonb, 근거 jsonb, 사전 점검 ID `text[]`, 예상 월 절감액 `numeric(12,2)`·계산식·출처 enum(server/llm), 실행 방법, 적용 위험도·이유, 확인 방법, "근거 확인 불가" 플래그). `run_id` FK ON DELETE CASCADE, UNIQUE(`run_id`, `priority`).
4. 보존 정리(`src/database/retention.ts`): 최근 50건 **또는** 90일 중 먼저 닿는 쪽(명세 D5), 실행 중(`active_lock` 있음)은 제외, 제안은 CASCADE. `closeInterruptedAdvisorRuns()`: API 재시작 시 남은 잠금을 `failed/interrupted`로 닫음.
5. 설정 `advisor.limits`(지연 180초, 시간 초과 600초, 브리지 확인 30초/3초, 워크로드 300·노드 100, 결과 신선도 7일), `advisor.prechecks`(사전 점검 기준값), `retention.advisorRunDays/MaxCount/RawResponseMaxBytes` 기본값을 `settings-defaults.ts`와 시드에 포함.
6. 검증: PGlite(Postgres 17.5 엔진)로 마이그레이션 적용 후 — 두 번째 `active` 실행 삽입이 unique 위반으로 거부됨, 잠금 해제 후 새 실행 가능, `precheck_ids` 기본값 `{}`, 실행 삭제 시 제안 CASCADE 삭제 확인. Prisma 클라이언트 통합 테스트로 50건/90일 정리·실행 중 보존·중단 실행 정리 확인.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 수정 | `AdvisorRun`, `AdvisorSuggestion` 및 enum 6개 (다른 모델은 aws-cost 보고서) |
| `apps/api/prisma/migrations/20260919120000_init/migration.sql` | 추가 | 초기 마이그레이션 (공통) |
| `docs/db/migrations/20260919120000_init.down.sql` | 추가 | 되돌리기 (공통) |
| `apps/api/src/database/retention.ts` | 추가 | 보존 정리, `closeInterruptedAdvisorRuns()` |
| `apps/api/src/database/retention.spec.ts` | 추가 | 어드바이저 보존 통합 테스트 포함 |
| `apps/api/src/database/settings-defaults.ts` | 추가 | `advisor.*`, `retention` 기본값 |
| `apps/api/prisma/seed.ts` | 추가 | 설정 기본값 시드 |
| `docs/db/schema.md` | 추가 | 2.6·2.7절, 3절 보존, 4절 인덱스 |

### 5. 주요 결정과 이유
- **보존: 최근 50건 또는 90일** / PM 예시는 180일이었으나 명세 가정 D5(50건/90일)를 따름. `settings.retention`으로 변경 가능.
- **동시 1건을 DB 제약으로 보장(`active_lock` UNIQUE)** / 대안: 메모리 뮤텍스만, 부분 unique 인덱스(수동 SQL) / 이유: 메모리만으로는 다중 인스턴스·재시작에 약하고, 수동 부분 인덱스는 Prisma 마이그레이션 diff가 모르는 객체라 이후 마이그레이션에서 drift로 잡힌다.
- **제안은 별도 테이블, 사전 점검은 실행 행의 jsonb 사본** / 이유: 제안은 필수 필드가 정해져 있고 필터(카테고리·심각도)·정렬(우선순위, 근거 확인 불가 맨 아래)이 있다. 사전 점검은 스냅샷이 바뀔 때마다 재계산되는 값이라 "실행 당시 무엇을 보냈나" 기록 용도로만 저장.
- **스냅샷 전문 저장 + sha256 해시** / 이유: 명세 7절 "전송한 스냅샷 전문" 저장 요구, 해시로 같은 입력 식별. 전문은 3.4 제외 규칙·비밀값 검사를 통과한 것만 저장한다는 전제(backend 책임).
- **원문 응답은 형식 오류일 때만** / 이유: 명세 3.5 "원문은 디버그용". 크기 상한(256KB)은 설정값, 자르기는 backend.
- **취소는 status로, 실패 사유와 분리** / 이유: 명세의 실패 사유 목록에 "취소됨"이 있지만 이력 목록에서 상태로 구분하는 편이 단순.
- **`interrupted` 사유 추가** / 이유: 분석은 API 프로세스 메모리에서 진행되므로 재시작 시 이어갈 수 없다. 남은 잠금을 닫지 않으면 새 분석을 영영 시작할 수 없다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npx prisma validate` | 통과 | |
| PGlite: 두 번째 `active_lock='active'` 삽입 | 거부됨 (기대대로) | `duplicate key value violates unique constraint "advisor_runs_active_lock_key"` |
| PGlite: 잠금 해제 후 새 실행, CASCADE 삭제, `precheck_ids` 기본값 | 통과 | |
| `DB_IT_URL=... npx jest src/database/retention.spec.ts` | 통과 | 55건+실행 중 1건 → 5건 삭제(50건 유지+실행 중), 제안 CASCADE, 중단 실행 정리 후 90일 지난 실행 삭제 |
| 마이그레이션 적용·drift·down (공통) | 통과 | `docs/reports/aws-cost/dba.md` 6절 |
| 실제 Postgres 16 적용 | **건너뜀** | Docker 없음 |

### 7. 남은 이슈·한계
- 스냅샷·원문 응답이 큰 경우(수 MB) 50건 기준 수십~수백 MB가 될 수 있다. 명세 규모 제한(워크로드 300·노드 100)이면 실행당 수백 KB 예상.
- 제안 필드 길이(제목 300자, 위험 이유 300자, 계산식 500자)를 넘으면 insert가 실패한다 — 결과 정리 단계에서 잘라야 한다.
- 진행 단계 이벤트(SSE)는 저장하지 않는다. 재진입 시에는 `stage`와 경과 시간만 복원된다.
- 명세 열린 질문 Q1(이름 가명화)이 "가명화"로 정해져도 스키마 변경은 필요 없다(스냅샷 jsonb 내용만 달라짐). 가명 ↔ 원래 이름 대응표를 저장해야 하면 `advisor_runs`에 컬럼 추가 마이그레이션이 필요하다.

### 8. 다른 담당 요청
- `backend 요청`: API 시작 시 `closeInterruptedAdvisorRuns(prisma)` 호출, 하루 1회 `purgeExpiredData()` 스케줄(`@nestjs/schedule`).
- (시드 등록·마이그레이션 실행 스크립트 요청은 `docs/reports/aws-cost/dba.md` 8절과 같음)

### 9. 다음 담당이 알아야 할 점 (backend)
- 분석 시작:
  ```ts
  try {
    run = await prisma.advisorRun.create({ data: { activeLock: 'active', status: 'queued', dataSource, isExample, snapshotHash, snapshotSummary, snapshot, snapshotBytes, redactedCount, precheckResults, precheckSummary } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const running = await prisma.advisorRun.findUnique({ where: { activeLock: 'active' } }); // 진행 중 분석으로 연결
    }
  }
  ```
- 진행: `update({ status: 'running', startedAt, stage })`. 종료(완료·실패·취소 모두): **반드시 `activeLock: null`**, `finishedAt`, `durationMs`, 카운트 컬럼, 실패면 `failureReason`·`errorMessage`(비밀값 가림, 500자).
- 제안 저장: 같은 트랜잭션에서 `advisorSuggestion.createMany` + run 카운트 업데이트(`prisma.$transaction`). priority는 1..N 중복 없이, "근거 확인 불가"는 `unverified: true` + 가장 뒤 priority. 목록 조회 `orderBy: [{ unverified: 'asc' }, { priority: 'asc' }]`.
- 절감액: `estimatedMonthlySavingsUsd`(Decimal) + `savingsFormula` + `savingsSource: 'server' | 'llm'`. 단가 근거가 없으면 셋 다 null.
- 이력 목록: `findMany({ orderBy: { requestedAt: 'desc' }, take: 50, select: { id, status, failureReason, requestedAt, durationMs, snapshotSummary, suggestionCount, highCount, mediumCount, lowCount, isExample } })` — `snapshot`·`rawResponse`는 상세에서만 select(크다).
- `rawResponse`는 `invalid_response`일 때만, `retention.advisorRawResponseMaxBytes`(256KB)로 잘라 저장.
- 저장되는 스냅샷은 명세 3.4 제외 규칙과 비밀값 검사를 통과한 것이어야 한다. DB 상태(`PgHealthSnapshot`)를 스냅샷에 넣을 때 `sessions[].user`·`locks.items[].user`는 빼고 명세 3.3의 DB 항목(버전, 레플리카 수, PVC·연결 사용률, 오래 걸린 쿼리 건수, 캐시 적중률, xid 나이, DB별 크기)만 넣는다.
- 시간 제한·브리지 확인 주기 등은 `mergeSetting('advisor.limits', row?.value)`.
- 컬럼 상세: `docs/db/schema.md` 2.6·2.7절.

## 2026-09-19 15:00 · API 계약(3단계) DBA 요청 반영

### 1. 요청 내용
`docs/reports/architecture-advisor/backend.md` 8절 / `docs/api/architecture-advisor.md` C.2·C.3의 DBA 요청:
1. `advisor_failure_reason`에 `budget_exceeded` 추가
2. `advisor.limits` 기본값에 `maxBudgetUsd: 2.0`, `maxTurns: 3`
3. `advisor_suggestions.targets` 모양 `string[]` → `TargetRef[]` (문서·타입)
4. `advisor_suggestions.steps` text → jsonb (`Step[]`)
5. (선택) `advisor_runs.stage_timings jsonb`

### 2. 참고한 문서
`docs/api/architecture-advisor.md`(A.1.3 TargetRef·Step·Evidence, A.1.2 StageState, B.5, C), `docs/reports/architecture-advisor/backend.md` 8절, `docs/api/common.md`(ResourceRef), `docs/db/schema.md`, `apps/api/prisma/schema.prisma`, 이 보고서 1절.

### 3. 작업 내용
1. **새 마이그레이션** `20260919150000_advisor_contract` + down SQL. (init을 고치지 않은 이유는 5절)
   - `ALTER TYPE advisor_failure_reason ADD VALUE IF NOT EXISTS 'budget_exceeded' BEFORE 'interrupted'` — schema.prisma 순서와 맞춤.
   - `advisor_runs.stage_timings jsonb NULL` 추가 (5번, 선택 요청이지만 컬럼 하나라 같이 넣음).
   - `advisor_suggestions.steps` text → jsonb. Prisma가 만든 SQL은 `DROP COLUMN` + `ADD COLUMN ... NOT NULL`이라 행이 있으면 실패/손실 → 손으로 `ALTER COLUMN ... TYPE jsonb USING (CASE ...)`로 교체. 유효한 JSON 배열 문자열은 그대로, 그 외(평문·객체·깨진 JSON)는 `[{"text": <원문>, "code": null}]`. `pg_input_is_valid`(PG 16+) 사용 — docker compose `db`가 16이라 가능.
2. down SQL: steps를 새 text 컬럼에 합쳐 넣고(단계 사이 빈 줄, 코드는 ```` ```lang ```` 블록) 교체, `stage_timings` 삭제, `budget_exceeded` 행을 `other`로 바꾼 뒤 enum 타입을 다시 만들고(Postgres는 enum 값 삭제 불가) `_prisma_migrations` 기록 삭제. 한 트랜잭션.
3. `settings-defaults.ts` `advisor.limits`에 `maxBudgetUsd: 2.0`, `maxTurns: 3`(시드는 이 파일을 그대로 씀).
4. `targets`·`evidence`·`steps`·`stage_timings` jsonb 모양을 TS 타입으로: 새 파일 `apps/api/src/database/advisor-json.ts` (`AdvisorTargetRefJson`, `AdvisorEvidenceJson`, `AdvisorStepJson`, `AdvisorStageId`, `AdvisorStageTimingJson`). API 타입과 같은 구조라 그대로 대입 가능.
5. `stage` 컬럼 주석을 API `StageId`(`snapshot`/`precheck`/`request`/`receiving`/`finalizing`)로 정정 — 2단계 주석이 다른 이름(`collecting_snapshot` 등)이었다. varchar라 마이그레이션 불필요.
6. `retention.spec.ts`의 제안 픽스처 `steps: 's'` → `[{ text: 's', code: null }]`.
7. `docs/db/schema.md`: settings 표, 2.6·2.7 컬럼 표, jsonb 모양 블록, 5절 마이그레이션 표·되돌리기 순서·검증 기록.

### 4. 변경 파일
- `apps/api/prisma/schema.prisma` (enum 값, `stageTimings`, `steps Json`, 주석)
- `apps/api/prisma/migrations/20260919150000_advisor_contract/migration.sql` (신규)
- `docs/db/migrations/20260919150000_advisor_contract.down.sql` (신규)
- `apps/api/src/database/settings-defaults.ts`
- `apps/api/src/database/advisor-json.ts` (신규)
- `apps/api/src/database/retention.spec.ts`
- `docs/db/schema.md`
- (`src/database/generated/prisma` 재생성, gitignore)

### 5. 주요 결정과 이유
- **init 수정 대신 새 마이그레이션**: 배포 전이지만 init은 이미 팀 로컬 DB·PGlite 검증에 적용된 상태다. init을 고치면 `_prisma_migrations` 체크섬 불일치로 `migrate deploy`가 경고·`migrate dev`가 리셋을 요구해 로컬 데이터를 날린다. 규칙(스키마 변경은 마이그레이션 + down 경로)도 새 마이그레이션 쪽이 맞다. 배포 전 정리(squash)는 필요하면 첫 배포 직전에 한 번에.
- **steps를 jsonb로**(텍스트에 JSON 문자열 대안 대신): DB에서 모양 확인·조회(`jsonb_array_length` 등)가 가능하고, api가 직렬화/파싱을 따로 하지 않아도 된다.
- **stage_timings는 `StageState[]`와 같은 모양**: api가 메모리의 `stages` 배열을 그대로 저장·복원할 수 있게. NULL 허용(과거 행·저장 실패 시 이력에서 소요만 비움).
- 기존 settings 행에 새 키가 없어도 `mergeSetting('advisor.limits', …)`이 기본값을 채우므로 설정 데이터 마이그레이션은 하지 않았다. 시드는 `ON CONFLICT DO NOTHING`이라 기존 행은 안 바뀐다.
- enum 추가(`ADD VALUE`)는 PG 12+에서 트랜잭션 안 허용. 같은 마이그레이션에서 새 값을 쓰지 않는다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npx prisma validate` | 통과 | |
| `npx prisma generate` | 통과 | Prisma 7.10.0 |
| PGlite(17.5) + socket: init만 deploy → text steps 4종 삽입 → 전체 deploy | 통과 | 평문→`[{text, code:null}]`, JSON 배열→그대로, JSON 객체·깨진 JSON→text로 감쌈. enum 순서 `…invalid_response,budget_exceeded,interrupted,other` |
| `migrate diff --from-config-datasource --to-schema schema.prisma` | 빈 결과 | drift 없음 |
| `budget_exceeded`·`stage_timings` 저장 | 통과 | |
| 시드 | 통과 | `advisor.limits`에 `maxBudgetUsd: 2`, `maxTurns: 3` |
| down SQL | 통과 | steps 텍스트 복원(코드 블록 포함), `budget_exceeded`→`other`, `stage_timings` 제거, 기록 삭제. 이전 스키마와 diff 빈 결과 |
| 재적용 deploy + drift | 통과 / 빈 결과 | |
| `DB_IT_URL=… jest src/database/retention.spec.ts` | 2 passed | jsonb steps로 Prisma 생성 확인 |
| `npm test --prefix apps/api` | 6 suites, 41 passed, 1 skipped | |
| `npm run lint:check --prefix apps/api` | **2 errors (내 영역 아님)** | `src/common/extension-points.ts:40`, `src/common/source-registry.service.ts:33` prettier. `src/database/**`, `prisma/*.ts`는 0건 |
| 실제 Postgres 16 적용 | **건너뜀** | Docker 없음. `pg_input_is_valid`는 16+ 함수라 16에서 동작 |

### 7. 남은 이슈·한계
- down은 손실이 있다: `budget_exceeded` → `other`, `stage_timings` 삭제, steps 구조(코드 언어 구분)가 텍스트로 합쳐짐. 재적용하면 steps는 한 단계짜리 배열이 된다.
- jsonb 모양은 DB가 강제하지 않는다(CHECK 없음). api가 저장 전 검증.
- Postgres 15 이하를 대시보드 DB로 쓰면 up 마이그레이션이 `pg_input_is_valid` 없음으로 실패한다(현재 16 고정이라 문제 없음).

### 8. 다른 담당 요청
- `backend 요청`: `src/common/extension-points.ts`, `src/common/source-registry.service.ts`의 prettier 오류 정리(lint:check 실패 원인).

### 9. 다음 담당이 알아야 할 점 (backend C)
- `steps`는 이제 `Json`: `steps: steps as unknown as Prisma.InputJsonValue` (문자열로 직렬화하지 말 것). 읽을 때 `as unknown as AdvisorStepJson[]`.
- `targets`는 `TargetRef[]` 그대로 저장(`AdvisorTargetRefJson`), `evidence`에 `verified` 포함.
- `stageTimings`: 끝날 때 `stages` 배열(5개)을 저장, 없으면 NULL. `stage`에는 API `StageId` 값을 쓴다.
- `failureReason: 'budget_exceeded'` 사용 가능(Prisma enum `AdvisorFailureReason.budget_exceeded`).
- 한도: `mergeSetting('advisor.limits', row?.value).maxBudgetUsd / .maxTurns`.
- 로컬 DB 갱신: `npx prisma migrate deploy` 후 `npx prisma generate`(이미 생성됨).

## 2026-09-19 12:40 · 어드바이저 한도 기본값 변경 (maxTurns 5, slowAfterSec 300)

### 1. 요청 내용
PM 결정: `advisor.limits` 기본값 `maxTurns` 3 → 5, `slowAfterSec` 180 → 300. `timeoutSec` 600, `maxBudgetUsd` 2.0은 유지. 이미 시드된 DB의 한계를 문서화하고, 옛 기본값을 올리는 데이터 마이그레이션 필요 여부를 판단.

### 2. 참고한 문서
`apps/api/src/database/settings-defaults.ts`, `apps/api/prisma/seed.ts`, `docs/db/schema.md` 2.1·5절, `apps/api/src/advisor/advisor-settings.service.ts`(읽기만).

### 3. 작업 내용
1. `settings-defaults.ts` `advisor.limits`: `slowAfterSec: 300`, `maxTurns: 5`(키 이름 그대로). `seed.ts`는 이 파일 값을 그대로 넣으므로 코드 변경 없음(시드 결과가 5/300인 것을 확인).
2. 데이터 마이그레이션 `20260919180000_advisor_limits_defaults` 추가 + down SQL. 필드별로 값이 **정확히** 옛 기본값(3 / 180)일 때만 `jsonb_set`으로 5 / 300으로 바꾼다. 다른 필드·다른 값·행 없음은 그대로 둔다.
3. `docs/db/schema.md`: settings 표 값 갱신, "시드의 한계" 문단(멱등 시드는 기존 행을 바꾸지 않음 → 기본값을 바꿀 때는 데이터 마이그레이션을 함께 둠), 5절 마이그레이션 표·설명·되돌리기 순서·검증 기록.

### 4. 변경 파일
- `apps/api/src/database/settings-defaults.ts`
- `apps/api/prisma/migrations/20260919180000_advisor_limits_defaults/migration.sql` (신규)
- `docs/db/migrations/20260919180000_advisor_limits_defaults.down.sql` (신규)
- `docs/db/schema.md`
- (`apps/api/prisma/seed.ts`: 변경 없음. 값은 settings-defaults.ts에서 가져옴)

### 5. 주요 결정과 이유
- **데이터 마이그레이션을 추가했다**. 시드는 `ON CONFLICT DO NOTHING`이라 이미 시드된 DB(팀 로컬 등)에는 3/180이 남는다. 이를 코드에서 "옛 값이면 무시"로 처리하면 운영자가 일부러 3이나 180을 설정해도 덮여 버린다. 마이그레이션은 한 번만 실행되므로, 그 뒤 운영자가 넣은 3/180은 그대로 존중된다. 설정 편집 UI가 없어 지금 저장된 3/180은 사실상 모두 시드 값이다.
- 필드별 조건부 UPDATE: 둘 중 하나만 바꿔 둔 경우도 나머지 필드는 올린다(검증 5단계).
- 스키마 변경이 없는 마이그레이션이라 drift가 없다. 새 DB에서는 시드 전에 실행되므로 아무것도 바꾸지 않는다.
- down은 5→3, 300→180. 마이그레이션 뒤 운영자가 일부러 5/300으로 둔 값과 구분할 수 없다(문서에 적음). 코드 기본값은 down으로 되돌아가지 않는다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| PGlite(17.5) + socket: 새 DB `migrate deploy` | 통과 | settings 0행, 변화 없음 |
| down → 옛 행(3/180) 삽입 → deploy | 통과 | 5/300, `timeoutSec` 600·`maxBudgetUsd` 2 유지 |
| down SQL | 통과 | 3/180 복원, `_prisma_migrations` 기록 삭제 |
| `maxTurns` 4(운영자 값) + `slowAfterSec` 180 → deploy | 통과 | 4 유지, 300으로 변경 |
| `migrate diff --from-config-datasource` | 빈 결과 | drift 없음 |
| 시드(기존 행 있음) / 행 삭제 후 시드 | 통과 | 기존 값 유지 / 5·300 |
| `npm run lint:check --prefix apps/api` | 통과 | 0건 |
| `npm test --prefix apps/api` | 통과 | 28 suites, 267 passed, 1 skipped |
| 실제 Postgres 16 | 건너뜀 | Docker 없음. `jsonb_set`·jsonb 비교는 16에서 동일 |

### 7. 남은 이슈·한계
- 이미 시드된 DB는 `npx prisma migrate deploy`를 돌려야 5/300이 된다(시드 재실행으로는 안 바뀜).
- down은 운영자의 5/300 설정까지 3/180으로 되돌린다.
- PGlite 서버를 끄면서 `taskkill /F /IM node.exe` 필터를 잘못 써서, 이 머신에서 실행 중이던 **다른 node 프로세스도 종료되었을 수 있다**(스크래치패드 `api.log`·`bridge.log`가 12:23까지 기록됨). 로컬 api·브리지 개발 서버를 띄워 두고 있었다면 다시 시작해야 한다.

### 8. 다른 담당 요청
- 없음.

### 9. 다음 담당이 알아야 할 점 (backend C)
- **`src/advisor/advisor-settings.service.ts`의 임시 처리(`SUPERSEDED`, `overrideUnlessSuperseded`)는 이 마이그레이션을 적용한 뒤에는 필요 없다.** 코드 기본값(`SETTING_DEFAULTS['advisor.limits']`)이 이제 5/300이고, 이미 시드된 DB의 3/180은 마이그레이션이 5/300으로 올린다. 오히려 남겨 두면 운영자가 일부러 `maxTurns` 3이나 `slowAfterSec` 180을 설정해도 5/300으로 덮이는 부작용이 있다.
- 제거 방법(권장): `maxTurns`/`slowAfterSec`도 다른 필드처럼 `env ?? limitsBase.x ?? d.x` 순으로 읽는다. `CODE_DEFAULTS`는 `SETTING_DEFAULTS` 값을 쓰면 된다(중복 상수 불필요). 관련 spec의 "옛 값이면 코드 기본값" 테스트도 함께 정리.
- 제거 전에 대상 환경에서 `npx prisma migrate deploy`(= `npm run db:migrate`)가 실행되어야 한다. 배포 순서: 마이그레이션 적용 → 임시 처리 제거 코드 배포. 순서가 반대여도 결과는 옛 값 3/180이 잠깐 쓰이는 정도다.
