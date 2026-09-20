# architecture-advisor · frontend 작업 보고

> 파일 위치: `docs/reports/architecture-advisor/frontend.md`
> 공통(셸·단일 스트림·검증 방법)은 `docs/reports/cluster-status/frontend.md`.

## 2026-09-19 12:50 · 5a 프론트 통합 (`/advisor`, `/advisor/runs/[id]`)

### 1. 요청 내용
- PM 5a 중 advisor: 분석 실행(진행 중이면 기존 실행으로 연결 `created:false`), 진행 표시(단계·경과·수신 표시만, LLM 원문 스트림 비표시), 취소, 결과(규칙 기반 점검과 LLM 제안 구분, 제안 카드), 실패 사유별 안내(`budget_exceeded`, `interrupted` 포함), 브리지 상태, 이력. LLM 출력은 텍스트로만.
- 추가 지시: 한도 변경(maxTurns 5, 지연 표시 300초).

### 2. 참고한 문서
- `docs/specs/architecture-advisor.md`(4·5절), `docs/design/architecture-advisor.md`, `docs/design/status.md` 1.2·8.3, `docs/api/architecture-advisor.md` A절
- `docs/reports/architecture-advisor/{publisher,designer,backend}.md`(4단계 C 구현, PM 결정 반영)

### 3. 작업 내용
- 데이터: `advisor` 토픽(`advisor.snapshot` = `GET /api/advisor`, `bridge.updated`, `precheck.updated`, `run.progress`, `run.finished`). 사전 점검 표·매트릭스는 REST `GET /api/advisor/prechecks?includeSystem=`(precheck `computedAt`이 바뀌면 다시 받음), 이력 `GET /api/advisor/runs?limit=`(이력 수·마지막 실행이 바뀌면 다시 받음).
- `AdvisorPage`:
  - BridgeStatusBar(API `BridgeState` 그대로, 서버 message·command·retryAt·checkedAt, `다시 확인` → `POST /api/advisor/bridge/check`: 429 `N초 뒤에 다시 확인할 수 있습니다`, 409 `RUN_ACTIVE` 안내, 응답 상태는 다음 `advisor.bridge.updated`까지 사용). 분석 실행 버튼 문구 `분석 실행` / `예시 분석 실행`(exampleMode) / `분석 진행 중`, 비활성 사유는 서버 `canRun`·`disabledReason` → 디자인 2.2 문구.
  - 분석 실행: `POST /api/advisor/runs {includeSystem}` — 202/200 모두 성공, `created` 무관하게 `run.id`를 따라감(스트림 activeRun이 오기 전에는 POST 응답의 run으로 패널 표시). 409 `BRIDGE_NOT_READY`, 503 `SNAPSHOT_UNAVAILABLE`은 서버 메시지 InlineAlert. `includeSystem`은 사전 점검 스위치와 같은 값.
  - RunProgressPanel: 5단계(스냅샷 수집 → 사전 점검 → 분석 요청 → 응답 수신 중 → 결과 정리), 완료 단계 소요 `m:ss`, 경과 타이머(서버 시각 보정), 수신 표시(`receivedChars`·`lastReceivedAt`만), 지연(서버 `delayed`), 스트림 끊김 문구. 재진입·다른 탭: `advisor.snapshot.activeRun`으로 복원.
  - 취소: 확인 Dialog(danger, `분석 취소`/`계속 기다리기`) → `POST /api/advisor/runs/:id/cancel`(409 `RUN_NOT_ACTIVE` 무시).
  - 실패·취소: RunResultAlert(API `failureReason` 그대로, 취소는 `status: cancelled`), `errorMessage`는 `advisor.run.finished` 또는 `GET /api/advisor/runs/:id`, `invalid_response` + `hasRawResponse`면 `GET .../raw-response` 원문을 접힌 CodeBlock으로, `budget_exceeded`는 `보낼 데이터 보기` + `다시 분석`, 닫기 가능. 자동 재시도 없음.
  - 사전 점검 섹션(`규칙 기반 · LLM 미사용`, 요약 배지 `높음 N건`/`중간 N건`/`문제 없음`, 계산 시각, 시스템 네임스페이스 스위치): SeverityMatrix(database→db, 셀 필터), 표(심각도·R-ID 툴팁·카테고리·내용·대상 수·예상 월 절감[추정], 판단 보류 칩·맨 아래, 기본 8행 + `전체 N건 보기`, 행 펼침: 대상·근거·계산식·`서버 계산`).
  - 최근 분석 결과(`AI 제안`, 예시 응답 배지, `방금 완료` 칩 5초): freshness stale Banner + `다시 분석`, 메타 줄(스냅샷 노드·워크로드, 추정 월, 가림 N건, 형식 오류로 제외, 생략, 심각도 수), SuggestionList(카테고리 토글·심각도·출처 `전체/사전 점검 연결/AI 단독`·모두 펼치기/접기, 1순위만 기본 펼침, 근거 확인 불가 제안은 구분 머리 아래), R-ID 클릭 → 사전 점검 표 해당 행 펼침·1500ms 선택·스크롤. 결과 없음 → EmptyState lg + 실행 버튼.
  - 분석 이력: 시작·상태(진행 중 스피너, 예시 칩)·사유(`RUN_REASON_LABEL`)·소요·제안 심각도 수·스냅샷 요약, 10행씩 `더 보기`(최대 50), 행 클릭 → 지난 결과, 보관 기준 caption.
  - 보낼 데이터 보기 Drawer lg: `GET /api/advisor/snapshot-preview`, 전송 안내(서버 `transmissionNotice`), 가림·생략·관측·데이터 소스 칩, 요약|JSON 탭(JsonTree, 가린 필드 목록), JSON 복사.
- `RunDetailPage`: `GET /api/advisor/runs/:id`, `지난 분석 결과입니다…` Banner + `최신 결과 보기`, 당시 스냅샷 요약 + `당시 보낸 데이터 보기`(`.../snapshot`), 성공이면 제안 목록, 실패·취소면 RunResultAlert(닫기 없음) + 원문, 진행 중이면 진행 패널, 404·잘못된 ID → EmptyState `분석 결과를 찾을 수 없습니다`.
- 매핑(`mapping.ts`, 순수): 단계·카드 props·필터·비활성 사유·결과 사유. 대상 링크는 `inSnapshot && ref`이고 화면이 있는 종류(Pod·Node·Deployment·StatefulSet·DaemonSet·Database)만, 스냅샷에 없는 대상은 `missing`(점선·경고).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/architecture-advisor/types.ts` | 추가 | 공개 계약 타입 |
| `apps/web/src/features/architecture-advisor/{mapping,actions}.ts` | 추가 | 매핑·동작 |
| `apps/web/src/features/architecture-advisor/{AdvisorPage,RunDetailPage,PrecheckSection,SuggestionList,HistorySection,SnapshotDrawer}.tsx` | 추가 | 화면 |
| `apps/web/src/app/advisor/page.tsx`, `app/advisor/runs/[id]/page.tsx` | 수정/추가 | 라우트 |

### 5. 주요 결정과 이유
- **LLM 원문 비표시·텍스트 전용**: 계약상 원문 스트림이 오지 않고, 제안·근거·단계·코드·계산식·서버 메시지는 퍼블리셔 컴포넌트가 텍스트 노드로만 렌더한다. 프론트는 `dangerouslySetInnerHTML`·마크다운·자동 링크를 쓰지 않는다(`<img onerror>`, `[링크](…)`, `<script>` 문자열 테스트).
- **적용·실행 버튼 없음**: 복사·펼치기·필터·링크·분석 실행/취소·미리보기만.
- **POST 응답의 run은 스트림 전까지만**: 진행 상태의 원천은 `advisor.run.progress`. 두 탭에서 동시에 눌러도 `created:false`의 run.id로 같은 진행을 본다.
- **지연·시간 제한 값은 서버 값**: `delayed`(300초 기준으로 바뀜)는 서버 계산을 그대로 쓰고 화면에 고정 시간 기준을 두지 않았다.
- 알 수 없는 카테고리 값은 `performance`로 표시(api-map이 콘솔 경고). 계약 enum 밖이라 발생하지 않는 것이 정상.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| lint / typecheck / test / build | 통과 | 공통 보고서 |
| 매핑 테스트 | 통과 | 카드 변환(문자열 그대로, missing 대상, database→db, savings 출처), 단계 소요, 필터, 비활성 사유, 결과 사유 |
| 페이지 렌더 테스트 2개 | 통과 | 예시 분석 실행 버튼, `분석 실패 · 비용 상한 초과` + 서버 문구, 악성 문자열이 문자 그대로·img/script/외부 링크 요소 없음, 근거 확인 불가 구분, 실행하지 않음 안내, 적용 버튼 없음 / 진행 패널 단계·수신 글자 수·취소·1건 제한 사유 |
| 실제 api(mock, 브리지 없음) 화면 | 통과 | 브리지 `미실행` + `예시 응답` + `예시 분석 실행`, 사전 점검 16건·매트릭스, 최근 결과 5건 카드, 이력 2건(완료·실패 로그인 필요), 콘솔 오류 0 |
| 실제 분석 실행(예시 흐름)·취소·실패 시나리오 전환 | 미확인 | 화면에서 버튼을 눌러 보지 않음(5b). 동작은 계약·단위 테스트 기준 |

### 7. 남은 이슈·한계
- 실제 실행→진행→완료, 취소, `delayed`, `timeout`, `invalid_response` 원문 표시는 5b에서 mock 시나리오(`/dev/mock`의 advisor 그룹, `fastTimers`)로 확인 필요.
- 실측 예시 결과는 모든 제안이 `근거 확인 불가`로 표시됨 — C 보고서 기재 사항(예시 fixture 이름과 mock 스냅샷 불일치), 화면 문제 아님.
- 근거 수치 강조: 서버 `value`가 문장에 없으면 뒤에 덧붙어 보임(예 `$280 280.32`) — 퍼블리셔 `SuggestionCard` 동작.
- `실패·취소 결과 닫기`는 페이지 세션 동안만 기억(새로고침하면 다시 보임).

### 8. 다른 담당 요청
- `퍼블리셔 요청`: `RunProgressPanel`/`RunResultAlert`의 `10분` 고정 문구를 `run.limits.timeoutSec`로 받을 수 있게(cluster-status 보고서 8절과 같음).
- `퍼블리셔 요청`: `SuggestionCard` 근거 강조에서 value가 문장에 없으면 덧붙이지 말고 생략할지 검토.

### 9. 다음 담당이 알아야 할 점
- 5b 확인 순서: `/dev/mock`에서 advisor 시나리오(`delayed`, `timeout`, `invalid-response`, `budget-exceeded`, `bridge-down`, `login-required`, `usage-limit`) 전환 → `/advisor`에서 실행·취소 → 이력 → `/advisor/runs/[id]`.

#### 수용 기준 (프론트 몫) — `docs/specs/architecture-advisor.md` 5절
| 기준 | 판정 | 근거 |
|---|---|---|
| mock: 사전 점검(각 카테고리)·브리지 상태·이력 + MOCK 배지 | 충족 | 실제 api(mock) 화면 |
| mock 분석 실행 → 예시 응답(단계 스트리밍, 예시 배지)으로 끝까지 | 미확인 | UI·계약 구현 완료, 버튼 실행은 5b |
| 오류 시나리오 설정으로 재현 | 충족(UI) | MOCK 배지 `어드바이저` 그룹, `/dev/mock`(fastTimers 포함) |
| 진행 단계 순서대로 표시 → 우선순위 순 제안 | 충족(코드·테스트) | 5단계 Stepper, 서버 순서 그대로 |
| 진행 중 다른 탭 실행 → 기존 분석으로 연결 | 충족(코드) | `created:false` run.id 추적, 스트림 activeRun |
| 페이지 이탈 후 복귀 → 진행 이어서/결과 표시 | 충족(코드) | `advisor.snapshot.activeRun`·latestResult |
| 지연 안내·취소, 10분 실패(시간 초과) | 충족(표시) | 서버 `delayed`, RunResultAlert `timeout` |
| 취소 → 이력 `취소됨` | 충족(표시) | 이력 배지·사유 |
| 이력(시각·상태·사유·심각도별 제안 수·스냅샷 요약) + 과거 결과 열기 | 충족 | 이력 표, `/advisor/runs/[id]` |
| 브리지 미실행 → 버튼 비활성·명령 안내·점검·이력 정상 | 충족 | 비활성 사유, 명령 줄(서버 command), 다른 섹션 독립 |
| 로그인 만료 → `claude` 로그인 안내, 자동 재시도 없음 | 충족 | RunResultAlert 명령 줄, 재시도는 버튼만 |
| 제안 형식 필드 전부 | 충족 | SuggestionCard(제목·카테고리·심각도·우선순위·대상·근거·실행 방법·위험도) |
| 절감액 `추정` 라벨·계산식·출처 | 충족 | 서버 계산 / LLM 추정 배지 + 계산식 |
| 스냅샷 밖 대상 → `근거 확인 불가` + 맨 아래 | 충족 | 테스트 |
| 사전 점검과 중복 제안 없음(ID 연결) | 충족(표시) | 연결된 사전 점검 R-ID 칩 → 표 행 |
| `대시보드는 실행하지 않습니다` + 적용 버튼 없음 | 충족 | 테스트 |
| 보낼 데이터 전체 미리보기 | 충족 | Drawer JSON 트리·복사 |
| 비밀값 가림·도구 차단 | 해당 없음(서버·브리지) | 화면은 `가림 N건` 표시 |
| 브라우저가 브리지를 직접 호출하지 않음 | 충족 | 모든 호출은 `/api/advisor/**` |
