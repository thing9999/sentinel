# cluster-status · publisher 작업 보고

> 파일 위치: `docs/reports/cluster-status/publisher.md`
> 공통 작업(토큰·전역 스타일·셸·공통 컴포넌트) 전체를 이 파일에 적는다. 기능 전용 부분은 `docs/reports/aws-cost/publisher.md`, `docs/reports/architecture-advisor/publisher.md`.

## 2026-09-19 11:55 · 4단계 퍼블리싱 (토큰 CSS · 전역 스타일 · 셸 · 공통 UI 컴포넌트)

### 1. 요청 내용
- PM 요청: 디자인 완료 후 백엔드보다 먼저 퍼블리싱 시작.
  1. `tokens.json` → `styles/tokens.css` (라이트/다크 `[data-theme]`, 미지정 시 `prefers-color-scheme`, `$meta`·`$reason` 제외). 생성 스크립트 `apps/web/scripts/build-tokens.mjs` + package.json `tokens` 스크립트(이번에 허용).
  2. `styles/globals.css`: 최소 리셋 유지 + 토큰 import + 셸 레이아웃 클래스.
  3. `components/ui/**`: components.md 1~8절, 10절. 9절 차트는 카드·범례 틀까지만.
  4. 셸 정적 마크업 `components/ui/shell/*` (layout.tsx는 frontend 영역 → 교체 방법을 9절에).
  5. 미리보기 `components/ui/__preview__/` (라우트 연결은 frontend 요청).
  6. 테스트(@testing-library/react 추가 허용), 7. lint/typecheck/test/build.
- 작업 중 PM 추가 지시(API 계약 반영 디자인 갱신): `BridgeStatusBar`·`RunResultAlert`는 API 값을 그대로 받게 변경, `budget_exceeded`·`interrupted` 추가, status.md 8절(API 값 ↔ 디자인 키) 기준으로 공통 컴포넌트가 받을 값을 정하고 9절에 명시.

### 2. 참고한 문서
- `CLAUDE.md`, `docs/reports/TEMPLATE.md`
- `docs/design/tokens.json`, `status.md`(8절 포함 갱신본), `shell.md`, `components.md`(10.1·10.3 갱신본)
- `docs/design/cluster-status.md`, `aws-cost.md`, `architecture-advisor.md`(2.2·2.4 갱신본)
- `docs/reports/cluster-status/designer.md` 7~9절, `docs/reports/bootstrap/frontend.md`
- `docs/api/common.md`(Status·MoneyKind·stale), `docs/api/architecture-advisor.md`(BridgeState, A.9 failureReason) — 매핑 확인용

### 3. 작업 내용
1. **의존성 설치** (PM 허용 범위): `lucide-react`(dependencies), `@testing-library/react`, `@testing-library/dom`, `jsdom`(devDependencies). jsdom은 testing-library가 DOM 환경을 요구해서 함께 추가했다. vitest 설정은 건드리지 않고 컴포넌트 테스트 파일 첫 줄 `// @vitest-environment jsdom`으로 환경을 바꾼다.
2. **토큰 생성 스크립트** `apps/web/scripts/build-tokens.mjs`
   - `npm run tokens --prefix apps/web` → `src/styles/tokens.css` 생성, `node apps/web/scripts/build-tokens.mjs --check`로 최신 여부 확인(다르면 exit 1).
   - 이름 규칙: 경로를 `-`로 잇고 camelCase→kebab-case, 소수 키 `0.5`→`0-5`. 예 `--color-bg-surface-raised`, `--spacing-0-5`, `--z-index-banner`, `--color-chart-series-0..7`, `--chart-dash-threshold`, `--size-top-bar`, `--border-style-estimate`, `--motion-duration-pulse`.
   - typography: `--font-<name>-size/-line/-weight/-letter-spacing/-family` + 단축 `--font-<name>`(`font: var(--font-body)`로 사용). `--font-family-sans|mono`, `--font-numeric: tabular-nums`.
   - 테마: `:root, [data-theme="light"]`(기본 라이트) / `[data-theme="dark"]` / `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`. 라이트·다크 키가 다르면 스크립트가 오류로 멈춘다.
   - `$`로 시작하는 키(`$meta`, `$reason`, `$description`)는 제외.
   - `prefers-reduced-motion: reduce` → `--motion-duration-*` 0ms. 단 `--motion-duration-status-highlight`는 유지(status.md 1.6 "페이드 없이 켜고 끈다").
3. **globals.css**: 기존 리셋 유지 + `@import "./tokens.css"`, body 글꼴·색, `:focus-visible` 링, `.sr-only`, `.tabular`, `.mono`, 셸 클래스(`app-shell`, `app-skip-link`, `app-header`, `app-banner`, `app-body`, `app-nav`, `app-main`, `app-main-inner`, `app-nav-scrim`), `.page-stack`(섹션 간 32px).
4. **공통 모듈**: `types.ts`(Status 등 공통 타입, 기본 문구, `StatusAltLabel` 허용 문구 타입), `icons.tsx`(lucide 이름 → 컴포넌트), `format.ts`(금액·%·단위·시간·가운데 말줄임), `api-map.ts`(API 값 → 디자인 키), `hooks.ts`(useNow, 떠 있는 요소 위치 계산), `cx.ts`.
5. **컴포넌트** (전부 props로만 동작, fetch·SSE·전역 상태 없음, 스타일은 CSS Modules + 토큰 변수). 폴더: `shell/`, `status/`, `cost/`, `controls/`, `overlay/`, `feedback/`, `table/`, `layout/`, `chart-frame/`, `advisor/`. 전부 `components/ui/index.ts`에서 내보낸다. 목록·props는 9절 표.
6. **미리보기** `__preview__/UiPreview.tsx`: 셸 + 거의 모든 컴포넌트를 고정 예시 데이터로 보여 준다(라우트 없음).
7. **테스트** `__tests__/format.test.ts`, `components.test.tsx`, `api.test.tsx` (42개 추가, 기존 8개 포함 50개).
8. **반응형 실측**(영역 밖 파일 수정 없이): scratchpad에 apps/web 복사본 + 임시 라우트 `/ui-preview`를 만들어 빌드·실행하고, headless Edge로 iframe 폭 360/414/768/1024/1280/1440px에서 `scrollWidth == clientWidth` 확인. 첫 측정에서 360px에 14px 가로 넘침 발견 → 원인은 `overflow:hidden`인 비-positioned 부모 안의 `.sr-only`(absolute)가 빠져나간 것 → `.sr-only`에 `left:0` 추가로 해결. 스크린샷(1440, 다크 테마)으로 StatusCard 머리에서 stale 배지가 넘치는 것 발견 → 배지 영역을 줄어들게(말줄임) 수정.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/package.json`, `package-lock.json` | 수정 | `tokens` 스크립트, `lucide-react`, `@testing-library/react`, `@testing-library/dom`, `jsdom` (PM 허용) |
| `apps/web/scripts/build-tokens.mjs` | 추가 | tokens.json → tokens.css 생성·검사 |
| `apps/web/src/styles/tokens.css` | 추가(생성물) | CSS 변수 (직접 수정 금지) |
| `apps/web/src/styles/globals.css` | 수정 | 토큰 import, 리셋 보강, 포커스, 유틸, 셸 레이아웃 |
| `apps/web/src/components/ui/index.ts` | 수정 | 전체 export |
| `apps/web/src/components/ui/{types,icons,format,api-map,hooks,cx}.ts(x)` | 추가 | 공통 모듈 |
| `apps/web/src/components/ui/shell/*` | 추가 | AppShell, TopBar, SideNav, Connection(Indicator/Banner), DataSourceBadge, PageHeader, ThemeMenu, shell.module.css |
| `apps/web/src/components/ui/status/*` | 추가 | StatusBadge, StatusIcon, ReasonText, StatusCard, SummaryStrip(+Item), UsageBar, Chip, StaleNotice |
| `apps/web/src/components/ui/cost/*` | 추가 | MoneyValue, RangeValue, CostKindBadge, MetricTile, BudgetGauge |
| `apps/web/src/components/ui/controls/*` | 추가 | Button, IconButton, CopyButton, SearchInput, Select, MultiSelect, SegmentedControl, Switch, FilterBar |
| `apps/web/src/components/ui/overlay/*` | 추가 | Tooltip, Popover, Drawer, Dialog, HelpPopover, ModalBase |
| `apps/web/src/components/ui/feedback/*` | 추가 | Banner, InlineAlert, EmptyState, UnknownState, ErrorState, Skeleton, Spinner |
| `apps/web/src/components/ui/table/*` | 추가 | DataTable, ResourceName, KeyValueList, DistributionBar |
| `apps/web/src/components/ui/layout/*` | 추가 | Section, Card, Grid/GridItem, Tabs/TabPanel, Timestamp, Duration, ElapsedTimer, Stepper, CodeBlock, JsonTree |
| `apps/web/src/components/ui/chart-frame/*` | 추가 | ChartFrame, ChartLegend (차트 본체 제외) |
| `apps/web/src/components/ui/advisor/*` | 추가 | 어드바이저 전용 (architecture-advisor 보고서 참고) |
| `apps/web/src/components/ui/__preview__/UiPreview.tsx` | 추가 | 미리보기 |
| `apps/web/src/components/ui/__tests__/*` | 추가 | 테스트 3파일 |

### 5. 주요 결정과 이유
- **공통 컴포넌트는 디자인 키를 받는다** (`Status = ok|warn|crit|unknown|stale`, `CostKind = estimate|confirmed|forecast|llmEstimate`). status.md 8절 원칙("API 값은 화면 진입 지점에서 한 번만 디자인 키로")을 따랐다. 변환은 프론트가 하되, 같은 표를 두 번 구현하지 않도록 순수 함수 `api-map.ts`를 제공한다. **예외**: `BridgeStatusBar.bridge`, `RunResultAlert.reason`은 갱신된 components.md 10.1·10.3대로 API 값 그대로.
- **대체 문구를 타입으로 제한**: `StatusBadge.label`은 `StatusAltLabel`(status.md 1.2 목록 + `진행 중`)만 허용 → 목록 밖 문구는 컴파일 오류.
- **포커스 링은 outline**: shadow.focus와 같은 모양(2px 간격 + 2px)이지만 box-shadow는 스크롤 컨테이너(표 등)에 잘려서 `outline + outline-offset`으로 그렸다.
- **비활성 버튼은 `aria-disabled`**: `disabled` 속성은 포커스·hover를 막아 `disabledReason` 툴팁을 볼 수 없어서. 클릭은 컴포넌트가 막는다.
- **Tooltip·Popover는 `position: fixed` + 화면 안 보정**: absolute는 360px에서 문서 폭을 늘린다. 스크롤 시 Tooltip은 닫고 Popover는 위치를 다시 잡는다. 포털은 쓰지 않았다(포커스 순서 유지).
- **Dialog·Drawer는 네이티브 `<dialog>` `showModal()`**: 포커스 가둠·배경 inert·top layer를 브라우저에 맡김. Esc·배경 클릭은 `onClose`로만 알리고 열림 상태는 호출 측이 제어.
- **Select는 네이티브 `<select>`**: 키보드·모바일·스크린리더 지원. `searchable`은 브라우저 타이프어헤드로 대체, 옵션 아이콘은 MultiSelect에서만 표시.
- **가운데 말줄임은 CSS**: 앞부분 `text-overflow: ellipsis` + 끝 16자 고정 → 폭에 맞으면 자르지 않는다(status.md 5.3). 스크린리더는 sr-only 전체 이름을 한 번 읽는다.
- **실시간 영역의 과도한 알림 방지**: ConnectionIndicator는 상태 문구만 `role=status`(시각·재시도 횟수 제외), ConnectionBanner는 제목만 status·카운트다운은 aria-hidden, SummaryStrip은 **전체 상태가 바뀔 때만** polite 알림(최초·이유만 바뀐 경우 제외), ElapsedTimer는 `role=timer`(자동 알림 없음), RunProgressPanel의 수신 초는 live 아님.
- **"다시 연결됨" 칩 3000ms, 상태 악화 강조 2000ms는 CSS 애니메이션**(JS 타이머 없음). 다시 띄우려면 호출 측이 `key`를 바꾼다.
- **셸 반응형은 360px까지 지원**: shell.md는 "1024px 미만은 가로 스크롤"이지만 퍼블리셔 규칙(360~1440px 가로 스크롤 금지)을 우선했다. 1280px 미만 드로어, 767px 이하 본문 패딩 16px·클러스터 정보 숨김, 479px 이하 로고 문구·연결 시각 숨김(스크린리더에는 남김). 넓은 표는 표 컨테이너 안에서만 가로 스크롤.
- **MetricTile 높이**: 문서는 136px 고정이지만 보조 줄 3줄 + 경고 칩이면 넘쳐서 `min-height: 136px`로 했다.
- **DataTable `totalRow`는 `Record<열 id, ReactNode>`**: 문서의 `ReactNode`로는 열 정렬을 맞출 수 없어서. 정렬(sort)은 호출 측이 하고, 표는 순환 규칙(`nextSort`)과 머리글 표시만 한다. 가상 스크롤은 고정 행 높이 방식으로 간단히 구현(expandable·groupRow와 함께 쓰지 않음).
- **아이콘 `tilde`**: lucide-react 1.x에 없어 `EqualApproximately`(≈ 모양)로 대체.
- **@media 폭은 숫자**: CSS 변수를 미디어 쿼리에 쓸 수 없어 tokens.json breakpoint 값(1024/1280/1440)을 그대로 적고 767/479px를 추가했다. 그 밖에 토큰에 없는 치수(툴팁 최대 320/480px, 카드 176px, 띠 88px, 빈 상태 200/320px, 스피너 800ms 등)는 components.md 수치를 그대로 썼다. 색은 전부 토큰 변수.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `node apps/web/scripts/build-tokens.mjs --check` | 통과 | tokens.css 최신 |
| `npm run lint --prefix apps/web` | 통과 | 경고 0 |
| `npm run typecheck --prefix apps/web` | 통과 | |
| `npm test --prefix apps/web` | 통과 | 4 파일, 50 테스트 (기존 8 + 신규 42) |
| `npm run build --prefix apps/web` | 통과 | 현재 라우트는 ui 컴포넌트를 import하지 않으므로 CSS 모듈은 아래 복사본 빌드로 따로 검증 |
| scratchpad 복사본 + 임시 `/ui-preview` 빌드 | 통과 | CSS 모듈 전체 컴파일, SSR 프리렌더 성공 |
| 가로 넘침 실측 (headless Edge, iframe) | 통과 | 360/414/768/1024/1280/1440px 모두 `scrollWidth == clientWidth` (수정 후) |
| 스크린샷 육안 확인 | 부분 | 1440px 다크 테마 전체 페이지만. 라이트 테마·키보드 포커스 순서·실제 스크린리더는 확인 못 함 |

### 7. 남은 이슈·한계
- 현재 `app/layout.tsx`가 셸을 쓰지 않아 실제 화면에는 아직 적용되지 않았다(9절 교체 방법, frontend 요청).
- 폰트(Pretendard, JetBrains Mono)는 번들하지 않았다. 없으면 시스템 폰트.
- 스크린리더 실기기 검증, 라이트 테마 스크린샷, 포커스 가둠 동작(브라우저 `<dialog>`) 수동 확인은 하지 않았다.
- 테마 적용 전 깜박임(FOUC) 방지 스크립트, `sentinel.theme`·`sentinel.nav.collapsed` 저장은 frontend 몫.
- DataTable 가상 스크롤은 단순 구현(고정 행 높이). 수백 행 성능은 파드 화면에서 확인 필요.
- Tooltip은 비대화형 요소(배지 등)에서 키보드로 열 수 없다(탭 정지 과다 방지). 같은 내용은 sr-only 텍스트로 넣었다. 키보드 사용자에게 필요하면 `focusable` prop을 켠다.

### 8. 다른 담당 요청
- `frontend 요청`: `app/layout.tsx`를 셸 컴포넌트로 교체(9절 방법). 셸 상태(테마, 내비 접힘·드로어, 연결 상태)는 클라이언트 래퍼에서 관리.
- `frontend 요청`: 미리보기 라우트 연결(예: `app/dev/ui/page.tsx`에서 `UiPreview` 렌더, 개발 모드에서만). 퍼블리셔 검증 때 같은 라우트를 쓰면 영역 밖 임시 파일이 필요 없다.
- `frontend 요청`: `<html>`에 `data-theme` 초기값을 그리기 전에 넣는 인라인 스크립트(localStorage `sentinel.theme`, `system`이면 속성 제거).
- `frontend 요청`: `useEventSource` 상태를 `ConnectionIndicator.status`(`connecting | open | reconnecting | disconnected | apiDown`)로 합치는 로직, 배너 5000ms 지연, `nextRetryInMs` 1초 갱신.
- `frontend 요청`: package.json 변경 확인(추가 패키지 4개와 `tokens` 스크립트). 필요하면 CI에 `node scripts/build-tokens.mjs --check` 추가.

### 9. 다음 담당이 알아야 할 점

#### 9.1 layout.tsx 교체 방법 (frontend)
`layout.tsx`는 서버 컴포넌트로 두고, 상태를 가진 클라이언트 래퍼를 `app/` 또는 `features/` 아래에 만든다.
```tsx
// app/layout.tsx
<html lang="ko" suppressHydrationWarning>
  <body>
    <ShellClient>{children}</ShellClient>   {/* 기존 header/nav/main 제거 */}
  </body>
</html>

// ShellClient ("use client")
const pathname = usePathname();
<AppShell
  navOpen={navOpen} onNavClose={() => setNavOpen(false)}
  topBar={<TopBar cluster={cluster} clusterLoading={!cluster && loading} dataSource={mode}
            connection={<ConnectionIndicator status={conn} lastEventAt={last} retryCount={n} justReconnected={j} />}
            themeToggle={<ThemeMenu value={theme} onChange={setTheme} />}
            onMenuClick={() => setNavOpen(o => !o)} menuOpen={navOpen} />}
  banner={showBanner ? <ConnectionBanner lastEventAt={last} retryCount={n} nextRetryInMs={ms} onRetryNow={retry} /> : null}
  nav={<SideNav items={DEFAULT_NAV_ITEMS /* + status/busy */} currentPath={pathname}
         collapsed={collapsed} onToggleCollapsed={toggle} />}>
  {children}
</AppShell>
```
- 기본 접힘: 1280~1439px면 `collapsed=true`, 1440px 이상이면 저장값(없으면 false). 1280px 미만은 CSS가 사이드바를 숨기고 `navOpen`일 때 드로어로 보인다(드로어에서는 항상 펼친 모습). 페이지 이동 시 `navOpen=false`.
- 건너뛰기 링크는 `#main`(AppShell `mainId`).
- 페이지 본문: `<PageHeader …/>` 다음 `<div className="page-stack">` 안에 `Section`들을 둔다. 그리드는 `Grid`/`GridItem`(12열, gutter 16px, 767px 이하 1열).

#### 9.2 프론트가 넘겨야 하는 값 (status.md 8절)
| 컴포넌트 prop | 넘길 값 | 변환 |
|---|---|---|
| `StatusBadge.status`, `StatusIcon.status`, `StatusCard.status`, `SummaryStrip.overall.status`, `UsageBar.status`, `Chip.tone`, `NavItem.status` 등 **모든 `Status`** | 디자인 키 `ok | warn | crit | unknown | stale` | API `ok/warning/critical/unknown` → `statusFromApi()`. `stale: true` 또는 화면 타이머(`updatedAt + staleAfterSec`)면 `badgeFromApi(info, screenStale)` → `{status:"stale", previousStatus, staleAt}` |
| `MoneyValue.kind`, `CostKindBadge.kind`, `MetricTile.kind` | `estimate | confirmed | forecast | llmEstimate` (+ MetricTile `plain`) | API `estimated/actual/forecast` → `costKindFromApi()` (모르면 null → 금액 `—`), 어드바이저 절감 `savingsKindFromSource()` |
| `BudgetGauge.projectedKind` | `forecast | estimate` | `projectedKindFromBasis(projectedBasis)` |
| `CategoryChip.category`, `SuggestionCard.category`, `SeverityMatrix.cells` 키 | `cost | reliability | performance | security | db` | `categoryFromApi()` (`database` → `db`) |
| `SeverityBadge.severity`, `RiskBadge.level` | `high | medium | low` | 같은 값. `null`(판단 보류)은 `Chip label="판단 보류" icon="hourglass"` |
| 분석 이력 상태 | `StatusBadge {...runStatusBadge(run.status)}` | `queued/running` → 진행 중(스피너), `succeeded` 완료, `failed` 실패, `cancelled` 취소됨 |
| `BridgeStatusBar.bridge` | **API 값 그대로** `connected | login_required | usage_limit | unreachable | unknown` | 변환 없음. 서버 `message`·`command`도 그대로 |
| `RunResultAlert.reason` | **API `failureReason` 그대로**, 취소는 `"cancelled"` | 변환 없음. 목록 밖 값은 자동으로 `기타`. `message`=서버 `errorMessage` |
| 금액 숫자 | 서버 값 그대로(합계 포함) | 반올림·기호는 컴포넌트가 표시 단계에서만 |
| 시각 | 서버 ISO 문자열 | 컴포넌트가 로컬 시간대로 표시 |

#### 9.3 컴포넌트별 props 인터페이스
공통: 대부분 `className?: string`을 받는다(표에서 생략). `IsoTime = string`.

**1. 셸**
| 컴포넌트 | props |
|---|---|
| `AppShell` | `topBar: ReactNode`, `nav: ReactNode`, `banner?: ReactNode`, `children`, `navOpen?: boolean`, `onNavClose?()`, `mainId?="main"` |
| `TopBar` | `cluster: {name; version?; region?} \| null`, `clusterLoading?`, `dataSource: "mock"\|"live"\|null`, `scenarios?: MockScenario[]`, `onScenarioChange?(group, id)`, `connection: ReactNode`, `themeToggle?: ReactNode`, `onMenuClick?()`, `menuOpen?` |
| `SideNav` | `items: NavItem[]` (`{href; label; icon: IconName; status?: Status; busy?; group?}`), `currentPath: string`, `collapsed: boolean`, `onToggleCollapsed?()`, `label?="주요 메뉴"`. `DEFAULT_NAV_ITEMS` 제공(shell.md 3.1) |
| `ConnectionIndicator` | `status: "connecting"\|"open"\|"reconnecting"\|"disconnected"\|"apiDown"`, `lastEventAt?: IsoTime\|null`, `retryCount?`, `justReconnected?` |
| `ConnectionBanner` | `lastEventAt?`, `retryCount?`, `nextRetryInMs?: number\|null`, `message?="연결 끊김"`(API 불가 `API에 연결할 수 없습니다`), `onRetryNow?()` |
| `DataSourceBadge` | `mode: "mock"\|"live"`, `scenarios?: {id; label; group: "cluster"\|"cost"\|"advisor"; active}[]`, `onScenarioChange?(group, id)` |
| `PageHeader` | `title`, `breadcrumbs?: {label; href?}[]`, `status?: {status; reason?: string\|string[]; staleAt?; label?: StatusAltLabel; previousStatus?; highlight?}`, `subtitle?`, `actions?`, `chips?`, `monoTitle?` |
| `ThemeMenu` | `value: "light"\|"dark"\|"system"`, `onChange(v)` |

**2. 상태 표시**
| 컴포넌트 | props |
|---|---|
| `StatusBadge` | `status: Status`, `size?: "sm"\|"md"\|"lg"`(md), `variant?: "subtle"\|"solid"\|"dot"`, `label?: StatusAltLabel`, `staleAt?`, `staleFormat?: TimeFormat`("time"), `previousStatus?`, `previousReason?`, `reason?`(스크린리더), `highlight?`, `busy?` |
| `StatusIcon` | `status`, `size?: 10\|12\|14\|16\|20\|24\|40`(16), `title?` |
| `ReasonText` | `reasons: string[]\|null`, `status?`, `lines?: 1\|2` |
| `StatusCard` | `title`, `icon: IconName`, `status`, `primary: ReactNode`, `counts?: {status; count}[]`, `reason?: string[]`, `items?: {label; href; status; detail?; mono?}[]`(최대 3), `href?`, `footerLabel?="목록 보기"`, `staleAt?`, `staleCount?`, `state?: "ready"\|"loading"\|"error"`, `errorMessage?`, `highlight?`, `headingLevel?: 2\|3` |
| `SummaryStrip` | `overall: {status; reason: string[]}`, `meta?`, `updatedAt?`, `updatedStale?`, `children`(SummaryStripItem), `state?: "ready"\|"loading"`, `label?`, `highlight?` |
| `SummaryStripItem` | `label`, `value: ReactNode`, `status?`, `href?` |
| `UsageBar` | `value: number`(0~1+), `status`, `warnAt?`, `critAt?`, `secondary?`, `secondaryLabel?`, `label?: ReactNode`, `size?: "sm"\|"md"`, `width?`, `approximate?`, `name?="사용률"`(스크린리더) |
| `Chip` | `label`, `icon?`, `tone?: "neutral"\|"info"\|Status`, `size?: "sm"\|"md"`, `dashed?`, `mono?`, `href?`, `onRemove?()` |
| `StaleNotice` | `staleAt`, `label?="데이터 오래됨"`, `format?` |

**3. 금액** (세부는 aws-cost 보고서)
| 컴포넌트 | props |
|---|---|
| `MoneyValue` | `amount: number\|null`, `kind: CostKind`, `unit: "hour"\|"day"\|"month"\|"total"\|"unitPrice"\|"gbMonth"`, `delta?`, `size?: "sm"\|"md"\|"lg"\|"xl"`, `showBadge?`, `badgeDetail?`, `asOf?`, `settledThrough?`, `range?: {low; high; confidence}`, `unknownReason?`, `showUnit?=true`, `stale?`, `loading?`, `tooltip?` |
| `RangeValue` | `low`, `high`, `confidence`, `kind?`, `unit?: "month"\|"total"` |
| `CostKindBadge` | `kind`, `detail?` |
| `MetricTile` | `label`, `value: ReactNode`, `kind?: CostKind\|"plain"`, `badge?`, `lines?: ReactNode[]`, `status?`, `footer?`, `state?: "ready"\|"loading"\|"unknown"\|"hidden"`, `unknownReason?`, `staleAt?`, `staleFormat?`, `href?` |
| `BudgetGauge` | `budget`, `confirmed`, `projected: number\|null`, `projectedKind: "forecast"\|"estimate"`, `projectedRange?: {low; high}`, `warnRatio?=0.9`, `elapsedRatio`, `elapsedLabel` |

**4. 버튼·입력**
| 컴포넌트 | props |
|---|---|
| `Button` | `variant?: "primary"\|"secondary"\|"ghost"\|"danger"`, `size?: Size`, `icon?`, `loading?`, `disabled?`, `disabledReason?`, `fullWidth?` + 나머지 `<button>` 속성 |
| `IconButton` | `icon`, `label`(필수), `size?: Size`, `variant?: "ghost"\|"secondary"`, `showTooltip?=true`, `rotate?: 0\|90\|180` + `<button>` 속성 |
| `CopyButton` | `text`, `label?="복사"`, `size?: "sm"\|"md"`, `showLabel?=true`, `onCopied?()` |
| `SearchInput` | `value`, `onChange(v)`, `placeholder?`, `debounceMs?=200`, `width?=240`, `label?`, `shortcut?=true`(`/`) |
| `Select` | `options: {value; label; count?; icon?}[]`, `value`, `onChange(v)`, `label`, `width?=180`, `disabled?` |
| `MultiSelect` | `options`, `value: string[]`, `onChange(v[])`, `label`, `width?`, `searchable?`(옵션 10개 초과면 기본 true) |
| `SegmentedControl` | `options: {value; label; count?; status?}[]`, `value`, `onChange(v)`, `label`, `size?: "sm"\|"md"` |
| `Switch` | `checked`, `onChange(b)`, `label`, `disabled?` |
| `FilterBar` | `children`, `resultText?`, `onReset?()`(기본값이 아닐 때만 넘김), `label?` |

**5. 오버레이**
| 컴포넌트 | props |
|---|---|
| `Tooltip` | `content`, `children`, `delayMs?=400`, `side?`, `maxWidth?`, `focusable?`, `mono?`, `disabled?`, `as?: "span"\|"div"` |
| `Popover` | `trigger: (p) => ReactNode`(p를 버튼에 전달), `children`, `label`, `width?=280`, `align?`, `open?`, `onOpenChange?` |
| `Drawer` | `open`, `onClose()`, `title`, `subtitle?`, `size?: "md"\|"lg"`, `footer?`, `children` |
| `Dialog` | `open`, `onClose()`, `title`, `description?`, `confirmLabel?`, `onConfirm?()`, `confirmLoading?`, `confirmLoadingLabel?`, `cancelLabel?="닫기"`, `tone?: "default"\|"danger"`, `size?: "sm"\|"md"`, `children?` |
| `HelpPopover` | `label`, `title`, `content`, `mode?: "popover"\|"drawer"` |

**6. 알림·빈 상태**
| 컴포넌트 | props |
|---|---|
| `Banner` | `tone: "info"\|"warn"\|"crit"\|"neutral"\|"stale"\|"ok"`, `icon?`, `title`, `description?`, `actions?`, `dismissible?`, `onDismiss?()`, `live?` |
| `InlineAlert` | `tone`, `title`, `description?`, `action?`, `compact?`, `icon?`, `live?` |
| `EmptyState` | `icon`, `title`, `description?`, `action?`, `size?: "chart"\|"sm"\|"lg"`, `iconTone?`, `headingLevel?` |
| `UnknownState` | `reason?`, `title?="알 수 없음"`, `hint?`, `onRetry?()`, `retryLabel?`, `action?`, `size?` |
| `ErrorState` | `title`, `detail?: "network"\|"timeout"\|"http"`, `description?`, `onRetry?()`, `retryLabel?`, `action?`, `size?` |
| `Skeleton` | `width?`, `height?`, `radius?`, `lines?` |
| `Spinner` | `size?: 12\|16\|20\|40`, `tone?: "accent"\|"current"`, `label?` |

**7. 표**
| 컴포넌트 | props |
|---|---|
| `DataTable<T>` | `columns: Column<T>[]`, `rows`, `rowKey(row)`, `sort?`, `onSortChange?(sort)`, `density?`, `virtualized?`, `height?`, `rowStatus?(row)`, `rowAccent?(row)`, `rowStale?(row)`, `selectedKey?`, `onRowClick?(row)`, `expandable?: {render; expandedKeys; onToggle; canExpand?}`, `groupRow?: {is; render; expanded?; onToggle?}`, `pinnedBottomRows?`, `totalRow?: Record<열id, ReactNode>`, `state?`, `emptyProps?`, `filteredEmptyText?`, `onResetFilters?`, `unknownReason?`, `unknownHint?`, `errorTitle?`, `onRetry?`, `pendingReorder?`, `onApplyReorder?`, `countText?`, `onHoverChange?(bool)`, `caption`(필수), `loadingRows?` |
| `Column<T>` | `{id; header; headerBadge?; width?; minWidth?; maxWidth?; align?; sortable?; render(row); numeric?; sticky?: "left"; hideBelow?: 1024\|1280}` / `nextSort(current, id)` |
| `ResourceName` | `name`, `keepTail?=16`, `href?`, `copyable?=true`, `maxWidth?`, `kind?: "pod"\|"node"\|…`, `namespace?` |
| `KeyValueList` | `items: {label; value; hint?}[]`, `columns?: 1\|2`, `labelWidth?=120` |
| `DistributionBar` | `segments: {value; status?; color?; label; valueText?}[]`, `height?: 4\|8`, `width?`, `label?` |

**8. 기타 구조**
| 컴포넌트 | props |
|---|---|
| `Section` | `title`, `badges?`, `meta?`, `actions?`, `children`, `collapsible?`, `defaultCollapsed?`, `kind?: "default"\|"estimate"`, `headingLevel?`, `id?` |
| `Card` | `padding?: "none"\|"sm"\|"md"\|"lg"`, `interactive?`, `kind?: "default"\|"estimate"\|"stale"\|"unverified"`, `status?: "warn"\|"crit"`, `as?`, aria 속성, `children` |
| `Grid` / `GridItem` | Grid `columns?`, `columnsMd?`, `columnsSm?`, `columnsXs?`, `as?` / GridItem `span?`, `spanMd?`, `spanSm?`, `as?` |
| `Tabs` / `TabPanel` | Tabs `items: {id; label; count?; status?}[]`, `value`, `onChange(id)`, `idBase`, `label` / TabPanel `idBase`, `id`, `value`, `children` |
| `Timestamp` | `value`, `format?: "time"\|"shortTime"\|"auto"\|"autoShort"`, `relative?`, `relativeOnly?` |
| `Duration` | `ms`, `style?: "table"\|"timer"` |
| `ElapsedTimer` | `startedAt`, `serverNow?`, `tickMs?=1000`, `running?=true`, `label?` |
| `Stepper` | `steps: {id; label; state: "pending"\|"active"\|"done"\|"error"\|"skipped"; detail?}[]`, `orientation?`, `label?` |
| `CodeBlock` | `code`, `language?`, `maxHeight?=320`, `wrap?=false` |
| `JsonTree` | `data`, `defaultExpandDepth?=1`, `searchable?=true`, `maxHeight?`, `redactedText?="[가림]"` |

**9. 차트 틀** (차트 본체는 frontend `charts/`)
| 컴포넌트 | props |
|---|---|
| `ChartFrame` | `title`, `badges?`, `subtitle?`, `actions?`, `legend?: ChartLegendItem[]`(2개 이상일 때만 표시), `height?: "sparkline"\|"sm"\|"md"\|"lg"\|"xl"`, `state?: "ready"\|"loading"\|"empty"\|"unknown"\|"stale"`, `unknownReason?`, `unknownHint?`, `staleAt?`, `staleFormat?`, `observedMinutes?`, `plotChips?`, `emptyText?`, `tableView?: {pressed; onToggle}`, `children`(차트), `kind?`, `bare?` |
| `ChartLegend` | `items: {label; color(CSS 변수 문자열); dashed?; hatched?}[]` |

**유틸**: `format.ts` — `formatMoney(amount, unit, {delta, showUnit})`, `formatMoneyRange`, `formatPercent(ratio, {signed, digits})`, `formatCount`, `formatMillicores`, `formatBytes`, `formatLatency`, `formatRate`, `formatDurationTable`, `formatDurationTimer`, `formatTime(v, format, now?)`, `formatMonthDay`, `formatFullTime`, `formatRelative`, `shortNodeName`, `formatXidAge`. `api-map.ts` — 9.2 표. `icons.tsx` — `Icon {name; size; title?}`, `STATUS_ICON`.

#### 9.4 주의
- 컴포넌트 안에서 서버 문자열은 모두 React 텍스트로만 넣는다. 호출 측도 `dangerouslySetInnerHTML`을 쓰지 말 것.
- 차트에 색을 넘길 때는 토큰 변수 문자열(`var(--color-chart-series-0)`)을 쓴다.
- 새 토큰이 필요하면 designer에게 tokens.json 수정을 요청하고 `npm run tokens --prefix apps/web`로 다시 만든다(tokens.css 직접 수정 금지).
- 시각 표시는 로컬 시간대라 서버 렌더와 다를 수 있어 해당 요소에 `suppressHydrationWarning`을 넣어 두었다.

## 2026-09-19 13:05 · 프론트 통합(5a) 퍼블리셔 요청 반영

### 1. 요청 내용
PM 요청(출처: cluster-status·aws-cost·architecture-advisor `frontend.md` 8절).
1. `DataSourceBadge` 시나리오 그룹에 `db` 추가 (cluster, db, cost, advisor).
2. `StatusCard`: counts가 두 줄이 되면 문제 항목이 `목록 보기`와 겹침 → 고치기.
3. 어드바이저 알림의 `10분` 하드코딩 → 타임아웃(초) prop. 기본 타임아웃 600초, 지연 300초.
4. 배치 유틸리티 클래스를 `src/styles`에 추가해 `features/common/layout.module.css`를 없앨 수 있게 하기(프론트 파일은 수정 안 함).
5. `SuggestionCard`: 근거 문장에 값이 없으면 값을 덧붙이지 않기. 테스트로 고정.
6. `/cost` 360px 가로 스크롤 원인 확인. 공통 컴포넌트 탓이면 고치고, 페이지 마크업 탓이면 프론트 요청으로 남기기.

### 2. 참고한 문서
`CLAUDE.md`, `docs/reports/{cluster-status,aws-cost,architecture-advisor}/frontend.md` 8절, 이 파일의 이전 섹션, `apps/web/src/features/architecture-advisor/types.ts`(`run.limits: { slowAfterSec; timeoutSec }`), `apps/web/src/features/common/layout.module.css`(대체 대상).

### 3. 작업 내용
1. **DataSourceBadge**: `SCENARIO_GROUPS = ["cluster","db","cost","advisor"] as const`를 추가해 내보내고, `ScenarioGroup`은 이 배열에서 만든다. Popover 그룹 순서도 이 배열을 따른다. `db` 라벨은 `DB`.
2. **StatusCard**: `height: 176px` → `min-height: 176px`. 카드 안 블록은 `flex-shrink: 0`, `목록 보기`에 `padding-top: spacing-2`. counts가 접히면 카드가 늘어나고, 같은 Grid 행의 카드들은 stretch 되어 높이가 같아진다.
3. **한도 문구**: `RunResultAlert.timeoutSec`, `RunProgressPanel.timeoutSec`·`slowAfterSec` 추가(모두 초, 선택). 서버 `run.limits` 값을 그대로 넘기면 된다. 값이 없거나 0 이하·NaN이면 기본값(600/300). 문구 예: `분석 실패 · 시간 초과 (15분)`, `5분이 넘었습니다. … 10분이 지나면 자동으로 실패 처리됩니다.` `1분 30초가`처럼 받침에 맞춰 조사를 붙인다.
   - `RUN_RESULT_SPEC.timeout.title/fallback`에는 이제 `{limit}` 자리표시자가 들어 있다. 이 표를 직접 읽어 제목으로 쓰지 말고 컴포넌트를 쓸 것(현재 프론트는 직접 쓰지 않음).
4. **유틸리티**: `src/styles/utilities.css` 추가, `globals.css`가 `tokens.css` 다음에 import한다. 사용법은 9절.
5. **SuggestionCard**: `EvidenceText`는 값이 문장에 있으면 그 자리만 `<strong>`, 값이 없거나 비었거나 문장에 없으면 문장만 보여 준다. `SuggestionEvidence.value`는 `string | null` 허용. 기존 XSS 테스트는 문장에 `18%`를 넣도록 고쳤다.
6. **/cost 가로 스크롤**: 원인은 공통 컴포넌트가 아니라 **프론트 차트** `charts/DailyBarChart.tsx`의 기준선 라벨(`lineLabel refLabel`, `7일 중앙값 …`)이다(8절 프론트 요청). 공통 컴포넌트(표·MetricTile·ChartFrame)는 넘치지 않았고, 표는 표 컨테이너 안에서만 스크롤된다. 퍼블리셔 쪽은 수정하지 않았다. ChartFrame에서 잘라내면 스크롤은 없어지지만 라벨이 잘려 보일 뿐이라 원인 쪽에서 고치는 게 맞다고 판단했다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/shell/DataSourceBadge.tsx` | 수정 | `SCENARIO_GROUPS`, `db` 그룹 |
| `apps/web/src/components/ui/status/status.module.css`, `StatusCard.tsx` | 수정 | 최소 높이, 겹침 방지(주석) |
| `apps/web/src/components/ui/advisor/RunResultAlert.tsx` | 수정 | `timeoutSec`, `DEFAULT_ADVISOR_TIMEOUT_SEC`(600), `DEFAULT_ADVISOR_SLOW_AFTER_SEC`(300), `formatLimitSec`, `withSubjectParticle` |
| `apps/web/src/components/ui/advisor/RunProgressPanel.tsx` | 수정 | `timeoutSec`, `slowAfterSec` |
| `apps/web/src/components/ui/advisor/SuggestionCard.tsx` | 수정 | 근거 값 규칙, `EvidenceText` export(테스트용) |
| `apps/web/src/components/ui/index.ts` | 수정 | `SCENARIO_GROUPS`, 한도 상수, `formatLimitSec` export |
| `apps/web/src/styles/utilities.css` | 추가 | 배치·글자 유틸리티 |
| `apps/web/src/styles/globals.css` | 수정 | utilities.css import |
| `apps/web/src/components/ui/__tests__/frontend-requests.test.tsx` | 추가 | 테스트 8개 |
| `apps/web/src/components/ui/__tests__/components.test.tsx` | 수정 | 근거 문장에 값 포함하도록 |

### 5. 주요 결정과 이유
- 지연 기준 prop 이름은 서버 필드에 맞춰 `slowAfterSec`로 했다(요청 예시 `timeoutSec`와 같은 방식). `delayed` 판정은 계속 서버 값을 쓴다.
- 유틸리티는 전역 클래스지만 이름을 `stack`, `row`, `text-*`, `gap-*` 등으로 짧게 했다. CSS Modules 클래스는 해시되므로 서로 겹치지 않는다. `gap-*`·`row-*` 보조 클래스는 기본 클래스보다 뒤에 있어서 함께 쓰면 덮어쓴다.
- `.label-row`(기존 `barRow`)는 479px 이하에서 한 칸으로 바뀐다(360px에서 UsageBar 공간 확보).
- 기존 `layout.clickableRow`(5열 고정 그리드)는 한 화면 전용이라 공통 유틸로 만들지 않았다. 프론트가 해당 기능 모듈 CSS로 옮기거나 `DataTable`을 쓰면 된다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 | |
| `npm run typecheck --prefix apps/web` | 통과 | |
| `npm test --prefix apps/web` | 통과 | 10 파일, 118 테스트 (신규 8) |
| `npm run build --prefix apps/web` | 통과 | 라우트 15개 |
| `/cost` 가로 넘침 (headless Edge, api `DATA_SOURCE=mock PORT=3095` dist 실행, web `next dev -p 3096`) | **실패(프론트 원인)** | 360 +9px, 414 +9px, 768 +1px, 1024 +1px, 1280·1440 정상. 넘치는 요소는 `DailyBarChart` refLabel 하나뿐 |
| `/cluster` StatusCard 겹침 (360/1024/1440) | 통과 | 1440에서 카드 224px로 늘고 `목록 보기`와 겹치지 않음(스크린샷 확인) |

- api는 백엔드가 수정 중이어서 빌드하지 않고 12:47에 만든 기존 `dist`로 띄웠다(레이아웃 확인용이라 충분). 띄운 프로세스(api 12844, web 18984/19968)는 PID로만 종료했다.

### 7. 남은 이슈·한계
- `/cost` 가로 스크롤은 프론트가 고칠 때까지 남는다(8절).
- 768·1024px의 +1px도 같은 라벨 때문이다.
- `/cluster` 요약 띠의 파드·워크로드 개수에서 아이콘 사이 `·`만 보이고 문구가 안 보이는 모습이 스크린샷에 있었다. 이번 범위 밖이라 원인은 확인하지 않았다.

### 8. 다른 담당 요청
- `frontend 요청 (/cost 가로 스크롤)`: `charts/DailyBarChart.tsx` 240행 기준선 라벨이 `left: m.left + innerW`(플롯 오른쪽 끝)에서 시작하는 `position:absolute; white-space:nowrap` 요소라서, 오른쪽 여백 `m.right`보다 긴 문구(`7일 중앙값 $24.12`, 약 98px)가 차트 밖으로 나가 문서 폭을 늘린다. 해결책: (권장) 라벨을 플롯 안 오른쪽에 붙인다. `left` 대신 `right: m.right`로 두고 기존 `translateY(-100%)`를 유지해서 선 위 오른쪽 끝에 놓는다. 또는 `m.right`를 라벨 폭만큼 늘린다. 차트 루트에 `overflow: clip`을 거는 방법은 라벨이 잘려서 권하지 않는다. `MonthProjectionChart`의 라벨들도 같은 방식이니 함께 확인할 것.
- `frontend 요청`: `features/common/layout.module.css` 제거(9절 대응표), `DataSourceBadge` 시나리오에 `db` 넣기(`features/shell/mock-scenarios.ts` `BADGE_GROUPS` → `SCENARIO_GROUPS`), `RunResultAlert`/`RunProgressPanel`에 `timeoutSec={run.limits.timeoutSec}`·`slowAfterSec={run.limits.slowAfterSec}` 넘기기.

### 9. 다음 담당이 알아야 할 점

#### 9.1 유틸리티 클래스 (`src/styles/utilities.css`, 전역이라 import 필요 없음)
`className="stack"`처럼 문자열로 쓰고, 여러 개는 공백으로 잇는다(`className="row gap-4"`).

| 분류 | 클래스 | 내용 |
|---|---|---|
| 세로 | `stack` / `stack-sm` / `stack-lg` | column, gap 12 / 8 / 16px |
| 가로 | `row` | wrap, 가운데 정렬, gap 8px |
| | `row-between` | 양 끝 정렬, wrap, gap 12px |
| | `row-nowrap`, `row-baseline`, `row-start`, `row-end` | `row`에 붙이는 보조 |
| 그리드 | `grid-auto` | 최소 폭 자동 배치. `style={{ "--grid-min": "280px" }}`(기본 240px), gap 16px. 360px에서도 넘치지 않음 |
| | `label-row` | 라벨 \| 값 2칸, `--label-width`(기본 96px), 479px 이하는 1칸 |
| 간격 | `gap-0`, `gap-0-5`, `gap-1`, `gap-1-5`, `gap-2`, `gap-3`, `gap-4`, `gap-5`, `gap-6`, `gap-8` | `--spacing-*` 토큰과 같은 이름 |
| 자식 | `min-w-0`, `grow`, `shrink-0`, `push-end`, `text-end`, `truncate` | |
| 글자 | `text-body`, `text-strong`, `text-caption`, `text-caption-tertiary`, `text-micro`, `text-h3`, `text-mono`, `text-stale`, `text-link` | 토큰 font·color |
| 목록 | `list-bullet`, `list-plain` | |
| 기존 | `sr-only`, `tabular`, `mono`, `page-stack` | globals.css (변경 없음) |

`layout.module.css` → 전역 클래스 대응:
| 기존 | 새 클래스 |
|---|---|
| `layout.row` / `rowBetween` | `row` / `row-between` |
| `layout.stack` / `stackSm` / `stackLg` | `stack` / `stack-sm` / `stack-lg` |
| `layout.caption` / `captionTertiary` / `micro` / `body` / `strong` / `h3` | `text-caption` / `text-caption-tertiary` / `text-micro` / `text-body` / `text-strong` / `text-h3` |
| `layout.mono` (12px) | `text-mono` |
| `layout.tabular` | `tabular` |
| `layout.staleValue` | `text-stale` |
| `layout.link` | `text-link` |
| `layout.barRow` | `label-row` |
| `layout.list` / `plainList` | `list-bullet` / `list-plain` |
| `layout.right` | `text-end` |
| `layout.srOnly` | `sr-only` |
| `layout.clickableRow` | 대응 없음: 기능 모듈 CSS로 옮기거나 `DataTable` 사용 |

#### 9.2 바뀐 props
| 컴포넌트 | 추가·변경 |
|---|---|
| `DataSourceBadge` | `scenarios[].group: "cluster" \| "db" \| "cost" \| "advisor"`, `SCENARIO_GROUPS` export |
| `StatusCard` | props 변경 없음. 높이 176px 고정 → 최소 176px |
| `RunResultAlert` | `timeoutSec?: number \| null` (기본 600) |
| `RunProgressPanel` | `timeoutSec?: number \| null` (기본 600), `slowAfterSec?: number \| null` (기본 300) |
| `SuggestionCard` | `evidence[].value?: string \| null`. 문장에 없는 값은 표시하지 않음 |
| 유틸 | `DEFAULT_ADVISOR_TIMEOUT_SEC`, `DEFAULT_ADVISOR_SLOW_AFTER_SEC`, `formatLimitSec(sec, fallbackSec)` |
