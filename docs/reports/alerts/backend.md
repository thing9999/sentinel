# alerts · backend 작업 보고

> 파일 위치: `docs/reports/alerts/backend.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 22:10 · alerts API 계약 작성 (3단계, 구현 전)

> **이번 작업은 `alerts`와 `logs` 두 기능의 계약을 한 번에 썼다.** 공통 규약(`docs/api/common.md`) 갱신과 두 기능이 만나는 지점(알림 → 로그 **링크만**)이 한 벌이어야 하기 때문이다.
> **공통 사항(common.md 갱신 내역, 검증, 대화 흐름)은 이 문서에 쓰고 `docs/reports/logs/backend.md`가 가리킨다.**

### 1. 요청 내용

PM 지시: 새 기능 두 개(`alerts`, `logs`)의 **API 계약**을 작성하라 (CLAUDE.md 기본 흐름 3단계). **구현 코드는 건드리지 않는다.**

- 작성: `docs/api/alerts.md`(신규), `docs/api/logs.md`(신규), `docs/api/common.md` 갱신, `docs/api/cluster-status.md` 문구 보강
- 하지 않을 것: `apps/api/src/**` 구현, `deploy/rbac.yaml`, `.env.example`, `docker-compose.yml` (다음 지시), `docs/specs/**`(planner), `docs/design/**`(designer), `apps/api/prisma/**`·`docs/db/**`(DBA)
- alerts에서 특히 중요한 것 7가지: ① 배지는 "미확인 수 + 최악 심각도"뿐, 패널용 응답 금지 ② 알림 어디에도 로그 줄 금지(요약·통계도) ③ 로그로는 링크만, 파드가 사라진 경우를 응답이 알릴 것 ④ 웹훅 URL 원문 미노출 + `.env` 잠금 이유 설명 ⑤ 테스트 발송 `confirm:true`(422)·60초 쿨다운(429) ⑥ 억제·플래핑·워밍업·정지 구간이 응답에 드러날 것(화면이 재판정하지 않는다) ⑦ `ALERTS_DISPATCH=mock`에서 아웃바운드 0건

**작업 중 받은 추가 지시 2건** (둘 다 반영했다)

1. **디자인 완료** — `docs/reports/{alerts,logs}/designer.md` 8절의 필드 요청을 계약에 반영하라: `durationMs`, `logHref`, facets, heartbeat, `segments[]`, 한국어 규칙 이름, `capabilities[]`. 원칙 확인: "파드가 사라졌는지를 화면이 추측하지 않고 서버가 말한다". PM 결정: 로그 가림 표식은 **왼쪽 sticky gutter** 기준으로 계약을 쓴다.
2. **DBA가 실재 충돌 발견** — 모니터링 대상 Postgres의 `log_min_error_statement=error` 기본값 때문에 **실패한 SQL 문 원문이 파드 로그에 남는다**(`DETAIL: Key (email)=(a@b.com) already exists.`). 가림 규칙에 `sql_statement`를 더할 것. 함께: **어드바이저 스냅샷에 알림 이력을 넣지 말 것**(가명 규칙 우회), DBA 설계 3가지(본문 미저장·원문 반환 함수 1개·env 우선 409)에 계약을 맞출 것.
3. **2의 SQL 가림 방법 폐기·갱신** — `maskSqlLiterals()` 재사용은 틀린 권고였다(DBA 실측 12종). `createPgLogValueMasker()`/`maskPgLogValues()`를 쓰고 **규칙 개수를 계약에 숫자로 박지 말 것**. 상세는 `docs/reports/logs/backend.md` 5절 6번.

### 2. 참고한 문서

- `docs/specs/alerts.md` 전체(특히 0.2 층 구분, 3.1 알림 키 8개, 3.2 억제·플래핑·워밍업, 3.3.2 디스코드, 3.4.3 웹훅 비밀값, 3.5 테스트 발송, 3.6 mock, 3.7 저장, 4절 갱신 주기, 5절 AC, 7절 백엔드·DBA)
- `docs/specs/logs.md` 전체 / `docs/specs/kops-support.md` 3.1(사이드바·`nav` 근거)
- `docs/reports/alerts/README.md`, `docs/reports/logs/README.md`(결정 정본 Q1~Q12)
- `docs/reports/alerts/designer.md` 8절, `docs/reports/logs/designer.md` 8절
- `docs/design/alerts.md`(3.2 필터·3.3 안내 줄·4.3 발송 칩·4.4 로그 링크·5.4 정지 구간·6.1 빈 상태), `docs/design/settings.md`, `docs/design/logs.md`(3·4·7·8·10절), `docs/design/components.md` 20~21절
- `docs/api/common.md`, `docs/api/cluster-status.md`, `docs/api/aws-cost.md` 6절(설정 API 선례), `docs/api/architecture-advisor.md` B.3(스트리밍 선례), `docs/api/k8s-snapshot.md`(422 확인 패턴)
- `docs/db/schema.md` 2.8~2.12, `apps/api/src/database/alerts-json.ts`, `apps/api/src/database/secret-settings.ts`, `apps/api/src/database/health/sanitize.ts`(읽기만)
- `deploy/rbac.yaml`(읽기만 — 고치지 않았다)

### 3. 작업 내용

1. **명세·결정 정본·디자인을 먼저 맞춰 읽었다.** 명세와 README가 어긋났던 전례(상단바 벨)가 있어 **README의 결정표를 정본으로** 삼고, 명세 본문과 디자인 산출물을 교차 확인했다.
2. **`docs/api/alerts.md`를 새로 썼다** (13절).
   - 0절: 화면↔엔드포인트, **"쓰기"의 층 구분 3층**(관측 대상 / 대시보드 DB / 밖으로 나가는 통지), **로그 금지(계약 수준)**, **어드바이저 격리**.
   - 1절: `AlertKey`(영역 8 + 시스템 2), `AlertSeverity`, `AlertKind`, `AlertTarget`, `AlertItem`, `AlertDetail`, `DispatchRecord`, `AlertGap`.
   - 2절: `GET /api/alerts`(필터·facets·gaps·watch), `GET /api/alerts/:id`, **`GET /api/alerts/badge`**, `PATCH /api/alerts/read`, `GET/PATCH /api/alerts/settings`, `GET /api/alerts/test/preview`, `POST /api/alerts/test`.
   - 3~5절: 발송 층 규칙(제외 사유 표·URL 제한·백오프·429·차단), 메시지에 담는 것/담지 않는 것, 억제·플래핑·워밍업이 응답에 드러나는 방식, mock 시나리오 9개와 `cluster`·`cost` 연동.
   - 6~13절: SSE 토픽 `alerts` 4개 이벤트, `Reason.code` 5개, 에러 코드, 환경 변수, 저장(DBA 설계 참조), 프론트 인수인계, 명세·디자인과의 차이 10건.
3. **`docs/api/logs.md`를 새로 썼다** — 상세는 `docs/reports/logs/backend.md`.
4. **`docs/api/common.md`를 갱신했다** (추가만. 기존 엔드포인트·토픽·필드 삭제·변경 0건).
   | 위치 | 추가 |
   |---|---|
   | 0 요약 | **"밖으로 나가는 통지" 행 신설**, "실시간" 행에 로그 전용 연결 예외 |
   | 1.2 | `Origin`·`Content-Type` 보호를 **로그 조회에도** 적용 |
   | 1.4 | **예외 ③ 컨테이너 로그 본문**, `details.fields[].value` 제외에 `webhookUrl`·`text` |
   | 2.3 | `SourceId` **`logBackend`**, `error.code` 2개 |
   | 3.3 | 403 3개·404 2개·422 `ALERT_TEST_CONFIRMATION_REQUIRED`·429 `ALERT_TEST_COOLDOWN`·503 `LOG_STREAM_LIMIT_REACHED` |
   | 4절 | `checks.logBackend` |
   | 5.1·5.3·5.8 | 토픽 **`alerts`** 1개, 봉투 union, 이벤트 목록(+ 전용 `log.*`), **로그는 공용 스트림에 싣지 않는다** 예외 |
   | 6.1 | mock 그룹 **`alerts`**(9)·**`logs`**(11) + cluster·cost → alerts 관계 |
   | 8절 | 변경 이력 1항목 |
5. **`docs/api/cluster-status.md`는 두 곳만 손봤다.** ① `nav`에 **알림·로그·설정 키를 추가하지 않는다**는 근거(`kops-support` 3.1 인용) ② `ControlPlaneComponent.logHref` 1개 추가(디자인 `ComponentMatrix.cells[].logHref`). 그 밖의 응답·토픽·이벤트는 건드리지 않았다.
6. **DBA가 이미 구현한 저장 계층에 계약을 맞췄다**(코드는 읽기만): `checkWebhookUrl()`의 실제 규칙(500자·하위 도메인 허용·경로 패턴), `maskWebhookUrl()`의 힌트 형식, `WebhookUrlRejectCode` 6개를 `details.reason`으로, `readWebhookStatus()`의 `source`, `ALERT_SYSTEM_KEYS` 2개.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/alerts.md` | 추가 | alerts API 계약 전체(엔드포인트 7개 + SSE 토픽 1개) |
| `docs/api/logs.md` | 추가 | logs API 계약 전체 — `docs/reports/logs/backend.md` 참고 |
| `docs/api/common.md` | 수정 | 층 구분·로그 예외·`logBackend`·에러 코드·토픽 `alerts`·mock 그룹 2개 (전부 **추가**) |
| `docs/api/cluster-status.md` | 수정 | `nav` 근거 문단 1개, `ControlPlaneComponent.logHref` 1필드, 변경 이력 |
| `docs/reports/alerts/backend.md` | 추가 | 이 보고서 |
| `docs/reports/logs/backend.md` | 추가 | logs 쪽 보고서 |

- **구현 코드·`deploy/rbac.yaml`·`.env.example`·`docker-compose.yml`은 건드리지 않았다.**

### 5. 주요 결정과 이유

1. **`alerts.snapshot`에 이력 목록을 싣지 않는다** (명세 4절과 다름)
   - 대안: 명세대로 "최근 N건"을 스냅샷에 넣는다.
   - 선택 이유: 상단바 벨·최근 10건 패널이 없어졌으므로(Q1) 목록이 필요한 화면은 `/alerts` 하나뿐이고 그 화면은 REST로 먼저 읽는다. 프론트는 앱 레이아웃에서 스트림 1개를 열어 **모든 페이지**가 이 토픽을 구독하므로, 스냅샷에 이력을 실으면 알림 화면을 보지 않는 탭까지 재연결마다 이력을 받는다. 배지 값은 모든 이벤트에 함께 실어 정확도를 유지한다. → **PM 확인 요청**(8절).
2. **배지 전용 엔드포인트 `GET /api/alerts/badge`를 만들되 목록은 주지 않는다.** 스트림 없이 렌더하는 첫 로드가 필요하고, 명세 7절 DBA가 "미확인 수와 최악 심각도" 전용 조회 패턴을 이미 요구했다. 응답 필드를 **3개로 제한**해 패널 응답으로 자라지 못하게 했다.
3. **로그 링크는 파드가 사라져도 지우지 않는다.** 대안(존재할 때만 링크)은 새로고침마다 링크가 나타났다 사라져 사용자가 자기 눈을 의심한다(디자인 4.4). 대신 `logTarget.gone`·`deletedAt`을 서버가 주어 `삭제됨` 칩을 그리게 하고, 실제 안내는 로그 화면(`LOG_POD_NOT_FOUND`)이 한다. **`logs.state`를 저장하지 않고 응답 시점에 계산**하는 것이 핵심이다 — 알림은 과거 기록이라 저장값이 곧 거짓이 된다.
4. **정지 구간을 `items[]`가 아니라 `gaps[]`로 분리했다.** 디자인 5.4가 "어떤 필터로도 사라지면 안 된다"고 못 박았는데, 항목 배열에 섞으면 필터링 코드가 언젠가 지운다. 배열을 나누면 **지울 수 없다.**
5. **테스트 발송 실패를 HTTP 오류로 만들지 않았다.** 200 + `result.state: "failed"`. 이유: 실패도 이력에 남아야 하고(명세 3.5-7), 화면의 "마지막 발송 결과"가 같은 구조를 쓴다. 422(확인 없음)·429(쿨다운)·409(미설정·꺼짐)만 오류다.
6. **`GET /api/alerts/test/preview`를 별도로 뒀다.** 확인 대화상자가 "보낼 본문 전문"을 **서버 문자열 그대로** 보여줘야 하는데(디자인 5절: 화면이 조립하지 않는다), `POST`에 미리보기 모드를 넣으면 "실수로 보냈다"가 생긴다. 조회는 부작용이 없어야 한다.
7. **웹훅 검증을 DBA `checkWebhookUrl()` 하나로 통일했다.** API가 별도 정규식을 가지면 두 곳이 갈라진다. 계약에 실제 규칙(500자·하위 도메인 허용·끝 슬래시 허용)을 그대로 적었다 — 처음 초안은 2048자·정확히 두 호스트·쿼리 금지였는데 **구현이 이미 다르게 돼 있어 구현 쪽에 맞췄다.**
8. **`lockedByEnvDetail[]`을 새로 뒀다.** 기존 `lockedByEnv: string[]`(필드 이름)만으로는 화면이 "왜 못 고치는지"를 말할 수 없고, 디자인 `SecretInput.lockedByEnv`는 **환경 변수 이름 문자열**을 받는다. 두 값의 용도가 달라서 나란히 둔다. 환경 변수 **값**은 절대 넣지 않는다.
9. **`DispatchState`에 2개를 더했다**(`skipped_no_pair`·`skipped_circuit_open`). AC-ALERT32(짝 없는 해제)와 연속 실패 차단을 기록으로 구분할 수 없으면 "왜 안 갔나"에 답할 수 없다. `restart_summary`는 값을 더하지 않고 **기록 자체를 만들지 않는 쪽**을 골랐다(디자인: 기록이 없으면 칩을 그리지 않는다).
10. **`nav`에 알림·로그 키를 추가하지 않았다.** 알림은 상태의 파생이라 점이 중복이고, 로그는 내용으로 상태를 판단하지 않는다. 근거를 `cluster-status.md` 2.1 본문에 **인용과 함께** 적어 다음 사람이 되돌리지 못하게 했다.

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과** (오류·경고 0) | 코드 미변경 |
| `npm test --prefix apps/api` | **통과** — 45 suites / **502 passed, 2 skipped, 504 total** | 코드 미변경. 작업 중 2회 실행: 489 → 502(DBA가 SQL 가림 실측 테스트 13개를 추가하는 동안) |

- **기준선 차이**: PM이 준 기준선은 `462 passed / 1 skipped`인데 실제는 `502 passed / 2 skipped`다. 원인은 **DBA가 같은 시간에 alerts 저장 계층을 이미 커밋하지 않은 상태로 올려 둔 것**이다(`apps/api/src/database/alerts-json.ts`, `secret-settings.ts`, `secret-settings.spec.ts`, `prisma/migrations/20260924180000_alerts/`, `retention`·`settings-defaults` 수정). 내 작업은 `docs/**`만 건드렸으므로 이 증가는 내 변경과 무관하다. `git status --porcelain -- docs`로 내 변경이 문서 4개 + 보고서 2개뿐임을 확인했다.
- 서버·프로세스를 띄우지 않았다(계약 문서 작업이라 필요 없었다). 포트 3131 미사용.

### 7. 남은 이슈·한계

- **계약이지 구현이 아니다.** 엔드포인트·필드·이벤트는 다음 지시에서 만든다. 지금 `apps/api`에는 alerts 라우트가 없다.
- **`ALERTS_DISPATCH`·`ALERTS_DISCORD_WEBHOOK_URL`·`ALERTS_PUBLIC_BASE_URL`이 `env.validation.ts`·`.env.example`·`docker-compose.yml`·`deploy/app.example.yaml`에 아직 없다.** 계약 9절에 적어 뒀고 구현 때 추가한다(이번 범위 밖).
- **열린 질문 Q11**(클러스터 안 배포에서 `discord.com:443` egress)은 그대로다. 계약은 "나갈 수 없으면 `failed`로 기록하고 화면 알림은 정상 동작"으로 처리했으므로 착수를 막지 않는다.
- `rules.repeatEveryMin`은 **자리만** 뒀다(P3). 값을 넣어도 동작하지 않고 notice가 붙는다 — 구현에서 이 약속을 지켜야 한다.
- 메시지 본문의 **정확한 임베드 형식**(플레인/embed, 색, 필드 배치)은 계약이 정하지 않았다. 담을 정보만 4.1에 고정했다(명세 3.3.2와 같은 태도).

### 8. 다른 담당 요청

- **DBA 요청 ①**: `alert_deliveries.status` enum(`alert_delivery_status`)에 **`skipped_no_pair`·`skipped_circuit_open` 2개 추가**(마이그레이션). 근거는 `docs/api/alerts.md` 1.4·3.1·12절. 현재 10개로는 AC-ALERT32(짝 없는 해제)와 연속 실패 차단(1시간 발송 정지)을 기록으로 구분할 수 없다.
- **DBA 요청 ②**(logs 쪽): `createPgLogValueMasker()`의 성능(줄당 초당 수천 번)과 **JSON 로그 형식에서의 동작 실측**. 상세는 `docs/reports/logs/backend.md` 8절.
- **PM 확인 요청**: `alerts.snapshot`에서 **"최근 N건"을 뺐다**(5절 결정 1). 명세 4절 문구와 다르므로 planner에게 넘길지 판단 바란다. 명세는 건드리지 않았다.
- **planner 요청**: 명세 3.3.1에 남아 있는 `Drawer` 언급(최근 N건 패널의 잔재)은 designer도 지적했다. 계약은 패널을 만들지 않는 전제로 썼다.
- **퍼블리셔·프론트 요청**: `DispatchState`에 디자인 union에 없는 값 2개가 온다. 모르는 `skipped_*` 값은 **"제외" 계열 중립 칩**으로 그리는 기본 규칙을 둬 달라(`docs/api/alerts.md` 11절에 적었다).
- **frontend 요청**: `alerts.created`를 받으면 행은 즉시 추가하되 `facets`·`gaps`는 `GET /api/alerts` 재조회(300ms debounce)로 맞춘다. 개수는 서버 값이라 화면이 세지 않는다.

### 9. 다음 담당이 알아야 할 점

- **계약 경로**: `docs/api/alerts.md`. 공통 규약 변경은 `docs/api/common.md` 8절 "2026-09-25" 항목에 한 번에 적어 뒀다.
- **화면이 하지 않는 것**은 `docs/api/alerts.md` 11절에 모아 뒀다. 프론트는 이 목록만 지키면 된다.
- **로그와의 경계**: 알림 응답에 로그를 담을 필드는 **없고 앞으로도 만들지 않는다**(0.3). 잇는 것은 `logHref` 하나다. 검증은 AC-ALERT13(응답 JSON 전체 문자열 검색).
- **어드바이저와의 경계**: 알림 이력을 스냅샷에 넣지 않는다(0.4). 넣으면 노드 이름 가명 규칙(AC-KOPS44)이 통째로 우회된다.
- **mock에서 눈으로 확인하는 경로**: `alerts` 그룹은 미리 쌓인 이력, **실시간 생성은 `cluster`·`cost` 시나리오 전환**(AC-ALERT02·07·12). 구현할 때 이 연동이 빠지면 실제 클러스터 없이 검증할 방법이 없어진다.
- 구현 시작 시 **`deploy/rbac.yaml`은 alerts 때문에 바뀌지 않는다.** RBAC가 바뀌는 것은 `logs`의 `pods/log` 하나뿐이다.

---

## 2026-09-24 22:50 · alerts P1 구현 (화면 알림 센터) + 공통 설정

### 1. 요청 내용

PM 지시(구현 4단계) 중 alerts 몫: **P1 = AC-ALERT01~18 + 35~37**.
- 알림 생성은 **기존 `StatusInfo`의 전이만** 감지한다. 새 판단 기준·새 임계값을 만들지 않는다
- 억제(15분)·플래핑(30분·4회)·워밍업(120초)·출처 억제(3분)·`unknown` 5분을 **전부 설정값**으로
- "정지 구간"은 `gaps[]`를 `items[]`와 **별도 배열**로 내려보낸다(필터 코드가 지울 수 없게)
- `GET /api/alerts/badge`는 `unreadCount`·`worstSeverity`·`updatedAt` **3개뿐**
- SSE는 **기존 토픽 체계에 `alerts` 1개 추가**
- 알림 응답에 **로그를 담을 필드를 만들지 않는다**(요약·통계도)
- **어드바이저 스냅샷에 알림 이력을 넣지 않는다**
- DBA 스키마 규칙 준수(`closed_at` 규칙, 바뀐 키만 upsert, jsonb 배열 상한 자르기, mock reset은 `data_source='mock'`만)
- `SettingsService`에 쓰기 후 `invalidate(key)`를 반드시 부른다
- **하지 않을 것**: P2(설정 화면 API·디스코드 발송)

작업 중 PM이 추가로 3건을 지시했다(DBA 실측). ① 배지 질의를 `severity < 'resolved'` + `min(severity)` 형태의 `$queryRaw`로 ② 발송 상태 enum 2개(`skipped_no_pair`·`skipped_circuit_open`)를 `failed`로 뭉뚱그리지 말 것 ③ 내 파일 2곳 prettier 오류. 셋 다 반영했고 ①은 계약 문서에도 적었다.

### 2. 참고한 문서

- `docs/api/alerts.md` (내가 3단계에 쓴 계약. **이대로 구현**), `docs/api/common.md`
- `docs/specs/alerts.md` 3.1~3.2·3.7·5절 AC-ALERT01~18·35~37
- `docs/reports/alerts/README.md` — PM·사용자 결정 Q1~Q12 (Q1 사이드바, Q3 원문 이름, Q5 기준값, Q12 보관)
- `docs/reports/alerts/dba.md` + 실제 코드: `apps/api/prisma/schema.prisma`(Alert·AlertDelivery·AlertKeyState·DashboardHeartbeat), `src/database/alerts-json.ts`, `src/database/secret-settings.ts`, `src/database/settings-defaults.ts`(`alerts`·`alerts.discord`), `src/database/retention.ts`
- 기존 구현 선례: `src/cost/cost.extensions.ts`(TopicSource·MockScenarioTarget 패턴), `src/cluster/overview.service.ts`, `src/common/status.ts`·`source-registry.service.ts`·`settings.service.ts`

### 3. 작업 내용

**(0) 공통 설정 — 먼저**

1. `deploy/rbac.yaml`: `pods/log`의 `get` **하나만** 추가하고 첫 줄 주석을 갱신했다("pods/log 없음" → 예외 1건 + 왜 열었는지 + 완화 수단 7가지 + "지우면 로그 기능만 403이 된다"). `pods/exec`·`portforward`·`attach`·쓰기 동사는 그대로 없다.
2. `.env.example`·`docker-compose.yml`·`deploy/app.example.yaml`에 `ALERTS_*`·`LOG_*` 환경 변수. **클러스터 안 배포는 `LOGS_ENABLED=false`가 기본**이고 "켜기 전에 확인할 것 3가지"를 주석으로 적었다.
3. `src/config/env.validation.ts`에 13개 추가 + `LOG_DEFAULT_LINES <= LOG_MAX_LINES` 교차 검증.

**(1) 판정 계층 — 순수 함수 (`alert-rules.ts`)**

`decideKey({key, state, observation, rules, now, warmup})` 하나가 키 1개의 표본을 처리하고 `{state, actions, changed}`를 돌려준다. 여기에는 **상태를 판단하는 코드가 없다** — 들어오는 `status`는 `areas.*.status`를 그대로 옮긴 값이다.

| 입력 | 결과 |
|---|---|
| ok/unknown → warning/critical | `transition` (진행 중 알림 없을 때) |
| warning → critical | `escalation` — **새 행 + 이전 행 닫기** |
| critical → warning | `mitigate` — **새 행을 만들지 않는다** |
| →ok (진행 중 알림 있음) | `resolve` |
| →ok (진행 중 알림 없음) | 아무것도 안 함 (짝 없는 "복구됨" 금지) |
| 같은 상태 유지 | 아무것도 안 함 (AC-ALERT03) |
| 같은 등급 + 영향 객체 증가 | `merge` (`repeatCount`++) |
| 창 안 전이 N회 | `flapping` 묶음 1건 + **그 표본부터** 개별 알림 정지 |
| unknown 지속 | 기준 시간 전에는 **아무것도 만들지 않는다** |
| 워밍업 / 출처 억제 | 상태만 따라가고 알림 없음 |

`changed`가 false면 상태 머신을 **쓰지 않는다**(15초마다 8행을 쓰지 않게 — DBA 규칙).

**(2) 엔진 (`alert-engine.service.ts`)** — 15초 루프. `OverviewService.overview()`로 `areas.*` 7개 + `cost.status`, `SourceRegistry`로 `source:kube`를 읽어 키 8개를 관측한다. kube가 기준 시간 넘게 끊겨 있으면 영역 5개를 `source:kube`에 묶는다. 60초 heartbeat, 기동 시 직전 heartbeat와의 차이로 정지 구간 계산, 워밍업 종료 시 `restart_summary` 1건.

**(3) 저장 (`alert-store.service.ts`)** — Prisma → 없으면 메모리 최근 N건(`memoryFallbackMax`). DBA 규칙을 코드에 박았다: 종결형은 만들 때 `closedAt`, 격상은 새 행 + 이전 행 닫기, 완화는 update만, jsonb 배열 상한 자르기, mock 초기화는 `data_source='mock'`만.

**(4) 배지 질의 (PM 지시 반영)** — Prisma `groupBy`를 버리고 `$queryRaw`로 바꿨다.

```sql
SELECT count(*)::int AS unread, min(severity) AS worst
  FROM alerts
 WHERE data_source = $1 AND acknowledged_at IS NULL
   AND severity < 'resolved'   -- 인덱스 경계 (<>는 필터라 VACUUM 전에 Seq Scan이 된다)
   AND kind <> 'test'          -- 힙 필터 (인덱스 열이 아니라 경계에 영향 없음)
```

메모리 폴백도 **같은 순서**(`SEVERITY_ORDER`)를 쓰도록 맞췄다 — 한쪽만 바뀌면 DB 있을 때와 없을 때 배지 색이 달라진다. 근거를 `docs/api/alerts.md` 2.3.1에 표로 적어 다음 사람이 Prisma의 편한 API로 되돌리지 못하게 했다.

**(5) 조립 (`alert-presenter.ts`)** — 저장된 구성요소 → `AlertItem`/`AlertDetail`/디스코드 본문. 본문 문자열을 저장하지 않으므로 **로그 줄이 들어올 자리가 구조적으로 없다**.

**(6) REST·SSE** — `GET /api/alerts`, `GET /api/alerts/:id`, `GET /api/alerts/badge`, `PATCH /api/alerts/read` + 토픽 `alerts`(`snapshot`·`created`·`updated`·`read`). `alerts.snapshot`에 **목록이 없다**(AC-ALERT37).

**(7) mock** — `alerts` 그룹 9종. 기동 시 `default`를 자동 시드한다(live에서는 아무것도 하지 않는다).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `deploy/rbac.yaml` | 수정 | `pods/log` `get` **1개만** 추가 + 첫 줄 주석 갱신(왜 열었나·완화 수단·지우면 무슨 일이) |
| `.env.example` | 수정 | `ALERTS_DISPATCH`·`ALERTS_DISCORD_WEBHOOK_URL`·`ALERTS_PUBLIC_BASE_URL` + `LOG_*` 12개 |
| `docker-compose.yml` | 수정 | 같은 값 전달 (`LOGS_ENABLED` 기본 true) |
| `deploy/app.example.yaml` | 수정 | **`LOGS_ENABLED=false` 기본** + 켜기 전 확인 3가지, `ALERTS_DISPATCH`, 웹훅은 Secret로 |
| `apps/api/src/config/env.validation.ts` | 수정 | 환경 변수 13개 + 교차 검증 1개 |
| `apps/api/src/alerts/alerts.types.ts` | 추가 | 응답·저장 타입. **로그 필드 없음** |
| `apps/api/src/alerts/alert-labels.ts` | 추가 | 키 → 영역·문구·경로, 심각도 순서 |
| `apps/api/src/alerts/alert-rules.ts` | 추가 | 전이 판정 (순수 함수) |
| `apps/api/src/alerts/alert-rules.spec.ts` | 추가 | 23건 (시간이 걸리는 규칙을 여기서 고정) |
| `apps/api/src/alerts/alert-engine.service.ts` | 추가 | 15초 루프·출처 억제·워밍업 요약·heartbeat·정지 구간 |
| `apps/api/src/alerts/alert-store.service.ts` | 추가 | Prisma + 메모리 폴백, 배지 `$queryRaw` |
| `apps/api/src/alerts/alert-presenter.ts` | 추가 | 구성요소 → AlertItem·본문 |
| `apps/api/src/alerts/alerts.service.ts` | 추가 | 목록·상세·배지·확인·SSE 페이로드 |
| `apps/api/src/alerts/alerts.controller.ts` | 추가 | REST 4개 |
| `apps/api/src/alerts/dto.ts` | 추가 | 쿼리·확인 DTO |
| `apps/api/src/alerts/alerts.extensions.ts` | 추가 | TopicSource `alerts` + MockScenarioTarget |
| `apps/api/src/alerts/mock/mock-alerts.ts` | 추가 | 시나리오 9종 픽스처 |
| `apps/api/src/alerts/alerts.module.ts` | 추가 | 모듈 |
| `apps/api/src/app.module.ts` | 수정 | `LogsModule`·`AlertsModule` 등록 |
| `apps/api/src/cluster/cluster.module.ts` | 수정 | `OverviewService` export (엔진이 읽기만 한다) |
| `apps/api/src/cluster/state/cluster-store.ts` | 수정 | `PodHistory.deletedAtOf()` 공개 (최근 삭제 캐시) |
| `apps/api/src/common/extension-points.ts` | 수정 | `MockScenarioGroup`에 `alerts`·`logs` |
| `apps/api/src/stream/stream.service.ts` | 수정 | `STREAM_TOPICS`에 `alerts` 1개 |
| `apps/api/src/stream/stream.service.spec.ts` | 수정 | 토픽 목록 + `?topics=logs`는 400 |
| `apps/api/src/stream/mock-scenario.service.ts` | 수정 | 그룹 2개 등록 |
| `docs/api/alerts.md` | 수정 | **2.3.1 배지 질의 절 신설** (PM 지시) |

### 5. 주요 결정과 이유

- **판정을 순수 함수로 떼어냈다.** 억제 15분·플래핑 30분·워밍업 120초·확인 불가 5분은 기동 검증으로 눈에 담을 수 없다. 함수로 떼면 가짜 시계로 전부 고정할 수 있다(23건). 대안(엔진 안에 두고 통합 테스트)은 검증이 느리고 시간 규칙을 못 덮는다.
- **플래핑 진입 표본에서도 개별 알림을 막았다.** 처음 구현은 진입 알림과 그 전이의 해제 알림이 함께 나갔다(테스트로 발견). 묶음을 만든 뜻이 없어진다.
- **해제 알림의 `durationMs`를 원본 발생 시각 기준으로 바꿨다.** 해제 행의 `occurredAt`은 해제된 시각(목록 정렬 기준)이라 그대로 쓰면 항상 0이고 "지속 17분"이 나오지 않는다. 원본 alert를 참조로만 두면 보관 정리로 사라질 때 값을 잃으므로 **`context.incidentStartedAt`에 값을 복사**했다.
- **발송 기록은 만들되 발송기는 만들지 않았다**(P1 범위). `alerts` 모듈에 HTTP 클라이언트가 **하나도 없어서** 아웃바운드 0건이 구조적으로 보장된다. mock이면 `skipped_mock`, live+웹훅 있음이면 `pending`(P2 큐가 가져간다), live+미설정이면 `skipped_not_configured`.
- **배지 질의를 `$queryRaw`로.** PM·DBA 실측 근거를 그대로 따랐고, 메모리 폴백도 같은 순서를 쓰게 맞췄다.
- **`kind <> 'test'`는 남겼다.** PM이 `<>`를 쓰지 말라고 한 것은 `severity`(인덱스 경계) 얘기다. `kind`는 인덱스 열이 아니라 힙 필터이므로 경계에 영향이 없고, 빼면 테스트 발송이 배지에 세어져 계약 2.3을 어긴다. 판단 근거를 코드 주석과 계약 2.3.1에 적었다.
- **mock 기본 시나리오를 기동 시 자동 시드**한다. 안 하면 화면을 열었을 때 0건이라 "미리 쌓인 이력"이라는 계약이 성립하지 않는다.
- **어드바이저 기여자를 만들지 않았다**(계약 0.4). 만들 자리를 비워 두는 것이 "넣지 말자"는 주석보다 확실하다.

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과** (오류 0) | |
| `npm test --prefix apps/api` | **566 passed / 2 skipped** | 기준선 502 → **+64** (alerts 23, logs 35, stream 기존 1건 갱신) |
| `npm run build --prefix apps/api` | **통과** | |
| `npx tsc --noEmit` | **통과** | |
| `npm run prisma:generate` | **통과** | DBA enum 2개 추가 반영 |

**mock 기동 검증** (포트 3131, `DATA_SOURCE=mock`, 대시보드 DB 없음). 띄운 PID가 실제로 3131을 듣는지 `netstat -ano`로 확인하고 **그 PID만** `Stop-Process -Id`로 종료했다(마지막 PID 29540).

| 확인 | 결과 |
|---|---|
| `GET /api/alerts/badge` | `unreadCount: 3`, `worstSeverity: critical` — **AC-ALERT35 mock 기대치와 일치** |
| `GET /api/alerts?range=24h` | `total 12`, `facets.severity {critical:3, warning:5, unknown:1, resolved:3}`, `persistence: memory` |
| 정지 구간 | `gaps[]` 1건(`unknownPrevious: true` — DB 없음). `severity=critical`·`includeResolved=false`·`area=system`(결과 0건) **모든 필터에서 그대로 1건** |
| facets | 필터를 걸어도 **기간 기준 값 그대로**(0이 되지 않음) |
| `PATCH /api/alerts/read` | 1건 → 배지 3→2, `{all:true}` → 0. `ids`+`all` 동시 → **400**, 없는 id 상세 → **404** |
| `alerts=restart` | `restart_summary` 1건 + `gaps[]`에 **19분 구간**(요약 안과 목록 두 곳 모두 — 디자인 5.4). `dispatch: []` |
| `alerts=suppressed-by-source` | `source:kube` **1건만**, `severity: unknown`/`확인 불가`, `suppressedAreas: 5`, 응답 전체에 **"장애" 낱말 0건** |
| `alerts=burst` + SSE | `alerts.snapshot`에 **목록 없음**(AC-ALERT37), `alerts.created`가 3초마다 도착, 배지 3→4→5→6→7 |
| 워밍업 120초 | 그동안 엔진 알림 **0건**, 종료 시 `restart_summary` **1건**(`counts {critical:4, warning:1}`, `gap.unknownPrevious: true`), `ALERTS_WARMUP_ACTIVE` notice 사라짐 |
| **실시간 생성** (AC-ALERT02) | `cluster` `healthy`→`critical` → 15초 안에 `area:nodes`·`workloads`·`pods`·`events` **4건 생성**, 배지 증가 |
| **해제** (AC-ALERT04) | `critical`→`healthy` → `resolve` 4건, `relation: resolves` + `relatedAlertId` 연결 |
| **반복 없음** (AC-ALERT03) | 같은 상태 30초 유지 → 알림 수 11 → 11 (증가 없음) |
| **아웃바운드 0건** (AC-ALERT26) | `src/alerts/`에 `fetch`/`axios`/`undici`/`http.request` **0건**, 프로세스의 외부 연결 **0건** |
| **AC-ALERT13** | 알림 응답 JSON 전체에서 mock 로그 픽스처 문자열(`hunter2hunter2`·`Failing row contains`·`STATEMENT:`·`Bearer`·`AKIA`·`OrderService.java`·`segments`·`logLineCount`) **전부 0건** |
| **계약 0.4** | 어드바이저 스냅샷(30KB)에 `"alerts"`·`unreadCount`·알림 사유 문자열 **0건** |

**하지 못한 검증(숨기지 않고 적는다)**

- **대시보드 DB(Postgres) 경로를 실제로 돌리지 못했다.** 검증은 전부 메모리 폴백(`persistence: "memory"`)이다. `$queryRaw` 배지 질의·`alertKeyState` upsert·`dashboardHeartbeat`·`seedMock`의 Prisma 경로는 **타입 검사만** 거쳤다 → 월요일 확인 목록.
- 억제 15분·플래핑 30분·확인 불가 5분·출처 억제 3분은 **기동으로 확인하지 못했다**(그만큼 기다려야 한다). 단위 테스트(가짜 시계) 23건으로 덮었다.
- 보관 정리(`purgeAlerts`, AC-ALERT18)는 DBA가 만든 기존 코드이고 이번에 **건드리지 않았다**. 동작 확인도 하지 못했다(DB 필요).
- `POST /api/mock/reset` 직후 배지가 3이 아니라 6이었다. 초기화가 상태 머신도 되돌리므로 엔진이 **지금의 `cluster=mixed`(critical) 상태를 새 전이로 다시 감지**하기 때문이다. 동작으로는 맞지만 "reset 후 배지 3"을 기대하면 어긋난다. 기동 직후(워밍업 중)에는 정확히 3이다.

### 7. 남은 이슈·한계

- **P2 미구현**: `GET/PATCH /api/alerts/settings`, `GET /api/alerts/test/preview`, `POST /api/alerts/test`, 디스코드 발송기·재시도·서킷 브레이커. `GET /api/alerts/settings`는 지금 `@Get(':id')`에 잡혀 **404 `RESOURCE_NOT_FOUND`**로 응답한다(P2에서 구체 경로를 `:id`보다 먼저 선언하면 해결).
- `dispatch[].state: 'pending'`인 알림은 **P2 발송기가 붙기 전까지 큐에서 빠져나가지 않는다**. 기본값(mock)에서는 생기지 않는다.
- `rules.repeatEveryMin`(주기 재알림)은 설정만 있고 동작하지 않는다(P3). P2에서 `ALERTS_REPEAT_NOT_IMPLEMENTED` notice를 붙여야 한다.
- 알림 키 8개 단위다. 파드·노드 개별 키는 P3.
- `system:test` 키는 타입·라벨만 있고 쓰이지 않는다(P2에서 쓴다).

### 8. 다른 담당 요청

- **DBA 요청 없음.** 스키마·enum·설정 기본값·보관 정리를 **그대로 썼고 `apps/api/src/database/**`·`prisma/**`를 하나도 건드리지 않았다.** enum 2개 추가 마이그레이션이 들어와 `npm run prisma:generate`만 돌렸다.
  - 확인 요청 1건: `alerts.discord.webhookUrl` 행이 `{url: null}`(지운 상태)로 남아 있을 때 `readWebhookStatus()`가 `configured: false`를 주는 것을 전제로 안내 문구를 만들었다. 지금 구현이 그러하다(코드로 확인함).
- **frontend 요청**: ① 배지는 `GET /api/alerts/badge`(3필드)로 첫 로드, 이후 `alerts.*`의 `badge`로 갱신 ② `gaps[]`를 필터 결과 배열에서 빼지 말 것 — 서버가 **필터와 무관하게** 내려보내는 것을 확인했다 ③ `alerts.snapshot`에 목록이 없으므로 `/alerts` 화면은 반드시 `GET /api/alerts`를 부른다.
- **publisher 요청**: `DispatchState` 12종이 모두 응답에 나올 수 있다(`skipped_no_pair`·`skipped_circuit_open` 포함). 서버가 `label`을 함께 주므로 **칩 문구를 화면이 만들지 않아도 된다**.
- **PM 확인 요청**: 위 6절의 "reset 후 배지 6" 동작이 의도와 맞는지. 맞다면 그대로 두고, "reset 후에는 엔진이 다시 감지하지 않아야 한다"면 상태 머신 초기화 방식을 바꾼다.

### 9. 다음 담당이 알아야 할 점

- **엔진은 `OverviewService.overview()`를 읽기만 한다.** 새 조회·새 `SourceId`·새 RBAC가 하나도 늘지 않았다(AC-ALERT14). 알림 때문에 쿠버네티스나 AWS를 더 부르지 않는다.
- **판정 규칙을 바꿀 때는 `alert-rules.ts` 하나만** 고치면 된다. 엔진·저장·응답은 그 결과를 옮길 뿐이다.
- **설정을 쓴 뒤에는 `AlertEngine.invalidateRules()`를 부른다**(안에서 `SettingsService.invalidate('alerts')`를 부른다). 안 부르면 최대 60초 옛 값이 쓰인다. P2 설정 API에서 반드시 호출할 것.
- **본문은 저장하지 않고 조립한다.** 문구를 고쳐도 과거 이력이 옛 문구로 남지 않고, **로그 줄이 들어올 자리가 없다.** `AlertRecord`에 자유 텍스트 칸을 추가하지 말 것.
- **mock에서 눈으로 보는 경로**: `alerts` 그룹 = 미리 쌓인 이력, **실시간 생성은 `cluster`/`cost` 전환**. 기동 직후 120초는 워밍업이라 알림이 안 생기는 것이 정상이다.

---

## 2026-09-24 23:40 · alerts P2 구현 (설정 API + 테스트 발송 + 디스코드 발송기)

### 1. 요청 내용

PM 지시(2단계). **AC-ALERT19~34**.
- **라우트 순서 먼저**: `GET /api/alerts/settings`가 `@Get(':id')`에 잡혀 404다(P1에서 내가 보고한 것). 구체 경로를 `:id`보다 먼저
- 설정 API: 웹훅 저장·해제. **원문을 응답에 담지 않는다**(끝 4자 힌트만). `.env`로 잠긴 경우 409 + "왜 못 고치는지"
- 저장은 `src/database/secret-settings.ts`의 전용 함수로만
- **설정 저장 후 `invalidate(key)`를 반드시 부른다**
- 테스트 발송: 422·429(+`Retry-After`)·부작용 없는 미리보기
- 디스코드 발송기: **`ALERTS_DISPATCH=mock`에서 아웃바운드 0건 유지.** 1단계의 "HTTP 클라이언트가 없다"는 성질이 깨지므로 **mock일 때 그 경로에 들어가지 않는 것을 테스트로 고정**
- 도메인 제한(SSRF), 연속 실패 1시간 차단 → `skipped_circuit_open`, 짝 없는 해제 → `skipped_no_pair`. **`failed`로 뭉뚱그리지 않는다**
- 알림 본문에 로그 줄 금지
- 발송 실패 메시지·`error_message`가 **`redactSecrets`를 반드시 타게** (DBA 요청)

또한 PM 확인 답변("`mock/reset` 후 배지 6은 정상")에 따라 **근거를 계약 문서에 적었다**.

### 2. 참고한 문서

- `docs/api/alerts.md` 2.5~2.7·3·5절(내가 쓴 계약), `docs/specs/alerts.md` AC-ALERT19~34
- `docs/reports/alerts/README.md` — Q4(평문 저장·원문 미노출), Q9(디스코드 도메인만), Q10(`ALERTS_DISPATCH`)
- DBA 구현: `src/database/secret-settings.ts`(`checkWebhookUrl`·`saveWebhookUrl`·`clearWebhookUrl`·`readWebhookStatus`·`loadWebhookUrlForDispatch`·`SettingLockedByEnvError`), `src/database/health/sanitize.ts`(`redactSecrets`에 웹훅 패턴), `settings-defaults.ts`(`alerts.discord`)

### 3. 작업 내용

**(1) 라우트 순서** — `alerts.controller.ts`를 "구체 경로 → 목록 → `:id`" 순서로 다시 썼고, **왜 그 순서여야 하는지**를 파일 머리말과 `:id` 바로 위에 적었다. 이 버그는 순서만 바꾸면 사라지지만 다음 사람이 알파벳순으로 정리하다 되돌리기 쉽다.

**(2) 판정과 발송을 나눴다** — `dispatch-rules.ts`(순수 함수)가 `decideDispatch(kind, severity, ctx)` → `{action: 'send'|'skip'|'none', state}`를 돌려준다. **`mock`이면 두 번째 줄에서 `skip/skipped_mock`으로 끝난다.**
판정 순서(위가 이긴다): `restart_summary`(기록 없음) → **mock** → 주소 없음 → 끄기 → 서킷 → 플래핑 → 테스트 → 해제(짝 확인) → `unknown` 축 → 심각도 하한.

**(3) 나가는 문을 하나로 좁혔다** — `discord-sender.ts`의 `DiscordSenderPort` 하나뿐이고 DI 토큰(`DISCORD_SENDER`)으로 주입한다. 그 안에서 **호스트를 한 번 더 검사**하고(저장 단계에 이어 두 번째), 허용되지 않으면 **`fetch`를 부르지 않는다**. 모든 실패 문구는 `safeDetail()`(= `redactSecrets` + 한 줄 + 300자)을 거친다.

**(4) 발송기(`alert-dispatcher.service.ts`)**
- 알림이 만들어지면 `record()`가 **판정만** 하고 기록을 남긴다(네트워크 없음).
- 2초 큐가 `pending`을 가져간다. **mock이면 큐가 즉시 반환**한다.
- 백오프 5→30→120초 후 `failed`, 429는 `Retry-After`를 지켜 `pending` 유지(실패로 세지 않는다), 연속 실패 10건 → 1시간 `skipped_circuit_open`.
- 기동 시 남아 있던 `pending`을 **`skipped_restart`로 정리**하고 자동 재발송하지 않는다.
- 원문 웹훅을 다루는 경로는 `loadWebhook()` 하나이고 반환값을 로그·응답·예외에 넣지 않는다.

**(5) 설정(`alert-settings.service.ts`)** — 웹훅은 **DBA 전용 함수로만** 오간다. `SETTING_DEFAULTS`에 그 key가 없어 `SettingsService.get()`은 컴파일되지 않는다(DBA가 일부러 만든 벽). 저장 후 **`invalidate('alerts')`·`invalidate('alerts.discord')`를 반드시** 부르고, 컨트롤러는 이어서 `AlertEngine.invalidateRules()`까지 부른다.

**형식 검증을 DB 확인보다 먼저 옮겼다.** 처음 구현은 DB가 없으면 틀린 주소에도 503을 줬다 — 사용자가 고칠 수 있는 유일한 것이 "주소가 틀렸다"인데 그 사실을 감추는 셈이다. 지금은 `checkWebhookUrl()`(DBA 함수 하나)로 먼저 판정해 400을 주고, 형식이 맞을 때만 DB를 본다. 덕분에 **DB 없이도 AC-ALERT21을 실제로 검증할 수 있었다.**

**(6) 테스트 발송** — 미리보기는 부작용이 없고, 실제 발송은 `confirm: true` 없으면 422, 60초 안 재호출은 429 + `Retry-After`. 결과와 무관하게 쿨다운이 시작된다. 이력 1건(`kind: 'test'`)을 남기지만 **배지에는 세지 않는다**.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/alerts/alerts.controller.ts` | 수정 | **라우트 순서 수정** + 설정·테스트 4개 추가 |
| `apps/api/src/alerts/dispatch-rules.ts` | 추가 | 발송 판정 (순수 함수) |
| `apps/api/src/alerts/dispatch-rules.spec.ts` | 추가 | 17건 (mock 전수 조합 포함) |
| `apps/api/src/alerts/discord-sender.ts` | 추가 | **나가는 문 1개** + 호스트 재검사 + `safeDetail` |
| `apps/api/src/alerts/alert-dispatcher.service.ts` | 추가 | 큐·백오프·429·서킷·재시작 정리·테스트 발송 |
| `apps/api/src/alerts/alert-settings.service.ts` | 추가 | 설정 조합·부분 갱신·env 잠금 |
| `apps/api/src/alerts/alerts.service.ts` | 수정 | `settings`·`patchSettings`·`testPreview`·`sendTest` |
| `apps/api/src/alerts/alert-store.service.ts` | 수정 | `upsertDelivery`·`wasDispatched`·`markPendingAsRestart`·`dueDeliveries` |
| `apps/api/src/alerts/alert-engine.service.ts` | 수정 | 발송 판정을 발송기에 위임 |
| `apps/api/src/alerts/alerts.extensions.ts` | 수정 | 발송 상태 변화 → `alerts.updated` |
| `apps/api/src/alerts/dto.ts` | 수정 | 설정 PATCH·테스트 DTO |
| `apps/api/src/alerts/alerts.module.ts` | 수정 | P2 provider |
| `docs/api/alerts.md` | 수정 | **5.1절 신설** (reset 후 배지가 다른 이유 — PM 확인 답변) |

### 5. 주요 결정과 이유

- **판정을 순수 함수로 뺀 것이 이번 핵심이다.** "mock에서 안 보낸다"를 동작으로 확인하려면 네트워크를 감시해야 하는데, 판정 함수로 빼면 **종류 6 × 심각도 4 × 설정 조합 16 = 384가지를 전수로 돌려** `send`가 0건임을 보일 수 있다. 1단계의 "보낼 수단이 없다"를 대신하는 증거다.
- **`kind: 'test'`는 심각도 하한을 타지 않게** 했다. 사용자가 방금 누른 버튼인데 "심각도가 낮아 안 보냄"이 나오면 설정을 확인할 방법이 없어진다.
- **서킷이 플래핑보다 먼저 이긴다.** 둘 다 참이면 "발송이 멈춰 있다"가 더 중요한 원인이다(플래핑은 그 키만, 서킷은 전체).
- **429를 실패로 세지 않는다.** 서킷 브레이커는 "디스코드가 망가졌다"를 잡는 장치인데, 속도 제한은 정상 동작이라 여기에 섞으면 바쁠 때 발송이 멈춘다.
- **`RecordingDiscordSender`를 만들어 두었다**(지금은 테스트에서 쓰지 않는다). mock 검증에서 "정말 안 불렸다"를 보고 싶을 때 DI 한 줄로 바꿔 끼울 수 있다.
- **컨트롤러 라우트 순서에 주석을 달았다.** 순서 자체가 계약이라는 것을 코드에 남기지 않으면 같은 버그가 다시 난다.

### 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/api` | **통과** |
| `npm test --prefix apps/api` | **590 passed / 2 skipped** (기준선 566 → **+24**: alerts 17, logs 7) |
| `npm run build --prefix apps/api` | **통과** |

**mock 기동 검증** (포트 3131). 매번 `netstat -ano`로 **내가 띄운 PID가 그 포트를 듣는지 확인**하고 그 PID만 종료했다(마지막 5640, 지금 3131 해제됨).

| 확인 | 결과 |
|---|---|
| **라우트 순서** | `GET /alerts/badge` **200**, `/alerts/settings` **200**, `/alerts/test/preview` **200** (P1에서는 셋 다 404였다) |
| `GET /alerts/settings` | `dispatch{mode:mock, modeSource:data_source, outbound:false}`, `rules` 9개, `retention{90, 2000}`, `keys` 8개. 응답 전체에 `/api/webhooks/` **0건** |
| **AC-ALERT21** | `http://`→`NOT_HTTPS`, 디스코드 아님→`HOST_NOT_ALLOWED`, 경로 틀림→`PATH_NOT_WEBHOOK`, URL 아님→`NOT_A_URL` 모두 **400**. **보낸 토큰(`TOKEN_AAA111` 등)과 호스트(`evil.example.com`)가 응답에 0건** |
| **AC-ALERT20** | env 잠금 상태에서 `hint: "…****ZZZ9"`, `length: 70`, `source: "env"`. **원문·전체 URL 0건** |
| **AC-ALERT22** | 잠긴 값 변경 → **409 `SETTING_LOCKED_BY_ENV`**, `details{fields:["webhookUrl"], envVars:["ALERTS_DISCORD_WEBHOOK_URL"]}`, message에 **"왜 못 고치는지"**가 들어 있다. `lockedByEnvDetail`에 `webhookUrl`·`dispatchMode` 2건 |
| DB 없음 | 형식이 맞는 저장 → **503 `DASHBOARD_DB_UNAVAILABLE`** (메모리 값을 바꾸지 않는다) |
| 받지 않는 필드 | `retention` → whitelist가 지워 200(변화 없음), `rules.dedupeWindowMin: 99999` → **400** |
| **AC-ALERT24** | 미리보기 `message`에 `[테스트]`·"실제 장애가 아닙니다"·`[MOCK]` 포함, `canSend: true`, `warning` 문구, **원문 0건** |
| **AC-ALERT23** | `{}`·`{confirm:false}` → **422 `ALERT_TEST_CONFIRMATION_REQUIRED`** |
| **AC-ALERT26** | `{confirm:true}` → 200, `result.state: "skipped_mock"`, label `보내지 않음 (mock)`, 본문 전문 포함. **프로세스 외부 연결 0건** |
| **AC-ALERT25** | 즉시 재호출 → **429 + `Retry-After: 60`** + `details{retryAfterSec:59, nextAvailableAt}` |
| 테스트 이력 | `kind: 'test'` 1건 남고 **배지는 3 그대로**(세지 않는다) |
| 일반 알림 | 모든 알림의 `dispatch`가 `skipped_mock` |
| 단위 테스트 | mock 전수 조합 **384가지에서 `send` 0건**, 허용 안 된 호스트·`http://`에서 **`fetch` 미호출**, 유출된 웹훅 URL이 섞인 오류 문구에서 **토큰·경로 제거 확인** |

**하지 못한 검증(숨기지 않고 적는다)**

- **대시보드 DB를 쓰지 못했다.** 이 환경에 Docker도 Postgres도 없다(`docker` 명령 없음, 5432 리스닝 없음). 따라서 **웹훅 저장 성공 경로·`readWebhookStatus`의 DB 분기·설정 PATCH 성공·`invalidate` 이후 값 반영·`alert_deliveries` upsert를 실제로 돌리지 못했다.** 검증한 것은 형식 오류(400)·env 잠금(409)·DB 없음(503)까지다.
- **실제 디스코드로 보내 보지 못했다**(웹훅 주소가 없고, 있어도 보내면 안 된다). `sent`·`failed`·429·서킷 브레이커의 **실제 HTTP 경로는 단위 테스트와 코드 검토뿐**이다. `webhook-failed`·`webhook-ratelimited` mock 시나리오는 픽스처로 화면 모양만 재현한다.
- 백오프 5/30/120초와 서킷 1시간은 **기다릴 수 없어** 기동으로 확인하지 못했다(순수 함수 테스트로 덮었다).
- `RecordingDiscordSender`를 실제 DI에 끼워 "호출 0회"를 통합 수준에서 재확인하지는 않았다. 판정 전수 테스트 + 외부 연결 0건으로 갈음했다.

### 7. 남은 이슈·한계

- **큐가 메모리 상태 일부를 쓴다**: `consecutiveFailures`·서킷 시각·테스트 쿨다운은 프로세스 메모리다. 재시작하면 서킷이 풀리고 쿨다운이 사라진다. `alert_deliveries`에 남는 것은 시도 기록이다.
- 발송 큐는 **2초 주기 폴링**이다. `minIntervalSec`(기본 2초)와 맞물려 초당 1건 이하로 나간다.
- `discord.queue.nextRetryAt`은 항상 `null`이다(가장 이른 재시도 시각을 아직 집계하지 않는다). `pending` 수는 정확하다.
- `rules.repeatEveryMin`은 여전히 **저장만 되고 동작하지 않는다**(P3). 값이 있으면 `ALERTS_REPEAT_NOT_IMPLEMENTED` notice가 붙는다.
- 다중 인스턴스로 띄우면 발송이 중복된다(큐에 잠금이 없다). 지금 배포는 1 레플리카다.

### 8. 다른 담당 요청

- **DBA 요청 없음.** `secret-settings.ts`의 5개 함수와 `redactSecrets`를 **그대로 썼고 `apps/api/src/database/**`·`prisma/**`를 수정하지 않았다.**
  - 전달: 요청하신 대로 발송 실패 문구가 **전부 `redactSecrets`를 탄다** — `HttpDiscordSender`가 반환 직전에 `safeDetail()`을 거치고, 그 값이 그대로 `alert_deliveries.error_message`·응답 `detail`로 간다. 테스트로 고정했다(유출된 웹훅 URL이 섞인 401 응답에서 토큰·경로가 사라지는 것).
- **frontend 요청**: ① `PATCH /api/alerts/settings` 성공 응답은 **전체 설정**이라 다시 GET할 필요가 없다 ② 저장 성공 즉시 입력칸과 DOM 값을 비운다(서버는 `hint`만 준다) ③ 테스트 발송 쿨다운은 서버의 `Retry-After`/`retryAfterSec`를 쓴다 ④ `lockedByEnv`(필드 이름)와 `lockedByEnvDetail[].envVar`(환경 변수 이름)는 **용도가 다르다** — `SecretInput.lockedByEnv` prop에는 후자를 넣는다.
- **publisher 요청**: `dispatch[].label`을 서버가 준다. `skipped_*` 12종 전부 "제외" 계열 중립 칩으로 그리면 된다.

### 9. 다음 담당이 알아야 할 점

- **밖으로 나가는 문은 `discord-sender.ts` 하나다.** 다른 파일에 `fetch`를 추가하면 mock 보장이 깨진다. 판정은 `dispatch-rules.ts`, 실행은 `alert-dispatcher.service.ts`, 전송은 `discord-sender.ts` — 셋을 섞지 말 것.
- **설정을 쓰는 코드는 반드시 `invalidate`를 부른다.** `AlertSettingsService.patch()`가 `SettingsService.invalidate`를, `AlertsService.patchSettings()`가 이어서 `AlertEngine.invalidateRules()`를 부른다. 새 설정 경로를 만들면 같은 쌍을 지켜야 한다.
- **컨트롤러 라우트 순서를 바꾸지 말 것.** 구체 경로가 `:id` 아래로 내려가면 조용히 404가 된다.
- **`skipped_*`는 오류가 아니다.** 화면에서 빨간색·배너·토스트를 쓰지 않는다(AC-ALERT19).

## 2026-09-25 06:45 · 통합 1차 후속 (알림 로그 링크 · 발송 칩 mock · 계약 11절)

> 주 작업은 logs 쪽이다: `docs/reports/logs/backend.md` 같은 시각 섹션. 여기는 **alerts에 영향이 있는 부분만** 적는다.

### 1. 요청 내용
- PM 결정 D3(알림 `logHref`에 `follow=1`을 붙이지 않는다) 반영 확인
- designer → PM: 계약 11절 "모르는 `DispatchState`는 중립 칩" 정정, mock에서 `skipped_no_pair`·`skipped_circuit_open` 칩을 볼 수 있는 이력 픽스처(발송 경로는 만들지 말 것, 384조합 테스트 유지)

### 2. 참고한 문서
- `docs/reports/alerts/README.md` "PM 결정 — 통합 1차에서 올라온 것", `docs/reports/alerts/designer.md` 01:30 섹션 7·8절, `docs/reports/alerts/frontend.md` 7·8절(R5)
- `docs/api/alerts.md` 2.2.1·5·11절, `docs/api/logs.md` 2.2.1·11.4

### 3. 작업 내용
- **알림 `logHref` — `follow=1`은 붙지 않는다(불변).** 링크 규칙이 `logs/log-href.ts`의 자리별 표로 옮겨졌고 `alert` 자리는 `{ follow: false, at: true }`다.
- **바뀐 것 1 — `at`이 실제로 붙는다.** 계약 2.2.1 예시에는 `at`이 있었는데 **구현이 넘기지 않고 있었다**(`linkFor(ref)`만 불렀다). presenter가 알림의 `occurredAt`을 넘기게 해 계약과 맞췄다: `/logs?namespace=prod&pod=…&at=2026-…Z`. 로그 화면이 `at`을 쓰는 방법은 `logs.md` 2.2.1(새로 정의).
- **바뀐 것 2 — `logTarget.stackSearch`가 스택 상태를 따른다.** 전에는 항상 `false`(L3 전 주석이 남아 있었다). 이제 `GET /api/logs/targets/*`의 `stackSearch.available`과 같은 판단(스택 설정됨 + 연결 실패 아님).
- **바뀐 것 3 — mock `logs=disabled`면 알림 `logHref`도 `null`**(`unavailableReason: 'logs_disabled'`). 전에는 env만 봐서 로그 API는 403인데 알림 링크가 남았다. 값은 공용 `LogLinkPolicy` 하나에서 온다.
- **mock `webhook-failed` 이력**: 최근 2건 `skipped_circuit_open`, 가장 최근 해제 1건 `skipped_no_pair`, 나머지 `failed`. **이력 픽스처만** 바꿨다 — `dispatch-rules.ts`·`alert-dispatcher.service.ts`·`discord-sender.ts`는 손대지 않았다.
- **mock 기본 이력의 최신 `area:pods` 알림 대상**을 클러스터 mock(`mixed`)에 실제로 있는 파드(`api-qfvhtjhs2-wbf44`·`…-xbf44`)로 바꿨다. 전에는 없는 이름이라 mock에서 알림 로그 링크가 늘 "사라진 파드"로 열려 `at` 동선을 확인할 수 없었다. 배지·개수·심각도는 그대로다(배지 3).
- 계약 `alerts.md`: 2.2.1 링크 모양 표(`at` = `occurredAt`, follow 없음), 5절 `webhook-failed` 행, **11절 "모르는 값은 칩 없이 서버 `label`만"**(디자인 12.5와 맞춤), 13절 변경 이력. `common.md` 6.1 `webhook-failed` 행.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/alerts/alert-presenter.ts` | 수정 | `logLink(ref, occurredAt)` |
| `apps/api/src/alerts/alerts.service.ts` | 수정 | 같음 |
| `apps/api/src/logs/log-link.service.ts` | 수정 | `alert` 자리 규칙 + `at`, `stackSearch` 계산, 정책 값 |
| `apps/api/src/alerts/alert-presenter.spec.ts` | 추가 | 2건 — 첫 Pod 대상 + `occurredAt` 전달, Pod 없으면 `not_a_pod` |
| `apps/api/src/alerts/mock/mock-alerts.ts` | 수정 | `webhook-failed` 칩 2종, 최신 파드 알림 대상 이름 |
| `apps/api/src/alerts/mock/mock-alerts.spec.ts` | 추가 | 3건 — 칩 2종 개수·위치, 기본 시나리오는 `skipped_mock` 그대로 |
| `docs/api/alerts.md` | 수정 | 2.2.1·5·11·13절 |

### 5. 주요 결정과 이유
- **`at`을 채운 것은 "변경"이 아니라 계약 이행이다.** D3의 근거("알림 링크는 그 시각을 보러 가는 링크")가 성립하려면 링크에 시각이 있어야 한다. 화면은 아직 `at`을 읽지 않으므로(통합 3차) 지금 화면 동작은 바뀌지 않는다.
- **발송 칩은 판정을 바꾸지 않고 픽스처로만**: mock에서 판정 순서를 바꾸면 "mock에서 나가는 요청 0건" 보장이 흔들린다. 칩은 화면 모양 확인용이므로 이력으로 충분하다.
- 서킷 안내(`ALERTS_DISCORD_CIRCUIT_OPEN`, designer 선택 요청)는 **하지 않았다.** 발송기의 실행 중 상태라 mock에서 켜려면 발송기에 mock 전용 후크가 필요하다 — 발송 경로를 건드리지 말라는 지시와 부딪힌다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 | |
| `npm test --prefix apps/api` | 639 passed / 2 skipped | 발송 판정 **384조합 테스트 그대로 통과**(`dispatch-rules.spec.ts` 무수정) |
| mock 실측(3141) | 알림 `logHref` = `/logs?namespace=prod&pod=api-qfvhtjhs2-wbf44&at=…` (**follow 없음**), 대상 `exists: true` → 2000줄 조회에서 `anchor.state: found` | `logs=disabled` → 알림 링크 0 + `logs_disabled`, `direct`로 돌리면 복구 |
- 실제 디스코드 발송·서킷은 이번에도 확인하지 않았다(월요일 목록 그대로).

### 7. 남은 이슈·한계
- `webhook-failed`의 칩 2종은 **이력**이다. 실시간 판정으로 두 상태가 생기는 것은 `ALERTS_DISPATCH=live`에서만 가능하다(판정 순서상 mock이 먼저 이긴다).
- `ALERTS_DISCORD_CIRCUIT_OPEN` 안내는 mock에서 볼 수 없다(5절).

### 8. 다른 담당 요청
- **frontend**: 알림 `logHref`는 지금처럼 **그대로** 쓴다(파라미터를 덧붙이지 않는다). 3차에서 로그 화면이 `at`을 읽으면(`logs.md` 2.2.1) 알림 → 그 시각 동선이 완성된다. mock `alerts=webhook-failed`에서 칩 2종 확인 가능(publisher `DISPATCH_SPEC` 반영 후).
- **publisher**: 칩 2종은 designer 요청대로(`status.md` 12.5). 서버 `label`은 `제외 (짝 없음)`·`제외 (발송 정지)`이고 확장 영역용이다.

### 9. 다음 담당이 알아야 할 점
- 알림 링크의 `follow`/`at`은 `logs/log-href.ts`의 `alert` 행이 정한다. presenter·서비스에서 파라미터를 붙이지 말 것.
- mock 알림 fixture의 파드 이름은 클러스터 mock 이름과 맞춰야 로그 동선이 끝까지 이어진다(`mock-alerts.ts` 주석).

## 2026-09-25 07:02 · 설정 화면 통합 2차 후속 (`keys[].status` · `lastDispatch` 뜻 · 서킷 재개 시각)

### 1. 요청 내용
PM 결정 "통합 2차에서 올라온 것"(`docs/reports/alerts/README.md`) 중 서버 몫 3건. 추가 전용, `database/**` 무변경, mock 포트 3141.
1. `GET /api/alerts/settings`의 `keys[]`에 현재 상태 `status` (디자인 `settings.md` 6.1 Card 2 `StatusBadge`). 알림 엔진이 이미 하는 판단을 그대로
2. `lastDispatch`의 뜻을 계약에 문장으로: 실제로 나간 시도(`sent`·`failed`)만, 테스트 발송 포함, `skipped_*` 제외 → mock에서 `null`. **live 경로에서 테스트 발송이 이 값을 갱신하는지 코드·테스트로 확인**
3. 서킷 재개 시각을 응답에 (디자인 3.6 `…15:04에 다시 시도합니다.`)

### 2. 참고한 문서
- `docs/reports/alerts/README.md` "PM 결정 — 통합 2차에서 올라온 것" #2~#4
- `docs/design/settings.md` 3.6·6.1, `docs/api/alerts.md` 2.5
- 코드: `alert-engine.service.ts`(키 상태 머신), `alert-dispatcher.service.ts`(서킷·`lastDispatch`), `alert-store.service.ts`(발송 큐)

### 3. 작업 내용
**(1) `keys[].status` · `keys[].statusSince`** (추가 전용)
- 엔진은 15초마다 키 8개를 관측해 `states`(키 → `KeyState.status`·`statusSince`)에 둔다. 알림 판정은 이 값으로 한다. `AlertEngine.keyStatus(key)`로 **그 값을 그대로** 읽어 설정 응답에 싣는다 — 새 기준 없음.
- **이번 실행에서 아직 평가하지 않은 키는 `null`**: 기동 때 DB에서 읽은 상태는 지난 실행의 값이다. 그것을 "현재"로 내보내면 재시작 직후 화면이 옛 상태를 그린다. `observedThisRun` 집합으로 거른다(mock 시나리오 초기화 때도 비운다).

**(2) `lastDispatch` 뜻 확정 + 구현 정리**
- 확인 결과 **테스트 발송(live)은 이미 갱신하고 있었다**(`sendTestNow`의 성공·실패 두 갈래). 테스트로 고정했다.
- 뜻과 어긋나던 곳 2개를 고쳤다: 보통 발송에서 **429**와 **재시도가 남은 실패**를 `state: 'pending'`으로 적고 있었다. PM 결정은 `sent`·`failed`뿐이다 → 그 시도는 배달되지 않았으므로 **`failed`**(디자인 3.6 `· 실패 (429 Too Many Requests)`와도 맞다). 배달 기록(`dispatch[]`)의 `pending`은 그대로다 — 다른 축이다. 타입도 `'sent' | 'failed'`로 좁혔다.
- mock: 발송 판정이 `skipped_mock`에서 멈추고 발송기를 부르지 않으므로 `null`이 유지된다(실측).

**(3) 서킷 재개 시각**
- **이미 응답에 있다**: `discord.circuitBreaker.resumeAt`(계약 예시에도 있었다). P2 보고의 "`nextRetryAt`이 항상 `null`"은 **`discord.queue.nextRetryAt`** 이야기였고, 둘이 섞여 전달됐다. 계약 표에 `resumeAt`의 뜻(디자인의 `10` = `consecutiveFailures`, `15:04` = `resumeAt`)을 문장으로 적었다.
- 그 김에 **`queue.nextRetryAt`을 실제로 계산**한다(항상 `null`이던 결함): 대기 건의 가장 이른 시도 시각, 서킷이 열려 있으면 `resumeAt`보다 이르지 않다. `queue.pending`은 전에는 "지금 보낼 것"만 셌다 → 재시도 예정까지 센다. 새 저장소 읽기 `AlertStore.queueSummary()`(기존 테이블 조회만, 스키마 변경 없음).
- **결함 수정**: 테스트 발송이 성공하면 실패 수만 0으로 돌리고 서킷은 열어 둬서 `open: true, consecutiveFailures: 0`이 될 수 있었다(화면: "연속 실패 0건으로 발송을 멈췄습니다"). 보통 발송 성공과 같이 서킷도 닫는다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/alerts/alert-engine.service.ts` | 수정 | `keyStatus(key)`, `observedThisRun` |
| `apps/api/src/alerts/alerts.service.ts` | 수정 | `keys[].status`·`statusSince`, `queueBlock()`(`queue.pending`·`nextRetryAt`) |
| `apps/api/src/alerts/alert-dispatcher.service.ts` | 수정 | `lastDispatch.state`를 `sent`·`failed`로(429·재시도 실패 → `failed`), 테스트 발송 성공 시 서킷 닫기, 뜻 주석 |
| `apps/api/src/alerts/alert-store.service.ts` | 수정 | `queueSummary()` (읽기 전용) |
| `apps/api/src/alerts/alerts-settings.http.spec.ts` | 추가 | 6건 — 키 상태 = 엔진/개요 값, 초기 `null`, 429 → `failed` + 대기열, 서킷 `resumeAt`·알림 `details.resumeAt`·`queue.nextRetryAt ≥ resumeAt`, **live 테스트 발송 성공·실패가 `lastDispatch` 갱신 + 서킷 닫힘**, mock 테스트 발송은 `skipped_mock` + `null` + 발송기 0회 |
| `apps/api/src/logs/logs.http.spec.ts` | 수정 | 타입 검사 한 곳(`?.text`) — 06:45 작업분, 동작 무관 |
| `docs/api/alerts.md` | 수정 | 2.5 예시·표(`lastDispatch` 뜻, `circuitBreaker`, `queue`, `keys[].status`), 13절 |

`database/**`·`prisma/**` 무변경 → **DBA 요청 없음.**

### 5. 주요 결정과 이유
- **서킷 재개 시각은 새 필드를 만들지 않았다.** `circuitBreaker.resumeAt`이 이미 계약·구현에 있다. 같은 값을 다른 이름으로 하나 더 두면 둘 중 하나만 고쳐지는 날이 온다.
- **429를 `failed`로**: PM 결정("`sent`·`failed`만")과 디자인 문구가 같은 방향이다. 429는 장애는 아니지만 **그 시도가 배달되지 않은 것**은 사실이고, 배달이 대기 중이라는 사실은 알림 항목의 `dispatch[]`(`pending`)와 `queue`가 말한다.
- **첫 평가 전 `null`**: 상태 배지는 "지금"을 말한다. 모르면 모른다고 한다(화면은 `null`을 확인 불가/로딩으로 그리면 된다 — 디자인 판단).
- **테스트 발송 실패는 연속 실패 수에 넣지 않았다**(기존 동작 유지). 사람이 누른 발송이 자동 발송 정지를 일으키면 "테스트를 눌렀더니 알림이 멈췄다"가 된다. 성공은 채널이 살아 있다는 증거라 서킷을 닫는다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 | |
| `npm run build --prefix apps/api` | 통과 | |
| `npm test --prefix apps/api` | **645 passed / 2 skipped** (58 suites) | 639 → +6. 기존 테스트 수정 0건, **384조합 발송 판정 테스트 그대로 통과** |

mock 실측(3141, 내가 띄운 PID 24296·22900만 `Stop-Process -Id`로 종료)
| 확인 | 결과 |
|---|---|
| `keys[].status` | `area:controlPlane=ok nodes=critical workloads=critical pods=critical events=critical db=warning cost=ok source:kube=ok` — `GET /api/overview` 영역 상태와 **전부 같다** |
| mock 테스트 발송 (env 웹훅 있음, 발송 mock) | 200 `skipped_mock` → `lastDispatch: null`, `circuitBreaker.resumeAt: null`, 로그에 `discord.com` 0건 |
| 웹훅 없음 | 테스트 발송 409 `ALERT_WEBHOOK_NOT_CONFIGURED`(기존 동작) |
| `alerts=webhook-ratelimited` | `queue: { pending: 12, nextRetryAt: 지금+2분 }` (전에는 `nextRetryAt: null`) |
- **live 발송 경로(가짜 발송기)**는 단위·HTTP 테스트로만 확인했다. **실제 디스코드로는 보내지 않았다**(월요일 목록 그대로).
- mock에서는 서킷이 열리지 않으므로 3.6의 `연속 실패 … 다시 시도합니다` 줄은 **mock 화면에서 볼 수 없다**(7절).

### 7. 남은 이슈·한계
- **서킷·`lastDispatch`는 메모리 값**이다. API를 재시작하면 서킷이 풀리고 `lastDispatch`는 `null`로 돌아간다(기존 한계, 계약 표에 적음). 남기려면 DB 저장이 필요하다 — 지금은 요청하지 않는다.
- mock에서 서킷 안내(3.6 두 번째 줄)를 눈으로 볼 방법이 없다. 보이게 하려면 발송기에 mock 전용 "서킷 열린 척" 값을 넣어야 하는데, 발송 경로를 건드리지 말라는 앞선 지시와 부딪혀 하지 않았다. **필요하면 PM 판단** — 넣는다면 `alerts=webhook-failed` 시나리오에서 `circuitBreaker`만 표시용으로 채우고 판정·발송기는 그대로 두는 방식이 된다.
- `keys[].status`는 설정 화면 조회 1회 값이다(설정 화면은 SSE에 의존하지 않는다, 디자인 6.3). 실시간 갱신이 필요하면 화면이 다시 조회한다.

### 8. 다른 담당 요청
- **frontend**: Card 2는 `keys[].status`로 `StatusBadge`를 그린다(`null`이면 확인 불가/로딩 모양 — 디자인 판단). 3.6 두 번째 줄은 `discord.circuitBreaker.open`일 때 `consecutiveFailures`·`resumeAt`으로 그린다. `lastDispatch.state`는 이제 `sent`·`failed` 둘뿐이다.
- **designer 확인**: `keys[].status`가 `null`(기동 직후 첫 15초)일 때의 배지 모양.
- **DBA 요청 없음.**

### 9. 다음 담당이 알아야 할 점
- `lastDispatch`를 쓰는 곳은 **실제로 `sender.send()`를 부른 뒤**뿐이다. `skipped_*`를 적는 경로에서 `lastDispatch`를 건드리지 말 것(PM 결정).
- 키 상태를 설정 화면용으로 따로 계산하지 말 것 — `AlertEngine.keyStatus()`가 판정에 쓰는 값이다.
- 서킷 재개 시각의 정본은 `circuitBreaker.resumeAt` 하나다. `queue.nextRetryAt`은 그것을 하한으로 쓴다.

### 추가 (07:15) · mock `webhook-failed` 표시 전용 서킷 (PM 결정)

**요청**: 디자인 3.6 둘째 줄을 mock에서 보이게 하는 **표시 전용 값** 허용. 조건 — `alerts=webhook-failed`일 때만, **응답을 만드는 층**에서만 덮어쓰고, dispatcher·큐·판정·전송은 한 줄도 건드리지 않는다. 실제 상태에 섞이지 않음을 테스트로 고정. 계약 mock 절에 "표시 전용, 실제 발송 상태와 무관".

**작업**
- `AlertsService.circuitForDisplay()`: 설정 응답의 `discord.circuitBreaker`(+ 같은 값을 쓰는 `ALERTS_DISCORD_CIRCUIT_OPEN` 안내·`queue.nextRetryAt` 하한)만 `{ open: true, consecutiveFailures: 10, openedAt: 시나리오 전환 2분 전, resumeAt: 전환 + 58분 }`으로 덮는다. 1시간 넘게 켜 두면 재개 시각을 다시 잡는다(표시가 "열림인데 재개 시각은 지남"으로 모순되지 않게).
- 켜고 끄는 것은 mock 시나리오 쪽(`AlertsMockScenarioTarget.setScenario`)이 `AlertsService.setMockCircuitDisplay(scenario === 'webhook-failed')`로 한다.
- **덮지 않는 경우**: live(`DATA_SOURCE=live`), 그리고 `DATA_SOURCE=mock` + **`ALERTS_DISPATCH=live`**(발송이 실제로 나갈 수 있는 조합 — 진짜 서킷이 있으므로 표시 값이 그것을 가리면 안 된다).
- `alert-dispatcher.service.ts`·`dispatch-rules.ts`·`discord-sender.ts`·큐(`alert-store.service.ts`) **이번 추가에서 무변경**. 판정은 계속 `dispatcher.circuit`(실제 값)을 본다. `dispatch-rules.ts`·`discord-sender.ts`는 git 기준으로도 변경 없음.
- 계약: `alerts.md` 5절 `webhook-failed` 행에 "**표시 전용이며 실제 발송 상태와 무관**" 문단, 2.5 `circuitBreaker` 행·13절, `common.md` 6.1 행.

**변경 파일**
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/alerts/alerts.service.ts` | 수정 | `mockCircuitDisplay`, `setMockCircuitDisplay()`, `circuitForDisplay()` — 설정 응답에서만 사용 |
| `apps/api/src/alerts/alerts.extensions.ts` | 수정 | 시나리오 전환 때 표시 값 켜기/끄기 한 줄 |
| `apps/api/src/alerts/alerts-settings.http.spec.ts` | 수정 | +2건 (아래) |
| `docs/api/alerts.md`, `docs/api/common.md` | 수정 | 표시 전용 명시 |

**검증**
| 명령 | 결과 |
|---|---|
| lint / build | 통과 |
| `npm test --prefix apps/api` | **647 passed / 2 skipped** (+2). 384조합 발송 판정 테스트 그대로 통과 |
- 새 테스트: ① `webhook-failed`에서 설정 응답은 열림·10건·약 1시간 뒤 + 안내 `details.resumeAt` 일치, **그때 `dispatcher.circuit`은 `open: false`·실패 0·`resumeAt: null`**, `drain()`을 불러도 발송기 호출 0회·`lastDispatch: null`, `default`로 돌리면 표시가 사라진다 ② `ALERTS_DISPATCH=live` 조합에서는 덮지 않는다.
- mock 실측(3141, 내가 띄운 PID 23980만 종료): `default` 닫힘 → `webhook-failed` `{"open":true,"consecutiveFailures":10,"resumeAt": 지금+58분}` + 안내 → `default` 닫힘. 같은 시나리오 목록의 발송 칩 `skipped_circuit_open`·`failed`·`skipped_no_pair`, `lastDispatch: null`, `queue` 0.

**다음 담당이 알아야 할 점**
- 이 값을 판정·발송 쪽에서 읽게 만들지 말 것. 설정 응답 전용이다(`circuitForDisplay()` 한 곳).
- mock `webhook-failed`에서 서킷 안내가 보이는 것은 **정상**이다(계약 5절).

## 2026-09-25 08:33 · PM 검증 후속 — AC-ALERT33 `skipped_restart` 테스트

### 1. 요청 내용
PM 검증: 코드는 있는데 테스트가 없는 경로. **동작을 바꾸지 말고 테스트만** 추가, 결함이 드러나면 고치고 적는다.
- 시작 시 `pending`이던 기록이 `skipped_restart`가 된다 / 다시 보내지 않는다(발송기 0회) / DB 경로는 PGlite 또는 저장소 대역

### 2. 참고한 문서
- `apps/api/src/alerts/alert-store.service.ts` `markPendingAsRestart`, `alert-dispatcher.service.ts` `onApplicationBootstrap`, `docs/api/alerts.md` 3.1

### 3. 작업 내용
- `alert-restart.spec.ts` **3건**
  1. **메모리 경로**: live `pending` → `skipped_restart`(+ `nextRetryAt: null`), 발송 큐(`dueDeliveries`)에서 빠진다, **mock 이력은 건드리지 않는다**
  2. **DB 경로(저장소 대역)**: Prisma `alertDelivery.updateMany`·`findMany`만 흉내 내는 작은 표로 확인 — 정리 질의가 `{ status: 'pending', alert: { dataSource } }` → `{ status: 'skipped_restart', nextAttemptAt: null }`이고, `sent` 행·다른 dataSource 행은 그대로, **발송 큐 질의가 정리된 행을 다시 집지 않는다**
  3. **dispatcher 시작 훅**: 실제 `AlertDispatcher`(발송기만 세는 대역)로 시작 → 남아 있던 대기분이 `skipped_restart` → 큐를 돌려도 **발송기 0회**. 대조군으로 시작 뒤에 생긴 `pending`은 1회 보내 `sent`가 된다(= 0회가 정리 덕분임을 보인다)
- PGlite는 저장소에 설치돼 있지 않다(DBA는 별도 스크립트로 썼다). 의존성을 늘리지 않으려고 **저장소 대역**을 택했다. 실제 Postgres에서 `updateMany` 질의는 이번에도 돌려 보지 않았다(월요일 실DB 목록과 같이 확인하면 된다).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/alerts/alert-restart.spec.ts` | 추가 | 3건 |

### 5. 주요 결정과 이유
- 대조군을 넣었다: "0회"만 보면 큐가 원래 아무것도 안 보내는 상태여도 통과한다. 같은 dispatcher가 새 `pending`은 보내는 것까지 보여야 정리가 효과가 있다는 증명이 된다.

### 6. 검증 결과
| 명령 | 결과 |
|---|---|
| `npm run lint --prefix apps/api` / build | 통과 |
| `npm test --prefix apps/api` | **658 passed / 2 skipped** (61 suites, 이번 작업 전체 +10 — alerts 3, logs 7) |
- 서버를 띄우지 않았다(띄운 PID 없음).

### 7. 남은 이슈·한계
- **결함 없음.** 코드 변경 0줄.
- DB 경로는 대역이다. 실제 Postgres·PGlite에서의 `updateMany` 동작은 미실측.

### 8. 다른 담당 요청
- 없음(DBA 요청 없음 — `database/**` 변경 불필요).

### 9. 다음 담당이 알아야 할 점
- `markPendingAsRestart`는 dispatcher 시작 훅에서 **fire-and-forget**으로 돈다. 큐 타이머(2초)보다 먼저 끝난다는 가정이다 — 메모리·DB 모두 한 번의 질의라 실제로는 먼저 끝나지만, 순서를 바꾸는 변경을 할 때는 이 테스트가 잡는다.
