# kops-support · publisher 작업 보고

> 파일 위치: `docs/reports/kops-support/publisher.md`
> 같은 기능에서 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 · 컨트롤 플레인 UI 컴포넌트 (ComponentMatrix + 기존 확장 3개)

### 1. 요청 내용

PM이 지정한 범위(표현 계층만, 데이터·상태 로직 없음):

1. **새 컴포넌트 `ComponentMatrix` 1개** — 마스터(열) × 필수 구성요소(행) 그리드. 왼쪽 머리 열 220px sticky, 셀 폭 `clamp(140, (가용 폭 − 220) ÷ N, 240)px`, 셀 48px + 간격 4px, 전체 높이 296px. **진짜 `<table>`**. 마스터 1~5대에서 무너지지 않고 6대 이상은 가로 스크롤.
2. **기존 컴포넌트 확장 3개** — `StatusCard.primarySub`, `SummaryStripItem.sub`/`subHref`, `ResourceName kind="cluster"`(앞 12자 + 뒤 8자 보존, sans). `Chip`·`SegmentedControl`은 props 변경 없음.
3. 아이콘 `server-cog` 추가, `CATEGORY_LABEL`에서 `eks` → `controlPlane`(`컨트롤 플레인`).

강조된 요구:
- **"보고 없음"과 "데이터 오래됨"이 시각적으로 확실히 갈릴 것**(빗금 + solid vs 빗금 없음 + dashed). 이 화면이 존재하는 이유.
- 새 토큰 금지, 데이터 로직 금지, 색만으로 구분 금지, 360~1440px에서 페이지 가로 스크롤 금지.
- 디자이너 확인 요청: 디자인 문서의 글자 폭은 근사치이므로 **카드 머리와 매트릭스 머리 열 220px을 실측으로 확인**할 것.

### 2. 참고한 문서

- `docs/design/components.md` — **18절 `ComponentMatrix`**, **19절 기존 확장**(19.1~19.5), 13절 아이콘
- `docs/design/cluster-status.md` — 3.1 레이아웃, **3.2.0~3.2.5 컨트롤 플레인 섹션**(셀 상태 7종 표·crit 3중 강조·상태별 모습), 4절 노드 상세의 열 1개 매트릭스
- `docs/design/status.md` — 1절(상태 4단계 + stale), 1.3(중립 칩 라벨), **2.5 "알 수 없음(보고 없음)" vs "데이터 오래됨"**, 5.2(정렬·비용 카테고리), 5.3(긴 이름·클러스터 예외), 7절(접근성)
- `docs/design/shell.md` — 2.1 긴 FQDN 클러스터 이름 처리
- `docs/reports/kops-support/designer.md` — 치수 근거, D1~D10, 남은 이슈 1~6
- `docs/reports/kops-support/README.md` — PM 결정 Q1~Q9
- `docs/reports/TEMPLATE.md`

### 3. 작업 내용

#### (1) `ComponentMatrix` (새 컴포넌트, `components/ui/cluster/`)

- **마크업**: `<table>` + `<caption class="sr-only">` + `<th scope="col">`(마스터) / `<th scope="row">`(구성요소). 셀은 `<td>` 안의 `<a>`(링크 있을 때) 또는 `<div>`이고, 셀 전체가 링크 영역(48px 높이 = hit 영역 32px 이상)이다.
- **폭 규칙을 CSS만으로** 구현했다(JS 측정 없음): `table-layout: fixed` + 첫 열 `width: 220px` + 표 `width:100%; min-width: calc(220px + N × 140px); max-width: calc(220px + N × 240px)`. fixed 레이아웃은 남는 폭을 열이 균등 분배하므로 셀 폭이 정확히 `clamp(140, (가용 폭 − 220) ÷ N, 240)px`이 된다. N은 인라인 CSS 변수 `--matrix-cols`.
- **높이**: 머리 40px + 5 × 48px + 행 사이 4px × 4 = **296px**(간격은 `tr + tr`의 `padding-top`으로 줘서 마지막 행 뒤에 여백이 생기지 않는다). 열 사이 4px은 `td`의 `padding-left`.
- **가로 스크롤**: 스크롤은 표 안에서만 일어난다(`overflow-x: auto`, `max-width: 100%`). 첫 열은 `position: sticky; left: 0`이고 **스크롤한 동안에만** 오른쪽 가장자리 그림자(`shadow.sm`)를 켠다. 넘칠 때만 요약 줄 오른쪽에 `가로로 스크롤할 수 있습니다` caption을 띄우고, 스크롤 컨테이너에 `tabIndex=0` + `role="group"`을 줘서 키보드로도 스크롤된다.
- **셀 상태 7종**을 `cluster-status.md` 3.2.3 표 그대로 그린다. 항상 **색 + 아이콘 모양 + 문구** 셋이 함께 나온다.
  | 상태 | 테두리 | 배경 | 아이콘 | 1행 |
  |---|---|---|---|---|
  | ok | 1px `border.subtle` | 없음 | `circle-check` | 서버 문구(`Ready`) |
  | warn | 1px `status.warn.border` | `status.warn.bg` | `triangle-alert` | 서버 문구 |
  | crit | **2px** `status.crit.border` | `status.crit.bg` | `octagon-x` | 서버 문구 |
  | unknown | 1px **solid** `status.unknown.border` | `status.unknown.bg` | `circle-help` | 서버 문구 |
  | **notReporting** | 1px **solid** `status.unknown.border` | `status.unknown.bg` + **45° 빗금** | `circle-help` | `노드 미보고` |
  | missing | 1px **dashed** `border.default` | 없음 | `minus`(text.tertiary) | `없음` |
  | **stale** | 1px **dashed** `status.stale.border` | **채움 없음** | `clock-alert` | `데이터 오래됨` |
- **두 회색의 구분**(요청의 핵심): 빗금은 `notReporting`에만 붙는다. 빗금은 기존 색(`status.unknown.border`) 1px 선을 6px 간격으로 반복한 채움 패턴이라 **새 토큰이 필요 없고 흑백·회색조에서도 갈린다.** 네 가지가 동시에 다르다 — ① 빗금 유무 ② 테두리 solid/dashed ③ 아이콘 `circle-help`/`clock-alert` ④ 보조 문구 `마지막 보고 04:58`/`14:02:10 기준`.
- **겹칠 때(staleAt + notReporting)**: 배지·테두리·문구는 stale이 가져가고 **빗금은 남긴다**(`.cell-stale.cellHatched`). 툴팁은 `마지막 상태: 노드 미보고 (마지막 보고 04:58)`. 끊긴 순간의 사실을 지우지 않는다는 `status.md` 2.5 규칙 그대로다.
- **crit 3중 강조**: ① crit 셀만 2px 테두리 + 채운 배경, ② crit이 있는 **행 머리·열 머리에 `octagon-x` 12px**, ③ 위 한 줄 요약의 `장애 N`. 머리 아이콘은 **축마다 하나**다 — 열 머리는 `worst(마스터 노드 상태, 그 열 셀들의 최악)`, 행 머리는 그 행 셀들의 최악이고, 최악이 `ok`면 아이콘을 그리지 않는다(정상은 조용하게). 열 머리 아이콘에는 `노드 주의 · 구성요소 알 수 없음` 툴팁을 단다.
- **한 줄 요약**: `필수 15칸 · 정상 13 · 주의 0 · 장애 1 · 알 수 없음 1`. 각 숫자 앞 12px 상태 아이콘, 0인 항목은 `text.disabled`. `onSummaryClick`이 있으면 0이 아닌 항목이 버튼이 되고, 누르면 그 상태 셀만 2000ms 외곽선(`status.<key>.solid`)으로 강조한다(`prefers-reduced-motion`이면 `steps(1,end)`로 켜고 끄기만).
- **클릭 규칙**: `notReporting`·`missing` 셀은 `href`가 와도 링크를 만들지 않고 `aria-disabled="true"` + 툴팁 사유만 남긴다.
- **상태**: `loading`(머리 40px + 5 × 48px 스켈레톤, `aria-busy`), `unknown`(표 대신 `UnknownState` sm + 서버 사유).
- **접근성**: 셀 스크린리더 문구는 `<구성요소>, <마스터>, <상태 문구>, <보조 문구>`(예 `kube-scheduler, i-0a1b2c3d4e5f6a7b8, 장애, CrashLoopBackOff · 재시작 4회`). 아이콘·시각 요소는 전부 `aria-hidden`. **실시간으로 바뀌는 영역이라 `aria-live`를 두지 않았다**(15칸이 매번 낭독되면 소음이 된다 — 전체 상태 낭독은 `SummaryStrip`이 이미 한다).
- **데이터 로직 없음**: 쿼럼·HA·Ready 수·셀 상태·요약 개수는 전부 props로 받은 서버 값이다. 화면이 하는 계산은 "서버가 준 상태들 중 나쁜 쪽 하나 고르기"(머리 아이콘)와 요약 숫자의 합(`필수 N칸`)뿐이고, 둘 다 새 판단을 만들지 않는다.
- 자동화·프론트가 쓸 수 있게 셀에 `data-cell-state` 속성을 둔다(`StatusBadge`의 `data-status`와 같은 방식).

#### (2) `StatusCard.primarySub` (19.1)

- `primary`(metricMd) 아래 caption 12/16 `text.secondary` 한 줄. `필수 구성요소 15/15`처럼 분모가 있는 비율을 위한 자리.
- `counts`와 **같은 자리**라 둘 다 오면 `primarySub`만 그리고 개발 모드에서 콘솔 경고를 낸다(문서 19.1 규정).

#### (3) `SummaryStripItem.sub` / `subHref` (19.2)

- 값 아래 caption 한 줄(`컨트롤 플레인 3/3`). 부제가 있는 칸은 최소 폭 120px → **150px**(≤1439px에서는 130px, ≤767px에서는 0 — 좁은 화면에서 가로 스크롤을 만들지 않는 쪽을 우선했다).
- `href`와 `subHref`가 **둘 다** 오면 `<a>` 중첩을 피하려고 칸 전체 링크를 쓰지 않고 값 줄만 링크로 만든다(부제는 별도 링크).

#### (4) `ResourceName kind="cluster"` (19.3)

- body 14/20 **sans**, 가운데 말줄임에서 **앞 12자 + 뒤 8자 보존**, `copyable` 기본 false.
- 구현: 이름을 `[앞 12자][줄어드는 가운데][뒤 8자]` 세 토막으로 나누고 가운데만 CSS로 자른다(`text-overflow: ellipsis`). 폭이 남으면 자르지 않는다.
- `keepHead` / `keepTail`을 함께 노출해 다른 kind도 조정할 수 있다. 기존 기본값(끝 16자 보존, 복사 버튼)은 그대로다.
- `tooltipExtra`를 더했다 — `shell.md` 2.1의 툴팁(전체 이름 + `Kubernetes v1.31.2 · ap-northeast-2`)을 상단바에서 쓸 수 있게 한 자리다. (상단바 적용 자체는 이번 지시 목록에 없어 손대지 않았다. 9절 참고.)

#### (5) 아이콘·라벨

- `server-cog` 추가(lucide-react 1.47에 `ServerCog`가 있어 대체 아이콘 `cpu`는 쓰지 않았다).
- **비용 카테고리 라벨**: `CATEGORY_LABEL`의 실제 정의는 `apps/web/src/features/aws-cost/CostTables.tsx`(프론트 영역)에 있어 직접 고치지 않았다. 대신 퍼블리셔 영역에 `components/ui/cost/costCategory.ts`를 만들어 `COST_CATEGORY_ORDER`(`… → controlPlane`), `COST_CATEGORY_LABEL`(`controlPlane: "컨트롤 플레인"`, `eks` 없음), `CONTROL_PLANE_KIND_ORDER`·`CONTROL_PLANE_KIND_LABEL`(`master_ec2` → `마스터 EC2` 등 5종)을 표로 두고, **프론트에 교체를 요청**했다(8절). 디자이너가 남긴 "프론트가 매핑 표를 한 곳에 둬야 한다"도 이 파일로 해결된다.

#### (6) 미리보기

- `components/ui/__preview__/ControlPlanePreview.tsx`를 만들어 `/dev/ui`에 붙였다: 마스터 3대(장애 1 + 보고 없음 1열 + 없음 1칸), 1대, 6대(가로 스크롤), 전체 stale, 로딩, 마스터 0대 + 카드 3종(primarySub) + 요약 띠 부제 + 중립 칩 5종 + 한계 안내 2줄.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/cluster/ComponentMatrix.tsx` | 추가 | 새 컴포넌트. `CellState` 7종, 셀·행·열 머리·요약·스크롤·loading·unknown |
| `apps/web/src/components/ui/cluster/cluster.module.css` | 추가 | 매트릭스 스타일(폭·높이·sticky·셀 상태 7종·빗금·강조). **새 토큰 0건** |
| `apps/web/src/components/ui/status/StatusCard.tsx` | 수정 | `primarySub` 추가, `counts`와 동시 사용 시 경고 |
| `apps/web/src/components/ui/status/SummaryStrip.tsx` | 수정 | `SummaryStripItem`에 `sub`·`subHref` 추가(링크 중첩 회피) |
| `apps/web/src/components/ui/status/status.module.css` | 수정 | `.cardPrimarySub`, `.stripItemWithSub`·`.stripSub`·`.stripSubLink`·`.stripItemHeadLink` + 반응형 |
| `apps/web/src/components/ui/table/ResourceName.tsx` | 수정 | `kind="cluster"`(앞 12 + 뒤 8, sans, 복사 없음), `keepHead`/`keepTail`, `tooltipExtra` |
| `apps/web/src/components/ui/table/table.module.css` | 수정 | `.rnKeptHead`·`.rnSans`·`.rnTooltipName`·`.rnTooltipExtra` |
| `apps/web/src/components/ui/icons.tsx` | 수정 | `server-cog`(lucide `ServerCog`) |
| `apps/web/src/components/ui/cost/costCategory.ts` | 추가 | 비용 카테고리·컨트롤 플레인 하위 종류 라벨 표(`eks` → `controlPlane`) |
| `apps/web/src/components/ui/index.ts` | 수정 | 18절 `ComponentMatrix`와 비용 라벨 표 export |
| `apps/web/src/components/ui/__preview__/ControlPlanePreview.tsx` | 추가 | 컨트롤 플레인 미리보기 |
| `apps/web/src/components/ui/__preview__/UiPreview.tsx` | 수정 | 위 미리보기 연결 |
| `apps/web/src/components/ui/__tests__/kops-support.test.tsx` | 추가 | 24개 테스트(마크업·접근성·두 회색 구분·crit 강조·열 수 1~6·확장 3개·라벨) |
| `docs/reports/kops-support/publisher.md` | 추가 | 이 보고서 |

`apps/web/src/app/**`, `features/**`, `charts/**`, `docs/design/**`, `apps/api/**`는 **건드리지 않았다.**

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| P1 | 셀 폭을 `table-layout: fixed` + 표의 `min-width`/`max-width`로 구현 | 셀마다 `width: clamp(140px, calc((100% - 220px)/N), 240px)` / JS로 폭 측정 | CSS의 `%`는 선언한 곳이 아니라 쓰는 요소의 컨테이닝 블록을 기준으로 풀려서 셀에 직접 `clamp`을 걸면 값이 어긋난다. fixed 레이아웃은 남는 폭을 균등 분배하므로 표 폭에 하한·상한만 주면 셀 폭이 정확히 clamp이 된다. JS 측정은 리사이즈마다 리렌더가 생기고 SSR에서 첫 프레임이 흔들린다 |
| P2 | 행 간격 4px을 `border-spacing`이 아니라 `tr + tr { padding-top }`로 | `border-collapse: separate; border-spacing: 4px` | `border-spacing`은 표 바깥 가장자리에도 간격을 넣어 총 높이가 296px이 아니라 300px+가 되고 sticky 열 배경에 틈이 생긴다 |
| P3 | 빗금을 `notReporting` **한 곳에만**, 색이 아닌 채움 패턴으로 | 두 회색을 다른 색으로 / 문구만 다르게 | 새 토큰 금지(D9)이고, 두 회색은 같은 팔레트라 명도 차가 작다. 빗금은 `repeating-linear-gradient`라 값이 필요 없고 흑백 출력·색각 이상에서도 남는다 |
| P4 | stale + notReporting이면 **테두리는 stale, 빗금은 유지** | 빗금 제거(stale이 전부 가져감) / 빗금 + solid 유지 | `status.md` 2.5: 배지는 stale이 이기지만 "보고 없음" 표식은 지우지 않는다. 빗금을 지우면 마스터가 죽은 사실이 화면에서 사라지고, 테두리까지 solid로 두면 "지금 보고가 없다"와 "화면이 못 받고 있다"가 섞인다 |
| P5 | 머리 아이콘은 `worst()`로 하나만 | crit 표식과 상태 아이콘을 둘 다 표시 | 문서 3.2.3의 "축마다 하나뿐" 규정. 두 개를 겹치면 무엇이 무엇을 가리키는지 흐려진다. `worst`는 서버가 준 상태 중 하나를 고르는 것이라 새 판단을 만들지 않는다 |
| P6 | 요약의 `필수 N칸`은 `summary` 숫자들의 합 | `cells.length` / 새 prop 추가 | 문서 18.1의 props에 합계가 없다. 셀 배열 길이를 세면 서버가 주지 않은 칸까지 세는 셈이 되고, 서버가 준 숫자의 합은 서버 값의 표시일 뿐이다 |
| P7 | `subHref`가 있으면 칸 전체 링크를 포기하고 값 줄만 링크 | `<a>` 안에 `<a>` | HTML에서 링크 중첩은 무효이고 스크린리더·키보드 순회가 깨진다. 값과 부제가 다른 곳으로 간다는 것이 19.2의 요구이므로 칸 전체 링크 쪽을 접었다 |
| P8 | `notReporting`·`missing` 셀은 `href`가 와도 링크를 만들지 않음 | 링크로 두고 `aria-disabled`만 | 미러 파드 상태를 믿을 수 없는 칸에서 파드 상세로 보내면 "Running"인 화면이 나와 오해를 키운다. 문서 3.2.3도 클릭 불가로 정했다 |
| P9 | 서버 `tooltip`이 없으면 `<1행 문구> · <2행 보조>`를 툴팁으로 대신 | 툴팁 없음 | 실측 결과 `CrashLoopBackOff · 재시작 4회`(micro 11)는 155px이라 최소 셀(140px)에서 잘린다. 잘린 문구에 닿을 길이 반드시 있어야 한다(6절 실측표) |
| P10 | 비용 라벨 표를 `components/ui/cost/costCategory.ts`에 새로 두고 프론트에 교체 요청 | `features/aws-cost/CostTables.tsx`를 직접 수정 | 그 파일은 **프론트 영역**이라 규칙상 손대지 않는다. 라벨은 표현 계층 값이므로 퍼블리셔 영역에 표를 두고 요청으로 넘기는 것이 역할 경계에 맞다 |
| P11 | 매트릭스에 `aria-live`를 두지 않음 | 셀 변화 낭독 | 15칸이 실시간으로 바뀌는 영역이라 낭독이 소음이 된다. 전체 상태 변화 낭독은 `SummaryStrip`이 이미 담당한다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과(0건) | |
| `npm run typecheck --prefix apps/web` | 통과 | |
| `npm run test --prefix apps/web` | **479개 전부 통과**(22 파일) | 새 파일 `kops-support.test.tsx` 24개 포함, 기존 455개 회귀 없음 |
| `npm run build --prefix apps/web` | 통과 | 18개 라우트 생성 |
| `next dev -p 3122` + `/dev/ui` SSR 확인 | 200, 콘솔 오류 없음 | 매트릭스 5개·셀 65칸·빗금 10칸·stale 15칸·`aria-disabled` 13개 렌더 확인. **띄운 PID 11660·14332만 종료**(이미지 이름 일괄 종료 안 함) |

**실측 확인 (디자이너 요청 사항)** — 이 컴퓨터에 Pretendard·JetBrains Mono가 설치돼 있지 않아 실제로 쓰이는 폰트는 **Malgun Gothic / Consolas**(폴백)다. 두 폰트 파일의 `hmtx`·`cmap`을 직접 읽어 문자열 폭을 계산했다(브라우저 렌더 픽셀 측정이 아니라 **폰트 메트릭 실측**이다).

| 문자열 | 크기 | 실측(Consolas/Malgun) | 디자인 근사치 | 판정 |
|---|---|---|---|---|
| `kube-controller-manager` (가장 긴 구성요소) | mono 12 | **151.7px** (JetBrains Mono면 158.4px) | 158px | 머리 열 220px에서 쓸 수 있는 폭은 220 − 오른쪽 12 − 아이콘 12 − 간격 4 = **192px**. **맞다**(여유 34~40px) |
| `etcd-manager-events` | mono 12 | 125.4px | - | 여유 |
| `i-0a1b2c3d4e5f6a7b8` (마스터 이름) | mono 12 | 125.4px | - | 셀 폭 240px에서 여유, 140px에서는 말줄임 |
| `컨트롤 플레인` (카드 제목 h3) | sans 16 | **101.6px** | 101px | **맞다** |
| 카드 머리 한 줄 합계(아이콘 20 + 8 + 제목 101.6 + 8 + `알 수 없음` md 배지 90.4) | - | **228.0px** | 235px | 디자이너의 결론(한 줄 6장 불가, 3 × 2 두 줄)이 **유지된다**(376px 카드에서는 여유) |
| `ap-northeast-2a · t3.medium` (열 머리 meta) | micro 11 | 143.6px | - | **셀 140px(내용 약 114px)에서 잘린다** → 툴팁을 달았다 |
| `CrashLoopBackOff · 재시작 4회` (셀 2행) | micro 11 | 155.2px | - | 같은 이유로 툴팁 보강(P9) |
| `마지막 보고 04:58` | micro 11 | 89.4px | - | 최소 셀에서도 들어간다 |
| `필수 구성요소 15/15` (primarySub) | caption 12 | 111.6px | - | 카드 376px·좁은 카드 모두 여유 |
| `컨트롤 플레인 3/3` (요약 띠 부제) | caption 12 | 98.4px | - | 부제 칸 최소 150px에서 들어간다 |

**폭 계산 확인(매트릭스)**

| 뷰포트 | 가용 폭(본문) | 마스터 3대 | 마스터 6대 |
|---|---|---|---|
| 1440px (SideNav 232 + 패딩 48) | 1160px | 셀 240(상한) → 표 940px, 스크롤 없음 | 셀 156 → 표 1156px, 스크롤 없음 |
| 1024px (SideNav 숨김) | 976px | 셀 240 → 940px, 스크롤 없음 | 표 최소 1060px > 976 → **표 안에서만 가로 스크롤 + 안내 caption** |
| 360px | 약 312px | 표 최소 640px → **표 안에서만 가로 스크롤**(페이지는 넘치지 않음) | 같음 |

**하지 못한 검증**
- **브라우저 픽셀 렌더 확인(360/768/1024/1440px 실제 화면)은 하지 못했다.** 이 환경에 헤드리스 브라우저(Playwright·Puppeteer)가 없어 SSR HTML·CSS 규칙·폰트 메트릭 계산으로만 확인했다. 가로 스크롤 여부는 CSS 규칙(`overflow-x: auto`, `max-width: 100%`, 표 `min-width`)과 위 계산에 근거한 판단이다.
- 빗금(`repeating-linear-gradient`)의 **실제 렌더 모습**도 같은 이유로 눈으로 보지 못했다. 클래스가 서로 겹치지 않는다는 것은 테스트로 고정해 뒀다(`cellHatched`는 `notReporting`에만, `cell-stale`에는 채움이 없음).
- 다크 테마는 토큰 변수만 쓰므로 자동으로 따라가지만, 역시 눈으로 확인하지 못했다.

### 7. 남은 이슈·한계

1. **실제 화면 확인이 필요하다.** 위 6절의 "하지 못한 검증" 3가지. 특히 **빗금 간격 6px이 48px 셀에서 너무 촘촘하거나 흐리게 보이지 않는지**는 사람 눈으로 한 번 봐야 한다(`/dev/ui` → "컨트롤 플레인 (kops-support)" 섹션).
2. 폰트가 **설치돼 있지 않다.** 이 프로젝트는 Pretendard·JetBrains Mono를 웹폰트로 싣지 않아(`apps/web/public` 없음) OS 폴백으로 렌더된다. 위 실측은 폴백(Malgun Gothic/Consolas) 기준이고, JetBrains Mono가 설치된 환경에서는 mono 문자열이 약 4% 넓어진다(그래도 220px 안). 웹폰트 도입 여부는 프론트 판단 사항이다.
3. **마스터 6대 이상**은 가로 스크롤로만 처리했다(디자인 그대로). 7대 이상에서 셀 문구를 1행으로 줄이는 변형은 만들지 않았다.
4. `summary`의 `알 수 없음` 항목은 `unknown`·`notReporting`·`missing` 셀을 **함께** 가리키도록 매핑했다(요약 축이 `Status` 5종뿐이라 `missing`이 들어갈 다른 칸이 없다). 서버가 `missing`을 다른 상태로 세고 있다면 강조가 어긋날 수 있다 — 백엔드 계약 확인이 필요하다(8절).
5. 열 머리 툴팁 문구는 `노드 <상태> · 구성요소 <상태>`로만 만든다. 디자인 예시(`노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5`)의 괄호 안 사유와 개수는 **props에 없어** 넣지 못했다. 필요하면 `columns[].reason` 같은 필드를 문서에 추가해야 한다(designer 요청).
6. `ResourceName.tooltipExtra`는 만들어 뒀지만 **상단바(TopBar)에는 아직 적용하지 않았다**(이번 지시 목록 밖). `shell.md` 2.1의 축소 순서(리전 → 버전 → 이름만 → 아이콘)도 구현 대상이 아니었다.

### 8. 다른 담당 요청

- **프론트 요청 ①**: `apps/web/src/features/aws-cost/types.ts`의 `CostCategory`와 `CostTables.tsx`의 `CATEGORY_ORDER`·`CATEGORY_LABEL`을 **`@/components/ui`의 `COST_CATEGORY_ORDER`·`COST_CATEGORY_LABEL`로 교체**해 주기 바란다(`eks` → `controlPlane`, 문구 `컨트롤 플레인`). 컨트롤 플레인 하위 종류 5종은 `CONTROL_PLANE_KIND_ORDER`·`CONTROL_PLANE_KIND_LABEL`을 쓰면 되고, 서버가 `label`을 주면 서버 값이 우선이다. 두 파일 모두 프론트 영역이라 손대지 않았다.
- **프론트 요청 ②**: `ComponentMatrix`의 `columns`는 **마스터 표와 같은 순서**로 넘겨야 한다(컴포넌트가 다시 정렬하지 않는다). `cells`는 칸마다 1개씩, 없는 칸은 서버 `missing`으로 채워서 넘긴다 — 빈 칸을 화면이 만들지 않는다.
- **프론트 요청 ③**: 노드 상세의 "컨트롤 플레인 구성요소" 카드는 같은 컴포넌트에 `columns` 1개만 넘기면 된다(열 수로 분기하지 않는다). `#control-plane` 앵커와 `scroll-margin-top: 96px`, 강조 2000ms는 페이지 쪽에서 붙인다.
- **백엔드 요청 ①**: 요약(`summary`)의 `알 수 없음` 개수에 `notReporting`과 `missing` 칸이 **모두 포함되는지** 확인해 주기 바란다. 화면은 그렇게 가정하고 강조 대상을 고른다(7절 4번).
- **백엔드 요청 ②**: 셀 `detail`은 **짧은 쪽부터**(사유 코드 먼저, 부가 설명 뒤) 채워 주기 바란다. 실측상 `CrashLoopBackOff · 재시작 4회`(155px)는 최소 셀 폭(140px)에서 잘린다. 잘려도 툴팁으로 전체를 볼 수 있게 해 뒀지만, 서버가 `tooltip`을 함께 주면 hover 문구가 더 정확해진다.
- **designer 요청 ①**: `components.md` 18.1의 `columns[]`에 **열 머리 툴팁용 사유**가 없다(`노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5`의 괄호 안). `reason?: string` 같은 필드를 넣을지 정해 주기 바란다. 지금은 상태 문구만으로 툴팁을 만든다.
- **designer 요청 ②**: 실측 결과 **머리 열 220px과 카드 머리 치수는 문서대로 맞다**(6절 표). 다만 열 머리 meta(`ap-northeast-2a · t3.medium`, micro 11 = 143.6px)와 crit 셀 2행 문구(155.2px)는 **최소 셀 폭 140px에서 잘린다.** 디자인 문서에 "meta·detail은 최소 폭에서 말줄임되고 툴팁으로 전체를 준다"를 명시해 주면 좋겠다(구현은 그렇게 해 뒀다). `docs/design/**`는 내 영역이 아니라 고치지 않았다.
- **PM 참고**: 새 토큰 0건, `tokens.json`·`docs/design/**` 미수정. `CATEGORY_LABEL` 교체는 프론트 영역이라 요청으로 넘겼다(위 프론트 요청 ①).

### 9. 다음 담당이 알아야 할 점

- **인터페이스 요약**

  ```ts
  type CellState = "ok" | "warn" | "crit" | "unknown" | "notReporting" | "missing" | "stale";

  <ComponentMatrix
    columns={{ id; name; meta?; status: Status; notReporting?; href? }[]}   // 마스터 표와 같은 순서
    rows={{ id; label }[]}                                                   // 필수 구성요소 5종, 서버 순서
    cells={{ columnId; rowId; state: CellState; label; detail?; href?; tooltip? }[]}
    summary={{ state: Status; count: number }[]}                             // 0인 항목도 넘긴다
    onSummaryClick={(state) => void}
    staleAt={IsoTime}                                                        // 있으면 전 셀 stale 모습
    state="ready" | "loading" | "unknown"
    unknownReason="컨트롤 플레인 노드를 찾을 수 없습니다"
    caption="컨트롤 플레인 구성요소 상태"                                      // 필수(스크린리더)
  />
  ```

  - `StatusCard`: `primarySub?: ReactNode` — `counts`와 **같이 쓰지 않는다**.
  - `SummaryStripItem`: `sub?: ReactNode`, `subHref?: string`.
  - `ResourceName`: `kind="cluster"`, `keepHead?`, `keepTail?`, `tooltipExtra?`.
  - 비용 라벨: `COST_CATEGORY_LABEL` / `CONTROL_PLANE_KIND_LABEL` (`@/components/ui`).
- **"노드 미보고"를 stale처럼 그리지 말 것.** 두 표현의 차이는 이 화면이 존재하는 이유다(빗금 + solid + `마지막 보고 HH:mm` vs 빗금 없음 + dashed + `HH:mm:ss 기준`). 테스트 `kops-support.test.tsx`의 "보고 없음 vs 데이터 오래됨" 4개가 이 규칙을 고정한다 — 실패하면 고치기 전에 `status.md` 2.5를 먼저 읽을 것.
- **매트릭스는 값을 계산하지 않는다.** 쿼럼·HA·Ready 수·셀 상태·요약 숫자는 전부 서버 값이다. 화면에서 "Running인데 노드가 NotReady네" 같은 추론을 하지 말 것(AC-KOPS21).
- 셀 상태별 확인은 `/dev/ui`의 "컨트롤 플레인 (kops-support)" 섹션에서 한 번에 볼 수 있다(3대·1대·6대·stale·로딩·0대).
- 셀에는 `data-cell-state` 속성이 있다. 페이지 테스트·E2E에서 클래스 대신 이 속성을 쓰면 CSS 모듈 해시에 영향받지 않는다.
- 매트릭스는 `aria-live`를 두지 않는다. 페이지에서 실시간 변화를 알릴 필요가 있으면 요약 띠 쪽에 붙일 것(같은 내용을 두 번 읽지 않게).

---

## 2026-09-24 (2) · 열 머리 툴팁에 `columns[].reason` 반영

### 1. 요청 내용

PM 전달: 디자이너가 내 요청 2건을 문서에 반영했고 **코드 변경이 필요한 것은 하나뿐**이다.

- `ComponentMatrix`의 `columns[]`에 **`reason?: string`**(마스터 노드 상태의 서버 사유 한 줄, 마스터 표의 `사유` 열과 같은 값)을 받아 열 머리 툴팁 문장을 조립할 것.
- 조립 규칙(`components.md` 18.1에 고정됨): `노드 <상태 문구>[ (<reason>)] · 구성요소 <그 열 최악 상태 문구>[ <같은 상태 칸 수>]`
  - `reason`이 없으면 괄호를 통째로 뺀다.
  - 칸 수는 **새 prop 없이 그 열의 셀을 세어** 만든다(서버가 준 상태를 세는 것이라 `worst()`와 같은 부류).
  - 열 머리 아이콘이 `ok`면 그리지 않는다.
- **손대지 말 것**: 최소 폭 말줄임 + 툴팁 보강은 이미 구현한 대로 확정. stale + 보고 없음 겹침 처리도 내 구현이 그대로 규칙이 됨. **빗금 6px 간격의 눈 확인은 PM 추적 목록으로 넘어갔으므로 지금 조정하지 않는다.**

### 2. 참고한 문서

- `docs/design/components.md` 18.1 — 갱신된 `columns[]` 표(`reason?` 추가), **열 머리 툴팁 문구 조립 규칙**, 최소 셀 폭 말줄임 표(내 실측값이 문서에 실림)
- 1차 작업 보고(위 섹션)

### 3. 작업 내용

- `ComponentMatrixColumn`에 `reason?: string` 추가.
- 툴팁 조립을 순수 함수 **`columnTooltip(column, cellSummary)`** 로 분리하고 export 했다(문구 규칙만 따로 테스트할 수 있게, 프론트가 다른 자리에서 같은 문장을 쓸 수 있게).
- 열 집계에 `worstCount`(그 열에서 `cellWorst`와 같은 상태인 칸 수)를 더했다. 기존 `worst()` 계산과 같은 루프에서 세므로 순회가 늘지 않는다.
- 열 머리 아이콘의 스크린리더 문구(`title`)를 조립된 문장 그대로로 바꿨다. 이전에는 `주의: 노드 주의 (…)`처럼 상태 이름이 앞에 한 번 더 붙었는데, 문장 자체가 노드·구성요소 두 상태를 모두 말하므로 중복이었다.
- 미리보기(`ControlPlanePreview`)의 보고 없음 마스터에 `reason: "NotReady 4분"`을 넣어 디자인 예시 문장이 실제로 나오는지 확인할 수 있게 했다.

**조립 결과(실제 렌더 확인)**

| 상황 | 문장 |
|---|---|
| 노드 warn + reason + 셀 5칸 보고 없음 | `노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5` (문서 예시와 일치) |
| 노드 ok + 장애 셀 1칸 | `노드 정상 · 구성요소 장애 1` (문서 예시와 일치) |
| 노드 ok + `없음` 칸 1개 | `노드 정상 · 구성요소 알 수 없음 1` |
| reason 없음 | `노드 주의 · 구성요소 주의 2` (괄호 통째로 빠짐) |
| 노드 ok + 셀 전부 정상 | `노드 정상 · 구성요소 정상` + **아이콘 자체를 그리지 않음** |

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/cluster/ComponentMatrix.tsx` | 수정 | `ComponentMatrixColumn.reason` 추가, `columnTooltip()` 분리·export, 열 집계에 `worstCount`, 아이콘 `title` 중복 제거 |
| `apps/web/src/components/ui/index.ts` | 수정 | `columnTooltip` export |
| `apps/web/src/components/ui/__preview__/ControlPlanePreview.tsx` | 수정 | 보고 없음 마스터에 `reason: "NotReady 4분"` |
| `apps/web/src/components/ui/__tests__/kops-support.test.tsx` | 수정 | 툴팁 조립 describe 4개 추가(총 24 → 28개) |
| `docs/reports/kops-support/publisher.md` | 수정 | 이 섹션 추가 |

CSS 변경 없음, 새 토큰 없음. 빗금 간격은 **지시대로 건드리지 않았다.**

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| P12 | 최악이 `ok`면 칸 수를 붙이지 않음(`노드 정상 · 구성요소 정상`) | 항상 붙임(`구성요소 정상 5`) | 문서 규칙의 칸 수는 `[ ]`로 **선택**이고, 예시 2개는 모두 문제 상태에만 숫자가 붙어 있다. "정상은 조용하게"(`status.md` 1절·`cluster-status.md` 3.2.3)와도 맞다. 다만 문서가 ok일 때를 명시하지는 않아 **해석**이다(7절) |
| P13 | 툴팁 조립을 순수 함수로 분리·export | 컴포넌트 안 인라인 문자열 | 문구 규칙이 문서에 문장으로 고정됐으므로 그 규칙만 단위 테스트로 못 박는 편이 회귀에 강하다. 프론트가 마스터 표 쪽에서 같은 문장을 쓰고 싶을 때도 한 곳에서 가져간다 |
| P14 | 칸 수를 기존 `worst()` 루프에서 함께 계산 | 새 prop(`columns[].counts`) 요구 | PM 지시대로 새 prop 없이. 서버가 준 상태를 세는 것이라 새 판단이 아니다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과(0건) | |
| `npm run typecheck --prefix apps/web` | 통과 | |
| `npm run test --prefix apps/web` | **483개 전부 통과**(22 파일) | `kops-support.test.tsx` 28개(툴팁 4개 신규), 기존 회귀 없음 |
| `npm run build --prefix apps/web` | 통과 | |
| `next dev -p 3122` + `/dev/ui` 렌더 문자열 확인 | 통과 | 실제 SSR HTML의 `aria-label`에서 세 문장을 그대로 확인(위 3절 표). **내가 띄운 PID 23220과 그 부모(next dev -p 3122)만 종료**, 이미지 이름 일괄 종료 안 함 |

**하지 못한 검증**: 1차와 같다. 헤드리스 브라우저가 없어 **툴팁이 실제로 뜨는 모습(hover 400ms 지연, 위치 보정)과 빗금 렌더는 눈으로 보지 못했다.** 툴팁 문구 자체는 `aria-label`로 DOM에 들어가 있어 확인했다.

### 7. 남은 이슈·한계

1. **`구성요소 정상`일 때 칸 수를 뺀 것은 해석이다**(P12). 문서에 ok일 때가 명시돼 있지 않다. 디자이너가 "항상 붙인다"로 정하면 한 줄(`cellWorst !== "ok"` 조건)만 지우면 된다.
2. 열 머리 툴팁은 **상태 아이콘에 붙어 있다.** 아이콘은 `ok`면 그리지 않으므로(문서 규칙) **전부 정상인 열에는 툴팁 트리거가 없다.** 지금은 알릴 것이 없는 상태라 문제가 아니지만, 나중에 정상 열에도 문장을 보여 주려면 트리거 자리를 따로 정해야 한다(열 머리 전체에 걸면 `ResourceName`의 이름 툴팁과 겹친다).
3. 빗금 6px 간격의 눈 확인은 **PM 추적 목록**으로 넘어갔다(지시대로 조정하지 않음).

### 8. 다른 담당 요청

- **프론트 요청**: `columns[].reason`에는 **마스터 표 `사유` 열과 같은 서버 문자열**을 그대로 넘겨 주기 바란다(화면이 다시 만들지 않는다). 같은 문장을 다른 자리에서 써야 하면 `columnTooltip()`을 `@/components/ui`에서 가져다 쓰면 된다.
- 1차 작업의 요청(프론트 ①~③, 백엔드 ①②)은 **그대로 유효**하다. 특히 비용 `CATEGORY_LABEL` 교체(`eks` → `controlPlane`)는 아직 프론트 영역에 남아 있다.
- **designer 요청(1차)**: 두 건 모두 문서에 반영됐음을 확인했다. 추가 요청 없음(위 7절 1번만 확인해 주면 좋다).

### 9. 다음 담당이 알아야 할 점

- `ComponentMatrixColumn`에 `reason?: string`이 늘었다. 나머지 props는 1차와 같다.
- 툴팁 문구는 `columnTooltip(column, { cellWorst, worstCount })`로 만든다(export됨). 문구 규칙을 바꾸려면 이 함수와 `kops-support.test.tsx`의 "열 머리 툴팁 조립" 4개만 고치면 된다.
- 열 머리 아이콘의 `aria-label` = 그 툴팁 문장이다. 스크린리더 사용자는 hover 없이 같은 정보를 얻는다.

---

## 2026-09-24 (3) · `ResourceName` 넘침 수정 + 상단바 FQDN 적용 (실제 브라우저 검증)

### 1. 요청 내용

PM 전달(프론트가 Playwright + Edge로 찾은 문제 2건 + 미완 1건). 상세 치수는 `docs/reports/kops-support/frontend.md` 8절.

1. **`ResourceName kind="cluster"` 넘침(우선)**: 남는 폭이 앞 12자 + 뒤 8자보다 좁으면 **상자 밖으로 삐져나와 옆 글자와 겹친다**(360px 개요에서 재현, 스크린샷 확보). 보존 글자 수를 줄이지 말고 **폭이 부족할 때의 동작을 정의**할 것. 구체적 처리는 퍼블리셔 판단.
2. **상단바 FQDN 적용(`shell.md` 2.1)**: `TopBar`가 클러스터 정보를 문자열로 그려 `ResourceName kind="cluster"`·`tooltipExtra`·축소 순서가 미적용. 실측 문제 ⓐ 768px에서 리전이 툴팁 없이 잘림 ⓑ **767px 이하에서 클러스터 정보가 통째로 사라지고 `circle-help` 대체가 없음(가장 큼)** ⓒ 긴 이름이 가운데가 아니라 끝에서 잘림.
3. 참고: 프론트가 **설치된 Edge를 Playwright `channel: "msedge"`로** 구동해 브라우저 다운로드 없이 실제 픽셀을 봤다. 내가 "헤드리스 브라우저가 없어 못 봤다"고 한 것들(빗금 6px 간격, 툴팁)을 같은 방법으로 확인해 볼 것.
4. 빗금 간격 숫자 자체는 PM 추적 목록이므로 **지금 조정하지 말 것**.

### 2. 참고한 문서

- `docs/reports/kops-support/frontend.md` 6·7·8절 — 실측표(가용 폭 768 → 257px, 767 → 0px, 이름 폭 138~292px), 퍼블리셔 요청 ①②
- `docs/design/shell.md` 2.1 — 이름 최대 폭 240/200/160px, 축소 순서(리전 → 버전 → 이름만 → `circle-help`), 툴팁 내용
- `docs/design/components.md` 19.3, `docs/design/status.md` 5.3 — 클러스터 이름 예외
- 1·2차 작업 보고(위 두 섹션)

### 3. 작업 내용

#### (1) 실제 브라우저 검증 경로 확보

스크래치패드에 `playwright`만 설치하고 **이미 깔린 Edge**(`channel: "msedge"`)로 `http://localhost:3122`를 띄워 확인했다(리포지터리 변경 없음, 브라우저 다운로드 없음). 확인 항목: 계산 스타일(배경·테두리), 요소 박스 치수, 넘침(px), 문서·헤더 `scrollWidth`, 툴팁 실제 표시, 스크린샷(3배 확대·회색조 포함).

**이 방법으로 눈으로 확인하고 나서야 찾은 결함이 3개 있다.** 아래 (2)·(3)·(4)가 전부 그 결과다.

#### (2) `ResourceName` 넘침 — 구조를 세 토막에서 두 토막으로 되돌렸다

- **원인**: `kind="cluster"`를 `[앞 12자(shrink 0)][가운데(shrink)][뒤 8자(shrink 0)]` 세 토막으로 그렸고 `.rnVisual`에 `overflow`가 없었다. 폭이 모자라면 shrink 0인 두 토막이 상자 밖으로 나갔다.
- **1차 시도(세 토막 유지 + 앞 토막도 줄이기)**: `.rnVisual { overflow: hidden }`으로 새는 것은 막았지만, Edge 실측에서 **말줄임이 두 번** 나왔다 — `prod-ap-n… heast… mple.com`. 앞 토막이 0.06px만 넘쳐도 `text-overflow: ellipsis`가 켜져 글자 세 개를 `…`로 바꾸기 때문이다(shrink 계수를 999로 줘도 몫이 한 레이아웃 단위 1/64px보다 크다).
- **2차 시도(shrink 계수 0.001)**: 실패. flexbox 규칙상 **줄임 계수 합이 1 미만이면 부족분의 그만큼(0.1%)만 분배**돼(CSS Flexbox 9.7.4) 가운데가 0이 된 뒤에도 앞 토막이 줄지 않고 32~72px이 잘려 나갔다(뒤 8자가 통째로 사라짐).
- **채택**: **두 토막으로 되돌렸다**(`[앞 토막(줄어듦·끝에서 말줄임)][뒤 8자(고정)]`). 앞 토막은 **끝에서** 잘리므로 잘림은 언제나 이름 가운데에서 일어나고, 앞 글자는 폭이 허락하는 만큼 그대로 남는다. 세 토막이 주던 이점은 없었다(보이는 문자열이 같다) — 이중 말줄임만 만들었다.
- 실측(상자 폭별, 긴 이름 `prod-ap-northeast-2.platform.k8s.example.com` 292px):

  | 상자 | 결과 | 넘침 |
  |---|---|---|
  | 320px | `prod-ap-northeast-2.platform.k8s.example.com`(전체) | 0 |
  | 200px | `prod-ap-northeast…mple.com`(앞 17자 남음) | **0** |
  | 120px | `prod-…mple.com` | **0** |
  | 80px | `p` + `mple.com`(`…`가 들어갈 자리도 없음, 7절 3번) | 0 |
- `keepHead` prop은 **없앴다**(아래 5절 P17, designer 요청).

#### (3) 상단바(`TopBar`) — `ResourceName` + 컨테이너 쿼리 축소 + `circle-help` 대체

- 클러스터 이름을 `ResourceName kind="cluster"`로 바꾸고 `tooltipExtra`에 `Kubernetes <버전> · <리전>`을 넣었다(`shell.md` 2.1 툴팁).
- **축소 순서를 컨테이너 쿼리로** 구현했다. `.clusterInfo { container-type: inline-size }` → 뷰포트가 아니라 **그 블록에 남는 폭**을 기준으로: 320px 미만이면 리전, 240px 미만이면 버전을 접고, 160px 미만이면 문구를 통째로 접고 `circle-help`만 남긴다. 미디어 쿼리로는 "남는 폭"을 알 수 없어(오른쪽 영역 폭이 데이터에 따라 변한다) 컨테이너 쿼리를 골랐다.
- **767px 이하에서 블록을 숨기지 않는다.** 대신 폭을 버튼 하나(24px)로 줄이면 위 컨테이너 쿼리가 자동으로 `circle-help`만 남긴다. 버튼의 `aria-label`·툴팁은 `클러스터 prod.k8s.example.com · v1.31.2 · ap-northeast-2`로 **버린 값 세 개를 모두** 담는다(ⓑ 해소).
- 이름 최대 폭 240/200/160px은 미디어 쿼리로 준다(뷰포트 기준이라 문서와 같다).
- **낭독은 한 문장으로 한 번만**: `.clusterText` 안에 `sr-only` 전체 문장을 두고 눈으로 보는 줄은 `aria-hidden`으로 감쌌다. 폭 때문에 화면에서 접힌 리전·버전도 스크린리더에는 남는다.
- 360px에서 상단바가 7px 넘치는 것을 실측으로 잡아(대체 버튼 32px + 간격이 늘어난 탓) ⓐ 대체 버튼 자리를 24px로, ⓑ 479px 이하 상단바 좌우 여백을 12 → 8px로 줄였다. 이후 **360·480px에서 헤더 넘침 0**.

#### (4) `ComponentMatrix` — 브라우저에서만 보인 결함 2개 수정

- **셀이 칸 폭을 채우지 않았다**: 셀 박스가 240px 칸 안에서 **73px**(글자 폭)로 쪼그라들어 있었다. `Tooltip`이 감싸는 `.tooltipAnchor`(`display: inline-flex`)가 내 `.cellAnchor`(`display: block`)를 이겨서다(CSS 모듈 파일 순서는 보장되지 않는다). 두 클래스 선택자로 특이도를 올려 고쳤다 → **셀 236px**(240 − 간격 4).
- **장애 셀의 2행이 잘렸다**: 줄 사이 `gap: 2px` 때문에 내용이 50px이 되어 48px 셀(장애는 테두리 2px이라 내용 44px)을 넘겼다. gap을 없애고(8 + 16 + 14 + 8 + 테두리 2 = 48 정확히), 장애 셀만 세로 패딩을 1px 줄였다. 이제 `scrollHeight == clientHeight == 44`.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/table/ResourceName.tsx` | 수정 | 세 토막 → 두 토막, `keepHead` prop 제거, kind 기본값 표 정리 |
| `apps/web/src/components/ui/table/table.module.css` | 수정 | `.rnVisual { overflow: hidden }`(넘침 차단), `.rnKeptHead` 삭제, `.rnHead` 주석 |
| `apps/web/src/components/ui/shell/TopBar.tsx` | 수정 | `ResourceName kind="cluster"` + `tooltipExtra`, 버전·리전 분리 span, `sr-only` 한 문장 + `aria-hidden` 시각 줄, `circle-help` 대체 버튼 |
| `apps/web/src/components/ui/shell/shell.module.css` | 수정 | `container-type: inline-size` + 축소 순서 3단계, 이름 최대 폭 240/200/160, `.clusterFallback`, 767 이하 블록 유지(24px), 479 이하 여백 8px |
| `apps/web/src/components/ui/cluster/cluster.module.css` | 수정 | `.matrixCellTd .cellAnchor`(칸 폭 채우기), 셀 `gap` 제거, 장애 셀 세로 패딩 |
| `apps/web/src/components/ui/__preview__/ControlPlanePreview.tsx` | 수정 | 긴 FQDN을 320/200/120/80px 상자에서 보여 주는 확인용 행 추가 |
| `apps/web/src/components/ui/__tests__/kops-support.test.tsx` | 수정 | `ResourceName` 두 토막 규칙으로 기대값 갱신(`keepHead` 테스트 → `keepTail`) |
| `docs/reports/kops-support/publisher.md` | 수정 | 이 섹션 추가 |

`features/**`·`app/**`·`docs/design/**`는 건드리지 않았다.

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| P15 | `.rnVisual { overflow: hidden }`(모든 kind 공통) | 클러스터 kind에만 적용 | 같은 구조라 파드·노드 이름도 상자보다 좁아지면 똑같이 새어 나간다. 막는 쪽이 항상 옳고, 전체 이름은 어차피 툴팁·`sr-only`에 있다 |
| P16 | 앞 보존을 **한 토막의 끝 말줄임**으로 | 세 토막 + shrink 계수 조정(999 / 0.001) | 계수 999는 이중 말줄임, 0.001은 flexbox 9.7.4(계수 합 < 1이면 부족분을 그 비율만 분배) 때문에 뒤 8자가 잘렸다. 두 토막은 보이는 문자열이 같으면서 두 결함이 모두 없다 |
| P17 | `keepHead` prop **제거** | 문서대로 유지(no-op) | 두 토막 구조에서는 동작이 없는 prop이 된다. 쓰는 곳이 0곳이라 지금이 지울 수 있는 유일한 시점이다. 문서 19.3 갱신을 designer에 요청했다(8절) |
| P18 | 상단바 축소를 **컨테이너 쿼리**로 | 미디어 쿼리 / JS 측정 | 버려야 할 값은 뷰포트가 아니라 "이 블록에 남는 폭"으로 정해진다(오른쪽 영역 폭이 MOCK 배지·연결 상태에 따라 변한다). JS 측정은 리사이즈마다 리렌더가 생긴다 |
| P19 | 767px 이하에서 블록을 **숨기지 않고 24px로 줄인다** | 기존처럼 `display: none` + 로고 옆에 별도 버튼 | 컨테이너 쿼리는 그 컨테이너 **안쪽**에만 걸리므로, 대체 버튼이 블록 밖에 있으면 "가용 폭 160px 미만" 조건을 CSS로 알 수 없다. 블록을 남기면 좁아짐 규칙 하나로 두 경우(≤767px·좁은 가용 폭)가 같이 풀린다 |
| P20 | 상단바 낭독을 `sr-only` 한 문장 + 시각 줄 `aria-hidden` | 조각마다 읽게 두기 | 이름·버전·리전이 세 조각으로 나뉘어 따로 읽히고, `ResourceName` 안의 `sr-only`와 겹쳐 이름을 두 번 읽는다. 한 문장이면 **화면에서 접힌 값도 낭독에는 남는다** |
| P21 | 479px 이하 상단바 여백 12 → 8px | 연결 표시·MOCK 배지를 줄임 | 두 요소는 `status.md` 2.3·2.4가 모양을 정한 것이라 손대면 규칙을 깬다. 여백은 셸의 재량이고 360px에서 7px이 모자랐다 |
| P22 | `.cellAnchor`를 두 클래스 선택자로 | `!important` / Tooltip에 `as="div"` prop 추가 | `!important`는 다음 사람이 이유를 알 수 없다. Tooltip API를 넓히면 다른 사용처의 회귀 범위가 커진다 |

### 6. 검증 결과

| 명령·항목 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과(0건) | |
| `npm run test --prefix apps/web` | **496개 전부 통과**(22 파일) | 프론트가 늘린 13개 포함. 상단바 마크업을 바꾸면서 `features/pages.test.tsx`의 문구 검색이 깨졌는데, **낭독용 한 문장(P20)을 넣으면서 함께 통과**했다(남의 테스트를 고치지 않았다) |
| `npm run build --prefix apps/web` | 통과 | `Compiled successfully` |
| `npm run typecheck --prefix apps/web` | **실패 7건 — 전부 `features/**`(프론트 영역), 내 영역 0건** | 프론트가 **지금 동시에** `aws-cost/types.ts`(`CostCategory`에서 `eks` 제거)·`cluster-status/types.ts`(`controlPlane` 필수)를 바꾸는 중이고 `fixtures.ts`·`CostTables.tsx`가 아직 안 맞는다. 두 번 돌리는 사이 줄 번호가 302 → 311로 움직여 진행 중임을 확인했다. 내 변경 전(1·2차)에는 통과했고, 오류 메시지에 `components/ui`는 **0건**이다 |
| 실제 브라우저(Edge, Playwright) | 아래 표 | 스크래치패드에만 설치, 리포지터리 변경 없음 |

**매트릭스 실측(1440px, 마스터 3대)**

| 항목 | 값 | 문서 |
|---|---|---|
| 표 전체 | 940 × 296px | 940 × 296 ✓ |
| 머리 행 / 머리 열 | 40px / 220px | 40 / 220 ✓ |
| 셀 | 높이 48px, 폭 236px(칸 간격 240) | 48 / clamp(140,…,240) ✓ |
| 행 간격 | 4px | 4 ✓ |
| 6대 매트릭스 칸 폭 | 1440px에서 156.7px(스크롤 없음) / 1024·768·360px에서 140px + **표 안 가로 스크롤** | clamp 하한 140 ✓ |

**"보고 없음" vs "데이터 오래됨" (계산 스타일 + 3배 확대 스크린샷 + 회색조 스크린샷)**

| 셀 | 배경 | 테두리 |
|---|---|---|
| 보고 없음 | `repeating-linear-gradient(45deg, #CDD2D9 0 1px, transparent …)` + `#EEF0F3` | **solid** 1px `#CDD2D9` |
| 데이터 오래됨 | **none** + `#FFFFFF` | **dashed** 1px `#B8BFC9` |
| 오래됨 + 보고 없음(겹침) | **빗금 유지** + `#EEF0F3` | dashed 1px `#B8BFC9`(stale이 가져감) |

- **빗금 6px 간격은 48px 셀에서 또렷하게 읽힌다**(3배 확대·회색조 모두 확인). PM 추적 항목대로 **숫자는 건드리지 않았다.** 지금 값으로 충분하다는 것이 내 판단이다.
- 회색조에서도 빗금 열이 한눈에 갈리고, 장애 셀은 2px 테두리 + 채움으로 구분된다.
- 툴팁이 실제로 뜨는 것을 확인했다: 셀 `마스터가 NotReady라 …(마지막 보고 04:58)`, 열 머리 `노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5`.

**상단바 실측(Edge)**

| 폭 | 가용 폭 | 표시 | 헤더 넘침 |
|---|---|---|---|
| 1440 / 1280 / 1024 / 900 | 864 / 704 / 404 / 389px | 이름 · 버전 · 리전 | 0 |
| 768 | 257px | 이름 · 버전 (**리전 접힘**, 값은 툴팁·낭독에 남음) | 0 |
| 600 / 480 / 360 | 24px | **`circle-help` 버튼만**, 툴팁·`aria-label` = `클러스터 <이름> · <버전> · <리전>` | 0 |

- `/`·`/cluster/nodes` 360·480px: 문서·헤더 **가로 스크롤 0**.
- 이름 조각이 상자 밖으로 새는 양: **모든 폭에서 0px**(수정 전 360px에서 겹침 재현됨).

**하지 못한 검증 / 남은 것**
- 다크 테마는 토큰만 쓰므로 자동으로 따라가지만 **눈으로 보지 않았다.**
- `/dev/ui`는 360px에서 문서 가로 스크롤이 있다(412px). **내 컴포넌트 때문이 아니다** — 컨트롤 플레인 섹션과 매트릭스를 모두 숨겨도 412px 그대로다. 범인은 `CommandSteps`/`CommandLine`(스냅샷 미리보기의 긴 명령 줄)이고, 내 영역이지만 이번 작업 범위 밖이라 손대지 않았다(7절 2번).
- `apps/api` 연동 확인은 하지 않았다(백엔드가 P3·P4 작업 중, 내 영역도 아님).

### 7. 남은 이슈·한계

1. **`typecheck`가 지금 빨갛다 — 프론트가 편집 중인 파일 때문이다.** 내 영역 오류는 0건이다. 프론트 작업이 끝나면 자동으로 풀린다(맞추려면 `features/aws-cost/CostTables.tsx`·`__fixtures__/fixtures.ts`를 새 `CostCategory`·`ClusterSnapshot`에 맞추면 된다 — 프론트 영역이라 손대지 않았다).
2. **`/dev/ui` 360px 가로 스크롤(412px)은 `CommandLine`/`CommandSteps`에 있다.** 내 영역이고 미리보기에서만 보이지만, 같은 컴포넌트를 스냅샷 화면이 쓰므로 실제 화면에서도 긴 명령이 들어오면 재현될 수 있다. 별도 작업으로 잡아 주기 바란다(원하면 다음 차례에 고치겠다).
3. **이름 상자가 약 90px보다 좁으면 `…`가 들어갈 자리도 없어** 앞 글자 한두 개가 표식 없이 남는다(`p` + `mple.com`). `shell.md` 2.1은 그 전에 `circle-help`로 넘어가고 표의 이름 열 최소 폭은 240px이라 실제 화면에서는 걸리지 않지만, 아주 좁은 자리에 이 컴포넌트를 쓸 때는 최소 폭 120px을 지켜 주기 바란다.
4. `container-type: inline-size`는 Edge/Chrome 105+, Safari 16+에서 동작한다. 더 낮은 브라우저에서는 축소 규칙이 걸리지 않고(리전·버전이 그대로) 기존처럼 말줄임된다 — 레이아웃이 깨지지는 않는다.
5. 빗금 간격 6px은 **PM 추적 항목**이라 값을 바꾸지 않았다. 내 눈(3배 확대·회색조)으로는 충분히 또렷하다.

### 8. 다른 담당 요청

- **designer 요청**: `components.md` 19.3에서 **`keepHead?: number`를 빼 주기 바란다.** 앞 12자를 `flex-shrink: 0`인 별도 토막으로 두면 ① 말줄임이 두 번 나오거나(`prod-ap-n… heast… mple.com`) ② flexbox 규칙(계수 합 < 1) 때문에 뒤 8자가 통째로 잘린다 — 둘 다 Edge 실측으로 확인했다. 한 토막의 **끝 말줄임**이면 잘림이 이름 가운데에서 일어나고 앞 글자는 폭이 허락하는 만큼 남아 **문서가 의도한 모습과 보이는 결과가 같다**(상자가 12자 + 8자 폭이면 앞 12자가 그대로 남는다). 문구 예: "앞 12자 + 뒤 8자 보존" → "**뒤 8자 보존, 앞부분은 폭이 허락하는 만큼 남기고 그 끝에서 말줄임**". prop은 `keepTail`만 둔다.
- **프론트 요청**: `TopBar` 마크업이 바뀌었다(이름이 `ResourceName`, 버전·리전이 별도 span, 낭독용 `sr-only` 한 문장). 상단바 문구를 테스트에서 찾을 때는 **`sr-only` 한 문장**(`prod.k8s.example.com · v1.31.2 · ap-northeast-2`)을 쓰면 된다 — 지금 `pages.test.tsx`가 그 문장을 찾아 통과한다. 767px 이하에서는 문구가 없고 `circle-help` 버튼의 `aria-label`(`클러스터 …`)만 남는다.
- **프론트 참고**: `features/__fixtures__/fixtures.ts`·`aws-cost/CostTables.tsx`가 새 타입과 안 맞아 지금 `typecheck` 7건이 난다(6절). 작업 중인 것으로 보여 손대지 않았다.
- **PM 참고**: 프론트가 알려 준 **Playwright + 설치된 Edge** 경로로 실제 픽셀을 확인했고, 그 덕에 단위 테스트로는 잡히지 않는 결함 3개(셀 폭 73px, 장애 셀 2행 잘림, 이름 이중 말줄임)를 찾았다. README "남은 이슈"의 *"UI가 실제 픽셀로 렌더된 것을 아무도 눈으로 보지 못했다"* 중 **퍼블리셔 영역(`/dev/ui`)은 해소**됐다고 봐도 된다(빗금·툴팁·치수·회색조 확인 완료).

### 9. 다음 담당이 알아야 할 점

- `ResourceName`의 prop에서 **`keepHead`가 없어졌다.** `keepTail`(kind별 기본 16 / cluster 8)만 쓴다. 잘림은 앞 토막 끝에서 일어나고, 전체 이름은 `sr-only`와 툴팁에 있다.
- `TopBar`는 **좁아져도 클러스터 정보를 완전히 버리지 않는다.** 폭이 모자라면 `circle-help` 하나로 줄고 툴팁·`aria-label`에 세 값이 모두 남는다. 이 대체 버튼은 `.clusterInfo` **안**에 있다(컨테이너 쿼리로 제어하기 위해서다) — 밖으로 옮기면 "가용 폭 160px 미만" 조건이 CSS로 표현되지 않는다.
- 상단바 축소 기준은 **뷰포트가 아니라 클러스터 블록에 남는 폭**이다(320 / 240 / 160px). 오른쪽 영역(MOCK 배지·연결 표시)이 넓어지면 더 일찍 접힌다 — 의도된 동작이다.
- 매트릭스 셀은 이제 칸 폭을 가득 채운다(`.matrixCellTd .cellAnchor`). `Tooltip`으로 무언가를 감쌀 때 **`.tooltipAnchor`(inline-flex)가 내 클래스를 이길 수 있다**는 점을 기억할 것 — CSS 모듈 파일 순서는 보장되지 않는다.
- 셀은 두 줄이 48px에 **딱 맞는다**(8 + 16 + 14 + 8 + 테두리 2). 줄 사이에 gap을 넣거나 글꼴을 키우면 둘째 줄(= 장애 사유)이 잘린다.
- 검증 스크립트(Playwright + Edge)는 리포지터리에 넣지 않았다(스크래치패드). 다시 만들 때는 `chromium.launch({ channel: "msedge" })` 한 줄이면 되고, 브라우저를 내려받지 않는다.

---

## 2026-09-24 (4) · 요약 숫자 강조를 기본 동작으로 (`onSummaryClick` 선택화)

### 1. 요청 내용

PM 전달(프론트가 실제로 붙이며 발견):

- **요약 숫자는 `onSummaryClick`을 넘겨야만 버튼이 된다.** 핸들러가 없으면 `<span>`이라 "숫자를 누르면 해당 상태 칸이 깜박인다"는 동작이 통째로 사라진다. 그런데 **강조는 컴포넌트 안에서 끝나는 일**이라 바깥에서 할 일이 없는데도 핸들러를 요구하는 구조다. 프론트는 지금 **빈 함수를 넘겨서** 쓰고 있고, 빈 함수를 넘겨야 동작하는 prop은 다음 사람이 반드시 빠뜨린다.
- 방향: `onSummaryClick` 없이도 기본으로 버튼·강조가 동작하게 하고, 핸들러는 "바깥에서 추가로 할 일이 있을 때만" 넘기는 선택 항목으로. 방식은 퍼블리셔 판단, **기존 호출부(빈 함수를 넘기는 곳)가 깨지지 않을 것.**
- 참고: 프론트가 Edge로 시나리오 7개(`cp-healthy`·`cp-node-down`·`cp-component-crash`·`cp-not-found`·`kube-stale` 등)를 전환하며 확인했고 **빈 칸은 어느 시나리오에도 없었다.** 내가 고친 셀 폭·2행 잘림도 실제 렌더에서 정상, 1024/768/360px 페이지 가로 스크롤 0.

### 2. 참고한 문서

- `docs/design/components.md` 18.1 — `onSummaryClick`, 한 줄 요약
- `docs/design/cluster-status.md` 3.2.3 — "숫자를 누르면 그 상태의 셀만 2000ms 외곽선(`status.<key>.solid` 2px)으로 깜박인다"
- 1~3차 작업 보고(위 세 섹션)

### 3. 작업 내용

- **0이 아닌 요약 숫자는 항상 `<button>`** 이다(핸들러 유무와 무관). 누르면 그 상태의 셀만 2000ms 외곽선으로 강조한다 — 강조는 전부 컴포넌트 안에서 끝난다.
- **0인 항목은 그대로 `<span>`**(`text.disabled`). 강조할 칸이 없는데 누를 수 있게 하면 "눌러도 아무 일이 없는 버튼"이 된다.
- `onSummaryClick`은 **선택**이 됐다. 있으면 강조에 **더해** 호출한다(`onSummaryClick?.(state)`). 빈 함수를 넘기던 기존 호출부는 그대로 동작한다(호출 시그니처·동작 모두 그대로, 빈 함수가 호출될 뿐).
- prop 주석에 "강조는 기본 동작이고 이 콜백은 바깥에서 추가로 할 일이 있을 때만(필터·URL 반영 등)"을 적어, 다음 사람이 빈 함수를 넘길 이유를 없앴다.
- 미리보기(`ControlPlanePreview`)에서 `onSummaryClick={() => undefined}`를 **지웠다.** 미리보기가 "핸들러 없이도 동작한다"는 것을 그대로 보여 준다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/cluster/ComponentMatrix.tsx` | 수정 | 요약 숫자를 핸들러 없이도 버튼으로, `handleSummary`에서 조기 반환 제거 후 `onSummaryClick?.()`, prop 주석 갱신 |
| `apps/web/src/components/ui/__preview__/ControlPlanePreview.tsx` | 수정 | 빈 핸들러 제거 |
| `apps/web/src/components/ui/__tests__/kops-support.test.tsx` | 수정 | 기본 동작·강조 대상·선택 콜백 테스트 3개(28 → 30개) |
| `docs/reports/kops-support/publisher.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| P23 | 강조를 **기본 동작**으로, `onSummaryClick`은 덧붙임 | `highlightOnSummaryClick` 같은 스위치 prop 추가 / 문서에 "빈 함수를 넘기세요" 적기 | 스위치는 "켜야 동작한다"는 같은 함정을 이름만 바꿔 남긴다. 화면 안에서 끝나는 동작은 **기본으로 켜져 있어야** 호출부가 잊을 수 없다. 기존 호출부도 그대로 돈다 |
| P24 | 0인 항목은 버튼으로 만들지 않음 | 전부 버튼 + 비활성 | 강조할 칸이 0개라 눌러도 아무 일이 없다. 비활성 버튼을 두면 Tab 순서만 늘고(15칸 화면에서 4개) 얻는 것이 없다. 0은 `text.disabled`로 죽인다는 디자인 규칙과도 맞는다 |
| P25 | prop 은 남기고 **선택**으로 | 삭제 | 필터·URL 반영처럼 바깥에서 할 일이 실제로 생길 수 있고(문서 18.1이 정의한 prop), 지우면 호출부가 깨진다 |

### 6. 검증 결과

| 명령·항목 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과(0건) | |
| `npm run typecheck --prefix apps/web` | **통과(0건)** | 3차 때 빨갛던 `features/**` 7건은 프론트 작업이 끝나 사라졌다 |
| `npm run test --prefix apps/web` | **510개 전부 통과**(22 파일) | 내 테스트 30개(신규 3개 포함) |
| `npm run build --prefix apps/web` | 통과 | |
| 실제 브라우저(Edge, Playwright, `/dev/ui`) | 통과 | 아래 |

**브라우저 실측(핸들러를 하나도 넘기지 않은 미리보기 기준)**

| 확인 | 결과 |
|---|---|
| 요약 버튼 수 | **3개**(정상 9 · 장애 1 · 알 수 없음 5), `aria-label`은 `<문구>, 해당 칸 강조` |
| 0인 항목(`주의 0`) | `SPAN` — 버튼이 아니다 |
| `장애 1` 클릭 | 강조된 칸 **1개**, `data-cell-state="crit"`, 외곽선 **2px `rgb(217,48,54)`**(= `status.crit.solid`) |
| `알 수 없음 5` 클릭 | 강조된 칸 **6개**(보고 없음 5 + 없음 1) — `SUMMARY_MATCH` 규칙대로 |
| 2.1초 후 | 남은 강조 **0개**(2000ms 뒤 사라짐) |
| 키보드 | 버튼이 포커스를 받고 **Enter 로 강조된다** |

**하지 못한 검증**
- 다크 테마는 여전히 눈으로 보지 않았다(토큰만 쓰므로 색은 따라간다).
- `prefers-reduced-motion: reduce`에서 깜박임이 "켜고 끄기"로 바뀌는 것은 CSS 규칙으로만 확인했고 실제로 에뮬레이트해 보지는 않았다.

### 7. 남은 이슈·한계

1. 미리보기 고정값의 `정상 9`는 실제 셀 수(8)와 한 칸 어긋난다 — **미리보기용 손으로 쓴 숫자**이고 실제 화면에서는 서버 값이 온다. 강조 대상은 셀 상태로 고르므로 숫자가 달라도 강조는 정확하다(요약 숫자와 실제 칸 수가 어긋나면 서버 값 문제다).
2. 3차 보고의 남은 이슈(`/dev/ui` 360px 가로 스크롤 = `CommandLine`/`CommandSteps`, 이름 상자 90px 미만의 `…` 자리 없음, 다크 테마 미확인)는 **그대로 남아 있다.**
3. 빗금 간격 6px은 이번에도 건드리지 않았다(PM 추적 항목).

### 8. 다른 담당 요청

- **프론트 요청**: `ComponentMatrix`에 넘기던 **빈 `onSummaryClick`을 지워도 된다**(지우는 편이 낫다). 필터·URL 반영처럼 바깥에서 할 일이 생기면 그때만 넘긴다 — 넘겨도 강조는 그대로 동작한다.
- **designer 참고**: `components.md` 18.1의 `onSummaryClick` 설명이 "그 상태 셀만 2000ms 외곽선 강조"로 돼 있어 **콜백이 강조를 일으키는 것처럼 읽힌다.** 실제로는 강조가 기본 동작이고 콜백은 덧붙임이다. 문구를 "0이 아닌 요약 숫자는 항상 버튼이고 누르면 그 상태 셀을 2000ms 강조한다. `onSummaryClick`은 바깥에서 추가로 할 일이 있을 때만 주는 **선택** prop"으로 고쳐 주기 바란다. 3차에서 요청한 `keepHead` 삭제도 함께 부탁한다.
- **PM 참고**: 이번 변경으로 `ComponentMatrix`의 필수 prop 은 `columns`·`rows`·`cells`·`caption` 넷뿐이다. 나머지(`summary`·`onSummaryClick`·`staleAt`·`state`·`unknownReason`)는 모두 선택이고, 빠뜨려도 화면이 조용히 기능을 잃지 않는다.

### 9. 다음 담당이 알아야 할 점

- **요약 숫자 강조는 기본으로 켜져 있다.** 핸들러를 넘기지 않아도 버튼이고, 눌리면 그 상태 칸이 2000ms 깜박인다. `onSummaryClick`은 "바깥에서 더 할 일"이 있을 때만 준다.
- 강조 대상은 `SUMMARY_MATCH` 규칙을 따른다: `알 수 없음` 숫자는 **보고 없음·없음 칸을 함께** 가리킨다(요약 축이 `Status` 5종뿐이라 `missing`이 들어갈 다른 칸이 없다).
- 0인 요약 항목은 버튼이 아니다(Tab 순서에 들어가지 않는다).
- 컴포넌트에 남은 내부 상태는 이 강조 타이머와 가로 스크롤 감지뿐이다. 데이터·상태 계산은 여전히 하나도 없다.
