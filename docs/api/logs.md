# API 계약: logs

- 작성: backend, 2026-09-25 (3단계 계약. **구현 전**)
- 갱신: backend, 2026-09-25 5b 후속 — **2.2.1 그 시각으로 열기(`at`·`anchorAt`)**, **11.4 진입점 링크(`logHref`)**, 9절 mock 시나리오 4개(`stream-notice`·`idle-pause`·`max-duration`·`flood`), 1.4 워크로드 합쳐보기 규칙, 6절 안내 코드 4개. **기존 필드 삭제·변경 없음**(추가만)
- 공통 규약: `docs/api/common.md` (prefix `/api`, 에러 형식, `SourceStatus`, SSE 봉투, mock 시나리오)
- 명세: `docs/specs/logs.md` (L1 AC-LOG01~24, L2 AC-LOG25~34, L3 AC-LOG35~48) / 결정 정본: `docs/reports/logs/README.md`
- 디자인: `docs/design/logs.md`, `docs/design/components.md` 20.4·20.5(`CollapsibleNotice`·`LogLineList`), 21절
- 관련 계약: `docs/api/cluster-status.md`(파드·컨테이너·컨트롤 플레인), `docs/api/alerts.md` 2.2.1(알림 → 로그 **링크만**)

---

## 0. 요약

### 0.1 이 계약이 지키는 원칙 6개

| # | 원칙 | 계약에 드러나는 곳 |
|---|---|---|
| **P1** | **가림(마스킹)은 서버에서 한다.** 가려지지 않은 원문이 API 프로세스 밖으로 나가지 않는다 | 3절. 모든 본문은 `segments[]`로 오고, `masked` 조각에는 **값이 아니라 표기**(`ap****(12자)`)가 들어 있다 |
| **P2** | **가림을 끄는 설정이 없다.** 쿼리 파라미터·헤더·환경 변수 어디에도 없다 | 2.2 요청 DTO에 그런 필드가 없다. `LOG_REDACTION`류 설정을 만들지 않는다 (AC-LOG09) |
| **P3** | **원문 보기 API를 만들지 않는다** | 이 문서의 어떤 엔드포인트도 가려진 원문을 돌려주지 않는다 (PM 결정 Q2) |
| **P4** | **한계를 응답이 정직하게 알린다** | `capabilities`·`limitations`·`notices[]`(6절). 화면이 추론하지 않는다 |
| **P5** | **로그를 어디에도 저장하지 않는다** | 11절. DB·디스크·캐시·API 자체 로그에 남기지 않는다 |
| **P6** | **로그 본문이 어드바이저·알림으로 나가지 않는다** | 11.2 |
| **P7** | **fail-closed** | 가림 처리가 실패하면 그 줄을 `kind: 'redactFailed'`로 바꾼다. 원문을 통과시키지 않는다 (AC-LOG10) |

### 0.2 화면 ↔ 엔드포인트

| 화면 | 엔드포인트 |
|---|---|
| 출처 줄·능력 칩·한계 블록·상한 | `GET /api/logs/capabilities` |
| 대상 선택(컨테이너 칩·init 그룹), 사라진 파드 화면 | `GET /api/logs/targets/:namespace/:pod` |
| 정지 조회(첫 조회, 기간·줄 수 변경, `stack` 검색) | **`POST /api/logs/query`** |
| 따라가기(tail) | `POST /api/logs/streams` → `GET /api/logs/stream/:streamId`(SSE 전용 연결) → `POST …/touch` · `POST …/close` |
| 그 시각으로 열기 (알림·Warning 이벤트 링크의 `at`) | `POST /api/logs/query`의 **`anchorAt`** (2.2.1) |
| 로그 링크를 그릴 수 있는가 (진입점 1~8) | **기존 응답의 `logHref`** — `PodItem`·`WorkloadItem`·`EventItem`·`ControlPlaneComponent`·`AlertItem` (11.4) |

- 파드·컨테이너 **목록**은 기존 `cluster` 토픽·`GET /api/cluster/pods`를 그대로 쓴다. **로그 때문에 쿠버네티스에 추가 조회를 하지 않는다**(명세 4절). `GET /api/logs/targets/*`도 informer 캐시에서만 만든다.

### 0.3 공용 스트림과 **완전히 분리**한다

- **로그 본문은 `GET /api/stream`(공용 SSE)의 어떤 이벤트에도 실리지 않는다**(AC-LOG22). 공용 스트림은 모든 구독자에게 방송되므로 로그를 보지 않는 탭까지 로그를 받게 되고, heartbeat·상태 이벤트가 로그 폭주에 밀린다.
- 로그는 **전용 연결** `GET /api/logs/stream/:streamId`를 쓴다. 토픽도 봉투 `topic` 값도 공유하지 않는다(7절).
- **상한도 따로 센다**: `LOG_MAX_STREAMS`(기본 3)는 `SSE_MAX_CLIENTS`(기본 20)와 **별개 카운터**다. 로그 스트림이 3개 차도 공용 스트림과 다른 화면은 영향을 받지 않는다(AC-LOG23).

### 0.4 쓰기 없음

- 쿠버네티스에 대한 호출은 **`pods/log` 서브리소스의 `get`** 하나뿐이다(`follow=true`도 같은 동사다). `pods/exec`·`pods/portforward`·`pods/attach`·쓰기 동사·`secrets`는 **없다**(AC-LOG01~03).
- 외부 로그 스택에 대한 호출도 **읽기 쿼리뿐**이다.
- `POST`를 쓰는 엔드포인트가 있지만(2.2·2.3) **상태를 바꾸지 않는다.** POST인 이유는 2.2에 적었다.

---

## 1. 공통 타입

### 1.1 출처와 능력 (화면은 출처 이름으로 능력을 추론하지 않는다 — AC-LOG47)

```ts
type LogSourceId = 'direct' | 'stack';

interface LogCapabilities {
  follow: boolean;              // 실시간 따라가기
  serverSearch: boolean;        // 서버 텍스트 검색 (direct: false)
  searchScope: 'fetched' | 'server';
  range: 'current_file' | 'retention';   // direct는 현재 로그 파일 안에서만
  rangeOptions: { id: string; label: string; sec: number | null }[];  // 서버가 주는 선택지 그대로
  previousGeneration: boolean;  // '이전 세대(1회 전)' 스위치 (direct만)
  gonePods: boolean;            // 사라진 파드 조회
  multiPod: boolean;            // 여러 파드 합쳐보기
  streamSplit: boolean;         // stdout/stderr 구분 (direct는 false — F6)
  retentionHours: number | null;
  labels: { search: string; searchHint: string };  // '화면 안에서 찾기' / '가져온 N줄 안에서만 찾습니다'
}
```

| 능력 | `direct` | `stack` |
|---|---|---|
| `follow` | true | true |
| `serverSearch` / `searchScope` | **false** / `fetched` | true / `server` |
| `range` / `rangeOptions` | `current_file` / 최근 5분·15분·1시간·현재 파일 전체 | `retention` / 최근 15분·1시간·6시간·24시간·7일·직접 지정 |
| `previousGeneration` | **true**(직전 1세대만) | false (기간으로 충분) |
| `gonePods` | **false** | true |
| `multiPod` | **false** | true |
| `streamSplit` | **false** | true |
| `labels.search` | `화면 안에서 찾기` | `검색` |

- **LogQL·쿼리 DSL은 응답 어디에도 나오지 않는다**(AC-LOG47). 화면이 다루는 것은 셀렉터·기간·텍스트·줄 수뿐이고, 쿼리 문자열은 서버 어댑터 안에만 있다. 어댑터를 늘려도(Elasticsearch, L4) **응답 모양과 화면은 바뀌지 않는다.**

### 1.2 `LogLine` — 화면이 본문을 파싱하지 않는다

```ts
type LogLineKind =
  | 'line'          // 보통 줄
  | 'dropped'       // 초당 상한으로 생략된 구간 (본문 없음)
  | 'binary'        // 바이너리로 판정 (본문 없음)
  | 'redactFailed'; // 가림 처리 실패 — 원문을 통과시키지 않는다 (P7)

type LogSegment =
  | { t: 'text';   v: string }
  | { t: 'masked'; v: string; rules: LogRuleRef[]; confidence: 'high' | 'suspect' };

interface LogRuleRef {
  id: string;        // 'conn_string' | 'bearer_token' | 'sql_statement' …
  label: string;     // 사람이 읽는 한국어 이름: '접속 문자열 자격 증명', 'Bearer 토큰'
}

interface LogLine {
  id: string;                 // 서버 값. 재연결해도 중복되지 않는다 (streamId/queryId + 일련번호)
  kind: LogLineKind;
  at: string | null;          // 서버가 분리한 시각 (ISO UTC). 원본에 시각이 없으면 null
  prefix: { pod: string; container: string } | null;  // stack 합쳐보기에서만
  segments: LogSegment[];     // kind: 'line'만. 나머지는 []
  truncatedBytes: number | null;  // 줄 끝 '… (N바이트 생략)'
  droppedLines: number | null;    // kind: 'dropped'
  bytes: number | null;           // kind: 'binary'
  stream: 'stdout' | 'stderr' | null;  // direct는 항상 null (F6)
}
```

- **본문은 `segments[]`로만 온다.** 화면은 `text` 조각을 그대로 그리고 `masked` 조각을 `MaskedValue variant="inline"`으로 그린다. **정규식으로 다시 파싱하지 않는다**(디자인 요청 1).
- `masked.v`는 **표기**(`ap****(12자)`, 6자 미만이면 `****(N자)`)다. 원문이 아니다.
- **ANSI 색상·제어문자 제거, 바이너리 판정, 긴 줄 자르기, 깨진 UTF-8 치환은 전부 서버가 끝낸다**(4절, AC-LOG18). 화면에 `[31m` 같은 찌꺼기가 오면 서버 결함이다.
- `kind: 'redactFailed'`는 화면에서 `[가림 처리 실패 — 줄 생략]`으로 그린다. **원문이 대신 나오지 않는다.**
- 링버퍼 위쪽 표시(`ringTop`)는 **화면이 만드는 줄**이고 서버는 보내지 않는다.

### 1.3 `LogNotice` — 코드마다 사유 한 줄이 함께 온다

```ts
interface LogNotice {
  code: string;                       // 6절 표. UPPER_SNAKE
  level: 'info' | 'warn' | 'error';
  text: string;                       // 서버가 만든 한국어 한 줄 (가림 처리됨)
  details?: Record<string, unknown>;  // 화면이 쓰는 값만 (retentionHours, deletedAt, nodeName, resumeAt …)
}
```
- 화면은 **코드 → 문구 매핑 표를 갖지 않는다.** `text`를 그대로 쓴다(디자인 요청 5). 코드는 어떤 컴포넌트·아이콘으로 그릴지 고르는 데만 쓴다.

### 1.4 `LogSelector` (출처 중립)

```ts
interface LogSelector {
  namespace: string;
  pod?: string;                 // 단일 파드 (direct는 필수)
  pods?: string[];              // stack 합쳐보기 (최대 20)
  workload?: { kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'; name: string };  // stack: 소속 파드 전체
  container?: string;           // 생략하면 서버 기본 선택 규칙(2.1.2)
  previous?: boolean;           // direct 전용. 직전 1세대
}
```

- `pods`는 **최대 20개**다. 넘으면 400 `VALIDATION_FAILED`(2026-09-25부터 DTO가 검사한다).
- **`workload`(stack 합쳐보기)는 서버가 소속 파드로 푼다** (2026-09-25). 쿠버네티스를 새로 부르지 않는다:
  - 지금 있는 파드: informer 캐시에서 소유자를 해석한 워크로드 키가 같은 파드(이름순)
  - 사라진 파드: **최근 삭제 캐시(1시간)**에서 마지막 소유자가 그 워크로드였던 파드(최근 것 먼저)
  - 합쳐서 **최대 20개**. 넘으면 `LOG_PODS_CLAMPED` 안내, 하나도 없으면 `LOG_WORKLOAD_NO_PODS`(query는 200 + 빈 줄, streams는 404)
  - 실제로 조회한 파드는 응답 `selector.resolvedPods`에 온다(그 밖에는 `null`). 줄마다 `prefix.pod`가 붙는 것은 그대로다
  - **1시간보다 오래전에 사라진 파드는 포함되지 않는다.** 그런 파드는 이름으로(`pod`/`pods`) 조회한다
  - 2026-09-25 이전 구현은 `workload`를 풀지 않고 넘겨 **네임스페이스 전체**를 조회했다(결함 수정)

---

## 2. REST

### 2.1 조회 준비

#### 2.1.1 `GET /api/logs/capabilities`

출처 줄·능력 칩·한계 블록·상한·가림 규칙 목록을 한 번에 준다. 로그 화면이 처음 여는 호출이다.

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:20:00.000Z",
  "enabled": true,
  "activeSource": "direct",
  "autoSelect": { "source": "direct", "code": "LOG_BACKEND_NOT_CONFIGURED", "text": "외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)" },
  "sources": [
    {
      "id": "stack",
      "label": "로그 스택",
      "productLabel": null,
      "selectable": false,
      "state": "not_configured",
      "disabledReason": "외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)",
      "tooltip": "로그 스택을 쓰면 가능해지는 것: 지난 로그 검색 · 기간 선택 · 사라진 파드 · 여러 파드 합쳐보기",
      "chips": [],
      "capabilities": null
    },
    {
      "id": "direct",
      "label": "직접 조회",
      "productLabel": null,
      "selectable": true,
      "state": "ok",
      "disabledReason": null,
      "tooltip": null,
      "chips": [],
      "capabilities": {
        "follow": true,
        "serverSearch": false,
        "searchScope": "fetched",
        "range": "current_file",
        "rangeOptions": [
          { "id": "5m", "label": "최근 5분", "sec": 300 },
          { "id": "15m", "label": "최근 15분", "sec": 900 },
          { "id": "1h", "label": "최근 1시간", "sec": 3600 },
          { "id": "file", "label": "현재 파일 전체", "sec": null }
        ],
        "previousGeneration": true,
        "gonePods": false,
        "multiPod": false,
        "streamSplit": false,
        "retentionHours": null,
        "labels": { "search": "화면 안에서 찾기", "searchHint": "가져온 500줄 안에서만 찾습니다. 지난 로그 검색은 외부 로그 스택이 필요합니다." }
      },
      "limitations": {
        "summary": "직접 조회 · 지난 로그·검색 없음",
        "lines": [
          { "code": "LOG_DIRECT_LIVE_ONLY", "text": "직접 조회는 지금 살아 있는 컨테이너의 현재 로그 파일만 읽습니다." },
          { "code": "LOG_DIRECT_ROTATED", "text": "노드가 로그 파일을 돌리면(보통 10MiB마다) 그 이전 내용은 남아 있어도 조회할 수 없습니다.", "hint": "노드(kubelet) 설정에 따라 다릅니다. 기본값이 10MiB입니다." },
          { "code": "LOG_DIRECT_ONE_GENERATION", "text": "재시작한 컨테이너는 직전 1세대까지만 볼 수 있습니다. 2세대 전 로그는 없습니다." },
          { "code": "LOG_DIRECT_POD_GONE", "text": "파드가 사라지면 그 로그는 볼 수 없습니다. 장애 조사에 가장 필요한 순간에 가장 약한 지점입니다 — 외부 로그 스택이 있으면 그쪽에 남습니다." }
        ]
      }
    }
  ],
  "limits": {
    "defaultLines": 500,
    "maxLines": 5000,
    "lineOptions": [200, 500, 2000, 5000],
    "maxBytes": 5242880,
    "maxLineBytes": 8192,
    "maxStreams": 3,
    "maxLinesPerSec": 2000,
    "idlePauseSec": 300,
    "maxStreamMin": 30
  },
  "streams": { "open": 0, "max": 3 },
  "redaction": {
    "alwaysOn": true,
    "notice": "비밀값 가림은 흔한 형태만 잡습니다. 완벽하지 않습니다 — 화면 공유·스크린샷 전에 직접 확인하세요.",
    "rules": [ { "id": "conn_string", "label": "접속 문자열 자격 증명", "confidence": "high" } ],
    "sourceNote": "원문은 대시보드에서 볼 수 없습니다. 필요하면 터미널에서 kubectl logs로 확인하세요."
  },
  "denyNamespaces": [],
  "notices": []
}
```

| 필드 | 규칙 |
|---|---|
| `enabled` | `LOGS_ENABLED`. `false`면 이 응답만 200으로 오고 **나머지 `/api/logs/*`는 403 `LOG_DISABLED`**. 화면은 이 값으로 사이드바 메뉴·탭·링크를 감춘다 |
| `activeSource` / `autoSelect` | **서버가 고른 기본 출처.** 화면은 이 값을 그대로 선택한다(명세 3.1 자동 선택 규칙). 자동 전환은 **절대 하지 않는다** — `stack`이 죽어도 여기 값은 `stack`으로 남고 `notices`에 `LOG_BACKEND_UNAVAILABLE`이 붙는다(AC-LOG42) |
| `sources[].selectable` / `disabledReason` / `tooltip` | 비활성 세그먼트와 툴팁 문구(디자인 3절). **비활성이어도 포커스를 받아 툴팁을 읽을 수 있어야** 한다 |
| `sources[].chips` | 능력 칩 목록 **서버가 준 그대로**: `[{ "id": "search", "label": "검색" }, … , { "id": "retention", "label": "보관 7일" }]`. `direct`는 빈 배열(없는 능력을 회색 칩으로 나열하지 않는다) |
| `sources[].limitations` | `direct`에만. `CollapsibleNotice`의 `summary`·`lines`에 그대로 들어간다. `stack`은 `null` |
| `streams.open` / `max` | 하단 상태 줄 `스트림 1/3`(디자인 7.5). **서버 값**이다 |
| `denyNamespaces` | `LOG_DENY_NAMESPACES` 목록. 네임스페이스 선택기에 `차단됨`을 표시하는 데 쓴다(설정값이고 비밀이 아니다) |
| `redaction.rules` | 3.2 목록 전체(id·한국어 이름·확신 등급). 팝오버가 이 목록을 쓴다. **화면·문서에 규칙 개수를 숫자로 박지 않는다** — 목록이 정본이고 앞으로 늘어난다 |

- 출처 상태(`sources[].state`)는 `SourceStatus`의 `SourceState`와 같은 값이다. `stack`은 새 `SourceId` **`logBackend`**를 쓰고 `GET /api/health`·`stream.source`에도 나온다(8절).
- **`not_configured`는 `degraded`가 아니다**(AC-LOG45). 로그 스택이 없는 것은 정상이다.

#### 2.1.2 `GET /api/logs/targets/:namespace/:pod`

컨테이너 칩·init 그룹·사라진 파드 화면·노드 경고를 한 번에 준다. **informer 캐시에서만** 만든다.

**응답 200 (파드가 있을 때)**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:20:00.000Z",
  "pod": {
    "ref": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" },
    "exists": true,
    "deletedAt": null,
    "phase": "Running",
    "nodeName": "i-0a1b2c3d4e5f60718",
    "nodeReporting": true,
    "isControlPlaneComponent": false
  },
  "containers": [
    { "name": "api", "init": false, "ready": false, "state": "waiting", "waitingReason": "CrashLoopBackOff", "restarts": { "total": 41, "last1h": 6 }, "hasPrevious": true, "recommended": true },
    { "name": "istio-proxy", "init": false, "ready": true, "state": "running", "waitingReason": null, "restarts": { "total": 0, "last1h": 0 }, "hasPrevious": false, "recommended": false },
    { "name": "migrate", "init": true, "ready": true, "state": "terminated", "waitingReason": null, "restarts": { "total": 0, "last1h": 0 }, "hasPrevious": false, "recommended": false }
  ],
  "defaultContainer": "api",
  "links": { "workload": "/cluster/workloads?focus=Deployment/prod/api", "events": "/cluster/events?target=prod/api-7f9c8d6b5-x2kq9", "node": "/cluster/nodes/i-0a1b2c3d4e5f60718" },
  "notices": []
}
```

| 규칙 | 내용 |
|---|---|
| `defaultContainer` | **서버가 고른다**(명세 3.8.2): ① 준비되지 않았거나 재시작 중인 컨테이너, ② 없으면 첫 번째 일반 컨테이너. 화면은 이 값을 그대로 쓴다 |
| `containers[].init` | init 컨테이너는 **별도 그룹**으로 그린다. 이미 끝난 init도 파드가 있는 한 목록에 남는다(로그가 없으면 `LOG_EMPTY`이고 오류가 아니다) |
| `containers[].hasPrevious` | `이전 세대(1회 전)` 스위치를 켤 수 있는지. `false`인데 켜서 조회하면 `LOG_PREVIOUS_NOT_AVAILABLE` |
| `pod.nodeReporting: false` | `notices`에 `LOG_NODE_NOT_REPORTING`. **조회를 막지 않는다**(성공할 수도 있다, AC-LOG32) |
| `pod.isControlPlaneComponent: true` | `notices`에 `LOG_APISERVER_SELF_DEPENDENCY`(+ 스택이 있으면 두 번째 줄)와 민감도 경고. 11절 |

**응답 200 (파드가 사라졌을 때 — S3 화면)**
```json
{
  "pod": { "ref": { "kind": "Pod", "namespace": "prod", "name": "worker-5d1f…" }, "exists": false, "deletedAt": "2026-09-25T14:02:10.000Z", "phase": null, "nodeName": null, "nodeReporting": null, "isControlPlaneComponent": false },
  "containers": [],
  "defaultContainer": null,
  "links": { "workload": "/cluster/workloads?focus=Deployment/prod/worker", "events": "/cluster/events?target=prod/worker-5d1f…", "node": null },
  "stackSearch": { "available": true, "hint": "로그 스택에서 이 파드 찾기" },
  "notices": [
    { "code": "LOG_POD_NOT_FOUND", "level": "info", "text": "이 파드는 더 이상 존재하지 않습니다. 쿠버네티스는 파드 객체가 사라지면 그 컨테이너 로그를 더 이상 제공하지 않습니다.", "details": { "deletedAt": "2026-09-25T14:02:10.000Z" } }
  ]
}
```
- **404가 아니라 200이다.** "파드가 없다"는 조사에 필요한 **사실**이고 화면이 전용 안내를 그려야 한다(AC-LOG26: 빈 로그 화면이나 오류 스택이 아니다). 404는 `POST /api/logs/query`에서 쓴다(6절).
- `deletedAt`은 **알면** 채운다: 최근 삭제 캐시(informer delete 이벤트, 기본 최근 1시간·200건)에서 온다. 모르면 `null`이고 화면은 시각 없이 같은 문장을 쓴다.
- `stackSearch.available`은 `logBackend` 출처가 `ok`일 때만 `true`(디자인 10절 버튼).
- **`exists`·`deletedAt`·`stackSearch`는 서버 값이다.** 화면이 "파드가 아직 있을 것"이라고 추측하지 않는다. `alerts`의 `logTarget.gone`도 같은 캐시에서 온다(`alerts.md` 2.2.1).

### 2.2 `POST /api/logs/query` (정지 조회)

**왜 GET이 아니라 POST인가**: 셀렉터와 **검색어**가 URL에 들어가면 프록시 접근 로그·브라우저 이력·리퍼러에 남는다. 사용자가 검색칸에 비밀값을 칠 수도 있다(명세 3.3.4). 본문으로 받으면 그 경로가 생기지 않는다. **상태를 바꾸지 않는 조회**이고, `Origin` 검사(`common.md` 1.2)와 `Content-Type: application/json`(415) 규칙을 적용한다(명세 3.3.6).

요청:
```json
{
  "source": "direct",
  "selector": { "namespace": "prod", "pod": "api-7f9c8d6b5-x2kq9", "container": "api", "previous": false },
  "range": { "sinceSec": 3600 },
  "limit": 500,
  "search": null
}
```

| 필드 | 규칙 |
|---|---|
| `source` | `direct` \| `stack`. 생략하면 `capabilities.activeSource` |
| `selector` | 1.4. `direct`는 `pod` 필수·`pods`/`workload` 금지(400) |
| `range` | `{ sinceSec }` \| `{ from, to }` \| `{ whole: true }`(direct의 `현재 파일 전체`). `stack`은 `from`·`to` 범위가 `LOG_BACKEND_MAX_RANGE_HOURS`를 넘으면 400 |
| `limit` | 1 ~ `LOG_MAX_LINES`(5000). 생략하면 `LOG_DEFAULT_LINES`(500). **넘으면 400이 아니라 상한으로 자르고** `LOG_LIMIT_CLAMPED` notice를 준다(AC-LOG14) |
| `search` | `{ text, caseSensitive? }`. **`capabilities.serverSearch`가 `false`인 출처에 보내면 400** — 화면이 "될 것 같다"고 보내는 일을 막는다 |
| `previous` | `stack`에 보내면 400(기간으로 충분) |
| **`anchorAt`** | ISO 8601. **그 시각으로 열기**(2.2.1). 링크의 `at`을 그대로 넣는다. `range`를 생략하면 서버가 그 시각을 덮는 기간을 고른다. **정지 조회 전용**(스트림에 보내면 400) |

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-25T14:20:00.000Z",
  "queryId": "q-8f1c2d",
  "source": { "id": "direct", "label": "직접 조회", "state": "ok" },
  "capabilities": { "…": "1.1과 같은 객체" },
  "selector": { "namespace": "prod", "pod": "api-7f9c8d6b5-x2kq9", "container": "api", "previous": false },
  "range": { "from": "2026-09-25T13:20:00.000Z", "to": "2026-09-25T14:20:00.000Z", "whole": false },
  "lines": [
    {
      "id": "q-8f1c2d:1",
      "kind": "line",
      "at": "2026-09-25T14:02:10.412Z",
      "prefix": null,
      "segments": [
        { "t": "text", "v": "Caused by: java.net.ConnectException: postgres://" },
        { "t": "masked", "v": "ap****(12자)", "rules": [ { "id": "conn_string", "label": "접속 문자열 자격 증명" } ], "confidence": "high" },
        { "t": "text", "v": "@postgres.db.svc:5432/app" }
      ],
      "truncatedBytes": null,
      "droppedLines": null,
      "bytes": null,
      "stream": null
    }
  ],
  "stats": { "returned": 500, "requested": 500, "bytes": 812340, "redactedLines": 3, "redactedCount": 4, "truncatedLines": 1, "droppedLines": 0, "binaryLines": 0, "redactFailedLines": 0 },
  "streams": { "open": 0, "max": 3 },
  "notices": [
    { "code": "LOG_REDACTED", "level": "info", "text": "가림 4건", "details": { "lines": 3, "count": 4 } }
  ]
}
```

- `lines`는 **시각 오름차순**(오래된 것 → 새것)이다. 화면은 아래에 붙여 그리고 따라가기와 같은 방향을 쓴다.
- **`anchor`**: `anchorAt`을 보냈을 때만 객체(2.2.1), 아니면 `null`. (2026-09-25 추가)
- **`selector.resolvedPods`**: stack에서 `selector.workload`를 서버가 풀어 실제로 조회한 파드(1.4). 그 밖에는 `null`. (2026-09-25 추가)
- `range`: stack은 서버가 확정한 `from`·`to`를 준다(`anchorAt`으로 고른 기간 포함).
- `stats.redactedCount`는 하단 상태 줄 `가림 3건`(디자인 7.5)에 쓴다.
- 자동 새로고침은 없다. 다시 부르는 것은 사용자가 결정한다(명세 3.8.3).

#### 2.2.1 그 시각으로 열기 — 링크의 `at`과 `anchorAt` (2026-09-25, PM 결정 D3·Q11)

알림과 Warning 이벤트에서 오는 링크에는 `follow` 대신 **`at=<ISO 시각>`**이 붙는다(11.4). `at`은 **"그 시각 근처의 줄을 보여 달라"**는 뜻이다. D3은 따라가기를 꺼서 그 지점을 잃지 않게 할 뿐이고, **그 지점으로 데려가는 것이 이 절이다.**

**화면이 할 일**

1. `/logs?…&at=…`로 열리면 **따라가기를 끈 채로**(정지 조회) `POST /api/logs/query`에 `anchorAt: <at 값>`을 넣어 부른다. **`range`는 보내지 않는다** — 서버가 출처에 맞게 고른다(아래 표).
2. 응답 `anchor.lineId` 줄로 스크롤하고 그 줄에 "그 시각" 표식을 그린다(모양은 디자인 6.2). `anchor.state`가 `found`가 아니면 `notices`의 `LOG_ANCHOR_*` 한 줄을 **그대로** 보여 준다.
3. `at`이 URL에 남아 있는 동안 다시 조회할 때(줄 수·이전 세대·출처 변경)도 `anchorAt`을 계속 보낸다. 사용자가 기간을 직접 고르면 그 `range`를 함께 보내고, 서버는 그 기간 안에서 찾는다(밖이면 `outside_range`).
4. 사용자가 `따라가기`를 켜면 URL에서 `at`을 뗀다. **스트림(`POST /api/logs/streams`)에 `anchorAt`을 보내면 400**이다.
5. **화면은 시각을 비교하지 않는다.** 줄의 `at`과 링크의 `at`을 화면이 맞춰 보면, 줄이 잘렸거나 회전됐을 때 엉뚱한 줄을 "그 시각"으로 표시한다. 서버의 `anchor`만 쓴다.

**출처별 정의**

| | `direct` (직접 조회) | `stack` (로그 스택) |
|---|---|---|
| 서버가 고르는 기간 (`range` 생략 시) | **그 시각 2분 앞부터 지금까지** (`sinceSec = 지금 − at + 120`). `pods/log`는 끝 시각을 받지 않고 **최근 `limit`줄**을 준다 | **그 시각 앞뒤 5분** (`from = at − 5분`, `to = min(지금, at + 5분)`) |
| 그 시각의 줄 | 가져온 줄 중 서버가 분리한 `at` ≥ 그 시각인 **첫 줄** | 같음 |
| 못 닿는 흔한 이유 | ① 그 뒤로 줄이 `limit`보다 많다 → 줄 수를 늘린다 ② 그 시각에는 **지금 컨테이너가 시작 전**이었다(재시작) → `이전 세대` ③ 로그 파일이 회전됐다 → 볼 수 없다(한계 블록 2번 줄) | ① 앞뒤 5분의 줄이 `limit`보다 많다 → 줄 수를 늘리거나 기간을 좁힌다 ② 보관 기간 밖 → `LOG_RETENTION_EXCEEDED` |
| 구분하지 못하는 것 | **"그 사이 출력이 없었다"와 "회전으로 사라졌다"를 구분할 수 없다.** 기간 시작부터 빠짐없이 가져왔는데 첫 줄이 그 시각 뒤면 `found`(조용했던 구간, 첫 줄)로 본다 | — |

요청 `anchorAt`(2.2 표) → 응답:

```json
"anchor": { "at": "2026-09-25T14:02:05.000Z", "state": "found", "lineId": "q-8f1c2d:412" }
```

| `anchor.state` | 뜻 | `lineId` | 안내 |
|---|---|---|---|
| `found` | 그 시각 이후 첫 줄을 찾았다 | 그 줄 | 없음 |
| `before_result` | 그 시각의 줄이 가져온 줄보다 **앞**이다 | 가져온 첫 줄 | `LOG_ANCHOR_BEFORE_RESULT` (`details.reason`·`details.suggest`) |
| `after_result` | 그 시각 **이후로 출력이 없다** | 마지막 줄 | `LOG_ANCHOR_AFTER_RESULT` |
| `none` | 시각이 있는 줄이 없다(빈 결과 등) | `null` | 기존 안내(`LOG_EMPTY` 등) |

`LOG_ANCHOR_BEFORE_RESULT`의 `details.reason`

| `reason` | 언제 | `suggest` | 서버 문구 (`text`) |
|---|---|---|---|
| `cut` | 줄 수 상한에 걸려 그 시각까지 닿지 않았다 | `more_lines` (이미 `LOG_MAX_LINES`면 direct `null` / stack `range`) | `그 시각의 줄은 가져온 500줄보다 앞에 있습니다. 줄 수를 늘려 다시 조회하세요.` |
| `earlier_generation` | direct: 그 시각에는 지금 컨테이너가 시작 전이었다(현재 세대의 시작 시각 > 그 시각). `이전 세대`로 조회 중이면 판단하지 않는다 | `previous` | `그 시각에는 지금 컨테이너가 아직 시작되기 전이었습니다(재시작됨). 재시작 직전 로그는 '이전 세대(1회 전)'에 있을 수 있습니다 — 직접 조회는 직전 1세대까지만 봅니다.` |
| `outside_range` | 사용자가 고른 기간 밖이다 | `range` | `그 시각은 고른 기간 밖입니다. 기간을 넓혀 다시 조회하세요.` |
| `file_start` | direct `현재 파일 전체`에서 파일의 첫 줄이 그 시각보다 뒤다 | `null` | `현재 로그 파일의 첫 줄이 그 시각보다 뒤입니다. 그 사이 출력이 없었거나, 로그 파일이 회전돼 직접 조회로는 볼 수 없습니다.` |

- `suggest`는 화면이 **바로가기 버튼**(`이전 세대 보기`·`줄 수 늘리기`·`기간 넓히기`)을 붙일지 고르는 데만 쓴다. 문구는 `text` 그대로다. 버튼 모양은 디자인 몫이다.
- `details.at`은 요청한 시각(정규화 ISO). 화면이 표식에 시각을 적을 때 쓴다(서버 문구에는 시계를 넣지 않는다 — 시간대를 화면이 정한다).
- **Warning 이벤트 링크의 `at`은 `lastSeenAt`(마지막 발생)**이다. 반복 이벤트의 가장 최근 발생이 현재 로그 파일에 남아 있을 가능성이 가장 높다. **알림 링크의 `at`은 `occurredAt`**이다(`alerts.md` 2.2.1).
- 사라진 파드면 `at`과 무관하게 S3 화면이다(`GET /api/logs/targets/*`가 `exists: false`). stack이 있으면 `로그 스택에서 이 파드 찾기`가 같은 `anchorAt`으로 조회한다.

### 2.3 따라가기(tail) — 전용 스트림

#### 2.3.1 `POST /api/logs/streams` (준비)

요청 본문은 2.2와 같고 `follow` 의미가 기본이다(`limit`은 **처음에 받을 줄 수**).

**응답 201**
```json
{
  "streamId": "ls_9f3a1c7e",
  "url": "/api/logs/stream/ls_9f3a1c7e",
  "expiresAt": "2026-09-25T14:20:30.000Z",
  "source": { "id": "direct", "label": "직접 조회", "state": "ok" },
  "capabilities": { "…": "1.1" },
  "limits": { "maxLinesPerSec": 2000, "idlePauseSec": 300, "maxStreamMin": 30 },
  "streams": { "open": 1, "max": 3 },
  "notices": []
}
```

| 규칙 | 내용 |
|---|---|
| **왜 두 단계인가** | ① 상한 초과·권한 없음·파드 없음을 **읽을 수 있는 JSON 오류**로 돌려줄 수 있다(EventSource는 오류 본문을 읽지 못한다). ② `LOG_MAX_STREAMS`를 연결 전에 정확히 센다. ③ 검색어·셀렉터가 URL에 남지 않는다 |
| `expiresAt` | 기본 **30초**. 그 안에 `GET /api/logs/stream/:id`로 연결하지 않으면 버려지고 슬롯이 돌아온다 |
| 슬롯 | **SSE 연결이 살아 있는 동안** 차지한다. 일시정지(`log.paused`) 상태도 연결이 살아 있으므로 슬롯을 쓴다 → 화면을 떠나면 반드시 `close`(2.3.4) |
| `previous: true` | **스트림을 열 수 없다**(400). 이전 세대는 정지 조회만 가능하다(끝난 로그라 따라갈 것이 없다) |
| `anchorAt` | **400**. 그 시각으로 열기는 정지 조회 전용이다(따라가기를 켜면 맨 아래로 붙어 그 시각을 잃는다, D3) |
| stack `selector.workload` | **준비 단계에서** 소속 파드로 푼다(1.4). 하나도 없으면 **404 `LOG_WORKLOAD_NO_PODS`**. 푼 목록은 `log.hello.selector.resolvedPods`(조회 응답과 같은 이름)와 기존 `selector.pods`에 함께 온다(7절) |
| 상한 초과 문구 | 503의 `message`: `로그 보기를 동시에 3개까지 열 수 있습니다. 다른 탭의 로그 화면이나 펼쳐 둔 파드 상세 로그를 닫아 주세요.` (PM 결정 2026-09-25 — 펼쳐 둔 파드 상세 섹션도 슬롯을 쓴다. `3` = `LOG_MAX_STREAMS`) |

**에러**: 403 `LOG_DISABLED` / 403 `LOG_FORBIDDEN` / 403 `LOG_NAMESPACE_DENIED` / 404 `LOG_POD_NOT_FOUND` / 404 `LOG_WORKLOAD_NO_PODS`(stack 워크로드) / 400 `VALIDATION_FAILED` / **503 `LOG_STREAM_LIMIT_REACHED`**(`details.open`·`details.max`, AC-LOG23).

#### 2.3.2 `GET /api/logs/stream/:streamId` (SSE 전용 연결)

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```
- **`retry:`를 보내지 않는다.** 브라우저가 자동 재연결해도 그 `streamId`는 이미 소비됐거나 만료됐으므로 404로 끝난다(EventSource는 404를 받으면 재시도를 멈춘다). 다시 보려면 화면이 `POST /api/logs/streams`를 다시 부른다.
- 봉투는 공용 스트림과 **다르다**(`topic` 없음):
```ts
interface LogStreamEnvelope<T> { seq: number; event: string; emittedAt: string; payload: T }
```
- 이벤트는 7절.
- 없는·만료된 `streamId`: **404** `LOG_STREAM_NOT_FOUND`(JSON).

#### 2.3.3 `POST /api/logs/streams/:streamId/touch` (살아 있음 신호)

- 본문 없음. **202**.
- 화면이 **보이는 동안 60초마다** 보낸다(탭이 백그라운드가 되면 멈춘다). 마지막 `touch` 이후 `LOG_STREAM_IDLE_PAUSE_SEC`(300초) 동안 신호가 없으면 서버가 **위쪽 출처 연결을 끊고** `log.paused`를 보낸다.
- 없는 스트림: 404 `LOG_STREAM_NOT_FOUND`.

#### 2.3.4 `POST /api/logs/streams/:streamId/close` (종료)

- 본문 없음. **204**. 위쪽 연결을 끊고 슬롯을 돌려준다.
- 화면을 떠날 때 반드시 부른다. `navigator.sendBeacon`으로도 보낼 수 있게 **POST에 본문 없음**으로 정의했다(`DELETE`는 beacon으로 못 보낸다).
- 이미 닫혔으면 204(멱등). SSE 연결이 먼저 끊겨도 서버는 슬롯을 회수한다.

---

## 3. 가림(마스킹)

### 3.1 규약

- 가림은 **서버에서만** 일어난다. 브라우저 개발자 도구의 응답 본문에도 원문이 없다(AC-LOG05).
- 적용 범위: 로그 본문 + **로그 스택이 돌려준 오류 메시지**(쿼리를 되비추는 경우가 있다) + 서버가 만든 사유 문자열.
- **표기**: `앞 2글자****(N자)`. 원문이 6자 미만이면 `****(N자)`. `k8s-snapshot`·드리프트와 **같은 형식**이다.
- **커넥션 스트링은 자격 증명만** 가리고 호스트·포트·DB 이름은 남긴다(AC-LOG06) — 조사에 필요하다.
- **식별자는 가리지 않는다**: IP, EC2 인스턴스 ID(`i-0…`), AWS 계정 ID, ARN. kOps에서 노드 이름이 인스턴스 ID라(F9) 가리면 "어느 노드인지"를 알 수 없다. 로그는 어드바이저로 나가지 않으므로(11.2) 가명 처리가 필요 없다.
- **fail-closed**(P7): 가림 처리 중 예외가 나면 그 줄을 `kind: 'redactFailed'` + `segments: []`로 바꾼다. 원문은 통과하지 않는다.
- **가림 표식은 줄 왼쪽 sticky gutter에** 그린다(PM 결정 2026-09-25, 디자인 7.1). 줄 바꿈을 끄면 오른쪽 끝이 가로 스크롤 뒤로 사라져 표식이 보이지 않기 때문이다. 계약은 위치를 강제하지 않지만 `segments[]`·`rules[]`가 **줄 단위로 집계 가능**하게 온다(화면이 gutter 개수를 셀 수 있다).

### 3.2 규칙 목록

> **개수를 숫자로 고정하지 않는다.** 아래 목록이 정본이고 앞으로 늘어난다. 화면은 `capabilities.redaction.rules`(서버가 주는 목록)를 그대로 쓰고, 문서나 코드에 "N종"을 박아 두지 않는다.

| id | `label` (한국어, 응답에 그대로) | 대상 | 확신 | 치환 |
|---|---|---|---|---|
| `aws_access_key` | AWS 액세스 키 | `AKIA`/`ASIA` + 16자 | `high` | `AK****(20자)` |
| `aws_secret_key` | AWS 시크릿 키 | `aws_secret`·`secret_access_key` 인접 40자 | `high` | 앞 2글자 + `****(N자)` |
| `bearer_token` | Bearer 토큰 | `Authorization:` 값, `Bearer <20자 이상>` | `high` | 〃 |
| `jwt` | JWT · 서비스 계정 토큰 | `eyJ`로 시작하는 3파트 | `high` | 〃 |
| `kv_secret` | 비밀 키-값 | `password`·`passwd`·`pwd`·`secret`·`token`·`api[-_]key`·`access[-_]key`·`client[-_]secret` 뒤의 값 | `high` | 〃 |
| `conn_string` | 접속 문자열 자격 증명 | `postgres://`·`mysql://`·`mongodb://`·`redis://`·`amqp://`·`https://`의 `user:pass@` | `high` | 자격 증명만 |
| `private_key_block` | 개인 키 블록 | `-----BEGIN … PRIVATE KEY-----` ~ `-----END …-----` | `high` | 블록 전체를 한 줄 `[가림: 개인 키 블록 N줄]`로 접는다 |
| `vendor_token` | 서비스 토큰 | `sk-ant-`, `sk-`, `ghp_`·`gho_`·`github_pat_`, `xox[baprs]-`, `AIza` | `high` | 앞 2글자 + `****(N자)` |
| `env_dump` | 환경 변수 덤프 | 한 줄에 `KEY=VALUE` 3쌍 이상 + 민감어 | `high` | 해당 값만 |
| **`sql_statement`** | **SQL 문·오류 설명의 값** | **Postgres 서버 로그에서 값이 오는 자리**: `STATEMENT:`/`QUERY:`/`statement:`/`execute <name>:` 뒤, `Key (cols)=(vals)`, `Failing row contains (…)`, `parameters: $1 = '…'`, `SQL statement "…"`, `invalid input syntax … : "…"` | `high` | **값 자리만 `?`** (다른 규칙과 달리 `앞 2글자****(N자)`를 쓰지 않는다. 3.2.1) |
| `long_opaque` | 긴 불투명 문자열 | 32자 이상 연속 hex/base64 | **`suspect`** | 앞 2글자 + `****(N자)` |

- `confidence: 'suspect'`는 오탐이 있을 수 있다(커밋 해시·트레이스 ID). **그래도 기본으로 가리고**, 화면이 규칙 이름과 등급을 보여 주어 사용자가 "이건 그냥 해시였구나"를 알 수 있게 한다(AC-LOG07).

#### 3.2.1 `sql_statement` — 왜 있고, 어떻게 동작하는가 (DBA 실측, 2026-09-24 갱신)

**왜 필요한가**

- 모니터링 대상 Postgres는 `log_statement=none`이 기본이라 평상시 쿼리는 로그에 남지 않는다. **그러나 `log_min_error_statement=error`가 기본이라 오류가 난 문장은 원문이 파드 로그에 남는다.** 제약 위반이면 값까지 남는다:
  `DETAIL:  Key (email)=(a@b.com) already exists.`
- 이것이 `cluster-status` 가정 A7("쿼리 원문을 화면에 보여주지 않는다")이 지키려던 개인정보다. 로그 화면을 만들면 그대로 보인다.
- **대상 DB 설정을 바꾸는 것은 답이 아니다.** `log_min_error_statement`를 `panic`으로 올리면 DBA가 장애를 못 보고, 무엇보다 **관측 대상에 대한 쓰기**라 조회 전용 원칙 위반이다. 그래서 가림 규칙으로 푼다.

**줄 전체에 `maskSqlLiterals()`를 돌리지 않는다** (초기 권고를 폐기했다. DBA 실측 12종)

| 시도 | 결과 |
|---|---|
| `DETAIL:  Key (email)=(a@b.com) already exists.` | **아무것도 안 바뀐다.** 값이 따옴표 없는 맨 토큰이라 SQL 리터럴이 아니다 — **이 건을 시작한 바로 그 줄이 안 잡힌다** |
| `DETAIL:  Failing row contains (1, alice, a@b.com, …)` | **숫자만 `?`, 문자열은 남는다.** 행 전체가 사용자 데이터라 더 위험하다 |
| `invalid input syntax for type integer: "abc"` | 그대로 남는다 |
| 줄 **전체**에 적용 | `2026-09-24 12:00:00.123 UTC [123]` → `?-?-? ?:?:? UTC [?]`. **"구조는 남는다"(AC-LOG49)에 정면으로 어긋나고**, 목적도 못 이루면서 로그를 읽을 수 없게 만든다 |

**대신 "값이 오는 자리"를 찾는 계층을 쓴다** (`apps/api/src/database/health/sanitize.ts`)

```ts
import { createPgLogValueMasker } from '.../database/health/sanitize';
const mask = createPgLogValueMasker();   // 조회·스트림 1건당 하나, 줄 순서대로
lines.map(mask);                          // 순서를 보장할 수 없으면 무상태 maskPgLogValues(line)
```

| 규칙 | 동작 |
|---|---|
| 마커(`STATEMENT:`·`QUERY:`·`statement:`·`execute <name>:`) | **뒤쪽에만** 리터럴 스캐너를 돌린다 → 타임스탬프·PID·심각도·제약 이름이 **남는다** |
| `Key (cols)=(vals)` | → **`Key (cols)=(?)`**. **컬럼 이름은 남는다**("어느 컬럼이 걸렸나"가 조사에 필요하다) |
| `Failing row contains (…)` | 그룹 전체를 `?` 하나로. **쉼표로 쪼개지 않는다** — 값 안에 쉼표가 들어갈 수 있어(`Doe, John`) 개수를 믿을 수 없다 |
| `parameters: $1 = '…'`, `SQL statement "…"`, `invalid input syntax … : "…"` | 값 자리만 |
| 여러 줄 문장 | **상태를 쓴다.** 직전 줄이 마커로 문장을 열었을 때만 들여쓴 다음 줄을 문장 조각으로 본다. 무상태로 "들여쓴 줄 = SQL"로 처리하면 앱 스택 트레이스(`\tat com.foo.Bar(Bar.java:42)`)의 줄 번호까지 `?`가 된다 |

**계약에서의 취급**

- `sql_statement`는 **규칙 하나**이고 `kv_secret`·`conn_string` 등과 **함께** 돌아간다. 규칙을 두 벌로 두지 않는다.
- **가림 여부 판정은 입력·출력 문자열 비교**로 한다(치환이 일어났으면 그 줄에 `masked` 조각이 생긴다).
- 응답 형식은 다른 규칙과 **동일**하다(`segments[].masked` + `rules[]` + `confidence`). **치환 결과만 `?`**이고 `앞 2글자****(N자)`가 아니다 — 화면은 `masked.v`를 그대로 그리므로 특별 처리가 필요 없다.
- 이 규칙은 DB 파드 로그에만 적용되는 것이 아니라 **모든 로그에 같은 규칙으로** 적용된다(출처가 달라도 규칙은 하나).
- **한계(정직하게 적는다)**: ① 실제 파드 로그로 검증하지 못했다 — DBA가 손으로 재현한 12종으로 확인했다(다만 접두어를 파싱하지 않고 **마커만 찾으므로 `log_line_prefix` 설정에 영향받지 않는다**). ② **오퍼레이터의 JSON 로그 형식**(`logging_collector`/`jsonlog`)에서는 값이 가려지는 것은 확인했지만 **JSON 구조 안에서의 동작을 실측하지 않았다.** 월요일에 실제 로그로 확인할 목록에 넣는다.

### 3.3 응답에 드러나는 방식

- 줄 단위: `segments[].masked.rules[]`(id + 한국어 label)와 `confidence`.
- 조회 단위: `stats.redactedLines` / `stats.redactedCount` → 하단 상태 줄 `가림 3건`.
- 상시 문구: `capabilities.redaction.notice`(닫을 수 없다, AC-LOG08)와 `redaction.sourceNote`(팝오버 맨 아래 한 줄).
- **원문 보기·복사 버튼·`kubectl logs` 명령 상자를 제공하는 필드가 없다**(PM 결정 Q2·Q10).

---

## 4. 줄 처리 (서버가 끝낸다)

| 대상 | 처리 | 응답 |
|---|---|---|
| 시각 | `direct`는 `timestamps=true`로 받아 서버가 시각·본문을 분리 | `at` |
| ANSI 색상·제어 시퀀스 | **제거**하고 평문으로 | 흔적 없음 |
| 인쇄 불가 제어문자 | `·`(U+00B7)로 치환 | 〃 |
| 깨진 UTF-8 | U+FFFD로 치환 | 〃 |
| 바이너리 줄 | 인쇄 불가 문자 비율 30% 이상이면 줄 전체를 접는다 | `kind: 'binary'`, `bytes` |
| 아주 긴 줄 | `LOG_MAX_LINE_BYTES`(8 KiB)에서 자른다 | `truncatedBytes` + notice `LOG_TRUNCATED_LINE` |
| 초당 상한 초과 | 버리고 생략 구간을 한 줄로 알린다 | `kind: 'dropped'`, `droppedLines` + notice `LOG_DROPPED_LINES` |
| 개인 키 블록 | 블록 전체를 한 줄로 접는다 | `segments`에 `masked`(rule `private_key_block`) |
| HTML·스크립트 문자열 | 그대로 텍스트로 (이스케이프는 화면 렌더러가) | — |

- 스택 트레이스는 **여러 줄 그대로** 둔다. 줄 묶음 추론을 하지 않는다(포맷마다 다르다).

---

## 5. 상한과 과부하 방어

| 항목 | 설정 | 기본 | 응답에 드러나는 곳 |
|---|---|---|---|
| 첫 조회 줄 수 | `LOG_DEFAULT_LINES` | 500 | `limits.defaultLines` |
| 한 번에 가져올 줄 수 | `LOG_MAX_LINES` | 5,000 | 초과 요청은 잘리고 `LOG_LIMIT_CLAMPED` |
| 바이트 상한 | `LOG_MAX_BYTES` | 5 MiB | `LOG_BYTES_LIMIT_REACHED` |
| 한 줄 길이 | `LOG_MAX_LINE_BYTES` | 8 KiB | `truncatedBytes` |
| **동시 로그 스트림** | `LOG_MAX_STREAMS` | **3** | `streams.open/max`, 503 `LOG_STREAM_LIMIT_REACHED`. **`SSE_MAX_CLIENTS`(20)와 별도 계산** |
| 초당 줄 수 | `LOG_STREAM_MAX_LPS` | 2,000 | `kind: 'dropped'` 줄 + `LOG_DROPPED_LINES` |
| 유휴 자동 일시정지 | `LOG_STREAM_IDLE_PAUSE_SEC` | 300 | `log.paused` + `LOG_STREAM_IDLE_PAUSED` |
| 한 스트림 최대 지속 | `LOG_STREAM_MAX_MIN` | 30 | `log.closing` + `LOG_STREAM_MAX_DURATION` |
| 배치 주기 | (고정) | **250ms** | `log.lines` 한 번에 묶어 보낸다 |

- **250ms 배치**: 줄 하나에 이벤트 하나면 초당 2,000 이벤트가 되어 브라우저가 렌더에 갇힌다. 묶으면 초당 4회 갱신이고 사람 눈에는 실시간과 같다(명세 4절, 화면 반영 1초 이내).
- **따라가기를 끄면 서버가 위쪽 연결을 닫는다.** "일시정지"는 화면 상태가 아니라 실제 연결 해제다.

---

## 6. 안내 코드 (`LogNotice.code`) · HTTP 매핑

**코드마다 서버가 사유 한 줄(`text`)을 함께 준다.** 화면은 매핑 표를 갖지 않는다.

**mock과 live가 같은 모양을 준다. 이 표가 정본이다** (PM 결정 2026-09-25). "notice"인 코드는 live 조회에서도 **HTTP 200 + 줄 0개 + `notices[]`**로 온다(오류 응답이 아니다). 코드별로 mock 응답과 live 응답의 모양(줄 수·출처·안내 코드·등급·문구·`details` 키)이 같다는 것을 테스트가 고정한다(`logs.service.live.spec.ts`). **이 표에 없는 코드는 나가지 않는다.**

| code | 어디로 오나 | 뜻 |
|---|---|---|
| `LOG_DISABLED` | **403** | `LOGS_ENABLED=false`. `GET /api/logs/capabilities`만 200(`enabled: false`) |
| `LOG_SOURCE_NOT_CONFIGURED` | notice (`capabilities` + 조회 200) | 클러스터 연결도 로그 스택도 없음 → 화면 전체 `알 수 없음`. **mock 로그를 대신 보여주지 않는다**(AC-LOG24). `level: warn` |
| `LOG_FORBIDDEN` | **403** | `pods/log` 권한 없음(쿠버네티스 403) → `deploy/rbac.yaml`을 다시 적용하세요. **다른 화면에는 영향 없다** |
| `LOG_NAMESPACE_DENIED` | **403** | `LOG_DENY_NAMESPACES` |
| `LOG_POD_NOT_FOUND` | **404**(query·streams) / notice(targets) | 파드 없음. `details.deletedAt`(알면) |
| `LOG_CONTAINER_NOT_STARTED` | notice (조회 200 / 스트림 `log.notice`) | `ContainerCreating`/`PodInitializing`. **스트림**: 연결을 닫지 않고 informer로 컨테이너가 돌기 시작하기를 **기다렸다가 붙는다**(파드 watch로 자동 재시도, 유휴·최대 지속 상한은 그대로, 기다리는 중 파드가 사라지면 `LOG_POD_NOT_FOUND`로 닫는다). 문구 `컨테이너가 아직 시작되지 않았습니다. 시작되면 자동으로 표시됩니다.` **정지 조회**: 자동으로 다시 부르지 않으므로 약속하지 않는다 — 문구 `컨테이너가 아직 시작되지 않았습니다. 따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.` (PM 결정 2026-09-25). client-node 2.0이 400 본문을 넘기지 않아 **informer 캐시(상태 없음 또는 대기 + 재시작 0)**로도 판단한다 |
| `LOG_PREVIOUS_NOT_AVAILABLE` | notice | 이전 세대 없음. **스위치를 자동으로 되돌리지 않고 안내만** |
| `LOG_KUBELET_UNREACHABLE` | notice (조회 200 / 스트림 `log.notice` 후 종료) | apiserver가 kubelet에 못 닿음(F7). `level: warn`, `details.nodeName`(조회), 문구 `노드에 연결할 수 없어 로그를 읽지 못했습니다.` 판단 문구: `dial tcp`·`connection refused`·`i/o timeout`·`no route to host`·`TLS handshake timeout`·`error dialing backend`. **`context deadline exceeded`는 넣지 않는다**(apiserver 자체 문제일 수 있다 → `LOG_UPSTREAM_ERROR`). 실클러스터 문구는 월요일 확인 |
| `LOG_NODE_NOT_REPORTING` | notice | 대상 노드 NotReady/Unknown. **조회를 막지 않는다** |
| `LOG_EMPTY` | notice | 조회 성공, 줄 0개. **오류가 아니다**. 줄이 0개인 이유를 다른 안내가 이미 말하면(출처 실패·이전 세대 없음·시작 전·워크로드 파드 없음 등) **붙이지 않는다** — 성공한 것이 아니다 (2026-09-25) |
| `LOG_BACKEND_UNAVAILABLE` | notice (`capabilities` + **조회 200, 줄 0개**) | 로그 스택 연결 실패 → `직접 조회로 전환` 버튼(`details.fallbackSource: 'direct'`). **자동 전환 없음**(AC-LOG42) — 응답 `source`는 `stack` 그대로 |
| `LOG_BACKEND_AUTH_FAILED` | notice (`capabilities` + **조회 200, 줄 0개**) | 스택 인증 실패. **자격 증명·토큰은 메시지에 없다**(AC-LOG44). `details.fallbackSource: 'direct'`, 자동 전환 없음 |
| `LOG_BACKEND_QUERY_REJECTED` | notice (**조회 200, 줄 0개**) | 스택이 쿼리 거부. 스택이 준 사유를 **가림 처리 후** `details.reason`에 그대로. 서버가 조용히 범위를 줄이지 않는다(AC-LOG43 — 응답 `range`는 요청한 기간 그대로). 연결은 살아 있으므로 출처 상태를 `unavailable`로 바꾸지 않는다 |
| `LOG_RETENTION_EXCEEDED` | notice | 보관 기간 밖 요청. `details.retentionHours`. 결과는 그대로 주고 **오류가 아니다** |
| `LOG_LIMIT_CLAMPED` | notice | 요청 줄 수가 상한으로 잘림. `details.requested`·`details.applied` |
| `LOG_BYTES_LIMIT_REACHED` | notice | 바이트 상한에 걸려 더 못 가져옴 |
| `LOG_TRUNCATED_LINE` | notice | 긴 줄 잘림(줄에는 `truncatedBytes`) |
| `LOG_DROPPED_LINES` | notice + `kind: 'dropped'` 줄 | 초당 상한 생략 |
| `LOG_BINARY_LINE` | notice + `kind: 'binary'` 줄 | 바이너리 판정 |
| `LOG_REDACTED` | notice | 가림 발생. `details.lines`·`details.count` |
| `LOG_REDACT_FAILED` | notice + `kind: 'redactFailed'` 줄 | fail-closed |
| `LOG_STREAM_LIMIT_REACHED` | **503** | 동시 스트림 상한. `details.open`·`details.max` |
| `LOG_STREAM_NOT_FOUND` | **404** | 없는·만료된 `streamId` |
| `LOG_STREAM_IDLE_PAUSED` | 이벤트 `log.paused` | 유휴 자동 일시정지. 문구 `이 화면이 5분 동안 보이지 않아 따라가기를 멈췄습니다.` — 서버는 **`touch` 신호**(화면이 보일 때만 온다)로 판단하므로 "조작이 없어"가 아니다(디자인 7.4, 2026-09-25) |
| `LOG_STREAM_MAX_DURATION` | 이벤트 `log.closing` | 30분 강제 종료. 문구 `연결을 30분마다 끊습니다(서버 보호).` (디자인 7.4) |
| `LOG_APISERVER_SELF_DEPENDENCY` | notice | 컨트롤 플레인 로그 상시 안내(11.3). `details.hint`에 etcd 도움말 한 줄 |
| `LOG_CONTROL_PLANE_SENSITIVE` | notice | 컨트롤 플레인 로그 민감도 경고(11.3) |
| `LOG_ANCHOR_BEFORE_RESULT` | notice | 그 시각의 줄이 가져온 줄보다 앞(2.2.1). `details.at`·`reason`·`suggest` |
| `LOG_ANCHOR_AFTER_RESULT` | notice | 그 시각 이후로 출력이 없다(2.2.1) |
| `LOG_PODS_CLAMPED` | notice | stack 워크로드 소속 파드가 20개를 넘어 20개만 합쳤다(1.4). `details.total`·`applied` |
| `LOG_WORKLOAD_NO_PODS` | notice(query) / **404**(streams) | stack 워크로드의 파드를 찾지 못했다(지금 것도, 최근 1시간 안에 사라진 것도 없음) |
| `LOG_BACKEND_NOT_CONFIGURED` | `sources[].disabledReason` | 스택 미설정 — **오류가 아니다** |
| `LOG_BACKEND_CONFIGURED` | `autoSelect.code` | 스택이 설정돼 있어 자동 선택했다(2.1.1). `LOG_BACKEND_NOT_CONFIGURED`의 짝 — **오류가 아니다** (2026-09-25 표에 추가, 코드는 전부터 나가고 있었다) |
| `LOG_DIRECT_LIVE_ONLY` · `LOG_DIRECT_ROTATED` · `LOG_DIRECT_ONE_GENERATION` · `LOG_DIRECT_POD_GONE` | `sources[].limitations.lines[].code` | direct 한계 4줄(2.1.1, AC-LOG19). 안내 문구 조각이지 상태가 아니다 (2026-09-25 표에 추가) |
| `LOG_STREAM_ENDED` | 이벤트 `log.closing` (`source_error`) | 쿠버네티스가 따라가기 연결을 끝냈다(컨테이너 재시작 등). `resumable: true` (2026-09-25 표에 추가) |
| `LOG_STREAM_CLOSED` | 이벤트 `log.closing` (`client`) | 화면이 `POST …/close`로 닫았다. `resumable: false` (2026-09-25 표에 추가) |
| `LOG_STREAM_SHUTDOWN` | 이벤트 `log.closing` (`shutdown`) | API 서버 종료 (2026-09-25 표에 추가) |
| **`LOG_UPSTREAM_ERROR`** | **503** (`details.status`) | 위 어느 것으로도 분류되지 않은 출처(쿠버네티스) 오류. **오류로 남는 것이 맞다**(PM 결정 2026-09-25). `details.status` = 쿠버네티스 응답 코드. 스트림에서는 `log.notice` 후 종료. 문구 `로그를 가져오지 못했습니다.` |

---

## 7. 전용 스트림 이벤트

| 이벤트 | 언제 | payload |
|---|---|---|
| `log.hello` | 연결 직후(첫 이벤트) | `{ streamId, source, capabilities, selector, limits, streams, serverTime, heartbeatSec }`. `selector`에 **`resolvedPods`**(2026-09-25 추가 — 아래) |
| `log.lines` | 초기 줄, 이후 **250ms 배치** | `{ lines: LogLine[], initial?: true, stats }` |
| `log.notice` | 상태 변화·생략·가림 등 | `LogNotice` |
| `log.paused` | 유휴 일시정지 | `{ code: 'LOG_STREAM_IDLE_PAUSED', text, resumable: true }` |
| `log.heartbeat` | **15초** | `{ serverTime }` |
| `log.closing` | 종료 직전(마지막 이벤트) | `{ reason: 'max_duration' \| 'idle' \| 'client' \| 'source_error' \| 'shutdown', code, text, resumable }` |

```
event: log.lines
data: {"seq":12,"event":"log.lines","emittedAt":"2026-09-25T14:02:10.660Z","payload":{"lines":[{"id":"ls_9f3a1c7e:412","kind":"line","at":"2026-09-25T14:02:10.412Z","prefix":null,"segments":[{"t":"text","v":"listening on :8080"}],"truncatedBytes":null,"droppedLines":null,"bytes":null,"stream":null}],"stats":{"redactedCount":0,"droppedLines":0}}}
```

- **`log.hello.selector.resolvedPods`와 `selector.pods`의 관계** (2026-09-25, 결정 8): `resolvedPods`는 조회 응답(2.2)의 `selector.resolvedPods`와 **같은 이름·같은 뜻**이다 — stack에서 `selector.workload`를 서버가 소속 파드로 풀었을 때 그 목록, 풀지 않았으면 `null`. 스트림은 준비 단계에서 푼 목록을 `selector.pods`에도 넣어 왔고 **그 필드는 그대로 둔다**(워크로드를 풀었을 때 `pods` = `resolvedPods`, 사용자가 `pods[]`를 직접 보냈을 때는 `pods`만 있고 `resolvedPods`는 `null`). **화면은 두 곳 모두 `resolvedPods` 하나로 읽는다.** 두 값이 같다는 것을 테스트가 고정한다(`logs.http.spec.ts`).
- `log.paused`·`log.closing`의 `text`는 **서버 문구 그대로** 쓴다(6절 표, 디자인 7.4 멈춤 안내). 기간은 서버 설정값으로 적힌다(`5분`·`30분`).
- **컨테이너가 아직 시작 전이면** 스트림은 `log.notice`(`LOG_CONTAINER_NOT_STARTED`)를 보내고 **닫지 않는다.** 컨테이너가 돌기 시작하면 그때 `log.lines`가 오기 시작한다(`log.hello` 뒤 첫 `log.lines`가 늦게 올 수 있다). 기다리는 동안에도 `log.heartbeat`·유휴 일시정지·최대 지속은 그대로다. 파드가 사라지면 `log.closing`(`LOG_POD_NOT_FOUND`) (2026-09-25).
- `log.closing`을 받으면 화면은 **`EventSource.close()`를 호출**한다(자동 재연결하지 않는다). 다시 보려면 `POST /api/logs/streams`부터 시작한다 — `다시 시작` 버튼이 하는 일이다.
- `log.paused` 뒤에도 연결은 유지되지만 **슬롯을 계속 차지한다.** 화면을 떠나면 `close`를 부른다(2.3.4).
- **공용 스트림에는 `logs` 토픽이 없다.** `GET /api/stream?topics=logs`는 400 `VALIDATION_FAILED`다.

---

## 8. 출처 상태 `logBackend`

- 새 `SourceId` **`logBackend`**를 추가한다(`common.md` 2.3). `GET /api/health`의 `checks.logBackend`와 `stream.source` 이벤트에 나온다(AC-LOG45).
- 상태: `ok`(연결 정상) / `not_configured`(`LOG_BACKEND` 비어 있음 — **오류가 아니고 `degraded`로 치지 않는다**) / `unavailable`(설정은 있는데 연결·인증 실패) / `mock`.
- `intervalSec` 30, `staleAfterSec` 90. **로그 화면을 보고 있을 때만** 확인한다(어드바이저 브리지와 같은 성격).
- `SourceStatus.error.code`: `LOG_BACKEND_UNAVAILABLE` / `LOG_BACKEND_AUTH_FAILED`. **자격 증명·토큰·URL 전체를 `message`에 넣지 않는다.**
- **`direct`는 별도 출처를 만들지 않는다.** 기존 `kube` 출처를 따른다(`kube`가 `unavailable`이면 직접 조회도 불가).

---

## 9. mock

`DATA_SOURCE=mock`에서 **두 출처 모두** 눈으로 동작한다. mock 시나리오 그룹 **`logs`**(`common.md` 6.1에 행 추가).

| id | 재현 |
|---|---|
| `direct` (기본) | 스택 없음 → `로그 스택` 회색, 한계 4줄, 여러 줄 스택 트레이스, OOMKilled 직전 줄, **이전 세대가 현재 세대와 다른 내용**, 초당 1~3줄이 계속 늘어남 |
| `stack` | 스택 있음(Loki) → 능력 칩 4개, 검색·기간·합쳐보기·사라진 파드가 **실제 Loki 없이** 동작 (AC-LOG48) |
| `stack-down` | 설정은 있는데 연결 실패 → `LOG_BACKEND_UNAVAILABLE` + 전환 버튼, **자동 전환 없음**. stack 조회도 **200 + 줄 0개 + 안내**(2026-09-25 전에는 503이었다) |
| `forbidden` | `pods/log` 403 |
| `empty` | 출력이 없는 컨테이너 (`LOG_EMPTY`) |
| `pod-gone` | 사라진 파드 → `exists: false` + `deletedAt` |
| `noisy` | 초당 수천 줄 → `kind: 'dropped'` 줄 |
| **`secrets`** | 환경 변수 덤프·`Bearer eyJ…`·커넥션 스트링 예외·PEM 블록·한국어 줄·**가려서는 안 되는** 커밋 해시(오탐 확인, `suspect` 표시). **`sql_statement` 확인용 Postgres 줄 3종**: `DETAIL: Key (email)=(a@b.com) already exists.` → `Key (email)=(?)`, `DETAIL: Failing row contains (1, alice, …)` → `(?)`, `STATEMENT: INSERT INTO users (email) VALUES ('a@b.com')` → 테이블·컬럼은 남고 값만 `?`. **같은 줄의 타임스탬프·PID·제약 이름은 그대로 남아야 한다**(AC-LOG49) |
| `binary` | ANSI 코드, 제어문자, 8 KiB 넘는 줄, 깨진 UTF-8, 바이너리 덩어리 |
| `control-plane` | `kube-apiserver`·`etcd-manager-main` 로그 + 자기참조 안내 |
| `disabled` | `LOGS_ENABLED=false`. **로그 링크도 함께 사라진다** — `PodItem`·`WorkloadItem`·`EventItem`·`ControlPlaneComponent`·`AlertItem`의 `logHref`가 전부 `null`이 되고 `cluster.snapshot`을 다시 보낸다(11.4, 2026-09-25) |
| **`stream-notice`** | 따라가기 연결 **10초 뒤** 초당 상한(`LOG_STREAM_MAX_LPS`)을 넘는 폭주 1회 → **`log.notice`(`LOG_DROPPED_LINES`)** + 생략 줄(`kind: 'dropped'`). 실제 push·250ms 배치·flush 경로를 탄다 (2026-09-25) |
| **`idle-pause`** | `touch`가 **20초** 없으면 **`log.paused`** (실제 기준 300초). 프론트는 60초마다 touch하므로 연결 약 20초 뒤에 온다. 문구는 `이 화면이 20초 동안 보이지 않아 따라가기를 멈췄습니다.` (2026-09-25) |
| **`max-duration`** | 연결 **30초 뒤** **`log.closing`**(`reason: max_duration`, `LOG_STREAM_MAX_DURATION`, `resumable: true`) (실제 기준 30분). 문구 `연결을 30초마다 끊습니다(서버 보호).` (2026-09-25) |
| **`container-starting`** | 시나리오를 **고른 뒤 30초 동안** 컨테이너가 시작 전이다. 따라가기: `log.notice`(`LOG_CONTAINER_NOT_STARTED`, 스트림 문구) 후 **연결을 유지**하고 30초 시점에 줄이 붙는다(live와 같은 대기 경로). 정지 조회: 200 + 줄 0개 + 같은 코드(정지 조회 문구). 다시 보려면 시나리오를 다시 고른다 (2026-09-25) |
| **`stack-auth-failed`** | 로그 스택 인증 실패 — `capabilities` 안내와 조회 응답 모두 `LOG_BACKEND_AUTH_FAILED`(live Loki 어댑터와 **같은 문구**), 조회 200 + 줄 0개, 자동 전환 없음 (2026-09-25) |
| **`stack-rejected`** | 로그 스택이 쿼리 거부 — 조회 200 + `LOG_BACKEND_QUERY_REJECTED` + `details.reason`(Loki 사유 예시). 출처 상태는 정상 (2026-09-25) |
| **`kubelet-unreachable`** | 조회 200 + `LOG_KUBELET_UNREACHABLE`(`details.nodeName`), 따라가기는 안내 후 종료 — live와 같은 모양 (2026-09-25) |
| **`flood`** | 따라가기에 **초당 상한의 80%**(기본 1,600줄/초)를 250ms마다 나눠 흘린다 → **2만 줄이 약 13초에** 찬다(AC-LOG51 링버퍼 멈춤 확인용). 상한 아래라 생략 줄은 없다. **40줄마다 가림 대상 1줄**(`password=`·`Bearer`·접속 문자열, 줄마다 값이 다르다)이 섞여 대량 흐름에서도 가림을 확인한다. 멈춤 판단은 화면 몫이다 (2026-09-25) |

- `DATA_SOURCE=live`인데 클러스터 연결도 스택도 없으면 `LOG_SOURCE_NOT_CONFIGURED`이고 **mock 로그가 대신 나오지 않는다**(AC-LOG24).
- mock에서도 **가림은 그대로 동작한다**(픽스처에 원문을 넣어 두고 서버가 가려서 내보낸다). 응답을 그대로 검색해 원문이 없는지 확인하는 것이 AC-LOG04·05의 검증이다.
- **시간 단축 시나리오(`stream-notice`·`idle-pause`·`max-duration`)는 기준값만 줄인다.** 서버 경로(`checkLimits`·`push`·`flush`)는 실제와 같고, `log.hello.limits`·`capabilities.limits`는 **설정값 그대로**(300초·30분)다. 문구의 기간만 실제로 적용된 값(20초·30초)으로 나온다 — 서버 문구는 일어난 사실을 말한다.
- 세 시나리오 모두 **direct 출처**다(로그 스택 없음). 다시 보려면 `다시 시작`(새 스트림)을 누르면 같은 시간표가 처음부터 다시 돈다.

---

## 10. 설정·환경 변수

```
LOGS_ENABLED=true
LOG_DENY_NAMESPACES=
LOG_DEFAULT_LINES=500
LOG_MAX_LINES=5000
LOG_MAX_BYTES=5242880
LOG_MAX_LINE_BYTES=8192
LOG_MAX_STREAMS=3
LOG_STREAM_MAX_LPS=2000
LOG_STREAM_IDLE_PAUSE_SEC=300
LOG_STREAM_MAX_MIN=30
LOG_REDACT_EXTRA_PATTERNS=

LOG_BACKEND=
LOG_BACKEND_URL=
LOG_BACKEND_TENANT=
LOG_BACKEND_TOKEN=
LOG_BACKEND_BASIC_AUTH=
LOG_BACKEND_TIMEOUT_SEC=20
LOG_BACKEND_MAX_RANGE_HOURS=168
LOG_BACKEND_RETENTION_HOURS=
LOG_BACKEND_LABEL_NAMESPACE=namespace
LOG_BACKEND_LABEL_POD=pod
LOG_BACKEND_LABEL_CONTAINER=container
LOG_BACKEND_LABEL_NODE=node_name
LOG_BACKEND_LABEL_STREAM=stream
```

- **`LOG_REDACTION=off` 같은 항목을 만들지 않는다**(P2). `LOG_REDACT_EXTRA_PATTERNS`는 **추가만** 한다.
- `deploy/app.example.yaml`(클러스터 안 배포)은 **`LOGS_ENABLED=false`가 기본**이고 이유를 주석으로 적는다(PM 결정 Q4).
- `LOG_BACKEND_LABEL_*`를 바꾸면 그 이름으로 조회한다(AC-LOG46, 회사 Loki 라벨 이름 U2 대응). **라벨 이름은 응답에 노출하지 않는다**(출처 중립).
- RBAC: `deploy/rbac.yaml`에 **`pods/log`의 `get` 하나만** 추가한다. 그 외 리소스·동사는 늘리지 않는다(AC-LOG01·34). 파일 첫 줄 주석의 "pods/log 없음"을 고치고 왜 열었는지와 완화 수단(이 문서 3절)을 적는다. → **2026-09-25 L1 구현에서 처리 완료.** `list`/`watch`도 주지 않았다(`pods/log`에는 의미가 없고 동사를 늘릴 이유가 되지 않는다). 지우면 **로그 기능만 403**이 되고 다른 화면은 영향을 받지 않는다.

---

## 11. 저장·격리

### 11.1 로그를 어디에도 저장하지 않는다 (P5, AC-LOG11)

- **대시보드 DB에 쓰지 않는다.** `schema.prisma`에 로그 테이블·열을 만들지 않는다. **DBA는 이 기능에서 할 일이 없는 것이 정상이다.**
- **디스크·파일 캐시에 쓰지 않는다.** 서버 메모리에서 스트리밍으로 지나가고 끝나면 남지 않는다.
- **API 프로세스 자신의 로그에 찍지 않는다.** 디버그 레벨에서도 로그 본문·검색어·셀렉터 문자열을 출력하지 않는다. 요청 로그에 `POST /api/logs/query`의 본문을 남기지 않는다.
- **내려받기·내보내기 엔드포인트를 만들지 않는다**(PM 결정 Q6, AC-LOG12).
- 조회 메타(언제 어떤 파드를 열었는지)도 이번 범위에서는 남기지 않는다(열린 질문 Q9, 기본값 유지).

### 11.2 어드바이저·알림 격리 (P6)

- **어드바이저 스냅샷(`AdvisorSnapshotV1`)에 로그 본문·로그 줄·로그 요약 필드를 추가하지 않는다.** 허용 목록 방식이라 기본적으로 막히지만 명시적으로 적어 다음 사람이 "몇 줄쯤은"을 하지 않게 한다(`architecture-advisor.md` 3.4 제외 목록에 반영됨).
- 브리지 프롬프트·도구 목록에 로그 조회 수단을 넣지 않는다. 허용 도구는 `StructuredOutput` 하나 그대로다.
- **알림 본문·이력·SSE에도 로그가 들어가지 않는다**(가림 처리한 줄도, 요약·통계도). 알림에서 로그로는 **링크만** 건다(`alerts.md` 0.3·2.2.1).
- **로그 내용으로 상태를 판단하지 않는다.** "ERROR N줄이면 장애" 같은 규칙을 만들지 않고, 사이드바 `로그` 메뉴에 **상태 점이 없다**(`nav`에 키를 추가하지 않는다). 로그 기반 알림 규칙도 범위 밖이다(PM 결정 Q7).
- 검증(AC-LOG21·AC-ALERT13): 어드바이저 스냅샷과 알림 응답 JSON 전체에 mock 로그 픽스처의 특징 문자열이 **0건**.

### 11.3 컨트롤 플레인 로그 (L2)

- kOps 컨트롤 플레인 구성요소는 `kube-system`의 미러 파드이므로 **같은 `pods/log` 경로로** 읽는다. **RBAC는 더 늘리지 않는다**(AC-LOG34).
- 진입: `GET /api/cluster/control-plane`의 `ControlPlaneComponent`에 **`logHref: string | null`**을 더한다(디자인 `ComponentMatrix.cells[].logHref`). 각 칸이 미러 파드 1개에 대응한다. `podKey`가 없거나(`missing`) 로그 기능이 꺼져 있으면 `null`.
  - **`follow=1`이 붙는다**(PM 결정 D3, 11.4). `not_reporting` 칸도 파드를 알면 링크를 준다(조회가 성공할 수 있다, AC-LOG32).
  - **SSE(`cluster.snapshot`·`cluster.controlplane.updated`)에도 같은 값이 온다.** 2026-09-25 이전 구현은 REST에서만 채워 SSE가 항상 `null`이었다 — 링크를 평가 단계로 옮겨 고쳤다(11.4).
- 미러 파드 판별은 **2중 조건**이다(`cluster-status.md` 1.6): `kube-system` + (노드를 알면) 마스터 노드 + 이름이 필수 5종 접두어. 다른 네임스페이스의 `kube-apiserver-…`에는 아래 안내가 붙지 않는다(2026-09-25 수정).
- 상시 안내(`GET /api/logs/targets/*`의 `notices`):
  - `LOG_APISERVER_SELF_DEPENDENCY` — `kube-apiserver 로그는 kube-apiserver를 통해 읽습니다. apiserver가 멈추면 그 로그도 볼 수 없습니다.` (+ 스택이 있으면 **같은 `text` 뒤에 한 문장** `외부 로그 스택이 있으면 그쪽에는 남아 있을 수 있습니다.` — 디자인 11.2). `details.hint`: `etcd가 멈추면 apiserver도 멈추므로 etcd-manager 로그도 같은 한계가 있습니다.`(첫 줄 도움말 툴팁. 화면이 문구를 만들지 않는다)
  - 민감도 경고(`LOG_CONTROL_PLANE_SENSITIVE`) — `컨트롤 플레인 로그에는 클러스터 사용자 이름·요청 경로·인증 실패 내역이 나올 수 있습니다.`
- 마스터가 NotReady면 `LOG_NODE_NOT_REPORTING`을 먼저 보여 주되 **조회를 막지 않는다**(AC-LOG32).
- 이것은 **로그**이지 etcd 심층 지표가 아니다. `kops-support` D3와 충돌하지 않는다.

### 11.4 진입점 링크 — 화면이 링크를 줄 수 있는지 아는 방법 (L2, 2026-09-25)

**원칙**: 링크를 줄 수 있는지(`LOGS_ENABLED`·`LOG_DENY_NAMESPACES`, mock `logs=disabled` 포함)와 링크 모양(`follow`·`at`)은 **서버 규칙 한 곳**(`apps/api/src/logs/log-href.ts`)이 정하고, 결과를 **기존 응답의 추가 전용 nullable 필드 `logHref`**로 준다. 화면은 `logHref`가 있으면 그대로 링크로 쓰고 `null`이면 그리지 않는다. **화면이 `enabled`·`denyNamespaces`로 링크를 다시 판단하지 않는다** — 규칙이 두 곳이면 `LOG_DENY_NAMESPACES`가 한쪽만 먹는다.

| # (명세 3.8.1) | 진입점 | 필드 | 링크 모양 | 따라가기 |
|---|---|---|---|---|
| 1 | 파드 상세 `로그` 섹션 · `로그 화면에서 열기` | `GET /api/cluster/pods/:ns/:name`의 `pod.logHref` (`PodItem`) | `/logs?namespace=…&pod=…&follow=1` | 켬 |
| 2 | 파드 목록 행 | `PodItem.logHref` (`GET /api/cluster/pods`, `cluster.snapshot.pods`, `cluster.pod.upsert`) | 같음 | 켬 |
| 3 | 컨트롤 플레인 매트릭스 칸 | `ControlPlaneComponent.logHref` (REST · `cluster.snapshot` · `cluster.controlplane.updated`) | 같음 | 켬 |
| 4 | Warning 이벤트 행 (대상이 파드일 때만) | `EventItem.logHref` (`GET /api/cluster/events`, `cluster.snapshot.events`, `cluster.event.upsert`) | `/logs?namespace=…&pod=…&at=<lastSeenAt>` | **끔 + `at`** |
| 5 | 워크로드 상세 | `WorkloadItem.logHref` (목록·상세·`cluster.workload.upsert`) + 상세의 소속 파드 행은 각 `PodItem.logHref` | `/logs?namespace=…&workload=<Kind>/<ns>/<name>&follow=1` | 켬 |
| 7 | DB 상세의 DB 파드 | `GET /api/cluster/db`(`db.snapshot`·`db.updated`)의 `kubernetes.pods[].logHref` (`PodItem`) | 파드와 같음 | 켬 |
| 8 | 알림 항목 | `AlertItem.logHref` (+ `logTarget`) | `/logs?namespace=…&pod=…&at=<occurredAt>` | **끔 + `at`** |
| 6 | 사이드바 `/logs` | (서버 링크 없음) | `/logs` | 끔 (대상이 아직 없다) |

- **규칙 하나(PM 결정 D3·Q12)**: "지금 상태"를 보는 화면에서 들어오면 `follow=1`, "지난 시점"을 가리키는 곳에서 들어오면 `follow` 없이 `at`. **`follow`와 `at`은 함께 붙지 않는다**(`log-href.spec.ts`가 전수로 고정). 새 진입점은 `log-href.ts`의 자리별 표에 한 줄을 더하면 된다.
- `at`을 로그 화면이 쓰는 방법은 **2.2.1**.
- 서버 링크가 없는 자리가 새로 생기면 화면의 링크 함수가 같은 규칙을 따른다(디자인 6.2). **지금은 그런 자리가 없다** — 파드 상세 `로그 화면에서 열기`도 `pod.logHref`를 쓰면 된다.

**`logHref`가 `null`인 경우**

| 필드 | `null`인 경우 |
|---|---|
| 모든 필드 | `LOGS_ENABLED=false` / mock `logs=disabled` / 네임스페이스가 `LOG_DENY_NAMESPACES`에 있음 |
| `EventItem` | 대상(`involvedObject`)이 파드가 아니다 |
| `ControlPlaneComponent` | 파드가 없다(`missing`). `not_reporting`이어도 파드를 알면 준다(AC-LOG32) |
| `AlertItem` | 영향 객체에 파드가 없다(`logTarget.unavailableReason`이 이유를 말한다) |

- **사라진 파드에도 링크를 준다**(이벤트·알림). 로그 화면이 S3(`exists: false`)로 정직하게 말한다.
- **링크는 평가 단계에서 채운다.** REST와 SSE가 같은 항목 객체를 보내므로 값이 갈라지지 않는다(2026-09-25 결함 수정 — `cluster-loghref.http.spec.ts`가 REST와 `cluster.snapshot`·`cluster.controlplane.updated`를 비교한다). mock `logs=disabled`로 바뀌면 서버가 `cluster.snapshot`을 다시 보낸다.
- `logHref`는 네임스페이스·파드 이름만 담는다. 어드바이저 스냅샷에는 들어가지 않는다(스냅샷은 허용 목록 방식이고 이 필드를 싣지 않는다).

**`/logs` 쿼리 파라미터** (서버 링크는 이 이름만 쓴다)

| 파라미터 | 뜻 |
|---|---|
| `namespace` | 필수 |
| `pod` | 파드 |
| `workload` | `<Kind>/<namespace>/<name>` — `PodItem.owner.workloadKey`, `GET /api/cluster/pods?workload=`와 **같은 형식** |
| `follow=1` | 따라가기를 켠 채로 연다 |
| `at` | 그 시각 (2.2.1) |
| `container`·`source`·`range`·`lines`·`prev` | 화면 상태용. **서버 링크에는 붙지 않는다** |

**`workload=`로 열렸을 때(진입점 5)**

- 소속 파드 목록은 `GET /api/cluster/pods?namespace=<ns>&workload=<workload>`(또는 `cluster` 토픽 `pods[]`의 `owner.workloadKey`)다. 서버 기본 정렬(상태 나쁜 순 → 최근 1시간 재시작 많은 순)이다.
- `direct`(`multiPod: false`): 파드 선택기를 그 목록으로 좁히고 **목록의 첫 파드**를 고른다(서버 정렬의 첫 번째 = 가장 나쁜 파드. 화면이 다시 고르지 않는다).
- `stack`(`multiPod: true`): `selector.workload: { kind, name }`를 보내면 **서버가** 소속 파드(지금 있는 것 + 최근 1시간 안에 사라진 것, 최대 20)를 풀어 합쳐 준다(1.4, `selector.resolvedPods`). 사용자가 일부만 고르면 `pods[]`를 보낸다.

**`/logs` 선택기(AC-LOG29)에 필요한 것은 기존 API로 전부 얻는다 — 새 엔드포인트 없음**

| 단계 | 출처 |
|---|---|
| 네임스페이스 | `GET /api/cluster/pods`의 `facets.namespaces` + `capabilities.denyNamespaces`(`차단됨` 표시) |
| 워크로드 | `GET /api/cluster/workloads?namespace=<ns>` (`items[].key`·`logHref`) |
| 파드 | `GET /api/cluster/pods?namespace=<ns>&workload=<key>` (`items[].logHref`). 워크로드를 고르지 않으면 `?namespace=<ns>` |
| 컨테이너 | `GET /api/logs/targets/:ns/:pod` |

- 같은 값이 `cluster` 토픽(`cluster.snapshot`의 `workloads`·`pods`)에도 있다. 이미 구독 중이면 REST를 다시 부르지 않아도 된다.

---

## 12. 화면이 하지 않는 것 (프론트 인수인계)

- 출처 이름으로 능력을 **추론하지 않는다.** `capabilities`·`chips`·`limitations`를 그대로 쓴다.
- 본문을 **파싱하지 않는다.** `segments[]`를 그대로 그리고 `dangerouslySetInnerHTML`을 쓰지 않는다.
- 파드가 살아 있는지 **판단하지 않는다.** `pod.exists`·`deletedAt`을 그대로 쓴다.
- 출처를 **자동 전환하지 않는다**(AC-LOG42). 전환은 사용자 클릭으로만.
- 안내 코드를 문구로 **번역하지 않는다.** `notice.text`를 그대로 쓴다.
- 로그를 `localStorage`·`sessionStorage`·IndexedDB에 넣지 않는다. 찾기 입력값을 URL에 남기지 않는다.
- 로그 전용 연결은 공용 SSE와 별개로 관리하고 **화면을 떠나면 반드시 `close`를 부른다.**
- `log.closing`을 받으면 `EventSource.close()`를 부르고 재연결하지 않는다.
- 링버퍼 2만 줄은 화면 책임이다(서버는 상한만 알린다).
- **로그 링크 규칙을 갖지 않는다.** `logHref`가 `null`이면 링크·로그 섹션을 그리지 않고, 있으면 파라미터를 덧붙이지 않고 그대로 쓴다(11.4). 컨트롤 플레인 매트릭스의 `podKey` 폴백은 지운다.
- **`at`으로 시각을 비교하지 않는다.** `anchorAt`으로 넘기고 서버의 `anchor.lineId`·`LOG_ANCHOR_*` 안내를 쓴다(2.2.1).

---

## 13. 명세·디자인·공통 규약과의 차이 (이 문서의 선택)

| 항목 | 원래 | 이 계약의 선택 | 이유 |
|---|---|---|---|
| 조회 메서드 | 명세는 정하지 않음 | **`POST /api/logs/query`** | 검색어·셀렉터를 URL·프록시 로그·브라우저 이력에 남기지 않기 위해. 상태를 바꾸지 않는 조회이고 `Origin` 검사를 적용한다 |
| 스트림 여는 방식 | 명세는 "전송 방식은 backend가 정한다" | **준비(POST) → SSE(GET) → touch/close** 3단계 | ① 상한·권한 오류를 읽을 수 있는 JSON으로 돌려준다(EventSource는 오류 본문을 못 읽는다) ② 상한을 연결 전에 정확히 센다 ③ 검색어가 URL에 안 남는다 |
| 유휴 판정 | 명세 "5분간 조작이 없으면" | `POST …/touch`(60초) 신호 기준 | 서버는 브라우저 탭의 상태를 알 수 없다. 신호가 없으면 서버가 위쪽 연결을 끊는다 |
| `previous` + 따라가기 | 명세에 없음 | **금지(400)** | 끝난 세대의 로그라 따라갈 것이 없다. 쿠버네티스도 의미 있게 지원하지 않는다 |
| 사라진 파드 | 명세는 `LOG_POD_NOT_FOUND` | `GET /api/logs/targets/*`는 **200 + `exists: false`**, `query`·`streams`는 404 | "파드가 없다"는 화면이 그려야 할 **사실**이다. 대상 조회가 404면 화면이 오류 스택을 그리게 된다(AC-LOG26 위반) |
| 가림 표식 위치 | 명세 3.3.3 "줄 오른쪽" | **왼쪽 sticky gutter** | PM 결정(2026-09-25). 줄 바꿈을 끄면 오른쪽이 가로 스크롤 뒤로 사라져 `status.md` 3.1을 어긴다. planner가 명세 문구를 맞춘다 |
| 가림 규칙 | 명세 3.3.2 **10종**(개수 고정) | **`sql_statement` 1종 추가 + 개수를 고정하지 않는다** | DBA 실측: 대상 Postgres의 `log_min_error_statement=error` 기본값 때문에 실패한 SQL 원문·제약 위반 값이 파드 로그에 남는다(3.2.1). 목록이 정본이고 앞으로 늘어나므로 "N종"을 박지 않는다. **명세 갱신 요청** |
| SQL 가림 구현 | (초기 권고) `maskSqlLiterals()`를 줄에 그대로 적용 | **폐기.** `createPgLogValueMasker()`(상태 있음) / `maskPgLogValues()`(무상태)를 쓴다 | 줄 전체에 리터럴 스캐너를 돌리면 타임스탬프·PID가 `?`가 되고(AC-LOG49 위반), 정작 `Key (email)=(a@b.com)`은 안 잡힌다. DBA 실측 12종(3.2.1) |
| 확신 등급 값 | 명세 `높음`/`의심` | `'high' \| 'suspect'` + 한국어 `label` | 디자인 `components.md` 20.5 타입과 맞춘다. 화면 문구는 `높음`/`의심` |
| `ControlPlaneComponent` | `cluster-status.md` 1.6 | **`logHref` 1개 추가** | 디자인 `ComponentMatrix.cells[].logHref`. 다른 필드·동작은 그대로 |
| 공용 스트림 | `common.md` 5.1 | **토픽을 추가하지 않는다** | 로그는 전용 연결이다. `?topics=logs`는 400 |
| 링크의 `at` | 명세·디자인에 정의 없음(`alerts.md` 예시 URL에만 있었다, Q11) | **2.2.1**: `anchorAt`으로 넘기면 서버가 기간을 고르고 그 줄을 찾고 못 찾은 이유를 말한다 | 화면이 시각을 비교하면 잘린·회전된 로그에서 엉뚱한 줄을 "그 시각"으로 보인다. 판단을 서버 한 곳에 둔다 |
| Warning 이벤트 링크의 `at` | 명세 "그 파드. 없으면 S3" | **`lastSeenAt`**, `follow` 없음 | 이벤트는 "지난 시점"(Q12). 반복 이벤트의 가장 최근 발생이 현재 로그 파일에 남아 있을 가능성이 가장 높다 |
| 워크로드 진입 링크 | 명세 "소속 파드 선택기가 붙은 로그 화면" | **`workload=<Kind>/<ns>/<name>`** + `follow=1`. 첫 파드는 서버 목록 정렬의 첫 번째 | 링크에 특정 파드를 박으면 파드가 바뀔 때마다 `WorkloadItem`이 흔들린다 |
| 링크 가능 여부 전달 | 명세 "진입점 표" | 새 엔드포인트 없이 **기존 응답의 `logHref`**(추가 전용 nullable) | 화면이 규칙을 따로 들지 않게. `ControlPlaneComponent.logHref`와 같은 방식 |
| 스트림 문구 | 서버 문구 `N초 동안 조작이 없어…` / `N분까지 유지됩니다` | **디자인 7.4 문구**(`이 화면이 5분 동안 보이지 않아…` / `연결을 30분마다 끊습니다(서버 보호).`) | 서버는 조작이 아니라 `touch`(화면이 보일 때만)로 판단한다 |

---

## 14. 변경 이력

- 2026-09-25 (logs 5b 후속 — 통합 1차 결함 + L2 서버 몫, backend): **추가만, 기존 필드 삭제·변경 없음.**
  - **결함 수정**: `cluster` 토픽 SSE의 `ControlPlaneComponent.logHref`가 항상 `null`이던 것 — 링크를 평가 단계에서 채워 REST·SSE가 같은 값(11.3·11.4). 회귀 테스트로 두 값을 비교한다.
  - **11.4 진입점 링크**: `PodItem`·`WorkloadItem`·`EventItem`에 `logHref` 추가(추가 전용 nullable). 자리별 규칙 표(`follow=1` / `at`), `/logs` 쿼리 파라미터, 워크로드 진입, 선택기 출처(새 엔드포인트 없음).
  - **2.2.1 그 시각으로 열기**: 요청 `anchorAt`, 응답 `anchor`, 출처별 정의, 안내 코드 `LOG_ANCHOR_BEFORE_RESULT`·`LOG_ANCHOR_AFTER_RESULT`. 스트림에 `anchorAt`은 400.
  - 1.4: `pods` 최대 20(400), stack `workload`를 서버가 소속 파드로 푼다(`selector.resolvedPods`, `LOG_PODS_CLAMPED`·`LOG_WORKLOAD_NO_PODS`) — 전에는 네임스페이스 전체를 조회했다.
  - 2.3.1·6·7: 상한 초과 문구(PM 결정), 유휴·30분 문구(디자인 7.4).
  - 9절: mock `stream-notice`·`idle-pause`·`max-duration`·`flood` 추가, `disabled`가 링크도 지운다.
  - 11.3: 매트릭스 링크 `follow=1`, 스택이 있으면 자기참조 안내에 한 문장, `details.hint`, 미러 파드 2중 조건.
  - (추가, PM 검증) **live 결함 수정**: `LOG_PREVIOUS_NOT_AVAILABLE`·`LOG_CONTAINER_NOT_STARTED`·**`LOG_KUBELET_UNREACHABLE`**(PM 결정 — `level: warn`, `details.nodeName`, 문구 `노드에 연결할 수 없어 로그를 읽지 못했습니다.`)가 live `POST /api/logs/query`에서 **503 오류**로 나가던 것을 계약 6절대로 **200 + notice**로(mock과 같은 모양, AC-LOG15). `@kubernetes/client-node` 2.0은 400 응답 본문을 넘기지 않아 `is waiting to start` 메시지를 볼 수 없다 → previous가 아닌 400은 informer 캐시상 "한 번도 돌지 않은 대기 컨테이너"일 때 `LOG_CONTAINER_NOT_STARTED`. 그 밖의 400은 `LOG_UPSTREAM_ERROR` + `details.status: 400`. (따라가기 스트림 쪽 정리는 하지 않았다 — previous 스트림은 원래 400이다)
  - (추가, PM 결정 "mock = live, 계약이 정본") **6절 코드가 전부 표대로 나간다**: `LOG_BACKEND_UNAVAILABLE`·`LOG_BACKEND_AUTH_FAILED`·`LOG_BACKEND_QUERY_REJECTED`(전에는 502)·`LOG_SOURCE_NOT_CONFIGURED`도 조회 **200 + notice**(자동 전환 없음, `details.fallbackSource`/`details.reason`). `LOG_KUBELET_UNREACHABLE` 판단 문구 2개 추가. `LOG_CONTAINER_NOT_STARTED`는 **스트림이 기다렸다가 붙고**(연결 유지) 정지 조회는 따라가기를 권하는 문구. **`LOG_UPSTREAM_ERROR` 행 추가**(503 + `details.status`). `LOG_EMPTY`는 조회가 실제로 성공했을 때만. `capabilities` 안내 코드가 실제 실패 종류를 따른다(인증 실패면 `LOG_BACKEND_AUTH_FAILED`). mock 시나리오 4개(`container-starting`·`stack-auth-failed`·`stack-rejected`·`kubelet-unreachable`). **502 근거는 계약 본문에 없었다**(L3 보고서에만) — 표 하나가 정본이다.
  - (추가, 결정 8) `log.hello.selector`에 **`resolvedPods`**(조회 응답과 같은 이름·같은 값). 기존 `selector.pods`는 그대로(2.3.1·7절).
  - 대상 화면(`GET /api/logs/targets/*`)의 `links.workload`를 **해석한 워크로드 키**로(전에는 원시 소유자라 `ReplicaSet/…`이 나왔다), 사라진 파드도 마지막 소유자로 채운다.

- 2026-09-25 (logs 계약, backend 3단계): 최초 작성. 새 엔드포인트 6개(`GET /api/logs/capabilities`, `GET /api/logs/targets/:ns/:pod`, `POST /api/logs/query`, `POST /api/logs/streams`, `GET /api/logs/stream/:id`, `POST /api/logs/streams/:id/{touch,close}`), 새 `SourceId` `logBackend` 1개, **전용 SSE 연결**(공용 `/api/stream`과 분리). `ControlPlaneComponent`에 `logHref` 1개 추가 외 기존 응답·토픽·이벤트 변경 없음. 디자인 요청 반영: `segments[]`·한국어 규칙 이름·`capabilities`/`chips`/`limitations`·`notice.text`·`deletedAt`·`links`·`streams.open/max`. DBA 실측 반영: 가림 규칙 `sql_statement` 추가(값 자리만 `?`, `createPgLogValueMasker()` 사용, 규칙 개수는 고정하지 않는다).
