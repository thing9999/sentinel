# alerts · publisher 작업 보고

> 파일 위치: `docs/reports/alerts/publisher.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 22:20 · 알림·로그·설정 UI 컴포넌트 (사이드바 3단 flex 포함) (날짜 정정 2026-09-25)

> **이번 작업은 `alerts`와 `logs` 두 기능을 한 번에 맡았다.** 두 기능이 사이드바·설정 화면·`Chip`·`MaskedValue` 같은 공통 컴포넌트를 나눠 쓰기 때문이다.
> **공통 사항(사이드바·설정·기존 컴포넌트 확장·검증 전체)은 이 문서가 정본**이고, 로그 전용 컴포넌트(`LogLineList`·`CollapsibleNotice`·`RedactionNotice`)의 설계 판단은 `docs/reports/logs/publisher.md`에 있다.

### 1. 요청 내용

PM이 새 기능 두 개(`alerts`·`logs`)와 설정 화면에 필요한 **표현 계층**을 맡겼다. 범위:

| # | 요청 | 결과 |
|---|---|---|
| A | 새 컴포넌트 5개 — `AlertItem`·`AlertGapRow`·`SecretInput`·`LogLineList`·`CollapsibleNotice` | 5개 모두 구현 (+ 아래 D의 `RedactionNotice` 1개 추가, 근거는 5절 P3) |
| B | 기존 확장 8건 — `NavItem`(count 단독·`countTone`·접힘 배지·`footerItems`) · `Chip`(`mock` tone, `onClick`) · `SegmentedControl`(`disabled` + 사유, 비활성도 포커스) · `MaskedValue`(`variant="inline"`) · `ComponentMatrix`(`cells[].logHref`) · `EmptyState`(`footer`) | 전부 구현 |
| C | `SideNav` **3단 flex 구조 변경** (목록만 스크롤 / `설정`·`메뉴 접기` 하단 고정) | 구현 + **배너가 있을 때 사이드바가 40px 잘리던 기존 결함까지 고침**(5절 P1) |
| D | 금지 사항 — `NotificationBell` 금지, 상단바·`shell.md` 2절 폭 계산 금지 | 지켰다. `shell/TopBar.tsx`·`shell.module.css`의 상단바 부분은 **한 줄도 건드리지 않았다** |
| E | 실제 브라우저(Playwright + 설치된 Edge, 포트 3122)로 sticky gutter·사이드바 높이 확인 | 수행. 결함 2건을 눈으로 찾아 고쳤다(6절) |

### 2. 참고한 문서

- `docs/design/components.md` **20절(새 컴포넌트 5개 + "왜 기존 것으로 안 되는가" 표)·21절(확장 8건)**, 13절(아이콘)
- `docs/design/shell.md` **3.1(항목 12개·상태 점 없음 규칙)·3.2(접힘 배지)·3.3(세로 공간·3단 flex)**, 1.1(좁은 폭), 2·2.1(상단바 — **읽고 건드리지 않았다**), 2.2(탭 제목 → 프론트), 5절(배지 0 금지)
- `docs/design/alerts.md` 2~9절, `docs/design/logs.md` 3~7·12·13절, `docs/design/settings.md` 3·5·8·9절
- `docs/design/status.md` **12절(알림)·13절(로그)**, 1.2(문구 대체), 1.3, 2.5(빗금), 3.1(사라지지 않는 표시), 5.1·5.3·5.6
- `docs/reports/alerts/designer.md`(정본: 사이드바·설정 D1~D13), `docs/reports/logs/designer.md`
- `docs/reports/alerts/README.md`·`docs/reports/logs/README.md`(사용자·PM 결정, "구현이 지켜야 할 것")
- `docs/api/alerts.md` 1.3·1.4·2.2, `docs/api/logs.md` 3절 — **계약과 prop 이름·타입을 맞추려고** 읽었다(8절에 어긋난 2건을 적었다)

### 3. 작업 내용

#### (1) `SideNav` 3단 flex — 항목 12개가 노트북에서 넘치는 문제

- 구조를 **`<nav>` = [스크롤 목록] + [하단 고정 영역]** 두 덩이로 바꿨다. 하단 고정 영역은 `footerItems`(= `설정`) + `메뉴 접기` 버튼이고 `flex: 0 0 auto`라 목록이 아무리 길어져도 언제나 보인다.
- 구분선은 `data-scrollable="true"`일 때만 그린다(`ResizeObserver`로 `scrollHeight > clientHeight` 관측). 스크롤이 없는 화면에서 하단 영역이 떠 보이지 않게.
- `globals.css`의 `.app-nav`를 `overflow-y: auto` → `overflow: hidden`으로 바꿨다. 사이드바 자체가 스크롤하면 하단 고정 영역까지 함께 밀려 올라간다.
- `DEFAULT_NAV_ITEMS`에 `알림`(2번, `inbox`, `/alerts`)·`로그`(7번, `scroll-text`, `/logs`, `클러스터` 그룹)를 넣어 11개, `DEFAULT_NAV_FOOTER_ITEMS`에 `설정`(`settings`, `/settings`) 1개 → 합계 12개.
- 현재 항목이 스크롤 영역 밖이면 `scrollIntoView({ block: "nearest" })`를 **컴포넌트 안에서** 한 번 맞춘다(스크롤 컨테이너가 `SideNav` 안에 있어 프론트가 잡을 수 없다).
- 1280px 미만 드로어: 하단 고정 영역은 그대로 두고 **`메뉴 접기` 버튼만 숨긴다**(종전에는 영역 전체를 숨겼는데, 이제 그 안에 `설정`이 있다).

#### (2) `NavItem` 배지 (21.1)

- `status` 없이 `count`만 줄 수 있다. `countTone?: Status`(기본 `crit`), `countLabel?: string`(`안 읽음 3건` — 없으면 종전 규칙 `커밋 금지 2개`).
- **접힘(64px) 배지**: 아이콘 오른쪽 위에 걸치는 14px pill(1.5px `bg.surface` 테두리, `99+` 최대 26px). **상태 점이 없는 항목만** 그린다 — 스냅샷은 종전대로 그리지 않는다.
- 스크린리더 문구는 `navItemStatusText()` 한 곳에서 만든다(펼침 sr-only와 접힘 툴팁이 같은 문장을 쓴다).
- 끊김 표시(`· 14:02:10 기준`)는 `countLabel`에 붙여 넘기면 된다 — 화면이 시계를 갖지 않는다.

#### (3) `AlertItem` / `AlertGapRow` (20.1·20.2)

- 3행 구조(gutter 20px + 배지·영역·칩·시각 / 사유 / 대상·발송 칩·`로그`·확장), `critical`만 왼쪽 3px 막대, 읽음은 **영역 이름의 무게만** 낮춘다.
- **중첩 금지 해결**: 항목 전체 링크는 `<a>` + `::after { inset: 0 }`(z-index 0)로 덮고, 안 읽음 점·발송 칩·`로그`·확장 버튼은 `z-index: 1`로 그 위에 둔다. 항목 아무 곳이나 누르면 링크가, 버튼 위를 누르면 버튼이 잡힌다(브라우저로 확인, 6절).
- 접근 이름 `안 읽음, 장애, 파드, <사유>, 14:02:05` 한 문장을 링크에 주고, **눈으로만 보는 조각(배지·영역·사유·시각)은 `aria-hidden`** 으로 빼 같은 말이 두 번 읽히지 않게 했다.
- 칩은 `alertModel.alertChips()`로 **순서 고정**(반복 → 불안정 → 영향 영역 → 테스트 → MOCK), 4개를 넘으면 `trimChips()`가 **오른쪽부터** 버리되 **MOCK은 `pinned`라 마지막까지 남는다**. 버린 칩은 `+N` 툴팁에 문구로 남는다.
- 발송 칩은 `DISPATCH_SPEC` 표 하나로 문구·아이콘·tone을 정한다(`failed`만 crit, `skipped_mock`만 `mock`).
- `AlertGapRow`는 `<li aria-label="정지 구간 9시 12분부터 …">` + 45° 빗금. **알림이 아니므로** `AlertItem`의 한 종류로 넣지 않았다.

#### (4) `SecretInput` (20.3)

- `configured && idle`이면 **입력칸을 그리지 않고** `MaskedValue`(서버 힌트) + `119자 · 9월 25일 14:02 저장` + `바꾸기`/`지우기`만 그린다.
- 입력은 `type="text"` + `autocomplete="off"` + `spellcheck=false`(+`autocorrect`/`autocapitalize` off). **"보기" 토글·눈 아이콘을 만들지 않았다** — 보여 줄 값이 애초에 없다.
- `lockedByEnv`면 입력·버튼을 **그리지 않고** `lock` 칩 + 사유 문장을 남긴다(숨기지 않는다).
- 오류는 서버 문구 한 줄만 쓴다. 입력값 원문을 되비추지 않는 것은 **테스트로 고정**했다(`SECRETTOKEN`이 DOM에 없는지 확인).

#### (5) 기존 컴포넌트 확장

| 컴포넌트 | 한 일 |
|---|---|
| `Chip` | `tone="mock"`(`mode.mock*` 재사용), `onClick`이면 `<button>`(hit 32px는 `::before`), `ariaLabel`·`pressed`, `title`(기존 `tooltip`의 문자열 별칭) |
| `SegmentedControl` | `options[].disabled` 추가(기존 `disabledReason`과 OR). 네이티브 `disabled`를 쓰지 않아 **포커스를 받는다**. 사유를 툴팁뿐 아니라 **접근 이름에도** sr-only로 넣었다 |
| `MaskedValue` | `variant="inline"` — 아이콘 없음, `display: inline`(줄 높이 20px 유지), dashed 테두리, 툴팁 래퍼 없음. `box`는 종전 그대로 |
| `ComponentMatrix` | `cells[].logHref` — 셀 위에 **겹쳐** 24px 버튼(hover·focus에서 보임). `missing`엔 없고 `notReporting`엔 있다. 셀 링크 **밖**에 둬 중첩을 피했다 |
| `EmptyState` | `footer` — 설명 아래 12px, caption `text.tertiary`, 최대 폭 400px |
| 아이콘 | `inbox`·`send`·`repeat`·`activity`·`arrow-down-to-line` 5개 추가(13절 목록 그대로) |
| `types.ts` | `StatusAltLabel`에 `확인 불가`·`해제`(알림) + `설정 없음`·`연결 실패`(로그 출처) 추가 — status.md 1.2에 있는 문구만 배지에 쓸 수 있게 하는 기존 장치를 그대로 지켰다 |

#### (6) 미리보기·테스트

- `__preview__/AlertsLogsPreview.tsx` 추가 → `/dev/ui`에서 전부 눈으로 볼 수 있다(알림 5종 + 정지 구간 2종, 로그 10줄 + **2만 줄**, 설정 4상태, 매트릭스 로그 버튼).
- `__tests__/alerts-logs.test.tsx` 41개 추가(총 551개).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/alerts/AlertItem.tsx` | 추가 | 알림 목록 항목 (20.1) |
| `apps/web/src/components/ui/alerts/AlertGapRow.tsx` | 추가 | 정지 구간 줄 (20.2) |
| `apps/web/src/components/ui/alerts/alertModel.ts` | 추가 | 심각도·발송 칩 매핑, 칩 순서·버리기, 접근 이름·정지 구간 문구(순수 함수) |
| `apps/web/src/components/ui/alerts/alerts.module.css` | 추가 | 항목·정지 구간 스타일(좁은 폭 4줄 배치 포함) |
| `apps/web/src/components/ui/controls/SecretInput.tsx` | 추가 | 비밀값 입력·표시 (20.3) |
| `apps/web/src/components/ui/feedback/CollapsibleNotice.tsx` | 추가 | 접을 수 있는 안내 (20.4) |
| `apps/web/src/components/ui/logs/LogLineList.tsx` | 추가 | 로그 본문·가상 스크롤 (20.5) |
| `apps/web/src/components/ui/logs/logLineModel.ts` | 추가 | 로그 줄 타입·오프셋·찾기·문구(순수 함수) |
| `apps/web/src/components/ui/logs/RedactionNotice.tsx` | 추가 | **닫을 수 없는** 가림 경고(5절 P3) |
| `apps/web/src/components/ui/logs/logs.module.css` | 추가 | 로그 본문 스타일(sticky gutter 포함) |
| `apps/web/src/components/ui/shell/SideNav.tsx` | 수정 | 3단 flex, `footerItems`, `countTone`/`countLabel`, 접힘 배지, 기본 항목 11 + 하단 1 |
| `apps/web/src/components/ui/shell/shell.module.css` | 수정 | `.navScroll`/`.navFooter`/`.navDotCount` 추가. **상단바 부분 무변경** |
| `apps/web/src/styles/globals.css` | 수정 | `.app-nav` 스크롤 제거 + **배너가 있을 때 높이 `100dvh − 96px`**(P1) |
| `apps/web/src/components/ui/status/Chip.tsx` · `status.module.css` | 수정 | `mock` tone, `onClick`, `title` |
| `apps/web/src/components/ui/controls/SegmentedControl.tsx` · `controls.module.css` | 수정 | `disabled` + 사유(포커스 유지), `SecretInput` 스타일 |
| `apps/web/src/components/ui/feedback/EmptyState.tsx` · `feedback.module.css` | 수정 | `footer` prop, `CollapsibleNotice` 스타일 |
| `apps/web/src/components/ui/k8s/DiffValue.tsx` · `k8s.module.css` | 수정 | `MaskedValue variant="inline"` |
| `apps/web/src/components/ui/cluster/ComponentMatrix.tsx` · `cluster.module.css` | 수정 | `cells[].logHref` |
| `apps/web/src/components/ui/icons.tsx` | 수정 | 아이콘 5개 |
| `apps/web/src/components/ui/types.ts` | 수정 | `StatusAltLabel` 4개 |
| `apps/web/src/components/ui/index.ts` | 수정 | 신규 export |
| `apps/web/src/components/ui/__preview__/AlertsLogsPreview.tsx` | 추가 | 미리보기 |
| `apps/web/src/components/ui/__preview__/UiPreview.tsx` | 수정 | 미리보기 연결 + 사이드바에 `footerItems`·알림 배지 |
| `apps/web/src/components/ui/__tests__/alerts-logs.test.tsx` | 추가 | 41개 |
| `docs/design/tokens.json` · `apps/web/src/styles/tokens.css` | **변경 없음** | **새 토큰 0건 (7회 연속)** |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| P1 | **배너가 떠 있으면 사이드바 높이를 `100dvh − 96px`로** (`globals.css`, `:has(> .app-banner)`) | 그대로 두기 | `shell.md` 3.3이 이미 "배너가 있으면 − 96px"라고 적었는데 코드는 언제나 `− 56px`이었다. 배너가 뜨면 사이드바 **아래 40px이 화면 밖**으로 나간다. 종전에는 그 자리에 `메뉴 접기`만 있어 아무도 몰랐지만, 이제 그 40px 안에 **눌러야 하는 `설정`**이 있다. Edge 실측으로 발견했다(6절 B1) |
| P2 | 로그 줄을 **absolute 배치가 아니라 위·아래 여백 div**로 가상 스크롤 | 줄마다 `position: absolute; top` | absolute 줄은 부모의 `max-content` 폭 계산에 **기여하지 않아** 컨테이너가 화면 폭으로 줄고, 그러면 가로로 스크롤했을 때 줄 상자가 먼저 끝나 **sticky gutter가 풀린다**(planner 경고 그대로). 정상 흐름에 두면 `.inner`가 가장 긴 줄 폭이 되고 모든 줄이 그 폭을 채운다 → 끝까지 스크롤해도 gutter가 남는다(실측 6절 B2) |
| P3 | 가림 경고를 **`RedactionNotice`라는 preset 컴포넌트**로 박제 | `InlineAlert`를 그대로 쓰라고 문서로만 당부 | "닫을 수 없다"를 **규칙이 아니라 타입으로** 만들었다 — `RedactionNotice`는 `className` 말고 아무 prop도 받지 않아서 `closable`을 줄 수가 없다. 새 카탈로그 컴포넌트를 늘린 것이 아니라 `InlineAlert` 한 줄 preset이다(구현 20줄). 같은 이유로 `CollapsibleNotice`에는 **닫기(`x`)를 아예 만들지 않았다**(접기만 있다) |
| P4 | `LogLineList`에 `currentMatch` prop 추가 | 문서의 `findQuery`만으로 | `logs.md` 6.3이 "현재 일치 1건은 1px `accent.default` 테두리"라고 요구하는데, **어느 일치가 현재인지는 화면 밖(찾기 이동 상태)에서 온다.** 선택 사항이라 종전 호출에는 영향이 없다 |
| P5 | 줄 바꿈(wrap)일 때 높이를 **ResizeObserver 측정 캐시**로 | 글자 수 × 폭 추정 | 추정은 가림 조각(inline-block)·한글 폭에서 빗나가 스크롤이 튄다. 측정값이 같으면 state를 안 바꾸므로 한두 프레임에 수렴한다. 관측기가 없는 환경(jsdom)에서는 20px 추정으로 그린다 |
| P6 | 안 읽음 점을 `onMarkRead`가 있을 때만 **버튼**으로 | 항상 버튼 | 읽음 처리 경로가 없는 자리(예: 미리보기·읽기 전용 목록)에서 눌리지 않는 버튼을 만들면 키보드 순서만 늘어난다. 점 자체는 8px, hit 영역은 `::before`로 32px |
| P7 | `Chip`의 `title`을 **기존 `tooltip`의 별칭**으로 | `title` 별도 구현 | 같은 일을 하는 prop이 두 개가 되면 어느 쪽이 이기는지 다음 사람이 모른다. `tooltip ?? title` 한 줄로 두고 주석에 적었다 |
| P8 | 알림 접근 이름의 시각을 **`useNow(0)` 기준**으로 | 고정 포맷(`14:02:05`) | 눈에 보이는 `Timestamp`는 "오늘인가"로 문구가 갈리는데 접근 이름만 고정이면 **보는 사람과 듣는 사람이 다른 문장**을 받는다. 서버·브라우저 시간대 차이는 `Timestamp`와 같은 방식(`suppressHydrationWarning`)으로 처리 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과**(0 error / 0 warning) | React Compiler 규칙(`refs during render`, `setState in effect`) 때문에 `LogLineList`의 높이 캐시를 ref → state + ResizeObserver 구독으로 두 번 고쳤다 |
| `npm run typecheck --prefix apps/web` | **통과** | |
| `npm test --prefix apps/web` | **551 passed (23 files)** | 기준선 510 + 신규 41. **기존 테스트 수정 0건**(`NavItem` 종전 문구·스냅샷 배지 규칙을 그대로 유지했는지 기존 테스트가 확인해 준다) |
| `NEXT_DIST_DIR=.next-pubbuild npx next build` | **통과** | PM의 `:3000` 개발 서버가 쓰는 `.next`를 건드리지 않으려고 출력 폴더를 갈랐고, 끝난 뒤 지웠다 |
| **브라우저(Playwright + 설치된 Edge, :3122)** | 아래 B1~B5 | 브라우저 다운로드 없음(`channel: "msedge"`). 포트 3122만 썼고 **내가 띄운 PID(28120)만** `Stop-Process`로 껐다 |

**B1. 사이드바 12항목 · 1366×768 (결함 발견 → 수정)**

| 뷰포트 높이 | 고치기 전 | 고친 뒤 |
|---|---|---|
| 768 | 사이드바 96~**808px**(뷰포트 밖 40px), `메뉴 접기` 잘림 | 96~768px, 목록 스크롤 없음, 구분선 없음, `설정`·`메뉴 접기` **둘 다 보임** |
| 640(노트북 실제) | 96~**680px** | 96~640px, **목록만 스크롤**(내용 554 > 영역 487), 구분선 표시, 하단 고정 둘 다 보임 |
| 600 | — | 96~600px, 같음 |
- 목록을 끝까지 스크롤해도 `설정`은 제자리(바닥 590px)에 있었다.
- 접힘(64px): 알림 배지 `99+` 14px이 48px 항목 상자 **안에** 들어가고, 스냅샷에는 접힘 배지가 없다(규칙대로).

**B2. 로그 sticky gutter — 긴 줄에서 실제로 확인 (AC-LOG07)**

| 항목 | 값 |
|---|---|
| 본문 스크롤 폭 / 보이는 폭 | 2,324px / 1,158px (긴 줄 1개 포함) |
| 가로로 끝까지(`scrollLeft = 1,166`) | gutter `position: sticky`, `left: 0`, **본문 왼쪽 가장자리 + 1px**(테두리)에 그대로. 폭 28px, 배경 `code.bg` |
| 짧은 줄에서도 | 같음(모든 줄 상자 폭 = 2,324px이라 줄이 먼저 끝나지 않는다) |
| **2만 줄 목록**(scrollHeight 400,000px) | 그린 줄 22개, 가로 끝까지 스크롤해도 gutter delta 1px |
| 줄 바꿈 켬 | 가로 스크롤 사라짐(scrollWidth == clientWidth), 긴 줄 높이 60px(20 × 3줄)로 측정됨 |

**B3. 360px 가로 스크롤**

| 섹션 | `scrollWidth` / `clientWidth` |
|---|---|
| 알림 항목 | 328 / 328 (넘침 없음) |
| 로그 | 328 / 328 (본문 안쪽 가로 스크롤은 **의도된 것**) |
| 설정 | 328 / 328 |
| 매트릭스 | 328 / 328 (표는 `.matrixScroll` 안에서만 스크롤) |
- 알림 항목 좁은 폭 높이 113~165px(최소 112px 규칙 만족), 정지 구간 48·56px(2줄).
- **문서 전체 `scrollWidth`는 412px**인데, 이는 미리보기에 함께 있는 **기존 `DataTable`(파드 표)** 때문이다 — `shell.md` 1.1이 "기존 화면은 1024px 기준"으로 남겨 둔 알려진 한계이고 이번 범위가 아니다.

**B4. 상호작용(마우스·키보드)**

| 확인 | 결과 |
|---|---|
| 항목 가운데 클릭 | `elementFromPoint` = 항목 링크(`/cluster/pods/prod/api-…`) — `::after`가 제대로 덮는다 |
| `자세히 보기` 클릭 | 확장만 열리고 **이동하지 않음** |
| 안 읽음 점 클릭 | 콜백만 호출, **이동하지 않음** |
| 가림 gutter 버튼 | `focus()` 가능, 접근 이름 `가려진 값 1개, 규칙 보기` |
| 매트릭스 로그 버튼 | 셀 hover 전 `opacity 0 / pointer-events none` → hover 후 `1 / auto`, 그 지점의 hit 테스트가 **로그 링크**를 가리킴 |
| `바꾸기` → 입력칸 | `type=text`, `autocomplete=off`, 힌트 문구 노출 |

**B5. 눈으로 본 것(스크린샷)**: 알림 5종 + 정지 구간, 로그 특별 줄 5종(링버퍼·생략·바이너리·가림 실패·잘림), 인라인 가림 표기, 접힘 사이드바, 360px 알림·설정.

**고치지 않고 남긴 것**: 없음. 위 B1(사이드바 40px 잘림)·B2 이전 구조(absolute 줄 → sticky 풀림 위험)는 **발견 즉시 고쳤고** 다시 측정했다.

**하지 않은 검증**: 실제 API·SSE 연결 상태에서의 동작(프론트 통합 단계), 스크린리더 실물 낭독(NVDA 등 미설치), 다크 테마 대비비 수치 측정(토큰을 그대로 써서 기존과 같다고 보았다).

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| R1 | **줄 바꿈 + 2만 줄**은 측정 기반 가변 높이라 스크롤바 길이가 스크롤하는 동안 조금씩 보정된다(designer R2와 같은 한계). 줄 바꿈을 끈 기본 상태는 20px 고정이라 영향 없음 |
| R2 | `AlertItem`은 **한 건**만 그린다. 목록 가상 스크롤(항목 높이 76/96/112 + 확장)은 프론트 몫이고, 확장된 항목이 섞이면 점프가 생길 수 있다(designer R1) |
| R3 | 좁은 폭에서 영향 객체를 **1개로 줄이는 것은 호출 측**이다(`targets`·`targetsMore`를 잘라서 넘긴다). 컴포넌트는 받은 만큼 그린다 |
| R4 | 안내 줄(`dropped`·`ringTop`) 문구에 **시각 구간**이 필요하면 서버가 `segments`에 문구를 넣어 줘야 한다. 없으면 컴포넌트가 최소 문구(`초당 상한으로 1,204줄 생략됨`)만 쓴다 — 화면이 시각을 지어내지 않는다 |
| R5 | `.app-nav` 높이 보정에 CSS `:has()`를 썼다(Edge·Chrome·Safari 지원). 아주 오래된 브라우저에서는 종전처럼 40px이 잘린다 |
| R6 | 매트릭스 로그 버튼은 hover 전 `pointer-events: none`이라 **자동화 도구가 곧바로 클릭하지 못한다**(마우스를 셀 안으로 옮긴 뒤에는 정상). 실제 사용자 조작에는 문제가 없다 |

### 8. 다른 담당 요청

**프론트 요청**
1. `SideNav`에 **`footerItems={DEFAULT_NAV_FOOTER_ITEMS}`를 넘겨야** `설정`이 나온다(안 넘기면 종전과 같은 모습).
2. 알림 배지는 `{ count, countTone, countLabel }` 세 개를 **서버 값 그대로** 넘긴다. 최초 로딩 중에는 `count`를 넘기지 않고(자리도 비운다), 끊긴 뒤에는 마지막 값을 유지하며 `countLabel` 끝에 `· 14:02:10 기준`을 붙인다(`shell.md` 5절). **0으로 내리지 말 것.**
3. 브라우저 탭 제목 `(3) 파드 · Sentinel`은 프론트 몫이다(컴포넌트에 없다).
4. **정지 구간 줄을 필터 결과 배열에서 빼지 말 것.** `AlertGapRow`는 필터와 무관하게 시각 순 자리에 그대로 둔다(필터 결과 0건이어도 빈 상태 문구 **위에**).
5. 읽음 처리는 **항목 클릭·확장·점 클릭·모두 확인**만이다. 화면을 여는 것으로 읽음 처리하지 말 것.
6. `AlertItem`은 계약과 이름이 **두 곳 다르다**: `flapping`은 계약이 객체(`{active,…}`)고 prop은 boolean(`Boolean(a.flapping?.active)`), `reason`은 계약이 `Reason` 객체고 prop은 `string`(`a.reason?.text ?? ""`). 나머지(`durationMs`·`repeatCount`·`suppressedAreas`·`dispatch[]`·`logHref`·`dataSource`)는 계약 이름 그대로다.
7. 가림 규칙 팝오버는 호출 측이 연다. `onRedactionClick(line, anchor)`의 `anchor`가 **sticky gutter 요소**이므로 그 자리에 붙이면 가로 스크롤해도 팝오버 위치가 어긋나지 않는다. 팝오버 본문에 쓸 문구는 `LOG_REDACTION_NO_RAW`·`LOG_CONFIDENCE_LABEL`로 export 해 뒀다.
8. `RedactionNotice`는 **로그 본문이 보이는 모든 자리**에 넣어야 한다(`/logs`·파드 상세 로그 탭·컨트롤 플레인 진입). `InlineAlert`로 직접 만들지 말 것 — 그러면 `closable`을 붙일 수 있게 된다.

**백엔드 요청**
- `docs/api/logs.md` 3절의 `LogSegment.rules`가 `{id,label}` 객체인데 `components.md` 20.5 표는 `string[]`이다. 컴포넌트는 **둘 다 받도록** 했으니 계약은 바꾸지 않아도 된다. 다만 문서 둘 중 하나는 다음 갱신 때 맞추는 것이 좋다(designer/planner 판단).

**designer 참고(조치 불필요)**
- `MaskedValue variant="inline"`의 radius를 스펙 3px 대신 **토큰 `--radius-xs`(2px)** 로 썼다. 새 토큰을 만들지 않기 위해서다.
- 접힘 배지를 아이콘 **오른쪽 끝 기준**으로 붙였다(왼쪽 기준이면 `99+`에서 48px 상자를 넘는다).

### 9. 다음 담당이 알아야 할 점

1. **상단바는 이 작업에서 한 줄도 바뀌지 않았다.** `shell.md` 2·2.1의 폭 계산·컨테이너 쿼리는 그대로다. `NotificationBell`은 없고 앞으로도 만들지 않는다(AC-ALERT36).
2. **사이드바는 이제 목록만 스크롤한다.** 항목을 더 늘리려는 사람은 `shell.md` 3.3 계산 표를 먼저 갱신하고, `.app-nav`가 `overflow: hidden`이라는 점을 기억해야 한다(사이드바 안에서 스크롤하려면 `.navScroll` 쪽에 넣는다).
3. **닫을 수 없는 문구가 셋 있다**: 로그 가림 경고(`RedactionNotice`), 설정의 리소스 이름 안내(`InlineAlert`에 `closable`을 주지 않는다), 정지 구간 줄(`AlertGapRow`, 필터 불가침). 셋 다 "레이아웃·사용자 조작 사정으로 사라지지 않는다"가 목적이다.
4. `CollapsibleNotice`는 **접기만** 있고 접힘 상태를 저장하지 않는다(`localStorage` 호출 없음). 다음에 열면 다시 펼쳐지는 것이 의도다.
5. `LogLineList`는 **브라우저 저장소를 건드리지 않는다**(테스트로 고정). 링버퍼·따라가기 상태·찾기 입력값 관리는 전부 호출 측이다.
6. 컴포넌트는 **props로만** 동작한다. fetch·SSE·전역 상태가 하나도 없고, 시계를 읽는 곳은 시각 표기 두 군데(`Timestamp`, 알림 접근 이름)뿐이다. 지속 시간·반복 횟수·심각도·배지 숫자는 **전부 서버 값**을 그린다.
7. 문구는 문서에 적힌 그대로 쓴다: `확인 불가`(≠ `알 수 없음`), `해제`(≠ `정상`), `정지 구간 … 이 동안의 변화는 알림으로 잡히지 않았습니다`, `비밀값 가림은 … 완벽하지 않습니다`. 배지 문구는 `StatusAltLabel` 타입에 없으면 **컴파일이 안 된다**(고의 장치).

## 2026-09-25 06:50 · 통합 1차 후속

> `alerts`·`logs` 5b 퍼블리싱 후속이다. 두 기능을 한 번에 맡았다.
> **이 섹션이 정본**인 것: 발송 칩 2종, 계약·디자인 대조 테스트, `AlertItem` 좁은 폭, 검증 명령 전체.
> `LogLineList.onReachBottom`·스크롤 표시 결함·`SegmentedControl` JSDoc·sticky gutter 재확인은 **`docs/reports/logs/publisher.md` 같은 이름 섹션**에 있다.

### 1. 요청 내용

PM 5b 후속 지시다. designer가 디자인 문서를 고쳤고(`docs/reports/{alerts,logs}/designer.md` "01:30 · 통합 1차 후속"), 그중 표현 계층 몫을 구현했다.

| # | 요청 | 결과 |
|---|---|---|
| 1 | **발송 칩 2종** `skipped_no_pair`·`skipped_circuit_open`을 union과 `DISPATCH_SPEC`에 넣는다(`status.md` 12.5 그대로). 기존 "`failed`만 상태색, `skipped_mock`만 mock" 테스트가 새 2종에도 성립하는지 확인한다. **계약 1.4의 상태가 `DISPATCH_SPEC`에 빠짐없이 있는지 검사하는 테스트**를 넣는다 | 완료. 기존 테스트는 **고치지 않고** 통과했다. 대조 테스트는 계약 문서와 디자인 정본을 **직접 읽는다**(3절) |
| 2 | `LogLineList.onReachBottom` | 완료. logs 보고서 |
| 3 | `SegmentedControl` JSDoc(`disabledReason` 주의) | 완료. 동작은 그대로다. logs 보고서 |
| 4 | **`AlertItem` 좁은 폭 ④행 줄바꿈**(`alerts.md` 8절, `components.md` 20.1). 칩은 말줄임하지 않는다 | 완료. 브라우저로 경계 폭까지 쟀다(6절) |
| 5 | designer 보고서의 다른 publisher 몫 | designer 요청 3건은 위 1~4에 모두 들어 있다. 대조하다 **`alerts.md` 8절 ③ "사유 2줄 말줄임"이 구현에 빠진 것**을 찾아 함께 맞췄다(3절 (3)) |

### 2. 참고한 문서

- `docs/reports/alerts/designer.md`·`docs/reports/logs/designer.md` "2026-09-25 01:30 · 통합 1차 후속"(publisher 요청 3건씩)
- `docs/design/status.md` **12.5**(발송 칩 정본 11행 12종), `docs/design/components.md` **20절**(union·변경분 기록)·**20.1**(`dispatch` 말줄임 금지)·20.5·21.3·17.4, `docs/design/alerts.md` 4.3·**8절**(좁은 폭 ①~④)
- `docs/api/alerts.md` **1.4**(`DispatchState` 12종), 11절 893행(모르는 값 처리 — 디자인 C5와 다름, designer R10)
- `docs/reports/alerts/README.md`·`docs/reports/logs/README.md` "PM 결정 — 통합 1차에서 올라온 것"
- `docs/reports/alerts/frontend.md` 5절 F2·8절, `docs/reports/logs/frontend.md` 8절
- 코드는 **읽기만** 했다(수정 없음): `features/alerts/model.ts`(`state in DISPATCH_SPEC`), `features/alerts/alerts-logs.test.tsx`, `features/alerts/types.ts`, `features/settings/model.ts`, `features/logs/LogViewer.tsx`

### 3. 작업 내용

**(1) 발송 칩 2종 — `alertModel.ts`**

| state | tone | icon | label |
|---|---|---|---|
| `skipped_circuit_open` | neutral | `pause` | `발송 멈춤(연속 실패)` |
| `skipped_no_pair` | neutral | `ban` | `제외(발생 안 보냄)` |

- `DispatchState` union을 12종으로 늘렸다. `DISPATCH_SPEC`은 **`status.md` 12.5 표 순서대로** 다시 늘어놓았다(값은 기존 10종 그대로, 2종만 추가). 표와 나란히 읽을 수 있게 하려는 것이다.
- 주석에 정본 위치(12.5), 서버 `label`은 칩 문구가 아니라는 점, 새 2종의 뜻과 "재개 시각을 칩에 넣지 않는다", "말줄임 금지"를 적었다.
- 새 아이콘·새 토큰은 없다. `pause`·`ban` 모두 레지스트리에 이미 있다.

**(2) 모르는 값 처리 — `isDispatchState()` 추가, `AlertItem`이 스스로 거른다**
- `isDispatchState(state): state is DispatchState`(`Object.hasOwn`)를 `alertModel.ts`에 두고 `index.ts`에서 내보낸다.
- `AlertItem`은 `dispatch[]`에서 표에 없는 값을 만나면 **그 칩만 그리지 않는다**. 전에는 `DISPATCH_SPEC[d.state].label`에서 터졌다. 이 경우를 막는 것은 프론트 필터(`state in DISPATCH_SPEC`) 하나뿐이었다.
- 디자인 C5 그대로다. 모르는 값을 비슷한 칩으로 바꿔 그리지 않는다. 서버 `label`은 확장 영역에서 호출 측이 보여 준다.

**(3) `AlertItem` 좁은 폭(640px 미만) — `alerts.module.css`**
- **④행 줄바꿈** (`alerts.md` 8절)
  - `.targets { flex: 1 1 128px }`. flex 줄바꿈은 항목의 "가상 크기"로 판정한다. 대상 칸 기준을 128px로 두면 `128 + 8 + 오른쪽 묶음 폭 > 줄 폭`일 때 발송 칩·`로그`·확장 버튼 **묶음 전체**가 다음 줄로 간다.
  - 같은 줄에 남을 때는 대상 칸이 남는 폭을 모두 채운다(grow). 그래서 128px 아래로 줄지 않는다.
  - `.row3Right { margin-left: auto }`(종전 `0`) → 다음 줄로 가도 **오른쪽 정렬**이다. 줄 사이 4px는 종전 `row-gap`이다.
  - `.row3Right > * { flex-shrink: 0 }` → 칩이 줄어들지 않는다. **말줄임이 생기지 않는다.** `Chip`의 `.chipText`는 줄어들면 말줄임하는 구조라 이 규칙이 꼭 필요하다.
  - 극단적인 경우(칩 여러 개)에 묶음이 줄 폭보다 넓어지면, 가로 스크롤 대신 묶음 **안에서** 줄을 바꾼다(`flex-wrap: wrap; justify-content: flex-end; max-width: 100%`).
- **③ 사유 2줄 말줄임**(같은 절, 대조하다 찾은 누락)
  - `ReasonText`에 `className={styles.reason}`을 넘긴다. 좁은 폭에서만 `.row2 .reason`에 `-webkit-line-clamp: 2`를 준다.
  - 선택자가 클래스 두 개라 `ReasonText`의 1줄 규칙보다 앞선다. 넓은 폭은 종전대로 1줄이다.

**(4) 테스트 — `__tests__/alerts-logs.test.tsx`** (+12개, 이 파일 41 → 53)

| 테스트 | 무엇을 고정하나 |
|---|---|
| 새 2종 문구·아이콘·tone | `toEqual`로 정확히. 색 칩은 `failed:crit`·`skipped_mock:mock` 둘뿐이다. 렌더에서 문구 전체가 DOM에 있고, `chip-crit`이 없다 |
| 모르는 발송 상태 | `isDispatchState`: `toString`은 false. 모르는 값이 섞여도 터지지 않고 `보냄` 칩만 그린다 |
| **계약 1.4 = `DISPATCH_SPEC`** | `docs/api/alerts.md`의 `### 1.4` 절에서 `type DispatchState = …;`를 읽는다(주석은 제거). 계약에만 있는 상태와 `DISPATCH_SPEC`에만 있는 상태를 **따로** 실패 메시지로 낸다. **계약에 상태가 늘면 이 테스트가 먼저 깨진다** |
| **정본 `status.md` 12.5 = `DISPATCH_SPEC`** | 12.5 표를 읽어 12종의 문구·아이콘·tone을 비교한다. 한 행에 상태 둘(`skipped_severity` / `skipped_unknown_off`)이면 문구도 ` / `로 나눠 짝짓는다. 예시 값(`` `14:02:12` ``)은 뺀다. 상태 하나에 문구 둘(`보내는 중 / 재시도 대기`)이면 앞 문구를 쓴다 |
| 좁은 폭 ④행 CSS 회귀 | 640px 미만 블록에 `.targets { flex: 1 1 128px }`, `.row3Right { margin-left: auto }`, `.row3Right > * { flex-shrink: 0 }`가 있다(폭 판정은 jsdom에서 못 잰다 → 6절 실측) |
| `LogLineList` 스크롤 5개 · `SegmentedControl` 1개 | logs 보고서 (알림 몫 6 + 로그 몫 6 = 12) |

- 문서 경로는 `snapshot-3d.test.tsx`와 같은 방식으로 찾는다. vitest를 `apps/web`에서 돌리든 저장소 루트에서 돌리든 찾는다.

**(5) 미리보기 — `__preview__/AlertsLogsPreview.tsx`**
- 새 칩 2개를 단 알림 항목 2개를 넣었다: `발송 멈춤(연속 실패)` + `로그` + 확장, `해제` + `제외(발생 안 보냄)`.
- mock 발송 판정에서는 `skipped_mock`이 먼저 이겨 두 칩을 화면에서 볼 길이가 없다(designer R9). 그래서 `/dev/ui`에서 보게 했다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/alerts/alertModel.ts` | 수정 | union 12종, `DISPATCH_SPEC` 2줄 추가(12.5 순서), `isDispatchState()` |
| `apps/web/src/components/ui/alerts/AlertItem.tsx` | 수정 | 모르는 발송 상태 건너뛰기, `ReasonText className`, `dispatch` prop 주석 |
| `apps/web/src/components/ui/alerts/alerts.module.css` | 수정 | 좁은 폭 ③ 2줄 말줄임, ④ 128px 기준 줄바꿈·오른쪽 정렬·칩 줄어듦 금지 |
| `apps/web/src/components/ui/index.ts` | 수정 | `isDispatchState` 내보내기 |
| `apps/web/src/components/ui/__preview__/AlertsLogsPreview.tsx` | 수정 | 새 칩 2개 항목, `onReachBottom` 시연(logs 보고서) |
| `apps/web/src/components/ui/__tests__/alerts-logs.test.tsx` | 수정 | +12개(위 표). **기존 테스트 수정 0건** |
| `apps/web/src/components/ui/logs/LogLineList.tsx`, `controls/SegmentedControl.tsx` | 수정 | logs 보고서 |
| `docs/design/tokens.json` · `apps/web/src/styles/tokens.css` | **변경 없음** | **새 토큰 0건(9회 연속)** |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| P9 | 대조 테스트가 **계약 문서를 직접 읽는다** | 테스트에 12종 목록을 적어 두기 / `features/alerts/types.ts`의 union을 가져와 타입으로 비교 | 목록을 적어 두면 `DISPATCH_SPEC`이 빠진 것만 잡는다. 계약이 늘어난 것은 못 잡는다. PM 요구는 "다음에 상태가 늘 때 바로 걸리게"였다. `features/**` 타입을 가져오면 `components/ui`가 프론트 영역에 기대게 된다. 그 타입도 사람이 옮겨 적은 사본이다. 계약 원문이 유일한 출처다. 문서를 읽는 테스트는 `snapshot-3d.test`에 선례가 있다 |
| P10 | 디자인 정본(12.5) 대조도 같이 넣었다 | 계약 대조만 | designer C4: "`DISPATCH_SPEC`은 12.5를 그대로 옮긴다, 값을 바꿀 때는 12.5만 고친다". 그러면 12.5만 바뀌고 코드가 남는 일이 생긴다. 이것을 사람 눈 말고 잡을 방법이 없다. 표 모양이 바뀌면 이 테스트도 깨진다. 그것도 "다시 옮겨라"는 신호라 받아들였다 |
| P11 | `AlertItem`도 모르는 값을 **스스로** 거른다 | 프론트 필터만 믿는다 | 필터가 한 곳만 빠지면 화면 전체가 `undefined.label`로 터진다. 발송 칩은 부가 정보다. 모르는 값 하나 때문에 알림 목록이 안 보이면 안 된다. 동작은 디자인 C5와 같다(그리지 않음). `in` 대신 `Object.hasOwn`을 쓴다. `"toString" in DISPATCH_SPEC`이 true이기 때문이다 |
| P12 | ④행 판정을 **`flex-basis: 128px`** 하나로 | 컨테이너 쿼리 / JS로 폭 측정 / `min-width: 128px` | 판정 기준이 곧 "대상 칸 128px"이라 flex 줄바꿈 규칙과 같은 말이다. JS 측정은 항목마다 ResizeObserver가 붙는다. 컨테이너 쿼리는 칩 종류마다 폭이 달라 기준을 하나로 못 정한다. 한계: 대상 이름이 128px보다 짧아도 기준은 128px이다. 조금 일찍 내려갈 수 있지만 잃는 정보는 없다(항목 +24px) |
| P13 | `DISPATCH_SPEC` 키 순서를 12.5 표 순서로 | 기존 순서 끝에 2줄 추가 | 표와 코드를 나란히 놓고 읽을 수 있다. 객체 순서는 동작에 영향이 없다(칩은 `dispatch[]` 순서로 그린다) |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과**(0 error) | |
| `npx tsc --noEmit` (apps/web) | **통과** | |
| `npm test --prefix apps/web` | **595 passed (26 files)** | 이 파일 41 → 53. 나머지 증가분은 같은 시간에 일한 frontend 몫이다. **기존 테스트 수정 0건.** "`failed`만 상태색, `skipped_mock`만 mock" 테스트는 고치지 않고 새 2종과 함께 통과했다 |
| 회귀 테스트 변이 확인 | 스크롤 표시 수정을 잠시 되돌리자 해당 테스트 **1건 실패**. 되돌린 뒤 통과 | logs 보고서 |
| `NEXT_DIST_DIR=.next-pub2 npx next build` | **통과**(2회: 미리보기 수정 전후) | 끝난 뒤 `.next-pub2` 삭제 |
| **브라우저(Playwright 1.63 npx 캐시 + 설치된 Edge, headless)** | 아래 B1~B3 | `next start -p 3145` + `SENTINEL_UI_PREVIEW=1`. `netstat`로 3145를 듣는 PID를 확인했다(1차 23044, 재빌드 뒤 24852). **그 PID만** `Stop-Process -Id`로 껐다 |

**B1. ④행 줄바꿈 — 폭별 실측** (`/dev/ui` 알림 목록. 대상이 있는 항목 3개)

| 뷰포트 | ④행 폭 | `발송 멈춤(연속 실패)` 항목 | `보냄 14:02:12` 항목 | `제외(발생 안 보냄)` 항목 |
|---|---|---|---|---|
| 360 | 262 | **내려감**, 위 4px, 오른쪽 끝 0px | 내려감 | 내려감 |
| 440 | 342 | **내려감**(128 + 8 + 218 = 354 > 342) | 한 줄, 대상 154px | 한 줄, 대상 157px |
| 452 | 354 | **한 줄, 대상 정확히 128px**(경계) | 한 줄 166px | 한 줄 169px |
| 480~639 | 382~541 | 한 줄, 대상 156~315px | 한 줄 | 한 줄 |
| 640 이상 | — | 넓은 폭 3행 배치(종전 그대로) | | |

- 칩 실제 폭: `발송 멈춤(연속 실패)` **134px**, `제외(발생 안 보냄)` **123px**, `실제로 보내지 않음` 126px, `보냄 14:02:12` 96px. 디자인 추정치(130/119/122)보다 4px 넓다. 128px 기준에는 영향이 없다.
- **말줄임 0건**: 9개 폭 × 모든 칩에서 `scrollWidth > clientWidth`인 칩 문구가 없다.
- 줄바꿈된 항목의 높이 +24px(440px에서 117 → 141px). 설계값과 같다. 좁은 폭 최소 높이 112px 이상.
- 가로 넘침: 항목 `<li>`·목록 `<ul>` 모두 `scrollWidth == clientWidth`(9개 폭 전부).
  - 문서 전체는 360px에서 412px이다. 미리보기에 함께 있는 기존 `DataTable` 때문이다(22:20 섹션 B3과 같은 알려진 한계, 이번 범위 아님).

**B2. ③ 사유 2줄 말줄임** — 긴 사유(120자)를 넣어 측정했다.

| 폭 | 결과 |
|---|---|
| 360 | 높이 32px(16px × 2줄), 잘림(말줄임) |
| 1440 | 16px(1줄) |

**B3. 눈으로 본 것(스크린숏)**: 360px 알림 목록.
- `Pod prod/worker-…` 아래 줄 오른쪽에 `⏸ 발송 멈춤(연속 실패) · 로그 · ⌄`가 온다.
- `해제` 항목은 `⊘ 제외(발생 안 보냄) · 로그`가 아래 줄 오른쪽에 온다. 둘 다 문구 전체가 보인다.

**하지 않은 검증**
- 실제 API·SSE에서 두 칩(mock 판정이 `skipped_mock`을 먼저 내므로 볼 수 없다. designer R9·backend 픽스처 요청 그대로다)
- 스크린리더 실물 낭독
- 다크 테마 대비비(토큰 그대로)

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| R7 | 대조 테스트는 **문서 모양**에 기댄다(`### 1.4` 절 제목, `type DispatchState = '…' \| …;`, 12.5 표의 4열). 문서를 크게 고치면 이 테스트가 깨진다. 실패 메시지가 무엇이 어긋났는지 말해 준다. 깨지면 **먼저 코드와 문서를 다시 대조**하고, 그다음에 파서를 고친다 |
| R8 | ④행 기준은 대상 **칸** 128px다. 대상 이름이 짧아도 128px로 판정해서 조금 일찍 내려갈 수 있다(5절 P12) |
| R9 | 확장 버튼이 있는 항목은 ④행 `scrollWidth`가 `clientWidth`보다 몇 px 크다. `IconButton` 클릭 영역 가상 요소가 밖으로 나온 것이다. `<li>`는 넘치지 않는다(가로 스크롤 없음). **종전부터 있던 것**이고 이번 변경과 무관하다 |
| R10 | 계약 11절 893행(모르는 값 = "제외" 계열 중립 칩)과 디자인 C5(그리지 않음)가 아직 다르다. 컴포넌트는 **디자인을 따른다.** backend 몫이다(designer 요청 그대로) |

### 8. 다른 담당 요청

**frontend 요청** (전부 선택. 지금 코드로도 동작한다)
1. `features/alerts/types.ts` 37행 주석 `모르는 값이 와도 skipped_*는 "제외" 계열 중립 칩으로 그린다(11절)`이 디자인 C5·구현과 반대다. `칩을 그리지 않고 확장 영역에서 서버 label`로 고치면 좋겠다.
2. `state in DISPATCH_SPEC` 두 곳(`features/alerts/model.ts` 130·140행)과 `features/settings/model.ts` 77행의 캐스트 조회를 **`isDispatchState()`**로 바꿀 수 있다(`@/components/ui`에서 내보낸다).
   - 이유: `in`은 `"toString"`·`"constructor"`에도 true를 낸다. 서버가 그런 값을 보낼 일은 없어 **실제 영향은 없다.**
   - `AlertItem`도 이제 모르는 값을 스스로 건너뛰므로, 필터가 빠져도 터지지 않는다.
3. `skipped_no_pair`를 "모르는 값"의 예로 쓰던 테스트는 **frontend가 이미 고쳐 두었다**(`features/alerts/alerts-logs.test.tsx` 161·178행 확인). 이번 변경으로 깨지는 프론트 테스트는 없다(595 통과).

**backend 요청**: 새 것 없다. 계약 11절 893행 정정과 두 칩 mock 픽스처는 designer 요청 그대로 남아 있다(R10, designer R9).

**designer 참고(조치 불필요)**
- 칩 실측 폭은 추정보다 4px 넓다(134/123px). 128px 기준과 "+24px"는 실측과 맞았다.
- ③ 사유 2줄 말줄임(`alerts.md` 8절)은 22:20 구현에 빠져 있었다. 이번에 맞췄다.

### 9. 다음 담당이 알아야 할 점

1. **발송 상태가 늘면**: 계약 1.4에 값이 먼저 들어온다 → 대조 테스트가 깨진다 → **`status.md` 12.5에 문구가 정해질 때까지 `DISPATCH_SPEC`에 넣지 않는다**(그 사이 화면은 칩을 그리지 않는다). 넣을 때는 union·`DISPATCH_SPEC` 두 곳을 고친다(`Record<DispatchState, …>`라 한쪽만 고치면 컴파일이 안 된다).
2. **발송 칩은 줄어들지 않는다.** `.row3Right > * { flex-shrink: 0 }`을 지우면 좁은 폭에서 `발송 멈춤(연…`이 생긴다. 칩을 더 넣고 싶으면 묶음 안에서 줄이 바뀌는 구조(`flex-wrap`)를 쓴다.
3. 좁은 폭 ④행 판정은 `.targets`의 `flex-basis: 128px` 하나로 정해진다. 기준을 바꾸려면 `status.md` 5.3(끝 16자 보존)과 `alerts.md` 8절을 먼저 고친다.

## 2026-09-25 07:15 · 앵커(그 시각으로 열기) + 통합 2차 publisher 요청

> PM이 06:50 뒤에 보낸 추가 작업 두 건을 한 번에 했다. **정본은 `docs/reports/logs/publisher.md` 같은 이름 섹션이다.** 거기에 앵커·찾기 이동·스크롤 플래그·`SearchInput`·`Chip.removeLabel`, 그리고 **검증 명령 전체와 `tsconfig.json` 보고**가 있다.
> 이 섹션은 frontend `alerts` 통합 2차(06:50) 8절의 **설정 쪽 요청 3건**만 적는다.

### 1. 요청 내용

| # | 요청(frontend 06:50 8절, PM 전달) | 결과 |
|---|---|---|
| 1 | `SecretInput`에 `disabled`/`disabledReason`. 지금은 `<fieldset disabled>`로 막는다(R1) | 추가 |
| 2 | `Switch` 설명 문장을 `aria-describedby`로 연결(R2, settings.md 9절 "설명이 동작의 절반이다") | 추가(`aria-describedby` prop) |
| 3 | `Dialog.cancelDisabled` — 테스트 발송 중 취소 막기(R3, settings.md 4.3 "전송 중 `취소` 비활성, 대화상자는 닫히지 않는다") | 추가(+`cancelDisabledReason`) |

### 2. 참고한 문서

- `docs/reports/alerts/frontend.md` "06:50 · 통합 2차" 5절 S1, 7절 R1~R3·R5, 8절
- `docs/design/settings.md` 4.2·4.3(전송 중 표), 5절(잠김 입력 모양), 6.3(DB 없음 → 저장 컨트롤 전부 비활성 + 사유 툴팁), 9절(스위치 `aria-describedby`, 비활성 버튼은 `aria-disabled` + 포커스)
- 기존 코드: `Button`(`disabledReason` → 툴팁 + sr-only + `aria-describedby`), `TextField`, `ModalBase`(Esc·배경 클릭 → `onClose`)

### 3. 작업 내용

**(1) `SecretInput.disabled` + `disabledReason`**
- 뜻은 "**지금 잠시** 저장할 수 없다"(DB 없음)이다.
- 값·가림 힌트·글자 수·저장 시각은 **그대로 보인다.**
- 막는 것: `바꾸기`·`지우기`·`저장`. `Button disabled`(= `aria-disabled` + **포커스 유지**) + `disabledReason`(툴팁 + `aria-describedby`)으로 막는다. 입력칸은 `disabled`(잠김과 같은 모양, settings.md 5절)다.
- `lockedByEnv`와 다르다. 잠김은 .env가 정한 값이라 버튼 자리를 없애고 사유 문장을 남긴다. 이것은 버튼을 **그대로 두고** 막는다. 돌아오면 바로 누를 수 있다.
- 편집 중 `취소`(편집 접기)는 저장이 아니라서 막지 않는다.
- 루트에 `data-disabled="true"`를 둔다(테스트·스타일 훅).

**(2) `Switch` `aria-describedby`**
- 호출 측이 그린 설명 문장의 id(여러 개면 공백)를 스위치 버튼에 잇는다.
- 비활성 사유(`disabledReason`)가 있으면 그 id를 **뒤에** 붙인다. 설명 → 사유 순서로 읽힌다.
- 설명을 컴포넌트가 그리게(`description` prop) 하지 않은 이유: frontend가 이미 설명 문장을 레이아웃 안에 그려 두었다. 연결만 없던 것이다.

**(3) `Dialog.cancelDisabled` + `cancelDisabledReason`**
- 취소 버튼은 `aria-disabled`(포커스 유지)이고, 사유가 있으면 툴팁 + `aria-describedby`가 붙는다.
- **이 동안에는 Esc·배경 클릭으로도 닫히지 않는다.** `ModalBase`에 넘기는 `onClose`를 거른다.
  - 버튼만 막고 Esc로 닫히면 "전송 중 닫히지 않는다"가 두 갈래가 된다. frontend가 호출 측에서 따로 막던 것을 컴포넌트 규칙으로 옮겼다.
- `initialFocus="cancel"`(기본 포커스 취소)과 함께 써도 된다. 막힌 취소에 포커스가 가고 사유를 읽는다.

**(4) 미리보기** `/dev/ui` "기존 컴포넌트 확장 (2026-09-25 통합 2차 요청)"
- DB 없음 `SecretInput`, 설명이 이어진 `Switch`, 테스트 발송 `Dialog`(`보내기` → 전송 중 → `(시연) 전송 끝내기`), `SearchInput onKeyDown`

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/controls/SecretInput.tsx` | 수정 | `disabled`·`disabledReason` |
| `apps/web/src/components/ui/controls/Switch.tsx` | 수정 | `aria-describedby`(사유 id와 합침) |
| `apps/web/src/components/ui/overlay/Dialog.tsx` | 수정 | `cancelDisabled`·`cancelDisabledReason`, 그동안 Esc·배경 클릭 무시 |
| 나머지(로그·미리보기·테스트) | 수정 | logs 보고서 4절 |
| 토큰 | **변경 없음** | 새 토큰 0건 |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| S1 | `SecretInput` 입력칸은 네이티브 `disabled`, 버튼은 `aria-disabled` | 입력칸도 `readOnly` + `aria-disabled`(포커스 가능) | 설계가 잠김 입력을 `disabled`(배경 `bg.surfaceSunken`·글자 `text.disabled`)로 정했다(settings.md 5절). 사유는 포커스가 가는 버튼들과 폼 위 배너가 말한다. 입력칸까지 포커스를 받게 하면 "쓸 수 있는 칸"처럼 보이고 탭 순서만 늘어난다 |
| S2 | `Dialog.cancelDisabled` 동안 **Esc·배경 클릭도 막는다** | 버튼만 막는다 | settings.md 4.3 "대화상자는 닫히지 않는다". 버튼만 막으면 Esc가 뒷문이 된다. 호출 측마다 `onClose`에서 거르면 한 곳만 빠져도 규칙이 깨진다 |
| S3 | `Switch`는 `aria-describedby` 전달만(HTML 속성 이름 그대로) | `description` prop으로 컴포넌트가 설명을 그림 | 설명 문장의 자리·모양은 화면마다 다르다(설정 카드 안 줄 간격). 연결만 컴포넌트가 책임진다. `Button`·`TextField`도 같은 이름을 받는다 |

### 6. 검증 결과

전체 명령은 **logs 보고서 같은 섹션 6절**이 정본이다. 요약: lint·tsc 통과, test **625 passed**(내 파일 +16, 기존 테스트 수정 0), build 통과(첫 시도는 frontend 작업 중 파일 때문에 TypeScript 단계에서 실패, 재시도 통과), `.next-pub2` 삭제.

| 확인 | 방법 | 결과 |
|---|---|---|
| `SecretInput` disabled | 단위 테스트 | 값 보임, `바꾸기`·`지우기` `aria-disabled="true"`·`disabled=false`(포커스 가능), `aria-describedby`가 사유 문장을 가리킨다, 눌러도 `onEdit`·`onClear` 호출 0. 편집 모드: 입력칸 `disabled`, `저장` `aria-disabled` |
| `Switch` | 단위 테스트 | `aria-describedby="d1"`. 사유가 있으면 `d1 <사유id>` 순서 |
| `Dialog` | 단위 테스트 + Edge | `취소` `aria-disabled="true"`, 클릭·Esc로 `onClose` 0회. 끄면 1회. Edge: 전송 중 Esc 뒤에도 `dialog[open]` 유지, 전송이 끝난 뒤 Esc로 닫힘 |

- 발견(고치지 않음): `Button`은 `disabledReason` sr-only 문장을 **버튼 안에** 둔다. 그래서 접근 이름이 `바꾸기 대시보드 DB에…`가 되고, `aria-describedby`로 한 번 더 읽힌다. 종전 `Button` 동작이라 이번에 바꾸지 않았다(7절 R11).

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| R11 | `Button disabledReason`의 사유가 접근 이름과 설명에 **두 번** 들어간다(위 발견). 모든 비활성 버튼에 걸린 기존 동작이다. 바꾸면 `getByRole({ name })`을 쓰는 기존 테스트 여럿이 움직인다. 따로 한 번에 정리하는 편이 낫다(PM 판단) |
| R12 | `SecretInput.disabled`에는 컴포넌트 안에 보이는 사유 문장이 없다(툴팁·스크린리더만). 디자인상 사유는 폼 위 `Banner`가 말한다(settings.md 6.3) |

### 8. 다른 담당 요청

**frontend 요청**(3차)
1. 웹훅 입력의 `<fieldset disabled>` + 흐림 우회를 지우고 `<SecretInput disabled disabledReason="대시보드 DB에 연결할 수 없어 저장할 수 없습니다." … />`로 바꾼다(R1). 문구는 settings.md 6.3 배너와 맞춘다.
2. 스위치 설명 `<p id=…>`에 id를 주고 `<Switch aria-describedby={id} … />`(R2).
3. 테스트 발송 대화상자: `cancelDisabled={sending}` + `cancelDisabledReason="보내는 중에는 닫을 수 없습니다."`(R3). `onClose` 안의 "전송 중이면 무시" 우회는 지워도 된다(컴포넌트가 Esc·배경 클릭도 막는다).
4. `apps/web/tsconfig.json` 원복(R5)은 **아직 하지 않았다.** diff에 `.next-fe3dev` 줄이 있어서다. 개발 서버를 끈 뒤 원복하면 된다(logs 보고서 8절 PM 보고).

### 9. 다음 담당이 알아야 할 점

1. `SecretInput`의 **`disabled`(잠시 저장 불가)와 `lockedByEnv`(.env 고정)는 모양이 다르다.** 앞은 버튼을 두고 막고, 뒤는 버튼 자리를 없애고 사유 문장을 남긴다. 섞어 쓰지 않는다.
2. `Dialog.cancelDisabled`는 **닫기의 모든 길**(버튼·Esc·배경 클릭)을 막는다. 켜 둔 채로 잊으면 대화상자가 안 닫힌다. 전송이 끝나면(성공·실패·429) 반드시 끈다.

## 2026-09-25 07:55 · 검증 전 정리 (특별한 줄 가운데 · Button 이중 낭독 · ResourceName `logHref`)

> **정본은 `docs/reports/logs/publisher.md` 같은 이름 섹션이다**(세 건 전부, 검증 명령 전체, 고친 테스트 표). 여기에는 설정·알림 화면에 닿는 **`Button` 변경**만 적는다.

### 1. 요청 내용
- PM 검증 전 정리 2번: `Button`의 비활성 사유가 버튼 **이름**에도 들어가 스크린리더가 두 번 읽는다. 사유를 설명(`aria-describedby`)에만 둔다. 기존 테스트 수정 허용.

### 2. 참고한 문서
- `docs/reports/logs/README.md` "3차 뒤 정리 목록" 2번, 이 파일 07:15 섹션 R11(내가 찾아 남긴 결함)

### 3. 작업 내용
- 사유 요소(`<span id>`)를 **버튼 밖**(툴팁 래퍼 안)으로 옮기고 `hidden`을 붙였다. 이름은 버튼 문구만, 사유는 설명으로 **한 번** 읽힌다. 숨긴 요소도 `aria-describedby`로 직접 가리키면 설명에 들어간다(accname 규칙).
- 설정 화면에 주는 영향: DB 없음 `SecretInput`의 `바꾸기`·`지우기`·`저장`, 테스트 발송 `보내기`(쿨다운 사유), `Dialog` `취소`(전송 중 사유)가 모두 `Button`이다. 이제 이름이 `바꾸기`, 설명이 `대시보드 DB에 연결할 수 없어 저장할 수 없습니다.`로 따로 읽힌다(Edge 확인, logs 보고서 B11).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/controls/Button.tsx` | 수정 | 사유 요소를 버튼 밖 `hidden`으로 |
| `apps/web/src/components/ui/__tests__/snapshot.test.tsx` | 수정 | 기존 테스트 1건(이유는 logs 보고서 5절 표) |
| `apps/web/src/components/ui/__tests__/alerts-logs.test.tsx` | 수정 | `SecretInput` 이름 검사를 정확한 이름으로 좁힘 + `Button` 테스트 2개 |

### 5. 주요 결정과 이유
- 버튼 밖 **sr-only**가 아니라 **`hidden`**: sr-only면 이름에서는 빠져도 읽기 모드에서 떠돌이 문장으로 또 읽힌다(logs 보고서 K9).

### 6. 검증 결과
- 전체는 logs 보고서 6절이다. lint·tsc 통과, test **634 passed**, build 통과. **`features/**` 테스트 깨짐 0건.**
- 이 화면 몫(Edge): `바꾸기`·`지우기`의 `textContent` = 버튼 문구, 설명 글자 = 사유, 설명 요소 `hidden`·버튼 밖.

### 7. 남은 이슈·한계
- 07:15 R11 **해결**.
- `Switch` 비활성 사유는 이름에는 안 섞이지만 sr-only라 읽기 모드에서 한 번 더 읽힐 수 있다(logs 보고서 RL16, 범위 밖).

### 8. 다른 담당 요청
- **frontend**: 없음. 설정 화면 테스트 중 버튼 이름을 사유까지 포함해 찾던 곳은 없었다(634 통과).

### 9. 다음 담당이 알아야 할 점
- 비활성 버튼은 이제 **정확한 문구**로 찾는다(`getByRole("button", { name: "보내기" })`). 사유는 `aria-describedby`로 확인한다.
