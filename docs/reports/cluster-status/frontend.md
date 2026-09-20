# cluster-status · frontend 작업 보고

> 파일 위치: `docs/reports/cluster-status/frontend.md`
> 공통 셸·스트림·차트·라우트 전체를 이 파일에 적는다. 비용·어드바이저 화면은 `docs/reports/aws-cost/frontend.md`, `docs/reports/architecture-advisor/frontend.md`.

## 2026-09-19 12:50 · 5a 프론트 통합 (계약 기준 구현: 셸·단일 스트림·클러스터 화면·차트)

### 1. 요청 내용
- PM 5a: API 계약 문서를 단일 기준으로 프론트 통합. 셸 교체(첫 페인트 전 `data-theme`, 연결 배너 5초 지연·재시도 카운트다운, MOCK 배지), 단일 SSE `GET /api/stream?topics=`(앱 전체 연결 1개, 페이지별 토픽 추가·해제), 디자인 라우트 전체, 차트 라이브러리 선택, 비용·어드바이저 화면, mock 시나리오 전환 UI, 테스트(리듀서·매핑·페이지 렌더), lint/typecheck/test/build, 가짜 또는 실제 API로 화면 확인.
- 작업 중 PM 추가 지시: 백엔드 A·B·C 구현 완료 → `metrics.updated` 별도 병합, `restartObservation`으로 관측 N분, 바뀐 행만 오는 스트림, 어드바이저 한도(maxTurns 5·지연 300초), 실제 api(`DATA_SOURCE=mock PORT=3091`)로 화면 확인. 다른 에이전트의 taskkill 사고 주의(프로세스는 PID로만 종료).

### 2. 참고한 문서
- `CLAUDE.md`, `docs/HANDOFF.md`, `docs/reports/README.md`, `TEMPLATE.md`
- 명세 `docs/specs/{cluster-status,aws-cost,architecture-advisor}.md`(4·5·7절)
- 디자인 `docs/design/{shell,status,components,cluster-status,aws-cost,architecture-advisor}.md`
- API `docs/api/{common,cluster-status,aws-cost,architecture-advisor}.md`
- 보고서 `docs/reports/cluster-status/publisher.md`(9절), `*/designer.md` 9절, `cluster-status/backend.md`(3단계 계약·4단계 A 구현), `aws-cost/backend.md`·`architecture-advisor/backend.md`(4단계 B·C), `bootstrap/frontend.md`
- Next 16 문서 `apps/web/node_modules/next/dist/docs/`(useSearchParams Suspense, 동적 params Promise, redirect)

### 3. 작업 내용

#### 3.1 셸 (`app/layout.tsx`, `features/shell/*`)
- `layout.tsx`(서버 컴포넌트): `<html suppressHydrationWarning>` + `<head>` 인라인 스크립트 `THEME_INIT_SCRIPT`(고정 문자열, localStorage `sentinel.theme` → `data-theme`, system이면 속성 제거) → 첫 페인트 전 테마 적용. `StreamProvider` > `ShellClient` > 페이지.
- `ShellClient`: 퍼블리셔 `AppShell`·`TopBar`·`SideNav`·`ConnectionIndicator`·`ConnectionBanner`·`ThemeMenu`·`DataSourceBadge` 조합(퍼블리셔 9.1 방법 그대로).
  - 테마·내비 접힘은 `useSyncExternalStore`(서버 스냅샷 `system`/펼침 → 하이드레이션 불일치 없음). 접힘 기본: 1280~1439 접힘, 1440 이상 저장값(`sentinel.nav.collapsed`), 1280 미만 드로어(페이지 이동 시 닫힘).
  - 사이드바 상태 점: `overview.nav` 서버 값 그대로, `nav.stale.*` 또는 heartbeat 45초 무수신이면 stale, `advisorBusy` 스피너.
  - 상단바 클러스터 정보: `overview.cluster`(연결 없음이면 `클러스터 연결 없음`), 스냅샷 전 스켈레톤.
  - 연결 표시: `features/stream/connection-view.ts`(순수)로 `connecting | open | reconnecting | disconnected | apiDown` 산출, 배너는 끊김 5초 이상 지속 시만, `다음 시도 N초 후` 1초 갱신, 5초 넘게 끊겼다 복구되면 `다시 연결됨` 칩 3초(key=reconnectedAt). 탭 숨김·의도적 토픽 전환 중에는 배너 없음.
  - 최초 연결 전 API 무응답이면 본문 대신 `ErrorState lg`(`API 서버에 연결할 수 없습니다`, `<API 주소> 응답 없음 · 자동으로 다시 시도합니다`, `지금 다시 시도`).
  - MOCK 배지 Popover: `GET /api/mock/scenarios` → cluster·cost·advisor 그룹 라디오, 선택 시 `PUT /api/mock/scenarios/:group`. 409 `RUN_ACTIVE` 등은 본문 위 Banner로 안내.
- `/dev/mock`(`MockScenarioPage`): 4개 그룹 전부(db 포함) Select, 어드바이저 `fastTimers` Switch, `전체 초기화`(`POST /api/mock/reset`). live면 `사용할 수 없습니다`.

#### 3.2 단일 스트림 (`features/stream/*`)
- `StreamClient`(`client.ts`): 앱 전체 EventSource 1개.
  - 토픽 참조 카운트: 항상 `overview`(사이드바·상단바) + 페이지가 `useTopics([...])`로 추가. 늘면 합친 토픽으로 즉시 재연결(스냅샷 재수신, 상태 `switching` = 끊김 아님), 줄면 30초(`LINGER_MS`) 뒤 정리 → 페이지를 오가도 재연결이 잦지 않고, 어드바이저 화면을 벗어나면 `advisor` 구독이 빠져 서버 브리지 확인이 멈춘다.
  - 끊김 감지: 마지막 수신(아무 이벤트) 후 35초(heartbeat 15초 × 2 + 여유, 계약 5.5 권장) → 닫고 재연결.
  - 재연결: 오류·`stream.closing` 시 EventSource를 닫고 지수 백오프 3초(`retry: 3000`과 같은 시작값) → 최대 30초, 지터 ±20%. `Last-Event-ID` 사용 안 함 → 새 연결마다 hello + 전체 스냅샷으로 교체. 재시도마다 `GET /api/health`(3초) 1회로 `API 연결 없음` 판별(폴링 아님).
  - 탭 숨김 15초 넘으면 연결을 닫고(서버 동시 연결 상한 20 보호), 보이면 즉시 재연결. 숨김 중에는 재시도·health 호출 없음.
  - 이벤트 묶음: 수신 이벤트를 requestAnimationFrame 단위 배치(`lib/sse-core.createBatcher`)로 리듀서에 한 번에 반영 → 화면 갱신은 프레임당 1회.
- `reducer.ts`(순수): `*.snapshot` 통째 교체, `*.upsert`/`*.delete` 행 병합(노드는 name, 나머지 key), `*.updated` 단일 객체 교체, `metrics.updated`는 클러스터 합계 교체 + 추이 끝점 추가(1시간 창) + 노드·파드 사용량 맵 교체(행 upsert와 별도), `cost.rate.sampled` 점 추가, `advisor.run.progress/finished` → activeRun·lastRun·latestResult·이력 수. hello는 값을 지우지 않고 서버 시각 보정(`serverOffsetMs`)·heartbeat 시각만 갱신. 스냅샷 전 변경분은 무시.
- `stale.ts`: 화면 stale = 서버 플래그(`StatusInfo.stale`, `stream.source` stale) 또는 1초 타이머(watch 기반은 마지막 heartbeat + 45초, 메트릭·DB 45초, 비용 추정 15분, CE 18시간, 사전 점검 15분, 브리지 90초). `badgeProps()`가 `badgeFromApi`(퍼블리셔 api-map)로 배지 키를 stale로 교체하고 이전 상태·이유를 툴팁용으로 넘긴다.
- `StreamProvider`: 테스트·미리보기용 가짜 저장소 주입 가능(`client` prop).

#### 3.3 라우트 (`app/**`)
| 경로 | 구성 |
|---|---|
| `/` | `OverviewPage` (overview·metrics) |
| `/cluster` | `redirect("/")` (307) |
| `/cluster/nodes`, `/cluster/nodes/[name]` | `NodesPage` / `NodeDetailPage` (cluster·metrics + REST 상세·series) |
| `/cluster/workloads` (`?focus=kind/ns/name`) | `WorkloadsPage` (행 펼침 → REST 상세 조건 + 스트림 소속 파드, focus 행 선택·펼침·가운데 스크롤) |
| `/cluster/pods`, `/cluster/pods/[namespace]/[name]` | `PodsPage`(200행 초과 가상 스크롤) / `PodDetailPage` |
| `/cluster/events` | `EventsPage` (행 펼침으로 message 전문) |
| `/cluster/db` | `DbPage` (db·cluster) |
| `/cost`, `/advisor`, `/advisor/runs/[id]` | 각 기능 보고서 |
| `/dev/mock` | mock 시나리오 전체 전환(개발용) |
| `/dev/ui` | 퍼블리셔 `UiPreview`. **프로덕션(`next start`)에서는 404**, 서버 env `SENTINEL_UI_PREVIEW=1`이면 노출(퍼블리셔 검증용). 앱 셸을 씌우지 않음 |
- 목록 필터·정렬·검색은 URL 쿼리(`status`, `namespace`, `hideSystem`, `showCompleted`, `node`, `workload`, `q`, `sort=col:dir`), `useSearchParams` 쓰는 페이지는 `<Suspense>`로 감쌈. 동적 params는 `await params` + `safeDecode`.

#### 3.4 cluster-status 화면
- 개요: SummaryStrip(전체 상태·이유·클러스터 정보·노드 Ready·파드/워크로드 장애·주의·정상 수·Warning 15분·DB 배지·마지막 갱신), StatusCard ×5(서버 problems 최대 3, crit/warn 강조, stale 교체), 지금 확인할 항목(최대 8, `모두 보기 (N)` → Drawer에서 `GET /api/cluster/attention`), 클러스터 CPU·메모리 카드(사용량·requests·limits 막대 + 1시간 추이 + 임계선, metrics 없음 → UnknownState + 설치 안내, `표로 보기`), 비용·어드바이저 요약 타일.
- 노드/워크로드/파드/이벤트 목록: 디자인 열 구성, 상태 SegmentedControl(개수 포함), 필터·검색, 기본 정렬(status.md 5.2), crit 행 막대, stale 행, 실시간 재정렬 보류(표 hover·펼침 중 순서 고정 + `새 순서로 정렬 (N건 변경)`), 빈·필터 결과 없음·클러스터 연결 없음 상태.
- 사용량 셀: `metrics.updated`의 노드·파드 값을 행 값 위에 덮어씀(A 보고서: 사용량만 바뀌면 upsert 안 옴).
- 파드 목록 `재시작(관측 N분)`: `cluster.restartObservation.fullWindow=false`일 때 머리글에 관측 분.
- 노드 상세: 조건 표(문제 조건 막대, 지속 시간), 용량 막대(사용량·requests·파드), CPU·메모리 추이(REST series + `metrics.updated` 끝점), 이 노드의 파드, 관련 이벤트, 404 `노드를 찾을 수 없습니다`, 503 UnknownState. 스트림 행의 `statusChangedAt`이 바뀌면 REST 상세를 다시 받음.
- 파드 상세: 컨테이너 카드(상태·대기·종료 사유 OOMKilled(137)·requests/limits·메모리 limit 막대·probe), 정보(소속 워크로드 → `?focus=`, 노드 → 상세 링크, 파드 IP), 추이(limit 대비, limit 없으면 bytes), 관련 이벤트, 404 → `워크로드 보기`(details.resource.owner) 또는 `파드 목록으로`.
- DB: 핵심 지표 타일 6개(접속 응답·연결 사용률 막대·긴 쿼리·idle in tx·잠금 대기·캐시 적중률, 판단 보류·해당 없음 칩, 접속 실패 시 unknown), 쿠버네티스 카드(StatefulSet ready + 파드 표), 저장소·안정성(PVC 막대 + `근사치`, XID, 데드락, 복제 `해당 없음`), 세션 표(쿼리 원문 없음 안내, 사용자·DB·상태·경과·대기 이벤트), 상태별 세션 분포, DB별 크기. 설정 없음 → UnknownState lg.

#### 3.5 차트 (`src/charts`)
- **선택: `d3-scale` + `d3-shape`(좌표·경로 계산만) + React가 SVG를 직접 그림.** 이유:
  1. 색이 모두 토큰 CSS 변수(`var(--color-chart-*)`, 라이트/다크 `[data-theme]`)다. SVG `style`에 변수를 그대로 쓸 수 있어 테마 전환 시 다시 그릴 필요가 없다(캔버스 계열 uPlot·ECharts·Chart.js는 변수를 해석하려면 getComputedStyle + 재렌더 필요).
  2. 디자인 요구가 세밀함: 점선 패턴 5종(`6 3`, `4 4`, `8 4`, `2 3`, `2 2`), 45° 빗금 `<pattern>`, 예측 구간 띠(`area` y0/y1), 결측 끊김(수집 주기 × 2 규칙 — 라이브러리의 connectNulls만으로는 간격 규칙 불가), 오른쪽 여백 56px의 아이콘 붙은 임계선 라벨과 12px 겹침 처리, 말일 원·마름모 마커, 오늘 세로선, 미확정 라벨·급증 아이콘 오버레이. Recharts도 가능하지만 커스텀 레이어가 대부분이 되어 이점이 적고, visx는 React 19 peer 범위 밖.
  3. 작고 의존성이 적음(d3-scale·d3-shape + 전이 의존성 d3-array/interpolate/format/time 등, 합계 수십 KB), SSR 안전, jsdom 테스트에서 결정적으로 렌더.
- 구현: `TimeSeriesChart`(선·점선·결측 끊김·임계선·기준선·수집 전 구간·hover 십자선·툴팁), `DailyBarChart`(합계/서비스별 누적, 미확정 빗금, 급증 아이콘, 7일 평균선), `MonthProjectionChart`(확정 실선, 예측 점선+80% 띠, 추정 월말 마름모 또는 점선, 예산·90% 선, 오늘 선), `ChartTooltip`, `SeriesTable`(`표로 보기`), `chart-utils`(niceMax, 시간 눈금, 단위 표기, 결측 분할).
- 크기·여백은 status.md 4.1 수치(160/240/280, 12/56/28/56), 폭은 ResizeObserver.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/package.json`, `package-lock.json` | 수정 | `d3-scale`, `d3-shape`, `@types/d3-scale`, `@types/d3-shape` 추가 |
| `apps/web/src/app/layout.tsx` | 수정 | 셸·스트림·테마 스크립트 |
| `apps/web/src/app/page.tsx` | 수정 | 개요 |
| `apps/web/src/app/cluster/page.tsx` | 수정 | `/`로 redirect |
| `apps/web/src/app/cluster/{nodes,nodes/[name],workloads,pods,pods/[namespace]/[name],events,db}/page.tsx` | 추가 | 클러스터 라우트 |
| `apps/web/src/app/{cost,advisor}/page.tsx` | 수정 | 기능 페이지 연결 |
| `apps/web/src/app/advisor/runs/[id]/page.tsx`, `app/dev/{ui,mock}/page.tsx` | 추가 | 지난 결과, 개발용 |
| `apps/web/src/features/common/{types.ts,hooks.ts,params.ts,useStableOrder.ts,layout.module.css}` | 추가 | 공통 타입·REST 훅·URL 쿼리·재정렬 보류·배치용 CSS |
| `apps/web/src/features/stream/{reducer,client,connection-view,stale}.ts`, `StreamProvider.tsx` | 추가 | 단일 스트림 |
| `apps/web/src/features/shell/{ShellClient,MockScenarioPage}.tsx`, `{theme,nav,mock-scenarios}.ts` | 추가 | 셸 |
| `apps/web/src/features/cluster-status/*` | 추가 | types, selectors, shared, chart-helpers, UsageCharts, 페이지 8개 |
| `apps/web/src/features/{aws-cost,architecture-advisor}/*` | 추가 | 각 기능 보고서 |
| `apps/web/src/features/{cluster-status,aws-cost,architecture-advisor}/index.ts` | 유지 | 빈 모듈(사용 안 함) |
| `apps/web/src/charts/*` | 추가/수정 | 차트 |
| `apps/web/src/features/__fixtures__/fixtures.ts` | 추가 | 계약 모양 가짜 데이터(테스트·실측 비교용, `import type`만) |
| 테스트 `features/stream/{reducer,connection}.test.ts`, `features/mapping.test.ts`, `features/pages.test.tsx`, `charts/chart-utils.test.ts` | 추가 | 60개 |

### 5. 주요 결정과 이유
- **토픽을 페이지별로 추가·해제**(계약 5.1은 "전체 구독도 무방, 페이지마다 바꾸면 재연결" 권장) — PM 지시에 따름. 재연결 비용은 늘 때 즉시, 줄 때 30초 지연으로 줄였고, 의도적 전환은 연결 표시·배너에 끊김으로 보이지 않게 했다.
- **탭 숨김 시 SSE도 닫음(15초 유예)** — 규칙의 "폴링 중지"를 넘어 스트림에도 적용. 서버 동시 연결 상한(20) 보호, 복귀 시 전체 스냅샷으로 일관 복원. 짧은 탭 전환(15초 미만)은 끊지 않는다.
- **백오프 시작 3초** — 계약 `retry: 3000`과 같은 시작값(뼈대는 1초).
- **REST 없이 스트림 스냅샷으로 목록을 그림** — 계약상 스냅샷 = REST 목록 항목 모양. 필터·정렬은 화면에서 표시 범위만 정하고(`countByStatus`는 서버 판단 값을 세기만), 상태·합계는 계산하지 않는다.
- **stale 교체는 배지만**: 값은 유지하고 숫자 셀은 stale 색(`rowStale`), 카드 dashed(퍼블리셔 컴포넌트).
- **배치용 CSS 모듈 1개(`features/common/layout.module.css`)** — 행·열 간격·caption 같은 조립용 배치만(색·글자는 토큰 변수). UI 컴포넌트는 새로 만들지 않았다.
- **`/dev/ui` 프로덕션 404** — 개발 도구가 운영 화면에 노출되지 않게. 퍼블리셔 실측이 필요하면 `SENTINEL_UI_PREVIEW=1`.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 | 0건 |
| `npm run typecheck --prefix apps/web` (= `tsc --noEmit`) | 통과 | |
| `npm test --prefix apps/web` | 통과 | 9 파일, 110 테스트(기존 50 + 신규 60) |
| `npm run build --prefix apps/web` | 통과 | 15 라우트(정적 11, 동적 4) |
| 실제 api(mock) 스트림 형식 비교 | 통과 | `DATA_SOURCE=mock PORT=3091` 컴파일본 실행(아래), `curl -N`으로 20초 수신: 헤더·`retry: 3000`→hello→토픽 스냅샷 순서, 스냅샷 payload 키를 계약 모양 fixture와 재귀 비교 → 누락 0(데이터 의존 키 1개 제외), 추가 필드만(`overview.advisor.status`, `cost.estimate.stale`, `cost.actual.stale/staleReason`, `cost.status.thresholds.*`) |
| 실제 api REST 형식 비교 | 통과 | nodes/:name, pods/:ns/:name, workloads 상세, metrics/series, attention, rate-series, prechecks, runs, mock/scenarios, snapshot-preview — 누락 0 |
| `next start -p 3092` + 실제 api, headless Edge(puppeteer-core, scratchpad 설치) | 통과 | `/`, 노드 목록·상세, 워크로드(`?focus=`), 파드 목록·상세, 이벤트, DB, 비용, 어드바이저, `/dev/mock` 모두 `실시간` 연결·콘솔 오류 0·1440px 가로 넘침 없음, 다크 테마가 첫 페인트 전 적용(`data-theme=dark`), `/cluster` 307 |
| 360px `/cost` | 가로 스크롤 있음 | shell.md 1.1: 1024px 미만은 지원 대상 아님(가로 스크롤 허용). 1024px 개요는 넘침 없음 |
| 가짜 API 서버 | 생략 | PM 지시로 실제 api 사용 |
| `docker compose` | 생략 | Docker 없음 |

- 실측 중 발견·수정: 요약 띠 파드/워크로드 개수 줄바꿈 → nowrap, DB 카드 대표 지표 단위(`응답 769` → `응답 769 ms`) 누락 → 단위 해석, 비용 표 머리글 `[추정]` 배지로 열 이름 잘림 → 폭 확대, 일별 차트 기준선 라벨 넘침 → 단위 생략, 급증 타일 문구가 큰 글자로 나옴 → caption.
- `start:dev`(nest --watch)는 다른 담당이 백엔드 파일을 고칠 때마다 재시작돼 확인이 끊겼다 → `tsc -p apps/api/tsconfig.build.json --outDir <scratchpad>/api-dist` 후 `node`로 실행(`NODE_PATH=apps/api/node_modules`). 내가 띄운 프로세스는 PID로만 종료했다.

### 7. 남은 이슈·한계
- 실제 live 클러스터·브라우저 재연결(네트워크 끊김) 시나리오는 단위 테스트(가짜 EventSource)로만 확인. 실제 끊김·재연결 화면(배너·다시 연결됨)은 5b에서 확인 필요.
- 개요 PageHeader의 `시스템 네임스페이스 숨기기` 스위치는 넣지 않음 — `/api/overview`에 해당 파라미터가 없음(계약 밖을 가정하지 않음).
- 이벤트 화면 `새 이벤트 N건`(스크롤이 맨 위가 아닐 때 버튼)은 미구현. 대신 hover 중 재정렬 보류 규칙을 공통 적용.
- 차트: 툴팁은 마우스 기준(키보드 탐색 없음, 대신 `표로 보기`와 role=img 요약). 1280px 미만 반응형 세부(카드 3+2 등)는 퍼블리셔 Grid 규칙에 의존.
- 개요 CPU·메모리 기간 전환(6h/24h)은 `history.source=prometheus`일 때만 표시(현재 구현은 in_memory 1시간만 → 버튼 없음).
- `src/lib/health.ts`는 더 이상 쓰지 않음(뼈대 파일, 삭제는 보류).

### 8. 다른 담당 요청
- `퍼블리셔 요청`: `DataSourceBadge`의 `ScenarioGroup`에 `db` 추가(계약 6.1은 cluster·db·cost·advisor 4그룹). 지금은 배지 Popover에 db를 넣지 못해 `/dev/mock`에서만 전환.
- `퍼블리셔 요청`: `StatusCard` 176px 고정에서 counts가 두 줄로 접히면(1440px 5열, `장애 2 · 주의 4 · 정상 7`) 문제 항목 3행이 하단 `목록 보기`와 겹친다(스크린샷 확인). counts 줄바꿈 방지 또는 min-height 필요.
- `퍼블리셔 요청`: `RunProgressPanel` 지연 안내 문구의 `10분`, `RunResultAlert` 제목 `시간 초과 (10분)`이 고정 문자열 — 서버 `run.limits.timeoutSec`를 받을 수 있게 prop 추가 검토(현재 값 600초라 문구는 맞음).
- `퍼블리셔 요청`: 배치 유틸 클래스(행 간격·caption 텍스트 등)를 `styles/`에 제공하면 `features/common/layout.module.css`를 지울 수 있다.
- `백엔드 요청(계약)`: 구현이 계약에 추가한 필드(`overview.advisor.status`, `cost.estimate.stale`, `summary.monthEnd.estimated`가 null 가능)를 `docs/api`에 반영.

### 9. 다음 담당이 알아야 할 점
- 페이지에서 스트림 쓰기: `useTopics(["cluster","metrics"])` + `useStreamStore()` → `{ stream, connection }`. 클러스터 화면은 `useClusterView(topics)`(now 1초·watch stale·클러스터 연결 없음 판정 포함).
- REST: `useApi<T>(path, query, refreshKey)` — refreshKey가 바뀌면 이전 데이터를 유지한 채 다시 받음. 에러 본문은 `errorBody(e)`.
- 배지: `badgeProps(StatusInfo, staleMark)` → `<StatusBadge {...} />`. 판단 이유는 `reasonTexts(info)` 그대로.
- 5b 실제 검증 시 `NEXT_PUBLIC_API_URL`은 빌드 시 고정(다른 포트로 띄우면 다시 빌드), API의 `CORS_ORIGIN`에 웹 주소 추가 필요.
- 가짜 저장소로 화면 렌더: `features/pages.test.tsx`의 `fakeStore()` 참고.

#### 수용 기준 (프론트 몫) — `docs/specs/cluster-status.md` 5절
| 기준 | 판정 | 근거 |
|---|---|---|
| mock, api·web만 띄워 모든 화면이 오류 없이 + MOCK 배지 | 충족 | 실제 api(mock) + next start, 8개 화면 콘솔 오류 0, 배지 표시 |
| 각 영역 정상·주의·장애·알 수 없음·데이터 오래됨 재현 | 충족(화면 몫) | 서버 상태 그대로 표시, stale은 서버 플래그·타이머 둘 다(테스트). 시나리오 전환 UI 제공 |
| 몇 분간 값이 주기적으로 바뀜(SSE) | 충족 | 실측: 20초 동안 upsert·metrics.updated·heartbeat 수신, 화면 `실시간 HH:mm:ss` 갱신 |
| live + kubeconfig 없음 → 클러스터 영역 알 수 없음(클러스터 연결 없음) | 충족(화면 몫) | kube `not_configured`면 목록 대신 UnknownState, 상단바 `클러스터 연결 없음`(테스트) |
| 모든 상태 배지 옆 판단 이유 한 줄 | 충족 | PageHeader·표 사유 열·카드·타일에 서버 `reasons[].text` |
| 조회만 (RBAC 등) | 해당 없음 | 화면에 쓰기 동작 없음 |
| CrashLoopBackOff 3초 안에 목록 맨 위·요약 장애 | 충족(화면 몫) | upsert 즉시 반영(프레임 배치), 기본 정렬 crit 먼저(테스트). 3초 지연 측정은 미확인 |
| 재시작 3회 장애/1~2회 주의, NotReady 60초, ready 0/2, CPU 연속 3회 | 해당 없음(서버 판단) | 화면은 서버 status 그대로 |
| 파드 상세에서 소속 워크로드·노드·관련 이벤트로 이동 | 충족 | 링크(`?focus=`, 노드 상세), 이벤트 표 |
| DB 연결 92% → 장애 + 이유 | 충족(화면 몫) | 서버 이유 그대로 |
| DB 접속 실패, 다른 영역 영향 없음 | 충족(화면 몫) | DB 타일만 unknown, InlineAlert 오류 한 줄 |
| 세션 목록에 쿼리 원문 없음 | 충족 | 열에 없음 + 안내 문구(테스트) |
| standby 없음 → 복제 해당 없음 | 충족 | `applicable:false` → `해당 없음` 칩(테스트) |
| SSE 끊김 → 연결 끊김·마지막 갱신 배너, 재연결 시 사라지고 값 재동기화 | 충족(단위 테스트) / 실제 끊김 미확인 | 배너 5초 지연·카운트다운·다시 연결됨·스냅샷 교체 테스트. 실브라우저 끊김은 5b |
| DB 45초 갱신 없음 → 데이터 오래됨 | 충족 | 타이머 + `monitoredDb` stale |
| metrics-server 없음 → CPU·메모리만 알 수 없음 | 충족 | 차트 UnknownState + 설치 안내, 표 CPU·메모리 `—` + 머리글 툴팁 |
