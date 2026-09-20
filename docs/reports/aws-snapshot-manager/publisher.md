# aws-snapshot-manager · publisher 작업 보고

## 2026-09-19 18:57 · UI 컴포넌트 구현 (새 6종 + 기존 확장 7건 + 아이콘 14개)

### 1. 요청 내용
- PM 요청: `aws-snapshot-manager` 표현 계층 UI 컴포넌트 구현(데이터·상태 로직 없음).
  - 새 컴포넌트 6종: CodeEditor, ScanFindingList(default/compact), ScanCounts, TextField/TextArea, TypeToConfirmDialog, CommandSteps
  - 기존 확장 7건: NavItem `count`·`statusLabel`(PM 결정: status 가 없으면 상태 아이콘 생략), SummaryStrip, DataTable `comfortable`, TabItem, KeyValueList `note`, Dialog `confirmDisabled`·`confirmDisabledReason`·`initialFocus`, DataSourceBadge 스냅샷 그룹. 하위 호환 유지
  - 아이콘 14개 등록
  - designer 요청: `advisor/`의 `CommandLine`을 공용 위치로 옮길지 판단
  - CodeEditor 는 편집 라이브러리에 독립적인 래퍼로, 가상 렌더링·편집 엔진을 꽂을 인터페이스를 명확히(라이브러리 설치 금지)
- 쓰기 영역: `apps/web/src/components/ui/**`, `apps/web/src/styles/**`

### 2. 참고한 문서
- `docs/design/aws-snapshot-manager.md` (전체, 특히 2·3·4·5·6·10·11절)
- `docs/design/components.md` 11절(새 컴포넌트)·12절(기존 확장)·13절(아이콘)
- `docs/design/status.md` 1.2(대체 문구 `커밋 금지`)·1.3·9절
- `docs/design/shell.md` 3절(메뉴 9번, 숫자 배지)
- `docs/specs/aws-snapshot-manager.md` (라벨 60자·메모 2000자)
- `docs/api/aws-snapshot-manager.md` (라벨·메모 길이는 JS 문자열 길이), `docs/api/common.md` 6절(mock 그룹 키 `snapshots`)
- `docs/reports/aws-snapshot-manager/designer.md` (publisher 요청)
- 기존 `apps/web/src/components/ui/**`, `apps/web/src/styles/**` 관례

### 3. 작업 내용
1. **공통 타입·아이콘**
   - `types.ts`: `StatusAltLabel`에 `커밋 금지` 추가(status.md 1.2), `ScanLevel = "error" | "warn"` 추가.
   - `icons.tsx`: 13절 아이콘 14개 등록(`archive`, `tag`, `trash-2`, `undo-2`, `pencil`, `save`, `terminal`, `folder`, `file-x`, `file-question`, `file-pen`, `sticky-note`, `wrap-text`, `lock`). `file-question`은 lucide 1.47 의 `FileQuestionMark`로 매핑.
2. **CommandLine 공용화**: `layout/CommandLine.tsx`로 옮기고 CSS(`.cmd`, `.cmdCode`)도 `layout.module.css`로 이동. `advisor/BridgeStatusBar.tsx`에서 `export { CommandLine } from "../layout/CommandLine"` 로 다시 내보내 기존 import 경로 유지. `index.ts`는 새 위치에서 내보냄(이름 동일). 새 props: `copyLabel`, `fullWidth`. 명령 `<code>`는 가로 스크롤 영역이라 `tabIndex=0` 추가.
3. **새 컴포넌트**
   - `snapshot/CodeEditor.tsx` + `snapshot/codeEditorModel.ts`: 틀(CodeEditor) / 엔진(PlainCodeEngine) 분리. 11.1 props 전부 + `targetKey`(같은 줄 재이동), `engine`(엔진 교체). 줄 분할·장식·가상 렌더링 범위·1/3 스크롤·안내 문구는 순수 함수로 분리.
   - `snapshot/ScanFindingList.tsx`: `<ul>` + 이동 가능 항목 `<button>`(aria-label, aria-current) / 비이동 `<div>`(hint·action 3줄). default 52px 2줄, compact 32px 1줄, `maxItems` → `외 N건`, `maxHeight` 스크롤.
   - `snapshot/ScanCounts.tsx`: sm/md, inline/stacked, ready/unknown/stale. 0 등급 생략, 둘 다 0 이면 `발견 없음`, 두 값 null 이면 `스캔할 수 없음`. 스크린리더 한 문장(`현재 스캔 오류 2건, 경고 1건`).
   - `snapshot/scan.ts`: `SCAN_LEVEL`, `scanLevelSpec`(모르는 값 → 알 수 없음 + 콘솔 경고 1회), `worstScanLevel`.
   - `controls/TextField.tsx`: `TextField`, `TextArea`. 상한 초과 입력(붙여넣기 포함)은 잘라 넣지 않고 거부 + `onOverflow` 콜백, `showCount` 카운터(상한 도달 시 warn 색), `error`(danger 테두리+아이콘+aria-invalid), `invalid`(문구 없이 crit 테두리: 비밀값 거부용), `mono`, `hideLabel`, 네이티브 속성 통과.
   - `overlay/TypeToConfirmDialog.tsx`: Dialog md danger 기반. 열릴 때 입력 초기화·포커스, 앞뒤 공백 제거 후 정확히 일치할 때만 확인 활성(`aria-disabled` + 사유 `스냅샷 ID를 입력하세요`), Enter 는 일치할 때만(IME 조합 중 무시), `autocomplete=off`·`spellcheck=false`, `error` → 본문 맨 위 InlineAlert crit.
   - `layout/CommandSteps.tsx`: `<ol>`, 번호 원 20px + 제목(titleWidth) + CommandLine/텍스트. 1280px 미만 세로 쌓기. 명령은 텍스트로만(실행 수단 없음).
4. **기존 확장 (모두 선택 prop, 기본값은 기존 동작)**
   - `SideNav` `NavItem.count`·`statusLabel`: 숫자 배지(18px pill, status 색, 99+ , aria-hidden), 스크린리더 `, 커밋 금지 2개`, 접힘 툴팁 `AWS 스냅샷 · 커밋 금지 2개`, 접힘 모드에선 숨김. **status 가 없으면 상태 아이콘 없이 숫자만(중립색)**. `DEFAULT_NAV_ITEMS`에 9번 `AWS 스냅샷`(`/snapshots`, `archive`, 그룹 `로컬 파일`) 추가. `formatNavCount` export.
   - `SummaryStrip`: `overall.label`(StatusAltLabel, aria-live 문구에도 반영), `updatedLabel`, `actions`, `updatedExtra`.
   - `DataTable`: `density="comfortable"`(56px, 셀 위아래 8px, 가상 스크롤 행 높이 56px) + 2줄 셀 도우미 `TwoLineCell`.
   - `Tabs` `TabItem`: `dirty`(8px accent 점 + sr `저장 안 됨`), `suffix`·`suffixIcon`·`suffixTone`, `mono`, `countLabel`(sr `, 발견 1건`).
   - `KeyValueList` item `note`: `{ tone: "warn"|"info"|"crit"; text }`, 아이콘 12px + 문구, 스크린리더 앞말(`주의:`/`참고:`/`문제:`).
   - `Dialog`: `confirmDisabled`, `confirmDisabledReason`(Button disabledReason → 툴팁 + aria-describedby), `initialFocus: "cancel"|"confirm"|"content"`(content: `[data-autofocus]` → 첫 입력 → 첫 포커스 가능 요소).
   - `DataSourceBadge`: `SCENARIO_GROUPS`에 `snapshots` 추가(맨 뒤, 라벨 `AWS 스냅샷`).
5. **미리보기**: `__preview__/SnapshotPreview.tsx` 추가, `/dev/ui`(UiPreview) 끝에 붙임. 사이드바 미리보기에 AWS 스냅샷 crit + 숫자 2.
6. **테스트**: `__tests__/snapshot.test.tsx` 35건 추가. `frontend-requests.test.tsx`의 SCENARIO_GROUPS 기대값에 `snapshots` 반영.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/types.ts` | 수정 | `커밋 금지` 대체 문구, `ScanLevel` |
| `apps/web/src/components/ui/icons.tsx` | 수정 | 아이콘 14개 |
| `apps/web/src/components/ui/index.ts` | 수정 | 새 컴포넌트·타입 export, CommandLine 경로 변경 |
| `apps/web/src/components/ui/layout/CommandLine.tsx` | 추가 | 공용 CommandLine |
| `apps/web/src/components/ui/layout/CommandSteps.tsx` | 추가 | 11.6 |
| `apps/web/src/components/ui/layout/Tabs.tsx` | 수정 | TabItem 확장 |
| `apps/web/src/components/ui/layout/layout.module.css` | 수정 | CommandLine·CommandSteps·탭 확장 스타일 |
| `apps/web/src/components/ui/advisor/BridgeStatusBar.tsx` | 수정 | CommandLine re-export (하위 호환) |
| `apps/web/src/components/ui/advisor/RunResultAlert.tsx` | 수정 | CommandLine import 경로 |
| `apps/web/src/components/ui/advisor/advisor.module.css` | 수정 | `.cmd*` 제거(layout 으로 이동) |
| `apps/web/src/components/ui/snapshot/CodeEditor.tsx` | 추가 | 11.1 틀 + 기본 엔진 |
| `apps/web/src/components/ui/snapshot/codeEditorModel.ts` | 추가 | 줄 분할·장식·가상 범위 순수 함수 |
| `apps/web/src/components/ui/snapshot/ScanFindingList.tsx` | 추가 | 11.2 |
| `apps/web/src/components/ui/snapshot/ScanCounts.tsx` | 추가 | 11.3 |
| `apps/web/src/components/ui/snapshot/scan.ts` | 추가 | 스캔 등급 매핑(status.md 9.2) |
| `apps/web/src/components/ui/snapshot/snapshot.module.css` | 추가 | 위 3종 스타일 |
| `apps/web/src/components/ui/controls/TextField.tsx` | 추가 | 11.4 |
| `apps/web/src/components/ui/controls/controls.module.css` | 수정 | TextField/TextArea 스타일 |
| `apps/web/src/components/ui/overlay/TypeToConfirmDialog.tsx` | 추가 | 11.5 |
| `apps/web/src/components/ui/overlay/Dialog.tsx` | 수정 | confirmDisabled·confirmDisabledReason·initialFocus |
| `apps/web/src/components/ui/overlay/overlay.module.css` | 수정 | TypeToConfirm 본문 간격 |
| `apps/web/src/components/ui/shell/SideNav.tsx` | 수정 | count·statusLabel, 9번 메뉴, formatNavCount |
| `apps/web/src/components/ui/shell/shell.module.css` | 수정 | 숫자 배지 |
| `apps/web/src/components/ui/shell/DataSourceBadge.tsx` | 수정 | `snapshots` 그룹, `ScenarioGroupKey` |
| `apps/web/src/components/ui/shell/TopBar.tsx` | 수정 | onScenarioChange 타입(하위 호환) |
| `apps/web/src/components/ui/status/SummaryStrip.tsx` | 수정 | overall.label·updatedLabel·actions·updatedExtra |
| `apps/web/src/components/ui/status/status.module.css` | 수정 | 시각 오른쪽 액션 자리 |
| `apps/web/src/components/ui/table/DataTable.tsx` | 수정 | comfortable, TwoLineCell |
| `apps/web/src/components/ui/table/KeyValueList.tsx` | 수정 | note |
| `apps/web/src/components/ui/table/table.module.css` | 수정 | comfortable·2줄 셀·note |
| `apps/web/src/components/ui/__preview__/SnapshotPreview.tsx` | 추가 | 미리보기 |
| `apps/web/src/components/ui/__preview__/UiPreview.tsx` | 수정 | 미리보기 연결, 사이드바 예시 |
| `apps/web/src/components/ui/__tests__/snapshot.test.tsx` | 추가 | 35건 |
| `apps/web/src/components/ui/__tests__/frontend-requests.test.tsx` | 수정 | SCENARIO_GROUPS 기대값 |

`apps/web/src/styles/**`는 바꾸지 않았다(새 토큰 없음, 기존 변수만 사용).

### 5. 주요 결정과 이유
- **CodeEditor = 틀 + 엔진 분리**
  - 틀(CodeEditor)이 맡는 것: 테두리·안쪽 2px 포커스 표시(`::after`), 잠금, 로딩 스켈레톤 12줄, 키 규칙(Tab/Shift+Tab/Esc→Tab/Ctrl·Cmd+S), 줄 장식 계산(`buildDecorations`: 한 줄 여러 마커는 최악 등급, 툴팁 줄), 이동 대상 처리(스크롤 1/3 + 포커스 + 안내 문구), 접근성 라벨.
  - 엔진이 맡는 것: 텍스트 렌더링·입력·스크롤. 인터페이스 `CodeEditorEngineProps`(value, lines, mode, editable, locked, wrap, indentUnit, decorations, ariaLabel, onChange, onKeyDown → `"indent"|"outdent"|null`, engineRef) / `CodeEditorEngineHandle`(`scrollToLine(line)`, `focus()`).
  - 기본 엔진 `PlainCodeEngine`(라이브러리 없음): 보이는 줄만 DOM(위아래 spacer, overscan 20). 보기 모드는 스크롤 영역 자체가 `role=textbox aria-readonly`. 편집 모드는 전체 높이 투명 `<textarea wrap=off>`를 본문 칸 위에 겹치고 아래층에 gutter·줄 배경만 가상 렌더링(20px 고정 줄이라 1:1 정렬). gutter 는 `position: sticky; left: 0`로 가로 스크롤해도 고정.
  - 대안: CodeMirror 6 / Monaco 를 바로 쓰기 → 설치는 frontend 몫이라 제외. 기본 엔진만으로도 명세 동작(가상 렌더링, 발견 줄, 이동, Tab, 저장 단축키, 잠금)은 된다. 라이브러리를 쓰면 `engine`에 렌더 함수를 넘기면 된다.
- **기본 엔진은 편집 중 줄 바꿈 미지원**(`PLAIN_ENGINE_WRAP_IN_EDIT = false`): textarea 의 줄 바꿈 위치를 gutter 와 맞출 방법이 없어서. `wrap=true`여도 edit 에서는 줄 바꿈 없이 그린다(`data-wrap="false"`). 보기 모드 줄 바꿈은 폭으로 줄 높이를 추정하고 흐름 배치라 겹치지 않는다(스크롤 막대 길이만 근사, 이동 시 실제 요소 위치로 한 번 더 보정).
- **CRLF**: 줄 분할은 CRLF·CR·LF 모두 줄바꿈. 기본 엔진 편집 값은 브라우저 textarea 규칙대로 LF 로 정규화되어 onChange 로 나간다(줄 수 1:1). 원본 줄바꿈 복원은 계약에 따른다.
- **gutter 아이콘 툴팁은 hover 전용**: 디자인은 hover·포커스. gutter 아이콘을 탭 정지점으로 만들면 편집 중 `Esc→Tab`으로 나갈 때 줄마다 멈춰 키보드 흐름이 깨진다. 키보드 사용자는 ScanFindingList(주 신호)와 이동 안내 문구로 같은 정보를 얻는다.
- **CommandLine 을 `layout/`로 이동**: 이제 advisor·스냅샷 두 기능이 쓰는 범용 컴포넌트라서. 기존 `advisor/BridgeStatusBar` 경로는 re-export 로 유지했고, `features/**`는 `@/components/ui` 경로만 써서 import 수정이 필요 없다.
- **DataSourceBadge 하위 호환 타입**: `SCENARIO_GROUPS`에 `snapshots`를 넣으면 기존 `ScenarioGroup` 타입이 넓어져 `features/shell/ShellClient.tsx`(`mock.change(group: MockGroupId)`)가 타입 오류가 난다. 그래서 `ScenarioGroup`은 기존 4개 그대로 두고, 전체 키 `ScenarioGroupKey`를 새로 만들고, `onScenarioChange`를 메서드 표기(매개변수 bivariant)로 바꿔 기존 핸들러가 그대로 들어가게 했다. 실제로 넘어오는 값에는 `snapshots`가 포함된다.
- **NavItem**: `statusLabel`은 문자열 하나라 상태별 분기를 하지 않는다. 호출 측이 crit 일 때만 `커밋 금지`를 넘긴다. status 가 없으면(현재 frontend 매핑에 `/snapshots`가 없음) 상태 아이콘 없이 그려지고, count 만 있으면 중립색 숫자만.
- **DEFAULT_NAV_ITEMS에 9번 메뉴 추가**: shell.md 3.1 기본 항목이라 퍼블리셔 목록에 넣었다. 이 때문에 `/snapshots` 페이지가 생기기 전까지 사이드바 링크가 404 로 갈 수 있다(아래 frontend 요청).
- **TextField 상한**: 네이티브 `maxLength`는 붙여넣기를 잘라 넣어 디자인(잘라 넣지 않고 거부 + 오류)과 달라서 쓰지 않았다. 길이는 계약대로 JS 문자열 길이.
- **Dialog 포커스 기본값**: 기존과 같다(danger → 취소, 그 밖 → 확인). 단 확인 버튼이 없는 창(충돌 등)은 이전에는 아무것도 autoFocus 하지 않았는데 이제 닫기 버튼에 포커스한다(showModal 기본 동작과 결과가 같거나 더 명확함).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 errors, 0 warnings) | |
| `npx tsc --noEmit -p apps/web` | 퍼블리셔 영역 오류 0건 / 전체 3건 실패 | 남은 3건은 `src/features/__fixtures__/fixtures.ts`(aws-cost 타입 `CeRefresh`·`CostEstimate`·`CostActual` 필드 누락). 이번 작업과 무관한 기존 오류(frontend 영역) |
| `npx vitest run` (apps/web 전체) | 153 passed | 새 `snapshot.test.tsx` 35건 포함 |
| `/dev/ui` SSR 확인 | 200, 스냅샷 미리보기·`terraform.tf 내용`·`커밋 금지 2개` 렌더 확인 | 포트 3010 으로 `next dev`를 띄웠으나 다른 에이전트의 dev 서버(PID 8756, :3100)가 같은 디렉터리에서 실행 중이라 Next 가 새 서버 시작을 거부하고 스스로 종료함. 그 서버에 GET 으로만 확인. 내가 띄운 프로세스는 남아 있지 않음 |
| 실제 브라우저 시각 확인(360·1024·1440px, 다크 테마, 20MB 스크롤 성능) | **생략** | 브라우저 도구 없음. jsdom 에서는 레이아웃 측정이 안 됨 → frontend 통합 후 PM/프론트 확인 필요 |

### 7. 남은 이슈·한계
- 기본 엔진 성능: 편집 시 입력마다 전체 값을 `split`·폭 계산한다(편집 상한 5MB 기준 수십 ms 예상, 실측 안 함). 보기 모드 20MB 는 가상 렌더링이라 DOM 은 작지만 최초 `split`에 수백 ms 걸릴 수 있다(실측 안 함).
- 기본 엔진 보기 모드는 보이는 줄만 DOM 에 있어, 드래그 선택으로 화면 밖 줄까지 복사할 수 없다. 전체 복사는 CopyButton 등으로 제공 필요.
- 기본 엔진은 편집 중 줄 바꿈 미지원(5절). 매우 긴 한 줄에서 한글·이모지 폭 추정이 틀리면 textarea 안에서 가로로 조금 잘릴 수 있다.
- 줄 번호 기준 `CR`(단독) 줄바꿈은 서버 스캐너의 줄 계산과 다를 수 있다(계약 확인 필요, 드문 경우).
- Button 이 `disabledReason` 유무에 따라 Tooltip 래퍼를 붙였다 떼어 버튼 DOM 이 다시 만들어진다(기존 동작). 확인 버튼에 포커스가 있는 상태에서 비활성↔활성이 바뀌면 포커스를 잃을 수 있다. TypeToConfirmDialog 는 포커스가 입력에 있어 영향 없음.
- 실제 화면(360~1440px, 다크) 시각 검증 안 함.

### 8. 다른 담당 요청
- `frontend 요청`: `features/common/types.ts` `MockGroupId`에 `"snapshots"` 추가. 그 뒤 `ScenarioGroupKey`를 써도 된다(지금은 하위 호환 타입으로 오류 없음). `features/shell/mock-scenarios.ts`는 이미 `SCENARIO_GROUPS` 기준으로 걸러서 `snapshots` 그룹도 배지에 나온다.
- `frontend 요청`: `DEFAULT_NAV_ITEMS`에 `/snapshots`(AWS 스냅샷)가 추가됐다. `features/shell/nav.ts` `HREF_TO_KEY`에 매핑이 없어 지금은 상태 없이 그려진다. 스냅샷 메뉴 요약(`aws-snapshots` 토픽)으로 `status`·`statusLabel: "커밋 금지"`(crit 일 때만)·`count`를 넣고, `/snapshots` 페이지를 만들 때까지 링크가 404 인 점 확인.
- `frontend 요청`: 편집 라이브러리(CodeMirror 6 등)를 쓰기로 하면 `CodeEditor`의 `engine` prop 에 어댑터를 넘긴다. 어댑터가 지켜야 할 것: `decorations`로 줄 배경·gutter 아이콘·이동 대상 표시, `onKeyDown` 호출 후 반환값이 indent/outdent 일 때만 들여쓰기, `engineRef`에 `scrollToLine`·`focus` 구현, 입력 요소에 `ariaLabel`, `locked`면 readOnly. 스타일 클래스가 필요하면 퍼블리셔에 요청. 기본 엔진을 그대로 쓰면 편집 중 줄 바꿈 토글을 비활성(사유 예: `편집 중에는 줄 바꿈을 쓸 수 없음`)으로 두거나 숨기는 것을 권장.
- `frontend 요청`: `src/features/__fixtures__/fixtures.ts` 타입 오류 3건(aws-cost 계약 필드 `maxCallsPerRefresh`·`refreshEstimatedCostUsd`·`stale`·`staleReason` 누락) 정리.
- `designer 요청`(확인만): ① gutter 아이콘 툴팁을 hover 전용으로 둔 점(키보드 대체: 발견 목록·이동 안내) ② 기본 엔진 편집 중 줄 바꿈 미지원 시 툴바 표시 방식.

### 9. 다음 담당이 알아야 할 점
- 모두 `@/components/ui`에서 import. 주요 인터페이스:
  - `CodeEditor({ value, fileName, mode?, locked?, onChange?, markers?, targetLine?, targetKey?, onTargetAnnounce?, wrap?, indentUnit?, onSaveShortcut?, height?, highlightLine?, state?, engine?, className? })`
    - `markers: { line; level: "error"|"warn"; items: { ruleId; description }[] }[]` — 편집 중에도 **마지막 저장 기준 줄 번호**를 그대로 넘긴다.
    - 같은 줄로 다시 이동하려면 `targetKey`를 바꾼다(예: 클릭 횟수). `onTargetAnnounce`를 안 주면 내부 polite live 영역에서 읽는다.
    - `height` 기본값 `CODE_EDITOR_DEFAULT_HEIGHT`(`clamp(480px, calc(100vh - 176px), 960px)`). 가상 렌더링에 정해진 높이가 필요하다.
    - `markers` 배열은 매 렌더 새로 만들지 말고 memo 권장(장식 재계산 방지).
    - 툴바 안내 `Esc 후 Tab: 편집 영역 나가기`, 탭·툴바·알림 슬롯은 밖에서 조립.
  - `ScanFindingList({ findings: ScanFinding[], variant?, selectedId?, onSelect?, maxItems?, maxHeight?, label? })` — `ScanFinding = { id, level, file, line, ruleId, description, navigable, hint?, action? }`. 서버 순서 그대로.
  - `ScanCounts({ errors, warnings, size?, layout?, state?, unknownText?, srPrefix? })`
  - `TextField` / `TextArea({ label, value, onChange, maxLength?, onOverflow?, showCount?, placeholder?, hint?, error?, invalid?, mono?, disabled?, hideLabel?, ... })` — 상한 초과 시 `onOverflow`에서 `error`를 세팅한다(`라벨은 60자까지 입력할 수 있습니다`). 입력이 다시 바뀌면 호출 측이 error 를 지운다.
  - `TypeToConfirmDialog({ open, onClose, title, description?, expected, inputLabel, confirmLabel, confirmLoadingLabel?, cancelLabel?, mismatchReason?, loading?, error?, onConfirm, children? })`
  - `CommandSteps({ steps: { id, title, command?, text? }[], titleWidth?, label? })`, `CommandLine({ command, copyLabel?, fullWidth? })`
  - `NavItem.count?`, `NavItem.statusLabel?` / `SummaryStrip overall.label?`, `updatedLabel?`, `actions?`, `updatedExtra?` / `DataTable density="comfortable"` + `TwoLineCell({ primary, secondary?, strong?, truncate? })` / `TabItem.dirty?`, `suffix?`, `suffixIcon?`, `suffixTone?`, `mono?`, `countLabel?` / `KeyValueItem.note?` / `Dialog confirmDisabled?`, `confirmDisabledReason?`, `initialFocus?` / `SCENARIO_GROUPS`에 `snapshots`, `ScenarioGroupKey`.
  - 도우미: `scanLevelSpec`, `worstScanLevel`(탭 status 계산용: error→crit, warn→warn), `splitLines`, `findingAriaLabel`, `matchesExpected`, `formatNavCount`.
- 디자인의 `hideConfirm`(Dialog)은 기존대로 `confirmLabel`을 생략하면 된다.
- 미리보기: `/dev/ui` 맨 아래 "AWS 스냅샷" 섹션.

## 2026-09-19 19:44 · 프론트 통합 후 publisher 요청 4건

### 1. 요청 내용
- PM이 전달한 frontend 요청(`docs/reports/aws-snapshot-manager/frontend.md` 8절). 기존 동작은 그대로 유지할 것:
  1. `IconButton`에 `disabledReason` 추가
  2. 링크 모양 ghost 버튼(목록 헤더 `휴지통 N`)
  3. `Chip`에 `tooltip` prop 추가
  4. `Card`에 편집 모드 테두리 variant 추가
- 서버는 띄우지 않는다.

### 2. 참고한 문서
- `docs/design/aws-snapshot-manager.md` 3.1(PageHeader `휴지통` ghost md + 숫자 caption), 3.4·3.5(동작 버튼 비활성 사유 툴팁·`aria-disabled`·`text.disabled`), 4.8·5.3(칩 툴팁), 5.3(편집 중 Card 2px `accent.default`)
- `docs/design/components.md` 4.1·4.2·2.7·8.2
- `docs/reports/aws-snapshot-manager/frontend.md` 5·8절

### 3. 작업 내용
1. `IconButton`: 새 prop `disabledReason?: string`. `disabled`와 `disabledReason`을 같이 주면 다음처럼 동작한다.
   - 네이티브 `disabled` 대신 `aria-disabled="true"`를 달아 포커스를 받을 수 있게 둔다.
   - 툴팁에 `라벨 · 사유`를 보이고, 사유를 sr-only 로 넣어 `aria-describedby`로 연결한다.
   - 색은 `text.disabled`, 클릭은 무시한다.
   - 사유 없이 `disabled`만 주면 기존대로 네이티브 disabled 다. 호출 측이 `aria-disabled`를 직접 넘기면 그 값을 그대로 둔다(통합 중에 이 값을 덮어쓰는 문제를 발견해 고쳤다).
2. `ButtonLink`(새 파일 `controls/ButtonLink.tsx`): next/link `<a>`에 Button과 같은 크기·변형 클래스를 입힌다. 기본값은 ghost md. `suffix`(caption `text.tertiary`)와 `suffixLabel`(sr 문구)을 받는다. 전역 `a`/`a:hover` 링크 색이 버튼 글자색을 덮지 않도록 변형별 색을 다시 지정했다.
3. `Chip`: 새 prop `tooltip?: ReactNode`. 링크 칩이 아니고 제거 버튼도 없으면 Tooltip 래퍼가 포커스를 받는다(`tabIndex=0`). 제거 버튼이 있거나 링크 칩이면 래퍼는 포커스를 받지 않는다. tooltip 이 없으면 마크업은 기존과 같다.
4. `Card`: 새 prop `editing?: boolean`. 1px 테두리 `accent.default`에 바깥 1px 그림자를 더해 2px로 보이게 했고, 레이아웃은 흔들리지 않는다. `data-editing="true"`도 단다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/controls/IconButton.tsx` | 수정 | `disabledReason` |
| `apps/web/src/components/ui/controls/ButtonLink.tsx` | 추가 | 버튼 모양 링크 |
| `apps/web/src/components/ui/controls/controls.module.css` | 수정 | `.ibDisabled`, `.buttonLink*` |
| `apps/web/src/components/ui/status/Chip.tsx` | 수정 | `tooltip` |
| `apps/web/src/components/ui/status/status.module.css` | 수정 | `.chipTipAnchor` |
| `apps/web/src/components/ui/layout/Card.tsx` | 수정 | `editing` |
| `apps/web/src/components/ui/layout/layout.module.css` | 수정 | `.cardEditing` |
| `apps/web/src/components/ui/index.ts` | 수정 | `ButtonLink` export |
| `apps/web/src/components/ui/__tests__/publisher-requests-snapshot.test.tsx` | 추가 | 7건 |

### 5. 주요 결정과 이유
- IconButton 을 soft disabled(`aria-disabled`)로 바꾸는 것은 `disabledReason`이 있을 때만이다. 기존 사용처(`disabled`만 넘기는 곳)의 네이티브 disabled 동작을 바꾸지 않으려고 이렇게 했다. Button 의 `disabled`+`disabledReason` 방식과 모양을 맞췄다.
- 링크 모양 버튼은 Button 에 `href`를 넣지 않고 별도 컴포넌트로 만들었다. Button 은 `<button>` 전용 props(loading·disabledReason)를 가지고 있어서 링크와 섞으면 비활성 링크 같은 잘못된 상태가 생긴다. 이동할 수 없으면 링크를 그리지 않는 쪽을 택했다.
- Card 편집 테두리는 `border-width`를 2px로 바꾸면 내용이 1px 밀려서, 테두리 1px + 바깥 그림자 1px 로 그렸다. 새 토큰은 없다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 errors, 0 warnings) | |
| `apps/web/node_modules/.bin/tsc --noEmit -p apps/web` | 통과 (0건) | 앞 섹션의 fixtures 오류 3건은 frontend 가 이미 해소 |
| `npx vitest run` (apps/web 전체) | 201 passed | 새 7건 포함. 처음 실행에서 `features/aws-snapshots/pages.test.tsx` 1건이 실패했다. IconButton 이 호출 측 `aria-disabled`를 덮어쓴 하위 호환 문제였고, 고친 뒤 통과 |
| 서버 실행·브라우저 시각 확인 | 생략 | 지시대로 서버를 띄우지 않음 |

### 7. 남은 이슈·한계
- 실제 화면(라이트·다크 테마, 편집 테두리 두께, 링크 버튼 hover 색)은 눈으로 확인하지 않았다.

### 8. 다른 담당 요청
- `frontend 요청`: 아래 4곳을 인라인 흉내에서 새 prop 으로 바꿔 주세요.
  - `RowActionButton`과 줄 바꿈 토글 → `IconButton disabled disabledReason`
  - 목록 헤더 `휴지통` → `ButtonLink`
  - `span title`로 감싼 칩 → `Chip tooltip`
  - 편집기 Card 의 인라인 style → `Card editing`

### 9. 다음 담당이 알아야 할 점
- `IconButton`: `disabled?: boolean` + `disabledReason?: string`(둘 다 있어야 soft disabled)
- `ButtonLink({ href, variant?: "primary"|"secondary"|"ghost"|"danger" = "ghost", size?: "sm"|"md"|"lg" = "md", icon?, children, suffix?, suffixLabel?, ...anchor 속성 })`
  - 예: `<ButtonLink href="/snapshots/trash" icon="trash-2" suffix={3} suffixLabel="3개">휴지통</ButtonLink>`
- `Chip`: `tooltip?: ReactNode`
- `Card`: `editing?: boolean` (색만으로 알리지 않도록 `편집 중` 칩을 함께 둔다)
