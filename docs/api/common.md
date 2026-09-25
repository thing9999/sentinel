# API 공통 규약

- 작성: backend, 2026-09-19 (3단계 계약. 구현 전)
- 적용: `docs/api/cluster-status.md`, `docs/api/aws-cost.md`, `docs/api/architecture-advisor.md`, `docs/api/aws-snapshot-manager.md`, `docs/api/k8s-snapshot.md`, `docs/api/snapshot-3d.md`, `docs/api/alerts.md`, `docs/api/logs.md`
- 근거: `CLAUDE.md` 확정된 결정, `docs/specs/*.md`, `docs/design/status.md`·`shell.md`, `docs/db/health.md`·`schema.md`, `docs/reports/bootstrap/{backend,frontend}.md`
- 이 문서의 규칙은 기능 문서가 명시적으로 덮어쓰지 않는 한 모든 엔드포인트에 적용된다.

## 0. 요약 (프론트가 먼저 알아야 할 것)

| 항목 | 결정 |
|---|---|
| 기본 URL | `http://localhost:3001/api` (전역 prefix `/api`) |
| CORS | 허용 origin `http://localhost:3000` (env `CORS_ORIGIN`, 쉼표로 여러 개) |
| 시각 | ISO 8601 **UTC**, 밀리초, `Z` 접미사 (`2026-09-19T05:02:10.123Z`). 날짜만은 `YYYY-MM-DD`(UTC 날짜) |
| 단위 | CPU **millicore 정수**, 메모리·디스크 **bytes 정수**, 금액 **USD 숫자**, 비율 **0~100 숫자**(소수 1자리, 100 초과 가능) |
| 상태 값 | `ok` \| `warning` \| `critical` \| `unknown` (서버 계산, 화면은 계산하지 않음) |
| 데이터 오래됨 | 상태 값이 아니라 **플래그**(`stale: true`) + 갱신 주기(`intervalSec`)로 표현 |
| 쓰기 | 클러스터·AWS·모니터링 대상 DB에는 없음. 대시보드 자체 DB 설정(`PATCH`)과 **로컬 스냅샷 파일**(`aws-snapshot-manager.md`, `k8s-snapshot.md`: `PUT`·`POST`·`DELETE`)만 |
| **밖으로 나가는 통지** (2026-09-25) | 사용자가 지정한 **디스코드 웹훅**으로 나가는 단방향 알림 (`alerts.md`). **관측 대상(클러스터·AWS·모니터링 DB)을 바꾸지 않는다.** 기본 꺼짐(주소 미설정), mock에서 아웃바운드 0건, 테스트 발송은 `confirm: true` + 60초 쿨다운 |
| 실시간 | **단일 SSE 스트림** `GET /api/stream?topics=...`, 연결 직후 토픽별 `*.snapshot`, 이후 변경분, `stream.heartbeat` **15초**. **예외**: 컨테이너 로그는 공용 스트림에 싣지 않고 **전용 연결**을 쓴다(`logs.md` 2.3·7절, 상한도 별도) |
| 재연결 | `Last-Event-ID` **미지원**. 재연결하면 항상 전체 스냅샷을 다시 받는다. `retry: 3000` |
| 에러 | `{ statusCode, code, message, details?, path, timestamp }` |
| mock 시나리오 전환 | **포함**: `GET /api/mock/scenarios`, `PUT /api/mock/scenarios/:group`, `POST /api/mock/reset` (mock 모드에서만) |

---

## 1. 기본 규칙

### 1.1 경로와 버전
- 모든 경로는 전역 prefix `/api` 아래에 둔다(`app.setGlobalPrefix('api')`). 예: `GET /api/cluster/pods`.
- URL 버전(`/v1`)은 두지 않는다. 호환이 깨지는 변경은 이 문서들을 먼저 고치고 프론트와 같은 단계에서 반영한다.
- 경로 세그먼트는 kebab-case, JSON 필드는 camelCase, enum 값은 소문자 snake_case(예: `on_demand`, `login_required`). 쿠버네티스 고유 값(phase `Running`, reason `CrashLoopBackOff`, kind `Deployment`)은 원문 그대로.

### 1.2 CORS
- `Access-Control-Allow-Origin`: `CORS_ORIGIN`(기본 `http://localhost:3000`). Docker 없이 실행할 때도 같은 기본값.
- 허용 메서드: `GET, POST, PUT, PATCH, DELETE, OPTIONS`. `DELETE`는 `aws-snapshot-manager`·`k8s-snapshot`의 휴지통 이동·영구 삭제만 쓴다(로컬 스냅샷 파일. 클러스터·AWS 삭제 아님).
  - 변경(2026-09-19): 처음에는 `DELETE`가 없었다. `aws-snapshot-manager` 삭제(명세 3.8)를 위해 추가.
- 허용 요청 헤더: `Content-Type`. 노출 헤더: `Retry-After`.
- 자격 증명(쿠키) 없음: `credentials: false`, EventSource는 `withCredentials: false`.
- 인증 없음(명세 `cluster-status` 가정 A5: 로컬 운영자 본인용). 클러스터 배포·팀 공유 시 별도 명세.
- 인증 없는 **파일 쓰기** API(`aws-snapshot-manager`, `k8s-snapshot`. k8s는 `POST …/refresh`·`POST …/drift`도 포함)에는 추가 보호가 있다: `Origin`이 `CORS_ORIGIN` 밖이면 403 `ORIGIN_NOT_ALLOWED`, 본문이 있는 쓰기는 `Content-Type: application/json` 필수(415). docker compose는 api 포트를 `127.0.0.1`에만 연다. 자세한 내용은 `aws-snapshot-manager.md` 1.3.
- **같은 보호를 로그 조회에도 적용한다** (2026-09-25, `logs.md` 2.2): `POST /api/logs/query`·`POST /api/logs/streams`는 쓰기가 아니지만 다른 사이트가 로컬 대시보드 API를 호출해 로그를 긁어가는 것을 막아야 하므로 `Origin` 검사와 `Content-Type: application/json`을 요구한다.

### 1.3 요청 형식
- 본문은 `application/json`. 전역 `ValidationPipe({ whitelist: true, transform: true })` → **DTO에 없는 필드는 조용히 제거**된다(오류 아님). 필드 값이 규칙에 맞지 않으면 400.
- 쿼리의 boolean은 `true`/`false` 문자열만 허용. 여러 값은 쉼표 구분(`status=critical,warning`).
- 정렬: `sort=<field>:<asc|desc>` 한 개. 생략하면 각 목록의 **기본 정렬**(디자인 `status.md` 5.2와 같음).
- 목록 페이지네이션: `limit`(1~5000), `offset`(0~). **생략하면 전체**를 준다(디자인 결정: 표는 가상 스크롤, 페이지네이션 없음). 응답에 항상 `total`(필터 전), `filteredTotal`(필터 후), `offset`, `limit`(`null`이면 전체)을 넣는다.
  - 충돌: 디자인 `status.md` 5.4는 "페이지네이션은 쓰지 않는다", PM 요청은 "목록 페이지네이션". → 선택: **선택적 `limit/offset`만 제공, 기본은 전체.** 이유: 실시간 목록은 SSE 스냅샷을 메모리에 들고 화면에서 가상 스크롤하는 편이 정확하고(페이지 사이에 행이 움직임), 수백 행 규모라 전체 전송이 부담이 없다. `limit`은 외부 스크립트·디버그용.

### 1.4 응답 형식
- 성공 응답은 **봉투 없이** 리소스 JSON을 그대로 준다(`{ "items": [...], ... }` 또는 객체).
- 모든 조회 응답의 최상위에 `dataSource`(`mock` | `live`)와 `generatedAt`(응답 생성 시각)을 넣는다.
- 필드가 "값 없음"이면 `null`(생략하지 않음). 배열은 비어 있으면 `[]`.
- 쿠버네티스 원본 객체를 그대로 내보내지 않는다. **환경 변수, command/args, 어노테이션, 레이블 전체, Secret/ConfigMap 내용, managedFields는 어떤 응답에도 없다.** (필요한 레이블 값은 해석된 필드로만: `nodeGroup`, `zone`, `capacityType` 등)
  - 예외(2026-09-19, `k8s-snapshot.md` 16절): ① 로컬 스냅샷 파일 보기 응답(`GET /api/k8s-snapshots/:id/file`, ASM 템플릿 보기와 같음)은 파일 원문을 준다. ② 드리프트 응답(`GET/POST /api/k8s-snapshots/:id/drift`)은 클러스터 객체의 **레이블·어노테이션 값과 spec 잎 값의 차이**를 준다(객체 통째가 아니라 잎 단위). 환경 변수 값·command/args·비밀값 스캐너에 걸리는 값은 여기서도 가린다(`값 다름 (앞 2글자****(N자))`). Secret은 읽지 않는다.
  - 예외 ③ (2026-09-25, `logs.md`): **컨테이너 로그 본문**은 파드의 서브리소스(`pods/log`)이고 "원본 객체"는 아니지만 성격이 비슷하므로 여기에 명시한다. 로그 전용 엔드포인트(`/api/logs/*`)만 본문을 내보내고, **서버에서 가림 처리를 거친 조각 배열(`segments[]`)로만** 나간다(`logs.md` 1.2·3절). 가림을 끄는 설정은 없고 원문을 돌려주는 API도 없다. **다른 어떤 응답에도 로그 줄이 들어가지 않는다** — 알림(`alerts.md` 0.3), 어드바이저 스냅샷(`architecture-advisor.md` 3.4), 공용 스트림(`logs.md` 0.3) 전부 금지다.
- 서버가 만든 문자열 중 화면에 그대로 나가는 사유(`reasons[].text`, 오류 메시지)는 비밀값 가림(`redactSecrets`)과 길이 제한을 거친다.
- 검증 실패 응답의 `details.fields[].value`는 필드 이름이 `content`·`label`·`memo`·`path`·**`webhookUrl`**(2026-09-25, `alerts.md` 2.6)·**`text`**(로그 검색어, `logs.md` 2.2)이면 넣지 않는다. 입력값 자체가 비밀일 수 있는 자리다.

### 1.5 시각·기간 표기
- 시각 필드 이름: `...At`(`updatedAt`, `lastSeenAt`). 값은 UTC ISO 문자열.
- 경과·지속 시간: 초는 `...Sec`, 밀리초는 `...Ms` 숫자. (예: `waitSec`, `durationMs`)
- 경과 시간(`3시간 4분`)은 화면이 `서버 시각 기준`으로 계산할 수 있게 **시작 시각**을 준다(`startedAt`, `since`). 서버 시각은 `stream.hello`·`stream.heartbeat`·`GET /api/health`의 `serverTime`으로 보정한다.
- 날짜 경계(일일 호출 수 등)는 **UTC** 기준. 화면 표시는 브라우저 로컬 시간대(디자인 `status.md` 6절).

### 1.6 단위
| 대상 | 단위 | 필드 예 |
|---|---|---|
| CPU | millicore 정수 | `cpuMillicores: 1250` |
| 메모리·디스크 | bytes 정수 (JS 안전 정수 범위) | `memoryBytes: 3435973837` |
| 비율 | 0~100, 소수 1자리. limits 오버커밋 등은 100 초과 가능 | `cpuPct: 62.4` |
| 금액 | USD 숫자. 반올림은 **표시 단계(프론트)**에서. 서버는 소수 6자리(단가 10자리)까지 준다 | `usdPerHour: 1.104532` |
| 응답 시간 | ms | `responseMs: 42` |
| 초당 비율 | 초당 수 | `commitsPerSec: 124.3` |

- 금액 표기 규칙(`≈`, 자릿수, `$N,NNN`)은 **프론트 책임**(디자인 `status.md` 3.2). 서버는 금액을 문자열로 만들지 않는다. 단, `reasons[].text`처럼 서버가 만든 문장 안의 금액은 같은 표기 규칙으로 서버가 쓴다.
- 합계는 **항상 서버가 준 값**을 쓴다. 프론트는 행을 더하지 않는다.

### 1.7 금액 공통 (`aws-cost`, `architecture-advisor`)
- 모든 금액에는 종류 `kind`와 조회 시각 `asOf`가 붙는다.
  - `kind`: `estimated`(현재 리소스 × 공시 단가) \| `actual`(Cost Explorer 확정) \| `forecast`(Cost Explorer 예측)
  - `asOf`: 그 금액의 근거 데이터를 조회·계산한 시각
- 단독 금액은 `Money` 객체로 준다. 표(같은 종류의 금액이 여러 행)는 **섹션 객체에 `kind`·`asOf`를 한 번** 두고 행에는 숫자만 둔다(행은 섹션의 kind·asOf를 상속). 한 섹션 안에 kind를 섞지 않는다(디자인 3.1 "한 표 안에 추정·확정 열을 섞지 않는다"와 같음).

```ts
type MoneyKind = 'estimated' | 'actual' | 'forecast';
interface Money {
  amountUsd: number;
  kind: MoneyKind;
  asOf: string;          // ISO UTC
}
```

- 충돌: 디자인 `aws-cost` 보고서 8절은 `kind`를 `estimate/confirmed/forecast`로 요청, PM 지시는 `estimated|actual|forecast`. → 선택: **`estimated | actual | forecast`**(PM 지시). 화면 배지 문구(`추정`/`확정`/`AWS 예측`)와 토큰 이름(`cost.estimate.*`, `cost.confirmed.*`)은 프론트가 매핑한다: `estimated→estimate`, `actual→confirmed`, `forecast→forecast`.

---

## 2. 상태 표현

### 2.1 상태 값

```ts
type Status = 'ok' | 'warning' | 'critical' | 'unknown';
```

| 값 | 의미 (명세 `cluster-status` 3.0) | 디자인 키 |
|---|---|---|
| `ok` | 정상 | `ok` |
| `warning` | 주의 | `warn` |
| `critical` | 장애 (비용 예산은 "초과", 급증은 "급증" 문구) | `crit` |
| `unknown` | 알 수 없음(출처 없음·조회 실패·권한 없음) | `unknown` |

- 집계 우선순위: `critical > warning > unknown > ok` (DBA `worstLevel`과 같음).
- 충돌: 디자인은 상태 키를 `warn`/`crit`로 쓰고, DBA 타입(`HealthLevel`)과 PM 지시는 `warning`/`critical`. → 선택: **API는 `warning`/`critical`**. 이유: DB 상태 스냅샷(`PgHealthSnapshot.checks[].level`)을 변환 없이 쓸 수 있고 PM 지시와 같다. 디자인 키는 토큰 이름이므로 프론트가 `warning→warn`, `critical→crit`로 매핑한다.
- "데이터 오래됨"은 **상태 값이 아니다**. 2.3의 `stale` 플래그로 표현한다(디자인이 stale을 배지 키로 쓰는 것은 화면 표현일 뿐).

### 2.2 공통 상태 객체 `StatusInfo`

상태 배지가 붙는 모든 곳(클러스터 전체, 영역, 노드·파드·워크로드 행, DB 지표, 비용 예산·급증, 사전 점검 요약, 브리지)에 같은 모양을 쓴다.

```ts
interface Reason {
  code: string;          // UPPER_SNAKE. 화면 분기·필터용 (예: POD_CRASHLOOP)
  text: string;          // 판단 이유 한 줄, 서버가 만든 한국어 (예: "CrashLoopBackOff · 최근 1시간 재시작 6회")
  status: Status;        // 이 이유 하나의 등급
}

interface StatusInfo {
  status: Status;
  reasons: Reason[];     // 나쁜 순서. [0]이 대표 사유. ok이고 이유가 없으면 []
  updatedAt: string | null;       // 판단에 쓴 데이터가 마지막으로 갱신된 시각 (stale 계산 기준)
  statusChangedAt: string | null; // status 값이 마지막으로 바뀐 시각 ("지금 확인할 항목" 정렬). 서버 시작 후 한 번도 안 바뀌었으면 최초 판단 시각
  stale: boolean;                 // 서버가 출처 끊김을 알고 있으면 true (2.3)
}
```

예:
```json
{
  "status": "critical",
  "reasons": [
    { "code": "POD_WAITING_CRASHLOOP", "text": "CrashLoopBackOff · 최근 1시간 재시작 6회", "status": "critical" },
    { "code": "POD_OOM_RECENT", "text": "최근 1시간 OOMKilled 1회", "status": "warning" }
  ],
  "updatedAt": "2026-09-19T05:02:10.123Z",
  "statusChangedAt": "2026-09-19T05:00:02.000Z",
  "stale": false
}
```

- 지속 조건(연속 3회, 60초, 2분/10분 등)은 **서버가 적용한 결과**가 `status`다. 화면은 다시 계산하지 않는다.
- 판단 보류(DB 캐시 적중률의 블록 부족, 사전 점검 관측 부족)는 해당 지표 객체의 `held: true`로 표시하고 `status`는 직전 상태를 유지한다.
- 공통 `Reason.code` 예(기능 문서에 전체 목록):
  | code | 뜻 |
  |---|---|
  | `SOURCE_NOT_CONFIGURED` | 출처 설정 없음 (예: 클러스터 연결 없음) |
  | `SOURCE_UNAVAILABLE` | 출처 조회 실패 (예: metrics-server 없음, 권한 없음) |
  | `SOURCE_STALE` | 출처 끊김, 마지막 값 유지 중 |
  | `SOURCE_SYNCING` | 최초 동기화 전 |

### 2.3 데이터 오래됨(stale)과 출처 상태 `SourceStatus`

서버가 데이터를 가져오는 출처마다 상태를 둔다. 스트림 `stream.hello`·`stream.source` 이벤트와 `GET /api/health`로 내려간다.

```ts
type SourceId =
  | 'kube'          // 쿠버네티스 Watch(informer): 노드·파드·워크로드·이벤트·PVC·서비스 등
  | 'metrics'       // metrics.k8s.io (15초)
  | 'prometheus'    // 선택 (PROMETHEUS_URL)
  | 'monitoredDb'   // 모니터링 대상 Postgres (15초)
  | 'awsResources'  // EC2·EBS·ELB Describe (5분). 클러스터 자체를 조회하는 AWS 호출은 없다(kOps에는 EKS 같은 클러스터 객체가 없다)
  | 'pricing'       // Pricing API 단가 (24시간 캐시)
  | 'spotPrice'     // DescribeSpotPriceHistory (1시간 캐시)
  | 'costExplorer'  // Cost Explorer (6시간 캐시)
  | 'agentBridge'   // 어드바이저 브리지 (30초, 어드바이저 구독 중일 때만)
  | 'logBackend'    // 외부 로그 스택 (LOG_BACKEND_URL, 30초·stale 90초, 로그 화면을 보고 있을 때만. logs.md 8절)
                    //   not_configured는 degraded가 아니다(스택이 없으면 pods/log 직접 조회로 동작한다)
  | 'dashboardDb'   // 대시보드 자체 DB (Prisma)
  | 'snapshotStore'   // 로컬 AWS 스냅샷 폴더 (AWS_SNAPSHOT_DIR, 10초 주기 확인, stale 90초. aws-snapshot-manager.md)
  | 'k8sSnapshotStore'; // 로컬 k8s 스냅샷 폴더 (K8S_SNAPSHOT_DIR, 10초 주기 확인, stale 90초. k8s-snapshot.md). 드리프트 값은 kube 출처를 따른다

type SourceState =
  | 'ok'              // 정상 갱신 중
  | 'syncing'         // 최초 동기화 중 (값 없음)
  | 'stale'           // 끊김/재시작 중. 마지막 값을 유지하며 stale 표시
  | 'unavailable'     // 조회 실패 (권한 없음, metrics-server 없음 등). 값 없음
  | 'not_configured'  // 설정 없음 (kubeconfig 없음 등)
  | 'mock';           // mock 모드 (시나리오 데이터)

interface SourceStatus {
  id: SourceId;
  state: SourceState;
  intervalSec: number | null;      // 갱신 주기. watch 기반(kube)은 heartbeat 주기(15)
  staleAfterSec: number | null;    // = intervalSec × 3. 이 시간 동안 updatedAt이 안 바뀌면 화면이 stale 처리
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  error: { code: string; message: string } | null;  // 가림 처리된 한 줄
}
```

**`SourceStatus.error.code` 공통 값** (출처가 `unavailable`·`stale`일 때. 기능별 코드는 각 기능 문서)

| code | 출처 | 언제 | message 예 |
|---|---|---|---|
| `KUBE_AUTH_FAILED` | `kube` | 쿠버네티스 조회가 **401/403**으로 실패 (ServiceAccount 토큰 만료·삭제, RBAC 축소) | `인증 실패 — 토큰이 만료됐을 수 있습니다` |
| `KUBE_CONNECT_FAILED` | `kube` | API 서버 주소로 접속 불가 (DNS 해석 실패, 연결 거부, TLS 실패) | `API 서버에 접속할 수 없습니다` |
| `METRICS_API_UNAVAILABLE` | `metrics` | `metrics.k8s.io` 없음 (metrics-server 미설치) | `metrics.k8s.io API 없음 (metrics-server 미설치)` |
| `AWS_ACCESS_DENIED` | `awsResources`·`pricing`·`spotPrice`·`costExplorer` | AWS 권한 없음 | `권한 없음: ec2:DescribeInstances` |
| `LOG_BACKEND_UNAVAILABLE` | `logBackend` | 로그 스택 연결 실패 (`logs.md` 8절) | `로그 스택에 연결할 수 없습니다 (연결 거부)` |
| `LOG_BACKEND_AUTH_FAILED` | `logBackend` | 로그 스택 인증 실패 | `로그 스택 인증에 실패했습니다` (자격 증명·토큰·URL 전체는 넣지 않는다) |

- **`KUBE_AUTH_FAILED`의 동작**(모든 기능 공통, `cluster-status.md` 3.6 / kops-support 명세 3.6.3):
  1. `kube` 출처 `state: 'unavailable'` + 위 코드. `stream.source` 이벤트로 즉시 알린다.
  2. **mock 데이터로 대체하지 않는다**(아래 2.4). 클러스터에서 오는 값은 전부 `unknown`이고, 마지막 캐시 값을 "정상"인 것처럼 계속 보여 주지 않는다.
  3. API 프로세스는 죽지 않는다. 다른 출처(비용의 AWS, 대시보드 DB, 스냅샷 폴더)는 그대로 동작한다.
  4. 서버는 재연결(informer 재시작)을 계속 시도한다. 토큰을 스스로 발급·갱신하지 않는다(TokenRequest `create` 권한이 없다).
  - `not_configured`(kubeconfig·in-cluster 설정 자체가 없음)와 **구분**한다. 인증 실패는 설정은 있는데 거부된 상태이므로 `unavailable`이다.

**stale 규칙 (서버·화면 공통)**
1. 서버가 출처 끊김을 알면(informer watch 오류 후 재시작 중, 주기 조회 연속 실패) 해당 출처를 `stale`로 바꾸고 `stream.source` 이벤트를 보낸다. 그 출처에서 나온 모든 `StatusInfo.stale`이 `true`가 되고, **값은 지우지 않는다**.
2. 화면은 서버가 멈춘 경우(스트림 끊김)에도 동작하도록 `updatedAt + staleAfterSec`을 1초 타이머로 검사한다(디자인 `status.md` 2.1).
   - watch 기반(노드·파드·워크로드·PVC·이벤트): 마지막 `stream.heartbeat` 수신 시각 + 45초.
   - 메트릭·DB: 45초. 비용 추정: 15분. Cost Explorer: 18시간. 사전 점검: 15분. 브리지: 90초. 스냅샷 폴더(AWS·k8s): 90초(`intervalSec` 10의 3배가 아닌 예외, `aws-snapshot-manager.md` 14절). k8s 드리프트 값: watch 기반과 같이 `kube` 출처 기준.
3. stale은 장애가 아니다. `status`는 마지막 판단 값을 그대로 유지하고 화면은 stale 표시로 **교체**한다.
4. 출처가 회복되면 `stream.source`(state `ok`) 후, watch 기반이면 **해당 토픽의 전체 `*.snapshot`을 다시 보낸다**(재동기화된 목록으로 교체).

### 2.4 `dataSource`
- `DATA_SOURCE=mock|live`(기본 `mock`). 응답·스트림의 `dataSource` 값은 **프로세스 전체에 하나**다.
- mock: 모든 출처가 `state: 'mock'`. AWS·클러스터·대상 DB를 한 번도 호출하지 않는다. 화면은 상단바 `MOCK 데이터` 배지를 상시 표시.
- live: 설정이 없는 출처는 `not_configured`, 설정은 있는데 거부·실패한 출처는 `unavailable`. **어느 경우에도 mock으로 몰래 바꾸지 않는다.** (예: `KUBE_AUTH_FAILED`로 쿠버네티스 인증이 끊긴 동안에도 mock 노드·파드를 대신 내려보내지 않는다. 비용의 `CLUSTER_NAME_NOT_CONFIGURED`도 같다 — `aws-cost.md` 3.1)
  - 충돌: `CLAUDE.md`는 "kubeconfig·AWS 자격 증명이 없으면 mock으로 동작", 명세 `cluster-status` 5절은 "`DATA_SOURCE=live`인데 kubeconfig가 없으면 클러스터 영역을 '알 수 없음(클러스터 연결 없음)'". → 선택: **기본값이 `mock`이라 자격 증명 없이 띄우면 mock으로 동작(CLAUDE.md 충족)하고, 운영자가 명시적으로 `live`를 고른 경우에는 없는 출처를 `unknown`으로 보인다(명세 충족).** 이유: live라고 표시된 화면에 가짜 데이터가 섞이면 운영 판단을 그르친다. 뼈대의 `shouldUseMock(mode, configured)`(live여도 설정 없으면 mock)는 구현 단계에서 이 규칙으로 바꾼다.

---

## 3. 에러

### 3.1 형식

```ts
interface ApiErrorBody {
  statusCode: number;
  code: string;              // UPPER_SNAKE, 화면 분기용
  message: string;           // 한국어 한 줄 (가림 처리됨)
  details?: Record<string, unknown>;
  path: string;              // 요청 경로
  timestamp: string;         // ISO UTC
}
```

예 (400):
```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "요청 값이 올바르지 않습니다.",
  "details": {
    "fields": [
      { "field": "status", "value": "bad", "constraints": ["status must be one of: ok, warning, critical, unknown"] }
    ]
  },
  "path": "/api/cluster/pods",
  "timestamp": "2026-09-19T05:02:10.123Z"
}
```

예 (429):
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1812
Content-Type: application/json
```
```json
{
  "statusCode": 429,
  "code": "CE_REFRESH_COOLDOWN",
  "message": "마지막 Cost Explorer 호출 후 1시간이 지나지 않았습니다.",
  "details": { "nextAvailableAt": "2026-09-19T05:32:22.000Z", "retryAfterSec": 1812 },
  "path": "/api/cost/explorer/refresh",
  "timestamp": "2026-09-19T05:02:10.123Z"
}
```

### 3.2 원칙
- **데이터 출처 실패는 HTTP 오류가 아니다.** 목록·요약 조회는 출처가 없거나 실패해도 `200`으로 응답하고 해당 영역을 `status: 'unknown'` + 사유로 준다(명세: 한 출처 실패가 다른 영역에 영향 없음).
- HTTP 오류는 (1) 요청이 잘못됐거나, (2) 특정 리소스를 지정했는데 판단할 수 없거나, (3) 제한에 걸렸거나, (4) API 자체 오류일 때만.
- 5xx 응답의 `message`에는 스택·내부 경로·접속 문자열을 넣지 않는다.

### 3.3 공통 에러 코드

| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | DTO 검증 실패. `details.fields[]` |
| 403 | `MOCK_MODE_ONLY` | mock 전용 API를 live에서 호출 |
| 403 | `LOG_DISABLED` · `LOG_FORBIDDEN` · `LOG_NAMESPACE_DENIED` | 로그 기능 꺼짐 / `pods/log` 권한 없음 / 차단 네임스페이스 (`logs.md` 6절) |
| 404 | `ROUTE_NOT_FOUND` | 없는 경로 |
| 404 | `LOG_POD_NOT_FOUND` · `LOG_STREAM_NOT_FOUND` | 로그 조회 대상 파드 없음 / 없는·만료된 로그 스트림 (`logs.md` 6절) |
| 404 | `RESOURCE_NOT_FOUND` | 지정한 노드·파드·실행 등이 없음. `details.resource` = `{ kind, namespace?, name? , id? }` |
| 403 | `ORIGIN_NOT_ALLOWED` | 파일 쓰기 API에 허용되지 않은 `Origin` (`aws-snapshot-manager.md` 1.3) |
| 409 | `CONFLICT` 계열 | 상태 충돌 (기능별 코드: `RUN_NOT_ACTIVE`, `SETTING_LOCKED_BY_ENV`, `SNAPSHOT_VERSION_CONFLICT`, `K8S_DRIFT_UNAVAILABLE` 등) |
| 413 | `PAYLOAD_TOO_LARGE` | 본문 1MB 초과. **예외**: 기능 문서가 경로별 상한을 정한 경로는 그 값(`aws-snapshot-manager` 템플릿 저장·검사: `AWS_SNAPSHOT_EDIT_MAX_BYTES × 2 + 64KB`, `k8s-snapshot` 파일 저장·검사: `K8S_SNAPSHOT_EDIT_MAX_BYTES × 2 + 64KB`, 기본 약 10MB. 내용 자체의 상한 5MB 초과는 413 `SNAPSHOT_FILE_TOO_LARGE`) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 본문이 필요한 쓰기 요청이 `application/json`이 아님 (`aws-snapshot-manager`, `k8s-snapshot`) |
| 422 | 기능 규칙 거부 계열 | 형식은 맞지만 기능 규칙상 처리하지 않음 (기능별 코드: `SNAPSHOT_CONFIRMATION_REQUIRED`, `SNAPSHOT_NOTES_SECRET_DETECTED`, **`ALERT_TEST_CONFIRMATION_REQUIRED`** — 되돌릴 수 없는 외부 발송이라 `confirm: true`가 없으면 거부, `alerts.md` 2.7) |
| 429 | `RATE_LIMITED` 계열 | 제한 (기능별 코드: `CE_REFRESH_COOLDOWN`, `CE_DAILY_LIMIT_REACHED`, `BRIDGE_CHECK_COOLDOWN`, **`ALERT_TEST_COOLDOWN`**(60초)). `Retry-After` 헤더(초) + `details.retryAfterSec` |
| 503 | `SOURCE_UNAVAILABLE` | 특정 리소스 상세를 요청했는데 출처가 `not_configured`/`syncing`/`unavailable`이라 있는지조차 판단할 수 없음. `details.source` = `SourceStatus`. `syncing`이면 `Retry-After: 2` |
| 503 | `DASHBOARD_DB_UNAVAILABLE` | 대시보드 자체 DB가 필요한 쓰기(설정 변경)인데 DB 연결 없음 |
| 503 | `STREAM_LIMIT_REACHED` | 공용 SSE 동시 연결 상한(`SSE_MAX_CLIENTS`, 기본 20) 초과 |
| 503 | `LOG_STREAM_LIMIT_REACHED` | **로그 전용** 스트림 상한(`LOG_MAX_STREAMS`, 기본 3) 초과. 위 상한과 **별도 카운터**다 (`logs.md` 5절) |
| 500 | `INTERNAL_ERROR` | 그 밖의 서버 오류 |

기능별 코드는 각 기능 문서의 "에러 코드" 절에 있다.

---

## 4. `GET /api/health` (정식 계약)

API 프로세스 생존과 출처별 연결 상태. 상단바 `ConnectionIndicator`의 "API 응답 없음" 판정과 `dataSource` 확인에 쓴다. 프로세스가 살아 있으면 **항상 200**.

**응답 200**
```json
{
  "status": "degraded",
  "dataSource": "live",
  "version": "0.1.0",
  "serverTime": "2026-09-19T05:02:10.123Z",
  "startedAt": "2026-09-19T03:40:01.000Z",
  "uptimeSec": 4929,
  "checks": {
    "kube":        { "state": "ok",             "configured": true,  "message": null, "checkedAt": "2026-09-19T05:02:00.000Z" },
    "metrics":     { "state": "unavailable",    "configured": true,  "message": "metrics.k8s.io API 없음 (metrics-server 미설치)", "checkedAt": "2026-09-19T05:02:00.000Z" },
    "prometheus":  { "state": "not_configured", "configured": false, "message": null, "checkedAt": null },
    "monitoredDb": { "state": "ok",             "configured": true,  "message": null, "checkedAt": "2026-09-19T05:02:00.000Z" },
    "aws":         { "state": "ok",             "configured": true,  "message": null, "checkedAt": "2026-09-19T05:00:00.000Z" },
    "costExplorer":{ "state": "ok",             "configured": true,  "message": null, "checkedAt": "2026-09-19T01:00:00.000Z" },
    "agentBridge": { "state": "unavailable",    "configured": true,  "message": "연결 거부 (http://host.docker.internal:3002)", "checkedAt": "2026-09-19T05:01:40.000Z" },
    "logBackend":  { "state": "not_configured", "configured": false, "message": null, "checkedAt": null },
    "dashboardDb": { "state": "ok",             "configured": true,  "message": null, "checkedAt": "2026-09-19T05:02:00.000Z" },
    "snapshotStore": { "state": "not_configured", "configured": false, "message": null, "checkedAt": null },
    "k8sSnapshotStore": { "state": "not_configured", "configured": false, "message": null, "checkedAt": null }
  }
}
```

| 필드 | 설명 |
|---|---|
| `status` | `ok`: 설정된 출처가 모두 `ok`/`mock`. `degraded`: 설정된 출처 중 하나라도 `unavailable`/`stale`. (`not_configured`는 degraded로 치지 않음) |
| `dataSource` | `mock` \| `live` |
| `version` | `apps/api/package.json` version |
| `serverTime` | 화면 경과 타이머 보정용 |
| `checks.*.state` | `SourceState`와 같은 값. `aws`는 `awsResources`·`pricing`·`spotPrice` 중 최악 |
| `checks.*.message` | 가림 처리된 한 줄. 접속 문자열·자격 증명 없음 |
| `checks.kube` | 인증 실패(401/403)면 `state: "unavailable"` + `message: "인증 실패 — 토큰이 만료됐을 수 있습니다"`(2.3 `KUBE_AUTH_FAILED`). 설정 자체가 없으면 `not_configured` |
| `checks.logBackend` | 외부 로그 스택(`logs`). `LOG_BACKEND`가 비어 있으면 `not_configured`이고 **`degraded`로 치지 않는다**(스택이 없으면 `pods/log` 직접 조회로 동작한다 — 정상 상태다). 설정은 있는데 연결·인증이 실패하면 `unavailable`. `message`에 자격 증명·토큰·URL 전체를 넣지 않는다 |
| `checks.k8sSnapshotStore` | 로컬 k8s 스냅샷 폴더(`k8s-snapshot`). 규칙은 `snapshotStore`와 같다. 스캐너(`AWS_SNAPSHOT_LIB_DIR`)나 k8s 규칙 lib(`K8S_SNAPSHOT_LIB_DIR`)를 못 불러오면 `unavailable` |
| `checks.snapshotStore` | 로컬 스냅샷 폴더(`aws-snapshot-manager`). 클러스터 안에 배포한 대시보드는 보통 `not_configured`(degraded 아님). 폴더 없음·읽기 실패·스캐너 lib 없음은 `unavailable`(message 예: `"스냅샷 폴더를 찾을 수 없습니다: deploy/aws-snapshot/snapshots"`) |

- `checks`는 **캐시된 값**이다. 이 요청이 외부(쿠버네티스·AWS·브리지)를 새로 호출하지 않는다(3초 타임아웃 프론트 호출에 안전).
- 뼈대와의 차이: 뼈대는 `checks.*`가 `"configured" | "not_configured"` 문자열이었다. 이 계약으로 **객체로 바뀐다**. 프론트 뼈대(`src/lib/health.ts`)는 `dataSource`만 읽으므로 영향 없음.
- mock: 모든 check가 `{ "state": "mock", "configured": false }`, `status: "ok"`.

---

## 5. 실시간 스트림 (SSE)

### 5.1 엔드포인트 구조: **단일 스트림 + 토픽 선택**

```
GET /api/stream?topics=overview,cluster,metrics,db,cost,advisor,aws-snapshots,k8s-snapshots,snapshot-menu,alerts
Accept: text/event-stream
```

| 토픽 | 내용 | 문서 |
|---|---|---|
| `overview` | 사이드바 영역 상태, 상단바 클러스터 정보, 개요 요약 띠·"지금 확인할 항목", 비용·어드바이저 요약 카드 | `cluster-status.md` |
| `cluster` | 노드·워크로드·파드·Warning 이벤트·PVC 목록과 변경분 | `cluster-status.md` |
| `metrics` | CPU·메모리 사용량(15초), 클러스터 합계, 추이 표본 추가 | `cluster-status.md` |
| `db` | DB 상세(15초) | `cluster-status.md` |
| `cost` | 비용 추정·배분·확정·예산·급증·CE 새로고침 상태 | `aws-cost.md` |
| `advisor` | 브리지 상태, 사전 점검, 분석 실행 진행·종료 | `architecture-advisor.md` |
| `aws-snapshots` | AWS 스냅샷 요약 + 바뀐 스냅샷 ID 알림 (**행 데이터 없음**, 라벨·메모·템플릿 금지. 화면은 REST로 다시 조회) | `aws-snapshot-manager.md` 11절 |
| `k8s-snapshots` | k8s 스냅샷 요약 + 바뀐 스냅샷 ID 알림 + 드리프트 배지(건수·상태만, **필드 값 없음**) | `k8s-snapshot.md` 13절 |
| `snapshot-menu` | 사이드바 "스냅샷" 메뉴 상태·숫자와 AWS/Kubernetes 탭 배지 (서버 합산, 드리프트는 메뉴 상태에 넣지 않음) | `k8s-snapshot.md` 12절 |
| `alerts` (2026-09-25) | 사이드바 `알림` 배지(미확인 수·최악 심각도), 발송 설정 요약, 알림 1건 추가·갱신·확인 (**이력 목록은 싣지 않는다**) | `alerts.md` 6절 |

- `topics` 생략 시 **전체**. 알 수 없는 토픽이면 스트림을 열기 전에 400 `VALIDATION_FAILED`.
- **예외: 컨테이너 로그는 이 스트림에 싣지 않는다** (2026-09-25, `logs.md` 0.3·2.3·7절). `?topics=logs`는 **400**이다. 이유: ① 공용 스트림은 모든 구독자에게 방송되므로 로그 화면을 열지 않은 탭까지 로그 본문을 받는다, ② heartbeat·상태 이벤트가 로그 폭주에 밀린다. 로그는 **전용 연결**(`POST /api/logs/streams` → `GET /api/logs/stream/:id`)을 쓰고 봉투도 다르다(`topic` 없음).
  - **상한도 따로 센다**: `LOG_MAX_STREAMS`(기본 3)는 아래 `SSE_MAX_CLIENTS`(기본 20)와 **별개 카운터**다. 로그 스트림이 가득 차도 공용 스트림과 다른 화면은 영향을 받지 않는다.
- **선택: 기능별 스트림이 아니라 단일 스트림.** 이유:
  1. 사이드바(`shell.md` 3절)가 **모든 페이지에서** 클러스터·비용·어드바이저 상태를 동시에 보여 준다. 기능별 스트림이면 탭 하나에 연결 3개가 필요하고, 브라우저의 HTTP/1.1 origin당 동시 연결 6개 제한에 탭 2개만 열어도 걸린다.
  2. 상단바 연결 표시(`ConnectionIndicator`)는 전역 상태 하나다. 연결·heartbeat·재연결이 하나여야 "연결 끊김" 판단이 단순하다.
  3. 서버는 토픽별 구독자 수로 불필요한 작업을 끈다(예: 브리지 상태 확인은 `advisor` 구독자가 있을 때만).
- 권장 사용: 프론트는 **앱 레이아웃에서 스트림 1개**를 연다. 규모가 작으므로(파드 수백 개) 기본은 전체 토픽을 구독해도 된다. 페이지 이동마다 토픽을 바꾸면 재연결 + 스냅샷 재전송이 일어나므로 권장하지 않는다.
- 참고: 프론트 뼈대 예시의 `/cluster/stream`은 이 계약으로 `/stream`이 된다.
- 동시 연결 상한: 20(env `SSE_MAX_CLIENTS`). 넘으면 503 `STREAM_LIMIT_REACHED`.

### 5.2 응답 헤더
```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```
- 압축하지 않는다(버퍼링 방지).

### 5.3 이벤트 형식

```
retry: 3000

event: stream.hello
data: {"seq":1,"topic":"stream","emittedAt":"2026-09-19T05:02:10.123Z","payload":{...}}

event: cluster.pod.upsert
data: {"seq":42,"topic":"cluster","emittedAt":"2026-09-19T05:02:11.500Z","payload":{...}}

```

- **이벤트 이름 규칙**: `<topic>.<entity>.<action>` 또는 `<topic>.<action>`. 소문자, 점 구분.
  - `<topic>.snapshot`: 토픽 전체 상태. 받으면 그 토픽의 화면 상태를 **통째로 교체**.
  - `<topic>.<entity>.upsert` / `<topic>.<entity>.delete`: 목록 한 행의 추가·변경 / 삭제. upsert는 **행 전체**를 준다(부분 패치 없음).
  - `<topic>.<entity>.updated`: 단일 객체 전체 교체(요약, DB 상세 등).
  - 스트림 자체 이벤트는 `stream.*`.
- **data**: 한 줄 JSON(줄바꿈 없음). 모든 이벤트가 같은 봉투를 쓴다.
  ```ts
  interface StreamEnvelope<T> {
    seq: number;        // 연결마다 1부터 증가. 빠짐 감지·디버그용 (재연결하면 1부터 다시)
    topic: 'stream' | 'overview' | 'cluster' | 'metrics' | 'db' | 'cost' | 'advisor' | 'aws-snapshots' | 'k8s-snapshots' | 'snapshot-menu' | 'alerts';
    emittedAt: string;  // 서버가 이벤트를 만든 시각
    payload: T;
  }
  ```
- `id:` 필드는 **보내지 않는다**(5.6).
- 순서 보장: 한 연결 안에서 `seq` 순서대로 도착한다. 어떤 토픽의 변경분은 그 토픽의 `*.snapshot`보다 먼저 오지 않는다.
- 서버 합치기: 같은 객체의 연속 변경은 **500ms 창으로 합쳐** 마지막 상태 한 번만 보낸다(파드 상태가 초당 여러 번 바뀌어도 이벤트 폭주 없음). 명세 "변화 후 3초 이내" 목표 안.

### 5.4 연결 직후 순서 (초기 스냅샷)

```
retry: 3000
event: stream.hello          ← 항상 첫 이벤트
event: overview.snapshot     ← 구독한 토픽마다 1개씩 (overview → cluster → metrics → db → cost → advisor → aws-snapshots → k8s-snapshots → snapshot-menu 순)
event: cluster.snapshot
...
(이후 변경분, heartbeat)
```

`stream.hello` payload:
```json
{
  "streamId": "b1f0c7e2-6f0e-4a55-9c3e-0d0b5f1a2c11",
  "dataSource": "mock",
  "serverTime": "2026-09-19T05:02:10.123Z",
  "heartbeatSec": 15,
  "topics": ["overview", "cluster", "metrics", "db", "cost", "advisor"],
  "sources": [
    { "id": "kube", "state": "mock", "intervalSec": 15, "staleAfterSec": 45, "lastSuccessAt": "2026-09-19T05:02:10.000Z", "lastAttemptAt": "2026-09-19T05:02:10.000Z", "error": null }
  ]
}
```
- 출처가 아직 `syncing`이면(최초 informer 목록 전) 해당 토픽 스냅샷은 빈 목록 + `sync.initialSyncDone: false`로 먼저 보내고, 동기화가 끝나면 스냅샷을 다시 보낸다.
- 스냅샷은 REST 목록 응답과 **같은 항목 모양**이다(필터 없이 전체). **예외**: `aws-snapshots`·`k8s-snapshots` 토픽은 요약과 revision만 준다(`aws-snapshot-manager.md` 11절, `k8s-snapshot.md` 13절). `snapshot-menu`는 `GET /api/snapshot-menu`와 같은 모양.

### 5.5 heartbeat
- **15초**마다 `stream.heartbeat` 이벤트. (주석 줄 `:`이 아니라 **이름 있는 이벤트**. EventSource API는 주석을 화면 코드에 전달하지 않으므로 끊김 감지에 쓸 수 없다.)
  ```
  event: stream.heartbeat
  data: {"seq":88,"topic":"stream","emittedAt":"2026-09-19T05:02:25.123Z","payload":{"serverTime":"2026-09-19T05:02:25.123Z"}}
  ```
- 결정 이유: 15~30초 범위에서 가장 짧은 값. watch 기반 데이터의 stale 기준이 heartbeat × 3 = **45초**로 메트릭·DB(15초 × 3)와 같아져 화면 규칙이 하나가 된다. 이벤트 크기가 작아 비용이 거의 없다.
- 프론트 권장: 마지막 수신(아무 이벤트) 후 **35초**(heartbeat 2회 + 여유) 동안 아무것도 오지 않으면 연결을 닫고 재연결한다(프록시가 연결을 조용히 끊은 경우 대비).

### 5.6 재연결 · `Last-Event-ID`
- **`Last-Event-ID`는 지원하지 않는다.** 헤더가 와도 무시하고, 모든 연결은 `stream.hello` + 전체 스냅샷으로 시작한다. `id:` 필드도 보내지 않는다.
  - 이유: (1) 명세 `cluster-status` 4절 "재연결 시 전체 스냅샷을 다시 받는다", (2) 프론트 `useEventSource`는 오류 시 EventSource를 닫고 새로 만들어 재연결하므로 브라우저가 `Last-Event-ID`를 보내지 않는다, (3) 스냅샷이 작아(수백 KB 이하) 재전송 비용보다 재생 버퍼의 일관성 문제가 크다.
- `retry: 3000`: 브라우저 기본 재연결을 쓰는 클라이언트용 권장값(3초). 프론트 뼈대처럼 직접 백오프(1초 → 최대 30초)를 쓰면 무시해도 된다.
- 재연결 후 스냅샷을 받으면 화면은 기존 상태를 교체하고 "다시 연결됨"을 표시한다(디자인 `status.md` 2.3).

### 5.7 출처 상태 이벤트
- 출처 상태가 바뀔 때마다(`ok ↔ stale ↔ unavailable` 등) 모든 구독자에게 `stream.source`:
  ```
  event: stream.source
  data: {"seq":120,"topic":"stream","emittedAt":"2026-09-19T05:03:02.000Z","payload":{"source":{"id":"kube","state":"stale","intervalSec":15,"staleAfterSec":45,"lastSuccessAt":"2026-09-19T05:02:55.000Z","lastAttemptAt":"2026-09-19T05:03:01.000Z","error":{"code":"WATCH_DISCONNECTED","message":"pods watch 연결 끊김, 재시작 중 (2회째)"}}}}
  ```
- 같은 시점에 영향을 받은 토픽의 `StatusInfo.stale`은 서버 메모리에서 `true`로 바뀌지만, 행마다 upsert를 보내지는 않는다. 화면은 `stream.source`를 받으면 그 출처에서 온 값을 모두 stale로 보인다(출처 ↔ 토픽 매핑은 기능 문서). 회복되면 `stream.source`(ok) + 해당 토픽 `*.snapshot`.
- 서버 종료 시: 스트림을 닫기 전에 `stream.closing` `{ "reason": "shutdown" }`을 보낸다(프론트는 일반 끊김과 같이 재연결).

### 5.8 스트림 이벤트 전체 목록

| 이벤트 | 토픽 | 정의 문서 |
|---|---|---|
| `stream.hello`, `stream.heartbeat`, `stream.source`, `stream.closing` | stream | 이 문서 |
| `overview.snapshot`, `overview.updated` | overview | `cluster-status.md` 8절 |
| `cluster.snapshot`, `cluster.summary.updated`, `cluster.node.upsert/delete`, **`cluster.controlplane.updated`**, `cluster.workload.upsert/delete`, `cluster.pod.upsert/delete`, `cluster.event.upsert/delete`, `cluster.pvc.upsert/delete` | cluster | `cluster-status.md` 8절 |
| `metrics.snapshot`, `metrics.updated` | metrics | `cluster-status.md` 8절 |
| `db.snapshot`, `db.updated` | db | `cluster-status.md` 8절 |
| `cost.snapshot`, `cost.estimate.updated`, `cost.actual.updated`, `cost.status.updated`, `cost.refresh.updated`, `cost.rate.sampled` | cost | `aws-cost.md` 7절 |
| `advisor.snapshot`, `advisor.bridge.updated`, `advisor.precheck.updated`, `advisor.run.progress`, `advisor.run.finished` | advisor | `architecture-advisor.md` A.8절 |
| `aws-snapshots.snapshot`, `aws-snapshots.changed` | aws-snapshots | `aws-snapshot-manager.md` 11절 |
| `k8s-snapshots.snapshot`, `k8s-snapshots.changed`, `k8s-snapshots.drift` | k8s-snapshots | `k8s-snapshot.md` 13절 |
| `snapshot-menu.snapshot`, `snapshot-menu.updated` | snapshot-menu | `k8s-snapshot.md` 12절 |
| `alerts.snapshot`, `alerts.created`, `alerts.updated`, `alerts.read` | alerts | `alerts.md` 6절 |
| (공용 스트림 아님) `log.hello`, `log.lines`, `log.notice`, `log.paused`, `log.heartbeat`, `log.closing` | **전용 연결** `GET /api/logs/stream/:id` | `logs.md` 7절 |

---

## 6. mock 시나리오 전환 API

- 결정: **포함한다.** 명세 수용 기준(`cluster-status` 5절 "모든 상태 재현", `aws-cost` 5절 "mock 시나리오 전환", `architecture-advisor` 5절 "오류 시나리오를 설정으로 재현")을 재시작 없이 확인할 수 있고, 디자인이 MOCK 배지 Popover 메뉴를 이미 설계했다(`status.md` 2.4).
- **mock 모드에서만** 동작한다. live에서는 403 `MOCK_MODE_ONLY`. 조회(`GET`)는 live에서도 200(`enabled: false`, 빈 목록)으로 답해 화면이 배지 클릭 가능 여부를 판단할 수 있게 한다.
- 시나리오 상태는 **프로세스 메모리**에만 있다(재시작하면 기본값). 모든 탭에 공통(서버 상태)이다.
- 시나리오를 바꾸면 영향을 받는 토픽의 `*.snapshot`을 모든 구독자에게 다시 보낸다.

### 6.1 `GET /api/mock/scenarios`

**응답 200 (mock)**
```json
{
  "dataSource": "mock",
  "enabled": true,
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "groups": [
    {
      "id": "cluster",
      "label": "클러스터",
      "active": "mixed",
      "options": [
        { "id": "mixed", "label": "혼합 (기본)", "description": "정상·주의·장애·알 수 없음이 영역마다 섞여 있음" },
        { "id": "healthy", "label": "모두 정상", "description": "" }
      ]
    },
    { "id": "db", "label": "데이터베이스", "active": "warning", "options": [] },
    { "id": "cost", "label": "비용", "active": "normal", "options": [] },
    { "id": "advisor", "label": "어드바이저", "active": "normal", "options": [], "fastTimers": true }
  ]
}
```

**응답 200 (live)**: `{ "dataSource": "live", "enabled": false, "generatedAt": "...", "groups": [] }`

**시나리오 ID** (예시 응답의 `options`는 생략해 적었다. 실제 응답에는 아래 전체가 들어간다)

| group | id | 재현 내용 |
|---|---|---|
| `cluster` | `mixed` (기본) | 각 영역에 정상·주의·장애가 1건 이상. CrashLoopBackOff 파드, NotReady 노드, ready 0 Deployment, Pending 파드, OOMKilled, 심각 reason 이벤트, cordon 노드, 관측 1시간 미만 재시작 등. 값은 15초마다 흔들림 |
| | `healthy` | 전부 정상 |
| | `warning` | 주의만 (cordon, 재시작 1~2회, 사용률 80%) |
| | `critical` | 장애 다수 |
| | `no-metrics` | metrics 출처 `unavailable` → CPU·메모리 unknown |
| | `kube-stale` | kube 출처 `stale` (watch 끊김 재현, 마지막 값 유지) |
| | `no-cluster` | kube 출처 `not_configured` → 클러스터 영역 unknown |
| | `kube-auth-failed` | kube 출처 `unavailable` + `KUBE_AUTH_FAILED`(토큰 만료 재현, 2.3). **mock 데이터로 대체되지 않는 것**을 화면에서 확인하는 용도 |
| | `empty` | **워커** 0대 (클러스터 전체 장애). 마스터 3대는 정상으로 남는다 (`cluster-status.md` 9절 `CLUSTER_NO_WORKER_NODES`) |
| | `cp-healthy` | 컨트롤 플레인 정상: 마스터 3대 Ready, 필수 구성요소 15/15 |
| | `cp-single` | 마스터 1대(HA 아님) → `CONTROL_PLANE_HA_EXPECTED=true`면 주의 |
| | `cp-node-down` | 마스터 3대 중 1대 NotReady → 주의(쿼럼 유지). **그 마스터의 구성요소 5종은 `unknown`**(미러 파드가 Running으로 남아 있어도) |
| | `cp-quorum-lost` | 마스터 3대 중 2대 NotReady → 장애(쿼럼 상실) |
| | `cp-component-crash` | `kube-scheduler`가 한 마스터에서 최근 1시간 4회 재시작 → 구성요소 장애 |
| | `cp-not-found` | `node-role.kubernetes.io/control-plane` 라벨 노드 0대 → 컨트롤 플레인 영역 `unknown`(`CONTROL_PLANE_NOT_FOUND`). 워커 집계는 정상 |
| `db` | `ok`, `warning` (기본), `critical` | DBA 픽스처 (`buildPgFixtureSnapshot`). warning = 연결 82%, 긴 쿼리 3건, idle in tx 12분 |
| | `unreachable` | 파드는 떠 있고 접속 실패 (장애) |
| | `no-pod` | DB 파드 없음 (대표 사유가 파드 쪽) |
| | `standby` | standby 1개, 복제 지연 주의 |
| | `stale` | DB 수집 중단 → 45초 뒤 stale |
| | `not-configured` | DB 대상 설정 없음 |
| `cost` | `normal` (기본) | 예산·급증 정상 |
| | `budget-warning`, `budget-over` | 예산 주의(예측 ≥ 90%) / 초과(누적 ≥ 100%) |
| | `spike-warning`, `spike-critical` | 소모율 급증 주의 / 급증 (원인 목록 포함) |
| | `forecast-unavailable` | AWS 예측 불가 → 추정 월말로 예산 판단 |
| | `ce-unavailable` | Cost Explorer 사용 불가 (AccessDenied) |
| | `ce-limit-reached` | 일일 호출 한도 도달 |
| | `unpriced` | 단가 없음 리소스 포함 |
| | `spot-fallback` | 스팟 시세 조회 실패 (온디맨드 상한) |
| | `baseline-collecting` | 소모율 기록 24시간 미만 (기준 수집 중) |
| | `no-budget` | 예산 미설정 (예산 영역 숨김) |
| `advisor` | `normal` (기본) | 브리지가 켜져 있으면 mock 스냅샷으로 **실제 분석**, 꺼져 있으면 **예시 응답** 흐름 |
| | `example` | 브리지 상태와 무관하게 예시 응답 |
| | `bridge-down`, `login-required`, `usage-limit` | 브리지 상태 재현 (분석 실행 버튼 비활성) |
| | `delayed` | 예시 흐름이 지연 기준을 넘김 |
| | `timeout` | 예시 흐름이 시간 초과로 실패 |
| | `invalid-response` | 응답 형식 오류로 실패 (원문 디버그 영역 포함) |
| | `budget-exceeded` | 비용 상한(`maxBudgetUsd`) 초과로 실패 |
| `snapshots` | `default` (기본) | 예시 스냅샷 9개(정상·주의·장애·알 수 없음·큰 파일) + 휴지통 1개. 편집·삭제는 메모리에서만 |
| | `empty` | 스냅샷 0개 (빈 상태 + CLI 안내) |
| | `not-configured`, `unavailable` | 스냅샷 폴더 설정 없음 / 폴더 없음 |
| | `read-only`, `write-disabled` | 쓰기 불가 (읽기 전용 / 쓰기 스위치 꺼짐) |
| | `conflict-once` | 다음 저장 한 번을 409 충돌로 응답한 뒤 `default`로 자동 복귀 |
| `k8s-snapshots` | `default` (기본) | 예시 k8s 스냅샷 10개(파일 정상·주의·장애·알 수 없음, 드리프트 차이 있음·다른 클러스터·지난 결과) + 휴지통 1개. 편집·삭제는 메모리에서만 |
| | `empty`, `not-configured`, `unavailable`, `read-only`, `write-disabled`, `conflict-once` | AWS `snapshots` 그룹과 같은 뜻 |
| | `cluster-disconnected` | 드리프트 쪽 클러스터 연결 없음 (모든 드리프트 알 수 없음, 계산 버튼 비활성) |
| | `no-drift` | 최신 스냅샷 드리프트 "차이 없음" |
| | `large` | 3D 구성도(`snapshot-3d.md` 12.4)용 대규모 예시 2개만: 리소스 1,000개(관계선 약 1,960) + 3,200개(묶어 보기). 기본 예시와 섞지 않아 기본 목록이 느려지지 않는다. 클러스터가 달라(`bench.k8s.example.com`) 드리프트는 계산하지 않는다 |
| `alerts` | `default` (기본) | 최근 24시간 예시 알림 12건(장애 3·주의 4·확인 불가 1·해제 3·플래핑 묶음 1), **미확인 3건** → 사이드바 배지 3 + 탭 제목 `(3) Sentinel` |
| | `empty` | 알림 0건 (빈 상태 + 마지막 관측 시각·감시 대상 8개) |
| | `burst` | 3초마다 1건 추가 (배지 숫자가 올라가는 것을 눈으로 확인) |
| | `flapping` | 한 키가 30분에 6회 전이 → 불안정 묶음 1건, 그 뒤 조용함 |
| | `restart` | 워밍업 요약 1건 + 정지 구간 19분 |
| | `webhook-unset`, `webhook-failed`, `webhook-ratelimited` | 웹훅 미설정(화면만 동작) / 5xx 3회 실패 후 포기(+ 발송 정지 `skipped_circuit_open` 2건·짝 없는 해제 `skipped_no_pair` 1건 이력 + 설정 화면 서킷 "열림" **표시 전용** 값 — 실제 발송 상태와 무관, `alerts.md` 5절, 2026-09-25) / 429 큐 대기 |
| | `suppressed-by-source` | `kube` 끊김으로 영역 5개가 묶여 `source:kube` 1건만 |
| `logs` | `direct` (기본) | 로그 스택 없음 → `로그 스택` 회색, 한계 4줄, 스택 트레이스·이전 세대·따라가기 흐름 |
| | `stack` | 로그 스택 있음(Loki) → 검색·기간·합쳐보기·사라진 파드가 **실제 Loki 없이** 동작 |
| | `stack-down` | 설정은 있는데 연결 실패 → 오류 + `직접 조회로 전환` 버튼(자동 전환 없음) |
| | `forbidden`, `empty`, `pod-gone`, `disabled` | `pods/log` 403 / 출력 없는 컨테이너 / 사라진 파드 / `LOGS_ENABLED=false`(로그 **링크도 함께** 사라진다 — `logHref` 전부 `null` + `cluster.snapshot` 재전송, 2026-09-25) |
| | `noisy` | 초당 수천 줄 → `초당 상한으로 N줄 생략됨` |
| | **`secrets`** | 비밀값이 섞인 줄 → **가림 확인(필수)**. 환경 변수 덤프·Bearer·커넥션 스트링·PEM·**실패한 SQL 문(`sql_statement`)**·오탐 확인용 커밋 해시 |
| | `binary` | ANSI 코드·제어문자·8KiB 넘는 줄·깨진 UTF-8·바이너리 덩어리 |
| | `control-plane` | `kube-apiserver`·`etcd-manager-main` 로그 + 자기참조 안내 |
| | `stream-notice`, `idle-pause`, `max-duration` | 따라가기 전용 스트림 이벤트를 **수십 초 안에**: 10초 뒤 `log.notice`(생략 줄) / touch 20초 없으면 `log.paused` / 30초 뒤 `log.closing`(`max_duration`). 기준값만 줄이고 서버 경로는 실제와 같다 (`logs.md` 9절, 2026-09-25) |
| | `container-starting` | 고른 뒤 30초 동안 컨테이너 시작 전 — 따라가기는 안내 후 **연결을 유지하고 기다렸다가 붙는다**, 정지 조회는 200 + `LOG_CONTAINER_NOT_STARTED` (2026-09-25) |
| | `stack-auth-failed`, `stack-rejected`, `kubelet-unreachable` | 로그 스택 인증 실패 / 쿼리 거부(`details.reason`) / 노드(kubelet)에 못 닿음 — 전부 조회 **200 + 안내**, live와 같은 모양 (2026-09-25) |
| | `flood` | 따라가기에 초당 상한의 80%(기본 1,600줄/초) → 화면 링버퍼 2만 줄이 약 13초에 찬다. 40줄마다 가림 대상 1줄 (2026-09-25) |

- `advisor.fastTimers`(기본 `true`): mock에서 지연 기준 10초, 시간 초과 20초로 줄인다(명세 "짧은 시간 제한으로 테스트 가능"). `false`면 설정값(180초/600초).
- **그룹 사이의 관계 (cluster → cost)**: 비용 mock의 노드·파드·PVC·로드밸런서는 **cluster 그룹의 현재 시나리오 인벤토리를 그대로 쓴다**(클러스터 화면과 비용 화면의 노드 이름·수가 같다). EC2·EBS·ELB 가짜 리소스와 단가는 그 인벤토리에서 만든다.
  - cost `spike-warning`/`spike-critical`(노드 +3/+6)과 `unpriced`(GPU 노드 1개, CLB)는 **비용 화면에만** 가상 노드·파드를 덧붙인다(클러스터 화면에는 없음).
  - 비용의 `controlPlane` 카테고리(마스터 EC2·etcd 볼륨·API 서버 LB·마스터 퍼블릭 IPv4)도 cluster 그룹의 **마스터 노드 인벤토리**에서 만든다. `cp-single`이면 마스터 1대, `cp-not-found`면 `controlPlane` 카테고리가 비고 `api_lb`만 남는다.
  - cluster 시나리오가 `no-cluster`·`kube-auth-failed`처럼 인벤토리를 쓸 수 없으면 비용 추정은 마지막 인벤토리 기준 AWS 목록으로 계속하고, 배분(`/api/cost/allocation`)만 `SOURCE_NOT_CONFIGURED`(live와 같은 동작). `empty`면 노드 0개 기준.
  - cluster 시나리오를 바꾸면 약 1~2초 뒤 `cost.snapshot`도 다시 보낸다.
- **그룹 사이의 관계 (cluster → k8s-snapshots)**: k8s 드리프트의 mock 클러스터 쪽 객체는 cluster 그룹의 현재 인벤토리로 만든다(드리프트의 이미지·limits·replicas가 클러스터 화면 값과 같다). cluster 시나리오를 바꾸면 드리프트를 다시 계산해 `k8s-snapshots.drift`를 보낸다. `no-cluster`·`kube-auth-failed`면 드리프트 전체가 "클러스터 연결 없음", `kube-stale`이면 드리프트 stale(`k8s-snapshot.md` 14.3).
- **그룹 사이의 관계 (cluster·cost → alerts)** (2026-09-25): `alerts` 그룹은 **미리 쌓인 이력**이고, **실시간 생성 확인은 `cluster`·`cost` 시나리오 전환으로 한다.** `cluster`를 `healthy` → `critical`로 바꾸면 상태 전이가 실제로 일어나 15초 안에 `area:pods`·`area:nodes` 알림이 만들어지고 `alerts.created` + 배지 증가가 온다(AC-ALERT02). `kube-auth-failed`는 출처 억제(`source:kube` 1건 + 영역 5개 억제, AC-ALERT07), `kube-stale`은 3분 지속 후 확인 불가, `cp-*`는 컨트롤 플레인 알림, `cost`의 `budget-over`·`spike-warning`은 비용 알림을 만든다(AC-ALERT12). **mock에서 디스코드로 나가는 요청은 0건이다**(`ALERTS_DISPATCH=mock`).
- **`logs` 그룹은 다른 그룹과 연동하지 않는다.** 예외 하나: `disabled`는 로그 **링크**(`cluster`·`alerts` 응답의 `logHref`)도 함께 지운다(2026-09-25, `logs.md` 11.4). 로그 픽스처는 `cluster` 인벤토리의 파드 이름을 쓰되(같은 파드의 로그처럼 보이게) 내용은 시나리오가 정한다. `DATA_SOURCE=live`인데 클러스터·로그 스택이 없으면 **mock 로그를 대신 보여주지 않는다**(`logs.md` 9절).
- 그룹의 `options`(이름·설명)와 reset 기본값은 각 기능 모듈이 제공한다. 위 표의 `(기본)`이 reset 기본값이다.

### 6.2 `PUT /api/mock/scenarios/:group`

요청:
```json
{ "scenario": "spike-critical" }
```
어드바이저만 선택 필드 `fastTimers: boolean`.

**응답 200**: 6.1 응답의 해당 그룹 객체.
```json
{ "id": "cost", "label": "비용", "active": "spike-critical", "options": [ ... ] }
```

| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `scenario`가 그 그룹에 없는 ID |
| 403 | `MOCK_MODE_ONLY` | live 모드 |
| 404 | `RESOURCE_NOT_FOUND` | 없는 group |
| 409 | `RUN_ACTIVE` | advisor 그룹을 바꾸려는데 분석이 진행 중 (진행 중 실행을 먼저 취소) |

### 6.3 `POST /api/mock/reset`
모든 그룹을 기본값으로 되돌리고 mock 시계열·이력(소모율 기록, 예시 분석 이력, AWS·k8s 예시 스냅샷의 편집·휴지통 상태, k8s 예시 드리프트 결과)을 초기 상태로 다시 만든다. 본문 없음.
**응답 200**: 6.1과 같은 전체 응답. 오류: 403 `MOCK_MODE_ONLY`, 409 `RUN_ACTIVE`.

---

## 7. 공통 타입 모음 (TypeScript 표기)

```ts
type Status = 'ok' | 'warning' | 'critical' | 'unknown';
type DataSource = 'mock' | 'live';

interface ResourceRef {
  kind: string;               // 'Pod' | 'Node' | 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'PersistentVolumeClaim' | 'Service' | 'Ingress' | 'NodeGroup' | ...
  namespace: string | null;   // 클러스터 범위 리소스는 null
  name: string;
}

interface ListMeta {
  total: number;          // 필터 전 전체 수
  filteredTotal: number;  // 필터 후 수 ("412개 중 37개 표시")
  offset: number;
  limit: number | null;   // null = 전체
}

interface Thresholds {    // 화면 UsageBar·차트 임계선용 (서버 값)
  warnPct: number;
  critPct: number | null; // 장애 기준이 없는 지표는 null
}
```

## 8. 변경 이력
- 2026-09-25 (logs mock = live, backend): **추가만.** 6.1 `logs` 그룹에 시나리오 4개(`container-starting`·`stack-auth-failed`·`stack-rejected`·`kubelet-unreachable`). `logs.md` 6절 안내 코드는 mock과 live가 같은 모양(조회 200 + notice)으로 나간다.
- 2026-09-25 (logs·alerts 5b 후속, backend): **추가만.** 6.1 `logs` 그룹에 시나리오 4개(`stream-notice`·`idle-pause`·`max-duration`·`flood`), `disabled`가 로그 링크도 지운다는 예외 한 줄, `alerts` `webhook-failed`에 발송 칩 2종 이력. 기존 엔드포인트·토픽·응답 필드·기본 시나리오 변경 없음.
- 2026-09-25 (alerts·logs 계약, backend 3단계): 적용 문서에 `alerts.md`·`logs.md` 추가. **추가만 했고 기존 엔드포인트·토픽·이벤트·응답 필드 삭제·변경 없음.**
  - 0 요약: **"밖으로 나가는 통지" 행 신설**(디스코드 웹훅 — 관측 대상을 바꾸지 않는다, `alerts.md` 0.2), "실시간" 행에 로그 전용 연결 예외 한 줄.
  - 1.2: `Origin` 검사·`Content-Type` 요구를 **로그 조회(`POST /api/logs/query`·`/streams`)에도** 적용.
  - 1.4: **예외 ③ 컨테이너 로그 본문**(가림 처리된 `segments[]`로만, 로그 전용 엔드포인트에서만), 검증 실패 `details.fields[].value` 제외 필드에 `webhookUrl`·`text`(로그 검색어) 추가.
  - 2.3: `SourceId`에 **`logBackend`** 1개 추가(`not_configured`는 degraded 아님), `SourceStatus.error.code`에 `LOG_BACKEND_UNAVAILABLE`·`LOG_BACKEND_AUTH_FAILED`.
  - 3.3: 403 `LOG_DISABLED`·`LOG_FORBIDDEN`·`LOG_NAMESPACE_DENIED`, 404 `LOG_POD_NOT_FOUND`·`LOG_STREAM_NOT_FOUND`, 422 `ALERT_TEST_CONFIRMATION_REQUIRED`, 429 `ALERT_TEST_COOLDOWN`, 503 `LOG_STREAM_LIMIT_REACHED`(`SSE_MAX_CLIENTS`와 **별도 카운터**).
  - 4절: `checks.logBackend` 행 추가.
  - 5.1: 토픽 **`alerts`** 1개 추가 + **로그는 공용 스트림에 싣지 않는다**는 예외(`?topics=logs`는 400, 전용 연결, 상한 별도). 5.3 봉투 `topic` union에 `'alerts'`, 5.8 이벤트 목록에 `alerts.*`와 전용 `log.*`.
  - 6.1: mock 그룹 **`alerts`**(9개)·**`logs`**(11개)와 cluster·cost → alerts 관계 추가.
- 2026-09-24 (kops-support 계약, backend 3단계): 대상 환경이 **kOps 클러스터**로 바뀌면서 공통 규약을 정리. 2.3 `SourceId.awsResources` 설명에서 EKS Describe 삭제, **`SourceStatus.error.code` 공통 표 신설**(`KUBE_AUTH_FAILED`·`KUBE_CONNECT_FAILED`·`METRICS_API_UNAVAILABLE`·`AWS_ACCESS_DENIED`)과 `KUBE_AUTH_FAILED` 동작 4항목, 2.4 "mock으로 대체하지 않는다"를 인증 실패·`CLUSTER_NAME_NOT_CONFIGURED`까지 확장, 4절 `checks.kube` 행 추가·`checks.snapshotStore` 문구 일반화, 5.8 이벤트 목록에 **`cluster.controlplane.updated`** 추가(**새 토픽 없이 기존 `cluster` 토픽**), 6.1 cluster mock 시나리오 7개 추가(`kube-auth-failed`, `cp-healthy`·`cp-single`·`cp-node-down`·`cp-quorum-lost`·`cp-component-crash`·`cp-not-found`)와 `empty`의 뜻을 "워커 0대"로 정정, cluster → cost 관계에 `controlPlane` 인벤토리 규칙 추가, mock 클러스터 이름 `prod-eks`→`prod.k8s.example.com`(`bench-eks`→`bench.k8s.example.com`). **기존 엔드포인트·SSE 토픽·응답 필드 삭제 없음**(추가와 문구 정정만).
- 2026-09-19: 최초 작성 (backend, 3단계 계약)
- 2026-09-19 (aws-snapshot-manager 계약): 0 요약 "쓰기" 행, 1.2 CORS `DELETE` 추가·파일 쓰기 보호, 2.3 `SourceId` `snapshotStore`·stale 기준, 3.3 `ORIGIN_NOT_ALLOWED`·413 경로별 상한·415·422, 4절 `checks.snapshotStore`, 5절 토픽 `aws-snapshots`(행 데이터 없는 예외), 6.1 mock 그룹 `snapshots`(토픽 이름과 다름), 6.3 reset 범위. 기존 엔드포인트의 응답 모양 변경 없음(health `checks`에 키 1개 추가).
- 2026-09-19 (4단계 모듈 연결): 응답 모양 변경 없음. 6.1에 cluster → cost mock 관계 추가. 서버 내부 확장점 정식화(`MockScenarioTarget`의 선택 필드 `options`·`defaultScenario`·`fastTimers`·`setFastTimers`, 개요 요약 제공자 `OverviewSummaryProvider` — `GET /api/overview`의 `cost`·`advisor` 블록, `cluster-status.md` 2.1)는 API 모양에 영향을 주지 않는다.
- 2026-09-19 (k8s-snapshot 계약, backend 4단계): 적용 문서에 `k8s-snapshot.md`. 0 요약 "쓰기" 행, 1.2 `DELETE`·파일 쓰기 보호 대상에 k8s 추가, 1.4 k8s 예외(파일 보기 원문, 드리프트의 레이블·어노테이션·spec 잎 값 — env·command/args·비밀값은 가림), 2.3 `SourceId` `k8sSnapshotStore`, 3.3 `K8S_DRIFT_UNAVAILABLE`·413 k8s 경로 상한, 4절 `checks.k8sSnapshotStore`, 5절 토픽 `k8s-snapshots`·`snapshot-menu`(이벤트·순서·봉투 topic 값), 6.1 mock 그룹 `k8s-snapshots`와 cluster → k8s-snapshots 관계, 6.3 reset 범위. 기존 엔드포인트·토픽 응답 모양 변경 없음(health `checks`에 키 1개 추가).
- 2026-09-20 (snapshot-3d 1단계 구현, backend 5단계): 응답 모양 변경 없음. 새 라우트 `GET /api/k8s-snapshots/:id/graph` 구현, mock 그룹 `k8s-snapshots`에 시나리오 `large` 추가(위 표), api 환경 변수 4개 추가(`K8S_GRAPH_CACHE_SIZE`·`K8S_GRAPH_GROUP_THRESHOLD`·`K8S_GRAPH_MAX_BLOCKS`·`K8S_GRAPH_MAX_EDGES`). 기존 엔드포인트·SSE·출처·health `checks` 불변(테스트로 확인).
- 2026-09-20 (snapshot-3d 1단계 계약, backend 4단계): 적용 문서에 `snapshot-3d.md` 추가. 6.1 mock 그룹 `k8s-snapshots`에 시나리오 `large` 1개 추가(기존 시나리오·기본값 불변). **1.4 예외를 늘리지 않는다** — 3D 구성 그래프 응답(`GET /api/k8s-snapshots/:id/graph`)에는 env·command/args·어노테이션·레이블·셀렉터 원문·ConfigMap/Secret 내용·이미지 문자열이 없다(관계는 근거 코드·문구로만). 새 엔드포인트 1개 외에 기존 응답·SSE 토픽·이벤트·출처(`SourceId`)·health `checks` 변경 없음.
- 2026-09-19 (k8s-snapshot 구현, backend 5단계): 1.4 보강 — 검증 실패 `details.fields[].value`는 필드 이름이 `content`·`label`·`memo`·**`path`**이면 넣지 않는다(서버 공통 `api-error.ts`, 모든 엔드포인트. 현재 `path` 필드는 k8s 파일 쿼리뿐). 토픽 `k8s-snapshots`·`snapshot-menu`는 스트림이 받는다(`?topics=overview,snapshot-menu` 연결 확인). 그 밖 모양 변경 없음.
