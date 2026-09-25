# logs · publisher 작업 보고

> 파일 위치: `docs/reports/logs/publisher.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 22:20 · 로그 뷰어 컴포넌트 (alerts와 한 번에) (날짜 정정 2026-09-25)

> **`alerts`와 함께 한 번에 맡은 작업이다.** 사이드바(12항목·3단 flex)·설정 화면·기존 컴포넌트 확장 8건·검증 전체는
> **`docs/reports/alerts/publisher.md`가 정본**이다. 이 문서는 **로그 전용 컴포넌트 3개**와 그 판단만 적는다.

### 1. 요청 내용

PM 지시 중 로그 몫:

| # | 요청 | 결과 |
|---|---|---|
| A | `LogLineList`(가상 스크롤 + 인라인 가림 + sticky gutter), `CollapsibleNotice`(접어도 한 줄 요약) | 구현 |
| B | **`가림 N` 표식이 줄 바꿈을 끄고 가로로 끝까지 스크롤해도 사라지지 않을 것**(AC-LOG07). "가상 스크롤 + 가로 스크롤 + sticky 조합은 안 먹는 경우가 있으니 **긴 줄을 실제로 만들어 확인**하라"(planner 경고) | 확인함. **구조를 바꿔야 했다**(4절 L1) |
| C | 마스킹 안내는 **닫을 수 없다**. `CollapsibleNotice`를 만들되 이 문구에는 접기를 허용하지 않는 **구조** | `RedactionNotice` preset으로 박제(4절 L2) |
| D | 로그 줄 목록은 `aria-live="off"` | 적용 |
| E | `SegmentedControl` 비활성 항목도 포커스 가능 / `MaskedValue variant="inline"` / `ComponentMatrix cells[].logHref` / `Chip onClick` | alerts 보고서 3-(5) |

### 2. 참고한 문서

- `docs/design/components.md` **20.4·20.5**, 21.2~21.5
- `docs/design/logs.md` 3(출처 줄)·4(한계 블록)·6.1(닫을 수 없는 경고)·6.3(찾기 vs 검색)·**7(로그 본문·가림 표식·따라가기)**·12(좁은 화면)·13(접근성)·14(컴포넌트 목록)
- `docs/design/status.md` **13절 전체**(13.1 로그는 상태를 만들지 않는다 / 13.3 타이포·열 폭 / 13.4 가림 표시 / 13.5 안내 코드 톤 / 13.6 한계 문구)
- `docs/reports/logs/designer.md`, `docs/reports/logs/README.md`(비밀값 원칙 7개, 가림 표식 위치 정정, **publisher 경고**)
- `docs/api/logs.md` 3절(`LogSegment`·`LogLine`·`kind`), 8절(줄 단위 집계), 9절(화면 규칙)

### 3. 작업 내용

#### (1) `LogLineList` (20.5)

- 구조: `[가림 gutter 28px sticky][시각 104px][접두 200px][본문 flex]`. 줄 높이 20px 고정, `code` 13/20, 색은 `code.*`.
- **가상 스크롤**: `logLineModel`의 `lineOffsets`/`indexAtOffset`/`logVisibleRange`(이분 탐색)로 화면 몫만 그린다. 2만 줄에서 그리는 줄은 22개(실측).
- **텍스트로만 렌더**한다. `dangerouslySetInnerHTML`이 없고, ANSI·제어문자를 다시 파싱하지 않는다. 가린 조각은 `MaskedValue variant="inline"`.
- 특별한 줄 5종(`ringTop`·`dropped`·`binary`·`redactFailed`·`gap`)은 중립색 가운데 정렬 한 줄. **`redactFailed`만 warn 색**을 쓴다(본문에 상태색을 쓰지 않는다는 규칙의 유일한 예외 — 내용이 통째로 사라진 자리라서).
- 접근성: 영역 `role="log" aria-label aria-live="off"`. **새 줄을 낭독하지 않는다.** `새 줄 N개` 버튼만 `aria-live="polite"`.
- 따라가기: `follow`면 새 줄에 맞춰 바닥에 붙이고, 사용자가 위로 스크롤하면 `onFollowBreak`를 **1회만** 부른다. 다시 내려가도 **자동으로 켜지지 않는다**(버튼으로만).
- 찾기: `findQuery` 일치는 **배경만** `status.warn.bg`(글자색 그대로), 현재 일치(`currentMatch`)만 1px `accent.default` 테두리. 정규식이 아니라 **글자 그대로** 찾는다(`.`을 쳐도 마침표만 찾힌다 — 테스트로 고정).
- **브라우저 저장소를 건드리지 않는다**(`localStorage` 호출 0건, 테스트로 고정).

#### (2) `CollapsibleNotice` (20.4)

- 접으면 `summary` 한 줄 + 아이콘이 남고, 펼치면 `lines[]`를 `<ul>`로 그린다. 토글은 `chevron-up/down` IconButton sm + `aria-expanded`/`aria-controls`.
- **닫기(`x`)가 없다.** 접힘 상태를 저장하지 않는다(`persistKey` 없음 — 다음에 열면 다시 펼쳐진다, `status.md` 13.6).
- 비제어(`defaultOpen`)·제어(`open`/`onToggle`) 둘 다 된다.

#### (3) `RedactionNotice` (신규 preset)

- `InlineAlert tone="neutral" icon="eye-off" title={LOG_REDACTION_NOTICE}` 고정. **prop이 `className` 하나뿐**이다.
- 문구·tone·닫기 가능 여부를 prop으로 열지 않았다 → 호출 측이 닫기를 붙일 방법이 없다.

#### (4) `logLineModel.ts` (순수 함수)

`LogLine`·`LogSegment`·`LogRuleRef` 타입, `maskedCount`/`maskedRules`, `noticeText`(서버 문구 우선, 없으면 최소 문구), `truncatedTail`, `formatLogTime`, `lineOffsets`/`indexAtOffset`/`logVisibleRange`, `findMatches`/`splitByMatches`, `logLineSrText`, 상수 `LOG_REDACTION_NOTICE`·`LOG_REDACTION_NO_RAW`·`LOG_CONFIDENCE_LABEL`.

### 4. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| L1 | 가상 스크롤을 **위·아래 여백 div**로 만들고 줄을 정상 흐름에 둔다. `.inner { width: max-content; min-width: 100% }` | 줄마다 `position: absolute; top`(이 저장소의 `ResourceTree`가 쓰는 방식) | **planner가 경고한 바로 그 함정이다.** absolute 줄은 부모의 `max-content` 폭에 기여하지 않아 컨테이너가 화면 폭으로 줄고, 줄 상자가 화면 폭만 해지면 **가로로 스크롤했을 때 줄이 먼저 끝나 sticky gutter가 풀린다.** 정상 흐름이면 `.inner`가 가장 긴 줄 폭이 되고 모든 줄이 그 폭을 채워 **끝까지 스크롤해도 gutter가 남는다**(Edge 실측: scrollLeft 1,166/2,324에서도 gutter가 본문 왼쪽 +1px) |
| L2 | 가림 경고를 **`RedactionNotice` preset**으로 박제 | 문서로 "`closable`을 주지 마세요"라고 당부 | 당부는 다음 사람에게 닿지 않는다. **줄 수 있는 prop이 없으면 줄 수 없다.** `CollapsibleNotice`에도 닫기를 아예 만들지 않아, 이 문구를 거기에 넣어도 "닫기"가 생기지 않는다(다만 요약/줄 구조가 맞지 않아 애초에 들어가지 않는다) |
| L3 | gutter 표식을 `Chip onClick`(버튼)으로 | `<span>` + 툴팁 | 규칙 팝오버를 **키보드로 열 수 있어야** 한다(`logs.md` 13절). 28px 안에 들어가도록 패딩만 줄인 `className`을 줬고 색·모양은 Chip 그대로다. hit 영역은 `::before`로 32px |
| L4 | 안내 줄 문구는 **서버 `segments` 우선**, 없을 때만 최소 문구 | 화면이 `(14:02:10 ~ 14:02:11)` 같은 구간까지 조립 | 화면이 시각을 지어내면 서버가 바뀔 때 두 곳이 어긋난다. 건수(`droppedLines`·`bytes`)는 서버 값을 **세지 않고 그대로** 쓴다 |
| L5 | `wrap` 높이를 ResizeObserver 측정 캐시로 | 글자 수 × 폭 추정 / wrap일 때 가상 스크롤 끄기 | 추정은 가림 조각·한글에서 빗나가 스크롤이 튄다. 끄면 2만 줄에서 브라우저가 멈춘다 |
| L6 | 시각 열 폭·gutter 폭을 **CSS 미디어 쿼리**로 줄인다(104→72, 28→24) | props로 받기 | 좁은 폭 규칙은 화면 폭의 함수이지 호출 측 선택이 아니다. **gutter를 없애지는 않는다**(`logs.md` 12절) |

### 5. 검증 결과

전체 명령 결과는 **`docs/reports/alerts/publisher.md` 6절**에 있다(lint·typecheck 통과, `npm test` **551 passed**(기준선 510 + 신규 41), build 통과). 로그 몫만 옮겨 적으면:

| 확인 | 방법 | 결과 |
|---|---|---|
| **sticky gutter (AC-LOG07)** | Edge에서 긴 줄(약 2,300px)을 만들고 `scrollLeft = scrollWidth` | `position: sticky`·`left: 0` 유지, 본문 왼쪽 +1px, 폭 28px, 배경 `code.bg`. **짧은 줄에서도 같다**(모든 줄 상자 폭 = 2,324px) |
| 2만 줄 | 같은 조작 + `scrollTop 4000` | 그린 줄 22개, scrollHeight 400,000px, gutter delta 1px |
| 줄 바꿈 켬 | 토글 후 측정 | 가로 스크롤 사라짐(scrollWidth == clientWidth), 긴 줄 60px(20 × 3줄) |
| 특별한 줄 | 계산 스타일 | `dropped`·`binary` 중립(`bg.surfaceSunken`/`text.tertiary`), `redactFailed`만 warn 배경·글자, 셋 다 가운데 정렬 |
| 가림 표기 | DOM | `data-variant="inline"`, 아이콘 0개, 복사 버튼 0개, 원문 문자열 없음 |
| gutter 키보드 | `focus()` | 포커스 가능, 접근 이름 `가려진 값 1개, 규칙 보기` |
| 가림 경고 | DOM | `inlineAlert tone-neutral`, **버튼 0개**, 왼쪽 3px `border.strong`, `eye-off` 1개 |
| `aria-live` | DOM | 영역 `off`, `새 줄 12개` 버튼만 `polite` |
| 360px | 섹션 폭 | 328/328 — 페이지 가로 스크롤 없음(본문 안쪽 가로 스크롤은 사용자가 고른 것) |

**하지 않은 것**: 실제 SSE 스트림으로 초당 수천 줄을 흘려보내는 부하 확인(프론트 통합 단계), 스크린리더 실물 낭독.

### 6. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL1 | 줄 바꿈 + 2만 줄은 측정 기반이라 스크롤바 길이가 스크롤 중 조금씩 보정된다(designer R2와 같은 한계). 기본값(줄 바꿈 끔)은 20px 고정이라 영향 없음 |
| RL2 | `wrap` 측정은 `ResizeObserver`가 있어야 정확하다. 없으면 모든 줄을 20px로 본다(jsdom 테스트 환경이 그렇다) |
| RL3 | `findQuery` 하이라이트는 **text 조각 안에서만** 찾는다. 가린 조각을 건너뛰는 일치(`postgres://ap****(12자)@db`에서 `://ap`)는 잡히지 않는다 — 가린 값 너머를 잇는 검색은 애초에 허용하면 안 되는 동작이다 |
| RL4 | 안내 줄 구간 문구(`(14:02:10 ~ 14:02:11)`)는 서버가 `segments`로 줘야 나온다(4절 L4) |
| RL5 | `ComponentMatrix`의 로그 버튼은 hover 전 `pointer-events: none`이라 자동화 도구가 곧바로 클릭하지 못한다(마우스를 셀 안으로 옮긴 뒤에는 정상) |

### 7. 다른 담당 요청

**프론트 요청**
1. `RedactionNotice`를 **로그 본문이 보이는 모든 자리**에 넣는다(`/logs`, 파드 상세 `로그` 탭, 워크로드·DB·컨트롤 플레인 진입). `InlineAlert`로 직접 만들지 말 것.
2. 출처 선택은 `SegmentedControl`에 `{ value: "stack", disabled: true, disabledReason: "외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)" }`로 준다. **목록에서 빼지 말 것**(있는데 못 보는 것과 없는 것은 다르다).
3. 한계 블록은 `CollapsibleNotice`(tone `neutral`, icon `info`, summary `직접 조회 · 지난 로그·검색 없음`, lines 4줄, 기본 펼침). `stack`에서는 **그리지 않는다**.
4. 링버퍼(2만 줄)·따라가기 on/off·찾기 입력값은 전부 호출 측 상태다. **찾기 입력값을 URL·저장소에 남기지 말 것.**
5. 가림 팝오버는 `onRedactionClick(line, anchor)`의 `anchor`(= sticky gutter 요소)에 붙인다. 규칙 이름은 서버가 준 것을 그대로 나열하고 **개수를 화면에 고정하지 않는다**. 문구는 `LOG_REDACTION_NO_RAW`·`LOG_CONFIDENCE_LABEL`을 쓴다.
6. 좁은 폭(<1024px)에서 `줄 바꿈`을 기본 켬으로 두는 것은 호출 측 기본값이다(`logs.md` 12절). 컴포넌트는 `wrap` prop만 본다.
7. 하단 상태 줄(`500줄 · 가림 3건 · …`)은 컴포넌트 밖이다. `aria-live="polite"`로 붙인다.

**백엔드 요청**
- `LogSegment.rules`가 계약은 `{id,label}` 객체, `components.md` 20.5 표는 `string[]`이다. 컴포넌트는 **둘 다 받으므로 계약 변경은 필요 없다**(문서 정합만 남는다).

### 8. 다음 담당이 알아야 할 점

1. **sticky gutter가 이 기능에서 가장 깨지기 쉬운 부분이다.** `logs.module.css`의 `.inner { width: max-content; min-width: 100% }`와 "줄을 정상 흐름에 둔다"는 구조를 바꾸면 **가로 스크롤 끝에서 표식이 사라진다.** 바꿀 일이 있으면 긴 줄을 만들어 `scrollLeft = scrollWidth` 상태에서 눈으로 확인할 것(4절 L1).
2. **로그는 상태를 만들지 않는다.** 본문에 상태색을 쓰지 않고(예외는 `redactFailed` 한 줄), 사이드바 `로그` 항목에 상태 점·배지가 없다.
3. **원문은 어디에도 없다.** 컴포넌트는 `masked.v`(표기)만 받고, "원문 보기"·복사·내려받기 버튼을 만들 자리가 없다.
4. 새 줄은 **낭독하지 않는다**(`aria-live="off"`). 이 값을 `polite`로 바꾸면 burst에서 낭독이 끝나지 않는다.
5. 새 디자인 토큰 **0건**이다. 로그 본문은 기존 `code.*`, 가림·생략은 중립색만 쓴다.

## 2026-09-25 06:50 · 통합 1차 후속

> `alerts`와 한 번에 맡은 5b 후속이다. **발송 칩 2종·`AlertItem` 좁은 폭·검증 명령 전체(lint·tsc·test·build·브라우저 PID)는 `docs/reports/alerts/publisher.md` 같은 이름 섹션이 정본**이다.
> 이 섹션은 로그 몫이다: `LogLineList.onReachBottom`, 스크롤 표시 결함 수정, `SegmentedControl` JSDoc, sticky gutter 재확인.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| 1 | `LogLineList`에 **`onReachBottom`** 1개 추가(`components.md` 20.5, `logs.md` 7.4) | 완료 |
|   | 조건: 맨 아래에 닿았을 때 **알리기만** 한다. 자동 스크롤을 다시 켤지는 쓰는 쪽이 정한다. 디자인은 "닿아도 켜지 않고 N만 0" | 그대로 |
| 2 | **sticky gutter 구조를 건드리지 않는다.** 이 파일을 고쳤으면 긴 줄에서 `scrollLeft = scrollWidth`로 다시 확인한다 | CSS·DOM 구조 변경 0. Edge로 다시 쟀다(6절) |
| 3 | `onFollowBreak` 주석을 "자동 스크롤만 끈다(스위치·연결은 그대로)"로 바꾼다(designer 요청) | 완료. `follow`·`pendingCount`·`onJumpToBottom`·`height` 주석도 20.5 정의로 맞췄다 |
| 4 | `SegmentedControl` JSDoc: `disabledReason`만 줘도 비활성이 된다는 점, 누를 수 있는 칸의 사유는 `tooltip`을 쓰라는 점을 적는다. **동작은 바꾸지 않는다** | 완료. 동작을 고정하는 테스트 1개를 추가했다 |
| — | (작업 중 발견) **"코드가 옮긴 스크롤" 표시가 남아 다음 사용자 스크롤을 삼키는 결함** | 고쳤다(3절 (2)). `onReachBottom`의 "사용자 스크롤일 때만"이 이 표시에 기대므로 같이 고쳐야 했다 |

### 2. 참고한 문서

- `docs/design/components.md` **20.5**(`follow`·`onFollowBreak`·`onReachBottom`·`pendingCount`·`onJumpToBottom`·`height`), **21.3**·17.4(`disabledReason` 주의)
- `docs/design/logs.md` **7.4**(스위치 = 연결 / 자동 스크롤 = 화면 동작 표, "맨 아래까지 직접 스크롤" 행, G1), 5절(컨테이너 칩 `tooltip`), 13절
- `docs/reports/logs/designer.md` "01:30 · 통합 1차 후속" 8절 publisher 요청 1~3
- `docs/reports/logs/README.md` "PM 결정 — 통합 1차에서 올라온 것" D2·"designer가 새로 정한 것"
- `docs/reports/logs/frontend.md` 5절 L2·L3, 8절, 9절 6("sticky gutter는 긴 줄로 확인할 것")
- `features/logs/LogViewer.tsx`(**읽기만**): `pendingCount = lines.length - scrollAnchor`, `follow && autoScroll`, 233행 `reveal` 주석("`LogLineList`가 방금 한 자기 스크롤로 착각해 놓치는 경우가 있다 — publisher 요청")

### 3. 작업 내용

**(1) `onReachBottom` — `LogLineList.tsx`**
- 부르는 조건은 셋 모두다.
  - `follow`가 false다(= 자동 스크롤이 꺼짐. 호출 측은 `따라가기 && 자동 스크롤`을 넘긴다).
  - **사용자 스크롤**이다. 코드가 옮긴 스크롤은 제외한다.
  - `scrollHeight - scrollTop - clientHeight <= 4`다.
- **내용이 늘어나는 것만으로는 부르지 않는다.** 새 줄이 붙어도 `scrollTop`은 그대로라 scroll 이벤트가 없다. 그래서 따로 막는 코드가 필요 없다(주석으로 적었다).
- **중복 억제**: 알린 때의 `lines` 배열을 ref(`reachedFor`)에 기억한다.
  - 같은 내용의 바닥에서 휠을 더 굴려도 다시 부르지 않는다.
  - 새 줄이 들어온 뒤(배열이 바뀜) 다시 바닥에 닿으면 또 부른다.
  - 바닥을 벗어나면(4px 초과) 기억을 지운다. 돌아오면 또 부른다.
  - 호출 측이 N을 0으로 맞추는 것은 멱등이라 여러 번 불려도 해가 없다.
- 기준이 `scrollHeight`가 아니라 `lines` 배열인 이유: 링버퍼가 가득 차면 총 높이가 400,000px로 **변하지 않는다.** 높이로는 "새 줄이 왔다"를 알 수 없다.
- `따라가기`가 꺼진 정지 조회에서도 조건이 같으면 부른다. 무엇을 할지는 호출 측이 정한다(JSDoc에 적었다).

**(2) 코드 스크롤 표시가 남는 결함 수정 — `scrollToEnd()`**
- **종전 동작**
  - 자동 스크롤 effect와 `새 줄 N개` 버튼은 `programmatic = true`를 세운 뒤 `scrollTop = scrollHeight`를 했다.
  - **이미 바닥이면 위치가 안 바뀌어 scroll 이벤트가 오지 않는다.** 그래서 표시가 남는다.
  - 그러면 **사용자의 다음 스크롤 1회**를 코드 스크롤로 잘못 알아 버린다.
- **언제 일어나나**
  - 조용한 파드(새 배치 길이가 그대로이거나 줄이 화면보다 적을 때)
  - 링버퍼가 가득 차 총 높이가 그대로일 때
- **결과**
  - PageUp·`End`처럼 이벤트가 한 번뿐인 조작에서 `onFollowBreak`를 놓친다.
  - `onReachBottom`도 놓친다.
  - frontend가 `LogViewer` 233행에 적은 증상("방금 한 자기 스크롤로 착각해 놓친다")이 바로 이것이다.
- **수정**: `scrollToEnd(el, programmatic)`는 바닥까지 남은 거리가 1px 이상일 때만 표시를 세우고 옮긴다. effect와 버튼이 둘 다 이 함수를 쓴다.
- **sticky gutter 구조**(`.inner { width: max-content }`, 위·아래 여백 div, 줄을 정상 흐름에 둠)와 `logs.module.css`는 **한 줄도 바꾸지 않았다.**

**(3) 주석 정정(20.5 정의로)**

| prop | 고친 주석 |
|---|---|
| `follow` | **자동 스크롤**이다. `따라가기` Switch(연결)와 다른 값이다. 호출 측은 `따라가기 켬 && 자동 스크롤 켬`을 넘긴다 |
| `onFollowBreak` | 끝에서 20px(1줄)을 넘게 벗어나면 1회. 호출 측은 **자동 스크롤만** 끈다. 스위치·연결은 그대로 둔다(종전 "호출 측이 `follow`를 끈다"를 고쳤다) |
| `pendingCount` | N = 자동 스크롤이 멈춘 뒤 들어와 **아직 화면 아래에 있는** 줄 수 |
| `onJumpToBottom` | 컴포넌트가 맨 아래로 옮기고, 호출 측은 자동 스크롤을 다시 켠다 |
| `height` | "탭 안 임베드" → "파드 상세 `로그` 섹션 안 임베드 480px"(D1) |

**(4) `SegmentedControl` JSDoc — 동작 변경 0**
- `disabledReason` 주석에 넣은 것
  - **"이 값만 줘도 칸이 비활성이 된다"**(`disabled || disabledReason`, 17.4·21.3)
  - **"누를 수 있어야 하는 칸에 사유만 보여 주려면 `tooltip`"**
  - 실제 결함(CrashLoopBackOff 컨테이너를 고를 수 없었다)
  - `tooltip`과 함께 주면 툴팁에는 이 사유가 나온다는 점
- `tooltip` 주석에는 "**칸을 막지 않는다**"와 컨테이너 칩 예를 넣었다.
- `blocked` 계산 줄에 "정의된 동작이다, 바꾸지 않는다"를 한 줄 적었다.

**(5) 테스트 추가** (`__tests__/alerts-logs.test.tsx`, 로그 몫 6개)
- jsdom에는 레이아웃이 없다. `scrollHeight`·`clientHeight`·`scrollTop`을 흉내 내는 `fakeScrollBox()`와 `userScroll()` 헬퍼를 두었다.

| 테스트 | 확인 |
|---|---|
| 끝에서 5px은 아니고 4px에서 1회, 바닥에서 더 굴려도 1회 | 경계·중복 억제 |
| 새 줄이 붙어도(이벤트 없음) 안 부름 → `End` 1회로 새 바닥 → 2회 → 벗어났다 돌아옴 → 3회 | "내용만 늘면 안 부른다" |
| `follow` 중에는 안 부름. 끝에서 10px은 유지, 100px에서 `onFollowBreak` 1회 | 자동 스크롤 중 |
| `새 줄 N개` 버튼으로 옮긴 스크롤에는 안 부름 | 코드 스크롤 제외 |
| **이미 바닥에서 새 배치 → PageUp 1회 → `onFollowBreak` 1회** | 결함 회귀. **수정을 잠시 되돌리면 이 테스트만 실패한다**(확인함) |
| `SegmentedControl`: `tooltip` 칸은 눌린다 / `disabledReason`만 준 칸은 `aria-disabled`이고 안 눌린다 | 동작 고정(JSDoc과 같은 말) |

**(6) 미리보기**
- `/dev/ui`의 **2만 줄 목록**에 `pendingCount`(상태)·`onReachBottom`·`onJumpToBottom`을 붙였다.
- 아래 줄에 `맨 아래 닿음 알림 N회 · 새 줄 N개`와 `새 줄 12개로 되돌리기` 버튼을 두었다.
- 10줄 목록은 240px 안에 다 들어가 세로 스크롤이 없다. 그래서 "바닥에 닿음"을 시연할 수 없어 종전(고정 `새 줄 12개`)대로 두었다.

### 4. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| L7 | 사용자 스크롤 판정은 **종전 `programmatic` 표시를 그대로 쓰고**, 표시가 남는 구멍만 막았다 | 휠·키·포인터 이벤트로 "사용자 의도"를 따로 추적 | 의도 추적은 스크롤바 드래그·터치·접근성 도구마다 경로가 달라 빠지는 곳이 생긴다. 코드가 스크롤을 옮기는 곳은 이 파일 안 두 군데(effect·버튼)뿐이다. 그 두 곳만 정확히 표시하면 "나머지는 사용자"가 성립한다. 표시가 남는 유일한 경우(옮길 것이 없을 때)를 막았다 |
| L8 | 중복 억제 기준 = **`lines` 배열이 같은가** | 매 scroll 이벤트마다 호출 / `scrollHeight`가 같은가 | 매번 부르면 바닥에서 휠 한 번에 수십 번 불린다. `scrollHeight`는 링버퍼가 가득 차면 변하지 않아 "새 줄이 왔다"를 놓친다. 호출 측은 새 배치마다 새 배열을 준다(`LogViewer`는 스트림 상태의 `lines`를 그대로 넘긴다) |
| L9 | 자동 스크롤 재개를 컴포넌트가 하지 않는다 | 바닥에 닿으면 컴포넌트가 스스로 `follow`처럼 동작 | 디자인 G1: 맨 아래에 닿는 것은 대개 마지막 줄을 **읽다가** 생긴다. 켜지면 새 줄이 오는 순간 읽던 줄이 밀려난다. PM 지시도 "알림만, 결정은 쓰는 쪽"이다 |
| L10 | 4px 판정은 컴포넌트 상수(`REACH_BOTTOM_PX`)다 | prop으로 열기 | 디자인이 정한 값이고 호출 측이 바꿀 이유가 없다. `onFollowBreak`의 20px(1줄)도 같은 방식이다 |

### 5. 검증 결과

전체 명령 결과는 **`docs/reports/alerts/publisher.md` 같은 섹션 6절**에 있다. lint·tsc 통과, `npm test` **595 passed**(26 files), build 통과, 기존 테스트 수정 0건이다. 로그 몫을 옮기면 다음과 같다.

**B4. sticky gutter 재확인 (AC-LOG07)** — Edge 1440px, `줄 바꿈` 끔, `scrollLeft = scrollWidth`

| 목록 | 스크롤 폭 / 보이는 폭 / scrollLeft | 그린 줄 | gutter 위치 | gutter |
|---|---|---|---|---|
| 10줄(긴 줄 포함) | 2,324 / 1,158 / 1,166(끝) | 10 | **전부 본문 왼쪽 +1px** | 28px, `sticky`, `left: 0` |
| 2만 줄(`scrollTop 4000`) | 2,367 / 1,158 / 1,209(끝) | 34 | **전부 +1px** | 28px, `sticky`, `left: 0` |

- 가림 표식 버튼 3개는 본문 왼쪽 +3px, 컨테이너 안에 있다.
- 22:20 측정값과 같다(구조 무변경). 스크린숏으로도 끝까지 스크롤한 상태에서 `eye-off 1` 표식 3개가 왼쪽에 남아 있는 것을 봤다.

**B5. `onReachBottom` 실동작** — `/dev/ui` 2만 줄 목록(`새 줄 12개`에서 시작)

| 조작 | 알림 횟수 | 버튼 | 비고 |
|---|---|---|---|
| 처음 | 0 | `새 줄 12개` | |
| 휠로 600px 내림(바닥 아님) | 0 | 그대로 | |
| **`End` 키** | **1** | **사라짐**(N=0) | 끝까지 0px. 자동 스크롤은 켜지지 않는다(시연은 N만 0으로) |
| 바닥에서 휠을 더 굴림 | 1 | — | 중복 없음 |
| N=12로 되돌림 → 위로 옮김 → **`새 줄 N개` 버튼** | **1**(그대로) | 사라짐 | 코드 스크롤은 알리지 않는다. N=0은 `onJumpToBottom`이 했다 |
| N=12로 되돌림 → 휠로 800px 올림 → `End` | **2** | 사라짐 | 벗어났다 돌아오면 다시 알린다 |

- 처음 스크립트에서는 마지막 줄이 1회로 나왔다. 원인은 **측정 스크립트의 실수**였다. `되돌리기` 버튼을 누르느라 마우스가 목록 밖으로 나갔고, 휠이 페이지를 굴렸다. 목록은 이미 바닥이었고, 바닥에서 누른 `End`는 scroll 이벤트를 만들지 않는다. 마우스를 목록 위로 옮긴 뒤 다시 재서 위 결과를 얻었다.
- 이 경우는 실제 화면에서는 생기지 않는다. 바닥에 있는데 "아래에 남은 새 줄"이 있는 상태는 새 줄이 붙어 바닥이 내려간 뒤에만 생기기 때문이다.

**하지 않은 검증**
- 실제 스트림에서 초당 수백 줄이 들어오는 동안 바닥에 닿는 경우. mock이 초당 1~3줄이라 못 봤다. backend의 `logs=flood` 시나리오가 나오면 frontend 통합 3차에서 확인할 수 있다.
- 스크린리더 실물 낭독

### 6. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL6 | `줄 바꿈`을 켠 상태에서는 측정 높이 보정과 브라우저 스크롤 앵커링 때문에 사용자 조작 없이 scroll 이벤트가 날 수 있다. 그때 이미 바닥이면 `onReachBottom`이 불릴 수 있다. 사용자가 **이미 바닥에 있을 때만** 생기는 일이라 N=0이 사실과 어긋나지 않는다. 앵커링을 끄는 것(`overflow-anchor: none`)은 위로 올려 읽을 때 화면이 튀게 만들어 택하지 않았다 |
| RL7 | 정지 조회(따라가기 끔)에서도 조건이 맞으면 `onReachBottom`이 불린다. 호출 측 N이 0이면 아무 일도 없다 |
| RL8 | 10줄 미리보기 목록의 `새 줄 12개`는 고정 시연값이라 누르거나 스크롤해도 사라지지 않는다(시연은 2만 줄 목록에서) |

### 7. 다른 담당 요청

**frontend 요청**
1. `LogViewer`의 `LogLineList`에 **`onReachBottom`**을 붙여 "맨 아래 닿으면 N=0, 자동 스크롤은 그대로 끔"을 만든다(designer frontend 요청 2).
   - 지금 식 `pendingCount = lines.length - scrollAnchor`에 맞추면 한 줄이다: `onReachBottom={() => setScrollAnchor((cur) => (cur === null ? cur : lines.length))}`
   - `scrollAnchor`가 null이 아닌 채로 남으므로 자동 스크롤은 켜지지 않는다.
   - `따라가기`가 꺼져 있으면(null) 건드리지 않는다.
2. `LogViewer` 233행 `reveal` 주석의 원인이었던 "자기 스크롤로 착각" 결함은 **`LogLineList`에서 고쳤다**(3절 (2)).
   - `reveal`이 자동 스크롤을 먼저 푸는 지금 방식은 그대로 두는 것이 더 명확하다. **바꿀 필요는 없다.**
   - 원하면 주석의 "놓치는 경우가 있다"를 "(publisher 06:50 수정 전) 있었다"로 정리하면 된다.
3. 컨테이너 칩 사유는 지금처럼 `tooltip`이다. JSDoc과 테스트에 그 규칙을 고정했다.

**designer 참고(조치 불필요)**: 20.5의 prop 정의를 JSDoc에 그대로 옮겼다. 4px·20px 판정도 문서 값 그대로다.

### 8. 다음 담당이 알아야 할 점

1. **이 파일에서 스크롤을 코드로 옮길 때는 `scrollToEnd()`처럼 "실제로 움직일 때만" `programmatic` 표시를 세운다.** 표시가 남으면 다음 사용자 스크롤 1회가 사라지고, 그러면 `onFollowBreak`·`onReachBottom`이 조용히 빠진다. 회귀 테스트가 있다("이미 바닥이면 코드 스크롤 표시를 남기지 않는다").
2. **`onReachBottom`은 알리기만 한다.** 자동 스크롤을 다시 켜는 코드를 컴포넌트에 넣지 않는다(디자인 G1, 다시 붙는 길은 `새 줄 N개` 버튼 하나).
3. sticky gutter 구조는 이번에도 **그대로**다. 이 파일을 또 고치면 긴 줄을 만들어 `scrollLeft = scrollWidth` 상태에서 확인한다. `/dev/ui`의 10줄 목록과 2만 줄 목록에 긴 줄이 들어 있다.
4. `SegmentedControl`의 `disabledReason`은 **칸을 막는다.** 사유만 보여 줄 때는 `tooltip`을 쓴다(JSDoc·테스트로 고정).

## 2026-09-25 07:15 · 앵커(그 시각으로 열기) + 통합 2차 publisher 요청

> 06:50 섹션 뒤에 PM이 두 번 더 보낸 추가 작업이다: ① 앵커 표시(`logs.md` 7.6) ② frontend 통합 2차에서 올라온 publisher 요청 6건.
> **이 섹션이 정본**인 것: `LogLineList.anchor`·`currentMatch` 스크롤·스크롤 플래그 확인·`SearchInput.onKeyDown`·`Chip.removeLabel`, 그리고 **이번 검증 명령 전체**.
> 설정 쪽 3건(`SecretInput.disabled`·`Switch aria-describedby`·`Dialog.cancelDisabled`)은 `docs/reports/alerts/publisher.md` 같은 이름 섹션에 있다.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| A1 | `LogLineList.anchor` — 앵커 줄 **바로 위** 구분 줄(20px, `bg.surfaceSunken`, `history` 12px, micro 600, 문구는 prop), 앵커 줄 `bg.selected` | 완료 |
| A2 | `before_result`·`after_result`의 구분 줄 위치를 7.6대로 | 완료. prop은 20.5대로 `placement`로 받는다. 상태 → 자리·문구는 `logListAnchor()`가 7.6 표 그대로 바꾼다 |
| A3 | 첫 화면 `found` = 본문 높이 1/3 지점. 스크롤은 누가 할지 정해 prop 주석에 적는다 | **컴포넌트가 직접 한다**(5절 K1). 주석에 "알리기만/직접 한다"를 분명히 적었다 |
| A4 | 조작 줄 `그 시각 14:02:05` 칩(`x` 해제)이 기존 조합으로 되는가 | **된다.** `Chip`(neutral sm + `history` + `onRemove` + `title`)이다. 새 컴포넌트는 없다. 접근 이름을 디자인 문구로 주려고 **`Chip.removeLabel` prop 1개**를 더했다(K4) |
| A5 | 구분 줄이 끼어도 가상 스크롤 높이가 안 어긋나는가 + sticky gutter를 `scrollLeft = scrollWidth`에서 다시 잰다 | 확인했다(6절 B6·B7). 2만 줄 중 10,000번째 줄에 앵커를 둬도 20px 격자가 정확하다 |
| A6 | `/dev/ui`에 세 상태 | 넣었다(+ 2만 줄 깊은 앵커 스위치, 칩 해제, 찾기 이동 시연) |
| R4 | `LogLineList`가 `currentMatch`로 **직접 스크롤**. `anchor`와 **같은 방식**으로 | 완료. 둘 다 "컴포넌트가 직접, 키가 바뀔 때 한 번, 즉시, 포커스 이동 없음"이다(K1) |
| R5 | 스크롤 플래그 누수가 06:50에 고친 것과 같은 결함인지 확인만 | **같은 결함이다.** 3절 (4) |
| R6 | (선택) `SearchInput` 키 입력 prop | `onKeyDown` 추가 |

### 2. 참고한 문서

- `docs/design/logs.md` **7.6**(① 표시·상태별 자리·1/3 근거, ② 칩, ③ 안내·`suggest`, ④ 따라가기, ⑤ 접근성), 6.3, 7.1~7.4, 12절
- `docs/design/components.md` **20.5 `anchor` 행**, 13절 아이콘(`history`)
- `docs/reports/logs/designer.md` "추가 2 · 그 시각으로 열기(앵커)"(A1~A9, publisher 요청)
- `docs/api/logs.md` **2.2.1**(`anchor { at, state, lineId }`, `state` 4종·`lineId` 규칙, `details.at`)
- `docs/reports/logs/frontend.md`·`docs/reports/alerts/frontend.md` "06:50 · 통합 2차" 5절 L9, 7절 RL7·RL8, 8절 publisher 요청
- `features/logs/find.ts`(`revealLine`)·`LogViewer.tsx`(`reveal`) — **읽기만**. 찾기 이동을 컴포넌트로 옮길 때 기존 동작(보이면 그대로, 아니면 가운데)을 맞추려고 읽었다

### 3. 작업 내용

**(1) `LogLineList.anchor` (`{ lineId, placement: "above" | "below", label, title? }`, 20.5 그대로)**
- **구분 줄**(`AnchorSeparator`, 파일 안 내부 컴포넌트)
  - 20px 블록, `bg.surfaceSunken`, 가운데 `history` 12px + `label` micro 11/14 **600** `text.primary`, `user-select: none`
  - `title`은 `Tooltip`(전체 시각)이다
  - **`data-log-row`가 없다** → 줄 수·높이 측정·찾기 대상에서 빠진다
- **가로 스크롤에서도 문구가 보인다**
  - 문구 상자를 **보이는 폭(측정한 `clientWidth`)만큼** `position: sticky; left: 0`으로 붙인다. 그 안에서 가운데 정렬한다
  - 줄 바꿈을 끄고 가로 끝까지 가도 문구는 보이는 폭의 가운데에 있다(B7)
  - 구분 줄 자체에는 `overflow`를 주지 않았다. `hidden`이면 구분 줄이 스크롤 상자가 되어 sticky가 풀린다(주석에 적음)
- **앵커 줄**(`data-anchor="true"`)
  - 배경 `bg.selected`이고 hover해도 그대로다
  - 글자색·gutter(`code.bg`)는 그대로다. 찾기 `mark`는 그 위에 겹친다
  - `가림 처리 실패` 줄이 앵커면 warn 배경이 이긴다(CSS 순서로 정함)
- **가상 스크롤 높이**
  - 구분 줄 20px를 **앵커 줄 칸에 더한다.** 칸 = [구분 줄 + 줄](above) / [줄 + 구분 줄](below)
  - 위·아래 여백 div가 항상 20px를 포함한다. 그래서 앵커 줄이 화면 밖에 있어도 스크롤 높이가 맞다
  - 줄 바꿈 측정은 `[data-log-row]`만 잰다. 구분 줄은 고정 20px라 재지 않는다
  - 상수 `LOG_ANCHOR_SEPARATOR_HEIGHT = LOG_LINE_HEIGHT`. CSS 20px와 같다는 것을 주석으로 묶었다
- **첫 화면 스크롤(컴포넌트가 직접)**
  - `above`: 구분 줄 윗변을 `floor(본문 높이 / 3 / 20) × 20` 지점에 둔다(`anchorScrollTop`). 모자라면 0이라 `before_result`(첫 줄)는 저절로 맨 위다
  - `below`: 구분 줄 아랫변을 본문 아래 끝에 둔다. `after_result`(마지막 줄)면 맨 아래다
  - 키(`lineId`+`placement`)가 **바뀔 때 한 번**만 옮긴다. 같은 키로 새 줄·재렌더가 와도 다시 끌고 가지 않는다. `anchor`를 뗐다 다시 주면 다시 옮긴다
  - 즉시 이동이고 포커스는 옮기지 않는다
  - `follow`와 함께 오면 스크롤은 `follow`가 맡고 앵커는 표시만 한다(7.6 ④: 호출 측이 따라가기를 켜면 앵커를 뗀다)
- **`lineId`가 `lines`에 없으면 아무것도 그리지 않는다.** 화면이 시각을 비교해 비슷한 줄을 고르지 않는다(7.6·계약 2.2.1-5).

**(2) 앵커 모델 — `logLineModel.ts`** (frontend가 7.6을 옮기지 않아도 되게)
- `logListAnchor(anchor, timeText, title?)`: 서버 `anchor { state, lineId }`를 prop으로 바꾼다. **7.6 표 그대로**다.
  - `found` → above `그 시각 14:02:05`
  - `before_result` → above `그 시각 14:02:05의 줄은 이보다 앞이라 가져오지 못했습니다`
  - `after_result` → below `그 시각 14:02:05 이후 출력 없음`
  - `none`·`lineId` 없음 → `undefined`
- `logAnchorTimeText(at, now)`: 오늘이면 `14:02:05`, 다른 날이면 `9월 24일 14:02:05`, 다른 해면 `2025년 …`. 7.6은 **초까지**다. 기존 `formatTime("auto")`는 다른 날이면 분까지라 따로 두었다.
- `anchorScrollTop(sepTop, viewportH)`, 타입 `LogAnchorState`·`LogListAnchor`, 상수 `LOG_ANCHOR_SEPARATOR_HEIGHT`. 전부 `index.ts`에서 내보낸다.

**(3) `currentMatch` 직접 스크롤(R4) — `anchor`와 같은 규칙**
- 키(`lineId`·`index`·`seq`)가 바뀔 때 한 번 옮긴다.
  - 세로: 그 줄이 다 보이면 그대로다. 아니면 줄 가운데를 본문 가운데로 옮긴다. frontend `revealLine`과 같은 결과다.
  - 줄 바꿈이 꺼져 있으면 가로도 맞춘다. 그 줄이 그려진 뒤 현재 `mark`가 보이는 폭(sticky gutter 오른쪽 ~ 오른쪽 끝) 밖이면 가운데로 옮긴다. frontend 판은 가로를 하지 않아 긴 줄 오른쪽 일치가 안 보였다.
- 구분 줄이 있으면 그 20px를 빼고 줄 위치를 잡는다(`rowBox`).
- **자동 스크롤 중**(`follow`)에 찾은 줄로 가서 바닥을 벗어나면 `onFollowBreak`를 **1회** 부른다. 호출 측이 자동 스크롤을 끄지 않으면 다음 새 줄에 바닥으로 끌려가 찾은 줄을 잃는다. frontend가 먼저 꺼 두어도 결과가 같다(멱등).
- `seq?: number`를 더했다. 일치가 1개뿐인데 `Enter`를 또 누르면 같은 일치로 **다시** 가야 한다. 키가 같으면 옮기지 않으므로 호출 측이 `seq`를 늘린다.
- 코드가 스크롤을 옮기는 곳은 이제 **`moveScroll()` 하나**다(자동 스크롤·`새 줄 N개`·앵커·찾기). 범위로 자르고, 실제로 움직일 때만 `programmatic` 표시를 세운다. 그래서 앵커·찾기 스크롤은 `onReachBottom`·`onFollowBreak`(스크롤 이벤트 경로)를 부르지 않는다.
- 크기 측정 effect가 **본문이 처음 그려질 때 다시 붙는다**(`ready` 의존).
  - 종전에는 mount 때 한 번만 붙었다. `loading`으로 시작하면(LogViewer가 그렇다) 관측기가 끝내 붙지 않았다.
  - 그러면 `height`가 바뀌어도 보이는 줄 범위 계산이 처음 값에 머물렀다. frontend의 `height="fill"`에 영향이 있을 수 있던 곳이다.

**(4) 스크롤 플래그 누수(R5) — 확인만**
- frontend 보고: "따라가기 효과가 `scrollTop = scrollHeight`를 넣었는데 이미 바닥이라 스크롤 이벤트가 나지 않으면 플래그가 남아 다음 사용자·찾기 스크롤을 자기 스크롤로 착각한다"(조용한 파드 `batch/cleanup-…`)
- **06:50에 고친 결함과 같은 것이다.** 원인 코드(effect가 무조건 `programmatic = true`)가 같다. 증상(다음 스크롤 1회 삼킴)도 같다.
- 06:50 수정: 실제로 움직일 때만 표시한다. 회귀 테스트가 있고, 수정을 되돌리면 그 테스트가 실패하는 것도 확인했다.
- 이번에 이 규칙을 `moveScroll()` 하나로 모았다.
- frontend는 3차에서 `LogViewer.reveal`의 우회와 `find.ts` `revealLine`을 지울 수 있다(8절).

**(5) `SearchInput.onKeyDown`(R6)**
- 입력칸 `keydown`을 넘긴다. `Escape`(지우기)는 컴포넌트가 먼저 처리한다(`e.defaultPrevented`로 알 수 있다).
- 치자마자 누른 `Enter`는 `e.currentTarget.value`로 지금 값을 읽을 수 있다(테스트로 고정).
- 한글 조합(`isComposing`) 거르기는 호출 측 몫이다. JSDoc에 적었다.

**(6) `Chip.removeLabel`(A4)**
- 제거 버튼 접근 이름. 기본값은 종전 `<label> 제거`다.
- `그 시각` 칩은 `removeLabel="그 시각 표시 해제"`를 쓴다(7.6 ②). 기존 호출은 그대로다(테스트로 확인).

**(7) 미리보기 `/dev/ui` "그 시각으로 열기 — 앵커"**
- 칩(`x` = 세 목록 앵커 해제 / `앵커 다시 켜기`)
- `found`·`before_result`·`after_result` 목록 3개(240px)
  - `before`는 `InlineAlert` info 2줄 + `2,000줄로 다시 조회` 버튼
  - `after`는 compact 안내
  - 7.6 ③을 **기존 `InlineAlert` 조합**으로 그린 것이다
- 2만 줄 + 10,000번째 줄 앵커 스위치
- `attempt=3` 찾기 버튼(긴 줄 오른쪽 끝, `seq` 증가)

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/logs/LogLineList.tsx` | 수정 | `anchor`(구분 줄·앵커 줄·첫 화면), `currentMatch` 직접 스크롤(+`seq`), `moveScroll()` 일원화, 크기 측정 `ready` 의존, prop 주석 |
| `apps/web/src/components/ui/logs/logLineModel.ts` | 수정 | `LogAnchorState`·`LogListAnchor`·`LOG_ANCHOR_SEPARATOR_HEIGHT`·`logAnchorTimeText`·`logListAnchor`·`anchorScrollTop` |
| `apps/web/src/components/ui/logs/logs.module.css` | 수정 | `.rowAnchor`·`.anchorSeparator`·`.anchorSticky`·`.anchorLabel`·`.anchorIcon`·`.anchorText`. **sticky gutter 규칙(`.inner`·`.gutter`)은 무변경** |
| `apps/web/src/components/ui/status/Chip.tsx` | 수정 | `removeLabel` |
| `apps/web/src/components/ui/controls/SearchInput.tsx` | 수정 | `onKeyDown` |
| `apps/web/src/components/ui/index.ts` | 수정 | 앵커 모델 내보내기 |
| `apps/web/src/components/ui/__preview__/AlertsLogsPreview.tsx` | 수정 | 앵커 섹션, 설정 확장 시연 섹션(alerts 보고서) |
| `apps/web/src/components/ui/__tests__/alerts-logs.test.tsx` | 수정 | +16개(53 → 69). **기존 테스트 수정 0건** |
| (설정 쪽) `SecretInput.tsx`·`Switch.tsx`·`Dialog.tsx` | 수정 | alerts 보고서 |
| `docs/design/tokens.json` · `apps/web/src/styles/tokens.css` | **변경 없음** | **새 토큰 0건(10회 연속)**. `bg.selected`·`bg.surfaceSunken`·`text.primary`·`--font-caption-strong-weight`(600) 재사용. 새 아이콘 0(`history`는 레지스트리에 있다) |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| K1 | **앵커 첫 화면·찾기 이동 모두 컴포넌트가 직접 스크롤한다.** 호출 측은 값만 준다. 컴포넌트는 알림만 돌려준다(`onFollowBreak`·`onReachBottom`) | ① 컴포넌트는 "옮길 위치"만 알리고 호출 측이 옮긴다 ② 앵커는 컴포넌트, 찾기는 호출 측(지금 frontend 구조) | 가상 스크롤의 줄 위치(측정 높이·구분 줄 20px 포함)를 정확히 아는 것은 컴포넌트뿐이다. ①·②면 호출 측이 본문 DOM(`role="log"`, `data-log-row`)을 읽어야 한다. 그러면 속성 하나만 바뀌어도 **조용히 스크롤만 안 된다**(frontend RL7). PM 지시대로 둘을 한 규칙으로 묶었다. **"스크롤 위치는 컴포넌트, 자동 스크롤 켜고 끄기는 호출 측"**. 06:50의 `onReachBottom`("알리기만")과도 모순이 없다. 그것은 켜고 끄기에 대한 결정이기 때문이다 |
| K2 | 키가 바뀔 때 **한 번만** 옮긴다(+`seq`) | 값이 올 때마다 / 객체가 바뀔 때마다 | 7.6 "그 뒤 사용자가 스크롤하면 다시 끌고 가지 않는다". 객체 기준이면 새 줄이 올 때마다(찾기 결과 배열이 새로 만들어진다) 찾은 줄로 끌려간다. `seq`는 "같은 일치로 다시"라는 사용자 의사만 담는다 |
| K3 | 구분 줄 높이를 **앵커 줄 칸에 더한다** | `lines`에 가짜 줄 끼우기 / 구분 줄을 absolute로 띄우기 | 가짜 줄은 7.6 "`lines`에 넣지 않는다"를 어긴다. 줄 수·찾기·`reachedFor`가 모두 틀어진다. absolute는 06:50까지 지켜 온 "줄은 정상 흐름"(sticky gutter 조건)을 깬다. 칸에 더하면 여백 div가 저절로 맞는다(B6: 2만 줄에서 격자 오차 0) |
| K4 | `그 시각` 칩은 기존 `Chip`. **`removeLabel` 1개만 추가** | 새 `AnchorChip` / 기본 이름(`그 시각 14:02:05 제거`) | 모양·동작은 기존 prop 조합으로 된다(neutral sm·`history`·`onRemove`·`title`). 7.6 ②의 접근 이름 `그 시각 표시 해제`만 못 줬다. "제거"는 필터 칩 말이라 여기서는 "시각을 지운다"로 들린다. 새 컴포넌트가 아니라 선택 prop이라 기존 호출은 그대로다 |
| K5 | 구분 줄 문구를 **보이는 폭 가운데**에(측정 폭 + sticky) | 줄 전체 폭 가운데(기존 특별한 줄과 같은 방식) / `left: 50%` + `transform` | 전체 폭 가운데면 긴 줄에서 가로로 스크롤할 때 문구가 화면 밖에 있다(기존 `ringTop`·생략 줄은 실제로 그렇다, 7절 RL11). `transform`은 안의 `Tooltip`(position: fixed) 기준을 망가뜨린다. 폭은 이미 있던 크기 관측기에서 같이 잰다 |
| K6 | 좁은 폭에서 긴 구분 줄 문구는 **말줄임**(줄 바꿈 안 함) | 2줄로 늘리기 | 높이 20px가 가상 스크롤 격자다. 늘리면 K3의 계산이 틀어진다. 같은 사실은 닫을 수 없는 `LOG_ANCHOR_BEFORE_RESULT` 안내가 위에서 전부 말한다(7.6 ③). DOM 문구는 그대로라 스크린리더는 끝까지 읽는다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과**(0 error) | 처음 돌렸을 때는 `features/logs/useLogStream.ts`에서 1건이 났다. frontend가 같은 시간에 고치던 파일이다. `components/ui`만 따로 돌리면 0이었다. 마지막 실행은 전체 0 |
| `npx tsc --noEmit` (apps/web) | **통과** | 중간에는 `features/logs/*`·`features/alerts/alerts-logs.test.tsx` 오류가 있었다(frontend 작업 중, 내 영역 0건). 마지막 실행은 전체 0 |
| `npm test --prefix apps/web` | **625 passed (27 files)** | 내 파일 53 → **69**(+16). 중간 실행에서 frontend 테스트 2건이 `features/logs/href` 작업 중이라 실패했다. 마지막 실행은 전부 통과. **기존 테스트 수정 0건** |
| `NEXT_DIST_DIR=.next-pub2 npx next build` | **통과**(마지막 실행) | 첫 시도는 **실패**했다. 컴파일은 됐고, TypeScript 단계에서 frontend 작업 중 파일(`LogsPage.tsx`·`alerts-logs.test.tsx`)에 걸렸다. frontend 파일이 정리된 뒤 다시 돌려 통과. 끝난 뒤 `.next-pub2` 삭제 |
| **브라우저(Playwright 1.63 npx 캐시 + Edge headless, :3145)** | 아래 B6~B9 | build가 막혀 있던 동안 **`next dev -p 3145`**(같은 `.next-pub2`)로 쟀다. 프로세스 트리를 확인해 **내 PID 24544(`next dev -p 3145`)·24404(그 서버 자식)만** `Stop-Process -Id`로 껐다. frontend의 `:3143` 개발 서버(8384·5604)는 건드리지 않았다 |

**B6. 세 상태 첫 화면** (본문 240px → clientHeight 238, 1/3 = `floor(238/3/20)×20` = 60)

| 상태 | scrollTop | 구분 줄 위치(본문 안) | 앵커 줄 | 기타 |
|---|---|---|---|---|
| `found`(`af25`) | **440** = 500 − 60 | 윗변 **60**, 높이 20 | 바로 아래(80, 간격 0) | 배경 `rgb(232,240,254)` = `bg.selected`, 구분 줄 `rgb(238,240,243)` = `bg.surfaceSunken`, 문구 `rgb(27,31,36)` = `text.primary` · **600**, 문구 가운데(오차 0) |
| `before_result`(`ab0`) | **0** | 0(맨 위) | 바로 아래(20) | 문구 `그 시각 14:02:05의 줄은 이보다 앞이라 가져오지 못했습니다` |
| `after_result`(`aa29`) | 382 = 맨 아래(끝까지 **0px**) | 아랫변 238 = 본문 아래 끝 | 바로 위(198~218) | 문구 `그 시각 14:02:05 이후 출력 없음` |

**B7. sticky gutter + 구분 줄 문구 — `scrollLeft = scrollWidth`** (긴 줄 `af24`와 구분 줄이 함께 그려진 상태, 줄 바꿈 끔)

| 폭 | 스크롤 폭 / 보이는 폭 / scrollLeft | gutter(그린 줄 35개) | 가림 표식 버튼 | 구분 줄 문구 | 20px 격자 |
|---|---|---|---|---|---|
| 1440 | 2,360 / 1,158 / 1,202(끝) | **전부 본문 왼쪽 0px**, `sticky` | 전부 +2px | 보이는 폭 **가운데(오차 0)**, 띠는 오른쪽 끝까지 | 앵커 앞 `i×20`, 뒤 `i×20+20` **일치** |
| 700 | 2,328 / 666 / 1,662(끝) | 전부 0px | +2px | 가운데(오차 0) | 일치 |
| 1440 줄 바꿈 켬 | 1,158 / 1,158 / 0 | 0px | +2px | 가운데 | (줄 바꿈은 긴 줄이 3줄이라 격자 검사 대상 아님) |
- 기준점이 22:20·06:50 측정(본문 테두리 +1px)과 다르다. 이번에는 **안쪽(clientLeft)** 기준이다. 값은 같은 자리다.
- 스크린숏(700px, 가로 끝): 긴 줄 끝 `… attempt=3 node=i-0c3d4e5f6a7b8c9d0`, 전체 폭 띠에 `🕘 그 시각 14:02:05`가 보이는 폭 가운데, 앵커 줄 `bg.selected`(gutter 칸은 `code.bg` 그대로), 왼쪽 끝에 가림 표식이 있다.

**B8. 가상 스크롤 — 2만 줄 중 10,000번째 줄에 앵커**

| 확인 | 값 |
|---|---|
| 첫 화면 scrollTop | **199,940** = 10,000×20 − 60 (기대값과 같음) |
| scrollHeight / `.inner` 높이 | **400,020** = 20,000×20 + 20 |
| 구분 줄 / 앵커 줄 / 앞 줄 offsetTop | 200,000 / 200,020 / 199,980 |
| 앵커 뒤(15,000·15,001·15,005번째) | 300,020 · 300,040 · 300,120 = `i×20 + 20` **일치** |
| 앵커 앞(5,000·5,003번째) | 100,000 · 100,060 = `i×20` **일치** |
| 맨 끝 | 끝까지 0px, 마지막 줄 아랫변 400,020 = 전체 높이(빈틈·겹침 없음) |

**B9. 찾기 이동·칩·좁은 폭**

| 확인 | 결과 |
|---|---|
| `attempt=3`(긴 줄 오른쪽 끝) 찾기, 본문을 900px 내려 둔 상태에서 | scrollTop 900 → **371**(줄 가운데 = 480 − 119 + 10), scrollLeft 0 → **1,202**. 일치 `mark`가 보이는 폭 안에 들어온다(왼쪽 903 ~ 오른쪽 967 / 1,158) |
| 사용자가 옮긴 뒤(800, 0) | **그대로**(같은 일치로 끌고 가지 않는다) |
| 버튼 다시 누름(`seq`+1) | 다시 371 / 1,202 |
| `그 시각 표시 해제` 버튼 | 1개. 누르면 세 목록의 구분 줄 0개·앵커 줄 0개 |
| 360px | 본문 326px. `before_result` 문구만 말줄임(K6). 세 목록 모두 섹션 가로 넘침 없음, 구분 줄 20px |

**하지 않은 검증**
- 실제 서버 `anchor` 응답으로 그리기. frontend 3차 몫이다(`logListAnchor`에 서버 값을 넘기면 된다).
- 스크린리더 실물 낭독
- 줄 바꿈 + 앵커 첫 화면의 정밀도(측정 전 20px 추정으로 옮긴다. 7절 RL10)

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL9 | 첫 화면 스크롤은 **본문이 보이는 상태**에서 한 번이다. 본문이 `display: none`(높이 0)인 채로 앵커를 받으면 0으로 옮기고 끝난다. 파드 상세처럼 접히는 자리에는 앵커가 없어서(7.6 ⑤) 지금은 해당 없다 |
| RL10 | 줄 바꿈을 켜면 앵커 위 줄들의 실제 높이를 모르는 채(20px 추정) 옮긴다. 측정 뒤 브라우저 스크롤 앵커링이 자리를 지켜 주지만, 1/3 지점이 몇 줄 어긋날 수 있다. 기본값(줄 바꿈 끔)에서는 정확하다(B6) |
| RL11 | 기존 특별한 줄(`ringTop`·초당 생략·바이너리)의 가운데 문구는 **줄 전체 폭** 가운데라 긴 줄에서 가로로 스크롤하면 화면 밖으로 간다(22:20부터 있던 모양. 06:50 스크린숏에서도 보인다). 앵커 구분 줄만 보이는 폭 가운데로 했다. 같은 방식으로 맞출지는 designer 판단이다 |
| RL12 | 좁은 폭에서 `before_result` 문구는 말줄임된다(K6) |
| RL13 | 미리보기 앵커 목록에 `showMillis`를 넘기지 않아 360px에서 시각 열(72px)과 본문이 겹친다. **미리보기만의 일**이다. 실제 `LogViewer`는 좁은 폭에서 `showMillis={false}`를 넘긴다 |

### 8. 다른 담당 요청

**frontend 요청**(3차)
1. **앵커**: `<LogLineList anchor={logListAnchor(res.anchor, logAnchorTimeText(res.anchor.at), formatFullTime(res.anchor.at))} />`
   - 서버 값을 그대로 넘긴다. 첫 화면 스크롤은 컴포넌트가 한다. **본문 DOM을 만지지 않는다.**
   - `anchor.at`이 없으면 `details.at`을 쓴다(7.6 "시각 표기").
   - 따라가기를 켜면 `anchor`를 뗀다(7.6 ④).
2. **`그 시각` 칩**: `<Chip label={`그 시각 ${t}`} icon="history" size="sm" title={formatFullTime(at)} onRemove={…} removeLabel="그 시각 표시 해제" />`. 조작 줄 맨 앞에 둔다.
3. **찾기 이동**
   - `currentMatch={{ lineId, index, seq }}`만 넘긴다. 같은 일치로 다시 갈 때는 `seq`를 늘린다.
   - 그 뒤 `features/logs/find.ts`의 `revealLine`을 지운다. `LogViewer.reveal`의 "자동 스크롤 먼저 풀기"도 지워도 된다(컴포넌트가 `onFollowBreak`를 부른다). 남겨도 결과는 같다.
   - 둘 다 남긴 채면 한 번에 두 번 옮길 수 있다(화면 쪽이 먼저, 컴포넌트가 뒤에서 확인). 눈에 띄는 튐은 없었지만 지우는 편이 맞다.
4. **스크롤 플래그 우회**(RL8): 06:50 수정과 같은 결함이라 **지워도 된다**.
5. **`SearchInput onKeyDown`**: 감싼 `div`에서 받던 키를 `onKeyDown`으로 옮길 수 있다. 조합 중 `Enter` 거르기는 그대로 호출 측이 한다.

**designer 참고**
- RL11: 기존 특별한 줄 문구도 보이는 폭 가운데로 맞출지 판단해 달라. 구현은 구분 줄과 같은 방식이면 된다.
- 구분 줄 600 굵기는 `--font-caption-strong-weight`를 빌렸다. micro 굵은 글꼴 토큰이 따로 없어서다. 새 토큰은 만들지 않았다.

**PM 보고**
- **`apps/web/tsconfig.json`을 되돌리지 않았다.** 되돌리기 전에 diff를 다시 확인했더니, 지시에 적힌 것(`.next-pub2` include 2줄 + 서식) **말고** frontend의 **`.next-fe3dev` include 2줄**이 더 있었다. frontend의 `next dev -p 3143`(PID 8384·5604)이 지금 돌고 있다.
- 지시의 전제("diff가 그것뿐")가 성립하지 않는다. 그래서 다른 담당 줄까지 지우는 되돌리기는 하지 않았다.
- frontend 개발 서버가 끝난 뒤 `git checkout -- apps/web/tsconfig.json` 한 줄이면 HEAD로 돌아간다. 내 `.next-pub2` 폴더는 이미 지웠다.

### 9. 다음 담당이 알아야 할 점

1. **스크롤 위치를 옮기는 것은 컴포넌트, 자동 스크롤을 켜고 끄는 것은 호출 측이다.** `follow`·`anchor`·`currentMatch`는 값이고, 옮기는 길은 `moveScroll()` 하나다. 새로 "그 줄로 가기"가 필요하면 prop을 더하고 같은 함수를 쓴다(표시가 남는 결함이 다시 생기지 않는다).
2. **구분 줄은 줄이 아니다.** `lines`에 넣지 말고 `data-log-row`를 붙이지 않는다. 높이 20px는 CSS와 `LOG_ANCHOR_SEPARATOR_HEIGHT`가 같아야 한다.
3. **구분 줄에 `overflow: hidden`을 주지 마라.** 문구의 가로 sticky가 풀린다.
4. 앵커·찾기 스크롤은 **키가 바뀔 때 한 번**이다. 새 줄마다 끌고 가는 동작을 만들지 않는다(7.6 "그 뒤 사용자가 스크롤하면 다시 끌고 가지 않는다").
5. sticky gutter는 이번에도 무변경이다. 이 파일을 또 고치면 `/dev/ui` 앵커 `found` 목록(긴 줄 `af24`가 앵커 바로 위)에서 `scrollLeft = scrollWidth`로 확인한다. gutter와 구분 줄 문구를 한 화면에서 볼 수 있다.

## 2026-09-25 07:55 · 검증 전 정리 (특별한 줄 가운데 · Button 이중 낭독 · ResourceName `logHref`)

> PM의 검증 전 마지막 정리 지시(`docs/reports/logs/README.md` "3차 뒤 정리 목록" 1·2번)와, 작업 중 추가로 온 `ResourceName.logHref`(`components.md` 21.10)를 한 번에 했다. **이 섹션이 정본이다**(검증 명령 전체 포함). `alerts/publisher.md` 같은 이름 섹션에는 `Button` 변경이 설정 화면에 주는 영향만 적었다.

### 1. 요청 내용

| # | 요청 | 결과 |
|---|---|---|
| 1 | **특별한 줄의 가로 위치**: 링버퍼 안내 같은 특별한 줄(디자인 7.2)도 앵커 구분 줄처럼 **보이는 영역 가운데**. 가로로 끝까지 스크롤해도 문구가 보여야 한다. 20px 격자와 gutter를 다시 잰다 | 완료. designer가 7.2에 넣은 규칙대로 **전체 폭 한 줄짜리(생략·링버퍼 위쪽·구간 없음)만** 가운데로 옮겼다. `가림 처리 실패`·`바이너리`는 문구를 본문 흐름에 둔다(3절 (1)) |
| 2 | **`Button` 비활성 사유 이중 낭독**: 사유를 이름에서 빼고 설명(`aria-describedby`)에만. 기존 테스트 수정 허용(고친 테스트마다 무엇이 어떻게 바뀌었는지 적기). `features/**` 테스트가 깨지면 목록으로 보고 | 완료. **기존 테스트 1건**을 고쳤다(`snapshot.test.tsx`, 5절 표). 내가 06:50·07:15에 쓴 테스트 2곳은 느슨하게 써 둔 이름 검사를 정확한 이름으로 좁혔다. **`features/**` 테스트는 하나도 깨지지 않았다**(634 통과) |
| 3 | (추가) **`ResourceName.logHref`**: 복사 버튼 다음 아이콘 링크. 마우스는 행 hover, 키보드는 행 포커스(복사 버튼에도 같은 조건), 터치(`hover: none`)는 항상, 스크린리더는 투명도로만 숨겨 항상 읽힌다. `null`이면 그리지 않는다. 링크는 받은 그대로. 미리보기에 hover·포커스·터치 | 완료 |

### 2. 참고한 문서

- `docs/design/logs.md` **7.2**(designer가 넣은 "보이는 본문 영역 가운데" 규칙 + "`가림 처리 실패`는 띠만 전체 폭, 문구는 본문 흐름"), 7.6 구분 줄 서술
- `docs/design/components.md` **21.10**(`ResourceName.logHref`: 모양·보이는 조건·접근 이름·폭 계산), 7.2
- `docs/reports/logs/designer.md` "추가 4"(E1·E2, publisher 요청 1~3)
- `docs/reports/logs/README.md` "3차 뒤 정리 목록" 1·2, "3차에서 올라온 것 — PM 결정" 5
- 기존 코드: `DataTable`(행 클릭은 셀 안 `a`·`button`을 거른다, 행 `Enter`는 행 자신일 때만), `IconButton`(이름이 `aria-label`이라 이 결함이 없다), `Switch`(사유가 버튼 밖 sr-only)

### 3. 작업 내용

**(1) 특별한 줄 — 보이는 본문 영역 가운데 (`LogLineList`·`logLineModel`·`logs.module.css`)**
- `isFullWidthNotice(kind)` 추가: `dropped`·`ringTop`·`gap`. 이 줄만 행에 `rowBand`를 붙이고, 시각·접두·문구를 **`noticeBody`**(sticky 상자)에 넣는다.
  - 상자는 `position: sticky; left: var(--log-gutter-w)`이고 폭은 `calc(var(--log-view-w, 100%) - var(--log-gutter-w))` = 보이는 폭 − gutter다.
  - gutter 바로 오른쪽에 붙어 가로로 밀어도 따라온다. 폭이 보이는 폭이라 스크롤 끝에서도 줄 상자(`.inner` 폭) 안에 딱 들어간다.
  - 스크롤 0에서는 종전과 **같은 모양**이다(시각 열 → 가운데 문구).
- `binary`·`redactFailed`는 **실제 한 줄을 대신하는** 줄이다. 7.2에 따라 문구를 다른 줄처럼 본문 흐름(왼쪽)에 둔다. 종전에는 모든 특별한 줄이 가운데였다. 배경(`bg.surfaceSunken` / `status.warn.bg`)은 행 전체 폭 그대로다.
- **변수 두 개**(토큰이 아니라 이 CSS 파일 안 구조 변수)
  - `--log-view-w`: 컴포넌트가 이미 재던 `clientWidth`를 스크롤 상자에 인라인으로 넣는다. 재기 전에는 없어서 100%로 떨어진다.
  - `--log-gutter-w`: 28px, 좁은 폭 24px. gutter 폭 숫자를 여기로 옮겼다(값 같음).
  - 앵커 구분 줄도 같은 `--log-view-w`를 쓴다. 07:15의 인라인 폭 prop을 지웠고, 한 값을 두 곳이 나눠 쓴다.
- **20px 격자 지키기**
  - 줄 바꿈을 끄면 가운데 문구는 한 줄로 두고, 보이는 폭보다 길면 말줄임한다(좁은 화면). 종전 `pre-wrap`이면 좁은 폭에서 두 줄이 되어 20px 격자를 깰 수 있었다.
  - 줄 바꿈을 켜면 종전대로 감싼다(높이는 측정).
  - 말줄임을 하려고 문구를 `noticeLabel` span으로 감쌌다. 글자는 같아서 `getByText`가 그대로 찾는다.

**(2) `Button` 비활성 사유 이중 낭독**
- 종전: 사유 sr-only 문장이 **버튼 안**에 있었다. 이름 = `저장 대시보드 DB에…`(내용으로 이름을 만든다)이고, 설명도 같은 문장이라 두 번 읽혔다.
- 수정: 사유 요소를 **버튼 밖**(툴팁 래퍼 안)에 두고 `hidden`으로 숨긴다. `aria-describedby`가 가리키는 숨은 요소의 글자는 설명 계산에 들어간다(accname 규칙).
- 이름은 버튼 문구만, 사유는 설명으로 한 번 읽힌다.
- 읽기 모드에서 버튼 옆 떠돌이 문장으로 한 번 더 읽히는 일도 없다. sr-only로 밖에 두면 그렇게 된다.
- 같은 패턴 점검: `IconButton`은 이름이 `aria-label`이라 이 결함이 없다. `Switch`는 사유가 버튼 밖 sr-only라 이름에는 안 섞이지만 읽기 모드에서 한 번 더 읽힐 수 있다. **이번 범위(Button)가 아니라 바꾸지 않았다**(7절 RL16).

**(3) `ResourceName.logHref` (21.10)**
- `logHref?: string | null`이다. 있으면 복사 버튼 **다음**(`.rn` gap 4px)에 `<a href>`를 그린다.
  - 모양: 24 × 24px, radius 6px, `scroll-text` 14px `text.secondary`. hover `bg.hover`·`text.primary`.
  - 포커스: 전역 focus ring. 클릭 영역 32 × 32px(`::before` 바깥 4px).
  - 툴팁 `로그 보기`(400ms), 접근 이름 `<표시 이름> 로그 보기`(노드면 짧은 이름).
- **주소는 받은 그대로**다(`href={logHref}`, 가공 없음). `null`·없음이면 아무것도 그리지 않고 자리도 비우지 않는다.
- 행 클릭으로 번지지 않게 감싼 span에서 `stopPropagation`한다(복사 버튼과 같다). `DataTable`도 셀 안 링크 클릭·행 밖 `Enter`는 원래 거른다.
- **보이는 조건을 한 규칙으로 묶었다**
  - 복사·로그 둘 다 `.rnAction`이다. 평소 `opacity: 0`(자리 차지, 스크린리더에 항상 있음)이다.
  - 보임: `.rn:hover`·`.rn:focus-within`·`tr:hover`·**`tr:focus-within`·`tr:focus-visible`**(키보드로 행에 오면. **복사 버튼에도 새로 적용**).
  - `@media (hover: none)`이면 항상 보인다.
  - `visibility`·`display`로 숨기지 않는다.

**(4) 미리보기 `/dev/ui`**
- "파드 표의 로그 (ResourceName logHref)": 파드 3행 표(`onRowClick` + 행 클릭 결과 줄, 마지막 행 `logHref: null`)와 ①②③ 설명.
- 터치 모양은 데스크톱에서 볼 수 없어서 이 미리보기에서만 강제로 보이게 한 한 줄을 두었다(실제 규칙은 CSS `@media (hover: none)`).
- 특별한 줄은 기존 10줄 목록(`ringTop`·`dropped`·`binary`·`redactFailed` + 긴 줄)에서 그대로 확인된다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/logs/logLineModel.ts` | 수정 | `isFullWidthNotice()` |
| `apps/web/src/components/ui/logs/LogLineList.tsx` | 수정 | 전체 폭 특별한 줄 → `noticeBody` sticky 상자, 문구 `noticeLabel`, `--log-view-w` 인라인, 구분 줄 인라인 폭 제거 |
| `apps/web/src/components/ui/logs/logs.module.css` | 수정 | `--log-gutter-w`·`.noticeBody`·`.rowBand`·`.noticeLabel`·줄 바꿈 끔 말줄임, `.anchorSticky` 폭 → 변수, gutter 폭 → 변수(값 같음) |
| `apps/web/src/components/ui/controls/Button.tsx` | 수정 | 사유 요소를 버튼 밖 `hidden`으로 |
| `apps/web/src/components/ui/table/ResourceName.tsx` | 수정 | `logHref` |
| `apps/web/src/components/ui/table/table.module.css` | 수정 | `.rnAction`(복사·로그 한 규칙 + 행 포커스), `.rnLogLink` |
| `apps/web/src/components/ui/__preview__/AlertsLogsPreview.tsx` | 수정 | 파드 표의 로그 섹션 |
| `apps/web/src/components/ui/__tests__/alerts-logs.test.tsx` | 수정 | +9개(Button 2 · 특별한 줄 3 · `logHref` 4), 내 테스트 2곳 이름 검사 좁힘 |
| `apps/web/src/components/ui/__tests__/snapshot.test.tsx` | 수정 | **기존 테스트 1건**(5절 표) |
| 토큰 | **변경 없음** | 새 토큰 0(11회 연속). 새 아이콘 0(`scroll-text`), 새 컴포넌트 0 |

### 5. 주요 결정과 이유 + 고친 테스트

| # | 결정 | 검토한 대안 | 고른 이유 |
|---|---|---|---|
| K7 | 특별한 줄의 **시각·접두·문구 전체**를 sticky 상자에 넣는다(폭 = 보이는 폭 − gutter) | 문구만 sticky(시각 열은 흐름대로) | 문구만 두면 sticky 상자의 원래 자리가 시각 열 **뒤**라, 스크롤 0에서 가운데를 맞추려면 앞 열 폭(시각 104/72, 접두 200/140/없음)을 CSS가 알아야 한다. 경우가 여섯 갈래다. 한 상자에 넣으면 gutter 폭 하나만 알면 되고, 스크롤 0 모양은 종전과 같다 |
| K8 | `binary`·`redactFailed`는 **가운데로 옮기지 않는다**(문구 본문 흐름) | 모든 특별한 줄을 가운데로(종전 정렬 유지) | designer 7.2: "`가림 처리 실패` 줄도 배경은 줄 전체 폭. 문구는 다른 줄처럼 본문 흐름 안". 이 두 줄은 그 시각의 **한 줄을 대신**하므로 다른 줄과 같은 열에 있어야 시각과 함께 읽힌다. 가로로 밀면 문구는 흐르지만, 띠(배경)는 전체 폭이라 "여기 무언가 빠졌다"는 남는다 |
| K9 | 사유 요소를 **버튼 밖 `hidden`**으로 | ① 버튼 밖 sr-only ② `aria-description` 속성 | ①은 이름에서는 빠지지만 읽기 모드에서 버튼 다음 떠돌이 문장으로 또 읽힌다. ②는 지원이 고르지 않다. `aria-describedby` → 숨은 요소는 설명 계산에 들어가는 것이 accname 표준이고 Chromium·jsdom 모두 따른다(Edge에서 설명 글자 확인, 6절 B11) |
| K10 | `logHref`의 보이는 조건을 **복사 버튼과 한 클래스(`.rnAction`)**로 | 로그 링크만 따로 규칙 | 21.10 "보이는 조건은 복사 버튼과 같다(한 규칙으로 묶는다)". 두 규칙이면 한쪽만 고쳐진다(행 포커스가 그 예였다 — 복사 버튼에 없었다) |

**고친 기존 테스트(PM 허용, 이유 기록)**

| 파일 · 테스트 | 무엇을 검사하던 것 | 어떻게 바뀌었나 |
|---|---|---|
| `components/ui/__tests__/snapshot.test.tsx` · `TypeToConfirmDialog (11.5) > 앞뒤 공백을 뺀 값이 정확히 같을 때만 확인, Enter 도 일치할 때만` 322~324행 | 비활성 `휴지통으로 이동` 버튼의 **`textContent`에 사유**(`스냅샷 ID를 입력하세요`)가 들어 있는가. 곧 "사유가 버튼 이름에 섞여 읽힌다"를 고정하고 있었다 | 이름을 **정확히** `휴지통으로 이동`으로 찾는다. 버튼 `textContent`에 사유가 **없고**, `aria-describedby`가 가리키는 요소에 사유가 **있는지**를 본다. 검사 의도("사유를 스크린리더가 읽을 수 있다")는 그대로이고, 읽히는 자리가 이름 → 설명으로 옮겨 갔다 |
| (내가 쓴 테스트) `alerts-logs.test.tsx` · SecretInput `disabled` 2곳 | `/^바꾸기/`·`/^지우기/`·`/^저장/` 앞부분 일치(06:50·07:15에 종전 동작을 피해 느슨하게 썼다) | 정확한 이름 `바꾸기`·`지우기`·`저장`으로 좁혔다. 이제 이름에 사유가 섞이면 실패한다 |

- **`features/**` 테스트 영향: 없음.** 전체 634개 통과. frontend에 넘길 깨진 테스트 목록은 **0건**이다.

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | **통과**(0 error) | |
| `npx tsc --noEmit` (apps/web) | **통과** | |
| `npm test --prefix apps/web` | **634 passed (27 files)** | 내 파일 69 → 78. 기존 테스트 수정 1건(5절) |
| `NEXT_DIST_DIR=.next-pub2 npx next build` | **통과** | 끝난 뒤 `.next-pub2` 삭제 |
| 브라우저(Playwright 1.63 npx 캐시 + Edge headless, `next start -p 3145`) | 아래 B10~B12 | 이번 서버 PID **1276**(`next start -p 3145`, 부모는 내 bash)만 `Stop-Process -Id`로 껐다 |
| `apps/web/tsconfig.json` | **손대지 않았다** | PM 지시(마지막에 PM이 되돌린다) |

**B10. 특별한 줄 — 스크롤 0 / `scrollLeft = scrollWidth`** (`/dev/ui` 10줄 목록, 줄 바꿈 끔)

| 폭 | 스크롤 폭/보이는 폭/끝 | `--log-view-w` | 링버퍼 위쪽·초당 생략 문구(본문 안 x) | gutter | 20px 격자 |
|---|---|---|---|---|---|
| 1440 | 2,324 / 1,158 / 1,166 | 1158px | 스크롤 0과 끝이 **같은 자리**(507~771 · 498~780), 시각 열 오른쪽~끝의 가운데에서 −6px(문구 칸 오른쪽 여백 12px의 절반) | 전부 0px | 10줄 전부 `i×20`, 행 높이 20 |
| 700 | 2,292 / 666 / 1,626 | 666px | 같은 자리(245~509 · 236~518) | 0px | 일치 |
| 360 | 2,288 / 326 / 1,962 | 326px | 같은 자리(96~314). 보이는 폭이 좁아 **말줄임**(설계대로, 20px 유지) | 0px | 일치 |
- `binary`·`가림 처리 실패`는 스크롤 0에서 시각 열 뒤(132px)에 있다. 끝까지 밀면 문구가 흐름대로 화면 밖으로 간다(K8). **띠는 보이는 폭 끝까지 칠해진다**(행 오른쪽 ≥ 보이는 오른쪽).
- 스크린숏(700px, 끝): `— 이전 줄은 화면에서 지워졌습니다 (2만 줄 상한) —`와 `— 초당 상한으로 1,204줄 생략됨 (14:02:11 ~ 14:02:12) —`가 가운데에 있다. 가림 처리 실패 행은 노란 띠만 전체 폭이다.
- 앵커 구분 줄(변수로 바꾼 뒤 회귀): 1440·700·360 모두 가로 끝에서 문구 가운데 오차 **0**.

**B11. `Button` 이름·설명** (`/dev/ui` 비활성 버튼 4개: 어드바이저 2 + DB 없음 `SecretInput` 2)

| 버튼 | `textContent`(= 이름) | 설명(`aria-describedby` 글자) | 설명 요소 |
|---|---|---|---|
| `바꾸기` | `바꾸기` | `대시보드 DB에 연결할 수 없어 저장할 수 없습니다.` | `hidden`, 버튼 밖 |
| `지우기` | `지우기` | 같음 | 같음 |
| `다시 분석` | `다시 분석` | `브리지 미실행` | 같음 |
| `비활성` | `비활성` | `Claude Code 로그인 필요` | 같음 |
- Playwright `getByRole("button", { name: "바꾸기", exact: true })`가 찾는다. 종전에는 이름이 `바꾸기대시보드…`라 정확한 이름으로 못 찾았다.

**B12. `ResourceName.logHref`** (`/dev/ui` 파드 표 3행, 3행째 `logHref: null`)

| 상태 | 복사·로그 `opacity` | 비고 |
|---|---|---|
| 평소(1440) | 0 · 0 | 링크 24px, 주소 `/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&follow=1` **그대로**, 이름 `prod/api-7f9c8d6b5-x2kq9 로그 보기` |
| 1행 hover | 1행만 1 · 1 | |
| 2행 **키보드 포커스**(행이 `activeElement`) | 2행만 1 · 1 | 복사 버튼도 이제 보인다 |
| **터치**(Edge `hasTouch`+`isMobile`, `(hover: none)` 참) | 모든 행 1 · 1 | |
| `null` 행 | 복사만(로그 없음, 자리 없음) | |
| 로그 아이콘 클릭 | 행 클릭 결과 `없음` | 번지지 않는다 |
| 이름 글자 클릭 | 행 클릭 결과 `prod/api-…` | 행 클릭은 그대로 된다 |
- 360px: 이름 칸 262px 안에 이름 158px + 복사 24 + 로그 24가 들어간다(말줄임 없이 맞음). 표는 표 안에서만 가로 스크롤한다(392/326).
  - `.rn`의 `scrollWidth`가 4px 큰 것은 아이콘 32px 클릭 영역(`::before`)이 바깥으로 나온 몫이다. 1440에서도 같고, 잘리는 것은 없다.
  - 문서 전체 가로 넘침은 미리보기의 기존 `DataTable` 때문이다(22:20 B3과 같은 알려진 한계).

**하지 않은 검증**: 스크린리더 실물 낭독(설명 계산은 DOM·표준으로만 확인), 실제 파드 표(frontend가 `LogLink` → `logHref`로 바꾼 뒤)

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| RL14 | 줄 바꿈을 끈 좁은 화면에서는 전체 폭 특별한 줄 문구가 말줄임된다(360px에서 링버퍼 위쪽·초당 생략). DOM 글자는 그대로라 스크린리더는 끝까지 읽는다. 좁은 폭 기본값은 줄 바꿈 켬이라(`logs.md` 12절) 실제로는 드물다 |
| RL15 | `binary`·`가림 처리 실패` 문구가 가로 스크롤을 따라 흐른다(설계대로, K8). 띠는 남는다 |
| RL16 | `Switch`의 비활성 사유는 버튼 밖 **sr-only**라 읽기 모드에서 스위치 다음에 한 번 더 읽힐 수 있다(이름에는 안 섞인다). `Button`과 같은 방식(`hidden`)으로 바꾸면 되지만 이번 지시 범위가 아니라 두었다. `SegmentedControl`은 사유를 **접근 이름에 일부러** 넣는다(21.3, 포커스로 읽게). 다른 성격이라 그대로다 |

### 8. 다른 담당 요청

**frontend 요청**(검증 전이면 좋다)
1. 파드 표 네 곳(목록·워크로드·노드·DB)의 `LogLink` 글자 버튼을 `<ResourceName … logHref={row.logHref} />`로 바꾼다(designer 요청 1). 서버 값을 그대로 넘기고, `null`이면 그대로 `null`을 넘긴다(컴포넌트가 그리지 않는다). Warning 이벤트 행은 글자 링크 그대로 둔다.
2. `Button` 변경으로 **깨진 `features/**` 테스트는 없다.** 이름을 `/…사유…/` 정규식으로 찾던 곳이 있으면 이제 사유 없이 찾으면 된다(찾아보니 현재 테스트에는 없었다).

**designer 참고**: 7.2의 `바이너리`도 `가림 처리 실패`처럼 "한 줄을 대신하는 줄"로 보고 본문 흐름에 두었다(7.2 규칙 목록에 이름이 없어 이렇게 읽었다). 다르게 뜻했다면 `isFullWidthNotice`에 `binary`를 한 단어 더하면 된다.

### 9. 다음 담당이 알아야 할 점

1. **"보이는 영역 가운데"는 CSS 변수 두 개로 된다**: `--log-view-w`(컴포넌트가 잰 보이는 폭)와 `--log-gutter-w`(gutter 폭). 앵커 구분 줄과 전체 폭 특별한 줄이 같은 값을 쓴다. 새로 "가로로 밀어도 남아야 하는 줄"이 생기면 같은 sticky 상자 방식을 쓴다. 부모에 `overflow`를 주지 않는다.
2. 전체 폭 특별한 줄인지는 **`isFullWidthNotice()` 한 곳**이 정한다.
3. `Button`의 사유는 이제 **이름에 없다.** 테스트는 `getByRole("button", { name: "정확한 문구" })`로 찾고, 사유는 `aria-describedby`로 확인한다.
4. `ResourceName`의 행동 아이콘(복사·로그)은 `.rnAction` **한 규칙**으로 보인다. 새 아이콘을 더하면 같은 클래스를 쓴다. `opacity`로만 숨긴다.
