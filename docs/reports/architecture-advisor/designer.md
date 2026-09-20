# architecture-advisor · designer 작업 보고

> 파일 위치: `docs/reports/architecture-advisor/designer.md`
> 공통 토큰·상태 규칙·셸·컴포넌트 작업은 [cluster-status/designer.md](../cluster-status/designer.md)에 있다.

## 2026-09-19 · 2단계 디자인 (architecture-advisor 화면)

### 1. 요청 내용
- PM이 기능 3개 화면 설계를 요청. 이 보고서는 `architecture-advisor` 부분.
- 요구: 분석 실행 버튼, 진행 중 스트리밍 표시(수 분), 브리지 꺼짐/로그인 만료 상태, 제안 카드(제목·카테고리·우선순위·근거·예상 절감액·실행 방법 코드 블록·위험도), 이력 목록, 규칙 기반 사전 점검과 LLM 제안 구분, 심각도·카테고리 색.
- 결정 반영: 스냅샷의 리소스 이름은 원문 전송(가명화 되돌림 UI 불필요).

### 2. 참고한 문서
- `docs/specs/architecture-advisor.md`, `docs/reports/architecture-advisor/planner.md`, `CLAUDE.md`
- 공통 산출물: `docs/design/tokens.json`, `status.md`, `shell.md`, `components.md`

### 3. 작업 내용
1. `docs/design/architecture-advisor.md` 작성: `/advisor`(BridgeStatusBar → RunProgressPanel → 사전 점검 → 최근 분석 결과 → 이력), `/advisor/runs/[id]`(지난 결과), 보낼 데이터 Drawer(640px), 취소 Dialog.
2. 브리지 상태 6행 표(연결됨/로그인 필요/사용량 한도/미실행/확인 중/분석 중 + mock 예시): 배지, 메시지, 복사 가능한 명령 줄(`claude`, `npm run dev --prefix apps/agent-bridge`), 버튼 활성 여부, 비활성 사유 문구.
3. 진행 표시: 5단계 Stepper + 경과 타이머 + 수신 표시(pulse, 마지막 수신 N초 전, 글자 수). LLM 원문 스트림은 화면에 흘리지 않기로 결정. 3분 지연 경고와 취소, 10분 시간 초과, 페이지 이탈 후 복원.
4. 실패·취소 결과 알림 7종(사유별 톤·문구·액션, 자동 재시도 없음, 형식 오류는 접힌 원문 디버그 영역).
5. 사전 점검: 카테고리 × 심각도 매트릭스 + 결과 표(펼침: 대상·근거·계산식), 판단 보류 행, `규칙 기반 · LLM 미사용` 라벨.
6. 제안 카드: 접힘 76px(우선순위 상자, 카테고리·심각도, 제목, 절감액+출처, 대상·위험도·연결 R-ID·AI 제안 라벨) / 펼침(대상, 근거, 절감액+계산식+출처, 실행 방법(NoExecuteNotice 맨 위 + 단계 + CodeBlock 복사), 위험도, 확인 방법, 연결 사전 점검 링크). 근거 확인 불가 변형(점선 경고 테두리 + 맨 아래 구분 머리).
7. 토큰: `color.*.advisor.severity`(높음=장애색, 중간=주의색, 낮음=info 파랑), `category` 5색(상태색과 겹치지 않게 청록·남보라·분홍·슬레이트·갈색), `source`(rule 채움/llm 외곽선), `noExecute`.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/design/architecture-advisor.md` | 추가 | 화면 설계 |
| `docs/design/components.md` 10절 | 추가 | 어드바이저 전용 컴포넌트 10개 (공통 파일) |
| `docs/design/tokens.json` `color.*.advisor` | 추가 | 심각도·카테고리·출처·실행 안 함 안내 색 |
| `docs/reports/architecture-advisor/designer.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **LLM 응답 원문을 진행 중에 흘려 보이지 않음** / 대안: 토큰 스트림 미리보기 / 이유: 검증 전 텍스트는 형식이 깨지거나 스냅샷에 없는 리소스를 말할 수 있다(명세 3.5 검증은 결과 정리 단계). 진행감은 단계·경과·수신 활동으로 충분.
- **심각도 배지(채움)와 위험도 배지(외곽선 + 방패 아이콘)를 모양으로 구분** / 이유: 둘 다 높음/중간/낮음이라 한 카드 안에서 혼동된다.
- **사전 점검과 AI 제안을 섹션으로 분리 + 출처 라벨** / 이유: 결정적 결과와 LLM 결과의 신뢰 수준이 다르다.
- **카테고리 색에 빨강·노랑·초록을 쓰지 않음** / 이유: 상태 색과 혼동 방지. 아이콘 + 문구 병기.
- **분석 실패해도 이전 성공 결과를 유지** / 이유: 브리지 문제로 가치 있는 과거 결과가 사라지면 안 된다.
- **mock + 브리지 없음이면 분석 버튼 활성(`예시 분석 실행`)** / 이유: 명세 수용 기준 "예시 응답으로 전체 흐름 재현".
- **실행·적용 버튼 없음, NoExecuteNotice를 실행 방법 블록 맨 위에 고정** / 이유: 명세 조회 전용 원칙과 수용 기준.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| 명세 수용 기준 대조 | 수동 | 브리지 미실행 안내·버튼 비활성, 로그인 만료 문구·자동 재시도 없음, 지연 3분 안내+취소, 10분 실패, 취소 이력, 제안 필수 필드 표시, 절감액 추정 라벨·계산식·출처, 근거 확인 불가 맨 아래, 중복 대신 R-ID 연결, "실행하지 않습니다" 문구, 보낼 데이터 전체 미리보기, 예시 응답 배지 — 위치 지정 확인 |
| 실행 검증 | 해당 없음 | 문서 작업 |

### 7. 남은 이슈·한계
- 수신 글자 수·마지막 수신 시각은 브리지·API가 진행 이벤트로 준다는 가정. 없으면 해당 표시만 생략.
- 사용량 한도 해제 시각은 브리지가 알 때만 표시.
- 명세 가정 D3 문구("Q1이 가명화로 정해지면")는 결정(원문 전송)으로 닫혔다. 보낼 데이터 안내 문구에 "이름은 원문 그대로 전송" 명시.

### 8. 다른 담당 요청
- `backend 요청`(계약): SSE 진행 이벤트에 `stage`, `stageStartedAt`, `lastReceivedAt`, `receivedChars`(선택), `delayed`; 실패 `reason` enum(bridgeDown/loginRequired/rateLimited/timeout/badFormat/cancelled/other); 제안의 `targets[].inSnapshot`(링크 생성 판단), `evidence[].field/value`, `savings.source`(server/llm), `unverified`; 결과 신선도 사유 문자열; 스냅샷 미리보기 크기·가림·생략 수; 브리지 `retryAt`.
- `frontend 요청`: LLM 출력 텍스트 노드 렌더(마크다운·HTML·자동 링크 금지), 진행 중 재진입 시 서버 상태로 패널 복원, 사이드바 `busy` 표시.

### 9. 다음 담당이 알아야 할 점
- 화면에 적용·실행 버튼을 추가하지 않는다. 복사만 허용.
- 사전 점검 절감액은 모두 서버 계산 추정(`≈`, `추정` 배지). LLM 계산값은 `LLM 추정` 배지 + 계산식 필수, 단가 근거 없으면 절감액 칸을 비운다.

## 2026-09-19 · API 계약 반영 (실패 사유 `budget_exceeded`, API 값 매핑표)

### 1. 요청 내용
- backend → designer(PM 전달): `docs/api/architecture-advisor.md` 실패 사유 enum에 `budget_exceeded`(비용 상한 초과, 기본 $2.00) 추가 → RunResultAlert 표에 행 추가(문구·아이콘·안내).
- API 상태 키 `ok|warning|critical|unknown`, 금액 kind `estimated|actual|forecast` → 디자인 키와의 매핑표를 `status.md`에 추가(프론트 매핑용).

### 2. 참고한 문서
- `docs/api/architecture-advisor.md` (A.1 타입, A.9 실패 사유 ↔ 화면, C절 limits), `docs/api/common.md` (Status, MoneyKind, stale 규칙)

### 3. 작업 내용
1. `docs/design/architecture-advisor.md` 2.4 RunResultAlert 표를 다시 썼다. API 값 열(`status` / `failureReason`)과 아이콘 열 추가, API 사유 이름(`bridge_unavailable`, `usage_limit`, `invalid_response`)에 맞춤.
   - 새 행 `budget_exceeded`: tone warn, 아이콘 `wallet`, 제목 `분석 실패 · 비용 상한 초과`, 설명은 서버 `errorMessage`, 고정 안내 2줄(스냅샷 크기 확인 / 상한 설정 `advisor.limits.maxBudgetUsd`(기본 $2.00), 구독 로그인이면 사용량 보호용), 액션 `보낼 데이터 보기` + `다시 분석`(자동 재시도 없음).
   - API에 있으나 디자인에 없던 `interrupted` 행도 추가: crit, `rotate-ccw`, `분석 실패 · 서버 재시작으로 중단`.
   - 모든 행에 아이콘 지정(`key-round`, `unplug`, `hourglass`, `timer-off`, `file-warning`, `wallet`, `rotate-ccw`, `square`, `octagon-x`). 이력 표 사유 열 문구 규칙, 알 수 없는 값은 `기타`.
2. `docs/design/status.md` 8절 추가: 8.1 상태(`warning→warn`, `critical→crit`, `stale: true` → 배지 키 `stale` + `previousStatus`), 8.2 금액(`estimated→estimate`, `actual→confirmed`, `forecast→forecast`, 어드바이저 `savings.source` server/llm → `estimate`/`llmEstimate`, `projectedBasis` → BudgetGauge), 8.3 어드바이저(BridgeState, Category `database→db`, Severity, 출처, RunStatus, failureReason). 문서 머리에 8절 안내 한 줄.
3. `docs/design/components.md`: `RunResultAlert.reason`을 API `failureReason` 값 그대로로 바꾸고 `command?`, `onOpenPreview?` 추가. `BridgeStatusBar.bridge`를 API `BridgeState` 값으로 변경. 아이콘 목록에 실패 사유 아이콘 5개 추가.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/design/architecture-advisor.md` | 수정 | 2.4 RunResultAlert 표 (API 값·아이콘 열, `budget_exceeded`·`interrupted` 행) |
| `docs/design/status.md` | 수정 | 머리 안내 1줄, 8절 API 값 ↔ 디자인 키 매핑 |
| `docs/design/components.md` | 수정 | 10.1 bridge 타입, 10.3 RunResultAlert props, 11절 아이콘 |
| `docs/reports/architecture-advisor/designer.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유
- **`budget_exceeded`는 crit가 아니라 warn** / 이유: 고장이 아니라 설정한 안전장치가 의도대로 동작한 결과이고, 사용자가 스냅샷 크기나 상한을 조정해 해결할 수 있다.
- **디자인 키는 유지하고 매핑표로 연결** / 대안: 디자인 문서 전체를 API 값으로 치환 / 이유: `warn`/`crit`/`estimate`/`confirmed`는 이미 토큰 경로(`color.*.status.warn` 등)라 바꾸면 퍼블리셔 CSS 변수 이름까지 흔들린다. API 문서(`common.md`)도 프론트 매핑을 전제로 결정했다.
- **컴포넌트 props 중 어드바이저 enum(bridge, failureReason)은 API 값 그대로 받게 변경** / 이유: 색 토큰과 무관한 값이라 변환 단계를 두면 오류 지점만 늘어난다. 상태·금액 kind는 토큰 키라 변환을 유지한다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| API 문서 대조 | 수동 | A.9 표의 9개 `status`/`failureReason` 조합이 디자인 표에 모두 있는지, common.md Status·MoneyKind 값이 8절에 모두 있는지 확인 |

### 7. 남은 이슈·한계
- 브리지 토큰 불일치 메시지(API A.3.1, `unreachable` + 별도 메시지) 표시 위치: 별도 행을 만들지 않고 BridgeStatusBar의 `미실행` 상태 메시지 자리에 서버 `message`를 그대로 보인다(명령 줄은 `command`가 있을 때만). API 보고 C.5의 두 번째 요청에 대한 답.

### 8. 다른 담당 요청
- 없음.

### 9. 다음 담당이 알아야 할 점
- 프론트는 API 응답을 받는 지점에서 `status.md` 8절 표로 한 번만 변환한다. 표에 없는 값은 `unknown` / `—`.
