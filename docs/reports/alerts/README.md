# alerts · 상태 알림 (2026-09-25~)

명세: [`docs/specs/alerts.md`](../../specs/alerts.md) — 수용 기준 AC-ALERT01~37(35~37은 뒤에 붙였다), 단계 P1~P3

## 진행 현황
| # | 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|---|
| 1 | 기획 | planner | [planner.md](planner.md) | **완료** — 알림 키 8개, 억제·플래핑·워밍업 규칙, 열린 질문 12건 |
| 1b | 기존 명세 반영 + 명세 본문 갱신 | planner | [planner.md](planner.md) | **완료** — 기존 명세 5개 반영, 두 명세 본문을 확정 결정에 맞춤. 명세 상태 "초안" → **"착수 가능"** |
| 2 | 디자인 (+후속 2회) | designer | designer.md | **완료 — designer 몫 종료** — 알림 센터·로그 뷰어·설정 화면·사이드바 12항목. 새 컴포넌트 5개, **디자인 토큰 추가 0건(6회 연속)**, 상단바 무변경 |
| 2 | DBA (+후속 4회) | dba | [dba.md](dba.md) | **완료** — 표 4개·enum 5개, 비밀번호 로그 노출 완화, `redactSecrets`에 웹훅 패턴. PGlite 29/29 + 8/8·jest **489**·tsc·eslint 통과. **실제 Postgres 16 미검증** |
| 3 | API 계약 | backend | backend.md | **완료** — alerts.md 882줄, 엔드포인트 7개 + SSE 토픽 `alerts`. `common.md`는 추가만(기존 필드 삭제·변경 0건). api lint·test 502 통과 |
| 4 | 퍼블리싱 | publisher | publisher.md | **완료** — 새 컴포넌트 5개 + preset 1개, 확장 8건, `SideNav` 3단 flex. lint·typecheck·build 통과, test **551**(510 → +41, 기존 테스트 수정 0건). **새 토큰 0건(7회 연속)** |
| 4 | 구현 1단계 (P1/L1) | backend | backend.md | **완료** — lint·build·tsc 통과, jest **566 passed / 2 skipped**(502 → +64). mock(3131)에서 알림 생성·배지·가림 실측. **DB 경로·실클러스터 미검증** |
| 4 | 구현 2단계 (P2 + **L3**) | backend | backend.md | **완료** — lint·build 통과, jest **590 passed / 2 skipped**(566 → +24). 설정 API·테스트 발송·디스코드 발송기·외부 로그 스택. **DB 경로·실제 디스코드·실제 Loki 미검증** |
| 5 | 통합 1차 (P1 + 로그 L1·L3 일부) | frontend | [frontend.md](frontend.md) | **완료** — 사이드바 12항목·배지·탭 제목·`/alerts`. lint·tsc·build 통과, test **566**(551 → +15, 기존 3건 문자열 수정). 브라우저(Edge)로 결함 4건 찾아 고침. **AC-ALERT37 네트워크 확인**(안 연 탭 `GET /api/alerts` 0건). `/settings`는 자리만 |
| 5b | 디자인 후속 (발송 칩 2종·`disabledReason` 주의) | designer | [designer.md](designer.md) | **완료** — `skipped_no_pair` → `제외(발생 안 보냄)`(neutral·`ban`), `skipped_circuit_open` → `발송 멈춤(연속 실패)`(neutral·`pause`). 정본 `status.md` 12.5. 경고·재개 시각은 칩이 아니라 목록 위 안내 줄이 한 번만 말한다 |
| 5b | 퍼블리싱 후속 (`DISPATCH_SPEC` 2종·`AlertItem` 좁은 폭) | publisher | [publisher.md](publisher.md) 06:50 | **완료** — lint·tsc·build 통과, test **595**(기존 수정 0). **계약 1.4와 `status.md` 12.5 표를 직접 읽어 `DISPATCH_SPEC`과 대조하는 테스트 2개** — 상태가 늘면 바로 걸린다. 모르는 상태는 터지지 않고 건너뛴다(`isDispatchState`). 좁은 폭 줄바꿈 경계 실측(440px 줄바꿈 / 452px 한 줄), 9개 폭에서 칩 말줄임 0 |
| 5b | 서버 후속 (계약 11절 문구·mock 픽스처에 칩 2종) | backend | [backend.md](backend.md) 06:45 | **완료** — 11절 "칩 없이 서버 `label`만", mock `webhook-failed`에 `skipped_circuit_open` 2·`skipped_no_pair` 1 이력(발송 경로 무변경). *publisher 보고의 "backend 몫이 아직 남았다"는 옛 정보다 — PM이 파일로 확인함* |
| 5c | 통합 2차 (P2 설정 화면 + 하이드레이션) | frontend | [frontend.md](frontend.md) 06:50 | **완료** — lint·tsc·build 통과, test **595**(자기 몫 +17). `/settings` 설정 화면(원문 URL은 `useState` 한 곳, 저장 즉시 비움, 페이지 HTML에 원문 0건). **하이드레이션: 고치기 전 `/cluster/pods`·`/nodes` 3/3 실패 → 고친 뒤 14경로×2회 0건, 프로덕션 8경로×3회 0건**. 서버 스냅샷만 되돌리면 다시 3/3 실패하는 것까지 확인. `useIsClient()` 훅은 **필요한 곳이 없어져 삭제**. **실제 DB 저장·실제 디스코드 미검증**(저장 성공은 요청 가로채기로 흉내) |
| 5d | 설정 화면 디자인 후속 | designer | [designer.md](designer.md) "추가 3" | **완료** — `settings.md` 3.6(재개 시각 없으면 앞 문장만, `마지막 발송`은 실제로 나간 시도만)·4.1·4.2(`DB 없음` 행 삭제)·4.4(429 warn)·6.1(`keys[].status`, 없으면 `—`)·6.3·10절 |
| 5d | 설정 응답 보강 (`keys[].status`·`lastDispatch` 의미·서킷 재개 시각) | backend | [backend.md](backend.md) 07:02 | **완료** — jest **645 passed / 2 skipped**(+6). `keys[].status`·`statusSince`(엔진 `keyStatus()` 그대로, 평가 전 `null` — 재시작 전 값을 현재로 보이지 않게). 재개 시각은 **기존 `circuitBreaker.resumeAt`**(P2 보고의 "항상 null"은 다른 필드 `queue.nextRetryAt`였고 이제 계산된다). **덤으로 결함 2건**: 429·재시도 대기가 `pending`으로 기록되던 것 → `failed` / 테스트 발송 성공이 서킷을 닫지 않아 "연속 실패 0건으로 멈췄습니다"가 뜰 수 있던 것 |
| 5d | mock 서킷 표시값 (디자인 3.6 둘째 줄을 mock에서 보이게) | backend | [backend.md](backend.md) 07:02 덧붙임 | **완료** — `alerts.service.ts`·`alerts.extensions.ts`(응답 층)에서만 덮는다. **PM이 파일 시각으로 확인**: `dispatch-rules.ts`·`discord-sender.ts`는 어젯밤 이후 무변경(`alert-dispatcher.service.ts` 06:58 수정은 이 지시 전의 결함 2건). `ALERTS_DISPATCH=live`면 덮지 않는다. 계약 5절에 "표시 전용" 명시 |
| 5d | publisher 요청 6건 + `anchor` | publisher | [publisher.md](publisher.md) 07:15 | **완료** — `SecretInput` 비활성, `Switch` 설명 연결, `Dialog.cancelDisabled`, `SearchInput.onKeyDown`. 스크롤 플래그 누수는 06:50에 고친 것과 같은 결함으로 확인 |
| 5e~5f | 정리 · 마지막 배선 | publisher · frontend | `logs/README.md` 5e·5f | **완료** — 공통 행은 logs 쪽에 적었다 |
| 6 | 검증 | PM | 아래 "6단계 검증" | **완료** — 최종 재실행: api **63 suites, 677 passed / 2 skipped** · web **27 files, 640 passed** · lint·tsc 통과. 작업 트리 정리 확인(dist 폴더·dev 서버 없음, `tsconfig.json` 되돌림). **미검증은 "월요일 확인 목록"에 전부 있다** — 실제 DB 저장·실제 디스코드 발송·실클러스터 |
| 6 | 검증 | PM | | 대기 |

## 사용자 결정 (2026-09-25)
| # | 결정 |
|---|---|
| Q1 | **사이드바에 "알림" 메뉴 + 안 읽은 개수 배지.** 상단바 종 아이콘은 만들지 않는다 → `shell.md` 2.1 폭 계산을 건드리지 않아도 된다 |
| Q3 | **알림 본문에 리소스 이름을 원문 그대로 쓴다.** kOps에서 노드 이름이 EC2 인스턴스 ID(`i-0…`)라 그 값이 디스코드 채널에 남지만, 사내 채널이고 **알림만 보고 바로 대응할 수 있는 것이 더 중요**하다는 판단 |

## PM 결정 (planner 권고 채택)
| # | 결정 |
|---|---|
| Q2 | `unknown`도 기본 발송, 지속 조건 5분. 시끄러우면 설정으로 끈다 |
| Q4 | 웹훅 URL은 DB `settings`에 **평문 저장**. 암호화해도 키를 `.env`에 둬야 해 보호 수준이 같다. 대신 **원문을 화면에 절대 다시 보여주지 않는다**(끝 4자 힌트만) |
| Q5 | 억제 15분 / 플래핑 30분·4회 / 워밍업 120초 / 출처 억제 3분. **전부 설정값**이므로 실환경에서 조정한다 |
| Q6 | 사이드바에 **`알림`·`로그`·`설정` 3개 추가**(로그는 `logs` 기능) |
| Q7 | 주기적 재알림은 기본 끔 — 다음 범위 |
| Q8 | 브라우저 알림·소리는 범위 밖. **브라우저 탭 제목 `(3) Sentinel`은 P1에 포함** |
| Q9 | **디스코드 도메인만 허용.** 임의 웹훅 URL은 SSRF 성격 위험 |
| Q10 | `ALERTS_DISPATCH=mock|live` (`ADVISOR_BRIDGE`와 같은 결) |
| Q12 | 이력 90일 / 2,000건 |

## PM 조치 — 명세가 확정 결정과 어긋나 있었다 (2026-09-25)
기획 당시 기본안이 **상단바 벨**이었고 사용자가 **사이드바 메뉴**를 골랐는데, **`alerts.md` 본문이 갱신되지 않은 채 남아 있었다.** 기존 명세를 정리하던 planner가 발견해 보고했다.

**가장 위험했던 것**: `alerts.md` **7절 디자인 1번이 "상단바 오른쪽 최소 폭 304px → 348px, 2.1 폭 계산 표를 다시 맞춰야 한다"**고 적혀 있었다. 이 README는 반대로 "폭 계산을 건드리지 않아도 된다"고 적혀 있어 **두 문서가 정반대로 말하는 상태**였고, **designer가 이미 그 문서를 읽으며 작업 중**이었다. 지난번 긴 FQDN 때문에 픽셀 단위로 맞춘 상단바를 건드릴 뻔했다.
→ designer에게 즉시 정정 전달(따르지 말 것 + README가 정본), planner에게 명세 본문 갱신 지시.

**함께 드러난 누락**: PM 결정 2건이 명세에 반영돼 있지 않았다 — ① "알림 본문에 로그 줄을 넣지 않는다(가린 줄도)" ② "브라우저 탭 제목 `(3) Sentinel`은 P1 포함".

**교훈**: 사용자 결정이 나오면 **README뿐 아니라 명세 본문까지** 같은 턴에 맞춰야 한다. 결정 기록과 작업 지시서가 갈라지면, 뒤에 오는 담당이 어느 쪽을 읽느냐에 따라 다른 것을 만든다.

## 벨이 되살아나지 못하게 만든 장치 (2026-09-25)
planner가 지목된 7곳 외에 **검색으로 5곳을 더 찾아냈다.** 그중 하나가 7절 퍼블리싱의 **`NotificationBell` 컴포넌트 정의** — 그대로 뒀으면 publisher가 만들었을 것이다. 나머지는 7절 프론트의 "벨 배지·패널", 9절 충돌표 2행, 10절 요약.
> "진입점 서술이 한 줄이라도 남으면 담당자가 또 벨을 만든다"

**그물 하나를 추가했다**: **AC-ALERT36 "상단바에 아무것도 추가되지 않았다"**. 문구를 지우는 것만으로는 다음에 누군가 "있으면 편하겠는데"로 되돌릴 수 있는데, 수용 기준이 있으면 검증에서 걸린다. AC-ALERT35(탭 제목)와 함께 **뒤에 덧붙여** 기존 번호를 밀지 않았다.

또 하나 좋았던 처리 — **본문에 흩어진 "→ Q□에서 PM 확인" 16곳을 전부 "결정됨"으로 고쳤다.** 열린 질문 절만 정리하면 본문은 계속 "미정"이라고 말한다. 같은 이유로 `logs.md` 8절 충돌표도 "요청" → "반영 완료"로 바꿔 중복 작업을 막았다.

## PM 결정 — 디자이너가 명세와 다르게 판단한 1건 채택 (2026-09-25)
로그의 **`가림 N` 표식을 줄 오른쪽(명세) → 왼쪽 sticky gutter(디자인)**로 바꾼 것을 **채택한다.**
근거: 로그에서 줄 바꿈을 끄면(긴 줄이 흔하다) **오른쪽 끝이 가로 스크롤 뒤로 사라진다.** 그러면 "이 줄에 가려진 값이 있다"는 표시를 볼 수 없고, 이는 `status.md` 3.1 **"추정·확인 필요 표시는 레이아웃 사정으로 사라지지 않는다"**에 정면으로 어긋난다. **자기가 만든 원칙을 자기 설계에 일관되게 적용한 판단**이다.
→ planner가 명세 문구를 맞추고(이유도 함께 적어 되돌림 방지), backend는 계약을 왼쪽 gutter 기준으로 쓴다.

## 디자인 결과에서 구현이 지켜야 할 것
- **`SideNav`를 3단 flex로 바꿔야 한다.** 항목이 12개가 되어 펼침 613px·접힘 584px이라 **1366×768 노트북에서 넘친다.** 목록만 스크롤하고 `설정`+`메뉴 접기`는 하단 고정
- 새 컴포넌트 **5개**(`AlertItem`·`AlertGapRow`·`SecretInput`·`LogLineList`·`CollapsibleNotice`). PM 기준(2개)보다 3개 많은데, **"왜 기존 것으로 안 되는가"를 `components.md` 20절 표로 근거화**했다 — 수용
- **`NotificationBell`은 만들지 않는다**(AC-ALERT36)
- **화면을 여는 것만으로 읽음 처리하지 않는다** (항목 클릭·확장·점 클릭·모두 확인만)
- **정지 구간 줄은 어떤 필터로도 사라지면 안 된다.** 필터 배열에서 빼는 코드 금지
- 탭 제목 개수는 배지와 같은 값이고 **연결이 끊겨도 0으로 내리지 않는다**
- 로그는 **전용 연결**(공용 SSE와 별개), 링버퍼 2만 줄, **출처 자동 전환 금지**, 찾기 입력값을 URL·저장소에 남기지 않음

## DBA 설계에서 특히 좋았던 것 (2026-09-25)
- **웹훅 원문 미노출을 "조심"이 아니라 타입으로 막았다.** `SETTING_DEFAULTS`에서 그 키를 **일부러 빼서** `SettingsService.get('alerts.discord.webhookUrl')`이 **컴파일되지 않게** 했다 → 60초 공용 캐시에 비밀값이 들어갈 길 자체가 없다. 원문을 주는 함수는 발송기 전용 하나뿐이고, 화면용은 `{configured, hint:"…****7f3a", length, lockedByEnv}`만 준다.
- **알림 본문을 저장하지 않고 구성요소로 저장**한다. 자유 텍스트 칸이 있으면 **언젠가 로그 줄·쿼리 원문이 들어온다**는 판단이다. "넣지 말자"는 규칙보다 **넣을 칸을 안 만드는 것**이 확실하다. 덤으로 문구를 고쳐도 과거 이력이 옛 문구로 남지 않는다.
- **PM 판단 하나를 정정했다**: "암호화해도 보호 수준이 같다"는 **DB 덤프 시나리오에서는 성립하지 않는다**(덤프는 밖으로 나가고 키는 `.env`에 남는다). 그럼에도 평문 유지를 권고한 근거가 타당해 결정은 유지한다 — 즉시 폐기 가능한 저가치 자격(웹훅 삭제=완전 무효화), 피해가 "그 채널에 글쓰기"로 한정, 암호화는 키 관리·복호화 실패라는 새 실패 모드를 들여온다. **저장 모양이 `{url}` 객체라 마이그레이션 없이 암호화로 전환 가능**하게 대비해 뒀다.

## 로그 기능에 영향을 주는 충돌 — 실재 확인 (2026-09-25)
대상 Postgres는 평상시 쿼리를 로그에 남기지 않지만(`log_statement=none` 기본), **`log_min_error_statement=error`가 기본이라 오류가 난 문장은 원문이 파드 로그에 남는다.** 제약 위반이면 `DETAIL: Key (email)=(a@b.com)`처럼 **값까지** 들어간다 — `cluster-status` 가정 A7이 말한 개인정보다.
**끄는 것은 답이 아니다**: `panic`으로 올리면 DBA가 장애를 못 보고, 무엇보다 **대상 DB 설정 변경은 관측 대상에 쓰기**라 원칙 위반이다.
→ **PM 결정: 로그 가림 규칙에 `sql_statement` 추가(10종 → 11종).** 기존 `maskSqlLiterals()`/`sanitizeQueryText()`를 재사용한다. 리터럴만 `?`로 바뀌어 **"어떤 쿼리가 실패했나"는 남고 값만 사라진다.**
→ 부수 건: `monitor-account.sql` 적용이 **실패하면** `ALTER ROLE … PASSWORD '…'`가 비밀번호째 로그에 남는다. **세션 한정** 완화를 DBA에 지시했다(영구 설정 변경은 금지).

## 설정 화면 안내 문구 — 자리가 문구만큼 중요했다 (2026-09-25)
"알림 본문에 리소스 이름이 원문 그대로 나간다"는 안내를 designer가 **웹훅 입력칸 아래가 아니라 테스트 발송 버튼 바로 위**에 뒀다.
> 입력칸 밑에 두면 주소를 붙여 넣을 때는 읽지만, **테스트를 누르는 순간에는 화면 위로 밀려 안 보인다.**

`i-0abc…`를 mono로 그리는 것도 의도가 있다 — "EC2 인스턴스 ID"라는 말만으로는 그것이 **AWS 계정 내부 식별자**라는 감각이 오지 않는다.
**확인 대화상자에는 일부러 넣지 않았다**: 테스트 메시지 본문에는 리소스 이름이 없어(클러스터 이름·시각뿐) 거기 넣으면 **사실과 어긋나고 정작 실제 알림에 대한 경고가 흐려진다.**
닫기·접기 없음, 새 토큰·새 컴포넌트 0개(기존 `InlineAlert` 재사용). **퍼블리셔는 이 알림에 `closable`을 주면 안 된다.**

덤: `docs/design/logs.md` 7.3에 **"가림 규칙 개수를 화면에 고정하지 않는다"**를 넣었다. 방금 10종 → 11종이 됐고 앞으로도 늘어난다.

## 비밀번호 로그 노출 완화 — "지우지 마라"를 코드에 남긴 처리 (2026-09-25)
`monitor-account.sql`에 `SET log_min_error_statement = 'panic';` 한 줄을 추가했다. **세 줄이 각각 다른 것을 막는다**는 점을 주석으로 구분했다 — `log_statement`=성공한 문장, `log_min_duration_statement`=느린 문장, **`log_min_error_statement`=실패한 문장**(기본 `error`라 앞 두 줄로는 못 막는다. 이번 발견의 핵심).

**PM 제약(세션 한정)을 실측으로 확인**했다: `pg_db_role_setting` 비어 있음, `source=session`, `ALTER SYSTEM/DATABASE/ROLE` 미사용 → 대상 DB의 영구 설정을 바꾸지 않는다.

**가장 좋았던 처리 — "지우지 마라"의 근거를 주석에 박았다:**
> `panic`은 오류를 **숨기는 게 아니라** 서버 로그에 남는 **사본만** 막는다. `ON_ERROR_STOP=1`이라 **오류는 실행자 화면에 그대로 뜬다**(PGlite로 확인).

이 문장이 없으면 다음 사람이 "위험한 설정"으로 보고 지운다. 실제로 그렇게 될 종류의 줄이다.
**`RESET`을 넣지 않은 것**도 맞다 — 스크립트 끝에서 되돌리면 그 직후 문장이 다시 노출될 여지가 생긴다. 세션은 어차피 닫힌다.

**`redactSecrets` 배치**: `sanitize.ts`(import 없는 잎 모듈)에 두어 **순환 import를 피했고**(`sanitize` ← `health/postgres/normalize` ← `settings-defaults` ← `secret-settings`), `redactSecrets`의 **첫 단계**로 넣어 뒤 규칙이 URL을 부분적으로 갉아먹어 조각이 남는 것을 막았다. 덤으로 DB 상태 조회의 `sanitizeErrorMessage`(화면 "판단 이유")도 알림 코드 없이 이미 보호된다.

## 유지보수 주의 — 한쪽만 고치면 어긋나는 짝 (DBA 인계, 2026-09-25)
- **가림 규칙을 늘리면 세 곳을 같이 고친다**: `apps/api/src/database/health/sanitize.ts`(구현) · `sanitize.spec.ts`(테스트) · `docs/db/health.md` 6절(민감값 처리 표).
- **`monitor-account.sql`의 `SET` 3줄 설명은 두 곳에 있다**: 스크립트 주석과 `health.md` 7.2. 같은 근거를 일부러 양쪽에 뒀다 — **스크립트만 읽는 사람과 문서만 읽는 사람이 다르고, 어느 쪽에서든 "이 SET은 왜 있나"에 답이 나와야 지워지지 않는다.** 한쪽만 고치지 마라.

DBA가 지시에 없던 것 하나를 더 고친 판단도 기록해 둔다: `health.md` 6절의 **기존 "접속·쿼리 오류 메시지" 행의 가림 목록에도 웹훅을 추가**했다. 새 행만 만들고 기존 행을 두면 **"오류 메시지에서 가리는 것" 목록이 코드와 어긋난 채 남는다**(그 경로도 같은 함수를 타므로 실제로는 가려진다).
반대로 **7.1 "세션 기본값" 행은 일부러 두었다** — 그것은 `ALTER ROLE … SET`으로 거는 **역할 수준** 설정이라 이번 변경과 무관하고, 섞어 적으면 다음 사람이 "역할에도 `log_min_error_statement`를 걸자"로 읽는다(superuser 컨텍스트라 불가능하고, 가능해도 영구 설정이라 원칙 위반).

## PM 결정 — 계약 단계에서 올라온 2건 (2026-09-25)
1. **`alerts.snapshot`에서 "최근 N건"을 뺀다** (명세 4절과 달랐다). **backend 판단 채택.**
   근거: 상단바 패널이 없어졌고 **목록이 필요한 화면은 `/alerts` 하나뿐**인데, `alerts` 토픽은 **모든 페이지가 구독**한다. 스냅샷에 이력을 실으면 **알림 화면을 보지도 않는 탭까지 재연결마다 이력을 받는다.** 스냅샷은 배지용 3개만, 목록은 REST로. → planner가 명세를 맞춘다.
2. **`alert_delivery_status` enum에 `skipped_no_pair`·`skipped_circuit_open` 2개 추가** (마이그레이션 필요). 현재 10개로는 **AC-ALERT32(짝 없는 해제)**와 **연속 실패 1시간 차단**을 기록으로 구분할 수 없다 — 나중에 "왜 안 갔나"를 추적할 수 없게 된다. → DBA에 지시.

## 계약에서 좋았던 설계
- **`gaps[]`를 `items[]`와 별도 배열로.** "정지 구간"이 목록 안에 섞여 있으면 **필터 코드가 지울 수 있다.** 배열을 나눠서 구조적으로 막았다 — designer가 "어떤 필터로도 사라지면 안 된다"고 한 것을 코드가 아니라 **형식으로** 보장한 것이다.
- **파드가 사라져도 `logHref`를 지우지 않는다.** `logTarget.gone`/`deletedAt`/`stackSearch`를 서버가 주고(저장하지 않고 응답 시점 계산), 실제 안내는 로그 화면이 `LOG_POD_NOT_FOUND`로 한다. 링크를 없애면 사용자는 "왜 없지?"를 묻게 되는데, 남겨두고 이유를 말하는 쪽이 낫다.
- **알림 응답에 로그를 담을 필드가 없고 앞으로도 만들지 않는다**를 계약에 명문화(요약·통계 필드명까지 예로 금지). 검증은 응답 JSON 전체 문자열 검색.

## 보이지 않는 결정에 수용 기준을 붙였다 (2026-09-25)
`alerts.snapshot`에서 목록을 빼면서 planner가 **AC-ALERT37**을 새로 만들었다: *스냅샷에 목록이 없고, **`/alerts`를 열지 않은 탭이 재연결해도 이력을 한 건도 받지 않는다**(네트워크로 확인)*.
> 이건 **눈에 안 보이는 결정**(네트워크 페이로드)이라 AC가 없으면 조용히 어긋나도 아무도 모른다.

기존 AC 중 이 결정을 검사하는 것이 없어서 문구를 맞출 대상이 없었고, 뒤에 덧붙였다(`AC-LOG22`와 같은 형태). **AC 재배치 0건, 기존 AC 문구 수정 0건.**

근거를 적는 방식도 좋았다 — **"실시간성은 그대로다(`created`/`updated`가 그 역할을 한다)"**를 명시했다. 되돌리려는 사람이 드는 **가장 흔한 이유를 미리 닫은 것**이다. 그리고 "패널이 있었다면 필요했지만 지금은 아니다"로 **Q1(사이드바 결정)의 파생이라는 인과를 연결**했다 — 없으면 나중에 앞뒤가 안 맞는다.

## frontend 착수 시 반드시 전달할 것
**스냅샷에서 목록을 빼도 `/alerts` 응답을 앱 레이아웃 전역 스토어에 얹으면 같은 문제가 되살아난다** — 안 보는 탭이 메모리에 이력을 든다. **계약만 고쳐서는 안 닫히는 구멍**이라 planner가 명세 7절 프론트에 명시했다.
- 배지 = SSE, 목록 = REST. **목록을 전역 상태에 들고 있지 않는다**

## "그대로 간다"로 답하려다 결론이 뒤집힌 건 (2026-09-25)
배지 질의 인덱스를 재검토하라고 했을 때 DBA가 **측정 조건을 현실적으로 바꿨더니 결론이 달라졌다.**
앞서 잰 것은 "2,000건 중 미확인 5건"이었는데 낙관적이었다 — **해제 알림은 이력 완결성 때문에 항상 만들지만 배지엔 세지 않으므로, 안 읽은 채 쌓이는 것이 기본 동작**이다. "미확인 2,000건 중 1,990이 resolved"로 다시 쟀다.

| 형태 | 읽은 인덱스 항목 | 시간 |
|---|---|---|
| `<> 'resolved'` | 2,000 (1,990 버림) | 0.53ms |
| **`< 'resolved'`** | **10** | **0.094ms** |

**결정적 차이**: `VACUUM` 전(= 쓰기가 몰린 상태, 알림 표의 평상시)에 `<>` 형태는 **아예 Seq Scan으로 떨어졌다**(46 buffers). `<>`는 **필터**이고 `<`는 **인덱스 경계**이기 때문이다.

채택한 형태는 집계 1행으로 끝난다(planner가 권한 "집계 한 방"):
```sql
SELECT count(*) AS unread, min(severity) AS worst
  FROM alerts
 WHERE data_source = $1 AND acknowledged_at IS NULL AND severity < 'resolved';
```
`min(severity)`가 곧 최악 심각도다 — enum을 `critical,warning,unknown,resolved` 순으로 선언했고 그것이 `common.md` 2.1 우선순위와 같다. **백엔드에 정렬 코드가 필요 없고 0건이어도 항상 1행**이 온다.

**인덱스 `(data_source, acknowledged_at, severity)`는 그대로** — 세 열이 다 인덱스 조건이 되어 Index Only Scan(Heap Fetches 0). 빈도 전제가 바뀐 뒤에도 열을 더하거나 순서를 바꿀 이유가 없었다.
**새 불변식을 테스트로 고정**했다 — 질의가 enum 선언 순서에 기대므로(첫 값=최악, 마지막=resolved) 순서가 바뀌면 **조용히 틀린 답**이 나온다.

## enum 2개 추가 (2026-09-25)
`skipped_no_pair`·`skipped_circuit_open`. `ADD VALUE`는 카탈로그에 값만 덧붙이므로 **테이블 재작성·캐스팅·타입 교체가 없고, 이 마이그레이션은 어떤 테이블도 읽거나 쓰지 않는다.** `AFTER`를 손으로 붙여 선언 순서와 DB 정렬 순서를 맞췄다(Prisma 기본 SQL은 맨 뒤에 붙여 어긋난다).
**down은 손실이 있다** — enum 값 삭제가 없어 타입 재생성이고 두 값이 `skipped_severity`·`failed`로 합쳐진다. **구분이 사라지는 것이 되돌리기의 본질**이라 파일에 명시했다.
검증 18/18(기존 10개 상태 발송 기록 전부 무변경 확인), jest **508 passed**(502 → +6).

## "안 보낸다"를 수단이 없음으로 보였다 (2026-09-25)
mock에서 디스코드로 나가지 않는 것을 **동작이 아니라 구조로** 확인했다: **`src/alerts/`에 HTTP 클라이언트 0건, 프로세스 외부 연결 0건.**
동작 확인("이번엔 안 나갔다")보다 **보낼 수단이 없음**을 보이는 쪽이 확실하다.
**단 P2에서 이 성질이 깨진다** — 발송기가 생기기 때문이다. P2 지시에 "mock일 때 그 경로에 들어가지 않는 것을 테스트로 고정하라"를 넣었다.

기타 실측: 배지 `unreadCount 3 / worstSeverity critical` · `gaps[]`가 **모든 필터(심각도·해제 포함·영역)에서 그대로 유지** · 워밍업 120초 동안 알림 0건 → 종료 시 `restart_summary` 1건 · `cluster` healthy→critical 시 **15초 안에 4건**, 되돌리면 `resolve` 4건 · **같은 상태 30초 유지 시 증가 0**(억제 동작).

## 아웃바운드 0 증명 방식이 바뀌었다 — 발송기가 생겼으므로 (2026-09-25)
1단계에서는 **"`src/alerts/`에 HTTP 클라이언트가 0건"**으로 증명했는데, P2에서 발송기가 생겨 그 성질이 깨진다. backend가 증명 방식을 바꿨다:
- **판정(`dispatch-rules.ts`)과 전송(`discord-sender.ts`)을 분리**하고, **종류 6 × 심각도 4 × 설정 16 = 384가지 전수 조합에서 `send` 판정이 0건**임을 테스트로 고정
- **나가는 문은 파일 하나**이고 DI 토큰으로 주입된다
- 허용 안 된 호스트·`http://`에서는 **`fetch` 자체를 부르지 않는 것**을 스파이로 확인

**검증 가능성을 위해 설계를 바꾼 것도 좋았다**: 이 환경에 DB가 없어 웹훅 저장 경로를 못 돌리는데, **형식 검증을 DB 확인보다 앞으로 옮겨** DB 없이도 AC-ALERT21(형식 오류 4종 400 + 토큰·호스트 응답에 0건)을 실제로 검증할 수 있게 만들었다.

실측: 라우트 순서 수정으로 `badge`·`settings`·`test/preview` **200**(전에는 404) · env 잠금 시 `hint "…****ZZZ9"`만, 변경 시도 **409 + "왜 못 고치는지"** · 테스트 발송 **422 → 200 `skipped_mock` → 429 + `Retry-After: 60`** · 테스트 이력 1건 남되 **배지 3 그대로** · 프로세스 외부 연결 **0건**.

## PM 결정 — 통합 1차에서 올라온 것 (2026-09-25)
| # | 결정 | 근거 |
|---|---|---|
| R2 | **`/cluster/pods`·`/cluster/nodes` hydration 오류를 이번 통합 2차에서 고친다** (`useStreamStore`에 `getServerSnapshot` 분리) | frontend는 "기존 구조 문제라 범위 밖"으로 판단 요청했다. 원인은 기존 구조가 맞지만 **`alerts`가 기본 토픽이 되면서 더 자주 드러난다**(frontend 본인 분석). 모든 페이지가 `alerts`를 구독하므로 이 기능이 드러낸 결함으로 본다. `/alerts`에 쓴 `useIsClient()` 우회를 화면마다 늘리는 것보다 **스토어 한 곳에서 서버 스냅샷을 비우는 것**이 맞다. 고친 뒤 `useIsClient()`가 여전히 필요한 자리만 남긴다 |
| — | **발송 칩 `skipped_no_pair`·`skipped_circuit_open` 2종**: designer가 `status.md` 12.5·`components.md` 20절에 문구·아이콘을 정하고 → publisher가 `DISPATCH_SPEC`에 넣는다 | 칩 문구의 정본은 디자인이다(서버 `label`은 확장 영역용). frontend 변경은 필요 없다(`state in DISPATCH_SPEC` 런타임 검사) |
| — | **`SegmentedControl.disabledReason` 함정**: 사유만 줘도 칸이 비활성이 된다. `components.md` 21.3에 주의 한 줄(designer) + 컴포넌트 JSDoc(publisher) | 실제로 `CrashLoopBackOff` 컨테이너가 눌리지 않는 결함이 났다. 문서만 고치면 코드를 읽는 사람이 못 보고, 코드만 고치면 설계를 읽는 사람이 못 본다 |
| — | **알림 `logHref`에는 `follow=1`을 붙이지 않는다** | 자세한 근거는 `logs/README.md` D3. 알림 링크는 그 시각(`at`)을 보러 가는 링크다 |

## 6단계 검증 — PM 직접 확인 (2026-09-25)
**명령** (모든 담당 작업이 끝난 뒤 PM이 다시 돌림)
| 대상 | 결과 |
|---|---|
| `apps/api` lint · build | 통과 |
| `apps/api` jest | **58 suites, 648 passed / 2 skipped** |
| `apps/web` lint · `tsc --noEmit` | 통과 |
| `apps/web` vitest | **27 files, 636 passed** |
| `apps/web` `next build` | 통과(`/alerts`·`/logs`·`/settings` 생성). 끝난 뒤 dist 폴더 삭제, `tsconfig.json` 자동 변경 되돌림 |

**보안 관련 AC — mock API(:3151, PID 9684, 끝난 뒤 그 PID만 종료)에 직접 요청**
가짜 웹훅 `ALERTS_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1234567890/PMSECRETtokenXYZ9`를 환경 변수로 넣고 띄웠다.
| AC | 확인 | 결과 |
|---|---|---|
| 20·22 | `GET /api/alerts/settings` | `configured true · hint "…****XYZ9" · source env`, `lockedByEnv ["webhookUrl"]` + `envVar ALERTS_DISCORD_WEBHOOK_URL`. **설정·목록 500건·상세·테스트 미리보기 응답 전체에서 토큰·경로 문자열 0건** |
| 23 | `POST /api/alerts/test` 본문 `{}` | **422** (확인 없이 안 나간다) |
| 24·26 | `{"confirm":true}` | `skipped_mock`, 본문 `[MOCK] [테스트] … 실제 장애가 아닙니다.` · **그 프로세스의 루프백 아닌 연결 0건**(netstat) |
| 25 | 곧바로 다시 | **429 + `Retry-After: 60`** |
| 13 | 알림 목록·상세 JSON에 로그 필드(`segments`·`lines`·`logs` 등) | 0건 |
| 37 | 공용 SSE `alerts.snapshot` | 키 6개 `badge·dispatch·notices·persistence·warmup·watch`, **목록 없음**, 1,408바이트 |
| (보조) | `keys[].status` | 8개 키 모두 값 있음 |

**근거가 없던 AC — PM이 mock에서 직접 확인** (서버를 세 번 새로 띄웠다: 시나리오를 빨리 바꾸면 **플래핑(30분 4회)이 걸려** 반복 알림이 멈췄기 때문이다. 워밍업 중에 바뀐 상태도 전이로 센다 — 설계대로이고, 덕분에 AC-ALERT06 플래핑 묶음을 실제로 봤다)
| AC | 결과 |
|---|---|
| 11 | `cp-node-down` → 컨트롤 플레인 **`transition warning`** "마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실" · `cp-quorum-lost` → **`escalation critical`**(새 알림) "쿼럼 상실 — 마스터 1/3 Ready". **`cp-not-found` → 확인 불가(5분 지속)는 미실측** |
| 12 | `spike-warning` → 비용 **`transition warning`** · `budget-over` → **`escalation critical`** · `no-budget` → 해제 알림만, 예산 알림 없음 |
| 06 | 30분 안 4회 전이 → **`flapping warning` 1건**("반복 알림을 멈춥니다"), 이후 전이마다 항목이 생기지 않음 |
| 28 | `dispatch-rules.spec.ts`에 `skipped_severity` 판정 테스트 있음(테스트) |
| 33 | `skipped_restart` 정리 코드(`alert-store.service.ts`)는 있으나 **테스트가 없었다** → backend가 `alert-restart.spec.ts` 3건 추가, **결함 없음**. 메모리 경로 + 저장소 대역(PGlite가 설치돼 있지 않다 — **실제 DB 미실행**) + 시작 훅 대조(남은 대기분 발송 0회 / 시작 뒤 생긴 대기분 1회) |

**AC-ALERT37 — 근거 표가 짚은 어긋남에 대한 PM 판단**: `alerts.created`/`updated`는 **새로 생긴 알림 1건**을 모든 탭에 싣는다(화면은 읽지 않고 버린다). AC-ALERT37은 "**재연결 때 이력**을 받지 않는다"를 검사하고, 명세도 "실시간성은 `created`/`updated`가 맡는다"고 적었다 → **AC 충족으로 판정한다.** 한 건씩의 새 알림은 이력이 아니다. payload를 배지만 남기도록 줄이는 것은 **이득(사용하지 않는 필드 제거)이 작고 계약 변경이라** 이번에는 하지 않는다 — 다음에 계약을 손볼 일이 있을 때 함께 검토한다.

## PM 결정 — 통합 2차에서 올라온 것 (2026-09-25)
| # | 건 | 결정 |
|---|---|---|
| 1 | frontend가 설정 화면에서 **디자인보다 서버 규칙을 따른 3건** — ① DB가 없다는 것만으로 테스트 발송을 막지 않는다(환경 변수 웹훅이면 서버가 보낸다) ② 실패 후 대화상자의 보내기 버튼을 서버 쿨다운 동안 비활성 ③ 429는 error가 아니라 warn | **3건 모두 채택.** 셋 다 "화면이 서버 사실과 다르게 말하지 않는다"는 같은 원칙이다. 특히 ③은 429가 **내가 방금 보낸 것의 쿨다운**이지 장애가 아니다. → designer가 `settings.md`를 맞춘다 |
| 2 | 디자인 6.1 Card 2는 알림 대상마다 **현재 상태 `StatusBadge`**를 그리는데 계약 `keys[]`에 상태가 없다(frontend는 "선택" 요청으로 올렸지만 실제로는 **계약 누락**) | **backend가 `keys[].status`를 추가 전용으로 넣는다.** 키 → 상태 판단은 알림 엔진이 이미 하고 있다. 화면이 다른 스트림에서 짜 맞추면 판단 기준이 두 곳이 된다 |
| 3 | mock 테스트 발송 뒤 `lastDispatch`가 `null`로 남는 것이 의도인가 | **의도로 정한다: `lastDispatch`는 실제로 밖으로 나간 시도(`sent`·`failed`)만 기록하고 테스트 발송도 포함한다. `skipped_*`는 기록하지 않는다.** mock은 나간 적이 없으니 `null`이 맞다. backend가 live 경로에서 테스트 발송이 이 값을 갱신하는지 확인하고 계약에 문장으로 적는다 |
| 4 | 디자인 3.6 "연속 실패 10건으로 발송을 멈췄습니다. **15:04에 다시 시도합니다.**" — 재개 시각이 필요한데 backend P2 보고에 `nextRetryAt`이 항상 `null`이라고 남아 있다 | backend가 서킷 재개 시각을 응답에 준다(메모리 값이라도). 없으면 시각 없이 앞 문장만 나가야 한다 |
| 5 | publisher 요청 6건(`SecretInput` 비활성, `Switch` 설명 연결, `Dialog.cancelDisabled`, `LogLineList` 현재 일치 스크롤, 스크롤 플래그 누수, `SearchInput` 키 입력) | 전부 publisher에게. **플래그 누수는 publisher가 06:50에 이미 고쳤다**(두 사람이 같은 시간에 같은 증상을 봤다) — frontend는 3차에서 화면 쪽 우회를 지운다 |

**`apps/web/tsconfig.json` 오염**: 별도 dist 폴더로 build하면 Next가 `include`에 그 경로를 넣고 파일 서식을 바꾼다. PM이 diff를 확인했다 — **자동 생성된 줄과 서식뿐이고 의도한 변경은 없다.** 마지막으로 build하는 담당이 끝날 때 `git checkout -- apps/web/tsconfig.json`으로 되돌린다.

## 월요일 확인 목록
- **실제 디스코드 발송** — `sent`·`failed`·429·서킷의 HTTP 경로는 단위 테스트뿐이다. 백오프 5/30/120초와 서킷 1시간은 기다릴 수 없어 순수 함수 테스트로 덮었다
- **Q11**: 클러스터 안에 배포했을 때 대시보드가 `discord.com:443`으로 나갈 수 있는가 (NetworkPolicy·egress·프록시)
- 대상 DB의 실제 `log_statement`·`log_min_error_statement` 값 (`pg_settings` 조회. **기존 `sentinel_monitor` 계정으로 권한 추가 없이 가능**함을 DBA가 확인)
- 실제 Postgres 16에서 `npm run db:migrate --prefix apps/api` 1회 (PGlite 17.5로만 검증됨)
- **"실패한 문장이 서버 로그에 정말 안 남는지" 실측** — PGlite에는 검사할 로그 파일이 없어 확인 불가. 확인된 것은 ①값이 `panic`으로 바뀐다 ②세션에만 적용된다 ③오류는 클라이언트에 그대로 온다. 나머지는 Postgres 문서 근거
- 실제 대상 DB에서 `monitor-account.sql` **전체 실행** (psql 메타명령은 PGlite로 실행 불가)

## PM 조율 (담당 지정)
- `docs/specs/cluster-status.md` 6절의 "알림 발송(Slack/메일)"·"컨테이너 로그 보기" 두 항목은 **alerts·logs planner가 둘 다 고쳐야 한다고 보고했다.** 같은 파일이므로 **planner 한 명에게 몰아서** 지시했다(충돌 방지).
- `docs/design/shell.md` 사이드바는 `alerts`·`logs` 항목이 함께 들어가므로 **designer가 한 번에** 처리한다.
- **logs planner 요청 수용**: 알림 본문에 **로그 줄을 넣지 않는다**(가린 줄도). 디스코드는 밖으로 나가는 경로다. 알림 → 로그 화면 링크만 건다.
- **로그 기반 알림 규칙은 이번 범위 밖**이다. 판단 기준이 두 곳에 생기면 안 된다.
