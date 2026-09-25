# alerts · DBA 작업 보고

> 파일 위치: `docs/reports/alerts/dba.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 21:30 · alerts 스키마 설계 (알림 이력·발송 기록·상태 머신·설정)

### 1. 요청 내용

PM이 넘긴 범위 세 가지.

1. **알림 이력 테이블 설계** — 명세 3.7 A~D를 담는 스키마. 특히
   - 보관 한도 **90일 / 2,000건**(PM 결정 Q12), **지우는 동안 화면이 멎으면 안 된다**
   - **안 읽은 개수 질의가 화면을 열 때마다 돈다** → 2,000건에서도 빨라야 한다 (인덱스를 그 기준으로)
   - 억제·플래핑 판정에 쓰는 **"직전 상태"와 "최근 N분 이력"** 조회가 효율적이어야 한다
   - 알림 본문에 리소스 이름이 원문으로 들어가 **AWS 인스턴스 ID가 DB에 남는다** → 문제인지 판단하고 근거를 남길 것
   - **로그 본문은 절대 저장하지 않는다**
2. **설정 저장(디스코드 웹훅 URL)** — 별도 key 여부 확인, **PM 결정은 평문 저장**(틀렸다고 보면 근거와 함께 보고), **원문을 API로 다시 내보내지 않는 것을 저장 계층에서 어떻게 보장할지**, `.env` 우선과 DB 값의 관계
3. **logs 기획이 넘긴 확인 요청** — 모니터링 대상 Postgres의 `log_statement` 설정 확인. 쿼리 원문이 파드 로그에 찍히면 `cluster-status` 가정 A7과 충돌한다. **확인·판단만 하고 모니터링 계정·상태 조회 쿼리·`docs/db/health.md`는 손대지 말 것**

제약: 내 영역은 `apps/api/src/database/**`, `apps/api/prisma/**`, `docs/db/**`. 기존 테이블 데이터 보존. 마이그레이션 실제 동작 검증(실제 Postgres 없음 → PGlite). 포트 3111, 내가 띄운 PID만 종료.

### 2. 참고한 문서

- `docs/specs/alerts.md` — 특히 **3.7**(저장할 것 A~E), 3.1(알림 키 8개), 3.2(전이·억제·플래핑·워밍업·출처 억제), 3.3.2(디스코드·절대 넣지 않는 것), 3.4.3(웹훅 URL 비밀값 취급), 3.6(mock), 4절(갱신 주기), 5절 AC-ALERT01~34, 7절 "DBA"
- `docs/reports/alerts/README.md` — **PM·사용자 결정 Q1~Q12** (Q3 원문 이름, Q4 평문 저장, Q5 기준값, Q9 디스코드 도메인만, Q12 90일/2,000건)
- `docs/reports/logs/README.md`, `docs/specs/logs.md` 3.3.1~3.3.4·7절·9절 — 가림 원칙 7개, 가림 규칙 10종, `log_statement` 확인 요청
- `docs/specs/cluster-status.md` 가정 A7, `docs/api/common.md`(1.4 `redactSecrets`, 2.1~2.3 `StatusInfo`·`SourceStatus`)
- 현재 스키마: `apps/api/prisma/schema.prisma`, `docs/db/schema.md`, `apps/api/src/database/{retention,settings-defaults}.ts`, `apps/api/src/common/settings.service.ts`
- 기존 마이그레이션 3건 + `20260924120000_control_plane_cost_column`(데이터 보존 방식의 선례), `docs/reports/kops-support/dba.md`(PGlite 검증 방법)
- `docs/db/monitor-account.sql`, `docs/db/health.md` 6·7절 — **읽기만 했고 수정하지 않았다**

### 3. 작업 내용

**(1) 테이블 4개 + enum 5개 추가** (`schema.prisma` → 마이그레이션 `20260924180000_alerts`)

| 표 | 무엇 | 명세 |
|---|---|---|
| `alerts` | 알림 1건 (키·심각도·전이·사유·영향 객체·시각·반복·플래핑·확인 여부·`data_source`) | 3.7 A |
| `alert_deliveries` | 채널별 발송 기록 (알림×채널당 1행, 재시도는 `attempts`) | 3.7 B |
| `alert_key_states` | 키별 상태 머신 (직전 상태·억제 창·최근 전이 목록·플래핑·unknown 지속·마지막 영향 객체) | 3.7 C |
| `dashboard_heartbeats` | 단일 행 heartbeat (정지 구간 계산) | 3.7 D |

- **본문 문자열 칸을 만들지 않았다.** 알림 문장은 `severity + kind + reason_text + targets + 시각`으로 **표시할 때 조립**한다. 자유 텍스트 칸이 없으니 로그 줄·쿼리 원문이 들어올 **자리 자체가 없다**(logs PM 결정: 알림에 로그 줄 금지). `context jsonb`도 "구조화된 값만"으로 못 박았다(정지 구간·전이 타임라인·집계 숫자).
- `closed_at`을 **진행 중 판정의 유일한 기준**으로 삼았다. 종결형(`resolve`/`restart_summary`/`test`)은 만들 때 `closed_at = occurred_at`을 채운다. 보관 정리가 "미해제는 지우지 않는다"를 `closed_at IS NOT NULL` **한 조건**으로 표현할 수 있게 하려는 것이다(조건이 복잡할수록 실수로 살아 있는 알림을 지운다).
- 해제·격상 연결은 `parent_alert_id` 자기 참조 FK + **ON DELETE SET NULL**. 부모가 보관 정리로 사라져도 해제 알림 **행은 남고 연결만 끊긴다**.

**(2) 배지 질의 전용 인덱스** `alerts (data_source, acknowledged_at, severity)`

- `acknowledged_at IS NULL` 구간만 훑으므로 이력이 2,000건이어도 **스캔 대상은 안 읽은 몇 건**이다. `severity`가 3번째 열이라 힙을 안 읽고 **Index Only Scan**으로 최악 심각도까지 구한다.
- PGlite에 2,000건(미확인 5건)을 넣고 `EXPLAIN ANALYZE`로 확인: `Index Only Scan using alerts_data_source_acknowledged_at_severity_idx … rows=4`.
- 부분 인덱스(`WHERE acknowledged_at IS NULL`)가 이론상 더 작지만 **쓰지 않았다** — Prisma 스키마로 표현할 수 없어 raw SQL로 만들어야 하고 그러면 `migrate diff`가 매번 드리프트를 낸다.

**(3) "직전 상태 + 최근 N분"을 한 행에** (`alert_key_states`)

- 직전 상태·억제 창·플래핑 카운터·마지막 영향 객체가 전부 **키당 1행**에 있다. 15초 루프는 PK 조회 1번으로 다 읽는다.
- 최근 전이는 `recent_transitions jsonb`(= `[{at, from, to}]`, 창 밖은 쓸 때 잘라냄, 상한 50). **`alerts`를 전이 로그로 쓸 수 없다** — 억제 창에 합쳐진 전이는 알림 행을 만들지 않기 때문이다. 별도 `alert_transitions` 표를 두는 대안은 15초마다 INSERT(하루 5,760행 × 키 8개)가 생겨 버렸다.
- **15초마다 쓰지 않는다.** 값이 실제로 바뀐 키만 upsert하도록 문서에 못 박았고, 그래도 잦은 갱신이라 `fillfactor = 85`를 걸었다.
- 진행 중 알림은 `open_alert_id`로 들고 있어 해제·격상 때 `alerts` 검색이 필요 없다.

**(4) 보관 정리** `purgeAlerts()` (`retention.ts`, `purgeExpiredData`에서도 호출)

- 90일(`retention.alertDays`) 또는 **data_source별** 2,000건(`alertMaxRows`) 중 먼저 닿는 쪽. mock 알림이 live 이력을 밀어내지 않게 건수는 모드별로 센다.
- **진행 중 알림은 어느 기준으로도 안 지운다.** 조건을 `closed_at IS NOT NULL OR kind NOT IN (transition, escalation, flapping)`으로 둬서, backend가 종결형에 `closed_at`을 빠뜨려도 이력이 무한정 쌓이지 않게 했다.
- **화면이 멎지 않는 근거**: Postgres는 MVCC라 `DELETE`의 행 잠금이 `SELECT`를 막지 않는다. 그래서 **`TRUNCATE`·`VACUUM FULL`을 쓰지 않는다**(둘 다 `ACCESS EXCLUSIVE`라 읽기까지 막는다). 그 위에 `alertPurgeBatchSize`(기본 500)행씩 나눠 지우고 **트랜잭션으로 묶지 않으며**, 한 호출에서 200배치까지만 돌고 남은 것은 다음 주기로 넘긴다.
- `alert_deliveries`는 FK CASCADE로 함께 사라지고, `parent_alert_id`·`open_alert_id`는 SET NULL. 둘 다 **인덱스를 만들어** 삭제 때 전체 스캔이 일어나지 않게 했다.

**(5) 설정** (`settings-defaults.ts`)

- 새 key 2개: `alerts`(억제 15분·플래핑 30분·4회·워밍업 120초·unknown 5분·출처 억제 3분·heartbeat 60초·메모리 폴백 200 — PM 결정 Q5), `alerts.discord`(켜기·심각도 하한 `critical`·`sendUnknown`·속도 상한·백오프·테스트 쿨다운·허용 호스트).
- `retention`에 `alertDays: 90`, `alertMaxRows: 2000`, `alertPurgeBatchSize: 500` 추가. 기존 행은 `mergeSetting`이 빠진 필드를 코드 기본값으로 채우므로 **데이터 마이그레이션이 필요 없다**(시드가 `ON CONFLICT DO NOTHING`이라 값도 안 덮인다).

**(6) 웹훅 URL 저장 계층** (새 파일 `secret-settings.ts` + 테스트)

기획자의 "별도 key" 권고를 **그대로 채택**했다(`alerts.discord.webhookUrl`). 그 위에 저장 계층 보장 6가지를 넣었다 — 자세한 표는 `docs/db/schema.md` 2.12.

- **타입으로 막았다**: 이 key를 `SETTING_DEFAULTS`에 **일부러 넣지 않았다.** 그래서 `SettingsService.get('alerts.discord.webhookUrl')`은 **컴파일되지 않는다**. `SettingsService`는 값을 60초 메모리 캐시에 넣고 누구나 `peek()`으로 꺼낼 수 있으므로, 비밀값이 그 캐시에 들어가지 못하게 하는 것이 핵심이었다.
- **원문을 반환하는 함수는 `loadWebhookUrlForDispatch()` 하나**(발송기 전용, 경고 주석). 화면·API는 `readWebhookStatus()` → `{configured, hint: "…****7f3a", length, source, lockedByEnv, updatedAt}`만 받는다.
- `listPublicSettings()`가 설정 목록에서 비밀 key를 거른다(where + 반환 직전 한 번 더).
- `checkWebhookUrl()`: https + `discord.com`/`discordapp.com` + `/api/webhooks/<숫자>/<토큰>` + 500자. 실패 시 `InvalidWebhookUrlError(code)` — **오류에 입력값을 담지 않는다**(AC-ALERT21). `discord.com.evil.io` 같은 호스트도 막는 것을 테스트로 확인.
- `ALERTS_DISCORD_WEBHOOK_URL`이 있으면 DB를 **읽지 않고**, 저장·삭제는 `SettingLockedByEnvError`(→ 409 `SETTING_LOCKED_BY_ENV`)로 막는다.
- `DISCORD_WEBHOOK_URL_PATTERN` / `redactDiscordWebhookUrls()`를 내보내 backend가 공용 `redactSecrets`에 얹을 수 있게 했다.
- 저장 모양은 `{"url": …|null}` **객체**다. 나중에 `{"url": "enc:v1:…"}`로 암호화 전환할 때 **스키마·마이그레이션이 필요 없다.**

**(7) jsonb 모양 타입** `alerts-json.ts` — `AlertTargetJson`, `AlertTransitionJson`, `AlertContextJson`(restart/flapping/unknown), 알림 키 상수, `alertTargetRef()`. advisor-json.ts와 같은 규칙(DB는 모양을 강제하지 않고 api가 검증).

**(8) 문서** `docs/db/schema.md`에 2.8~2.13(표 4개 + 비밀값 설정 + 조회 패턴 요약), 3절 보관 정책 + "화면이 멎지 않게", 4절 인덱스 + 배지 질의 근거, 5절 마이그레이션·검증 기록을 추가했다.

**(9) logs 확인 요청** → 7절·8절에 결과와 판단을 적었다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 수정 | enum 5개 + 모델 4개 추가, `Setting`에 비밀값 key 경고 주석 |
| `apps/api/prisma/migrations/20260924180000_alerts/migration.sql` | 추가 | 표·enum·인덱스·FK 생성 + `fillfactor`. **기존 표·행을 읽지도 쓰지도 않는다** |
| `docs/db/migrations/20260924180000_alerts.down.sql` | 추가 | 되돌리기(새 표·enum·마이그레이션 기록만 삭제. `data_source_mode`·`settings`·웹훅 값 유지) |
| `apps/api/src/database/settings-defaults.ts` | 수정 | `alerts`·`alerts.discord` key, `retention`에 알림 3필드, `SECRET_SETTING_KEYS`·`isSecretSettingKey()` |
| `apps/api/src/database/secret-settings.ts` | 추가 | 웹훅 URL 전용 접근 계층(상태 조회·발송용 로드·저장·삭제·검증·가림·목록 필터) |
| `apps/api/src/database/secret-settings.spec.ts` | 추가 | 단위 테스트 15건 (원문 미노출·env 잠금·형식 거부·목록 제외) |
| `apps/api/src/database/alerts-json.ts` | 추가 | jsonb 모양 TS 타입 + 알림 키 상수 |
| `apps/api/src/database/retention.ts` | 수정 | `alertBefore` 컷오프, `PurgeResult.alerts`, `purgeAlerts()` (배치·미해제 보존·모드별 건수) |
| `apps/api/src/database/retention.spec.ts` | 수정 | 기본값 검증 + `DB_IT_URL` 통합 테스트에 알림 정리 시나리오 추가 |
| `docs/db/schema.md` | 수정 | 2.8~2.13, 3절 보관 정책, 4절 인덱스·배지 질의 근거, 5절 마이그레이션·검증 기록, 머리말 근거 명세 |
| `docs/reports/alerts/dba.md` | 추가 | 이 보고서 |

**건드리지 않은 것**: `docs/db/health.md`, `docs/db/monitor-account.sql`, `apps/api/src/database/health/**`(읽기만), `src/alerts/**`·`src/config/**` 등 backend 영역, 기존 표의 열·행.

### 5. 주요 결정과 이유

**A. 알림 본문을 저장하지 않는다 (구성요소만 저장).**
대안은 완성된 문자열을 `body text`에 넣는 것. 그러면 ① 문구를 고칠 때 과거 이력이 옛 문구로 남고 ② **자유 텍스트 칸이 생겨 로그 줄·쿼리 원문이 언젠가 들어온다.** logs 기획이 "알림에 로그 줄을 넣지 않는다"를 PM 결정으로 올린 이상, **넣을 칸을 아예 만들지 않는 것**이 가장 확실한 보장이라고 판단했다. mock의 "보낼 본문 전문 보기"도 조립해서 보여주면 된다.

**B. `closed_at`을 진행 중 판정의 단일 기준으로.**
대안 ① `resolved_at IS NULL`만 쓰기 → 격상으로 대체된 알림·테스트 알림이 영원히 "진행 중"이 되어 보관 정리가 못 지운다. 대안 ② `is_open boolean` → `resolved_at`과 어긋날 수 있다. 채택안은 `resolved_at`(표시용 "지속 N분")과 `closed_at`(수명)을 **역할로 분리**하고, 정리 조건을 한 줄로 만든다. 보관 정리에서 가장 위험한 실수는 "살아 있는 알림을 지우는 것"이라 조건이 단순한 쪽을 골랐다.

**C. 전이 이력을 별도 표로 두지 않는다.**
억제 창에 합쳐진 전이는 `alerts` 행을 만들지 않으므로 `alerts`는 전이 로그가 아니다. 그렇다고 `alert_transitions` 표를 두면 15초 루프에서 INSERT가 계속 생기고 판정마다 범위 조회가 붙는다. 플래핑 판정에 필요한 건 **창 길이만큼의 목록**뿐이라 상태 머신 행 안의 jsonb 배열이 더 싸고 단순하다(조회 0회).

**D. 배지 인덱스를 부분 인덱스로 만들지 않는다.**
Prisma로 표현할 수 없어 raw SQL이 필요하고, 그러면 `migrate diff`가 매번 "인덱스를 지우라"는 드리프트를 낸다. 드리프트가 상시로 뜨는 저장소는 **진짜 드리프트를 놓치게 만든다.** 일반 복합 인덱스로도 `IS NULL` 탐색 + Index Only Scan이 되는 것을 실측으로 확인했다.

**E. 건수 상한은 `data_source`별로.**
mock `burst` 시나리오는 3초에 1건이다. 전역 2,000건이면 mock 데모 한 번에 live 이력이 통째로 밀려난다.

**F. heartbeat는 `settings`가 아니라 전용 표에.**
`settings`는 사람이 바꾸는 값이고 부팅 때 읽어 캐시한다. 60초마다 바뀌는 런타임 값이 섞이면 설정 화면·캐시·시드의 의미가 흐려진다. 전용 표라야 `fillfactor`도 걸 수 있다.

**G. 웹훅 URL 평문 저장 — PM 판단을 유지한다. 다만 "보호 수준이 같다"는 한 지점에서 성립하지 않는다.**
PM 근거는 "암호화해도 키를 `.env`에 둬야 해 보호 수준이 같다"인데, **DB 덤프 시나리오에서는 같지 않다.** `.env`는 호스트에 남지만 `pg_dump`·볼륨 스냅샷·지원용 덤프는 밖으로 나가기 쉽고, 키가 `.env`에만 있으면 덤프 속 암호문은 쓸모가 없다. 그럼에도 **평문을 유지하자고 본다.** 이유: ① 이 값은 **즉시 폐기 가능**하다(디스코드에서 웹훅 삭제 = 완전 무효화, 클러스터·AWS에 영향 0) ② 유출 피해가 "그 채널에 글을 쓸 수 있다"로 한정되고 **읽기 권한을 주지 않는다** ③ 암호화는 키 보관·회전·복호화 실패라는 새 실패 모드를 들여온다. 대신 두 가지를 넣었다: **한계를 문서에 명시**(schema.md 2.12, 설정 행 description)하고, **`.env` 경로를 1급으로**(env 우선 + 잠금) 뒀다. 덤프를 외부에 공유하는 운영이라면 `.env`만 쓰고 DB 행을 비우면 된다. 되돌리기도 쉽다 — 저장 모양이 `{url}` 객체라 `enc:v1:` 접두어를 붙이는 것만으로 **마이그레이션 없이** 암호화로 갈 수 있다.

**H. 원문 미노출을 "조심"이 아니라 "타입"으로 보장.**
`SETTING_DEFAULTS`에서 key를 빼서 일반 설정 읽기 경로가 **컴파일 단계에서 막히게** 했다. 규칙 문서 + 코드 리뷰만으로는 언젠가 `findMany()` 한 줄이 응답에 실린다.

**I. `ui` 채널 발송 행은 선택으로.**
화면 알림 센터는 끌 수 없고 항상 도달하므로 행을 만들어도 정보가 늘지 않고 행 수만 2배가 된다. enum 값은 계약대로 두되 **discord 행만 만드는 것을 권장**으로 적었다(backend 판단).

**J. AWS 인스턴스 ID가 DB에 남는 것 — 문제 없다.** (근거는 `docs/db/schema.md` 2.8에 그대로 적었다)
① 인스턴스 ID는 **식별자이지 자격 증명이 아니다**(알아도 AWS를 부르려면 자격 증명이 따로 필요). ② **이미 같은 값이 이 DB에 있다** — `cost_rate_samples.resources[].key`가 EC2 인스턴스 키를 담는다. 이번 결정이 **새로운 종류의 노출을 만들지 않는다.** ③ 대시보드 DB는 관측 대상과 **같은 신뢰 경계** 안이다(이 DB를 읽는 사람은 이미 클러스터를 다 본다). ④ 진짜 위험은 **밖으로 나가는 경로**다 — 디스코드 채널(PM 결정 Q3으로 수용 + 설정 화면 안내), 어드바이저 스냅샷(가명 규칙 — **알림 이력을 스냅샷에 넣지 말 것**, 8절 요청 3), DB 덤프. ⑤ 90일/2,000건 한도가 자동으로 지우므로 영구 누적이 아니다.

### 6. 검증 결과

로컬에 **Docker·psql이 없어**(`docker`·`psql` 모두 PATH에 없음) **PGlite(Postgres 17.5 엔진) + pglite-socket**으로 검증했다. 기존 마이그레이션 검증과 같은 방식이고 포트는 지시대로 **3111**만 썼다. 검증 스크립트는 자기 프로세스 안에서 소켓 서버를 띄웠다 닫고 끝나므로 **남는 PID·서버가 없다**(이미지 이름 일괄 종료 없음, 3000·3001·3121 미사용).

시나리오: ① 새 마이그레이션을 잠시 빼고 "알림 도입 이전 DB"를 만든다(기존 3종 deploy + 시드 + `cost_rate_samples` 2행 + `advisor_runs` 1건 + 운영자가 손으로 바꾼 `retention.advisorRunMaxCount=77`) → ② 새 마이그레이션 deploy → ③ 보존·생성 확인 → ④ 드리프트·시드 → ⑤ 제약·FK → ⑥ 2,000건 질의 계획 → ⑦ heartbeat → ⑧ 보존 정리 통합 테스트 → ⑨ down → ⑩ 재적용.

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `prisma format` / `validate` / `generate` | 성공 | 클라이언트 재생성 |
| `prisma migrate deploy` (새 마이그레이션) | 성공 | 5 migrations applied |
| 기존 `cost_rate_samples` 행·합계 보존 | **통과** | 2행 → 2행, 합계 3.1 동일 |
| 기존 `advisor_runs` 보존 | **통과** | 1건 |
| 기존 `settings` 값 그대로(운영자 수정 포함) | **통과** | `advisorRunMaxCount=77` 유지, 전체 JSON 동일 |
| 새 표 4개 / enum 5개 생성 | **통과** | |
| `fillfactor` 적용 | **통과** | `dashboard_heartbeats=70`, `alert_key_states=85` |
| `migrate diff --from-config-datasource --to-schema` | **드리프트 없음** | `-- This is an empty migration.` (fillfactor는 diff에 안 잡힌다) |
| 시드 재실행: 새 key만 추가 | **통과** | `alerts`, `alerts.discord` 추가. `retention` 77 유지 |
| 시드가 비밀값 key를 만들지 않는다 | **통과** | `alerts.discord.webhookUrl` 행 0개 |
| 발송 기록 UNIQUE(alert_id, channel) | **통과** | 두 번째 삽입 거부 |
| 상태 머신 PK(data_source, alert_key) | **통과** | 두 번째 삽입 거부 |
| 부모 알림 삭제 → 해제 알림 행 유지·연결만 NULL | **통과** | ON DELETE SET NULL |
| 부모 알림 삭제 → 발송 기록 CASCADE 삭제 | **통과** | |
| 부모 알림 삭제 → 상태 머신 `open_alert_id` SET NULL(행 유지) | **통과** | |
| **2,000건에서 배지 질의** | **통과** | `Index Only Scan using alerts_data_source_acknowledged_at_severity_idx … rows=4`, Seq Scan 없음 |
| 배지 집계 값 | **통과** | 미확인 5건 중 해제 1건 제외 = 4 |
| 최근 N건 목록 / 키별 최근 30분 | **통과** | 각각 `…occurred_at_idx`, `…alert_key_occurred_at_idx` Index Scan |
| heartbeat 단일 행 upsert 3회 | **통과** | 1행 유지 |
| `purgeAlerts` 통합 테스트(`DB_IT_URL`) | **통과** | 3 passed — 90일·건수·미해제 보존·CASCADE 확인 |
| down SQL: 표·enum·마이그레이션 기록 삭제 | **통과** | |
| down SQL: `data_source_mode`·`settings`·기존 데이터 유지 | **통과** | `alerts` 설정 행·`retention` 77 그대로 |
| 재적용 후 드리프트 없음 / `migrate status` | **통과** | `Database schema is up to date!` |
| `npx tsc -p tsconfig.json --noEmit` (apps/api) | 성공(에러 0) | |
| `eslint src/database` | 통과 | |
| `jest` (apps/api 전체) | **45 suites / 484 passed, 2 skipped** | 새 `secret-settings.spec.ts` 15건 포함 |

검증 자동화 스크립트는 세션 스크래치패드(`…/scratchpad/verify-alerts-migration.cjs`)에 있고 저장소에는 넣지 않았다. **29개 확인 전부 통과(29/29).**

**하지 않은 검증 (그대로 적는다)**

- **실제 Postgres 16(docker compose `db`)에서 실행하지 못했다.** 이 PC에 Docker·psql이 없다. 쓴 문법(`CREATE TYPE … AS ENUM`, `TIMESTAMPTZ(3)`, `TEXT[]`, `JSONB DEFAULT`, `BIGSERIAL`, `ALTER TABLE … SET (fillfactor=…)`, 자기 참조 FK)은 전부 Postgres 9.x~12 이전부터 있는 기능이라 16에서 문제될 것이 없지만, **실기 확인은 backend/PM이 `npm run db:migrate --prefix apps/api` 한 번으로 해 주기 바란다**(8절 요청 6).
- **동시성 검증을 못 했다.** PGlite 소켓은 한 번에 한 연결만 받는다. "보관 정리가 도는 동안 배지 질의가 막히지 않는다"는 **MVCC 성질에 근거한 설계 주장**이고 실측이 아니다(잠금을 늘리는 `TRUNCATE`·`VACUUM FULL`을 쓰지 않은 것까지가 내가 보장한 범위다).
- **대용량 실측을 안 했다.** 2,000건까지만 넣었다(명세 상한). `burst` 시나리오로 수만 건이 쌓였을 때의 정리 소요는 재지 않았다.
- **모니터링 대상 Postgres의 실제 `log_statement` 값은 확인할 수 없었다** — 클러스터·접속 정보가 아직 없다(가정 N3, 월요일 예정). 7절은 **확인 방법 + 기본값 + 구조적 판단**이고, 실환경 값 확인은 월요일 항목이다.
- backend 영역(`src/alerts/**`)은 아직 없으므로 "API가 실제로 이 표에 쓰는지"는 검증 범위 밖이다.

### 7. logs 확인 요청 결과 — 대상 Postgres의 `log_statement`

**요청**: DB 파드 로그에 쿼리 원문이 찍히면 로그 화면에 그대로 보이고 `cluster-status` 가정 A7("쿼리 원문은 화면에 보여주지 않는다 — 개인정보 포함 가능")과 충돌한다.

**(1) 확인 방법** (읽기 전용. 기존 `sentinel_monitor` 계정으로 **권한 추가 없이** 된다 — `pg_monitor` ⊃ `pg_read_all_settings`를 확인했다)

```sql
-- 서버 전역 값 + 어디서 설정됐는지
SELECT name, setting, source, sourcefile, sourceline, pending_restart
FROM pg_settings
WHERE name IN ('log_statement','log_min_duration_statement','log_min_error_statement',
               'log_duration','log_parameter_max_length','log_parameter_max_length_on_error',
               'log_destination','logging_collector','log_line_prefix','log_error_verbosity');

-- DB·역할 단위 오버라이드 (ALTER DATABASE/ROLE … SET)
SELECT r.rolname, d.datname, s.setconfig
FROM pg_db_role_setting s
LEFT JOIN pg_roles r ON r.oid = s.setrole
LEFT JOIN pg_database d ON d.oid = s.setdatabase;
```

파드 쪽 교차 확인: `kubectl logs -n <ns> <postgres-pod> --tail=200 | grep -iE 'statement:|execute '`

**(2) 기본값** (Postgres 16/17 동일. PGlite 17.5에서 실측)

| 설정 | 기본값 | 의미 |
|---|---|---|
| `log_statement` | `none` | 평상시 문장을 안 남긴다 |
| `log_min_duration_statement` | `-1` | 느린 쿼리 로그 꺼짐 |
| **`log_min_error_statement`** | **`error`** | **오류가 난 문장은 원문 그대로 남는다** |
| `log_parameter_max_length_on_error` | `0` | 바인드 파라미터는 안 남긴다(기본) |
| `logging_collector` | `off` | 로그가 stderr로 → 컨테이너 로그 → `kubectl logs`에 보인다 |
| `log_destination` | `stderr` | 〃 |

로컬 `docker-compose.yml`의 `db`(`postgres:16-alpine`)는 별도 설정을 주지 않으므로 **위 기본값 그대로**다.

**(3) 판단 — 충돌은 실재하고, DB 설정만으로는 못 없앤다**

- `log_statement=none`이어도 **`log_min_error_statement=error`가 기본이라 오류 난 문장은 원문이 로그에 찍힌다.** 게다가 제약 위반의 `DETAIL:` 줄에는 **값까지** 들어간다(`Key (email)=(a@b.com) already exists.` — 이게 A7이 말한 "개인정보"다).
- 이걸 끄려면 `log_min_error_statement='panic'`으로 올려야 하는데, 그러면 **DBA가 장애 원인을 못 본다.** 바꾸는 것 자체가 **관측 대상에 대한 쓰기**라 조회 전용 원칙에도 어긋난다(대시보드가 요구할 일이 아니다).
- 운영 현장에서 `log_statement='ddl'`이나 `log_min_duration_statement=250ms`(느린 쿼리 로그)를 켜 두는 것은 매우 흔하다. 그 경우 **평상시에도** 문장 원문이 파드 로그에 쌓인다.
- **따라서 해결은 logs 쪽 가림 규칙이다.** A7을 지키려면 로그 화면이 그 줄을 처리해야 한다.

**(4) 권고 (PM·logs planner 판단용)**

- **권고 A(채택 권장)**: 가림 규칙에 **`sql_statement`** 한 종을 추가한다. Postgres 로그 줄의 `statement:` / `STATEMENT:` / `execute <unnamed>:` 뒤 본문과 `DETAIL:  Key (…)=(…)` 값을 대상으로, **리터럴만** 가린다(문장 구조는 남긴다).
  - **새로 만들 필요가 없다.** 이미 내 영역에 검증된 함수가 있다 — `apps/api/src/database/health/sanitize.ts`의 `maskSqlLiterals()` / `sanitizeQueryText()`. 문자열·숫자·달러 인용 리터럴을 `?`로 바꾸고 주석을 지우며, 잘려서 닫히지 않은 리터럴도 끝까지 가린다. logs 명세 3.3.2가 말한 "규칙을 새로 만들지 말고 공용 모듈로 올려 쓰라"와 정확히 맞는다.
  - 이렇게 하면 `INSERT INTO users … VALUES (?, ?)`처럼 **"어떤 쿼리가 실패했나"는 남고 값만 사라진다.** 조사 가치를 지키면서 A7의 취지(개인정보)를 지킨다.
  - 확신 등급은 **높음**(대상이 Postgres 로그의 고정된 접두어라 오탐이 적다).
- **권고 B(함께)**: A7 문구를 **"대시보드가 대상 DB에서 쿼리 원문을 조회하지 않는다 + 로그 화면에 쿼리 원문이 나오면 리터럴을 가린다"**로 다듬는다. 지금 문구는 상태 화면(`pg_stat_activity`)만 염두에 둔 것이라 로그 경로가 빠져 있다. (`docs/specs/cluster-status.md`는 planner 영역이라 내가 고치지 않았다.)
- **채택하지 않기를 권하는 대안**: ① DB 파드 로그를 로그 화면에서 제외 — 장애 조사에 가장 필요한 로그를 막는 것이라 과하다. ② 가림 없이 그대로 노출 + A7 축소 — A7의 근거가 "개인정보"라 보호가 사라진다. ③ 대상 DB의 로그 설정을 바꾸게 한다 — 조회 전용 원칙 위반이고 DBA의 눈을 가린다.

**(5) 덤으로 발견한 것 (모니터링 쪽에 영향)**

- 우리 모니터링 쿼리는 **리터럴이 없고 비밀값도 없어서** 로그에 찍혀도 유출이 아니다. 다만 `log_statement='all'`인 서버라면 15초 주기 × 10쿼리 = **시간당 2,400줄**이 DB 파드 로그에 얹힌다(로그 화면이 그만큼 시끄러워지고 디스크도 먹는다). 현 계정은 `log_min_duration_statement=-1`이 걸려 있어 **느린 쿼리 로그에는 기여하지 않는다**(`log_statement`는 역할 단위로 낮출 수 없는 `superuser` 컨텍스트라 서버 설정을 따른다).
- **주의 1건(운영자용)**: `docs/db/monitor-account.sql`은 세션에서 `SET log_statement='none'`을 걸지만, **`log_min_error_statement=error`는 남는다.** 만약 `ALTER ROLE … PASSWORD '…'` 문장이 **실패하면** 그 문장이 비밀번호째 DB 파드 로그에 남고, 로그 화면에서 보이게 된다. 지시에 따라 파일은 **손대지 않았다** — 8절 요청 5로 올린다.

### 8. 남은 이슈·한계

1. **실제 Postgres 16 미검증** (6절). PGlite는 17.5다.
2. **대상 DB의 실제 `log_statement` 값 미확인** — 접속 정보가 월요일에 온다. 7절은 방법·기본값·구조적 판단까지다.
3. **`alert_key_states`의 jsonb 배열은 backend가 잘라야 한다.** DB는 길이를 강제하지 않는다(`flapTransitionsMax` 50, `lastNotifiedTargetsMax` 200). 안 자르면 행이 계속 커진다.
4. **`closed_at` 규칙은 backend가 지켜야 성립한다.** 종결형 알림에 `closed_at`을 안 넣으면 "진행 중"으로 남는다 — 보관 정리에 `kind` 기반 안전장치를 뒀지만, 화면의 "진행 중" 목록은 틀리게 보인다.
5. **`purgeAlerts`는 한 호출에서 200배치(기본 10만 행)까지만** 지운다. 그 이상 쌓였으면 다음 호출에서 이어 지운다(의도).
6. **웹훅 URL이 DB 덤프에 평문으로 들어간다** — 5절 G의 판단대로 수용했고 문서에 적었다. 되돌리려면 `{url}` 객체 모양 덕분에 마이그레이션 없이 암호화로 전환할 수 있다.
7. **`SettingsService`에 쓰기·무효화 경로가 없다.** 설정 PATCH를 만들 때 `invalidate(key)`를 반드시 부르지 않으면 최대 60초 동안 옛 값이 쓰인다(기존 구조의 한계이지 이번 변경 때문은 아니다).
8. `alerts.discord.webhookUrl`의 `description`은 **행이 처음 만들어질 때만** 들어간다(upsert의 create 쪽). 이미 있는 행의 설명은 바뀌지 않는다.

### 9. 다른 담당 요청

**backend 요청 1 (스키마 사용법 · 가장 중요).**
- 알림 생성 시 **`closed_at` 규칙**을 지킬 것: `resolve`·`restart_summary`·`test`는 만들 때 `closedAt = occurredAt`. `warning → critical` 격상은 **새 행을 만들고 이전 행을 `closedAt = now`로 닫은 뒤** 새 행의 `parentAlertId`로 잇는다. `critical → warning` 완화는 **새 행을 만들지 말고** 기존 행의 `severity`·`lastEventAt`만 바꾼다(명세 3.2.1).
- 상태 머신은 **값이 바뀐 키만** upsert할 것(15초마다 8행 무조건 쓰기 금지). `recentTransitions`는 창 밖을 잘라서 저장(상한 `alerts.flapTransitionsMax`), `lastNotifiedTargets`는 `alertTargetRef()` 문자열로 상한 200.
- 진행 중 알림은 `alert_key_states.openAlertId`로 찾을 것(`alerts` 검색 불필요).
- heartbeat는 `upsert({ where: { scope: 'alerts' } })` 단일 행. 60초.
- `purgeAlerts(prisma, now, policy)`를 **하루 1회 외에 1시간마다 한 번** 더 부르기를 권한다(mock `burst`는 3초에 1건). `purgeExpiredData`에도 이미 포함돼 있다.
- mock 초기화(`POST /api/mock/reset`)는 `DELETE FROM alerts WHERE data_source='mock'` + `alert_key_states` 같은 조건 + `alert_deliveries`는 CASCADE. **live 이력을 지우지 말 것.**

**backend 요청 2 (웹훅 비밀값 · 저장 계층 사용).**
`apps/api/src/database/secret-settings.ts`를 통해서만 다룰 것.
- 화면·API: `readWebhookStatus(prisma, process.env)` → `{configured, hint, length, source, lockedByEnv, updatedAt}`을 그대로 응답에 실어도 된다.
- 발송기만: `loadWebhookUrlForDispatch()`. 반환값을 응답·SSE·로그·예외·알림 본문에 **절대** 넣지 말 것.
- 저장: `saveWebhookUrl()` / `clearWebhookUrl()`. `InvalidWebhookUrlError`(→ 400, 본문에 입력값 금지) / `SettingLockedByEnvError`(→ 409 `SETTING_LOCKED_BY_ENV`)를 매핑.
- 설정을 목록으로 줄 일이 생기면 `listPublicSettings()`만 쓸 것(`prisma.setting.findMany()` 직접 사용 금지).
- **공용 `redactSecrets`에 디스코드 웹훅 패턴 추가**: `DISCORD_WEBHOOK_URL_PATTERN`을 내보내 뒀다. 그 함수가 `apps/api/src/database/health/sanitize.ts`(내 영역)에 있는데, 이번 지시가 "`docs/db/health.md`를 손대지 말라"여서 **문서와 함께 고쳐야 하는 그 파일을 건드리지 않았다.** 내가 해야 하면 PM이 지시해 주면 한 번에 처리한다.

**backend 요청 3 (어드바이저 격리).**
어드바이저 스냅샷에 **알림 이력을 넣지 말 것.** 알림 `targets[].name`에는 kOps 노드 이름(EC2 인스턴스 ID)이 **원문 그대로** 들어간다(PM 결정 Q3). 어드바이저는 가명 규칙을 쓰므로 알림을 그대로 실으면 가명 규칙이 깨진다. `advisor-snapshot` 빌더가 알림 표를 읽지 않는지 확인 부탁한다.

**backend 요청 4 (환경 변수 등록).**
`ALERTS_DISCORD_WEBHOOK_URL`(선택, 설정되면 DB 값을 이기고 화면 잠금)을 `apps/api/src/config/env.validation.ts`·`.env.example`·`docker-compose.yml`·`deploy/app.example.yaml`에 추가. **값 형식 설명만 적고 예시 실제 값은 넣지 말 것.** `ALERTS_DISPATCH`·`ALERTS_PUBLIC_BASE_URL`은 명세 7절대로.

**PM·운영자 요청 5 (모니터링 계정 스크립트 보강 여부 판단).**
`docs/db/monitor-account.sql` 적용이 **실패하면** `log_min_error_statement=error`(기본) 때문에 `ALTER ROLE … PASSWORD '…'` 문장이 비밀번호째 DB 파드 로그에 남고, logs 기능이 켜지면 화면에도 보인다. 완화책 두 가지 중 고르면 내가 반영하겠다: ① 스크립트에 `SET log_min_error_statement = 'panic';`을 `SET log_statement='none'` 옆에 추가(세션 한정, superuser 필요) ② 문서에 "적용 실패 시 파드 로그를 확인하고 비밀번호를 교체" 안내만 추가. **이번 지시가 "손대지 말라"여서 파일은 그대로 뒀다.**

**PM·backend 요청 6 (검증 보완).**
실제 Postgres 16에서 `npm run db:migrate --prefix apps/api`를 한 번 돌려 주기 바란다. 가능하면 **기존 `cost_rate_samples`·`settings` 행이 있는 DB**에서 돌리고 행 수·값이 그대로인지 확인해 주면 좋다. 이 환경에는 Docker·psql이 없다.

**logs planner·PM 요청 7.**
7절 (4)의 권고 A(가림 규칙 `sql_statement` 추가, `maskSqlLiterals()` 재사용)와 권고 B(A7 문구 보강)에 대한 판단 부탁. `docs/specs/logs.md` 3.3.2와 `docs/specs/cluster-status.md` 가정 A7은 내 영역이 아니라 고치지 않았다.

**designer 요청 8 (있으면 좋은 것).**
설정 화면의 웹훅 입력 옆에 한 줄: `알림 본문에 클러스터 리소스 이름(노드는 EC2 인스턴스 ID)이 그대로 들어갑니다. 채널 공개 범위를 확인하세요.` (명세 0.1 가정 N6·PM 결정 Q3). 저장 후 표시는 `설정됨 · …****7f3a (119자)` — `readWebhookStatus()`의 `hint`·`length`가 그 모양 그대로다.

### 10. 다음 담당이 알아야 할 점

- **적용**: `apps/api`에서 `npx prisma migrate deploy`(또는 `npm run db:setup`). 새 마이그레이션 1건만 추가로 적용된다. **Prisma 클라이언트 재생성 필요**(`npm run prisma:generate --prefix apps/api`) — 모델 4개가 새로 생겼다.
- **되돌리기**: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db/migrations/20260924180000_alerts.down.sql` (최신부터 역순, `docs/db/schema.md` 5절). **알림 이력이 전부 사라지므로** 필요하면 먼저 `pg_dump -t alerts -t alert_deliveries -t alert_key_states -t dashboard_heartbeats`.
- **설정 기본값 반영**: 새 key는 `npm run db:seed --prefix apps/api`로 들어간다. **안 돌려도 동작한다** — `mergeSetting`이 코드 기본값으로 채운다. 이미 시드된 DB의 기존 key 값은 절대 덮어쓰지 않는다.
- **불변식 3가지**: ① `closed_at IS NULL` = 진행 중(보관 정리가 건드리지 않는다) ② 알림 1건 × 채널당 발송 행 1개 ③ `alert_key_states`는 (data_source, alert_key)당 1행.
- **대시보드 DB가 없을 때**(`PrismaService.isConnected === false`) 알림 기능은 죽지 않아야 한다(AC-ALERT17). 메모리 최근 200건(`settings alerts.memoryFallbackMax`)으로 동작하고 위 질의를 부르지 않는다. 이때 heartbeat 행이 없으므로 정지 구간은 "이전 실행 기록 없음"이다.
- **모니터링 대상 DB 쪽은 이번 작업으로 아무것도 바뀌지 않았다.** `docs/db/health.md`의 쿼리 10종, `sentinel_monitor` 계정, `statement_timeout` 설정 그대로 쓰면 된다.
- 조회 패턴 요약표는 `docs/db/schema.md` **2.13**에 있다. 배지 질의의 정확한 형태와 인덱스 근거는 **4절**에 있다.

---

## 2026-09-24 22:40 · PM 후속 지시 2건 (모니터링 계정 완화 · `redactSecrets` 웹훅 패턴)

### 1. 요청 내용

PM이 설계를 채택하면서 남은 2건을 넘겼다.

1. **`docs/db/monitor-account.sql` 완화 적용** — `ALTER ROLE … PASSWORD '…'`가 **실패하면** 비밀번호가 파드 로그에 남고 로그 화면에서 보인다. 앞선 보고의 권고안대로 적용하되 **제약**: 완화는 **그 스크립트를 실행하는 세션에 한정**돼야 한다(대상 DB의 영구 설정 변경 = 관측 대상 쓰기 = 원칙 위반). 같은 파일의 `SET log_statement='none'` 선례와 일관되게. **왜 그렇게 했는지 주석으로 남길 것**(안 적으면 다음 사람이 "불필요한 SET"으로 보고 지운다).
2. **공용 `redactSecrets`에 디스코드 웹훅 패턴 추가 — 내가 직접.** 그 함수가 있는 `src/database/health/sanitize.ts`는 **내 영역**이고, 앞선 "`health.md`를 손대지 마라"는 지시는 **모니터링 계정·상태 조회 쿼리·그 문서**를 뜻한 것이지 이 파일 전체가 아니었다는 확인을 받았다.

참고로 전달받은 결정: `sql_statement` 가림 규칙 승인(backend로), 어드바이저 스냅샷에 알림 이력 제외(backend 계약으로), `health.md`의 A7 문구 조정은 PM이 planner와 따로 처리, 월요일 확인 목록에 대상 DB 실제 로깅 설정 + 실제 PG16 `db:migrate` 등록.

### 2. 참고한 문서

- 이 파일 앞 섹션 7절(확인 결과)·9절 요청 2·5
- `docs/db/monitor-account.sql`(현 상태), `apps/api/src/database/health/sanitize.ts`, `docs/specs/alerts.md` 3.4.3, AC-ALERT13·20
- Postgres 설정 의미: `log_statement` / `log_min_duration_statement` / `log_min_error_statement`(기본 `error`)

### 3. 작업 내용

**(1) `monitor-account.sql` — `SET log_min_error_statement = 'panic';` 추가**

기존 두 줄(`log_statement='none'`, `log_min_duration_statement=-1`) 옆에 세 번째 줄을 넣고, 그 위에 **왜 세 줄이 다 필요한지**를 주석으로 달았다.

- 각 설정이 막는 것을 한 줄씩 구분해 적었다 — `log_statement`는 **성공한** 문장, `log_min_duration_statement`는 **느린** 문장, `log_min_error_statement`는 **실패한** 문장. 앞 두 줄로는 세 번째를 못 막는다는 것이 이번 발견의 핵심이라 그 문장을 그대로 남겼다(`기본값이 'error'라, 문장이 실패하면 원문이 그대로 남는다`).
- **PM 제약을 주석에 명시**했다: 셋 다 `SET`이라 **이 psql 세션에만** 적용되고 `ALTER SYSTEM`/`ALTER DATABASE`/`ALTER ROLE` 같은 영구 설정은 건드리지 않는다는 것, 이유가 "모니터링 대상 DB에 쓰기를 하지 않는다"(CLAUDE.md)라는 것, 세션이 끝나면 원래 값으로 돌아가고 다른 접속의 로깅에는 영향이 없다는 것.
- **"진단을 잃지 않는다"**도 적었다. `panic`으로 올리면 서버 로그의 사본만 사라지고, `ON_ERROR_STOP=1`이라 **오류는 실행한 사람의 화면에 그대로 뜬다.** 이 한 줄이 없으면 다음 사람이 "오류를 숨기는 위험한 설정"으로 오해하고 지운다.
- superuser 권한이 없으면 여기서 psql이 멈춘다는 것도 적었다 — **권한 없는 계정으로 계속 진행돼 비밀번호가 로그에 남는 것보다 멈추는 편이 안전하다**는 판단을 함께 남겼다.
- 계정 권한·속성·역할 수준 설정은 **한 글자도 바꾸지 않았다.** 추가한 것은 세션 `SET` 한 줄과 주석뿐이다.

**(2) `sanitize.ts` — `redactSecrets`에 디스코드 웹훅 패턴 추가**

- `DISCORD_WEBHOOK_URL_PATTERN`·`WEBHOOK_MASK`(`[웹훅 주소 가림]`)·`redactDiscordWebhookUrls()`를 **`sanitize.ts`로 옮기고**, `redactSecrets`의 **가장 첫 단계**로 넣었다.
- **첫 단계로 둔 이유**: 뒤의 규칙(`key=value`, 접속 문자열)이 URL을 부분적으로만 갉아먹으면 알아볼 수 있는 조각이 남는다. 통째로 먼저 지운다.
- **구현을 `secret-settings.ts`가 아니라 `sanitize.ts`에 둔 이유(중요)**: 반대 방향이면 **순환 import**가 된다 — `sanitize` ← `health/postgres/normalize`(19행에서 `sanitizeErrorMessage`를 쓴다) ← `settings-defaults`(`DEFAULT_PG_THRESHOLDS`) ← `secret-settings`. `sanitize.ts`는 import가 하나도 없는 잎 모듈이라 여기가 유일하게 안전한 자리다. `secret-settings.ts`는 이제 그것을 가져와 **다시 내보내기만** 한다(backend가 어느 쪽 경로로 import해도 같은 구현).
- 전역(`/g`) 정규식을 모듈 수준 상수로 두는 것이 `lastIndex` 때문에 위험할 수 있어, `.replace()`만 쓰고(호출 전후로 `lastIndex`가 0으로 리셋된다) **같은 입력을 두 번 넣어도 결과가 같은지**를 테스트로 못 박았다.
- 마스킹은 **URL 통째로**다. 호스트·경로를 남기면 `discord.com/api/webhooks`로 grep했을 때 걸려 AC-ALERT20("응답 전체를 검색해도 URL이 없다")의 취지가 흐려진다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/db/monitor-account.sql` | 수정 | `SET log_min_error_statement = 'panic';` 1줄 + 이유·세션 한정·진단 유지 주석. **계정 권한·속성은 변경 없음** |
| `apps/api/src/database/health/sanitize.ts` | 수정 | `DISCORD_WEBHOOK_URL_PATTERN`·`WEBHOOK_MASK`·`redactDiscordWebhookUrls()` 추가, `redactSecrets` 첫 단계로 편입 |
| `apps/api/src/database/health/sanitize.spec.ts` | 수정 | 웹훅 가림 테스트 5건 추가 |
| `apps/api/src/database/secret-settings.ts` | 수정 | 중복 정의 제거 → `./health/sanitize`에서 가져와 재내보내기(순환 import 방지 이유 주석) |

### 5. 주요 결정과 이유

**A. `log_min_error_statement`를 `panic`으로 올린다(끄는 것이 아니다).**
대안은 `fatal`인데, 그러면 `FATAL` 등급 문장이 여전히 로그에 남는다. `panic`이 실질적인 "문장 로깅 없음"이다. 진단 손실이 없는 이유(psql이 오류를 화면에 그대로 띄운다)를 주석에 적어 다음 사람이 지우지 않게 했다.

**B. 세션 `SET`만 쓰고 `RESET`을 넣지 않았다.**
스크립트 끝에서 되돌리면 그 뒤 문장(`\unset` 직전까지)이 다시 로그에 노출될 여지가 생긴다. 세션은 스크립트가 끝나며 닫히고 `SET`은 세션 밖으로 새지 않으므로 되돌릴 필요가 없다.

**C. 가림 패턴의 집은 `sanitize.ts`다.**
순환 import를 피할 수 있는 유일한 방향이고(3절 (2)), 덤으로 DB 상태 조회 쪽 오류 메시지(`sanitizeErrorMessage`)까지 **자동으로** 보호된다 — 알림 코드가 아직 없어도 이미 적용돼 있다.

**D. `docs/db/health.md`는 건드리지 않았다.** 6절·7.2가 이번 변경으로 **두 줄 낡았지만**, PM이 그 파일의 문구 조정을 planner와 따로 처리한다고 했으므로 동시 편집 충돌을 피했다. 필요한 수정 2건은 아래 7절에 **붙여 넣을 수 있는 형태로** 적었다.

### 6. 검증 결과

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| PGlite: `SET log_min_error_statement='panic'` 수용 | **통과** | `pg_settings.setting='panic'` (유효한 값임을 실측) |
| PGlite: `log_statement='none'`·`log_min_duration_statement=-1` 동시 적용 | **통과** | 셋이 서로 간섭하지 않음 |
| **세션 한정인지** (`pg_db_role_setting` 비어 있음, `boot_val`/`reset_val`=`error`, `source`=`session`) | **통과** | **영구 설정을 바꾸지 않는다**는 PM 제약 충족을 실측으로 확인 |
| PGlite: 실패한 `ALTER ROLE`이 실행자에게 그대로 보이는지 | **통과** | `role "no_such_role_xyz" does not exist` — 진단 손실 없음 |
| PGlite: 그 뒤 계정 생성·권한 문장 정상 동작 | **통과** | `superuser=f, conn_limit=3, pg_monitor=t`, `rolconfig` 그대로 |
| `redactSecrets`가 문장 속 웹훅 URL을 통째로 가린다 | **통과** | `발송 실패: POST [웹훅 주소 가림] → 401` |
| `sanitizeErrorMessage`(화면 "판단 이유")에도 안 남는다 | **통과** | |
| `discordapp.com`·서브도메인(`ptb.`)·`http` 변형 | **통과** | |
| 전역 정규식 재사용 시 결과 불변(`lastIndex`) | **통과** | 같은 입력 2회 호출 결과 동일 |
| 디스코드가 아닌 `/api/webhooks/` 주소는 그대로 둔다 | **통과** | 오탐 없음 |
| `npx tsc --noEmit` | 성공(에러 0) | 순환 import 없음 |
| `eslint "src/**/*.ts"` | 통과 | |
| `jest` (apps/api 전체) | **45 suites / 489 passed, 2 skipped** | 앞 섹션 484건 + 이번 5건 |
| 알림 마이그레이션 재검증(PGlite, 포트 3111) | **29/29 통과** | 이번 변경으로 회귀 없음 |

검증 스크립트는 스크래치패드(`check-monitor-sets.cjs` 8/8, `verify-alerts-migration.cjs` 29/29). 포트는 **3111**만 썼고 스크립트가 자기 프로세스 안에서 소켓을 닫고 끝나므로 남는 PID가 없다(3121은 다른 에이전트 것 — 건드리지 않았다).

**하지 않은 검증 (그대로 적는다)**

- **"실패한 문장이 서버 로그에 정말 안 남는지"는 실측하지 못했다.** PGlite에는 검사할 서버 로그 파일이 없다. 확인한 것은 ① 설정값이 `panic`으로 **실제로 바뀐다** ② **세션에만** 적용된다 ③ 오류가 클라이언트에는 그대로 온다, 세 가지다. "`log_min_error_statement` 이상 등급의 오류만 문장을 남긴다"는 Postgres 문서에 근거한 동작이다.
- 실제 대상 Postgres에서 스크립트를 처음부터 끝까지 돌려 보지 못했다(클러스터 접속 정보 없음 — 월요일). psql 메타명령(`\set`·`\if`·`\gexec`)은 PGlite로 실행할 수 없어 SQL 문장만 확인했다.

### 7. 남은 이슈·한계

1. **`docs/db/health.md`가 두 줄 낡았다.** 내가 고치지 않았다(5절 D). 붙여 넣을 수 있게 그대로 적는다 — 수정하는 사람이 누구든 이 두 곳만 바꾸면 된다.
   - **6절 민감값 처리 표**에 행 1개 추가:
     `| 디스코드 웹훅 URL | redactSecrets()가 **통째로** 가린다([웹훅 주소 가림]). 주소 자체가 비밀값이다(alerts 3.4.3). 저장·조회는 src/database/secret-settings.ts 전용 함수로만 |`
   - **7.2 3단계 첫 불릿**을 교체:
     `- 스크립트는 세션 안에서 log_statement='none'·log_min_duration_statement=-1·log_min_error_statement='panic'으로 바꿔, 비밀번호가 든 문장이 **성공하든 실패하든** 서버 로그에 남지 않게 한다(superuser 필요, 세션 한정이라 서버 설정은 그대로).`
   - 7.1 "세션 기본값" 행은 **역할 수준 설정**이라 바뀐 것이 없다(그대로 두면 된다).
2. `log_min_error_statement`는 superuser 컨텍스트라 **모니터링 계정 세션에는 걸 수 없다.** 모니터링 쿼리는 리터럴·비밀값이 없어 문제가 아니지만, 대상 서버가 `log_statement='all'`이면 15초 주기 조회가 파드 로그에 시간당 약 2,400줄을 얹는다(앞 섹션 7절 (5)).
3. 웹훅 가림은 **디스코드 도메인 패턴**에만 붙는다. 나중에 Slack 등 채널이 늘면 패턴을 함께 늘려야 한다(`DISCORD_WEBHOOK_URL_PATTERN` 옆에 추가).
4. `redactSecrets`는 DB 상태 조회 쪽 오류 메시지 경로에만 자동 적용된다. **알림 발송 실패 메시지가 이 함수를 타는지는 backend 구현에 달려 있다**(8절 요청 2).

### 8. 다른 담당 요청

**PM 요청 1 (문서 한 곳).** 7절 1번의 두 줄을 `docs/db/health.md`에 반영해 주기 바란다(또는 내가 하라고 지시해 주면 바로 한다). 동시 편집 충돌을 피하려고 손대지 않았다.

**backend 요청 2 (앞 섹션 9절 요청 2의 갱신).** `redactSecrets`에 웹훅 패턴이 **이미 들어갔다.** 따로 추가할 필요가 없고, 대신 **발송 실패 메시지·`SourceStatus.error.message`·알림 이력의 `error_message`가 그 함수를 반드시 타게** 해 주기 바란다. import 경로는 둘 다 같은 구현이다:
- `import { redactSecrets } from '../database/health/sanitize';` (다른 비밀값까지 함께)
- `import { redactDiscordWebhookUrls } from '../database/secret-settings';` (웹훅만)

**backend 요청 3 (변동 없음).** 앞 섹션 9절의 요청 1·3·4·6은 그대로 유효하다.

### 9. 다음 담당이 알아야 할 점

- **`monitor-account.sql`의 `SET` 세 줄을 지우지 말 것.** 주석에 이유를 적어 뒀다. 특히 `log_min_error_statement='panic'`은 "오류를 숨기는 설정"이 아니라 **서버 로그에 남는 사본만** 막는 것이고, 실행자는 오류를 화면에서 그대로 본다.
- 스크립트 적용 방법·권한 요구사항은 **바뀌지 않았다**(superuser로 표준 입력 파이프). 이미 계정을 만든 환경에서 다시 돌려도 멱등이다.
- **웹훅 주소가 코드 어디를 지나가든 `redactSecrets`를 한 번 거치면 사라진다.** 새 오류 경로를 만들 때 그 함수를 통과시키기만 하면 된다.
- `DISCORD_WEBHOOK_URL_PATTERN`의 **집은 `src/database/health/sanitize.ts`**다(순환 import 때문). `secret-settings.ts`에서 import해도 같은 것이다.

---

## 2026-09-24 23:05 · `docs/db/health.md` 갱신 (앞 두 변경으로 낡아진 서술)

### 1. 요청 내용

PM 확인: **`docs/db/health.md`는 DBA 영역이 맞고, 직접 반영하라.** 앞서 "손대지 마라"고 한 것은 **모니터링 계정·상태 조회 쿼리의 내용을 바꾸지 말라**는 뜻이었고, 이번 변경으로 **낡아진 서술을 갱신하는 것은 다른 얘기**다. (`docs/specs/cluster-status.md`의 가정 A7만 planner 몫 — PM이 따로 지시한다.)

앞 섹션 7절에 준비해 둔 텍스트 2건을 넣었다.

### 2. 참고한 문서

- 이 파일 앞 섹션(22:40) 7절 1번 — 붙여 넣을 텍스트
- `docs/db/health.md` 현재 상태(머리말 모듈 목록, 6절 민감값 처리, 7.1 권한 요약, 7.2 적용 절차)

### 3. 작업 내용

1. **6절 민감값 처리 표** — 두 곳.
   - 기존 `접속·쿼리 오류 메시지` 행의 가림 목록에 **디스코드 웹훅 URL** 추가(`sanitizeErrorMessage`가 `redactSecrets`를 타므로 실제로 가려진다).
   - **`디스코드 웹훅 URL` 행 신설**: `redactSecrets()`가 통째로 가린다(`[웹훅 주소 가림]`), 주소 자체가 비밀값인 이유, 패턴 위치(`DISCORD_WEBHOOK_URL_PATTERN` in `sanitize.ts`), 저장·조회는 `secret-settings.ts` 전용 함수로만(`schema.md` 2.12 연결).
2. **7.2 3단계 첫 불릿 교체** — `log_statement='none'`·`log_min_duration_statement=-1`·`log_min_error_statement='panic'` 세 설정 버전으로. 하위 불릿 3개로 근거를 남겼다: ① 셋이 막는 것이 다르다(성공한 문장 / 느린 문장 / **실패한 문장**, 세 번째는 기본값이 `error`라 앞 두 개로 못 막는다) ② **진단은 잃지 않는다**(`ON_ERROR_STOP=1`이라 오류는 실행자 화면에 뜬다) ③ 전부 `SET`이라 **세션 한정**이고 영구 설정을 건드리지 않는다(관측 대상 쓰기 금지 원칙).
3. **머리말 모듈 목록** — `sanitize.ts` 설명에 `디스코드 웹훅 URL` 추가(한 단어).

**바꾸지 않은 것**: 상태 조회 쿼리 10종의 내용·주기·타임아웃, 판단 기준, 5절 사용법, **7.1 권한 요약 표의 "세션 기본값" 행**(그것은 `ALTER ROLE … SET`으로 거는 **역할 수준** 설정이라 이번 변경과 무관하다 — 역할에는 `log_min_error_statement`를 걸 수 없다). 모니터링 계정의 권한·속성도 그대로다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/db/health.md` | 수정 | 6절 민감값 표(행 1개 신설 + 기존 행 1개 보강), 7.2 3단계 불릿 교체(+근거 3줄), 머리말 모듈 목록 1단어 |

### 5. 주요 결정과 이유

- **행을 새로 만들면서 기존 `오류 메시지` 행도 함께 고쳤다.** 둘 중 하나만 고치면 "오류 메시지에서 가리는 것" 목록이 코드와 어긋난 채 남는다. 표는 `대상 | 처리` 구조라 웹훅은 독립된 대상이고, 오류 메시지 행은 "그 경로에서 무엇을 가리나"라 성격이 다르다 — 중복이 아니라 서로 다른 질문에 대한 답이다.
- **7.2에 근거를 3줄이나 붙인 이유**: `monitor-account.sql` 주석과 **같은 내용을 문서에도** 남겨야 한다. 스크립트만 읽는 사람과 문서만 읽는 사람이 다르고, 어느 쪽에서든 "이 `SET`은 왜 있나"에 답이 나와야 지워지지 않는다.
- **7.1은 건드리지 않았다.** 역할 수준 설정과 세션 설정을 한 표에 섞으면 다음 사람이 "역할에도 `log_min_error_statement`를 걸어 두자"로 읽는다 — 그건 superuser 컨텍스트라 불가능하고, 가능하더라도 영구 설정이라 원칙 위반이다.

### 6. 검증 결과

| 확인 | 결과 | 비고 |
|---|---|---|
| 편집 두 곳이 의도대로 들어갔는지 (표 행·불릿) | **통과** | 6절 308~309행, 7.2 351~354행 렌더링 확인 |
| 문서에 남은 다른 낡은 서술 (`redactSecrets`·`PEM`·`세션 기본값` 전수 검색) | **없음** | 7.1 "세션 기본값"은 역할 수준이라 변경 대상 아님 |
| 코드와의 일치 (`DISCORD_WEBHOOK_URL_PATTERN`·`[웹훅 주소 가림]`·`SET` 3줄) | **통과** | `sanitize.ts`·`monitor-account.sql` 실제 내용과 대조 |

문서만 바뀌었으므로 코드 검증은 다시 돌리지 않았다(직전 상태: `tsc` 0에러, `eslint` 통과, `jest` 45 suites / 489 passed, 마이그레이션 29/29). 프로세스를 새로 띄우지 않았다.

### 7. 남은 이슈·한계

- 앞 섹션(22:40) 7절의 한계 2~4는 그대로다. 문서 갱신으로 해소되는 것은 7절 1번뿐이고, 그것은 이번에 처리됐다.
- 월요일 확인 목록(PM 등록): 실패한 문장이 서버 로그에 정말 안 남는지 실측, 실제 대상 DB에서 `monitor-account.sql` 전체 실행.

### 8. 다른 담당 요청

- 없다. 앞 섹션의 **PM 요청 1(문서 반영)은 이번에 내가 처리해 종료**한다. backend 요청 2·3은 그대로 유효하다.
- `docs/specs/cluster-status.md` 가정 A7 문구는 **planner 몫**이다(PM이 지시). 내가 손대지 않았다.

### 9. 다음 담당이 알아야 할 점

- 가림 규칙을 늘리면 **세 곳을 같이** 고쳐야 한다: `sanitize.ts`(구현), `sanitize.spec.ts`(테스트), `docs/db/health.md` 6절(표). 이번에 셋 다 맞춰 뒀다.
- `monitor-account.sql`의 `SET` 3줄에 대한 설명은 **스크립트 주석과 `health.md` 7.2 두 곳**에 있다. 한쪽만 고치지 말 것.

---

## 2026-09-24 23:40 · `sql_statement` 재사용 방안 구멍 확인 → `maskSqlLiterals` 보강 (AC-LOG49)

### 1. 요청 내용

PM: planner가 **내가 권고한 재사용 방안에 구멍이 있다**고 지적했고 타당해 보인다. `maskSqlLiterals()`/`sanitizeQueryText()`가 ① `STATEMENT:`/`DETAIL:` 접두 줄과 여러 줄 문장, ② **`DETAIL: Key (email)=(a@b.com) already exists.`의 값**을 실제로 잡는지 확인하라. ②가 핵심 — `DETAIL:`은 SQL 문장이 아니라 Postgres가 붙이는 설명 줄이라 **그대로는 못 잡을 가능성**이 있고, **여기서 못 잡으면 이번 조치가 목적을 달성하지 못한다.**

방향: **로그 전용 규칙을 새로 만들지 말고 그 함수를 보강**할 것(규칙이 두 벌이면 한쪽만 고쳐져 어긋난다). 보강해도 **리터럴만 `?`로 바꾸고 문장 구조·테이블·컬럼 이름은 남기는** 성질을 지킬 것. 검사 기준은 **AC-LOG49**. 잡는지 못 잡는지 **둘 다 보고**할 것.

### 2. 참고한 문서

- `docs/specs/logs.md` 3.3.2 가림 규칙 목록·AC-LOG49(planner가 방금 갱신 — 읽기만 했다)
- 이 파일 앞 섹션(21:30) 7절 (4) 권고 A — 내가 `maskSqlLiterals()` 재사용을 권고한 지점
- `apps/api/src/database/health/sanitize.ts` 현재 구현

### 3. 확인 결과 — **못 잡는다. planner 지적이 맞다.**

실제 함수에 Postgres 로그 줄 12종을 넣어 실측했다(스크래치패드 `probe-sql-mask.ts`).

| 입력 | `maskSqlLiterals` 결과 | 판정 |
|---|---|---|
| `DETAIL:  Key (email)=(a@b.com) already exists.` | **바뀌지 않음** | ❌ **핵심 케이스 누출** |
| `DETAIL:  Key (tenant, email)=(acme, a@b.com) …` | **바뀌지 않음** | ❌ 누출 |
| `DETAIL:  Failing row contains (1, alice, a@b.com, 2026-01-01).` | `(?, alice, a@b.com, ?-?-?)` | ❌ **숫자만 가려지고 문자열은 남음** (행 전체가 사용자 데이터라 더 위험) |
| `ERROR:  invalid input syntax for type integer: "abc"` | 바뀌지 않음 | ❌ 누출 |
| `DETAIL:  Key (user_id)=(42) …` | `(?)` | ✅ (숫자라 우연히) |
| `DETAIL:  parameters: $1 = 'a@b.com'` | `$1 = ?` | ✅ |
| `STATEMENT:  INSERT INTO users (email) VALUES ('a@b.com')` | `VALUES (?)` | ✅ |
| `\tVALUES ('a@b.com')` (연속행 단독) | `VALUES (?)` | ✅ |
| `ERROR: … unique constraint "users_email_key"` | 그대로 | ✅ (남아야 할 것이 남음) |

**원인**: `maskSqlLiterals`는 **SQL 리터럴 스캐너**다. 따옴표·숫자·달러 인용만 본다. `Key (email)=(a@b.com)`의 `a@b.com`은 따옴표가 없는 맨 토큰이라 SQL 문법상 리터럴이 아니고, 그래서 지나간다. planner가 짚은 그대로다.

**추가로 찾은 구멍 (지적에는 없었지만 같은 뿌리)**: 로그 줄 **전체**에 `maskSqlLiterals`를 돌리면
`2026-09-24 12:00:00.123 UTC [123] STATEMENT: …` → `?-?-? ?:?:? UTC [?] STATEMENT: …`
로 **타임스탬프·PID까지 뭉개진다.** "무엇이 언제 실패했나"가 사라져 AC-LOG49의 "구조는 남음"에 정면으로 어긋난다. 즉 내 권고안을 **그대로 적용하면 목적도 못 이루고 로그도 못 읽게 된다.** 앞 섹션 7절 (4)의 권고 A는 이 정도까지 검증하지 않고 낸 것이었다 — 내 실수였다.

### 4. 보강 내용

`sanitize.ts` **한 파일 안에서**, 리터럴 스캐너(`maskSqlLiterals`)는 **그대로 재사용**하고 "값이 오는 자리"를 찾는 계층만 위에 얹었다. 규칙을 두 벌로 만들지 않았다.

| 추가한 것 | 하는 일 |
|---|---|
| `maskPgDetailValues(text)` | `Key (cols)=(vals)` → `Key (cols)=(?)`, `Failing row contains (…)` → `(?)`. **컬럼 이름은 남는다** |
| `maskPgLogValues(line)` | 위 + `parameters:` 뒤 + **마커(`STATEMENT:`/`QUERY:`/`statement:`/`execute <name>:`) 뒤쪽에만** `maskSqlLiterals` + `CONTEXT: SQL statement "…"` 안쪽 + 값이 큰따옴표로 오는 알려진 오류 문구 |
| `createPgLogValueMasker()` | 줄 단위 상태 보존 래퍼. 직전 줄이 문장을 열었으면 **들여쓴 다음 줄**을 그 문장의 조각으로 보고 리터럴을 가린다 |

핵심 설계 두 가지.

1. **마커 뒤쪽에만 리터럴 스캐너를 돌린다.** 그래서 타임스탬프·PID·심각도·제약 이름이 그대로 남는다(3절의 추가 구멍 해결).
2. **값 목록을 쉼표로 쪼개지 않는다.** 값 안에 쉼표가 들어갈 수 있어(`Doe, John`) 개수를 믿을 수 없다. 그룹 전체를 `?` 하나로 바꾼다 — "어느 컬럼이 걸렸나"는 왼쪽 괄호에 남으므로 조사 가치는 유지된다.

여러 줄 처리에서 **상태를 쓰는 이유**: Postgres는 이어지는 줄을 탭으로 들여쓰고 접두어를 붙이지 않는다. 무상태로 "들여쓴 줄이면 SQL로 본다"고 하면 앱 스택 트레이스(`\tat com.foo.Bar(Bar.java:42)`)의 줄 번호까지 `?`가 된다. **문장이 열려 있을 때만** 연속행을 SQL로 본다 — 테스트로 스택 트레이스가 그대로 남는 것을 확인했다.

`redactSecrets`에도 **`maskPgDetailValues`만** 편입했다(마커 기반 SQL 마스킹은 넣지 않았다 — 일반 오류 문자열에서 숫자까지 `?`가 되면 과하다). 드라이버 오류에 `detail`이 붙어 오는 경우를 덮는 방어층이다.

### 5. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/database/health/sanitize.ts` | 수정 | `maskPgDetailValues`·`maskPgLogValues`·`createPgLogValueMasker` 추가(+ 실측 근거 주석), `redactSecrets`에 `maskPgDetailValues` 편입 |
| `apps/api/src/database/health/sanitize.spec.ts` | 수정 | AC-LOG49 테스트 13건 추가 |
| `docs/db/health.md` | 수정 | 6절 민감값 표에 "Postgres 서버 로그 줄의 값" 행 추가, `오류 메시지` 행에 `Key (col)=(…)` 추가 |

("가림 규칙은 세 곳을 같이 고친다" — 구현·테스트·문서 셋 다 맞췄다.)

### 6. 검증 결과

| 확인 | 결과 |
|---|---|
| **`DETAIL: Key (email)=(a@b.com)`** → `Key (email)=(?)` | **통과** (핵심) |
| 복합 키 `Key (tenant, email)=(acme, a@b.com)` → `(?)` | **통과** |
| `Failing row contains (1, alice, a@b.com, …)` → `(?)` | **통과** |
| `parameters: $1 = '…'` → `$1 = ?` | **통과** |
| `STATEMENT:` 뒤 리터럴만 `?` + **타임스탬프·PID 보존** | **통과** |
| `LOG: statement:` / `execute <unnamed>:` / `CONTEXT: SQL statement "…"` | **통과** |
| `invalid input syntax for type integer: "abc"` → `"?"` | **통과** |
| **남아야 할 것**: 제약 이름 `"users_email_key"`, 테이블 `"users"`, 컬럼 `(email)`, `INSERT INTO users (email)` | **통과** (통째로 지우지 않음) |
| SQL이 아닌 앱 로그 줄은 건드리지 않음 | **통과** |
| 여러 줄 문장: 연속행 `\tVALUES ('a@b.com')` → `(?)`, 문장이 끝난 뒤 스택 트레이스는 그대로 | **통과** |
| **기존 DB 상태 조회 경로 회귀**: `sanitizeErrorMessage`(접속 문자열·SQLSTATE), `redactSecrets`(key=value·AWS 키), 제약 이름 보존 | **회귀 없음** |
| `npx tsc --noEmit` / `eslint "src/**/*.ts"` | 통과 |
| `jest` (apps/api 전체) | **45 suites / 502 passed, 2 skipped** (직전 489 → +13) |
| 알림 마이그레이션 재검증(PGlite, 포트 3111) | **29/29 통과** |

프로세스는 새로 띄우지 않았고(ts-node 1회성 실행), 임시 폴더 `apps/api/.probe`는 지웠다.

**하지 않은 검증 (그대로 적는다)**

- **실제 Postgres 파드 로그로 확인하지 못했다.** 입력은 Postgres 로그 형식을 손으로 재현한 12종이다. `log_line_prefix`가 회사 설정과 다르면 앞부분 모양이 달라지는데, 규칙이 **접두어를 파싱하지 않고 마커만 찾으므로** 영향받지 않게 만들었다. 다만 실기 확인은 월요일 항목이다.
- 오퍼레이터(CloudNativePG 등)의 **JSON 로그 형식**은 다루지 않았다. 그 경우 `DETAIL`이 JSON 필드로 오므로 줄 전체가 `{"level":"error","detail":"Key (email)=(a@b.com)…"}` 모양이 된다 — `maskPgDetailValues`가 문자열 어디에 있든 잡으므로 **값은 가려지지만**, JSON 구조 안에서의 동작은 실측하지 않았다.
- 로그 파이프라인에 실제로 연결해 보지 않았다(backend 구현 전).

### 7. 남은 이슈·한계

1. **오탐은 설계대로 감수한다**(planner 수용). 앱 로그에 `Key (x)=(y)` 같은 문자열이 있으면 `?`가 된다 — 값이 사라지는 안전한 쪽이고 규칙 이름이 화면에 표시된다.
2. `Key (…)=(…)`의 값 안에 닫는 괄호가 들어가면(`Key (name)=(foo (bar))`) 출력에 괄호 하나가 남는다(`Key (name)=(?))`). **값은 새지 않고** 모양만 지저분하다.
3. 값이 큰따옴표로 오는 오류 문구는 **알려진 5종만** 처리한다. Postgres 문구는 버전마다 늘어나므로, 새로 발견되면 `PG_QUOTED_VALUE_MESSAGES`에 추가하면 된다(식별자 `"테이블명"`을 건드리지 않으려고 일부러 허용 목록 방식으로 뒀다).
4. `createPgLogValueMasker()`는 **줄 순서가 보장될 때만** 정확하다. 로그 스택이 줄을 섞어 주면(멀티 컨테이너 병합 등) 연속행 판정이 빗나갈 수 있다 — 그때도 무상태 `maskPgLogValues`가 걸러 주는 범위는 그대로다.

### 8. 다른 담당 요청

**backend 요청 1 (logs `sql_statement` 규칙 구현).** 규칙을 새로 쓰지 말고 이걸 부르면 된다.
```ts
import { createPgLogValueMasker } from '../database/health/sanitize';
const mask = createPgLogValueMasker();   // 조회 1건(스트림 1개)당 하나 만들어 줄 순서대로 부른다
lines.map(mask);
// 줄 순서를 보장할 수 없으면 무상태 버전: maskPgLogValues(line)
```
- **줄 전체에 `maskSqlLiterals`를 돌리지 말 것.** 타임스탬프·PID가 `?`가 된다(3절).
- 이 함수는 `sql_statement` 규칙 **하나**다. `kv_secret`·`conn_string` 등 다른 규칙과 함께 돌려야 한다.
- 가림 여부를 화면에 표시하려면 입력과 출력을 비교하면 된다(함수가 건드리지 않았으면 문자열이 동일하다).

**planner 요청 2 (없음).** AC-LOG49 기준을 그대로 만족하는 것을 테스트로 확인했다. 명세는 손대지 않았다.

**PM 요청 3 (내 권고의 정정 기록).** 앞 섹션(21:30) 7절 (4) 권고 A는 "**`maskSqlLiterals()`/`sanitizeQueryText()`를 그대로 재사용하면 된다**"였는데 **그대로는 부족했다.** 지금은 `maskPgLogValues()`/`createPgLogValueMasker()`를 쓰는 것으로 대체된다. backend에 전달된 내용이 옛 권고면 갱신 부탁한다.

### 9. 다음 담당이 알아야 할 점

- **진입점은 `createPgLogValueMasker()`**(여러 줄 지원) 또는 `maskPgLogValues()`(무상태). `maskSqlLiterals()`는 그 안에서 쓰는 저수준 부품이지 로그 줄에 직접 쓰는 것이 아니다.
- 값 가림 규칙을 늘릴 때 고칠 곳은 여전히 **세 곳**: `sanitize.ts`, `sanitize.spec.ts`, `docs/db/health.md` 6절.
- `redactSecrets`는 이제 `Key (col)=(값)`·`Failing row contains (…)`도 가린다. DB 상태 조회 쪽 동작에는 회귀가 없다(테스트로 고정).

---

## 2026-09-25 00:20 · 발송 상태 enum 2개 추가 + 배지 인덱스 재검토

### 1. 요청 내용

PM 두 건(작업 중 두 번째가 들어왔다).

1. **`alert_delivery_status`에 `skipped_no_pair`·`skipped_circuit_open` 추가.** 현재 10개로는 ① AC-ALERT32(짝 없는 해제)가 "안 보냄"인지 "실패"인지 ② 연속 실패 1시간 차단으로 건너뛴 것과 실제 발송 실패를 기록으로 구분할 수 없다. **기존 행·값을 잃지 말 것**(`cost_rate_samples` 때와 같은 수준), 마이그레이션이 실제로 도는지 검증할 것.
2. **배지 인덱스 재검토.** `alerts.snapshot`(SSE)에서 목록이 빠져 빈도 전제가 바뀌었다 — 조회 ①(최근 N건)은 **`/alerts` 화면 전용**, 조회 ②(미확인 수 + 최악 심각도)는 **모든 탭·모든 재연결마다 불리는 유일한 조회**. planner가 "**집계 한 방으로 끝나는 형태**"를 권했다. 바꿀 필요가 없으면 "그대로 간다"로 보고.

제약: `src/alerts/**`는 **backend가 동시에 구현 중**이라 건드리지 말 것. 포트 3111, 자기 PID만.

### 2. 참고한 문서

- `docs/reports/alerts/README.md`, 이 파일 앞 섹션 2.13(조회 패턴)·4절(배지 인덱스 근거)
- `docs/specs/alerts.md` 3.3.2(연속 실패 차단)·3.2.1(해제 알림은 짝이 있을 때만)·AC-ALERT32
- `docs/db/migrations/20260919150000_advisor_contract.down.sql` — enum 값 제거의 기존 방식(타입 재생성)

### 3. 작업 내용

#### 3.1 enum 2개 추가 (`20260924200000_alert_delivery_skip_reasons`)

```sql
ALTER TYPE "alert_delivery_status" ADD VALUE 'skipped_no_pair'      AFTER 'skipped_unknown_off';
ALTER TYPE "alert_delivery_status" ADD VALUE 'skipped_circuit_open' AFTER 'skipped_flapping';
```

- **기존 데이터가 안전한 이유**: `ADD VALUE`는 카탈로그에 값만 덧붙인다. 테이블 재작성·`USING` 캐스팅·타입 교체가 **없고**, 이 마이그레이션은 **어떤 테이블도 읽거나 쓰지 않는다.** `cost_rate_samples` 때 `DROP+ADD` 대신 `RENAME`을 골랐던 것과 같은 기준(행을 건드리지 않는 경로를 고른다)이다.
- **`AFTER`를 붙여 손으로 썼다.** Prisma가 생성하는 SQL은 두 값을 **맨 뒤에** 붙이는데, 그러면 `schema.prisma`의 선언 순서(논리적 묶음: "판단해서 안 보냄" 다음에 `skipped_no_pair`)와 DB의 정렬 순서가 어긋난다. `AFTER`로 맞추고 **드리프트가 없는 것을 확인**했다.
- **트랜잭션**: Prisma migrate는 마이그레이션을 트랜잭션으로 감싼다. Postgres 12+는 트랜잭션 안 `ADD VALUE`를 허용하고 제약은 "같은 트랜잭션에서 그 값을 **쓸 수는** 없다"인데, 이 마이그레이션은 값을 쓰지 않는다. 실제로 `migrate deploy`가 통과하는 것으로 확인했다.
- **down은 손실이 있다.** Postgres에 enum 값 삭제가 없어 타입을 다시 만든다. `skipped_no_pair` → `skipped_severity`(짝 없는 해제의 가장 흔한 원인이 심각도 하한이라 성격이 같다), `skipped_circuit_open` → `failed`(회로가 열린 원인이 연속 실패라 실패 계열에 남는 편이 사실에 가깝다). **구분이 사라지는 것이 되돌리기의 본질**이므로 파일 머리말에 못 박았다. 다른 열(시도 횟수·시각·응답 코드·오류)과 다른 표는 그대로다.

#### 3.2 배지 조회 재검토 — **인덱스는 그대로, 질의 형태를 바꿨다**

빈도 전제가 바뀌었으니 **최악 상황을 새로 만들어** 다시 쟀다. 앞서(21:30) 잰 조건은 "2,000건 중 미확인 5건"이었는데, 이건 낙관적이다. 해제 알림은 **화면 이력의 완결성 때문에 항상 만들지만 배지에는 안 센다**(명세 3.2.1·3.3.1) → **안 읽은 해제 알림이 자연히 쌓인다.** 그래서 "미확인 2,000건인데 그중 1,990건이 `resolved`"로 다시 쟀다.

측정 (PGlite, `VACUUM ANALYZE` 후):

| 질의 형태 | 읽은 인덱스 항목 | buffers | 시간 |
|---|---|---|---|
| `GROUP BY severity` + `severity <> 'resolved'` (앞서 문서에 적은 형태) | 2,000 (1,990 버림) | 5 | 0.53 ms |
| 집계 1행 + `<>` | 2,000 (1,990 버림) | 5 | 0.33 ms |
| **집계 1행 + `severity < 'resolved'`** | **10** | **3** | **0.094 ms** |
| 집계 1행 + `IN (critical,warning,unknown)` | 10 | 3 | 0.103 ms |

- **`VACUUM` 전(= 방금 쓰기가 몰린 상태)에는 `<>` 형태가 아예 `Seq Scan`으로 떨어졌다**(2,490행 필터, 46 buffers). `<` 형태는 그 상태에서도 Bitmap Index Scan을 유지했다(3 buffers). 알림 표는 계속 쓰이는 표라 이 상태가 드물지 않다 — **이게 결정적이었다.**
- 이유: `<>`는 인덱스로 좁히지 못하고 **스캔 후 버리는 필터**가 된다. `resolved`가 enum의 **마지막** 값이라 `<`는 뜻이 같으면서 **인덱스 경계**가 된다.

채택한 형태 (1행으로 끝난다 — planner가 권한 "집계 한 방"):

```sql
SELECT count(*) AS unread, min(severity) AS worst
  FROM alerts
 WHERE data_source = $1 AND acknowledged_at IS NULL AND severity < 'resolved';
```

- **`min(severity)`가 곧 최악 심각도다.** enum을 `critical, warning, unknown, resolved` 순으로 선언했고 그 순서가 `docs/api/common.md` 2.1의 집계 우선순위와 같기 때문이다. 백엔드에 정렬·비교 코드가 필요 없다.
- 행이 0건이어도 **항상 1행**(`unread=0, worst=null`)이 온다.
- **인덱스 `(data_source, acknowledged_at, severity)`는 그대로 간다.** 세 열이 전부 인덱스 조건이 되어 **Index Only Scan(Heap Fetches 0)**으로 끝난다. 빈도 전제가 바뀐 뒤에도 열을 더하거나 순서를 바꿀 이유가 없었다. 조회 ①용 `(data_source, occurred_at DESC)`도 보존 정리가 함께 쓰므로 그대로 둔다.
- 부분 인덱스는 여전히 쓰지 않는다(Prisma로 표현 불가 → 상시 드리프트, 위 측정대로 이득도 없다).

**새로 생긴 불변식을 테스트로 고정했다.** 위 질의는 enum 선언 순서에 기댄다(첫 값 = 최악, 마지막 값 = `resolved`). 순서가 바뀌면 질의가 **조용히 틀린 답**을 낸다 → `src/database/alerts-json.spec.ts`가 선언 순서를 검사한다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | 수정 | `AlertDeliveryStatus`에 값 2개(+ 각 값의 뜻·"값을 지우지 않는다" 주석) |
| `apps/api/prisma/migrations/20260924200000_alert_delivery_skip_reasons/migration.sql` | 추가 | `ADD VALUE … AFTER` 2줄 + 안전성 근거 주석 |
| `docs/db/migrations/20260924200000_alert_delivery_skip_reasons.down.sql` | 추가 | 값 이동 후 타입 재생성(손실 명시) |
| `apps/api/src/database/alerts-json.spec.ts` | 추가 | enum 선언 순서 불변식 + 새 값 2개 + 알림 키 테스트 6건 |
| `docs/db/schema.md` | 수정 | 2.9 enum 12개·두 값의 뜻, 2.13 조회 빈도 전제, **4절 배지 질의 근거 전면 개정(측정표 포함)**, 5절 마이그레이션·검증 기록 |

`src/alerts/**`는 **손대지 않았다**(backend 동시 작업).

### 5. 주요 결정과 이유

**A. `AFTER`로 순서를 맞춘다.** 그냥 `ADD VALUE`(Prisma 기본)면 DB는 맨 뒤, 스키마 파일은 중간이 된다. 순서가 어긋나도 지금은 드리프트로 안 잡히지만, enum 정렬 순서는 `ORDER BY`·`min()`의 의미를 바꾸는 값이라 **파일과 DB가 같아야** 나중에 읽는 사람이 속지 않는다.

**B. down에서 `skipped_circuit_open`을 `failed`로 보낸다.** `skipped_*` 아무 값으로나 보내면 "보내지 않기로 판단했다"로 읽혀 사실과 멀어진다. 회로가 열린 **원인이 연속 실패**이므로 실패 계열이 오해가 적다.

**C. 배지 질의를 `<>`에서 `<`로 바꾼다.** 앞서 "그대로 충분하다"고 볼 수도 있었지만, **측정 조건을 현실적으로 바꾸니 결론이 달라졌다.** 해제 알림이 안 읽은 채 쌓이는 것은 예외가 아니라 기본 동작이다. 인덱스를 바꾸지 않고 질의 한 줄로 5배(미VACUUM 상태에서는 Seq Scan 회피) 차이를 얻으므로 비용이 없다.

**D. `IN` 대신 `<`.** 둘 다 같은 성능이다. `<`는 "해제를 뺀 나머지"라는 뜻을 그대로 옮기고 심각도 값이 하나 늘어도 자동으로 포함된다. 순서 의존이 부담이면 `IN`으로 바꿔도 인덱스·성능이 같다는 것을 문서에 적어 뒀다.

**E. 인덱스를 바꾸지 않았다.** planner의 "집계 한 방" 요구는 **질의 형태**의 문제였고 인덱스는 이미 맞았다. 열을 더하면 삽입·삭제만 느려진다.

### 6. 검증 결과

PGlite(Postgres 17.5) + pglite-socket, **포트 3111**만 사용. 스크립트가 자기 프로세스 안에서 소켓을 닫고 끝나 남는 PID가 없다.

**enum 마이그레이션 — 18개 확인 전부 통과**

| 확인 | 결과 |
|---|---|
| 사전 상태: enum 10개, 기존 10개 상태를 하나씩 쓰는 발송 기록 10건 | 통과 |
| 트랜잭션 안에서 `ADD VALUE` 성공 (PG12+ 동작) | **통과** |
| **기존 발송 기록 10건의 상태·시도 횟수·응답 코드·오류 메시지가 그대로** | **통과** |
| 기존 `alerts`·`cost_rate_samples`·`settings` 보존 | 통과 |
| enum 12개 + **순서가 `schema.prisma` 선언과 일치** | 통과 |
| 새 값 2개로 실제 저장 | 통과 |
| 드리프트 없음 | 통과 |
| down: `skipped_no_pair`→`skipped_severity`, `skipped_circuit_open`→`failed`(attempts 7 유지) | 통과 |
| down: 원래 10건은 상태·다른 열 모두 무변경, enum 10개 복귀, 기록 삭제, 다른 표 그대로 | 통과 |
| 재적용 후 enum 12개·순서 동일·드리프트 없음·`migrate status` 최신 | 통과 |

**배지 질의 — 10개 확인 전부 통과** (형태 4종 × 최악/평상시, mock·live 분리, 0건일 때 1행, `모두 확인` 후 0)

**전체 체인 (새 DB)**: 마이그레이션 6개 적용 → 시드 → 드리프트 없음 → `migrate status` 최신 → 표 12개·settings 11행.

**코드**: `tsc --noEmit` 0에러, `eslint src/database/**` 통과, `jest` **46 suites / 508 passed, 2 skipped**(직전 502 → +6).

**하지 않은 검증 / 그대로 적는 것**

- **실제 Postgres 16 미검증**(Docker·psql 없음)은 그대로다. `ALTER TYPE … ADD VALUE … AFTER`는 PG 9.1/12 이후 기능이라 16에서 문제될 것이 없지만 실기 확인은 월요일 항목이다.
- 성능 측정은 **PGlite(단일 연결, 메모리)** 기준이다. 절대 수치(0.09ms)가 아니라 **형태 사이의 상대 차이**(읽은 인덱스 항목 10 vs 2,000, Seq Scan 회피)를 근거로 삼았다. 이 차이는 엔진이 같은 플래너를 쓰므로 실제 Postgres에서도 방향이 같다.
- **동시 접속 부하(탭 20개가 동시에 재연결)는 재현하지 못했다.** PGlite가 한 번에 한 연결만 받는다.
- `npx eslint "src/**/*.ts"` 전체 실행 시 **`src/alerts/alert-rules.ts`·`alerts.types.ts`에 prettier 오류 2건**이 보였다. **backend 작업 중인 파일이라 건드리지 않았다**(7절).

### 7. 남은 이슈·한계

1. **enum 선언 순서가 배지 질의의 전제다.** 테스트로 고정했지만, 값을 추가할 때 `resolved` **뒤에** 넣으면 배지에 포함된다. 새 심각도를 넣을 일이 생기면 위치를 의식해야 한다.
2. down의 값 매핑은 **되돌릴 수 없다**(원래 값으로 복원 불가). 운영 중 롤백이면 먼저 `pg_dump -t alert_deliveries`.
3. `skipped_no_pair`/`skipped_circuit_open`을 **누가 언제 쓰는지는 backend 구현에 달려 있다.** DB는 값을 받을 준비만 됐다.
4. 앞 섹션들의 한계(실제 PG16 미검증, 대상 DB 로깅 설정 미확인, 동시성 미측정)는 그대로다.

### 8. 다른 담당 요청

**backend 요청 1 (배지 질의 — 계약에 반영 바람).** SSE 스냅샷의 배지 값은 이 한 줄로 끝난다.
```sql
SELECT count(*) AS unread, min(severity) AS worst
  FROM alerts
 WHERE data_source = $1 AND acknowledged_at IS NULL AND severity < 'resolved';
```
- **`severity <> 'resolved'`로 쓰지 말 것.** 인덱스 경계가 필터로 바뀌어, 안 읽은 해제 알림이 쌓이면 Seq Scan까지 떨어진다(6절 측정).
- `min(severity)`가 최악 심각도다. 백엔드에서 따로 정렬하지 않는다.
- Prisma로 쓰면 `groupBy`/`aggregate`가 이 형태를 못 만들 수 있다. 그때는 `$queryRaw`가 낫다(질의가 고정이고 파라미터가 `data_source` 하나뿐이다).
- 배지는 알림 생성·확인 때만 바뀐다. 결과를 메모리에 들고 변화 때만 다시 계산하면 재연결이 몰려도 질의 1회로 끝난다(필수는 아니다).

**backend 요청 2 (새 enum 값).** `skipped_no_pair`는 AC-ALERT32에서, `skipped_circuit_open`은 연속 실패 차단(기본 10회 → 60분) 중 건너뛸 때 쓴다. **`failed`로 뭉뚱그리지 말 것** — 이 둘을 나누려고 마이그레이션을 추가했다. 적용은 `npx prisma migrate deploy` + **`npm run prisma:generate --prefix apps/api`**(enum이 늘었으므로 클라이언트 재생성 필요).

**backend 요청 3 (lint).** `src/alerts/alert-rules.ts:352`와 `src/alerts/alerts.types.ts:118`에 prettier 오류가 있다. 내 영역이 아니라 두었다 — `npx eslint --fix src/alerts` 한 번이면 된다.

### 9. 다음 담당이 알아야 할 점

- **마이그레이션이 6개가 됐다.** 적용 순서·되돌리기 역순은 `docs/db/schema.md` 5절에 있다. 되돌릴 때는 `20260924200000_alert_delivery_skip_reasons.down.sql`이 **가장 먼저**다.
- **enum 값을 지우지 않는다.** Postgres는 enum 값 삭제가 없어 타입을 다시 만들어야 하고 그 과정에서 행의 값이 바뀐다. 필요 없어진 값은 쓰지 않고 두는 편이 싸다.
- 배지 질의의 근거·측정표는 `docs/db/schema.md` **4절**, 조회 패턴 요약은 **2.13**에 있다.
- enum 순서 불변식은 `src/database/alerts-json.spec.ts`가 지킨다. 이 테스트가 깨지면 **배지 질의부터 다시 보라**는 신호다.
