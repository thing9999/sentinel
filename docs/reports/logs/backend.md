# logs · backend 작업 보고

> 파일 위치: `docs/reports/logs/backend.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 22:10 · logs API 계약 작성 (3단계, 구현 전)

> **이번 작업은 `alerts`와 `logs` 계약을 한 번에 썼다.**
> **공통 사항(요청 전문, `docs/api/common.md` 갱신 내역, 검증 결과, 기준선 차이)은 `docs/reports/alerts/backend.md`에 있다.** 여기에는 logs 고유 내용만 적는다.

### 1. 요청 내용

PM 지시 중 logs 부분:

- `docs/api/logs.md`(신규) 작성. **구현 코드·`deploy/rbac.yaml`·`.env.example`은 다음 지시.**
- 특히 중요한 것 7가지: ① **출처 능력(capabilities)을 서버가 내려주고 화면은 추론하지 않는다** ② **가림은 서버에서**, 표기 `앞 2글자****(N자)` + 규칙 이름, **원문 보기 API 금지** ③ **로그를 어디에도 저장하지 않는다** ④ **공용 `/api/stream`에 싣지 않는다**, `LOG_MAX_STREAMS=3`을 `SSE_MAX_CLIENTS=20`과 별도 계산, 250ms 배치·초당 2,000줄·유휴 5분·30분 종료 ⑤ **출처 중립 계약**(Loki 전제, Elasticsearch 자리 남김, AC-LOG47) ⑥ 한계(파드 사라짐·회전·`--previous` 1세대·stdout/stderr 미분리)를 응답이 정직하게 알릴 것 ⑦ `LOGS_ENABLED`·`LOG_DENY_NAMESPACES`
- 작업 중 추가 지시 3건: ① **디자인 완료**(`segments[]`·한국어 규칙 이름·`capabilities[]`, 가림 표식 **왼쪽 sticky gutter**) ② **DBA 충돌** — 대상 Postgres의 `log_min_error_statement=error` 때문에 실패한 SQL 원문이 파드 로그에 남는다 → 가림 규칙 `sql_statement` 추가 ③ **②의 방법을 폐기·갱신** — `maskSqlLiterals()` 재사용은 틀린 권고였다(DBA 실측 12종). `createPgLogValueMasker()`/`maskPgLogValues()`를 쓰고 **규칙 개수를 계약에 숫자로 박지 말 것**.

### 2. 참고한 문서

- `docs/specs/logs.md` 전체(0.2 확인된 사실 F1~F11, 3.1~3.10, 4절 갱신 주기, 5절 AC-LOG01~48, 7절 백엔드·DBA, 8절 충돌표, 9절 결정)
- `docs/reports/logs/README.md`(결정 Q2·Q3·Q4·Q6·Q7), `docs/reports/logs/designer.md` 8절
- `docs/design/logs.md`(3 출처 줄·4 한계 블록·5 대상 선택·6.3 찾기 vs 검색·7.1~7.5 본문·8 상태 화면·10 사라진 파드·11 컨트롤 플레인), `docs/design/components.md` 20.4·20.5
- `docs/api/common.md`, `docs/api/cluster-status.md`(1.3 `PodItem`, 1.6 `ControlPlaneComponent`, 5.2 파드 상세), `docs/api/architecture-advisor.md` B.3(스트리밍 선례)
- `apps/api/src/database/health/sanitize.ts`(읽기만 — `createPgLogValueMasker`·`maskPgLogValues`·`maskPgDetailValues`·`maskSqlLiterals`·`redactSecrets` 확인)
- `deploy/rbac.yaml`(읽기만)

### 3. 작업 내용

`docs/api/logs.md`를 14절로 썼다.

1. **0절 원칙 6개**(P1 서버 가림 / P2 끄는 설정 없음 / P3 원문 보기 API 없음 / P4 한계를 응답이 알림 / P5 저장 없음 / P6 어드바이저·알림 격리 / P7 fail-closed)와 **공용 스트림 분리**, **쓰기 없음**.
2. **1절 타입**: `LogCapabilities`(능력 + `labels.search`), `LogLine`(**`segments[]`**·`kind` 4종·`truncatedBytes`·`droppedLines`·`bytes`), `LogRuleRef`(id + **한국어 label**), `LogNotice`(코드 + **사유 한 줄**), `LogSelector`.
3. **2절 엔드포인트 6개**
   - `GET /api/logs/capabilities` — 출처 2개의 `selectable`·`disabledReason`·`tooltip`·`chips`·`capabilities`·**`limitations`(한계 4줄 + 접힘 요약)**, `limits`, `streams.open/max`, `redaction.rules`(목록 전체, **개수 고정 없음**), `denyNamespaces`.
   - `GET /api/logs/targets/:ns/:pod` — 컨테이너 칩(init 분리·`hasPrevious`·`recommended`), **`defaultContainer`(서버가 고른다)**, 사라진 파드면 **200 + `exists:false` + `deletedAt` + `stackSearch`**, 노드 미보고·컨트롤 플레인 안내.
   - **`POST /api/logs/query`** — 정지 조회. `lines[]`·`stats`·`notices`·`range`.
   - **`POST /api/logs/streams` → `GET /api/logs/stream/:id` → `POST …/touch` · `POST …/close`** — 따라가기 전용 연결.
4. **3절 가림**: 규약(표기·자격 증명만·식별자는 안 가림·fail-closed·왼쪽 gutter), **규칙 목록 표**(한국어 이름·확신 등급·치환. 개수를 숫자로 박지 않는다), **3.2.1 `sql_statement`의 근거와 동작**(폐기된 방법 / 실측 실패 4종 / `createPgLogValueMasker` 규칙 / 계약에서의 취급 / 한계 2가지), 응답에 드러나는 방식.
5. **4~5절**: 줄 처리(ANSI 제거·제어문자·바이너리·UTF-8·긴 줄 — 전부 서버), 상한 표와 250ms 배치 근거.
6. **6절 안내 코드 28개** + HTTP 매핑(403/404/503 구분).
7. **7절 전용 스트림 이벤트 6개**(`log.hello`·`log.lines`·`log.notice`·`log.paused`·`log.heartbeat`·`log.closing`)와 봉투(공용과 다름), 재연결 금지 규칙.
8. **8~14절**: `logBackend` 출처, mock 11개, 환경 변수, 저장·격리(어드바이저·알림), 컨트롤 플레인(`ControlPlaneComponent.logHref`), 화면이 하지 않는 것, 명세·디자인과의 차이 9건.

`docs/api/common.md`·`docs/api/cluster-status.md` 갱신 내역은 `docs/reports/alerts/backend.md` 3절 표에 있다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/logs.md` | 추가 | logs API 계약 전체(엔드포인트 6개 + 전용 SSE + `SourceId` `logBackend`) |
| `docs/api/common.md` | 수정 | `logBackend`·로그 예외 ③·로그 에러 코드·전용 연결 예외·mock 그룹 `logs` (`alerts/backend.md` 3절 표) |
| `docs/api/cluster-status.md` | 수정 | `ControlPlaneComponent.logHref` 1필드 + 설명 한 줄 |
| `docs/reports/logs/backend.md` | 추가 | 이 보고서 |

- **`deploy/rbac.yaml`은 읽기만 했고 고치지 않았다**(다음 지시).

### 5. 주요 결정과 이유

1. **조회를 `POST /api/logs/query`로 했다** (GET 아님)
   - 대안: `GET /api/logs?namespace=…&search=…`.
   - 선택 이유: **검색어가 URL에 들어가면** 프록시 접근 로그·브라우저 이력·리퍼러에 남는다. 명세 3.3.4는 "API 자신의 로그에 검색 쿼리를 남기지 않는다"고 못 박았는데(사용자가 검색칸에 비밀값을 칠 수 있다), GET이면 그 약속을 서버 코드만으로 지킬 수 없다. 본문으로 받으면 경로 자체가 생기지 않는다. 상태를 바꾸지 않는 조회이고 `Origin` 검사(명세 3.3.6)와 415 규칙을 함께 적용했다.
2. **따라가기를 3단계로 나눴다**(준비 POST → SSE GET → touch/close)
   - 대안: `GET /api/logs/stream?namespace=…&pod=…` 한 방.
   - 선택 이유: ① **EventSource는 오류 응답 본문을 읽지 못한다.** 상한 초과(503 `LOG_STREAM_LIMIT_REACHED`)·권한 없음(403)·파드 없음(404)을 화면이 문구로 보여주려면 **연결 전에 JSON으로** 받아야 한다(디자인 8.5가 그 화면을 이미 그렸다). ② `LOG_MAX_STREAMS`를 연결 전에 정확히 센다. ③ 셀렉터·검색어가 URL에 안 남는다(1과 같은 이유).
   - `close`를 `DELETE`가 아니라 **본문 없는 POST**로 한 이유: 화면을 떠날 때 `navigator.sendBeacon`으로 보낼 수 있어야 하는데 beacon은 POST만 된다. 스트림 슬롯이 3개뿐이라 "탭을 닫으면 슬롯이 돌아온다"가 반드시 동작해야 한다.
3. **유휴 판정을 `touch` 신호로 했다.** 서버는 브라우저 탭이 백그라운드인지 알 수 없다. 화면이 보이는 동안 60초마다 `touch`를 보내고, 300초 동안 없으면 서버가 위쪽 연결을 끊고 `log.paused`를 보낸다. 명세 3.5의 "유휴 5분 일시정지"를 서버 쪽에서 실제로 구현할 수 있는 유일한 방법이다.
4. **사라진 파드는 `targets` 조회에서 200 + `exists:false`로 준다**(404 아님). 404를 주면 화면이 오류 스택·빈 화면을 그리게 되는데, 디자인 10절·AC-LOG26은 **전용 안내 화면**을 요구한다. "결과 0건"과 "볼 수 없음"은 다른 사실이다. 실제 조회(`query`·`streams`)는 404 `LOG_POD_NOT_FOUND`다.
5. **본문을 `segments[]`로만 준다.** 디자이너 요청이기도 하고, 가림 표기를 문자열로 합쳐 보내면 **화면이 정규식으로 다시 파싱**하게 된다. 그러면 로그 본문에 `****(12자)` 같은 문자열이 원래 들어 있을 때 가짜 가림 표시가 생긴다. 조각 배열은 그 모호함이 없다.
6. **`sql_statement` 규칙을 더하되, 구현 방법은 PM 갱신 지시대로 바꿨다**
   - 왜 필요한가: 대상 Postgres의 `log_min_error_statement=error` 기본값 때문에 **실패한 SQL 문과 제약 위반 값이 파드 로그에 남는다**(`DETAIL: Key (email)=(a@b.com) already exists.`). 대상 DB 설정을 바꾸는 것은 **관측 대상 쓰기**라 원칙 위반이고 `panic`으로 올리면 DBA가 장애를 못 본다. 그래서 가림으로 푼다.
   - **처음 초안(`maskSqlLiterals()` 줄 단위 재사용)은 폐기했다.** DBA 실측으로 ① 정작 `Key (email)=(a@b.com)`을 **못 잡고**(따옴표 없는 맨 토큰이라 SQL 리터럴이 아니다) ② `Failing row contains`는 숫자만 바뀌고 ③ 줄 전체에 돌리면 **타임스탬프·PID까지 `?`가 되어 AC-LOG49("구조는 남는다")에 정면으로 어긋난다**는 것이 확인됐다.
   - 계약은 **"값이 오는 자리"를 찾는 계층**(`createPgLogValueMasker()` / 무상태 `maskPgLogValues()`)으로 다시 썼다: 마커 뒤쪽에만 스캐너, `Key (cols)=(?)`로 **컬럼 이름 보존**, 값 목록을 쉼표로 쪼개지 않음, 여러 줄 문장은 **상태**를 써서 앱 스택 트레이스 줄 번호를 지킨다.
   - **규칙 개수를 계약에 숫자로 박지 않았다**(전에 "11종"이라고 썼던 자리를 전부 고쳤다). 목록이 정본이고 앞으로 늘어난다.
   - `sql_statement`만 치환 결과가 `?`다(다른 규칙은 `앞 2글자****(N자)`). 응답 형식은 같으므로 화면은 `masked.v`를 그대로 그리면 된다 — 특별 처리가 없다.

7. **`capabilities`에 화면 문구(`labels.search`)까지 담았다.** AC-LOG20·37이 "찾기 vs 검색 — **이름이 다르다**"를 검증한다. 문구를 화면이 고르면 출처 판단이 화면으로 새어 들어간다. 기존 계약도 `reasons[].text`·`headline.label` 등 서버 문자열을 쓰므로 새 방식이 아니다.
8. **확신 등급을 `'high' | 'suspect'`로 했다**(명세는 `높음`/`의심`). 디자인 `components.md` 20.5 타입과 값을 맞추고, 사람이 읽는 문구는 `LogRuleRef.label`과 화면 매핑으로 준다.
9. **공용 스트림에 `logs` 토픽을 만들지 않고 400으로 거절한다.** "토픽만 추가하면 편한데"를 다음 사람이 하지 못하게 계약에 명시적으로 적었다(AC-LOG22).
10. **`previous: true` + 따라가기를 금지(400)했다.** 끝난 세대의 로그는 따라갈 것이 없다. 조용히 무시하면 사용자는 "따라가기가 고장 났다"고 읽는다.

### 6. 검증 결과

`docs/reports/alerts/backend.md` 6절과 같다 (lint 통과, 테스트 **502 passed / 2 skipped**, 코드 미변경. 기준선 462/1과의 차이는 DBA의 동시 작업 때문이며 내 변경은 `docs/**`뿐이다. DBA의 SQL 가림 실측 테스트 13개가 들어오면서 489 → 502가 됐고, 그 결과가 계약 3.2.1의 근거다).

### 7. 남은 이슈·한계

- **계약이지 구현이 아니다.** `deploy/rbac.yaml`의 `pods/log` 추가(+ 첫 줄 주석 갱신), `.env.example`·`docker-compose.yml`·`deploy/app.example.yaml`(`LOGS_ENABLED=false` 기본)은 **다음 지시**에서 한다. 계약 10절에 목록을 적어 뒀다.
- **월요일 확인 4건**은 그대로다(U2 회사 Loki 라벨 이름, U3 kubelet 회전 값, U4 init 컨테이너 보관, U5 Loki 서버 상한). 계약은 U2를 `LOG_BACKEND_LABEL_*` 설정으로, U3을 "보통 10MiB" 문구로, U4를 `LOG_EMPTY`로, U5를 `LOG_BACKEND_QUERY_REJECTED`로 처리해 **어느 값이 와도 계약이 바뀌지 않게** 했다.
- **열린 질문 Q5**(`LOG_DENY_NAMESPACES` 기본값)·**Q9**(조회 기록)·**Q10**(kubectl 복사 버튼)은 기본값(비움 / 남기지 않음 / 문구만)으로 계약을 썼다.
- **Loki `tail`은 WebSocket**이다(F10). 계약은 **출처 중립**이라 브라우저 쪽 계약(SSE)과 무관하지만, 구현에서 서버가 WebSocket 클라이언트를 붙여야 한다. 어댑터 안쪽 일이므로 응답 모양은 바뀌지 않는다.
- **`stack` 모드의 서버 검색은 가려지지 않은 원본을 대상으로 한다**(명세 9절 알려진 한계). 검색어를 바꿔 가며 결과 유무로 가려진 값을 추론할 수 있다. 단일 운영자용 전제에서 감수한다 — 계약이 바꿀 수 있는 것이 아니다.

### 8. 다른 담당 요청

- **DBA 요청**: `createPgLogValueMasker()`가 로그 파이프라인에서 **줄당 초당 수천 번**(`LOG_STREAM_MAX_LPS=2000`) 불린다. 구현 단계에서 성능을 함께 봐 달라. 또 **오퍼레이터의 JSON 로그 형식**에서의 동작이 아직 실측되지 않았다(계약 3.2.1 한계 ②) — 월요일 실제 로그 확인 목록에 넣었다. 감사 인사: 실측으로 초기 권고의 결함을 잡아 준 덕분에 **핵심 케이스 누출과 AC-LOG49 위반을 계약 단계에서 막았다.**
- **planner 요청 ①**: 명세 3.3.2에 **`sql_statement` 규칙을 더하고, "10종"처럼 개수를 고정한 표현을 빼 달라**(목록이 정본이고 앞으로 늘어난다). 근거·동작·한계는 `docs/api/logs.md` 3.2.1. 함께 **AC-LOG49**(값은 가리고 구조는 남는다)가 명세에 반영돼 있는지 확인이 필요하다 — 계약은 그 기준으로 썼다.
- **planner 요청 ②**: 가림 표식 자리가 명세 3.3.3("줄 오른쪽")과 다르다 — **왼쪽 sticky gutter**(PM 결정 2026-09-25). 계약은 결정대로 썼다.
- **frontend 요청**: 로그 전용 연결은 공용 SSE와 별개로 관리하고, `log.closing`을 받으면 **`EventSource.close()`를 반드시 부른다**(자동 재연결하면 404 루프가 된다). 화면을 떠날 때 `POST …/close`(sendBeacon 가능)를 부르지 않으면 슬롯 3개가 금방 찬다.
- **publisher 요청**: `LogLine.kind`가 4종(`line`·`dropped`·`binary`·`redactFailed`)이고, 디자인 union의 `ringTop`·`gap`은 **화면이 만드는 줄**이다(서버는 보내지 않는다).

### 9. 다음 담당이 알아야 할 점

- **계약 경로**: `docs/api/logs.md`. 알림 쪽과의 경계는 `docs/api/alerts.md` 0.3·2.2.1.
- **화면이 하지 않는 것**은 `docs/api/logs.md` 12절에 모아 뒀다(능력 추론 금지·본문 파싱 금지·파드 존재 판단 금지·자동 전환 금지·문구 번역 금지·저장소 금지).
- **출처 중립이 이 계약의 뼈대다**(AC-LOG47). LogQL·쿼리 DSL은 응답 어디에도 없다. Elasticsearch 어댑터를 붙일 때 바뀌는 것은 `LOG_BACKEND` 값과 서버 어댑터 1개뿐이고 **응답 모양·화면은 그대로**여야 한다. 구현할 때 어댑터 인터페이스를 L1에서 미리 잡아 두는 것이 중요하다(명세 7절).
- **RBAC는 `pods/log`의 `get` 하나만 는다.** 컨트롤 플레인 로그도 같은 권한으로 읽는다(미러 파드). 구현 시 `rbac.yaml` 첫 줄 주석의 "pods/log 없음"을 고치고 **왜 열었는지와 완화 수단(계약 3절) 링크**를 적어야 한다(AC-LOG01).
- **저장 없음이 이 기능의 핵심 약속이다**(11절): DB·디스크·캐시·**API 자체 로그**·브라우저 저장소 어디에도 남기지 않는다. 구현에서 요청 로깅 미들웨어가 `POST /api/logs/query` 본문을 찍지 않게 **명시적으로 제외**해야 한다.

---

## 2026-09-24 22:50 · logs L1 구현 (직접 조회 + 가림) + RBAC `pods/log`

### 1. 요청 내용

PM 지시(구현 4단계) 중 logs 몫: **L1 = AC-LOG01~24 + 49**.
- `pods/log`로 조회. **가림은 서버에서** — 화면에 원문이 도달하면 안 된다
- 가림 함수는 **DBA가 새로 만든 것**을 쓴다: `createPgLogValueMasker()`를 조회 1건당 하나 만들어 줄 순서대로. **줄 전체에 `maskSqlLiterals`를 돌리지 말 것**(타임스탬프가 `?`가 된다). `sql_statement`는 규칙 **하나**이고 `kv_secret`·`conn_string` 등과 **함께** 돈다
- **로그를 어디에도 저장하지 말 것** — DB·디스크·API 자체 로그·응답 캐시
- 로그 스트림을 공용 `/api/stream`에 싣지 말 것. `LOG_MAX_STREAMS`를 `SSE_MAX_CLIENTS`와 **별도로** 계산. 250ms 배치, 초당 2,000줄 상한, 유휴 5분 일시정지, 30분 강제 종료
- `capabilities`를 **서버가** 내려준다. **원문 보기 API를 만들지 말 것**. 파드가 사라졌을 때 `LOG_POD_NOT_FOUND`
- **RBAC에 `pods/log` `get` 외에 아무것도 추가하지 말 것**

### 2. 참고한 문서

- `docs/api/logs.md` (내가 3단계에 쓴 계약. **이대로 구현**), `docs/api/common.md`
- `docs/specs/logs.md` 3.3·4·5절 AC-LOG01~24·49
- `docs/reports/logs/README.md` — PM 결정 Q2(원문 보기 없음)·Q4(클러스터 배포 기본 false)·Q6(내려받기 없음)·Q7(로그 기반 알림 범위 밖), 비밀값 원칙 7개
- `docs/reports/alerts/README.md` — `sql_statement` 추가 경위, DBA 실측 12종, "규칙 개수를 숫자로 박지 않는다"
- DBA 구현: `apps/api/src/database/health/sanitize.ts`(`createPgLogValueMasker`·`maskPgLogValues`·`maskPgDetailValues`·`maskSqlLiterals`)와 `sanitize.spec.ts`
- 기존 구현: `src/cluster/state/cluster-store.ts`(informer 캐시·`PodHistory`), `src/cluster/state/control-plane.ts`(`componentKindOf`), `src/aws-snapshots/write.guard.ts`(Origin·Content-Type)

### 3. 작업 내용

**(1) RBAC** — `deploy/rbac.yaml`에 `apiGroups:[""] resources:["pods/log"] verbs:["get"]` **한 블록만** 추가. 첫 줄 주석의 "pods/log 없음"을 고치고 **왜 열었는지 + 완화 수단 7가지 + "지우면 로그 기능만 403이고 다른 화면은 영향 없다"**를 적었다(AC-LOG01). `list`/`watch`도 주지 않았다 — `pods/log`에는 의미가 없고 동사를 늘릴 이유가 되지 않는다.

**(2) 가림 엔진 (`redact.ts`)** — 계약 3.2의 규칙 목록을 그대로. 동작 방식:

1. 원본 줄에 **정규식 규칙**을 돌려 "값이 있는 구간"을 모은다(`aws_access_key`·`aws_secret_key`·`bearer_token`·`jwt`·`kv_secret`·`conn_string`·`vendor_token`·`long_opaque`·`env_dump`·`extra`).
2. 같은 줄에 **DBA의 `createPgLogValueMasker()`**를 돌리고 **입력·출력을 비교**해 바뀐 구간을 찾는다(계약 3.2.1이 정한 판정 방식). 이 구간의 치환 결과는 `?` 계열 그대로 쓴다.
3. sql 구간과 겹치는 정규식 구간은 **sql 구간에 흡수**시킨다(같은 자리를 두 번 가리지 않는다). 나머지는 겹치는 것끼리 합친다.
4. 구간을 `segments[]`(`text`/`masked`)로 조립한다. `masked.v`는 **표기**(`ap****(12자)` 또는 `?`)이고 원문이 아니다.
5. 전체를 `try/catch`로 감싸 예외가 나면 `failed: true` + `segments: []` — **fail-closed**(AC-LOG10).

가림기는 **조회·스트림 1건당 하나**를 만들어 줄 순서대로 쓴다(DBA의 마스커가 여러 줄에 걸친 SQL 문장을 상태로 따라가기 때문).
개인 키 블록은 줄 단위 가림 **전에** `collapsePrivateKeyBlocks()`로 한 줄(`[가림: 개인 키 블록 N줄]`)로 접는다 — 안 그러면 블록 안 base64가 조각조각 나간다.

**(3) 줄 처리 (`line-processor.ts`)** — 순서가 중요하다: ① 개인 키 블록 접기 → ② 시각 분리(`timestamps=true`) → ③ ANSI·제어문자 정리 → ④ 바이너리 판정(인쇄 불가 30%) → ⑤ 바이트 상한 자르기(멀티바이트 안 쪼갬) → ⑥ **가림**. 가림을 마지막에 두는 이유는 ANSI 시퀀스가 값 중간에 끼면 규칙이 값을 못 알아보기 때문이다.

**(4) `direct` 출처 (`direct-source.ts`)** — `@kubernetes/client-node`의 `Log.log()`(= `pods/log`의 `get`)만 쓴다. 정지 조회는 `follow:false` + `limitBytes` + `tailLines`, 따라가기는 `follow:true` + `AbortController`. 오류를 계약 코드로 매핑(403 → `LOG_FORBIDDEN`, 404 → `LOG_POD_NOT_FOUND`, kubelet 연결 실패 → `LOG_KUBELET_UNREACHABLE`, 이전 세대 없음, 컨테이너 미시작). **이 모듈의 반환값은 아직 원문이고**, 호출부가 반드시 `processLines`(→ 가림)를 거치도록 머리말에 못 박았다.

**(5) 서비스 (`logs.service.ts`)** — `capabilities`(출처 2개·능력·한계 4줄·상한·가림 규칙 목록·차단 네임스페이스), `targets`(informer 캐시에서만, 기본 컨테이너는 **서버가** 고른다, 사라진 파드는 **200 + `exists:false`**), `query`(가림 → `segments[]` + `stats` + `notices`). **조회 결과를 필드에 담아두지 않는다**(응답을 만든 뒤 버린다).

**(6) 전용 스트림 (`log-stream.service.ts`)** — 준비(POST) → SSE(GET) → touch/close 3단계. 공용 스트림과 **봉투도 다르다**(`topic` 없음), `retry:`를 보내지 않는다. 슬롯은 **`LOG_MAX_STREAMS` 별도 카운터**. 250ms 배치, 초당 줄 수 상한 초과분은 `kind:'dropped'` 한 줄로, 유휴 시 **위쪽 연결을 실제로 끊고** `log.paused`, 최대 지속 시 `log.closing`.

**(7) 알림 연결 (`log-link.service.ts`)** — alerts가 쓰는 **링크 전용** 제공자. informer 캐시 + 최근 삭제 캐시(`PodHistory.deletedAtOf`)로 `gone`·`deletedAt`을 서버가 말한다. **파드가 사라져도 링크를 지우지 않는다.** 로그 줄은 여기로 나가지 않는다.

**(8) mock** — `logs` 그룹 9종(`direct`·`secrets`·`empty`·`noisy`·`binary`·`forbidden`·`pod-gone`·`control-plane`·`disabled`). 픽스처에는 **원문을 그대로** 넣고 서버가 가려서 내보내는 것을 확인한다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `deploy/rbac.yaml` | 수정 | `pods/log` `get` **1개만** + 첫 줄 주석(왜 열었나·완화 수단 7가지) |
| `.env.example`·`docker-compose.yml` | 수정 | `LOGS_ENABLED`·`LOG_DENY_NAMESPACES`·`LOG_MAX_STREAMS` 등 12개 |
| `deploy/app.example.yaml` | 수정 | **`LOGS_ENABLED=false` 기본** + 켜기 전 확인 3가지 |
| `apps/api/src/config/env.validation.ts` | 수정 | `LOG_*` 11개 + `LOG_DEFAULT_LINES <= LOG_MAX_LINES` |
| `apps/api/src/logs/logs.types.ts` | 추가 | 응답 타입. **원문 필드 없음** |
| `apps/api/src/logs/logs.options.ts` | 추가 | 상한·차단 목록·추가 패턴 |
| `apps/api/src/logs/redact.ts` | 추가 | 가림 엔진 (규칙 목록 = 정본) |
| `apps/api/src/logs/redact.spec.ts` | 추가 | **22건** (AC-LOG04·06·10·49 포함) |
| `apps/api/src/logs/line-processor.ts` | 추가 | ANSI·제어문자·바이너리·자르기·시각 분리 |
| `apps/api/src/logs/line-processor.spec.ts` | 추가 | **13건** |
| `apps/api/src/logs/direct-source.ts` | 추가 | `pods/log` get (정지·따라가기) |
| `apps/api/src/logs/logs.service.ts` | 추가 | capabilities·targets·query |
| `apps/api/src/logs/log-stream.service.ts` | 추가 | 전용 SSE·슬롯·배치·유휴·최대 지속 |
| `apps/api/src/logs/log-link.service.ts` | 추가 | alerts용 **링크만** |
| `apps/api/src/logs/logs.controller.ts` | 추가 | REST 6개 + `direct` 제약 검증 |
| `apps/api/src/logs/dto.ts` | 추가 | 요청 DTO (**가림 끄는 필드 없음**) |
| `apps/api/src/logs/logs.extensions.ts` | 추가 | MockScenarioTarget `logs` (**TopicSource 없음**) |
| `apps/api/src/logs/mock/mock-logs.ts` | 추가 | 시나리오 9종 픽스처 |
| `apps/api/src/logs/logs.module.ts` | 추가 | 모듈 (`LogLinkService` export) |
| `apps/api/src/cluster/state/cluster-store.ts` | 수정 | `PodHistory.deletedAtOf()` 공개 |

### 5. 주요 결정과 이유

- **가림 판정을 "구간 수집 → 병합 → 조립"으로 만들었다.** 문자열을 순차 치환하면 좌표가 밀려 `segments[]`를 만들 수 없고, 규칙 간 순서에 결과가 의존한다. 원본 좌표로 구간만 모으면 규칙 순서가 결과를 바꾸지 않는다.
- **`sql_statement`만 입력·출력 비교로 구간을 찾는다**(계약 3.2.1이 정한 방식). DBA 마스커는 치환된 문자열만 돌려주므로 앞뒤 공통 부분을 잘라 바뀐 구간을 찾았다. 한 줄에 치환이 여러 곳이면 **한 조각으로 합쳐진다** — 값이 더 넓게 가려질 뿐 새는 쪽으로는 틀리지 않는다.
- **줄 전체에 `maskSqlLiterals`를 돌리지 않았다.** DBA 실측대로 타임스탬프·PID가 `?`가 된다. 검증에서 `2026-09-25 14:02:10.412 UTC [1834]`와 제약 이름 `"users_email_key"`가 그대로 남는 것을 확인했다.
- **개인 키 블록을 줄 가림보다 먼저 접었다.** 나중에 접으면 블록 안 base64 줄이 `long_opaque`로 조각조각 나가 "가렸지만 다 보이는" 상태가 된다.
- **`LOG_REDACT_EXTRA_PATTERNS`의 잘못된 정규식은 무시하고 경고도 남기지 않는다.** 패턴 자체가 비밀값의 모양을 담을 수 있어 로그에 찍으면 안 된다. 기능을 멈추지도 않는다.
- **`POST`에 `SnapshotWriteGuard`를 재사용했다.** Origin 검사 + `Content-Type: application/json`(415)이 계약 2.2가 요구하는 것과 같다. 새 가드를 만들면 규칙이 두 벌이 된다.
- **`logBackend` `SourceId`를 추가하지 않았다.** 스택 어댑터가 L3라 지금 추가하면 `GET /api/health`에 **확인하지도 않는 출처**가 생긴다. `capabilities.sources[]`의 `stack` 항목은 `not_configured`로 자체 제공한다.
- **`targets`는 informer 캐시에서만 만든다.** 로그 때문에 쿠버네티스를 더 부르지 않는다는 명세 4절을 코드에서 지켰다.

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과** | |
| `npm test --prefix apps/api` | **566 passed / 2 skipped** | logs 신규 **35건**(redact 22 + line-processor 13) |
| `npm run build --prefix apps/api` | **통과** | |

**mock 기동 검증** (포트 3131, `DATA_SOURCE=mock`). 내가 띄운 PID가 실제로 3131을 듣는지 `netstat -ano`로 확인하고 **그 PID만** 종료했다.

**AC-LOG49 — `logs=secrets` 픽스처의 Postgres 실패 SQL 덩이 (서버가 실제로 내보낸 줄)**

```
2026-09-25 14:02:10.412 UTC [1834] ERROR:  duplicate key value violates unique constraint "users_email_key"
2026-09-25 14:02:10.412 UTC [1834] DETAIL:  Key (email)=(?) already exists.
2026-09-25 14:02:10.413 UTC [1834] DETAIL:  Failing row contains (?).
2026-09-25 14:02:10.413 UTC [1834] STATEMENT:  INSERT INTO users (email, name) VALUES (?, ?)
```

값만 `?`가 됐고 **타임스탬프·PID·심각도·제약 이름·테이블 이름·컬럼 이름·문장 구조가 전부 남았다**. 규칙 이름은 `sql_statement`로 표시된다.

| 확인 | 결과 |
|---|---|
| **AC-LOG04** | `AKIA…`→`AK****(20자)`, `Bearer eyJ…`→`ey****(107자)`, `DB_PASSWORD=…`→`s3****(15자)`, `sk-ant-…`→`sk****(45자)`, PEM 블록→`[가림: 개인 키 블록 4줄]` |
| **AC-LOG05** | 응답 본문 **전체 문자열 검색**: `s3cr3t-p4ssw0rd`·`hunter2hunter2`·`AKIAIOSFODNN7EXAMPLE`·`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`·`sk-ant-api03-EXAMPLE`·`a@b.com`·`alice`·`MIIEowIBAAKCAQEA` → **전부 0건** |
| **AC-LOG06** | `postgres://ap****(22자)@postgres.db.svc:5432/app` — 자격 증명만 가리고 호스트·포트·DB 이름 유지 |
| 오탐 표시 | 커밋 해시 → `9f****(40자)` + `confidence: "suspect"` + 규칙 이름 `긴 불투명 문자열` |
| 식별자 보존 | `i-0a1b2c3d4e5f60718`·IP·스택 트레이스 줄 번호(`OrderService.java:142`) **가리지 않음** |
| **AC-LOG18** | ANSI 제거(응답에 `[31m` 0건), 제어문자 `·`, 8KiB 초과 줄 `truncatedBytes: 817`, 바이너리 줄 `kind:'binary'` + `bytes:70`, 한국어 정상 |
| **AC-LOG14** | `limit: 99999` → 400이 아니라 5000으로 자르고 `LOG_LIMIT_CLAMPED{requested:99999, applied:5000}` |
| **AC-LOG23** | 스트림 3개 후 4번째 → **503 `LOG_STREAM_LIMIT_REACHED{open:3,max:3}`**. 그 상태에서 **공용 SSE는 정상 동작** (별도 카운터). 닫으면 `streams.open` 3→0 |
| 전용 스트림 | `log.hello`(봉투에 **`topic` 없음**) → `log.lines`(첫 배치 `initial:true`) → 250ms 배치로 9회 수신. **`retry:` 줄 0개** |
| 수명 | 살아 있는 스트림 `touch` → **202**, `close` → **204**(재호출도 204), 없는 id → **404 `LOG_STREAM_NOT_FOUND`** |
| `empty` | `lines: 0` + `LOG_EMPTY` (**오류가 아니다**) |
| `noisy` | `droppedLines: 5000` + `LOG_DROPPED_LINES` |
| `forbidden` | **403 `LOG_FORBIDDEN`** |
| `pod-gone` | `targets` **200 + `exists:false` + `deletedAt`** + `LOG_POD_NOT_FOUND` notice / `query`는 **404** (계약 13절대로) |
| `disabled` | `capabilities`만 **200 + `enabled:false`**, `targets`·`query`는 **403 `LOG_DISABLED`** |
| 컨트롤 플레인 | `etcd-manager-main-i-…` → `isControlPlaneComponent: true` + `LOG_APISERVER_SELF_DEPENDENCY`·`LOG_CONTROL_PLANE_SENSITIVE` |
| `direct` 제약 | `search` → 400, `pods[]` → 400, `source:"stack"` → 400, `previous`+스트림 → 400. **오류 응답에 입력값 0건**(`value` 미포함 확인) |
| Origin·Content-Type | 허용 안 된 Origin → **403**, `Content-Type` 없음 → **415** |
| **AC-LOG22** | `GET /api/stream?topics=logs` → **400**. 공용 스트림에 로그 토픽 없음 |
| **AC-LOG12** | `/api/logs/download`·`/export`·`/raw` → **404** (만들지 않았다) |
| **AC-LOG21** | 어드바이저 스냅샷(30KB)에 `STATEMENT:`·`Failing row`·`hunter2hunter2`·`AKIA`·`Bearer`·`segments` **전부 0건** |

**하지 못한 검증(숨기지 않고 적는다)**

- **실제 클러스터에 붙여 `pods/log`를 호출하지 못했다.** `direct-source.ts`의 live 경로(`Log.log()` 호출·오류 매핑·`follow` 재연결)는 **한 번도 실행되지 않았다.** mock 검증은 `LogsService` 위쪽만 덮는다 → 월요일 확인 목록 1순위.
- `kubectl auth can-i --list`(AC-LOG02)를 돌리지 못했다(클러스터 없음). `rbac.yaml` 텍스트로만 확인했다.
- 유휴 5분 일시정지(`log.paused`)·30분 강제 종료(`log.closing`)는 **기다려야 해서 확인하지 못했다.** 코드 경로는 5초 주기 감시 타이머 하나이고 `touch` 202 응답으로 시각 갱신만 확인했다.
- **오퍼레이터의 JSON 로그 형식**에서 `sql_statement`가 어떻게 동작하는지 실측하지 못했다(DBA가 남긴 한계 그대로).
- `stack` 출처(L3)는 구현하지 않았다. `capabilities`에 `not_configured`로만 나온다.

### 7. 남은 이슈·한계

- **L2 미구현**: 이벤트·워크로드·DB·컨트롤 플레인 화면의 진입점, `ControlPlaneComponent.logHref` 추가(`GET /api/cluster/control-plane`). 컨트롤 플레인 파드의 **로그 자체는 이미 읽힌다**(같은 `pods/log` 경로, RBAC 추가 없음).
- **L3 미구현**: `stack` 어댑터, `logBackend` `SourceId`, 서버 검색·기간·합쳐보기·사라진 파드 조회, `LOG_BACKEND_*` 환경 변수는 `.env.example`에 자리만 있고 읽지 않는다.
- `containers[].restarts.last1h`가 항상 0이다(파드 상세와 달리 `PodHistory` 집계를 붙이지 않았다). 화면은 `total`과 `waitingReason`으로 충분하고, 필요해지면 `ClusterStateService`의 계산을 가져오면 된다.
- 긴 줄(9,000자 `x` 반복)이 `long_opaque`(suspect)로도 잡힌다. 규칙상 맞지만 노이즈가 될 수 있다 — 실제 로그를 보고 판단할 항목.
- 요청 로깅 미들웨어는 **원래 없다**(확인함). 나중에 넣는다면 `POST /api/logs/query` 본문을 반드시 제외해야 한다.

### 8. 다른 담당 요청

- **DBA 요청 없음.** `sanitize.ts`의 함수를 **그대로 가져다 썼고 `apps/api/src/database/**`를 수정하지 않았다.** 로그는 계약 11.1대로 **DB에 아무것도 저장하지 않으므로 스키마 변경도 없다.**
  - 참고 전달: `createPgLogValueMasker()`가 의도대로 동작하는 것을 실제 응답으로 확인했다(위 AC-LOG49 출력). 다만 **실제 파드 로그로는 여전히 미검증**이다.
- **frontend 요청**: ① 로그 전용 연결은 공용 SSE와 별개로 관리하고 `log.closing`을 받으면 `EventSource.close()`를 부른다(자동 재연결하면 404 루프) ② 화면을 떠날 때 `POST …/close`를 반드시 부른다 — 안 부르면 슬롯 3개가 금방 찬다(SSE 연결이 끊기면 서버가 회수하지만, 탭이 살아 있으면 계속 점유한다) ③ `segments[]`를 그대로 그리고 정규식으로 다시 파싱하지 않는다.
- **publisher 요청**: `LogLine.kind` 4종(`line`·`dropped`·`binary`·`redactFailed`)이 실제로 응답에 나온다. `redactFailed`는 `[가림 처리 실패 — 줄 생략]`으로 그리고 **원문을 대신 보여주지 않는다**.
- **planner 요청(기존 그대로)**: 명세 3.3.2의 `sql_statement` 반영 여부. 계약·구현은 이미 그 기준이다.

### 9. 다음 담당이 알아야 할 점

- **가림 규칙을 늘릴 때는 `redact.ts`의 `REDACTION_RULES` + `VALUE_RULES` 두 곳과 `redact.spec.ts`를 같이 고친다.** 목록이 정본이고 개수는 어디에도 숫자로 박혀 있지 않다(`capabilities.redaction.rules`가 이 목록을 그대로 내보낸다).
- **가림기는 조회 1건당 하나**(`createLineRedactor()`)를 만들어 **줄 순서대로** 쓴다. 재사용하거나 순서를 섞으면 여러 줄 SQL 문장 추적이 깨진다.
- **로그가 나가는 문은 `processLines()` 하나다.** `direct-source.ts`의 반환값을 응답에 직접 실으면 원문이 나간다.
- **저장 없음이 이 기능의 핵심 약속이다**: DB·디스크·응답 캐시·**API 자체 로그** 어디에도 남기지 않는다. `direct-source.ts`는 실패도 **코드로만** 남기고 셀렉터·검색어·본문을 찍지 않는다.
- **`LOG_MAX_STREAMS`는 `SSE_MAX_CLIENTS`와 별도 카운터다.** 한쪽을 다른 쪽으로 합치지 말 것(AC-LOG23).
- **alerts가 `LogLinkService`를 쓴다**(링크만). 여기에 로그 줄·요약을 돌려주는 메서드를 추가하지 말 것 — 알림과 로그를 잇는 것은 링크 하나다.

---

## 2026-09-24 23:40 · logs L2 구현 (외부 로그 스택 · 출처 중립 어댑터)

### 1. 요청 내용

PM 지시(2단계). **Loki 전제, 다만 출처 중립 계약을 지킬 것.**
- LogQL이 응답에 노출되면 안 되고, Elasticsearch 어댑터를 나중에 붙일 자리를 남긴다 (AC-LOG47)
- `capabilities`를 **서버가** 내려준다. 화면이 추론하지 않는다
- **출처 자동 전환 금지.** 스택이 죽어도 자동으로 직접 조회로 내려가지 않는다
- 가림은 **두 출처 모두에** 적용된다. 스택에서 온 줄이라고 건너뛰면 안 된다
- **회사 클러스터에 스택이 있는지 아직 모른다.** 없어도 L1이 동작해야 하고, 설정이 없으면 `unknown`

> 명세 번호로는 이 작업이 **L3(AC-LOG35~48)**이다(L2는 동선·컨트롤 플레인, AC-LOG25~34). PM 지시가 "L2 = 외부 로그 스택"이라 그 범위대로 했고, **L2 항목 중 계약에 명시된 `ControlPlaneComponent.logHref` 1개는 함께** 넣었다(프론트가 지금 컨트롤 플레인 매트릭스를 통합 중이라 필요하다). 나머지 L2 동선(이벤트·워크로드·DB 화면 진입점)은 하지 않았다.

### 2. 참고한 문서

- `docs/api/logs.md` 1.1·2.1.1·2.2·6·8·9·10·13절(내가 쓴 계약), `docs/specs/logs.md` AC-LOG35~48
- `docs/reports/logs/README.md` — 월요일 확인 목록 Q1(스택 유무·제품), 회사 Loki 라벨 이름(U2)
- 기존: `src/common/source-registry.service.ts`, `src/health/health.service.ts`, `src/database/health/sanitize.ts`

### 3. 작업 내용

**(1) 출처 중립 경계 (`backend/log-backend.port.ts`)** — 서비스·컨트롤러·응답이 아는 것은 이 인터페이스뿐이다: 셀렉터(네임스페이스·파드들·컨테이너들·워크로드)·기간·줄 수·검색어 → `LogBackendEntry[]`(시각·줄·파드·컨테이너·stdout/stderr). **LogQL·라벨 이름·인덱스 이름이 이 경계를 넘지 않는다.**

**(2) Loki 어댑터 (`backend/loki.adapter.ts`)** — LogQL이 존재하는 **유일한 파일**.
- 라벨 이름은 전부 설정값(`LOG_BACKEND_LABEL_*`). 회사 Loki가 다른 이름을 써도 코드를 고치지 않는다 (AC-LOG46).
- 라벨 값에서 정규식·따옴표 문자를 지워 **셀렉터를 빠져나갈 수 없게** 한다(DTO가 이미 막지만 여기서 한 번 더).
- 401/403 → `LOG_BACKEND_AUTH_FAILED`(**토큰·주소를 메시지에 넣지 않는다**), 4xx → `LOG_BACKEND_QUERY_REJECTED`(**스택이 준 사유를 가림 처리해 그대로**), 그 밖 → `LOG_BACKEND_UNAVAILABLE`.
- **따라가기는 websocket `/tail` 대신 `query_range` 2초 폴링**으로 구현했다. 이유: ① 프록시·인그레스가 websocket을 막는 환경이 흔하다 ② 재연결·백프레셔를 직접 다루지 않아도 된다 ③ 어차피 250ms 배치로 묶어 내보내므로 화면 체감이 같다. 이 선택은 **어댑터 안에만** 있어 나중에 websocket으로 바꿔도 위쪽이 바뀌지 않는다.

**(3) mock 스택 (`backend/mock-stack.adapter.ts`)** — 같은 인터페이스를 구현한다. 서비스는 mock인지 알지 못한다 — **출처 중립이 실제로 지켜지는지를 이 어댑터가 증명한다.** 검색·기간·합쳐보기·사라진 파드가 실제 Loki 없이 동작한다.

**(4) 출처 상태 (`backend/log-backend.service.ts`)** — 새 `SourceId` `logBackend`(주기 30초, stale 90초)를 추가하고 `GET /api/health`의 `checks.logBackend`에 실었다. **`not_configured`는 `degraded`로 치지 않는다.** 로그 화면이 열릴 때만 확인한다(30초에 한 번 이하).
**자동 전환을 하지 않는다**: 스택이 죽어도 `activeSource`는 `stack`으로 남고 `LOG_BACKEND_UNAVAILABLE` 안내만 붙는다. 전환은 사용자 클릭이다.

**(5) 서비스 분기** — `capabilities`가 두 출처의 능력·칩·한계를 **서버 값으로** 내려주고, `query`는 `source`에 따라 어댑터/`pods/log`로 간다. **두 경로가 같은 `processLines`(→ 가림)를 지난다** — 출처에 따라 규칙이 갈라지는 자리가 없다.
여러 파드를 볼 때 **줄마다** 파드·컨테이너가 붙도록 `processLines`에 `prefixes[]`·`streams[]`를 더했다(개인 키 블록 접기로 줄 번호가 밀리므로 `collapsePrivateKeyBlocks`가 원본 인덱스 맵을 함께 돌려준다).

**(6) 요청 검증을 "능력대로"** — 컨트롤러가 `capabilities`와 **같은 값**을 보고 막는다. 능력 표를 컨트롤러가 따로 들면 두 벌이 되어 어긋난다.

**(7) `ControlPlaneComponent.logHref`** — 링크를 줄 수 있는지 판단하는 규칙을 `logs/log-href.ts`(의존성 없는 잎 모듈)로 빼고 **`alerts`의 `logHref`와 컨트롤 플레인 매트릭스가 같은 함수를 쓴다**. `LogsModule → ClusterModule` 방향이라 반대로 import하면 순환이 되므로, ClusterModule은 **값만 읽고 규칙은 공용 함수**를 쓴다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/logs/backend/log-backend.port.ts` | 추가 | **출처 중립 경계** |
| `apps/api/src/logs/backend/loki.adapter.ts` | 추가 | LogQL이 있는 유일한 파일 |
| `apps/api/src/logs/backend/loki.adapter.spec.ts` | 추가 | 7건 (AC-LOG43·44·46·47) |
| `apps/api/src/logs/backend/mock-stack.adapter.ts` | 추가 | 실제 Loki 없이 동작 |
| `apps/api/src/logs/backend/log-backend.service.ts` | 추가 | 어댑터 소유·출처 상태·자동 전환 금지 |
| `apps/api/src/logs/log-href.ts` | 추가 | 링크 가능 판단 **한 곳** (alerts·컨트롤 플레인 공용) |
| `apps/api/src/logs/logs.service.ts` | 수정 | 스택 능력·칩·조회, 두 출처 공통 가림 |
| `apps/api/src/logs/logs.controller.ts` | 수정 | **능력 기반** 검증 |
| `apps/api/src/logs/log-stream.service.ts` | 수정 | 스택 따라가기, 줄마다 파드·컨테이너 |
| `apps/api/src/logs/logs.options.ts` | 수정 | `LOG_BACKEND_*` |
| `apps/api/src/logs/log-link.service.ts` | 수정 | 공용 함수 사용 |
| `apps/api/src/logs/line-processor.ts` | 수정 | `prefixes[]`·`streams[]` |
| `apps/api/src/logs/redact.ts` | 수정 | 접기 결과에 원본 인덱스 맵 |
| `apps/api/src/logs/mock/mock-logs.ts` | 수정 | `stack`·`stack-down` 시나리오 |
| `apps/api/src/logs/logs.module.ts` | 수정 | `LogBackendService` |
| `apps/api/src/common/source-registry.service.ts` | 수정 | `SourceId` `logBackend` |
| `apps/api/src/health/health.service.ts` | 수정 | `checks.logBackend` |
| `apps/api/src/cluster/types.ts` | 수정 | `ControlPlaneComponent.logHref` |
| `apps/api/src/cluster/state/control-plane.ts` | 수정 | 평가 단계에서는 `null` |
| `apps/api/src/cluster/cluster-query.service.ts` | 수정 | 응답에 `logHref` 채움 |
| `apps/api/src/config/env.validation.ts` | 수정 | `LOG_BACKEND_*` 12개 + 교차 검증 |
| `.env.example` · `docker-compose.yml` | 수정 | 같은 값 |

### 5. 주요 결정과 이유

- **mock 어댑터를 같은 인터페이스로 만들었다.** 서비스에 `if (mock)` 분기를 두면 출처 중립이 "약속"으로만 남는다. 같은 포트를 구현하면 **중립성이 컴파일러로 강제된다.**
- **따라가기를 폴링으로.** websocket은 환경 의존이 크고 재연결 처리가 붙는다. 250ms 배치로 묶어 보내므로 2초 폴링도 화면에서는 같아 보인다. 어댑터 안에 갇혀 있어 나중에 바꿀 수 있다.
- **mock 스택의 보관 기간(3일)을 기간 상한(7일)보다 짧게** 잡았다. 둘이 같으면 `LOG_RETENTION_EXCEEDED`가 영영 나오지 않아 AC-LOG38을 확인할 수 없다. 실제 Loki에서도 흔한 조합이다.
- **mock 스택이 비밀값 픽스처를 섞어 준다.** AC-LOG41은 "AC-LOG04~08을 `stack` 출처에서 다시 확인"을 요구하는데, 스택 시나리오가 평범한 줄만 주면 확인할 수 없다.
- **mock `direct`도 없는 파드는 404로** 바꿨다. 전에는 어떤 이름을 넣어도 픽스처를 돌려줘서 "스택은 사라진 파드를 읽고 직접 조회는 못 읽는다"는 차이를 눈으로 볼 수 없었다.
- **`logBackend` SourceId를 이제 추가했다.** L1에서는 "확인하지도 않는 출처를 health에 띄우는 것은 거짓"이라 미뤘는데, 이번에 실제로 확인하므로 넣는 것이 맞다.
- **링크 판단을 잎 모듈로 뺀 것**이 `ControlPlaneComponent.logHref`를 순환 import 없이 넣는 유일한 방법이었다. 규칙을 복사했다면 `LOG_DENY_NAMESPACES`를 켰을 때 한쪽만 막혔을 것이다 — 그렇게 되지 않는 것을 기동으로 확인했다.

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/api` | **통과** |
| `npm test --prefix apps/api` | **590 passed / 2 skipped** (logs 신규 7건 포함) |
| `npm run build --prefix apps/api` | **통과** |

**mock 기동 검증** (포트 3131, PID를 `netstat -ano`로 확인 후 그 PID만 종료)

| 확인 | 결과 |
|---|---|
| **AC-LOG35** | 스택 미설정 → `activeSource: direct`, `stack.state: not_configured`, `selectable: false`, 툴팁 제공, `capabilities: null` |
| **AC-LOG36** | `logs=stack` → `activeSource: stack` **자동 선택**, `productLabel: "Loki"`, 칩 `검색·기간·사라진 파드·합쳐보기·보관 3일` |
| **AC-LOG37** | 검색 `OOM` → 15줄 **전부 포함**, `searchScope: "server"`, `labels.search: "검색"` |
| **AC-LOG38** | 6일 전 요청 → **200 + `LOG_RETENTION_EXCEEDED`**(`details.retentionHours: 72`), **결과는 그대로**. 상한(168h) 초과는 **400** |
| **AC-LOG39** | 파드 3개 → 12줄이 **시각 오름차순으로 섞이고** 줄마다 `prefix{pod, container}` + `stream`. 따라가기 배치에서도 유지 |
| **AC-LOG40** | 사라진 파드: **stack 200(5줄) / direct 404 `LOG_POD_NOT_FOUND`** |
| **AC-LOG41** | stack 응답 34줄 중 **11줄 가림**, 규칙 `env_dump·bearer_token·jwt·aws_access_key·conn_string·kv_secret·vendor_token·long_opaque·sql_statement(3)·private_key_block`. 원문(`s3cr3t-p4ssw0rd`·`hunter2hunter2`·`AKIA…`·`a@b.com`·`alice`·PEM) **전부 0건** |
| **AC-LOG42** | `stack-down` → `activeSource`가 **`stack`으로 유지**(자동 전환 없음), `state: unavailable`, `LOG_BACKEND_UNAVAILABLE` notice, stack 조회 503. **사용자가 direct를 고르면 정상 동작**(200) |
| **AC-LOG43** | 400 응답의 사유가 `detail`로 그대로 올라온다(`max entries limit exceeded: 5000 > 1000`). 서버가 조용히 줄이지 않는다 |
| **AC-LOG44** | 401에서 토큰 `SUPERSECRET`이 메시지·detail에 **0건**. 연결 실패 메시지에 호스트·IP **0건** |
| **AC-LOG45** | `GET /api/health`에 `checks.logBackend` 존재, `not_configured`·`unavailable`이 **전체 `status`를 degraded로 만들지 않는다** |
| **AC-LOG46** | 라벨을 `k8s_ns`/`k8s_pod`로 바꾸면 **그 이름으로** 쿼리한다 |
| **AC-LOG47** | 응답·스트림 전체에 `{namespace=`·`|~`·`query_range` **0건** |
| **AC-LOG48** | 위 전부가 **실제 Loki 없이** 동작 |
| 셀렉터 주입 | `prod"} |= "secret`을 넣어도 `|=`가 사라지고 따옴표 2개만 남는다(셀렉터를 못 빠져나간다) |
| `logHref` 공용 규칙 | 켰을 때 컨트롤 플레인 15칸 전부 링크. **`LOGS_ENABLED=false`면 컨트롤 플레인 0/15 + 알림 `logHref: null`(`unavailableReason: logs_disabled`)** — 한 규칙이 두 곳에 같이 적용된다 |
| 회귀 | `direct`+`secrets`에서 AC-LOG49 출력 그대로, 알림 배지 3·`gaps` 1건 유지 |

**하지 못한 검증(숨기지 않고 적는다)**

- **실제 Loki에 붙여 보지 못했다.** `LokiAdapter`의 HTTP 경로는 **`fetch`를 가로챈 단위 테스트뿐**이다. 실제 응답 형식(`data.result[].values`의 나노초 문자열), 라벨 존재 여부, `/loki/api/v1/labels` ping 경로, 대량 응답 성능은 확인하지 못했다. **회사에 스택이 있는지도 아직 모른다**(월요일 확인 Q1).
- **`pods/log` live 경로도 여전히 미검증**이다(L1 보고서와 같은 한계).
- 폴링 따라가기의 **중복·누락**(같은 나노초에 여러 줄, 시계 차이)을 실제 Loki로 확인하지 못했다. 지금은 마지막 줄의 시각 + 1ms부터 다시 조회하므로 **같은 밀리초 안의 줄이 빠질 수 있다.**
- Elasticsearch 어댑터는 만들지 않았다(L4). 경계만 열어 뒀다.
- `LOG_BACKEND_BASIC_AUTH`·`LOG_BACKEND_TENANT` 경로는 코드 검토만 했다(헤더 생성 단위 테스트 없음).

### 7. 남은 이슈·한계

- **L2 동선 미구현**: 이벤트·워크로드·DB 화면의 로그 진입점(AC-LOG25~34 중 일부). `ControlPlaneComponent.logHref`만 넣었다.
- `workload` 셀렉터는 포트에 자리만 있고 **Loki 어댑터가 아직 쓰지 않는다**(파드 목록으로만 조회). 워크로드 단위 조회는 화면이 파드 목록을 넘기면 동작한다.
- 스택 조회에 `container`를 1개만 넘긴다(포트는 배열을 받는다). 컨테이너 전체 보기는 `container`를 비우면 된다.
- mock 스택의 `stack-down`은 **연결 실패만** 재현한다(인증 실패·쿼리 거부 시나리오는 단위 테스트에만 있다).

### 8. 다른 담당 요청

- **DBA 요청 없음.** 로그는 계약 11.1대로 **DB에 아무것도 저장하지 않는다.** `sanitize.ts`를 읽기만 했다.
- **frontend 요청**: ① `capabilities.sources[].capabilities`·`chips`·`limitations`를 **그대로** 쓰고 출처 이름으로 추론하지 말 것 ② `activeSource`가 `stack`인데 `state: unavailable`이면 **전환 버튼**을 그리고 **자동으로 바꾸지 말 것** ③ 합쳐보기에서는 줄마다 `prefix{pod, container}`가 오고 단일 파드면 `null`이다 ④ `stream`(stdout/stderr)은 스택에서만 온다 ⑤ `ControlPlaneComponent.logHref`가 **새로 생겼다**(nullable, 기존 필드 변화 없음) — 컨트롤 플레인 매트릭스 각 칸의 로그 진입점이다.
- **planner 요청**: 이번 작업이 명세 번호로는 **L3**다. PM이 "L2 = 외부 로그 스택"으로 불렀으므로 명세의 단계 표(L2/L3 정의)와 어긋난다 — 어느 쪽으로 정리할지 확인이 필요하다.

### 9. 다음 담당이 알아야 할 점

- **LogQL은 `loki.adapter.ts` 안에만 있다.** 다른 파일에서 쿼리 문자열을 만들면 출처 중립이 깨진다. Elasticsearch를 붙일 때는 `LogBackendPort` 구현 1개만 추가하고 `LogBackendService`의 생성 분기에 끼우면 된다 — **응답 모양과 화면은 바뀌지 않아야 한다.**
- **가림은 출처와 무관하게 `processLines` 한 곳**을 지난다. 새 출처를 붙일 때 그 파이프라인을 우회하면 원문이 나간다.
- **링크 가능 판단은 `log-href.ts` 하나**다. 세 번째 사용처가 생겨도 이 함수를 쓴다.
- **`logBackend` 출처 확인은 로그 화면이 열릴 때만** 돈다(`capabilities` 호출이 방아쇠다). 백그라운드 타이머가 없다.
- 월요일에 스택이 있다고 확인되면 `LOG_BACKEND=loki` + `LOG_BACKEND_URL`만 채우면 된다. **라벨 이름이 다르면 `LOG_BACKEND_LABEL_*`만 바꾼다** — 코드는 고치지 않는다.

## 2026-09-25 06:45 · 통합 1차 후속 + L2 서버 몫

### 1. 요청 내용

PM 5b 지시(통합 1차에서 올라온 요청 + L2 서버 몫). 작업 중 PM·designer 추가 지시 4건을 함께 처리했다.

| # | 요청 | 결과 |
|---|---|---|
| 1 | **결함**: `cluster` 토픽 SSE(`cluster.snapshot`·`cluster.controlplane.updated`)의 `ControlPlaneComponent.logHref`가 항상 `null`. mock·live 모두 고치고 **SSE = REST 테스트** | 완료 — 링크를 평가 단계로 옮김. 회귀 테스트 7건 |
| 2 | **D3**: `buildLogHref`가 따라가기 여부를 받게. 매트릭스 `follow=1`, 알림은 붙이지 않음. 규칙은 파일 한 곳 | 완료 — **자리별 규칙 표**(`LOG_HREF_ENTRY_RULES`) |
| 3 | **`at` 의미 정의**(Q11) — 계약에 없으면 출처별로 | 없었다 → **계약 2.2.1 신설** + 서버 구현(`anchorAt`) |
| 4 | mock: `log.notice`·`log.paused`·`log.closing`을 수십 초 안에 | 완료 — `stream-notice`(10초)·`idle-pause`(20초)·`max-duration`(30초) |
| 5 | L2 서버 몫: 진입점 2·4·5·7에서 링크 가능 여부를 알 방법을 계약 먼저 + 구현. 워크로드 → 소속 파드 | 완료 — **계약 11.4** + `PodItem`·`WorkloadItem`·`EventItem`에 `logHref`(추가 전용 nullable). 선택기는 기존 API로 충분(새 엔드포인트 0) |
| 추가 1 (PM) | Q12 규칙 하나로: 지금 상태 → `follow=1` / 지난 시점(알림·Warning 이벤트) → `at` | 2번 표가 그대로 이 규칙이다. designer `design/logs.md` 6.2 표와 대조 — **일치** |
| 추가 2 (PM) | 스트림 상한 문구를 PM 확정 문구로(서버가 문구를 준다면) | **서버가 준다**(503 `message`) → 바꿨다 |
| 추가 3 (PM) | `logs=flood` — 따라가기에 초당 상한 가까이, 2만 줄이 수십 초 안에, 가림 대상 섞기 (AC-LOG51) | 완료 — 초당 1,600줄, **실측 13.5초에 2만 줄** |
| 추가 4 (designer→PM) | 유휴 문구 `이 화면이 5분 동안 보이지 않아…`(design 7.4 표) / alerts 계약 11절 / 발송 칩 2종 mock 이력 / 6.2 대조 | 완료 — 30분 문구도 7.4 표대로. alerts 쪽은 `docs/reports/alerts/backend.md` 같은 시각 섹션 |

### 2. 참고한 문서

- `docs/reports/logs/README.md` "PM 결정 — 통합 1차에서 올라온 것"(D1~D3·SSE 결함·L2 남은 것), "planner가 반영 중 올린 확인 요청 3건"(Q11~Q13·상한 문구)
- `docs/reports/alerts/README.md` 같은 이름의 절
- `docs/reports/logs/frontend.md`·`docs/reports/alerts/frontend.md` 7·8절, `docs/reports/logs/designer.md`·`docs/reports/alerts/designer.md` 01:30 섹션 8절
- `docs/api/logs.md` 전체, `docs/api/alerts.md` 2.2.1·5·11절, `docs/api/cluster-status.md` 1.2~1.6·8.2, `docs/api/common.md` 6.1
- `docs/specs/logs.md` 3.7·3.8.1·5절 L2(AC-LOG25~34), `docs/design/logs.md` 0·6.2·7.4·10·11·15절
- 내 이전 섹션: 이 파일 23:40, `docs/reports/alerts/backend.md` 23:40

### 3. 작업 내용

**(1) SSE `logHref` 결함 — 원인과 수정**

- 원인: `ClusterQueryService.controlPlane()`(REST)만 `components.items`를 **꾸며서** `logHref`를 채우고, SSE(`ClusterTopicSource`)는 평가 결과 `v.controlPlane`을 그대로 보냈다. 평가 단계(`control-plane.ts`)는 `logHref: null`로 두었다. **값을 채우는 자리가 REST 한 곳이라 SSE가 갈라졌다.**
- 수정: **링크를 평가 단계에서 채운다.** `evaluateCluster()` 입력에 `logLinks`(링크 가능 여부 값)를 넣고 `ControlPlaneComponent`·`PodItem`·`WorkloadItem`·`EventItem`을 만들 때 `buildLogHref`를 부른다. REST와 SSE가 **같은 항목 객체**를 보내므로 구조적으로 갈라질 수 없다. REST의 꾸미기 코드는 지웠다.
- mock·live 둘 다 `ClusterStore → evaluateCluster` 한 경로라 한 번에 고쳐진다.
- **회귀 테스트** `cluster-loghref.http.spec.ts`: `cluster.snapshot`·`cluster.controlplane.updated`(미러 파드를 CrashLoop로 바꿔 실제로 발생시킴) 값과 `GET /api/cluster/control-plane` 값을 칸마다 비교. **"둘 다 null이라 같다"도 막는다**(링크가 실제로 있어야 통과). 파드·이벤트·워크로드도 스냅샷과 REST를 비교한다.

**(2) 링크 규칙 한 곳 — `logs/log-href.ts`**

- 자리(`entry`)를 받는다: `pod`·`controlPlane`·`workload`·`event`·`alert`. **`follow`/`at`은 호출부가 아니라 파일 안의 표가 정한다**(PM "규칙은 이 파일 한 곳에만"). 지시문은 "따라가기 여부를 받게"였지만, 여부를 호출부가 넘기면 규칙이 호출부 5곳에 흩어진다 → 자리를 받고 표가 정하게 했다.

| 자리 | follow | at |
|---|---|---|
| `pod` (파드 목록 행·파드 상세·DB 파드·워크로드 소속 파드) | 1 | - |
| `controlPlane` | 1 | - |
| `workload` (`workload=<Kind>/<ns>/<name>`) | 1 | - |
| `event` (대상이 파드일 때) | - | `lastSeenAt` |
| `alert` | - | `occurredAt` |

- `follow`와 `at`이 함께 붙지 않는 것을 **전 자리 전수 테스트**로 고정(`log-href.spec.ts`).

**(3) 링크 가능 여부의 "값" — `common/log-link-policy.service.ts`**

- 규칙(함수)은 `log-href.ts`, **값**(`enabled`·`denyNamespaces`)은 전역 `LogLinkPolicy` 하나. 전에는 `ClusterQueryService`·`LogLinkService`가 env를 **각자** 읽었다 → mock `logs=disabled`로 바꿔도 **로그 API만 403이고 매트릭스·알림 링크는 남았다**(디자인 15절 "링크가 사라진 것까지 확인" 위반). 이제 `LogsService.setScenario('disabled')`가 정책 값을 바꾸고, `ClusterStateService`가 받아 **`cluster.snapshot`을 다시 보낸다**. `LogsService.enabled`도 같은 값을 본다.

**(4) `at` 정의와 `anchorAt` (계약 2.2.1)**

- 계약·명세·디자인 어디에도 정의가 없었다(Q11 확인). 화면이 시각을 비교하면 잘린·회전된 로그에서 엉뚱한 줄을 "그 시각"으로 보이므로 **판단을 서버에 둔다**:
  - 요청 `anchorAt`(정지 조회 전용, 스트림은 400). `range`를 생략하면 서버가 고른다 — direct: 그 시각 2분 앞부터(`sinceSec`), stack: 앞뒤 5분.
  - 응답 `anchor: { at, state, lineId }` — `found` / `before_result` / `after_result` / `none`.
  - 못 찾으면 `LOG_ANCHOR_BEFORE_RESULT`(`details.reason`: `cut`·`earlier_generation`·`outside_range`·`file_start`, `details.suggest`: `more_lines`·`previous`·`range`) 또는 `LOG_ANCHOR_AFTER_RESULT`. **문구는 서버가 만든다.**
  - direct는 현재 세대 컨테이너 시작 시각(informer 캐시의 `running.since`)보다 앞이면 **`earlier_generation` → `이전 세대` 권유**. 이 판단은 쿠버네티스 호출 없이 캐시로 한다.
- 순수 함수 `logs/anchor.ts`로 분리해 14건 단위 테스트.
- 알림 링크에 **`at`이 실제로는 빠져 있었다**(계약 예시에만 있었다) → `occurredAt`으로 채움. `follow`는 그때도 지금도 없다.

**(5) L2 진입점 — 계약 11.4 + 구현**

- 새 엔드포인트 없이 **기존 응답에 추가 전용 nullable `logHref`**: `PodItem`(진입점 1·2·7 + 워크로드 상세 소속 파드 행), `WorkloadItem`(5), `EventItem`(4, 대상이 파드일 때만), `ControlPlaneComponent`(3, 기존). DB 상세·워크로드 상세·노드 상세는 `PodItem`을 쓰므로 저절로 따라왔다.
- `/logs` 선택기(AC-LOG29)와 워크로드 → 파드는 **기존 API로 충분**함을 확인해 계약에 조합법을 적었다(`facets.namespaces` → `workloads?namespace=` → `pods?workload=` → `logs/targets`).
- **결함 발견·수정**: stack에서 `selector.workload`만 보내면 어댑터가 파드 조건 없이 **네임스페이스 전체**를 조회했다. 이제 서버가 소속 파드(지금 것 + 최근 삭제 캐시 1시간, 최대 20)를 풀어 조회하고 `selector.resolvedPods`로 알려 준다. 스트림은 준비 단계에서 풀고 0개면 404 `LOG_WORKLOAD_NO_PODS`. `pods`는 최대 20(DTO `@ArrayMaxSize(20)`).
- AC-LOG31 보강: 스택이 있으면 자기참조 안내에 한 문장을 잇고(디자인 11.2), etcd 도움말을 `details.hint`로 준다. 미러 파드 판별을 이름만 → **2중 조건**(`kube-system` + 마스터 노드 + 접두어)으로.
- 대상 화면 `links.workload`: 원시 소유자(`ReplicaSet/prod/api-7f9c8d6b5`)로 만들던 것을 **해석한 워크로드 키**로. 사라진 파드도 최근 삭제 캐시의 마지막 소유자로 채운다(디자인 10절 `소속 워크로드에서 새 파드 보기`).

**(6) mock 시나리오 4개 (계약 9절)**

- `stream-notice`·`idle-pause`·`max-duration`: **기준값만 줄인다**(10초 폭주 / 유휴 20초 / 최대 30초). 경로는 실제와 같다 — 폭주는 `push()`로 넣어 실제 `flush()`가 생략 줄과 `LOG_DROPPED_LINES`를 만들고, 유휴·최대는 실제 `checkLimits()`가 판단한다(검사 주기만 5초 → 1초). 문구는 실제로 적용된 값(`20초`·`30초`)으로 나온다.
- `flood`: 초당 상한의 80%(1,600줄/초)를 250ms마다. 40줄마다 가림 대상 1줄(줄마다 값이 다르다). 상한 아래라 생략 없음.

**(7) 서버 문구 3개**

- 503 `LOG_STREAM_LIMIT_REACHED`: `로그 보기를 동시에 3개까지 열 수 있습니다. 다른 탭의 로그 화면이나 펼쳐 둔 파드 상세 로그를 닫아 주세요.` — **서버가 문구를 준다**(503 응답 `message`)이므로 바꿨다.
- `log.paused`: `이 화면이 5분 동안 보이지 않아 따라가기를 멈췄습니다.` (전: `300초 동안 조작이 없어…`)
- `log.closing`(`max_duration`): `연결을 30분마다 끊습니다(서버 보호).` (전: `한 스트림은 30분까지 유지됩니다. 다시 시작하세요.`)

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/logs/log-href.ts` | 수정 | 자리별 규칙 표(`LOG_HREF_ENTRY_RULES`), `buildLogHref(policy, target)`, `buildPodKeyLogHref`, `logLinkBlocked` |
| `apps/api/src/logs/log-href.spec.ts` | 추가 | 9건 — follow·at 동시 부착 0건(전수), D3·Q12 표, 차단 이유 |
| `apps/api/src/common/log-link-policy.service.ts` | 추가 | 링크 가능 여부의 실효 값(env + mock `disabled`), `changes$` |
| `apps/api/src/common/common.module.ts` | 수정 | `LogLinkPolicy` 제공·export |
| `apps/api/src/cluster/types.ts` | 수정 | `WorkloadItem`·`PodItem`·`EventItem.logHref` 추가, `ControlPlaneComponent.logHref` 주석 |
| `apps/api/src/cluster/state/evaluate.ts` | 수정 | `EvalInput.logLinks`, 평가 단계에서 파드·이벤트·워크로드 링크 |
| `apps/api/src/cluster/state/control-plane.ts` | 수정 | 칸 링크를 평가 단계에서(`not_reporting`도 파드를 알면 준다) |
| `apps/api/src/cluster/state/cluster-state.service.ts` | 수정 | 정책 값 주입, 값이 바뀌면 `requestResync()` |
| `apps/api/src/cluster/state/cluster-store.ts` | 수정 | `PodHistory.deletedPodsOf(workloadKey)` |
| `apps/api/src/cluster/cluster-query.service.ts` | 수정 | REST 전용 꾸미기·env 읽기 제거 |
| `apps/api/src/cluster/cluster-loghref.http.spec.ts` | 추가 | 7건 — **SSE = REST**(스냅샷·`controlplane.updated`·파드·이벤트·워크로드), `disabled` 재전송, `LOGS_ENABLED=false`, 차단 네임스페이스 |
| `apps/api/src/logs/anchor.ts` | 추가 | `locateAnchor`·`anchorNotice` (순수 함수) |
| `apps/api/src/logs/anchor.spec.ts` | 추가 | 14건 |
| `apps/api/src/logs/logs.service.ts` | 수정 | `anchorAt`·서버 기간 선택·`anchor`, 워크로드 → 파드 해석, `resolvedPods`, 대상 화면 보강(2중 조건·스택 문장·hint·워크로드 링크), `enabled` = 정책 값 |
| `apps/api/src/logs/log-stream.service.ts` | 수정 | 상한 문구, 유휴·30분 문구, mock 시간표·폭주·`flood`, stack 워크로드 준비 단계 해석 |
| `apps/api/src/logs/log-link.service.ts` | 수정 | 정책 값 사용, `alert` 자리 + `at`, `stackSearch` 계산 |
| `apps/api/src/logs/dto.ts` | 수정 | `anchorAt`, `pods` 최대 20 |
| `apps/api/src/logs/logs.controller.ts` | 수정 | `anchorAt` 전달, 스트림에 `anchorAt`이면 400 |
| `apps/api/src/logs/mock/mock-logs.ts` | 수정 | 시나리오 4개, `mockStreamTiming`·`mockBurstLines`·`mockFloodLines` |
| `apps/api/src/logs/logs.http.spec.ts` | 추가 | 14건 — anchor found/before/null, 스트림+anchor 400, stack 워크로드 해석, pods 21개 400, 대상 화면, 상한 문구, 알림 링크, **가짜 시계로 4개 시나리오** |
| `apps/api/src/alerts/alert-presenter.ts` | 수정 | 링크 규칙에 `occurredAt` 전달 |
| `apps/api/src/alerts/alerts.service.ts` | 수정 | 같음 |
| `apps/api/src/alerts/alert-presenter.spec.ts` | 추가 | 2건 |
| `apps/api/src/alerts/mock/mock-alerts.ts` | 수정 | `webhook-failed` 발송 칩 2종 이력, 최신 `area:pods` 알림 대상을 클러스터 mock에 실제로 있는 파드로 |
| `apps/api/src/alerts/mock/mock-alerts.spec.ts` | 추가 | 3건 |
| `docs/api/logs.md` | 수정 | 머리말, 0.2, 1.4, 2.2 표, **2.2.1 신설**, 2.3.1, 6·7·9절, 11.3, **11.4 신설**, 12·13·14절 |
| `docs/api/alerts.md` | 수정 | 2.2.1 링크 모양(`at`, follow 없음), 5절 `webhook-failed`, 11절 모르는 칩, 13절 |
| `docs/api/cluster-status.md` | 수정 | 1.2·1.3·1.4 `logHref`, 1.6 주석, 8.2 한 줄, 13절 |
| `docs/api/common.md` | 수정 | 6.1 `logs` 시나리오 4개·`disabled` 예외, `alerts` `webhook-failed`, 8절 |

`deploy/rbac.yaml`·`apps/api/src/database/**`·`prisma/**`·`apps/web/**` **변경 없음.**

### 5. 주요 결정과 이유

- **링크를 평가 단계로 옮겼다**(REST에서 SSE까지 꾸미기를 복사하지 않았다). 복사하면 "값을 채우는 자리가 둘"인 원인이 그대로 남아 다음 필드에서 또 갈라진다. 평가 결과를 두 경로가 공유하면 구조적으로 같다. 비용: 설정(정책) 값이 평가 입력이 되어, 값이 바뀌면 재평가·재전송이 필요하다 → `changes$` → `requestResync()`.
- **자리(`entry`)를 받는 API**: "따라가기 여부를 받게"를 글자 그대로 하면 `follow: true`를 호출부 5곳이 정한다. PM이 원한 것은 "규칙은 이 파일 한 곳"이므로 자리를 받고 표가 정한다. 새 진입점은 표에 한 줄(Q12 결정의 취지와 같다).
- **`at` 판단을 서버에**: 계약이 "화면은 추론하지 않는다"인 이유와 같다. 화면이 줄 시각을 비교하면 `limit`에 잘렸을 때 **가져온 첫 줄을 "그 시각"으로 오인**한다. 서버는 "잘렸다/조용했다/이전 세대/기간 밖"을 가를 재료(완결 여부·기간 시작·컨테이너 시작 시각)를 가지고 있다.
- **direct 기간을 "그 시각 2분 앞부터 지금까지"로**: `pods/log`는 `sinceSeconds`만 있고 끝 시각이 없으며 `tailLines`는 끝에서 센다. "그 시각 앞뒤 N분"을 정확히 가져오려면 `limitBytes`로 앞에서부터 읽어야 하는데 live 경로를 크게 바꾸고 실클러스터 검증이 불가능하다. **기존 경로 그대로 + 못 닿으면 이유를 말하는** 쪽을 택했다.
- **Warning 이벤트의 `at` = `lastSeenAt`**(Q12 "이벤트 시각"을 구체화): 반복 이벤트의 가장 최근 발생이 현재 로그 파일에 남아 있을 가능성이 가장 높다(direct는 회전된 분량을 못 읽는다). `firstSeenAt`은 이미 회전됐을 가능성이 크다.
- **워크로드 링크에 파드를 박지 않았다**: 박으면 "가장 나쁜 파드"가 바뀔 때마다 `WorkloadItem`이 흔들려 upsert가 늘어난다. 첫 파드는 화면이 `pods?workload=`의 **서버 정렬 첫 번째**를 쓴다(화면이 고르는 규칙이 아니라 서버 순서).
- **워크로드 → 파드 해석을 어댑터가 아닌 서비스에서**: Loki에서 이름 패턴(`api-[a-z0-9]+-[a-z0-9]{5}`)으로 풀면 오래전 파드까지 잡지만, 이름 규칙에 기대고(`api-x` DaemonSet과 충돌 가능) 출처마다 따로 구현해야 한다. informer + 최근 삭제 캐시는 출처 중립이고 정확하다. 한계(1시간)는 계약에 적었다.
- **mock 시간 단축은 "기준값만"**: 가짜 이벤트를 `send`로 직접 쏘면 화면은 볼 수 있지만 서버 경로가 검증되지 않는다. 기준값만 바꿔 실제 `push`·`flush`·`checkLimits`를 태웠다.
- **알림 fixture 파드 이름 변경**: 알림 대상 파드(`api-7f9c8d6b5-x2kq9`)가 클러스터 mock에 없어 mock에서 알림 로그 링크가 **항상 S3(사라진 파드)**로 열렸다 → 통합 3차에서 `at` 표식을 알림 경로로 확인할 수 없다. 최신 `area:pods` 알림만 `mixed` 세계의 실제 파드로 바꿨다. 7시간 전 `worker` 해제 알림은 S3 경우로 그대로 둔다.

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과** (0 problems) | `--fix`가 새 spec 1개의 사용 안 한 disable 주석을 지웠고 다시 맞췄다 |
| `npm run build --prefix apps/api` | **통과** | |
| `npm test --prefix apps/api` | **639 passed / 2 skipped** (57 suites) | 590 → +49 (log-href 9, anchor 14, cluster-loghref 7, logs.http 14, alert-presenter 2, mock-alerts 3). **기존 테스트 수정 0건**. 384조합 발송 판정 테스트 그대로 통과 |

**mock 기동 실측** (포트 3141, `node dist/main.js`, PID는 `netstat -ano`로 확인 → 22912·24168·1932 **내가 띄운 것만** `Stop-Process -Id`로 종료. 문구 변경 뒤 빌드가 옛것이라 두 번 재빌드·재기동했다)

| 확인 | 결과 |
|---|---|
| **SSE `cluster.snapshot` = REST** | 컨트롤 플레인 15칸 **15칸 링크, 칸별 일치 true**. 파드 56·이벤트 6·워크로드 12 **전부 일치** |
| **SSE `cluster.controlplane.updated` = REST** | `cluster=cp-component-crash` 전환으로 실제 발생 → 15칸 중 14칸 링크(1칸 `missing`) **일치 true** |
| 링크 모양 | 매트릭스 `…&follow=1` / 파드 `…&follow=1` / 이벤트 `…&at=<lastSeenAt>`(follow 없음) / 워크로드 `…&workload=Deployment%2Fbatch%2Freport-generator&follow=1` / 알림 `…&at=<occurredAt>`(follow 없음) / DB 파드 `postgres-0`·`postgres-1` `follow=1` |
| `logs=disabled` | `cluster.snapshot` **재전송**, 링크 82개 중 **0개**, 알림 `logHref` 0 + `logs_disabled`, `capabilities.enabled: false` → `direct`로 되돌리면 81/82(1개는 `missing` 칸) |
| **`stream-notice`** | **10.1~10.2초**에 `log.notice` `LOG_DROPPED_LINES` "초당 상한(2000줄)으로 151줄이 생략됐습니다." |
| **`idle-pause`** | **20.1~20.2초**에 `log.paused` "이 화면이 20초 동안 보이지 않아 따라가기를 멈췄습니다." `resumable: true` |
| **`max-duration`** | **30.3초**에 `log.closing` `max_duration` "연결을 30초마다 끊습니다(서버 보호)." `resumable: true` |
| **`flood`** | 따라가기 줄 **2만 줄 13.5초**, 생략 0, 가림 줄 **500**(= 1/40), 원문(`s3cret-pw`·`hunter2`·`Bearer flood…token`) **0건** |
| 슬롯 | 각 시나리오 후 `close` → `streams.open: 0` |
| anchor (direct) | 1분 전 → `found`(그 시각 이후 첫 줄). 3시간 전 → `before_result` + "그 시각의 줄은 가져온 200줄보다 앞에 있습니다…" `suggest: more_lines` |
| **알림 → `at` → anchor** | 알림 링크(18분 전) → 대상 `exists: true` → 500줄 `before_result`(`more_lines`) → **2000줄 `found`**. 이벤트 링크 → `found` |
| 스트림 + `anchorAt` | **400** `VALIDATION_FAILED`, `fields: ["anchorAt"]` |
| stack 워크로드 | `Deployment/prod/api` → `resolvedPods` 3개 = 줄 `prefix.pod` 3개 = `GET /api/cluster/pods?workload=` 3개 **일치**. stack anchor `found`(기간 앞뒤 5분) |
| 대상 화면 | 파드 `links.workload` = `/cluster/workloads?focus=Deployment/prod/api`(전에는 `ReplicaSet/…`). 미러 파드 안내 2개 + `details.hint`(etcd). stack이면 자기참조 안내 끝에 "외부 로그 스택이 있으면 그쪽에는 남아 있을 수 있습니다." |
| 상한 문구 | 4번째 준비 **503** + PM 확정 문구 그대로 |
| **AC-LOG32** (`cp-node-down`) | `not_reporting` 5칸 **5칸 모두 링크**, `missing` 칸 링크 0. 대상 화면 notice 순서 `LOG_NODE_NOT_REPORTING` → 자기참조 → 민감도, 조회 **200**(막지 않음) |

**하지 못한 검증 (숨기지 않는다)**
- **live `pods/log`에서 `anchorAt`**: 실클러스터가 없다. `sinceSeconds` 계산·컨테이너 시작 시각(`running.since`) 판단은 mock 캐시와 단위 테스트로만 확인했다.
- **실제 Loki에서 anchor 기간(앞뒤 5분)·워크로드 해석 결과로 조회**: 실 Loki 없음. 어댑터는 바뀌지 않았고 파드 목록만 넘긴다.
- 브라우저 화면 확인은 frontend 몫이다(통합 3차). 서버 응답·이벤트만 실측했다.

### 7. 남은 이슈·한계

| # | 내용 |
|---|---|
| B1 | **direct는 "그 사이 출력이 없었다"와 "회전으로 사라졌다"를 구분하지 못한다.** 기간 시작부터 빠짐없이 가져왔는데 첫 줄이 그 시각 뒤면 `found`(첫 줄)로 본다. 한계 블록 2번 줄이 이미 말하는 한계와 같다(계약 2.2.1 표) |
| B2 | direct anchor는 **끝에서 N줄**이라 그 시각 뒤로 줄이 많으면 닿지 않는다(`before_result` + `more_lines`, 상한 5,000줄이면 "더 앞을 가져올 수 없다"). 앞에서부터 읽는 방식(`limitBytes`)은 live 검증이 가능해진 뒤 검토 |
| B3 | stack 워크로드 합쳐보기는 **최근 1시간 안에 사라진 파드까지만** 자동 포함(최근 삭제 캐시). 더 오래된 파드는 이름으로 조회. Loki 이름 패턴 해석은 하지 않았다(5절) |
| B4 | mock 시간 단축 시나리오에서 `log.hello.limits`·`capabilities.limits`는 **설정값(300초·30분)** 그대로다. 문구만 실제 적용값(20초·30초). 계약 9절에 적었다 |
| B5 | 알림 mock의 최신 `area:pods` 대상 이름은 클러스터 mock `mixed` 세계의 이름이다. cluster 시나리오를 바꾸면 이름이 달라져 S3로 열린다(정상 동작) |
| B6 | Loki 어댑터는 여전히 `selector.workload`를 쓰지 않는다. 서비스가 파드로 풀어 넘기므로 지금은 문제없지만, 어댑터를 직접 부르는 새 코드가 생기면 **파드 없이 넘기지 말 것**(네임스페이스 전체가 된다) |

**AC-LOG25~34 서버 몫 상태**

| AC | 서버 | 비고 |
|---|---|---|
| 25 진입점 링크 | **완료** — `PodItem`·`WorkloadItem`·`EventItem`·`ControlPlaneComponent`·DB·워크로드 상세 | 화면 연결은 frontend 3차 |
| 26 S3 | 기존 완료 + 이벤트·알림 링크가 사라진 파드에도 온다 | |
| 27 S3 스택 유무 | 기존 완료. **알림 `logTarget.stackSearch` 결함 수정**(항상 false였다) | |
| 28 사이드바 | 서버 몫 없음 | |
| 29 `/logs` 좁히기 | **새 엔드포인트 불필요** — 계약 11.4에 조합법 | |
| 30 매트릭스 링크 | **완료** — SSE 결함 수정 + `follow=1` | frontend `podKey` 폴백 제거 가능 |
| 31 안내 2줄 | **완료** — 스택 문장·etcd hint·2중 조건 | |
| 32 `cp-node-down` | **실측 확인** | |
| 33 `control-plane` mock | 기존 완료 | |
| 34 RBAC | **변경 없음** (`deploy/rbac.yaml` 손대지 않음) | |

### 8. 다른 담당 요청

- **frontend 요청 (통합 3차)** — 쓸 필드는 대화 보고의 목록과 같다.
  1. `ControlPlaneSection.tsx`의 **`podKey` 폴백을 지운다.** SSE에도 서버 값이 온다(실측 15/15 일치).
  2. 파드 상세 `로그` 섹션 표시 여부와 `로그 화면에서 열기`는 **`pod.logHref`**로. `null`이면 섹션을 그리지 않는다. `features/logs/href.ts`의 링크 생성은 더 이상 필요 없다(서버 링크가 없는 자리가 없다).
  3. 파드 목록 행·Warning 이벤트 행·워크로드 상세·DB 상세는 각 항목의 `logHref`를 **그대로** 링크로. `null`이면 그리지 않는다. `useLogsEnabled`·`denyNamespaces`로 링크를 다시 판단하지 않는다.
  4. `readLogsQuery`에 **`at`·`workload`**를 더한다. `at`이 있으면 따라가기 끔 + `POST /api/logs/query`에 `anchorAt`, `range` 생략 → `anchor.lineId`로 스크롤·표식, `LOG_ANCHOR_*` 안내는 `text` 그대로. 따라가기를 켜면 URL에서 `at`을 뗀다(계약 2.2.1).
  5. `workload=`로 열리면 direct는 `GET /api/cluster/pods?workload=`의 첫 파드, stack은 `selector.workload`를 보내고 `selector.resolvedPods`로 선택기를 채운다(계약 11.4).
  6. mock 확인: `logs=stream-notice`(10초)·`idle-pause`(20초)·`max-duration`(30초)·`flood`(2만 줄 약 13초). RL1·AC-LOG51 확인용.
- **designer 요청**: 계약 **2.2.1이 나왔다**(designer 요청 4 — "나오면 알려 달라"). 6.2에 ① "그 시각" 표식 모양(`anchor.lineId` 줄), ② `before_result`/`after_result` 안내 자리, ③ `details.suggest` 바로가기 버튼(`이전 세대 보기`·`줄 수 늘리기`·`기간 넓히기`)을 둘지를 정해 주면 된다. 서버 문구는 계약 2.2.1 표.
- **planner 요청**: ① Q11 `at` 정의를 명세로 옮긴다(계약 2.2.1). ② Warning 이벤트의 `at`은 **`lastSeenAt`**으로 구체화했다(Q12 "이벤트 시각") — 명세 3.8.1 진입점 4 비고에 반영. ③ stack 워크로드 합쳐보기의 "최근 1시간 안에 사라진 파드까지" 한계를 명세 L3에 한 줄.
- **PM 확인 요청**: 위 ②(`lastSeenAt`)와 알림 mock fixture 파드 이름 변경(5절 마지막 항목).
- **DBA 요청 없음.** 로그·링크는 DB에 아무것도 쓰지 않는다.

### 9. 다음 담당이 알아야 할 점

- **로그 링크는 `logs/log-href.ts`의 표 한 곳이다.** 새 진입점은 `LogHrefEntry`와 `LOG_HREF_ENTRY_RULES`에 한 줄을 더하고 `buildLogHref(policy, target)`를 부른다. `follow`·`at`을 호출부에서 붙이지 말 것.
- **링크 가능 여부 값은 `LogLinkPolicy` 하나다.** env를 다시 읽지 말 것 — mock `disabled`를 한쪽만 알게 된다.
- **클러스터 항목의 `logHref`는 평가 단계(`evaluate.ts`·`control-plane.ts`)에서만 채운다.** REST 핸들러나 토픽 소스에서 항목을 꾸미면 REST와 SSE가 다시 갈라진다(이번 결함의 원인). `cluster-loghref.http.spec.ts`가 잡는다.
- **로그 스택 어댑터에 파드 없이 넘기지 말 것.** `workload`만 오면 서비스(`resolveWorkloadPods`)가 먼저 푼다.
- `anchor.ts`는 줄의 `at`·`id`만 본다. 로그 본문을 읽지 않는다.
- mock 시간표는 `mock-logs.ts`의 `mockStreamTiming`에 있다. 새 시나리오도 "기준값만 바꾸고 실제 경로를 태운다"를 지킬 것.

### 추가 (07:25) · 스트림 `hello.selector.resolvedPods` (README 결정 8)

- **요청**: 스트림 `log.hello.selector.pods`와 조회 응답 `selector.resolvedPods`가 같은 것을 다른 이름으로 부른다 → 스트림에도 `resolvedPods`를 **추가 전용**으로. 기존 `pods`는 유지. 계약 2.3·7절에 관계를 적고, 두 값이 같다는 테스트 1건.
- **작업**: `LogStreamService.prepare()`가 stack 워크로드를 풀 때 그 목록을 `entry.resolvedPods`에 함께 담고, `log.hello.selector`에 `resolvedPods`로 싣는다. 워크로드를 풀지 않았으면 `null`(조회 응답과 같은 규칙). 기존 `selector.pods`는 그대로(워크로드를 풀었을 때 두 값이 같다).
- **변경 파일**: `apps/api/src/logs/log-stream.service.ts`(수정), `apps/api/src/logs/logs.http.spec.ts`(+1건), `docs/api/logs.md`(2.3.1 표·7절 표와 관계 문단·14절).
- **검증**: lint·build 통과, jest **648 passed / 2 skipped**(+1). 새 테스트: 같은 워크로드로 조회한 `selector.resolvedPods` = 스트림 `log.hello.selector.resolvedPods` = `log.hello.selector.pods`, direct 스트림은 `resolvedPods: null`. mock 실측(3141, 내가 띄운 PID 25044만 종료): `Deployment/prod/api` → 조회·hello 모두 `["api-qfvhtjhs2-wbf44","api-qfvhtjhs2-xbf44","api-qfvhtjhs2-zbf44"]`, `same: true`.
- **frontend 참고**: 합쳐보기 파드 목록은 조회·스트림 모두 **`resolvedPods` 하나로** 읽는다. `hello.selector.pods`를 읽는 갈래는 지워도 된다.

## 2026-09-25 08:33 · PM 검증 후속 — AC-LOG15 실클러스터 경로 테스트 (+ 결함 1건 수정)

### 1. 요청 내용
PM 검증: `direct-source.ts`가 쿠버네티스 응답을 `LOG_PREVIOUS_NOT_AVAILABLE`로 바꾸는 경로에 테스트가 없다. 동작을 바꾸지 말고 테스트만, 결함이 드러나면 고치고 적는다.
- previous 요청에 400 → 이 코드 / `previous terminated container … not found` 메시지 → 이 코드 / previous가 아닌 400 → 이 코드가 아님

### 2. 참고한 문서
- `apps/api/src/logs/direct-source.ts` `mapError`, `node_modules/@kubernetes/client-node/dist/log.js`(2.0.0), `docs/api/logs.md` 6절, 명세 AC-LOG15

### 3. 작업 내용
**(1) `direct-source.spec.ts` 4건** — 실제 `@kubernetes/client-node` `Log`를 쓰고 API 서버만 로컬 HTTP 서버(임시 포트, 테스트 안에서 열고 닫음)로 대신했다(`extract-raw.spec.ts`와 같은 방식). 요청 3가지 전부 통과:
- previous + 400 → `LOG_PREVIOUS_NOT_AVAILABLE` (요청에 `previous=true`가 실제로 실린 것도 확인)
- 메시지 `previous terminated container "api" in pod … not found` → `LOG_PREVIOUS_NOT_AVAILABLE` (본문이 읽히는 500 경로 + `mapError` 직접)
- previous가 아닌 400 → `LOG_PREVIOUS_NOT_AVAILABLE`이 아니다(`LOG_UPSTREAM_ERROR`)
- 403·404는 previous여도 권한·파드 없음이 먼저

**테스트를 쓰며 알게 된 사실**: client-node 2.0 `Log.log`는 **500일 때만** 응답 본문(`Status.message`)을 읽고, 400 등은 본문 없이 상태 코드만 준다. 그래서 400에서는 메시지 규칙(`previous terminated…`, `is waiting to start: ContainerCreating`)이 **절대 맞지 않는다.** previous 400은 상태 코드 규칙이 받아 주지만, **"컨테이너 시작 전"(쿠버네티스는 400)은 live에서 `LOG_CONTAINER_NOT_STARTED`가 될 수 없었다.**

**(2) 결함 — `logs.service.live.spec.ts` 3건으로 드러났다**
- `POST /api/logs/query`(live direct)에서 `LOG_PREVIOUS_NOT_AVAILABLE`·`LOG_CONTAINER_NOT_STARTED`가 `toApiError`를 지나 **503 오류**로 나갔다. 계약 6절은 둘 다 **notice**이고, mock(`logs=empty` + previous)은 200 + notice다 → live에서만 화면이 오류 화면을 그리고 AC-LOG15("안내가 뜨고 스위치는 그대로")를 못 지킨다.
- **수정**(`logs.service.ts` `readLines`의 live `catch`): 두 코드는 **200 + 빈 줄 + notice**(`level: info`, 문구는 mock과 같다). previous가 아닌 **400**은 informer 캐시상 그 컨테이너가 **한 번도 돌지 않은 대기**(상태 없음, 또는 `waiting` + 재시작 0)일 때 `LOG_CONTAINER_NOT_STARTED` notice로, 그 밖은 기존대로 오류.
- 이를 위해 `mapError`가 `LOG_UPSTREAM_ERROR`에 `details: { status }`를 남긴다(503 응답 `details`에 상태 코드가 보인다 — 비밀값 아님). `mapError`는 테스트용으로 export만 했다.
- 수정 전 실행: 3건 중 **2건 실패**(503) → 수정 후 3건 통과. 이미 돌았던 컨테이너의 400은 여전히 오류(503)로 두는 것도 테스트로 고정했다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/logs/direct-source.spec.ts` | 추가 | 4건 |
| `apps/api/src/logs/logs.service.live.spec.ts` | 추가 | 3건 |
| `apps/api/src/logs/direct-source.ts` | 수정 | `mapError` export, `LOG_UPSTREAM_ERROR.details.status`, client-node 2.0 동작 주석 |
| `apps/api/src/logs/logs.service.ts` | 수정 | live 오류 중 안내로 내릴 것(`directErrorAsNotice`), 캐시로 "시작 전" 판단(`containerNeverStarted`) |
| `docs/api/logs.md` | 수정 | 14절 변경 이력 한 줄 |

### 5. 주요 결정과 이유
- **"시작 전" 판단을 informer 캐시로**: 쿠버네티스가 주는 사유를 라이브러리가 버리므로 남은 근거는 캐시뿐이다. "재시작 0 + 대기"로 좁혀 CrashLoopBackOff(이미 돌았던 컨테이너, 로그가 있다)를 "시작 전"으로 잘못 부르지 않게 했다.
- **스트림(따라가기)은 고치지 않았다**: previous 스트림은 계약상 400(애초에 열 수 없다)이고, 시작 전 컨테이너를 따라가면 지금처럼 `log.notice` + 종료가 된다. 범위를 요청된 조회 경로로 한정했다.
- **`LOG_KUBELET_UNREACHABLE`은 그대로 503**이다(계약 6절은 notice). 이번 요청 범위 밖이라 손대지 않았다 — 7절.

### 6. 검증 결과
| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/api` / build | 통과 |
| `npm test --prefix apps/api` | **658 passed / 2 skipped** (61 suites, +10 — logs 7, alerts 3) |
- mock API 서버는 띄우지 않았다. `direct-source.spec.ts`의 가짜 API 서버는 테스트 프로세스 안에서 임시 포트로 열고 닫는다.
- **실클러스터 미실측**: 가짜 서버는 쿠버네티스 `Status` 모양을 흉내 낸 것이다. 실제 kOps에서 `--previous` 없음·ContainerCreating 응답 코드(400)는 공식 동작을 따른 가정이다.

### 7. 남은 이슈·한계
- `LOG_KUBELET_UNREACHABLE`(계약 6절 notice)은 live 조회에서 여전히 **503**이다. 500 본문은 읽히므로 코드는 맞게 나오지만 모양이 오류다 — **PM 판단 요청**(notice로 내릴지).
- 따라가기 중 컨테이너가 재시작되면(쿠버네티스가 스트림을 끝낸다) `LOG_STREAM_ENDED`로 닫힌다. 이번 범위 밖.

### 8. 다른 담당 요청
- **frontend 참고**: live에서도 이전 세대 없음이 **200 + `LOG_PREVIOUS_NOT_AVAILABLE` notice**로 온다(mock과 같다). 오류 화면 분기가 필요 없다.
- **PM**: 7절 `LOG_KUBELET_UNREACHABLE`.

### 9. 다음 담당이 알아야 할 점
- `@kubernetes/client-node`를 올릴 때 `Log.log`가 400 본문을 넘기기 시작하면 `mapError`의 메시지 규칙이 400에도 맞게 된다. 그때도 `direct-source.spec.ts`가 세 요구를 지키는지 잡는다.
- live 조회에서 오류를 안내로 바꾸는 자리는 `directErrorAsNotice` 한 곳이다. 코드를 늘릴 때 계약 6절의 "어디로 오나" 열과 맞출 것.

### 추가 (08:50) · `LOG_KUBELET_UNREACHABLE`도 200 + notice (PM 결정) + 계약 대조 목록

**작업**
- `directErrorAsNotice`에 `LOG_KUBELET_UNREACHABLE`을 더했다: live 조회에서 **200 + 빈 줄 + notice**(`level: warn`, 문구 `노드에 연결할 수 없어 로그를 읽지 못했습니다.` — 명세 3.4·디자인 8.7, `details.nodeName` = informer 캐시의 그 파드 노드). 노드 링크는 화면이 `details.nodeName`(또는 대상 화면 `links.node`)으로 붙인다.
- 테스트 +1(`logs.service.live.spec.ts`): 쿠버네티스 500 Status 본문(`dial tcp 10.0.1.5:10250: connect: connection refused`) → `mapError` → 조회 응답까지 한 줄로 이어서 확인. `details.nodeName: 'node-a'`.
- 계약 `logs.md` 14절 한 줄 갱신.
- 검증: lint·build 통과, jest **659 passed / 2 skipped**(61 suites). 서버를 띄우지 않았다.

**명세 7절 백엔드(724행) 번역 목록 ↔ 구현 대조**

| 명세 번역 | 구현 | 일치 |
|---|---|---|
| 403 → `LOG_FORBIDDEN` | `mapError` 403 → HTTP 403 (계약 6절 **403**) | 일치 |
| 404 → `LOG_POD_NOT_FOUND` | `mapError` 404 → query·streams **404** (targets는 notice) | 일치 |
| 400 "container … is waiting to start" → `LOG_CONTAINER_NOT_STARTED` | **조회**: client-node 2.0이 400 본문을 버려 메시지로는 못 가른다 → informer 캐시(대기 + 재시작 0)로 판단해 notice. **스트림**: 캐시 판단이 없어 `LOG_UPSTREAM_ERROR` notice 후 종료 | **조회만 일치**(아래 목록 3) |
| kubelet 연결 실패 → `LOG_KUBELET_UNREACHABLE` | 500 본문을 읽으므로 메시지 규칙(`dial tcp`·`connection refused`·`i/o timeout`·`no route to host`)으로 판단 → 조회 **notice**(이번 수정) | 일치. 단 메시지 규칙 범위는 목록 5 |

**계약과 다르게 오류로 나가는 것 (고치지 않고 목록만)**

| # | 코드 | 계약 6절 | 지금 구현 | 비고 |
|---|---|---|---|---|
| 1 | `LOG_BACKEND_UNAVAILABLE` | notice (S5 + `직접 조회로 전환`) | stack **조회 503** (`readFromStack`). `capabilities`에는 notice로 온다 | 화면은 capabilities notice로 S5를 그릴 수 있지만, 조회 자체는 오류로 받는다 |
| 2 | `LOG_BACKEND_AUTH_FAILED` | notice | stack **조회 503** | 1과 같은 자리 |
| 3 | `LOG_BACKEND_QUERY_REJECTED` | notice (사유를 가림 처리해 그대로) | stack **조회 502** + `details.reason` | L3 보고서에 "502로 올린다"고 적었던 선택. 계약 표와 다르다 |
| 4 | `LOG_SOURCE_NOT_CONFIGURED` | notice (화면 전체 `알 수 없음`) | `capabilities`에는 notice, **live 조회는 503**(클러스터 연결 없음) | 화면이 capabilities를 먼저 보므로 실제로는 조회까지 가지 않을 가능성이 크다 |
| 5 | `LOG_KUBELET_UNREACHABLE` 판단 범위 | — | 메시지 규칙이 `dial tcp`·`connection refused`·`i/o timeout`·`no route to host`뿐. `TLS handshake timeout`·`context deadline exceeded`·`error dialing backend`(konnectivity) 등은 **`LOG_UPSTREAM_ERROR` 503**이 된다 | 실클러스터 문구 확인 필요(월요일) |
| 6 | `LOG_CONTAINER_NOT_STARTED` (스트림) | notice + "파드 watch로 자동 재시도" | 스트림은 `LOG_UPSTREAM_ERROR` `log.notice` 후 **종료**, **자동 재시도 없음**(조회도 자동 재시도 없음) | 명세 3.4 문구 "시작되면 자동으로 표시됩니다"를 서버가 지키지 않는다 |
| 7 | `LOG_UPSTREAM_ERROR` | **계약 6절 표에 없는 코드** | 분류되지 않은 쿠버네티스 오류 → 503 (`details.status`) | 계약에 행을 더하거나 이름을 정해야 한다 |

## 2026-09-25 09:05 · mock = live, 계약 6절이 정본 (PM 결정 1~7)

### 1. 요청 내용
PM 원칙: **mock과 live가 같은 모양을 준다. 계약이 정본이다.** 앞 섹션 "계약과 다르게 오류로 나가는 것" 7건 처리.
- 1·2·4 `LOG_BACKEND_UNAVAILABLE`·`LOG_BACKEND_AUTH_FAILED`·`LOG_SOURCE_NOT_CONFIGURED` → 조회 200 + notice(줄 0개). `직접 조회로 전환` 안내 유지, 자동 전환 없음(AC-LOG42)
- 3 `LOG_BACKEND_QUERY_REJECTED` → 200 + notice. 사유는 가림 처리 후 `details.reason`, 범위를 줄이지 않는다(AC-LOG43). 502 근거가 계약 본문에 있으면 하나로 합친다
- 5 kubelet 판단 문구에 `TLS handshake timeout`·`error dialing backend` 추가(`context deadline exceeded`는 제외)
- 6 `LOG_CONTAINER_NOT_STARTED`: 스트림은 닫지 않고 informer로 기다렸다가 붙는다(유휴·최대 상한 유지, mock 시나리오 추가). 정지 조회는 약속하지 않는 문구
- 7 `LOG_UPSTREAM_ERROR` 행을 계약 6절에 추가(503 + `details.status`로 남는다)

### 2. 참고한 문서
- `docs/api/logs.md` 2.1.1·6·7·9절, `docs/specs/logs.md` 3.4·7절(724행), `docs/design/logs.md` 8.4·8.7, 이 파일 08:33·08:50 섹션

### 3. 작업 내용
**(1) 로그 스택 실패 → 200 + notice** (`logs.service.ts` `readFromStack`)
- 어댑터가 던진 `LogBackendError`를 `backendErrorNotice()`로 바꿔 `notices[]`에 싣고 줄 0개로 돌려준다.
  - 연결·인증 실패: `details.fallbackSource: 'direct'` — 화면의 `직접 조회로 전환` 버튼 자리
  - 쿼리 거부: `details.reason` — 어댑터가 이미 가림 처리했다
- 응답 `source`는 `stack` 그대로다(자동 전환 없음). 응답 `range`는 요청한 기간 그대로다(AC-LOG43). 출처 상태 보고(`reportFailure`)는 바뀌지 않았다.
- 전에는 503/502 `ApiException`이었다. **502 근거는 계약 본문에 없었다.** 6절 표는 처음부터 notice였고, 502는 L3 보고서에서 내가 고른 것이었다. 합칠 본문이 없으므로 **표 하나가 정본**이다.
- `capabilities`의 스택 안내 코드가 **실제 실패 종류**를 따른다. 인증 실패면 `LOG_BACKEND_AUTH_FAILED`다(전에는 항상 `UNAVAILABLE`). mock은 시나리오에서, live는 ping 결과에서 온다.

**(2) `LOG_SOURCE_NOT_CONFIGURED`**
- live 조회(클러스터 연결 없음)도 200 + notice(`warn`)로 보낸다. mock 로그를 대신 보여주지 않는다(AC-LOG24).

**(3) `LOG_EMPTY`는 조회가 실제로 성공했을 때만 붙인다**
- 줄 0개의 이유를 다른 안내가 이미 말하면 붙이지 않는다(출처 실패·이전 세대 없음·시작 전·워크로드 파드 없음·kubelet). 붙이면 "조회 성공, 줄 0개"가 거짓이 된다.
- **mock `empty` + previous에서 붙던 `LOG_EMPTY`도 빠졌다**(frontend 참고).

**(4) kubelet 판단 문구**
- `mapError`에 `TLS handshake timeout`·`error dialing backend`를 추가했다.
- `context deadline exceeded`는 `LOG_UPSTREAM_ERROR`로 둔다(테스트로 고정).
- 문구는 명세 3.4와 같은 `노드에 연결할 수 없어 로그를 읽지 못했습니다.`다(스트림 안내도 같은 문장).

**(5) 시작 전 컨테이너 — 스트림은 기다렸다가 붙는다** (`log-stream.service.ts` `waitForContainer`)
- 연결 직후 informer 캐시상 "한 번도 돌지 않은 대기"면 `log.notice`(`LOG_CONTAINER_NOT_STARTED`, `…시작되면 자동으로 표시됩니다.`)를 보내고 **닫지 않는다.**
- `ClusterStore.changes$` 신호마다(+ 2초 재확인) 시작됐는지 보고, 시작되면 `pods/log` follow를 연다.
- follow가 "시작 전"으로 실패해도 같은 대기로 간다. `LOG_CONTAINER_NOT_STARTED`이거나, 400이면서 캐시상 시작 전인 경우다(캐시가 한발 늦은 경우).
- 유휴 일시정지·최대 지속 상한은 **그대로**다. 일시정지되면 기다림도 멈춘다. 기다리는 중 파드가 사라지면 `log.closing`(`LOG_POD_NOT_FOUND`).
- 정지 조회 문구는 `…따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.`다(약속하지 않는다).
- `LogStreamService`가 `ClusterStore`를 주입받는다(LogsModule은 이미 ClusterModule을 import한다).

**(6) mock 시나리오 4개** — PM 원칙대로 live가 낼 수 있는 안내마다 mock 짝을 만들었다.
- `container-starting`: 고른 뒤 30초 동안 시작 전이다.
  - 스트림은 **live와 같은 `waitForContainer` 경로**를 탄다(시작 판단만 시계로 한다)
  - 조회는 200 + 안내
- `stack-auth-failed`·`stack-rejected`: `MockStackAdapter`가 **Loki 어댑터와 같은 코드·같은 문구**를 던진다. 쿼리 거부는 연결이 살아 있어 출처 상태가 정상이다.
- `kubelet-unreachable`: 조회는 live와 같은 `directErrorAsNotice` 경로, 스트림은 live처럼 안내 후 종료.

**(7) 계약**
- 6절 머리에 적었다: "mock = live, 이 표가 정본, 표에 없는 코드는 나가지 않는다".
- 행을 갱신했다: 스택 3개, `SOURCE_NOT_CONFIGURED`, `CONTAINER_NOT_STARTED`, `KUBELET_UNREACHABLE`, `LOG_EMPTY`.
- **`LOG_UPSTREAM_ERROR` 행을 추가했다.**
- 대조하다 **이미 나가고 있는데 표에 없던 코드**를 더 찾아 행을 추가했다:
  - `LOG_BACKEND_CONFIGURED` (autoSelect)
  - `LOG_DIRECT_*` 4개 (한계 줄)
  - `LOG_STREAM_ENDED`·`LOG_STREAM_CLOSED`·`LOG_STREAM_SHUTDOWN` (`log.closing`)
- 7절에 스트림 대기, 9절에 mock 4개, 14절에 변경 이력을 적었다. `common.md` 6.1·8절도 갱신했다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/logs/logs.service.ts` | 수정 | 스택 실패 notice(`backendErrorNotice`), `LOG_EMPTY` 조건(`explained`), `SOURCE_NOT_CONFIGURED`, 정지 조회 문구 상수, mock `container-starting`·`kubelet-unreachable`, capabilities 안내 코드 |
| `apps/api/src/logs/log-stream.service.ts` | 수정 | `waitForContainer`·`stopWaiting`, `startMock`/`startDirect` 분리, 일시정지·종료 때 기다림 해제, mock kubelet |
| `apps/api/src/logs/direct-source.ts` | 수정 | kubelet 판단 문구 2개, 문구를 명세와 맞춤 |
| `apps/api/src/logs/backend/mock-stack.adapter.ts` | 수정 | 인증 실패·쿼리 거부 재현(Loki와 같은 문구), `connectionFailure()` |
| `apps/api/src/logs/backend/log-backend.service.ts` | 수정 | mock 시나리오 4종의 `configured`·`currentState`, mock `error`는 시나리오에서 |
| `apps/api/src/logs/mock/mock-logs.ts` | 수정 | 시나리오 4개 |
| `apps/api/src/logs/logs.service.live.spec.ts` | 재작성 | 14건. 코드별 live 대역, **실제 LokiAdapter를 로컬 HTTP 서버(닫힌 포트·401·400)에 붙인 스택 실패**, **mock = live 모양 대조 6건**(UNAVAILABLE·AUTH·REJECTED·PREVIOUS·NOT_STARTED·KUBELET) |
| `apps/api/src/logs/log-stream.wait.spec.ts` | 추가 | 5건. 기다림 후 Running 신호에 붙음, 신호를 놓쳐도 2초 재확인으로 붙음, 파드 사라짐 → `LOG_POD_NOT_FOUND`, 유휴 일시정지가 기다림도 멈춤, 이미 돈 컨테이너는 기존대로 종료 |
| `apps/api/src/logs/logs.http.spec.ts` | 수정 | +2건. mock `container-starting` 스트림(30초 뒤 붙고 닫지 않음), mock `kubelet-unreachable` 스트림 |
| `apps/api/src/logs/logs.contract-codes.spec.ts` | 추가 | 1건. **`src/logs`가 내보내는 `LOG_*` 코드 ⊆ 계약 6절 표**(환경 변수 이름 제외) |
| `docs/api/logs.md`, `docs/api/common.md` | 수정 | 위 (7) |

### 5. 주요 결정과 이유
- **스택 실패 안내에 `details.fallbackSource: 'direct'`를 붙였다.** 화면이 코드로 전환 버튼을 고르지 않아도 된다(추가 필드). 전환 자체는 여전히 사용자 클릭이다.
- **`LOG_EMPTY`를 억제했다.** PM 결정은 "줄 0개 + notice"였고 `LOG_EMPTY`는 언급하지 않았다. 계약 6절은 `LOG_EMPTY`를 "조회 성공"으로 정의하므로 실패한 조회에 붙이면 계약과 어긋난다. mock에도 같은 규칙을 적용해 모양을 맞췄다.
- **시작 판단 규칙은 하나다.** 스트림 대기와 조회 안내가 같은 `containerNeverStarted()`(상태 없음 또는 대기 + 재시작 0)를 쓴다. CrashLoopBackOff(이미 돈 컨테이너)는 로그가 있으므로 기다리지 않는다.
- **mock `container-starting`의 시계는 "시나리오를 고른 때"다.** 조회와 스트림이 같은 시각에 "시작"으로 바뀌어 모순이 없다. 대신 다시 보려면 시나리오를 다시 골라야 한다(계약 9절에 적었다).
- **계약에 없던 기존 코드 5종은 표에 더했다.** 새로 만든 코드가 아니라 전부터 나가던 것이다. 지우면 화면이 깨진다. 앞으로는 `logs.contract-codes.spec.ts`가 잡는다.

### 6. 검증 결과
| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/api` | 통과 |
| `npm run build --prefix apps/api` | 통과 |
| `npm test --prefix apps/api` | **677 passed / 2 skipped** (63 suites, 659 → +18) |

mock 실측(3141, 내가 띄운 PID 9132만 `Stop-Process -Id`로 종료)
| 확인 | 결과 |
|---|---|
| `stack-down` | capabilities `LOG_BACKEND_UNAVAILABLE`, `activeSource: stack` / 조회 **200**, 줄 0, `source: stack`, `details.fallbackSource: direct` |
| `stack-auth-failed` | capabilities **`LOG_BACKEND_AUTH_FAILED`** / 조회 200 + 같은 코드, Loki와 같은 문구 |
| `stack-rejected` | capabilities 안내 없음(연결 정상) / 조회 200 + `details.reason` |
| `kubelet-unreachable` | 조회 200 + `LOG_KUBELET_UNREACHABLE(warn)` + `details.nodeName` |
| `container-starting` 조회 | 200 + `LOG_CONTAINER_NOT_STARTED` + 정지 조회 문구 |
| `container-starting` 스트림 | `log.hello@0.0 → log.notice(NOT_STARTED)@0.0 → heartbeat@15 → heartbeat@30 → log.lines@30.1 → 흐름@31.1`. **닫지 않고 기다렸다가 붙었다** |
| 시작 뒤 조회 | 500줄 정상 |
- 실클러스터 미실측: 쿠버네티스 "시작 전" 400·kubelet 문구·Loki 401/400 본문은 대역과 로컬 서버로만 확인했다.

### 7. 남은 이슈·한계
- 스트림 대기는 informer 캐시에 기댄다. 캐시가 끊겨 있으면(kube stale) 시작을 늦게 알 수 있다(2초 재확인도 캐시를 본다).
- 여러 파드를 따라가는 stack 스트림에는 "시작 전" 대기가 없다. 스택은 파드가 로그를 내기 시작하면 폴링에 자연히 잡힌다.
- 실클러스터 kubelet 문구 확인은 PM 월요일 목록이다.

### 8. 다른 담당 요청
- **frontend**
  1. stack 조회 실패가 이제 **200 + `notices[]`**로 온다(전에는 503/502 오류 응답). S5 화면을 오류 분기가 아니라 안내 코드로 그린다. `details.fallbackSource`가 `direct`면 전환 버튼을 그린다.
  2. `LOG_EMPTY`가 다른 안내와 같이 오지 않는다. 이전 세대 없음 화면에 "로그 없음"이 겹치지 않는다.
  3. 스트림에서 `LOG_CONTAINER_NOT_STARTED` 뒤 연결이 **유지**된다. 스위치를 끄지 말고 기다리고, 줄이 오면 안내를 내린다.
  4. mock `container-starting`·`stack-auth-failed`·`stack-rejected`·`kubelet-unreachable`로 확인한다.
- **designer**: 스트림 대기 중 모습(안내가 떠 있고 스위치는 켜진 채, 줄 없음)이 7.4 표에 없다. "시작 전 대기" 행이 필요하다.
- **planner**: 명세 3.4 `LOG_CONTAINER_NOT_STARTED` 문구를 정지 조회/스트림 두 문구로 나눈다(PM 결정).

### 9. 다음 담당이 알아야 할 점
- **새 안내 코드를 만들면 계약 6절에 먼저 행을 더한다.** `logs.contract-codes.spec.ts`가 표에 없는 코드를 잡는다.
- **mock과 live는 같은 함수를 지나게 만든다.**
  - 쿠버네티스 오류 → 안내: `directErrorAsNotice`
  - 스택 실패 → 안내: `backendErrorNotice`
  - 시작 전 대기: `waitForContainer`
  - mock 시나리오도 이 함수들을 거치게 했다. 새 시나리오도 문구를 따로 만들지 말 것.
- `LOG_EMPTY`는 `FetchedLines.explained`가 거짓일 때만 붙는다. 줄 0개의 이유를 안내로 말하는 경로는 `explained: true`를 돌려줘야 한다.
