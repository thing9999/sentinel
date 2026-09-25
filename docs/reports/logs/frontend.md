# logs · frontend 작업 보고

> 파일 위치: `docs/reports/logs/frontend.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 23:55 · 로그 뷰어 통합 (`/logs` · 파드 상세 · 컨트롤 플레인 진입)

> **`alerts`와 함께 한 번에 맡은 작업이다.** 사이드바 3항목·셸 배선·스트림 배선·검증 명령 전체는
> **`docs/reports/alerts/frontend.md`가 정본**이다. 이 문서는 **로그 화면과 그 판단**만 적는다.

### 1. 요청 내용

PM 지시(5단계 통합) 중 logs 몫:

| # | 요청 | 결과 |
|---|---|---|
| A | `/logs` 로그 뷰어 — 직접 조회(L1)·가림 표시·실시간 따라가기 | 구현 |
| B | 파드 상세·컨트롤 플레인 매트릭스에서 **로그로 가는 동선**(`cells[].logHref`) | 구현 |
| C | 로그 스트림 정리 — `log.closing` → `EventSource.close()`, 떠날 때 **`POST …/close` 필수**, 공용 SSE 와 별개 | 구현 + 실측 |
| D | 마스킹 표시 — `RedactionNotice`를 **로그가 보이는 모든 자리**, 팝오버는 `label`만, **규칙 개수 고정 금지** | 구현 |
| E | 작업 중 PM 추가 지시: 외부 로그 스택(L2)이 이미 동작하니 **출처 전환 UI 까지 붙여도 된다** | 붙였다 (3-(1)) |

### 2. 참고한 문서

- `docs/api/logs.md` **전체**(1.1 `capabilities`·1.2 `LogLine`·1.3 `LogNotice`·2.1~2.3·5절 상한·6절 코드·7절 이벤트·**12절 화면이 하지 않는 것**)
- `docs/design/logs.md` 2~13절(특히 3 출처 줄·4 한계 블록·6.1 닫을 수 없는 경고·6.3 찾기 vs 검색·7 본문·7.3 가림 팝오버·7.5 상태 줄·9 파드 상세·10 사라진 파드·12 좁은 폭)
- `docs/reports/logs/README.md` — PM 결정 Q2(원문 보기 없음)·Q6(내려받기 없음), 비밀값 원칙 7개, **가림 표식 위치 정정과 AC-LOG07**
- `docs/reports/logs/publisher.md` **7절 프론트 요청 1~7**, 8절(“sticky gutter 가 가장 깨지기 쉽다”)
- `docs/reports/logs/backend.md` 최신 섹션 8·9절(전용 연결·`close` 필수·`segments[]` 그대로)

### 3. 작업 내용

#### (1) `LogViewer` — `/logs`와 파드 상세가 **같은 컴포넌트**를 쓴다

화면이 두 벌이 되지 않게 뷰어를 하나로 만들고, 바깥(경로·파드 선택기·높이)만 다르게 넘긴다.

- **출처 줄**: `capabilities.sources`를 **그대로** `SegmentedControl`에 넣는다. 못 고르는 칸도 **목록에 남기고**
  `disabled` + `disabledReason`(서버 문구)을 준다 — 비활성이어도 포커스를 받아 사유를 읽을 수 있다.
  능력 칩(`검색`·`기간`·`사라진 파드`·`합쳐보기`·`보관 3일`)은 서버가 준 목록 그대로다. **출처를 자동 전환하지 않는다.**
- **한계 블록**: `sources[].limitations`가 있을 때만(`direct`) `CollapsibleNotice`로 그린다. `summary`·`lines`·`hint` 전부 서버 문구.
- **대상**: 컨테이너 칩은 `targets.containers`, 기본 선택은 **서버 `defaultContainer`**. init 은 별도 그룹, 1개면 숨긴다.
- **조작**: 기간·줄 수 선택지는 **서버 값**(`rangeOptions`·`limits.lineOptions`)이다. 화면에 목록을 두지 않았다.
  찾기 라벨·부제도 `capabilities.labels`를 그대로 쓴다(`direct`는 `화면 안에서 찾기`, `stack`은 `검색`).
- **본문**: `LogLineList`에 `segments[]`를 그대로 넘긴다. 정규식으로 다시 파싱하지 않고 `dangerouslySetInnerHTML`도 없다.
- **하단 상태 줄**: `N줄 · 가림 N건 · 초당 상한으로 N줄 생략 · HH:mm:ss부터 · 스트림 1/3` — **전부 서버 값**(`stats`·`streams`).

#### (2) 전용 스트림 (`useLogStream`)

공용 SSE 와 **완전히 별개**다. 준비(POST) → SSE(GET) → touch/close 3단계.

| 규칙 | 구현 |
|---|---|
| `log.closing` | 배치를 비우고 **`EventSource.close()`** + `POST …/close`. **재연결하지 않는다**(그 `streamId`는 이미 소비돼 404 루프가 된다) |
| `onerror` | 같은 처리. 서버가 `retry:`를 보내지 않으므로 브라우저 자동 재연결을 그대로 두면 404 를 계속 친다 |
| 화면을 떠날 때 | 언마운트는 `fetch(keepalive)`, 탭 닫기(`pagehide`)는 `navigator.sendBeacon` — 그래서 계약이 **본문 없는 POST** 로 정의돼 있다 |
| `touch` | **보이는 동안만** 60초마다(`visibilityState === "hidden"`이면 건너뛴다) |
| 줄 반영 | 서버 250ms 배치 + **rAF 배치**(`createBatcher`)로 프레임당 1회 |
| 링버퍼 | 2만 줄. 넘치면 잘라내고 목록 맨 위에 `ringTop` 안내 줄을 **화면이** 만든다(서버는 보내지 않는다) |

#### (3) 가림 표시

- `RedactionNotice`(닫기 없는 preset)를 **뷰어 맨 위**에 둔다 → `/logs`·파드 상세 둘 다 자동으로 붙는다.
- 규칙 팝오버는 `LogLineList`가 준 **sticky gutter 요소**에 붙인다(가로로 스크롤해도 어긋나지 않게 **클릭 순간** 좌표를 잰다).
  **`rules[].label`만** 그리고 `id`는 `sr-only`에도 넣지 않는다. 개수를 숫자로 박지 않고 서버 목록을 그대로 나열한다.
  맨 아래 한 줄은 `LOG_REDACTION_NO_RAW`. **원문 보기·복사·명령 상자가 없다.**
- 찾기 입력값은 **URL·저장소에 남기지 않는다**(`useState`만).

#### (4) 진입점

| 자리 | 구현 |
|---|---|
| 사이드바 `로그` | `LOGS_ENABLED=false`면 **항목을 뺀다**(서버 `capabilities.enabled`) |
| 알림 항목 | 서버 `logHref`를 **그대로** 쓴다(`AlertItem`의 `logHref`·`targetGone`) |
| 컨트롤 플레인 매트릭스 | `cells[].logHref`. 서버 값 우선, 없으면 `LOGS_ENABLED` 확인 후 `podKey` 폴백(6절 B4·`alerts/frontend.md` 8절) |
| 파드 상세 | `로그` 섹션 — **기본 접힘**, 펼치면 뷰어(따라가기 켬, 480px) + `로그 화면에서 열기` 링크 |

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/logs/types.ts` | 추가 | 계약 1절 타입. **원문 필드 없음**, 가림 끄는 필드 없음 |
| `apps/web/src/features/logs/useLogStream.ts` | 추가 | 전용 SSE·touch·close·링버퍼·rAF 배치 |
| `apps/web/src/features/logs/LogViewer.tsx` | 추가 | 출처·한계·대상·조작·본문·상태 줄 (공용) |
| `apps/web/src/features/logs/LogsPage.tsx` | 추가 | `/logs` (네임스페이스·파드 선택기 + 뷰어) |
| `apps/web/src/features/logs/PodLogsSection.tsx` | 추가 | 파드 상세의 `로그` 섹션 (기본 접힘) |
| `apps/web/src/features/logs/RedactionRulesPopover.tsx` | 추가 | 가림 규칙 팝오버 (`label`만) |
| `apps/web/src/features/logs/href.ts` | 추가 | `/logs` 링크 만들기·읽기 (프론트 라우트 한 곳) |
| `apps/web/src/features/logs/useLogsEnabled.ts` | 추가 | `capabilities.enabled` 공유 조회(문서당 1회) |
| `apps/web/src/features/logs/logs.module.css` | 추가 | 줄 배치·팝오버·상태 줄 |
| `apps/web/src/app/logs/page.tsx` | 추가 | 라우트(`title: 로그`) |
| `apps/web/src/features/cluster-status/ControlPlaneSection.tsx` | 수정 | `cells[].logHref` |
| `apps/web/src/features/cluster-status/PodDetailPage.tsx` | 수정 | `로그` 섹션 1줄 추가 |
| `apps/web/src/features/cluster-status/types.ts` | 수정 | `ControlPlaneComponent.logHref`(선택) |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| L1 | 파드 상세의 로그는 **섹션 + 기본 접힘** | 디자인 9절대로 **탭**, 항상 펼침 | 현재 파드 상세는 탭 구조가 아니라 섹션 나열이다. 탭이면 "탭을 고른 순간"이 의사 표시인데, **항상 펼친 섹션**이면 파드 상세를 여는 모든 사람이 스트림 슬롯(3개)을 하나씩 먹는다. 접힘 = 연결 없음이고 펼치면 따라가기가 켜진다. 실측: 펼치기 전 `streams.open 0` → 펼친 뒤 `1` → 떠나면 `0` |
| L2 | 위로 스크롤하면 **자동 스크롤만** 풀고 연결은 유지 | 디자인 7.4대로 `따라가기` 스위치를 끈다 | 스위치를 끄면 **서버 연결이 실제로 끊긴다**(디자인 6.2). 그러면 `새 줄 12개` 버튼이 셀 줄이 없고, 다시 켜면 `POST /streams`부터라 초기 배치가 화면을 갈아엎는다(읽던 자리를 잃는다). 스위치=연결 / 자동 스크롤=따로 두면 두 문구가 모두 뜻대로 동작한다. **designer 확인 요청**(8절) |
| L3 | 컨테이너 칩의 `CrashLoopBackOff`는 **`tooltip`** | 디자인 5절 문구대로 `disabledReason` | `SegmentedControl`은 `disabled || disabledReason`으로 칸을 막는다 — 사유만 주면 **정작 조사해야 할 CrashLoop 컨테이너가 눌리지 않는다**(브라우저로 발견). 디자인도 "사유는 툴팁에 둔다"이므로 문구 위치는 그대로다 |
| L4 | 기간·줄 수·찾기 라벨을 **서버 값**으로만 | 화면에 선택지 상수 두기 | 계약 1.1이 `rangeOptions`·`lineOptions`·`labels`를 주는 이유가 "출처가 늘어도 화면이 안 바뀌게"다. 실제로 `stack` 출처로 바꾸니 **코드 변경 0줄**로 기간 6종·`검색` 라벨·능력 칩이 그대로 나왔다 |
| L5 | 가림 팝오버 좌표를 **클릭 순간**에 계산 | 렌더·이펙트에서 `getBoundingClientRect` | gutter 는 가로 스크롤 안의 sticky 요소라 렌더 시점 좌표가 실제와 다르다. 이벤트에서 재면 정확하고, React Compiler 의 "렌더 중 부작용 금지" 규칙에도 걸리지 않는다. 스크롤·리사이즈 때는 닫는다(어긋난 팝오버를 남기지 않는다) |
| L6 | `capabilities.enabled`를 **모듈 캐시**로 공유 | 화면마다 조회 / 전역 스토어에 넣기 | 사이드바·컨트롤 플레인·파드 상세 셋이 같은 값을 쓴다. 문서당 1회만 부르고, 로그 때문에 쿠버네티스·API 호출을 늘리지 않는다는 명세 4절과 결이 같다 |

### 6. 검증 결과

전체 명령 결과는 **`docs/reports/alerts/frontend.md` 6절**에 있다(lint·tsc·build 통과, `npm test` **566 passed**). 로그 몫만 옮겨 적는다.
브라우저는 Playwright + **설치된 Edge**(`channel: "msedge"`, 다운로드 없음), 웹 :3123 / mock API :3124.

**B1. 기본 화면 (`logs=direct`)**

| 확인 | 결과 |
|---|---|
| 가림 경고 | 상시 표시, 버튼 없음 |
| 한계 블록 | **4줄 전부**(`직접 조회 · 지난 로그·검색 없음` 요약) |
| 찾기 | 라벨 `화면 안에서 찾기` + 부제 `가져온 500줄 안에서만 찾습니다…`. "검색"이라는 낱말 **없음** |
| 로그 영역 | `role="log"`, **`aria-live="off"`** |
| 하단 상태 줄 | `500줄 · 가림 39건` |
| 호출 | `GET /logs/capabilities` → `GET /logs/targets/…` → `POST /logs/query` (그 외 없음) |
| 찾기 동작 | `listening` 입력 → `1 / 39`, **URL 에 입력값 없음** |

**B2. AC-LOG07 — 가림 표식이 가로 끝까지 스크롤해도 남는가**

1440px 에서는 mock 픽스처에 컨테이너보다 긴 줄이 없어 가로 스크롤 자체가 생기지 않았다. **700px + `줄 바꿈` 끔**으로 조건을 만들어 측정:

| 항목 | 값 |
|---|---|
| 본문 스크롤 폭 / 보이는 폭 | 939px / 666px |
| 가로로 끝까지(`scrollLeft = scrollWidth`) | sticky gutter **12개 전부** 본문 왼쪽 **+1px**, 폭 28px |
| 가림 표식 버튼 | 왼쪽 +3px, 전부 컨테이너 안 |
| `줄 바꿈` 켬 | 가로 스크롤 사라짐(`scrollWidth == clientWidth`) |

**B3. 가림 (`logs=secrets`)**

| 확인 | 결과 |
|---|---|
| DOM 전체 원문 검색 | `hunter2hunter2`·`AKIAIOSFODNN7EXAMPLE`·`s3cr3t-p4ssw0rd`·`a@b.com`·`MIIEowIBAAKCAQEA`·`alice` **0건** |
| `sql_statement` | `DETAIL: Key (email)=(?)` / `Failing row contains (?)` / `STATEMENT: INSERT INTO users (email, name) VALUES (?, ?)` — **PID·제약 이름·테이블/컬럼 보존** |
| 팝오버 | `환경 변수 덤프` + `높음` 칩 + `원문은 대시보드에서 볼 수 없습니다…`. **규칙 `id` 문자열 0건**(`outerHTML` 검색) |
| 개인 키 | `[가림: 개인 키 블록 4줄]` 한 줄 |

**B4. 전용 스트림**

| 확인 | 결과 |
|---|---|
| 준비 → 연결 | `POST /api/logs/streams` → `GET /api/logs/stream/ls_…` |
| 서버 카운터 | 따라가기 중 `streams.open 1/3`, 하단 상태 줄도 `스트림 1/3` |
| 줄이 붙는다 | 506줄 → 511줄 (4초) |
| **화면을 떠나면** | `POST /api/logs/streams/ls_…/close` **1건**, `streams.open` **0** |
| 탭 닫기 | `streams.open 1 → 0` (beacon 요청은 Playwright 가 잡지 못해 호출 자체는 못 셌다 — 슬롯 회수만 확인) |
| 파드 상세 | 펼치기 전 0 → 펼친 뒤 1 → 떠난 뒤 **0** |

**B5. 상태 화면**

| 시나리오 | 결과 |
|---|---|
| `pod-gone` | `이 파드는 더 이상 존재하지 않습니다` + footer `외부 로그 스택이 있으면…`. 오류 스택·빈 로그 아님 |
| `forbidden` | `pods/log 권한이 없습니다. deploy/rbac.yaml을 다시 적용하세요.`(서버 문구 그대로), 다른 화면 정상 |
| `disabled` | `로그 조회가 꺼져 있습니다` + 사이드바 항목 **사라짐**(12 → 11) + 매트릭스 로그 버튼 **0개** |
| `stack-down` | 선택은 **`로그 스택 (Loki)` 유지**(자동 전환 없음) + `로그 스택에 연결하지 못했습니다.` |

**B6. 외부 로그 스택 (L2, PM 추가 지시)**

| 확인 | 결과 |
|---|---|
| 자동 선택 | 서버 `activeSource`대로 `로그 스택 (Loki)` |
| 능력 칩 | `검색` `기간` `사라진 파드` `합쳐보기` `보관 3일` (서버 목록 그대로) |
| 찾기 라벨 | **`검색`**(`direct`의 `화면 안에서 찾기`와 다름) |
| 한계 블록 | **그리지 않음**(`stack`은 `limitations: null`) |
| LogQL 노출 | **없음**(`{label=` 패턴·`LogQL`·`\|=` 0건) |
| 사용자 전환 | `직접 조회` 클릭 → URL `source=direct`, 한계 블록·`화면 안에서 찾기` 복귀 |

**B7. 진입점**

| 자리 | 결과 |
|---|---|
| 컨트롤 플레인 매트릭스 | 로그 버튼 **15개**, `href=/logs?namespace=kube-system&pod=kube-apiserver-i-0a1b…`. 로그 꺼짐이면 **0개** |
| 알림 항목 | 서버 `logHref` 그대로(`/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9` 등) |
| 파드 상세 | `로그 보기`·`로그 화면에서 열기` 둘 다. 펼치기 전에는 가림 경고도 없다(로그 본문이 없으므로) |

**B8. 좁은 폭** — 360px 에서 `/alerts`·`/logs`·`/settings` 모두 문서 가로 스크롤 없음(360/360). 본문 안쪽 가로 스크롤은 사용자가 `줄 바꿈`을 끈 결과다.

**하지 못한 검증(숨기지 않고 적는다)**

- **유휴 5분(`log.paused`)·30분 강제 종료(`log.closing`)를 보지 못했다.** 기다려야 한다. `log.closing` 처리 경로(닫기 + 재연결 안 함)는
  코드로만 확인했고, `log.notice`·`log.paused`·`log.closing` 이벤트는 **mock 이 보내지 않아 한 번도 그려 보지 못했다.**
- **초당 수천 줄(`noisy`)을 따라가기로 흘려보내지 못했다.** 정지 조회로 `dropped` 줄만 확인했다.
- **실제 클러스터에 붙여 보지 않았다.** 전부 mock(3124)이다. `direct` live 경로는 backend 도 미검증이다.
- `stack` 출처의 **여러 파드 합쳐보기 접두 열**을 화면에서 보지 못했다(단일 파드로만 조회했다. `pods[]` 다중 선택 UI 는 만들지 않았다 — 7절 RL2).
- **스크린리더 실물 낭독**은 하지 못했다.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL1 | **`log.notice`·`log.paused`·`log.closing` 수신 화면이 미검증이다.** 코드는 `InlineAlert` + `다시 시작` 버튼으로 그리지만 mock 에서 그 이벤트가 오지 않아 눈으로 못 봤다 |
| RL2 | **`stack`의 여러 파드 합쳐보기(`pods[]`)·워크로드 선택기를 만들지 않았다.** 능력 칩에는 `합쳐보기`가 뜨는데 화면에는 단일 파드 선택만 있다. 접두 열은 `LogLineList`가 이미 지원하므로(`showPrefix`) 선택기만 붙이면 된다 |
| RL3 | `direct`에서 `이전 세대` 스위치는 있지만 **따라가기와 동시에 켤 수 없다**(계약 2.3.1: `previous`+스트림은 400). 따라가기가 켜져 있으면 스위치를 비활성으로 두고 사유를 툴팁에 적었다 |
| RL4 | 본문 높이는 `/logs` 520px·파드 상세 480px **고정**이다. 디자인 2절의 "남은 높이(최소 360px)" 계산은 넣지 않았다 |
| RL5 | 찾기 일치 이동(`Enter`/`Shift+Enter` 단축키)을 넣지 않았다. 위·아래 버튼과 `3 / 12` 카운터만 있다 |
| RL6 | 링버퍼 2만 줄은 넣었지만 **2만 줄까지 채워서 확인하지 못했다**(mock 이 초당 1~3줄). `ringTop` 줄 렌더는 코드 경로만 있다 |

### 8. 다른 담당 요청

**backend 요청**
1. **`cluster` 토픽 SSE 의 `ControlPlaneComponent.logHref`가 항상 `null`이다**(REST 는 값이 있다). 자세한 내용과 임시 폴백은
   `docs/reports/alerts/frontend.md` 8절에 적었다.
2. mock 에서 **`log.notice`·`log.paused`·`log.closing`을 한 번씩이라도 보내 주는 시나리오**가 있으면 좋겠다.
   지금은 그 세 화면을 눈으로 확인할 방법이 없다(유휴 5분·30분을 기다리는 것 말고는). 예: `logs=idle-pause`가 20초 뒤 `log.paused`.
3. `logHref`에 `follow=1`을 붙일지 정해 달라(디자인 6.2: 알림·매트릭스 진입은 따라가기 기본 켬). 화면은 서버 링크에 파라미터를 덧붙이지 않는다.

**publisher 요청**
- `SegmentedControl`의 `disabledReason`은 **단독으로도 칸을 비활성으로 만든다**(`disabled || disabledReason`).
  "사유는 툴팁에만"이 필요한 자리에서 함정이 된다(컨테이너 칩이 눌리지 않는 결함이 실제로 났다). `tooltip`으로 우회했으니 조치는 필요 없지만
  `components.md` 21.3에 한 줄 주의가 있으면 좋겠다.

**designer 확인 요청**
- **위로 스크롤했을 때 `따라가기` 스위치를 끄지 않았다**(5절 L2). 스위치는 "연결", 자동 스크롤은 별도로 두었다.
  디자인 7.4 문구("Switch 가 꺼진다")와 다르므로 확인이 필요하다. 지금 동작: 위로 스크롤 → `새 줄 N개` 버튼이 뜨고 줄은 계속 쌓인다 →
  버튼을 누르면 맨 아래로 + 자동 스크롤 재개. 스위치를 실제로 끄면 서버 연결이 끊겨 `새 줄 N개`가 셀 줄이 없어진다.

### 9. 다음 담당이 알아야 할 점

1. **로그가 나가는 문은 `LogViewer` 하나다.** `/logs`·파드 상세가 같은 컴포넌트를 쓰므로 가림 경고·한계 블록·상태 줄이 저절로 따라간다.
   새 진입점을 만들 때 `InlineAlert`로 경고를 직접 만들지 말고 이 컴포넌트를 쓰면 된다.
2. **`useLogStream`의 `close` 경로를 건드리지 마라.** 언마운트(`fetch keepalive`)와 탭 닫기(`sendBeacon`) **두 경로가 다 필요하다** —
   하나만 있으면 슬롯 3개가 샌다. `log.closing`에서 `EventSource.close()`를 빼면 404 재연결 루프가 된다.
3. **출처를 자동 전환하지 마라.** `stack`이 죽어도 `activeSource`는 그대로 두고 사용자가 누르게 한다(AC-LOG42).
   출처별로 화면을 갈라 쓰지도 마라 — `capabilities`가 다 말해 준다(실제로 L2 를 붙일 때 코드 변경이 0줄이었다).
4. **가림 규칙 개수를 화면·테스트에 숫자로 박지 마라.** 팝오버는 서버 목록을 나열할 뿐이고 `id`는 화면에 나가지 않는다(테스트로 고정).
5. **찾기 입력값을 URL·저장소에 넣지 마라.** 사용자가 검색칸에 비밀값을 칠 수 있다(명세 3.3.4). 지금은 `useState`에만 있다.
6. sticky gutter 는 **퍼블리셔의 `LogLineList` 구조**가 지킨다(`.inner { width: max-content }` + 줄을 정상 흐름에 둔다).
   그 파일을 고칠 일이 있으면 **긴 줄을 만들어 `scrollLeft = scrollWidth` 상태에서** 눈으로 확인할 것(이번에도 700px 폭으로 재확인했다).

## 2026-09-25 06:50 · 통합 2차 (찾기 단축키 · 본문 남은 높이)

> `alerts` 통합 2차와 한 번에 맡은 작업이다. **공통 검증 명령(lint·tsc·test 595·build)과 하이드레이션 확인은
> `docs/reports/alerts/frontend.md`의 같은 날짜 섹션 6절이 정본**이다. 여기는 로그 화면 몫만 적는다.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| RL5 | 로그 찾기에서 `Enter`/`Shift+Enter`로 다음·이전 일치 이동 | 구현. **찾은 줄로 본문을 스크롤**하는 것까지 넣었다(1차에는 위·아래 버튼도 카운터·테두리만 바뀌고 화면은 움직이지 않았다) |
| RL4 | `/logs` 본문을 디자인 2절의 "남은 높이(최소 360px)"로. 파드 상세는 480px 고정 그대로 | 구현. `/logs` 줄 간격도 디자인 2절 표(8px)로 맞췄다(5절 L8) |
| — | D1(섹션 + 기본 접힘)·D2(위로 스크롤하면 자동 스크롤만 멈춤) 유지 | 유지. 찾기 이동도 D2 규칙을 따른다(5절 L9) |

하지 않은 것(지시대로 3차): 파드 목록 행·이벤트·워크로드·DB 상세 진입점, 워크로드 선택기, `stack` 합쳐보기, `podKey` 폴백 제거, `at` 파라미터.

### 2. 참고한 문서

- `docs/design/logs.md` 2절(레이아웃·높이 표), 6.3(찾기 vs 검색), 12절(좁은 화면 — "찾기 결과 이동은 `Enter`(다음) / `Shift+Enter`(이전). 이동할 때 `aria-live`로 `3 / 12`를 읽는다")
- `docs/reports/logs/README.md` — "PM 결정 — 통합 1차에서 올라온 것"(D1·D2·D3)
- 내 1차 보고서 7절 RL4·RL5, 9절
- `apps/web/src/components/ui/logs/LogLineList.tsx`(가상 스크롤·`data-log-row`·`follow`·`programmatic` 플래그) — 고치지 않고 읽기만

### 3. 작업 내용

#### (1) 찾기 단축키 (RL5)

- `Enter` = 다음 일치, `Shift+Enter` = 이전 일치. 끝에서 처음으로(처음에서 끝으로) 돈다. `3 / 12` 카운터는 1차부터 `aria-live="polite"`라 이동할 때 읽힌다.
- **키는 찾기 상자를 감싼 `div`에서 받는다.** `SearchInput`(퍼블리셔)에 키 처리 prop 이 없어서, 입력칸의 `keydown`이 올라오는 것을 받는다. 컴포넌트는 고치지 않았다.
- **한글 조합 중 `Enter`는 무시한다**(`isComposing` / `keyCode 229`). 한글 입력기는 `Enter`로 글자를 확정하므로, 무시하지 않으면 한 글자 칠 때마다 다음 일치로 뛴다.
- **치자마자 누른 `Enter`**: 입력은 200ms 늦게 반영된다(디바운스). 그래서 `Enter` 순간 입력칸의 값이 현재 찾기어와 다르면 **그 값으로 첫 일치부터** 찾는다. 뒤이어 오는 디바운스 호출은 같은 값이라 아무 일도 하지 않는다(순번이 0으로 되돌아가지 않게 막았다).
- **찾은 줄로 스크롤**(`find.ts` `revealLine`): 가상 스크롤이라 목표 줄이 아직 그려져 있지 않을 수 있다 → ① `20px × 순번`으로 먼저 옮기고 ② 그려진 뒤 실제 줄 위치로 가운데를 맞춘다. 줄 바꿈이 켜져 줄 높이가 다르면 **그려진 줄 범위와 비교해** 몇 프레임 더 보정한다. 본문 안에서만 스크롤하고 페이지는 움직이지 않는다.
  - 새 찾기어를 칠 때도 첫 일치로 옮긴다(브라우저 찾기와 같은 동작). 위·아래 버튼도 같은 함수를 탄다.
  - 컴포넌트에 "그 줄로 스크롤" 기능이 없어 본문 요소(`role="log"`)와 줄 표식(`data-log-row`)을 읽는다 — **publisher 요청**(8절).
- **따라가는 중에 찾기 이동을 하면 자동 스크롤만 먼저 푼다**(연결 유지, `새 줄 N개`로 돌아온다). D2 와 같은 규칙이다.
- 찾기 입력값은 여전히 `useState`에만 있다. URL 에 남지 않는 것을 브라우저로 다시 확인했다.
- 순수 함수(`collectMatches`·`stepIndex`)와 스크롤 보조(`revealLine`)는 `features/logs/find.ts`로 뺐다(컴포넌트 파일에는 컴포넌트만).

#### (2) 본문 남은 높이 (RL4)

- `LogViewer`의 `height`에 `"fill"`을 더했다. `/logs`만 `"fill"`, 파드 상세는 **480 그대로**.
- 계산: `창 높이 − 본문 위쪽(문서 좌표) − 본문 아래(상태 줄까지) − 페이지 아래 여백`, **최소 360px**. 숫자를 박지 않고 실제 요소로 잰다.
- 다시 재는 때: 창 크기, **뷰어 크기**(한계 블록 접기·안내 줄 추가), 문서 크기(연결 끊김 배너). 값이 같으면 state 를 바꾸지 않아 측정이 바로 멈춘다(무한 루프 없음).
- `/logs` 줄 간격을 디자인 2절 표의 **8px**로 맞췄다: 페이지 `page-stack`(32px) → `styles.page`(8px), 뷰어 `stack`(12px) → `stack-sm`(8px). 본문에 48px 이 더 남는다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/logs/find.ts` | 추가 | `collectMatches`·`stepIndex`(순수) + `revealLine`(본문 스크롤 보조) |
| `apps/web/src/features/logs/LogViewer.tsx` | 수정 | `Enter`/`Shift+Enter`·찾은 줄로 스크롤·따라가기 중 자동 스크롤 해제, `height: "fill"` + `useFillHeight`, 뷰어 간격 8px, 본문 상자 `ref` |
| `apps/web/src/features/logs/LogsPage.tsx` | 수정 | `height={520}` → `height="fill"`, 페이지 간격 8px |
| `apps/web/src/features/logs/logs.module.css` | 수정 | `.page`(8px) · `.bodyBox` |
| `apps/web/src/features/alerts/alerts-logs.test.tsx` | 수정 | 찾기 2건 추가(글자 그대로 일치·`.`은 마침표만 / 순번이 돈다) |

`PodLogsSection.tsx`는 고치지 않았다(480 그대로).

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| L7 | 단축키만이 아니라 **찾은 줄로 스크롤**까지 넣었다 | 지시대로 순번만 움직인다 | 1차 버튼은 카운터·테두리만 바뀌고 화면이 안 움직였다. 500줄 중 300번째 일치로 "이동"했는데 보이지 않으면 이동이 아니다. 단축키를 붙이면 이 빈틈이 더 자주 드러난다 |
| L8 | `/logs` 줄 간격을 **8px**로 | 종전(32px·12px) 유지 | 디자인 2절 표가 8px 이고, 남은 높이를 채우는 작업이라 간격이 곧 본문 높이다(1440×900 에서 본문 위쪽 560 → 512px). 파드 상세도 같은 뷰어라 8px 이 되지만 같은 표를 따르는 것이다 |
| L9 | 찾기 이동 시 **자동 스크롤을 화면이 먼저 푼다** | `LogLineList`의 스크롤 감지(`onFollowBreak`)에 맡긴다 | 조용한 파드에서 실제로 놓쳤다: `LogLineList`는 자기 스크롤 뒤 `programmatic` 플래그를 세우는데, 이미 바닥이라 스크롤 이벤트가 안 나면 플래그가 남아 **다음 스크롤(찾기 이동)을 자기 것으로 착각**한다 → 따라가기가 풀리지 않고 다음 줄이 오면 바닥으로 되돌아가 찾은 줄을 잃는다. 원인은 컴포넌트라 publisher 요청으로 남기고, 화면은 D2 규칙(자동 스크롤만 해제, 연결 유지)을 직접 적용했다 |
| L10 | 높이를 **실제 요소로 잰다** | 디자인 표의 고정 합계(376px)로 `calc(100dvh − …)` | 우리 화면은 표와 다르다(네임스페이스·파드 선택 줄이 뷰어 밖에 있고, 가림 건수 안내·찾기 부제가 더 있다). 한계 블록 접기·안내 줄·배너로 위쪽 높이가 계속 바뀐다. 고정 합계는 한 가지 상태에서만 맞는다 |
| L11 | 한글 조합 중 `Enter` 무시 | 그대로 처리 | 한글 사용자가 찾기어를 칠 때마다 결과가 넘어간다 |

### 6. 검증 결과

전체 명령 결과는 `docs/reports/alerts/frontend.md` 같은 날짜 섹션 6절(lint·tsc 통과, test **595 passed**, build 통과). 로그 몫:
브라우저는 Playwright + 설치된 Edge, 웹 :3143(개발 서버) / mock API :3144.

**B1. 본문 높이**

| 창 | 본문 높이 | 본문 위쪽 | 문서 높이 | 비고 |
|---|---|---|---|---|
| 1920×1080 | **512px** | 512 | 1080 | 페이지 스크롤 없음(남은 높이를 딱 채움) |
| 1440×900, 한계 블록 **접음** | **412px** | 432 | 900 | 페이지 스크롤 없음. 접는 순간 360 → 412 로 늘어남 |
| 1440×900, 한계 블록 펼침 | 360px(최소) | 512 | 928 | 남은 높이 332px < 360 → 최소값, 페이지가 28px 스크롤 |
| 1366×768 · 1440×620 | 360px(최소) | 512 | 928 | 최소 높이 유지 |
| 파드 상세 `로그` 펼침 | **480px** | — | — | 고정 그대로 |

가로 스크롤은 모든 경우 없음. 간격 조정 전(1차 구조)에는 1440×900 본문 위쪽이 **560px**였다.

**B2. 찾기** (`java`, 191개 일치)

| 확인 | 결과 |
|---|---|
| 치자마자 `Enter`(디바운스 전) | `1 / 191` (첫 일치) |
| `Enter` ×4 | `2` → `3` → `4` → `5 / 191` |
| `Shift+Enter` | `4 / 191` |
| 처음에서 `Shift+Enter` | `191 / 191`, 본문 `scrollTop` 0 → **9642**(맨 아래 줄로 이동), 현재 일치가 본문 **안에** 보임 |
| 한글 조합 `Enter`(`keyCode 229`) | 순번 그대로 |
| URL 에 찾기어 | **없음** |

**B3. 따라가기 중 찾기**

| 파드 | 결과 |
|---|---|
| `prod/api-…`(줄이 계속 옴) | 찾기어 입력 → 첫 일치로 이동(`scrollTop` 0) → 4초 동안 **0 유지**, `새 줄 N개` 버튼 나타남, 줄 504 → 513, `스트림 1/3` 유지 |
| `batch/cleanup-…`(조용함) | 고치기 **전**: 이동 후 다시 바닥(`scrollTop` 9630)으로 끌려감 → 고친 **뒤**: 0 유지, `새 줄` 버튼, 따라가기 스위치 켬 그대로 |

**하지 못한 검증**

- **줄 바꿈을 켠 상태에서 긴 줄이 많은 경우의 보정 수렴**은 mock 픽스처에 긴 줄이 적어 눈으로 확인하지 못했다(코드 경로와 20px 추정은 확인). 2만 줄 링버퍼 끝까지의 이동도 채워 보지 못했다(1차 RL6 과 같은 한계).
- 스크린리더가 `3 / 12`를 실제로 읽는지는 확인하지 못했다(`aria-live` 속성만 확인).

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL4 | **해결** — `/logs` 남은 높이(최소 360px). 1440×900 에서 한계 블록을 펼쳐 두면 최소값에 걸린다(우리 화면의 위쪽 영역이 디자인 표보다 크다: 선택 줄이 뷰어 밖 + 가림 건수 안내 + 찾기 부제) |
| RL5 | **해결** — `Enter`/`Shift+Enter` + 찾은 줄로 스크롤 |
| RL7 | 찾은 줄로 스크롤은 퍼블리셔 컴포넌트의 DOM(`role="log"`, `data-log-row`)을 읽는다. 컴포넌트가 이 속성을 바꾸면 **조용히 스크롤만 안 된다**(카운터·테두리는 된다) — 8절 요청 1 |
| RL8 | `LogLineList`의 `programmatic` 플래그 누수(5절 L9)는 화면에서 우회했을 뿐이다. 사용자가 직접 위로 스크롤할 때도 같은 조건(이미 바닥에서 따라가기 시작 + 새 줄 없음)이면 첫 스크롤을 놓칠 수 있다 — 8절 요청 2 |

1차의 RL1·RL2·RL3·RL6 은 그대로다(3차 범위 또는 mock 한계).

### 8. 다른 담당 요청

**publisher 요청**
1. `LogLineList`가 `currentMatch`를 받으면 **그 줄이 보이도록 스스로 스크롤**하게 해 달라(가상 스크롤의 `offsets`를 컴포넌트가 가지고 있어 정확하다). 되면 `features/logs/find.ts`의 `revealLine`을 지운다.
2. `LogLineList`의 `programmatic` 플래그: 따라가기 효과가 `scrollTop = scrollHeight`를 넣었는데 **이미 바닥이라 스크롤 이벤트가 나지 않으면** 플래그가 남아, 다음 사용자·찾기 스크롤을 자기 스크롤로 착각한다. 값이 실제로 바뀔 때만 세우거나 다음 프레임에 내리면 된다(조용한 파드 `batch/cleanup-…`에서 재현).
3. (선택) `SearchInput`에 `onKeyDown` 또는 `onEnter(shift)` prop. 지금은 감싼 `div`에서 받는다.

### 9. 다음 담당이 알아야 할 점

1. `/logs`만 `height="fill"`이다. **파드 상세에 `fill`을 주지 마라** — 섹션 안 임베드라 "남은 높이"가 없다(디자인 9절 480px).
2. `/logs` 위쪽에 줄을 더하면 본문이 그만큼 줄어든다(최소 360). 줄을 더할 때는 1440×900 에서 본문 높이를 재 볼 것.
3. 찾기 이동을 바꿀 때 **한글 조합 `Enter`**와 **디바운스 전 `Enter`**를 같이 확인할 것. 둘 다 실제로 틀리기 쉬운 자리다.
4. 찾기 입력값은 여전히 `useState`에만 있다(URL·저장소 금지, 명세 3.3.4). `find.ts`에도 저장이 없다.

## 2026-09-25 07:40 · 통합 3차 (진입점 · 앵커 · 연결 멈춤 · 워크로드 합쳐보기)

> 지시 목록의 정본은 `docs/reports/logs/README.md` "통합 3차 frontend 지시 목록" 1~9번이다.
> 처음 지시에서는 앵커 표시·`currentMatch` 스크롤·설정 우회 제거가 "나중에"였다. publisher 07:15 작업이 끝나 **작업 중에 3차 범위로 들어왔다.**
> 설정 화면 반영(`keys[].status` 등)과 발송 칩은 `docs/reports/alerts/frontend.md`의 같은 날짜 섹션에 있다.
> **공통 검증 명령(lint·tsc·test·build)과 프로세스 정리도 이 섹션이 정본이다.**

### 1. 요청 내용

| # | 지시 (README 3차 목록) | 결과 |
|---|---|---|
| 1 | L2 진입점: 파드 목록 행·Warning 이벤트 행·워크로드 상세·DB 상세. **서버 `logHref` 그대로**, 파라미터를 덧붙이지 않는다 | 구현. 링크 만드는 화면 함수(`logsHref`·`logsHrefFromPodKey`)는 **지웠다**(3-(1)) |
| 2 | `/logs` 워크로드 선택기 + `stack` 합쳐보기(`pods[]`, RL2) | 구현. AC-LOG53 확인 |
| 3 | `ControlPlaneSection`의 `podKey` 폴백 **제거** | 제거. SSE 로 온 링크 15/15 확인 |
| 4 | `at` 처리(계약 2.2.1) | 데이터 쪽 + 표시(`LogLineList.anchor`)까지 연결 |
| 5 | designer 변경 5가지: 접힌 줄 가림 문장 삭제 · `onReachBottom` · **링버퍼 멈춤**("2만 줄"은 상수에서) · 연결이 닫히면 스위치 끔 + 받은 줄 유지 + `log.paused` 때 `close` · 진입점 따라가기 규칙(Q12) | 전부 구현 |
| 6 | mock 새 시나리오로 `log.notice`·`log.paused`·`log.closing` 화면(RL1), `logs=flood`로 AC-LOG51 | 확인 |
| 7 | 발송 칩 2종 확인 + `isDispatchState()` + `features/alerts/types.ts:37` 주석 | alerts 보고서 |
| 8 | `onReachBottom` 배선 + 스크롤 플래그 우회 제거 | 구현. 우회를 지운 뒤에도 증상이 없는 것을 확인 |
| 9 | 앵커 표시 · AC-LOG52·53 · "사라진 파드" 화면이 mock에 남아 있는지 | 확인 |
| 추가 (PM, 작업 중) | publisher 07:15 반영: `anchor` 배선, `currentMatch`+`seq` 스크롤, `revealLine` 삭제, `SearchInput.onKeyDown` | 반영 |

### 2. 참고한 문서

- `docs/reports/logs/README.md` — D1~D3, Q11~Q13, "작은 것 4건", "designer가 새로 정한 것", "backend 5b에서 드러난 것", **통합 3차 지시 목록**
- `docs/api/logs.md` **1.4**(셀렉터·`resolvedPods`), **2.2.1**(`at`·`anchorAt`·`anchor`·`LOG_ANCHOR_*`·`suggest`), 2.3.1(스트림에 `anchorAt`은 400), 6·7·9절, **11.4**(진입점 링크·쿼리 파라미터·워크로드 진입·선택기 출처), 12절
- `docs/api/cluster-status.md` — `PodItem`·`WorkloadItem`·`EventItem`·`ControlPlaneComponent`의 `logHref`, DB `kubernetes.pods[]`
- `docs/design/logs.md` 0·2·5·6.2·**7.4(재작성)**·**7.6(앵커)**·8.5·8.7·**9절**·12절
- `docs/specs/logs.md` AC-LOG13·16·29·39·50~53
- `docs/reports/logs/backend.md` 06:45 섹션(필드·notice 코드·mock 시나리오)
- `docs/reports/logs/publisher.md` 06:50(`onReachBottom`·플래그 결함 수정)·**07:15**(`anchor`·`currentMatch` 스크롤·`SearchInput.onKeyDown`·`Chip.removeLabel`)

### 3. 작업 내용

#### (1) 진입점 — 링크는 전부 서버 `logHref`

| 진입점 | 필드 | 화면 |
|---|---|---|
| 2 파드 목록 행 (+ 워크로드 상세 소속 파드, 노드 상세 파드) | `PodItem.logHref` | `podColumns` 이름 칸에 `로그`(`ButtonLink` ghost sm `scroll-text`) — 공용 열이라 세 표에 같이 붙는다 |
| 4 Warning 이벤트 행 (파드일 때만) | `EventItem.logHref` (`at=<lastSeenAt>`) | `eventColumns` 대상 칸. 파드 상세의 관련 이벤트 표에도 붙는다 |
| 5 워크로드 상세(행 펼침) | `WorkloadItem.logHref` (`workload=…&follow=1`) | `파드 목록에서 보기` 옆 |
| 7 DB 상세 DB 파드 | `kubernetes.pods[].logHref` | 파드 표 이름 칸 |
| 1 파드 상세 `로그` 섹션 | `pod.logHref` | **링크가 `null`이면 섹션째 없다.** `로그 화면에서 열기`는 그 주소 그대로 |
| 3 컨트롤 플레인 매트릭스 | `ControlPlaneComponent.logHref` | 서버 값 그대로. **`podKey` 폴백과 `useLogsAvailability` 호출을 지웠다** |

- 링크 컴포넌트 `features/logs/LogLink.tsx`는 기존 `ButtonLink`를 감싼 것이다(새 UI 아님). `null`이면 아무것도 그리지 않는다.
- **`features/logs/href.ts`의 겹치는 규칙을 정리했다**(PM 지시): `logsHref()`·`logsHrefFromPodKey()`를 **삭제**했다. 서버 규칙(`log-href.ts`)과 겹치는 두 번째 규칙이었고, 이제 서버 링크가 없는 자리가 없다. 남은 것은 URL **읽기**(`readLogsQuery` — `at`·`workload` 추가, `parseWorkloadKey`)뿐이다.
- `useLogsAvailability`는 사이드바 `로그` 항목에만 쓴다(서버 링크가 없는 유일한 자리). `denyNamespaces`는 더 들고 있지 않다.

#### (2) 연결이 닫히면 — 스위치 끔 · 받은 줄 유지 · 닫을 수 없는 멈춤 안내 (디자인 7.4)

`useLogStream`을 다시 짰다. 연결이 닫히는 모든 길이 **`onHalt(halt)` 하나**로 모인다.

| 원인 | `halt.kind` | 모양 | 비고 |
|---|---|---|---|
| `log.paused` (유휴) | `idle` | info compact + `다시 시작` | **화면이 `close`를 불러 슬롯을 돌려준다**(서버는 열어 둔 채 슬롯을 쥔다) |
| `log.closing` `max_duration` | `max` | info compact + `다시 시작` | |
| `log.closing` 그 밖(`source_error`·`shutdown`) | `closed` | warn compact (`resumable`이면 `다시 시작`) | |
| `onerror` (이벤트 없이 끊김) | `disconnect` | warn compact `로그 연결이 끊겼습니다.` | |
| **위로 올려 읽는 중 링버퍼가 참**(Q13) | `ring` | info **2줄**, `live`, `다시 시작` | 서버 코드가 없어 **화면이 문구를 만든다** |
| 스트림 시작 실패(503 상한·403·404) | `failed` | warn compact + `다시 시도` | `LOG_WORKLOAD_NO_PODS`만 본문 한 줄(디자인 8.7) |

- `LogViewer`는 멈추면 **스위치를 끄고**, 그 조회 키를 `keepKey`로 기억해 **정지 조회로 다시 읽어 오지 않는다**(받은 줄 유지). 조회가 바뀌면(컨테이너 등) 안내가 사라지고 정지 조회가 된다. 멈춤 안내는 전부 `closable` 없음.
- `다시 시작` = 스위치 켬 + 새 연결 + **맨 아래 + 자동 스크롤**(PM "작은 것 4건" 2). 스위치를 직접 켜도 같다.

#### (3) 링버퍼 멈춤 (Q13, AC-LOG51)

- `appendRing(lines, added, hold)`: `hold`(= 따라가기 켬 && 위로 올려 읽는 중)이면 **지우지 않고** 상한까지만 받고 멈춘다. 아니면 지금처럼 위에서부터 버린다.
- 안내 설명 `화면에 담을 수 있는 ${ringLimitText()} 줄이 찼습니다. …` — **`2만`은 `RING_MAX_LINES`(20,000)에서 만든다**(`ringLimitText`). 숫자가 문구에 따로 있지 않다(테스트로 고정).
- 멈춘 뒤에도 `새 줄 N개`는 남는다(받아 둔 줄 끝으로 가는 길, 숫자는 더 늘지 않는다).

#### (4) 자동 스크롤 (D2 · `onReachBottom`)

- `onReachBottom={() => setScrollAnchor((cur) => (cur === null ? cur : lines.length))}` — 맨 아래에 **직접** 닿으면 N=0, 자동 스크롤은 꺼진 채(publisher 제안 그대로).
- **스크롤 플래그 우회를 지웠다**: 통합 2차 `reveal()`의 "따라가기 중이면 자동 스크롤을 먼저 푼다"와 `find.ts`의 `revealLine`(본문 DOM 을 읽던 코드). 찾은 줄로 가는 스크롤은 `LogLineList`가 `currentMatch={{ lineId, index, seq }}`로 **직접** 한다(가로 포함). 같은 일치로 다시 갈 때 `seq`를 늘린다.
- 찾기 단축키는 감싼 `div` 대신 **`SearchInput.onKeyDown`**으로 받는다. 한글 조합 `Enter` 거르기·디바운스 전 `Enter`(지금 입력칸 값) 처리는 그대로다.

#### (5) 그 시각으로 열기 (계약 2.2.1, 디자인 7.6)

- `at`이 있으면 **따라가기 끔**으로 열고 `POST /logs/query`에 `anchorAt`, **`range`는 보내지 않는다**(서버가 고름). 사용자가 기간을 고르면 그 `range`를 같이 보낸다. 줄 수·이전 세대·출처를 바꿔 다시 조회해도 `anchorAt`은 계속 보낸다.
- 표시: `anchor={logListAnchor(res.anchor, logAnchorTimeText(at), formatFullTime(at))}` — 구분 줄·앵커 줄 강조·첫 화면 1/3 스크롤은 **컴포넌트가** 한다. 화면은 시각을 비교하지 않는다.
- 조작 줄 맨 앞 `그 시각 07:15:48` 칩(`history`, `removeLabel="그 시각 표시 해제"`) → `x`로 URL 의 `at`을 뗀다. 기간 Select 는 사용자가 고르기 전까지 `기간: 그 시각 기준`.
- `LOG_ANCHOR_BEFORE_RESULT`: info 2줄 + `suggest` 바로가기 — `more_lines` → `2,000줄로 다시 조회`(서버 `lineOptions`의 다음 값), `previous` → `이전 세대로 다시 조회`, `range` → `기간 고르기`(기간 Select 로 포커스, **대신 고르지 않는다**). `AFTER_RESULT`는 info compact. 둘 다 닫기 없음, 바로가기로 다시 조회했을 때만 `live`.
- **따라가기를 켜면 앵커를 푼다**: URL 에서 `at`을 떼고 스트림에는 `anchorAt`을 보내지 않는다(보내면 400).

#### (6) `/logs` 워크로드 선택기 + `stack` 합쳐보기 (AC-LOG29, RL2)

- 대상 선택: `네임스페이스 → 워크로드(전체/…) → 파드 → 컨테이너`. 네임스페이스·워크로드는 이미 구독 중인 `cluster` 토픽, 워크로드 소속 파드는 **서버 정렬**을 쓰려고 `GET /api/cluster/pods?namespace=&workload=`.
- `direct`: 워크로드를 고르면 파드 Select 를 그 소속으로 좁히고 **서버 목록의 첫 파드**(= 가장 나쁜 파드)를 고른다.
- `stack`(`multiPod`): 파드 선택기가 `MultiSelect`다. 워크로드를 고르고 파드를 따로 고르지 않으면 `selector.workload` → **서버가 푼 `resolvedPods`**로 선택기를 채운다(정지 조회는 응답 `selector.resolvedPods`, 따라가기는 `log.hello`의 `selector.pods`). 하나라도 빼면 `pods[]`(최대 20)로 보낸다. 합쳐 보면 줄마다 파드·컨테이너 접두 열.
- `LOG_PODS_CLAMPED`: info compact + `파드 고르기`(파드 선택기를 연다). `LOG_WORKLOAD_NO_PODS`: 본문 한 줄(서버 문구).
- 네임스페이스·워크로드·출처가 바뀌면 뷰어를 새로 시작한다(`key`). 네임스페이스·파드를 바꾸면 URL 의 `at`도 뗀다(다른 파드의 시각이다).

#### (7) 그 밖 (designer 변경)

- 파드 상세 접힌 줄에서 `비밀값은 서버에서 가려서 옵니다`를 뺐다. 토글에 `aria-expanded`·`aria-controls`.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/logs/LogViewer.tsx` | 수정(대부분 재작성) | `target`(파드/여러 파드/워크로드), 멈춤 처리·`keepKey`, 링버퍼 `hold`, `onReachBottom`, 앵커(요청·칩·기간·안내·`suggest`·`anchor` prop), `currentMatch`+`seq`, `SearchInput.onKeyDown`, `LOG_PODS_CLAMPED`·`LOG_WORKLOAD_NO_PODS`, `HaltNotice` |
| `apps/web/src/features/logs/useLogStream.ts` | 수정(재작성) | `onHalt`·`hold`·`onResolvedPods`, `appendRing`·`ringLimitText`·`closingHaltKind`, `log.paused`에서 `close`, 배치기 지연 생성 |
| `apps/web/src/features/logs/LogsPage.tsx` | 수정(재작성) | 워크로드 선택기, 서버 정렬 소속 파드, `stack` `MultiSelect`·`resolvedPods`, `at` |
| `apps/web/src/features/logs/PodLogsSection.tsx` | 수정 | `logHref` prop(없으면 섹션 없음), 링크 그대로, 접힌 줄 문장 삭제, `aria-expanded` |
| `apps/web/src/features/logs/href.ts` | 수정 | **링크 생성 함수 삭제**, `readLogsQuery`에 `at`·`workload`, `parseWorkloadKey` |
| `apps/web/src/features/logs/find.ts` | 수정 | `revealLine` **삭제**(순수 함수만) |
| `apps/web/src/features/logs/LogLink.tsx` | 추가 | 진입점 `로그` 링크(서버 값 그대로) |
| `apps/web/src/features/logs/types.ts` | 수정 | `LogSelector.pods`·`workload`, `LogResolvedSelector`, `LogAnchor`, `anchorAt`, 응답 `anchor` |
| `apps/web/src/features/logs/useLogsEnabled.ts` | 수정 | 사이드바 전용으로 축소(`denyNamespaces` 제거) |
| `apps/web/src/features/logs/logs.module.css` | 수정 | `.podPicker`·`.rangeBox`(`display: contents` 자리) |
| `apps/web/src/features/logs/logs.test.tsx` | 추가 | 10건 |
| `apps/web/src/features/cluster-status/types.ts` | 수정 | `PodItem`·`WorkloadItem`·`EventItem.logHref`, `ControlPlaneComponent.logHref` 필수화 |
| `apps/web/src/features/cluster-status/shared.tsx` | 수정 | 파드 이름 칸·이벤트 대상 칸 `로그` |
| `apps/web/src/features/cluster-status/DbPage.tsx` · `WorkloadsPage.tsx` | 수정 | `로그` |
| `apps/web/src/features/cluster-status/ControlPlaneSection.tsx` | 수정 | **`podKey` 폴백 삭제** |
| `apps/web/src/features/cluster-status/PodDetailPage.tsx` | 수정 | `pod.logHref` 전달 |
| `apps/web/src/features/__fixtures__/fixtures.ts` | 수정 | 서버 규칙 모양의 `logHref`(파드·워크로드 `follow=1`, 이벤트 `at`, 매트릭스 `missing`은 null) |
| `apps/web/src/features/pages.test.tsx` | 수정 | +2(파드 행 링크, 매트릭스 링크 = 서버 값·폴백 없음) |
| `apps/web/src/features/alerts/alerts-logs.test.tsx` | 수정 | 링크 생성 테스트 2건 → URL 읽기 1건으로 교체 |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| L12 | 멈춤을 **훅의 `onHalt` 한 곳**으로 모으고, 화면은 `keepKey`로 "받은 줄 유지"를 표현한다 | 스위치 표시만 `follow && !halted`로 가리기 | 가리기만 하면 `follow` 상태가 켜진 채라 컨테이너를 바꾸는 순간 **스위치가 꺼져 보이는데 새 연결이 열린다**. 스위치를 실제로 끄고 "이 조회는 다시 읽지 않는다"를 키로 기억하면 두 규칙(스위치 = 연결, 받은 줄 유지)이 함께 선다 |
| L13 | 링버퍼 판정을 **setState 갱신 함수 밖**에서 한다(`stateRef` + `commit`) | 갱신 함수 안에서 판정 | 멈춤은 연결 정리·`close` 호출이라는 부수 효과가 따른다. 갱신 함수는 여러 번 불릴 수 있다(통합 1차 F4와 같은 이유) |
| L14 | 시작 실패(503 등)도 **스위치를 끈다**(`failed`) | 종전처럼 스위치를 켠 채 오류 안내 | "스위치가 켜져 있는데 줄이 안 오는 상태를 만들지 않는다"(디자인 7.4). `LOG_WORKLOAD_NO_PODS`는 디자인 8.7이 명시적으로 "스위치는 꺼진 채" |
| L15 | 파드 목록 행의 `로그`는 **항상 보이는 `ButtonLink`**(`로그` 글자 + 아이콘) | 디자인 0절 3: 이름 칸 hover·focus 때 `scroll-text` IconButton(복사 버튼 다음) | hover 로 나타나는 아이콘 링크는 `ResourceName` 안(복사 버튼 옆) 자리라 퍼블리셔 컴포넌트다. 화면이 따로 만들면 새 UI 가 된다. **publisher 요청**으로 남긴다 |
| L16 | 파드 상세 `로그 화면에서 열기`에 **고른 컨테이너를 붙이지 않는다** | 디자인 9절: `…&container=…&follow=1`로 고른 컨테이너를 넘긴다 | PM 제약 "링크는 서버 `logHref` 그대로, 파라미터를 덧붙이지 않는다"가 우선이다. 로그 화면은 서버 기본 컨테이너로 열린다(대부분 같은 값). **designer 확인 요청** |
| L17 | 앵커 **표시·스크롤은 컴포넌트**, 화면은 값만 | 화면이 본문 DOM 을 읽어 옮기기(통합 2차 `revealLine` 방식) | publisher K1. 가상 스크롤의 줄 위치를 정확히 아는 것은 컴포넌트뿐이다. 같은 이유로 `revealLine`도 지웠다 |
| L18 | 워크로드 소속 파드는 **REST 로** 읽는다(`?workload=`) | 이미 구독 중인 `cluster` 토픽의 `pods`를 거르기 | 계약 11.4 "첫 파드 = 서버 정렬의 첫 번째(가장 나쁜 파드), 화면이 다시 고르지 않는다". 토픽의 `pods`는 맵이라 순서가 없고, 화면이 정렬하면 서버 규칙을 다시 드는 셈이다 |
| L19 | 본문 상자에 `data-anchor-state`·`data-anchor-line`을 남겼다 | 두지 않음 | 서버가 지목한 줄을 브라우저 검증에서 확인하는 표식이다(AC-LOG52 "그 줄은 서버가 지목한 줄"). 화면은 이 값을 읽지 않는다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과** (0 error) | 중간에 `react-hooks/refs` 1건(배치기를 렌더 중에 만듦) → 지연 생성으로 고침 |
| `npx tsc --noEmit` (apps/web) | **통과** | |
| `npm test --prefix apps/web` | **625 passed (27 files)** | 내 순증 **+14**(logs 10, settings 3, pages 2, alerts-logs −1). 나머지 +16은 publisher 07:15. 기존 테스트 수정: `alerts-logs`의 링크 생성 테스트 2건(함수를 지웠다), 설정 DB 없음 테스트 1건(`fieldset` → `SecretInput.disabled`) |
| `NEXT_DIST_DIR=.next-fe3 npx next build` | **통과** | 24 라우트. 끝난 뒤 `.next-fe3`·`.next-fe3dev` 삭제 |
| 브라우저 (Playwright + Edge) | 아래 C1~C9 | 웹 :3143(개발 서버, 마지막 하이드레이션은 프로덕션) / mock API :3144(`apps/api` 소스를 스크래치 폴더로 tsc 컴파일해 띄움 — backend 의 `dist`·3141 을 건드리지 않았다) |

**C1. 진입점 · Q12(AC-LOG50) · 스트림 수** — 링크 주소는 서버 값 그대로(화면이 붙인 것은 `/logs`가 스스로 넣는 `container`뿐 — 화면 상태 파라미터)

| 진입점 | 링크 | 열린 뒤 따라가기 | 스트림 수 |
|---|---|---|---|
| 파드 목록 행 | `…&pod=api-…-wbf44&follow=1` | **켬** | 0 → **1** |
| Warning 이벤트 행 | `…&at=<lastSeenAt>` | **끔** | 0 → **0**, 앵커 `found` |
| 워크로드 상세 | `…&workload=Deployment%2Fbatch%2Freport-generator&follow=1` | **켬** | 0 → **1**, 워크로드 Select = 그 키, 파드 = 서버 목록 첫 파드 |
| DB 파드 | `…&pod=postgres-0&follow=1` | **켬** | 0 → **1** |
| 알림 항목 | `…&at=<occurredAt>` | **끔** | 0 → **0**, 앵커 `before_result` |
| 사이드바 `/logs` | `/logs` | **끔** | 0 |
| 화면을 떠나면 | — | — | 매번 **0으로** 돌아옴 |

**C2. 컨트롤 플레인(SSE 링크, 폴백 없음)**: 매트릭스 로그 버튼 **15개** = REST `GET /api/cluster/control-plane`의 링크 15개와 **주소 일치**, 전부 `follow=1`. 단위 테스트: 서버 링크를 `null`로 바꾼 스냅샷이면 버튼 **0개**(화면이 `podKey`로 만들지 않는다).

**C3. AC-LOG13(파드 상세)**: 접힘 스트림 **0** → `로그 보기` **1** → `로그 닫기` **0**. 펼치면 가림 경고 1개. `로그 화면에서 열기` 주소 = 서버 `pod.logHref`(`…&follow=1`) 그대로.

**C4. AC-LOG16**(`logs=direct`, 초당 1~3줄): 위로 올림 → `새 줄 1개` → 5초 뒤 **`새 줄 8개`**(계속 늘어남), 스위치 **켬**, 스트림 **1**. `End`로 맨 아래 → 바로 `새 줄 1개`(8 → 0 → 그 사이 1줄 도착), 4초 뒤 `6개` — **N만 0으로 돌아가고 자동 스크롤은 꺼진 채**(켜졌다면 0에 머문다).

**C5. RL1 멈춤 화면**(mock 시간 단축 시나리오)

| 시나리오 | 결과 |
|---|---|
| `stream-notice` | 10초 뒤 info `초당 상한(2000줄)으로 151줄이 생략됐습니다.` + 본문 생략 줄 1개. **연결 유지**(스위치 켬, 스트림 1), 상태 줄 `… · 초당 상한으로 151줄 생략 · … · 스트림 1/3` |
| `idle-pause` | **20초**에 `이 화면이 20초 동안 보이지 않아 따라가기를 멈췄습니다.` · 스위치 **끔** · 스트림 **0**(화면이 `close`) · 받은 줄 528줄 **유지** · 닫기 버튼 0 → `다시 시작` → 스위치 켬·스트림 1·안내 사라짐 |
| `max-duration` | **30초**에 `연결을 30초마다 끊습니다(서버 보호).` · 스위치 끔 · 스트림 0 · 542줄 유지 · 닫기 0 → `다시 시작` → 켬·1 |

**C6. AC-LOG51 (`logs=flood`, 초당 1,600줄)**

| 확인 | 결과 |
|---|---|
| 위로 올려 읽는 중 | **10초 뒤** `읽던 줄이 지워지지 않게 따라가기를 멈췄습니다.` + `화면에 담을 수 있는 2만 줄이 찼습니다. …`(`role="status"` 1개) |
| 읽던 자리 | 멈추기 전·후 **첫 줄 id(`ls_…:3833`)·scrollTop(86,642) 동일** — 지워지지 않았다 |
| 연결 | 스위치 **끔**, 스트림 **0**, 상태 줄 `20,000줄 · 가림 529건`, `새 줄 15,500개` 버튼 남음 |
| `다시 시작` | 스위치 켬 · 스트림 1 · 맨 아래 |
| 맨 아래에서 자동 스크롤 중(17초) | 멈추지 않음(스위치 켬·스트림 1·멈춤 안내 0), `20,000줄`, 맨 위에 `이전 줄은 화면에서 지워졌습니다` |

**C7. AC-LOG52 (그 시각)**

| 확인 | 결과 |
|---|---|
| 알림 링크(18분 전) | 요청 `anchorAt` 있음·`range` **없음**·`limit 500` → `before_result` + `그 시각의 줄은 가져온 500줄보다 앞에 있습니다. 줄 수를 늘려 다시 조회하세요.` + **`2,000줄로 다시 조회`** 버튼, 목록 맨 위 구분 줄 `그 시각 06:42:32의 줄은 이보다 앞이라 가져오지 못했습니다` |
| 버튼 | 요청 `limit 2000` + 같은 `anchorAt` → **`found`**, 서버가 지목한 줄(`q-…:747`)에 `data-anchor="true"`, 본문 안(위에서 121px — 360px 본문의 1/3 지점 100px + 구분 줄 20px), 구분 줄 `그 시각 06:42:32` |
| 이벤트 링크 | `found`, 칩 `그 시각 07:15:48`, 기간 `그 시각 기준` |
| 따라가기 켬 | URL 에서 `at` 사라짐, 앵커 줄 0, 칩 0, 스트림 **1** |
| 스트림 수 | 앵커로 여는 동안 **0**(정지 조회) |

**C8. AC-LOG53 (`logs=stack`, `prod`에 워크로드 4개)**: `Deployment/prod/api` → 요청 `selector.workload {Deployment, api}` → `resolvedPods` 3개 = `GET /api/cluster/pods?workload=` 3개와 **일치**, 줄의 파드 3종 전부 그 안(**다른 워크로드 줄 0**), 선택기 `파드: 3개`, 접두 열 표시. 하나를 빼면 요청이 `pods: [2개]`로 바뀜.

**C9. 그 밖**

| 확인 | 결과 |
|---|---|
| 사라진 파드(S3) | 해제된 `worker-5d1f…` 알림의 링크 → `이 파드는 더 이상 존재하지 않습니다` — **mock 에 여전히 있다**(backend 가 최신 알림만 실제 파드로 바꿨다) |
| 조용한 파드 + 따라가기 + 찾기 `Enter` (우회 삭제 뒤) | 찾은 줄(맨 위)에 머묾, `새 줄 1 → 3 → 8개`, 스위치 켬 — **통합 2차에 본 "바닥으로 끌려감"이 다시 나지 않는다** |
| `logs=disabled` | 파드·이벤트·노드·DB 화면의 `/logs` 링크 **0**, 파드 상세 `로그` 섹션 0, 사이드바 항목 0 — 전부 서버 `null`에서 온 결과(화면은 따로 판단하지 않는다) |
| 하이드레이션(프로덕션 빌드) | 10개 경로 × 2회 **0건**(파드·노드·이벤트·워크로드·DB·알림·개요·설정·로그·파드 상세) |
| 360px | `/logs`·`/logs?…&at=`·`/cluster/pods`·`/cluster/events`·`/settings` 가로 스크롤 없음 |

**하지 못한 검증**

- **실제 클러스터·실제 Loki 없음**. 전부 mock 이다. `stack`에서 **따라가기로** 워크로드를 열 때 `log.hello`의 `selector.pods`로 선택기를 채우는 경로는 코드만 확인했다(정지 조회 경로만 브라우저로 봤다).
- 줄 바꿈을 켠 상태의 앵커 1/3 정밀도(publisher RL10)는 보지 않았다.
- `log.closing`의 `source_error`·`shutdown`(warn 멈춤)과 `onerror` 끊김은 mock 이 만들지 않아 화면으로 보지 못했다(단위 테스트로 종류·톤만).
- 스크린리더 실물 낭독.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL1·RL2·RL6 | **해결**(1차 이슈): 멈춤 안내 3종 화면 확인, 워크로드 선택기·합쳐보기, 링버퍼 2만 줄까지 채워 확인 |
| RL7·RL8 | **해결**: `revealLine` 삭제(컴포넌트가 스크롤), 플래그 우회 삭제 |
| RL9 | 파드 목록 행의 `로그`가 hover 아이콘이 아니라 항상 보이는 버튼이다(L15) — publisher 요청 |
| RL10 | 파드 상세 `로그 화면에서 열기`가 고른 컨테이너를 넘기지 않는다(L16) — designer 확인 |
| RL11 | `LOG_REDACTED` 안내(`가림 39건`)가 하단 상태 줄의 `가림 39건`과 겹쳐 두 번 보인다. 1차부터 있던 모양이다(서버 notice 를 그대로 그린다). 하나를 뺄지는 designer 판단 |
| RL12 | 멈추면 URL 의 `follow=1`도 뗀다(`onFollowChange(false)` — 스위치와 URL 이 같은 말을 하게). 그래서 멈춘 화면을 새로고침하면 정지 조회로 열린다. 같은 진입점 링크를 다시 누르면 따라가기로 열린다(링크의 뜻 그대로) |

### 8. 다른 담당 요청

**publisher 요청**
1. `ResourceName`에 `logHref`(행 hover·focus 때 복사 버튼 다음 `scroll-text` 아이콘 링크, `ComponentMatrix.cells[].logHref`와 같은 방식). 디자인 0절 3. 지금은 이름 칸에 항상 보이는 `로그` 버튼이다.

**designer 확인 요청**
1. 파드 상세 `로그 화면에서 열기`는 서버 `pod.logHref` 그대로라 **고른 컨테이너가 넘어가지 않는다**(디자인 9절은 `container=`를 붙인다). PM 제약(파라미터를 덧붙이지 않는다)을 따랐다. 문서를 맞출지, 서버 링크에 컨테이너를 받을 자리를 둘지 판단 필요.
2. `LOG_REDACTED` 안내 줄과 하단 상태 줄 `가림 N건`이 겹친다(RL11).

**backend 참고(조치 불필요)**: `logs=stack`에서 워크로드를 **따라가기로** 열면 화면은 `log.hello.selector.pods`를 서버가 푼 파드로 읽는다. 계약에 `hello.selector.resolvedPods`로 적어 주면 정지 조회와 이름이 같아진다(지금은 `selector.pods`에 들어 있다).

### 9. 다음 담당이 알아야 할 점

1. **로그 링크를 화면에서 만들지 마라.** `href.ts`에는 읽기만 남았다. 새 진입점은 서버 `logHref` 필드를 받아 `LogLink`에 넘기면 끝이다. 컨트롤 플레인 폴백을 되살리면 `LOG_DENY_NAMESPACES`가 한쪽만 먹는다.
2. **연결이 닫히는 길은 `useLogStream`의 `halt()` 하나다.** 새 이벤트를 받으면 거기로 보낸다. 멈춘 조회는 `keepKey`로 지키므로, `keepKey`를 지우지 않고 정지 조회를 부르면 받은 줄을 덮어쓴다.
3. **링버퍼 숫자는 `RING_MAX_LINES` 하나다.** 멈춤 안내 문구는 `ringLimitText()`로 만든다.
4. **스크롤을 옮기는 것은 `LogLineList`다**(`follow`·`anchor`·`currentMatch`). 화면은 자동 스크롤 켜고 끄기(`scrollAnchor`)만 정한다.
5. `at`이 있으면 `range`를 보내지 않는다(사용자가 기간을 고르기 전까지). 스트림 요청에서는 `anchorAt`을 뺀다.
6. mock 시간 단축 시나리오는 `PUT /api/mock/scenarios/logs {"scenario":"idle-pause"}` 등으로 바꾼다. 끝나면 `direct`로 되돌린다.

## 2026-09-25 08:05 · 마지막 배선 (5f — 파드 표 아이콘 링크 · 컨테이너 유지 · 안내 줄 정리)

> 정본: `docs/reports/logs/README.md` "3차에서 올라온 것 — PM 결정" 4~8, 5e 행들. 배경: `docs/reports/logs/designer.md` "추가 4"(E2·E3·E5), `docs/reports/logs/publisher.md` 07:55.
> **이 섹션이 5f 공통 검증 명령의 정본이다.** 설정 4.2 확인은 `docs/reports/alerts/frontend.md` 같은 이름 섹션.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| 1 | 파드 표 4곳(목록·워크로드 소속·노드 상세·DB 파드)의 글자 `LogLink`를 **`ResourceName logHref={row.logHref}`**로(components.md 21.10). Warning 이벤트 행은 글자 링크 그대로 | 완료 |
| 2 | 파드 상세 `로그 화면에서 열기` = 서버 `logHref` + **`container` 하나만**(PM 결정 4). 링크 가능 여부는 여전히 `logHref` 유무 | 완료 |
| 3 | `LOG_REDACTED`·`LOG_DROPPED_LINES` 안내 줄을 그리지 않는다(숫자는 하단 상태 줄 한 곳) | 완료 |
| 4 | 스트림 `hello.selector.resolvedPods` — 두 갈래(`pods`·`resolvedPods`)면 `resolvedPods` 하나로 | 완료(3차의 `selector.pods` 읽기를 지웠다) |
| 5 | publisher 의 `Button` 비활성 사유 위치 변경 뒤 전체 테스트 재확인 | **636 passed**, `features/**` 수정 필요 0건 |
| 6 | `settings.md` 4.2 새 문장과 구현이 맞는지 | 맞다(alerts 보고서) |

### 2. 참고한 문서

- `docs/reports/logs/README.md` 5e·5f 행, "3차에서 올라온 것 — PM 결정"
- `docs/reports/logs/designer.md` "추가 4" E2(파드 표 `로그` = 아이콘 링크, 이벤트 행만 글자)·E3(`가림`·`생략` 숫자는 상태 줄 한 곳)·E5(`container` 허용)
- `docs/design/components.md` **21.10** `ResourceName.logHref`, `docs/design/logs.md` 0절·6.2·7.5·9절
- `docs/reports/logs/publisher.md` 07:55, `docs/api/logs.md` 2.3.1·7절(`hello.selector.resolvedPods`)

### 3. 작업 내용

- **파드 표 4곳**: 공용 `podColumns`의 이름 칸(파드 목록·워크로드 상세 소속 파드·노드 상세 파드가 함께 쓴다)과 DB 파드 표가 `ResourceName`에 `logHref`를 넘긴다. 보이는 조건(hover·행 포커스·터치 항상)과 행 클릭 차단은 **컴포넌트**가 한다. 3차에 넣은 글자 `로그` 버튼은 지웠다. `LogLink`는 이제 Warning 이벤트 행(그 시각을 보러 가는 링크)과 워크로드 상세의 **워크로드** 링크(파드 표가 아니다)에만 쓴다.
- **`로그 화면에서 열기`**: `withContainer(pod.logHref, 펼친 뷰어의 컨테이너)` — `href.ts`에 한 곳. `container`만 `set`하고 서버 파라미터(`follow=1`)는 손대지 않는다. 섹션을 그릴지는 그대로 `pod.logHref` 유무.
- **안내 줄**: `LogViewer`가 `COUNTED_IN_STATUS_LINE = ["LOG_REDACTED", "LOG_DROPPED_LINES"]`을 안내 줄에서 거른다. 숫자는 하단 상태 줄(`가림 N건 · 초당 상한으로 N줄 생략`)에만 있다. 본문의 생략 줄(`— 초당 상한으로 N줄 생략됨 … —`)은 그대로 — 그것은 **어디서** 빠졌는지를 말하는 줄이다.
- **`resolvedPods`**: `useLogStream`이 `log.hello`의 `selector.resolvedPods`만 읽는다. 조회 응답과 이름이 같아져 한 갈래가 됐다. `LogHelloPayload.selector` 타입도 조회 응답과 같은 `LogResolvedSelector`로.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/cluster-status/shared.tsx` | 수정 | 파드 이름 칸 → `ResourceName logHref` (글자 버튼 삭제) |
| `apps/web/src/features/cluster-status/DbPage.tsx` | 수정 | 같음, `LogLink` import 삭제 |
| `apps/web/src/features/logs/href.ts` | 수정 | `withContainer()` 추가 |
| `apps/web/src/features/logs/PodLogsSection.tsx` | 수정 | `로그 화면에서 열기`에 `container` |
| `apps/web/src/features/logs/LogViewer.tsx` | 수정 | `COUNTED_IN_STATUS_LINE` 거르기 |
| `apps/web/src/features/logs/useLogStream.ts` · `types.ts` | 수정 | `hello.selector.resolvedPods` 하나로 |
| `apps/web/src/features/logs/LogLink.tsx` | 수정 | 쓰는 곳 주석(파드 표는 쓰지 않는다) |
| `apps/web/src/features/logs/logs.test.tsx` | 수정 | +2(`withContainer`, `LogViewer` 렌더로 두 안내가 안내 줄에 없고 상태 줄에만 있는지) |
| `apps/web/src/features/pages.test.tsx` | 수정 | 파드 행 링크 테스트를 아이콘 링크(`rn-log-link`, 이름 `api-… 로그 보기`)로 |

### 5. 주요 결정과 이유

| # | 결정 | 이유 |
|---|---|---|
| F1 | `container`는 **펼친 뷰어가 실제로 보여 주는 컨테이너**(사용자가 고른 값, 없으면 서버 기본값)를 붙인다. 접혀 있으면(대상 조회 전) 붙이지 않는다 | "같은 컨테이너로 열린다"가 목적이다. 서버 기본값을 붙여도 로그 화면이 고르는 값과 같아 결과가 달라지지 않는다 |
| F2 | 안내 줄 거르기는 **코드 두 개를 이름으로** 적는다(상태 줄에 숫자가 있는 것) | designer E3 가 코드 목록을 이 둘로 정했다. 화면이 "숫자가 있는 안내"를 추측해 넓히지 않는다 |
| F3 | 워크로드 상세의 **워크로드** 링크는 글자 `로그` 그대로 | 지시의 4곳은 **파드 표**다. 워크로드 링크는 표의 행이 아니라 펼친 영역의 동작 링크라 21.10 대상이 아니다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과** | |
| `npx tsc --noEmit` (apps/web) | **통과** | |
| `npm test --prefix apps/web` | **636 passed (27 files)** | publisher 634 + 내 +2. publisher 의 `Button` 사유 이동으로 `features/**`에서 고칠 테스트 **0건**(내 테스트는 `getByRole({name})`을 쓰는 곳이 버튼 이름 정확 일치라 영향 없음). 파드 행 링크 테스트 1건은 **이번 지시로** 바꿨다 |
| `NEXT_DIST_DIR=.next-fe4 npx next build` | **통과** | 끝난 뒤 삭제 |
| 브라우저 (Playwright + Edge, **프로덕션 빌드** :3143 / mock API :3144) | 아래 | API 는 `apps/api` 최신 소스를 스크래치 폴더로 컴파일(`hello.selector.resolvedPods` 포함 확인) |

| 확인 | 결과 |
|---|---|
| 파드 목록 아이콘 링크 | 54행 모두 아이콘 1개, 글자 `로그` 버튼 **0**. 평소 `opacity 0` → 행 hover **1** |
| 키보드 | Tab 9번으로 행(`tr:focus-visible`)에 도착 → 아이콘 **opacity 1**. 행에서 Tab → `… 이름 복사` → Tab → **`api-qfvhtjhs2-wbf44 로그 보기`**(21.10 접근 이름) |
| 터치(`hover: none`) | 항상 **opacity 1** |
| 아이콘 클릭 | `/logs?namespace=prod&pod=…&follow=1`로 이동 — **파드 상세로 가지 않았다**(행 클릭이 번지지 않음). 따라가기 **켬**, 스트림 0 → **1**(Q12) |
| 다른 표 | DB 파드 아이콘 2(글자 0) · 노드 상세 3 · 워크로드 펼침 소속 파드 1(+ 워크로드 글자 링크 1) · **이벤트 행 아이콘 0 / 글자 링크 4** |
| 컨테이너 유지 | 접힘: `…&follow=1`(서버 값 그대로) → 펼쳐 `fluent-bit` 선택 → `…&follow=1&container=fluent-bit` → 로그 화면에서 **`fluent-bit` 선택됨**, 따라가기 켬 |
| 안내 줄(`logs=stream-notice`) | 폭주 뒤 안내 줄은 가림 경고·노드 미보고 **2개뿐**(`초당 상한…`·`가림 N건` 안내 **0**). 상태 줄 `2,514줄 · 가림 39건 · 초당 상한으로 151줄 생략 · … · 스트림 1/3`, 본문 생략 줄 1 |
| stack 워크로드 **따라가기**(`hello.selector.resolvedPods`) | 선택기 `파드: 3개`, 따라가기 켬, 스트림 1 — 3차에 "코드로만 확인"이던 경로를 이번에 봤다 |

**하지 못한 검증**: 실제 터치 기기(에뮬레이션 `hasTouch`로 `hover: none`만 확인), 스크린리더 실물 낭독, 실클러스터.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL9·RL10·RL11 (3차) | **해결** — 파드 행 아이콘 링크, `container` 유지, `가림 N건` 중복 |
| RL13 | 파드 목록에서 키보드로 행을 지나 **오른쪽 열의 버튼**(노드 이름 복사 등)에 가면 표가 가로로 밀린다(표 영역 안 가로 스크롤). 브라우저의 포커스 따라가기 동작이고 이번 변경과 무관하다 — 참고로만 적는다 |

### 8. 다른 담당 요청

없음.

### 9. 다음 담당이 알아야 할 점

1. **파드 표에서 로그로 가는 링크는 `ResourceName.logHref` 하나다.** 새 파드 표를 만들면 이름 칸에 `logHref={row.logHref}`만 넘긴다. 글자 버튼을 다시 두지 않는다.
2. 로그 링크에 화면이 덧붙일 수 있는 것은 **파드 상세의 `container` 하나**(`withContainer`)뿐이다. `follow`·`at`·그 밖의 파라미터는 서버 규칙이다.
3. 숫자가 하단 상태 줄에 있는 안내(`LOG_REDACTED`·`LOG_DROPPED_LINES`)는 안내 줄로 그리지 않는다. 새 코드가 같은 성질이면 `COUNTED_IN_STATUS_LINE`에 더한다 — 추측으로 넓히지 말고 designer 판단을 받는다.

## 2026-09-25 11:30 · live 경로 정리 후 화면 확인

> 앞선 frontend 세션이 세션 한도로 끊겨 이어받았다(코드 작업은 이 섹션에서 시작). 정본: `docs/reports/logs/README.md` "검증에서 드러난 live 경로 어긋남 7건 — PM 결정"과 "결과 (backend 09:05)", `docs/reports/logs/backend.md` 09:05 섹션 8절 frontend 항목, **작업 중 도착한 designer 09:40 확정**(`docs/design/logs.md` 7.4 "시작 전 대기" 표 · 8.1 · 8.4).

### 1. 요청 내용

| # | 확인 항목 (PM) | 결과 |
|---|---|---|
| 1 | 새 mock 시나리오 `container-starting`·`stack-auth-failed`·`stack-rejected`·`kubelet-unreachable` + 기존 `stack-down`을 브라우저(Playwright + Edge)로 확인. 각 안내가 **서버 문구 그대로** 보이는지 | 확인 — 전부 서버 `text` 그대로(아래 6절 표) |
| 2 | 스택 실패에서 `직접 조회로 전환` 동선이 살아 있고 **자동으로 바뀌지 않는지** | 동선은 출처 줄(`SegmentedControl`)로 살아 있었으나 **8.4의 전환 버튼이 없었다** → 추가(3-(4)). 자동 전환 없음 확인 |
| 3 | `container-starting`에서 따라가기가 켜진 채 약 30초 뒤 줄이 붙는지(멈춤 안내 없음, 스위치 켜진 채) | 붙었다(스위치 켬·스트림 1·`다시 시작` 0). 다만 **줄이 온 뒤에도 대기 안내가 남아 있었다** → 첫 `log.lines`에 내리게 고침(3-(1)) |
| 4 | `LOG_EMPTY`가 다른 안내와 겹쳐 뜨지 않는지 | 겹치지 않는다(서버가 붙이지 않는다). `empty`·`empty`+이전 세대·스택 실패·kubelet·시작 전 전부 `LOG_EMPTY` 0 |
| 5 (designer 09:40, PM 추가) | 스트림 `LOG_CONTAINER_NOT_STARTED` = `InlineAlert` info compact `live`, 닫기·action 없음, 본문 비움, 스위치 켠 채 | `live`·본문 비움이 없었다 → 고침(3-(1)) |
| 6 (designer) | 정지 조회 `LOG_CONTAINER_NOT_STARTED` = 본문 한 줄(서버 문구), `Spinner` 없음, 자동 재조회 없음 | 안내 줄 + 화면 기본 문구(`아직 아무것도 출력하지 않았습니다`)였다 → 본문 한 줄로(3-(2)). Spinner·자동 재조회는 원래 없었다 |
| 7 (designer) | 같은 `code`의 `log.notice` + `log.closing`이면 멈춤 안내 하나만 | `kubelet-unreachable` 따라가기에서 **같은 문구가 두 번**(멈춤 안내 + 안내 줄) → 고침(3-(3)) |
| 8 (designer) | `직접 조회로 전환` 버튼은 `details.fallbackSource === 'direct'`일 때만. `LOG_BACKEND_QUERY_REJECTED`는 warn compact + `details.reason`, 버튼 없음 | 구현(3-(4)·(5)). `details.reason`은 전에 화면에 나오지 않았다 |

### 2. 참고한 문서

- `docs/api/logs.md` 6절(안내 코드 표 — mock = live, `details.fallbackSource`·`details.reason`), 7절(스트림 대기 — 닫지 않는다, 첫 `log.lines`가 늦게 온다), 9절(mock 4행)
- `docs/design/logs.md` 7.4 "시작 전 대기" 행 + "시작 전 대기 안내" 표, 8.1(정지 조회 문구·`Spinner` 삭제), 8.4(전환 버튼 조건·`QUERY_REJECTED` 모양), 8.7, 14절, 15절 `container-starting` 행
- `docs/reports/logs/backend.md` 09:05 (3)·(5)·(6)·8절, `docs/reports/logs/designer.md` 09:40 8·9절
- 이 파일 07:40(화면 구조·`onHalt`·`keepKey`)·08:05(`COUNTED_IN_STATUS_LINE`)

### 3. 작업 내용

먼저 코드를 바꾸지 않은 채 5개 시나리오를 브라우저로 돌려 어긋남을 모았고(6절 "고치기 전"), 그 다음 최소한으로 고쳐 다시 돌렸다.

**(1) 스트림 시작 전 대기 — 멈춤 안내가 아니다** (`useLogStream.ts`·`LogViewer.tsx`)
- `useLogStream.apply`: `log.lines`가 오면(빈 배치여도 — 붙었다는 뜻이다) `notices`에서 `LOG_CONTAINER_NOT_STARTED`를 뺀다. 서버는 "내려라"를 따로 보내지 않고 첫 `log.lines`가 그 신호다(계약 7절). 상수 `CONTAINER_NOT_STARTED`를 훅에서 내보낸다.
- `LogViewer`: `waitNotice = follow && !shownHalt ? notStartedNotice : null` → `InlineAlert tone="info" compact live`(닫기·action 없음), 자리는 멈춤 안내 바로 다음(둘은 같이 뜨지 않는다 — 기다리는 중 유휴·30분에 걸리면 `shownHalt`가 생겨 대기 안내가 멈춤 안내로 **바뀐다**). 본문 `emptyText`는 빈 문자열(8.1 한 줄·스켈레톤·Spinner 없음). 스위치는 훅이 `halt`를 부르지 않으므로 켜진 채다(원래 그랬다).

**(2) 정지 조회 시작 전** — `notStartedLine = !follow && !shownHalt ? notStartedNotice : null` → `LogLineList.emptyText`에 서버 `text` 그대로(`LOG_WORKLOAD_NO_PODS`와 같은 자리·같은 방식). 안내 줄로는 그리지 않는다. 자동 재조회·Spinner 없음.

**(3) 같은 코드의 `log.notice` + `log.closing`** — `plainNotices`에서 `n.code === shownHalt?.code`를 뺀다. `kubelet-unreachable` 따라가기: 멈춤 안내(warn compact + `다시 시작`) 하나만.

**(4) 출처 실패 전환 버튼 (8.4)** — 안내의 `details.fallbackSource === 'direct'`이고 그 출처가 `selectable`이며 지금 출처가 아니면: `InlineAlert warn`(compact 아님) + `description` = `직접 조회로 바꾸면 지난 로그 검색과 기간 선택을 쓸 수 없습니다.`(`FALLBACK_DESCRIPTION`, 디자인 8.4의 "무엇을 잃는지" 한 줄) + `action` = `Button secondary sm` **`{서버 label}로 전환`**(= `직접 조회로 전환`, 라벨은 `capabilities.sources`의 `label`). 누르면 `onSourceChange('direct')` — 기존 출처 줄 클릭과 같은 길(URL `source=direct` → 뷰어 재시작). **자동 전환 없음**(AC-LOG42).

**(5) `details.reason`** — 안내에 문자열 `details.reason`이 있으면 compact 한 줄에 `${text} (${reason})`. 서버가 가림 처리한 값을 그대로 붙인다(디자인 8.4 "한 줄로"; 괄호 표기는 8.4 예시 `연결할 수 없습니다 (연결 거부)`와 같은 꼴). `LOG_BACKEND_QUERY_REJECTED`에는 `fallbackSource`가 없어 버튼이 없다 — 화면이 코드로 고르지 않는다.

**(6) 본문 비우기** — 줄 0개인데 **조회·스트림 안내**(`stream.state.notices`)에 `warn`/`error`가 있으면 `emptyText`를 비운다(디자인 8.4 "본문 영역은 비운다"). 대상 안내(`targets.notices`, 예: 노드 미보고)는 세지 않는다 — `empty` 시나리오에서 `LOG_EMPTY`(info) + 노드 미보고(warn)가 함께 와도 8.1 한 줄이 그대로 남는다(확인). 전에는 스택 실패·kubelet에서도 `이 컨테이너가 아직 아무것도 출력하지 않았습니다.`가 떠 사실이 아니었다.

**(7) 테스트 +3** (`logs.test.tsx`): 스택 실패 → 전환 버튼·설명·`onSourceChange('direct')`는 클릭 때만·본문 비움 / 쿼리 거부 → `text (reason)` 한 줄·전환 버튼 없음 / 정지 조회 시작 전 → 본문 한 줄(`emptyLine`)·안내 줄 없음·`다시 시작` 없음·`role=status` 없음.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/logs/useLogStream.ts` | 수정 | `CONTAINER_NOT_STARTED` 상수, `apply`에서 `log.lines`가 오면 대기 안내 제거 |
| `apps/web/src/features/logs/LogViewer.tsx` | 수정 | `waitNotice`(info compact live) · `notStartedLine`(본문 한 줄) · 멈춤 코드와 같은 안내 제거 · `fallbackSource` 전환 버튼 + `FALLBACK_DESCRIPTION` · `details.reason` 한 줄 · warn 안내면 본문 비움 · 머리 주석 한 줄 |
| `apps/web/src/features/logs/logs.test.tsx` | 수정 | +3건 (위 (7)) |

`components/ui/**`·`apps/web` 루트 설정은 손대지 않았다(`tsconfig.json`은 dev 서버가 넣은 include 줄을 `git checkout`으로 되돌렸다).

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 이유 |
|---|---|---|---|
| G1 | 대기 안내를 내리는 신호는 **첫 `log.lines`**(빈 배치 포함), 훅이 코드 이름으로 뺀다 | 서버가 "내려라" notice를 보내게 backend 요청 / 화면이 줄 수 > 0로 판단 | 계약 7절이 "시작되면 그때 `log.lines`가 오기 시작한다"로 정했고 backend 8절도 "줄이 오면 안내를 내린다"다. 빈 배치라도 붙은 것이므로 "시작 전"은 거짓이 된다. 코드 이름 하나를 훅이 아는 것은 `COUNTED_IN_STATUS_LINE`과 같은 성격(문구 번역이 아니라 자리·수명 규칙) |
| G2 | 정지 조회의 시작 전은 **본문 한 줄**(안내 줄 아님), 스트림은 **안내 줄 + 빈 본문** | 둘 다 안내 줄 | designer 8.1이 정지 조회를 `LOG_EMPTY`와 같은 모양(본문 한 줄)으로, 7.4가 스트림을 대기 안내 표로 정했다. 문구는 둘 다 서버 `text`라 화면이 문장을 갖지 않는다 |
| G3 | 전환 버튼 라벨은 서버 `label` + `로 전환`, 설명 한 줄은 화면 상수 | 라벨도 하드코딩 / 설명을 `direct.limitations.summary`에서 | 라벨은 출처 이름이라 서버 값을 쓰는 게 맞다. 설명은 "버튼을 누르면 무엇을 잃는가"라는 **화면 동작의 설명**이라 디자인 8.4 문장을 그대로 뒀다(링버퍼 멈춤 문구와 같은 예외 — 머리 주석에 적었다) |
| G4 | 본문 비움 판단은 **조회·스트림 안내의 level**(warn/error)로, 코드 목록이 아니다 | 코드 목록(`LOG_BACKEND_*`·`KUBELET`) / 모든 warn(대상 안내 포함) | 코드 목록은 계약에 코드가 늘 때마다 화면을 고쳐야 한다. 대상 안내까지 세면 `empty`에서 노드 미보고 때문에 8.1 한 줄이 사라진다 |
| G5 | 멈춤 코드와 같은 안내만 뺀다(코드 비교) | 멈추면 안내를 전부 숨김 | 멈춤과 무관한 안내(가림·컨트롤 플레인 상시 안내)는 남아야 한다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과** (0 error, 0 warning) | 중간에 테스트 헬퍼의 미사용 인자 경고 1건 → 고침 |
| `npx tsc --noEmit -p apps/web` | **통과** | |
| `npm test --prefix apps/web` (vitest) | **639 passed (28 files)** | 08:05의 636 + 이번 3 |
| `NEXT_DIST_DIR=.next-fe5 npx next build` | **통과** | 끝난 뒤 `.next-fe5`·`.next-fe5dev` 삭제, `tsconfig.json` 되돌림 |
| 브라우저 (Playwright + Edge headless, 1440×900) | 아래 | 웹 **:3143**(dev), mock API **:3144** — `apps/api` 최신 소스를 스크래치 폴더(`api-dist6`)로 `tsc` 컴파일해 `NODE_PATH`로 띄움(backend의 `dist`·3141은 건드리지 않았다). `CORS_ORIGIN=http://localhost:3143` 필요(기본 3000). 끝난 뒤 **내가 띄운 PID만**(node 29336·23632·9200·12860 + 래퍼 cmd/bash/nohup) `Stop-Process -Id`로 종료, 포트 비어 있음 확인 |

**고치기 전** (같은 스크립트, 코드 변경 없이): ① 스택 실패 3종 — 서버 문구는 그대로였지만 전환 **버튼 없음**(출처 줄 클릭으로만 전환 가능), `details.reason` **표시 안 됨**, 본문에 `이 컨테이너가 아직 아무것도 출력하지 않았습니다.` ② `kubelet-unreachable` 따라가기 — 같은 문구가 **2번**(멈춤 안내 + 안내 줄) ③ `container-starting` 따라가기 — 스위치 켬·스트림 1·30초 뒤 줄 붙음은 맞았지만 **줄이 온 뒤에도 대기 안내가 남음**(t=33s `502줄`인데 안내 그대로), `live` 아님, 본문에 화면 기본 문구 ④ `LOG_EMPTY` 겹침 **없음**(맞았다).

**고친 뒤** (`fe6-check.mjs` · 시나리오는 `PUT /api/mock/scenarios/logs`로 바꾸고 끝에 `direct`로 되돌림):

| 시나리오 | 결과 |
|---|---|
| `stack-down` | 출처 `로그 스택 (Loki)` **유지**(자동 전환 없음), warn 2줄 `로그 스택에 연결하지 못했습니다.` + `직접 조회로 바꾸면 …` + **`직접 조회로 전환`** 버튼, 본문 빈 채(`0줄`), `LOG_EMPTY` 0, 스트림 0. 버튼 클릭 → URL `source=direct`, `500줄 · 가림 39건`, 안내 사라짐 |
| `stack-auth-failed` | 같은 모양, 문구 `로그 스택 인증에 실패했습니다. 토큰 또는 계정 설정을 확인하세요.`(서버 그대로, 토큰 값 없음) + 버튼. 클릭 → `direct` 500줄 |
| `stack-rejected` | warn compact **한 줄** `로그 스택이 요청을 거부했습니다. (max entries limit per query exceeded, limit > max_entries_limit (5000 > 1000))`, **전환 버튼 0**, 출처 줄 정상(`stack` 선택 가능), 본문 빈 채. 출처 줄 `직접 조회` 클릭으로 전환은 여전히 된다 |
| `kubelet-unreachable` 정지 조회 | warn compact `노드에 연결할 수 없어 로그를 읽지 못했습니다.`, 본문 빈 채, `LOG_EMPTY` 0 |
| `kubelet-unreachable` 따라가기 | 멈춤 안내 **하나만**(`노드에 연결할 수 없어 … + 다시 시작`), 스위치 **끔**, 스트림 0 — 같은 문구의 안내 줄 없음 |
| `empty` / `empty`+이전 세대 | `이 기간에 출력된 로그가 없습니다.` 하나 / `이전 세대 로그가 없습니다.` 하나(`LOG_EMPTY` 없음). 두 경우 본문 8.1 한 줄 `이 컨테이너가 아직 아무것도 출력하지 않았습니다.` 그대로(노드 미보고 warn이 같이 있어도) |
| `container-starting` 정지 조회 (t=2.4s) | 본문 한 줄 **`컨테이너가 아직 시작되지 않았습니다. 따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.`**, 안내 줄 0, 스피너 0, 스위치 끔 |
| `container-starting` 따라가기 (t=4.8s·27.4s) | 안내 **`컨테이너가 아직 시작되지 않았습니다. 시작되면 자동으로 표시됩니다.`**(`role=status` 1), 스위치 **켬**, 스트림 **1**, `다시 시작` 0, 본문 빈 채, 상태 줄 `0줄 · 11:27:54부터 · 스트림 1/3` |
| `container-starting` 따라가기 (t=33.1s·36.2s) | 안내 **내려감**(`role=status` 0), `502줄 → 506줄` 계속 붙음, 스위치 켬, 스트림 1, 멈춤 안내 0 |
| 대기 중 스위치 끔 → 켬 (`fe6-toggle.mjs`) | 끔: 정지 조회 문구 본문 한 줄, 스트림 0 → 켬: 대기 안내(`live`) 복귀, 스트림 1 (디자인 15절 행 그대로) |
| 파드 상세 `로그 보기`로 열기 | 같은 모양(대기 안내 `live` 1, 스위치 켬, 스트림 1) |
| 마무리 | 스트림 0, 콘솔 오류 0 |

**하지 못한 검증**: 실클러스터·실제 Loki(전부 mock). 기다리는 중 유휴·30분에 걸려 대기 안내가 멈춤 안내로 바뀌는 경우는 mock이 두 시나리오를 동시에 주지 않아 코드로만 확인(`waitNotice`는 `shownHalt`가 있으면 `null`). 스크린리더 실물 낭독.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL14 | `empty`에서 `LOG_EMPTY` 안내 줄(`이 기간에 출력된 로그가 없습니다.`)과 8.1 본문 한 줄(`이 컨테이너가 아직 아무것도 출력하지 않았습니다.`)이 **둘 다** 보인다. 1차부터 있던 모양이고 이번 지시 밖이라 두었다. 하나로 줄일지는 designer 판단(정지 조회 시작 전과 `LOG_WORKLOAD_NO_PODS`는 본문 한 줄만이다) |
| RL15 | `details.reason`이 길면(Loki 사유) compact 한 줄이 길어진다. 1440px에서는 한 줄 안에 들어왔고 줄 바꿈은 `InlineAlert`가 한다. 360px는 보지 않았다 |
| RL16 | 본문 비움 규칙(G4)은 level 기반이라, 줄이 있는 응답에 warn 안내가 붙어도 영향이 없다(`state`가 `ready`). 줄 0개 + warn인데 본문 한 줄이 필요한 코드가 생기면 그때 designer와 정한다 |

### 8. 다른 담당 요청

- **designer 확인 요청**: RL14 — `LOG_EMPTY`에서 안내 줄과 본문 한 줄이 함께 보이는 것을 그대로 둘지.
- backend·publisher: 없음(새 필드·새 컴포넌트 0).

### 9. 다음 담당이 알아야 할 점

1. **`LOG_CONTAINER_NOT_STARTED`는 자리가 두 곳이다.** 따라가기 중이면 `waitNotice`(안내 줄, `live`), 정지 조회면 `notStartedLine`(본문 한 줄). 문구는 둘 다 서버 `text`고 서로 다르다(정지 조회 문구는 "따라가기를 켜 두면"). 멈추면(`shownHalt`) 둘 다 그리지 않는다.
2. **대기 안내를 내리는 것은 훅이다** (`useLogStream.apply`, `log.lines`). `LogViewer`에서 다시 내리지 마라.
3. 전환 버튼은 **`details.fallbackSource`가 정한다.** 코드 이름으로 버튼을 붙이지 마라. 라벨은 `capabilities.sources[].label`.
4. `details.reason`이 있는 안내는 한 줄에 `(reason)`으로 붙는다 — 서버가 가림 처리한 값이라 화면이 다시 가리지 않는다.
5. 로컬 mock API를 다른 포트로 띄울 때 `CORS_ORIGIN`을 웹 포트로 줘야 한다(기본 `http://localhost:3000`).

#### 덧붙임 (11:45) · RL14 PM 결정 — `LOG_EMPTY`는 8.1 본문 한 줄만

- **결정**: `empty`에서 `LOG_EMPTY`는 디자인 8.1의 본문 한 줄(`이 컨테이너가 아직 아무것도 출력하지 않았습니다.`)만 보이고 안내 줄(`InlineAlert`)로는 그리지 않는다(같은 말을 두 곳에서 하지 않는다 — `가림 N건`·`생략 N줄`을 상태 줄 한 곳으로 모은 결정과 같은 결).
- **변경** (`apps/web/src/features/logs/LogViewer.tsx`): 상수 `LOG_EMPTY`를 두고 `plainNotices` 필터에 더했다(한 줄). 본문 한 줄은 기존 `emptyText` 기본값 그대로. `logs.test.tsx` +1(`LOG_EMPTY` → 본문 한 줄만, 안내 줄 0).
- **검증**: lint 통과 · `tsc --noEmit` 통과 · vitest **640 passed (27 files)** · 브라우저(`fe6-empty.mjs`, 웹 :3143 / API :3144 다시 띄움): `empty` → 안내 줄은 노드 미보고(대상 안내)뿐, 본문 `이 컨테이너가 아직 아무것도 출력하지 않았습니다.` 한 줄, `이 기간에 출력된 로그가 없습니다.` **0** / `empty`+이전 세대 → `이전 세대 로그가 없습니다.` 안내 하나 + 본문 한 줄(전과 같음) / `direct` → 500줄 정상. 끝난 뒤 내가 띄운 PID만 `Stop-Process -Id`로 종료(포트 비어 있음), `.next-fe5dev` 삭제, `tsconfig.json` 되돌림.
- 7절 RL14·8절 designer 확인 요청은 이 결정으로 **닫힘**.
- 다음 담당: 안내 줄에서 거르는 코드는 `COUNTED_IN_STATUS_LINE`·`LOG_EMPTY`·`CONTAINER_NOT_STARTED`·앵커·합쳐보기 4종이다. 새 코드를 더할 때는 designer/PM 결정을 먼저 받는다.
