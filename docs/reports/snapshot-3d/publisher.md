# snapshot-3d · 퍼블리셔 작업 보고

> 파일 위치: `docs/reports/snapshot-3d/publisher.md`
> 같은 기능에서 다시 작업하면 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다.

## 2026-09-20 · 1단계 UI 컴포넌트 (표현 계층)

### 1. 요청 내용
- PM 요청: 기능 `snapshot-3d` **1단계**(K8s 구성도 + 드리프트)의 UI 컴포넌트 구현. 표현 계층만 만들고 three.js 캔버스는 프론트 영역이므로 `canvasSlot`까지.
- 만들 것: `Scene3DFrame`(state 12종), `SceneToolbar`(A 48px / B 40px), `CameraControls`, `SceneInfoBar`, `SceneLegend`, `BlockDetailPanel`, `RelationItem`, `RelationTable`, `BlockMarkers`, `CertaintyChip`.
- 확장: `DataTable` `rowIndent`·`rowAria`, `Tabs` 6개 탭 수용. 아이콘 등록: `table-2`·`zoom-in`·`zoom-out`·`maximize`·`circle-dashed`·`unlink`·`chevron-up`·`waypoints`.
- 주의로 받은 것: 블록 면 색은 **종류(층)**이고 상태가 아니다. 상태·드리프트는 표식 아이콘 + 문구. 라이트·다크·색맹 고려. API 필드 이름은 계약 작성 중이므로 **표현 중심 props**. 사용자가 보고 있는 :3000/:3001 프로세스를 건드리지 않고 `next build`도 돌리지 않는다(서버도 띄우지 않음).

### 2. 참고한 문서
- `docs/design/snapshot-3d.md` 전체 (특히 3 레이아웃 · 4 장면 구성 · 5 색·토큰 · 6 도구 막대·오버레이·범례 · 7 선택 패널 · 8 관계 표 · 9 상태별 모습 · 10 겹쳐 보기 · 11 접근성 · 12 반응형 · 13 컴포넌트 사용 목록 · 14 계약 요청)
- `docs/design/components.md` 13절(아이콘) · **16절**(3D 전용 컴포넌트 16.1~16.10) · **17절**(기존 확장)
- `docs/design/status.md` **11절**(3D 규칙: 11.1 세 축 · 11.2 확실성·유령 · 11.3 라벨·접근성 · 11.4 정렬), 9.2 스캔 등급, 10.3 드리프트 구분
- `docs/design/tokens.json` (`color.*.viz` 신설, `opacity.vizDimmed`·`vizGhost`)
- `docs/specs/snapshot-3d.md` 1단계 범위(3.0·3.1·3.5~3.9, AC-3D01~33)
- 기존 코드: `apps/web/src/components/ui/**`(Chip·ScanCounts·DriftStatus·ResourceTree·DataTable·ResourceName·Tooltip·Popover 등), `apps/web/src/styles/**`

### 3. 작업 내용

**① 토큰 반영 (`styles/tokens.css`)**
- `node apps/web/scripts/build-tokens.mjs`로 `tokens.json`을 다시 생성했다(이 파일은 자동 생성물이라 직접 손대지 않았다). 결과로 라이트·다크 두 벌에 `--color-viz-kind-{workload,service,ingress,storage,aux}-{fill,edge,on-fill}`, `--color-viz-scene-*`, `--color-viz-plate-*`, `--color-viz-ghost-*`, `--color-viz-edge-*`, `--color-viz-select-outline`, `--color-viz-search-outline`, `--color-viz-label-*`, `--opacity-viz-dimmed: 0.25`, `--opacity-viz-ghost: 0.35`가 들어왔다.

**② 공용 모델 (`components/ui/viz/viz.ts`)**
- 타입: `VizLayer`, `Certainty`, `GhostReason`, `SceneState`(12종), `MarkerTone`, `BlockMarkerSource`, `BlockMarkerItem`.
- 상수: `VIZ_LAYER`(층 라벨·대표 종류·정렬 순서), `VIZ_LAYER_ORDER`(저장·설정 → 워크로드 → 서비스 → 진입 → 곁), `GHOST_REASON_TEXT`(4.4 사유 문구 5종), `CERTAINTY`(확정 `check` / 추정 `tilde`), `LEGEND_NOTES`(“블록 색은 층을 뜻합니다…” 2줄), `NO_EDGE_HINT`(4.5 상시 안내).
- 함수: `blockMarkerItems()` — 표식 **순서 고정**(스캔 → 드리프트 → 비교 불가 → 파일 문제 → Helm → 유령), `same`·0건은 표식 없음, Secret 유령은 `circle-dashed` + `key-round` 2개. `blockLocationText()`, `blockSelectionAnnouncement()`(7.1 aria-live 문장 생성).

**③ 새 컴포넌트 10종 + 보조 2종 (`components/ui/viz/*`)**
- `Scene3DFrame` — Card padding 0, 도구 막대 A/B 슬롯, 본문 = `height − 88px`, 오버레이 4곳(왼위 정보 줄 / 왼아래 범례 / 오른아래 카메라 / 위 가운데 알림), 상태 12종 분기(9절 문구 그대로), `sr-only` 건너뛰기 링크, `aria-live="polite"` 영역(선택 결과만).
- `SceneToolbar`(+ `SceneToolbarItem`, `SceneSearchNav`) — row A 48px / row B 40px, 오른쪽 결과 수 + trailing, 1280px 미만 접힘은 CSS로만.
- `CameraControls` — 세로 SegmentedControl(위/비스듬/앞) + `maximize`·`zoom-in`·`zoom-out` IconButton, 툴팁에 단축키.
- `SceneInfoBar` — 칩 목록(mock 슬롯 → 개수 → 드리프트 → stale → 리소스 밖 발견 → 묶어 보기·간소화 → `circle-help` 안내). **live 영역이 아니다.**
- `SceneLegend` — 층 5줄 + 유령 + 확정/추정 선 견본 + 표식 6개 + 하단 2줄 문구, 접기/펼침.
- `BlockDetailPanel` — 머리(선택 해제) · ① 식별 · ② 파일(앞을 자르고 파일 이름 보존 + 복사) · ③ 표식 줄 · ④ 표시 문구(InlineAlert neutral compact, 아이콘 `unlink`) · ⑤ 관계(8개 + 더 보기) · ⑥ 바닥 고정 이동 버튼, 빈 상태 `블록을 고르세요`.
- `RelationItem` / `RelationList` — 44px 한 줄, **항목 전체가 버튼 하나**, 2줄 근거 문구, `CertaintyChip`, 유령 상대 표시.
- `RelationTable` — `DataTable` 기반 트리 표(그룹 행 + 리소스 행 + 펼침 관계 2열), 열 6개(종류·이름 / 위치 136 / 표식 200 / 들어옴 72 / 나감 72 / 동작 176), 표식 열만 정렬, 200행 초과 가상 스크롤.
- `BlockMarkers` — `overlay`(18px 원, 최대 3 + `+N`) / `inline`(아이콘 + 문구) 두 변형, 모두 툴팁 + 스크린리더 문구.
- `CertaintyChip` — `확정`/`추정` + `선택 참조`, 색 구분 없음.
- 보조: `LayerSwatch`(층 색 사각 10/12px, 유령은 점선 빈 사각), `SCENE_TEXT`(9절 문구 상수).

**④ 기존 확장**
- `DataTable`: `rowIndent?: number | ((row) => number)` (CSS 변수 `--row-indent`로 첫 열 패딩에만 더함), `rowAria?: (row) => { level?, expanded? }` → `<tr aria-level aria-expanded>`. 펼침 가능한 행은 `aria-expanded`를 자동으로 채운다.
- `SegmentedControl`(디자인 문서에 없던 확장): 옵션에 `icon`·`tooltip`·`disabledReason`, 컴포넌트에 `orientation="vertical"`. 도구 막대 A의 `3D`/`표`(아이콘), 9.3의 3D 칸 `aria-disabled`, 6.3의 세로 시점 전환에 필요했다.
- `Switch`(같은 사유): `disabledReason` — 네이티브 disabled 대신 `aria-disabled` + 툴팁 + `aria-describedby`(6.2 드리프트 겹쳐 보기·주변만 보기).
- `Tabs`: **코드 변경 없음**. 6개 탭(3D 보기 포함) 렌더·화살표 키 이동·아이콘/숫자 없음을 테스트로 고정했다.
- 아이콘 8개 등록(`table-2`, `zoom-in`, `zoom-out`, `maximize`, `circle-dashed`, `unlink`, `chevron-up`, `waypoints`).

**⑤ 미리보기·테스트**
- `__preview__/Snapshot3DPreview.tsx` 추가 후 `UiPreview`에 연결 → `/dev/ui`에서 상태 12종을 Select로 바꿔 가며 눈으로 확인할 수 있다(고정 예시 데이터, fetch 없음). 캔버스 자리는 회색 판 문구로만 채웠다.
- `__tests__/snapshot-3d.test.tsx` 41개 테스트 추가.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/styles/tokens.css` | 수정(자동 생성) | `--color-viz-*`, `--opacity-viz-dimmed/ghost` 라이트·다크 반영 |
| `apps/web/src/components/ui/viz/viz.ts` | 추가 | 타입·층/유령/확실성 상수·표식 목록·선택 안내 문장 |
| `apps/web/src/components/ui/viz/viz.module.css` | 추가 | 3D 표현 컴포넌트 전체 스타일(토큰 변수만) |
| `apps/web/src/components/ui/viz/Scene3DFrame.tsx` | 추가 | 3D 카드 틀 + 상태 12종 + 오버레이 슬롯 + live 영역 |
| `apps/web/src/components/ui/viz/SceneToolbar.tsx` | 추가 | 도구 막대 A/B, 항목 래퍼, 검색 결과 이동 |
| `apps/web/src/components/ui/viz/CameraControls.tsx` | 추가 | 시점 3칸 + 초기화·확대·축소 |
| `apps/web/src/components/ui/viz/SceneInfoBar.tsx` | 추가 | 정보 줄 칩 목록 |
| `apps/web/src/components/ui/viz/SceneLegend.tsx` | 추가 | 범례(층·유령·관계·표식·문구) |
| `apps/web/src/components/ui/viz/BlockDetailPanel.tsx` | 추가 | 선택 정보 패널 + 이동 버튼 |
| `apps/web/src/components/ui/viz/RelationItem.tsx` | 추가 | 관계 한 줄 + 관계 목록 |
| `apps/web/src/components/ui/viz/RelationTable.tsx` | 추가 | 관계 표(대체 보기) |
| `apps/web/src/components/ui/viz/BlockMarkers.tsx` | 추가 | 표식(overlay·inline) |
| `apps/web/src/components/ui/viz/CertaintyChip.tsx` | 추가 | 확정·추정·선택 참조 칩 |
| `apps/web/src/components/ui/viz/LayerSwatch.tsx` | 추가 | 층 색 사각(유령 점선 포함) |
| `apps/web/src/components/ui/icons.tsx` | 수정 | 3D 아이콘 8개 등록 |
| `apps/web/src/components/ui/table/DataTable.tsx` | 수정 | `rowIndent`·`rowAria` 추가 |
| `apps/web/src/components/ui/table/table.module.css` | 수정 | 첫 열 패딩에 `--row-indent` 더함 |
| `apps/web/src/components/ui/controls/SegmentedControl.tsx` | 수정 | 옵션 `icon`·`tooltip`·`disabledReason`, `orientation` |
| `apps/web/src/components/ui/controls/Switch.tsx` | 수정 | `disabledReason`(aria-disabled + 툴팁) |
| `apps/web/src/components/ui/controls/controls.module.css` | 수정 | 세로 묶음·비활성 칸·스위치 비활성 스타일 |
| `apps/web/src/components/ui/index.ts` | 수정 | 16절 컴포넌트·타입 export |
| `apps/web/src/components/ui/__preview__/Snapshot3DPreview.tsx` | 추가 | `/dev/ui` 미리보기 |
| `apps/web/src/components/ui/__preview__/UiPreview.tsx` | 수정 | 미리보기 연결 |
| `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx` | 추가 | 컴포넌트 테스트 41개 |

### 5. 주요 결정과 이유
1. **`RelationItem` 안에 IconButton을 두지 않았다.** 디자인 7.3은 “항목 전체가 `<button>`” + “오른쪽 아래 IconButton”을 함께 적었지만 버튼 안 버튼은 HTML 위반이고 탭 정지점이 둘로 갈라진다. 오른쪽 `chevrons-right`는 장식(aria-hidden)으로 두고 클릭 동작(`이 블록 선택`)은 행 버튼이 가진다. 관계 목록이 키보드로 관계를 따라가는 길이라는 11.1 요구는 그대로 지켜진다.
2. **`rowIndent`를 숫자뿐 아니라 함수로도 받는다.** components.md 17.1은 `rowIndent?: number`로 적었지만 관계 표는 행마다 깊이가 다르다(네임스페이스 0 · 층 1 · 리소스 2). 기존 per-row prop(`rowStatus`·`rowStale`)과 같은 모양으로 함수도 허용했다. `rowAria`도 같은 이유로 함수다.
3. **`SegmentedControl`·`Switch`를 확장했다**(문서 17절에 없던 항목). 6.1 보기 전환은 아이콘이 필요하고 9.3은 3D 칸을 사유와 함께 비활성으로 두라고 하며, 6.3 시점 전환은 세로 묶음이다. 모두 **선택 prop**이라 기존 사용처 동작·DOM은 그대로다. → 디자이너 요청(8절)에 문서 반영을 남긴다.
4. **선택 패널·표의 표식을 `BlockMarkers inline` 하나로 통일했다.** 7.2 ③은 `DriftKindChip`·`ScanCounts`를 나열하지만, 같은 표식을 3D 오버레이·패널·표 세 곳에서 **같은 순서·같은 문구**로 읽히게 하는 것이 status.md 11.1/11.3의 핵심이라 단일 함수(`blockMarkerItems`)에서 만들도록 했다. 드리프트 색은 `text.secondary` 중립 고정(빨강·초록 없음).
5. **면 색과 상태를 코드 수준에서 분리했다.** 층 색은 `LayerSwatch`(`data-layer` → `--color-viz-kind-*`)에서만 쓰고, 상태·드리프트 색은 표식 `tone`으로만 쓴다. 범례 하단 2줄(`블록 색은 층을 뜻합니다. 상태가 아닙니다.`)은 접지 않으면 항상 보인다.
6. **정보 줄은 live 영역이 아니다.** 드리프트·개수·stale이 실시간으로 바뀌는데 이를 읽으면 스크린리더 소음이 된다. 읽는 것은 `Scene3DFrame`의 `liveMessage`(선택 결과) 하나뿐이고, 문장은 `blockSelectionAnnouncement()`로 만든다(7.1 예시와 같은 형식).
7. **`Scene3DFrame`이 표도 감싼다.** `unsupported`·`chunkFailed`·`contextLost`는 `tableSlot` + 안내를 자동으로 얹고, 사용자가 고른 표 보기는 `view="table"`로 안내 없이 그린다(9.3~9.4). 12열 한 장 레이아웃(8.1)은 페이지 조립이라 프론트가 결정한다.
8. **로딩 문구 150ms 지연을 CSS 애니메이션으로 처리**했다(기존 `Skeleton`과 같은 방법). 타이머 상태를 만들지 않아 컴포넌트가 계속 props만으로 동작한다. `prefers-reduced-motion`에서는 즉시 보인다.
9. **가상 스크롤은 펼친 행이 없을 때만 켠다.** `DataTable`의 가상 스크롤은 고정 행 높이를 가정한다. 관계 행을 펼치면 높이가 달라져 자리 계산이 어긋나므로 그 동안은 전체 렌더로 돌린다(8.2의 200행 규칙은 펼치기 전 기본 상태에서 지켜진다).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 problems) | |
| `npm run typecheck --prefix apps/web` | 통과 | |
| `npm test --prefix apps/web` (vitest) | 통과 **19 파일 / 344 테스트** (이번 추가 41개 포함) | 기존 303개도 모두 통과 — `DataTable`·`SegmentedControl`·`Switch` 확장이 기존 화면을 깨지 않음 |
| `next build` | **돌리지 않음** | 지시대로. 사용자가 :3000 dev 서버를 보고 있어 `.next` 충돌을 피했다 |
| 브라우저 육안 확인 | **하지 않음** | 서버를 띄우지 말라는 지시. 대신 `/dev/ui`에 미리보기를 추가해 두었으니 이미 떠 있는 dev 서버에서 `http://localhost:3000/dev/ui` 로 바로 볼 수 있다 |
| 라이트·다크 대비 실측 | **하지 않음**(계산 검증 없음) | 값은 designer가 5.3에서 대비를 확인한 토큰을 그대로 썼다 |

### 7. 남은 이슈·한계
- **반응형은 코드 규칙으로만 보장**했다(모든 flex 컨테이너 `min-width: 0`, 도구 막대 `flex-wrap`, 오버레이 `max-width: calc(100% - 24px)`, 캔버스 영역 `overflow: hidden`, 표는 `DataTable` 내부 스크롤). 실제 360px·1440px 렌더 확인은 못 했다(서버 금지). 프론트가 페이지를 붙일 때 확인 요청.
- 1280px 미만 “관계·표식 필터를 `필터 ▾` 하나로 접기”는 `SceneToolbarItem collapseBelow/showBelow`로 **자리만** 만들었다. 팝오버 안 내용 구성은 프론트가 조립한다.
- 9.7 묶어 보기(3,000블록 초과)는 패널 쪽 표현(`block.grouped`: 개수·관계 수 문구)만 넣었다. 묶음 블록 자체는 3D 장면(프론트) 몫이다.
- `RelationTable` 행 펼침 상태는 기본 내부 상태다(`openRowIds`로 제어 가능). URL에 남길 필요가 생기면 프론트가 제어형으로 쓰면 된다.
- 표식 아이콘 툴팁은 `Tooltip`(hover·focus 400ms)을 쓴다. 3D 캔버스 위 실제 블록 표식은 프론트가 이 컴포넌트를 2D 오버레이로 얹어야 툴팁이 동작한다.

### 8. 다른 담당 요청
- **디자이너 요청**: ① `components.md` 17절에 `SegmentedControl`(옵션 `icon`·`tooltip`·`disabledReason`, `orientation="vertical"`)과 `Switch`(`disabledReason`) 확장을 추가해 주세요. 6.1·6.3·9.3을 그리려면 필요했고 이미 구현했습니다. ② 17.1 `DataTable rowIndent`는 행마다 깊이가 달라 `number | (row) => number`로 넓혔습니다(문서 표기 갱신 요청). ③ 7.3의 “행 전체 버튼 + 오른쪽 아래 IconButton”은 중첩 버튼이라 아이콘을 장식으로 바꿨습니다(문서에 반영 요청).
- **백엔드 요청**: `docs/api/snapshot-3d.md`에 설계 14절 필드를 그대로 담아 주세요. 화면이 그대로 쓰는 값은 `blocks[].layer`, `blocks[].markers`(scan/drift/fileIssue/helm/notComparable), `blocks[].ghost{reason,text}`, `blocks[].notes[]{code,text}`, `edges[]{rule,certainty,evidence,optional}`, `summary`입니다. 특히 ① 드리프트 `fieldCount`(변경 건수) ② 표식 사유 **문구(text)** ③ `evidence` 문구(셀렉터·이름 규칙 등, **값 원문 금지**)가 없으면 화면이 문구를 지어내야 합니다. `ghost.reason` 값은 `not_in_snapshot|secret|autocreated|cluster_scope|drift_added` 5종으로 맞춰 주세요(기본 문구가 이 키에 붙어 있습니다).
- **프론트 요청**: 아래 9절 참고. `apps/web` 루트 설정은 건드리지 않았습니다.

### 9. 다음 담당(프론트)이 알아야 할 점
- import 는 모두 `@/components/ui` 한 곳에서 됩니다. 주요 props:
  - `Scene3DFrame`: `state`(`ready|loadingData|loadingChunk|building|empty|filteredEmpty|unsupported|chunkFailed|contextLost|error|unknown|stale`), `view`(`3d|table`), `toolbarA/toolbarB`, `canvasSlot`, `tableSlot`, `infoBar/legend/cameraControls/notice`, `height`(기본 `clamp(480px, calc(100vh - 176px), 960px)`), `stale`, `skipLinkHref`, `onRetry/onReenable/onShowTable/onResetFilters`, `buildingCount`, `keepScene`, `liveMessage`, `unknown*`/`error*`.
  - `SceneToolbar`: `row("a"|"b")`, `children`, `trailing`, `countText`, `busy`. 좁은 화면 접힘은 `SceneToolbarItem collapseBelow={1280}` / `showBelow={1280}`. 검색 이동은 `SceneSearchNav{index,total,onPrev,onNext}`.
  - `CameraControls`: `view("top"|"iso"|"front")`, `onView/onReset/onZoomIn/onZoomOut`.
  - `SceneInfoBar`: `items[{id,icon,text,tone,href,tooltip}]`, `mockBadge`(여기에 `DataSourceBadge`를 넣습니다), `staleAt`, `hint`.
  - `SceneLegend`: `layers?`(기본 5줄), `collapsed/onCollapsedChange`, `markers?`.
  - `BlockDetailPanel`: `block`(`{id,layer,kind,kindIcon?,apiVersion?,name,namespace,file,fileNote?,documentIndex/Count?,ghost?,grouped?}` 또는 `null`), `markers`, `notes[]`, `incoming/outgoing`(RelationItemProps[]), `actions{file,drift,secrets,note}`(각 `{href?|disabledReason?}`), `onSelectRelated`, `onClear`, `height`.
  - `RelationTable`: `rows`(평탄화한 `group`/`resource` 행 + `depth`), `expandedIds/onExpandedChange`, `selectedId/onSelectRow`, `openRowIds/onToggleRow`, `summary`, `sort("default"|"markers")/onSortChange`, `state`, `height`.
  - `BlockMarkers`: `{scan,drift,fileIssue,helm,notComparable,ghost}` + `variant("overlay"|"inline")`, `max`.
  - `CertaintyChip`: `{certainty,optional,evidence,plain}` — 버튼·링크 안에 넣을 때 `plain`.
  - `LayerSwatch`: `{layer,size(10|12),ghost}` — 3D 장면 밖에서 층 색이 필요할 때 쓰세요.
- **3D 장면 색은 CSS 변수에서 읽으세요.** three.js 재질 색은 `getComputedStyle(document.documentElement).getPropertyValue("--color-viz-kind-workload-fill")` 식으로 가져오면 테마 전환(라이트/다크)에 자동으로 맞습니다. 하드코딩하지 마세요. 흐림은 `--opacity-viz-dimmed`(0.25), 유령 면은 `--opacity-viz-ghost`(0.35), 배경·안개는 `--color-viz-scene-bg/fog`, 관계선은 `--color-viz-edge-*`, 선택·검색 윤곽은 `--color-viz-select-outline`/`--color-viz-search-outline`입니다.
- **캔버스의 `role="application"`·`aria-roledescription`·`aria-label`·키보드 처리는 프론트가 `canvasSlot` 안에서** 하세요. 프레임은 캔버스 앞 건너뛰기 링크와 선택 결과 live 영역만 제공합니다. 선택이 바뀔 때 `blockSelectionAnnouncement({kind,name,namespace,markers,incoming,outgoing})` 결과를 `liveMessage`로 넘기면 7.1 문장이 그대로 읽힙니다(카메라 조작은 넘기지 마세요 — 소음).
- **정렬·배치 순서는 서버가 준 순서를 그대로** 쓰세요. 표의 기본 정렬과 3D 배치가 같아야 하고(`status.md` 11.4), 표식 열 외 정렬은 막아 두었습니다.
- 표식·관계 수는 3D와 표에서 **같은 값**이어야 합니다(AC-3D04). 두 보기 모두 같은 `markers`/`summary` 값을 넘기세요.
- `/dev/ui`에 `Snapshot3DPreview`가 붙어 있습니다. 상태 12종을 Select로 바꿔 보면서 붙이면 빠릅니다.
- 테스트는 `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx`에 있습니다(41개). 문구를 바꾸려면 `SCENE_TEXT`·`viz.ts` 상수를 고치면 테스트가 함께 따라옵니다.

---

## 2026-09-20 (2) · 판(네임스페이스) 표식 반영

### 1. 요청 내용
- PM 전달: designer가 판 표식 설계를 마쳤고 publisher 요청 6건이 문서에 반영됐다. 기존 구현은 되돌릴 필요 없이 **보태기**만 한다.
  1. `BlockMarkers`: `variant`에 `plate`(알약 h20/radius 4/패딩 0 6) 추가, `notes?`, `hrefs?`, `density?`(0~3), inline 문구 `사용자 지정`
  2. `RelationTable`: 그룹 행 `groupKind`·`markers`·`notes`·`location`·`actions`·`emptyHint`, 층 행은 세 열 비움, 클릭 영역 분리, 판 행은 선택 대상 아님, `aria-level`·`aria-expanded`
  3. `Scene3DFrame`: `notice`가 `ReactNode[]`도 허용(세로 8px, 최대 2개)
  4. `SceneLegend`: 판 표식 줄(알약 예시 + "원은 블록, 알약은 판")
  5. 새 컴포넌트 `PlateLabel`(폭 P0 200 / P1 가변 / P2 84 / P3 64px, 위치·단계 계산은 프론트)
  6. 아이콘 `shapes` 추가
- 제약: :3000·:3001 프로세스 유지, `next build`·서버 실행 금지.

### 2. 참고한 문서
- `docs/design/snapshot-3d.md` 4.1.1(판 표식·클릭·축소 사다리 P0~P3) · 4.4(유령 보임 규칙) · 4.7 · 6.6(`notices[]` 자리) · 7.4(`notes[]` 10종 자리) · 8.3(그룹 행) · 9.7 · 9.9(일부만 표시·알림 스택) · 14.1(계약 확정본 매핑)
- `docs/design/components.md` 13절(`shapes`) · 16.8 · 16.9 · 16.11 · 17.4 · 17.5
- `docs/design/status.md` 11.5(원 = 블록 / 알약 = 판)

### 3. 작업 내용
- **`viz.ts`**
  - `BlockMarkerItem`에 `plate`(알약 문구)와 `href` 추가. 같은 표식이 블록·판·표에서 **같은 뜻·같은 순서**를 쓰되 문구 길이만 자리에 맞춘다: 스캔 `오류 1` / 드리프트 short `변경 2` · plate `변경 · 필드 2건` · text `변경됨 · 필드 2건`.
  - `BlockMarkerSource`에 `notes?: {code,text,count?}[]`, `hrefs?: {scan?,drift?}` 추가. `notComparable`에 `kind?: "uncomparable" | "skipped"` — `skipped`면 `file-warning` warn + `비교 못 함`(4.1.1 ② 마지막 줄).
  - `NOTE_SPEC` 추가(`custom_resource` → `shapes`/`사용자 지정`/`사용자 지정 리소스`, `namespace_file_missing` → `file-question`). **모르는 code는 버리지 않고** 서버 `text` 그대로 `info` 아이콘으로 보인다(6.6 마지막 규칙).
  - `PLATE_MARKER_NOTE`(범례 문구) 추가.
- **`BlockMarkers`**: `variant="plate"` 추가(알약 20px, 아이콘 12 + 문구 micro, 최대 3 + `+N`). `density` 0~3 구현 — 0 전체 / 1 아이콘만 / 2 1순위 아이콘 + 총계 / 3 1순위 아이콘만. **어느 단계에서도 표식은 하나 남고**, 전체 문구는 `sr-only`로 항상 남는다. `hrefs`가 있는 표식만 `<a>`(next `Link`)로 그린다.
- **`PlateLabel`(신규)**: 이름(가운데 말줄임 뒤 8자) + 시스템 칩 / `리소스 11 · 유령 5` / 판 알약. DOM 순서는 읽는 순서(이름 → 수 → 표식), 화면은 `column-reverse`로 아래에서 위로 쌓아 판을 가리지 않는다. 폭은 `density`로 P0 200 / P1 가변(프론트가 style) / P2 84 / P3 64px. 이름은 `<button tabIndex={-1}>`이라 **캔버스 탭 순서에 들어가지 않는다**(키보드 경로는 관계 표 판 그룹 행).
- **`RelationTable`**: 그룹 행을 판/층으로 나눴다. 층 행만 `DataTable groupRow`(colSpan)로 남겨 세 열을 자연스럽게 비우고, **판 행은 보통 행처럼 셀 6개를 채운다**(위치 = `prod/namespace.yaml` 앞 자르기, 표식 = `BlockMarkers inline`, 들어옴/나감 = `—` + `aria-label="해당 없음"`, 동작 = 파일·드리프트 ghost sm). 이름 칸은 `chevron + 아이콘 + 이름 + (개수)` 하나의 버튼이라 **여기서만 펼침/접힘**이 일어나고, 판 행은 `onSelectRow`를 호출하지 않는다. `emptyHint`가 있으면 문구를 붙이고 버튼을 `aria-disabled`로 둔다. 판 행 배경은 `tr:has(.rtPlateCell)`로 칠했다.
- **`Scene3DFrame`**: `notice`가 배열이면 `MAX_NOTICES`(2)까지 세로 8px로 쌓는다. 우선순위(잘림 → 구성 변경 → 저사양)는 배열 순서로 호출 측이 정한다.
- **`SceneLegend`**: 표식 아이콘 줄 아래에 원/알약 견본 한 줄 + `원은 블록, 알약은 판(네임스페이스)입니다.` 문구를 넣었다.
- **아이콘**: `shapes` 등록(`file-question`은 기존 등록분 재사용).
- **미리보기·테스트**: `/dev/ui` 캔버스 자리에 `PlateLabel` P0~P3 네 개를 나란히 두고, 관계 표 예시의 첫 행을 판 그룹 행(표식·경로·동작 포함)으로 바꿨다. 테스트 11개 추가(총 52개).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/viz/viz.ts` | 수정 | `plate`·`href` 필드, `notes`·`hrefs`·`notComparable.kind`, `NOTE_SPEC`, `PLATE_MARKER_NOTE` |
| `apps/web/src/components/ui/viz/BlockMarkers.tsx` | 수정 | `plate` 변형, `density` 축소 사다리, 링크 표식 |
| `apps/web/src/components/ui/viz/PlateLabel.tsx` | 추가 | 판 라벨 상자(P0~P3) |
| `apps/web/src/components/ui/viz/RelationTable.tsx` | 수정 | 판/층 그룹 행 분리, 판 행 표식·위치·동작·클릭 영역 분리 |
| `apps/web/src/components/ui/viz/Scene3DFrame.tsx` | 수정 | `notice` 배열(최대 2개, 8px 스택), `MAX_NOTICES` |
| `apps/web/src/components/ui/viz/SceneLegend.tsx` | 수정 | 원/알약 구분 줄 |
| `apps/web/src/components/ui/viz/viz.module.css` | 수정 | 알약·판 라벨·판 행·범례 견본·알림 스택 스타일 |
| `apps/web/src/components/ui/icons.tsx` | 수정 | `shapes` 등록 |
| `apps/web/src/components/ui/index.ts` | 수정 | `PlateLabel`·`NOTE_SPEC`·`PLATE_MARKER_NOTE`·`MAX_NOTICES`·`BlockNote` export |
| `apps/web/src/components/ui/__preview__/Snapshot3DPreview.tsx` | 수정 | P0~P3 판 라벨, 판 그룹 행 예시 |
| `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx` | 수정 | 판 표식·PlateLabel·판 그룹 행·알림 스택 테스트 11개 추가 |

### 5. 주요 결정과 이유
1. **판 행을 `DataTable groupRow`에서 뺐다.** groupRow는 전체 열을 colSpan으로 덮어 위치·표식·동작을 그릴 수 없다. 층 행만 groupRow로 남기고 판 행은 일반 행으로 그려 8.3 표를 그대로 만족시켰다. 배경(`bg.surfaceSunken`)은 `tr:has(.rtPlateCell)` 선택자로 칠했다 — `DataTable`에 행 className prop을 새로 뚫지 않기 위해서다(다른 화면에 영향 0).
2. **클릭 영역 분리를 "이름 버튼"으로 구현**했다. `DataTable`은 셀 안 `a`/`button` 클릭을 행 클릭으로 처리하지 않으므로 표식 링크·동작 버튼은 자동으로 전파되지 않는다. 판 행은 `onRowClick`에서 일찍 반환해 선택되지 않는다.
3. **`skipped`(비교 못 함)를 `notComparable.kind`로 받는다.** 아이콘이 `file-warning`이라 파일 문제와 겹쳐 보이지만 **드리프트 축**이므로 클릭은 드리프트 탭으로 간다(`hrefs.drift`). `fileIssue`로 넘기면 파일 탭으로 가 버린다.
4. **`density` 2·3의 "합침"은 1순위 아이콘 기준**이다. 순위는 표식 순서(스캔 → 드리프트 → …)와 같아서 가장 급한 것이 남는다. 문구가 사라져도 `sr-only`와 툴팁에는 전부 남는다(표식은 어느 단계에서도 사라지지 않는다는 4.1.1 규칙).
5. **`PlateLabel`은 DOM 순서와 시각 순서를 분리**했다(`column-reverse`). 판 라벨은 아래에서 위로 쌓아야 판을 가리지 않는데, 읽는 순서는 이름이 먼저여야 한다.
6. **알림 개수 제한을 컴포넌트가 지킨다**(`MAX_NOTICES = 2`). 우선순위 판단(잘림 > 구성 변경 > 저사양)은 상태를 아는 프론트가 배열 순서로 준다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 problems) | |
| `npm run typecheck --prefix apps/web` | 통과 | |
| `npm test --prefix apps/web` | 통과 **19 파일 / 355 테스트**(snapshot-3d 52개) | 기존 테스트 무영향 |
| `next build` · 서버 실행 | **하지 않음** | 지시대로(:3000·:3001 유지) |
| 브라우저 육안 확인 | 하지 않음 | `/dev/ui`에 P0~P3 판 라벨과 판 그룹 행 예시를 넣어 두었다 |

### 7. 남은 이슈·한계
- 판 라벨의 **위치(투영 좌표)·가용 폭 `A` 계산·단계 선택은 프론트 몫**이다. `PlateLabel`은 `density`를 받아 그리기만 한다. P1은 폭이 가변이라 프론트가 `style={{ width: A }}`(또는 컨테이너)로 폭을 정해야 한다.
- 블록 라벨과 판 라벨의 겹침 회피(판 라벨이 이긴다)는 3D 좌표 계산이라 프론트에서 한다.
- `tr:has(...)`를 쓰므로 `:has()`를 지원하지 않는 아주 오래된 브라우저에서는 판 행 배경만 빠진다(정보 손실 없음 — 아이콘·문구·들여쓰기로 구분된다).
- 정렬(`표식` 열)을 켰을 때 "판 순서는 그대로, 판 안에서만 정렬"하는 것은 **행 배열을 만드는 쪽(프론트)** 책임이다. 표는 받은 순서를 그대로 그린다.

### 8. 다른 담당 요청
- **프론트 요청**: ① 판 알약 클릭 이동은 `markers.hrefs = { scan: "?view=files&file=…&line=…", drift: "?view=drift&res=…" }`로 넘기세요(`navigate.file`이 null이면 `hrefs.scan`을 주지 마세요 — 그러면 알약이 링크가 아니라 글자로 남습니다). ② `PageDown`/`PageUp`으로 판에 들어갈 때 읽을 문장은 `prod 판, 리소스 11개, 변경됨 · 필드 1건, 스캔 경고 2건` 형식으로 만들어 `Scene3DFrame liveMessage`에 넣으세요(판 전용 문장 생성기는 만들지 않았습니다 — 필요하면 요청 주세요). ③ 표식이 있는 판은 자식이 0이어도 행을 남기고 `emptyHint="표시할 리소스 없음"`을 주세요.
- **디자이너 요청**: 없음(이번 6건은 모두 반영 완료).

### 9. 다음 담당이 알아야 할 점 (새 prop 시그니처)
- `BlockMarkers`: `variant?: "overlay" | "inline" | "plate"`, `density?: 0|1|2|3`(plate 전용), `notes?: { code; text; count? }[]`, `hrefs?: { scan?: string; drift?: string }`, `notComparable?: { reason?; text; kind?: "uncomparable" | "skipped" }`, `max?`, `srPrefix?`.
- `PlateLabel`: `{ name, kind?: "namespace"|"cluster"|"unparsed"|"ghost", system?, resourceCount?, ghostCount?, markers?(BlockMarkers props, variant·density는 자동), density?: 0|1|2|3, onNameClick?, onNameDoubleClick?, className? }`.
- `RelationTable` 그룹 행: `{ id, type: "group", groupKind?: "plate"|"layer", depth, label, count?, icon?, layer?, trailing?, location?, markers?, actions?: { file?, drift? }, emptyHint? }` — `groupKind`를 주지 않으면 **판 행**으로 본다.
- `Scene3DFrame`: `notice?: ReactNode | ReactNode[]`(최대 `MAX_NOTICES` = 2, 앞에 오는 것이 우선).
- 상수: `NOTE_SPEC`(code → 아이콘·문구), `PLATE_MARKER_NOTE`, `MAX_NOTICES`, `BlockNote` 타입.

---

## 2026-09-20 (3) · 1단계 통합 후 보완 3건 (하위 호환)

### 1. 요청 내용
- PM 전달: 프론트 1단계 통합(`docs/reports/snapshot-3d/frontend.md` 8절 퍼블리셔 요청 3건)을 반영한다. **기존 사용처를 깨지 않는 보태기**만 한다.
  1. `NOTE_SPEC`에 `selector_missing`·`no_target`·`pvc_template_unmatched` 추가(아이콘 `unlink`, 문구는 디자인 6.6/7.4 기준)
  2. `InlineAlert`에 `closable`/`onClose` 추가 — 프론트가 닫을 수 있는 알림 3종을 `action` 슬롯의 `IconButton x`로 흉내 내고 있다. 정식 prop으로 만들고 바꿔 쓸 시그니처를 보고
  3. `RelationTable` 판 행의 `(11)`이 **전체 수인지 보이는 수인지** 확정(현재 구현은 보이는 수). 디자인 8.3과 대조해 정하고, 필요하면 두 값을 모두 보이게 prop 정의
- 제약: 사용자가 :3000(next dev)·:3001을 보고 있다 → 그 프로세스를 건드리지 않고 `next build`·서버 실행 금지. 검증은 lint·typecheck·vitest.

### 2. 참고한 문서
- `docs/reports/snapshot-3d/frontend.md`(8절 퍼블리셔 요청 3건, 7절 남은 이슈), `docs/reports/snapshot-3d/publisher.md`(앞 두 섹션)
- `docs/design/snapshot-3d.md` — 4.1.1(판 표식·축소 사다리), 6.1(도구 막대 결과 수 `블록 128개 중 12개`), **6.6**(`notices[]` 자리 + 모르는 code 규칙), 7.2 ④(표시 문구 `InlineAlert`), **7.4**(`notes[]` 10종 → 화면 자리), 8.2(표 요약 `… 중 12개`), **8.3**(그룹 행), 9.5(저사양 알림 닫기), 9.9(잘림 알림 닫기 / 표 위는 닫기 없음)
- `docs/design/components.md` 6.2(`InlineAlert`), 13절(아이콘 `unlink`), 16.8·16.9, 17절
- `docs/api/snapshot-3d.md` 6.2(`notes[]` 코드·서버 문구·`count` 의미)
- 기존 코드: `components/ui/viz/**`, `components/ui/feedback/Banner.tsx`, 프론트 쪽 `features/k8s-snapshots/graph/model.ts`(`markerSource`·`INFO_NOTES`·`ALERT_NOTES`)·`GraphTab.tsx`(알림 3종)

### 3. 작업 내용

**① `NOTE_SPEC` 3종 추가 (`viz/viz.ts`)**
- `selector_missing`·`no_target`·`pvc_template_unmatched`를 아이콘 `unlink`로 등록했다(디자인 13절 `unlink` = "대상 없음·연결 못 찾음", 7.4 1순위 "관계를 못 그린 사유").
- 문구는 **자리에 맞는 길이 세 벌**을 유지한다(기존 규칙 그대로): `short`(관계 표 표식 열 200px) / `plate`(판 알약·툴팁) / `text`(**서버 문구 그대로** — 툴팁·스크린리더). 서버 `text`는 어떤 경우에도 그대로 남는다.
  - `selector_missing`: short `셀렉터 없음` / label `셀렉터 없음 (수동 Endpoints·ExternalName)`
  - `no_target`: short·label `대상 없음`
  - `pvc_template_unmatched`: short `맞는 PVC 없음` / label `PVC 템플릿 — 맞는 PVC 없음`
- `NoteSpec`에 `withCount?: (count) => { short, label }`를 새로 뒀다. 7.4가 `pvc_template_unmatched`만 "`count` 포함"이라고 적었는데, 기존의 "문구 뒤에 숫자를 붙인다" 규칙을 그대로 쓰면 `맞는 PVC 없음 2`가 되어 뜻이 어긋난다. `count ≥ 1`이면 `맞는 PVC 없음 (템플릿 2)` / `PVC 템플릿 2개 — 맞는 PVC 없음`을 만든다. `withCount`가 없는 코드는 예전과 **완전히 같은** 동작(`count > 1`일 때 숫자 접미).
- 모르는 code는 예전처럼 `info` 아이콘 + 서버 문구 그대로(6.6 마지막 규칙) — 테스트로 고정했다.
- **표식 원(블록 위)은 여전히 만들지 않는다**: 7.4가 이 세 코드의 "블록 표식(원) = 없음"이라고 정했고, 프론트가 이미 `markerSource(..., { variant: "overlay" })`에서 `notes`를 비운다. 이번 변경은 `inline`(선택 패널 ③·관계 표 표식 열)과 `plate`(판 알약) 문구·아이콘만 바꾼다.

**② `InlineAlert` `closable`/`onClose` (`feedback/Banner.tsx`)**
- `closable?: boolean` + `onClose?: () => void` + `closeLabel?: string`(기본 `이 안내 닫기`)를 추가했다. 두 값이 **모두 있을 때만** 오른쪽 끝에 `IconButton x sm`을 그린다(`Banner`의 `dismissible`+`onDismiss`와 같은 안전장치).
- 자리는 `action` **뒤 마지막**이다. 그래서 9.5 저사양 알림처럼 `[표로 보기]`와 닫기가 함께 있어도 닫기가 항상 같은 자리에 온다. 간격·정렬은 `Banner`가 쓰던 `.alertClose`를 그대로 재사용해 CSS 추가가 없다.
- 9.9의 "표 위 같은 알림은 닫기 없음"은 `closable`을 주지 않으면 그대로다.

**③ `RelationTable` 그룹 행 개수: `보이는 수 / 전체` (`viz/RelationTable.tsx`)**
- **결론: `count`는 "보이는 수"가 맞다**(현재 프론트 구현 유지). 디자인 8.3에는 필터 중 규칙이 없지만, 같은 화면의 다른 개수 표기가 모두 "그린 수"를 앞에 두기 때문이다 — 6.1 도구 막대 `블록 128개 중 12개`, 8.2 표 요약 `블록 128개 중 12개 …`, 4.4/AC-3D04의 "3D와 표는 같은 수치". 그룹 행만 전체 수를 적으면 같은 화면 안에서 기준이 둘이 된다.
- 다만 **필터 중에는 전체 수도 같이 보여야** 8.3의 `표시할 리소스 없음`(자식 0인 판) 규칙이 말이 된다(`(0)`만 있으면 판이 원래 비어 있는지 필터에 걸린 건지 알 수 없다). 그래서 `totalCount?: number`를 새로 뒀다.
  - `totalCount`가 없거나 `count`와 같으면 → 예전 그대로 `(11)`
  - 다르면 → `(3 / 11)` = **보이는 수 / 전체**, 스크린리더는 `/`를 읽지 않게 `11개 중 3개 표시` 한 문장(`sr-only`)으로 읽는다
- 판 행·층 행 모두 같은 `GroupCount` 보조 컴포넌트를 쓴다(두 곳에 흩어져 있던 개수 렌더를 하나로 모았다).

**④ 미리보기·테스트**
- `/dev/ui` 미리보기 맨 아래 관계 표를 **필터 중 모습**(판 `(12 / 42)` · 층 `(3 / 12)`, 요약 `블록 128개 중 12개 …`)으로 바꾸고, 그 위에 닫히는 `InlineAlert`(9.9 잘림 알림) 예시를 넣었다. `Scene3DFrame` 안 표(필터 없음)는 `(42)` 그대로라 두 모습을 한 화면에서 비교할 수 있다.
- 테스트 12개 추가(총 64개): `unlink` 아이콘 3종, 짧은 문구 vs 서버 문구, `count` 문구, 모르는 code, 표식 열 렌더 / 닫기 호출·자리·`onClose` 없을 때 / 개수 4가지 경우.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/viz/viz.ts` | 수정 | `NoteSpec` 타입 + `withCount`, `NOTE_SPEC`에 `selector_missing`·`no_target`·`pvc_template_unmatched`(아이콘 `unlink`) |
| `apps/web/src/components/ui/feedback/Banner.tsx` | 수정 | `InlineAlert`에 `closable`·`onClose`·`closeLabel` |
| `apps/web/src/components/ui/viz/RelationTable.tsx` | 수정 | 그룹 행 `totalCount`, `GroupCount` 보조 컴포넌트(`(3 / 11)` + `sr-only` 문장) |
| `apps/web/src/components/ui/index.ts` | 수정 | `type NoteSpec` export |
| `apps/web/src/components/ui/__preview__/Snapshot3DPreview.tsx` | 수정 | 필터 중 표(`FILTERED_ROWS`) + 닫히는 알림 예시 |
| `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx` | 수정 | 테스트 12개 추가(52 → 64) |

### 5. 주요 결정과 이유
| 결정 | 검토한 대안 | 이유 |
|---|---|---|
| `count` = **보이는 수**로 확정, 전체는 `totalCount`로 따로 | `count`를 전체 수로 바꾸고 보이는 수를 새 prop으로 | 기존 호출(프론트 1단계 통합)이 이미 보이는 수를 넣고 있어 **의미를 바꾸면 조용히 틀린 숫자**가 된다. 같은 화면의 6.1·8.2 표기도 "그린 수"가 앞이다 |
| 두 값 표기를 `(3 / 11)`로 | `(3 / 11개)`, `(11개 중 3개)`, 툴팁만 | 행 이름 칸은 폭이 좁고 숫자는 tabular다. 긴 문장은 `sr-only`와 요약 caption이 이미 맡고 있다 |
| 두 값이 같으면 한 값만 | 항상 `(11 / 11)` | 필터가 없을 때가 기본이고, 같은 수를 두 번 적으면 "무언가 걸러졌다"는 잘못된 신호를 준다 |
| `NoteSpec.withCount` 도입 | `short`에 숫자 접미(기존 규칙) | `맞는 PVC 없음 2`는 "PVC 2개가 없다"로 읽힌다. 계약의 `count`는 **템플릿 수**다 |
| `closable`+`onClose` 둘 다 있어야 그림 | `closable`만으로 그리고 `onClose` 선택 | 닫기를 눌렀는데 아무 일도 없는 버튼을 막는다. `Banner`(`dismissible`+`onDismiss`)와 같은 규칙 |
| prop 이름을 `closable`/`onClose`로 | `Banner`와 맞춰 `dismissible`/`onDismiss` | 요청받은 이름을 그대로 썼다. 두 컴포넌트의 이름이 다른 점은 디자이너 요청으로 남긴다(8절) |
| 닫기 버튼을 `action` **뒤**에 | `action` 앞 | 9.5처럼 실제 동작 버튼이 함께 올 때 닫기가 늘 마지막 자리여야 손·눈이 찾기 쉽다. `Banner`도 같은 순서다 |

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` (= `eslint`) | **src 기준 통과(0 problems)** — 단, 인자 없이 돌리면 `5933 problems (192 errors)` | 전부 `apps/web/.next-build/**`(누군가 `next build --distDir .next-build`로 만든 빌드 산출물)에서 나온다. `eslint.config.mjs`가 `.next`만 무시하고 `.next-build`는 무시하지 않는다. `npm run lint -- src` 로 돌리면 0 problems. → 프론트 요청(8절) |
| `npm run typecheck --prefix apps/web` | **통과** | |
| `npm test --prefix apps/web` (vitest) | **통과 20 파일 / 381 테스트** | 이번 추가 12개. 기존 369개 그대로 통과 = 세 변경 모두 하위 호환 |
| `next build` · 서버 실행 | **하지 않음** | 지시대로(:3000·:3001 유지) |
| 브라우저 육안 확인 | 하지 않음 | 이미 떠 있는 dev 서버의 `http://localhost:3000/dev/ui` 에서 바로 볼 수 있게 미리보기만 갱신 |

### 7. 남은 이슈·한계
- `(3 / 11)`의 **전체 수를 만드는 쪽은 프론트**다. 표는 받은 값을 그대로 그린다. 필터 전 자식 수를 세어 `totalCount`로 넘기지 않으면 예전과 똑같이 한 값만 보인다(깨지지 않음).
- `pvc_template_unmatched`의 짧은 문구(`맞는 PVC 없음 (템플릿 2)`)는 **퍼블리셔가 줄인 표현**이다. 서버 원문(`PVC 템플릿 2개(스냅샷에 PVC 없음)`)은 툴팁·스크린리더에 그대로 남지만, 디자인 문구표에 확정본이 없으므로 디자이너 확인이 필요하다(8절).
- `InlineAlert`와 `Banner`의 닫기 prop 이름이 다르다(`closable`/`onClose` vs `dismissible`/`onDismiss`). 이번엔 요청받은 이름을 썼고, 통일은 디자이너·PM 판단에 맡긴다.
- 9.5 저사양 알림의 "한 번 닫으면 이 스냅샷을 보는 동안 다시 뜨지 않는다"는 **상태**라 여전히 프론트 몫이다(컴포넌트는 `onClose`만 알린다).
- 라이트·다크 대비 실측, 360px~1440px 실제 렌더 확인은 이번에도 하지 않았다(서버 실행 금지). 새로 추가한 것이 텍스트 한 조각과 기존 `IconButton` 재배치뿐이라 레이아웃 위험은 낮다고 판단했다.

### 8. 다른 담당 요청
- **프론트 요청**
  1. 알림 3종을 새 prop으로 바꿔 주세요. `action={<IconButton icon="x" size="sm" label="이 안내 닫기" onClick={…} />}` → `closable onClose={…}`. 9.5 저사양 알림처럼 동작 버튼이 함께 있으면 `action`에는 `[표로 보기]`만 남기고 닫기는 `closable`/`onClose`로 넘기면 됩니다(`<>…</>`로 두 버튼을 묶던 것이 사라집니다). 9.9 **표 위** 알림에는 `closable`을 주지 마세요(디자인이 "닫기 없음").
  2. 그룹 행에 `totalCount`(필터 전 전체 자식 수)를 넣어 주세요. 필터가 없으면 `count`와 같아서 화면이 그대로고, 필터 중이면 `(3 / 11)`로 바뀝니다. 8.3의 `emptyHint="표시할 리소스 없음"` 행에도 함께 주면 `(0 / 11)`이 되어 "원래 빈 판"과 구분됩니다.
  3. `selector_missing`·`no_target`·`pvc_template_unmatched`는 이제 `unlink` 아이콘 + 짧은 문구로 나옵니다. `model.ts`의 `INFO_NOTES`(inline)·`ALERT_NOTES`(패널 ④)·overlay 제외 규칙은 **그대로 두세요** — 7.4가 정한 자리와 맞습니다.
  4. (영역 밖이라 고치지 못함) `apps/web/eslint.config.mjs`의 무시 목록에 **`.next-build/`** 를 넣어 주세요. 지금 `npm run lint --prefix apps/web`를 그냥 돌리면 빌드 산출물에서 192 errors / 5,741 warnings가 나와 실제 문제를 덮습니다(`npm run lint -- src`로는 0). `.next-build/`는 번들 측정용으로 만들어진 폴더로 보입니다 — 지우거나 `.gitignore`에도 넣어 주세요.
- **디자이너 요청**
  1. `components.md` 6.2 `InlineAlert`에 `closable`/`onClose`/`closeLabel`을 추가해 주세요(9.5·9.9가 "닫기 있음"을 요구하는데 prop이 없었습니다). `Banner`는 `dismissible`/`onDismiss`라 이름이 어긋나는데, 통일할지 판단 부탁드립니다.
  2. `components.md` 16.8 그룹 행에 `totalCount`(필터 중 `보이는 수 / 전체`)를 추가해 주세요. 8.3에 "필터 중 개수 표기" 문장을 한 줄 넣어 주시면 좋겠습니다 — 지금은 6.1·8.2 표기와의 일관성으로 정했습니다.
  3. `snapshot-3d.md` 7.4 표에 `pvc_template_unmatched`의 **짧은 문구 확정본**을 적어 주세요(현재 퍼블리셔 표현: 표 `맞는 PVC 없음 (템플릿 2)` / 판 알약 `PVC 템플릿 2개 — 맞는 PVC 없음`). 서버 원문은 툴팁·스크린리더에 그대로 남습니다.
- **백엔드 요청**: 없습니다.

### 9. 다음 담당이 알아야 할 점 (새 prop 시그니처)

```ts
// components/ui/feedback/Banner.tsx
InlineAlert: {
  closable?: boolean;            // onClose 와 함께 있어야 그린다
  onClose?: () => void;
  closeLabel?: string;           // 기본 "이 안내 닫기"
}                                // 자리: action 뒤 마지막. 기존 props 는 그대로

// components/ui/viz/RelationTable.tsx — RelationGroupRow
{
  count?: number;                // 지금 보이는 자식 수 (기존 의미 그대로)
  totalCount?: number;           // 필터 전 전체 수. count 와 다르면 `(3 / 11)` + sr-only "11개 중 3개 표시"
}

// components/ui/viz/viz.ts
export interface NoteSpec {
  icon: IconName;
  short: string;                 // 표 표식 열·패널 칩
  label: string;                 // 판 알약·툴팁
  withCount?: (n: number) => { short: string; label: string };
}
// NOTE_SPEC: selector_missing | no_target | pvc_template_unmatched (icon "unlink")
//          | custom_resource | namespace_file_missing
```

- 세 새 코드는 **표식 원(overlay)에 넣지 않는다**(7.4). `inline`(선택 패널 ③·표 표식 열)과 `plate`(판 알약)에서만 쓴다.
- `blockMarkerItems()`의 `text`는 언제나 **서버 문구 그대로**다. 문구를 줄이는 것은 `short`/`plate`뿐이고 전문은 툴팁·`sr-only`에 남는다.

---

## 2026-09-20 (4) · 디자인 보완 반영 8건 (KindIcon 신설 · 범례 팝오버 · 닫기 이름 통일)

### 1. 요청 내용

PM 전달: designer의 세 번째 보완(`designer.md` 2026-09-20 (3) 8절 publisher 요청 9건)을 반영한다. **하위 호환 유지 — 기존 사용처는 고치지 않는다.**

1. **`KindIcon` 신규**(components.md 16.12): k8s 종류 23줄 + 판 4줄 매핑을 **이 컴포넌트 한 곳**에 둔다(다른 곳에서 표 복제 금지 — frontend가 이걸 쓴다)
2. lucide 아이콘 8개 등록: `hard-drive`·`network`·`door-open`·`grid-2x2`·`briefcase`·`user-round`·`scroll-text`·`link`. 버전에 없으면 대체안(`user-round`→`user`, `grid-2x2`→`layout-grid`) 사용 후 보고
3. `InlineAlert.closable` 표준화, `Banner`는 `closable ?? dismissible` 병행 수용 + deprecated 표시(**기존 사용처 무수정**)
4. `SceneLegend` 팝오버화(200→280px, `collapsed` 제거) + `Scene3DFrame.legend` 슬롯 제거 → 도구 막대 B 버튼에서 여는 형태
5. `RelationTable`: `count`/`totalCount`/`plateKind`
6. `Popover`에 `align`/`maxHeight`
7. `BlockDetailPanel`의 block에 `custom?`
8. 표식 원 위치 변경(라벨 상자 맨 윗줄 가운데)에 맞춘 `BlockMarkers` 조정이 필요하면 함께

제약: :3000(next dev)·:3001을 건드리지 않고 `next build`·서버 실행 금지. 검증은 lint(`-- src`)·typecheck·vitest.

### 2. 참고한 문서

- `docs/design/snapshot-3d.md` — **4.7.1 신설**(블록 라벨 겹침 B0~B3), **4.8 수정**(표식 줄 = 라벨 상자 맨 윗줄·가운데 정렬), **4.9 신설**(기본 거리 맞춤 · 안전 영역 왼쪽 12px), **4.10 신설**(종류 → 아이콘 표), **6.5 변경**(범례 = 캔버스 밖 Popover 280px), 4.1·4.1.1(판 라벨), 4.2(층 간격 10u), 4.4(Secret 유령 표식에서 `key-round` 제거), 6.2(범례 버튼), 6.4-9(`circle-help` 툴팁), 8.3(판 그룹 행)
- `docs/design/components.md` — 6.1(`Banner` 이름 통일·하위 호환) · 6.2(`InlineAlert` 닫기) · 13절(종류 아이콘 목록) · 16.1(`legend` 슬롯 제거) · 16.5(`SceneLegend` 팝오버) · 16.6(`custom?`) · 16.8(`count`·`totalCount`·`plateKind`) · 16.9(표식 자리 주석) · **16.12 `KindIcon`** · 17.6 · 17.7
- `docs/design/status.md` **11.6**(종류 아이콘: 표식 글리프와 겹치지 않음 / 아이콘은 혼자 서지 않음 / 대체 `box` / `hard-drive` 중복 예외)
- `docs/reports/snapshot-3d/designer.md` 2026-09-20 (3) 전체(특히 3절 (3)·(4)·(6), 8절)
- 내 이전 작업 `docs/reports/snapshot-3d/publisher.md` 세 섹션, 프론트 사용처 `apps/web/src/features/k8s-snapshots/graph/**`

### 3. 작업 내용

**① lucide 아이콘 8개 등록 (`components/ui/icons.tsx`)**

- `hard-drive` · `network` · `door-open` · `grid-2x2` · `briefcase` · `user-round` · `scroll-text` · `link` 을 그대로 등록했다.
- **대체안은 쓰지 않았다.** 설치된 `lucide-react@1.47.0`에 8개 모두 있다(`Grid2x2`·`UserRound` 확인). designer가 준 대체안(`user`·`layout-grid`)은 쓸 일이 없었다 — 4.10 표 그대로다.

**② `KindIcon` 신설 (`components/ui/viz/KindIcon.tsx`) — 매핑의 코드 단일 출처**

- `KIND_ICON`(k8s 종류 **25키** = 4.10의 23줄에서 `Role`/`ClusterRole`·`RoleBinding`/`ClusterRoleBinding`을 키로 펼치고 판의 `Namespace`를 더한 것), `PLATE_ICON`(판 4줄), `FALLBACK_KIND_ICON`(`box`), `CUSTOM_KIND_ICON`(`shapes`).
- 함수 `kindIconName(kind, custom)` / `plateIconName(plate)` 를 함께 뒀다 — **컴포넌트를 쓸 수 없는 자리**(three.js 텍스처, 다른 컴포넌트의 `icon` prop, 테스트)에서도 표를 복제하지 않고 이름만 얻게 하기 위해서다. 매핑을 읽는 곳은 이 파일 하나다.
- 컴포넌트 `KindIcon`은 `plate`가 있으면 판 매핑을, 없으면 `custom` → `kind` 순으로 본다. `size` 12/14(기본)/16, 색은 `currentColor`(부모가 `text.secondary` 또는 `viz.kind.*.onFill`을 준다). **언제나 `aria-hidden`**.
- 표식 아이콘 9종과 겹치지 않는 것을 **테스트로 고정**했다(`status.md` 11.6). 새 종류를 더할 때 이 테스트가 규칙을 지켜 준다.

**③ 쓰는 자리 연결 (4.10 "쓰는 자리와 크기")**

| 자리 | 바뀐 점 |
|---|---|
| `BlockDetailPanel` ① 식별 줄 | `kindIcon`을 주지 않으면 `KindIcon(kind, custom)` 14px. block에 `custom?: boolean` 추가 |
| `RelationTable` 리소스 행 | 같은 규칙으로 14px. 행에 `custom?` 추가 |
| `RelationTable` 판 그룹 행 | `plateKind`(`namespace`/`cluster`/`unparsed`/`ghost`) → `KindIcon plate` 14px. 예전 기본값 `box`는 `plateKind`·`icon`이 **둘 다 없을 때만** 남는다 |
| `SceneLegend` 층 5줄 | 대표 종류 아이콘 12px(`exampleKind`). `VIZ_LAYER`에 `exampleKind`를 더해 기본값이 자동으로 채워진다 |
| `PlateLabel` | 아이콘을 `KindIcon plate`로 바꿨다(표만 옮긴 것, **보이는 모습은 그대로**) |

- `kindIcon`(패널·표)과 `icon`(판 행)은 **직접 고를 때만 쓰는 우선 prop**으로 남겼다. 프론트가 이미 넘기고 있어 지우면 깨진다.
- **`RelationItem`에는 넣지 않았다**(4.10 마지막 줄: 44px 행의 이름 폭 140px을 지킨다).

**④ Secret 유령 표식에서 `key-round` 제거 (`viz.ts`, 4.4 2026-09-20 변경)**

- `blockMarkerItems()`가 `ghost.reason === "secret"`일 때 더하던 `ghostSecret`(`key-round`) 항목을 없앴다. `key-round`가 Secret의 **종류 아이콘**이 되면서 같은 아이콘이 한 블록에 두 번 나오기 때문이다. 사유 문구(`Secret — 이름만, 값 없음`)는 `circle-dashed` 표식의 `text`에 그대로 남는다(툴팁·스크린리더·선택 패널 ③).

**⑤ 범례 = 캔버스 밖 Popover (6.5)**

- `SceneLegend`를 **팝오버 안 내용**으로 다시 썼다: `Card`를 벗기고(배경·그림자·패딩은 `Popover`가 갖는다) `<section aria-label="범례">` + 머리 24px(`범례` + `IconButton x` `닫기`). 폭은 `100%`(팝오버가 280px을 정한다). 접기 버튼(`chevrons-down-up`)은 없앴다.
- `collapsed`/`onCollapsedChange`는 **`@deprecated`로 남기고 무시**한다. 지우면 프론트 `GraphTab.tsx`가 컴파일되지 않아 "기존 사용처 무수정" 지시와 충돌한다. 넘겨도 범례는 접히지 않는다(테스트로 고정).
- `Scene3DFrame.legend`도 같은 방식: prop은 `@deprecated`로 받되 **그리지 않는다**. `overlayBottomLeft` 오버레이와 관련 CSS(+1023px 미디어 규칙)를 지웠다 → **지금 바로 범례가 캔버스를 가리지 않는다**(프론트가 코드를 고치기 전에도 왼쪽 뒤 판이 살아난다).
- `Popover`에 `maxHeight?: number | string`을 더했다(`align`은 이미 있었다). 범례는 `align="end"` + `maxHeight = 캔버스 높이 − 24px`로 연다.

**⑥ `Banner` 닫기 이름 통일 (6.1)**

- `closable` / `onClose` / `closeLabel`(기본 `닫기`)을 표준으로 받고, `dismissible` / `onDismiss`는 `@deprecated` 주석과 함께 **그대로 받는다**(`closable ?? dismissible`, `onClose ?? onDismiss`). 기존 사용처 3곳(`ShellClient`·`RunResultAlert`·`UiPreview`)은 **건드리지 않았다.**
- `InlineAlert`의 `closable`/`onClose`/`closeLabel`은 앞선 (3) 작업에서 이미 만든 것이라 **변경 없음**. 6.2의 나머지 규칙(자리 = `action` 뒤, 닫기를 주면 안 되는 알림 3종)도 그대로 지켜진다.

**⑦ 표식 줄 (4.8)**

- `BlockMarkers variant="overlay"`에 `justify-content: center`를 줬다. 표식 줄이 블록 오버레이 상자의 맨 윗줄에서 **블록 중심에 가로 가운데 정렬**이어야 하기 때문이다(4.8). 상자 위치·줄 쌓기(보조 줄 → 이름 → 표식, 바닥 = 윗면 위 6px)는 좌표 계산이라 **프론트 몫 그대로**다(16.9 "이 컴포넌트는 줄 하나를 그릴 뿐 좌표를 갖지 않는다").

**⑧ 미리보기·테스트**

- `/dev/ui` 미리보기: 도구 막대 B의 `범례` 버튼을 **`Popover`(280px · `align="end"` · `maxHeight={520}`) + `SceneLegend onClose`** 로 바꾸고, `Scene3DFrame`에서 `legend`를 뺐다. 선택 패널 예시의 `kindIcon: "boxes"`도 지워 `KindIcon`이 `kind`만으로 고르는 것을 볼 수 있게 했다.
- 테스트 13개 추가(64 → **77개**): 4.10 표 25줄 전수 대조 · 대체(`box`)·`custom`(`shapes`)·판 4줄 · **표식 아이콘 9종과 글리프 겹침 0** · `aria-hidden` · 새 아이콘 8개 렌더 · 패널/표가 `kind`만으로 고르는지 · `plateKind` 우선순위 · `Banner` 새·옛 이름 · `Popover maxHeight`. 기존 테스트 3개는 바뀐 동작(범례 닫기, Secret 유령 1개, `legend` 미렌더)에 맞춰 고쳤다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/viz/KindIcon.tsx` | **추가** | 종류·판 아이콘 매핑 단일 출처 + `KindIcon`·`kindIconName`·`plateIconName` |
| `apps/web/src/components/ui/icons.tsx` | 수정 | lucide 8개 등록(`hard-drive`·`network`·`door-open`·`grid-2x2`·`briefcase`·`user-round`·`scroll-text`·`link`) |
| `apps/web/src/components/ui/viz/viz.ts` | 수정 | `VizLayerSpec.exampleKind` 추가, Secret 유령의 `key-round` 표식 제거(4.4) |
| `apps/web/src/components/ui/viz/SceneLegend.tsx` | 수정 | 팝오버 내용으로 재작성(`onClose`·`exampleKind`), `collapsed` deprecated·무시 |
| `apps/web/src/components/ui/viz/Scene3DFrame.tsx` | 수정 | `legend` deprecated·미렌더, 왼쪽 아래 오버레이 제거 |
| `apps/web/src/components/ui/viz/RelationTable.tsx` | 수정 | 그룹 행 `plateKind`, 리소스 행 `custom`, 아이콘을 `KindIcon`으로 |
| `apps/web/src/components/ui/viz/BlockDetailPanel.tsx` | 수정 | block `custom?`, 식별 줄 아이콘을 `KindIcon`으로 |
| `apps/web/src/components/ui/viz/PlateLabel.tsx` | 수정 | 판 아이콘을 `KindIcon plate`로(모습 동일), `PlateKind = KindIconPlate` |
| `apps/web/src/components/ui/viz/BlockMarkers.tsx` | 수정 | overlay 주석(4.8 한 덩어리 오버레이) |
| `apps/web/src/components/ui/viz/viz.module.css` | 수정 | 범례 = 팝오버 내용(배경·그림자 제거), 층 줄 아이콘 자리, overlay 표식 줄 가운데 정렬, `overlayBottomLeft` 삭제 |
| `apps/web/src/components/ui/overlay/Popover.tsx` | 수정 | `maxHeight` 추가, `align` 주석 |
| `apps/web/src/components/ui/feedback/Banner.tsx` | 수정 | `Banner`에 `closable`/`onClose`/`closeLabel` + 옛 이름 병행(deprecated) |
| `apps/web/src/components/ui/index.ts` | 수정 | `KindIcon`·`kindIconName`·`plateIconName`·`KIND_ICON`·`PLATE_ICON`·`KindIconPlate` export |
| `apps/web/src/components/ui/__preview__/Snapshot3DPreview.tsx` | 수정 | 범례 팝오버 예시, `legend` 제거, `kindIcon` 예시 제거 |
| `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx` | 수정 | 테스트 13개 추가(64 → 77), 기존 3개 갱신 |

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 이유 |
|---|---|---|
| `legend`·`collapsed`를 **지우지 않고 deprecated + 무시** | ① prop 삭제 ② 그대로 렌더 | ①은 프론트 `GraphTab.tsx`가 즉시 타입 오류가 나 "기존 사용처 무수정"·"typecheck 통과" 두 지시와 동시에 충돌한다. ②는 캔버스를 계속 가려 6.5의 목적이 사라진다. **받되 그리지 않는다**가 둘을 모두 만족한다 — 프론트가 팝오버로 옮기면 prop만 지우면 된다 |
| 매핑 함수(`kindIconName`)를 컴포넌트와 함께 export | `KindIcon` 컴포넌트만 | three.js 재질·다른 컴포넌트의 `icon` prop 자리처럼 **JSX를 넣을 수 없는 곳**이 있다. 함수를 주지 않으면 그쪽에서 표를 다시 만든다(16.12가 막으려는 바로 그 일) |
| `kindIcon`/`icon` prop을 **우선 prop으로 유지** | 제거하고 `KindIcon`만 | 프론트가 이미 넘기고 있다. 남겨 두면 프론트가 한 줄씩 지우며 옮길 수 있고, 특수한 자리(2단계 AWS 등)에 탈출구가 된다 |
| `PlateLabel`의 `namespace`·`ghost`에는 아이콘을 **더하지 않음** | 4.10 판 4줄을 그대로 붙이기 | 4.1·4.1.1의 판 라벨 정의는 `이름 + caption + 알약`뿐이고, P2·P3(84·64px)에서 14px 아이콘은 이름 폭을 12% 넘게 먹는다. `cluster`·`unparsed`는 아이콘이 **문구(`클러스터 범위`·`해석 실패`)와 짝**이라 기존대로 둔다. 표 판 그룹 행은 8.3대로 `folder`/`circle-dashed`를 쓴다 |
| Secret 유령 표식에서 `key-round` **제거** | 유지 | 4.4가 2026-09-20에 바꿨다. 같은 아이콘이 블록 윗면(종류)과 표식(상태) 두 축에 동시에 나오면 11.1의 축 분리가 깨진다 |
| `Banner.closeLabel` 기본을 `닫기`로 | `이 안내 닫기`로 통일 | 기존 `Banner` 동작이 `닫기`였다. 기본값을 바꾸면 아무도 요청하지 않은 접근 이름 변경이 세 화면에 퍼진다 |
| `InlineAlert.closeLabel` 기본은 `이 안내 닫기` **유지** | 6.2 문서대로 `닫기`로 내리기 | 6.2는 기본 `닫기`라고 적었지만 `InlineAlert`는 카드 안에 여러 개가 겹칠 수 있어 더 긴 이름이 구분에 낫다. 이미 쓰이고 있어 바꾸면 조용한 회귀가 된다 → 8절 디자이너 확인 요청 |
| overlay 표식 줄은 **CSS 가운데 정렬만** | 상자 전체(보조 줄·이름·표식)를 컴포넌트로 묶기 | 상자 위치·B0~B3 단계·격자 점유는 카메라 상태에 따라 매번 달라지는 **좌표 계산**이라 프론트 영역이다(16.9 명시). 퍼블리셔가 상자를 가지면 3D 좌표가 컴포넌트로 흘러든다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web -- src` | **통과 (0 problems)** | 인자 없이 돌리면 여전히 `apps/web/.next-build/**` 빌드 산출물에서 대량 경고가 나온다(PM이 만든 잔재, 프론트가 정리 중). `src` 기준으로만 확인했다 |
| `npx tsc --noEmit`(= typecheck) | **통과** | 프론트가 아직 `legend`·`collapsed`를 넘기고 있어도 통과 = 하위 호환 확인 |
| `npx vitest run` | **통과 20 파일 / 394 테스트** | snapshot-3d 77개(이번 +13). 기존 381개 그대로 통과 |
| `next build` · 개발 서버 실행 | **하지 않음** | 지시대로(:3000·:3001 유지) |
| 브라우저 육안 확인 | **하지 않음** | 서버 금지. 이미 떠 있는 dev 서버의 `http://localhost:3000/dev/ui` 에서 범례 팝오버·종류 아이콘을 바로 볼 수 있게 미리보기를 갱신했다 |
| 라이트·다크 대비 실측 | **하지 않음** | 이번 변경에 새 색이 없다(아이콘은 `currentColor`) |
| 360px~1440px 실제 렌더 | **하지 않음** | 범례가 오버레이에서 팝오버로 빠져 좁은 화면 위험은 오히려 줄었다(`Popover`가 `min(280px, 100vw − 16px)`로 막는다) |

### 7. 남은 이슈·한계

1. **`legend`·`collapsed`는 "받지만 그리지 않는" 과도기 상태**다. 프론트가 팝오버로 옮긴 뒤 PM이 별도 작업으로 두 prop을 지워야 한다(`Banner.dismissible`과 같은 처지 — designer 보고 7절 5번).
2. **프론트 `GraphTab.tsx`는 지금 상태에서 범례가 보이지 않는다.** 도구 막대 B의 `범례` 버튼이 `legendCollapsed` 상태만 토글하고 있어 아무 일도 일어나지 않는다. 9절 시그니처대로 `Popover`로 바꿔야 한다(그 전까지는 정보 줄 `circle-help` 툴팁 둘째 줄이 "블록 색은 층" 문장을 맡는다 — 6.4-9).
3. **블록 오버레이 상자(보조 줄/이름/표식 한 덩어리)와 B0~B3 사다리는 만들지 않았다.** 4.7.1은 카메라 상태에 따라 250ms마다 다시 계산하는 규칙이라 프론트 영역이다. 퍼블리셔가 준 것은 표식 줄 자체(가운데 정렬·최대 3 + `+N`)뿐이다.
4. `KIND_ICON`은 **25키**다. 4.10 표의 "23줄"은 `Role`·`ClusterRole`처럼 한 줄에 두 종류를 적은 것을 세지 않은 수이고, `Namespace`는 표 그룹 행에서 `kind`로 들어올 수 있어 종류 쪽에도 뒀다(같은 아이콘 `folder`).
5. `PersistentVolume`·`PersistentVolumeClaim`이 같은 `hard-drive`를 쓰는 것은 **의도**다(11.6의 유일한 예외). 위치·이름으로 갈린다.
6. `InlineAlert`의 `role`은 기존대로 `live`일 때만 `status`다. 6.2에는 "`tone === crit`이면 `role="alert"`, 아니면 `role="status"`(기존 그대로)"라고 적혀 있는데 **구현은 그렇지 않았다**. 모든 알림이 `status`가 되면 화면에 뜨는 것마다 낭독돼 소음이 되므로 이번에도 바꾸지 않았다 → 8절.

### 8. 다른 담당 요청

**프론트 요청** (모두 9절에 시그니처를 적었다)

1. **범례를 팝오버로 옮겨 주세요.** `Scene3DFrame`에 `legend`를 넘기지 말고, 도구 막대 B의 `범례` 버튼을 `Popover`(`width={280}` · `align="end"` · `maxHeight={캔버스 높이 − 24}`)의 `trigger`로 감싸 `<SceneLegend onClose={…} />`를 넣으세요. 지금은 `legend`를 넘겨도 **그려지지 않습니다**(캔버스는 이미 안 가립니다). 저장 키는 `sentinel.snapshots.k8s.legendSeen`(열어 본 적 있는지)이고 **옛 키 `…legend`는 읽지 마세요**. `SceneLegend`의 `collapsed`/`onCollapsedChange`도 함께 지우면 됩니다(지금은 무시됩니다).
2. **종류 아이콘은 `KindIcon`에 `kind`·`custom`만 넘기세요.** 표를 `graph/*`에 복제하지 마세요. 블록 윗면(three.js)처럼 JSX를 쓸 수 없는 자리는 `kindIconName(kind, custom)`으로 **아이콘 이름만** 받아 쓰세요. 표·패널은 `kindIcon`을 넘기지 않으면 자동으로 고릅니다(넘기던 값은 지워도 됩니다).
3. **관계 표 판 그룹 행에 `plateKind`를 넣어 주세요**(`namespace`/`cluster`/`unparsed`/`ghost`). 지금 넘기는 `icon`이 있으면 그것이 이깁니다 — `icon`을 지우고 `plateKind`로 바꾸면 8.3의 `folder`/`globe`/`file-warning`/`circle-dashed`가 됩니다.
4. `Banner`를 새로 쓸 때는 `closable`/`onClose`를 쓰세요. 기존 `dismissible`/`onDismiss` 사용처는 **그대로 둬도 됩니다**(deprecated일 뿐 동작 동일).
5. Secret 유령 블록의 표식이 **2개 → 1개**(`circle-dashed`만)가 됐습니다(4.4). `key-round`는 이제 Secret의 종류 아이콘입니다. 표식 수를 세는 곳이 있으면 확인해 주세요.
6. (영역 밖) `apps/web/eslint.config.mjs` 무시 목록에 **`.next-build/`** 를 넣거나 폴더를 지워 주세요. 지난 보고의 요청이 아직 남아 있습니다.

**디자이너 요청**

1. `components.md` 6.2의 `InlineAlert.closeLabel` **기본값**을 확인해 주세요. 문서는 `닫기`인데 구현은 `이 안내 닫기`입니다(한 카드 안에 알림이 여러 개일 때 구분을 위해 2026-09-20 (3)에서 그렇게 정했습니다). `Banner`는 문서대로 `닫기`입니다.
2. `components.md` 6.2의 "`role`은 기존 그대로(`crit`이면 `alert`, 아니면 `status`)"는 **현재 구현과 다릅니다**. 구현은 `live`를 준 알림만 `role="status"`이고 나머지는 role이 없습니다(과한 낭독 방지). 문서를 구현에 맞추거나, 바꿔야 한다면 소음 검토가 필요합니다.
3. `snapshot-3d.md` 4.1의 판 라벨 정의에 **판 아이콘을 넣을지** 한 줄 적어 주세요. 4.10은 `folder`를 "판·표 그룹 행·`PlateLabel`"에서 쓴다고 했지만 4.1·4.1.1의 라벨 구성에는 아이콘 자리가 없습니다. 지금은 `cluster`·`unparsed`만 아이콘을 두고 `namespace`·`ghost`는 이름만 둡니다(P2·P3 이름 폭 보호).
4. `KindIcon`의 종류 표에 `Namespace`(`folder`)를 함께 뒀습니다. 4.10 표에서는 (판) 구역에만 있어 "종류로 올 수 있나"가 모호했습니다.

**백엔드 요청**: 없습니다(이번 반영에 계약 변경 없음. `blocks[].kind`·`blocks[].custom`·`plates[].kind`면 충분합니다).

### 9. 다음 담당이 알아야 할 점 (새·바뀐 prop 시그니처)

```ts
// components/ui/viz/KindIcon.tsx  (신규 — 매핑 단일 출처)
type KindIconPlate = "namespace" | "cluster" | "unparsed" | "ghost";
KindIcon: {
  kind?: string | null;        // blocks[].kind 원문. 모르는 값·null 이면 box
  custom?: boolean;            // true 면 kind 와 무관하게 shapes
  plate?: KindIconPlate;       // 주면 kind 보다 먼저 본다
  size?: 12 | 14 | 16;         // 기본 14 (윗면·묶음 16 / 패널·표 14 / 범례 12)
  className?: string;          // 색은 currentColor
}
kindIconName(kind?, custom?): IconName;    // JSX 를 쓸 수 없는 자리(three.js 등)용
plateIconName(plate): IconName;
KIND_ICON / PLATE_ICON / FALLBACK_KIND_ICON("box") / CUSTOM_KIND_ICON("shapes")

// components/ui/viz/SceneLegend.tsx  (팝오버 내용)
SceneLegend: {
  layers?: { layer; label; example; exampleKind? }[];   // exampleKind → 층 줄 아이콘 12px
  markers?; ghostText?;
  onClose?: () => void;                                  // 머리 오른쪽 x
  collapsed?; onCollapsedChange?;                        // @deprecated — 받기만 하고 무시한다
}
// 쓰는 법:
// <Popover label="범례" width={280} align="end" maxHeight={캔버스높이 - 24}
//          trigger={(p) => <Button {...p} variant="ghost" size="sm" icon="layers">범례</Button>}>
//   <SceneLegend onClose={…} />
// </Popover>

// components/ui/viz/Scene3DFrame.tsx
legend?: ReactNode;   // @deprecated — 캔버스에 그리지 않는다. 오버레이는 infoBar·cameraControls 둘뿐

// components/ui/overlay/Popover.tsx
align?: "start" | "center" | "end";     // 기존
maxHeight?: number | string;            // 신규. 넘치면 패널 안에서 스크롤

// components/ui/feedback/Banner.tsx — Banner
closable?: boolean; onClose?: () => void; closeLabel?: string;   // 표준(기본 "닫기")
dismissible?: boolean; onDismiss?: () => void;                   // @deprecated, 계속 동작
// 읽는 규칙: closable ?? dismissible / onClose ?? onDismiss (둘 다 있어야 버튼을 그린다)

// components/ui/viz/RelationTable.tsx
RelationGroupRow: { …, count?, totalCount?, plateKind?: KindIconPlate, icon? /* icon 이 우선 */ }
RelationResourceRow: { …, kind, custom?, kindIcon? /* kindIcon 이 우선 */ }

// components/ui/viz/BlockDetailPanel.tsx
BlockDetailBlock: { …, kind, custom?, kindIcon? /* kindIcon 이 우선 */ }
```

- **표는 한 곳에만 있다.** 새 종류가 생기면 `snapshot-3d.md` 4.10에 줄을 먼저 넣고 `KindIcon.tsx`에 더한다. 표식 아이콘 9종과 겹치는 글리프는 테스트가 막는다.
- **블록 면 색은 여전히 층**이고 상태가 아니다. 종류는 **아이콘으로만** 갈린다(색 17개를 만들지 않는다).
- 표식 줄(`BlockMarkers variant="overlay"`)은 **가운데 정렬된 줄 하나**다. 상자 위치·B0~B3·격자 점유는 프론트가 계산한다(4.7.1).

### 10. 후속 1건 · 유령 판 라벨 아이콘 (같은 날, designer 확인 결과 반영)

- **요청(PM)**: `PlateLabel`의 `kind="ghost"`에 `circle-dashed` 12px 아이콘 추가(density 무관, 항상 표시). 근거 `snapshot-3d.md` 4.1(2026-09-20 (4) 갱신분 「판 라벨 이름 앞 아이콘」 표)·`components.md` 16.11.
- **한 일**
  - `PlateLabel`의 `KIND_TEXT`를 `{ label?, icon?: 12 | 14, iconTone?, note? }`로 바꿔 `ghost: { icon: 12, iconTone: "tertiary", note: "스냅샷에 없음" }`을 넣었다. P2·P3에서 caption `스냅샷에 없음`이 사라져도 **아이콘은 남는다**(4.1 마지막 줄).
  - 같은 표에 적힌 **해석 실패 아이콘 색 `status.warn.fg`**도 함께 맞췄다(`iconTone: "warn"`). 클러스터 범위는 이름과 같은 색 그대로.
  - **보통 네임스페이스는 아이콘 없음**이 4.1에서 확정돼 앞 섹션의 구현(8절 디자이너 요청 3번으로 확인 요청했던 것)이 그대로 맞았다. 바꾼 것 없음.
  - 아이콘은 여전히 `KindIcon plate`로만 고른다(매핑 단일 출처 유지).
- **변경 파일**: `apps/web/src/components/ui/viz/PlateLabel.tsx`(수정) · `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx`(테스트 3개 추가, 77 → **80개**)
- **테스트**: 유령 판이 density 0~3 **모두**에서 `circle-dashed` 12px을 보이는지 / 보통 네임스페이스 라벨에 `svg`가 하나도 없는지 / 클러스터·해석 실패가 14px인지.
- **검증**: `npm run lint --prefix apps/web -- src` 0 problems · `tsc --noEmit` 통과 · `vitest run` **20 파일 / 397 테스트 통과**. `next build`·서버 실행 없음(:3000·:3001 그대로).
  - 첫 전체 실행에서 `src/features/aws-snapshots/pages.test.tsx`의 `편집 → 저장 … 커밋 금지 상태로 저장` 1건이 실패했다가 **같은 코드로 재실행 시 통과**했다(단독 실행도 19/19 통과). 내 변경과 무관한 비동기 확인 창 타이밍으로 보인다 — 프론트/PM이 알고 있어야 할 **간헐 실패**라 적어 둔다.
- **주의**: 작업 중 `npx prettier --write`를 한 번 돌렸는데 저장소에 prettier 설정이 없어 기본 printWidth 80으로 파일이 재정렬됐다. 주변 코드(약 120칸)와 어긋나므로 **원래 폭으로 되돌려 저장**했다. 이 저장소에서는 prettier를 쓰지 말 것(lint만으로 충분하다).

### 11. 후속 2건 · 정보 줄 동작 칩 · 9.4 알림 `live` (같은 날, designer 수용분)

- **요청(PM)**: ① `SceneInfoItem`에 `onClick`·`actionLabel` 추가(`href`와 **배타**) ② 9.4 데이터 오류 알림(`Scene3DFrame` 안)에 `live` 고정. 근거 `snapshot-3d.md` 6.4·9.4, `components.md` 16.1·16.4. frontend 대기 중.
- **한 일**
  - **`SceneInfoBar`**: `SceneInfoItem`에 `onClick?: () => void`·`actionLabel?: string` 추가. 칩 하나를 그리는 `InfoChip`를 두고 **`onClick` → `<button>` / `href` → `<a>` / 둘 다 없으면 글자 칩**으로 나눴다. 모양은 `Chip` neutral sm 클래스를 그대로 써서 세 형태가 같아 보인다(`.infoChipButton`은 버튼 기본 스타일만 지우고 focus 링을 준다).
  - **배타 처리**: `href`와 `onClick`이 함께 오면 **`href`를 무시**하고 개발 모드에서 `console.warn`(운영 빌드는 조용). 타입으로 막지 않은 이유는 5절 표에 적었다.
  - **접근 이름**: `actionLabel`이 있으면 `"<text> — <actionLabel>"`을 `aria-label`로 준다(`일부가 화면 밖 — 전체가 보이게 축소`). 버튼·링크 **둘 다** 적용한다(6.4 마지막 줄).
  - **`Scene3DFrame` `live` 고정**: `chunkFailed`·`contextLost`의 `InlineAlert`와, 장면을 유지한 채 얹는 `error` 알림에 `live`를 **컴포넌트가 켠다**(프론트가 줄 수 없는 자리, 16.1). `unsupported`(9.3)는 **켜지 않는다** — 탭을 여는 순간부터 있는 사실이라 진입 시 낭독이 겹친다.
  - 기존 호출은 그대로다(`onClick`·`actionLabel`을 주지 않으면 예전 DOM·모습 그대로).
- **변경 파일**: `apps/web/src/components/ui/viz/SceneInfoBar.tsx`(수정) · `apps/web/src/components/ui/viz/Scene3DFrame.tsx`(수정) · `apps/web/src/components/ui/viz/viz.module.css`(`.infoChipButton` 추가) · `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx`(테스트 5개 추가, 80 → **85개**)
- **테스트**: 세 형태(button/link/글자) 렌더·클릭 / `actionLabel` 접근 이름(버튼·링크) / `href`+`onClick` 배타 + 경고 / 9.4 세 알림이 `role="status"` / 9.3은 `role="status"` 아님.
- **검증**: `eslint src/components` **0 problems** · `components/ui` 타입 오류 **0** · `vitest run` **20 파일 / 402 테스트 통과**. `next build`·서버 실행 없음(:3000·:3001 그대로).
  - 다만 `npm run lint -- src`·`tsc --noEmit`을 **저장소 전체**로 돌리면 프론트가 지금 고치는 중인 `src/features/k8s-snapshots/graph/scene/**`에서 오류가 난다: `SceneCanvas.tsx`가 `GraphScene`에 없는 `zoom`·`setViewpoint`를 부른다(TS2339 5건), `engine.ts`의 `VIEWPOINTS` 미사용 경고 1건. **내 변경과 무관**하고(내 작업 직전 전체 typecheck는 통과했고 이 파일들은 그 뒤에 생겼다) 내 영역 파일에는 오류가 없다 → 프론트가 마무리하면 사라진다.
- **아직 안 한 것(같은 6.4에 함께 들어온 변경)**: **정보 줄 줄바꿈 금지(한 줄 20px 고정) + 480px 초과 시 뒤에서부터 `+N` 합침**. 이번 요청 2건에 들어 있지 않아 손대지 않았다. 지금 `.infoBar`는 여전히 `flex-wrap: wrap`이다. 합침은 **칩 폭 측정**이 필요해(ResizeObserver) 컴포넌트가 상태를 갖게 되므로, 할지 말지와 방식(퍼블리셔가 측정 / 프론트가 미리 합쳐서 넘김)을 PM이 정해 주면 반영하겠다.

### 12. 후속 3건째 · 정보 줄 한 줄 고정 (PM 결정: 합침은 frontend)

- **요청(PM)**: `.infoBar`를 `nowrap` + 높이 20px 고정, 넘치면 마지막 칩이 말줄임. `+N` 합침 판단은 frontend(컴포넌트에 ResizeObserver 상태를 넣지 않는다). frontend가 합쳐 넘길 수 있는지 지금 시그니처로 확인.
- **한 일**: `.infoBar` `flex-wrap: wrap` → **`nowrap`**, `height: var(--size-badge-sm)`(20px). 마지막 칩에만 `.infoChipShrink`(`flex-shrink: 1`, 최소 폭 40px)를 붙여 **줄어드는 것이 하나뿐**이게 했다(앞 칩은 우선순위 1·2라 폭을 지킨다). 안내 아이콘(`.infoHint`)은 `flex-shrink: 0`. 컴포넌트는 여전히 props만으로 동작한다(측정·상태 없음).
- **시그니처 변경 없음**: `+N` 칩은 `{ id: "more", text: "+2", tooltip: <전체 목록>, actionLabel: "숨은 정보 보기", onClick? }`로 **지금 그대로** 표현된다(툴팁 `ReactNode`라 목록도 들어간다). 테스트로 고정했다. 다만 6.4가 말하는 **`Popover`에 담는 형태**는 `SceneInfoItem`에 내용 슬롯이 없어 불가능하다 → 툴팁으로 충분한지 designer 확인(아래).
- **변경 파일**: `apps/web/src/components/ui/viz/viz.module.css`·`SceneInfoBar.tsx`(수정) · `__tests__/snapshot-3d.test.tsx`(테스트 2개 추가, 85 → **87개**)
- **검증**: `eslint src/components` 0 problems · `components/ui` 타입 오류 0 · `vitest run` **20 파일 / 404 테스트 통과**. `next build`·서버 실행 없음. (`src` 전체 lint·typecheck는 프론트가 편집 중인 `graph/scene/**` 때문에 여전히 실패 — 11절과 같은 건이다.)
- **designer 요청**: 6.4의 "`+N` Chip 하나(아이콘 없음, **툴팁·Popover**에 전부)"에서 **Popover 쪽은 만들지 않았다.** 정보 줄 칩은 `text`·`tooltip`만 받는 데이터 항목이라 임의 내용을 넣을 슬롯이 없다(슬롯을 열면 정보 줄이 무엇이든 담는 자리가 된다). 툴팁 한 줄(`일부가 화면 밖 · 라벨 3개 숨김`)로 충분한지, 아니면 Popover가 꼭 필요한지 정해 주면 그때 슬롯을 만들겠다.

### 13. 후속 4건째 · 도구 막대 결과 수를 같은 줄로 (frontend 요청)

- **요청**: `SceneToolbar`의 `countText`가 아랫줄로 내려가 도구 막대 A가 65 → 85px이 되고 캔버스 높이를 16~20px 먹는다(frontend 실측). 같은 줄에 붙이되 좁은 폭에서는 말줄임(지우지 말 것).
- **한 일**: `.toolbarMain`에 `flex: 1 1 auto`(+ 기존 `min-width: 0`)를 줘 남은 폭을 차지하게 했다 → `countText`·`trailing`이 같은 줄에 남는다. `.toolbarCount`는 `flex: 0 1 auto` + `min-width: 64px` + `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap`으로, 좁아지면 **줄어들며 말줄임하되 사라지지 않는다**(개수는 "3D와 표가 같은 값"이라는 약속을 보여 주는 정보다). 도구 막대 안쪽 항목의 줄바꿈(12절 반응형)은 그대로다. **CSS만 바꿨고 prop·DOM 구조는 그대로**라 기존 사용처 무수정.
- **변경 파일**: `apps/web/src/components/ui/viz/viz.module.css`(수정) · `__tests__/snapshot-3d.test.tsx`(테스트 1개 추가, 87 → **88개** — 본문·개수·trailing이 같은 부모(한 줄)에 있고 개수 문구가 지워지지 않는지 고정)
- **검증**: `eslint src/components` 0 problems · `components/ui` 타입 오류 0 · `vitest run` **20 파일 / 405 테스트 통과**. `next build`·서버 실행 없음(:3000·:3001 그대로).

### 14. 후속 5건째 · 정보 줄 칩이 **전부** 잘리던 문제 (PM 실화면 확인)

- **증상**: 1440px·캔버스 766px에서 칩 3~4개인데 `블록 27 · 관계 …`, `차이 3건 · 12:23 계…`, `라벨 20개 숨…`처럼 **모든 칩이 말줄임**. 12절의 "마지막 칩만" 규칙과 달랐다.
- **원인 2가지가 겹쳤다**
  1. **툴팁이 붙은 칩은 `Chip` 이 `Tooltip` 래퍼(`.chipTipAnchor`)로 감싼다.** 그래서 flex 항목은 래퍼이고, 내가 막아 둔 `.chip { flex-shrink: 0 }`·`.infoChipShrink` 는 **래퍼 안쪽**에 있었다. 래퍼는 기본값 `flex-shrink: 1` → 모든 툴팁 칩이 줄어들었고, 안의 `.chipText` 가 말줄임됐다.
  2. `.infoBar { max-width: min(480px, 100%) }` 의 **`100%`가 문제**였다. 부모가 `position: absolute` 오버레이(`.overlayTopLeft`)라 shrink-to-fit이고, 그 폭이 "줄어들 수 있는 내용의 최소 폭"으로 잡혀 480px보다 훨씬 좁은 값이 됐다 → 줄바꿈을 막아 둔 상태에서 전부 압축.
- **고친 방법**: `.infoBar` 를 `width: max-content` + `max-width: 480px`(퍼센트 제거)로 바꾸고, **`.infoBar > *` 에 `flex-shrink: 0`** 을 줘 래퍼든 칩이든 직계 자식은 줄어들지 않게 했다. 줄어들 수 있는 것은 마지막 칩뿐이고 래퍼까지 잡도록 `.infoBar > .infoChipShrink, .infoBar > :has(> .infoChipShrink)` 두 선택자를 함께 썼다. **칩이 자리에 들어가면 전문 그대로**, 480px을 넘으면 마지막 칩만 말줄임, 그래도 모자라면 **컴포넌트는 억지로 줄이지 않고** 프론트의 `+N` 합침에 맡긴다(6.4).
- **변경 파일**: `apps/web/src/components/ui/viz/viz.module.css`(수정) · `__tests__/snapshot-3d.test.tsx`(테스트 3개 추가, 88 → **91개**). jsdom은 CSS를 계산하지 않으므로 ① CSS 원문에 `.infoBar > * { flex-shrink: 0 }`·`max-width: 480px`·`:has(> .infoChipShrink)` 가 있는지 ② 칩 4개에서 `infoChipShrink` 가 **마지막 하나에만** 붙고 앞 칩 문구가 그대로인지를 고정했다.
- **검증**: `eslint src/components` 0 problems · `components/ui` 타입 오류 0 · `vitest run` **20 파일 / 408 테스트 통과**. `next build`·서버 실행 없음(:3000·:3001 그대로).
- **프론트 참고**: `:has()`를 쓴다(이 파일의 판 행 배경과 같은 방식). 지원하지 않는 아주 오래된 브라우저에서는 마지막 **툴팁 칩**이 말줄임되지 않고 그대로 넘칠 뿐, 잘못 잘리지는 않는다.

## 2026-09-20 (5) · 블록 모양 분화 (`ShapeSwatch` 신설 · `kindShape()` 단일 출처 · 범례 「모양 = 종류」)

### 1. 요청 내용

PM이 넘긴 publisher 요청 5건 (designer 2026-09-20 (8)):

1. **`ShapeSwatch` 신설**(`components.md` 16.13): 실루엣 9종 SVG(`stack`·`cylinder`·`panel`·`roof`·`chamfer`·`gate`·`diamond`·`box`·`tile`), `size` 14/16, `tone` neutral/layer. 기본 시점 윤곽 + 윗면 경계선 1개.
2. **`kindShape()`를 `KindIcon`과 같은 파일에서 export** — 프론트가 three.js 지오메트리를 고를 때 import 한다(매핑 단일 출처). 배정은 4.11.2 표 그대로.
3. `SceneLegend`에 **「모양 = 종류」 절**(층 5줄 바로 아래, 2열 × 5줄, 항목 폭 124px, 9항목 문구 고정) + 맨 아래 문장 교체.
4. `SceneToolbar` 종류 필터 옵션의 층 색 사각 10px → `ShapeSwatch` 14px `tone="layer"`.
5. 선택 패널·`RelationItem`·관계 표의 층 색 사각은 **그대로 둘 것**.

제약: 프론트가 **동시에** 3D 지오메트리를 구현하므로 `kindShape()`를 먼저 내보내고 시그니처를 정확히 보고할 것. `:3000`(next dev)·`:3001` 건드리지 말 것, `next build`·prettier·서버 실행 금지.

### 2. 참고한 문서

- `docs/design/snapshot-3d.md` — **4.11 전체**(4.11.0 지켜야 할 것 · **4.11.1 모양 9종 치수표** · **4.11.2 종류 배정·환산표** · 4.11.3 밝기 · 4.11.4 상태별 · 4.11.5 성능 · 4.11.6 불변 점검 · **4.11.7 영향 없는 자리**) · 4.3 · 4.4 · 4.10 · **6.1** · **6.5** · 12
- `docs/design/components.md` — **16.13 `ShapeSwatch`(신설)** · 16.12 `KindIcon` + `kindShape()` · 16.5 `SceneLegend` · 16.2 `SceneToolbar` · 4.5 `Select`/`MultiSelect`
- `docs/design/status.md` — **11.1**(세 축: 층 색 / **모양** / 표식. "모양도 상태를 뜻하지 않는다") · 11.2
- `docs/reports/snapshot-3d/designer.md` **2026-09-20 (8)** — 봉투 고정의 근거, 퍼블리셔 요청 3건, 중립 견본을 쓰는 이유

### 3. 작업 내용

**① `kindShape()` — 매핑 단일 출처 (요청 2, 가장 먼저 끝냈다)**

`viz/KindIcon.tsx` 아래쪽에 종류 → 모양 표를 **아이콘 표와 같은 파일**로 넣었다(`VizShape` 타입 · `KIND_SHAPE` 표 11줄 · `FALLBACK_KIND_SHAPE` · `AUX_KIND_SHAPE` · `kindShape()`). 판단 순서는 **① 곁 층 → ② custom → ③ 종류 표 → ④ 기본형**이다. 곁을 먼저 보는 이유: 곁 타일은 종류·`custom` 과 무관하게 타일이어야 한다(4.11.2 마지막 두 줄).

**② `ShapeSwatch` (요청 1)**

`viz/ShapeSwatch.tsx` 신설. 하드코딩한 path 문자열을 붙여 넣는 대신 **4.11.1 치수표를 그대로 코드에 적고 모듈이 읽힐 때 한 번 투영**한다(값이 아니라 치수가 원본으로 남아 나중에 4.11.1이 바뀌면 숫자 한 개만 고친다).

- **투영**: 기본 시점(방위 −35°·고도 30°) 정사영. 1u 당 화면 성분 `x (+0.82, −0.29)` · `z (+0.57, +0.41)` · `y (0, −0.87)`(4.0 투영 상수). 이 배치라야 **왼쪽 옆면이 −x, 오른쪽 옆면이 +z**로 장면과 같은 면이 보인다(4.11.3 밝기 표와 같은 방위).
- **배율 2.6 · 원점 (8, 11.39)**: 4u 봉투(가로 5.56u · 세로 5.41u)가 viewBox 16 안에 **사방 ~0.8 여백**을 남기고 들어간다. 여백은 1px 윤곽(비축소 stroke)이 잘리지 않을 만큼 필요하다. 테스트로 모든 좌표가 0.6~15.4 안에 있는지 고정했다.
- **실루엣 = 볼록 껍질**: 모양 9종은 모두 **볼록 조각**으로 이루어져 있어, 꼭짓점을 투영한 뒤 단조 사슬(monotone chain)로 껍질을 구하면 그것이 그대로 그 시점의 윤곽이다. 모양마다 "어느 모서리가 실루엣인지"를 손으로 적을 필요가 없어졌다(오타·시점 불일치가 생길 자리를 없앴다).
- **겹 상자·아치 문은 조각 여러 개**: `stack` = 아래 단 + 위 단, `gate` = 다리 3 + 보. **뒤 → 앞 순서로 칠하고 면이 불투명**이라 뒤 조각의 가려진 선이 앞 조각의 면에 덮인다(은선 제거를 따로 하지 않는다).
- **윗면 경계선 1개**: 윗면 꼭짓점의 **아래쪽 사슬**(= 윗면이 옆면과 만나는 선)만 열린 path로 그린다. 윗면 자체는 **칠만** 하고 선을 긋지 않아 윤곽선이 두 번 그려지지 않는다(윤곽 `border.strong` 위에 경계선 `border.default`가 덧칠되는 것을 피했다). `roof`만 윗면이 면이 아니라 **용마루**라 선을 직접 준다.
- **색**: `.shapeSwatch`에 `--shape-fill`·`--shape-edge`·`--shape-top` 세 CSS 변수를 두고 `data-layer`로 층 색을 갈아 끼운다. 기본(중립) = `bg.canvas` + `border.strong` + `border.default`, `tone="layer"` = `viz.kind.<layer>.fill` + `edge`. **토큰 변수만 쓴다.**
- 밝기 3단은 쓰지 않는다(14~16px에서 뭉갠다). `aria-hidden="true"` + `focusable="false"` 고정 — 옆에 종류 문구가 글자로 있다.
- **곁 타일만 2/3 축소**: 실제 치수 6 × 3 × 0.75u는 4u 봉투보다 넓어 같은 배율로 그리면 견본 폭을 넘는다. **비율을 유지한 채 2/3로 줄여**(4 × 2 × 0.5) 다른 8종과 같은 폭 예산 안에 넣었다. 납작함이 이 모양의 전부라 읽기에는 영향이 없다.

**③ 범례 「모양 = 종류」 절 (요청 3)**

`SceneLegend`에 `shapes` prop + `DEFAULT_LEGEND_SHAPES`(9항목 **고정 순서·고정 문구**, 6.5 표 그대로) + `SHAPE_SECTION_TITLE`을 더했다. 기존 `<ul>` 한 덩이를 **층 5줄 / 모양 절 / (유령 + 관계 2줄)** 셋으로 갈라 모양 절이 **층 5줄 바로 아래**(색 → 모양 순서)에 오게 했다.

- 배치: `grid-template-columns: repeat(2, minmax(0, 1fr))`, 열 간격 8px · 줄 간 6px → 팝오버 내부 폭 256px에서 **항목 폭 124px · 9항목 5줄**. 고정 px 대신 `1fr`이라 폭이 줄어드는 화면에서도 **가로 스크롤이 생기지 않고** 문구가 말줄임된다(12절).
- 제목은 `micro` + `caption-strong` weight(= 11/14 captionStrong)로 토큰만 조합했고, `<p id>` + `<ul aria-labelledby>`로 묶었다. **`<h3>`를 쓰지 않았다** — 범례는 팝오버 안이라 문서의 heading 층위를 알 수 없다(잘못된 단계의 heading은 스크린리더 목차를 망친다).
- `shapes={[]}`를 주면 절 전체를 그리지 않는다(2단계 AWS 구성도에서 모양 어휘가 달라질 때를 위한 문).
- 맨 아래 문장: `LEGEND_NOTES[0]`을 **`블록 색은 층, 모양은 종류를 뜻합니다. 상태가 아닙니다.`**로 교체. 이 상수는 정보 줄 도움말도 함께 쓰는 자리라 한 곳만 고치면 된다.

**④ 종류 필터 옵션의 모양 견본 (요청 4)**

`MultiSelect` 옵션(`SelectOption`)에 **`adornment?: ReactNode`**를 더했다(라벨 앞, 기존 `icon` 자리를 대신한다). 종류 필터는 `apps/web/src/features/...`(프론트 영역)에서 조립되므로 **퍼블리셔는 자리를 열고 예시를 고정**했다: `SceneToolbar`의 문서 주석에 그대로 쓸 수 있는 호출 예시를 적고, `/dev/ui` 미리보기에 종류 필터를 층 색 견본 14px과 함께 넣고, 테스트로 옵션 한 줄의 DOM(견본 `data-shape`·`data-layer`·`aria-hidden` + 종류 이름·개수 글자)을 고정했다. **GraphTab 배선은 frontend 요청으로 남긴다**(8절).

**⑤ 그대로 둔 것 (요청 5)**

`BlockDetailPanel` ① 식별 줄 · `RelationItem` · `RelationTable` 리소스·그룹 행의 `LayerSwatch`는 **한 줄도 고치지 않았다**(4.11.7). 모양 견본을 쓰는 자리는 범례와 종류 필터 둘뿐이다.

**⑥ 미리보기·테스트**

`/dev/ui`의 3D 구성도 절에 **모양 9종 갤러리**(중립 16px + 층 색 14px + `모양 id · 종류 문구`)와 **종류 필터 12종**을 넣었다. 갤러리는 "같은 층 안에서 갈리는가"(특히 `stack` ↔ `chamfer`)를 눈으로 확인하는 자리다.

작업 중 실루엣이 실제로 맞는지 보려고 **임시 테스트로 9종을 ASCII로 래스터라이즈해 확인**하고(겹 상자의 턱, 원통의 둥근 윤곽, 지붕의 뾰족함, 아치 문의 구멍, 다이아몬드의 좁은 밑면, 타일의 납작함), 확인 뒤 임시 파일은 지웠다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/viz/ShapeSwatch.tsx` | **추가** | 모양 견본 9종 SVG. 4.11.1 치수 → 기본 시점 투영 → 볼록 껍질 실루엣 + 윗면 경계선. `SHAPE_PATH`도 내보낸다(테스트·회귀 확인용) |
| `apps/web/src/components/ui/viz/KindIcon.tsx` | 수정 | **`VizShape` · `KIND_SHAPE` · `kindShape()` · `FALLBACK_KIND_SHAPE` · `AUX_KIND_SHAPE` 추가**(아이콘 표와 같은 파일) |
| `apps/web/src/components/ui/viz/SceneLegend.tsx` | 수정 | `shapes` prop · `DEFAULT_LEGEND_SHAPES`(9항목) · `SHAPE_SECTION_TITLE` · 「모양 = 종류」 절(층 5줄 바로 아래) |
| `apps/web/src/components/ui/viz/viz.ts` | 수정 | `LEGEND_NOTES[0]` 문구 교체(모양 포함) |
| `apps/web/src/components/ui/viz/viz.module.css` | 수정 | `.shapeSwatch`(층별 색 변수 5벌) · `.shapeBody` · `.shapeTopFace` · `.shapeTopLine` · `.legendShapes` · `.legendShapeTitle` · `.legendShapeGrid`(2열) · `.legendShapeItem(Text)` |
| `apps/web/src/components/ui/controls/Select.tsx` | 수정 | `SelectOption.adornment?: ReactNode`(MultiSelect 목록 전용, `icon` 자리를 대신한다) |
| `apps/web/src/components/ui/viz/SceneToolbar.tsx` | 수정 | 주석만 — 종류 필터 옵션에 `ShapeSwatch` 14px `tone="layer"`를 쓰는 법(호출 예시) |
| `apps/web/src/components/ui/index.ts` | 수정 | `ShapeSwatch`·`SHAPE_PATH`·`kindShape`·`KIND_SHAPE`·`VizShape`·`DEFAULT_LEGEND_SHAPES`·`SHAPE_SECTION_TITLE` 등 내보내기 |
| `apps/web/src/components/ui/__preview__/Snapshot3DPreview.tsx` | 수정 | 모양 9종 갤러리 + 종류 필터(모양 견본 옵션 12종) |
| `apps/web/src/components/ui/__tests__/snapshot-3d.test.tsx` | 수정 | 테스트 **91 → 104개**(+13): `kindShape` 매핑·곁·custom·층 안 구분, `SHAPE_PATH` 조각 수·경계선·viewBox 범위·9종 서로 다름, `ShapeSwatch` 장식·tone, 범례 9항목·순서·문구·맨 아래 문장·`shapes={[]}`, 종류 필터 옵션 DOM |

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|
| 치수표를 코드에 적고 **모듈 로드 때 한 번 투영** | path `d` 문자열 9벌을 하드코딩(문서의 "고정 path") | 원본이 4.11.1 **치수표**라 그 숫자를 코드에 남기는 편이 검토·수정에 안전하다. 결과는 같은 고정 path이고(상수 1회 계산, 렌더마다 계산하지 않는다) `SHAPE_PATH`로 내보내 테스트가 값을 고정한다 |
| 실루엣 = **볼록 껍질** | 모양마다 실루엣 꼭짓점 순서를 손으로 나열 | 9종 × 6~10 꼭짓점을 시점에 맞춰 손으로 고르면 한 군데만 틀려도 도형이 깨진다. 모든 조각이 볼록이라 껍질이 곧 윤곽이다 |
| **뒤 → 앞으로 칠해** 가려진 선을 덮는다 | 은선 계산 / 겹 상자를 한 폴리곤으로 합치기 | 14~16px에서는 painter 순서면 충분하고, 면 색이 불투명(`bg.canvas`·`viz.kind.*.fill`)이라 결과가 같다. 폴리곤 합집합 코드를 들일 이유가 없다 |
| 윗면은 **칠만**, 경계선은 아래쪽 사슬만 | 윗면을 채우고 테두리까지 stroke | 윗면 테두리를 그리면 윤곽선(`border.strong`) 위에 경계선 색(`border.default`)이 덧칠돼 실루엣이 부분적으로 흐려진다. 아래쪽 사슬만 그리면 문서가 말한 "**경계선 1개**"와도 정확히 같다 |
| 곁 타일만 **2/3 축소**(비율 유지) | 실제 6u 폭 그대로 그리기 / 4u에 맞춰 찌그러뜨리기 | 6u는 견본 폭을 넘고, 찌그러뜨리면 비율이 거짓이 된다. 축소는 "납작한 타일"이라는 유일한 특징을 해치지 않는다 |
| 범례 견본 **중립 고정**, 종류 필터만 층 색 | 범례도 층 색 | 6.5 그대로. 바로 위 5줄이 색을 말하므로 견본까지 색을 쓰면 "모양 × 색 45칸"으로 읽게 된다 |
| 모양 절 2열을 **`1fr`** 로 | 고정 124px 2열 | 280px 팝오버에서 결과는 같고(124px), 좁아지는 화면에서 **가로 스크롤 대신 말줄임**이 된다(360px 요구) |
| 제목을 `<p>` + `aria-labelledby` | `<h3>` | 팝오버 안이라 heading 층위를 알 수 없다. 목록 이름은 `aria-labelledby`로 충분히 전달된다 |
| `SelectOption.adornment` (ReactNode) | `SelectOption.shape`/`layer` 필드 추가 | 일반 컨트롤(`controls/Select`)이 3D 전용 개념을 알게 하지 않는다. 견본을 넘기는 쪽(3D 화면)만 `ShapeSwatch`를 안다 |
| `kindShape()`에서 **곁 층을 가장 먼저** 판단 | custom 먼저 | 4.11.2: 곁 층은 종류·custom과 무관하게 타일이다. 곁의 사용자 지정 리소스가 `box`로 새는 것을 막는다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web -- src/components` | **통과(0 problems)** | |
| `npx tsc --noEmit -p tsconfig.json` (apps/web 전체) | **통과(오류 0)** | `features/**`(프론트 영역)까지 포함해 깨끗하다 — `index.ts` 내보내기 변경이 기존 사용처를 깨지 않았다 |
| `npx vitest run` (apps/web 전체) | **통과 — 20 파일 / 421 테스트** | snapshot-3d 파일은 91 → **104개** |
| 실루엣 눈 확인 | **통과** | 임시 ASCII 래스터로 9종 확인 후 임시 파일 삭제. 겹 상자 턱 / 원통 곡선 / 지붕 능선 / 아치 문 구멍 / 다이아몬드 좁은 밑면 / 얇은 판 / 납작한 타일이 모두 갈린다 |
| `next build` · prettier · 서버 실행 | **하지 않음(지시)** | `:3000`·`:3001`·`:3002` 건드리지 않았다. 프로세스를 띄우지 않았다 |

- **브라우저 실측은 하지 않았다**: `/dev/ui`를 띄우지 못하므로(서버 실행 금지) 14·16px에서의 최종 인상은 PM·designer가 `/dev/ui`에서 확인해야 한다. 코드 쪽으로는 좌표 범위(0.6~15.4)와 9종이 서로 다른 path라는 것까지 고정했다.

### 7. 남은 이슈·한계

1. **종류 필터 옵션의 층 그룹 제목**(6.1 "옵션은 층으로 묶고 그룹 제목 `워크로드`")은 아직 없다. `MultiSelect`가 평평한 목록만 지원한다(이번 요청 5건 밖이라 손대지 않았다). 필요하면 `SelectOption.group` + `<fieldset>` 안 소제목으로 넣겠다 — PM 판단을 기다린다.
2. **`roof`의 사면 방향에 문서 불일치**가 있다. 4.11.1은 용마루를 **x = 0**(사면이 ±x를 향함)으로 못 박았는데, 4.11.3 밝기 표는 `roof +z 사면`·`−z 사면`이라고 적었다. 견본은 **치수표(4.11.1)를 따랐다**. 프론트 지오메트리도 4.11.1을 따라야 견본과 장면이 같아진다 → designer 확인 요청(8절).
3. **`gate` 견본은 앞 세 다리만** 그린다. 네 번째(뒤) 다리는 구멍 너머로 보여 14px에서 구멍을 메운다. 3D 장면은 문서대로 **다리 4개**여야 한다(견본만의 축약이다).
4. 견본은 **밝기 3단을 쓰지 않으므로** 장면의 블록보다 평평해 보인다(의도 — 6.5).
5. `stack` ↔ `chamfer`가 가장 가까운 쌍이라는 designer의 경고는 견본에서도 같다. 견본(16px)에서는 턱 위치·꺾임 방향으로 갈리는 것을 ASCII로 확인했지만, **실제 장면 22px 확인은 프론트 몫**이다(4.11.6 회귀 점검).

### 8. 다른 담당 요청

- **frontend 요청**
  1. **모양 매핑 표를 만들지 말고** `kindShape`를 import 하세요. 시그니처는 9절에 그대로 적었습니다. `layer`는 **서버가 준 `blocks[].layer`**를 그대로 넘기면 됩니다(곁 판단이 여기 들어 있습니다).
  2. **종류 필터 옵션 배선**(6.1 · 16.2): `GraphTab.tsx`의 `kindOptions`에 `adornment: <ShapeSwatch shape={kindShape(k.kind, { layer })} size={14} tone="layer" layer={layer} />`를 더해 주세요. `facets.kinds[]`에 `layer`가 없어 **종류 → 층은 프론트가 `layers[].kinds` 구성에서 찾아야** 합니다(계약에 `facets.kinds[].layer`를 더하는 편이 깔끔합니다 — backend 요청 참고).
  3. `GraphTab.tsx` 984줄의 `hint`가 옛 문장(`블록 색은 층을 뜻합니다. 상태가 아닙니다.`)을 **직접 적어** 두었습니다. `LEGEND_NOTES[0]`으로 바꿔 주세요(6.4-9 · status.md 11.1: 새 문장은 `블록 색은 층, 모양은 종류를 뜻합니다. 상태가 아닙니다.`).
  4. 범례는 **`SceneLegend`가 알아서** 모양 절을 그립니다(기본값). 호출부를 고칠 필요가 없습니다.
- **backend 요청**: 3D 계약의 `facets.kinds[]`에 **`layer`**를 하나 더 주면, 종류 필터가 종류 → 층 표를 화면에서 다시 만들지 않아도 됩니다(4.10·4.11이 "층은 서버가 준다"를 전제로 합니다).
- **designer 요청**: 위 7-2의 **`roof` 사면 방향**(4.11.1 x축 vs 4.11.3 ±z) 중 어느 쪽이 맞는지 한 줄 확정해 주세요. 견본과 장면이 갈라지면 범례가 거짓말을 합니다.

### 9. 다음 담당이 알아야 할 점

**`kindShape()` — 프론트가 쓸 시그니처 (`@/components/ui` 또는 `components/ui/viz/KindIcon`에서 import)**

```ts
export type VizShape = "box" | "stack" | "cylinder" | "panel" | "roof" | "chamfer" | "gate" | "diamond" | "tile";

export function kindShape(
  kind?: string | null,
  opts?: { custom?: boolean; layer?: VizLayer },
): VizShape;

export const KIND_SHAPE: Record<string, VizShape>;   // 4.11.2 표 11줄
export const FALLBACK_KIND_SHAPE: VizShape;          // "box"
export const AUX_KIND_SHAPE: VizShape;               // "tile"
```

- 판단 순서: **`layer === "aux"` → `tile`** / `custom` → `box` / 표에 있으면 그 모양 / 그 밖 → `box`. 모르는 종류에도 빈 값을 주지 않습니다.
- 표: `Deployment` stack · `StatefulSet` cylinder · `DaemonSet` panel · `CronJob` roof · `Job` chamfer · `Service` diamond · `Ingress` gate · `PersistentVolumeClaim`/`PersistentVolume` cylinder · `ConfigMap` panel · `Secret` chamfer.

**`ShapeSwatch` props**

```ts
interface ShapeSwatchProps {
  shape: VizShape;               // kindShape() 의 결과
  size?: 14 | 16;                // 14 = 종류 필터 옵션, 16 = 범례(기본)
  tone?: "neutral" | "layer";    // 기본 neutral(중립색)
  layer?: VizLayer;              // tone="layer" 일 때만
  className?: string;
}
```

- 언제나 `aria-hidden="true"`입니다. 옆에 종류 문구를 **반드시 글자로** 두세요.
- 쓰는 자리는 **범례와 종류 필터 둘뿐**입니다(4.11.7). 선택 패널·관계 표·관계 항목은 `LayerSwatch`(층 색 사각) 그대로입니다.
- `SHAPE_PATH`(모양별 `{ parts, top, line }` path 문자열)도 내보냅니다. **three.js가 이 값을 쓰면 안 됩니다** — 2D 견본 전용이고, 3D 지오메트리는 4.11.1 치수표로 직접 만듭니다.

**`SceneLegend` 추가 props**

```ts
shapes?: { shape: VizShape; label: string }[];  // 기본 DEFAULT_LEGEND_SHAPES (9항목 고정)
```

빈 배열이면 모양 절을 그리지 않습니다. `SHAPE_SECTION_TITLE`(`"모양 = 종류"`)도 내보냅니다.

**`MultiSelect` 옵션 확장**

`SelectOption.adornment?: ReactNode` — 체크박스와 라벨 사이에 들어갑니다(`icon`보다 우선). 견본은 장식이어야 하고 뜻은 라벨 글자가 집니다.
