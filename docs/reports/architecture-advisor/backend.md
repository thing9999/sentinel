# architecture-advisor · backend 작업 보고

> 파일 위치: `docs/reports/architecture-advisor/backend.md`

## 2026-09-19 · API 계약 (3단계)

### 1. 요청 내용
- PM 요청: `docs/api/architecture-advisor.md` 작성(구현 없음). 두 부분:
  - a) 공개 계약: 분석 실행(POST, 동시 1건 — 진행 중이면 기존 실행으로 연결), 실행 상태·진행 SSE(단계, 경과, 수신 표시 — LLM 원문은 화면에 안 보냄), 취소, 이력 목록·상세, 규칙 기반 사전 점검과 LLM 제안 구분, 제안 스키마, 실패 사유 enum, 브리지 상태 조회.
  - b) 내부 계약 api ↔ agent-bridge: 스냅샷 입력 스키마(포함/제외), 스트리밍 엔드포인트(NDJSON/SSE 선택), 구조화 출력 사용 여부, `maxTurns`·`maxBudgetUsd` 기본값, 타임아웃, `x-bridge-token`, 에러 매핑, SDK 결과 필드 → api 응답 매핑.

### 2. 참고한 문서
- `CLAUDE.md`(어드바이저 결정, 스냅샷 원문 전송 결정), `docs/specs/architecture-advisor.md`
- `docs/design/architecture-advisor.md`, `status.md` 1.2(브리지·실행 결과 문구)
- `docs/db/schema.md` 2.6·2.7(`advisor_runs`, `advisor_suggestions`, `active_lock`), `docs/reports/architecture-advisor/dba.md` 9절, `settings-defaults.ts`(`advisor.limits`, `advisor.prechecks`)
- `docs/reports/bootstrap/backend.md`(브리지 뼈대·SDK 이름), `apps/agent-bridge/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`(0.3.277: `JsonSchemaOutputFormat`, `SDKResultMessage.subtype`·`structured_output`·`total_cost_usd`, `SDKAssistantMessageError`, `SDKRateLimitEvent.rate_limit_info{status, resetsAt}`, `Query.interrupt()`)
- `docs/reports/architecture-advisor/designer.md` 8절

### 3. API 계약 (`docs/api/architecture-advisor.md`)

#### 3.1 공개 (A)
| 메서드·경로 | 용도 |
|---|---|
| `GET /api/advisor` | 화면 상태 한 번에: `bridge`, `activeRun`(재진입 복원), `lastRun`, `latestResult`(최근 성공 + 제안), 사전 점검 요약, 이력 수, `persistence` |
| `GET /api/advisor/bridge` | 브리지 상태(캐시) |
| `POST /api/advisor/bridge/check` | "다시 확인". 필요 시 인증 확인 쿼리. 429 `BRIDGE_CHECK_COOLDOWN`, 409 `RUN_ACTIVE` |
| `GET /api/advisor/prechecks` | 규칙 기반 사전 점검(`source: 'rule'`), 매트릭스, 판단 보류 |
| `GET /api/advisor/snapshot-preview` | "보낼 데이터 보기": 전송될 스냅샷 전문 + 크기·가림·생략 메타 |
| `POST /api/advisor/runs` | 분석 실행. **202 `created: true`** / **이미 진행 중이면 200 `created: false` + 진행 중 실행**. 409 `BRIDGE_NOT_READY`, 503 `SNAPSHOT_UNAVAILABLE` |
| `GET /api/advisor/runs/:id` | 진행 상태 또는 결과 |
| `POST /api/advisor/runs/:id/cancel` | 202, 409 `RUN_NOT_ACTIVE` |
| `GET /api/advisor/runs` | 이력(limit 1~50, 최근순) |
| `GET /api/advisor/runs/:id/snapshot` | 당시 보낸 스냅샷 |
| `GET /api/advisor/runs/:id/raw-response` | 형식 오류 원문(디버그, 텍스트로만) |

- 실행 단계 `snapshot → precheck → request → receiving → finalizing`, `Run`에 `stages[]`, `elapsedSec`, `delayed`(180초), `receiving{lastReceivedAt, receivedChars}`(텍스트 없음), `limits`, `llm{model, costUsd(추정), …}`.
- 실패 사유: `bridge_unavailable`, `login_required`, `usage_limit`, `timeout`, `invalid_response`, `budget_exceeded`(신규), `interrupted`, `other`. 취소는 `status: cancelled`.
- 제안 `Suggestion`: priority, title, category(cost/reliability/performance/security/database), severity, `targets[]{kind, namespace, name, snapshotName, inSnapshot, ref}`, `evidence[]{field, value, text, verified}`, `precheckIds`, `savings{monthlyUsd, kind: estimated, asOf, formula, source: server|llm}`, `steps[]{text, code}`, 고정 `noExecuteNotice`, `risk{level, reason}`, `verification`, `unverified`, `source: 'llm'`.
- SSE(`advisor`): `advisor.snapshot`, `advisor.bridge.updated`, `advisor.precheck.updated`, `advisor.run.progress`(단계 변경·수신 진행 ≤1초 1회·진행 중 5초마다), `advisor.run.finished`.
- 결과 신선도: 7일 경과, 노드 수·인스턴스 타입 구성 변경 → `freshness.stale` + 사유.

#### 3.2 내부 (B)
| 항목 | 결정 |
|---|---|
| 보호 | `x-bridge-token`(= 브리지 `BRIDGE_TOKEN`), 없으면 브리지는 루프백 전용(뼈대 그대로). api → 브리지 단방향 |
| 엔드포인트 | `GET /health`(가벼운 확인 + 마지막 인증·한도 상태, 필드 추가), `POST /v1/auth-check`(최소 쿼리, 뼈대 `ping-agent` 정식화), **`POST /v1/advise`(NDJSON 스트림)**, `POST /v1/runs/:runId/cancel` |
| 스트림 | NDJSON 줄 `accepted` → `init` → `progress`(글자 수만, ≤1초 1회) / `ping`(10초) → `result` 또는 `error` |
| 입력 | `{ runId, promptVersion: "advisor-v1", snapshot: AdvisorSnapshotV1, limits? }`. 프롬프트·출력 스키마는 **브리지 소유**(범용 LLM 프록시화 방지) |
| 스냅샷 | 허용 목록 스키마(B.2). 이름 원문(네임스페이스·워크로드·노드그룹·PVC·DB), IP 형태 노드 이름·볼륨 ID·LB 이름은 가명, 이미지는 레지스트리 호스트·계정 ID 제거. env·command/args·어노테이션·이벤트 message·쿼리 원문·**DB 사용자 이름**·IP·ARN 제외. 비밀값 패턴 검사 후 `"[가림]"` + `redactedCount`. 워크로드 300·노드 100·512KB 제한 |
| 구조화 출력 | SDK `outputFormat: { type: 'json_schema', schema }` 사용 → `structured_output`. api가 같은 스키마로 재검증, 없으면 `resultText`에서 JSON 추출 |
| 기본값 | `maxTurns` 3, `maxBudgetUsd` $2.00, 전체 600초(지연 180초), 연결 3초, 스트림 무응답 60초 |
| 에러 매핑 | 연결 실패·401/403·도중 끊김 → `bridge_unavailable`; `authentication_failed` 등 → `login_required`; `rate_limit_event rejected`·`rate_limit`·`billing_error` → `usage_limit`(`retryAt` = `resetsAt`); `error_max_budget_usd` → `budget_exceeded`; `error_max_structured_output_retries`·`error_max_turns`·검증 실패 → `invalid_response`; 시간 제한 → `timeout`; 취소 → `cancelled`; `init.tools` 비어 있지 않음 → 즉시 중단 `other` |
| 결과 필드 매핑 | `subtype`·`is_error`·`structured_output`·`result`(필요 시)·`duration_ms`·`duration_api_ms`·`num_turns`·`total_cost_usd`(추정)·`stop_reason`·`usage`(4개)·`permission_denials` 수·`errors` → NDJSON `result` → `Run.llm`, DB `model`·`usage` jsonb. `session_id`·텍스트 델타는 내보내지 않음 |

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/architecture-advisor.md` | 추가 | 공개 + 내부 계약 |
| `docs/reports/architecture-advisor/backend.md` | 추가 | 이 보고서 |

(코드 변경 없음)

### 5. 주요 결정과 이유
- **"진행 중이면 연결"은 오류가 아닌 200 `created: false`** (대안: 409). 화면은 상태 코드와 무관하게 `run.id`를 따라가면 되므로 다른 탭 연결(명세 D2)이 단순.
- **전제 조건 실패(브리지 미연결)는 409로 거절하고 이력에 남기지 않음**, 실행 도중 문제만 실패 이력. 버튼이 비활성인데도 불린 경우라 이력 오염 방지. 명세 S3(로그인 만료 → 실패 이력)은 실행 중 발생이므로 충족.
- **실패 사유는 DBA enum(snake_case) + `budget_exceeded`** — 디자인 camelCase 요청과 충돌. 저장값 = API 값으로 변환 오류 제거.
- **NDJSON 선택** (대안: SSE). 서버 간 POST 응답 스트림이라 SSE의 이벤트 이름·재연결 의미가 불필요, Node `fetch`로 줄 단위 파싱이 간단.
- **프롬프트는 브리지 소유** — api는 스냅샷만 보냄. 토큰이 새도 브리지가 임의 프롬프트 실행기가 되지 않음.
- **구조화 출력 사용 + api 재검증** — SDK가 스키마를 강제해 형식 오류를 줄이되, LLM 출력은 신뢰하지 않으므로 api가 필수 필드·대상 대조·근거 확인·절감액 재계산을 다시 함.
- **`maxTurns` 3** — 도구가 없어 1턴이면 되지만 구조화 출력 재시도 여유. 뼈대 상한(1~3) 안.
- **`maxBudgetUsd` $2.00** — 보통 입력 1.5~2만 + 출력 1만 토큰 이하(추정 $0.2~0.8)의 2배 이상 여유, 폭주 차단. 구독 로그인에선 추정치이므로 사용량 보호 의미. 초과 시 `budget_exceeded`로 구분해 원인이 보이게.
- **돈 계산은 서버가 덮어씀** — 연결된 사전 점검에 서버 절감액이 있으면 LLM 값을 무시(`source: server`), 없을 때만 `llm`(계산식 필수), 계산식 없으면 null.
- **브리지 인증 확인은 가벼운 `/health`(30초) + 필요할 때만 최소 쿼리** — 30초마다 LLM을 부르면 사용량 낭비. 마지막 쿼리 결과로 인증·한도 상태를 유지.
- **가명 매핑은 api 메모리에만**, 제안 대상은 실제 이름으로 복원해 저장·표시(화면 링크).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint:check --prefix apps/api` | 통과 | 코드 변경 없음 |
| `npm test --prefix apps/api` | 통과 | 6 suites, 41 passed, 1 skipped |
| SDK 타입 확인 | 확인 | `sdk.d.ts` 0.3.277에서 `outputFormat`/`structured_output`, result subtype 5종, `SDKAssistantMessageError`, `SDKRateLimitInfo.resetsAt`, `interrupt()` 존재 확인 |
| 구조화 출력 실제 동작(`tools: []` 상태) | **생략** | 계약 단계. SDK 문서상 json_schema는 "end-turn tool"로 구현되어, 도구 전부 비활성·`dontAsk` 조합에서 동작하는지 4단계에서 실제 호출로 확인 필요 |
| 브리지 lint/test | 생략 | 브리지 코드 변경 없음 |

### 7. 남은 이슈·한계
- 구조화 출력이 `tools: []`에서 막히면 텍스트 JSON 모드로 대체(계약은 동일, `resultText` 경로).
- `login_required`·`usage_limit` 분류는 SDK 오류 코드(`authentication_failed`, `rate_limit`, `rate_limit_event`)에 의존. SDK 버전이 바뀌면 재확인.
- 단계별 소요 시간은 진행 중에만 정확(DB에 `stage`만 있음). 이력에서는 null 가능.
- `usage_limit`의 `retryAt`은 구독 로그인에서 `rate_limit_event`가 올 때만 알 수 있음.
- 사전 점검의 복수 카테고리를 대표 1개로 줄임(A.4 표).
- 24시간 재시작·OOM, 관측 평균(R-OVERREQ·R-NODEIDLE)은 API 재시작 후 관측 구간이 짧음 → 판단 보류.

### 8. 다른 담당 요청
- `DBA 요청`:
  1. `advisor_failure_reason` enum에 `budget_exceeded` 추가(마이그레이션 + down SQL).
  2. `settings.advisor.limits`에 `maxBudgetUsd: 2.0`, `maxTurns: 3` 추가(`settings-defaults.ts`, 시드).
  3. `advisor_suggestions.targets` jsonb 모양을 `string[]` → `TargetRef[]`(`{kind, namespace, name, snapshotName, inSnapshot, ref}`)로 문서 갱신(마이그레이션 불필요).
  4. `advisor_suggestions.steps`를 `Step[]`(`{text, code:{language, content}|null}`) 저장용 jsonb로 변경 권장(불가하면 text에 JSON 문자열로 저장하겠음).
  5. (선택) `advisor_runs.stage_timings jsonb` — 이력에서 단계별 소요 표시가 필요하면.
- `designer 요청`: RunResultAlert에 `budget_exceeded`(분석 실패 · 비용 상한 초과) 행 추가, 브리지 토큰 불일치(`BRIDGE_TOKEN_MISMATCH`) 메시지 표시 확인.
- `frontend 요청`: 진행은 `advisor.run.progress`만 보고(LLM 텍스트 없음), 재진입은 `GET /api/advisor`의 `activeRun`으로 복원, `POST runs`는 202/200 모두 성공으로 처리, 제안·사전 점검 문자열은 텍스트 노드로만 렌더, 대상 링크는 `ref`가 있을 때만.
- `PM 요청`: 없음(`maxBudgetUsd`·스트리밍 방식 결정 완료, 결정 근거는 5절).

### 9. 다음 담당이 알아야 할 점
- 브리지 새 엔드포인트도 반드시 `buildAdvisorOptions()`를 거쳐 `query()` 호출. `init.tools`가 비어 있지 않으면 즉시 중단(안전 확인).
- 동시 1건: DB `active_lock` UNIQUE(P2002 → 진행 중 실행 조회), DB 없으면 메모리 잠금. 종료 시 반드시 `activeLock: null`. 시작 시 `closeInterruptedAdvisorRuns`.
- 스냅샷 빌더는 허용 필드만 복사(원본 객체 spread 금지). 비밀값 검사는 이름 필드에도 적용. 테스트 필수: `DB_PASSWORD` env·`last-applied-configuration` 어노테이션·레이블의 AWS 키 형식 문자열(명세 수용 기준).
- 결과 정리 규칙 8단계(B.4)와 에러 매핑 표(B.6)가 구현 기준.

## 2026-09-19 · 구현 (4단계, C 파트: 아키텍처 어드바이저)

### 1. 요청 내용
- PM 요청: 4단계 백엔드 구현 중 C 파트. 쓰기 영역 `apps/api/src/advisor/**`, `apps/agent-bridge/**`.
  - 브리지: NDJSON `POST /v1/advise`(반드시 `buildAdvisorOptions()`), 프롬프트 파일 분리, 구조화 출력 실제 확인(안 되면 텍스트 JSON), subtype → 실패 사유, `maxBudgetUsd` 2.0·`maxTurns` 3·600초·취소(연결 끊김 포함), 진행 이벤트만, 로그인 만료·미설치 감지, vitest.
  - api: 규칙 기반 사전 점검(순수 함수), 공개 계약 전체(동시 1건·P2002·종료 시 `activeLock: null`, SSE는 `AdvisorTopicSource`, 취소, 이력, 브리지 상태), 시작 시 `closeInterruptedAdvisorRuns()`, 브리지 응답 재검증, mock 시나리오 + `ADVISOR_BRIDGE=live`, DB 없을 때 인메모리 폴백.
  - 최종 확인: 브리지 + api(`DATA_SOURCE=mock`, `ADVISOR_BRIDGE=live`)로 실제 분석 1회.
- 중간 지시(DBA 스키마 보완 반영): `budget_exceeded`, `stage_timings`, `steps` Json, `advisor-json.ts` 타입, `advisor.limits.maxBudgetUsd/maxTurns` → 모두 반영.

### 2. 참고한 문서
- `CLAUDE.md`, `docs/api/common.md`, `docs/api/architecture-advisor.md`(A·B·C), `docs/specs/architecture-advisor.md`, `docs/design/architecture-advisor.md` 2.2(브리지 문구)
- `docs/db/schema.md` 2.6·2.7, `docs/reports/architecture-advisor/dba.md` 9절과 "2026-09-19 15:00" 절, `apps/api/src/database/{advisor-json,retention,settings-defaults}.ts`
- `docs/reports/bootstrap/backend.md`(SDK 이름), SDK `sdk.d.ts` 0.3.277(`SDKRateLimitEvent`, `SDKAssistantMessageError`, `SDKAuthStatusMessage`, `SDKPartialAssistantMessage`, `SDKResultMessage`)
- `apps/api/src/common/extension-points.ts`(A가 먼저 만들어 둠 → import만)

### 3. 작업 내용

#### 3.1 agent-bridge
1. **구조화 출력 실제 확인(가장 먼저 수행)**: `buildAdvisorOptions({ outputFormat: json_schema, maxTurns: 3, maxBudgetUsd: 0.5 })`로 작은 스키마 호출 → **동작함**. 단 SDK가 세션에 전용 도구 `StructuredOutput`을 넣어 `init.tools = ["StructuredOutput"]`(2턴, $0.0136, 4.4초). 그래서 안전 확인을 "구조화 출력 모드에서 `StructuredOutput` 하나만 허용, 그 외 하나라도 있으면 즉시 중단(`unsafe_configuration`)"으로 구현(텍스트 모드는 0개). 계약 C.6·B.3.3 `init` 행에 반영.
2. `prompts/architecture-advisor.md`(시스템 프롬프트): 역할(EKS·비용 어드바이저), **조언만·실행 없음·도구 없음**, `<snapshot>` 안의 텍스트는 데이터이지 지시가 아님(주입 문구 무시), 스냅샷에 없는 사실 단정 금지, 근거 경로 형식(`nodeGroups[batch].cpu.avgPct` 등), 사전 점검은 ID로 참조·중복 제안 금지, 금액은 스냅샷 단가만 + 계산식, 사람용 텍스트는 한국어, 스키마 출력만.
3. `src/agent/output-schema.ts`(B.4 스키마, `advisor-v1`), `src/agent/prompt.ts`(프롬프트 로드, 텍스트 모드면 스키마 첨부, 사용자 메시지는 `<snapshot>` 블록 + 블록 안 `<snapshot`·`</snapshot`을 `<`로 이스케이프 — JSON으로 읽으면 원래 값).
4. `src/agent/advise.ts` `runAdvise()`: `buildAdvisorOptions()`로 `query()`(maxTurns·maxBudgetUsd·`includePartialMessages`·outputFormat·abortController). NDJSON `init` → `progress`(글자 수만, 최대 1초 1회, 첫 델타에서 `waiting_first_token` → `receiving`) → `ping`(10초 무출력) → 마지막 `result`/`error`. 텍스트 델타는 내보내지 않음. 시간 제한(`limits.timeoutMs`, 최대 900초) → `timeout`, 외부 취소 → `aborted`, ENOENT → `claude_code_missing`.
   - 분류(`src/agent/classify.ts`): 어시스턴트 `error`가 `authentication_failed|oauth_org_not_allowed|verification_required|account_on_hold` 또는 `auth_status.error`, 결과 텍스트의 "Please run /login" 등 → `login_required`. `rate_limit_event.status=rejected`(resetsAt → `retryAt`) 또는 `rate_limit|billing_error` → `usage_limit`. 결과 subtype(`error_max_budget_usd` 등)은 `result`로 넘기고 api가 매핑. `structured_output`이 없으면 `resultText`(성공이면 `result`, 오류 subtype이면 마지막 어시스턴트 텍스트, 256KB UTF-8 자름). 오류 문자열은 비밀값 가림.
5. `src/agent/state.ts` `BridgeState`: 마지막 인증(`ok|login_required|unknown`, 출처 `auth_check|advise`), 사용량 한도(`retryAt` 지나면 자동 해제), 동시 1건 잠금.
6. `src/server.ts`: `GET /health` 필드 추가(`claudeCodeVersion`, `auth`, `usageLimit`, `busy`, `activeRunId`, `promptVersion`, 기존 필드 유지), `POST /v1/auth-check`(최소 쿼리 60초, 로그인 만료도 200), `POST /v1/advise`(요청 검증 400·`unsupported_prompt_version`, 1MB 초과 413 `payload_too_large`, 503 `claude_code_missing`, 409 `busy`+`activeRunId`, 이후 `reply.hijack()`으로 NDJSON), `POST /v1/runs/:runId/cancel`(202, 없으면 404), **클라이언트 연결이 끊기면 abort**. `/v1/ping-agent`는 뼈대 진단 응답 모양 그대로 두고 인증 상태만 함께 갱신(순수 별칭 대신 유지 — 진단용·기존 테스트).
7. `src/config.ts`: `ADVISOR_OUTPUT_MODE=json_schema|text`(기본 json_schema, 대체 경로). `src/http/auth.ts`: 401/403 본문에 계약 형식 `code`(`unauthorized`/`forbidden`)·`message` 추가(`error` 유지).

#### 3.2 api `src/advisor`
| 파일 | 역할 |
|---|---|
| `advisor.types.ts` | 공개 계약 타입(A.1) |
| `snapshot/snapshot.types.ts` | `AdvisorSnapshotV1`(B.2) + 섹션 기여 모양(`ClusterContribution`, `CostContribution`, `SnapshotDb`) |
| `snapshot/sanitize-snapshot.ts` | **허용 목록 재복사**(원본 조각이 섞여 와도 스키마 필드만) + 가명(IP 형태 노드 → `<nodeGroup>-node-<n>`, 볼륨 ID → `vol-<n>`, LB 이름·ARN → `lb-<n>`, 매핑은 메모리만) + 이미지 레지스트리 호스트·계정 ID·digest 제거 + 레이블 표준 5개만 + **모든 문자열(이름 포함) 비밀값 검사**(DBA `redactSecrets` + AKIA/ASIA, `key=`, PEM, JWT, 32자+ hex/base64, ARN, 12자리 계정 ID, IPv4, `sk-ant-`, 접속 문자열) → `"[가림]"` + 경로 기록. 멱등 |
| `snapshot/snapshot-builder.ts` | 병합 → 시스템 네임스페이스 제외(`SYSTEM_NAMESPACES`, 기본 A6 목록) → 정제 1차 → 규모 제한(문제 우선 → 규모 순, 300/100) → 사전 점검 첨부 → **보내기 직전 정제 2차** → 512KB 초과 시 usage → events → 워크로드 절반씩. 요약·sha256 |
| `snapshot/advisor-snapshot.service.ts` | `DiscoveryService`로 `@AdvisorSnapshotContributorProvider()` 수집(section별 첫 번째, 5초 타임아웃). 없거나 실패하면 unavailable, **mock 모드에서만** 내장 mock 섹션으로 대체 |
| `precheck/precheck-rules.ts` | 명세 3.2의 27개 규칙(순수 함수): 대표 카테고리(A.4), 대상 50개 제한, 근거(verified), 서버 절감액(R-GP2 `(gp2−gp3)×GB`, R-GRAVITON·R-ONDEMAND `(현재−대체)×730h×대수`, R-EBSIDLE·R-LBIDLE 월 비용 합), R-OVERREQ·R-NODEIDLE은 관측 60분 미만이면 판단 보류, R-HOST는 시스템 네임스페이스 항상 제외, R-SINGLE은 DB StatefulSet 제외(R-DB-SINGLE), 정렬(심각도 → 대상 수 → ID, held 맨 아래), 매트릭스 |
| `precheck/advisor-precheck.service.ts` | 5분 주기 재계산(부팅 5초 후 첫 계산), 바뀌면 `advisor.precheck.updated`, `includeSystem=true`는 60초 캐시, 상태(PRECHECK_HIGH/MEDIUM/NO_DATA) |
| `result/finalize-result.ts` | 결과 정리 B.4 1~8: 파싱(structured → 텍스트에서 JSON 추출, 코드 펜스·앞뒤 문장 허용) → 스키마 재검증(버림 → `dropped`) → 대상 대조(가명 복원, `inSnapshot`, 화면 있는 종류만 `ref`) → 근거 경로 조회·값 비교(숫자 ±1%) → `unverified` 맨 뒤 → 같은 precheckIds 병합 → 절감액 서버 우선, LLM은 계산식 있을 때만 → priority 1..N. 제어 문자 제거·길이 제한만(내용 불변) |
| `bridge/bridge-client.ts` | `/health`(3초), `/v1/auth-check`, `/v1/advise` NDJSON 파서(연결 3초, 무응답 60초 → `idle`, 도중 끊김 → `disconnected`), cancel. `x-bridge-token` |
| `bridge/bridge-status.ts`, `bridge/advisor-bridge.service.ts` | A.3.1 판정표·디자인 2.2 문구(순수 함수) + 캐시. 구독자 또는 최근 REST 조회가 있을 때만 30초 주기 확인, 실행 직전 1회, "다시 확인" 쿨다운 10초·인증 쿼리 60초(429 + `Retry-After`), 실행 중 409 `RUN_ACTIVE`, 실행 결과(로그인·한도)를 즉시 반영, 바뀌면 `advisor.bridge.updated` |
| `run/run-model.ts` | 실행 레코드·단계 전이·`toRun`·결과 신선도(A.10) |
| `run/run-store.ts`, `run/advisor-run.repository.ts` | Prisma 저장(`activeLock: 'active'`로 생성 → P2002면 진행 중 실행 반환, 종료 트랜잭션에서 제안 `createMany` + `activeLock: null` + `stageTimings` + 카운트 + `rawResponse`(256KB, invalid_response만) + `model`·`usage`). **DB 없음·쓰기 실패 시 메모리 폴백 + 경고**(목록은 DB + 메모리 전용 병합). 부팅 시 `closeInterruptedAdvisorRuns()` |
| `run/failure.ts` | A.9 문구, B.6 매핑(NDJSON code·subtype·HTTP) |
| `run/advisor-run.service.ts` | 동시 1건(메모리 + DB 잠금), 실행 직전 브리지 확인(409 `BRIDGE_NOT_READY`), 스냅샷(503 `SNAPSHOT_UNAVAILABLE`), 브리지 NDJSON 소비(수신 진행 ≤1초 1회, 5초마다 진행, 지연 전환 즉시), api 시간 제한(`timeoutSec+10초` → abort + 브리지 cancel), 취소(멱등, 브리지 cancel + fetch abort), 결과 정리·저장·`advisor.run.finished`. mock 예시 흐름(시나리오별), mock 예시 이력 2건 시드 |
| `advisor.service.ts`, `advisor.controller.ts`, `dto/advisor.dto.ts`, `api-error.ts` | A.2~A.7 엔드포인트, DTO 검증(`true/false`, 쉼표 목록, limit 1~50), `:id`가 uuid가 아니면 400 `VALIDATION_FAILED`, 에러 본문 `{statusCode, code, message, details}`(path·timestamp는 A의 전역 필터가 붙임 — 실제 응답에서 확인) |
| `advisor-events.ts`, `advisor-topic.source.ts` | `@TopicSourceProvider()` 토픽 `advisor`(연결 시 `advisor.snapshot`), 구독 수 집계 |
| `mock/advisor-scenario.state.ts`, `mock/advisor-mock-scenarios.ts`, `mock/mock-fixtures.ts` | `@MockScenarioTargetProvider()` group `advisor`(9개 시나리오, 진행 중 변경 409 `RUN_ACTIVE`, `fastTimers` 기본 true = 지연 10초·초과 20초), mock 섹션·예시 LLM 출력·형식 오류 원문 |
| `advisor-settings.service.ts` | 환경 변수 > settings 테이블 > 기본값. `ADVISOR_BRIDGE`, `AGENT_BRIDGE_URL/TOKEN`, `SYSTEM_NAMESPACES`, 선택 `ADVISOR_SLOW_AFTER_SEC`·`ADVISOR_TIMEOUT_SEC`·`ADVISOR_MAX_BUDGET_USD` — 모두 `ConfigService` 기본값으로 읽음(검증 파일은 A 영역) |

- **`ADVISOR_BRIDGE=mock|live`**: `DATA_SOURCE=mock`에서 기본 `mock`(브리지를 부르지 않고 예시 응답). `live`면 mock 스냅샷(A·B 제공자 값 또는 내장 mock)으로 **실제 로컬 Claude Code 분석**, 브리지가 없으면 예시 응답. `DATA_SOURCE=live`에서는 항상 live.
- mock 시나리오: `normal`(위 규칙) / `example` / `bridge-down`·`login-required`·`usage-limit`(버튼 비활성) / `delayed`·`timeout`·`invalid-response`·`budget-exceeded`(예시 흐름이 해당 결과로 끝남). fastTimers는 **예시 흐름에만** 적용(실제 브리지 분석은 설정값 180/600초).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/agent-bridge/prompts/architecture-advisor.md` | 추가 | 시스템 프롬프트 |
| `apps/agent-bridge/src/agent/{advise,auth-check,classify,output-schema,prompt,state}.ts` | 추가 | 분석 실행·분류·스키마·프롬프트·상태 |
| `apps/agent-bridge/src/agent/ping.ts` | 수정 | `assistantError`, `rateLimit` 수집 |
| `apps/agent-bridge/src/{server,config}.ts`, `src/http/auth.ts`, `.env.example` | 수정 | 새 엔드포인트, `ADVISOR_OUTPUT_MODE`, 오류 본문 `code` |
| `apps/agent-bridge/src/advise-route.test.ts`, `src/agent/{advise,classify}.test.ts` | 추가 | vitest 36개 추가(21 → 57) |
| `apps/api/src/advisor/**` (위 표) | 추가·수정 | 모듈 전체 (`advisor.module.ts` 뼈대 교체) |
| `apps/api/src/advisor/**/*.spec.ts` (7개) | 추가 | jest 80개 |
| `docs/api/architecture-advisor.md` | 수정 | B.3.3 `init.tools`, C.6 확인 결과, A.6 202의 `stage` 메모 |
| `docs/reports/architecture-advisor/backend.md` | 수정 | 이 절 |

(`apps/api/src/common/extension-points.ts`는 A가 먼저 만들어 import만 함. `prisma/schema.prisma` 수정 없음 — DBA가 generate까지 완료)

### 5. 주요 결정과 이유
- **구조화 출력 사용(json_schema)** — 실제 호출로 `tools: []`에서 동작 확인. 형식 오류를 SDK 단계에서 줄이고 api는 같은 규칙으로 재검증. 대체 경로(`ADVISOR_OUTPUT_MODE=text`)는 설정 한 줄로 전환.
- **안전 확인 기준 = "StructuredOutput 외 도구 0개"** — SDK가 구조화 출력 구현용 도구를 세션에 넣기 때문. `buildAdvisorOptions()` 고정값(`tools: []` 등)과 `options.test.ts`는 그대로.
- **mock에서 브리지 호출은 옵트인(`ADVISOR_BRIDGE=live`)** — 계약 6.1 `normal`("브리지가 켜져 있으면 실제 분석")을 그대로 따르면 mock 화면만 열어도 호스트 브리지를 두드리고, 실수로 분석을 누르면 사용량을 쓴다. PM 지시(mock은 브리지 호출 없음)를 기본으로, 실제 분석은 명시적으로 켠다.
- **라이브 실행의 202는 `stage: request`** — 스냅샷·사전 점검은 수 ms라 요청 처리 안에서 끝내고 실제 소요를 기록(DB `snapshot` 컬럼이 NOT NULL이라 생성 전에 스냅샷이 필요). 화면은 `stages`만 따르면 되므로 계약 영향 없음(계약 A.6에 메모).
- **전부 형식 오류면 invalid_response** — 계약 B.4-2("유효 0건 + 파싱 실패")를 "파싱은 됐지만 유효 0건 + 버림 1건 이상"까지 넓힘(원문 보관이 더 유용). 빈 배열은 성공(0건).
- **`llm.inputTokens` = input + cache read + cache creation** — 구독 로그인에서는 대부분이 캐시 토큰이라 input만 보이면 규모를 오해함. 세부는 DB `usage` jsonb에 따로 저장.
- **DB에서 읽은 제안의 `savings.asOf`** — 컬럼이 없어 실행의 `snapshotSummary.estimatedMonthly.asOf`(없으면 요청 시각)를 씀.
- **메모리 폴백은 실행 단위** — DB 쓰기가 실패하면 그 실행만 메모리 전용으로 두고 계속. 목록은 DB + 메모리 전용 병합(`persistence`는 DB 연결 여부).
- **mock 예시 이력은 현재 mock 섹션으로 생성** — 처음엔 내장 fixture로 만들어서 A·B의 mock 데이터와 인스턴스 타입이 달라 "결과가 현재 상태와 다를 수 있음"이 항상 켜졌음(실제 실행에서 발견, 수정).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| 구조화 출력 실험(`tools: []` + json_schema) | 동작 | init.tools `["StructuredOutput"]`, 2턴, $0.0136, 4.4초 |
| `npm run lint --prefix apps/agent-bridge` | 통과 | |
| `npm test --prefix apps/agent-bridge` | 통과 | 6 files, 57 tests |
| `npm run build --prefix apps/agent-bridge` | 통과 | |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 통과 | |
| `npm run lint:check --prefix apps/api` | 통과 | 프로젝트 전체(작업 중간엔 A 파일 prettier 오류가 있었으나 마지막 실행에서 0건) |
| `npm test --prefix apps/api` | 통과 | 27 suites, 262 passed, 1 skipped (advisor 7 suites 80 tests) |
| `nest build` | 생략(금지) | 실제 실행은 `tsc -p tsconfig.build.json --outDir <scratchpad>`로 스크래치 폴더에 컴파일 후 `NODE_PATH`로 실행(공유 `dist` 미사용). `ts-node`는 Prisma 생성 코드의 `.js` import를 못 풀어 사용 불가 |

**실제 연결 확인** (브리지 `npm run dev --prefix apps/agent-bridge`, 토큰 없음·127.0.0.1 / api `PORT=3021 DATA_SOURCE=mock ADVISOR_BRIDGE=live`, 대시보드 DB 없음 → `persistence: memory`)
- 부팅: A의 StreamService가 토픽 `advisor`를 찾음. A·B의 스냅샷 제공자(cluster·db·cost)가 동작해 내장 mock 대신 그 값으로 스냅샷 생성(노드 6, 워크로드 8, PVC 5, 25,803 bytes, 노드 6개 가명).
- `GET /api/advisor`: 브리지 `connected`, 사전 점검 critical(높음 4·중간 5·낮음 7), 예시 이력 2건.
- **분석 1회** (`POST /api/advisor/runs` → `created: true`, 곧바로 다시 POST → `created: false` 같은 id)
  - 결과 `succeeded`, **소요 182.8초**(api `durationMs` 182,822 / 브리지 SDK `duration_ms` 181,219 / `duration_api_ms` 182,214). 단계 소요 snapshot 9ms · precheck 0ms · request 1,220ms · receiving 181,591ms · finalizing 2ms
  - **비용 `total_cost_usd` = $0.7990 (추정치, 구독 로그인이라 실제 청구 아님)**, 모델 `claude-opus-5[1m]`, `num_turns` 3, 입력 37,189 토큰(캐시 포함) / 출력 22,857 토큰
  - 제안 10건(high 4 · medium 4 · low 2, 버림 0, 근거 확인 불가 0) — 모두 스키마대로: 제목·카테고리(reliability·database·performance·cost·security)·심각도·대상(스냅샷 이름, `inSnapshot: true`)·근거(field/value, 대부분 verified)·precheckIds·실행 단계(bash/yaml 코드 블록)·위험도·확인 방법. 서버 절감액 덮어쓰기 2건(R-NODEIDLE+R-GRAVITON $53.14/월, R-GP2 $0.11/월).
  - 예: 1순위 "prod/api 메모리 limit을 올려 OOMKilled와 재시작 반복 해소" — 근거 `workloads[prod/api].ready = 0`(verified), `workloads[prod/api].containers[api].usage.memoryAvgBytes = 522352398`(verified), 단계 1 `kubectl -n prod describe pod ... | grep -A3 'Last State'`.
  - SSE(`/api/stream?topics=advisor`): `advisor.snapshot` 1, `advisor.run.progress` 151(receiving 중 ≤1초 1회, 글자 수만·텍스트 없음), `advisor.run.finished` 3, `advisor.bridge.updated` 9.
- **취소 실측**: 새 분석 8초 뒤 `POST .../cancel` → 202 `cancelling: true` → 브리지 로그 `error code: aborted`, 브리지 `busy: false`, 실행 `cancelled`(8.2초, 단계 done·done·done·skipped·skipped). 다시 cancel → 409 `RUN_NOT_ACTIVE`.
- **브리지 종료 후**: `POST /api/advisor/bridge/check` → `unreachable` + `exampleMode: true`, `canRun: true`, 사유 `브리지 미실행 (연결 거부)`. 10초 안에 다시 → 429 `BRIDGE_CHECK_COOLDOWN`(`retryAfterSec`). 예시 분석 → `isExample: true`, limits 10/20초, 9.0초에 succeeded(제안 5).
- 검증 오류: `runs/not-a-uuid` 400, `prechecks?severity=bad` 400 `VALIDATION_FAILED`(fields).
- 확인 후 브리지(npm·tsx watch·node)·api·SSE curl 프로세스 모두 종료, 3002/3021 포트 닫힘 확인.

### 7. 남은 이슈·한계
- **실제 분석이 `num_turns` 3 = `maxTurns` 상한에 닿음.** 구조화 출력은 최소 2턴이고 스키마 재시도가 한 번 더 일어나면 상한을 넘어 `error_max_turns` → `invalid_response`가 될 수 있다. 상한은 `options.ts`의 안전 고정값(`MAX_TURNS_LIMIT = 3`)이라 임의로 올리지 않았다 → PM 결정 요청.
- 실제 분석 소요가 약 3분 → 지연 기준 180초 근처. 운영에서 "지연 중" 안내가 자주 뜰 수 있다.
- DB 연결 상태의 저장 경로(Prisma `create`·P2002·`$transaction`)는 로컬 Postgres가 없어 **실 DB로 검증하지 못함**(타입 검사·코드 리뷰만). 메모리 경로만 실측.
- 예시 LLM 출력(fixture)은 내장 mock 이름 기준이라, A·B mock 데이터로 만든 스냅샷과 섞이면 일부 예시 제안이 "근거 확인 불가"로 표시된다(예시 응답이라 허용).
- 이력에서 읽은 실행의 `redactedFields`는 저장하지 않아 `[]`(가림 건수는 스냅샷 meta에 있음).
- `advisor.bridge.updated`가 실행 시작·종료마다(busy·canRun 변화) 나가 몇 분에 9건. 의도된 동작이지만 배지 강조가 잦을 수 있음.
- `usage_limit`·로그인 만료는 실제 상황을 재현하지 못하고 가짜 SDK 메시지로만 테스트(SDK 오류 코드에 의존).

### 8. 다른 담당 요청
- `A/PM 요청` (env 검증 `src/config/env.validation.ts`, 루트 `.env.example`, compose): `ADVISOR_BRIDGE`(mock|live, 기본은 DATA_SOURCE를 따름), `SYSTEM_NAMESPACES`(쉼표), 선택 `ADVISOR_SLOW_AFTER_SEC`·`ADVISOR_TIMEOUT_SEC`·`ADVISOR_MAX_BUDGET_USD`를 스키마·예시에 추가. 지금은 `ConfigService` 기본값으로 읽어 동작함(검증 없음). 브리지 `.env.example`에는 `ADVISOR_OUTPUT_MODE`를 추가함.
- `A/B 요청` (스냅샷 제공자): `contribute()` 반환 모양은 `apps/api/src/advisor/snapshot/snapshot.types.ts`의 `ClusterContribution`(cluster·nodeGroups·nodes·workloads·storage·loadBalancers·unattachedVolumes·events·observationSec), db는 `SnapshotDb`(또는 `{ db }`), cost는 `SnapshotCost`(또는 `{ cost, unattachedVolumes?, loadBalancers? }`). 여분 필드는 advisor가 버리므로 안전하지만 이름이 다르면 빠진다 — 이번 실측에서 `loadBalancers` 0개였으니 어느 쪽이 LB를 넘기는지 확인 필요. mock 시나리오 화면용으로 `ADVISOR_SCENARIO_OPTIONS`(label·description)와 `AdvisorMockScenarios.fastTimers`·`setFastTimers()`를 공개함 — 공통 mock 컨트롤러가 `fastTimers`를 받으면 호출해 주세요. `POST /api/mock/reset`에서는 `setScenario('normal')`이면 충분.
- `PM 요청`: (1) `maxTurns` 상한(현재 3, `options.ts` 안전 고정값)을 4~5로 올릴지 결정 — 실제 분석이 3턴을 다 썼음. (2) 지연 기준 180초 유지 여부(실측 약 3분).
- `DBA 요청`: 없음(보완 스키마 그대로 사용). 참고: 실 DB에서 `closeInterruptedAdvisorRuns`·P2002 경로를 한 번 같이 확인하면 좋음.
- `designer 요청`: 없음(3단계 요청 그대로).
- `frontend 요청`: 라이브 실행의 첫 응답은 `stage: request`(앞 두 단계 done)일 수 있음. `llm.inputTokens`는 캐시 포함. 브리지 `exampleMode: true`면 버튼 문구 "예시 분석 실행".

### 9. 다음 담당이 알아야 할 점
- 로컬에서 실제 분석: `npm run dev --prefix apps/agent-bridge` 후 api를 `DATA_SOURCE=mock ADVISOR_BRIDGE=live`로 실행. 브리지 없이 화면만 볼 때는 기본값(mock) → 예시 응답.
- 안전 설정은 여전히 `apps/agent-bridge/src/agent/options.ts` 한 곳. 새 호출도 `buildAdvisorOptions()`만 쓴다. 구조화 출력 모드의 `StructuredOutput` 허용은 `classify.ts` `unsafeTools()`.
- 정제는 두 번(`sanitizeSnapshot` 1차·2차). 새 스냅샷 필드는 `snapshot.types.ts` + `sanitize-snapshot.ts`의 `copy*` 함수에 추가해야 전송된다(허용 목록). `sanitize-snapshot.spec.ts`가 env·어노테이션·AWS 키 레이블 수용 기준을 고정.
- 실패 사유 매핑은 `run/failure.ts` 한 곳, 브리지 상태 판정은 `bridge/bridge-status.ts`(순수 함수).

## 2026-09-19 · PM 결정 반영 (maxTurns 5, 지연 기준 300초)

- 요청: `MAX_TURNS_LIMIT` 3 → 5, 기본 maxTurns 5. 지연 기준 180 → 300초(시간 초과 600초 유지). 실제 분석은 다시 돌리지 않음(비용).
- 변경:
  - 브리지 `src/agent/options.ts`: `MAX_TURNS_LIMIT = 5`. `src/agent/advise.ts`: `DEFAULT_LIMITS.maxTurns = 5`, `clampLimits`의 상한 1~5. `buildAdvisorOptions()`에 maxTurns를 안 넘기면 쓰는 값은 그대로 1(ping 등 안전한 쪽 유지). 분석 요청의 기본값만 5로 바뀜.
  - 테스트 고정값 갱신: `options.test.ts`(`MAX_TURNS_LIMIT`가 5), `advise.test.ts`, `advise-route.test.ts`, api `advisor-run.service.spec.ts`.
  - api `advisor-settings.service.ts`: 코드 기본값 `CODE_DEFAULTS = { maxTurns: 5, slowAfterSec: 300 }`. 우선순위: 환경 변수(`ADVISOR_MAX_TURNS`(새로 추가), `ADVISOR_SLOW_AFTER_SEC`) > settings 값 > 코드 기본값.
    - 단, settings 값이 **예전 기본값(maxTurns 3, slowAfterSec 180)과 같으면** 운영자가 바꾼 값이 아니라고 보고 코드 기본값(5·300)을 쓴다.
    - 확인 결과: 지금은 settings 기본값·시드(`settings-defaults.ts`)가 3·180이라 예외 처리가 없으면 3·180이 쓰였을 것이다. 새 테스트 `advisor-settings.service.spec.ts`로 확인했다: DB가 없을 때와 시드 값이 3·180일 때는 5·300, 운영자가 바꾼 값(4·240)과 환경 변수는 그 값을 따른다.
  - DB 이력 행에 한도가 없을 때 쓰는 기본값 180 → 300. 예시 이력 시드의 limits도 300.
  - 계약 `docs/api/architecture-advisor.md`: A.1.2 `delayed` 주석, A.6·A.7 예시의 `slowAfterSec` 300, B.3.3 요청 예시의 `maxTurns` 5와 상한 1~5, B.5 표(maxTurns 5, 지연 300초)를 고침.
- 검증: 브리지 lint 통과 / test 57 통과 / build 통과. api `tsc --noEmit` 통과 / `lint:check` 통과(프로젝트 전체 0건. 중간 실행에서는 다른 담당 파일의 CRLF prettier 오류 7건이 있었으나 재실행 시 0건) / `npm test` 28 suites, 266 passed, 1 skipped.
- `DBA 요청`: `apps/api/src/database/settings-defaults.ts`의 `advisor.limits` 기본값과 seed를 `maxTurns: 5`, `slowAfterSec: 300`으로 바꿔 주세요. 이미 시드된 DB 행도 같이 갱신(선택)해 주세요. 갱신한 뒤에는 api의 예전 기본값 예외(`SUPERSEDED`)를 지워도 됩니다(backend).
- `A 요청`(PM 전달분에 추가): env 선언에 `ADVISOR_MAX_TURNS`(선택, 1~5)도 넣어 주세요.

## 2026-09-19 · 개요 요약 카드 제공자 (A 확장점)

- 요청: A가 만든 선택 확장점 `src/common/overview-summary.ts`의 `@OverviewSummaryProviderDecorator()`를 section `advisor`로 구현. 개요 화면의 advisor 블록이 비어 있었기 때문.
- 추가: `apps/api/src/advisor/advisor-overview.summary.ts`의 `AdvisorOverviewSummaryProvider`를 만들어 `advisor.module.ts`에 등록했다.
  - `summary()`는 `cluster-status.md` 2.1 예시 모양을 반환한다: `{ status, precheck: { status, high, medium, low, held }, lastRun: { id, status, finishedAt, suggestionCount } | null, bridge: BridgeState, busy, available: true }`.
  - `status`(사이드바 `nav.advisor`와 stale 표시)는 사전 점검 요약의 `StatusInfo`를 쓴다. 계약 예시에서도 `nav.advisor`와 `precheck.status`가 같다.
  - `busy()`는 분석 진행 중 여부이고 `nav.advisorBusy`에 쓰인다.
  - `changes$`는 `advisor.precheck.updated`, `advisor.run.finished`, `advisor.bridge.updated`, `advisor.snapshot`에서만 알린다. 진행 이벤트는 초당 발생해서 제외했다. 분석 시작·종료는 `bridge.updated`의 busy 변화로 알 수 있다.
- `MockScenarioTarget`의 선택 필드(`options`, `defaultScenario`, `fastTimers`)는 지시대로 손대지 않았다. 내 구현에는 이미 `options`와 `fastTimers`가 있다.
- 검증:
  - 브리지: lint 통과, test 57 통과, build 통과.
  - api: `tsc --noEmit` 통과, `lint:check` 0건, `npm test` 28 suites / 267 passed / 1 skipped.
  - 요약 테스트 1건을 추가했다: mock 이력, 진행 중 busy, `lastRun` 갱신, `changes$` 알림을 확인한다.
- maxTurns 5·지연 300초 반영은 바로 앞 절에 있다.

## 2026-09-19 · 임시 처리 제거 (DBA 기본값 5/300 반영 후)

- DBA가 `advisor.limits` 기본값을 5/300으로 바꾸고, 시드에 남아 있던 3/180을 올리는 데이터 마이그레이션 `20260919180000_advisor_limits_defaults`를 추가했다.
- 그래서 "settings 값이 예전 기본값 3/180이면 코드 기본값을 쓴다"는 임시 처리(`SUPERSEDED`, `overrideUnlessSuperseded`)를 제거했다.
- 이제 우선순위는 env(`ADVISOR_MAX_TURNS`, `ADVISOR_SLOW_AFTER_SEC`) → settings 값 → 코드 기본값(`CODE_DEFAULTS` 5/300)이다. settings 값은 양수이기만 하면 그대로 쓴다. 운영자가 일부러 넣은 3/180도 존중한다.
- `advisor-settings.service.spec.ts`를 바꿨다.
  - settings에 3/180이 있으면 3/180을 쓴다.
  - env가 settings보다 우선한다.
  - DB가 없으면 5/300을 쓴다.
- 검증: `tsc --noEmit` 통과, `lint:check` 0건, `npm test` 28 suites / 267 passed / 1 skipped. 이번 작업에서는 띄운 프로세스가 없다.

## 2026-09-19 · 예시 fixture EKS 버전 정리 (1.30 → 1.34)

- 배경: cluster mock 버전이 `v1.34.1`로 올라갔다(`docs/reports/aws-cost/backend.md` 3.3·7절). 그런데 어드바이저 예시 fixture에는 `version: '1.30', supportTier: 'standard'`가 남아 있었다. 1.30은 일정표상 확장 지원이라 두 값이 서로 맞지 않았다.
- 변경: `apps/api/src/advisor/mock/mock-fixtures.ts`의 `mockClusterContribution().cluster.version`을 `'1.34'`로 바꿨다. `supportTier`는 `'standard'` 그대로 둬서 1.34 standard가 됐다.
- 예시 제안 5건의 문구·근거·명령에는 EKS 버전이 나오지 않아 고칠 곳이 없었다. 남은 `16.4`는 Postgres 버전이고 `1.4.2`, `2.3.0`, `v1.11.1` 등은 이미지 태그다.
- `snapshot/sanitize-snapshot.spec.ts`의 `'1.30'`은 fixture와 무관한 독립 테스트 입력이라 건드리지 않았다(쓰기 범위 밖).
- 검증: `lint:check` 0건, `tsc --noEmit` 통과, `npm test` 29 suites / 289 passed / 1 skipped. 이번 작업에서 띄운 프로세스는 없다.
