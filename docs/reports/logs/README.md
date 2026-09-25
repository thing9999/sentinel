# logs · 로그 조회 (2026-09-25~)

명세: [`docs/specs/logs.md`](../../specs/logs.md) — 수용 기준 AC-LOG01~53(49~53은 뒤에 붙였다), 단계 L1~L4

## 진행 현황
| # | 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|---|
| 1 | 기획 | planner | [planner.md](planner.md) | **완료** — 비밀값 원칙 7개·가림 규칙 10종, 두 출처 설계, 열린 질문 10건 |
| 1b | 기존 명세 반영 + 명세 본문 갱신 | planner | [planner.md](planner.md) | **완료** — 열린 질문 정리(9.1 결정 / 9.2 남은 확인), 끊긴 참조 1건 수정. 명세 상태 **"착수 가능"** |
| 2 | 디자인 (+후속 2회) | designer | designer.md | **완료 — designer 몫 종료** — 알림 센터·로그 뷰어·설정 화면·사이드바 12항목. 새 컴포넌트 5개, **디자인 토큰 추가 0건(6회 연속)**, 상단바 무변경 |
| 2 | DBA | dba | [alerts/dba.md](../alerts/dba.md) 23:40 섹션 | **완료** — `maskPgDetailValues`·`maskPgLogValues`·`createPgLogValueMasker`로 `sql_statement` 보강(AC-LOG49). 보고서는 alerts 쪽에 있다 |
| 3 | API 계약 | backend | backend.md | **완료** — logs.md 740줄, 엔드포인트 6개 + **전용 SSE 연결**, `logBackend` 출처. `common.md`는 추가만(기존 필드 삭제·변경 0건). api lint·test 502 통과 |
| 4 | 퍼블리싱 | publisher | publisher.md | **완료** — 새 컴포넌트 5개 + preset 1개, 확장 8건, `SideNav` 3단 flex. lint·typecheck·build 통과, test **551**(510 → +41, 기존 테스트 수정 0건). **새 토큰 0건(7회 연속)** |
| 4 | 구현 1단계 (P1/L1) | backend | backend.md | **완료** — lint·build·tsc 통과, jest **566 passed / 2 skipped**(502 → +64). mock(3131)에서 알림 생성·배지·가림 실측. **DB 경로·실클러스터 미검증** |
| 4 | 구현 2단계 (P2 + **L3**) | backend | backend.md | **완료** — lint·build 통과, jest **590 passed / 2 skipped**(566 → +24). 설정 API·테스트 발송·디스코드 발송기·외부 로그 스택. **DB 경로·실제 디스코드·실제 Loki 미검증** |
| 5 | 통합 1차 (L1 + L3 출처 전환 + 컨트롤 플레인 진입) | frontend | [frontend.md](frontend.md) | **완료** — `LogViewer` 하나를 `/logs`·파드 상세가 같이 쓴다. 전용 스트림·close 2경로·링버퍼·가림 팝오버(`label`만). sticky gutter 700px 폭 재확인. 공통 검증은 `alerts/frontend.md` 6절 |
| 5b | 명세 반영 (D1~D3, Q11~Q13, 상한 문구) | planner | [planner.md](planner.md) 5차 | **완료** — AC-LOG13·16 수정, **AC-LOG50·51 신설**(기존 번호 이동 0건, 총 51개). 진입점 표에 "따라가기 기본" 열 추가, 3.8.3을 "규칙 → 분류 → 진입점" 표로. 문서만 — AC-LOG13(접으면 스트림 수 복귀)·16·51은 **아직 실측 없음** |
| 5b | 디자인 문서 반영 | designer | [designer.md](designer.md) | **완료** — 7.4·9절 전면 재작성, 탭 서술 14곳 정리(planner 목록 9 + 밖 5), 멈춤 안내 문구, 상한 문구. **새 토큰 0(8회 연속)·새 컴포넌트 0**, 새 prop `LogLineList.onReachBottom` 1개 |
| 5b | 후속 정리 (SSE 결함·follow 규칙·mock 시나리오·**L2 서버 몫**) | backend | [backend.md](backend.md) 06:45 섹션 | **완료** — lint 0·build 통과, jest **639 passed / 2 skipped**(+49, 기존 수정 0, 384조합 유지). SSE↔REST `logHref` 일치 실측(컨트롤 플레인 15/15·파드 56·이벤트 6·워크로드 12). `at`→`anchorAt` 계약 신설(2.2.1), 진입점 링크 11.4. mock `stream-notice`·`idle-pause`·`max-duration`·`flood`(2만 줄 13.5초, 원문 누출 0). **실제 `pods/log`·Loki의 `anchorAt` 미검증** |
| 5b | `at`(앵커) 명세 반영 | planner | [planner.md](planner.md) 5차 "추가 반영 3·4" | **완료** — AC-LOG52(앵커)·53(워크로드 해석 회귀) 신설, 총 53개 |
| 5b | `at`(앵커) 디자인 | designer | [designer.md](designer.md) "추가 2" | **완료** — `logs.md` **7.6 신설**(구분 줄 `그 시각 14:02:05` + 앵커 줄 `bg.selected`, `found`는 본문 1/3 지점), 8.7에 워크로드 안내 2종. `suggest`는 바로가기 버튼(`range`는 기간 Select만 연다 — 같은 값이 "넓혀라/좁혀라" 두 뜻이라 화면이 대신 고르지 않는다). 앵커 중 따라가기를 켜면 **앵커를 풀고** 새 연결. 새 토큰·아이콘·컴포넌트 0, 새 prop `LogLineList.anchor` |
| 5b | `LogLineList.anchor` + frontend 요청 6건 | publisher | [publisher.md](publisher.md) 07:15 | **완료** — lint·tsc·build 통과, test **625**(기존 수정 0). **스크롤 규칙 하나로 통일: 위치는 컴포넌트가, 자동 스크롤 켬/끔은 쓰는 쪽이** — 앵커와 `currentMatch`가 같은 `moveScroll()`을 탄다. 2만 줄·앵커 1만 번째 줄에서 모든 줄이 20px 격자(총 400,020px), gutter 1440·700px 폭 모두 유지 |
| 5e | 정리 — 디자인 판단 | designer | [designer.md](designer.md) "추가 4" | **완료** — 파드 표 `로그` = **`ResourceName.logHref` 아이콘 링크**(hover·행 포커스·`hover:none`이면 항상, 파드 표 4곳 같은 규칙, 이벤트 행만 글자 링크). `가림 N건`·`생략 N줄`은 **하단 상태 줄 한 곳**(안내 줄로 그리지 않는다 — 따라가기 중 숫자가 서로 달라진다). 테스트 발송 활성 = frontend 방식이 4.2를 만족(대화상자가 최종 문). 7.2 특별한 줄 보이는 영역 가운데, 9절 `container` 허용 반영 |
| 5e | 정리 — `resolvedPods` 스트림 추가 | backend | [backend.md](backend.md) | **완료** — `hello.selector.resolvedPods` 추가(기존 `pods` 유지), 두 값 같음 테스트. PM이 코드로 확인 |
| 5e | 정리 — 특별한 줄 위치·`Button` 이중 낭독·`ResourceName.logHref` | publisher | [publisher.md](publisher.md) 07:55 | **완료** — lint·tsc·build 통과, test **634**. 전폭 특별한 줄(`dropped`·`ringTop`·`gap`)은 보이는 영역 가운데 sticky 상자(1440·700·360px에서 스크롤 0과 끝이 같은 자리). `binary`·`redactFailed`는 실제 줄을 **대신하는** 줄이라 본문 흐름에 남는다(디자인 7.2대로, 전에는 가운데였다). `Button` 사유를 이름 밖으로 — **기존 테스트 1건 수정**(`snapshot.test.tsx`: 이름에 사유가 들어 있는 것을 검사하고 있었다 → 정확한 이름 + `aria-describedby`로). `ResourceName.logHref` + 복사 버튼도 행 포커스에서 보이게 |
| 5f | 마지막 배선 | frontend | [frontend.md](frontend.md) "마지막 배선" | **완료** — test **636**. 파드 표 4곳 `ResourceName logHref`(54행 전부 아이콘, 글자 버튼 0), `로그 화면에서 열기`에 `container`만 덧붙임(`withContainer()`), 안내 줄 2종 제거, 스트림은 `resolvedPods` 한 갈래. 아이콘 클릭이 행 클릭을 일으키지 않음, `follow=1`로 스트림 0→1 |
| 6 | 검증 | PM | 아래 "6단계 검증" | **완료** — 최종 재실행: api **677 passed / 2 skipped** · web **640 passed** · lint·tsc 통과. 검증 중 **live 경로 결함 10건**(503으로 나가던 notice 3종 + 계약 어긋남 7건)을 찾아 고쳤고, 되살아나지 않게 "mock 응답 = live 응답" 대조 테스트와 "내보내는 코드 ⊆ 계약 표" 테스트로 고정. **미검증은 "월요일 확인 목록"에 전부 있다** — 실클러스터·실제 Loki·`anchorAt`·kubelet 실문구(Q14) |
| 5b | 퍼블리싱 후속 (`onReachBottom`·칩 2종·JSDoc) | publisher | [publisher.md](publisher.md) 06:50 | **완료** — `onReachBottom`은 알리기만 하고 자동 스크롤을 켜지 않는다. **덤으로 결함 1건**: 이미 맨 아래일 때 "내가 스크롤했다" 표시가 남아 **사용자의 다음 스크롤 한 번(PageUp·End)이 무시**됐다(frontend가 `LogViewer.tsx:233` 주석으로 적어 둔 증상). 고친 부분을 되돌리면 회귀 테스트가 실패하는 것까지 확인. sticky gutter 재실측 1px 유지 |
| 5c | 통합 2차 (찾기 단축키·남은 높이·하이드레이션) | frontend | [frontend.md](frontend.md) 06:50 | **완료** — `Enter`/`Shift+Enter`(한글 조합 중 무시), **찾기 이동이 카운터만 바꾸고 화면을 안 옮기던 것**도 고침. `/logs` 남은 높이(최소 360px). 파드 목록 진입점은 3차로 미룸(서버 링크 규칙 대기였다) |
| 5d | 통합 3차 (L2 진입점·합쳐보기·폴백 제거·앵커·링버퍼 멈춤) | frontend | [frontend.md](frontend.md) 07:40 | **완료** — lint·tsc·build 통과, test **625**(+14). **`features/logs/href.ts`의 링크 만드는 함수를 삭제** — 이제 읽기만 한다(규칙이 서버 한 곳). 컨트롤 플레인 폴백 제거(SSE 15개 = REST). 실측: **Q12 진입점별 켬/끔 전부 규칙대로**, AC-LOG13(0→1→0)·16·**51**(10초에 멈춤, 같은 줄·같은 스크롤 위치·2만 줄 유지)·**52**(`before_result` → `2,000줄로 다시 조회` → `found`, 1/3 지점)·**53**(다른 워크로드 줄 0), 멈춤 안내 3종, `logs=disabled` 링크 0, 프로덕션 10경로 하이드레이션 0. **미검증**: 실클러스터·Loki, `source_error`·`shutdown`·`onerror` 멈춤 화면(mock이 안 만든다), 줄 바꿈 켠 상태의 앵커 정확도 |
| 6 | 검증 | PM | | 대기 |

## 사용자 결정 (2026-09-25)
- **출처 두 가지를 모두 만든다.** 로그 스택(Loki 등)이 설정돼 있으면 그쪽, 없으면 `pods/log` 직접 조회.
  회사 클러스터에 로그 스택이 있는지 **아직 모른다** — 월요일 확인 후 어느 쪽을 쓸지 정해진다.

## PM 결정
| # | 결정 |
|---|---|
| Q2 | **가린 값의 원문 보기를 허용하지 않는다** (planner 설계 유지). 원문 보기를 열면 마스킹이 "불편함"이 되고 사람들은 결국 항상 원문을 본다 — 그러면 안 가린 것과 같다. 가림 규칙이 과하면 **규칙을 조정**하는 방향으로 간다 |
| Q3 | **사이드바에 `로그` 메뉴를 만든다.** 알림도 사이드바로 가기로 했으므로 일관된다. 상태 점은 없다(로그 내용으로 상태를 판단하지 않는다) |
| Q4 | 클러스터 안 배포 시 `LOGS_ENABLED` **기본 false** |
| Q6 | 내려받기 버튼 **없음** |
| Q7 | 로그 기반 알림 규칙은 **이번 범위 밖** — 판단 기준이 alerts와 logs 두 곳에 생기면 안 된다 |

## 이 기능에서 가장 중요한 것 — 비밀값
`pods/log`를 여는 것은 **기존 원칙(secrets 제외, pods/log 제외)의 예외**다. CLAUDE.md에 "완화 수단을 명세가 반드시 정한다. 이 항목 없이 구현하지 않는다"로 못 박았고, planner가 원칙 7개로 답했다:
1. 가림은 **서버**에서 (화면에 원문이 도달하지 않는다)
2. **끄는 설정이 없다** (규칙 추가만 가능)
3. **원문 보기 없음** — 규칙 이름 + `앞 2글자****(N자)` 표기
4. **"마스킹은 완벽하지 않다"를 닫을 수 없는 문구로 상시 표시**
5. DB·디스크·API 자체 로그·브라우저 저장소 **어디에도 저장하지 않음**, 내려받기 없음
6. 어드바이저 격리 (로그 본문이 스냅샷에 들어가지 않는다)
7. fail-closed

**식별자(IP·`i-0…`·ARN)는 가리지 않는다.** 로그는 어드바이저로 나가지 않고, kOps에서 인스턴스 ID를 가리면 "어느 노드인지"를 알 수 없어 조사가 불가능해진다. 알림 본문 결정(원문 사용)과도 일관된다.

## 가림 표식 위치 정정 — 검증 조건까지 바꾼 처리 (2026-09-25)
designer 판단(줄 오른쪽 → **왼쪽 sticky gutter**)을 채택하고 planner가 명세를 맞췄다. **지목한 1곳 외에 5곳을 더 찾아** 전수 정리했다(S1 시나리오, AC-LOG07, 3.8.3 `줄 바꿈` 토글 행, 3.3.2, 7절 디자인·퍼블리싱).

**가장 중요한 처리**: **AC-LOG07에 "`줄 바꿈`을 끄고 가로로 끝까지 스크롤해도 사라지지 않는다"를 넣었다.**
> 위치만 적으면 "왼쪽에 뒀으니 됐다"로 끝나고 **sticky가 아닌 왼쪽 열**(스크롤과 함께 밀리는 구현)을 못 잡는다. 문제의 본질은 위치가 아니라 **사라지지 않는 것**이다.

용어도 정리했다 — gutter 안의 것은 **"칩" → "표식"**. 이 문서에서 `칩`은 컨테이너 칩·능력 배지 같은 **본문 흐름 안 요소**를 가리켜 왔고, 같은 말로 부르면 인라인 칩으로 구현될 여지가 있다.

그리고 **명세는 위치와 불변 조건만, px 같은 구체값은 `docs/design/logs.md`가 정본**으로 분리했다. 명세가 px를 들고 있으면 두 문서가 어긋난다.

**publisher 경고(planner)**: 가상 스크롤 + 긴 줄 가로 스크롤 + `sticky` 조합은 **가로 스크롤 컨테이너 위치에 따라 sticky가 안 먹는 경우가 있다.** 긴 줄을 실제로 만들어 확인해야 한다 → 퍼블리싱 지시에 포함함.

## 가정 A7 결론 + `sql_statement` 규칙 (2026-09-25)
planner가 A7의 "PM 판단 대기"를 **결론 4줄**로 바꿨다: ① A7이 **덮는 것**(모니터링 계정의 조회 — 이 규칙은 변하지 않는다) ② **덮지 않는 것**(`logs`가 읽는 DB 파드 컨테이너 로그) ③ **완화 위치**(`logs` 3.3.2의 `sql_statement`, "A7을 고쳐서 해결하는 문제가 아니다") ④ **왜 DB 설정을 안 바꾸나**("되돌아오지 말 것").

④를 쓴 방식이 좋다 — **이유를 하나만 적으면 "일시 설정이면 되잖아"로 우회**하므로, 원칙 위반(관측 대상에 쓰기)과 **운영 손해(DBA가 장애 원인을 못 본다)를 함께** 적었다.

**개수 문제는 숫자를 고치는 대신 규칙으로 막았다.** 본문에 원래 "10종"이라는 숫자가 없었고(검색 확인), 그래서 고칠 숫자 대신 **"규칙은 앞으로 늘어난다. 개수를 본문·화면·테스트에 숫자로 박지 않는다. 목록이 정본이다"**를 넣었다.
> 숫자를 고치는 것보다 숫자를 쓰지 말라는 규칙이 오래 간다.

**AC-LOG49 신설**(맨 뒤, 기존 번호 안 밀림). 기존 AC-LOG04에 끼우지 않은 이유가 정확하다 — 그 AC는 "`앞 2글자****(N자)` 형태로 보인다"를 검사하는데 `sql_statement`는 **치환 결과가 달라서(`?`) 끼워 넣으면 AC가 자기모순**이 된다.

## 확인된 구멍과 보강 — 재사용 권고가 틀렸다 (2026-09-25)
**`maskSqlLiterals()`가 `DETAIL: Key (email)=(a@b.com) already exists.` 줄을 잡는지 확인되지 않았다.**
`DETAIL:`은 **SQL 문장이 아니라 Postgres가 붙이는 설명 줄**이라, SQL 리터럴을 전제로 만든 기존 함수가 그대로는 못 잡을 수 있다. **그런데 이 건을 시작한 이유가 바로 그 줄에 개인정보가 들어간다는 것이었다** — 여기서 못 잡으면 조치가 목적을 달성하지 못한다.
**실측 결과: planner 지적이 맞았다. 게다가 구멍이 하나 더 있었다.**

**못 잡던 것** (실측 12종 중):
- `DETAIL:  Key (email)=(a@b.com) already exists.` → **아무것도 안 바뀜.** 이 건을 시작한 바로 그 케이스가 누출됐다
- `Failing row contains (1, alice, a@b.com, …)` → **숫자만 `?`, 문자열은 남음** (행 전체가 사용자 데이터라 더 위험)
- `invalid input syntax for type integer: "abc"` → 그대로

원인: `maskSqlLiterals`는 **SQL 리터럴 스캐너**라 따옴표·숫자만 본다. `Key (email)=(a@b.com)`의 값은 **따옴표 없는 맨 토큰**이라 SQL 문법상 리터럴이 아니다.

**반대 방향 구멍 (DBA가 스스로 찾아 정정 보고)**: 줄 **전체**에 그 함수를 돌리면 `2026-09-24 12:00:00.123 UTC [123]` → `?-?-? ?:?:? UTC [?]`가 된다. AC-LOG49의 "구조는 남음"에 정면으로 어긋나고, **목적도 못 이루면서 로그도 못 읽게 된다.** DBA가 "제 원래 권고는 여기까지 검증하지 않고 낸 것"이라고 실수를 명시해 보고했다.

**보강 방식 — 규칙을 두 벌로 만들지 않았다.** 리터럴 스캐너는 그대로 재사용하고 **"값이 오는 자리"를 찾는 계층**을 얹었다:
- `maskPgDetailValues()` — `Key (cols)=(?)`, `Failing row contains (?)`. **컬럼 이름은 남는다**
- `maskPgLogValues(line)` — 위 + `parameters:` + **마커(`STATEMENT:`/`QUERY:`/`statement:`/`execute <name>:`) 뒤쪽에만** 스캐너 → **타임스탬프·PID·제약 이름 보존**
- `createPgLogValueMasker()` — 줄 단위 상태 보존 래퍼(여러 줄 문장)

설계 판단 둘: ① 값 목록을 **쉼표로 쪼개지 않는다**(값에 쉼표가 들어갈 수 있어 개수를 믿을 수 없다) ② 여러 줄은 **상태를 쓴다** — 무상태로 "들여쓴 줄 = SQL"로 처리하면 앱 스택 트레이스의 줄 번호까지 `?`가 된다(테스트로 고정).

`redactSecrets`에는 **`maskPgDetailValues`만** 편입했다(마커 기반 SQL 마스킹 제외 — 일반 오류 문자열에서 숫자까지 `?`가 되면 과하다).

검증: AC-LOG49 전부 통과, 남아야 할 것도 확인, 기존 경로 회귀 없음, jest **502 passed**(489 → +13).
**못 한 검증**: 실제 파드 로그(손으로 재현한 12종). 다만 규칙이 **접두어를 파싱하지 않고 마커만 찾아** `log_line_prefix` 설정에 영향받지 않게 만들었다. 오퍼레이터의 **JSON 로그 형식**은 값은 가려지지만 구조 안 동작 미실측.

## 실제 브라우저가 또 잡았다 — planner 경고가 정확했다 (2026-09-25)
**1. sticky gutter가 풀리는 구조였다.** planner가 "가상 스크롤 + 긴 줄 가로 스크롤 + `sticky` 조합은 컨테이너 위치에 따라 안 먹을 수 있다"고 경고한 바로 그 함정이었다.
원인: 줄을 `position:absolute`로 띄우면 **부모의 `max-content` 폭에 기여하지 않아** 줄 상자가 화면 폭이 되고, 가로 끝까지 스크롤하면 표식이 사라진다.
해결: **위·아래 여백 div + 정상 흐름 줄**. 실측 — 스크롤 폭 2,324px에서 끝까지 밀어도 gutter가 본문 왼쪽 +1px 유지, **2만 줄(scrollHeight 400,000px)에서도 동일**.
→ AC-LOG07의 "가로로 끝까지 스크롤해도 사라지지 않는다"가 **없었으면 통과했을 구현**이다. planner가 위치가 아니라 불변 조건을 검사하게 바꾼 판단이 실제로 값을 했다.

**2. 배너가 뜨면 사이드바 아래 40px이 화면 밖으로 나갔다.** `globals.css`가 항상 `100dvh−56px`인데 `shell.md` 3.3은 배너 시 `−96px`이다. **전에는 그 자리에 `메뉴 접기`뿐이라 안 보였는데, 이제 `설정`이 있어서 드러났다.** `:has(> .app-banner)`로 보정.

## PM 결정 — `RedactionNotice` preset 승인 (2026-09-25)
퍼블리셔가 마스킹 경고를 `InlineAlert` **preset으로 박제해 `closable`을 줄 수 없게** 만들었다(20줄). **승인한다.**
근거: "닫을 수 없어야 한다"를 문서 규칙으로 적어두는 것보다 **prop 자체를 없애는 쪽**이 확실하다. DBA가 웹훅 원문 노출을 `SETTING_DEFAULTS`에서 빼 **컴파일되지 않게** 만든 것과 같은 방식 — 이 저장소에서 반복해서 효과를 본 패턴이다.
새 카탈로그 컴포넌트가 아니라 preset이라 designer의 "새 컴포넌트 5개" 설계는 그대로다.

## 규칙 `id`를 화면에 내보내지 않는다 (designer, 2026-09-25)
`LogSegment.rules`를 계약대로 **`{id, label}`**로 정정하면서, **팝오버에는 `label`만 그리고 `id`(`conn_string` 같은 값)는 `sr-only`에도 넣지 않는다**는 규칙을 함께 넣었다.
> 매핑 표를 화면이 들고 있으면 규칙이 늘 때마다(이미 10 → 11종) **매핑이 빠진 규칙에서 코드가 사용자에게 그대로 보인다.**

**`RedactionNotice` preset을 문서에도 적었다** — PM이 "조치 불필요"라고 한 항목인데 designer가 스스로 넣었다:
> 구현에만 있으면 다음 사람이 `InlineAlert`로 다시 만들면서 `closable`을 붙인다.

preset으로 prop을 막아도 **다른 경로로 우회할 수 있으면 의미가 없다**는 판단이다. `tone`·문구를 밖에서 바꾸게 열지 말 것도 함께 적었다.

## 가림이 실제로 동작하는 것을 확인했다 (2026-09-25)
mock 서버의 실제 응답:
```
2026-09-25 14:02:10.412 UTC [1834] DETAIL:  Key (email)=(?) already exists.
2026-09-25 14:02:10.413 UTC [1834] DETAIL:  Failing row contains (?).
2026-09-25 14:02:10.413 UTC [1834] STATEMENT:  INSERT INTO users (email, name) VALUES (?, ?)
```
**타임스탬프·PID·제약 이름·테이블/컬럼 이름 전부 보존**, 값만 `?`. DBA가 보강한 마커 기반 처리가 의도대로 동작한다.
응답 본문 **전체 검색**에서 `hunter2hunter2`·`AKIAIOSFODNN7EXAMPLE`·`a@b.com`·`alice`·PEM **원문 0건**(AC-LOG05). 커넥션 스트링은 `postgres://ap****(22자)@postgres.db.svc:5432/app`(AC-LOG06).
스트림 3개 후 4번째 → 503, **그때도 공용 SSE는 정상**(AC-LOG23). `?topics=logs` → 400. **어드바이저 스냅샷(30KB)에 로그·알림 문자열 0건.**

## PM 결정 — `mock/reset` 후 배지가 6인 것은 정상 (2026-09-25)
기동 직후 배지는 3인데 `POST /api/mock/reset` 직후에는 6이다. 초기화가 상태 머신도 되돌려 **엔진이 현재 `cluster=mixed`(critical)를 새 전이로 다시 감지**하기 때문이다.
**그대로 둔다.** reset은 "상태를 처음으로"이지 "대시보드 재시작 시뮬레이션"이 아니다. 워밍업을 reset에도 적용하면 더 일관돼 보이지만 **검증자가 120초를 기다려야 해서** mock의 목적(빠르게 눈으로 확인)에 어긋난다.
→ 계약 mock 절에 근거와 함께 적도록 지시했다. **안 적으면 검증하는 사람이 버그로 본다.**

## PM 정정 — 단계 번호를 잘못 불렀다 (2026-09-25)
PM이 "L2"라고 지시한 **외부 로그 스택은 명세상 L3(AC-LOG35~48)**다. **L2는 동선·컨트롤 플레인(AC-LOG25~34)**이다. backend가 지시받은 범위를 정확히 해내고 번호 불일치를 보고했다.
**명세가 정본이다. PM 지시가 틀렸다.** 진행 기록을 아래로 정정한다:
- **L1 완료** (직접 조회·가림·전용 스트림)
- **L3 완료** (외부 로그 스택 — 능력 칩·서버 검색·기간·여러 파드 합쳐보기·자동 전환 없음·스택 출처에도 같은 가림·LogQL 비노출)
- **L2 일부 완료** — `ControlPlaneComponent.logHref`(아래 승인). 나머지 동선(이벤트·워크로드·DB 화면 진입점)은 **미완**
- L4는 착수 안 함

## PM 승인 — `ControlPlaneComponent.logHref` 추가 (2026-09-25)
원래 L2 항목인데 backend가 앞당겨 넣었다. **승인한다** — frontend가 지금 컨트롤 플레인 매트릭스를 통합 중이라 없으면 그 동선을 못 만든다. **추가 전용 nullable 필드**라 기존 계약을 깨지 않는다.
링크 판단 규칙을 `logs/log-href.ts`(잎 모듈)로 빼서 **알림과 컨트롤 플레인이 같은 함수**를 쓰게 한 것도 맞다 — 규칙이 두 벌이면 한쪽만 고쳐져 어긋난다. `LOGS_ENABLED=false`일 때 **두 곳이 함께 막히는 것**을 기동으로 확인했다.

## PM 결정 — 통합 1차에서 올라온 것 (2026-09-25)
frontend가 명세·디자인과 다르게 만든 2건과 질문 1건이다. **셋 다 명세와 디자인 문서가 결정을 따라가도록 이번 턴에 함께 고친다**(alerts 벨 사건의 교훈 — 결정 기록과 작업 지시서가 갈라지면 안 된다).

| # | 결정 | 근거 |
|---|---|---|
| D1 | **파드 상세의 로그는 `탭` 대신 `섹션 + 기본 접힘`으로 한다** (frontend L1 채택) | 명세·디자인은 "기존 탭(개요·컨테이너·이벤트) 옆에"를 전제했는데 **실제 파드 상세에는 탭이 없다**(섹션 나열). 항상 펼친 섹션이면 파드 상세를 여는 사람마다 스트림 슬롯(최대 3개)을 하나씩 쓴다. 접힘 = 연결 없음, 펼침 = 따라가기 켬으로 탭과 같은 의사 표시가 된다. 실측: 펼치기 전 `streams.open 0` → 펼친 뒤 `1` → 떠나면 `0`. → planner가 AC-LOG13·시나리오·진입점 표를, designer가 `design/logs.md` 9절을 맞춘다 |
| D2 | **위로 스크롤하면 자동 스크롤만 멈추고 `따라가기`(연결)는 유지한다** (frontend L2 채택) | 명세 4절은 "따라가기를 끄면 서버가 연결을 닫는다"고 하면서 AC-LOG16은 "위로 스크롤하면 따라가기 해제 + `새 줄 N개` 버튼"이라 **명세 안에서 서로 맞지 않았다.** 연결이 끊기면 `새 줄 N개`가 셀 줄이 없다. 스위치 = 연결, 자동 스크롤 = 화면 동작으로 나눈다. 연결을 오래 붙잡는 문제는 기존 유휴 5분 일시정지가 막는다. → planner가 AC-LOG16·3.8.3을, designer가 7.4를 맞춘다 |
| D3 | **`logHref`의 `follow=1`: 컨트롤 플레인 매트릭스는 붙이고 알림은 붙이지 않는다** | 디자인 6.2는 "파드 상세·**매트릭스**에서 들어오면 켬"이고 알림은 적혀 있지 않다(frontend 보고의 "알림·매트릭스"는 과하게 읽은 것). 알림 링크는 **그 시각(`at`)을 보러 가는 링크**라 따라가기를 켜면 맨 아래로 스크롤돼 그 지점을 잃는다. 링크 규칙은 `logs/log-href.ts` **한 곳**에서 정한다(화면이 서버 링크에 파라미터를 덧붙이지 않는 frontend 판단 유지). → backend |

**frontend가 찾은 계약 결함(backend)**: `cluster` 토픽 SSE의 `ControlPlaneComponent.logHref`가 **항상 `null`**이다(REST는 값이 있다). 매트릭스는 스트림으로 그리므로 frontend의 `podKey` 폴백이 없으면 로그 동선이 통째로 사라진다. 고친 뒤 **통합 3차에서 폴백을 지운다** — 규칙이 서버와 화면 두 곳에 있으면 `LOG_DENY_NAMESPACES`가 한쪽만 먹는다.

### planner가 반영 중 올린 확인 요청 3건 — PM 결정 (2026-09-25)
planner가 D1~D3을 명세에 넣다가 **결정만으로 답이 안 나오는 곳 3건**을 찾아 `specs/logs.md` 9.2에 Q11~Q13으로 올렸다. (0.1의 확정 전제 D1~D9와 번호가 겹쳐 "0.1의 D□ 아님" 표기를 넣은 것도 planner 처리다.)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| Q11 | 알림 링크의 `at`을 로그 화면이 어떻게 쓰나 — **어디에도 정의가 없다**(`api/alerts.md` 예시 URL에만 있다) | **backend가 계약에 출처별로 정의한다**(5b 지시 3번에 이미 포함). Warning 이벤트 진입도 같은 `at`을 쓴다. 정의가 나오면 planner가 명세에 옮긴다 | D3은 따라가기를 꺼서 그 지점을 잃지 않게 할 뿐 **그 지점으로 데려가지는 않는다** — planner 지적대로 목적의 절반이다 |
| Q12 | 진입점 2·4·5·7의 따라가기 기본값 | **규칙 하나로 정한다: "지금 상태"를 보는 화면에서 들어오면 켬, "지난 시점"을 가리키는 곳에서 들어오면 끔 + `at`.** 켬 = 파드 상세(펼칠 때)·파드 목록 행·컨트롤 플레인 매트릭스·워크로드 상세·DB 상세. 끔 + `at` = 알림·Warning 이벤트. 끔 = 사이드바 `/logs`(대상이 아직 없다) | 진입점마다 따로 정하면 다음 진입점이 또 질문이 된다. 규칙이면 새 진입점도 답이 나온다. 링크는 `buildLogHref` 한 곳이 만든다 |
| Q13 | D2로 위로 올려 읽는 동안에도 줄이 쌓여, 링버퍼 2만 줄을 넘으면 **읽던 줄이 위에서부터 지워진다**(초당 상한 2,000줄이면 약 10초) | **위로 올려 읽는 중에 링버퍼가 가득 차면 따라가기를 멈춘다**(연결을 닫고 Switch가 꺼진다) + 닫을 수 없는 안내 + `다시 시작`. 맨 아래에서 자동 스크롤 중이면 지금처럼 위에서부터 버린다 | D2의 목적이 "읽던 자리를 잃지 않게"인데 10초 만에 그 자리가 지워지면 D2가 무의미하다. 멈추는 것은 **예외 상황에서만** 일어나고 Switch가 꺼지므로 "스위치 = 연결" 규칙도 그대로다(유휴 일시정지와 같은 결). 링버퍼는 화면 상수라 **프론트 몫**이고, 문구는 designer가 정한다 |
| — | 스트림 상한 문구 "다른 탭의 로그 화면을 닫아 주세요"가 D1 이후 틀렸다(펼친 파드 상세 섹션도 슬롯을 쓴다) | **`로그 보기를 동시에 N개까지 열 수 있습니다. 다른 탭의 로그 화면이나 펼쳐 둔 파드 상세 로그를 닫아 주세요.`** 로 바꾼다(명세 planner · 디자인 8.5 designer · 서버 문구가 있으면 backend) | 사용자가 슬롯을 차지한 것을 찾지 못하면 상한 안내가 쓸모없다 |

**planner 반영 후 남은 작은 것 4건 — PM 결정** (전부 "스위치 = 연결" 원칙에서 나온다)
1. **연결이 닫히면 이유와 상관없이 Switch는 꺼진다** — 유휴 일시정지·최대 지속·링버퍼 멈춤·`log.closing` 모두. 스위치가 켜져 있는데 줄이 안 오는 상태를 만들지 않는다.
2. **`다시 시작`을 누르면 맨 아래 + 자동 스크롤 재개**(`새 줄 N개` 버튼과 같다). 새 연결의 첫 배치가 화면을 다시 채우므로 읽던 자리를 지킬 방법이 없고, 그러니 누르기 전에 안내가 그 사실을 알려야 한다(designer).
3. **링버퍼 멈춤에는 서버 코드가 없다.** 링버퍼는 화면 상수라 화면이 판단하고 안내를 만든다(`ringTop` 줄과 같은 결). 문구는 designer.
4. **AC-LOG51을 mock에서 재현할 수 있게** 초당 상한 가까이 흘리는 mock 시나리오를 backend가 만든다(2만 줄이 수십 초 안에 차야 확인할 수 있다).

**designer가 새로 정한 것 — PM 채택** (2026-09-25)
- 맨 아래까지 **직접** 내려도 자동 스크롤은 다시 켜지지 않는다(N만 0). 다시 붙는 길은 버튼 하나다. 기존 7.4 근거("의도 없이 켜지면 읽던 자리를 잃는다")와 같다.
- 연결이 닫혀도 **받은 줄은 지우지 않는다.** `log.paused`를 받으면 화면이 `close`를 불러 슬롯을 돌려준다.
- 파드 상세 접힌 줄에서 `비밀값은 서버에서 가려서 옵니다`를 뺐다 — **"완벽하지 않다" 없이 안심만 시키는 반쪽 문장**이라서. 원칙 4(닫을 수 없는 경고)와 어긋난다.
- 유휴 문구를 `이 화면이 5분 동안 보이지 않아…`로 — 서버는 조작이 아니라 `touch`(보일 때만 온다)로 판단하므로 "조작이 없어"는 사실과 다르다.

### backend 5b에서 드러난 것 + PM 확인 (2026-09-25)
**`at`은 계약 예시에만 있었고 실제 알림 링크에 한 번도 들어간 적이 없었다.** planner가 Q11로 "정의가 없다"를 짚었는데, backend가 확인해 보니 **값 자체도 안 들어가고 있었다.** 지금은 `occurredAt`이 들어간다. 정의(2.2.1): 화면은 `at`을 `anchorAt`으로 보내고 **범위는 서버가 정한다**(direct: `at` 2분 전 ~ 지금 / stack: ±5분). 못 찾으면 `LOG_ANCHOR_*` 안내가 이유와 제안을 준다. 스트림에 `anchorAt`을 보내면 400 — 따라가기와 앵커는 함께 쓰지 않는다(D3과 일관).

**backend가 스스로 찾아 고친 결함 4건**: ① `stack`에서 `selector.workload`만 주면 **네임스페이스 전체를 검색**했다 → 현재 파드 + 지난 1시간 삭제 파드(최대 20개)로 풀고 `resolvedPods`로 알린다 ② `logs=disabled`에서 링크가 남았다 ③ `logTarget.stackSearch`가 항상 false ④ targets의 워크로드 링크가 ReplicaSet을 가리켰다.

| # | 확인 요청 | PM 결정 |
|---|---|---|
| 1 | Warning 이벤트의 `at` = `lastSeenAt` | **승인.** 반복 이벤트(`BackOff` 등)의 첫 발생은 `direct`의 보관 범위(최신 파일·재시작 1세대) 밖일 가능성이 크고, 지금 조사하는 것은 가장 최근 발생이다 |
| 2 | mock `area:pods` 최신 알림 픽스처를 mock 클러스터(`mixed`)에 **실제로 있는** 파드로 바꿨다 | **승인.** 그대로면 mock에서 알림 → 로그가 언제나 "사라진 파드" 화면이라 앵커를 눈으로 볼 수 없다. **단 "사라진 파드" 경우도 mock에서 계속 보여야 한다**(다른 픽스처가 없는 파드를 가리키는지 통합 3차에서 확인) |
| 3 | `stack` 워크로드 → 파드 해석의 "지난 1시간·최대 20개" | **기본값으로 채택.** 명세에 옮긴다(planner). 실환경 Loki 보관 기간을 보고 조정할 값이다 |
| 4 | (planner 제안) 워크로드 해석 결함은 **명세 문장으로만** 막혀 있다 — AC-LOG39는 다른 워크로드 줄이 섞여도 통과한다 | **AC-LOG53 신설**(맨 뒤, AC-LOG39는 그대로). "그 워크로드에 속하지 않은 파드의 줄이 0줄". 고쳐진 결함에 AC가 없으면 조용히 되살아난다 — AC-ALERT36(벨)과 같은 이유 |

명세는 AC-LOG01~53(52 = 알림·이벤트 → 그 시각 줄 앵커, 53 = 워크로드 해석 회귀). planner 5차 "추가 반영 3·4".

### 통합 3차 frontend 지시 목록 (backend·publisher 5b가 끝난 뒤)
1. L2 진입점: 파드 목록 행·Warning 이벤트 행·워크로드 상세·DB 상세 — **서버 `logHref` 그대로**, 화면이 파라미터를 덧붙이지 않는다
2. `/logs` 워크로드 선택기 + `stack` 합쳐보기(`pods[]`, RL2)
3. `ControlPlaneSection`의 `podKey` 폴백 **제거**(SSE 결함 수정 확인 후)
4. `at` 처리 — backend 계약 정의대로
5. designer 변경 5가지: 접힌 줄 가림 문장 삭제 / 맨 아래 닿으면 N=0(`onReachBottom`) / **링버퍼 멈춤**(AC-LOG51 — 안내 문구의 "2만 줄"은 **상수에서 만든다**, 상수와 문구가 갈라지지 않게) / 연결이 닫히면 Switch 끔 + 받은 줄 유지 + `log.paused` 때 `close` / 진입점 따라가기 규칙(Q12)
6. mock 새 시나리오로 `log.notice`·`log.paused`·`log.closing` 화면 확인(RL1), `logs=flood`로 AC-LOG51 확인
7. 발송 칩 2종이 목록에 그려지는지 mock `alerts=webhook-failed`로 확인(코드 변경 없어야 한다). `in DISPATCH_SPEC` 검사를 publisher의 `isDispatchState()`로 바꾸고 `features/alerts/types.ts:37`의 낡은 주석 정리
8. `onReachBottom` 배선: `setScrollAnchor((cur) => (cur === null ? cur : lines.length))` — N=0, 자동 스크롤은 꺼진 채(publisher 제안). `LogViewer.tsx:233`의 우회 주석이 publisher 수정으로 필요 없어졌는지 확인
9. 알림 → 로그 앵커 표시(designer "추가 2" 결과대로), AC-LOG52·53 확인. mock에서 **"사라진 파드" 화면도 여전히 보이는지** 확인

### 3차 뒤 정리 목록 (frontend가 같은 컴포넌트를 쓰는 중이라 미룬다)
1. **특별한 줄(링버퍼 안내 등, 디자인 7.2)이 가로 스크롤하면 화면 밖으로 밀린다** — 줄 전체 폭 기준으로 가운데 정렬돼 있다. publisher가 앵커 구분 줄은 **보이는 영역 가운데**에 두게 만들었으니 같은 방식으로 맞춘다. `status.md` 3.1("확인 필요 표시는 레이아웃 사정으로 사라지지 않는다")과 sticky gutter를 고친 이유와 같다. → publisher 구현 + designer가 7.2에 한 줄
2. **`Button`의 비활성 사유가 버튼 이름 안에도 들어가 스크린리더가 두 번 읽는다**(기존 동작). 사유는 설명(`aria-describedby`)에만 둔다. 기존 테스트 여러 개가 이름을 검사하므로 **테스트 수정이 불가피하다** — 수정 이유를 남기는 조건으로 허용. → publisher
3. `apps/web/tsconfig.json` 되돌리기 — 모든 build·dev 서버가 끝난 뒤 **PM**이 diff 확인 후 `git checkout`

**3차에서 올라온 것 — PM 결정** (2026-09-25)
| # | 건 | 결정 |
|---|---|---|
| 4 | 파드 상세 `로그 화면에서 열기`가 **고른 컨테이너를 잃는다**(frontend가 "서버 링크에 덧붙이지 않는다" 규칙을 지켰다) | **`container` 하나만 덧붙이는 것을 허용한다.** 그 규칙의 대상은 **정책**(링크를 줄 수 있나, 따라가기 켬/끔, `at`)이고, 컨테이너는 사용자가 방금 화면에서 고른 **상태**다. 링크를 줄 수 있는지는 여전히 서버 `logHref`가 있느냐로만 정한다. 다른 파라미터는 계속 덧붙이지 않는다 |
| 5 | 파드 목록 행의 `로그`가 항상 보이는 버튼이다. frontend는 `ResourceName`에 `logHref` prop(매트릭스처럼 hover 아이콘)을 publisher에 요청 | **designer가 정한다.** 디자인 0절은 "행위 메뉴 → 로그"다. hover에서만 보이는 링크는 터치·키보드에서 못 찾는다는 점을 함께 판단 |
| 6 | `LOG_REDACTED` 안내 줄이 하단 상태 줄의 `가림 N건`을 되풀이한다 | **designer가 하나로 정한다** |
| 7 | 테스트 발송 버튼 활성은 서버 값(설정됨·켜짐·쿨다운)으로, 대화상자만 `preview.canSend` — 디자인 4.2를 만족하나 | **designer 확인** |
| 8 | 스트림 `hello.selector.pods` ↔ 조회 응답 `selector.resolvedPods` 이름이 다르다 | **backend가 스트림에도 `resolvedPods`를 추가 전용으로 넣는다**(기존 필드 유지). 같은 것을 두 이름으로 부르면 화면이 두 갈래 코드를 든다 |

**L2 남은 것**: 진입점 4·5·7(Warning 이벤트 행·워크로드 상세·DB 상세) + 진입점 2(파드 목록 행의 `로그`, L1인데 빠졌다) + `/logs`의 워크로드 선택기 + `stack` 합쳐보기 선택기(RL2). 링크를 줄 수 있는지는 **서버 규칙(`buildLogHref`) 한 곳**이 정하도록 backend가 계약에 먼저 적는다.

## 6단계 검증 — PM 직접 확인 (2026-09-25)
명령 결과(api 648 passed / web 636 passed, lint·tsc·build 통과)는 `alerts/README.md` 같은 절에 있다.

**비밀값 관련 AC — mock API(:3151)에 직접 요청**. mock `logs=secrets`, 파드 `prod/api-qfvhtjhs2-wbf44`, `POST /api/logs/query` 500줄
| AC | 확인 | 결과 |
|---|---|---|
| 05 | 응답 전체에서 원문 검색 | `hunter2hunter2`·`AKIAIOSFODNN7EXAMPLE`·`s3cr3t-p4ssw0rd`·`a@b.com`·`alice`·`BEGIN RSA PRIVATE`·JWT 앞부분 **전부 0건**. 가림 구간 9개 |
| 49 | Postgres 실패 줄 구조 | `UTC [1834] DETAIL:  Key (email)=(?)`, `INSERT INTO users (email, name) VALUES (?, ?)` — **타임스탬프·PID·컬럼 이름 보존, 값만 `?`**, 규칙은 `label`만 |
| 22 | `GET /api/stream?topics=logs` | **400** |
| 22 | 공용 SSE 전체 토픽 8초 수신(토픽 11종) | 로그 본문·`segments`·가림 규칙 흔적 **0건** |
| 6절 원칙 6 · 21 | 어드바이저 `GET /api/advisor/snapshot-preview`(30,637바이트) | `segments`·`DETAIL:`·`[boot]`·`hunter2`·`alertKey`·`logHref`·`/logs?`·웹훅 토큰 **전부 0건**. 브리지 `tools: []`·`allowedTools: []` 그대로 |
| 09 | 가림 끄는 스위치 검색(`REDACT*_OFF/DISABLE/ENABLED`·`showRaw` 등, `apps/**`) | **0건** |
| 11 | `schema.prisma` 모델 11개 중 로그 테이블 없음 · `features/logs·alerts·settings`에 브라우저 저장소 사용 0(주석뿐) · **PM이 띄운 API 프로세스 자체 로그 126줄에 비밀값·로그 본문 0건**(비밀값 로그 조회·가짜 웹훅을 거친 뒤) | 통과 |
| 15 | `selector.previous: true` → **다른 내용**(`1.4.1 (previous generation)` … `OOMKilled`) · `logs=empty`에서 `LOG_PREVIOUS_NOT_AVAILABLE` + 요청의 `previous`는 `true` 그대로(스위치를 되돌리지 않는다). **실클러스터 경로(쿠버네티스 400 → 이 안내로 바꾸는 `direct-source.ts`)는 테스트가 없다** → backend에 추가 지시. mock은 파드별 재시작 여부를 로그에 반영하지 않는다(한계) |
| 15 (후속) | backend 테스트 추가(`direct-source.spec.ts` 4 · `logs.service.live.spec.ts` 3) | **테스트를 쓰다가 live 결함 1건이 드러났다**: live `POST /api/logs/query`에서 `LOG_PREVIOUS_NOT_AVAILABLE`·`LOG_CONTAINER_NOT_STARTED`가 **503 오류**로 나갔다(계약·mock은 200 + notice). 원인 하나는 `@kubernetes/client-node` 2.0이 400 본문을 넘기지 않아 "컨테이너 시작 전"을 메시지로 구분할 수 없던 것 → informer 캐시(한 번도 돌지 않은 대기 컨테이너)로 판단. **mock만 보고는 절대 못 찾았을 결함**이다. 같은 성격의 `LOG_KUBELET_UNREACHABLE`(여전히 503)도 **계약대로 200 + notice로 맞추라고 지시**(PM) |
| 41 | `logs=stack`, `source: stack` 494줄 | 가림 규칙 **10종**이 걸려 가림 구간 46개, 원문 7종 **0건**, LogQL·`{namespace=` **0건** |

### 검증에서 드러난 live 경로 어긋남 7건 — PM 결정 (2026-09-25)
backend가 AC-LOG15 테스트를 쓰다가 찾은 결함(503으로 나가던 notice 3종)을 고친 뒤, **같은 성격을 전수 조사**해 7건을 더 올렸다. 모두 **mock은 계약대로인데 live만 다른** 경로다 — mock에서 화면을 보고 만들었으므로 그대로면 **월요일에 화면이 깨진다.**
원칙: **mock과 live가 같은 모양. 계약이 정본.**
| # | 건 | 결정 |
|---|---|---|
| 1·2·4 | `LOG_BACKEND_UNAVAILABLE`·`AUTH_FAILED`·`SOURCE_NOT_CONFIGURED`가 live 조회에서 503 | **200 + notice**(mock `stack-down`과 같은 모양) |
| 3 | `LOG_BACKEND_QUERY_REJECTED`가 502 | 계약 표대로 **200 + notice**, 사유는 가림 후 `details.reason` |
| 5 | kubelet 판단 문구가 4종뿐 | `TLS handshake timeout`·`error dialing backend` 추가. `context deadline exceeded`는 apiserver 자체일 수 있어 제외 → **월요일 실문구 확인** |
| 6 | `LOG_CONTAINER_NOT_STARTED` — 스트림은 엉뚱한 코드로 닫히고, 명세의 "시작되면 자동으로 표시"가 **어디에도 구현돼 있지 않다** | 스트림: 이 코드 + **informer로 Running을 기다렸다 붙는다**(기존 상한 유지, mock 시나리오 추가). 정지 조회: 지킬 수 없는 약속을 하지 않는다 — `…따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.` |
| 7 | `LOG_UPSTREAM_ERROR`가 계약 표에 없다 | 오류(503)로 남는 게 맞다 — **계약 표에 행 추가** |

**결과 (backend 09:05)**: 7건 전부 반영, jest **677 passed / 2 skipped**(+18), lint·build 통과. 되살아나지 않게 만든 장치 3가지 — ① **코드별 "mock 응답 모양 = live 응답 모양" 대조 테스트 6건**(스택 쪽은 실제 `LokiAdapter`를 로컬 HTTP 서버의 닫힌 포트·401·400에 붙였다) ② **"`src/logs`가 내보내는 코드 ⊆ 계약 6절 표" 테스트** — 이것 때문에 표에 없던 기존 코드 **8종**(`LOG_BACKEND_CONFIGURED`·`LOG_DIRECT_*` 4·`LOG_STREAM_ENDED`·`CLOSED`·`SHUTDOWN`)도 표에 올라갔다 ③ live가 낼 수 있는 안내마다 **mock 짝 시나리오**(`container-starting`·`stack-auth-failed`·`stack-rejected`·`kubelet-unreachable`) — 화면이 월요일 전에 모든 안내를 볼 수 있다. 덤으로 `LOG_EMPTY`가 실패 안내와 겹치던 것을 정리. mock 실측: `container-starting` 스트림이 안내(0초) → heartbeat → **30.1초에 줄이 붙고 연결 유지**.
→ **planner 완료**("추가 반영 6"): 3.4 문구 분리 + 4절 갱신 주기 표("자동으로 1회 조회" → 정지 조회는 자동 재조회 없음) + 7절 번역 목록 + 3.4↔계약 6절 대조에서 낡은 문구 3곳 정정(`IDLE_PAUSED` "조작이 없어", `PREVIOUS_NOT_AVAILABLE` "끈 상태로"→"켜진 채", `LOG_EMPTY` 조건) + `LOG_UPSTREAM_ERROR` 행 + 9.2 **Q14**(kubelet 실문구 월요일). AC 53개 그대로. 디자인 8.4의 "자동으로 1회 조회"도 낡았다고 지적 → designer에 전달
→ **designer 완료**(09:40 "추가 5"): 7.4 "시작 전 대기" 행 — **멈춤 안내가 아니다**(info compact `live`, 닫기·`다시 시작` 없음, 본문 비움), 8.1 `Spinner`·"자동으로 1회 조회" 삭제, 8.4 전환 버튼은 `details.fallbackSource`로만, 15절 mock 8행 추가. 새 토큰·컴포넌트 **9회 연속 0**
→ **frontend 완료**(11:30): 5개 시나리오 전부 서버 문구 그대로 · 자동 전환 없음 · `container-starting` 30초 뒤 줄이 붙고 멈춤 안내 0 · `LOG_EMPTY` 겹침 0. **브라우저에서 어긋남을 확인한 뒤 최소 변경 3파일**(줄이 붙어도 대기 안내가 남던 것, 같은 코드의 notice+closing이 두 번 뜨던 것, 줄 0개 + warn 안내에 "아직 아무것도 출력하지 않았습니다"가 떠 **사실이 아니던 것**). vitest **639**, build 통과, tsconfig 되돌림. RL14(`empty`에서 안내 줄 + 본문 한 줄 중복) → **PM 결정: 8.1 본문 한 줄만** — 같은 말을 두 곳에서 하지 않는다
(앞 세션 셋이 세션 한도로 중단돼 새 에이전트가 이어받았고, 중단 전 손댄 파일은 없었다)

## 월요일 확인 목록
- **Q1**: 회사 클러스터에 로그 스택이 있는가, 있다면 제품은? (Loki / Elasticsearch / 없음) → L3 착수 판단
- 회사 Loki 라벨 이름, kOps kubelet 로그 회전 값, init 컨테이너 보관, Loki 서버 상한 (명세 0.3의 "확인 필요" 4건)
- **live 경로 실측** — 위 7건은 전부 live 대역 테스트로만 확인됐다. 실클러스터에서 ① 이전 세대 없음 ② 컨테이너 시작 전(대기 → 자동 붙기) ③ kubelet 연결 실패의 **실제 오류 문구**(`context deadline exceeded`가 어느 쪽인지 포함)를 한 번씩 본다
- **알림 앵커 `anchorAt`** — 실제 `pods/log`·Loki에서 그 시각 줄을 찾는지(mock만 확인)

## 확인된 사실 (추측 아님, 명세 0.2)
- `kubectl logs`는 **최신 로그 파일만** 준다 — 회전된 분량은 조회 불가
- `--previous`는 **1세대만**
- **파드가 삭제되면 조회 불가** — 정작 장애 조사에 가장 필요한 순간이다
- stdout·stderr **미분리** (1.32+ 알파 게이트 필요)
- `pods/log`의 `get` 권한이면 `follow`(실시간)도 동작한다

## PM 조율 (담당 지정)
- `docs/specs/cluster-status.md` 6절 정리는 **planner 한 명에게 몰아서** 지시했다(alerts와 같은 파일).
- `docs/specs/architecture-advisor.md` 3.4 제외 목록에 "컨테이너 로그 본문" 추가 — 같은 planner가 함께 처리.
- **DBA 요청 전달**: 대상 Postgres의 `log_statement` 설정 확인. DB 파드 로그에 쿼리 원문이 나오면 `cluster-status` 가정 A7과 충돌한다.
