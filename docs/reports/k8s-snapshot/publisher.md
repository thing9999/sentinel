# k8s-snapshot · publisher 작업 보고

## 2026-09-19 22:33 · UI 컴포넌트 구현 (새 10종 + 기존 확장 + 아이콘 15개)

### 1. 요청 내용
- PM 요청: `k8s-snapshot` 표현 계층 UI 컴포넌트 구현(데이터·상태 로직 없음).
  - 새 컴포넌트: `LinkTabs`, `LabeledStatus`, `DriftStatus`, `DriftKindIcon`, `DriftKindChip`, `ResourceTree`(가상 렌더링 + WAI-ARIA tree 키보드), `DriftSummary`, `FieldDiffTable`, `DiffValue`, `MaskedValue`
  - 기존 확장: `SideNav` 기본 라벨 `스냅샷`, `DataSourceBadge` Kubernetes 스냅샷 시나리오 그룹(기존 그룹·타입 하위 호환), `ScanFindingList` `truncateFile`, `NoExecuteNotice` `text`, 새 아이콘 등록
  - 추가·삭제·변경은 빨강·초록 대신 사각 아이콘 + 문구. 드리프트는 회색 `차이 N` 칩
  - 기존 사용처(aws-snapshot 화면 포함)가 깨지지 않을 것. API 계약이 작성 중이라 props 는 디자인 문서 기준, 데이터 모양 결합 최소화
- 쓰기 영역: `apps/web/src/components/ui/**`, `apps/web/src/styles/**`. 서버는 띄우지 않는다.

### 2. 참고한 문서
- `docs/design/k8s-snapshot.md` 전체 (특히 2.1·2.3 탭, 3.5 드리프트 셀, 4.2 chips 줄, 5.2 트리, 5.3 발견 표기, 6.3~6.7 드리프트 탭, 14 접근성)
- `docs/design/components.md` 13절(아이콘), 14절(새 컴포넌트), 15절(확장), 12절(기존 확장 관례)
- `docs/design/status.md` 1.2(대체 문구 `차이 없음`/`차이 N건`), 1.3(중립 칩), 5.2(정렬), 10절(드리프트 규칙·색 금지·가림)
- `docs/design/shell.md` 3.1 9번 메뉴
- `docs/specs/k8s-snapshot.md` (5.x 화면 요구, 4.6 드리프트 판단)
- `docs/api/common.md` 6절 (mock 그룹. k8s 그룹 키는 아직 없음)
- `docs/reports/aws-snapshot-manager/publisher.md` (이전 확장 관례·하위 호환 타입 처리)
- 기존 `apps/web/src/components/ui/**`, `apps/web/src/styles/**`

### 3. 작업 내용
1. **공통 타입·아이콘**
   - `types.ts`: `StatusAltLabel`에 `차이 없음`, `` `차이 ${number}건` `` 추가(status.md 1.2). `DriftKind`, `DriftFieldClass`, `DriftState` 타입 추가.
   - `icons.tsx`: 13절 k8s 아이콘 15개 등록(`git-compare`, `square-plus`/`square-minus`/`square-dot`, `eye-off`, `ship-wheel`, `link-2-off`, `globe`, `layers`, `file-text`, `chevrons-up-down`/`chevrons-down-up`, `settings-2`, `bot`, `git-branch`). 모두 lucide-react 1.47 에 있는 이름.
2. **기존 확장 (모두 기본값은 기존 동작)**
   - `SideNav` `DEFAULT_NAV_ITEMS` 9번 라벨 `AWS 스냅샷` → `스냅샷`(경로·아이콘·그룹 그대로). props 변경 없음.
   - `DataSourceBadge`: `SCENARIO_GROUPS`에 `k8sSnapshots`(표시 `Kubernetes 스냅샷`), `k8sDrift`(표시 `Kubernetes 드리프트`)를 맨 뒤에 추가. 시나리오가 없는 그룹은 그리지 않으므로 드리프트를 따로 두지 않으면 `k8sDrift`는 보이지 않는다. 새 전체 키 타입 `ScenarioGroupId`, 기존 `ScenarioGroupKey`(5개)·`ScenarioGroup`(4개)는 그대로 유지. `TopBar` `onScenarioChange` 타입도 `ScenarioGroupId`로(메서드 표기라 기존 핸들러 그대로 들어감).
   - `ScanFindingList` `truncateFile?: boolean`(기본 false): 파일 표기를 마지막 `/` 기준으로 나눠 앞(디렉터리)만 말줄임, 뒤 `<파일 이름>:<줄>` 보존, 툴팁 전체 경로(mono). 스크린리더 문구는 기존 그대로 전체 경로. 도우미 `splitFileLocation` export.
   - `NoExecuteNotice` `text?: string`: 문구만 바꾼다. 기본 문구는 `NO_EXECUTE_DEFAULT_TEXT`로 export.
   - `StatusBadge` `srPrefix?: string`(기본 `상태: `): 한 화면에 두 축(파일 상태/드리프트)이 있을 때 스크린리더 앞말을 바꾸려고 추가(k8s-snapshot.md 14절 `파일 상태: …`, `드리프트: …`).
3. **새 컴포넌트**
   - `layout/LinkTabs.tsx`: `<nav aria-label>` + `<ul>` + next/link `<a>`. 현재 항목 `aria-current="page"`, 아래 2px accent. 상태 아이콘 14px(`ok`는 안 그림), 숫자 pill(NavCount 모양, `countTone` 기본 crit, 99+), `trailing`(장식, aria-hidden). 스크린리더 보조 문구는 자동(`주의` / `커밋 금지 1개`) 또는 `srText`로 대체. 좁으면 목록 안에서 가로 스크롤. 화살표 키 이동 없음(링크).
   - `status/LabeledStatus.tsx`: 라벨(captionStrong tertiary, aria-hidden) + 배지 + ReasonText + meta + action. 라벨-배지 6px, 배지-사유 8px, 좁으면 줄바꿈(배지와 라벨은 붙어 있음).
   - `k8s/DriftStatus.tsx`
     - `DriftStatus`: changed → StatusBadge warn `차이 N건`, none → ok `차이 없음`, unknown → unknown, stale → stale 배지 + 툴팁 `마지막 결과: 차이 3건`, notComputed → `minus` + `계산 안 함`(배지 아님), computing → Spinner + `계산 중`. 스크린리더 앞말 기본 `드리프트: `(`srPrefix`로 변경·삭제 가능).
     - `DriftKindIcon`: `square-dot`/`square-minus`/`square-plus`, 색 `text.secondary`, `same`은 null. `title`(기본 `변경`/`삭제`/`추가`, null 이면 장식).
     - `DriftKindChip`: 중립 칩(sm 20 / md 24) + 문구 `변경됨`/`삭제됨`/`추가됨`/`같음`, `href` 있으면 링크(hover `bg.hover`), `tooltip`.
     - `DriftCountChip`: 탭의 `차이 N` 중립 칩(`git-compare`). 0 이하면 안 그림. 링크 안에 넣으므로 포커스를 받지 않음.
   - `k8s/drift.ts`: `DRIFT_KIND` 표, `formatDriftBreakdown`(`변경 2 · 삭제 1`, 0 생략, 변경→삭제→추가), `formatDriftCount`, `formatDriftLastResult`(`지난 결과 차이 3건 · 9월 18일 14:02`).
   - `k8s/DiffValue.tsx`: `DiffValue`(text / absent `(없음)` / masked), 기본 3줄 넘으면 앞 3줄 + `더 보기 (N줄)` 버튼(`onExpand`, `aria-expanded`, `aria-controls`), 텍스트 노드로만 렌더. `MaskedValue`: dashed `border.default` 중립 상자 + `eye-off` + 서버 문자열, sr `가린 값, …`, warn 색·복사 버튼 없음.
   - `k8s/FieldDiffTable.tsx`: 시맨틱 `<table>`(caption sr-only, 필드는 `<th scope=row>`). 열 필드(flex, 최소 200) / 스냅샷 값 176 / → 24(aria-hidden) / 클러스터 값 176 / 분류 128. 경로는 `.` 뒤·`[` 앞 `<wbr>`, 말줄임 없음. 서버 순서 그대로, 숨긴 행(default·managed)은 보이는 행 뒤 그룹 행(`숨긴 차이 N건 (기본값 차이 a · 관리 필드 b)`, 버튼 `aria-expanded`). `showHidden`이면 펼친 상태(그룹 행은 버튼 아님). 보이는 차이 0 + 숨긴 차이만이면 표 위 안내 문구. 여러 줄 값 `더 보기`는 행 아래 확장 영역(좌우 2단). loading 스켈레톤 6행. 1280px 미만 값 열 144px. 좁으면 표 안에서만 가로 스크롤.
   - `k8s/DriftSummary.tsx`: `<section aria-label="드리프트 요약">`. ① DriftStatus lg + ReasonText, 오른쪽 계산 시각·비교 대상·모드 문구, 갱신 중 Spinner, request 모드 `다시 계산` ② 5칸(변경·삭제·추가·같음은 `<button aria-pressed>`, `비교한 리소스`는 버튼 아님, 0 이면 tertiary·아이콘 없음) ③ 숨긴 차이 + Switch ④ 비교 불가 칩(최대 8 + `외 N종`, denied 는 dashed `· 권한 거부` + 툴팁) ⑤ notices. stale 이면 카드 dashed + 값 valueText 색, loading 스켈레톤 160px. warn 막대 없음. 줄 ① 값이 바뀌면 polite live 로 한 번 알림(`드리프트 차이 3건에서 2건으로 바뀜`).
   - `k8s/ResourceTree.tsx` + `k8s/resourceTreeModel.ts`
     - 모델(순수 함수): `filterTree`(잎 라벨·툴팁 부분 일치, 조상 id), `flattenVisible`, `aggregateMarkers`(scan 최악+합계, fileIssue, drift 차이 리소스 수), `treeRowSrText`, `defaultExpandedIds`(잎 150개 이하 모두 펼침, 초과면 최상위만, `defaultCollapsed` 노드는 접음), `treeVisibleRange`, `countLeaves`, `allBranchIds`(모두 펼치기용).
     - 컴포넌트: 스크롤 컨테이너 안 `role="tree"`, 행 `role="treeitem"` + `aria-level/setsize/posinset/expanded/selected/disabled` + `aria-label`(예 `api, Deployment, app 네임스페이스, 스캔 오류 1건, 드리프트 변경, Helm 관리`). 행 28px 고정 절대 배치, 보이는 행 + overscan 10 만 DOM(1,000행에서 40행 미만). 포커스 행은 범위 밖이어도 그려서 탭 정지점 유지. roving tabindex. 키: ↑↓, → 펼침/첫 자식, ← 접힘/부모, Home/End, Enter(잎 선택·가지 토글), `*` 형제 모두 펼침. 클릭도 같은 동작. 펼침은 제어형(`expandedIds`/`onExpandedChange`) 또는 `defaultExpandedIds`. 검색 중에는 일치 잎의 조상을 자동으로 펼치고, 사용자가 접으면 그 검색어 동안 접힌 채 유지. 행 모양: 펼침 칸 16 + 아이콘 14 + 이름(잎은 가운데 말줄임 keepTail 8, 툴팁 전체 경로) + 칩 + 표시(scan → fileIssue → drift → helm → dirty) + 개수. 접힌 가지는 하위 집계 표시. `variant="drift"`는 잎 아이콘 자리에 DriftKindIcon + 오른쪽 caption(`secondary`, `숨김 N`). state loading(12행 스켈레톤)·empty·filteredEmpty(`필터 초기화` 버튼).
4. **미리보기**: `__preview__/K8sSnapshotPreview.tsx`(탭·배지·칩·트리 1,000행 가까운 예시·요약·필드 표), `/dev/ui` 맨 아래 연결.
5. **테스트**: `__tests__/k8s-snapshot.test.tsx` 43건 추가. 기존 테스트 2건의 `SCENARIO_GROUPS` 기대값을 새 그룹에 맞게 고침(`frontend-requests.test.tsx`, `snapshot.test.tsx`. 순서 조건은 유지).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/types.ts` | 수정 | 드리프트 대체 문구, `DriftKind`·`DriftFieldClass`·`DriftState` |
| `apps/web/src/components/ui/icons.tsx` | 수정 | 아이콘 15개 |
| `apps/web/src/components/ui/index.ts` | 수정 | 새 컴포넌트·도우미·타입 export |
| `apps/web/src/components/ui/shell/SideNav.tsx` | 수정 | 9번 라벨 `스냅샷` |
| `apps/web/src/components/ui/shell/DataSourceBadge.tsx` | 수정 | `k8sSnapshots`·`k8sDrift` 그룹, `ScenarioGroupId` |
| `apps/web/src/components/ui/shell/TopBar.tsx` | 수정 | `onScenarioChange` 그룹 타입 |
| `apps/web/src/components/ui/snapshot/ScanFindingList.tsx` | 수정 | `truncateFile`, `splitFileLocation` |
| `apps/web/src/components/ui/snapshot/snapshot.module.css` | 수정 | 가운데 말줄임 스타일 |
| `apps/web/src/components/ui/advisor/Labels.tsx` | 수정 | `NoExecuteNotice text`, `NO_EXECUTE_DEFAULT_TEXT` |
| `apps/web/src/components/ui/status/StatusBadge.tsx` | 수정 | `srPrefix` |
| `apps/web/src/components/ui/status/LabeledStatus.tsx` | 추가 | 14.2 |
| `apps/web/src/components/ui/status/status.module.css` | 수정 | LabeledStatus |
| `apps/web/src/components/ui/layout/LinkTabs.tsx` | 추가 | 14.1 |
| `apps/web/src/components/ui/layout/layout.module.css` | 수정 | LinkTabs |
| `apps/web/src/components/ui/k8s/drift.ts` | 추가 | 드리프트 구분 표·문구 도우미 |
| `apps/web/src/components/ui/k8s/DriftStatus.tsx` | 추가 | DriftStatus·DriftKindIcon·DriftKindChip·DriftCountChip |
| `apps/web/src/components/ui/k8s/DiffValue.tsx` | 추가 | DiffValue·MaskedValue |
| `apps/web/src/components/ui/k8s/FieldDiffTable.tsx` | 추가 | 14.6 |
| `apps/web/src/components/ui/k8s/DriftSummary.tsx` | 추가 | 14.5 |
| `apps/web/src/components/ui/k8s/ResourceTree.tsx` | 추가 | 14.4 |
| `apps/web/src/components/ui/k8s/resourceTreeModel.ts` | 추가 | 트리 순수 함수 |
| `apps/web/src/components/ui/k8s/k8s.module.css` | 추가 | 위 컴포넌트 스타일 |
| `apps/web/src/components/ui/__preview__/K8sSnapshotPreview.tsx` | 추가 | 미리보기 |
| `apps/web/src/components/ui/__preview__/UiPreview.tsx` | 수정 | 미리보기 연결 |
| `apps/web/src/components/ui/__tests__/k8s-snapshot.test.tsx` | 추가 | 43건 |
| `apps/web/src/components/ui/__tests__/frontend-requests.test.tsx` | 수정 | SCENARIO_GROUPS 기대값 |
| `apps/web/src/components/ui/__tests__/snapshot.test.tsx` | 수정 | AWS 스냅샷 그룹 위치 조건(맨 뒤 → advisor 바로 뒤) |

`apps/web/src/styles/**`는 바꾸지 않았다(새 토큰 없음, status.md 10.6).

### 5. 주요 결정과 이유
- **k8s 컴포넌트는 `components/ui/k8s/`에 모음**: aws-snapshot 때 `snapshot/`을 만든 관례를 따랐다. 두 축 공용인 `LinkTabs`는 `layout/`, `LabeledStatus`는 `status/`에 두었다.
- **props 는 표현 모양으로만 정의**: 계약이 작성 중이라 API 필드 이름(예: `driftStatus`, `resourceKey`)을 쓰지 않았다. 호출 측이 API 값을 `DriftState`(`changed|none|unknown|notComputed|computing|stale`), `TreeNode`, `FieldDiffRow`, `DiffValueData`로 옮긴다. critical → unknown 매핑과 콘솔 경고는 프론트 매핑 몫이다(status.md 10.1).
- **스크린리더 두 축 구분 = StatusBadge `srPrefix` 추가**: 드리프트 배지가 `드리프트: 차이 3건`으로 읽혀야 해서다(14절). StatusBadge 를 감싸 문구를 흉내 내면 `상태: ` 앞말이 겹친다. 기본값 `상태: `라 기존 사용처는 그대로다. `LabeledStatus`의 보이는 라벨은 aria-hidden 으로 두어 `드리프트 드리프트:`로 두 번 읽히지 않게 했다. 표 셀처럼 열 머리글이 이미 `드리프트`이면 `srPrefix=""`를 쓴다.
- **`계산 안 함`은 `aria-label` 대신 sr-only 앞말**: 디자인은 `aria-label="드리프트: 계산 안 함"`이지만 일반 `span`의 aria-label 은 스크린리더마다 무시된다. 읽는 결과는 같다.
- **LinkTabs `trailing`은 aria-hidden, 읽을 말은 `srText`**: 드리프트 칩이 툴팁 때문에 포커스를 받으면 링크 안에 대화형 요소가 들어간다. 칩은 장식으로, 문구는 링크 이름으로 옮겼다. 그래서 기존 `Chip tooltip` 대신 포커스를 받지 않는 `DriftCountChip`을 따로 만들었다.
- **DataSourceBadge 그룹 키 `k8sSnapshots`·`k8sDrift`는 제안값**: 계약(common.md 6절)에 아직 없다. 디자인 제안 `k8sSnapshots`를 쓰고, 드리프트를 따로 나눌 경우를 위해 `k8sDrift`도 넣었다. 시나리오가 없는 그룹은 그리지 않아 해는 없다. `ScenarioGroupKey`를 넓히면 frontend `ShellClient`의 `(group: ScenarioGroupKey) => mock.change(group: MockGroupId)`가 타입 오류가 난다. 그래서 `ScenarioGroupKey`는 그대로 두고 전체 키 `ScenarioGroupId`를 새로 만들었다(aws-snapshot 때와 같은 방식).
- **FieldDiffTable 은 DataTable 대신 전용 `<table>`**: 디자인은 "DataTable 기반"이지만, 숨긴 행 배경·그룹 행 버튼·행 아래 2단 확장·행 머리(`th scope=row`)를 DataTable 의 `groupRow`/`expandable` 조합으로 맞추면 DataTable 을 크게 바꿔야 한다. 머리글 36px, 행 구분선, sunken 배경 등 치수와 토큰은 status.md 5.1 과 같게 맞췄다. 행 확장 여부만 내부 상태다.
- **ResourceTree 가상 렌더링 = 평평한 treeitem + aria-level/setsize/posinset**: WAI-ARIA 가 허용하는 평면 구조다. 중첩 `role=group`을 쓰면 보이는 행만 그릴 수 없다. 포커스 행은 범위 밖이어도 항상 그려 roving tabindex 정지점이 없어지지 않게 했다. 행 높이는 28px 고정(`calc(var(--spacing-6) + var(--spacing-1))`)이다.
- **트리 검색 중 접기**: 일치 조상은 자동으로 펼친다. 사용자가 접으면 그 검색어 동안 접힌 채로 둔다(검색어가 바뀌면 초기화). 이렇게 하지 않으면 검색 중에는 가지를 접을 수 없다.
- **트리 행 이름은 `aria-label`로 한 문장**: 행 안의 표시 아이콘·칩은 aria-hidden, 정보는 모두 이름 문장에 넣었다(5.2 스크린리더 규칙). 표시 아이콘 툴팁은 hover 전용이다(행마다 탭 정지점이 생기지 않게. aws-snapshot gutter 결정과 같음).
- **DriftSummary live 알림은 effect 없이 렌더 중 상태 조정**: `react-hooks` lint(set-state-in-effect)를 피하고 이전 값을 비교한다. 처음 그릴 때는 알리지 않는다.
- **`같음` 칸 클릭은 `onFilter("same")`만 호출**: 디자인의 `전체` + 숨긴 차이 켬 동작은 호출 측 상태라 프론트가 처리한다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 errors, 0 warnings) | 처음 한 번 미리보기의 `useMemo(buildTree, [])`가 `react-hooks/use-memo`에 걸려 인라인 함수로 고침 |
| `npx tsc --noEmit -p apps/web` | 통과 (0건) | |
| `npx vitest run src/components/ui/__tests__/k8s-snapshot.test.tsx` | 43 passed | |
| `npx vitest run` (apps/web 전체) | 1차: 245 passed / 1 failed. 2·3차: **246 passed** | 1차 실패는 `features/aws-snapshots/pages.test.tsx` "편집 → 저장: 검사에서 오류 남음…(AC-22·23·33)". 이 파일만 따로 돌리면 19/19 통과하고 전체 재실행 2번도 통과했다. 전체 실행 부하로 생긴 타이밍 flake 로 보인다(내 변경은 이 화면이 쓰는 컴포넌트 동작을 바꾸지 않음) |
| 기존 테스트 기대값 수정 2건 | 수정 | SCENARIO_GROUPS 에 그룹이 늘어서 바꿨다. 순서 조건은 유지 |
| 서버 실행·브라우저 시각 확인(360·1024·1440px, 다크 테마, 1,000행 스크롤 체감) | **생략** | 지시대로 서버를 띄우지 않음. jsdom 은 레이아웃을 재지 못함. 가상 렌더링은 DOM 행 수로만 확인함 |

### 7. 남은 이슈·한계
- 실제 화면(360~1440px, 라이트·다크)은 눈으로 확인하지 않았다. 특히 DriftSummary 칸 줄바꿈, 트리 행 말줄임, FieldDiffTable 좁은 폭 스크롤은 frontend 통합 후 확인이 필요하다.
- `DiffValue`의 `더 보기`는 줄바꿈(`\n`) 수로만 판단한다. 한 줄이 아주 길어 화면에서 여러 줄로 접히는 값은 잘리지 않고 다 보인다(`overflow-wrap:anywhere`).
- ResourceTree 는 행 높이 28px 고정을 전제로 한다. 글자 확대(200%)에서 행 안 글자가 잘릴 수 있다(가상 렌더링의 일반적 한계).
- ResourceTree 타입어헤드(글자 입력으로 이동)는 만들지 않았다(디자인 키 목록에 없음).
- 트리 `*`는 포커스 행의 형제 중 접힌 가지만 펼친다(WAI-ARIA 권장 동작).
- DataSourceBadge 그룹 키 `k8sSnapshots`·`k8sDrift`는 계약 확정 전 제안값이다. 계약이 다른 이름을 쓰면 `SCENARIO_GROUPS`와 라벨 표를 바꿔야 한다(퍼블리셔 작업, 5분 이내).

### 8. 다른 담당 요청
- `backend 요청`: `docs/api/common.md` 6절에 k8s mock 그룹 키를 정할 때 `k8sSnapshots`(그리고 드리프트를 나누면 `k8sDrift`)를 쓰면 UI 변경이 필요 없다. 다른 이름이면 퍼블리셔에 알려 달라.
- `frontend 요청`: `features/common/types.ts` `MockGroupId`에 k8s 그룹 키를 넣은 뒤 `ShellClient`/`mock-scenarios.ts`의 `ScenarioGroupKey`를 `ScenarioGroupId`로 바꿔 달라(지금은 하위 호환 타입이라 오류 없음. `toBadgeScenarios`는 이미 `SCENARIO_GROUPS` 기준으로 걸러 k8s 그룹도 넘어간다).
- `frontend 요청`: 사이드바 라벨이 `스냅샷`으로 바뀌었다. `features/shell/nav.ts`의 스냅샷 항목 상태·숫자를 AWS + k8s 합산 서버 값으로 바꾸고, `/snapshots/**` 전체를 현재 위치로 볼 것(SideNav 는 이미 `href/` 접두어로 판단). 목록 페이지 h1 `스냅샷`, 메타 title(`app/snapshots/page.tsx`의 `AWS 스냅샷`) 변경은 frontend 영역.
- `frontend 요청`: 드리프트 목록 셀처럼 열 머리글이 `드리프트`인 곳은 `DriftStatus srPrefix=""`, 상세 제목 옆 파일 상태 배지는 `StatusBadge srPrefix="파일 상태: "`를 쓰면 14절 스크린리더 문구가 된다.
- `designer 요청`(확인만): ① `계산 안 함` aria-label 대신 sr-only 앞말로 구현한 점 ② 탭 드리프트 칩을 장식(aria-hidden)으로 두고 문구를 링크 이름(`srText`)으로 옮긴 점 ③ FieldDiffTable 을 DataTable 이 아닌 같은 치수의 전용 표로 만든 점 ④ 트리 검색 중 사용자가 자동 펼침 가지를 접을 수 있게 한 점.

### 9. 다음 담당이 알아야 할 점
- 모두 `@/components/ui`에서 import. 주요 인터페이스:
  - `LinkTabs({ items: { href, label, status?, statusLabel?, count?, countTone?, trailing?, srText? }[], currentHref, label })`
    - 예: `trailing={<DriftCountChip count={3} tooltip="최신 스냅샷 드리프트: 차이 3건 (변경 2 · 삭제 1) · 15:12 계산" />}`, `srText="커밋 금지 1개, 드리프트 차이 3건"`
  - `LabeledStatus({ label, children, reason?: string | string[], meta?, action?, size?: "sm"|"md" })`
  - `DriftStatus({ state: "changed"|"none"|"unknown"|"notComputed"|"computing"|"stale", count?, size?, staleAt?, previous?: { count? }, reason?, srPrefix? = "드리프트: " })`
    - 목록 2줄 문구: `formatDriftBreakdown({ changed, removed, added })`, 계산 안 함 + 지난 결과: `formatDriftLastResult({ state, count?, computedAt })`
  - `DriftKindIcon({ kind, size?: 12|14|16, title? })`, `DriftKindChip({ kind, size?: "sm"|"md", href?, tooltip? })`, `DriftCountChip({ count, tooltip? })`
  - `ResourceTree({ nodes: TreeNode[], variant?: "files"|"drift", selectedId?, onSelect?, expandedIds?, onExpandedChange?, defaultExpandedIds?, query?, height?, state?, label, emptyText?, filteredEmptyText?, onResetFilters? })`
    - `TreeNode = { id, kind: "group"|"namespace"|"resourceKind"|"file", label, icon?, iconTone?, mono?, count?, children?, disabled?, disabledReason?, chips?, markers?, tooltip?, secondary?, srText?, defaultCollapsed? }`
    - `TreeMarkers = { scan?: { level, count }, fileIssue?: string, drift?: { kind, detail? }, helm?, dirty?, notComparable?: string, hiddenOnly?: number }`
    - 노드 순서는 호출 측이 정한다(스냅샷 파일 → 네임스페이스 → 클러스터 범위 → 예상 밖 파일, 5.2). 트리는 다시 정렬하지 않는다.
    - 기본 펼침: `defaultExpandedIds(nodes, 150)`, 모두 펼치기: `allBranchIds(nodes)`, 모두 접기: `[]`. 결과 줄(`리소스 128개 중 3개`)은 `filterTree(nodes, q)`로 호출 측이 셀 수 있다.
    - 표시 필터(스캔 발견 있음 등)는 호출 측이 `nodes`를 걸러 넘긴다. 0건이면 `state="filteredEmpty"` + `onResetFilters`.
    - `height`는 작업 영역 높이(`clamp(...)` 문자열 가능). 가상 렌더링에 필요하다.
  - `DriftSummary({ status, reason?, computedAt?, target?, mode?, refreshing?, onRecompute?, recomputeLoading?, counts?, activeFilter?, onFilter?, hidden?, showHidden?, onShowHiddenChange?, notComparable?: { kind, count, reason: "rbac"|"denied" }[], notComparableMax?, notices?, state?, label? })`
  - `FieldDiffTable({ rows: { id, path, snapshot, cluster, cls: "change"|"default"|"managed", clsLabel?, clsDetail? }[], showHidden?, hiddenExpanded?, onHiddenToggle?, state?, caption, hiddenOnlyText? })`
  - `DiffValue({ value: { type: "text", text, lines? } | { type: "absent" } | { type: "masked", text }, maxLines?, onExpand?, expanded?, controlsId? })`, `MaskedValue({ text, tooltip? })`
  - 확장: `ScanFindingList truncateFile`, `NoExecuteNotice text`, `StatusBadge srPrefix`, `SCENARIO_GROUPS`에 `k8sSnapshots`·`k8sDrift`, `ScenarioGroupId`.
- 미리보기: `/dev/ui` 맨 아래 "Kubernetes 스냅샷" 섹션.

## 2026-09-19 22:46 · 계약 확정 반영 (mock 그룹 하나로, 드리프트 타입·props 계약 모양) + 전체 테스트 flake 확인

### 1. 요청 내용
- PM 요청 ①: 계약(`docs/api/k8s-snapshot.md`, `docs/api/common.md` 6절) 확정. mock 그룹은 `k8s-snapshots` **하나**이고 드리프트 시나리오도 그 안에 있다. DataSourceBadge 의 `k8sDrift` 그룹을 없애고 하나로 합친다. 키 이름은 기존 aws 그룹 관례를 따른다. 테스트를 갱신한다.
- PM 요청 ②: designer 가 계약에 맞춰 갱신한 components.md 14·15절을 반영한다.
  - 이름 변경: `DriftKind` removed→deleted, `DriftFieldClass` change→changed
  - `DiffValueData`를 계약 모양으로
  - `DiffValue`에 list·`showType`
  - `FieldDiffTable` rows 계약 모양 + `truncated`
  - `DriftSummary`: mode·counts·hidden·target·notComparable 계약 모양, `totalUncomparable`, state `lastResult`
  - `DriftStatus` `refreshing`
  - `DriftKindIcon` deleted
- PM 요청 ③: 앞 작업 때 전체 vitest 에서 난 `features/aws-snapshots/pages.test.tsx` 저장 흐름 flake 의 원인이 퍼블리셔 영역(컴포넌트 타이밍)인지 확인한다. frontend 영역이면 원인 추정을 요청으로 남긴다.
- designer 확인 요청 4건(계산 안 함 sr 앞말, 탭 드리프트 칩 장식, FieldDiffTable 전용 표, 검색 중 펼친 가지 접기)은 문서와 충돌이 없으면 그대로 둔다.

### 2. 참고한 문서
- `docs/design/components.md` 14·15절 (계약 반영본)
- `docs/design/k8s-snapshot.md` 6.3(요약 줄 ①~⑤, 모드 문구, 비교 불가 사유별 칩), 6.5(`fieldsTruncated`), 6.7(값 표시), 6.8(지난 결과), 16절(API↔화면 매핑)
- `docs/api/common.md` 6.1 (mock 그룹 `snapshots`·`k8s-snapshots`), `docs/api/k8s-snapshot.md` (mock 그룹 하나, AC-K19 기존 키 유지)
- `apps/web/src/features/shell/mock-scenarios.ts` (UI 그룹 키 관례 확인용, 읽기만)

### 3. 작업 내용
1. **mock 그룹 키 = `k8s-snapshots`**
   - 관례: 기존 UI 키 `cluster`/`db`/`cost`/`advisor`/`snapshots`는 모두 API mock 그룹 id 와 같다. frontend `toBadgeScenarios`도 `SCENARIO_GROUPS.includes(g.id)`로 API id 를 그대로 걸러 넘긴다. 그래서 API 키를 그대로 썼다. AWS 쪽도 토픽 이름(`aws-snapshots`)이 아니라 mock 그룹 id(`snapshots`)를 쓴다.
   - `SCENARIO_GROUPS = ["cluster", "db", "cost", "advisor", "snapshots", "k8s-snapshots"]`, 라벨 `Kubernetes 스냅샷`. `k8sSnapshots`·`k8sDrift`·`Kubernetes 드리프트`는 없앴다.
   - `ScenarioGroupId`(전체 6개)는 유지하고, `ScenarioGroupKey`는 `k8s-snapshots`를 뺀 5개 그대로 두었다(하위 호환).
2. **드리프트 타입 이름**: `DriftKind = "added"|"deleted"|"changed"|"same"`, `DriftFieldClass = "changed"|"default"|"managed"`. `DRIFT_KIND.deleted`(`square-minus`, `삭제`/`삭제됨`), `DriftBreakdown.deleted`, 트리 스크린리더 문구·툴팁을 함께 바꿨다.
3. **`DiffValue` / `DiffValueData`** (계약 모양 그대로)
   - 타입: `{ kind:"scalar", value: string|number|boolean|null } | { kind:"list", items } | { kind:"masked", text, preview } | null`. 기존 text/absent/masked 모양은 없앴다.
   - `null`은 `(없음)`, scalar `null` 값은 tertiary `null`로 구분한다.
   - scalar 문자열은 따옴표 없이 pre-wrap, 숫자·불리언은 JSON 표기.
   - list 는 항목마다 한 줄에 `- `(tertiary). 넘치면 `더 보기 (N개)`, scalar 여러 줄은 `더 보기 (N줄)`.
   - masked 는 `text`만 쓴다(`preview` 안 씀).
   - 새 prop `showType`: 값 뒤 6px 에 micro tertiary `문자열`/`숫자`/`불리언`, sr 은 `, 문자열`.
   - 도우미: `scalarText`, `scalarTypeLabel`, `differsOnlyByType`(표시 글자 같고 JSON 타입만 다를 때), `diffValueLines`.
4. **`FieldDiffTable`**
   - rows = `{ path, category, reason, managedRule?, snapshot, cluster }`, 행 키는 `path`. `id`/`cls`/`clsLabel`/`clsDetail`은 없앴다.
   - 분류 아래 caption 은 `reason`이다. 두 값이 타입만 다르면 양쪽 셀에 `showType`을 준다.
   - 새 prop `truncated`: 표 끝 36px sunken 안내 행(`info` 12px + `필드 차이가 많아 500건까지만 보여 줍니다. 전체는 kubectl diff로 확인하세요.`). 문구 상수 `FIELDS_TRUNCATED_TEXT`.
   - 서버 순서(changed → managed → default)를 유지한다. 숨긴 행은 보이는 행 뒤 그룹으로 모으고 순서는 바꾸지 않는다.
5. **`DriftSummary`**
   - `mode: "auto"|"on_demand"|"last_result"`
     - on_demand: `요청 계산 · 이 화면을 떠나면 최대 2분 뒤 갱신을 멈춥니다` + secondary sm `다시 계산`
     - last_result: `지난 결과 · 지금은 갱신하지 않습니다` + **primary** sm `다시 계산`
   - `counts.deleted`, `hidden: { default, managed }`, `target: { name, context? }`
   - `notComparable: { kind, count, reason, text }[]`
     - `NOT_IN_RBAC`와 모르는 사유는 실선 칩
     - `FORBIDDEN`은 dashed `… · 권한 거부`, `API_VERSION_MISMATCH`는 dashed `… · API 버전 다름`
     - 툴팁은 서버 `text` + 사유별 안내를 줄마다 블록으로 보인다(툴팁이 `white-space: normal`이라 줄바꿈 문자 대신 줄 요소를 씀)
     - 칩 뒤 문구 `대시보드 권한·버전 밖이라 비교하지 않습니다. …`
     - 도우미 `notComparableChip`
   - 새 prop `totalUncomparable`(`비교 불가 N개`, 없으면 칩 개수 합).
   - 새 state `lastResult`: 카드 1px dashed `border.strong` + 배지 앞 caption `지난 결과`.
6. **`DriftStatus` `refreshing`**: 배지(또는 `계산 안 함` 문구) 뒤 4px 에 12px Spinner(`role=img`, `갱신 중`)를 둔다. 값은 그대로다. state `computing`일 때는 스피너가 이미 있어 붙이지 않는다.
7. **designer 확인 요청 4건**: 갱신된 components.md 14절·k8s-snapshot.md 와 충돌이 없어 그대로 두었다.
8. 미리보기(`K8sSnapshotPreview`)를 계약 모양 예시로 바꿨다(타입만 다른 포트, list args, null, 사유 3종 칩, `totalUncomparable`, `refreshing`). 테스트도 갱신·추가했다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/shell/DataSourceBadge.tsx` | 수정 | 그룹 `k8s-snapshots` 하나로 |
| `apps/web/src/components/ui/types.ts` | 수정 | `DriftKind` deleted, `DriftFieldClass` changed |
| `apps/web/src/components/ui/k8s/drift.ts` | 수정 | deleted |
| `apps/web/src/components/ui/k8s/DiffValue.tsx` | 수정 | 계약 `DiffValueData`, list, `showType`, 도우미 |
| `apps/web/src/components/ui/k8s/FieldDiffTable.tsx` | 수정 | 계약 rows, `truncated`, 타입 표시 |
| `apps/web/src/components/ui/k8s/DriftSummary.tsx` | 수정 | mode·counts·hidden·target·notComparable 계약 모양, `totalUncomparable`, `lastResult` |
| `apps/web/src/components/ui/k8s/DriftStatus.tsx` | 수정 | `refreshing` |
| `apps/web/src/components/ui/k8s/ResourceTree.tsx` | 수정 | deleted 툴팁 |
| `apps/web/src/components/ui/k8s/resourceTreeModel.ts` | 수정 | deleted 스크린리더 문구 |
| `apps/web/src/components/ui/k8s/k8s.module.css` | 수정 | list·타입 표시·null·잘림 행·lastResult 카드·refreshing·툴팁 줄 |
| `apps/web/src/components/ui/index.ts` | 수정 | 새 도우미·타입 export |
| `apps/web/src/components/ui/__preview__/K8sSnapshotPreview.tsx` | 수정 | 계약 모양 예시 |
| `apps/web/src/components/ui/__tests__/k8s-snapshot.test.tsx` | 수정 | 계약 모양으로 갱신 + 추가(총 51건) |
| `apps/web/src/components/ui/__tests__/frontend-requests.test.tsx` | 수정 | SCENARIO_GROUPS 기대값 |

### 5. 주요 결정과 이유
- **그룹 키는 API id 그대로(`k8s-snapshots`)**: 3절 1번 근거. 다른 키를 쓰면 frontend 에 id→키 변환표가 생긴다.
- **`ScenarioGroupKey`는 넓히지 않음**: frontend `ShellClient`가 이 타입으로 `mock.change(group: MockGroupId)`를 부른다. 넓히면 frontend 영역에 타입 오류가 난다(앞 섹션과 같은 이유).
- **scalar `null`과 값 없음(`null` DiffValue)을 다르게 표시**: 계약에서 둘은 뜻이 다르다(필드는 있는데 값이 null / 필드 자체 없음). 디자인 6.7 도 `null`과 `(없음)`을 따로 적었다.
- **`notComparable` reason 타입은 열린 문자열**(`"NOT_IN_RBAC" | "FORBIDDEN" | "API_VERSION_MISMATCH" | (string & {})`): 서버가 새 사유를 보내도 타입 오류 없이 실선 + 서버 문구로 그린다(디자인 "그 밖 실선").
- **`DriftStatus` `refreshing` 스피너는 `role=img` + 이름 `갱신 중`**: 디자인은 `aria-label="갱신 중"`이다. 기존 `Spinner label`이 이 모양을 만든다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0건) | |
| `npx tsc --noEmit -p apps/web` | 통과 (0건) | 중간에 notComparableChip 반환 타입 수정 누락 1건(스크립트 치환 실패)을 발견해 고침 |
| `npx vitest run` (apps/web 전체) | **254 passed**, 3번 연속 | 중간 실패 1건: list 테스트 선택자가 바깥 span 까지 잡은 테스트 문제라 고침 |
| mock 그룹 반영 직후 전체 vitest | 246 passed | |
| flake 재현 시도 | 전체 vitest 를 8번 더 돌렸고 모두 통과, **재현 안 됨** | 아래 7절 |
| 서버 실행·브라우저 확인 | 생략 | 지시대로 서버를 띄우지 않음 |

### 7. 남은 이슈·한계 (flake 확인 결과 포함)
- **`features/aws-snapshots/pages.test.tsx` "편집 → 저장: 검사에서 오류 남음…" flake**
  - 처음 1회 실패한 뒤 단독 실행 1회와 전체 실행 10회(앞 섹션 2회 + 이번 8회)에서 모두 통과했다. 처음 실패의 오류 본문은 남기지 못했다(요약만 보존).
  - **퍼블리셔 영역 원인은 아닌 것으로 판단**한다.
    - 이 흐름이 쓰는 퍼블리셔 컴포넌트(CodeEditor, Dialog, Button, Tabs)에는 타이머가 없다. CodeEditor 의 `requestAnimationFrame` 하나는 줄 이동 + 줄 바꿈 켬일 때만 돌고, 이 흐름에서는 쓰지 않는다.
    - 이번 작업은 이 흐름의 컴포넌트를 바꾸지 않았다(앞 섹션 작업은 StatusBadge `srPrefix` 추가뿐이고 기본값은 기존 출력 그대로).
  - 원인 추정(frontend 영역): 이 테스트는 동적 `await import("./SnapshotDetailPage")` 뒤에 `findBy*`/`waitFor` 6번을 기본 1000ms 제한 시간으로 이어서 기다린다. 처음 실패 때 테스트 시간이 891ms 였다. 전체 실행에서 여러 워커가 모듈 변환·jsdom 렌더를 동시에 하면 한 단계가 1000ms 를 넘을 수 있다. 다음 8절 frontend 요청으로 남긴다.
- 앞 섹션 7·8절의 `k8sSnapshots`·`k8sDrift` 관련 내용은 이 섹션으로 대체한다(키 `k8s-snapshots` 확정).
- 실제 화면(라이트·다크, 360~1440px) 확인은 아직 안 했다(앞 섹션과 같음).

### 8. 다른 담당 요청
- `frontend 요청`: `features/common/types.ts` `MockGroupId`에 `"k8s-snapshots"`를 추가하고, `ShellClient`·`mock-scenarios.ts`의 `ScenarioGroupKey`를 `ScenarioGroupId`로 바꿔 달라. 지금도 `toBadgeScenarios`가 `SCENARIO_GROUPS` 기준으로 걸러 `k8s-snapshots` 시나리오는 배지에 나온다. 다만 `g.id as ScenarioGroupKey` 캐스트가 실제 값과 맞지 않는다.
- `frontend 요청`(flake): `features/aws-snapshots/pages.test.tsx` 긴 저장 흐름 테스트 안정화를 부탁한다. 방법은 셋 중 하나:
  - ① `SnapshotDetailPage` 동적 import 를 `beforeAll`로 옮긴다.
  - ② 긴 흐름의 `findBy*`/`waitFor`에 `{ timeout: 3000 }`을 준다.
  - ③ `@testing-library/react` `configure({ asyncUtilTimeout: 3000 })`을 쓴다.
  - 근거는 7절.
- `frontend 요청`(통합 시): 앞 섹션 이름을 쓰던 곳은 계약 이름으로 쓴다.
  - `DriftKind` deleted, `DriftFieldClass` changed
  - `FieldDiffTable rows = resources[].fields[]` 그대로 + `truncated = fieldsTruncated`
  - `DriftSummary`: `mode = drift.mode`, `counts = drift.counts`, `hidden = counts.hidden`, `target = target`, `notComparable = uncomparable`, `totalUncomparable = counts.uncomparable`, 지난 결과 보기면 `state="lastResult"`
  - `DriftStatus refreshing = drift.computing`

### 9. 다음 담당이 알아야 할 점
- 바뀐 인터페이스:
  - `DiffValueData = { kind:"scalar", value } | { kind:"list", items } | { kind:"masked", text, preview } | null`
  - `DiffValue({ value, maxLines?, showType?, onExpand?, expanded?, controlsId? })`
  - `FieldDiffTable({ rows: { path, category, reason, managedRule?, snapshot, cluster }[], showHidden?, hiddenExpanded?, onHiddenToggle?, truncated?, state?, caption })`
  - `DriftSummary({ status, reason?, computedAt?, target?: { name, context? }, mode?: "auto"|"on_demand"|"last_result", refreshing?, onRecompute?, recomputeLoading?, counts?: { changed, deleted, added, same, compared }, activeFilter?, onFilter?, hidden?: { default, managed }, showHidden?, onShowHiddenChange?, notComparable?: { kind, count, reason, text }[], totalUncomparable?, notComparableMax?, notices?, state?: "ready"|"loading"|"stale"|"lastResult" })`
  - `DriftStatus`에 `refreshing?`
  - `SCENARIO_GROUPS` 마지막 `k8s-snapshots`, 라벨 `Kubernetes 스냅샷`
- 타입만 다른 값 판단은 `FieldDiffTable`이 알아서 한다(`differsOnlyByType`). 따로 쓸 때만 `DiffValue showType`을 직접 준다.

## 2026-09-19 23:42 · 프론트 통합 후 publisher 요청 4건 (하위 호환)

### 1. 요청 내용
- PM: `docs/reports/k8s-snapshot/frontend.md`의 `publisher 요청` 1~4를 하위 호환을 유지하며 반영.
  1. `PageHeader.status`에 `srPrefix` 전달 (상세 파일 상태 배지 → `파일 상태: …`)
  2. `PageHeader` 탭 줄 슬롯 또는 아래 여백 0 옵션 (디자인 2.3)
  3. `UnknownState`에 `icon` prop (`hourglass`, 6.8)
  4. 표 안 링크 셀 hover 스타일 (드리프트 셀, 3.4)

### 2. 참고한 문서
- `docs/design/k8s-snapshot.md` 2.3, 3.4, 6.8, 14절(접근성)
- `docs/design/components.md` 1.7 PageHeader, 6.4 UnknownState, 7.1 DataTable
- `docs/reports/k8s-snapshot/frontend.md` (요청 맥락), 이 파일 이전 섹션

### 3. 작업 내용
1. `PageHeader`
   - `status.srPrefix?: string` 추가 → `StatusBadge srPrefix`로 그대로 전달. 없으면 StatusBadge 기본값 `상태: `.
   - `tabs?: ReactNode` 슬롯 추가: header 안 맨 아래(`.pageTabs`)에 그린다. 있으면 header 아래 여백 24px → 0(`.pageHeaderFlush`).
   - `flushBottom?: boolean` 추가: 탭을 머리 밖에 직접 붙이는 경우용 여백 0 옵션.
2. `UnknownState`
   - `icon?: IconName`(기본 `circle-help`) 추가. 색은 항상 `status.unknown.fg`(iconTone unknown 고정).
   - 덤으로 `headingLevel?`(EmptyState와 같은 타입, 기본 p) 전달 추가 — 드리프트 탭에서 제목 수준 맞출 때 사용 가능.
3. `TableLinkCell` (새, `table/TableLinkCell.tsx`, index에서 export)
   - `next/link` 기반. 셀 패딩까지 덮도록 음수 margin + 같은 padding(comfortable 밀도는 위아래 8px까지).
   - hover: `bg.hover`, 밑줄 없음, 색 inherit, cursor pointer. focus-visible 링은 td `overflow: hidden`에 잘리지 않게 안쪽(offset 음수).
   - 클릭·Enter 를 행(onRowClick)으로 전파하지 않음(`stopRowClick` 기본 true).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/shell/PageHeader.tsx` | 수정 | `status.srPrefix`, `tabs`, `flushBottom` |
| `apps/web/src/components/ui/shell/shell.module.css` | 수정 | `.pageHeaderFlush`, `.pageTabs` |
| `apps/web/src/components/ui/feedback/EmptyState.tsx` | 수정 | `UnknownState` `icon`, `headingLevel` |
| `apps/web/src/components/ui/table/TableLinkCell.tsx` | 추가 | 셀 전체 링크 |
| `apps/web/src/components/ui/table/table.module.css` | 수정 | `.cellLink` (hover/focus/comfortable) |
| `apps/web/src/components/ui/index.ts` | 수정 | `TableLinkCell`, `TableLinkCellProps` export |
| `apps/web/src/components/ui/__tests__/publisher-requests-k8s-snapshot.test.tsx` | 추가 | 4건 테스트 8개 |

### 5. 주요 결정과 이유
- 탭 줄: 슬롯(`tabs`)과 여백 옵션(`flushBottom`) 둘 다 제공. 슬롯이 디자인 의도("탭이 머리의 일부")에 맞지만, 프론트가 이미 `SnapshotsHeader`에서 PageHeader와 LinkTabs를 나란히 두고 있어 옵션만으로도 최소 변경이 가능하게 했다. 탭 줄 아래 1px 테두리는 LinkTabs가 이미 그리므로 슬롯은 테두리를 추가하지 않는다.
- 링크 셀: `DataTable` Column에 링크 옵션을 넣는 대안 대신 별도 셀 컴포넌트로. 셀 내용이 임의 ReactNode라 컴포넌트가 더 유연하고 DataTable 변경이 없다. 행 hover도 `bg.hover`라 겉보기 차이는 작지만 선택 행(`bg.selected`) 위에서도 셀 hover가 드러나고, 클릭 영역이 셀 전체가 된다.
- 기존 prop 기본값을 모두 유지 → 하위 호환.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 | |
| `npm run typecheck` (apps/web) | 통과 | 첫 실행에서 `tabs && …` 타입 오류(ReactNode 0) → `Boolean(tabs)`로 수정 후 통과 |
| `npx vitest run` (apps/web 전체) | 18 files / 303 tests 통과 | 수정 직후 `components/ui` 재실행 8 files / 151 통과 |
- 서버는 띄우지 않았다(지시). 실제 화면 확인은 생략.

### 7. 남은 이슈·한계
- `TableLinkCell`은 default(40px)·compact 밀도에서 td 위아래 패딩이 0이라 셀 높이 전체가 아니라 내용 높이만 덮는다(가로는 전체). k8s 목록은 comfortable이라 해당 없음.
- 디자인 14절 상세 aria-live 문구(`스냅샷 파일 상태 커밋 금지: …`)는 이번 요청 범위 밖(PageHeader 라이브 영역 없음).

### 8. 다른 담당 요청
- `frontend 요청`:
  1. 상세 `PageHeader status={{ …, srPrefix: "파일 상태: " }}`
  2. `SnapshotsHeader`: `<PageHeader title="스냅샷" actions={…} tabs={<LinkTabs … />} />` (또는 `flushBottom`)
  3. 드리프트 탭 `CLUSTER_SYNCING`·`SNAPSHOT_FILES_PENDING`: Card+아이콘 흉내 대신 `<UnknownState size="lg" icon="hourglass" … />`
  4. 목록 드리프트 셀: 인라인 style `<Link>` 대신 `<TableLinkCell href={k8sDetailHref(it.id, { view: "drift" })}>…</TableLinkCell>` (stopPropagation 내장)

### 9. 다음 담당이 알아야 할 점
- 시그니처
  - `PageHeaderProps.status.srPrefix?: string`, `PageHeaderProps.tabs?: ReactNode`, `PageHeaderProps.flushBottom?: boolean`
  - `UnknownStateProps.icon?: IconName` (기본 `circle-help`), `UnknownStateProps.headingLevel?: 2 | 3 | 4 | "p"`
  - `TableLinkCellProps { href: string; children: ReactNode; "aria-label"?: string; stopRowClick?: boolean (기본 true); className?: string }`
