# architecture-advisor · publisher 작업 보고

> 파일 위치: `docs/reports/architecture-advisor/publisher.md`
> 공통 작업(토큰·셸·공통 컴포넌트·검증 전체)은 `docs/reports/cluster-status/publisher.md`. 이 파일은 components.md 10절(어드바이저 전용) 부분만 적는다.

## 2026-09-19 11:55 · 4단계 퍼블리싱 (어드바이저 전용 컴포넌트)

### 1. 요청 내용
- PM 요청(4단계 퍼블리싱) 중 components.md 10절 구현. LLM 출력은 텍스트로만 렌더(dangerouslySetInnerHTML·마크다운 파싱·자동 링크 금지).
- 작업 중 추가 지시: 디자인 갱신(API 계약 반영) — `BridgeStatusBar`, `RunResultAlert`가 API 값을 그대로 받도록 props 변경, `RunResultAlert`에 `budget_exceeded`(warn, wallet, 안내 2줄, `보낼 데이터 보기` + `다시 분석`)와 `interrupted` 추가.

### 2. 참고한 문서
- `docs/design/architecture-advisor.md`(2.2·2.4 갱신본), `docs/design/components.md` 10절(10.1·10.3 갱신본), `docs/design/status.md` 1.2·2.4·8.3
- `docs/api/architecture-advisor.md` (BridgeState, A.9 failureReason, errorMessage, hasRawResponse)

### 3. 작업 내용
- `components/ui/advisor/`
  - `Labels.tsx`: `SeverityBadge`, `SeverityIcon`, `RiskBadge`(outline / text), `CategoryChip`(토글 칩 지원), `SourceLabel`, `ExampleBadge`, `NoExecuteNotice`
  - `SeverityMatrix.tsx`: 5×3 + 합계, 셀은 필터 토글 버튼(`aria-pressed`), 0은 `—`
  - `BridgeStatusBar.tsx`(+ `CommandLine`): API `BridgeState` 그대로, 기본 메시지 표, 서버 `message`가 있으면 그것을 씀, 명령 줄은 `command`가 있을 때만
  - `RunProgressPanel.tsx`: 5단계 Stepper, 경과 타이머, 수신 표시(pulse, 30초 이상이면 `응답 대기 중`), 지연 InlineAlert, 스트림 끊김 문구. LLM 원문 스트림은 보여 주지 않는다
  - `RunResultAlert.tsx`: API `failureReason` 그대로(+`cancelled`), 사유별 tone·아이콘·제목·기본 문구·안내·액션 표(`RUN_RESULT_SPEC`), 이력 `사유` 열 문구(`RUN_REASON_LABEL`), 목록 밖 값 → 기타(`toRunFailReason`)
  - `SuggestionCard.tsx`: 접힘/펼침, 1~3순위 accent, 근거 확인 불가(dashed warn + 칩 + InlineAlert), 절감액(서버 계산/LLM 추정 + 계산식), 실행 방법(NoExecuteNotice + 번호 목록 + CodeBlock), 위험도, 확인 방법, 연결된 사전 점검(R-ID 버튼)
- 아이콘 추가: `key-round`, `timer-off`, `file-warning`, `wallet`, `rotate-ccw`.
- `api-map.ts`: `categoryFromApi()`(`database`→`db`), `severityFromApi()`, `runStatusBadge()`, `savingsKindFromSource()`.
- 공통 `CodeBlock`, `JsonTree`(스냅샷 미리보기, 검색·`[가림]` 강조), `Stepper`, `ElapsedTimer`, `Drawer lg`, `Dialog danger`도 이 기능에서 쓴다.

**안전 렌더링**: 제목·근거·단계·코드·이유·계산식·서버 메시지·원문 응답 모두 React 텍스트 노드. `**굵게**`, `[링크](…)`, URL, `<img …>`가 그대로 문자로 보이는지 테스트했다. 근거 수치 강조는 서버가 준 `value`를 문자열 위치로 찾아 `<strong>`으로 감싸는 것뿐(파싱 없음). 대상 링크는 `href`를 줬을 때만(서버가 스냅샷과 대조한 경우). 실행·적용 버튼은 없다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/advisor/{Labels,SeverityMatrix,BridgeStatusBar,RunProgressPanel,RunResultAlert,SuggestionCard}.tsx`, `advisor.module.css` | 추가 | 어드바이저 전용 |
| `apps/web/src/components/ui/icons.tsx` | 추가 | 실패 사유 아이콘 5개 포함 |
| `apps/web/src/components/ui/api-map.ts` | 추가 | 카테고리·실행 상태 변환 |
| `apps/web/src/components/ui/__tests__/api.test.tsx`, `components.test.tsx` | 추가 | 브리지·실패 사유·비-HTML 렌더 테스트 |

### 5. 주요 결정과 이유
- **브리지·실패 사유는 API 값 그대로** (갱신된 components.md 10.1·10.3). 매핑 표는 컴포넌트 안(`BRIDGE_BADGE`, `RUN_RESULT_SPEC`)에 한 번만 둔다. 알 수 없는 값은 브리지 `확인 중`(unknown), 실패 사유 `기타`로 표시한다(`Object.hasOwnProperty`로 확인해 `toString` 같은 값에 속지 않음).
- **나머지(카테고리·심각도·출처)는 디자인 키**: 공통 원칙(status.md 8절). 프론트는 `categoryFromApi()`로 `database`→`db`.
- **서버 `errorMessage` 우선, 없으면 기본 문구**: 디자인 표 "설명 칸의 문장은 서버 errorMessage를 그대로". `budget_exceeded`의 안내 2줄은 화면 고정 문구로 덧붙인다.
- **디자인 표의 `` `claude` `` 백틱**: 마크다운을 해석하지 않으므로 기본 문구에서는 백틱을 빼고 `아래 명령으로`로 바꿔 명령 줄(복사 가능)로 안내했다. 서버 `errorMessage`에 백틱이 있으면 문자 그대로 보인다(해석하지 않음).
- **원문 응답**: `hasRawResponse`일 때 프론트가 원문을 받아 `rawResponse`로 넘기면 `<details>` 안 CodeBlock(wrap, 400px)으로 텍스트만 보인다.
- **SuggestionCard 머리 전체 클릭**은 마우스 편의용이고, 키보드·스크린리더용 컨트롤은 오른쪽 `IconButton`(`aria-expanded`, `aria-controls`) 하나다(버튼 중첩 방지).
- **RunProgressPanel 수신 표시**는 이 패널이 `lastReceivedAt`에서 1초마다 계산하지만 aria-live가 아니다(과도한 알림 방지). 수신 표시는 `receivingStepId`(기본 `receive`) 단계가 `active`일 때만 붙는다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm test --prefix apps/web` | 통과 | SuggestionCard·CodeBlock·RunResultAlert 비-HTML 렌더, BridgeStatusBar API 값, budget_exceeded·interrupted·목록 밖 사유 |
| lint / typecheck / build | 통과 | 공통 보고서 참고 |
| 360~1440px 가로 넘침 | 통과 | 미리보기 어드바이저 영역 포함 |

### 7. 남은 이슈·한계
- 분석 이력 표, 사전 점검 결과 표, 보낼 데이터 Drawer는 공통 `DataTable`, `JsonTree`, `Drawer`, `Tabs` 조합으로 frontend가 만든다(전용 컴포넌트 없음).
- 결과 정리 완료 시 패널 200ms 페이드아웃, `방금 완료` 칩 5000ms 표시·제거는 호출 측 몫(`Chip tone="ok"`).
- `SuggestionCard` 필터(카테고리 토글·심각도·출처)는 `FilterBar` + `CategoryChip onClick/pressed` + `MultiSelect` + `SegmentedControl`로 조합한다.

### 8. 다른 담당 요청
- `frontend 요청`: 취소 확인은 `Dialog tone="danger" title="분석을 취소할까요?" confirmLabel="분석 취소" cancelLabel="계속 기다리기" confirmLoading confirmLoadingLabel="취소 중"`.
- `frontend 요청`: R-ID 칩 클릭(`onRuleClick`) 시 사전 점검 표 해당 행으로 스크롤·펼침·1500ms `bg.selected`(DataTable `selectedKey` 사용).

### 9. 다음 담당이 알아야 할 점
| 컴포넌트 | props | 프론트가 넘길 값 |
|---|---|---|
| `BridgeStatusBar` | `bridge`, `message?`, `command?`, `retryAt?`, `checkedAt?`, `onRecheck?()`, `rechecking?`, `runButton?`, `previewButton?`, `runDisabledReason?`, `exampleMode?`, `highlight?` | **API 값 그대로**: `bridge = state`(`connected\|login_required\|usage_limit\|unreachable\|unknown`), `message`·`command`는 서버 값(없으면 기본 문구). 비활성 사유 문구는 architecture-advisor.md 2.2 표 |
| `RunProgressPanel` | `run: {id; startedAt; serverNow?; stage; stages: Step[]; lastReceivedAt?; receivedChars?; delayed; example}`, `onCancel()`, `cancelling?`, `receivingStepId?="receive"`, `streamDisconnected?` | 단계 id 중 수신 단계를 `receive`로(또는 `receivingStepId` 지정) |
| `RunResultAlert` | `reason`, `message?`, `command?`, `rawResponse?`, `retryAt?`, `cancelledAt?`, `onDismiss?()`, `onRetry?()`, `retryDisabled?`, `retryDisabledReason?`, `onRecheck?()`, `onOpenPreview?()` | **API 값 그대로**: `reason = status === "cancelled" ? "cancelled" : failureReason`, `message = errorMessage`. `onRetry`는 사용자가 누를 때만(자동 재시도 금지), 브리지 연결됨이 아니면 `retryDisabled` |
| `SeverityBadge` | `severity: Severity`, `size?: "sm"\|"md"` | 같은 값 |
| `SeverityIcon` | `severity`, `size?: 10\|12\|14` | 이력 `높음 2 · 중간 4` |
| `RiskBadge` | `level: Severity`, `reason?`, `variant?: "outline"\|"text"` | |
| `CategoryChip` | `category: AdvisorCategory`, `size?`, `pressed?`, `onClick?()`, `count?` | `categoryFromApi()` |
| `SourceLabel` | `source: "rule"\|"llm"`, `ruleId?`, `detail?` | 섹션 머리 `detail="LLM 미사용"` |
| `ExampleBadge` | `label?="예시 응답"` | 이력 표는 `label="예시"` |
| `NoExecuteNotice` | 없음 | |
| `SeverityMatrix` | `cells: Record<AdvisorCategory, Record<Severity, number>>`, `onCellClick?(cat, sev)`, `selected?`, `footnote?`, `caption?` | 키는 디자인 키(`db`) |
| `SuggestionCard` | `priority`, `title`, `category`, `severity`, `targets: {name; kind; href?; missing?}[]`, `evidence: {text; field?; value?}[]`, `linkedRules: string[]`, `savings: {monthly; formula; source: "server"\|"llm"} \| null`, `steps: {text; code?: {language?; code}}[]`, `risk: {level; reason}`, `verify?`, `unverified?`, `expanded`, `onToggle()`, `onRuleClick?(id)` | 문자열은 서버 값 그대로(가공·HTML 변환 금지). `href`는 서버가 스냅샷과 대조한 대상만, 스냅샷에 없는 대상은 `missing: true` |
| 이력 상태 배지 | `<StatusBadge size="sm" {...runStatusBadge(run.status)} />` | 사유 열: `RUN_REASON_LABEL[toRunFailReason(failureReason)]` |
