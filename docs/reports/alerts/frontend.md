# alerts · frontend 작업 보고

> 파일 위치: `docs/reports/alerts/frontend.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 23:55 · 알림 센터 통합 (사이드바 배지 · 탭 제목 · `/alerts`)

> **이번 작업은 `alerts`와 `logs` 두 기능을 한 번에 맡았다.** 사이드바·셸·스트림 배선을 나눠 쓰기 때문이다.
> **공통 사항(사이드바 3항목·셸 배선·검증 명령 전체)은 이 문서가 정본**이고, 로그 화면 전용 판단은
> `docs/reports/logs/frontend.md`에 있다.

### 1. 요청 내용

PM 지시(5단계 통합) 중 alerts 몫:

| # | 요청 | 결과 |
|---|---|---|
| A | 사이드바 3항목(`알림`·`로그`·`설정`) — `footerItems={DEFAULT_NAV_FOOTER_ITEMS}`, 셋 다 상태 점 없음, `알림`만 숫자 배지 | 구현 |
| B | `/alerts` 알림 센터 — 목록·필터·읽음 처리·정지 구간 | 구현 |
| C | 브라우저 탭 제목 `(3) Sentinel` | 구현 |
| D | **목록을 전역 상태에 들지 않는다**(AC-ALERT37) | 구현 + 네트워크로 확인(6절 B1) |
| E | 설정 화면은 **자리까지만** (저장·테스트 발송은 backend P2) | 빈 화면 + API 호출 0건 |
| F | 실제 브라우저(Playwright + 설치된 Edge)로 확인 | 수행. **결함 4건을 눈으로 찾아 고쳤다**(6절) |

### 2. 참고한 문서

- `docs/api/alerts.md` **전체**(1.3 `AlertItem`·1.4 `DispatchRecord`·2.1~2.4·6절 SSE·**11절 화면이 하지 않는 것**·12절 차이)
- `docs/api/common.md` 5절(SSE 봉투·재연결), 7절 공통 타입
- `docs/design/alerts.md` 2~11절, `docs/design/shell.md` **2.2(탭 제목)·3.1(상태 점 없는 항목)·3.2(배지)·3.3(세로 공간)**
- `docs/reports/alerts/README.md` — 사용자·PM 결정(Q1 사이드바, Q8 탭 제목), **"frontend 착수 시 반드시 전달할 것"**(배지=SSE / 목록=REST), "디자인 결과에서 구현이 지켜야 할 것"
- `docs/reports/alerts/publisher.md` **8절 프론트 요청 1~8**(특히 6: `flapping`은 boolean, `reason`은 문자열)
- `docs/reports/alerts/backend.md` 최신 섹션 8·9절(배지 3필드, `gaps[]`는 필터 무관, 스냅샷에 목록 없음)

### 3. 작업 내용

#### (1) 스트림 배선 — 배지는 받고 **이력은 받지 않는다**

- `StreamTopic`에 `alerts`를 더하고 **`BASE_TOPICS`에 넣었다**(모든 페이지 구독, 계약 6절).
- 리듀서 `applyAlerts`는 **`payload.alert`를 읽지 않는다.** 꺼내는 것은 `badge`뿐이고, 항목은 카운터(`seq`)로만 남긴다.
  - 계약이 스냅샷에서 목록을 뺐어도(6.1) **`alerts.created`의 항목 객체를 전역 상태에 쌓으면 같은 구멍이 되살아난다.**
    리듀서 코드에 그 이유를 주석으로 박고, 상태 전체를 문자열로 만들어 항목 특징값이 0건인지 **테스트로 고정**했다.
- `/alerts` 화면은 그 카운터가 오르면 **300ms debounce 로 `GET /api/alerts`를 다시 읽는다**(계약 11절). `facets`·`gaps`는
  기간 필터에 딸린 값이라 이벤트에 실리지 않으므로, 행만 끼워 넣으면 두 값이 어긋난다.

#### (2) 사이드바 배지 + 탭 제목 (`features/alerts/badge.ts`)

- `alertsNavPatch(badge, loaded, streamDown)` — `{count, countTone, countLabel}` 세 개만 만든다. **상태 점은 주지 않는다**(shell.md 3.1).
  - 0이면 **그리지 않는다**(자리도 비운다), 값을 받기 전에도 그리지 않는다(깜박임 방지).
  - **끊겨도 0으로 내리지 않는다** — 마지막 값 + `countLabel` 끝에 `· 14:02:10 기준`.
- `useBadgeFallback` — 스트림이 아직 배지를 주지 않았을 때만 `GET /api/alerts/badge`를 **한 번** 부른다(계약 2.3 폴백).
- `useTabTitleCount` — Next 가 라우트마다 `<title>`을 다시 쓰므로 `MutationObserver`로 접두어를 다시 붙인다.
  0이면 접두어를 떼고, 100건 이상은 `(99+)`. **배지와 언제나 같은 값**이다.

#### (3) `/alerts` 알림 센터

- 요약 줄: `미확인 N` + 심각도 4개. 숫자는 **서버 `facets`**이고 0이 아닌 것만 누를 수 있는 필터 칩이다(0은 `text.disabled`).
- 필터(심각도·영역·기간·안 읽음만·해제 포함)는 URL 쿼리에 두고 **서버에 그대로 보낸다**(화면이 거르지 않는다).
  영역 후보는 서버 `watch.keys`(감시 대상 8개)에서 만든다 — `area=system` 필터를 만들지 않는다.
- 목록: `mergeRows(items, gaps)`가 **시각 순으로 섞는다.** `gaps`는 별도 배열로 와서 **어떤 필터에서도 그대로 그려진다**
  (필터 배열에서 빼는 코드가 아예 없다). 항목이 0건이어도 빈 상태 문구 **위에** 남는다.
- 읽음: **항목 클릭·확장·안 읽음 점·`모두 확인`만** `PATCH /api/alerts/read`를 부른다. 화면을 여는 경로에는 호출이 없다.
- 확장: 종류별로 전이 한 줄·완화·확인 불가 구간·재시작 요약·플래핑 타임라인·출처 억제 목록·영향 객체·발송 기록·본문 전문.
  상세는 **펼칠 때 한 번** `GET /api/alerts/:id`로 읽는다. **조작 버튼은 하나도 없다**(조회 전용).
- 빈 상태: 기간 문구 그대로 + footer `대시보드는 14:02:10까지 정상적으로 지켜보고 있습니다 · 감시 대상 8개`(서버 `watch`).

#### (4) 셸

- `SideNav`에 `footerItems={DEFAULT_NAV_FOOTER_ITEMS}`를 넘겨 `설정`이 하단 고정으로 나온다(12항목).
- `LOGS_ENABLED=false`면 `로그` 항목을 목록에서 **뺀다**(logs.md 0절, 서버 `capabilities.enabled` 하나로만 판단).
- `/settings`는 **아무 API도 부르지 않는 빈 화면**이다. `GET /api/alerts/settings`는 아직 `@Get(':id')`에 잡혀 404라
  (backend 7절) 부르면 "설정이 고장났다"로 보인다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/alerts/types.ts` | 추가 | 계약 1절 타입. **로그 필드 없음** |
| `apps/web/src/features/alerts/badge.ts` | 추가 | 사이드바 배지 패치·탭 제목·배지 폴백 |
| `apps/web/src/features/alerts/model.ts` | 추가 | 기간·필터·`mergeRows`·안내 우선순위·발송 칩 변환(순수 함수) |
| `apps/web/src/features/alerts/AlertsPage.tsx` | 추가 | `/alerts` 화면 |
| `apps/web/src/features/alerts/alerts.module.css` | 추가 | 요약 줄·목록·확장 배치 |
| `apps/web/src/features/alerts/alerts-logs.test.tsx` | 추가 | 15건 (alerts·logs 공통) |
| `apps/web/src/app/alerts/page.tsx` | 추가 | 라우트(`title: 알림`) |
| `apps/web/src/app/settings/page.tsx` · `features/settings/SettingsPage.tsx` | 추가 | **자리만** (API 호출 0건) |
| `apps/web/src/features/stream/reducer.ts` | 수정 | `AlertsStreamState` + `applyAlerts`(**항목 저장 안 함**) + 이벤트 4개 |
| `apps/web/src/features/stream/client.ts` | 수정 | `BASE_TOPICS`·`TOPIC_ORDER`에 `alerts` |
| `apps/web/src/features/common/types.ts` | 수정 | `StreamTopic`·`ALL_TOPICS`에 `alerts`, `MockGroupId`에 `alerts`·`logs` |
| `apps/web/src/features/common/hooks.ts` | 수정 | `useIsClient()` 추가(하이드레이션 안전) |
| `apps/web/src/features/shell/nav.ts` | 수정 | 알림 배지 패치, `LOGS_ENABLED=false`면 `로그` 항목 제외 |
| `apps/web/src/features/shell/ShellClient.tsx` | 수정 | `footerItems`, 배지, 탭 제목, 로그 가용성 |
| `apps/web/src/features/stream/connection.test.ts` · `features/k8s-snapshots/model.test.ts` | 수정 | 기본 토픽 문자열 3곳 (`alerts` 추가 반영) |
| `apps/web/eslint.config.mjs` | 수정 | `.next-*/**` 무시 (개발용 별도 dist 를 lint 하지 않게) |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| F1 | **리듀서가 `alerts.created`의 항목을 저장하지 않는다.** `/alerts`는 카운터를 보고 300ms debounce 로 재조회한다 | 계약 11절대로 "행은 즉시 추가" — 받은 항목을 잠깐 들고 있다가 재조회로 맞추기 | 항목을 들려면 **어딘가에 둬야** 하는데, 전역 스토어에 두면 알림 화면을 보지 않는 탭이 이력을 든다(AC-ALERT37이 막으려는 바로 그 일). 화면 안에서만 들려면 스트림→화면 전용 이벤트 버스를 새로 만들어야 한다. 얻는 것은 **최대 300ms 빨라지는 행 추가**뿐이라 무게가 맞지 않다. `burst`(3초마다 1건)에서 눈으로 확인했다 — 행이 밀리는 느낌이 없다 |
| F2 | 발송 칩은 **`DISPATCH_SPEC`에 있는 상태만** 넘긴다 | ① 없는 키를 그대로 넘긴다 ② 비슷한 키로 바꿔친다 | ①은 `undefined.label`로 터지고, ②는 **틀린 문구**가 나온다(`skipped_no_pair`를 `제외(심각도)`로 그리면 "왜 안 갔나"를 영영 못 찾는다). 계약 11절의 "모르는 값은 중립 칩" 은 컴포넌트가 중립 칩을 가질 때 성립한다 — 지금은 없으므로 **칩을 그리지 않고 확장 영역에서 서버 `label`을 그대로** 보여 준다. 퍼블리셔가 2종을 넣으면 런타임 검사(`state in DISPATCH_SPEC`)가 저절로 통과시킨다 |
| F3 | 배지·목록 부분은 **하이드레이션 이후에** 그린다(`useIsClient`) | 그대로 두기 | 스트림 저장소는 `getServerSnapshot`도 살아 있는 값을 주므로, SSE 스냅샷이 하이드레이션 전에 도착하면 `모두 확인` 버튼이 서버(비활성+툴팁 래퍼) ↔ 클라이언트(일반 버튼)로 **DOM 구조가 갈려** hydration 오류가 난다. 실제로 났고(6절 B2) 이 방식으로 없앴다. `useSyncExternalStore`를 쓴 이유는 effect + setState 가 React Compiler 규칙에 걸리기 때문이다 |
| F4 | 상세 조회를 **`setState` 갱신 함수 밖**으로 뺐다 | 갱신 함수 안에서 `fetch` | 갱신 함수는 여러 번 불릴 수 있어 같은 상세를 **4번** 불렀다(브라우저로 확인, 6절 B3). 이미 부른 id 를 ref 로 기억한다 |
| F5 | 안내 줄 톤을 **코드별 우선순위 표**로 정했다 | `notice.level` 만 쓰기 | `ALERTS_DISCORD_NOT_CONFIGURED`가 `level: info`로 와도 화면에서는 "회색 안내"여야 하고(AC-ALERT19), `ALERTS_HISTORY_MEMORY_ONLY`는 **데이터가 실제로 사라지는** 사실이라 warn 이다. 목록에 없는 코드는 서버 `level`을 따른다(화면이 코드→문구 매핑 표를 갖지 않는다는 규칙은 **문구**에 대한 것이고, 톤은 디자인 3.3이 정한다) |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과** (0 error) | React Compiler 규칙(`set-state-in-effect`·`purity`·`refs`) 때문에 `LogViewer` 상태를 파생값으로 3번 고쳤다 |
| `npx tsc --noEmit` (apps/web) | **통과** | |
| `npm test --prefix apps/web` | **566 passed (24 files)** | 기준선 551 + 신규 15. **기존 테스트 3건 수정**(7절 R1) |
| `NEXT_DIST_DIR=.next-febuild npx next build` | **통과** | `/alerts`·`/logs`·`/settings` 라우트 생성 확인. 끝난 뒤 폴더 삭제 |
| **브라우저(Playwright + 설치된 Edge)** | 아래 B1~B6 | 웹 :3123 / mock API :3124. `netstat`로 그 포트를 듣는 PID 를 확인하고 **내가 띄운 PID만**(3124: 12672→22092, 3123: 27760·10700) `Stop-Process -Id` 로 껐다 |

**B1. AC-ALERT37 — 알림 화면을 안 연 탭에 이력이 오지 않는다 (네트워크로 확인)**

| 확인 | 결과 |
|---|---|
| `/cluster/pods` 탭의 스트림 토픽 | `overview,snapshot-menu,alerts` |
| 그 탭의 `GET /api/alerts` 호출 | **0건** |
| 재연결(새 스트림 연결) 시 `alerts.*` 이벤트 | `alerts.snapshot` **1건뿐** |
| 그 payload 의 키 | `badge`·`watch`·`dispatch`·`persistence`·`warmup`·`notices` — **`items`·`occurredAt`·`targets`·`severityLabel` 0건**, 899바이트 |
| 배지 호출 | `GET /api/alerts/badge` (숫자·색·시각 3개뿐) |

**B2. 결함 4건 (브라우저로 찾아 고침)**

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| 1 | `/alerts`에서 hydration 오류 | 서버는 배지 0(비활성 버튼 + 툴팁 래퍼), 클라이언트는 배지 4(일반 버튼) → **DOM 구조가 갈렸다** | `useIsClient()`로 하이드레이션 이후 렌더 (F3) |
| 2 | 같은 상세를 **4번** 조회 | `setDetails` 갱신 함수 안에서 `fetch` | ref 로 중복 차단 (F4) |
| 3 | 로그 화면에서 **`CrashLoopBackOff` 컨테이너를 고를 수 없다** | 컨테이너 칩에 `disabledReason`을 넘겼는데 `SegmentedControl`이 그것만으로 칸을 **비활성**으로 만든다 | `tooltip`으로 바꿨다 (`logs/frontend.md` L3) |
| 4 | 컨트롤 플레인 로그 버튼 0개 | **SSE `cluster` 스냅샷의 `logHref`가 항상 `null`**(REST 는 값이 있다) | 서버 값 우선 + `LOGS_ENABLED` 확인 후 `podKey` 폴백. **backend 요청**(8절) |

**B3. 읽음 처리 (디자인 4.6)**

| 조작 | read 호출 | 배지 |
|---|---|---|
| 화면 열기만 | **0건** | 4 → 4 |
| 항목 확장 | 1건 | 4 → 3 |
| 안 읽음 점 클릭 | 1건 | 3 → 2 |
| `모두 확인 (2)` | 1건 | 2 → **0**, 탭 제목 `(2) 알림 · Sentinel` → `알림 · Sentinel` |

**B4. 정지 구간 — 어떤 필터로도 사라지지 않는다**

`?sev=critical` / `?resolved=0` / `?area=cost` / `?unread=1&sev=warning` **네 경우 모두 1개 유지**(항목이 0건이 되는 조합 포함).

**B5. 사이드바·탭 제목**

| 확인 | 결과 |
|---|---|
| 항목 | **12개** (`/`,`/alerts`,노드,워크로드,파드,이벤트,`/logs`,DB,비용,어드바이저,스냅샷 + 하단 `/settings`) |
| 1366×768 | 사이드바 56~768px(뷰포트 안), `설정` 바닥 714px **보임**, 문서 가로 스크롤 없음 |
| 배지 | 펼침: 라벨 `알림` + sr-only `, 안 읽음 4건` + 숫자 `4`(crit) — **보이는 숫자는 하나** |
| 접힘(64px) | 항목 상자 47×40px **안에** 배지 `4`가 들어간다 |
| 탭 제목 | `(4) 파드 · Sentinel` / `(4) 알림 · Sentinel` / 0이면 접두어 없음 |
| `LOGS_ENABLED=false` | 항목 **11개**(`로그` 사라짐) |

**B6. `alerts=burst` (실제로 쌓이는 것)**

탭 제목 `(3) 파드 · Sentinel` → **`(6)`**, 사이드바 배지 3 → **6**, `/alerts` 행 16 → **19**(8초). 낭독은 배지 문구 1줄만.

**하지 못한 검증(숨기지 않고 적는다)**

- **대시보드 DB가 있는 경로를 보지 못했다.** mock API 에 DB 가 없어 전부 `persistence: "memory"`였다 — `ALERTS_HISTORY_MEMORY_ONLY` 안내 줄과 "최근 200건만" 문구는 그 상태로만 확인했다.
- 억제 15분·플래핑 30분·확인 불가 5분은 **기다려야 해서** 화면에서 보지 못했다. `flapping`·`restart`·`suppressed-by-source` 시나리오로 **표시**만 확인했다.
- 디스코드 발송 관련 화면(`webhook-failed`·`webhook-ratelimited`의 칩)은 mock 시나리오를 바꿔 **칩 문구만** 봤고, 실제 발송 경로(P2)는 범위 밖이다.
- **스크린리더 실물 낭독**(NVDA 등)은 하지 못했다. 접근 이름은 DOM 으로만 확인했다.
- `/cluster/pods`·`/cluster/nodes`에서 hydration 오류가 남아 있다(7절 R2). **이번 작업으로 생긴 것이 아니다**는 근거는 7절에 적었다.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| R1 | **기존 테스트 3건을 고쳤다**(`connection.test.ts` 2곳, `k8s-snapshots/model.test.ts` 1곳). 전부 `BASE_TOPICS` 문자열 비교이고, `alerts`가 기본 토픽이 된 것이 계약(6절)이라 값을 맞추는 것 외에 방법이 없다. 검사 의도는 그대로 두고 문자열만 바꿨으며 "왜 늘었는지"를 주석으로 남겼다 |
| R2 | `/cluster/pods`·`/cluster/nodes`에서 hydration 오류가 난다. **배지를 0으로 만들어도 그대로**이고, **SSE 를 차단하면 사라진다** → 원인은 "스트림 데이터가 하이드레이션보다 먼저 도착하면 표 내용이 서버 HTML 과 달라진다"는 **기존 구조**다(`/cluster/pods`는 이번에 한 줄도 건드리지 않았다). 다만 `alerts` 토픽이 늘면서 스냅샷 도착 순서가 바뀌어 **더 자주 드러날 수는 있다.** 근본 해결은 `useStreamStore`에 `getServerSnapshot`을 따로 주는 것이라 이번 범위 밖으로 남긴다 — **PM 판단 요청** |
| R3 | 목록 가상 스크롤을 넣지 않았다. 기본 `limit` 100건 + `더 보기`(최대 500)로 두었다. 디자인은 200건 초과 시 가상 스크롤인데, 항목 높이가 가변(확장 포함)이라 지금 넣으면 점프가 생긴다(publisher R2와 같은 한계) |
| R4 | `모두 확인`은 확인 대화상자 없이 곧바로 부른다(디자인 4.6 그대로). 되돌리기가 없으므로 문구에 개수를 적어 미리 보이게 했다 |
| R5 | 알림 항목의 `logHref`는 서버 값을 그대로 쓰므로 `follow=1`이 없다 — 로그 화면이 **정지 조회**로 열린다. 디자인 6.2는 "알림·매트릭스에서 들어오면 따라가기 켬"이라 어긋난다. 서버 링크에 화면이 파라미터를 덧붙이지 않는 쪽을 택했다(8절 요청) |

### 8. 다른 담당 요청

**backend 요청**
1. **`cluster` 토픽 SSE 의 `ControlPlaneComponent.logHref`가 항상 `null`이다.** `GET /api/cluster/control-plane`은 값을 주는데
   (`/logs?namespace=kube-system&pod=kube-apiserver-i-0a1b…`) `cluster.snapshot`·`cluster.controlplane.updated`에는 `null`이 온다(2026-09-24 23:50 실측).
   컨트롤 플레인 매트릭스는 **스트림으로 그리므로** 그대로면 로그 동선이 통째로 사라진다. 지금은 `LOGS_ENABLED` 확인 후 `podKey` 폴백으로 메워 뒀고,
   스트림에도 값이 오면 **폴백은 저절로 쓰이지 않는다**(서버 값 우선). 고쳐지면 `ControlPlaneSection.tsx`의 폴백을 지워도 된다.
2. `logHref`에 `follow=1`을 붙일지 정해 달라(디자인 6.2: 알림·매트릭스 진입은 따라가기 기본 켬). 지금은 **서버 값 그대로** 쓰므로 정지 조회로 열린다.
3. `alerts` 토픽의 `alerts.created`/`updated` payload 에 항목 전체가 들어 있다(계약대로다). 화면은 **읽지 않고 버린다** —
   나중에 payload 를 줄일 여지가 있다면 배지만 남겨도 프론트는 영향이 없다(참고).

**publisher 요청**
1. **`DISPATCH_SPEC`에 `skipped_no_pair`·`skipped_circuit_open` 2종이 없다**(계약 1.4·12절이 추가한 값). 지금은 그 상태의 발송 기록을
   **칩으로 그리지 않고** 확장 영역의 서버 문구로만 보여 준다. `components.md` 20절 표에 두 줄을 더하고 `DISPATCH_SPEC`에 넣어 주면
   프론트 변경 없이 칩이 나온다(런타임에 `state in DISPATCH_SPEC`으로 거른다). 문구는 서버가 `label`로 주므로 "제외" 계열 중립 칩이면 된다.
2. `SegmentedControl`의 `disabledReason`은 **단독으로도 칸을 비활성으로 만든다**(`disabled || disabledReason`). 사유만 툴팁으로 주고 싶은 자리에서
   함정이 된다(실제로 컨테이너 칩이 눌리지 않는 결함이 났다). `tooltip`으로 우회했으니 조치는 필요 없지만, 20·21절 주석에 한 줄 있으면 좋겠다.

**designer 참고(조치 불필요)**
- 요약 줄의 심각도 칩은 **단일 선택 토글**로 만들었다(누르면 그 심각도만, 다시 누르면 해제). 여러 개 고르는 것은 `심각도` MultiSelect 가 맡는다.

### 9. 다음 담당이 알아야 할 점

1. **목록을 전역 상태에 올리지 마라.** `features/stream/reducer.ts`의 `applyAlerts`에 그 이유가 주석으로 있고, 테스트가
   "상태 문자열에 항목 특징값 0건"으로 고정한다. 편의를 위해 `alert`를 저장하는 순간 AC-ALERT37이 조용히 깨진다.
2. **배지는 `features/alerts/badge.ts` 한 곳에서만 만든다.** 사이드바와 탭 제목이 같은 값을 쓰는 이유가 그것이다(둘이 다르면 하나는 고장).
3. **화면을 여는 경로에 `PATCH /api/alerts/read`를 넣지 마라.** 지금은 `markRead`를 부르는 곳이 4개(항목 클릭·확장·점·모두 확인)뿐이다.
4. 설정 화면을 만들 때: `SecretInput`·`lockedByEnv`·리소스 이름 안내 자리(**테스트 발송 버튼 바로 위**)·`confirm: true`·쿨다운 429 처리가
   `docs/design/settings.md`와 계약 2.5~2.7에 이미 정해져 있다. `SettingsPage.tsx` 머리말에 요약해 뒀다.
5. `useIsClient()`(`features/common/hooks.ts`)는 **스트림 값으로 DOM 구조가 바뀌는 자리** 전용이다. 남발하면 첫 페인트가 늦어진다.

## 2026-09-25 06:50 · 통합 2차 (설정 화면 · 하이드레이션)

> 이번에도 `alerts`·`logs`를 한 번에 맡았다. **공통 검증(명령·하이드레이션)은 이 섹션이 정본**이고,
> 로그 찾기 단축키·본문 높이는 `docs/reports/logs/frontend.md`의 같은 날짜 섹션에 있다.

### 1. 요청 내용

PM 지시(5c 통합 2차) 중 alerts 몫:

| # | 요청 | 결과 |
|---|---|---|
| A | `/settings` 알림 설정 화면(P2, AC-ALERT19~34) — 1차의 "API 호출 0건 빈 자리"를 채운다 | 구현 |
| A-1 | `SecretInput`: 웹훅 원문을 다시 그리지 않고, 저장 성공 즉시 입력칸·DOM 값을 비운다 | 구현 + 브라우저·테스트로 확인 |
| A-2 | 잠금: `SecretInput.lockedByEnv`에는 `lockedByEnvDetail[].envVar`(환경 변수 이름). 잠긴 항목은 "왜 못 고치는지" | 구현 |
| A-3 | `PATCH` 성공 응답(전체 설정)으로 바꿔 끼우고 다시 GET 하지 않는다 | 구현 + 호출 수로 확인 |
| A-4 | 리소스 이름 안내는 **테스트 발송 버튼 바로 위**, `closable` 없음, 확인 대화상자 안에 넣지 않음 | 구현 + 테스트로 자리 고정 |
| A-5 | 테스트 발송 `confirm: true`, 쿨다운은 서버 `Retry-After`/`retryAfterSec`(429), mock 은 `skipped_mock` | 구현 + 실제 mock API 로 확인 |
| A-6 | `skipped_*`는 오류가 아니다(빨간색·배너·토스트 금지) | 구현 |
| A-7 | Card 2·3 표시만, 예산 편집 자리 없음 | 구현 |
| B | **R2 하이드레이션 결함**: `useStreamStore`에 `getServerSnapshot`을 따로 주고, `useIsClient()`는 필요한 자리만 남긴다 | 수정. `useIsClient()`는 **남길 자리가 0곳**이라 훅째 지웠다(5절 H2) |
| C | `/cluster/pods`·`/cluster/nodes`·`/alerts`·`/`에서 콘솔 hydration 오류 0건을 브라우저로 확인 | 개발 서버·프로덕션 빌드 둘 다 0건 + 되돌려서 다시 나는 것까지 확인(6절) |

하지 않은 것(지시대로 3차로 미룸): 파드 목록 행·이벤트·워크로드·DB 상세의 `로그` 진입점, 워크로드 선택기, `stack` 합쳐보기,
`ControlPlaneSection`의 `podKey` 폴백 제거, `at` 파라미터. 발송 칩 2종은 publisher 가 처리했다(아래 3-(4)).

### 2. 참고한 문서

- `docs/reports/alerts/README.md` — "PM 결정 — 통합 1차에서 올라온 것"(R2), "디자인 결과에서 구현이 지켜야 할 것", "설정 화면 안내 문구"
- `docs/reports/logs/README.md` — 같은 절(D1·D2 유지)
- 내 1차 보고서 두 개(특히 9절)
- `docs/design/settings.md` 전체, `docs/design/components.md` 20.3(`SecretInput`)·21.7(`Dialog`)
- `docs/api/alerts.md` 2.5~2.7·8절(오류 코드)·11절(화면이 하지 않는 것)
- `docs/specs/alerts.md` 5절 P2(AC-ALERT19~34)
- `docs/reports/alerts/backend.md` 23:40 섹션 8절 "frontend 요청" 4개 — ① PATCH 응답 = 전체 설정 ② 저장 즉시 비우기 ③ 쿨다운은 서버 값 ④ `lockedByEnv` vs `envVar`

### 3. 작업 내용

#### (1) 하이드레이션 결함(R2) — 스토어 한 곳에서 서버 스냅샷을 비웠다

- 원인(재현으로 확인): 셸(`StreamProvider`)이 먼저 하이드레이션되고 effect 에서 SSE 를 연다 → 스냅샷이 도착한다 →
  **그 뒤에** `<Suspense>` 안의 페이지(`/cluster/pods`·`/cluster/nodes`)가 하이드레이션된다. 이때 `useSyncExternalStore`의
  세 번째 인자가 `store.getSnapshot`(살아 있는 값)이라 페이지가 **채워진 표**로 하이드레이션하려 하고, 서버 HTML 은 **빈 표**라 갈린다.
- 수정: `client.ts`에 `SERVER_STREAM_SNAPSHOT`(= `initialStreamState` + 초기 연결, `Object.freeze`한 모듈 상수)을 두고
  `useStreamStore`의 `getServerSnapshot`이 **언제나 그것**을 돌려준다. 하이드레이션이 끝나면 React 가 `getSnapshot`과 다른 것을
  보고 곧바로 다시 그리므로 데이터가 늦게 보이는 일은 없다. `StreamClient`의 첫 상태도 같은 상수에서 시작한다.
- `/alerts`의 `useIsClient()` 우회(1차 F3)를 **걷어냈다**. 서버·하이드레이션이 같은 빈 값을 보므로 `모두 확인` 버튼 구조가 갈리지 않는다.
  다른 사용처가 없어 `features/common/hooks.ts`에서 훅 자체를 지웠다(주석이 "스트림 저장소는 서버 스냅샷도 살아 있는 값"이라는
  **이제는 틀린 설명**을 담고 있었다).

#### (2) `/settings → 알림` (P2)

구조는 디자인 2절 그대로: `PageHeader`(보조 줄 디자인 문구) → (DB 없음이면 `Banner` warn) → Card 1 디스코드 알림 → Card 2 알림 대상 → Card 3 화면 알림과 이력. 폼 최대 폭 720px, 탭 줄 없음(디자인 7절·AC-ALERT34).

**조회·저장**
- 화면 전용 훅 `useAlertSettings`: `GET /api/alerts/settings` 1회. `PATCH` 성공 응답을 `replace()`로 **그대로 바꿔 끼운다**(다시 GET 없음).
- 스위치 2개·보낼 심각도는 **즉시 저장**. 저장 중에는 그 값을 보여 주고 컨트롤을 막으며, 실패하면 서버 값으로 되돌아가고 항목 바로 아래 `InlineAlert` crit compact. 성공하면 카드 제목 오른쪽 `저장됨 HH:mm`(1500ms, 서버 `generatedAt`) + `aria-live` `저장됐습니다`.
- 오류 처리: 400 `VALIDATION_FAILED`(웹훅) → 필드 아래 **서버 사유 한 줄**(입력값을 되비추지 않는다) / 409 `SETTING_LOCKED_BY_ENV` → warn 한 줄 + 설정을 다시 읽어 잠금 상태로 / 503 `DASHBOARD_DB_UNAVAILABLE` → crit 한 줄 + 다시 읽기.

**웹훅 주소 (`SecretInput`)**
- 원문이 사는 곳은 `webhook` `useState` **하나**다(URL·저장소·전역 상태 없음). 저장 성공 즉시 `{mode: idle, value: ""}` → 서버가 `configured: true`를 주므로 입력칸이 사라지고 `…****QQQ1 · 73자 · 9월 25일 06:30 저장`만 남는다.
- `바꾸기` = 빈 입력칸(이전 값은 나오지 않는다), `취소` = 친 값을 버린다. `지우기` = `Dialog` sm danger(디자인 3.2 문구) → `webhookUrl: null`.
- 잠금: `lockOf(settings, "webhookUrl")?.envVar`를 `lockedByEnv` prop 에 넣는다(필드 이름이 아니라 **환경 변수 이름**).
- 미설정이면 서버 `ALERTS_DISCORD_NOT_CONFIGURED` 문구를 **회색 한 줄**로(AC-ALERT19).

**리소스 이름 안내 · 테스트 발송**
- 안내는 디자인 3.5 문구 그대로(`i-0abc…`는 `typography.resourceName` mono), `InlineAlert` neutral 2줄, `closable` 없음. DOM 상 **바로 다음 형제가 테스트 발송 줄**이다(테스트로 고정). 대화상자 안에는 없다.
- 버튼 비활성 사유(디자인 4.2): 미저장 → `먼저 웹훅 주소를 저장하세요…` / 꺼짐 → `디스코드 발송이 꺼져 있습니다.` / 쿨다운 → `58초 후 다시 보낼 수 있습니다.`(1초 갱신은 이 줄만 다시 그린다). 비활성은 `aria-disabled` + 사유 툴팁(포커스 유지).
- 대화상자(디자인 4.3): `GET /test/preview`(부작용 없음) → 경고 줄(서버 `warning`) · 대상 `MaskedValue`(서버 힌트) · **보낼 본문 전문**(`CodeBlock`, 서버 문자열 그대로) · mock 이면 `실제로 보내지 않음` 칩(tone `mock`) + 어느 설정 때문인지 한 줄. 기본 포커스 `취소`, 닫으면 포커스가 `테스트 발송`으로 돌아온다(브라우저 확인).
- `보내기` = `POST {confirm: true}`. 결과: `sent` → info compact `테스트 메시지를 보냈습니다 HH:mm:ss — 채널을 확인하세요.`(8초) / `skipped_mock` → neutral `실제로 보내지 않았습니다 (mock)` + 본문 전문(접기 가능) / 그 밖의 `skipped_*` → neutral + 서버 `label` / `failed` → **대화상자를 닫지 않고** 맨 위 crit 한 줄(가림 처리된 서버 사유).
- 쿨다운: 응답 `cooldown.retryAfterSec`, 429 면 `details.retryAfterSec`(= `Retry-After`)로 맞춘다. 시작·끝에만 `aria-live`(카운트다운 글자는 `aria-hidden`).
- `마지막 발송 …` 줄은 서버 `lastDispatch` 그대로(실패는 `octagon-x` + 서버 사유). 테스트 뒤에는 이 줄 때문에 설정을 한 번 다시 읽는다(PATCH 가 아니므로).
- 연속 실패 차단이면 warn compact `연속 실패 N건으로 발송을 멈췄습니다. HH:mm에 다시 시도합니다.`(서버 `circuitBreaker`).
- `발송 모드` 표시 전용 줄(디자인 5절): `실제로 보내지 않음 (ALERTS_DISPATCH=mock)` 또는 `(DATA_SOURCE=mock을 따름)`, env 로 잠겼을 때만 `lock` 칩 + 서버 `lockedByEnvDetail[].text`. 스위치를 만들지 않았다.

**Card 2·3 (표시만)**
- Card 2: 서버 `keys[]` 8행(라벨은 서버 값). 현재 상태는 계약 1.1의 출처 그대로 — `area:*`는 개요의 `areas.*.status`(비용은 `cost.status`)를 **그대로 배지로**, `source:kube`는 등급이 없는 `SourceStatus`라 낱말(`연결됨`·`mock 데이터`…)로만. 맨 아래 `대상별로 켜고 끄는 기능은 제공하지 않습니다.`("아직"·"곧" 없음).
- Card 3: `항상 켜짐 · 끌 수 없습니다` / `90일 또는 2,000건 · 해제되지 않은 알림은 지우지 않습니다`(서버 `retention`) / `연결됨` 또는 `없음 — 최근 200건만 메모리에 있습니다`(warn 색 아님).
- 억제·플래핑·워밍업 값(`rules`)은 **화면에 두지 않았다**(명세 3.4.2). 예산 편집 자리도 없다.

**대시보드 DB 없음(`persistence: "memory"`)** — 디자인 6.3: 폼 위 `Banner` warn + 저장 컨트롤 비활성(사유 툴팁). 조회는 된다.

#### (3) 테스트

- `features/settings/settings.test.tsx` **13건**: 저장 성공(PATCH 1회·다시 GET 0회·DOM 에 원문 0건·`저장됐습니다`) / 400(서버 사유만, 되비춤 없음, `aria-invalid`) / env 잠금(환경 변수 이름이 간다) / 409(사유 + 다시 읽어 잠금) / 안내 자리(다음 형제 = 테스트 발송, 닫기 없음, 대화상자 밖) / 취소 = POST 0건, 보내기 = `{confirm:true}`, mock 결과에 `tone-crit` 0개 / 429 → 서버 초로 쿨다운 / DB 없음 / 순수 함수 5건.
- `features/stream/server-snapshot.test.tsx` **2건**: 저장소에 살아 있는 값(배지 7)이 있어도 `renderToString`은 빈 초기값(`empty:0:idle`)을 그린다 + 서버 스냅샷 참조 고정. **R2 재발 방지용**이다.
- `alerts-logs.test.tsx`: 1차의 "설정 화면은 자리만" 검사 **1건 삭제**(P2 로 맞지 않는다 — 설정 테스트 파일로 옮겼다는 주석을 남김), 발송 칩 검사 1건 수정 + 1건 추가(아래 (4)), 로그 찾기 2건 추가(logs 보고서).

#### (4) 발송 칩 2종 — 프론트 변경 없이 들어왔다

작업 중 publisher 가 `DISPATCH_SPEC`에 `skipped_no_pair`·`skipped_circuit_open`을 넣었다(06:36). 1차의 런타임 검사(`state in DISPATCH_SPEC`)가
**그대로 통과시켜** 칩이 나온다. 다만 1차 테스트가 "컴포넌트가 모르는 상태"의 예로 바로 그 `skipped_no_pair`를 쓰고 있어 깨졌다 →
예시를 **가상의 미래 값**(`skipped_future_reason`)으로 바꿔 가드 검사는 유지하고, 2종이 칩으로 나가는지는 별도 테스트로 고정했다.
`model.ts`의 설명도 "아직 없다"에서 "들어왔고 프론트 변경은 없었다"로 고쳤다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/stream/client.ts` | 수정 | `SERVER_STREAM_SNAPSHOT`(모듈 상수, freeze) + 첫 상태를 그 상수로 |
| `apps/web/src/features/stream/StreamProvider.tsx` | 수정 | `useStreamStore`의 `getServerSnapshot` = `SERVER_STREAM_SNAPSHOT` |
| `apps/web/src/features/stream/server-snapshot.test.tsx` | 추가 | 2건 (R2 재발 방지) |
| `apps/web/src/features/common/hooks.ts` | 수정 | `useIsClient()` **삭제**(사용처 0) |
| `apps/web/src/features/alerts/AlertsPage.tsx` | 수정 | `useIsClient()` 우회와 그 스켈레톤 분기 제거 |
| `apps/web/src/features/alerts/model.ts` | 수정 | `toChipDispatch` 설명만(동작 변경 없음) |
| `apps/web/src/features/alerts/alerts-logs.test.tsx` | 수정 | 설정 자리 검사 1건 삭제, 칩 검사 1건 수정 + 1건 추가, 로그 찾기 2건 추가 |
| `apps/web/src/features/settings/SettingsPage.tsx` | 수정(재작성) | P2 화면 전체 |
| `apps/web/src/features/settings/types.ts` | 추가 | 계약 2.5~2.7 타입(**원문 필드 없음**) |
| `apps/web/src/features/settings/model.ts` | 추가 | 잠금·비활성 사유·마지막 발송·발송 모드·오류 읽기·알림 대상 상태(순수 함수) |
| `apps/web/src/features/settings/settings.module.css` | 추가 | 폼 720px·카드 머리·구분선·스위치 설명 44px·좁은 폭 |
| `apps/web/src/features/settings/settings.test.tsx` | 추가 | 13건 |
| `apps/web/tsconfig.json` | 수정 | `next dev/build`가 자동으로 붙인 **내 `.next-fedev`·`.next-febuild`·`.next-fe2dev`·`.next-fe2` include 8줄을 뺐다**(7절 R5) |
| `apps/web/next-env.d.ts`(git 무시 파일) | 되돌림 | build 가 `.next-fe2`를 가리키게 바꿔 놓은 것을 기본 `.next`로 |

`apps/web/src/app/settings/page.tsx`는 그대로다(1차에 만든 라우트, `title: 설정`).

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| H1 | 서버 스냅샷은 **모듈 상수 하나**(`Object.freeze`)이고 `StreamClient`의 첫 상태도 그 상수 | 호출마다 `{stream: initialStreamState, …}` 새 객체 | `getServerSnapshot`이 매번 다른 참조를 주면 React 가 "getServerSnapshot should be cached" 경고 + 무한 렌더 위험. 첫 상태까지 같은 참조면 "하이드레이션 직후 아무것도 안 왔으면 다시 그리지 않는다"도 성립한다 |
| H2 | `useIsClient()`를 **남기지 않고 지웠다** | 훅은 남겨 두고 사용처만 제거 | 필요한 자리를 찾아봤다: 이 훅을 쓰던 곳은 `/alerts` 하나였고, 그 자리는 H1 로 해결됐다(되돌려 보면 3/3 재발 — 6절 C3). 다른 화면에서 hydration 오류는 14개 경로 × 2회 0건. 남은 비결정 값(`useNow`의 `Date.now()`, `useMediaQuery`)은 **스트림이 비어 있는 동안에는 글자로 나오지 않거나** fallback 이 서버와 같다. 쓸 곳 없는 훅을 두면 다음 사람이 "스트림 값이 갈리니 미뤄 그리자"로 다시 퍼뜨린다 — 규칙은 **서버 스냅샷을 비운다** 하나로 두는 편이 맞다 |
| S1 | DB 없음은 GET 의 `persistence: "memory"`로 **미리** 알고 저장 컨트롤을 막는다 | 눌러 보고 503 이 오면 막기 | 디자인 6.3 이 "배너 + 모든 컨트롤 비활성"이다. 누르고 나서 되돌리면 스위치가 튀었다 돌아온다. 웹훅 입력은 `SecretInput`에 비활성 prop 이 없어 **`<fieldset disabled>`**(브라우저 기본)로 막고 `opacity.disabled` 토큰으로 흐리게만 했다 — publisher 요청 |
| S2 | 테스트 발송 버튼은 **DB 없음만으로는 막지 않는다.** DB 없음 사유는 "저장된 주소가 없고 저장할 수도 없을 때"에만 쓴다 | 디자인 4.2 표대로 DB 없음이면 항상 비활성 | DB 가 없어도 **환경 변수로 들어온 주소는 서버가 보낸다**(실측: env 잠금 + DB 없음에서 `skipped_mock` 200). 막으면 되는 일을 못 하게 된다. 반대로 주소가 없는데 "먼저 저장하세요"라고 하면 저장할 수 없는 상황이라 거짓 안내다. **designer 확인 요청** |
| S3 | 테스트 발송 `failed`면 대화상자를 닫지 않되, `보내기`는 **서버 쿨다운 동안 비활성** | 디자인 4.4 "버튼은 다시 활성" | 계약 2.7.2 가 "성공·실패·mock 어느 결과든 쿨다운이 시작된다(실패로 연타하는 것을 막는다)"이다. 다시 활성으로 두면 누르는 순간 429 다. 서버 규칙을 화면이 따라간다. **designer 확인 요청** |
| S4 | 쿨다운 초는 `details.retryAfterSec`에서 읽는다 | `Retry-After` 헤더 | `lib/api`의 `ApiError`가 헤더를 싣지 않는다(내 영역 밖). 서버가 두 값을 **같은 값**으로 내려보낸다(`api-error.ts`). 실측: 헤더 `Retry-After: 57` = 본문 `57초` |
| S5 | 429 는 대화상자 안 **warn**(crit 아님) | crit | 사용자가 잘못한 것이 아니라 "다른 탭이 방금 보냈다"는 사실이다. 실패(crit)와 구분한다 |
| S6 | 리소스 이름 안내는 **디자인 문구**를 화면에 고정하고, 같은 뜻의 서버 notice `ALERTS_TARGET_NAMES_PLAIN`은 따로 그리지 않는다 | 서버 문구를 그 자리에 | 디자인 문구에만 `i-0abc…` 예시가 있다(README "설정 화면 안내 문구" — 예시가 핵심). 같은 사실을 두 번 그리면 한쪽을 안 읽는다. 자리를 정한 notice 코드 8개는 `PLACED_NOTICES`로 명시했고, **모르는 코드는 Card 1 위에 서버 문구 그대로** 나온다(화면이 문구 매핑을 갖지 않는다) |
| S7 | Card 2 의 `source:kube`는 **배지가 아니라 낱말** | `SourceState` → 등급 매핑 | 등급 매핑을 화면에 두면 알림 엔진(`sourceStatus()`)과 **판단 기준이 두 벌**이 된다(명세: 새 기준 금지). 서버가 `keys[].status`를 주면 배지로 바꾸면 된다 — backend 요청(선택) |
| S8 | 테스트 발송 뒤에는 설정을 **한 번 다시 읽는다** | 응답 `result`로 `lastDispatch`를 화면이 조립 | `마지막 발송` 줄은 서버 값이다. mock 테스트는 서버가 `lastDispatch`를 바꾸지 않는데 화면이 조립하면 서버와 달라진다. "PATCH 뒤 GET 금지"는 PATCH 에 대한 규칙이라 어긋나지 않는다 |
| S9 | mock 대화상자 한 줄은 `modeSource`에 따라 다르게 쓴다 | 디자인 문구(`ALERTS_DISPATCH=mock이라…`) 고정 | 기본 mock 은 `ALERTS_DISPATCH`가 **없고** `DATA_SOURCE=mock`을 따른다. 고정 문구면 없는 설정을 가리킨다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과** (0 error) | |
| `npx tsc --noEmit` (apps/web) | **통과** | 테스트의 `getByRole({exact})` 오타 1건을 고친 뒤 |
| `npm test --prefix apps/web` | **595 passed (26 files)** | **내 순증 17건**(설정 13, 서버 스냅샷 2, 찾기 2, 칩 +1, 자리 검사 −1). 나머지 증가는 같은 시간 publisher 작업분. 기존 테스트 수정 1건(3-(4)) |
| `NEXT_DIST_DIR=.next-fe2 npx next build` | **통과** | `/alerts`·`/logs`·`/settings` 포함 24개 라우트. 끝난 뒤 폴더 삭제 |
| 브라우저 (Playwright + 설치된 Edge `msedge`) | 아래 C1~C6 | 웹 :3143 / mock API :3144. API 는 `apps/api` 소스를 **스크래치 폴더로 tsc 컴파일**해 띄웠다(backend 의 `dist`를 건드리지 않게) |

**C1. 하이드레이션 — 고치기 전 / 후 (개발 서버, 각 3회)**

| 경로 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `/cluster/pods` | **3/3 오류** (`Hydration failed … <PodsPage> <PageHeader status={crit}>`) | 0/3 |
| `/cluster/nodes` | **3/3 오류** | 0/3 |
| `/alerts` | 0/3 (1차 `useIsClient` 우회 덕) | 0/3 — **우회를 지운 뒤에도** |
| `/` | 0/3 | 0/3 |

**C2. 넓게 (개발 서버, 14개 경로 × 2회)**: `/cluster/pods`·`/cluster/nodes`·`/alerts`·`/`·`/settings`·`/logs`·`/cluster/workloads`·`/cluster/events`·`/cluster/db`·`/cost`·`/advisor`·`/snapshots`·파드 상세·노드 상세 — **hydration 0건, 그 밖의 콘솔 오류 0건.**
**프로덕션 빌드(`next start`)** 8개 경로 × 3회(최소화된 `#418/#423/#425`까지 검사) — **0건.**

**C3. 되돌려 보기(음성 대조)**: `getServerSnapshot`만 옛 값(`store.getSnapshot`)으로 잠시 되돌리자 `/alerts` **3/3**, `/cluster/pods` **3/3** 다시 오류 → 원복 후 0건. `/alerts`에서 우회를 지워도 되는 이유가 **이 수정**이라는 확인이다.

**C4. 설정 — 실제 mock API, env 잠금**(`ALERTS_DISCORD_WEBHOOK_URL=…ZZZ9`, `ALERTS_DISPATCH=mock`, DB 없음)

| 확인 | 결과 |
|---|---|
| 잠금 표시 | `…****ZZZ9` + `.env로 고정됨` + `ALERTS_DISCORD_WEBHOOK_URL 환경 변수가 설정돼 있어…`. 입력칸 0, `바꾸기`·`지우기` 0 |
| `발송 모드` | `실제로 보내지 않음 (ALERTS_DISPATCH=mock)` + 잠금 칩 + 서버 사유 |
| 원문 노출 | 페이지 HTML 에서 토큰·웹훅 ID·`/api/webhooks/` **0건** |
| 대화상자 | 기본 포커스 `취소`, `실제로 보내지 않음` 칩, 본문 `[MOCK] [테스트] … 실제 장애가 아닙니다.`, **리소스 이름 안내 없음** |
| 취소 | `POST /api/alerts/test` **0건**, 포커스가 `테스트 발송`으로 돌아옴 (AC-ALERT23) |
| 보내기 | 요청 본문 `{"confirm":true}` → `실제로 보내지 않았습니다 (mock)` + 본문 전문, 카드 안 `tone-crit` **0개** (AC-ALERT26) |
| 쿨다운 | 버튼 `aria-disabled`, `60초 후 다시 보낼 수 있습니다`, 낭독 `60초 뒤에 다시 보낼 수 있습니다` 1회 |
| **429 (두 탭)** | 둘째 탭이 먼저 대화상자를 열어 두고 첫 탭이 보낸 뒤 `보내기` → **429 + `Retry-After: 57`** → 대화상자 warn `테스트 발송은 57초 뒤에 다시 할 수 있습니다.` + `보내기` 비활성 → 닫으면 `56초 후…` (AC-ALERT25) |

**C5. 설정 — "DB 있음" 흉내**(GET 응답의 `persistence`만 바꾸고 **PATCH 는 실제 API** 또는 가짜 성공)

| 단계 | 결과 |
|---|---|
| 실제 PATCH `http://evil…` | 실제 400 → `웹훅 주소 형식이 올바르지 않습니다 (https여야 합니다).`, 문구에 입력값 0, `aria-invalid=true` (AC-ALERT21) |
| 실제 PATCH 올바른 주소 | 실제 503 → crit 한 줄 + 설정 다시 읽기, 입력값 유지 |
| 가짜 성공 | 입력칸 **0**, HTML 에 친 토큰 **0건**, `73자 · 9월 25일 06:30 저장`, `저장됨 06:30`(1.7초 뒤 사라짐), 낭독 `저장됐습니다`, **추가 GET 0회** (AC-ALERT20) |
| `바꾸기` → 입력 → `취소` | 빈 칸으로 열림, 취소 후 친 값 HTML 에 0건 |
| 실제 503 으로 스위치 | 켬으로 **되돌아감** + crit 한 줄 |
| 스위치 끔(가짜 성공) | 테스트 발송 사유 `디스코드 발송이 꺼져 있습니다.` |
| `주의부터` | 설명 `주의·장애를 보냅니다.` |
| 테스트 `sent`(가짜) | `테스트 메시지를 보냈습니다 06:30:52 — 채널을 확인하세요.` |
| 테스트 `failed`(가짜) | 대화상자 유지 + crit `발송 실패 — 디스코드가 500을 돌려줬습니다` + `보내기` 비활성 |
| `지우기` | 확인 대화상자(포커스 `취소`) → 미설정 + 회색 `디스코드 미설정 — 알림이 화면에만 쌓입니다.` |
| **409(env 잠금 API 로 실제 PATCH)** | warn `환경 변수 … 고정돼 있어…` + 다시 읽어 **잠금 화면으로 바뀜**, 친 값 HTML 0건 (AC-ALERT22) |

**C6. 좁은 폭**: `/settings` 360px·768px 문서 가로 스크롤 없음(360/360, 768/768), 테스트 발송 버튼 전체 폭.

**하지 못한 검증(숨기지 않고 적는다)**

- **대시보드 DB 가 있는 실제 저장 경로를 돌리지 못했다.** 이 환경에 Postgres 가 없고 지시받은 포트가 둘뿐이라 PGlite 소켓 서버도 띄우지 않았다. 저장 **성공**과 테스트 `sent`/`failed`는 Playwright 가로채기(계약 모양의 가짜 응답)로 화면 동작만 확인했다. 400·409·503·429·`skipped_mock`은 **실제 API 응답**이다.
- **실제 디스코드로 보내지 않았다.**
- 연속 실패 차단 줄(`circuitBreaker.open`)은 그 상태를 만드는 mock 이 없어 **코드로만** 확인했다.
- 스크린리더 실물 낭독은 하지 못했다(`aria-live` 문자열만 DOM 으로 확인).
- 개발 모드에서는 `GET /api/alerts/settings`가 **두 번** 나간다(StrictMode 가 effect 를 두 번 돌리고 첫 요청은 취소된다). 프로덕션은 1회다.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| R1 | 웹훅 입력의 "DB 없음 비활성"은 `<fieldset disabled>` + 흐림이다. 버튼이 네이티브 disabled 라 **포커스·사유 툴팁이 없다**(배너가 설명한다). publisher 가 `SecretInput.disabled`를 주면 바꾼다 |
| R2 | 스위치 설명을 `aria-describedby`로 잇지 못했다(`Switch`가 그 prop 을 받지 않는다). 설명은 바로 아래 보이는 글자로 있다 |
| R3 | 테스트 발송 중 `취소`가 **눈에는 활성**이다(`Dialog`에 취소 비활성 prop 이 없다). 눌러도 닫히지 않게만 막았다 |
| R4 | 디자인 대비 차이 2건(5절 S2·S3) — designer 확인 전까지 서버 규칙을 따른다 |
| R5 | `apps/web/tsconfig.json`에 **publisher 의 `.next-pub2` include 2줄과 Next 가 바꾼 줄바꿈 형식**이 남아 있다. publisher 빌드가 도는 중일 수 있어 내 줄만 뺐다. 빌드가 없을 때 `git checkout -- apps/web/tsconfig.json`으로 HEAD 로 되돌리면 된다(HEAD 에는 `.next-*` 줄이 없다) |
| R6 | mock 테스트 발송은 서버가 `lastDispatch`를 갱신하지 않아 `마지막 발송 기록 없음`이 그대로다(설계상 맞는지 backend 확인 요청 — 화면은 서버 값을 그대로 쓴다) |

### 8. 다른 담당 요청

**publisher 요청**
1. `SecretInput`에 `disabled` + `disabledReason`(포커스 유지 + 사유 툴팁). 지금은 대시보드 DB 없음일 때 `<fieldset disabled>`로 우회했다(R1).
2. `Switch`에 설명 연결(`description` 또는 `aria-describedby` 전달). 디자인 settings 9절 "설명이 동작의 절반이다"(R2).
3. `Dialog`에 `cancelDisabled`(디자인 4.3 "전송 중 `취소` 비활성")(R3).
4. `LogLineList` 2건은 `docs/reports/logs/frontend.md` 같은 날짜 섹션 8절(찾은 줄로 스크롤 · `programmatic` 플래그 누수).

**backend 요청(선택)**
1. `GET /api/alerts/settings`의 `keys[]`에 **현재 상태**(`status`)가 있으면 Card 2 의 `쿠버네티스 연결`도 배지로 그릴 수 있다. 지금은 화면이 등급을 만들지 않으려고 낱말로 둔다(S7).
2. mock 테스트 발송 뒤 `lastDispatch`가 `null`로 남는 것이 의도인지 확인(R6).

**designer 확인 요청**
- S2(테스트 발송은 DB 없음만으로 막지 않음), S3(실패 뒤 `보내기`는 서버 쿨다운 동안 비활성), S5(429 는 warn). 셋 다 서버 규칙을 따른 판단이다.

**PM 참고**
- R5 `tsconfig.json` 원복 시점.

### 9. 다음 담당이 알아야 할 점

1. **`useStreamStore`의 `getServerSnapshot`을 살아 있는 값으로 되돌리지 마라.** 되돌리면 `/cluster/pods`·`/cluster/nodes`·`/alerts`에서 바로 hydration 오류가 난다(6절 C3). `server-snapshot.test.tsx`가 막는다. 새 외부 저장소를 만들 때도 **서버 스냅샷은 빈 상수**로 둔다.
2. **`useIsClient()`는 지웠다. 다시 만들지 마라.** 스트림 값 때문에 트리가 갈리면 화면에서 미루지 말고 서버 스냅샷을 비우는 쪽이 맞다(스토어 한 곳).
3. **웹훅 원문이 사는 곳은 `SettingsPage`의 `webhook` state 하나다.** URL·저장소·전역 스토어·로그에 넣지 않는다. 저장 성공 처리에서 `setWebhook({… value: ""})`를 빼면 원문이 메모리에 남는다.
4. `SecretInput.lockedByEnv`에는 **`lockOf(settings, "webhookUrl")?.envVar`**. 필드 이름을 넣으면 "webhookUrl 환경 변수가…"라는 틀린 문장이 나온다(테스트로 고정).
5. **리소스 이름 안내의 자리를 옮기지 마라** — 테스트 발송 줄의 바로 앞 형제다(테스트로 고정). 대화상자 안에 넣지 않는다.
6. 새 알림 notice 코드가 생기면 `PLACED_NOTICES`에 없으면 **Card 1 위에 서버 문구 그대로** 나온다. 자리를 정해 줄 때만 목록에 더한다.
7. 설정 화면은 개요 스트림(`overview`)을 Card 2 에서만 읽는다(기본 토픽이라 토픽을 더 열지 않는다). 설정 자체는 SSE 에 의존하지 않는다.

## 2026-09-25 07:40 · 통합 3차 (설정 화면 반영 · 발송 칩 확인)

> 로그 몫(진입점·앵커·멈춤·합쳐보기)과 **공통 검증 명령·프로세스 정리**는 `docs/reports/logs/frontend.md`의 같은 날짜 섹션이 정본이다.
> 여기는 alerts·settings 몫만 적는다.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| 1 | 발송 칩 2종(`skipped_no_pair`·`skipped_circuit_open`)이 목록에 그려지는지 mock `alerts=webhook-failed`로 확인(코드 변경 없어야 한다) | 확인 — **칩 코드 변경 없이** 나온다 |
| 2 | `in DISPATCH_SPEC` 검사를 publisher 의 `isDispatchState()`로 바꾸고 `features/alerts/types.ts:37`의 낡은 주석 정리 | 완료 |
| 3 | (작업 중 PM) backend 설정 응답 보강 반영: **`keys[].status`·`statusSince`**로 Card 2, `lastDispatch`의 뜻(sent·failed만, mock 은 `null`), 서킷 재개 시각 = `circuitBreaker.resumeAt`, 디자인 `settings.md` 3.6·4.1·4.2·4.4·6.1·6.3 변경 | 반영 |
| 4 | (작업 중 PM) publisher 07:15: 설정 우회 걷어내기 — `SecretInput.disabled`·`Switch aria-describedby`·`Dialog.cancelDisabled` | 반영 |

### 2. 참고한 문서

- `docs/reports/alerts/README.md` "PM 결정 — 통합 2차에서 올라온 것"(3건 채택, `keys[].status` 계약 누락, `lastDispatch` 뜻, 서킷 재개 시각)
- `docs/api/alerts.md` 2.5(`keys[].status`·`statusSince`, `discord.lastDispatch`·`circuitBreaker`·`queue` 뜻), 5절 `webhook-failed`(표시 전용 서킷 값), 13절
- `docs/design/settings.md` 3.6·4.1·4.2·4.4·6.1·6.3 (2026-09-25 개정)
- `docs/reports/alerts/publisher.md` 07:15 섹션(설정 쪽 3건)

### 3. 작업 내용

#### (1) 발송 칩 — `isDispatchState()`

- `features/alerts/model.ts`의 `toChipDispatch`·`hasUnknownDispatch`가 `d.state in DISPATCH_SPEC` 대신 **`isDispatchState(d.state)`**를 쓴다. `in`은 `toString` 같은 상속 키에 속는다 — 테스트에 `state: "toString"`이 칩으로 넘어가지 않는 것을 더했다.
- `features/alerts/types.ts`의 `DispatchState` 주석: "모르는 값은 `제외` 계열 중립 칩으로 그린다"(계약 11절 문장, 실제 구현과 달랐다) → "**컴포넌트 표에 없는 값은 칩으로 그리지 않고** 확장 영역에서 서버 `label` 그대로"로 고쳤다.
- 1차 테스트가 "모르는 상태"의 예로 쓰던 `skipped_no_pair`는 이제 표에 있으므로 2차에 가상의 값으로 바꿔 두었고, 2종이 칩으로 나가는 테스트도 있다.

#### (2) Card 2 · 알림 대상 — 서버 `keys[].status` 하나 (디자인 6.1, PM 결정 2)

- 통합 2차에 **개요 스트림(`areas.*`·`cost.status`·`kube` 출처)에서 짜 맞추던 코드(`keyStatus`·`SOURCE_STATE_TEXT`)를 지웠다.** 이제 8행 모두 `keys[].status`를 `StatusBadge`로 그린다(`쿠버네티스 연결` 포함). `statusSince`는 배지의 스크린리더 문구(`07:31:21부터`)에 넣었다.
- `null`(엔진이 아직 평가 전 — 기동·mock 전환 직후 15초)이면 `—`(`text.tertiary`)만. 화면이 채우지 않는다. 설정 화면은 더 이상 스트림을 읽지 않는다(디자인 6.3 "SSE 에 의존하지 않는다"와도 맞다).

#### (3) 디자인 개정 반영

| 자리 | 바뀐 것 |
|---|---|
| 4.2 주소 없음 + DB 없음 | `대시보드 DB에 연결할 수 없어 웹훅 주소를 저장할 수 없습니다. ALERTS_DISCORD_WEBHOOK_URL 환경 변수로 넣으면 보낼 수 있습니다.`(되는 길을 말한다). DB 없음만으로는 막지 않는 것은 2차 그대로(PM 채택) |
| 3.6 `마지막 발송` | `null`이면 **`마지막 발송 없음`**(`text.tertiary`). 상태는 `sent`·`failed`만 온다(429·재시도 실패도 `failed`) |
| 3.6 서킷 | `연속 실패 {consecutiveFailures}건으로 발송을 멈췄습니다. {resumeAt HH:mm}에 다시 시도합니다.` — `resumeAt`이 없으면 앞 문장만(2차 그대로, 이번에 화면으로 확인) |
| 4.4 실패·429 뒤 `보내기` | 서버 쿨다운 동안 비활성 + 사유 **`58초 후 다시 보낼 수 있습니다.`(1초 갱신)** — 2차의 `잠시 뒤에…`를 남은 초로 바꿨다 |

#### (4) publisher 우회 걷어내기

| 우회(2차) | 이번 |
|---|---|
| `<fieldset disabled>` + `opacity.disabled` 흐림 | **`<SecretInput disabled disabledReason="대시보드 DB에 연결할 수 없어 설정을 저장할 수 없습니다.">`** — 입력칸 `disabled`, `저장`·`바꾸기`·`지우기`는 `aria-disabled`(포커스 유지) + 사유. CSS `.fieldset` 삭제 |
| 스위치 설명이 이어지지 않음 | `<Switch aria-describedby={설명 id}>` — 사유가 있으면 컴포넌트가 뒤에 붙인다(설명 → 사유 순) |
| `onClose`에서 "전송 중이면 무시" | **`Dialog cancelDisabled={sending}`** + `보내는 중에는 닫을 수 없습니다.` — 버튼·Esc·바깥 클릭을 컴포넌트가 막는다. 웹훅 `지우기` 대화상자도 같은 방식(`지우는 중에는 닫을 수 없습니다.`) |

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/alerts/model.ts` | 수정 | `isDispatchState()` |
| `apps/web/src/features/alerts/types.ts` | 수정 | `DispatchState` 주석 정리 |
| `apps/web/src/features/alerts/alerts-logs.test.tsx` | 수정 | `isDispatchState`·상속 키(`toString`) 검사 |
| `apps/web/src/features/settings/SettingsPage.tsx` | 수정 | Card 2 = `keys[].status`(스트림 의존 제거), `SecretInput.disabled`, `Switch aria-describedby`, `Dialog.cancelDisabled` ×2, 대화상자 쿨다운 초 표시, `마지막 발송 없음` |
| `apps/web/src/features/settings/model.ts` | 수정 | `keyStatus`·`SOURCE_STATE_TEXT` **삭제**, `TEXT.dbDownNoWebhook`, `lastDispatchText`(`none`) |
| `apps/web/src/features/settings/types.ts` | 수정 | `keys[].status`·`statusSince` |
| `apps/web/src/features/settings/settings.module.css` | 수정 | `.fieldset` 삭제, `.testMetaNone` |
| `apps/web/src/features/settings/settings.test.tsx` | 수정 | 13 → **16**건(Card 2, `마지막 발송 없음`, 스위치 설명 연결 + 전송 중 취소·Esc 막힘). DB 없음 테스트 1건을 `fieldset` → `SecretInput.disabled` 검사로 고침 |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| S10 | Card 2 는 `keys[].status`만 쓰고, 값이 없으면 `—` | 계약 값이 없을 때 개요 스트림으로 채우기(2차 방식을 폴백으로 남김) | 폴백을 남기면 판단 기준이 두 곳이 된다(디자인 6.1, PM 결정 2). `null`은 "엔진이 아직 평가 전"이라는 사실이고 15초면 채워진다 |
| S11 | `테스트 발송` 버튼의 활성 판단은 **설정 응답의 서버 값(`configured`·`enabled`) + 서버 쿨다운 초**로 한다. 대화상자는 `preview.canSend`·`blocked`를 그대로 따른다 | 페이지를 열 때 `GET /test/preview`를 불러 버튼에도 `canSend`를 쓴다(디자인 4.2 마지막 줄) | 두 값은 서버 `testBlocked()`와 같은 조건(주소·켜짐·쿨다운)이라 결론이 갈리지 않는다. 미리보기를 페이지마다 부르면 호출이 하나 늘고, 버튼 사유 문구는 어차피 디자인 4.2 표 문구를 써야 한다(서버 `blocked.text`와 다르다). **designer 확인 요청**(문서의 "`canSend`를 따른다"를 "같은 조건의 서버 값을 따른다"로 읽어도 되는지) |

### 6. 검증 결과

명령 결과(lint·tsc·test **625**·build)는 `docs/reports/logs/frontend.md` 같은 날짜 섹션 6절. 브라우저는 Playwright + Edge, mock API :3144(이번 라운드 중간에 backend 의 서킷 표시 값을 받으려고 **다시 컴파일해 재기동**했다 — 내 PID 23640 → 23400).

| 확인 | 결과 |
|---|---|
| `alerts=webhook-failed` 목록 | `발송 멈춤(연속 실패)` 칩 **2**, `제외(발생 안 보냄)` 칩 **1**, `발송 실패` 9 — **칩 코드 변경 없음**(1차 런타임 검사가 통과시켰고 이번에 `isDispatchState`로 바꿨다) |
| 설정 3.6 서킷 둘째 줄 | `연속 실패 10건으로 발송을 멈췄습니다. 08:29에 다시 시도합니다.`(표시 전용 값 `resumeAt` 그대로) |
| 3.6 `마지막 발송` | mock 에서 `마지막 발송 없음` |
| Card 2 | 엔진 평가 전(전환 직후) API 8개 전부 `null` → 17초 뒤 `정상·장애·장애·장애·장애·주의·정상·정상`, **`쿠버네티스 연결`도 배지** |
| DB 없음 | 입력칸 `disabled`, `저장` `aria-disabled="true"`. `테스트 발송` 사유 = 개정된 4.2 문구(환경 변수 안내) |
| 스위치 설명 | `aria-describedby` → `끄면 디스코드로 보내지 않습니다. …` + (DB 없음 사유) 순 |
| 전송 중 대화상자(단위 테스트) | `취소` `aria-disabled`, Esc 로 닫히지 않음, 전송이 끝나면 결과 안내 |
| 하이드레이션 `/settings`·`/alerts`(프로덕션 빌드) | 0건 |

**하지 못한 검증**: DB 가 있는 실제 저장 경로·실제 디스코드 발송(2차와 같은 이유). 서킷 둘째 줄은 **표시 전용 mock 값**으로만 봤다.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| R1·R2·R3 (2차) | **해결** — `SecretInput.disabled`·`Switch aria-describedby`·`Dialog.cancelDisabled`로 우회를 걷어냈다 |
| R6 (2차) | **해결** — `lastDispatch`의 뜻이 PM 결정으로 정해졌다(mock `null`이 정상) |
| R7 | S11(버튼 활성 판단 근거) — designer 확인 대기 |
| R8 | publisher 가 찾은 `Button disabledReason` 사유 중복 낭독(publisher R11)은 설정 화면의 비활성 버튼에도 해당한다. 컴포넌트 쪽 정리 대상이라 화면은 그대로 둔다 |

### 8. 다른 담당 요청

- **designer 확인 요청**: S11 — 디자인 4.2 "활성 여부는 `preview.canSend`·`blocked`를 따른다"를 "같은 조건의 서버 값(`configured`·`enabled`·쿨다운)을 따르고, 대화상자 안에서는 `canSend`"로 읽어도 되는지.
- 그 밖에 요청 없음.

### 9. 다음 담당이 알아야 할 점

1. **Card 2 는 `keys[].status` 하나다.** 개요 스트림에서 채우는 폴백을 다시 넣지 마라(2차 코드는 지웠다).
2. `SecretInput`의 **`disabled`(잠시 저장 불가)와 `lockedByEnv`(`.env` 고정)는 모양이 다르다**(publisher). DB 없음에는 앞의 것, 환경 변수 잠금에는 뒤의 것.
3. `Dialog.cancelDisabled`는 닫기의 모든 길(버튼·Esc·바깥)을 막는다. 전송·지우기가 끝나면(성공·실패·429) `sending`/`pending`이 풀리게 되어 있다 — 새 비동기 경로를 붙일 때 `finally`에서 푼다.
4. 발송 칩 검사는 `isDispatchState()`다. `in`으로 되돌리지 마라.

## 2026-09-25 08:05 · 마지막 배선 (5f — 설정 4.2 확인 · 테스트 재확인)

> 로그 몫(파드 표 아이콘 링크·컨테이너·안내 줄·`resolvedPods`)과 **5f 공통 검증 명령**은 `docs/reports/logs/frontend.md` 같은 이름 섹션이 정본이다.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| 5 | publisher 가 `Button` 비활성 사유를 접근 이름 밖으로 옮겼다 — 전체 테스트로 다시 확인 | **636 passed**. 설정·알림 테스트에서 고칠 것 0건 |
| 6 | `settings.md` 4.2 새 문장(카드 버튼 = 설정 응답·쿨다운, 대화상자 = `preview.canSend`, 갈리면 대화상자가 최종)과 구현이 맞는지만 확인 | 맞다(아래) |

### 2. 참고한 문서

- `docs/design/settings.md` 4.2(개정), 4.4
- `docs/reports/logs/designer.md` "추가 4" E4, `docs/reports/logs/publisher.md` 07:55(`Button` 사유 위치)

### 3. 확인 내용 — `settings.md` 4.2 대조

| 4.2 문장 | 구현(`features/settings/SettingsPage.tsx`) | 맞나 |
|---|---|---|
| 카드 `테스트 발송`: 설정 응답의 `configured`·`enabled`와 서버 쿨다운 초 | `TestSendRow` → `testBlockReason(settings, 남은 초)`. 남은 초는 서버 `cooldown.retryAfterSec`·429 `details.retryAfterSec`로 맞춘 값 | 맞다 |
| 카드 버튼 때문에 페이지를 열 때마다 `preview`를 부르지 않는다 | `GET /test/preview`는 **대화상자를 열 때만** 부른다 | 맞다 |
| 대화상자 `보내기`: `preview.canSend`·`blocked`, 문구는 서버 `blocked.text` 그대로 | `TestSendDialog` — `canSend: false`면 `confirmDisabled` + 사유 `blocked.text` | 맞다 |
| 갈리면 대화상자가 최종(예: 다른 탭이 보내 쿨다운) | 미리보기에 `cooldown.active`가 오면 그 초로 쿨다운을 시작하고 `보내기`를 막는다. 이때 사유는 4.4의 `N초 후 다시 보낼 수 있습니다.`(서버 초) — `blocked.text`(`방금 보냈습니다…`) 대신 **남은 초**를 보인다. 4.4(쿨다운은 남은 초 표시)와 같은 규칙이라 그대로 둔다 | 맞다(쿨다운 문구만 4.4를 따른다) |
| DB 없음은 비활성 조건이 아니다 | `testBlockReason`은 주소가 없을 때만 DB 없음 문구(`… 환경 변수로 넣으면 보낼 수 있습니다.`) | 맞다 |

### 4. 변경 파일

설정·알림 쪽 **코드 변경 없음.** (로그 쪽 변경은 logs 보고서)

### 5. 주요 결정과 이유

- 대화상자의 쿨다운 사유를 `blocked.text`로 바꾸지 않았다. 같은 쿨다운을 카드 버튼은 `58초 후…`로, 대화상자는 `방금 보냈습니다…`로 말하면 두 자리가 다른 말을 한다. 4.4가 쿨다운 표시를 남은 초로 정했으므로 그것을 따른다.

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| lint · tsc · build | 통과(logs 보고서 6절) |
| `npm test --prefix apps/web` | **636 passed (27 files)** — `settings.test.tsx` 16건·`alerts-logs.test.tsx` 16건 그대로 통과. publisher 의 `Button` 사유 이동으로 고칠 곳 **0건**(내 테스트는 버튼을 정확한 이름으로 찾고, 사유는 `aria-describedby`로 확인한다) |

브라우저 재확인은 하지 않았다 — 설정 코드가 바뀌지 않았고 3차에 같은 항목을 확인했다.

### 7. 남은 이슈·한계

- alerts R7(4.2 판단 근거) **해결** — designer E4 채택, 문서가 구현에 맞춰졌다.

### 8. 다른 담당 요청

없음.

### 9. 다음 담당이 알아야 할 점

- 카드 버튼과 대화상자의 판단 근거가 다르다(4.2). 서버에 새 차단 조건이 생기면 **설정 응답에도 그 값**이 있어야 카드 버튼이 따라간다. 없으면 대화상자만 막는다(잘못 나가지는 않는다).
