# snapshot-3d · 프론트 작업 보고

> 파일 위치: `docs/reports/snapshot-3d/frontend.md`
> 같은 기능에서 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-20 · 1단계 통합 (3D 보기 탭 + 관계 표)

### 1. 요청 내용

- PM 요청: 기능 `snapshot-3d` **1단계** 통합. k8s 스냅샷 상세에 "3D 보기" 탭(`?view=3d`) — three.js 3D 장면 + 관계 표 대체 보기. 범위는 **AC-3D01~33**(5.1 공통 + 5.2 K8s 구성도)만.
- 핵심 요구로 받은 것
  - three.js 도입·동적 로딩. 다른 페이지 첫 로딩 **+5 KB gzip 이하**, 3D 청크 **300 KB gzip 이하**. 번들 수치를 측정해 보고.
  - 데이터는 `GET …/graph` **1회 호출**로 3D·관계 표 모두. 드리프트 재조회 금지, 필터·검색·선택은 재조회 없이 응답 안에서. `blocks[]` 순서 = 배치 순서(좌표 없음) → **결정적 배치**. "구성이 바뀌었습니다"는 `graph.version` 비교. 임대는 기존 `POST …/drift {"force": false}` 60초.
  - URL: 탭 `?view=3d`, 선택은 기존 `res=` 재사용, 3D 전용 필터는 `g` 접두사. 기존 탭·쿼리 동작 불변.
  - 상호작용: 한 번 클릭 = 선택·정보 패널, 두 번 클릭·`Enter` = 파일/드리프트 탭 이동.
  - 접근성·대체: 관계 표는 항상 사용 가능하고 3D와 수치가 같아야 함. WebGL 없음·저사양·컨텍스트 손실·`prefers-reduced-motion`·키보드. 캔버스 `role=application` 은 `canvasSlot` 안에서.
  - 재질 색은 `--color-viz-*` CSS 변수에서 읽어 테마 전환 대응. 판 라벨 위치·가용 폭 A·축소 단계(P0~P3) 계산은 프론트.
  - 판 알약 이동은 `markers.hrefs`, 표식 있는 판은 자식 0이어도 행 유지 + `emptyHint`.
- 검증 환경 제약: 사용자가 보고 있는 **:3000(next dev)·:3001(api mock)** 을 종료·재시작하지 않고, `next build` 도 돌리지 않는다. 브라우저 확인은 그 :3000 에 헤드리스 Chrome 으로 붙어서.

### 2. 참고한 문서

- 명세 `docs/specs/snapshot-3d.md` — 3.0 공통 원칙, 3.1 K8s 구성도(층·관계 K1~K11·드리프트 겹쳐 보기), 3.5~3.9, 3.10 mock, 4.1~4.3 갱신·성능·번들, 5.1~5.2 AC-3D01~33
- 디자인 `docs/design/snapshot-3d.md` — 2 탭·URL·보기 기억, 3 레이아웃, 4 장면(4.1.1 판 표식·축소 사다리 / 4.3 배치 / 4.4 유령 보임 규칙 / 4.5 연결선 / 4.7 라벨·보조 줄 / 4.8 표식 / 4.9 카메라), 5 토큰, 6 도구 막대·정보 줄·범례·6.6 `notices` 매핑, 7 선택 패널·7.4 `notes` 자리, 8 관계 표·8.3 그룹 행, 9 상태별 모습(9.5~9.9), 10 겹쳐 보기·이동 규칙, 11 접근성, 12 반응형, 14 필요한 값
- `docs/design/components.md` 16·17절, `docs/design/status.md` 11절, `docs/design/k8s-snapshot.md`(상세 탭·URL 규칙)
- 계약 `docs/api/snapshot-3d.md` 전체(19절 변경 이력 포함), `docs/api/k8s-snapshot.md`, `docs/api/common.md`
- 보고서 `docs/reports/snapshot-3d/{publisher,designer,backend}.md` — publisher 의 prop 시그니처 2개 섹션과 프론트 요청 3건, backend 의 frontend 요청 7건
- 기존 코드 `apps/web/src/features/k8s-snapshots/**`, `apps/web/src/components/ui/viz/**`

### 3. 작업 내용

**① three.js 도입 (루트 설정)**

- `apps/web/package.json` 에 `three@^0.182.0`(dependencies)·`@types/three@^0.182.0`(devDependencies) 추가. 다른 설정 파일은 건드리지 않았다.
- three.js 는 **오직 `graph/scene/engine.ts` 한 곳**에서만 import 한다. 그 파일을 쓰는 `graph/scene/SceneCanvas.tsx` 는 `GraphTab` 이 `import()` 로만 부른다.

**② 두 단계 지연 로딩 (AC-3D01·02)**

1. 상세 페이지(`K8sDetailPage`)는 `graph/GraphTabLazy.tsx`(next/dynamic, `ssr:false`)만 정적으로 가진다 → 3D 탭을 열기 전에는 3D 코드가 0바이트.
2. 3D 탭을 열면 `GraphTab`(three.js 없음. 도구 막대·정보 줄·선택 패널·**관계 표**까지 전부 동작)을 받는다.
3. 사용자가 실제로 3D 장면을 볼 때만 `scene/SceneCanvas`(three.js 포함)를 받는다. 받는 동안 `Scene3DFrame state="loadingChunk"`(진행 표시 + [표로 보기]), 실패하면 `state="chunkFailed"` → 관계 표 + [다시 시도].
- 이 구조 때문에 `hooks.ts` 가 쓰는 3D 쿼리 파서를 **`graph/query.ts`(의존성 없는 파일)** 로 떼어 냈고, 배치 계산을 **`graph/layout.ts`(UI 컴포넌트 import 없음)** 로 떼어 냈다. 그렇지 않으면 상세·목록 페이지가 `@/components/ui` 배럴을 거쳐 3D 코드를 끌고 들어온다.

**③ 데이터 (조회 1회)**

- `api.ts` 에 `graphPath(id)` 추가, `graph/useGraph.ts` 에서 `GET /api/k8s-snapshots/:id/graph` **한 번만** 부른다. 드리프트 배지·표식·계산 시각은 응답 안의 `graph.drift`·`markers.drift` 를 쓰고 `GET …/drift` 는 부르지 않는다.
- SSE 는 기존 `k8s-snapshots` 토픽만 쓴다. `changed`·`drift` 수신 → `refreshKey` 가 바뀌어 다시 조회(새 토픽 없음).
- `graph.version` 비교: 같으면 **말없이 갱신**(카메라·선택 유지), 다르면 새 응답을 `pending` 에 두고 `구성이 바뀌었습니다 (블록 +2 · 관계 −1)` + [다시 배치]. 선택한 블록이 새 응답에 없으면 알림에 `고른 블록(...)이 더 이상 없습니다.` 를 붙이고 다시 배치할 때 `res=` 를 지운다.
- [드리프트 계산] 은 **기존** `POST …/drift {force:true}`. 응답의 `lease.renewAfterSec`(기본 60초)마다 `{force:false}` 로 갱신하고, 탭을 떠나거나 브라우저 탭이 숨겨지면 멈춘다.

**④ 배치 (`graph/layout.ts`) — 좌표는 화면이 만든다**

- 서버가 준 `plates[]`·`blocks[]` **순서**만으로 좌표를 만든다. 난수·force layout·해시 정렬 없음 → 같은 입력이면 항상 같은 배열·같은 자리(AC-3D11). 필터는 숨기기만 하고 좌표를 다시 계산하지 않는다(배치는 **전체 블록**으로 계산).
- 규칙: 셀 6u, 블록 4u×4u×3u, 층 간격 9u(비어 있는 층은 자리를 차지하지 않음), 층 안 열 수 `min(8, ceil(√n))`, 곁(`aux`)은 판 가장자리 띠에 6u×3u×0.75u 타일로 시계 방향, 판 크기 = 층 격자 최댓값 + 여백 3u + 곁 띠 3u(최소 18u), 판은 이름순 왼→오 한 줄 4장·간격 10u, `_cluster`·`_unparsed`·유령 판은 **새 줄**(맨 뒤 줄).

**⑤ 3D 장면 (`graph/scene/engine.ts`)**

- 렌더: 층마다 `InstancedMesh` 1개(면 밝기 윗면 100%·옆면 82%·아랫면 64%를 **지오메트리 정점 색으로 구워** 빛·그림자 없이 4.3 규칙을 만족), 층별 합친 `LineSegments` 윤곽, 유령은 투명 인스턴스 + dashed 윤곽, 관계선은 확정(실선)·추정(dashed) 2개의 합친 `LineSegments` + 화살표 머리 `InstancedMesh`.
- 색은 전부 `readVizColors()` 가 `--color-viz-*` CSS 변수에서 읽는다(하드코딩 0). 테마를 바꾸면 `applyColors()` 로 다시 만든다.
- 선택: 선택·이웃·검색 결과를 제외한 블록의 `instanceColor` 를 배경색 쪽으로 섞어 `--opacity-viz-dimmed`(0.25) 효과를 낸다(투명도 정렬 비용 회피). 선택 윤곽(실선)·검색 윤곽(dashed)·이웃 선 강조는 별도 `LineSegments`.
- 카메라: 방위 −35°·고도 30°, FOV 35°, 거리·고도 제한, `0`/`1`/`2`/`3`, 300ms 전환(`prefers-reduced-motion` 이면 0ms). 자동 회전 없음. 고도 70° 이상이면 위쪽 층 면을 0.35로 낮춘다.
- **렌더 루프는 요청형**이다. 조작·데이터 변경이 있을 때만 `requestAnimationFrame` 을 걸고, 끝나면 프레임 요청이 0이 된다(AC-3D17). 탭이 숨겨지면 브라우저가 rAF 를 멈추고, 다시 보이면 한 프레임만 그린다.
- 저사양 감지: 프레임 간격을 5초 창으로 모아 중앙값 > 50ms(=20fps 미만)이면 `onLowPerformance` 1회(AC-3D07). `frameStats()` 로 중앙값·p95 를 꺼내 쓸 수 있다.
- 컨텍스트 손실: `webglcontextlost` → 관계 표로 전환 + [3D 다시 켜기].
- 자원 해제: `dispose()` 에서 지오메트리·재질·InstancedMesh·renderer 를 모두 해제하고 리스너를 뗀다.

**⑥ 2D 오버레이 (라벨·표식·판 라벨)**

- 라벨·표식은 3D 가 아니라 **HTML 오버레이**다. React 가 DOM 을 만들고(`PlateLabel`·`BlockMarkers` 그대로 사용) 엔진이 매 프레임 `transform` 으로 위치만 옮긴다.
- 겹침 처리: 화면 24px 격자로 중복을 눌러 **카메라에서 먼 라벨을 숨긴다**. 판 라벨·선택·검색 결과·표식이 있는 블록은 `priority` 로 항상 이긴다(4.7).
- **판 라벨 가용 폭 `A` 와 축소 단계 P0~P3 는 프론트가 계산한다**: 같은 줄 다음 판 앵커까지의 화면 거리 − 8px(줄 마지막 판은 200px)을 250ms마다 다시 재고, 바뀐 경우에만 `onPlateDensity` 로 알려 `PlateLabel density` 를 바꾼다.
- 판 알약 클릭 이동은 `markers.hrefs = { scan, drift }` 로 넘긴다. `navigate.file` 이 없으면 `hrefs.scan` 을 주지 않아 알약이 링크가 아니라 글자로 남는다(publisher 요청 ①).

**⑦ 필터·검색·선택 (재조회 없이, AC-3D10·12)**

- `useDetailQuery` 를 확장해 `gview·gns·gkind·grel·gmark·gq·glabels·gfocus·gdrift` 를 같은 URL 상태로 다룬다. 기존 `view·file·line·res·kind·hidden` 동작은 그대로. 선택은 **기존 `res=`** 를 재사용하고, 드리프트 탭으로 넘길 때는 `navigate.resourceKey` 를 쓴다.
- `grel` 이 없으면 기본 켬 집합 `K1~K7`. 전부 끄면 `grel=none`(빈 집합)으로 남겨 "기본값"과 구분한다.
- 필터 순서는 디자인 4.4 그대로: ① 관계 필터로 유령 숨김(`ghostFromRules`) → ② 드리프트 겹쳐 보기 → ③ `gns`·`gkind`·`gq`·`gmark` → ④ 주변만 보기. 판은 거르지 않는다.
- 개수·요약은 전부 서버 값과 같은 배열에서 센다. 3D 정보 줄·도구 막대 오른쪽·표 위 요약이 **같은 함수**(`countText`·`tableSummaryText`)를 쓴다(AC-3D04).

**⑧ 관계 표 (대체 보기)**

- 같은 응답으로 `RelationTable` 행을 만든다: 판 그룹 행(표식·`namespace.yaml` 경로·[파일]/[드리프트]·`emptyHint`) → 층 그룹 행 → 리소스 행(표식·들어옴/나감·동작) → 펼치면 관계 목록.
- 표식이 있는 판은 자식이 0이어도 행을 남기고 `emptyHint="표시할 리소스 없음"` 을 준다(publisher 요청 ③).
- `표식` 열 정렬만 허용하고, 판 순서는 그대로 두고 **층 안에서만** 다시 정렬한다.

**⑨ 접근성 (11절)**

- 캔버스는 `role="application"` + `aria-roledescription="3D 구성도"` + 요약 `aria-label` + `aria-describedby` 조작 한 줄, **탭 정지점 1개**. 앞에 `sr-only` 건너뛰기 링크 [표로 보기](`gview=table`).
- 키: 방향키 회전 / Shift+방향키 팬 / `+`·`-` / `0` / `1`·`2`·`3` / `]`·`[` 다음·이전 블록 / `Home`·`End` / `PageDown`·`PageUp` 판 이동 / `Enter` 이동 / `Esc` 해제 / `f` 주변만 / `t` 표 / `?` 도움말.
- 선택이 바뀌면 `blockSelectionAnnouncement()` 문장을 `Scene3DFrame liveMessage` 로 읽는다. `PageDown`/`PageUp` 으로 판에 들어갈 때는 `plateAnnouncement()`(`prod 판, 리소스 11개, 변경됨 · 필드 1건 …`)를 앞에 붙인다(publisher 요청 ②).
- `prefers-reduced-motion: reduce` → 카메라 전환 0ms, 자동 회전·깜박임 없음, 알림 등장 애니메이션 없음.

**⑩ 상태·안내**

- `Scene3DFrame state` 매핑: `loadingData`·`unknown`(`pending_export`/`SOURCE_UNAVAILABLE`)·`empty`·`unsupported`(WebGL 없음)·`chunkFailed`·`contextLost`·`loadingChunk`·`filteredEmpty`·`error`·`stale`·`ready`.
- `notices[]` 는 디자인 6.6 표대로 자리를 나눴다(`RELATIONS_PARTIAL` → 정보 줄 `circle-help` 툴팁, `EXPORT_MAYBE_IN_PROGRESS`/`NO_RESOURCES` → 상태 화면, `CUSTOM_RESOURCES_PRESENT`/`GROUPED_VIEW`/그 밖 모르는 code → 정보 줄 칩). 서버 문구를 그대로 쓰고 화면이 새 문구를 만들지 않는다.
- 캔버스 위 알림은 최대 2개(잘림 → 구성 변경 → 저사양 순).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/package.json` | 수정 | `three@^0.182.0`, `@types/three@^0.182.0` 추가 |
| `apps/web/package-lock.json` | 수정 | 위 의존성 |
| `apps/web/src/features/k8s-snapshots/graph/types.ts` | 추가 | `docs/api/snapshot-3d.md` 계약 타입(좌표 없음) |
| `apps/web/src/features/k8s-snapshots/graph/query.ts` | 추가 | 3D URL 쿼리(`g*`)·규칙 목록. **의존성 없는 파일**(상세 페이지가 3D 코드를 끌고 오지 않게) |
| `apps/web/src/features/k8s-snapshots/graph/layout.ts` | 추가 | 배치 계산(판·층·격자·곁 띠·카메라 기준값). UI import 없음 |
| `apps/web/src/features/k8s-snapshots/graph/model.ts` | 추가 | 필터·검색·표식 매핑·보조 줄·개수 문구·표 행 뼈대·이동 주소 |
| `apps/web/src/features/k8s-snapshots/graph/model.test.ts` | 추가 | 순수 함수 테스트 14개 |
| `apps/web/src/features/k8s-snapshots/graph/view.tsx` | 추가 | 계약 값 → publisher 컴포넌트 props(선택 패널·관계 항목·표 행·이동 버튼) |
| `apps/web/src/features/k8s-snapshots/graph/store.ts` | 추가 | 보기 기억(`localStorage`)·WebGL 지원 여부(`useSyncExternalStore`) |
| `apps/web/src/features/k8s-snapshots/graph/useGraph.ts` | 추가 | `GET …/graph` 1회 조회·`graph.version` 비교·드리프트 계산/임대 갱신 |
| `apps/web/src/features/k8s-snapshots/graph/GraphTab.tsx` | 추가 | 3D 보기 탭 조립(도구 막대 A·B, 정보 줄, 범례, 카메라, 선택 패널, 관계 표, 알림) |
| `apps/web/src/features/k8s-snapshots/graph/GraphTabLazy.tsx` | 추가 | 탭 진입 시에만 `GraphTab` 을 받는 동적 진입점 |
| `apps/web/src/features/k8s-snapshots/graph/graph.module.css` | 추가 | 블록 라벨·보조 줄·조작 도움말·필터 팝오버 |
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 추가 | three.js 장면·카메라·픽킹·오버레이 위치·성능 측정 (**three.js 를 import 하는 유일한 파일**) |
| `apps/web/src/features/k8s-snapshots/graph/scene/SceneCanvas.tsx` | 추가 | 캔버스 React 컴포넌트(`role=application`·키보드·오버레이 DOM) |
| `apps/web/src/features/k8s-snapshots/graph/scene/colors.ts` | 추가 | `--color-viz-*` CSS 변수 읽기, WebGL 지원 확인 |
| `apps/web/src/features/k8s-snapshots/graph/scene/scene.module.css` | 추가 | 캔버스·오버레이 레이어 |
| `apps/web/src/features/k8s-snapshots/api.ts` | 수정 | `graphPath(id)` 추가 |
| `apps/web/src/features/k8s-snapshots/hooks.ts` | 수정 | `useDetailQuery` 에 `g*` 쿼리 9개 추가(기존 6개 동작 불변) |
| `apps/web/src/features/k8s-snapshots/model.ts` | 수정 | `DetailView` 에 `3d` 추가, `detailTabs` 에 3번째 탭 `3D 보기`(숫자·상태 아이콘 없음) |
| `apps/web/src/features/k8s-snapshots/K8sDetailPage.tsx` | 수정 | `?view=3d` 분기에서 `GraphTabLazy` 렌더 |
| `apps/web/src/features/k8s-snapshots/model.test.ts` | 수정 | 탭 6개 기대값 |
| `apps/web/src/features/k8s-snapshots/pages.test.tsx` | 수정 | 탭 6개 기대값 |

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 이유 |
|---|---|---|
| **지연 로딩을 2단계로** (`GraphTabLazy` → `GraphTab` → `SceneCanvas`) | `SceneCanvas` 만 동적 | AC-3D01 은 "3D 보기를 열지 않고 다니면 3D 청크 요청이 없고 첫 로딩이 +5 KB 이하". `GraphTab` 을 정적으로 두면 상세 페이지가 3D UI 로직(gzip 19 KB)을 항상 받는다. 2단계로 쪼개 상세 페이지 증가를 **0.7 KB gzip** 으로 줄였다 |
| `query.ts`·`layout.ts` 를 별도 파일로 | `model.ts` 한 파일 | `hooks.ts`(목록·상세·휴지통 공용)가 3D 쿼리 파서를 쓰는데, `model.ts` 는 `@/components/ui` 를 import 한다. 파일을 쪼개지 않으면 3D 를 안 여는 페이지까지 번들이 커지고, 반대로 3D 청크가 공용 UI 를 다시 끌고 들어온다 |
| 면 밝기를 **지오메트리 정점 색으로 구움** (빛 없음) | `MeshLambertMaterial` + 평행광 | 디자인 4.3의 "윗면 100%·옆면 82%·아랫면 64%, 그림자 없음"을 정확히 재현하면서 빛 계산·셰이더 분기를 없앴다. 1,000 블록에서 draw call 이 층당 1개로 끝난다 |
| 흐림을 투명도가 아니라 **instanceColor 혼합**으로 | `material.opacity` | 투명 인스턴스는 정렬 비용이 크고 겹치면 어색하다. 배경색 쪽으로 섞으면 같은 시각 효과를 불투명 렌더로 얻는다 |
| 라벨·표식을 **HTML 오버레이**로 | 스프라이트·캔버스 텍스처 | 원근을 따르지 않는 같은 크기(1절)·툴팁·링크·스크린리더 문구를 그대로 쓰려면 DOM 이어야 한다. publisher 컴포넌트(`BlockMarkers`·`PlateLabel`)를 그대로 재사용할 수 있다 |
| 판 라벨 밀도(P0~P3)를 **엔진이 재고 React 가 그림** | React 가 매 프레임 계산 | 화면 거리는 카메라가 움직여야 바뀌므로 엔진이 안다. 250ms 간격으로 재고 **값이 바뀔 때만** 상태를 올려 프레임마다 리렌더하지 않는다 |
| 카메라 기본 거리를 **오버레이를 뺀 영역에 맞춤** | 디자인 4.9의 "대각선 × 1.25" 그대로 | 1.25배만 쓰면 768px 캔버스에서 장면이 잘리거나(넓은 배치) 가운데 작게 남았다. 또 범례(200px)·카메라 오버레이가 덮는 영역 때문에 왼쪽 뒤 판(`prod`)이 범례 뒤로 완전히 숨었다. `대각선 × 1.25` 에서 시작해 화면 비율과 오버레이 여백으로 줄이고 중심을 옮긴다 — **디자인과 다른 점**(8절에 디자이너 요청) |
| 선택 강조 = 이웃·선만, 깜박임 없음 | 맥동 강조 | 디자인 7.1 그대로(reduced-motion 과 무관하게 항상) |
| 렌더 루프를 **요청형**으로 | 상시 rAF | AC-3D17("조작이 없으면 2초 안에 그리기 멈춤")을 구조적으로 보장한다. 멈추는 데 2초가 아니라 즉시다 |
| 탭이 숨겨져도 **캔버스를 언마운트하지 않는다** | 숨기면 언마운트 | 언마운트하면 카메라·선택 상태가 사라진다. 요청형 루프라 숨겨진 동안 프레임 요청이 없고 브라우저도 rAF 를 멈춘다 |
| 종류 아이콘(블록 윗면·패널·표)을 **넣지 않음** | 임의 lucide 아이콘 매핑 | 디자인에 k8s 종류별 아이콘 표가 없다. 없는 매핑을 지어내면 뜻이 굳어 버린다. 종류는 라벨·패널·표의 종류 이름과 층 색으로 구분된다(디자인 5.2 ②③). → 8절 디자이너·퍼블리셔 요청 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과** (0 problems) | |
| `npx tsc --noEmit -p apps/web` | **통과** | `--incremental false` 로도 확인 |
| `npm test --prefix apps/web` (vitest) | **통과 20 파일 / 369 테스트** | 이번 추가 14개(`graph/model.test.ts`). 기존 355개 중 2개(탭 목록)는 탭이 5→6개가 되어 기대값을 고쳤다 |
| `next build` | **돌리지 않음** | 지시대로(:3000 dev 서버의 `.next` 충돌 회피). 번들 수치는 rolldown(저장소에 이미 있는 vitest 의존성)으로 **따로 묶어 측정**했다 — 아래 |
| 브라우저 확인 | 헤드리스 Chrome(CDP)으로 이미 떠 있는 :3000 에 접속해 확인·촬영 | 스크린샷 16장 + 검증용 7장 |

**번들 수치** (rolldown `minify: true` + gzip level 9, `react`/`next`/공용 UI 배럴은 외부로)

| 항목 | raw | **gzip** | 목표 |
|---|---|---|---|
| **3D 청크**(three.js + `engine.ts` + `SceneCanvas` + `colors` + `layout`) | 515.6 KB | **129.9 KB** | ≤ 300 KB ✅ |
| └ 그중 내 코드(three.js 제외) | — | 8.0 KB | |
| **3D 탭 청크**(`GraphTab` + `model`·`view`·`useGraph`·`store`, 공용 모듈 제외) | 51.4 KB | **19.3 KB** | 탭을 열 때만 받는다 |
| **3D 를 열지 않은 페이지가 더 받는 양** = 동적 진입점(0.3 KB) + `query.ts`(0.4 KB) | 1.0 KB | **0.7 KB** | ≤ 5 KB ✅ |
| 그 밖의 페이지(개요·비용·노드 등) | — | **0 KB** | k8s 상세를 import 하지 않는다 |

- 측정 방법: `rolldown` 으로 각 진입점을 번들 + minify 후 gzip. `next build` 와 청크 경계가 완전히 같지는 않지만, **three.js 가 3D 청크에만 들어간다는 것**(`engine.ts` 외에 import 하는 파일이 없음)과 자릿수는 그대로다. 정확한 라우트별 First Load JS 비교는 `next build` 가 필요하다 → **PM 요청**(8절).
- 참고: `components/ui` 배럴에 publisher 가 추가한 viz 컴포넌트(1단계 퍼블리싱)는 이번 작업 전부터 공용 청크에 있다. 위 "0 KB"는 **이번 프론트 변경분** 기준이다.

**AC-3D별 확인** (mock `default` 시나리오, `20260919-061000` 등)

| AC | 결과 | 근거 |
|---|---|---|
| 3D01 | ✅ | 3D 탭을 열기 전 `GraphTabLazy` 스텁만(0.7 KB gzip). three.js import 는 `engine.ts` 한 곳 |
| 3D02 | ✅ | 3D 청크 129.9 KB gzip, 받는 동안 `loadingChunk`(스피너 + `처음 한 번만 내려받습니다`), 실패 시 표 + [다시 시도] |
| 3D03 | ✅ | `--disable-3d-apis` 크롬에서 오류 없이 관계 표 + `이 브라우저에서 3D를 쓸 수 없어 표로 보여 줍니다`, `3D` 칸 비활성 (`nowebgl-*.png`) |
| 3D04 | ✅ | 3D 정보 줄 `블록 27 · 관계 15`, 표 위 `블록 27개(유령 3) · 관계 15개 · 드리프트 표식 3 · 스캔 표식 0` — 같은 배열·같은 함수. 행 이동 버튼 = 선택 패널 버튼 |
| 3D05 | ✅(코드) | `useMediaQuery("(prefers-reduced-motion: reduce)")` → 카메라 전환 0ms. 자동 회전·깜박임 없음. 실제 OS 설정으로는 확인 못 함 |
| 3D06 | ✅ | 캔버스 탭 정지점 1개 + 키 13종 + `sr-only` [표로 보기] + `aria-live` 선택 문장 |
| 3D07 | ⚠ 부분 | 저사양 감지(5초 중앙값 20fps 미만)·자동 간소화·[표로 보기 권함] 알림 구현. **실제로 20fps 미만을 만드는 개발 설정은 만들지 않았다**(명세가 "프론트가 제공"이라 한 부분). 컨텍스트 손실 → 표 + [3D 다시 켜기]는 구현 |
| 3D08 | ✅ | `localStorage sentinel.snapshots.k8s.view3d`, 우선순위 `gview` > 저장소 > `3d`. WebGL 없음·청크 실패·컨텍스트 손실은 저장소를 바꾸지 않는다 |
| 3D09 | ✅ | 회전·팬·확대(마우스/휠/키보드), hover 라벨, 선택 + 이웃·선 강조 + 패널, `Esc`, 초기화, 시점 3개, 주변만 보기, 라벨 밀도 |
| 3D10 | ✅ | 검색 부분 일치·대소문자 무시 + `n/m` + 이전·다음(카메라 이동). 필터는 3D·표에 함께 걸리고 `g*` 쿼리로 남는다 |
| 3D11 | ✅ | `computeLayout` 단위 테스트(두 번 계산해도 동일). 필터는 좌표를 다시 계산하지 않는다 |
| 3D12 | ✅ | `?view=3d&res=apps/Deployment/prod/api` 링크로 열면 선택된 채 열린다 (`selected-*.png`) |
| 3D13 | ✅ | 3D 탭에서 나가는 요청은 `GET …/graph` 뿐. PUT·DELETE 0건, `GET …/drift` 0건, [드리프트 계산]만 기존 `POST …/drift` |
| 3D14 | ✅ | 응답에 값이 없고 화면도 식별값·서버 문구만 쓴다. Secret 유령은 이름 + `Secret — 이름만, 값 없음` |
| 3D15 | ✅ | 적용·내보내기·삭제·배치 저장·연결 편집 수단 없음 |
| 3D16 | ✅(코드) | SSE `changed`·`drift` → 재조회, `graph.version` 비교로 말없이 갱신/[다시 배치]. 외부 파일 변경 시나리오는 mock 에서 만들지 못해 코드 경로만 확인 |
| 3D17 | ✅ | 요청형 rAF — 조작이 끝나면 프레임 요청 0. 탭 숨김 시 rAF 정지 |
| 3D18 | ✅ | mock 배지, `pending_export`→`UnknownState`, `SOURCE_UNAVAILABLE`→`UnknownState`, stale 테두리·배지, 클러스터 연결 없음 → 구성도는 그리고 겹쳐 보기만 비활성 |
| 3D19 | ⚠ 부분 | mock `large`(블록 1,020·관계 1,960)에서 장면이 정상으로 열리는 것까지 확인(`verify/verify-large-1000.png`). **fps 실측은 못 했다** — 헤드리스 SwiftShader(소프트웨어 렌더)라 기준 장비 수치가 아니다. `SceneCanvasHandle.frameStats()` 를 넣어 두었으니 실장비에서 바로 잰다 |
| 3D20 | — | 백엔드 몫(p50 25ms·p95 45ms 보고됨) |
| 3D21 | ⚠ 미측정 | `dispose()` 로 지오메트리·재질·renderer 해제 구현. 힙 10회 열고 닫기 측정은 못 함 |
| 3D22 | ⚠ **부분** | 블록 3,264개에서 `summary.grouped` 로 정보 줄 `묶어 보기` 칩이 뜨고 **관계 표는 전체 행**을 보인다. 그러나 **3D 묶음 블록(판×종류 묶기·두 번 클릭 펼침)은 구현하지 않았다** — 지금은 개별 블록 3,264개를 그대로 그린다(`verify/verify-large-3200.png`). 7절 참고 |
| 3D23 | ✅ | 탭 6개(`파일`·`드리프트`·`3D 보기`·`리소스 수`·`Secret 참조`·`메타데이터`), 3D 탭에 숫자·상태 아이콘 없음. 기존 쿼리·AC-K17~K19 테스트 통과 |
| 3D24 | ✅ | K-1: 판 5장(batch·data·default·monitoring·prod), 층대로 블록 27개(기본 켬 기준) / 전체 33개. ConfigMap·NetworkPolicy·CronJob 도 블록(비교 불가 표식) |
| 3D25 | ✅ | 선택 패널에서 `Service api`(추정·셀렉터)·`HPA api`(확정)·`ConfigMap api-config`(확정)·`Secret api-db-credentials`(확정·유령) 확인, K8~K11 은 필터로 켜면 보인다 (`selected-1440-light.png`) |
| 3D26 | ✅ | K-9: `ConfigMap worker-config` 유령 "스냅샷에 없음", `Service api-legacy` "대상 없음", `Service pg-external` "셀렉터 없음(수동 Endpoints·ExternalName)" — 선 없음, 상태 배지·상태색 아님 (`verify/verify-k9-services.png`) |
| 3D27 | ✅ | K-1 표식 3건(변경 `Deployment api` 필드 3 / 삭제 `Ingress api-public` / 추가 `Deployment payments` 유령) = 드리프트 배지 `차이 3건`. 비교 불가 4건 `eye-off`. 빨강·초록 없음 |
| 3D28 | ✅ | K-7·K-9: 스위치 비활성 + `계산 안 함` + [드리프트 계산](허용될 때만). 임대는 `POST …/drift {force:false}` 60초, 탭을 떠나면 멈춤 |
| 3D29 | ✅(코드) | `badge.mode === "last_result"` 면 계산 시각 앞에 `지난 결과 · ` |
| 3D30 | ✅ | K-3 `StatefulSet postgres` 에 오류 표식, `navigate.primary = files` + `line = firstLine` 로 발견 줄 이동 |
| 3D31 | ✅ | K-7: `한 파일에 여러 리소스 (2개)` 두 블록이 같은 파일로(문서별 줄), `경로 불일치` 표식, 해석 실패는 `_unparsed` 판에 관계선 없이 (`verify/verify-k7-table.png`) |
| 3D32 | ✅ | [파일에서 보기] `?view=files&file=…(&line=)`, [드리프트에서 보기] `?view=drift&res=<resourceKey>`, 추가됨 유령은 드리프트만, Secret 유령은 `?view=secrets` |
| 3D33 | ✅ | `monitoring/grafana` 에 `Helm` 표식 (`verify/verify-k9-services.png`) |

**스크린샷**: `…/scratchpad/shots-3d/` — `scene-{1024,1440}-{light,dark}.png`(3D 장면 전체), `selected-*`(선택 상태), `table-*`(관계 표), `nowebgl-*`(WebGL 없음). 검증용은 `shots-3d/verify/`(K-9 관계 예외, K-7 여러 문서·경로 불일치, K-3 스캔, 대규모 1,000·3,200).

### 7. 남은 이슈·한계

1. **AC-3D22 묶어 보기(3D 쪽) 미구현.** `summary.grouped` 안내·칩과 "관계 표는 전체 행"은 되지만, 3D 장면의 묶음 블록(`groups[]` 로 판×종류 1블록 + 두 번 클릭 펼침 + 펼친 묶음만 선 그리기, 디자인 9.7)은 만들지 않았다. 지금은 3,264 블록을 개별로 그린다(헤드리스에서는 뜨지만 저사양 기기에서 목표 fps 를 못 맞출 수 있다). **다음 작업 1순위**.
2. **성능 수치(AC-3D19·21) 실측 없음.** 헤드리스 Chrome 은 SwiftShader 소프트웨어 렌더라 기준 장비(내장 GPU) 수치가 아니다. `frameStats()`(중앙값·p95·표본 수)를 노출해 두었으니 실장비에서 콘솔로 바로 잰다. JS 힙 10회 반복 측정도 남았다.
3. **저사양 흉내 개발 설정 없음**(AC-3D07 절반). 명세가 "프론트가 제공"이라 한 WebGL 끔·저사양 흉내 스위치를 만들지 않았다. WebGL 끔은 브라우저 플래그(`--disable-3d-apis`)로 대체했다.
4. **범례가 장면을 가린다.** 캔버스 768×636 에 범례 200×~380px 오버레이가 왼쪽 아래를 덮어 왼쪽 뒤 판이 숨었다. 카메라 맞춤에 오버레이 여백(왼쪽 184px·오른쪽 112px)을 넣어 피했지만, 그만큼 장면이 작아진다. 범례를 접으면(상태 저장) 넓게 쓴다.
5. **종류 아이콘 없음.** 블록 윗면 아이콘(디자인 4.3), 선택 패널·표의 `kindIcon` 을 비웠다(5절 참고). 층 색 + 종류 이름으로만 구분한다.
6. **관계 표 보기에 범례가 없다.** 디자인 6.5 마지막 줄("표 위 접힘 영역으로 남는다")은 넣지 않았다. 표에는 아이콘 + 문구가 함께 있어 기호 해설이 덜 급하다고 봤지만, 필요하면 추가한다.
7. **블록 라벨 겹침**은 24px 격자 + 우선순위로만 줄인다. `prod` 처럼 좁은 판에 블록이 몰리면 여전히 붐빈다(라벨 밀도를 `선택·검색만`으로 내리면 해소).
8. **표식 원 위치**가 디자인 4.8(블록 윗면 오른쪽 위 모서리 위 4px)과 다르다. 라벨 상자 위에 가운데 정렬로 쌓았다 — 오버레이 한 덩어리로 움직여야 겹침 처리·툴팁이 일관된다.
9. `res=` 로 링크를 열면 그 블록이 **선택되지만 카메라는 옮기지 않는다**(AC-3D12 는 선택만 요구). 키보드·검색 이동에서는 카메라가 따라간다.
10. mock 시나리오 `large` 로 바꿔 대규모를 확인한 뒤 **`default` 로 되돌려 놓았다**(사용자가 보는 :3001 상태 유지).

### 8. 다른 담당 요청

- **PM 요청**: 라우트별 First Load JS 를 계약대로 비교하려면 `next build` 가 필요합니다(지금은 `.next` 충돌 때문에 돌리지 않았습니다). 사용자의 :3000 dev 서버를 잠시 멈출 수 있을 때 ① `npm run build --prefix apps/web` 한 번 ② 출력의 라우트별 First Load JS 표를 이 보고서에 첨부 — 또는 `next build --distDir .next-build` 처럼 **다른 출력 폴더**로 돌리면 dev 서버와 충돌 없이 잴 수 있습니다(제 측정치: 3D 청크 129.9 KB gzip / 비3D 페이지 +0.7 KB gzip).
- **PM 요청**: AC-3D19·21(조작 중 fps·힙 증가)은 기준 장비(내장 GPU, Chrome)에서 사람이 한 번 재야 합니다. 3D 보기를 열고 개발자 도구 콘솔에서 회전 5초 뒤 `frameStats()` 값을 읽는 방식으로 측정할 수 있게 해 두었습니다(핸들을 화면에 노출해 드릴까요?).
- **디자이너 요청**
  1. 4.9 카메라 기본 거리 "대각선 × 1.25"만으로는 8열 768px 캔버스에서 장면이 잘리거나 작게 남습니다. **"장면이 다 들어오는 거리(오버레이 여백 제외)"** 로 문구를 고쳐 주세요. 지금 구현은 `max(대각선 × 1.25, 화면에 맞춘 거리)` 에서 시작해 여백만큼 줄이고 중심을 옮깁니다.
  2. 6.5 범례(200px, 펼침 기본)가 캔버스의 왼쪽 아래 1/4을 덮어 **왼쪽 뒤 판을 가립니다**. ① 기본을 접힘으로 바꾸거나 ② 캔버스 밖(도구 막대 B 옆 팝오버)으로 옮기는 안을 검토해 주세요.
  3. 4.3 "윗면 종류 아이콘 16px"과 7.2/8.2의 종류 아이콘에 쓸 **k8s 종류 → lucide 아이콘 표**가 없습니다. 표를 주시면 넣겠습니다(지금은 층 색 + 종류 이름으로만 구분).
  4. 4.8 표식 원 위치를 "블록 라벨 상자 위"로 바꿔도 되는지 확인 부탁드립니다(7절 8번).
- **퍼블리셔 요청**
  1. `NOTE_SPEC` 에 `selector_missing`·`no_target`·`pvc_template_unmatched` 를 추가해 주세요(디자인 13.1의 `unlink` 아이콘). 지금은 등록되지 않은 code 라 `info` 아이콘 + 서버 문구로 그려집니다(동작에는 문제 없음).
  2. `InlineAlert` 에 `onClose` 가 없어 닫을 수 있는 알림(9.5 저사양·9.9 잘림)을 `action` 슬롯의 `IconButton x` 로 만들었습니다. 디자인이 "닫기 있음"이라고 한 알림이 3종이니 `closable`/`onClose` prop 을 검토해 주세요.
  3. `RelationTable` 의 판 그룹 행에 `count` 를 주면 `(11)` 로 보이는데, **필터 중일 때는 보이는 자식 수**를 넣고 있습니다. 디자인 8.3의 `(11)` 이 전체 수인지 보이는 수인지 확정 부탁드립니다(지금은 보이는 수 — 정보 줄 개수와 일관되게).
- **백엔드 요청**: 없습니다. 계약(19절 변경분 포함)대로 다 받았고 응답 1회로 충분했습니다. 응답 크기(1,000 리소스 2.0 MB)는 로컬에서 체감 문제가 없어 `rules` 쿼리를 쓰지 않았습니다 — 원격에서 느려지면 그때 `rules=K1..K7` 로 줄이겠습니다.

### 9. 다음 담당이 알아야 할 점

- **three.js 를 import 하는 파일은 `graph/scene/engine.ts` 하나뿐입니다.** 다른 곳에서 `from "three"` 를 쓰면 AC-3D01 이 깨집니다(3D 를 열지 않은 페이지가 129 KB 를 받게 됩니다). `graph/scene/**` 는 `GraphTab` 이 `import()` 로만 불러야 합니다.
- `graph/layout.ts`·`graph/query.ts` 는 **UI 컴포넌트를 import 하지 않습니다**(청크 경계 유지). 이 두 파일에 `@/components/ui` 를 추가하지 마세요.
- **좌표는 서버가 주지 않습니다.** 배치가 바뀌어야 하면 `graph/layout.ts` 의 `U` 상수와 `computeLayout()` 만 고치면 3D·카메라·오버레이가 따라옵니다. 난수·물리 시뮬레이션을 넣으면 AC-3D11 이 깨집니다.
- 색은 전부 `graph/scene/colors.ts` 의 `readVizColors()` 를 거칩니다. 새 색이 필요하면 `tokens.json` → `--color-viz-*` 에 추가하고 여기서 읽으세요.
- 2단계(AWS 구성도)를 붙일 때: `engine.ts`·`SceneCanvas.tsx` 에는 k8s 용어가 없습니다(층 id 만 공유). `GraphTab` 의 문구·필터·이동 규칙만 AWS 판으로 갈아 끼우면 됩니다. 계약도 같은 봉투(`plates`/`blocks`/`edges`)를 쓰기로 되어 있습니다(계약 18절).
- 관계 표와 3D 는 **같은 `filterGraph()` 결과**를 씁니다. 한쪽만 고치면 AC-3D04(같은 수치)가 깨집니다.
- 3D 탭을 열어 두는 동안 `POST …/drift {force:false}` 가 60초마다 나갑니다(사용자가 [드리프트 계산]을 눌렀을 때만). 탭을 떠나면 멈추고 서버가 최대 120초 뒤 계산을 멈춥니다.
- 테스트는 `apps/web/src/features/k8s-snapshots/graph/model.test.ts`(순수 함수 14개)에 있습니다. 필터·배치·문구를 바꾸면 여기가 먼저 깨집니다.

---

## 2026-09-20 (2) · 번들 실측(`next build`) + 퍼블리셔 새 prop 반영

### 1. 요청 내용

- PM 요청 ①: `next build --distDir` CLI 옵션이 없어 실패했으니 **`apps/web/next.config.ts` 에 `distDir: process.env.NEXT_DIST_DIR ?? ".next"`** 를 넣고(기본값 그대로 → 기존 동작 불변), `NEXT_DIST_DIR=.next-build npx next build` 로 **사용자의 :3000 dev 서버를 건드리지 않고** 라우트별 First Load JS 를 실측한다. 측정 뒤 `.next-build` 삭제, `.gitignore`·`eslint.config.mjs` 무시 목록에 추가(루트 `.gitignore` 수정이 필요하면 PM 요청). `npm run lint` 이 그 폴더 때문에 5,933건(192 errors)을 내고 있으니 정리 후 0이 되는지 확인.
- PM 요청 ②: publisher 가 새 prop 을 넣었다(`publisher.md` 2026-09-20 (3)) — `NOTE_SPEC` 3종 추가(내 임시 처리 제거), `InlineAlert` `closable`/`onClose`/`closeLabel`(action 슬롯 `IconButton` 흉내 교체, **9.9 표 위 알림에는 `closable` 주지 말 것**), `RelationTable` 그룹 행 `totalCount`(필터 중 `(3 / 11)`).
- 제약: :3000·:3001 종료·재시작 금지. lint·typecheck·vitest 재확인.

### 2. 참고한 문서

- `docs/reports/snapshot-3d/publisher.md` 2026-09-20 (3) 섹션(새 prop 3종과 결정 이유)
- `docs/design/snapshot-3d.md` 7.4(`notes[]` 자리)·8.3(그룹 행 개수)·9.5(저사양 알림 닫기)·**9.9**(표 위 알림은 닫기 없음)·6.1·8.2(개수 표기 기준)
- `docs/design/components.md` 6.2(`InlineAlert`)

### 3. 작업 내용

**① 번들 실측 환경 (`next.config.ts`)**

- `distDir: process.env.NEXT_DIST_DIR ?? ".next"` 를 추가했다. 환경 변수가 없으면 **`.next` 그대로**라 dev 서버·기존 스크립트·docker 동작이 바뀌지 않는다.
- `NEXT_DIST_DIR=.next-build npx next build` 로 프로덕션 빌드 → `NEXT_DIST_DIR=.next-build npx next start -p 3456`(3000·3001·3002 회피)으로 띄우고, **헤드리스 Chrome(CDP `Network` 도메인)** 으로 라우트를 돌며 **실제로 내려받은 JS 전송량**을 셌다.
  - Next 16(Turbopack)은 빌드 로그에 First Load JS 표를 찍지 않아 브라우저 실측으로 대신했다. "브라우저 네트워크에 3D 청크 요청이 없다"는 AC-3D01 문구를 **직접** 확인하는 방법이기도 하다.
  - :3456 origin 은 API(:3001) CORS 허용 목록에 없어 화면이 "API 연결 없음"으로 떨어졌다 → **측정용 크롬(일회용 프로필)에만** `--disable-web-security` 를 켜 실제 화면이 뜨는 상태로 쟀다. 서버 설정·남의 프로세스는 건드리지 않았다.
- 측정 뒤 `.next-build` 를 삭제하고, `apps/web/.gitignore`·`apps/web/eslint.config.mjs`(`globalIgnores`)에 `.next-build` 를 넣었다. `next build` 가 `tsconfig.json` `include` 에 자동으로 끼워 넣은 `.next-build/types/**` 두 줄도 **원래대로 되돌렸다**.
- 루트 `.gitignore` 는 `.next` 만 있어 `.next-build` 를 덮지 않지만, 내 영역인 `apps/web/.gitignore` 가 `/.next-build/` 를 무시하므로 **루트 수정은 필요 없다**.

**② publisher 새 prop 반영**

- `NOTE_SPEC` 3종(`selector_missing`·`no_target`·`pvc_template_unmatched`, 아이콘 `unlink`)이 등록돼 내 임시 처리(등록 안 된 code → `info` 아이콘)가 사라졌다. 대신 **같은 문구가 한 화면에 두 번 나오지 않게** `markerSource` 의 `variant` 를 3단으로 나눴다(디자인 7.4).
  - `overlay`(블록 위 원) = 표시 문구 없음
  - `panel`(선택 패널 ③ 칩) = 성질 문구만(`custom_resource` 등). 관계를 못 그린 사유는 ④ `InlineAlert` 가 맡는다
  - `table`(관계 표 표식 열·판 알약) = 전부
- `InlineAlert` 의 닫기를 `action` 슬롯 `IconButton` 흉내에서 **`closable` + `onClose`** 로 교체했다(9.5 저사양 · 9.9 잘림).
- **9.9 "표 위 같은 알림"을 새로 넣었다**: 관계 표 위에 같은 잘림 `InlineAlert` 를 **닫기 없이** 그린다(표에는 정보 줄이 없어 다른 단서가 없다). 표 요약 뒤 `(N개 제외)` 는 이미 있었다.
- `RelationTable` 판 그룹 행에 `totalCount` 를 넘긴다. 다만 **필터를 건 상태에서만** 넘긴다 — 기본 켬 집합(K1~K7)이 K9 유령을 가리는 것은 "필터"로 세지 않기 때문이다(4.4). 기본 화면은 `(3)`, 필터 중에는 `(2 / 10)`. 분모는 정보 줄 `블록 33개 중 12개` 와 같은 기준(서버 전체 블록 수)을 쓴다.
- `GraphTab.tsx` 는 prettier(`--print-width 140`, 저장소 기존 줄 길이에 맞춤)로 한 번 정리했다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/next.config.ts` | 수정 | `distDir: process.env.NEXT_DIST_DIR ?? ".next"` (기본값 동일 → 기존 동작 불변) |
| `apps/web/.gitignore` | 수정 | `/.next-build/` 무시 |
| `apps/web/eslint.config.mjs` | 수정 | `globalIgnores` 에 `.next-build/**` |
| `apps/web/tsconfig.json` | 수정(원복) | `next build` 가 끼워 넣은 `.next-build/types/**` 제거 — 작업 전과 같은 내용 |
| `apps/web/src/features/k8s-snapshots/graph/model.ts` | 수정 | `markerSource` `variant: overlay \| panel \| table`, `TRAIT_NOTES`/`RELATION_NOTES` 분리 |
| `apps/web/src/features/k8s-snapshots/graph/view.tsx` | 수정 | 표 행은 `variant: "table"`, 판 행 `totalCount`(`TableContext.totalByPlate`) |
| `apps/web/src/features/k8s-snapshots/graph/GraphTab.tsx` | 수정 | 선택 패널 `variant: "panel"`, 알림 `closable`/`onClose`, **표 위 잘림 알림(닫기 없음)**, `totalByPlate`(필터 중에만) |

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 이유 |
|---|---|---|
| `distDir` 를 **환경 변수로만** 바꾸게 | `next.config.ts` 에 `.next-build` 고정 | 기본값이 `.next` 라 dev·CI·docker 동작이 전혀 바뀌지 않는다. 측정할 때만 `NEXT_DIST_DIR` 를 준다 |
| 측정을 **브라우저 실측**으로 | 빌드 매니페스트 합산 | Next 16 Turbopack 은 First Load JS 표를 찍지 않고, app router 클라이언트 청크 목록이 매니페스트에 그대로 있지 않다. AC-3D01 문구("브라우저 네트워크에 3D 청크 요청이 없다")를 직접 확인할 수 있다 |
| 측정 크롬에만 `--disable-web-security` | API CORS 에 :3456 추가(백엔드 영역) / :3000 점유 | 남의 영역·남의 프로세스를 건드리지 않는다. 일회용 프로필이라 사용자 브라우저와 무관하다 |
| `markerSource` 를 3단 `variant` 로 | `NOTE_SPEC` 추가분을 안 쓰기 | 표에서는 `셀렉터 없음` 이 표식 열에 있어야 하고(7.4), 패널에서는 ④ 알림과 ③ 칩에 **같은 말이 두 번** 나오면 안 된다. 자리마다 다른 규칙이 `variant` 하나로 표현된다 |
| `totalCount` 는 **필터 중에만** | 항상 `(보이는 수 / 전체)` | 기본 화면이 `(3 / 4)` 로 보이면 "무언가 걸러졌다"는 잘못된 신호를 준다. 기본 켬 집합은 `isFiltered()` 가 필터로 세지 않는다(4.4) |
| 분모 = **서버 전체 블록 수** | 규칙 필터만 적용한 수 | 정보 줄·표 요약의 `블록 33개 중 12개` 와 같은 기준이어야 한 화면 안에서 기준이 하나가 된다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `NEXT_DIST_DIR=.next-build npx next build` | **성공** (18 라우트) | dev 서버의 `.next` 와 충돌 없음. 측정 뒤 폴더 삭제 |
| `npm run lint --prefix apps/web` (인자 없이) | **통과 0 problems** | `.next-build` 삭제 + `eslint.config.mjs` 무시 추가로 5,933건(192 errors) → 0 |
| `npx tsc --noEmit -p apps/web` | **통과** | |
| `npm test --prefix apps/web` | **통과 20 파일 / 381 테스트** | publisher 가 늘린 12개 포함(369 → 381). 내 테스트 14개 그대로 통과 |
| 브라우저 재확인 | 스크린샷 16장 다시 촬영 | 표식 열 `unlink` 아이콘, 판 행 `(2 / 10)`(필터 중)·`(3)`(기본), 선택 패널 ④ `대상 없음` 한 번만 |

**라우트별 First Load JS 실측** (프로덕션 빌드 :3456, 캐시를 비우고 라우트 진입, 값은 **전송량**(gzip/br))

| 라우트 | JS 요청 수 | 전송량 | 3D 청크 포함? |
|---|---|---|---|
| `/` (개요) | 18 | **318.0 KB** | ❌ |
| `/cost` (비용) | 18 | **318.0 KB** (개요와 바이트 단위로 동일) | ❌ |
| `/snapshots/k8s` (목록) | 21 | **346.2 KB** | ❌ |
| `/snapshots/k8s/[id]` 파일 탭(기본) | 24 | **397.1 KB** | ❌ |
| └ 같은 화면에서 **[3D 보기] 탭 클릭** | +3 | **+144.8 KB** | ✅ 이때 처음 받는다 |
| `/snapshots/k8s/[id]?view=3d` (직접 진입) | 27 | **541.9 KB** (= 397.1 + 144.8) | ✅ |
| `/snapshots/k8s/[id]?view=3d&gview=table` (관계 표) | 26 | **410.2 KB** (= 397.1 + 13.1) | ❌ **three.js 없이 동작** |

3D 탭을 열 때 새로 받는 청크 3개(`.next-build/static/chunks`):

| 청크 | raw | gzip | 내용 |
|---|---|---|---|
| `0fciwdjhy4d7_.js` | 519 KB | **130 KB** | **3D 청크** — three.js + `engine.ts`·`SceneCanvas`·`colors`·`layout` (`WebGLRenderer` 가 든 **유일한** 청크) |
| `30il-4wei42xy.js` | 31 KB | **12 KB** | 3D 탭 청크 — `GraphTab`·`model`·`view`·`useGraph`·`store` |
| `126dxtoc2z7dl.js` | 0.6 KB | 0.6 KB | 동적 import 보조 |

**AC-3D01·02 판정**

- **AC-3D02 ✅** — 3D 청크 **130 KB gzip**(전송 131.7 KB). 한도 300 KB 의 43%. 앞서 rolldown 으로 낸 추정 129.9 KB 와 일치.
- **AC-3D01 ✅(요청 0건)** — `/`·`/cost`·`/snapshots/k8s`·상세 파일 탭 어디에도 3D 청크 요청이 **0건**이다. `grep -l WebGLRenderer` 로도 three.js 가 든 청크는 하나뿐임을 확인했다.
- **"다른 페이지 첫 로딩 +5 KB gzip 이하"** — 이 기능 이전 빌드가 저장소에 없어(버전 관리 없음) before/after 직접 비교는 못 했다. 대신 **비3D 라우트에서 새로 도달 가능한 모듈**을 하나씩 재서 합산했다.
  - `/`·`/cost` 등 k8s 상세를 import 하지 않는 라우트: 새 모듈 **0개 → +0 KB**(두 라우트의 전송량이 바이트 단위로 같은 것으로도 확인).
  - `/snapshots/k8s`(목록)·상세: `hooks.ts` 가 쓰는 `graph/query.ts` 하나뿐 — **0.4 KB gzip**(rolldown 측정). 실제로 `gdrift` 문자열이 든 청크는 3D 탭 청크와 k8s-snapshots 공용 훅 청크뿐이었다.
  - 상세 라우트는 여기에 `GraphTabLazy` 동적 스텁 **0.3 KB gzip** 이 더해져 **합계 ≈ +0.7 KB gzip** → 한도 5 KB 이내.
  - (`드리프트 겹쳐 보기` 문구가 든 다른 청크 하나는 `/dev/ui` 미리보기 전용이라 제품 라우트에 오지 않는다.)

### 7. 남은 이슈·한계

- 앞 섹션 7번의 남은 이슈(**AC-3D22 3D 묶어 보기 미구현**, AC-3D19·21 실측, 저사양 흉내 설정, 범례 가림, 종류 아이콘 없음, 블록 라벨 겹침, 표식 원 위치)는 **그대로**다.
- "이 기능 전" 빌드와의 직접 비교는 여전히 불가(저장소에 버전 관리가 없어 되돌린 빌드를 만들 수 없다). 위 +0.7 KB 는 **새로 도달 가능한 모듈을 하나씩 측정해 합산한 값**이다.
- `--disable-web-security` 는 **측정용 크롬 일회용 프로필에만** 썼다. 제품 동작·설정과 무관하다.
- 관계 표 보기의 범례(디자인 6.5 마지막 줄)는 여전히 없다.

### 8. 다른 담당 요청

- **PM 요청**: 이번 두 건은 모두 처리했다. 앞 섹션의 PM 요청 중 **AC-3D19·21 실장비 측정**만 남았다.
- **퍼블리셔 요청**: 앞 섹션 3건 모두 반영됐음을 확인했다. 새 요청 없음. 참고로 `(3 / 11)` 의 전체 수는 **필터를 건 상태에서만** 넘긴다(기본 화면은 `(3)`).
- **디자이너 요청**: 앞 섹션 4건 그대로(카메라 기본 거리 문구, 범례 위치·기본 접힘, 종류 아이콘 표, 표식 원 위치). 추가로 **9.9 "표 위 알림"의 설명 문구**를 3D 쪽과 한 군데 바꿔 썼다(`표 보기도 같은 범위입니다` → 표에서는 `3D 보기도 같은 범위입니다`). 문구표에 확정해 주세요.

### 9. 다음 담당이 알아야 할 점

- 번들을 다시 재려면: `cd apps/web && NEXT_DIST_DIR=.next-build npx next build` → `NEXT_DIST_DIR=.next-build npx next start -p <빈 포트>` → 브라우저로 라우트별 JS 전송량. **끝나면 `.next-build` 를 지운다**(lint 가 그 폴더까지 검사하면 수천 건이 난다 — 지금은 `eslint.config.mjs` 가 무시한다).
- `next build` 는 `tsconfig.json` `include` 에 `<distDir>/types/**` 를 자동으로 덧붙인다. `.next-build` 로 빌드했다면 **그 두 줄을 지워야** 원래 상태다.
- `markerSource(..., { variant })` 를 빠뜨리면 기본값이 `table` 이라 선택 패널 ③ 칩과 ④ 알림에 같은 문구가 두 번 나온다. 패널에서는 반드시 `variant: "panel"`.
- 판 그룹 행 `totalCount` 는 `filteredNow` 일 때만 채운다. 항상 채우면 기본 화면이 `(3 / 4)` 로 보여 "필터 걸림"으로 오해된다.

---

## 2026-09-20 (3) · 디자인 보완 반영 (카메라 4.9 · 라벨 겹침 4.7.1 · 범례 팝오버 · KindIcon) + 테스트 안정화

### 1. 요청 내용

- PM 요청(designer 2026-09-20 (3) 8절 frontend 요청 1~9 + publisher 새 prop):
  1. **카메라 4.9 재구현** — "대각선 × 1.25" 폐기. 안전 영역(왼 12 / 위 44~88 / 오른 116 / 아래 12px), `d_fit`·`d_read` → `d0 = clamp(min(d_fit × 1.06, d_read), 36u, 대각선 × 3)`. **대상 = bbox 3D 중심**, 장면 중심을 안전 영역 중심에 맞춤(자가 점검 ±4px). 충돌하면 읽기 우선 + 칩 `일부가 화면 밖`.
  2. **블록 라벨 겹침 4.7.1** — 우선순위 점수 → B0~B3 사다리(`g` 96/64/40px) → 8×8px 격자 점유 → 숨김 + 칩 `라벨 N개 숨김`·`표식 N개 숨김`.
  3. 층 간격 9u → **10u**, 안개를 카메라 거리 기준으로, 표식 원은 라벨 상자 맨 윗줄 가운데.
  4. **범례를 캔버스 밖 Popover 로**(`Scene3DFrame.legend`·`SceneLegend.collapsed` deprecated). 저장 키 `sentinel.snapshots.k8s.legendSeen`, 옛 키는 읽지 않는다. 표 보기에서도 같은 버튼.
  5. **`KindIcon` 사용**(4.10 표 복제 금지) — 표·패널에 `kind`·`custom`, 판 그룹 행은 `plateKind`.
  6. 정보 줄 칩 3개, 그룹 행 `totalCount`, 짧은 문구 2곳.
  7. 닫을 수 있는 알림 2종에 `closeLabel`(9.5 `3D 속도 안내 닫기` / 9.9 `일부만 표시 안내 닫기`), `live` 는 **9.4·9.5·9.8 에만**.
  8. `.next-build` 정리(삭제 + `.gitignore`·`eslint.config.mjs` 무시) — 앞 섹션에서 처리.
  9. **`aws-snapshots/pages.test.tsx` "커밋 금지 상태로 저장" 플레이크**를 시간 제한이 아니라 경쟁 조건으로 보고 안정화. 전체 vitest 3회 연속 통과 확인.
- 제약: :3000·:3001 종료·재시작·`next build` 금지. **prettier 를 돌리지 말 것**(저장소에 설정이 없어 printWidth 80 으로 재정렬된다).

### 2. 참고한 문서

- `docs/design/snapshot-3d.md` — **4.9 「기본 거리 맞춤」**(안전 영역·`d_fit`/`d_read`·중심 맞추기·자가 점검·다시 맞추는 때), **4.7.1 블록 라벨 겹침**(①~④), 4.2 층 간격, 4.10 종류 아이콘, 5.3 안개, 6.4 정보 줄 칩, 6.5 범례 팝오버, 2.3 `legendSeen`, 7.4 짧은 문구
- `docs/reports/snapshot-3d/designer.md` 2026-09-20 (3) 8절, `docs/reports/snapshot-3d/publisher.md` 2026-09-20 (3)

### 3. 작업 내용

**① 카메라 (engine.ts `fitCamera`·`safeArea`·`sceneBounds`·`fitCheck`)**

- `대각선 × 1.25` 를 지우고 설계 수식을 그대로 옮겼다. `sceneBounds()` 는 판 + 블록 기하만 쓰고(2D 라벨 제외), **대상은 bbox 3D 중심**이다 — 바닥면 중심을 쓰던 것이 "장면이 아래로 몰리는" 원인이었다.
- 기본 시점 카메라 축(right·up·forward)으로 bbox 반지름 `r_x·r_y·r_z` 를 구해 `d_fit = max(r_x/tanX, r_y/tanY) + r_z`, `d_read = h / (2·tan(17.5°)·4)`, `d0 = clamp(min(d_fit×1.06, d_read), 36u, 대각선×3)`.
- 그다음 장면 중심의 투영점이 **안전 영역 중심**에 오도록 화면 축으로 민다(`pan`).
- `d_read` 상한에 걸리면 `onOffscreen(true)` → 정보 줄 칩 `일부가 화면 밖`.
- 자가 점검용 `fitCheck()`(투영 사각형 중심과 안전 영역 중심의 `dx`·`dy`, `inside`, `offscreen`)를 엔진과 `SceneCanvasHandle` 에 노출했다.
- 안전 영역 값은 GraphTab 이 `insets={{ left: 12, right: 116, top: 44, bottom: 12 }}` 로 준다(범례가 캔버스 밖으로 나가 왼쪽이 184 → 12px).

**② 블록 라벨 겹침 (engine.ts `layoutLabels`)**

- 4.7.1 그대로 4단계: ① 점수(선택 1000 / hover 900 / 검색 800 / 스캔 오류 700 / 그 밖 표식 600 / 이웃 500 / 나머지 `400 × (1 − 거리/최대거리)`) → ② 이웃 간격 `g`(96px 격자 해시로 최근접 탐색)로 **B0~B3** → ③ **8 × 8px 격자 점유**(판 라벨이 먼저 점유) → ④ 그래도 겹치면 숨김.
- 점수 800 이상(선택·hover·검색)은 단계와 무관하게 B0.
- 단계는 `onLabelLayout` 으로 React 에 올라가 `renderBlockLabel(id, step)` 이 상자 내용을 바꾼다. 버리는 순서는 **보조 줄 → 이름 → 표식**이고, B3 에서 표식이 없으면 종류 아이콘만 남긴다.
- 숨긴 수는 `라벨 N개 숨김`·`표식 N개 숨김` 칩으로 반드시 말한다(표 보기로 가는 링크 포함).
- 재계산은 판 라벨과 같은 **250ms** 주기다. 프레임마다 하지 않는다. 난수가 없어 같은 카메라면 결과가 같다.

**③ 층 간격·안개·아이콘**

- `layout.ts` `U.layerGap` 9 → **10u**(표식이 라벨 위로 올라가 오버레이가 최대 56px). 단위 테스트를 상수 기준으로 고쳤다.
- 안개를 **카메라 거리 기준**으로 바꿨다: `near = 거리 + 대각선 × 0.25`, `far = 거리 + 대각선 × 1.1`(저사양이면 0.8). 매 프레임 `Fog` 객체를 새로 만들지 않고 값만 고친다.
- 종류 아이콘은 `KindIcon` 에 `kind`·`custom` 만 넘긴다(4.10 표를 프론트에 복제하지 않음). 판 그룹 행은 `plateKind`. 선택 패널은 `custom` 을 함께 넘긴다.

**④ 범례·알림**

- 범례를 도구 막대 B 의 `범례` 버튼 + `Popover`(280px, `align="end"`, `maxHeight`)로 옮기고 `Scene3DFrame` 에 `legend` 를 넘기지 않는다. **표 보기에서도 같은 버튼**이다.
- `sentinel.snapshots.k8s.legendSeen` 을 새로 두고(옛 키는 읽지 않음) 한 번도 열지 않았으면 버튼에 8px 점을 보인다.
- 범례가 캔버스에서 빠진 만큼 정보 줄 `circle-help` 툴팁에 `블록 색은 층을 뜻합니다. 상태가 아닙니다.` 를 붙였다(6.4-9).
- 닫을 수 있는 알림 2종에 `closeLabel` 을 주고, `live` 는 9.5 저사양·9.8 구성 변경에만 줬다(9.3·9.9 에는 주지 않음).

**⑤ 테스트 안정화 (`aws-snapshots/pages.test.tsx`)**

- 원인으로 본 것은 **시간 제한이 아니라 두 가지 경쟁 조건**이다.
  1. `커밋 금지 상태로 저장` 버튼은 `POST …/check` 응답이 그리는데 `getByRole` 로 **즉시** 찾고 있었다 → `findByRole` 로 바꿔 나타날 때까지 기다린다.
  2. 그다음 `waitFor(putBody 정의됨)` → `findByText(재스캔 …)` 로 **폴링을 두 번** 기다렸다. 전체 실행 부하에서는 앞의 `waitFor` 가 먼저 제한에 걸린다. 화면 결과(`재스캔: 오류 2 → 1, 경고 1 → 1`)를 **한 번만** 기다린 뒤 기록해 둔 `putBody` 를 확인하도록 순서를 바꿨다(PUT 이 끝나야 그 문구가 그려지므로 검사 강도는 같다).
- 가짜 타이머는 이 파일에서 쓰지 않는다(쓰는 곳은 k8s `pages.test.tsx` 의 임대 테스트뿐이고 `afterEach` 에서 `useRealTimers` 로 되돌린다). `configure({ asyncUtilTimeout: 3000 })` 는 그대로 뒀다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | 4.9 `fitCamera`·`safeArea`·`sceneBounds`·`fitCheck`·`zoomToFitAll`, 4.7.1 `layoutLabels`, 안개 카메라 기준, `onLabelLayout`·`onOffscreen` 콜백 |
| `apps/web/src/features/k8s-snapshots/graph/scene/SceneCanvas.tsx` | 수정 | `labels`(점수·표식 수·이름 유무), `renderBlockLabel(id, step)`, `onLabelOverflow`·`onOffscreen`, `fitCheck`·`zoomToFitAll` 핸들 |
| `apps/web/src/features/k8s-snapshots/graph/layout.ts` | 수정 | 층 간격 9u → 10u |
| `apps/web/src/features/k8s-snapshots/graph/model.ts` | 수정 | 보조 줄은 `NOTE_SPEC` 짧은 문구(전문은 툴팁·패널 ④) |
| `apps/web/src/features/k8s-snapshots/graph/view.tsx` | 수정 | `kindIcon` 대신 `kind`·`custom`, 판 행 `plateKind` |
| `apps/web/src/features/k8s-snapshots/graph/store.ts` | 수정 | `legendSeenStore`(옛 키 안 읽음) |
| `apps/web/src/features/k8s-snapshots/graph/GraphTab.tsx` | 수정 | 범례 Popover·`legendSeen` 점, 안전 영역 insets, B0~B3 라벨 렌더, 정보 줄 칩 3개, `closeLabel`·`live`, 안내 툴팁 2줄 |
| `apps/web/src/features/k8s-snapshots/graph/graph.module.css` | 수정 | 단계별 이름 폭, B3 종류 아이콘, 범례 버튼 점 |
| `apps/web/src/features/k8s-snapshots/graph/model.test.ts` | 수정 | 층 간격을 상수 기준으로 |
| `apps/web/src/features/aws-snapshots/pages.test.tsx` | 수정 | 확인 버튼 `findByRole`, 결과를 한 번만 기다린 뒤 본문 검사 |

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 이유 |
|---|---|---|
| 라벨 단계 계산은 **엔진**, 내용은 **React** | 전부 React / 전부 엔진 | `g`·격자 점유는 카메라가 있어야 알고, 상자 내용은 publisher 컴포넌트다. 250ms 주기로 단계만 올려 리렌더를 최소화했다 |
| 단계별 상자 크기를 **상수표**로 고정 | 실제 DOM 크기 측정 | 측정하면 레이아웃 → 계산 → 리렌더가 물려 프레임마다 흔들린다. 고정 크기라 격자 점유 결과가 결정적이다 |
| B3 에서 표식이 없으면 **종류 아이콘**만 그린다 | 아무것도 그리지 않는다 | 4.7.1 은 "윗면 종류 아이콘이 남으므로 종류를 알 수 있다"를 전제로 하는데, 윗면 아이콘(3D 텍스처)은 아직 없다. 오버레이에 12px 아이콘을 남겨 같은 정보를 준다(7절에 한계로 적었다) |
| `d_read` 상한을 **그대로** 지킨다 | 화면에 다 담기게 더 멀리 | 설계가 "읽기 우선"으로 정했다. 대신 `일부가 화면 밖` 칩으로 사실을 말한다. 1024px 에서는 판이 잘려 나가므로 디자이너에게 다시 물었다(8절) |
| 테스트를 **대기 순서 정리**로 고침 | 제한 시간을 더 늘린다 | 제한을 늘리는 것은 증상만 미룬다. 실제 문제는 ① 아직 안 그려진 버튼을 `getBy*` 로 찾은 것 ② 폴링 두 번을 이어 기다린 것이었다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** | `.next-build` 삭제·무시 반영 상태 |
| `npx tsc --noEmit -p apps/web` | **통과** | |
| `npm test --prefix apps/web` **3회 연속** | **모두 통과 20 파일 / 397 테스트** | publisher 가 같은 시간대에 컴포넌트·테스트를 늘려 397개(이전 381)로 늘었다. aws 저장 흐름 플레이크 재현 없음 |
| `next build` | 돌리지 않음 | 번들 수치는 앞 섹션의 `NEXT_DIST_DIR` 측정값 그대로(이번 변경은 3D 청크 안쪽이라 청크 경계가 바뀌지 않는다) |
| 브라우저 확인 | `shots-3d/after/scene-{1024,1440}-{light,dark}.png` + 주요 16장 다시 촬영 | 아래 |

**화면으로 확인한 것**

- **카메라**: 장면이 안전 영역 가운데에 오고 아래로 몰리지 않는다. 판이 커져 블록·판 이름이 읽힌다(이전에는 캔버스 아래쪽 1/3에 작게 몰려 있었다).
- **범례**: 캔버스에서 사라지고 도구 막대 B `범례` 버튼(첫 방문 파란 점)으로 열린다. 가려져 있던 `prod`·`batch` 판이 보인다.
- **라벨 겹침**: 붐비는 판에서 이름이 서로 겹쳐 뭉개지던 것이 사라지고, 정보 줄에 `라벨 17개 숨김`·`표식 6개 숨김`·`일부가 화면 밖` 칩이 뜬다. 선택하면 그 블록만 B0(전체 이름)로 살아난다.
- **종류 아이콘**: 블록 오버레이·선택 패널·관계 표에 `KindIcon` 이 나온다(`Deployment` boxes, `StatefulSet` database, `Service` network …).

### 7. 남은 이슈·한계

- **AC-3D22 3D 묶어 보기**는 여전히 미구현(1단계 보고 그대로). 설계 9.7 은 바뀌지 않았다.
- **블록 윗면 종류 아이콘(4.3·4.10)은 아직 3D 로 그리지 않는다.** 아이콘 아틀라스 텍스처가 필요하다. 대신 오버레이 상자(B3 포함)에 12px 아이콘을 둔다.
- **기본 화면에서 이름이 거의 보이지 않는다.** 기준 장면에서 이웃 간격 `g` 가 24~30px 이라 4.7.1 사다리가 대부분 **B3**(표식만)로 내린다. 설계가 의도한 동작이고(`이름 전체는 확대·선택·표 보기에서`) 칩으로 알리지만, 첫인상이 "이름 없는 블록 더미"다 — 디자이너 확인 요청(8절).
- **1024px 에서 `d_read` 상한 때문에 판 일부가 캔버스 밖으로 나간다**(칩으로 알림). 좁은 캔버스에서 "읽기 우선"의 부작용이라 디자이너 확인이 필요하다.
- `일부가 화면 밖` 칩을 **누르면 축소**하는 동작(4.9-2)은 못 붙였다. `SceneInfoItem` 에 `onClick` 이 없다(퍼블리셔 요청). 엔진에는 `zoomToFitAll()` 을 만들어 뒀다.
- 자가 점검(±4px)은 `fitCheck()` 로 **읽을 수만** 있고 자동 테스트로 걸지 못했다(jsdom 에 WebGL 이 없어 엔진을 단위 테스트로 띄울 수 없다).
- AC-3D19·21 실장비 측정은 여전히 남아 있다.

### 8. 다른 담당 요청

- **퍼블리셔 요청**
  1. `SceneInfoItem` 에 **`onClick`** 을 넣어 주세요. 4.9-2 의 `일부가 화면 밖` 칩은 누르면 카메라를 한 번 축소해야 하는데 지금은 `href` 만 있어 동작을 붙일 수 없습니다(엔진 쪽 `zoomToFitAll()` 은 준비돼 있습니다).
  2. 9.4 데이터 오류 알림(`Scene3DFrame` 안의 `tone="crit"` `InlineAlert`)에 **`live`** 를 주세요. 디자이너가 `live` 를 9.4·9.5·9.8 에 주라고 확정했는데 9.4 는 컴포넌트 안에 있어 제가 줄 수 없습니다.
- **디자이너 요청**
  1. **기본 화면에서 블록 이름이 거의 보이지 않습니다**(7절). 4.7.1 사다리가 기준 장면에서 대부분 B3 로 내려갑니다. ① `g` 임계값을 낮추거나(예: B2 를 `28 ≤ g < 64`) ② 이름 최대 폭을 줄여 B2 를 더 오래 유지하거나 ③ 이대로 두고 "이름은 확대·선택에서"를 안내로 명시하거나 — 어느 쪽인지 정해 주세요.
  2. **1024px 에서 `d_read` 상한으로 판이 잘립니다.** 좁은 캔버스에서는 `d_read` 를 조금 완화(블록 한 변 12px)하는 안을 검토해 주세요.
  3. 블록 **윗면 종류 아이콘**은 아이콘 아틀라스가 필요해 이번에도 못 넣었습니다. 오버레이 12px 아이콘으로 대신해도 되는지 확인 부탁드립니다.
- **PM 요청**: AC-3D19·21(실장비 fps·힙) 측정만 남았습니다. 3D 보기에서 회전 5초 뒤 `frameStats()`·`fitCheck()` 를 읽으면 됩니다.

### 9. 다음 담당이 알아야 할 점

- 카메라를 **다시 맞추는 때**는 4.9-4 표대로 넷뿐이다: 첫 진입 · `0`/`⤢` · [다시 배치] · 스냅샷 ID 변경. 필터·검색·선택·라벨 밀도·창 크기에서는 맞추지 않는다(자리 기억).
- `layoutLabels()` 는 250ms 주기다. 값이 바뀔 때만 React 에 올린다 — 여기에 프레임마다 도는 계산을 넣지 말 것.
- 종류 아이콘 표는 `components/ui/viz/KindIcon.tsx` **한 곳**에만 있다. `graph/` 어디에도 복제하지 않는다(JSX 를 못 쓰는 자리에서는 `kindIconName()`/`plateIconName()`).
- 범례는 `Scene3DFrame` 슬롯이 아니라 도구 막대 B 의 `Popover` 다. 저장 키는 `legendSeen` 뿐이고 옛 `…legend` 키는 읽지 않는다.
- `aws-snapshots/pages.test.tsx` 의 저장 흐름은 **화면 결과를 기다린 뒤 요청 본문을 검사**한다. 순서를 되돌리면(본문 폴링 → 화면 폴링) 전체 실행 부하에서 다시 플레이크가 난다.
- 이 저장소에는 prettier 설정이 없다. **`npx prettier` 를 돌리지 말 것**(기본 printWidth 80 으로 파일 전체가 재정렬된다).

---

## 2026-09-20 (4) · designer 실측 재조정 반영 (배치 상수 · 카메라 · B0~B4) + 실측 보고

### 1. 요청 내용

- PM 요청(designer 2026-09-20 (5) — 원인: 임계값 96/64/40px 이 도달 불가, 위 여백은 판 4열 배치 · `d_fit` 18% 과다 · 정보 줄 2줄이 겹친 결과):
  1. `graph/layout.ts` 상수 — 층 간격 **12u**, 판 한 줄 **3장**, 판/줄 간격 **8u**, 판 여백 **2u**, 최소 판 **14u**, 곁 띠는 곁 리소스가 있는 판만
  2. `engine.ts fitCamera` — **모서리별 `d_fit`**, `s_min` 16px / 13px(캔버스 높이 < 600), 원근 보정 + **2회 반복** 중심 맞추기, `fitCheck()` 에 `fillX`·`fillY`
  3. `engine.ts layoutLabels` — 사다리 **B0~B4 = 72/48/28/18px**, 상자 폭 136/104/76/52/20, 이름 폭 120/88/60/36, 폰트 11px·이름 한 줄, **위로 밀어 올리기(8px × 최대 4칸 + 1px 지시선)를 단계 내리기보다 먼저**, 숨김 기준 "먼 쪽" → **"점수 낮은 쪽"**, hover 는 이웃까지 B0, 600점 이상은 최소 B2
  4. 오버레이 이름 줄 앞 `KindIcon` 12px(B4 는 아이콘만). **3D 윗면 아이콘·아틀라스는 만들지 않는다**
  5. 정보 줄 **한 줄 고정**(`insets.top` 항상 44), 칩 3개에 `onClick`, `일부가 화면 밖` → `zoomToFitAll()`
  6. 9.9 문구 두 벌
- 수용 기준(designer 신설): 이름 보이는 블록 **≥ 80%**, 표식 있는 블록 **100%**, `표식 숨김` 칩 **0**. **못 맞춰도 임계값을 임의로 더 내리지 말고 실측만 보고**.
- 제약: :3000·:3001 종료·재시작·`next build` 금지, prettier 금지.

### 2. 참고한 문서

- `docs/design/snapshot-3d.md` 4.0(px 환산 전제) · 4.1(판 배치 근거) · 4.2(층 12u) · 4.3 · **4.7.1 전면 개정** · **4.9 기본 거리 맞춤** · 4.10 · 6.4(정보 줄 한 줄·칩 동작 표) · 9.4 · 9.9 · 12절(좁은 캔버스 완화)
- `docs/reports/snapshot-3d/designer.md` 2026-09-20 (5) — 특히 ①의 투영 상수(x 0.868u · z 0.705u · y 0.866u)와 "임계값이 도달 불가였다"는 계산

### 3. 작업 내용

- **배치 상수**(`layout.ts`): 층 12u · 한 줄 3장 · 간격 8u · 여백 2u · 최소 판 14u, **곁 띠는 곁 리소스가 있는 판만** 차지하도록 크기 계산을 고쳤다. 셀(6u)은 그대로 뒀다(설계 근거대로 — 셀을 키우면 판도 커져 화면상 간격은 그대로다).
- **카메라**(`engine.ts`): `d_fit` 을 **8 모서리별** `max(|sx|/tanX + sz, |sy|/tanY + sz)` 로 바꾸고, `d_read` 의 `s_min` 을 캔버스 높이별 16px / 13px 로 나눴다. 중심 맞추기는 **원근 그대로 투영한 사각형**의 중심을 안전 영역 중심에 맞추며 **2회 반복**한다. `fitCheck()` 가 `dx`·`dy`·`fillX`·`fillY`·`inside`·`offscreen` 을 돌려준다. `focusBlock()` 도 안전 영역 가운데로 맞춘다.
- **라벨**(`engine.ts layoutLabels`): 5단계 사다리(72/48/28/18px), 상자 136/104/76/52/20, **위로 밀어 올리기**(8px × 4칸, 올린 상자에는 1px 지시선)를 단계 내리기보다 먼저, hover 는 **이어진 이웃까지** B0, 표식 블록 최소 B2 · 선택 이웃 최소 B3, 숨김은 **점수 낮은 쪽**, `라벨 N개 숨김` 은 **이름 글자가 하나도 없는 블록(B4 + 완전 숨김)** 을 센다.
- **표식은 지우지 않는다**: B4 까지 내려가도 자리가 없으면 **겹치더라도 그린다**(이름만 잃는다). 임계값은 건드리지 않았고, "표식은 마지막까지 남는다"(1절)를 지키기 위한 규칙 변경이다 → `표식 N개 숨김` 실측 **0**.
- **오버레이**: 이름 줄 맨 앞에 `KindIcon` 12px(B4 는 아이콘만). **3D 윗면 아이콘·아틀라스는 만들지 않았다.**
- **정보 줄**: `insets.top` 44 고정, 칩이 6개를 넘으면 뒤쪽을 `+N` 하나로 합쳐 한 줄을 지킨다. 칩 3개에 `onClick`·`actionLabel`(publisher prop 도착 전이라 타입만 확장해 미리 넘긴다), `일부가 화면 밖` → `zoomToFitAll()`.
- **측정 훅**: 캔버스가 뜨면 `window.__sentinel3d = { fitCheck, labelStats, frameStats }` 를 걸고 언마운트에서 지운다(화면 동작에는 쓰지 않는다. AC-3D19·21 실장비 측정에도 그대로 쓸 수 있다).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/layout.ts` | 수정 | 배치 상수 6개, 곁 띠 조건부 |
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | 모서리별 `d_fit`·`s_min` 2단계·2회 반복 중심 맞추기·`fitCheck(fillX/fillY)`·`fitAllDistance`, B0~B4 사다리·밀어 올리기·점수 기준 숨김·`labelStats()`, `focusBlock` 안전 영역 정렬 |
| `apps/web/src/features/k8s-snapshots/graph/scene/SceneCanvas.tsx` | 수정 | `LabelStep`, 측정 훅 등록·해제 |
| `apps/web/src/features/k8s-snapshots/graph/scene/scene.module.css` | 수정 | 밀어 올린 상자의 1px 지시선 |
| `apps/web/src/features/k8s-snapshots/graph/GraphTab.tsx` | 수정 | B0~B4 렌더·`KindIcon` 이름 줄, 정보 줄 한 줄(`+N`)·칩 `onClick`, 핸들을 상태로(렌더 중 ref 접근 금지) |
| `apps/web/src/features/k8s-snapshots/graph/graph.module.css` | 수정 | 이름 줄 상자·단계별 이름 폭 |
| `apps/web/src/features/k8s-snapshots/graph/model.test.ts` | 수정 | 층 간격을 상수 기준으로 |

### 5. 실측 (요청 항목)

기준 장면 **mock K-1 `20260919-061000`**, 1440 × 900 뷰포트 / **캔버스 766 × 576px** / 안전 영역 **638 × 520px**(왼 12 · 위 44 · 오른 116 · 아래 12).

| 항목 | 실측 | 기대 | 판정 |
|---|---|---|---|
| `fitCheck().dx` | **0.15px** | ±4px | ✅ |
| `fitCheck().dy` | **0.02px** | ±4px | ✅ |
| `fitCheck().fillX` | **0.844** | `max(fillX,fillY) ≥ 0.90` | ❌ |
| `fitCheck().fillY` | **0.779** | ≥ 0.70 | ✅ |
| `offscreen`(`일부가 화면 밖` 칩) | **false** | 사라질 것 | ✅ |
| 이름이 보이는 블록 | **9 / 27 (33%)** | ≥ 80% (22/27) | ❌ |
| 표식이 있는 블록 | **27/27 중 표식 블록 100% 표시** | 100% | ✅ |
| `표식 N개 숨김` 칩 | **0** | 0 | ✅ |
| `라벨 N개 숨김` 칩 | **19** (1024px 에서는 23) | ≤ 5 | ❌ |
| 이웃 간격 `g` | **최소 21 · 중앙값 39 · 최대 59px** | designer 예측 24~60 | ✅ 일치 |
| 단계 분포(그려진 16개) | B0 1 · B1 2 · B2 6 · B4 7 (+ 11개 완전 숨김) | — | — |
| **실제 판 크기** | **22u**(prod: 격자 12u + 2 × (여백 2 + 곁 띠 3)) | designer 가정 22u | ✅ 일치 |
| `px_per_u` | **≈ 5.0** | designer 예측 5.74 | 캔버스 높이가 636이 아니라 **576**이라 낮다 |

**못 맞춘 두 항목의 원인(임계값은 건드리지 않았다)**

1. **이름 33%·라벨 숨김 19** — 사다리 단계는 맞게 잡히는데(중앙값 `g` 39px → B2) **B2 상자 폭 76px 이 이웃 간격 39px 보다 넓다**. 그래서 격자 점유에서 이웃끼리 서로 막고, 밀어 올리기(최대 32px)로 구제되는 것 말고는 B4·숨김으로 내려간다. 상자 폭이 `g` 보다 커지는 구간에서는 이름이 구조적으로 못 들어간다.
2. **fillX 0.844** — `d0 = d_fit × 1.06` 의 6% 여유(≈ −6%)와, 8 모서리 중 "가장 멀리 밀어내는 모서리"가 투영 사각형의 폭을 정하는 모서리와 다르기 때문이다(`d_fit` 이 여전히 약간 보수적). `dx`·`dy` 는 0에 가까우므로 **치우침 문제는 해결**됐고 크기만 약 15% 작다.

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** |
| `npx tsc --noEmit -p apps/web` | **통과** |
| `npm test --prefix apps/web` | **통과 20 파일 / 404 테스트** |
| 스크린샷 | `shots-3d/after2/scene-{1024,1440}-{light,dark}.png` |
| `next build` | 돌리지 않음(:3000 유지). prettier 도 돌리지 않았다 |

**화면으로 확인한 것**: 장면이 이전보다 눈에 띄게 커졌고(판 22u · 3열) 위쪽 빈 띠가 사라졌다. `일부가 화면 밖` 칩이 없어졌다(1024px 에서도). 이름 앞에 종류 아이콘이 붙고, 겹치는 라벨은 위로 밀려 올라가 지시선으로 블록과 이어진다. `표식 N개 숨김` 칩은 더 이상 뜨지 않는다.

**작업 중 사고 하나(복구 완료)**: 일괄 치환 스크립트가 인덱스를 잘못 잡아 `engine.ts` 의 카메라 메서드 묶음(`setViewpoint`·`pan`·`zoom`·`moveTo` 등)이 지워졌다. 같은 세션에서 전부 복원했고 타입 검사·테스트로 확인했다(현재 1,282줄, 메서드 목록 이상 없음). 저장소에 버전 관리가 없어 되돌릴 수 없는 만큼, 앞으로 같은 파일에 인덱스 기반 치환을 쓸 때는 **구간 양 끝이 모두 뒤쪽인지** 먼저 확인해야 한다.

### 7. 남은 이슈·한계

- **이름 80% · 라벨 숨김 ≤ 5 를 못 맞췄다**(5절 원인). 임의로 임계값을 내리지 않았다.
- `fillX 0.844` 로 `max(fill) ≥ 0.90` 미달.
- **AC-3D22 3D 묶어 보기** 미구현(그대로).
- `SceneInfoItem.onClick`·`actionLabel` 은 publisher 도착 전이라 **타입만 확장해 미리 넘기고 있다**. 도착하면 그대로 동작하고, 그 전까지 칩은 클릭 동작 없이 문구만 보인다.
- 9.4 데이터 오류 알림의 `live` 는 `Scene3DFrame` 안이라 여전히 publisher 몫이다.
- AC-3D19·21 실장비 측정은 그대로 남아 있다(`window.__sentinel3d.frameStats()` 로 바로 읽을 수 있다).

### 8. 다른 담당 요청

- **디자이너 요청**
  1. **상자 폭이 이웃 간격보다 넓어 이름이 구조적으로 못 들어갑니다**(중앙값 `g` 39px vs B2 상자 76px). ① 단계별 상자 폭을 `g` 이하로 잡거나(예: B2 상자 = `min(76, g − 4)`) ② 이름을 블록 **오른쪽/왼쪽 번갈아 배치**해 가로로 비켜 가거나 ③ 밀어 올리기 한도를 늘리는(32 → 48px) 안 중 하나가 필요합니다. 실측 분포는 5절 표에 있습니다.
  2. `fillX 0.844`(목표 0.90). `d_fit` 의 6% 여유를 3%로 줄이거나, 투영 사각형 기준으로 한 번 더 조여도 되는지 확인 부탁드립니다.
  3. 캔버스 높이가 설계 가정(636px)이 아니라 **576px** 입니다(1440 × 900 기준). `px_per_u` 가 5.74 대신 5.0 이 되는 원인이라 4.0의 기준 장면 수치를 실제 값으로 맞출지 확인 부탁드립니다.
- **퍼블리셔 요청**: `SceneInfoItem.onClick`·`actionLabel`(진행 중으로 알고 있습니다)과 9.4 알림 `live` — 도착하면 추가 작업 없이 동작합니다.
- **PM 요청**: AC-3D19·21 실장비 측정.

### 9. 다음 담당이 알아야 할 점

- 측정은 3D 보기를 연 상태에서 콘솔에 `__sentinel3d.fitCheck()` / `__sentinel3d.labelStats()` / `__sentinel3d.frameStats()` 를 치면 된다(캔버스가 없으면 객체도 없다).
- 라벨 사다리·카메라 수치를 고칠 때는 **`layout.ts` 상수 → `engine.ts` 임계값** 순서로 본다. 상자 폭과 이웃 간격의 관계가 이름 노출률을 결정한다.
- 표식은 **어떤 경우에도 지우지 않는다**(자리가 없으면 겹쳐서라도 그린다). 이 규칙을 되돌리면 `표식 N개 숨김` 이 다시 생긴다.
- `engine.ts` 는 1,200줄이 넘는다. 부분 치환 스크립트를 쓸 때 **구간 끝 인덱스가 시작보다 뒤인지** 반드시 확인할 것(이번에 한 번 날렸다).

---

## 2026-09-20 (5) · designer 최종 조정 반영 (자리 후보 19개 · 몸체 점유 · 크기 조이기) + 실측

### 1. 요청 내용

- PM 요청(designer 2026-09-20 (6)):
  1. `layoutLabels` — **자리 후보 19개**(`n ∈ {0,8,…,48}` × `o ∈ {0, −o_max, +o_max}`, `o_max = max(0, 상자폭/2 − 12)` = B0 56 · B1 40 · B2 26 · B3 14 · B4 0, `n = 0` 은 `o = 0` 만). 순서 = `n` 오름차순 → 각 `n` 에서 `0 → −o_max → +o_max`. 19자리가 다 막히면 한 단계 내리고 다시. 밀어 올리기 한도 32 → **48px**(`n ≥ 8` 만 1px 지시선). **임계값(72/48/28/18)·상자·이름 폭은 그대로.**
  2. 점유 격자에 **모든 블록의 몸체 사각형**(앵커 중심, 한 변 `4u × px_per_u`, 자기 블록 제외).
  3. `fitCamera` — **`× 1.06` 제거**, **맞춤 영역 = 안전 영역에서 각 26px 안쪽**으로 `tanX/tanY`, 루프에 **크기 조이기** `k = max(R.w/W_f, R.h/H_f)` → `d = clamp(d × k, 36u, min(d_read, 대각선 × 3))`, 반복 **3회**, `fitCheck()` 에 **`fit`**(목표 0.98~1.02).
  4. `일부가 화면 밖` 칩 `onClick` = `d_read` 상한을 푼 맞춤 거리.
  5. 정보 줄 `+N` 은 **툴팁 전용**(탭 정지점 아님, `href`·`onClick` 없음).
  6. 3절 작업 영역 식(`100vh − 176px`) 검증 — 설계는 캔버스 636 기대, 실측 576.
- 수용 기준(하향 확정): 이름 **≥ 20/27(74%)**, `라벨 숨김` **≤ 7**, 표식 100% · `표식 숨김` 0, `fit` 0.98~1.02 · `fillX ≈ 0.92` · `|dx|,|dy| ≤ 4px`.
- 미달해도 임계값을 임의로 바꾸지 말고 숫자만 보고. `engine.ts` 에 인덱스 기반 일괄 치환 금지.

### 2. 참고한 문서

`docs/design/snapshot-3d.md` 3 · 4.0 · 4.7 · **4.7.1** · 4.8 · **4.9** · 6.4, `docs/reports/snapshot-3d/designer.md` 2026-09-20 (6).

### 3. 작업 내용

- **자리 후보 19개**(`engine.ts`): `LIFT_STEPS = [0,8,16,24,32,40,48]`, `offsetMax(boxWidth) = max(0, w/2 − 12)`. 같은 단계에서 19자리를 모두 시도한 **뒤에** 단계를 내린다. 좌우 비켜 간 거리는 `--shift` 로 넘겨 지시선이 **앵커 자리에** 서도록 CSS 를 고쳤다(`left: calc(50% - var(--shift))`). 지시선은 `n ≥ 8` 에서만 그린다.
- **몸체 사각형 점유**: 판 라벨 → **모든 블록 몸체**(앵커 중심, 한 변 `4u × px_per_u`) → 라벨 순으로 점유한다. 몸체 칸은 소유자를 기록해 **자기 블록에게는 막히지 않는다**(여러 블록이 겹친 칸은 `*` 로 두어 아무에게도 열어 주지 않는다).
- **카메라**: `× 1.06` 을 지우고 **맞춤 영역**(안전 영역 − 26px × 4변)으로 `tanX/tanY` 를 만든다. 루프는 **3회**이고 매 회 ① 투영 사각형 ② 크기 조이기 `d ← clamp(d × k, 36u, min(d_read, 대각선×3))` ③ 중심 맞추기 순서다. `fitCheck()` 가 `fit`(맞춤 영역 기준)·`fillX`·`fillY`·`dx`·`dy`·`inside`·`offscreen` 을 돌려준다.
- **`일부가 화면 밖` 칩**: `zoomToFitAll()` 이 **`d_read` 상한을 쓰지 않는** 맞춤 거리로 가고, 중심도 안전 영역에 맞춘다.
- **정보 줄 `+N`**: `href`·`onClick` 없이 `tooltip` 만 준다(탭 정지점 아님).
- **작업 영역 식 검증**(아래 5절 ⑦에 자세히): 식은 **맞다**. 카드 높이 실측 724px = `clamp(480, 900−176, 960)`. 캔버스가 576 이었던 것은 **도구 막대 A 가 두 줄로 접혀서**였다(실측 105px, 설계 48px). 관계·표식 필터를 **항상** `필터 ▾` 팝오버로 돌리고 검색 결과 이동(`SceneSearchNav`)을 **검색 중에만** 그리게 해서 도구 막대 A 를 한 줄로 되돌렸다 → 캔버스 **576 → 616px**.
- 조정용 통계(`labelStats().placement`)를 새로 붙였다: `atAnchor`·`lifted`·`shifted`·`downgraded`·`blocked[{id, gap, score}]`.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | 자리 후보 19개·몸체 점유·자리 통계, 맞춤 영역·크기 조이기 3회·`fit`, `zoomToFitAll` 상한 해제 |
| `apps/web/src/features/k8s-snapshots/graph/scene/scene.module.css` | 수정 | 지시선을 `--shift` 만큼 되돌려 앵커에 세움 |
| `apps/web/src/features/k8s-snapshots/graph/GraphTab.tsx` | 수정 | 관계·표식 필터 항상 팝오버, 검색 이동은 검색 중에만 (도구 막대 A 한 줄) |

### 5. 실측 (요청 항목 ①~⑥ + ⑦)

기준 장면 **mock K-1**, 1440 × 900, **카드 724px · 도구 막대 A 65px · B 41px · 캔버스 766 × 616px**, 안전 영역 638 × 560, 맞춤 영역 586 × 508.

**① 카메라 자가 점검**

| 항목 | 실측 | 기대 | 판정 |
|---|---|---|---|
| `dx` / `dy` | **−0.007px / −0.001px** | ≤ ±4px | ✅ |
| `fit` | **1.00001** | 0.98~1.02 | ✅ |
| `fillX` | **0.9185** | ≈ 0.92 | ✅ |
| `fillY` | **0.7856** | (참고) | — |
| `offscreen` | **false** (`일부가 화면 밖` 칩 없음) | — | ✅ |

**② 이름이 보이는 블록** — **5 / 27 (19%)** · 기준 ≥ 20/27(74%) **❌**
**③ 칩** — `라벨 22개 숨김`(기준 ≤ 7 **❌**) · `표식 N개 숨김` **0** ✅ · 표식 있는 블록 **100% 표시** ✅

**④ 자리 분포** (놓인 18개 기준)

| 자리 | 수 |
|---|---|
| `n = 0`(앵커 그대로) | **10** |
| `n ≥ 8`(밀어 올림) | **5** |
| `o ≠ 0`(좌우 비켜감) | **3** |

**⑤ 단계를 내려서 놓인 블록** — **10개**(시작 단계보다 낮은 단계에서 자리를 찾음)
**단계 분포**(그려진 18개): B1 1 · B2 3 · B3 1 · **B4 13**

**⑥ 19자리가 다 막힌 블록 — 18개** (그중 표식이 있는 6개는 겹쳐서라도 그렸고, 12개는 숨겼다)

| id | `g` | 점수 |
|---|---|---|
| `core/ConfigMap/data/postgres-config` | 23 | 600 |
| `ghost:core/Secret/data/postgres-credentials` | 23 | 600 |
| `apps/Deployment/prod/api` | 18 | 600 |
| `ghost:apps/Deployment/prod/payments` | 18 | 600 |
| `core/ConfigMap/prod/api-config` | 25 | 600 |
| `ghost:core/Secret/prod/api-db-credentials` | 25 | 600 |
| `apps/Deployment/batch/report-generator` | 34 | 196 |
| `core/Service/data/postgres` | 53 | 196 |
| `apps/StatefulSet/data/postgres` | 28 | 196 |
| `core/PersistentVolumeClaim/data/data-postgres-0` | 23 | 196 |
| `apps/StatefulSet/data/redis` | 28 | 196 |
| `core/PersistentVolumeClaim/data/data-postgres-1` | 23 | 196 |
| `core/PersistentVolumeClaim/monitoring/grafana` | 52 | 196 |
| `core/Service/prod/api` | 26 | 196 |
| `policy/PodDisruptionBudget/prod/web` | 25 | 196 |
| `apps/Deployment/prod/web` | 18 | 196 |
| `apps/Deployment/prod/worker` | 18 | 196 |
| `autoscaling/HorizontalPodAutoscaler/prod/api` | 23 | 196 |

**⑦ 작업 영역 식** — `clamp(480px, calc(100vh − 176px), 960px)` 는 **맞다**(카드 실측 724px, 파일·드리프트 탭과 같은 값). 캔버스가 636 이 아니었던 이유는 **도구 막대 A 의 줄바꿈**이다.

| | 이전 | 조치 후 | 설계 |
|---|---|---|---|
| 도구 막대 A | **105px**(2줄) | **65px** | 48px |
| 도구 막대 B | 41px | 41px | 40px |
| 캔버스 | **576px** | **616px** | 636px |

- 남은 **20px** 은 `SceneToolbar` 가 결과 수(`countText`)를 `toolbarMain` 아래 줄에 놓기 때문이다(`toolbarMain` 이 `flex: 1` 이라 폭을 다 먹는다, 실측 main 48 + count 16 ≈ 65). 퍼블리셔 컴포넌트 쪽이라 손대지 않았다.
- 접기 전 도구 막대 A 항목 합: `보기 117 + 네임스페이스 165 + 종류 109 + 관계·표식 300 + 검색 200 + 결과 이동 74 = 965px` (사용 가능 742px). 관계·표식을 `필터 ▾`(68) 로 접고 결과 이동을 검색 중에만 그려 **691px** 로 줄였다.

**못 맞춘 두 항목의 원인(임계값·폭은 건드리지 않았다)**

- **이름 5/27 · 라벨 숨김 22.** 지난 회차(9/27)보다 **더 줄었고**, 원인은 ②번 요구인 **블록 몸체 사각형 점유**다. `px_per_u ≈ 5.35` 라 몸체 한 변이 **21px**인데 층 안 이웃 간격이 18~28px 이다. 즉 이웃 블록의 몸체 사각형이 라벨 자리를 거의 전부 덮는다. B2 상자(76 × 42px)는 물론 B3(52 × 42px)도 이웃 몸체 2~3개를 지나가므로, 19자리를 다 써도 자리가 없어 대부분 **B4** 로 내려간다(그려진 18개 중 13개가 B4).
- 자리 후보 19개와 밀어 올리기 48px 은 **잘 작동한다**(밀어 올림 5 · 좌우 비켜감 3 · 단계 내림 10). 다만 세로로 48px 올려도 그 위에는 **위 층 블록의 몸체**(층 간격 12u ≈ 64px)가 있어 구제 폭이 좁다.

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** |
| `npx tsc --noEmit -p apps/web` | **통과** |
| `npm test --prefix apps/web` | **통과 20 파일 / 404 테스트** |
| 스크린샷 | `shots-3d/after3/scene-{1024,1440}-{light,dark}.png` |
| `next build` · prettier | 돌리지 않음. `engine.ts` 는 **문자열 치환만**(유일성 검사 포함) 사용 |

### 7. 남은 이슈·한계

- **이름 19% · 라벨 숨김 22** — 수용 기준 미달(5절 원인). 임계값·상자 폭을 임의로 바꾸지 않았다.
- 캔버스 **616px**(설계 636). 남은 20px 은 `SceneToolbar` 의 결과 수 줄바꿈이다(퍼블리셔 영역).
- **AC-3D22 3D 묶어 보기** 미구현(그대로).
- `SceneInfoItem.onClick`·`actionLabel`, 9.4 알림 `live` 는 여전히 퍼블리셔 도착 대기(타입만 확장해 미리 넘기고 있다).
- AC-3D19·21 실장비 측정 미실시.

### 8. 다른 담당 요청

- **디자이너 요청**
  1. **몸체 사각형 점유(4.7.1 ②)와 이름 74% 는 지금 규모에서 양립하지 않는다.** 몸체 21px vs 이웃 간격 18~28px 이라 라벨 자리가 남지 않는다(⑥ 표의 `g` 참고). 셋 중 하나를 골라 주세요 — ① 몸체 사각형을 **한 변 `2u × px_per_u`(≈11px)** 로 줄이기 ② 라벨 상자를 몸체 **위쪽 절반만** 침범 금지로 완화 ③ 층 간격을 12u → 16u 로 늘려 세로 여유를 만들기(밀어 올림이 살아난다).
  2. 도구 막대 A 를 한 줄(48px)로 두려면 **결과 수(`countText`)를 어디에 둘지** 정해 주세요. 지금은 `toolbarMain` 아래 줄로 내려가 16px 을 더 먹습니다(정보 줄에 같은 수치가 이미 있습니다). 관계·표식 필터는 **모든 폭에서** `필터 ▾` 로 접었습니다(6.1·12절 갱신 필요).
  3. `fillY 0.786` — `fit` 이 1.00 이므로 가로가 먼저 차서 세로가 21% 남습니다(장면이 여전히 가로로 넓다). 더 줄이려면 판을 2열로 내려야 하는데, 그러면 세로가 길어져 `d_read` 상한에 걸릴 수 있습니다. 현 상태 유지 여부를 확인해 주세요.
- **퍼블리셔 요청**: `SceneInfoItem.onClick`·`actionLabel`, 9.4 알림 `live`(기존 그대로). 추가로 `SceneToolbar` 의 `countText` 가 `toolbarMain` 과 **같은 줄**에 오도록(`toolbarMain` 에 `flex: 1 1 auto; min-width: 0`) 해 주시면 캔버스 16px 을 돌려받습니다.
- **PM 요청**: AC-3D19·21 실장비 측정.

### 9. 다음 담당이 알아야 할 점

- 자리 후보 순서는 `LIFT_STEPS` × `offsetMax()` 로 정해진다. 후보를 늘리려면 이 두 상수만 고치면 되고, 단계 임계값(`LABEL_GAP`)·상자 폭(`LABEL_BOX`)과는 독립이다.
- 몸체 점유는 `bodyOwner` 맵으로 "자기 블록 예외"를 구현했다. 여러 블록이 겹친 칸은 `*` 로 두어 누구에게도 열리지 않는다.
- 카메라 루프는 **크기 조이기 → 중심 맞추기**를 3회 반복한다. `fit` 이 1.0 에서 벗어나면 이 루프를 먼저 의심할 것.
- 도구 막대 A 는 **한 줄에 들어가야** 캔버스가 설계 높이를 지킨다. 항목을 추가하려면 `필터 ▾` 팝오버 안으로 넣는다.
- 측정은 `__sentinel3d.fitCheck()` / `.labelStats()`(`placement` 포함) / `.frameStats()`.

---

## 2026-09-20 (6) · A·B·C·D 실측 비교 → **C(층 간격 16u) 채택**

### 1. 요청 내용

- PM 결정: "계산으로 세 번 빗나갔으니 이번엔 **측정으로 고른다**". designer 의 세 안 + 조합을 같은 장면(mock K-1, 1440 × 900)에 각각 적용해 실측하고 제일 나은 것을 채택한다. **규칙 자체(임계값 72/48/28/18 · 상자·이름 폭 · 자리 후보 19개 · 밀어 올리기 48px)는 건드리지 않는다.**
  - **A** 몸체 점유 사각형 `4u` → **`2u × px_per_u`**(≈ 11px)
  - **B** 몸체의 **위쪽 절반만** 침범 금지
  - **C** 층 간격 12u → **16u**
  - **D** A + B
- 채택 기준: **표식 100% · `표식 숨김` 0** 과 `fit` 0.98~1.02 를 지키면서 **이름이 가장 많이 보이는 안**. 동률이면 **라벨이 블록을 덜 가리는 쪽**. 목표(≥ 20/27) 미달이어도 최선을 채택하고 숫자를 그대로 보고.

### 2. 방법

- `engine.ts`(몸체 크기·위쪽 절반)와 `layout.ts`(층 간격)에 **측정 전용 임시 스위치**(`window.__viz3dExp`)를 넣고, 헤드리스 Chrome 이 문서 로드 전에 값을 넣어 같은 URL·같은 크기로 다섯 번(base·A·B·C·D) 돌렸다. 측정은 `__sentinel3d.fitCheck()` / `.labelStats()`, 겹침은 스크린샷 육안 확인.
- 채택 뒤 **스위치는 제거**했고 `U.layerGap = 16` 으로 고정했다.

### 3. 실측 비교 (mock K-1, 1440 × 900, 캔버스 766 × 616)

| 안 | ① 이름/27 | ② `라벨 숨김` | ③ `표식 숨김` | ④ `fit` / `fillX` / `fillY` / `dx` / `dy` | 자리(앵커·올림·좌우·단계내림·막힘) | ⑤ 라벨이 블록을 덮나 |
|---|---|---|---|---|---|---|
| 현재(몸체 4u 전체) | 5 | 22 | 0 | 1.000 / 0.919 / 0.786 / −0.01 / 0.00 | 10 · 5 · 3 · 10 · 18 | 덮지 않음 |
| **A** 몸체 2u | 6 | 21 | 0 | 1.000 / 0.919 / 0.786 / −0.01 / 0.00 | 10 · 6 · 3 · 10 · 14 | **일부 덮음**(몸체 위 절반까지 라벨이 내려옴) |
| **B** 위쪽 절반만 금지 | 7 | 20 | 0 | 1.000 / 0.919 / 0.786 / −0.01 / 0.00 | 9 · 7 · 3 · 9 · 16 | **일부 덮음**(아래 절반 허용이라 옆 블록 몸통에 얹힘) |
| **C** 층 16u | **7** | **20** | **0** | **1.000 / 0.919 / 0.866 / −0.01 / 0.00** | 9 · 10 · 3 · 12 · 12 | **덮지 않음** |
| **D** A + B | 7 | 20 | 0 | 1.000 / 0.919 / 0.786 / −0.01 / 0.00 | 9 · 7 · 3 · 9 · 14 | **덮음**(`monitoring/grafana` 라벨이 Service 블록 위) |

- 이름 최대값은 **7 로 B·C·D 동률**이다. 동률 기준(라벨이 블록을 덜 가리는 쪽)에서 **C 만 몸체 침범이 0** 이다. C 는 덤으로 `fillY` 0.786 → **0.866**(세로 채움), 막힌 블록 18 → **12**, 밀어 올림 5 → **10** 으로 모두 낫다.
- **채택: C (층 간격 12u → 16u).** 채택 뒤 재측정: 이름 **7/27**, `라벨 숨김` **20**, `표식 숨김` **0**, `fit` **1.00005**, `fillX` **0.9185**, `fillY` **0.8660**, `dx` **−0.013px**, `dy` **−0.002px**, 단계 분포 B0 1 · B1 3 · B2 2 · B3 1 · B4 12(그려진 22개).

**참고 — 요청 범위 밖 조합도 함께 쟀다**(채택하지 않음, designer 판단용)

| 조합 | 이름/27 | `라벨 숨김` | `표식 숨김` | `fillY` | 막힘 | 겹침 |
|---|---|---|---|---|---|---|
| C + A | **9** | 18 | 0 | 0.866 | 11 | 일부 덮음 |
| C + B | **9** | 18 | 0 | 0.866 | 13 | 일부 덮음 |
| C + A + B | **9** | 18 | 0 | 0.866 | 12 | 일부 덮음 |

→ 층 16u 위에 몸체 완화를 얹으면 이름이 **9/27** 까지 올라간다(겹침을 감수하는 대신). 네 안 중에서 고르라는 지시라 채택하지 않았고, 다음 판단을 위해 숫자만 남긴다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/layout.ts` | 수정 | `U.layerGap` 12 → **16**(채택안 C), 근거 주석 |
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | 측정용 임시 스위치 추가 후 **제거**(몸체 점유는 `4u` 전체 사각형 그대로) |

### 5. 주요 결정과 이유

| 결정 | 이유 |
|---|---|
| **C 채택** | 이름 수 동률(7)에서 **유일하게 라벨이 블록을 덮지 않는다**(채택 기준 2번). `fillY`·막힌 블록 수도 가장 좋다 |
| A·B·D 기각 | 이름 이득이 없거나 같고(6~7), 라벨이 블록 몸통에 얹힌다. 블록을 가리면 종류 색·표식을 읽기 어려워져 4.8 의 전제가 깨진다 |
| C+A(9/27)를 채택하지 않음 | 지시가 네 안 중 선택이었고, 겹침이 생긴다. 숫자는 3절에 남겨 designer 가 판단하게 한다 |
| 측정 스위치를 **남기지 않음** | 제품 코드에 실험 플래그를 남기면 다음 사람이 켜진 줄 모른다. 같은 측정이 필요하면 같은 방식으로 임시로 넣고 지우면 된다 |

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** |
| `npx tsc --noEmit -p apps/web` | **통과** |
| `npm test --prefix apps/web` | **통과 20 파일 / 405 테스트** |
| 스크린샷 | 채택안 `shots-3d/after4/scene-{1024,1440}-{light,dark}.png`, 비교용 `shots-3d/exp/exp-{base,A,B,C,AB,CB}.png` |
| `next build` · prettier | 돌리지 않음 |

### 7. 남은 이슈·한계

- 이름 **7/27(26%)** 로 수용 기준(≥ 20/27) 미달. 임계값·폭은 건드리지 않았다. 3절의 C + A(9/27) 숫자가 다음 조정의 재료다.
- 캔버스 616px(설계 636) — `SceneToolbar` 의 결과 수 줄바꿈 20px(퍼블리셔 영역).
- AC-3D22 묶어 보기 미구현, AC-3D19·21 실장비 측정 미실시 — 그대로.

### 8. 다른 담당 요청

- **디자이너**: ① 채택안 **C(층 16u)** 를 4.2 에 반영해 주세요(기준 장면 실측: 이름 7/27 · `라벨 숨김` 20 · `표식 숨김` 0 · `fit` 1.000 · `fillX` 0.919 · `fillY` 0.866). ② **C + A(몸체 2u)** 를 허용하면 이름이 **9/27** 로 늘지만 라벨이 블록 몸통 위 절반을 덮습니다 — 허용 여부를 정해 주세요. ③ 이름 74% 는 이 규모(층 안 이웃 간격 18~28px)에서 현 규칙으로는 도달하지 못합니다. 더 올리려면 상자·이름 폭(4.7.1 표)을 줄이는 쪽을 봐야 합니다.
- **퍼블리셔**: 기존 3건 그대로(`SceneInfoItem.onClick`·`actionLabel`, 9.4 `live`, `SceneToolbar` 결과 수 같은 줄).

### 9. 다음 담당이 알아야 할 점

- 층 간격은 `layout.ts` 의 `U.layerGap` **한 곳**이다(16u). 바꾸면 `px_per_u`·라벨 자리·`fillY` 가 함께 움직이니 3절과 같은 방식으로 다시 재는 것이 빠르다.
- 같은 A/B/C/D 실험을 다시 하려면 `engine.ts` 의 몸체 점유 부분과 `layout.ts` 의 층 간격에 임시 스위치를 넣고 헤드리스에서 `window.__viz3dExp` 를 문서 로드 전에 주입하면 된다(측정 스크립트는 scratchpad 의 `shot.mjs` 가 `exp` 필드를 지원한다).

---

## 2026-09-20 (7) · 불변 ②-1 위반 수정(표식 블록 최소 B2) + 최종 실측

### 1. 요청 내용

PM: ① 기준 장면에서 **표식이 있는 블록 수**와 **그중 이름이 보이는 수**를 세고, designer 규칙 **②-1 "표식 있는 블록은 최소 B2(이름 보임)"** 가 깨져 있으면 `layoutLabels` 를 고칠 것(다른 불변 — `표식 숨김` 0 · 라벨이 블록을 덮지 않음 · `fit` 0.98~1.02 — 은 유지). ② publisher 가 고친 두 가지(정보 줄 칩 말줄임, `SceneToolbar` 결과 수 같은 줄)를 반영한 상태로 스크린샷과 `fitCheck()` 재측정(캔버스 616 → 636 여부 포함). ③ lint·typecheck·vitest.

### 2. ① 불변 확인 → **깨져 있었다 → 고쳤다**

| | 고치기 전 | **고친 뒤** |
|---|---|---|
| 표식이 있는 블록 | 11 | 11 |
| 그중 **이름이 보이는** 블록 | **4** ❌ | **11 (100%)** ✅ |
| 표식 블록 단계 분포 | B0 1 · B1 1 · B2 2 · **B4 7** | B0 1 · B1 1 · **B2 9** |
| 전체 이름/27 | 7 | **14** |
| `라벨 숨김` | 20 | **13** |
| `표식 숨김` | 0 ✅ | **0** ✅ |
| `fit` / `fillX` / `fillY` / `dx` / `dy` | 1.00005 / 0.9185 / 0.8660 / −0.013 / −0.002 | **같음**(카메라는 건드리지 않았다) ✅ |
| 자리(앵커·올림·좌우·단계내림·막힘) | 9 · 10 · 3 · 12 · 12 | **4 · 12 · 10 · 2 · 11**(막힌 11개는 모두 200점 = 표식 없음) |

**원인**: 최소 단계 보장을 **시작 단계**에만 걸고, 19자리가 다 막히면 B3 → B4 로 **내려가게** 두었다. 표식 블록 7개가 그렇게 B4(표식만)로 떨어져 이름을 잃었다.

**고친 방법**(`layoutLabels`): 표식이 있는 블록은 **B2 밑으로 내려가지 않는다**. 19자리가 다 막히면 그중 **부딪히는 칸이 가장 적은 자리**를 골라 겹쳐서 그린다. 비용은 `블록 몸체 칸 3점 · 다른 라벨 칸 1점` 으로 매겨 **블록을 가리는 자리보다 라벨끼리 겹치는 자리를 먼저** 고른다.

**다른 불변**: `표식 숨김` 0 유지 ✅, `fit`·`fillX`·`fillY`·`dx`·`dy` 불변 ✅. **라벨이 블록을 덮지 않음** — 표식 **없는** 블록은 여전히 몸체를 절대 침범하지 않는다. 표식 블록만, 그것도 최소 비용 자리를 골라 겹치므로 육안으로 블록을 가리는 곳은 없고 라벨끼리 두 군데(`api-config`/`api-db-credentials`, `postgres-config`/`postgres-credentials`) 겹친다.

- 중간 검증으로 **M2**(표식 블록이 다른 라벨과만 겹치고 몸체는 계속 피함)도 쟀는데 결과가 고치기 전과 같았다(4/11). 막는 것이 **다른 라벨이 아니라 이웃 블록의 몸체 사각형**임이 확인됐다 — 그래서 최소 비용 자리 선택 방식으로 갔다.

### 3. ② publisher 수정 반영 상태 재측정

- **정보 줄 칩 말줄임 해소 확인** — `블록 27 · 관계 15`, `차이 3건 · 12:43 계산`, `라벨 14개 숨김` 이 잘리지 않고 그대로 보인다.
- **캔버스는 616px 그대로(636 아님)**. 카드 **724px**(식 `clamp(480, 100vh−176, 960)` 정상), 도구 막대 **A 65px · B 41px**.
  - `SceneToolbar` 의 `toolbarMain { flex: 1 1 auto; min-width: 0 }` · `toolbarCount { flex: 0 1 auto; 말줄임 }` 은 **반영돼 있다**. 남은 17px 은 **결과 수가 아니라 row A 내부 줄바꿈**이다: 항목 합 `보기 117 + 네임스페이스 165 + 종류 109 + 필터 68 + 검색 200 = 659 + 간격 32 = 691px` 인데, 결과 수(90px)와 좌우 패딩을 빼면 가용 폭이 **약 640px** 이라 마지막 항목이 다음 줄로 내려간다.
  - 결과 수 문구(`블록 27 · 관계 15`)는 **정보 줄 2번 칩과 같은 문자열**이다. 이것을 row A 에서 빼면 691 ≤ 742 로 한 줄이 되어 캔버스가 **636px** 이 된다 → 8절 디자이너 확인 요청.
- `fitCheck()` 재측정: **`fit` 1.00005 · `fillX` 0.9185 · `fillY` 0.8660 · `dx` −0.013px · `dy` −0.002px · `inside` true · `offscreen` false** (모두 기준 안).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | 표식 블록의 **B2 하한 보장**(19자리 소진 시 최소 비용 자리에 배치), `place()` 에 `ignoreLabels` 인자(몸체는 언제나 보호) |

### 5. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** |
| `npx tsc --noEmit -p apps/web` | **통과** |
| `npm test --prefix apps/web` | **통과 20 파일 / 408 테스트** |
| 스크린샷 | `shots-3d/final/` — `scene-{1024,1440}-{light,dark}.png`, `table-1440-light.png`, `selected-1440-light.png` |
| `next build` · prettier | 돌리지 않음 |

### 6. 남은 이슈

- 전체 이름 **14/27(52%)** — 수용 기준(≥ 20/27) 미달. 남은 13개는 표식이 없는 블록이고 `g` 18~33px 구간이다.
- 캔버스 616px(설계 636) — 3절의 결과 수 중복 때문. 디자이너 판단 필요.
- AC-3D22 묶어 보기 미구현, AC-3D19·21 실장비 측정 미실시 — 그대로.

### 7. 다른 담당 요청

- **디자이너**: ① 도구 막대 A 의 **결과 수(`블록 27 · 관계 15`)를 빼도 되는지** 확인해 주세요(정보 줄 2번 칩과 같은 문구입니다). 빼면 row A 가 한 줄이 되어 캔버스가 616 → **636px** 이 됩니다. ② 표식 블록의 B2 보장 때문에 **라벨끼리 겹치는 곳이 두 군데** 생깁니다(블록은 가리지 않음). 겹침 대신 이름을 포기하는 쪽이 낫다면 알려 주세요 — 되돌리면 표식 블록 이름이 11 → 4 로 줄어듭니다. ③ 표식 없는 블록 13개는 여전히 이름이 없습니다(4.7.1 표의 상자·이름 폭을 줄이는 것이 다음 지렛대입니다).

---

## 2026-09-20 (8) · 블록 모양 분화 9종 (4.11 구현) + 실측 재확인

### 1. 요청 내용

- PM 요청: 디자인 4.11(2026-09-20 (8) 신설)대로 **블록 모양을 종류별로 나눈다**.
  1. 지오메트리 **9종**(`stack`·`cylinder`(16각)·`panel`·`roof`·`chamfer`·`gate`·`diamond`·`box`·`tile`)을 4.11.1 치수표 그대로
  2. 인스턴싱 단위 `층` → **`층 × 모양`**(윤곽 `LineSegments`도 같은 단위)
  3. 밝기는 정점 색으로 굽되 광원 **`l = (−0.49, 0.87, 0.10)`** + **100/82/64% 양자화**(그라데이션 금지)
  4. 윤곽선 `EdgesGeometry` **thresholdAngle 25°**(원통 세로 모서리 제외)
  5. **히트 영역은 모양이 아니라 봉투**(얇은 `panel`도 같은 크기로 집힘)
  6. 매핑 표를 새로 만들지 말고 퍼블리셔 `kindShape()`를 **import**
  7. 유령·비교 불가·선택·호버가 **모든 모양에서** 동일 동작(4.11.4)
- **절대 제약**: 모든 모양이 봉투 **4u × 3u × 4u** 안, 상단 평면 정확히 **3u**, `(0, 3u, 0)` 솔리드. 벗어나면 카메라·라벨 실측값이 전부 무효.
- 구현 후 확인 3가지(designer 지정): ① `fitCheck()`가 이전과 같은 값인지 ② 한 판에서 `Deployment`(stack) ↔ `Job`(chamfer)이 22px에서 갈리는지 ③ 유령 `Secret`·`Ingress` 구멍이 보이는지.
- 재측정: 이름 보이는 블록 수/27 · `라벨 숨김` · `표식 숨김` · `fit`/`fillX`/`fillY`/`dx`/`dy` · 드로콜 수 · 대규모(`k8s-snapshots=large`) 회전 체감. 확인 뒤 시나리오 `default` 복구.
- 작업 중 PM이 전달한 추가 지시 2건: (a) 퍼블리셔 배선 3건(`kindShape` import · 종류 필터 `ShapeSwatch` adornment · 범례 중복 확인, `GraphTab` 의 `hint` 를 `LEGEND_NOTES[0]` 으로) (b) **`roof` 는 용마루 `z` 방향·처마 `x = ±2`, 밝기는 −x 사면 100% / +x 사면 82% / 박공 ±z 64%**(designer 8-1 확정).
- 제약: 사용자가 :3000·:3001을 보고 있으므로 종료·재시작·`next build`·prettier 금지, 헤드리스는 :3000에 접속.

### 2. 참고한 문서

- `docs/design/snapshot-3d.md` **4.11 전체**(4.11.0 제약 7 · 4.11.1 치수표 · 4.11.2 종류 배정과 층별 구분 · 4.11.3 밝기 양자화 · 4.11.4 상태별 · 4.11.5 성능 · 4.11.6 불변 6개 · 4.11.7 무영향 자리), **4.0**(투영 상수·기준 장면 실측), 4.3(봉투·면취 폐지·히트 영역), 4.4(유령은 모양 유지), 4.10(아이콘과 모양의 역할 분담), 6.1·6.5(범례 「모양 = 종류」 절)
- `docs/design/components.md` 16.12 `kindShape()` · 16.13 `ShapeSwatch` · 16.2 종류 필터 옵션
- `docs/reports/snapshot-3d/designer.md` 2026-09-20 (8)(결정 이유·대비책) 및 PM이 전달한 (8-1) 확정
- `docs/reports/snapshot-3d/publisher.md` 2026-09-20 (5)(`kindShape`·`ShapeSwatch`·`SceneLegend`·`SelectOption.adornment`)
- 내 이전 보고 (1)(렌더 구조)·(6)(층 16u)·(7)(최신 실측값)

### 3. 작업 내용

**① 지오메트리 9종 — `graph/scene/shapes.ts` 신설**

- **u 단위 그대로** 만든다(x·z ∈ [−2, 2], y ∈ [−1.5, 1.5] = 블록 중심 기준, 상단 평면 = +1.5 = 3u). 엔진은 `w/4 · h/3 · d/4` 로만 스케일한다.
  - 정규화 정육면체(1 × 1 × 1)로 만들고 (4, 3, 4)로 늘리면 **비균등 스케일 때문에 법선이 찌그러져 밝기 양자화가 틀린다**(예: `roof` 사면이 45°가 아닌 각으로 계산된다). u 단위로 만들면 스케일이 1이라 이 문제가 없고, 곁 타일(6 × 0.75 × 3)은 축에 나란한 상자라 비균등 스케일에도 법선이 그대로다.
- 모양은 모두 **볼록 조각의 합**으로 만든다(상자·사각 절두체·정n각 기둥·박공 프리즘). 가려지는 면(위 단 아랫면, `chamfer` 기둥 윗면, `gate` 다리 윗면)은 빼고, **`gate` 보의 밑면(구멍 천장)은 반드시 남긴다**(64%로 어둡게 읽히는 자리).
- 밝기: 면 법선마다 `t = n · l`(`l = (−0.49, 0.87, 0.10)`)을 구해 **100 / 82 / 64% 세 값으로 양자화**해 정점 색으로 굽는다. 보간·그라데이션 없음. **판(슬래브)도 같은 함수**를 쓰게 고쳤다(이전엔 옛 광원 기준 고정 배열이었다).
- 윤곽: `EdgesGeometry(geo, 25)` 결과를 u 단위 선분 배열로 캐시해 두고, 인스턴스마다 위치·스케일만 적용해 한 덩어리 `LineSegments` 로 합친다.
- `roof` 는 PM이 전달한 designer 확정대로 **용마루 z 방향·처마 x = ±2** 로 만들었다. 이 방향에서 밝기가 **−x 사면 100% / +x 사면 82% / 박공 ±z 64%** 로 나와 designer 표(4.11.3)와 정확히 일치한다.

**② 인스턴싱 단위 `층` → `층 × 모양`**

- `build()` 가 블록을 `<ghost|layer>|<shape>` 조합으로 모아 조합마다 `InstancedMesh` 1개 + 합친 윤곽 `LineSegments` 1개를 만든다. **장면에 실제로 등장하는 조합만** 만든다.
- 조합 순서는 `보통 → 유령`, `층 아래 → 위`, 같으면 키 문자열 순이다(같은 입력이면 같은 순서, AC-3D11).
- 유령도 **모양별로** 묶는다(면 `ghost.fill` 0.35 + 1.5px dashed **그 모양의** 윤곽, 4.11.4).
- 기존 `meshes`/`blockIndex`(층 기준 Map)는 `blockGroups` 배열로 바꿨고, 흐림(`instanceColor` 혼합)·위에서 시점 페이드도 이 배열을 돈다.

**③ 히트 영역 = 봉투 (4.11.4)**

- 층마다(+유령) **봉투 상자(`lb.w × lb.h × lb.d`) `InstancedMesh`** 를 따로 만들고 **장면에 넣지 않는다**(그리지 않으므로 드로콜이 늘지 않는다). `updateMatrixWorld()` 만 하고 레이캐스트 대상으로만 쓴다.
- 덕분에 깊이 1.2u짜리 `panel`(화면 4.6px)도 상자와 **같은 크기로 집힌다**. 얇은 모양이 집기 어려워지는 문제가 구조적으로 없다.

**④ 상태별 처리 — 모든 모양에서 같은 모서리 집합**

- 선택 2px · 검색 2px dashed · **hover 1.5px**(이번에 추가: 4.11.4의 hover 윤곽이 1단계에서 빠져 있었다) 모두 `pushShapeEdges(..., pad 0.12)` 로 **같은 모서리 집합**에 굵기·색·대시만 바꾼다.
- 유령·비교 불가·드리프트·흐림·위에서 시점은 4.11.4 그대로(모양·색을 바꾸지 않는다).

**⑤ 매핑은 퍼블리셔 `kindShape()` 하나**

- `GraphTab` 이 `kindShape(b.kind, { custom: b.custom, layer: b.layer })` 로 `blocks[].id → VizShape` 맵을 만들어 `SceneCanvas` → `SceneData.shapes` 로 내려보낸다. **엔진·`shapes.ts` 에는 종류 표가 없다**(`VizShape` 도 `KindIcon` 에서 **타입만** 가져온다 — 런타임 import 가 아니라 청크 경계에 영향 없음).
- 종류 필터 옵션에 `adornment: <ShapeSwatch shape={kindShape(kind, { layer })} size={14} tone="layer" layer={layer} />` 를 넣었다. 종류 → 층은 **서버가 준 `blocks[].layer`** 에서 읽는다(화면이 종류 → 층 표를 갖지 않는다).
- 정보 줄 `circle-help` 툴팁 둘째 줄을 직접 적던 문장을 **`LEGEND_NOTES[0]`** 로 바꿨다(범례 맨 아래 문장과 한 문자열).

**⑥ 자가 점검·측정 훅**

- `shapesOutsideEnvelope()` — 봉투 이탈·상단 평면 미달·`(0, 3u, 0)` 비솔리드를 한 번에 본다(`roof` 처럼 **면이 아니라 능선**인 경우도 통과시킨다).
- `GraphScene.renderStats()` — 드로콜·삼각형·`층 × 모양` 조합 목록. `window.__sentinel3d` 에 `renderStats`·`shapeStats`·`shapeCheck` 를 더했다(측정 전용).
- 단위 테스트 `graph/scene/shapes.test.ts` 34개(봉투·상단 3u·밝기 3값·삼각형 상한·원통 세로 모서리 없음·지오메트리 캐시).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/scene/shapes.ts` | **추가** | 모양 9종 지오메트리·밝기 양자화·`EdgesGeometry 25°` 윤곽 템플릿·봉투 자가 점검 |
| `apps/web/src/features/k8s-snapshots/graph/scene/shapes.test.ts` | **추가** | 불변 점검 34개 |
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | `SceneData.shapes`, 인스턴싱 `층 × 모양`(`blockGroups`), 봉투 픽킹(`pickGroups`), 모양 윤곽 기반 선택·검색·**hover** 윤곽, 판 밝기도 같은 광원, `renderStats()` |
| `apps/web/src/features/k8s-snapshots/graph/scene/SceneCanvas.tsx` | 수정 | `shapes` prop 전달, 측정 훅 3개 추가 |
| `apps/web/src/features/k8s-snapshots/graph/GraphTab.tsx` | 수정 | `kindShape()` 로 모양 맵 생성, 종류 필터 `ShapeSwatch` adornment, `hint` 를 `LEGEND_NOTES[0]` 으로 |

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 이유 |
|---|---|---|
| 지오메트리를 **u 단위**로 만들고 스케일을 1로 | 단위 정육면체 + (4,3,4) 스케일 | 비균등 스케일은 법선을 찌그러뜨려 **밝기 양자화가 틀린다**(사면·원통에서 특히). 곁 타일만 축 정렬 상자라 비균등 스케일에도 안전하다 |
| 모양 지오메트리를 **모듈 캐시**로 공유 | 장면마다 생성 | 9종 합계 224 삼각형이다. 테마 전환·데이터 갱신마다 다시 굽지 않는다(재질만 다시 만든다) |
| 히트 영역 메시를 **장면에 넣지 않는다** | 투명 재질로 장면에 추가 | 그리지 않으므로 드로콜·투명 정렬 비용이 0이다. `updateMatrixWorld()` 만 하면 레이캐스트는 정상 동작한다 |
| 픽킹은 **층 단위**(모양 단위 아님) | 조합마다 픽 메시 | 봉투는 모양과 무관하므로 층 단위로 묶는 것이 조합보다 적다(기준 장면 5개). 선택 id 매핑도 단순해진다 |
| hover 윤곽을 **이번에 추가** | 그대로 두기 | 4.11.4가 "선택·hover·검색이 같은 모서리 집합"이라고 못박았는데 1단계에는 hover 윤곽이 없었다. 같은 `drawOutline()` 을 쓰므로 새 코드 경로가 아니다 |
| 유령도 **모양별로 묶기** | 유령은 상자 하나로 | 4.4가 "유령은 그 종류의 모양 그대로"라고 못박았다. 유령 Secret 이 `chamfer` 윤곽이어야 "무엇이 없는가"의 절반(종류)이 읽힌다 |
| `VizShape` 를 `KindIcon` 에서 **타입만** import | 엔진에 타입 재정의 | 타입이 두 벌이면 퍼블리셔가 모양을 늘렸을 때 조용히 어긋난다. `import type` 은 런타임에 사라져 3D 청크 경계에 영향이 없다 |

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** |
| `npx tsc --noEmit -p apps/web` | **통과** |
| `npm test --prefix apps/web` | **통과 22 파일 / 455 테스트** (이번 추가 34개 포함) |
| `next build` · prettier | **돌리지 않음**(지시대로. :3000 dev 서버 유지) |
| 브라우저 | 이미 떠 있는 **:3000** 에 헤드리스 Chrome(CDP)으로 접속. 서버를 띄우거나 죽이지 않았다 |

**① `fitCheck()` — 이전과 같은 값인가 (봉투 이탈 신호)**

| 항목 | designer 기준값 (4.0) | 이번 실측 | 판정 |
|---|---|---|---|
| `fit` | 1.00005 | **1.0000472** | 동일 |
| `fillX` | 0.9185 | **0.9185386** | 동일 |
| `fillY` | 0.8660 | **0.8659683** | 동일 |
| `dx` · `dy` | −0.013 · −0.002 | **−0.0134 · −0.0017** | 동일 |
| `inside` · `offscreen` | true · false | **true · false** | 동일 |
| `shapeCheck()`(봉투 이탈) | — | **`[]`** | 이탈 0 |

→ **bbox 가 한 치도 바뀌지 않았다**(4.11.6 불변 5 확인). 카메라·라벨 실측값은 재측정 없이 유효하다.

**라벨 재측정** (mock `default`, `20260919-061000`, 1440 × 900 · 라이트 · 기본 시점 · 라벨 `전체`)

| 항목 | (7) 실측 | 이번 |
|---|---|---|
| 이름이 보이는 블록 | 14 / 27 | **14 / 27** |
| `라벨 숨김`(이름 없음) | 13 | **13** |
| **`표식 숨김`** | 0 | **0** |
| 자리 통계 | — | 앵커 4 · 밀어 올림 12 · 좌우 비켜감 10 · 단계 내림 2 |
| 1024 × 900(캔버스 536px) | — | `라벨 16개 숨김`, 장면 정상 |

**드로콜·삼각형 (`renderStats()`)**

| 장면 | `층 × 모양` 조합 | 드로콜 | 삼각형 |
|---|---|---|---|
| 기준 장면(블록 27) | **10** (`storage/cylinder×5`·`storage/panel×2`·`workload/cylinder×2`·`workload/roof×1`·`workload/stack×5`·`service/diamond×4`·`ingress/gate×2`·`aux/tile×3`·`ghost/chamfer×2`·`ghost/stack×1`) | **30** (블록 메시 10 + 윤곽 10 + 판 5 + 격자·판 윤곽 2 + 관계선 2 + 화살촉 1) | 1,020 |
| 대규모(블록 3,264) | **8** | **21** | 133,376 |

- 조합 수 10개는 designer 예상(8~14) 안이다. **블록이 쓰는 드로콜은 20개**(메시 10 + 윤곽 10)로 designer 예상 16~28 안이고, 30은 판·격자·관계선까지 더한 장면 전체 수치다.
- 모양별 삼각형(고유 지오메트리, 합계 **224 ≤ 256**): `box` 12 · `stack` 20 · `cylinder` 60 · `panel` 12 · `roof` 16 · `chamfer` 20 · `gate` 52 · `diamond` 20 · `tile` 12. 윤곽 선분: 12 · 24 · **32(세로 모서리 없음)** · 12 · 15 · 20 · 60 · 20 · 12.

**② `Deployment`(stack) ↔ `Job`(chamfer) 구분 — 기준 장면에서는 확인 불가**

- **mock 데이터에 `Job` 종류가 하나도 없다**(스냅샷 10개 전부 + `large` 시나리오 확인). 또 `Secret` 은 스냅샷 규칙상 **항상 유령**(이름만)이라 면이 있는 `chamfer` 가 장면에 나오지 않는다. 그래서 "한 판에 `Deployment` 와 `Job`" 스크린샷을 **실데이터로 만들 수 없었다.**
- 대신 **제품 지오메트리 코드 그대로**(`shapes.ts` 를 rolldown 으로 묶어) 기준 장면과 **같은 배율·같은 투영 상수**(`px_per_u` 5.45 · right (0.819, 0, 0.574) · up (0.287, 0.866, −0.410))로 9종을 나란히 그린 대조 하니스를 만들어 찍었다(`shots-3d/shapes/harness-pair.png`, 아래 줄은 같은 래스터를 5배 확대). 결과: **22px 에서 갈린다.**
  - `stack` = 낮고 넓은 턱 + **수직으로 꺾여** 올라가는 좁은 상단(상단 폭 11.3px)
  - `chamfer` = 턱 없이 **대각선으로** 좁아지는 상단(상단 폭 7.6px), 옆면이 사다리꼴
  - 두 실루엣은 꺾임 위치(4.2px / 7.6px 지점)와 꺾임 방향(수직 / 대각선)이 모두 달라 겹쳐 보이지 않는다.
- 실장면에서 가장 가까운 대조는 `roof-1440-light.png` 다: 같은 판(`batch`)의 `Deployment report-generator`(stack)와 `CronJob nightly-report`(roof)가 나란히 있고 22px 에서 확실히 갈린다. 유령 `chamfer`(`api-db-credentials`)는 `ghost-1440-light.png` 에서 선택 윤곽으로 모양이 그대로 보인다.
- **designer 대비책(`stack` 치수 조정 / `Job` 을 `box` 로)은 쓰지 않았다.** 하니스에서 갈리는 것이 확인됐고, 치수를 바꾸면 4.11.1 표와 어긋나기 때문이다. 실데이터 확인은 **mock 에 `Job` 이 생긴 뒤**로 남긴다(8절 백엔드 요청).

**③ 유령 `Secret`·`Ingress` 구멍**

| 확인 | 결과 | 스크린샷 |
|---|---|---|
| 유령 `Secret` = `chamfer` dashed | 통과 — 모양 유지, 면 0.35 + dashed 윤곽. 선택하면 같은 모서리 집합에 2px 윤곽 | `ghost-1440-light.png` · `zoom-1440-light.png` |
| `Ingress` = `gate` 구멍 | 통과 — 다리 4개 사이 구멍이 보이고 보의 밑면이 어둡다 | `gate-1440-light.png` |
| `Service` = `diamond` · `PVC`/`StatefulSet` = `cylinder` · `ConfigMap`/`DaemonSet` = `panel` · 곁 = `tile` | 통과 — 전부 육안 구분 | `scene-1440-light.png` · `zoom-1440-light.png` |
| 흐림(선택 중 나머지)에서 모양 유지 | 통과 | `roof-1440-light.png` |
| 범례 「모양 = 종류」 9항목 · 맨 아래 문장 | 통과 — 퍼블리셔 기본값 그대로, 내 쪽 중복 표기 없음 | `legend-1440-light.png` |
| 종류 필터 옵션 `ShapeSwatch`(층 색) | 통과 | `kindfilter-1440-light.png` |

**대규모(`k8s-snapshots=large`, 블록 3,264 · 관계 6,272) 체감**

| 항목 | 값 |
|---|---|
| 회전 5~6초 `frameStats()` | 중앙값 **83.4 / 83.5ms**, p95 100~117ms (표본 55~56) |
| 같은 하니스·같은 조작, 기준 장면(블록 27) | 중앙값 **16.7ms**, p95 50ms (표본 261) |
| 드로콜 / 삼각형 | **21 / 133,376** |

- 헤드리스 Chrome 은 **SwiftShader(소프트웨어 렌더)** 라 기준 장비(내장 GPU) 수치가 아니다. 같은 환경에서 기준 장면이 60fps 인데 3,264 블록에서 12fps 이므로 **삼각형 수(약 3.6만 → 13.3만)가 소프트웨어 래스터라이저에서 그대로 비용이 된다**는 것만 말할 수 있다. GPU 에서는 13만 삼각형·드로콜 21이 문제가 되는 규모가 아니다(4.11.5의 판단과 같다). 실장비 측정은 여전히 남아 있다(AC-3D19).
- 확인 뒤 시나리오를 **`default` 로 되돌렸다**(`PUT /api/mock/scenarios/k8s-snapshots {"scenario":"default"}` → `active = default` 확인).

**스크린샷**: `…/scratchpad/shots-3d/shapes/` — `scene-{1024,1440}-{light,dark}.png`(3D 장면) · `zoom-1440-light.png`(확대) · `ghost-1440-light.png`(유령 Secret) · `gate-1440-light.png`(Ingress 구멍) · `roof-1440-light.png`(CronJob roof + Deployment stack) · `legend-1440-light.png` · `kindfilter-1440-light.png` · `harness-pair.png`(22px 대조 하니스) · `large-{1440-light,fitall-1440-light,rotated-1440-light}.png`

### 7. 남은 이슈·한계

1. **`Job` 실데이터 확인 미완**(위 ②). mock 에 `Job` 이 없어 `stack ↔ chamfer` 를 실장면 스크린샷으로 확인하지 못했다. 하니스(제품 지오메트리·같은 배율)로는 갈린다.
2. **대규모 장면의 첫 화면이 비어 보인다 — 이번 변경과 무관한 기존 문제.** `large`(블록 3,264)에서 `d_read` 상한(244u)이 장면 크기(대각선 약 1,000u 이상)보다 훨씬 작아, 맞춤 계산의 bbox 모서리 일부가 **카메라 뒤로 가서** 투영값이 폭주한다(`fitCheck().dx ≈ −250,000`, `fit ≈ 984`). 정보 줄의 **[일부가 화면 밖 — 전체가 보이게 축소]** 를 누르면 정상으로 돌아온다(`dx 0.40` · `fit 0.739` · `inside true`, `large-fitall-1440-light.png`). 기준 장면의 `fitCheck()` 가 designer 기준값과 소수 5자리까지 같다는 점에서 **모양 변경이 원인이 아니다**(bbox 불변). 카메라 규칙(4.9-2) 쪽 수정이 필요하다 → 8절 디자이너 요청.
3. 성능 실측은 여전히 **소프트웨어 렌더** 수치다(AC-3D19·21 실장비 측정 미실시).
4. AC-3D22 **3D 묶어 보기 미구현** — 그대로(4.11.4의 묶음 블록 1.5배 규칙도 아직 적용할 자리가 없다).
5. 이름이 보이는 블록 **14/27** — 이번 변경이 건드리지 않았다(4.11.6 불변 2·3 그대로). 다만 라벨 없는 블록 13개가 이제 **몸체만으로 종류를 말한다** — 이번 변경의 실질 이득이다.
6. `gate` 는 윤곽 선분이 60개로 9종 중 가장 많다(다리 4개). `Ingress` 가 수백 개 나오는 장면에서는 윤곽 선분이 블록당 60개가 되므로, 묶어 보기(9.7)를 구현할 때 이 모양부터 묶는 것이 좋다.

### 8. 다른 담당 요청

- **백엔드 요청**: mock k8s 스냅샷에 **`Job` 리소스 1개**를 넣어 주세요(가능하면 `Deployment` 가 있는 판, 예: `batch` 또는 `prod`). 디자인 4.11.2가 `stack ↔ chamfer` 를 "가장 가까운 쌍"으로 꼽고 회귀 점검 항목으로 지정했는데, 지금 mock 에는 `Job` 이 한 개도 없어 **실장면 스크린샷을 만들 수 없습니다**(`Secret` 은 규칙상 항상 유령이라 면 있는 `chamfer` 가 장면에 없습니다). 계약 변경은 필요 없습니다(`blocks[].kind` 만 `Job`).
- **디자이너 요청**
  1. **4.11.1 `roof` 치수 줄의 문구**를 확정 내용(용마루 z 방향 · 처마 `x = ±2`)에 맞춰 고쳐 주세요. 지금 문서에는 "처마(x = ±2) … 용마루(x = 0, z 전 구간)"와 "용마루 방향을 x축으로 고정"이 같은 절에 함께 있어 읽는 사람마다 다르게 구현하게 됩니다(저는 PM이 전달한 (8-1) 확정대로 만들었고, 밝기는 −x 100 / +x 82 / 박공 ±z 64%로 4.11.3과 일치합니다).
  2. **4.9-2 카메라: 아주 큰 장면에서 첫 화면이 비어 보입니다**(7절 2번). `d_read` 상한으로 거리를 묶은 뒤에도 맞춤 반복이 bbox 여덟 모서리를 투영하는데, 카메라 뒤 모서리가 섞이면 중심 계산이 무너집니다. ① 카메라 뒤 모서리를 빼고 중심을 잡거나 ② `offscreen` 일 때는 **중심만 bbox 중심에 두고 팬 보정을 생략**하는 규칙 중 어느 쪽을 쓸지 정해 주세요(제 쪽 수정 범위입니다).
  3. 4.11.4 hover 윤곽(1.5px 50%)을 이번에 넣었습니다. **50% 불투명도 대신 `viz.select.outline` 원색 1.5px** 로 그리고 있습니다(three.js 선 재질에 불투명도를 주면 겹친 선이 더 진해져 얼룩집니다). 이대로 괜찮은지 확인 부탁드립니다.
- **퍼블리셔 요청**: 없습니다. `kindShape()`·`ShapeSwatch`·`SceneLegend` 「모양 = 종류」 절·`SelectOption.adornment` 모두 그대로 썼고 중복 표기는 없습니다.
- **PM 요청**: AC-3D19·21 **실장비 측정**(3D 보기를 열고 콘솔에서 `__sentinel3d.frameStats()` / `renderStats()`)이 여전히 남아 있습니다. 이번에 `renderStats()`(드로콜·삼각형·조합)를 추가해 두었습니다.

### 9. 다음 담당이 알아야 할 점

- **모양 매핑은 `kindShape()`(퍼블리셔 `KindIcon.tsx`) 한 곳이다.** `graph/**` 에 종류 → 모양 표를 만들지 마세요. 엔진은 `SceneData.shapes`(블록 id → 모양)만 받고, `VizShape` 도 **타입만** 가져옵니다.
- **봉투 4u × 3u × 4u · 상단 평면 3u · `(0, 3u, 0)` 솔리드**를 어기는 순간 `fitCheck()` 값이 달라지고 카메라·라벨 실측값이 전부 무효가 됩니다. `shapes.test.ts` 가 먼저 깨지고, 실행 중에는 `__sentinel3d.shapeCheck()` 가 모양 id 를 돌려줍니다.
- 지오메트리는 **u 단위**로 만들고 엔진이 `w/4 · h/3 · d/4` 로 스케일합니다. 새 모양을 더할 때 정규화 좌표로 만들면 **밝기가 틀립니다**(비균등 스케일 → 법선 왜곡).
- three.js 를 import 하는 파일이 `scene/engine.ts` 하나에서 **`scene/engine.ts` + `scene/shapes.ts` 둘**로 늘었습니다. 둘 다 `scene/**` 안이고 `GraphTab` 이 `import()` 로만 부르므로 AC-3D01은 그대로입니다. **`scene/` 밖에서 `from "three"` 를 쓰지 마세요.**
- 히트 영역 메시(`pickGroups`)는 **장면에 없습니다**. 새 블록 종류를 추가하면 그리는 쪽과 집는 쪽 **두 군데**에 들어가야 합니다(`build()` 안에 나란히 있습니다).
- 모양 지오메트리는 모듈 캐시(`shapeGeometry()`)라 `clearContent()` 에서 **dispose 하지 않습니다**. 재질만 장면과 함께 버립니다.

---

## 2026-09-20 (9) · 카메라 유효 모서리 규칙 (4.9-3 「3-1)」) — 대규모 장면 첫 화면 비어 보임 수정

### 1. 요청 내용

PM 결정 + designer 문서화(`docs/design/snapshot-3d.md` 4.9-3 「3-1) 유효 모서리」, designer.md 2026-09-20 (8-2)):

- 유효 모서리 조건 **`d − sz_i ≥ max(near, 0.05 × d)`**. 조건을 못 넘는 모서리는 투영 사각형 계산에서 **뺀다**.
- 남은 모서리 `m ≥ 3` 이면 평소대로, **`m < 3` 이면 크기 조이기·중심 맞추기를 건너뛰고 직전 `d`·`target` 유지**(폭주 대신 안전한 실패). 그래도 `inside` 가 거짓이면 정보 줄 칩 `일부가 화면 밖`.
- `fitCheck()` 에 **`m`·`skipped`** 노출. `skipped: true` 면 `fit`·`fill`·`dx`·`dy` 를 기준 판정에서 제외한다.
- hover 윤곽 1.5px 원색은 designer 수용 — 수정 없음.

### 2. 작업 내용

- `engine.ts` `projectBounds()` 가 모서리마다 카메라 공간 깊이(`-z_cam` = `d − sz_i`)를 재고 **`max(camera.near, 0.05 × this.distance)` 미만이면 건너뛴다.** 남은 수를 `count`(= `m`), `ok = count ≥ 3` 로 돌려준다.
- `fitCamera()` 의 3회 반복과 `zoomToFitAll()` 의 2회 반복은 `!ok` 이면 **그 자리에서 멈춘다**(직전 `distance`·`target` 유지).
- `fitCheck()` 는 `m`·`skipped` 를 함께 돌려주고, `skipped` 면 `fit`·`fill`·`dx`·`dy` 를 0으로 두어 **기준 판정에 섞이지 않게** 한다.
- 카메라 규칙 밖(모양·라벨·배치)은 건드리지 않았다.

### 3. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/graph/scene/engine.ts` | 수정 | `projectBounds()` 유효 모서리 필터(`max(near, 0.05 d)`)·`m`/`ok`, `fitCamera()`·`zoomToFitAll()` 안전 중단, `fitCheck()` 에 `m`·`skipped` |

### 4. 검증 결과

| 확인 | 결과 |
|---|---|
| ① `large`(블록 3,264) 첫 화면 | **장면이 보인다**(`large-fixed-1440-light.png`). `fitCheck` = `m 4` · `skipped false` · `dx −406.6` · `dy −308.0` · `fit 0.629` · `inside false` · `offscreen true` → **유한한 값**(고치기 전 `dx ≈ −249,959` · `fit ≈ 984`) |
| 칩 · 복귀 | 정보 줄에 `일부가 화면 밖 — 전체가 보이게 축소` 칩이 뜨고, 누르면 **`m 8` · `dx 0.40` · `dy 0.14` · `fit 0.739` · `inside true`** 로 전체가 보인다(`large-fixed-fitall-1440-light.png`) |
| ② 기준 장면(mock `default`) | **`m: 8` · `skipped: false`** — `near`/`0.05 × d` 조건이 기준 장면을 하나도 걸러내지 않는다 |
| ③ 기준 장면 수치 | `fit` **1.0000471983726091** · `fillX` **0.9185386492889482** · `fillY` **0.8659682835094604** · `dx` **−0.013404882794191053** · `dy` **−0.0016727868213592956** — **고치기 전과 마지막 자리까지 동일** |
| ④ `shapeCheck()` | **`[]`** |
| lint · tsc · vitest | **0 problems · 통과 · 21 파일 / 455 테스트 통과** |
| `next build` · prettier | 돌리지 않음 |
| 시나리오 | 확인 뒤 **`default` 복구**(API `active = default` 확인) |

**덤으로 확인한 것 — backend 가 mock 에 `Job` 을 넣어 주어 (8) 보고의 미완 항목이 닫혔다**

- `batch` 판에 `Job report-backfill`(chamfer)과 `Deployment report-generator`(stack)가 **같은 판에** 있다. 실장면에서 **확실히 갈린다**: `pair-job-deployment-1440-light.png`(선택 상태) · `pair-job-deployment-nosel-1440-light.png`(선택 없음, 같은 줄에 chamfer·stack·roof 세 모양이 나란히). designer 대비책(`stack` 치수 조정 / `Job` → `box`)은 **필요 없다**.
- 이 리소스 때문에 기준 장면이 **블록 27 → 28** 이 됐다. 라벨 실측은 **이름 14 / 28 · `라벨 숨김` 14 · `표식 숨김` 0**(이름 수 14는 그대로, 늘어난 블록 1개가 숨김으로 갔다). `fitCheck()` 수치는 위와 같이 **변함없다**(판 크기가 그대로라 bbox 가 같다).
- 대규모 장면의 드로콜은 장면이 실제로 보일 때 **85**(판 64 + 블록 메시 8 + 블록 윤곽 8 + 격자·판 윤곽·관계선). (8) 보고의 21은 카메라가 장면 밖을 보던 상태라 판이 절두체 컬링된 수치였다 — **블록이 쓰는 드로콜 16개**가 실제 값이다.

### 5. 남은 이슈

- 대규모 장면의 첫 화면 `dx`·`dy` 가 −406 · −308px 이다(`m = 4`). 유효 모서리가 4개뿐이라 보정 반복이 수렴하지 않는다 — 장면은 보이고 칩으로 복귀도 되므로 **더 조이지 않았다.** 완전한 수렴이 필요하면 bbox 모서리 대신 **화면에 보이는 블록 앵커**로 사각형을 잡는 방법이 있다(4.9 규칙 변경이 필요해 designer 판단 사항).
- (8) 보고의 나머지 이슈(AC-3D19·21 실장비 측정, AC-3D22 묶어 보기)는 그대로다.

---

## 2026-09-20 (10) · backend mock 갱신(`Job` + 판 집계) 반영 확인 — 기준 장면 실측 최신화

### 1. 요청 내용

PM: backend 가 mock 에 `Job report-backfill`(`batch` 판)을 넣고 판 집계(`plates[].byLayer` 가 드리프트 유령을 빠뜨리던 것)를 고쳤다. ① K-1(`20260919-061000`) 하드코딩·픽스처 값 갱신(블록 34 / `drift=off` 33 · 선 28 · 비교 불가 5 · `ns:batch.resourceCount` 4, `byLayer` 는 backend 최종 수치 확인 후) ② `chamfer` 회귀 스크린샷은 `batch` 판의 `batch/Job/batch/report-backfill` ③ 기준 장면 실측(이름 /27 → /28)을 최신 값으로 보고. lint·typecheck·vitest 재확인.

### 2. 작업 내용

- **프론트에는 K-1 하드코딩이 없다**(확인 완료). `graph/model.test.ts` 는 합성 픽스처(`resourceCount: 1`, `byLayer: {}`)를 쓰고, 개수·판 집계는 전부 **응답 값을 그대로** 렌더한다(`countText`·`tableSummaryText`·`plateAnnouncement`). `features/__fixtures__/k8s-snapshots.ts` 에도 graph 픽스처가 없다. 그래서 **코드 변경 없음** — backend 최종 `byLayer` 수치가 또 바뀌어도 화면은 따라온다.
- 실제 응답이 기대대로 오는지 확인하고(아래), 회귀 스크린샷을 `batch` 판 기준으로 다시 찍었다.

### 3. 변경 파일

- 없음(코드). 이 보고서만 갱신.

### 4. 검증 결과

**서버 응답 (`GET …/20260919-061000/graph`, 확인 시점)**

| 항목 | 값 |
|---|---|
| 전체 블록 / 유령 | **34 / 9** |
| 전체 관계 (`edgesDefaultOn`) | **28** (15) |
| 비교 불가 | **5** |
| `ns:batch` `resourceCount` / `ghostCount` / `byLayer` | **4** / 1 / `{storage:1, workload:3, aux:1}` |
| `ns:prod` `byLayer` | `{storage:2, **workload:4**, service:2, ingress:2, aux:6}` — 판 집계 수정이 반영된 값 |
| `summary` | `blocks 34 · edges 28 · ghosts 9 · resourceBlocks 25 · driftMarkers 3 · scanMarkers 0` |

**화면 (기본 켬 집합 K1~K7 · 드리프트 겹쳐 보기 켬, 1440 × 900 라이트)**

| 자리 | 문구 |
|---|---|
| 정보 줄 · 도구 막대 A | `블록 28 · 관계 15`(그린 수) |
| 관계 표 요약 | `블록 28개(유령 3) · 관계 15개 · 드리프트 표식 3 · 스캔 표식 0` |
| 드리프트 겹쳐 보기 끔(`gdrift=0`) | `블록 27 · 관계 15` |

- 서버 전체(34/28)와 화면의 그린 수(28/15) 차이는 **기본 켬 집합이 K8~K11 유령을 숨기기 때문**이다(4.4 — "필터를 건 상태"로 세지 않는다). 규칙대로 동작한다.

**기준 장면 실측 최신화**

| 항목 | (8)·(9) 보고 | **지금** |
|---|---|---|
| 그린 블록 | 27 → 28 | **28** |
| 이름이 보이는 블록 | 14 / 27 → 14 / 28 | **14 / 28** |
| `라벨 숨김` | 13 | **14** |
| **`표식 숨김`** | 0 | **0** |
| `fit` · `fillX` · `fillY` · `dx` · `dy` | 1.0000472 · 0.9185386 · 0.8659683 · −0.0134 · −0.0017 | **완전히 동일** (`m: 8` · `skipped: false`) |
| `shapeCheck()` | `[]` | **`[]`** |
| `층 × 모양` 조합 | 10 | **11** (`workload/chamfer×1` 추가 = `Job`) |
| 드로콜 / 삼각형 | 30 / 1,020 | **32 / 1,040** |

- 블록이 하나 늘었지만 **이름이 보이는 수는 14 그대로**이고 늘어난 1개가 `라벨 숨김`(13 → 14)으로 갔다. 판 크기·bbox 가 그대로라(배치 격자에 빈 자리가 있었다) 카메라 수치는 변하지 않았다.

**`chamfer` 회귀 스크린샷 (designer 확인 ②)**

- `shots-3d/shapes/pair-job-deployment-1440-light.png`(`batch/Job/batch/report-backfill` 선택) · `pair-job-deployment-nosel-1440-light.png`(선택 없음). `batch` 판 한 줄에 **chamfer(`report-backfill`) · stack(`report-generator`) · roof(`nightly-report`)** 가 나란히 있고 실장면에서 확실히 갈린다.
- `scene-{1024,1440}-{light,dark}.png` 도 `Job` 이 들어간 장면으로 다시 찍었다.

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/web` | **통과 0 problems** |
| `npx tsc --noEmit -p apps/web` | **통과** |
| `npm test --prefix apps/web` | **통과 21 파일 / 455 테스트** |
| `next build` · prettier | 돌리지 않음 |
| 시나리오 | `default` 유지(이번에는 전환하지 않았다) |

### 5. 남은 이슈

- backend 가 `byLayer` 를 더 손보면 **화면은 코드 수정 없이 따라온다**(응답 값을 그대로 쓴다). 다만 판 라벨의 `리소스 N` 과 `aria-live` 문장이 그 값을 읽으므로, 최종 수치가 확정되면 **판 라벨 `리소스 11 · 유령 5`(prod)** 가 그대로인지만 눈으로 한 번 더 보면 된다.
- (9) 보고의 남은 이슈(대규모 첫 화면 `dx/dy` −406/−308, AC-3D19·21 실장비 측정, AC-3D22 묶어 보기)는 그대로다.
