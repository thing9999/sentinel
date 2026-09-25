# API 계약: alerts

- 작성: backend, 2026-09-25 (3단계 계약. **구현 전**)
- 공통 규약: `docs/api/common.md` (prefix `/api`, 에러 형식, `StatusInfo`, 단위, SSE 봉투·heartbeat·재연결, mock 시나리오)
- 명세: `docs/specs/alerts.md` (P1 AC-ALERT01~18·35·36, P2 AC-ALERT19~34) / 결정 정본: `docs/reports/alerts/README.md`
- 디자인: `docs/design/alerts.md`, `docs/design/settings.md`, `docs/design/components.md` 20~21절 (`AlertItem`·`AlertGapRow`·`SecretInput`)
- 관련 계약: `docs/api/cluster-status.md`(`StatusInfo`·`areas`·`nav`), `docs/api/aws-cost.md` 6절(설정 API 선례), `docs/api/logs.md`(알림 → 로그 **링크만**)
- 이 문서가 정하는 것은 **브라우저 ↔ api** 계약이다. 디스코드로 나가는 메시지의 **담을 정보**는 4절에 있고, 실제 임베드 형식은 구현이 정한다.

---

## 0. 요약

### 0.1 화면 ↔ 엔드포인트

| 화면 | REST | SSE |
|---|---|---|
| 사이드바 `알림` 배지 + 브라우저 탭 제목 (모든 화면) | `GET /api/alerts/badge` | 토픽 `alerts` → 모든 이벤트의 `badge` |
| `/alerts` 목록·필터·정지 구간 | `GET /api/alerts` | 〃 (`alerts.created`/`alerts.updated`로 행 추가·갱신) |
| `/alerts` 항목 확장 영역 | `GET /api/alerts/:id` | — |
| 확인(읽음) 처리 | `PATCH /api/alerts/read` | `alerts.read` |
| `/settings → 알림` | `GET /api/alerts/settings`, `PATCH /api/alerts/settings` | `alerts.snapshot`(발송 설정 요약) |
| 테스트 발송 대화상자 | `GET /api/alerts/test/preview` → `POST /api/alerts/test` | — |

- **상단바에 붙는 엔드포인트는 없다.** 종(벨)·알림 패널을 만들지 않기로 확정됐다(사용자 결정 Q1, AC-ALERT36).
- **"최근 N건 패널"용 응답을 만들지 않는다.** 목록이 필요한 화면은 `/alerts` 하나뿐이고, 그 화면만 `GET /api/alerts`를 부른다. 모든 페이지가 구독하는 스트림에는 **이력 목록을 싣지 않는다**(6.1 근거).

### 0.2 "쓰기"의 층 구분 (명세 0.2 — 계약에서도 섞어 적지 않는다)

| 층 | 대상 | 이 계약에서 | 근거 |
|---|---|---|---|
| ① 관측 대상 쓰기 | 쿠버네티스 · AWS · 모니터링 대상 Postgres | **없다. 하나도 늘지 않는다.** 새 조회도, 새 `SourceId`도, 새 RBAC·IAM도 만들지 않는다 | 조회 전용 원칙 (`CLAUDE.md`) |
| ② 대시보드 자체 상태 쓰기 | 대시보드 DB(Prisma): 알림 이력·발송 기록·`settings`·heartbeat | **있다.** `PATCH /api/alerts/read`, `PATCH /api/alerts/settings` — 기존 `PATCH /api/cost/settings`와 **같은 성격** | `common.md` 0 요약 "쓰기" 행 |
| ③ 밖으로 나가는 통지 | 사용자가 지정한 디스코드 웹훅 | **있다(선택).** `POST /api/alerts/test`와 알림 발송 큐. 단방향이고 관측 대상을 바꾸지 않는다 | 이번에 새로 생기는 층. 기본 꺼짐(주소 미설정), mock 차단, 테스트는 명시 확인 |

③만 **되돌릴 수 없는 외부 효과**다. 그래서 ③에만 별도 안전장치가 붙는다: 도메인 제한(3.2), mock 차단(5절), `confirm: true`(2.7), 60초 쿨다운(2.7), 억제·플래핑·심각도 하한(1.4·4.3).

### 0.3 알림 본문·이력·SSE에 **로그가 들어가지 않는다** (계약 수준 금지)

`docs/specs/alerts.md` 3.3.2 / AC-ALERT13 / `docs/specs/logs.md` 6절 (PM 결정 2026-09-25).

- 이 문서의 어떤 응답·이벤트에도 **컨테이너 로그 줄을 담을 필드가 없다.** 가림 처리한 줄도, 로그에서 뽑은 문장·오류 메시지도, `logLineCount`·`errorLines`·`lastLogLine` 같은 **요약·통계 필드도 없다.**
- **나중에도 추가하지 않는다.** 필드를 늘리고 싶어지면 그것은 `docs/api/logs.md`의 일이다. 알림과 로그를 잇는 것은 **링크 한 개**(`logHref`, 2.2)뿐이다.
- 이 금지는 채널(디스코드)만이 아니라 **화면 알림 센터·SSE·이력 저장 전부**에 적용된다. 알림 본문은 한 벌이고 화면과 채널이 같은 내용을 쓴다.
- 알림 본문에 들어가는 문자열은 **서버가 만든 `Reason.text`와 `ResourceRef`뿐**이고 둘 다 이미 `redactSecrets` + 길이 제한을 거친다(`common.md` 1.4).
- **구조적 보강(DBA 설계, 2026-09-25)**: 대시보드 DB는 알림 본문 문자열을 저장하지 않고 **구성요소(코드·사유·대상)로 저장했다가 표시할 때 조립**한다. 그래서 **로그 줄이 들어올 자리가 구조적으로 없다.** 이 계약도 같은 전제로 쓴다.
- 검증(AC-ALERT13): `GET /api/alerts`·`GET /api/alerts/:id`·`alerts.*` 이벤트의 JSON 전체를 문자열로 만들어 mock 로그 픽스처(`logs` mock `secrets`·`direct`)의 특징 문자열이 **0건**인지 확인한다.

### 0.4 알림 이력을 **어드바이저로 보내지 않는다**

- 어드바이저 스냅샷(`AdvisorSnapshotV1`, `architecture-advisor.md` B.2)에 **알림 이력·알림 본문·알림 요약을 넣지 않는다.**
- 이유: 알림 본문에는 리소스 이름이 **원문 그대로** 들어간다(사용자 결정 Q3, kOps 노드 = `i-0abc…`). 어드바이저 스냅샷은 노드 이름을 **가명 처리**하게 돼 있다(AC-KOPS44). 알림 이력이 스냅샷에 섞이면 **그 가명 규칙이 통째로 우회된다.**
- 스냅샷 스키마는 허용 목록 방식이라 기본적으로 막히지만, 여기에 명시적으로 적어 다음 사람이 "최근 알림 몇 건쯤은"을 하지 않게 한다. `logs`의 로그 본문 금지(`architecture-advisor.md` 3.4)와 같은 성격이다.
- 검증: 어드바이저 스냅샷 JSON 전체에 mock 알림 픽스처의 특징 문자열이 0건.

---

## 1. 공통 타입

### 1.1 키·심각도·종류

```ts
// 상태 전이를 감시하는 알림 키 8개 (DBA `ALERT_KEYS`와 같은 값)
type AlertAreaKey =
  | 'area:controlPlane'   // 마스터 대수·Ready·쿼럼·static pod 구성요소
  | 'area:nodes'          // 워커 노드
  | 'area:workloads'
  | 'area:pods'
  | 'area:events'
  | 'area:db'
  | 'area:cost'
  | 'source:kube';        // 쿠버네티스 출처 자체의 끊김·인증 실패

// 영역이 없는 시스템 키 2개. 상태 머신이 없다(전이가 없다). DBA `ALERT_SYSTEM_KEYS`와 같은 값
type AlertSystemKey = 'system:restart' | 'system:test';

type AlertKey = AlertAreaKey | AlertSystemKey;

type AlertArea = 'controlPlane' | 'nodes' | 'workloads' | 'pods' | 'events' | 'db' | 'cost' | 'source' | 'system';

type AlertSeverity = 'critical' | 'warning' | 'unknown' | 'resolved';

type AlertKind =
  | 'transition'        // ok → warning/critical, unknown → warning/critical, 추가 발생
  | 'escalation'        // warning → critical
  | 'resolve'           // warning/critical/unknown → ok
  | 'flapping'          // 플래핑 진입 묶음
  | 'restart_summary'   // 워밍업 종료 요약
  | 'test';             // 테스트 발송
```

- **상태를 감시하는 키는 8개뿐이다.** 개별 파드·노드 단위 키는 다음 범위(P3)다. 파드 50개가 동시에 죽어도 알림은 `area:pods` 1건이다(명세 3.1 근거 1).
- `system:restart`(워밍업 요약)·`system:test`(테스트 발송)는 **감시 대상이 아니다.** `/alerts` 화면의 **영역 필터 목록에는 8개만** 넣고(`area=system`으로 거르는 UI를 만들지 않는다), `watch.keyCount`도 8이다. 이 두 종류는 `area` 필터를 걸면 결과에서 빠진다(정지 구간 줄은 `gaps[]`라 그대로 남는다 — 2.1).
- `severity`는 서버가 이미 계산한 `StatusInfo.status`를 **그대로 옮긴 값**이다. 새 등급을 만들지 않는다.
- `severityLabel`(`장애`/`주의`/`확인 불가`/`해제`)과 `areaLabel`(`컨트롤 플레인`/`파드`/`비용`/`쿠버네티스 연결`…)을 **서버가 문자열로 준다.** 화면이 코드 → 문구 매핑 표를 갖지 않는다.
- **`unknown` 알림의 어떤 문자열에도 "장애"라는 낱말을 넣지 않는다**(명세 3.2.4).
- 알림 키 ↔ 상태 출처: `area:*`는 `GET /api/overview`의 `areas.*.status`(비용은 `cost.status`), `source:kube`는 `SourceStatus(kube)`. **알림 계층은 상태를 다시 판단하지 않는다.**

### 1.2 `AlertTarget` (영향 객체)

```ts
interface AlertTarget {
  ref: ResourceRef;            // common.md 7절 { kind, namespace, name }. 이름은 원문 그대로 (사용자 결정 Q3)
  status: Status;
  reason: string;              // 짧은 한 줄 ("CrashLoopBackOff", "NotReady 4분"). areas.*.problems[].reason 재사용
  href: string | null;         // 그 리소스 화면
}
```
- 목록(`GET /api/alerts`)은 **최대 3개**, 상세(`GET /api/alerts/:id`)는 **최대 10개**. 전체 수는 항상 `targetTotal`로 준다(화면 `외 N개` = `targetTotal - targets.length`).
- kOps에서 노드 이름은 EC2 인스턴스 ID(`i-0…`)다. **가리지 않는다**(사용자 결정 Q3). 이름을 만드는 자리는 서버 한 곳에 모은다.

### 1.3 `AlertItem`

```ts
interface AlertItem {
  id: string;                          // uuid
  key: AlertKey;
  area: AlertArea;
  areaLabel: string;                   // '컨트롤 플레인' | '파드' | '비용' | '쿠버네티스 연결' …
  severity: AlertSeverity;
  severityLabel: string;               // '장애' | '주의' | '확인 불가' | '해제'
  kind: AlertKind;

  transition: { from: Status | null; to: Status } | null;   // restart_summary·test는 null
  reason: Reason | null;               // 서버가 만든 대표 사유(reasons[0]) 그대로. 알림이 문장을 새로 쓰지 않는다
  targets: AlertTarget[];
  targetTotal: number;

  occurredAt: string;                  // 발생 시각 (목록 정렬 기준)
  lastSeenAt: string;                  // 마지막 갱신(합쳐진 사건 포함)
  resolvedAt: string | null;
  durationMs: number;                  // 지속 시간 (서버 계산. 1.3.1)

  repeatCount: number;                 // 억제 창에 합쳐진 사건 수. 1이면 화면 표시 없음
  dedupe: { windowMin: number; lastEventAt: string };
  flapping: { active: boolean; transitions: number; windowMin: number } | null;
  suppressedAreas: number;             // source:kube 알림이 묶은 영역 수 (화면 '영향 영역 5개'). 없으면 0
  unknownGap: { from: string; to: string | null; minutes: number } | null;  // 확인 불가 구간 (4.3)
  mitigations: { at: string; from: Status; to: Status }[];                  // critical → warning 완화 기록

  relatedAlertId: string | null;       // 격상·해제의 짝
  relation: 'escalated_from' | 'resolves' | null;

  restart: {                           // kind === 'restart_summary'
    warmupSec: number;
    counts: { critical: number; warning: number; unknown: number };
    gap: AlertGap | null;              // 정지 구간 (2.1의 gaps[]와 같은 모양)
  } | null;

  href: string | null;                 // 항목 전체가 링크. 알림 키 → 화면 (2.2 표)
  logHref: string | null;              // 로그 화면 링크. 로그 줄은 없다 (2.2)
  logTarget: AlertLogTarget | null;    // 로그 링크의 대상 정보 (2.2)

  read: boolean;
  readAt: string | null;

  dispatch: DispatchRecord[];          // 채널별 발송 기록. 1.4
  dataSource: DataSource;              // 'mock' | 'live'
  createdAt: string;
}
```

#### 1.3.1 `durationMs` (화면이 시계로 계산하지 않는다)

- **해제된 알림**: `resolvedAt - occurredAt`의 확정값.
- **진행 중인 알림**: 응답의 `generatedAt`(또는 이벤트의 `emittedAt`) 기준 값. 화면은 이 값을 시작점으로 쓰고 `occurredAt` + 서버 시각(`stream.heartbeat.serverTime`)으로 이어서 센다(`common.md` 1.5).
- `kind: 'restart_summary'`·`'test'`는 `0`.

**상세(`GET /api/alerts/:id`)에만 있는 것**

```ts
interface AlertDetail extends AlertItem {
  messagePreview: string;              // 디스코드로 보낼(보낸) 본문 전문. 4절 규칙을 통과한 문자열. 웹훅 URL은 없다
  transitions: { at: string; from: Status; to: Status }[];   // 플래핑 묶음의 전이 타임라인 (최대 20)
  suppressedKeys: { key: AlertKey; label: string }[];        // source:kube 알림이 묶은 영역 목록
  dispatchAttempts: {
    at: string;
    channel: 'discord';
    state: DispatchState;
    responseCode: number | null;
    detail: string | null;             // 가림 처리된 한 줄
  }[];
}
```

### 1.4 `DispatchRecord` (발송 상태)

```ts
type DispatchState =
  | 'pending'                    // 큐에 있음 (429 대기·백오프 포함)
  | 'sent'
  | 'failed'                     // 백오프 3회 후 포기
  | 'skipped_disabled'           // 디스코드 알림 끄기
  | 'skipped_not_configured'     // 웹훅 주소 없음 (오류가 아니다)
  | 'skipped_severity'           // 심각도 하한에 걸림
  | 'skipped_unknown_off'        // sendUnknown 꺼짐
  | 'skipped_flapping'           // 플래핑 진입 후 그 키의 발송 정지
  | 'skipped_mock'               // ALERTS_DISPATCH=mock → 아웃바운드 0건
  | 'skipped_restart'            // 발송 대기 중 API 재시작 (자동 재발송하지 않는다)
  | 'skipped_no_pair'            // 발생 알림을 보내지 않은 것의 해제 (AC-ALERT32) ★ 디자인 union에 없던 값
  | 'skipped_circuit_open';      // 연속 실패 10건으로 1시간 발송 정지     ★ 디자인 union에 없던 값

interface DispatchRecord {
  channel: 'discord';
  state: DispatchState;
  label: string;                 // 화면 칩 문구 ('보냄' | '미설정' | '제외(심각도)' | '실패' | '보내지 않음(mock)' …)
  at: string | null;             // 마지막 시도 시각
  attempts: number;
  responseCode: number | null;
  detail: string | null;         // 가림 처리된 한 줄. 웹훅 URL·토큰 없음
  nextRetryAt: string | null;    // 429 Retry-After·백오프 대기 중일 때
}
```

- **`dispatch[]`에는 `discord` 채널만 담는다.** 화면 알림 센터(`ui`)는 항상 성공하고 끌 수도 없어서 정보가 아니다(디자인 4.3 "채널이 `ui`인 기록은 그리지 않는다").
- **규칙상 발송하지 않는 알림은 기록을 만들지 않는다**(`dispatch: []`). `kind: 'restart_summary'`가 그렇다 — 재시작은 사용자가 한 일이라 채널로 보내지 않는다(명세 3.2.5). 디자인은 "디스코드 기록이 없으면 칩을 그리지 않는다"이므로 그대로 맞는다.
- ★ 표시한 두 값은 디자인 `components.md` 20절의 `DispatchState` union에 없다. **둘 다 "제외" 계열 칩**으로 그리면 된다(퍼블리셔·프론트 요청, 13절).
- **화면은 이 판정을 다시 하지 않는다.** "주의라서 안 보냈다", "플래핑이라 멈췄다"는 전부 서버가 정해 `state`로 내려보낸다.
- `skipped_*`는 **오류가 아니다.** 화면에서 빨간색·배너·토스트를 쓰지 않는다(AC-ALERT19).

### 1.5 `AlertGap` (정지 구간 — 알림이 아니다)

```ts
interface AlertGap {
  id: string;
  from: string;
  to: string | null;             // null이면 '지금'까지
  minutes: number;               // 서버 값
  unknownPrevious: boolean;      // true면 '이전 실행 기록 없음' (대시보드 DB 없음)
}
```
- 대시보드가 **보지 못한 구간**이다. 알림 목록과 같은 시간 축에 끼워 그리지만 심각도·읽음·발송·링크가 없다(디자인 `AlertGapRow`, `components.md` 20.2).
- 서버가 60초마다 남기는 heartbeat로 계산한다. 대시보드 DB가 없으면 계산할 수 없고 `unknownPrevious: true`로 준다(AC-ALERT10).

---

## 2. REST

### 2.1 `GET /api/alerts` (이력 목록 — `/alerts` 화면 전용)

| 쿼리 | 형식 | 기본 | 설명 |
|---|---|---|---|
| `range` | `1h` \| `24h` \| `7d` \| `30d` \| `all` | **`24h`** | 기간 지름길(디자인 3.2). `from`/`to`와 함께 보내면 400 |
| `from`, `to` | ISO UTC | 없음 | `occurredAt` 기준 직접 지정 |
| `severity` | `critical,warning,unknown,resolved` 쉼표 | 전체 | |
| `area` | `AlertArea` 쉼표 | 전체 | |
| `key` | `AlertKey` 쉼표 | 전체 | `area`와 함께 쓰면 AND |
| `kind` | `AlertKind` 쉼표 | 전체 | |
| `includeResolved` | boolean | `true` | `false`면 `severity: resolved`와 `kind: resolve`를 뺀다 |
| `unreadOnly` | boolean | `false` | |
| `limit` | 1~500 | **100** | |
| `offset` | 0~ | 0 | |

- **정렬은 `occurredAt` 내림차순으로 고정이다.** `sort` 파라미터를 두지 않는다(디자인: 사용자가 정렬을 바꾸지 못한다 — 시간 축이 뒤집히면 정지 구간 줄과 전이 흐름이 읽히지 않는다).

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:20:00.000Z",
  "persistence": "database",
  "total": 128, "filteredTotal": 12, "offset": 0, "limit": 100,
  "range": { "id": "24h", "from": "2026-09-24T14:20:00.000Z", "to": "2026-09-25T14:20:00.000Z" },
  "badge": { "unreadCount": 3, "worstSeverity": "critical", "updatedAt": "2026-09-25T14:19:40.000Z" },
  "watch": {
    "lastObservedAt": "2026-09-25T14:02:10.000Z",
    "keyCount": 8,
    "keys": [ { "key": "area:controlPlane", "label": "컨트롤 플레인" }, { "key": "area:nodes", "label": "노드" } ]
  },
  "facets": {
    "severity": { "critical": 3, "warning": 4, "unknown": 1, "resolved": 4 },
    "area": { "pods": 5, "nodes": 2, "controlPlane": 1, "cost": 1, "source": 1 }
  },
  "gaps": [
    { "id": "gap-2026-09-25T09:12", "from": "2026-09-25T09:12:00.000Z", "to": "2026-09-25T09:31:00.000Z", "minutes": 19, "unknownPrevious": false }
  ],
  "items": [
    {
      "id": "c7b1f0e2-6f0e-4a55-9c3e-0d0b5f1a2c11",
      "key": "area:pods",
      "area": "pods",
      "areaLabel": "파드",
      "severity": "critical",
      "severityLabel": "장애",
      "kind": "transition",
      "transition": { "from": "ok", "to": "critical" },
      "reason": { "code": "POD_WAITING_CRASHLOOP", "text": "CrashLoopBackOff · 최근 1시간 재시작 6회", "status": "critical" },
      "targets": [
        {
          "ref": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" },
          "status": "critical",
          "reason": "CrashLoopBackOff",
          "href": "/cluster/pods/prod/api-7f9c8d6b5-x2kq9"
        }
      ],
      "targetTotal": 2,
      "occurredAt": "2026-09-25T14:02:05.000Z",
      "lastSeenAt": "2026-09-25T14:12:05.000Z",
      "resolvedAt": null,
      "durationMs": 1075000,
      "repeatCount": 2,
      "dedupe": { "windowMin": 15, "lastEventAt": "2026-09-25T14:12:05.000Z" },
      "flapping": null,
      "suppressedAreas": 0,
      "unknownGap": null,
      "mitigations": [],
      "relatedAlertId": null,
      "relation": null,
      "restart": null,
      "href": "/cluster/pods",
      "logHref": "/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&container=api&at=2026-09-25T14%3A02%3A05.000Z",
      "logTarget": { "ref": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" }, "gone": false, "deletedAt": null, "stackSearch": false },
      "read": false,
      "readAt": null,
      "dispatch": [
        { "channel": "discord", "state": "skipped_mock", "label": "보내지 않음 (mock)", "at": null, "attempts": 0, "responseCode": null, "detail": null, "nextRetryAt": null }
      ],
      "dataSource": "mock",
      "createdAt": "2026-09-25T14:02:05.000Z"
    }
  ],
  "notices": [
    { "code": "ALERTS_DISCORD_NOT_CONFIGURED", "level": "info", "text": "디스코드 미설정 — 알림이 화면에만 쌓입니다." }
  ]
}
```

| 필드 | 규칙 |
|---|---|
| `watch` | **빈 상태 footer의 근거**(디자인 6.1 D10). `lastObservedAt`은 서버 heartbeat 값이고, `keyCount`는 알림 키 8개다. "알림이 없다"가 "감시가 멈췄다"로 읽히지 않게 하는 유일한 장치라 **목록이 비어도 항상 준다** |
| `facets` | **기간(`range`/`from`·`to`)만 적용한 뒤** 심각도·영역·읽음 필터를 적용하기 **전** 기준 개수다. 필터 컨트롤 옆 숫자가 필터를 걸 때마다 0이 되지 않게 한다. 화면은 세지 않는다(디자인 3.2) |
| `gaps` | **기간과 겹치는 정지 구간 전부.** 심각도·영역·읽음·해제 필터의 영향을 **받지 않는다**(디자인 5.4). `items`와 별도 배열이므로 화면이 필터 결과 배열에서 뺄 수 없다 |
| `filteredTotal` | 필터 후 `items` 전체 수(`gaps` 제외) |
| `notices` | 화면 상단 회색 안내. `ALERTS_DISCORD_NOT_CONFIGURED`, `ALERTS_DISCORD_DISABLED`, `ALERTS_HISTORY_MEMORY_ONLY`(AC-ALERT17), `ALERTS_WARMUP_ACTIVE`, `ALERTS_DISPATCH_MOCK`, `ALERTS_DISCORD_CIRCUIT_OPEN`(+`details.resumeAt`) |

- **`limit` 기본값이 공통 규약(1.3 "생략하면 전체")과 다르다.** 알림 이력은 최대 2,000건까지 쌓이고 화면이 이어 읽으므로 기본 100건을 준다. 이 예외는 이 엔드포인트에만 적용된다(12절).
- **`dataSource`가 다른 알림은 섞지 않는다.** live 프로세스는 mock 알림을 돌려주지 않고, 그 반대도 같다(명세 3.7 A).
- 오류: 400 `VALIDATION_FAILED`. 출처 실패는 200으로 답한다(공통 3.2).

### 2.2 `GET /api/alerts/:id` (상세) · 링크 규칙

**응답 200**: `AlertDetail`(1.3) + `dataSource`·`generatedAt`. 오류: 404 `RESOURCE_NOT_FOUND`.

**`href` 매핑** (서버가 정한다. 화면이 키 → 경로를 다시 매핑하지 않는다)

| key | href | 비고 |
|---|---|---|
| `area:controlPlane` | `/cluster/nodes#control-plane` | 전용 화면 없음(`cluster-status.md` 2.3과 같은 규칙) |
| `area:nodes` | `/cluster/nodes` | |
| `area:workloads` | `/cluster/workloads` | |
| `area:pods` | `/cluster/pods` | |
| `area:events` | `/cluster/events` | |
| `area:db` | `/cluster/db` | |
| `area:cost` | `/cost` | |
| `source:kube` | `/` | 개요 |

#### 2.2.1 `logHref` · `logTarget` — 알림에서 로그로는 **링크만** 건다

```ts
interface AlertLogTarget {
  ref: ResourceRef;                 // 링크가 가리키는 파드 (영향 객체 중 첫 번째 Pod)
  gone: boolean;                    // 서버가 아는 한 이 파드는 지금 존재하지 않는다
  deletedAt: string | null;         // 알면 채운다. 모르면 null (gone이어도 null일 수 있다)
  stackSearch: boolean;             // 외부 로그 스택이 있어 사라진 파드도 찾을 수 있다
  unavailableReason: 'not_a_pod' | 'logs_disabled' | 'namespace_denied' | null;  // logHref가 null인 이유
}
```

| 상황 | `logHref` | `logTarget` |
|---|---|---|
| 영향 객체에 파드가 있고 로그 기능이 켜져 있고 네임스페이스가 차단되지 않음 | **있다** | `gone`은 지금 사실대로 |
| **그 파드가 이미 사라졌다** | **있다(그대로 준다)** | `gone: true` + 알면 `deletedAt` → 화면은 `삭제됨` 칩을 붙이고 링크는 살려 둔다 |
| 영향 객체가 파드가 아님(Node·Deployment·비용·출처) | `null` | `unavailableReason: 'not_a_pod'` |
| `LOGS_ENABLED=false` | `null` | `unavailableReason: 'logs_disabled'` |
| `LOG_DENY_NAMESPACES`에 걸림 | `null` | `unavailableReason: 'namespace_denied'` |

**링크 모양 — `follow` 없이 `at`** (2026-09-25, PM 결정 D3·Q12)

```
/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&at=2026-09-25T14%3A02%3A05.000Z
```

| 파라미터 | 값 | 규칙 |
|---|---|---|
| `namespace`·`pod` | 영향 객체 중 첫 번째 Pod | 컨테이너는 붙이지 않는다(로그 화면이 서버 기본 선택 규칙으로 고른다) |
| `at` | **그 알림의 `occurredAt`** (해제 알림이면 해제된 시각) | 알림 링크는 **그 시각을 보러 가는** 링크다. 로그 화면이 `at`을 어떻게 쓰는지는 `logs.md` **2.2.1**(출처별 정의) |
| `follow` | **붙지 않는다** | 따라가기를 켜면 맨 아래로 붙어서 그 시각을 잃는다. **Warning 이벤트 행도 같은 규칙**(`logs.md` 11.4) |

- `follow`·`at`을 붙일지는 **서버 링크 규칙 한 곳**(`apps/api/src/logs/log-href.ts`의 자리별 표)이 정한다. 화면은 `logHref`에 파라미터를 덧붙이지 않는다.
- 2026-09-25 이전 구현은 위 예시와 달리 `at`을 붙이지 않았다(계약 예시에만 있었다). **5b에서 계약대로 채웠다.** `follow=1`은 그때도 지금도 붙지 않는다.
- `logTarget.stackSearch`는 `GET /api/logs/targets/*`의 `stackSearch.available`과 **같은 판단**이다: 외부 로그 스택이 설정돼 있고 연결 실패 중이 아니면 `true`(2026-09-25 이전 구현은 항상 `false`였다).
- 링크 가능 여부(`LOGS_ENABLED`·`LOG_DENY_NAMESPACES`)는 mock `logs=disabled` 시나리오도 따른다 — 로그 API가 403인데 링크만 남는 일이 없다(`logs.md` 11.4).

- **파드가 사라졌어도 링크를 지우지 않는다.** 알림은 과거 기록이라 링크를 그리는 시점과 누르는 시점 사이에 파드가 사라질 수 있다. 존재할 때만 링크를 주면 새로고침마다 링크가 나타났다 사라진다(디자인 4.4). 사라졌다는 사실은 **로그 화면이 `LOG_POD_NOT_FOUND` 전용 화면으로 정직하게** 말한다(`logs.md` 2.4·6절).
- **화면이 파드 존재 여부를 추측하지 않는다.** `gone`·`deletedAt`·`stackSearch`는 전부 서버 값이다(PM·디자인 원칙: "파드가 사라졌는지를 화면이 추측하지 않고 서버가 말한다").
- `gone` 판정은 **kube informer 캐시 + 최근 삭제 캐시**로 한다(`logs.md` 2.4와 같은 캐시). 쿠버네티스 API를 새로 부르지 않는다. 캐시에 없고 삭제 기록도 없으면 `gone: false`로 둔다(모르면 링크를 살린다).
- **저장하지 않고 응답을 만들 때 계산한다.** 알림이 생길 때 살아 있던 파드가 지금은 없을 수 있다.
- **이 응답에 로그 줄은 없다**(0.3).

### 2.3 `GET /api/alerts/badge` (사이드바 배지 — 이것뿐이다)

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:20:00.000Z",
  "unreadCount": 3,
  "worstSeverity": "critical",
  "updatedAt": "2026-09-25T14:19:40.000Z"
}
```

| 필드 | 규칙 |
|---|---|
| `unreadCount` | **미확인 알림 수**. `kind: 'resolve'`·`severity: 'resolved'`·`kind: 'test'`는 **세지 않는다**(좋은 소식과 내가 누른 버튼으로 배지를 올리지 않는다). 숫자는 원값 — `99+` 표기는 화면(`components.md` 12.1 `NavItem.count`) |
| `worstSeverity` | 미확인 알림 중 최악. `critical > warning > unknown`. 미확인이 0이면 `null` |
| `updatedAt` | 배지 값이 마지막으로 바뀐 시각 |

- **이 응답에 목록·최근 N건·개요 요약을 넣지 않는다.** 배지가 필요로 하는 것은 숫자와 색뿐이다(상단바 벨과 패널이 없어졌다 — 사용자 결정 Q1).
- 브라우저 탭 제목 `(3) Sentinel`도 이 값 하나로 만든다(AC-ALERT35). 0이면 접두어를 붙이지 않고, **연결이 끊겨도 화면이 0으로 내리지 않는다**(마지막 값 유지 — 프론트 규칙).
- 평소에는 SSE `alerts.*`의 `badge`로 갱신되고, 이 엔드포인트는 **스트림 없이 렌더하는 첫 로드·폴백**용이다. 가볍게 답해야 한다(집계 쿼리 1회, DBA 조회 패턴 ②).

#### 2.3.1 배지 질의는 이 형태로 쓴다 (DBA 실측, PM 결정 2026-09-25)

```sql
SELECT count(*)::int AS unread, min(severity) AS worst
  FROM alerts
 WHERE data_source = $1
   AND acknowledged_at IS NULL
   AND severity < 'resolved'      -- ← 인덱스 경계
   AND kind <> 'test';            -- ← 힙 필터 (인덱스 열이 아니다)
```

- **`severity <> 'resolved'`로 쓰지 않는다.** `<>`는 **필터**이고 `<`는 **인덱스 경계**다. 실측:

  | 형태 | 읽은 인덱스 항목 | 시간 |
  |---|---|---|
  | `<> 'resolved'` | 2,000 (1,990 버림) | 0.53ms |
  | **`< 'resolved'`** | **10** | **0.094ms** |

  결정적 차이는 평균 시간이 아니다 — **`VACUUM` 전(= 쓰기가 몰린 상태, 알림 표의 평상시)에 `<>` 형태는 아예 Seq Scan으로 떨어진다.**
- `min(severity)`가 곧 `worstSeverity`다. enum이 `critical,warning,unknown,resolved` 순으로 선언돼 있고 그 순서가 `common.md` 2.1 우선순위와 같다. **정렬 코드가 필요 없고 0건이어도 항상 1행이 온다**(그때 `worst`는 `NULL`). 이 불변식은 enum 선언 순서에 기대므로 DBA가 테스트로 고정해 두었다 — **순서가 바뀌면 조용히 틀린 답이 나온다.**
- **Prisma `groupBy`/`aggregate`로는 이 형태가 나오지 않는다.** `$queryRaw`를 쓴다(파라미터는 `data_source` 하나).
- `kind <> 'test'`는 **인덱스 열이 아니라 힙 필터**라 위 경계에 영향이 없다. `kind='resolve'`는 항상 `severity='resolved'`이므로 경계에서 이미 빠진다.
- **대시보드 DB가 없을 때의 메모리 폴백도 같은 순서를 쓴다.** 한쪽만 바꾸면 DB가 있을 때와 없을 때 배지 색이 달라진다.
- 이 질의는 **모든 탭·모든 재연결마다 불리는 유일한 조회**다. 여기가 느리면 전체가 느려진다.

### 2.4 `PATCH /api/alerts/read` (확인 처리)

요청 (둘 중 하나. 함께 보내면 400):
```json
{ "ids": ["c7b1f0e2-…", "…"] }
```
```json
{ "all": true }
```

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:21:00.000Z",
  "persistence": "database",
  "updated": 3,
  "badge": { "unreadCount": 0, "worstSeverity": null, "updatedAt": "2026-09-25T14:21:00.000Z" }
}
```
- 확인 상태는 **서버에 하나**다(가정 N2 — 로그인이 없다). 모든 탭·브라우저가 같은 값을 본다. 처리 후 `alerts.read`를 모든 구독자에게 보낸다(AC-ALERT16).
- **화면을 여는 것만으로 부르지 않는다.** 항목 클릭·확장·읽음 점 클릭·`모두 확인`에서만 부른다(디자인 4.6 — 프론트 규칙).
- 없는 `id`는 조용히 건너뛴다. 이미 확인된 항목도 오류가 아니다. `ids` 최대 500개.
- 대시보드 DB가 없으면 **200**이고 메모리에만 반영된다(`persistence: "memory"`, 재시작하면 사라진다).
- 오류: 400 `VALIDATION_FAILED`.

### 2.5 `GET /api/alerts/settings`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-25T14:21:00.000Z",
  "persistence": "database",
  "dispatch": { "mode": "mock", "modeSource": "data_source", "outbound": false },
  "discord": {
    "enabled": true,
    "configured": true,
    "hint": "…****7f3a",
    "length": 119,
    "updatedAt": "2026-09-25T13:40:00.000Z",
    "minSeverity": "critical",
    "sendUnknown": true,
    "publicBaseUrlConfigured": false,
    "lastDispatch": { "at": "2026-09-25T14:02:12.000Z", "state": "sent", "responseCode": 204, "detail": null },
    "circuitBreaker": { "open": false, "consecutiveFailures": 0, "openedAt": null, "resumeAt": null },
    "queue": { "pending": 0, "nextRetryAt": null }
  },
  "rules": {
    "dedupeWindowMin": 15,
    "flapWindowMin": 30,
    "flapTransitions": 4,
    "warmupSec": 120,
    "unknownAfterMin": 5,
    "sourceSuppressAfterMin": 3,
    "notifyOnNewTarget": true,
    "repeatEveryMin": null,
    "minIntervalSec": 2,
    "uiEditable": false
  },
  "retention": { "days": 90, "maxRows": 2000, "uiEditable": false },
  "keys": [
    { "key": "area:controlPlane", "label": "컨트롤 플레인", "enabled": true, "editable": false, "status": "ok", "statusSince": "2026-09-25T09:12:00.000Z" },
    { "key": "area:nodes", "label": "노드", "enabled": true, "editable": false, "status": "critical", "statusSince": "2026-09-25T14:17:40.000Z" }
  ],
  "warmup": { "active": false, "endsAt": null },
  "lockedByEnv": [],
  "lockedByEnvDetail": [],
  "notices": [
    { "code": "ALERTS_DISPATCH_MOCK", "level": "info", "text": "mock 모드입니다 — 디스코드로 실제 발송하지 않습니다." },
    { "code": "ALERTS_TARGET_NAMES_PLAIN", "level": "info", "text": "알림 본문에 클러스터 리소스 이름이 포함됩니다. 채널 공개 범위를 확인하세요." }
  ],
  "updatedAt": "2026-09-25T13:40:00.000Z"
}
```

| 필드 | 설명 |
|---|---|
| `dispatch.mode` | `mock` \| `live`. `ALERTS_DISPATCH`가 설정돼 있으면 그 값, 없으면 `DATA_SOURCE`를 따른다 |
| `dispatch.modeSource` | `env` \| `data_source` |
| `dispatch.outbound` | `false`면 **아웃바운드 요청이 0건**이다(5절). 화면은 이 값으로 `실제로 보내지 않음` 배지를 띄운다 |
| `discord.configured` | 웹훅 주소가 저장돼 있거나 환경 변수로 들어와 있음 |
| `discord.hint` | **끝 4자만**: `…****` + 마지막 4자(원문이 4자 이하면 꼬리 없이 `…****`). DBA `maskWebhookUrl()`이 만든다. **이 응답과 다른 어떤 API도 전체 URL·토큰을 돌려주지 않는다**(AC-ALERT20) |
| `discord.source` | `env` \| `db` \| `null`(미설정). DBA `readWebhookStatus()`의 값 그대로 |
| `discord.minSeverity` | `critical`(장애만, 기본) \| `warning`(주의부터). `unknown`은 이 순서에 넣지 않는다 |
| `discord.sendUnknown` | 별도 축(명세 3.2.4). 기본 켬 |
| `discord.lastDispatch` | 화면 `마지막 발송 9월 25일 14:02 · 성공` 줄(디자인 3.6). `detail`은 **가림 처리된 서버 문구** 그대로. **뜻(PM 결정 2026-09-25)**: 마지막으로 **실제로 밖으로 나간 시도**의 결과다. ① `state`는 **`sent`·`failed` 두 값뿐**이다 — 재시도가 남은 실패와 429도 **그 시도는 배달되지 않았으므로 `failed`**(배달 기록 `dispatch[]`의 `pending`과는 다른 축이다. 디자인 `· 실패 (429 Too Many Requests)`) ② **테스트 발송도 포함한다**(live에서 `POST /api/alerts/test`가 이 값을 갱신한다) ③ `skipped_*`(mock·미설정·꺼짐·서킷·플래핑 등)는 나간 적이 없으므로 **기록하지 않는다** → **mock에서는 `null`로 남는 것이 정상이다** ④ 메모리 값이라 API를 재시작하면 `null`로 돌아간다 |
| `discord.circuitBreaker` | `{ open, consecutiveFailures, openedAt, resumeAt }`. 연속 실패가 `failureCircuitCount`(기본 10)에 닿으면 `failureCooldownMin`(기본 60분) 동안 발송을 멈춘다. **`resumeAt` = 발송을 다시 시도하는 시각**(열려 있을 때만, 닫혀 있으면 `null`) — 디자인 3.6 `연속 실패 10건으로 발송을 멈췄습니다. 15:04에 다시 시도합니다.`의 `10`은 `consecutiveFailures`, `15:04`는 `resumeAt`이다. 같은 값이 `notices[]`의 `ALERTS_DISCORD_CIRCUIT_OPEN.details.resumeAt`에도 온다. 발송이 한 번이라도 성공하면(테스트 발송 포함) 닫힌다. **메모리 값이다** — 재시작하면 서킷이 풀린다(알려진 한계). mock `alerts=webhook-failed`에서는 **표시 전용** 값이 온다(5절 — 실제 발송 상태와 무관) |
| `discord.queue` | `{ pending, nextRetryAt }`. `pending` = 배달 대기(`pending`) 건 수 — 지금 보낼 것과 재시도 예정을 **모두** 센다. `nextRetryAt` = 대기 건이 다음에 시도되는 **가장 이른 시각**. 서킷이 열려 있으면 `circuitBreaker.resumeAt`보다 이르지 않다(큐가 그때까지 멈춘다). 곧바로 보낼 건만 있으면 응답 시각에 가깝다. 대기 건이 없으면 `null` (2026-09-25 전에는 항상 `null`이었다) |
| `discord.publicBaseUrlConfigured` | `ALERTS_PUBLIC_BASE_URL`이 있으면 메시지에 대시보드 링크가 붙는다. **URL 자체는 돌려주지 않는다** |
| `rules.uiEditable` | `false` — 화면에 노출하지 않는다(명세 3.4.2). API로는 바꿀 수 있다(2.6) |
| `keys[].editable` | 이번 범위에서는 전부 `false`(키별 켜고 끄기는 P3) |
| **`keys[].status`** / **`keys[].statusSince`** | (2026-09-25 추가) 그 키의 **현재 상태**(`ok`·`warning`·`critical`·`unknown`)와 그 상태가 된 시각. 디자인 `settings.md` 6.1 Card 2의 `StatusBadge`. **알림 엔진이 알림 판정에 쓰는 바로 그 값**이다(영역 상태 `areas.*.status`·비용 상태·`kube` 출처 상태를 15초마다 본 결과) — 새 판단 기준을 만들지 않는다. 화면이 다른 스트림에서 짜 맞추지 않는다. API가 뜬 뒤 아직 한 번도 평가하지 않았으면(첫 15초) **`null`** — 지난 실행에서 DB에 남은 상태를 "현재"로 내보내지 않는다 |
| `warmup.active` | 워밍업 중이면 `true` + `endsAt`. 이 동안 알림이 생기지 않는 것이 정상이다 |
| `lockedByEnv` | 환경 변수로 고정된 **필드 이름** 배열. 기존 `PATCH /api/cost/settings` 규칙과 **같다**. 디자인의 `SecretInput.lockedByEnv` prop은 환경 변수 **이름 문자열**을 받으므로 화면은 `lockedByEnvDetail[].envVar`를 넣는다(두 값의 용도가 다르다) |

**`lockedByEnvDetail` — "왜 못 고치는지"가 응답에 있다** (`ALERTS_DISCORD_WEBHOOK_URL`이 설정된 경우)
```json
"lockedByEnv": ["webhookUrl"],
"lockedByEnvDetail": [
  {
    "field": "webhookUrl",
    "envVar": "ALERTS_DISCORD_WEBHOOK_URL",
    "text": "환경 변수 ALERTS_DISCORD_WEBHOOK_URL로 고정돼 있어 화면에서 바꿀 수 없습니다. 값을 바꾸려면 .env(또는 배포 매니페스트)를 고치고 API를 다시 시작하세요."
  }
]
```
- **환경 변수 값은 넣지 않는다.** 이름과 안내 문구뿐이다. `discord.hint`는 잠겨 있어도 끝 4자를 보여 준다("내가 넣은 그 웹훅이 맞나"는 확인할 수 있어야 한다).
- 환경 변수가 있으면 서버는 **DB 값을 읽지 않는다**(DBA 설계). 저장 시도는 409다(2.6).
- `ALERTS_DISPATCH`가 설정되면 `lockedByEnv`에 `dispatchMode`가 들어간다(같은 형식).
- 조회는 대시보드 DB가 없어도 200이다(`persistence: "memory"`, 기본값 반환).

### 2.6 `PATCH /api/alerts/settings`

요청(부분 갱신. 보낸 필드만 바뀐다):
```json
{
  "discord": {
    "enabled": true,
    "webhookUrl": "https://discord.com/api/webhooks/123456789012345678/AbCdEf…",
    "minSeverity": "warning",
    "sendUnknown": false
  },
  "rules": { "dedupeWindowMin": 20 }
}
```

| 필드 | 규칙 |
|---|---|
| `discord.enabled` | boolean. `false`면 발송만 멈추고 **화면 알림 센터는 계속 쌓인다**(AC-ALERT29) |
| `discord.webhookUrl` | `null`(지우기) 또는 문자열. 검증은 **DBA `checkWebhookUrl()`** 하나로 한다(API가 따로 정규식을 쓰지 않는다): **`https`** + 호스트가 `discord.com`·`discordapp.com`(**하위 도메인 포함**, `settings.alerts.discord.allowedHosts`로 바꿀 수 있다) + 경로 `/api/webhooks/{숫자}/{토큰}`(끝 슬래시 허용) + **500자 이하**. 그 밖은 400 (PM 결정 Q9) |
| `discord.minSeverity` | `critical` \| `warning` |
| `discord.sendUnknown` | boolean |
| `rules.dedupeWindowMin` | 1~1440 |
| `rules.flapWindowMin` | 5~1440 / `rules.flapTransitions` 2~50 |
| `rules.warmupSec` | 0~3600 |
| `rules.unknownAfterMin` | 1~120 / `rules.sourceSuppressAfterMin` 1~120 |
| `rules.notifyOnNewTarget` | boolean |
| `rules.repeatEveryMin` | `null`(끔, 기본) 또는 15~1440 — **P3의 자리만 둔다.** 값을 넣어도 이번 범위에서는 동작하지 않고 `notices`에 `ALERTS_REPEAT_NOT_IMPLEMENTED`가 붙는다 |
| `rules.minIntervalSec` | 0~60 |
| `retention.*`, `keys[].enabled` | **변경 불가**(요청에 있으면 400). 보관은 DBA 정리 작업 설정, 키별 켜기는 P3 |

**응답 200**: 2.5와 같은 전체 설정.

**저장·노출 규칙 (웹훅 URL)**

1. 저장 위치는 대시보드 자체 DB `settings`의 **별도 키** `alerts.discord.webhookUrl`(평문, PM 결정 Q4). 암호화하지 않는다.
2. **원문을 반환하는 함수는 발송기 전용 하나뿐이다**(DBA 설계). 화면용 조회는 `{ configured, hint, length, lockedByEnv }`만 돌려준다. 이 계약의 2.5 응답이 그 모양이다.
3. **응답·로그·이력·SSE 어디에도 원문이 나가지 않는다.** 서버 공통 `redactSecrets`에 디스코드 웹훅 URL 패턴을 추가한다.
4. **검증 실패 응답에 입력값을 싣지 않는다**(AC-ALERT21). `details.fields[].value` 제외 필드 목록에 `webhookUrl`을 추가한다(기존 `content`·`label`·`memo`·`path`와 같은 처리, `common.md` 1.4).
```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "웹훅 주소 형식이 올바르지 않습니다 (호스트가 허용 목록에 없습니다).",
  "details": {
    "fields": [ { "field": "discord.webhookUrl", "constraints": ["디스코드 웹훅 주소여야 합니다 (https://discord.com/api/webhooks/…)"] } ],
    "reason": "HOST_NOT_ALLOWED"
  },
  "path": "/api/alerts/settings",
  "timestamp": "2026-09-25T14:21:00.000Z"
}
```
- `details.reason`은 DBA `WebhookUrlRejectCode` 그대로: `EMPTY` \| `NOT_A_URL` \| `NOT_HTTPS` \| `HOST_NOT_ALLOWED` \| `PATH_NOT_WEBHOOK` \| `TOO_LONG`. **입력값은 어디에도 없다.**
5. 저장 후 화면 입력칸은 비우고 `설정됨 · …****7f3a (119자)`만 보인다. **"다시 보기" 버튼도, 원문을 돌려주는 API도 만들지 않는다.**

**에러**
| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 위 규칙 위반 (값은 응답에 싣지 않는다) |
| 409 | `SETTING_LOCKED_BY_ENV` | 환경 변수로 고정된 필드 변경 시도. `details.fields: ["webhookUrl"]`, `details.envVars: ["ALERTS_DISCORD_WEBHOOK_URL"]`, `message`에 "왜 못 고치는지"가 들어간다 (AC-ALERT22) |
| 503 | `DASHBOARD_DB_UNAVAILABLE` | 대시보드 DB 없음. **메모리 값은 바꾸지 않는다**(재시작 시 사라지는 변경 방지 — 기존 cost 규칙과 동일) |

### 2.7 테스트 발송 (되돌릴 수 없는 외부 동작)

#### 2.7.1 `GET /api/alerts/test/preview` (부작용 없음)

확인 대화상자가 쓴다. **이 호출은 아무것도 보내지 않는다.**

```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:22:00.000Z",
  "canSend": true,
  "blocked": null,
  "target": { "hint": "…****7f3a", "length": 119 },
  "dispatch": { "mode": "mock", "outbound": false },
  "message": "[MOCK] [테스트] Sentinel 알림 설정 확인 메시지입니다. 실제 장애가 아닙니다.\n클러스터: prod.k8s.example.com\n시각: (보낼 때의 시각으로 채워집니다)",
  "cooldown": { "active": false, "retryAfterSec": 0, "nextAvailableAt": null },
  "warning": "디스코드 채널에 실제 메시지가 즉시 전송됩니다. 되돌릴 수 없습니다."
}
```
- `message`는 **대화상자가 그대로 보여 주는 문자열**이다. 화면이 조립하지 않는다(디자인 5절).
- `blocked`는 버튼 비활성 이유다: `{ "code": "ALERT_WEBHOOK_NOT_CONFIGURED" | "ALERT_DISPATCH_DISABLED" | "ALERT_TEST_COOLDOWN", "text": "…" }`.
- `dispatch.outbound: false`(mock)일 때도 `canSend`는 `true`다. 버튼은 눌리고 **아무것도 나가지 않으며** 결과에 보낼 본문 전문이 온다(AC-ALERT26).

#### 2.7.2 `POST /api/alerts/test`

요청:
```json
{ "confirm": true }
```

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:22:10.000Z",
  "alertId": "1a2b3c4d-…",
  "result": { "state": "skipped_mock", "label": "실제로 보내지 않았습니다 (mock)", "at": "2026-09-25T14:22:10.000Z", "responseCode": null, "detail": null },
  "message": "[MOCK] [테스트] Sentinel 알림 설정 확인 메시지입니다. 실제 장애가 아닙니다.\n클러스터: prod.k8s.example.com\n시각: 2026-09-25T14:22:10Z",
  "cooldown": { "retryAfterSec": 60, "nextAvailableAt": "2026-09-25T14:23:10.000Z" }
}
```

| 규칙 | 내용 |
|---|---|
| **명시 확인** | 본문에 `confirm: true`가 없거나 `false`면 **422 `ALERT_TEST_CONFIRMATION_REQUIRED`**. 기존 `SNAPSHOT_CONFIRMATION_REQUIRED`(422)와 같은 패턴이다 |
| **저장된 주소로만** | 요청 본문에 웹훅 URL을 받지 않는다. DTO에 그런 필드가 **없다**(`whitelist: true`라 보내도 제거된다). 저장 → 테스트 → (틀리면) 지우고 다시 저장 |
| **쿨다운 60초** | 그 안에 다시 부르면 **429 `ALERT_TEST_COOLDOWN`** + `Retry-After`(초) 헤더 + `details.retryAfterSec`·`details.nextAvailableAt`. 성공·실패·mock 어느 결과든 쿨다운이 시작된다(실패로 연타하는 것을 막는다) |
| **본문 표시** | 메시지에 `[테스트]`와 "실제 장애가 아닙니다"가 반드시 들어간다. mock에서 만든 것은 맨 앞에 `[MOCK]` |
| **이력** | `kind: 'test'` 알림 1건을 남긴다(언제 눌렀고 결과가 무엇인지). **배지에는 세지 않는다**(2.3) |
| **발송 실패** | HTTP 오류로 만들지 않는다. **200 + `result.state: "failed"`** + 가림 처리된 사유. 화면은 "마지막 발송 결과"에 그대로 보여 준다 |

**에러**
| HTTP | code | 언제 | 비고 |
|---|---|---|---|
| 422 | `ALERT_TEST_CONFIRMATION_REQUIRED` | `confirm`이 없거나 `true`가 아님 | **아무것도 보내지 않는다**(AC-ALERT23) |
| 429 | `ALERT_TEST_COOLDOWN` | 60초 안에 재호출 | `Retry-After` + `details.retryAfterSec` (AC-ALERT25) |
| 409 | `ALERT_WEBHOOK_NOT_CONFIGURED` | 저장된 주소 없음 | |
| 409 | `ALERT_DISPATCH_DISABLED` | `discord.enabled: false` | |
| 400 | `VALIDATION_FAILED` | 본문 형식 오류 | |

---

## 3. 발송 층 (③) 규칙 — 서버가 지키고 화면은 결과만 본다

### 3.1 언제 무엇이 기록되나

| 조건 | `dispatch[].state` |
|---|---|
| 주소 없음 | `skipped_not_configured` — **시도조차 하지 않는다.** 오류가 아니다 |
| `discord.enabled: false` | `skipped_disabled` |
| `severity`가 `minSeverity`보다 낮음 | `skipped_severity` (AC-ALERT28) |
| `severity: 'unknown'`이고 `sendUnknown: false` | `skipped_unknown_off` |
| 발생 알림을 보내지 않은 것의 해제 | `skipped_no_pair` — 짝 없는 "복구됨"이 채널에 뜨지 않는다 (AC-ALERT32) |
| 플래핑 진입 후 그 키 | `skipped_flapping` |
| `ALERTS_DISPATCH=mock` | `skipped_mock` — **아웃바운드 0건** |
| 발송 대기 중 API 재시작 | `skipped_restart` — 자동 재발송하지 않는다 (AC-ALERT33) |
| 연속 실패 10건 이후 1시간 | `skipped_circuit_open` + 설정 응답의 `circuitBreaker.resumeAt` |
| `kind: 'restart_summary'` | **기록을 만들지 않는다**(`dispatch: []`). 규칙상 채널로 보내지 않는다 |

### 3.2 URL 제한·실패 처리

- 호스트 `discord.com` / `discordapp.com`, `https`, 경로 `/api/webhooks/…`만 허용(2.6). 그 밖의 주소로는 **요청을 만들지 않는다**(SSRF 성격 위험 차단, PM 결정 Q9).
- 4xx(429 제외)/5xx/타임아웃: 지수 백오프 **3회**(5초 → 30초 → 120초) 후 `failed`. `nextRetryAt`으로 남은 대기를 알린다. **알림 자체는 화면에서 사라지지 않는다**(AC-ALERT30).
- 429: `Retry-After`를 지키고 큐에 남긴다(`pending`). 유실하지 않는다(AC-ALERT31).
- 발송 속도 상한 `rules.minIntervalSec`(기본 2초에 1건).
- 연속 실패 10건 → 1시간 정지 + `notices`에 `ALERTS_DISCORD_CIRCUIT_OPEN`(+`details.resumeAt`). 화면 알림은 계속 쌓인다.
- 실패 사유는 **가림 처리된 한 줄**이다. 웹훅 URL·토큰·요청 본문은 `detail`에 넣지 않는다.

---

## 4. 알림 본문(메시지)에 담는 것 / 담지 않는 것

`messagePreview`와 실제 디스코드 메시지는 **같은 문자열**을 쓴다. 화면과 채널이 다른 말을 하지 않는다.

### 4.1 담는 것

| 항목 | 값 |
|---|---|
| 접두어 | `[장애]` / `[주의]` / `[확인 불가]` / `[해제]` / `[테스트]` |
| mock 표시 | `dataSource: 'mock'`에서 만든 알림은 **맨 앞에 `[MOCK]`** (AC-ALERT27) |
| 영역 | `areaLabel` |
| 대표 사유 | `reason.text` **그대로** |
| 영향 객체 | 최대 3개 `Kind namespace/name` + `외 N개` |
| 클러스터 | `K8S_CLUSTER_NAME`(보통 FQDN) |
| 시각 | 발생 시각(UTC ISO). 해제 알림은 `지속 17분` 추가 |
| 반복 | `repeatCount >= 2`면 `반복 N회` |
| 확인 불가 구간 | `unknownGap`이 있으면 `확인 불가 구간 14:02 ~ 14:38 (36분)` |
| 정지 구간 | `restart_summary`면 `정지 구간 09:12 ~ 09:31 (19분) — 이 동안의 변화는 알림으로 잡히지 않았습니다.` (모르면 `이전 실행 기록 없음`) |
| 링크 | **`ALERTS_PUBLIC_BASE_URL`이 설정됐을 때만** 대시보드 링크 |

### 4.2 담지 않는 것 (AC-ALERT13)

비밀값, **웹훅 URL 자체**, 환경 변수, `command`/`args` 원문, 어노테이션·레이블 원문, ConfigMap/Secret 내용, DB 쿼리 원문, 접속 문자열, 스택 트레이스, **컨테이너 로그 줄(가림 처리한 것 포함)과 로그 요약·통계**.

- 로그는 **링크만** 건다(2.2.1). "무슨 일이 일어났나"는 알림이, "왜 그랬나"는 로그 화면이 답한다.
- **로그 내용으로 알림을 만들지도 않는다.** 로그 기반 알림 규칙은 범위 밖이다(PM 결정 Q7). 판단 기준이 `alerts`와 `logs` 두 곳에 생기면 안 된다.
- 리소스 **이름**은 원문 그대로 쓴다(사용자 결정 Q3). 가리지 않는다.

### 4.3 억제·플래핑·워밍업이 응답에 드러나는 방식 (화면은 다시 판정하지 않는다)

| 서버 규칙 | 응답에 드러나는 곳 |
|---|---|
| 중복 억제 15분 | `repeatCount`, `dedupe.windowMin`, `dedupe.lastEventAt` — 항목은 **1건**이고 화면은 `반복 4회` 칩만 그린다 (AC-ALERT05) |
| 억제 창이 끝나도 재알림 없음 | 같은 키의 새 `AlertItem`이 **만들어지지 않는다** (AC-ALERT03) |
| 영향 객체 추가 | 같은 등급의 새 항목(`kind: 'transition'`) 또는 `repeatCount` 증가. `rules.notifyOnNewTarget`로 끌 수 있다 |
| 플래핑(30분 4회) | `flapping: { active: true, transitions: 6, windowMin: 30 }` + `kind: 'flapping'` **묶음 1건**. 전이 타임라인은 상세의 `transitions[]` (AC-ALERT06) |
| 플래핑 해제 | 그 시점 상태로 새 항목 1건(정상이면 `kind: 'resolve'`) |
| `unknown` 5분 지속 | 5분이 지나기 전에는 항목이 **생기지 않는다.** 생기면 `severity: 'unknown'`, `severityLabel: '확인 불가'` (AC-ALERT08) |
| 출처 억제(kube 3분) | `source:kube` 항목 **1건** + `suppressedAreas: 5`(상세는 `suppressedKeys[]`). 영역 5개의 항목은 생기지 않는다 (AC-ALERT07) |
| 끊긴 구간 소급 금지 | 회복 후 새 항목의 `unknownGap`에 구간이 적힌다. 과거 시각으로 알림을 만들지 않는다 |
| 워밍업 120초 | 그 동안 항목 0건. 설정 응답의 `warmup.active: true`로만 보인다 (AC-ALERT09) |
| 워밍업 종료 요약 | `kind: 'restart_summary'` 1건 + `restart.counts` + `restart.gap`, 그리고 같은 구간이 목록의 `gaps[]`에도 들어간다 — **두 곳에 있는 것이 맞다**(디자인 5.4) (AC-ALERT10) |
| 완화(critical → warning) | 새 항목을 만들지 않고 기존 항목의 `severity`를 낮추고 `mitigations[]`에 한 줄 추가 → `alerts.updated` |
| 격상(warning → critical) | **새 항목**(`kind: 'escalation'`) + `relatedAlertId`·`relation: 'escalated_from'` (AC-ALERT11) |

---

## 5. mock 모드

- **`ALERTS_DISPATCH=mock`(기본: `DATA_SOURCE`를 따름)에서 디스코드로 나가는 요청은 0건이다.** 테스트 발송도 포함한다(AC-ALERT26). 구현은 아웃바운드 호출을 호출부에서 차단하고, 테스트로 "HTTP 클라이언트가 한 번도 불리지 않았음"을 확인한다.
- `DATA_SOURCE=live` + `ALERTS_DISPATCH=mock`은 **비상 차단 스위치**로도 쓴다.
- `DATA_SOURCE=mock` + `ALERTS_DISPATCH=live`면 실제로 나가고 본문 맨 앞에 `[MOCK]`이 붙는다(AC-ALERT27).
- mock에서 만들어진 알림은 `dataSource: 'mock'`이고 화면에 `실제로 보내지 않음` 칩이 붙는다. **live 이력과 섞이지 않는다.**

**mock 시나리오 그룹 `alerts`** (`common.md` 6.1에 행 추가)

| id | 재현 |
|---|---|
| `default` (기본) | 최근 24시간 예시 12건: 장애 3, 주의 4, 확인 불가 1, 해제 3, 플래핑 묶음 1. **미확인 3건** → 배지 3 + 탭 제목 `(3) Sentinel` (AC-ALERT35) |
| `empty` | 0건 (빈 상태 + `watch.lastObservedAt`·`keyCount: 8` footer) |
| `burst` | 3초마다 1건 추가 → 배지 숫자가 올라가는 것을 눈으로 확인 |
| `flapping` | 한 키가 30분에 6회 전이 → 묶음 1건, 그 뒤 조용함 |
| `restart` | 워밍업 요약 1건 + `gaps[]`에 19분 구간 |
| `webhook-unset` | 미설정(화면만 동작, 회색 안내 한 줄) |
| `webhook-failed` | 5xx 3회 실패 후 `failed`. **최근 2건은 `skipped_circuit_open`**(연속 실패로 발송 정지), **가장 최근 해제 1건은 `skipped_no_pair`**(발생을 못 보냈으니 해제도 안 보냄) — 두 칩을 mock에서 눈으로 보기 위한 **이력 픽스처**다. 판정 순서상 `ALERTS_DISPATCH=mock`이 먼저 이겨 실시간으로는 이 두 상태가 생기지 않는다. 발송 판정·발송기는 그대로이고 **mock에서 나가는 요청은 0건**이다(2026-09-25). **+ 설정 화면 서킷 표시**: 이 시나리오에서만 `GET /api/alerts/settings`의 `discord.circuitBreaker`가 `{ open: true, consecutiveFailures: 10, resumeAt: 지금 + 약 1시간 }`이고 `ALERTS_DISCORD_CIRCUIT_OPEN` 안내가 붙는다(디자인 3.6 둘째 줄 확인용). **표시 전용이며 실제 발송 상태와 무관하다** — 응답을 만드는 층에서만 덮어쓰고, dispatcher·큐·판정·전송은 이 값을 모른다(실제 서킷은 닫혀 있다). `ALERTS_DISPATCH=live`(발송이 실제로 나갈 수 있는 조합)이면 덮지 않는다. 1시간 넘게 켜 두면 재개 시각을 다시 잡는다(PM 결정 2026-09-25) |
| `webhook-ratelimited` | 429로 `pending` |
| `suppressed-by-source` | `kube` 끊김으로 영역 5개가 묶여 `source:kube` 1건만 |

**그룹 사이의 관계 (실시간 생성 확인 경로 — AC-ALERT02·07·12)**

- `cluster`·`cost` 시나리오를 바꾸면 **상태 전이가 실제로 일어나 알림이 만들어진다.** 예: `cluster`를 `healthy` → `critical`로 바꾸면 15초 안에 `area:pods`·`area:nodes` 알림이 생기고 `alerts.created` + 배지 증가가 온다.
- `cluster=kube-auth-failed` → `source:kube` 1건 + 영역 5개 억제.
- `cluster=kube-stale` → 3분 지속 후 확인 불가 1건.
- `cluster=cp-node-down` / `cp-quorum-lost` / `cp-not-found` → 컨트롤 플레인 주의 / 장애(격상) / 확인 불가.
- `cost=budget-over` / `spike-warning` / `no-budget` → 비용 장애 / 주의 / 알림 없음.
- `alerts` 그룹은 **미리 쌓인 이력**이고, 실시간 생성 확인은 `cluster`/`cost` 전환으로 한다.
- `POST /api/mock/reset`은 `alerts` 그룹을 `default`로 되돌리고 예시 이력·읽음 상태·쿨다운을 초기화한다.

#### 5.1 reset 직후 배지가 기동 직후와 다른 것은 정상이다 (PM 확인, 2026-09-25)

| 시점 | `alerts=default`의 배지 | 왜 |
|---|---|---|
| **기동 직후**(워밍업 중) | **3** — 예시 이력의 미확인 3건뿐 | 워밍업 120초 동안 엔진이 알림을 만들지 않는다 |
| **`POST /api/mock/reset` 직후** | **3보다 크다**(예: 6) | 초기화가 **상태 머신도 비우므로** 엔진이 지금의 `cluster` 시나리오 상태(기본 `mixed` = 장애 포함)를 **새 전이로 다시 감지**해 알림을 만든다 |

- **버그가 아니다.** `reset`은 "상태를 처음으로"이지 **"대시보드 재시작 시뮬레이션"이 아니다.** 재시작이라면 워밍업이 다시 돌아 알림이 억제되겠지만, 그러면 **검증하는 사람이 120초를 기다려야 해서** mock의 목적(빠르게 눈으로 확인)에 어긋난다.
- 그래서 `reset` 후에는 **워밍업을 다시 켜지 않는다.** 대신 상태 머신이 비어 있으므로 다음 15초 평가에서 현재 상태가 전이로 잡힌다.
- 배지 숫자를 정확히 3으로 보고 싶으면 **API를 다시 시작**하고 워밍업이 끝나기 전에 확인한다.

---

## 6. SSE (토픽 `alerts`)

봉투·순서·heartbeat·재연결은 `common.md` 5절 그대로. **새 스트림을 만들지 않는다** — 기존 `GET /api/stream`에 토픽 1개를 더한다.

| 이벤트 | 언제 | payload |
|---|---|---|
| `alerts.snapshot` | 연결 직후, mock 시나리오 전환 후, 설정 변경 후 | `{ badge, watch, dispatch, persistence, warmup, notices }` — **목록 없음**(6.1) |
| `alerts.created` | 새 알림 1건 | `{ alert: AlertItem, badge }` |
| `alerts.updated` | 반복 합산·완화·해제·플래핑 변화·발송 상태 변화 | `{ alert: AlertItem, badge }` |
| `alerts.read` | 확인 처리 | `{ ids: string[] \| null, all: boolean, badge }` |

```
event: alerts.created
data: {"seq":142,"topic":"alerts","emittedAt":"2026-09-25T14:02:06.000Z","payload":{"alert":{ ... },"badge":{"unreadCount":3,"worstSeverity":"critical","updatedAt":"2026-09-25T14:02:06.000Z"}}}
```

- **`facets`·`gaps`는 이벤트에 싣지 않는다.** 둘 다 기간 필터에 딸린 값이라 스트림에 담으면 화면마다 다른 값을 방송하게 된다. `/alerts` 화면은 `alerts.created`를 받으면 목록 행은 즉시 추가하고 **`GET /api/alerts`를 300ms debounce로 다시 불러** `facets`·`gaps`를 맞춘다(11절).
- `watch.lastObservedAt`은 heartbeat가 갱신될 때마다가 아니라 **`alerts.snapshot`과 60초에 한 번 이하**로만 다시 보낸다(값이 바뀌었을 때만).

### 6.1 `alerts.snapshot`에 목록을 싣지 않는 이유 (명세 4절과의 차이)

명세 4절은 `alerts.snapshot`을 "최근 N건 + 미확인 수 + 최악 심각도 + 발송 설정 요약"으로 적었다. 이 계약은 **최근 N건을 뺀다.**

- 상단바 벨과 "최근 10건 패널"이 없어졌고(사용자 결정 Q1), 목록이 필요한 화면은 `/alerts` **하나뿐**이며 그 화면은 `GET /api/alerts`로 먼저 읽는다.
- 프론트는 앱 레이아웃에서 스트림 1개를 열고 **모든 페이지에서** 이 토픽을 구독한다. 스냅샷에 이력 목록을 실으면 알림 화면을 보지 않는 탭까지 매 재연결마다 이력을 받는다.
- `/alerts` 화면의 실시간성은 `alerts.created`/`alerts.updated`(항목 1건씩)로 충분하다.
- 배지에 필요한 값(`unreadCount`·`worstSeverity`)은 **모든 이벤트에 함께** 실어 보내므로 항목 하나 크기로 배지가 항상 정확하다.

→ 명세 본문(planner 영역)은 고치지 않았다. **PM 확인 요청**으로 보고서에 올린다.

### 6.2 출처·stale

- 알림은 **새 `SourceId`를 만들지 않는다.** 상태의 파생이므로 `stream.source`의 기존 출처(`kube`·`monitoredDb`·`awsResources`…)가 그대로 적용된다.
- 이력 저장이 메모리 폴백이면 `alerts.snapshot.persistence: "memory"` + `notices`에 `ALERTS_HISTORY_MEMORY_ONLY`.

---

## 7. `Reason.code` (알림 계층이 새로 만드는 것)

알림의 `reason`은 **기존 코드를 그대로** 쓴다(`cluster-status.md` 9절, `aws-cost.md` 8절, `common.md` 2.3). 알림 계층이 새로 만드는 코드는 아래 5개뿐이고, 전부 **상태 판단이 아니라 알림 자체를 설명**한다.

| code | 언제 | text 예 |
|---|---|---|
| `ALERT_SOURCE_SUPPRESSED` | `source:kube` 알림이 영역 알림을 묶음 | `인증 실패, 토큰이 만료됐을 수 있습니다 (5분 지속) · 영향 영역 5개` |
| `ALERT_FLAPPING` | 플래핑 진입 | `불안정(최근 30분 6회 변화) · 반복 알림을 멈춥니다` |
| `ALERT_RESTART_SUMMARY` | 워밍업 종료 요약 | `대시보드가 시작됐습니다 · 현재 장애 2, 주의 1, 확인 불가 0` |
| `ALERT_UNKNOWN_GAP` | 확인 불가 구간 안내(보조 사유) | `확인 불가 구간 14:02 ~ 14:38 (36분)` |
| `ALERT_TEST` | 테스트 발송 | `테스트 발송` |

- **새 임계값 상수를 만들지 않는다**(AC-ALERT14). 억제·플래핑·워밍업 기준값은 알림 계층의 값이고 `rules`(2.5) 한곳에 모인다.

---

## 8. 에러 코드 요약

| HTTP | code | 엔드포인트 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 전체 (웹훅 URL 형식 포함. **값은 응답에 없다**) |
| 404 | `RESOURCE_NOT_FOUND` | `GET /api/alerts/:id` |
| 409 | `SETTING_LOCKED_BY_ENV` | `PATCH /api/alerts/settings` |
| 409 | `ALERT_WEBHOOK_NOT_CONFIGURED` | `POST /api/alerts/test` |
| 409 | `ALERT_DISPATCH_DISABLED` | `POST /api/alerts/test` |
| 422 | `ALERT_TEST_CONFIRMATION_REQUIRED` | `POST /api/alerts/test` |
| 429 | `ALERT_TEST_COOLDOWN` | `POST /api/alerts/test` (`Retry-After` + `details.retryAfterSec`) |
| 503 | `DASHBOARD_DB_UNAVAILABLE` | `PATCH /api/alerts/settings` |

- 조회 엔드포인트는 출처 실패·DB 없음에도 **200**이다(`persistence: "memory"`, `notices`).
- **디스코드 발송 실패는 HTTP 오류가 아니다.** 200 + `result.state: "failed"` / `dispatch[].state: "failed"`.

---

## 9. 설정·환경 변수 (이 기능)

| 이름 | 기본 | 설명 |
|---|---|---|
| `ALERTS_DISPATCH` | (없음 → `DATA_SOURCE`를 따름) | `mock` \| `live`. `mock`이면 **아웃바운드 0건**. 설정되면 `lockedByEnv`에 `dispatchMode` |
| `ALERTS_DISCORD_WEBHOOK_URL` | (없음) | 선택. 설정되면 **DB 값을 읽지 않고** 이 값을 쓴다. 화면 입력은 잠기고 저장 시도는 409 |
| `ALERTS_PUBLIC_BASE_URL` | (없음) | 선택. 설정됐을 때만 메시지에 대시보드 링크를 붙인다 |

- `settings` 테이블 키: `alerts.discord.enabled`·`alerts.discord.minSeverity`·`alerts.discord.sendUnknown`·`alerts.dedupeWindowMin`·`alerts.flapWindowMin`·`alerts.flapTransitions`·`alerts.warmupSec`·`alerts.unknownAfterMin`·`alerts.sourceSuppressAfterMin`·`alerts.notifyOnNewTarget`·`alerts.repeatEveryMin`·`alerts.discord.minIntervalSec`, **별도 키** `alerts.discord.webhookUrl`.
- 값 적용 우선순위: 환경 변수 > `settings` > 코드 기본값(기존 `mergeSetting` 규칙).
- **RBAC·IAM은 바꾸지 않는다.** `deploy/rbac.yaml`의 리소스·동사, AWS 권한 목록이 그대로다(AC-ALERT14).
- 클러스터 안에 배포하면 `discord.com:443` 아웃바운드가 필요하다(열린 질문 Q11). 나갈 수 없으면 발송이 `failed`로 기록되고 **화면 알림은 정상 동작한다.**

---

## 10. 저장 (구조는 DBA가 정한다)

- 이 계약은 **응답 모양**만 정한다. 테이블·컬럼·인덱스·마이그레이션은 **DBA 설계에 따른다**(`docs/specs/alerts.md` 3.7 A~E, `docs/reports/alerts/dba.md`, `docs/db/**`).
- 계약이 기대는 DBA 설계 결정 4가지(이미 구현돼 있다):
  1. **알림 본문 문자열을 저장하지 않는다.** 구성요소(키·사유 코드·대상·시각·context)로 저장하고 표시할 때 조립한다 → 로그 줄이 들어올 자리가 구조적으로 없다(`apps/api/src/database/alerts-json.ts` 머리말, 0.3).
  2. **웹훅 URL 원문을 반환하는 함수는 발송기 전용 하나뿐**(`loadWebhookUrlForDispatch()`)이고, 화면용은 `readWebhookStatus()` → `{ configured, hint, length, source, lockedByEnv, updatedAt }`만 준다.
  3. 환경 변수 `ALERTS_DISCORD_WEBHOOK_URL`이 있으면 **DB를 읽지 않고**, 저장 시도는 `SettingLockedByEnvError` → **409**다.
  4. 저장 전 형식 검증은 `checkWebhookUrl()` 하나로 하고 **오류 객체·메시지에 입력값을 담지 않는다**(코드만).
- **DBA 요청**: `alert_deliveries.status` enum(`alert_delivery_status`)에 **`skipped_no_pair`·`skipped_circuit_open` 2개**를 더해야 한다(1.4·3.1). 현재 10개로는 AC-ALERT32(짝 없는 해제)와 연속 실패 차단을 기록으로 구분할 수 없다. `ui` 채널 행을 만들지 않는 권장(`schema.md` 2.9)은 이 계약과 같다 — 응답의 `dispatch[]`에도 `discord`만 담는다.
- 계약이 요구하는 것(= 없으면 응답을 만들 수 없는 것): 알림 1건의 키·심각도·전이·종류·대표 사유(코드+가림된 문구)·영향 객체 10개와 전체 수·시각들·`repeatCount`·플래핑·`dataSource`·읽음 여부·연결 알림 id / 발송 기록(채널·`DispatchState`·시도 수·응답 코드·가림된 한 줄, **웹훅 URL 없음**) / 키별 상태 머신 / **heartbeat 1행(60초)** — 정지 구간(`gaps[]`·`watch.lastObservedAt`) 계산용 / `settings`의 `alerts.*`.
- 대시보드 DB가 없으면 **메모리 최근 200건**으로 동작한다. `persistence: "memory"` + `notices`에 `ALERTS_HISTORY_MEMORY_ONLY`(AC-ALERT17). 이때 `gaps[].unknownPrevious: true`.
- 보관 90일 / 2,000건, **미해제 알림은 지우지 않는다**(AC-ALERT18). 정리는 기존 `purgeExpiredData`에 얹는다.

---

## 11. 화면이 하지 않는 것 (프론트 인수인계)

- 심각도·억제·플래핑·정지 구간·발송 제외 사유·지속 시간·개수(facets)를 **계산하지 않는다.** 전부 서버 값이다.
- 알림 키 → 화면 경로를 **매핑하지 않는다.** `href`·`logHref`를 그대로 쓴다.
- 파드가 살아 있는지 **판단하지 않는다.** `logTarget.gone`을 그대로 쓰고, 링크는 사라진 파드에도 그대로 그린다.
- 웹훅 원문을 **다루지 않는다.** 저장 성공 즉시 입력 상태와 DOM 값을 비운다.
- 테스트 발송은 확인 대화상자 없이 부르지 않는다. 쿨다운 남은 시간은 서버의 `Retry-After`/`retryAfterSec`을 쓴다.
- 배지는 `badge.unreadCount`·`badge.worstSeverity` 두 값으로만 그린다(`99+` 표기만 화면 규칙). 연결이 끊겨도 0으로 내리지 않는다.
- 목록 정렬을 바꾸지 않는다(시각 내림차순 고정). `gaps[]`를 필터 결과 배열에서 빼지 않는다.
- `alerts.created`를 받으면 행은 즉시 추가하되, `facets`·`gaps`는 `GET /api/alerts` 재조회(300ms debounce)로 맞춘다.
- `DispatchState`에 모르는 값이 오면 **칩을 그리지 않고** 확장 영역에 서버 `label`만 보여 준다(디자인 `status.md` 12.5, 2026-09-25 정정 — 화면이 실제로 그렇게 동작한다). 새 값은 디자인 12.5 표에 먼저 더해져야 칩이 생긴다.

---

## 12. 명세·디자인·공통 규약과의 차이 (이 문서의 선택)

| 항목 | 원래 | 이 계약의 선택 | 이유 |
|---|---|---|---|
| `alerts.snapshot`의 "최근 N건" | 명세 4절에 있음 | **뺀다**(6.1) | 패널이 없어졌고 모든 페이지가 구독하는 스트림에 이력을 싣지 않는다. **PM 확인 요청** |
| 목록 기본 `limit` | 공통 1.3 "생략하면 전체" | `GET /api/alerts`만 **기본 100**(최대 500) | 이력은 2,000건까지 쌓인다. 실시간 목록(가상 스크롤)과 성격이 다르다 |
| 배지 전용 엔드포인트 | 명세에 없음 | `GET /api/alerts/badge` 추가 | 스트림 없이 렌더하는 첫 로드용. **목록을 돌려주지 않는다** |
| 테스트 미리보기 | 명세는 화면 대화상자만 요구 | `GET /api/alerts/test/preview` 추가 | 대화상자가 "보낼 본문 전문"을 그대로 보여 주려면 부작용 없는 조회가 필요하다 |
| `DispatchState` | 명세 3.7 B 9개 / 디자인 union 10개 / **DB enum `alert_delivery_status` 10개**(`docs/db/schema.md` 2.9) | `skipped_no_pair`·`skipped_circuit_open` **2개 추가**, `restart_summary`는 기록 없음 | AC-ALERT32(짝 없는 해제)와 연속 실패 차단을 기록으로 구분해야 한다. **DBA 요청**(enum 값 2개 추가 마이그레이션) + 퍼블리셔·프론트 요청(칩 처리) |
| 알림 키 | 명세 3.1 8개 | **+ `system:restart`·`system:test`** | 모든 알림에 키가 있어야 저장·조회가 성립한다. DBA `ALERT_SYSTEM_KEYS`와 같은 값이고 **감시 대상 8개에는 넣지 않는다** |
| 웹훅 URL 길이 상한 | 명세에 없음 | **500자**(DBA `checkWebhookUrl`) | 저장 계층 검증 하나로 통일한다. API가 별도 정규식을 갖지 않는다 |
| 지속 시간 단위 | 공통 1.5는 `...Sec`도 허용 | **`durationMs`** | 디자인 `AlertItem.durationMs`와 이름을 맞춘다 |
| 정지 구간 | 명세는 요약 알림 안의 한 줄 | **별도 `gaps[]` 배열**로도 준다 | 디자인 5.4가 목록 안의 독립 줄(`AlertGapRow`)로 그리고 **어떤 필터로도 사라지면 안 된다.** 항목 배열에 섞으면 필터 코드가 지운다 |
| 정렬 | — | **고정**(`occurredAt` desc), `sort` 없음 | 시간 축이 뒤집히면 정지 구간·전이 흐름이 읽히지 않는다(디자인) |
| 발송 실패의 HTTP 코드 | — | 200 + `result.state` | "출처 실패는 HTTP 오류가 아니다"와 같은 결. 실패도 이력에 남아야 한다 |
| `nav`에 알림 키 | `cluster-status.md` 2.1 | **추가하지 않는다** | 알림은 상태의 파생이라 점을 달면 같은 정보가 두 번 보인다(`kops-support` 3.1, `alerts` 3.3.1). 배지 숫자만 쓴다 |

---

## 13. 변경 이력

- 2026-09-25 (설정 화면 통합 2차 후속, backend): **추가 전용 + 뜻 확정.** ① `GET /api/alerts/settings`의 **`keys[].status`·`keys[].statusSince`** 추가(알림 엔진이 이미 판단한 값). ② **`discord.lastDispatch`의 뜻을 확정**(PM 결정): 실제로 나간 시도만, `state`는 `sent`·`failed`뿐(429·재시도 남은 실패도 `failed`), 테스트 발송 포함, `skipped_*` 제외 → mock에서는 `null`. 전에는 429·재시도 실패를 `pending`으로 적을 수 있었다. ③ 서킷 재개 시각은 **기존 `discord.circuitBreaker.resumeAt`**(표에 뜻 명시), **`discord.queue.nextRetryAt`을 실제로 계산**(전에는 항상 `null`), `queue.pending`은 재시도 예정까지 센다. ④ 테스트 발송이 성공하면 서킷도 닫힌다(전에는 실패 수만 0이 되어 "0건으로 멈췄습니다" 상태가 될 수 있었다). ⑤ mock `alerts=webhook-failed`에서 `discord.circuitBreaker`를 **표시 전용**으로 "열림 · 10건 · 약 1시간 뒤 재개"로 채운다(5절, PM 결정). 실제 발송 상태와 무관.

- 2026-09-25 (logs·alerts 5b 후속, backend): **응답 모양 변경 없음.** ① 2.2.1 `logHref`에 **`at`(= `occurredAt`)을 계약대로 채움**(전에는 빠져 있었다), **`follow`는 붙지 않는다**(PM 결정 D3) — 규칙 표 추가, `at`의 의미는 `logs.md` 2.2.1. ② `logTarget.stackSearch`를 스택 상태대로 계산(전에는 항상 `false`). ③ 링크 가능 여부가 mock `logs=disabled`도 따른다. ④ 5절 `webhook-failed`에 `skipped_circuit_open` 2건·`skipped_no_pair` 1건 이력 픽스처. ⑤ 11절 "모르는 `DispatchState`는 중립 칩" → **"칩 없이 서버 `label`만"**(디자인 12.5와 맞춤).

- 2026-09-25 (alerts 계약, backend 3단계): 최초 작성. 새 엔드포인트 7개(`GET /api/alerts`, `GET /api/alerts/:id`, `GET /api/alerts/badge`, `PATCH /api/alerts/read`, `GET/PATCH /api/alerts/settings`, `GET /api/alerts/test/preview`, `POST /api/alerts/test`), SSE 토픽 `alerts` 1개 추가. 디자인 산출물(`docs/design/alerts.md`·`settings.md`·`components.md` 20~21절)의 요청 필드 반영: `durationMs`·`logHref`/`logTarget`·`facets`·`watch`(heartbeat·감시 대상 수)·`gaps[]`·`dispatch[]`·`areaLabel`·`read`. DBA 설계 반영: 본문 문자열 미저장, 웹훅 원문 반환 함수 1개, env 우선·409. **기존 엔드포인트·토픽·응답 필드·`SourceId`·RBAC 변경 없음.**
