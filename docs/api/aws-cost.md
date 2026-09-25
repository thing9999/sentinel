# API 계약: aws-cost

- 작성: backend, 2026-09-19 (3단계 계약. 구현 전)
- 공통 규약: `docs/api/common.md` (특히 1.7 금액 `kind`·`asOf`, 2절 상태, 5절 SSE, 6절 mock 시나리오)
- 명세: `docs/specs/aws-cost.md` / 디자인: `docs/design/aws-cost.md`, `status.md` 3·4.9절 / DBA: `docs/db/schema.md` 2.1~2.5, `apps/api/src/database/settings-defaults.ts`
- 모든 금액·배분·예산·급증 판단은 **서버가 계산**한다. 화면은 금액을 더하거나 계산하지 않는다.
- 대상 환경은 **kOps 클러스터**다. 컨트롤 플레인은 AWS 관리형이 아니라 **사용자 소유 EC2**이므로 "컨트롤 플레인 관리 요금"이라는 항목이 존재하지 않는다. 대신 마스터 EC2·etcd 볼륨·API 서버 LB **실비**가 잡힌다(`docs/specs/kops-support.md` 3.5).
- AWS 호출은 `CLAUDE.md` 읽기 전용 권한만: `pricing:GetProducts`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeSpotPriceHistory`, `elasticloadbalancing:Describe*`. mock 모드는 **AWS 호출 0회**. mock의 노드·파드·PVC·LB는 cluster mock 인벤토리와 같다(`common.md` 6.1 "그룹 사이의 관계").
  - **`eks:*`는 목록에 없다**(kOps에는 AWS 쪽 클러스터 객체가 없다. 클러스터 버전은 쿠버네티스 API 서버에서 읽는다). **`autoscaling:*`도 없다**(노드그룹은 노드 라벨로만 파악한다, 명세 D2). **`route53:*`·`s3:*`도 없다**(3.8 제외 항목).
  - **이번 kOps 전환으로 AWS 호출이 늘지 않는다.** `controlPlane` 카테고리는 이미 받아오는 EC2·EBS·ELB 목록을 **다시 분류**하는 것뿐이다(AC-KOPS32). `eks:DescribeCluster`가 빠지므로 5분마다 **1회 줄어든다**.

## 0. 화면 ↔ 엔드포인트

| 화면 영역 (`docs/design/aws-cost.md`) | REST | SSE (`cost` 토픽) |
|---|---|---|
| CostStatusBanner, KPI 타일 5개, 개요 비용 카드 | `GET /api/cost/summary` | `cost.snapshot`, `cost.status.updated` |
| 소모율 추이 차트 (a) | `GET /api/cost/rate-series?range=` | `cost.rate.sampled` |
| 카테고리 구성 (b), 리소스 내역 (d), 경고 칩 | `GET /api/cost/estimate` | `cost.estimate.updated` |
| 급증 원인 (c), 예산·급증 상세 | `GET /api/cost/status` | `cost.status.updated` |
| 네임스페이스별 추정 비용 | `GET /api/cost/allocation` | `cost.estimate.updated` |
| 확정 비용 섹션 (누적·예측 차트, 일별, 서비스별) | `GET /api/cost/actual` | `cost.actual.updated` |
| CE 새로고침 버튼·Dialog·데이터 출처 정보 | `GET /api/cost/explorer/refresh`, `POST /api/cost/explorer/refresh` | `cost.refresh.updated` |
| (설정) 예산·급증 기준·CE 설정 | `GET /api/cost/settings`, `PATCH /api/cost/settings` | `cost.status.updated` |

**출처 ↔ 데이터** (`common.md` 2.3)

| 출처 | 데이터 | 주기 | stale 기준 |
|---|---|---|---|
| `awsResources` | EC2 인스턴스, EBS 볼륨, 로드밸런서 | 5분 + 쿠버네티스 노드·PVC·서비스 변경 시 즉시(10초 debounce) | 15분 |
| `pricing` | 공시 단가 (Pricing API) | 24시간 캐시, 처음 보는 타입은 즉시 | 72시간 |
| `spotPrice` | 스팟 시세 | 1시간 캐시 (타입·AZ별) | 3시간 |
| `costExplorer` | 확정·예측 | 6시간 캐시 (자체 DB 영속) | 18시간 |
| `kube` | 노드·파드 requests·PVC·서비스·인그레스 (배분·식별) | watch | 45초 |

---

## 1. 공통 타입

```ts
type MoneyKind = 'estimated' | 'actual' | 'forecast';
interface Money { amountUsd: number; kind: MoneyKind; asOf: string }

type CostCategory = 'ec2' | 'ebs' | 'lb' | 'ipv4' | 'controlPlane';
// 화면 순서(고정): EC2 노드 → EBS → 로드밸런서 → 퍼블릭 IPv4 → 컨트롤 플레인
// 서버는 `categories[]`를 항상 이 순서로 내려보낸다. 화면은 다시 정렬하지 않는다.

// `controlPlane` 내역의 하위 종류 (리소스 종류가 아니라 '역할' 축이다)
type ControlPlaneCostKind =
  | 'master_ec2'        // 마스터 노드의 EC2 인스턴스
  | 'etcd_ebs'          // 마스터에 붙은 etcd 볼륨 (main/events. 마스터당 2개, kOps 기본 gp3 20GB)
  | 'master_root_ebs'   // 마스터 인스턴스의 루트 볼륨
  | 'api_lb'            // API 서버 앞단 로드밸런서 (기본 NLB). 식별은 추정 — 3.1 참고
  | 'master_ipv4';      // 마스터에 붙은 퍼블릭 IPv4

interface Unavailable { code: string; message: string }       // 영역을 계산할 수 없을 때 사유
```

- **금액 `kind`·`asOf` 규칙**(`common.md` 1.7): 단독 금액은 `Money`. 표·목록은 섹션 객체에 `kind`·`asOf`가 있고 행의 숫자(`usdPerHour` 등)는 그것을 상속한다.
- 금액 필드 이름: `usdPerHour`(시간당), `usdPerDay`(= ×24), `usdPerMonth`(= ×730, 명세 가정 C9), 누적·총액은 `amountUsd`/`...Usd`.
- 단가: `usdPerHour`(인스턴스·LB·IPv4), `usdPerGbMonth`(EBS 용량), `usdPerIopsMonth`, `usdPerMibpsMonth`(gp3/io 추가 성능). **컨트롤 플레인 전용 단가는 없다** — 마스터 EC2는 인스턴스 단가, etcd·루트 볼륨은 EBS 단가, API LB는 LB 단가를 그대로 쓴다.
- `ec2`·`ebs`·`lb`·`ipv4` 카테고리는 이제 **워커·워크로드용으로 순수하다**(마스터 관련 리소스가 `controlPlane`으로 빠지므로). 같은 리소스가 두 카테고리에 **중복으로 잡히지 않는다**(AC-KOPS29): 카테고리 합계 = `total`.

---

## 2. 요약

### 2.1 `GET /api/cost/summary`

KPI 타일 5개와 배너, 개요 비용 카드, 사이드바 비용 상태.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "status": {
    "status": "warning",
    "reasons": [
      { "code": "BUDGET_FORECAST_OVER_WARN", "text": "예산: 월말 예측 $845 (예산 $800의 106%)", "status": "warning" },
      { "code": "SPIKE_RATE_WARNING", "text": "급증(추정): +77% (+$0.48/h) vs 7일 중앙값 $0.62/h", "status": "warning" }
    ],
    "updatedAt": "2026-09-19T05:05:00.000Z",
    "statusChangedAt": "2026-09-19T05:05:00.000Z",
    "stale": false
  },
  "rate": {
    "available": true,
    "unavailable": null,
    "hourly":  { "amountUsd": 1.104532, "kind": "estimated", "asOf": "2026-09-19T05:05:00.000Z" },
    "daily":   { "amountUsd": 26.508768, "kind": "estimated", "asOf": "2026-09-19T05:05:00.000Z" },
    "monthly": { "amountUsd": 806.30836, "kind": "estimated", "asOf": "2026-09-19T05:05:00.000Z" },
    "warnings": {
      "unpricedCount": 2,
      "spotFallbackCount": 1,
      "outOfClusterCount": 4,
      "priceCacheUsed": false
    }
  },
  "monthToDate": {
    "available": true,
    "unavailable": null,
    "amount": { "amountUsd": 512.33, "kind": "actual", "asOf": "2026-09-19T01:00:00.000Z" },
    "settledThrough": "2026-09-17",
    "lastMonthSamePeriod": { "amountUsd": 470.12, "kind": "actual", "asOf": "2026-09-19T01:00:00.000Z" },
    "changePct": 9.0,
    "scope": "account",
    "metric": "UnblendedCost"
  },
  "monthEnd": {
    "forecast": {
      "available": true,
      "unavailable": null,
      "amount": { "amountUsd": 845.2, "kind": "forecast", "asOf": "2026-09-19T01:00:00.000Z" },
      "low":  { "amountUsd": 790.4, "kind": "forecast", "asOf": "2026-09-19T01:00:00.000Z" },
      "high": { "amountUsd": 900.1, "kind": "forecast", "asOf": "2026-09-19T01:00:00.000Z" },
      "confidencePct": 80
    },
    "estimated": {
      "amount": { "amountUsd": 830.4, "kind": "estimated", "asOf": "2026-09-19T05:05:00.000Z" },
      "method": "actual_plus_rate",
      "formula": "확정 누적 $512.33 + 추정 $1.10/h × 남은 290시간"
    }
  },
  "budget": {
    "configured": true,
    "status": { "status": "warning", "reasons": [ { "code": "BUDGET_FORECAST_OVER_WARN", "text": "월말 예측 $845 (예산 $800의 106%)", "status": "warning" } ], "updatedAt": "2026-09-19T01:00:00.000Z", "statusChangedAt": "2026-09-19T01:00:00.000Z", "stale": false },
    "budgetUsd": 800,
    "monthToDatePct": 64.0,
    "projectedPct": 105.7,
    "projectedBasis": "aws_forecast",
    "monthElapsedPct": 60.4,
    "daysElapsed": 18.13,
    "daysInMonth": 30,
    "warnPct": 90,
    "overPct": 100
  },
  "spike": {
    "status": { "status": "warning", "reasons": [ { "code": "SPIKE_RATE_WARNING", "text": "+77% (+$0.48/h) vs 7일 중앙값 $0.62/h", "status": "warning" } ], "updatedAt": "2026-09-19T05:05:00.000Z", "statusChangedAt": "2026-09-19T05:05:00.000Z", "stale": false },
    "rate":  { "status": "warning", "baselineState": "ready", "collectedHours": 168, "requiredHours": 24, "currentUsdPerHour": 1.104532, "medianUsdPerHour": 0.62, "deltaUsdPerHour": 0.484532, "deltaPct": 78.1 },
    "daily": { "status": "ok", "available": true, "date": "2026-09-17", "usd": 31.2, "baselineAvgUsd": 22.1, "deltaUsd": 9.1, "deltaPct": 41.2 }
  }
}
```

| 필드 | 설명 |
|---|---|
| `status` | 비용 전체 상태 = 예산 상태와 급증(A·B) 중 최악(명세 3.7). 출처 실패는 해당 영역만 unknown. 배너는 `ok`일 때 숨김(화면) |
| `rate` | 타일 1. `monthly` = 시간당 × 730. `warnings`는 경고 칩(단가 없음 N개, 스팟 시세 실패 N대, 클러스터 외 N개, 단가 캐시 사용) |
| `monthToDate` | 타일 2. `settledThrough`: "9월 17일까지 반영"(UTC 날짜). `scope`: `account`(계정 전체) \| `tag_filter`(비용 할당 태그 필터 설정 시) |
| `monthEnd.forecast` | 타일 3. AWS 예측 월말 총액 = 확정 누적 + 남은 기간 예측(서버가 합침). 80% 구간 |
| `monthEnd.estimated` | "추정 월말". `method`: `actual_plus_rate`(확정 누적 + 소모율 × 남은 시간) \| `elapsed_rate`(CE 없음: 이번 달 경과 시간 × 소모율 + 남은 시간 × 소모율 = 월 전체 시간 × 소모율). 항상 `kind: estimated`. **`null`일 수 있다**: 실시간 추정이 없을 때(`rate.available: false`와 같은 조건 — AWS 미설정 `AWS_NOT_CONFIGURED`, 최초 조회 중 `SOURCE_SYNCING`, 리소스 조회·단가 조회가 실패했고 이전 추정도 없음). 확정 비용(CE)이 없는 것만으로는 null이 아니다(`elapsed_rate`). `/api/cost/estimate`의 `monthEnd`도 같은 규칙 |
| `budget` | 타일 4. `configured: false`면 나머지 필드 null이고 화면은 타일을 렌더링하지 않음(명세 C6). `projectedBasis`: `aws_forecast` \| `estimated_month_end`(이때 판단 이유에 "(추정 기준)") |
| `spike.rate` | 타일 5 줄1. `baselineState`: `collecting`(기록 24시간 미만 → 판단 안 함. 등급은 `ok` + reason `SPIKE_BASELINE_COLLECTING`, 8절) \| `ready`. `collectedHours`는 **`baselineFrom` 이후** 표본만 센다(아래) |
| `spike.daily` | 타일 5 줄2. CE 없으면 `available: false`, `status: unknown` |

- `budget.status.status`가 `critical`이면 화면 문구 "초과", `spike.*.status`가 `critical`이면 "급증"(디자인 `status.md` 1.2).
- 오류: 없음(항상 200). AWS 자격 증명 없음(live): `rate.available: false`, `rate.unavailable: { "code": "AWS_NOT_CONFIGURED", "message": "AWS 자격 증명 없음" }`, 금액 필드 null, `monthToDate`·`forecast`도 같은 사유, 상태 unknown.

---

## 3. 실시간 추정

### 3.1 `GET /api/cost/estimate`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "available": true,
  "unavailable": null,
  "kind": "estimated",
  "asOf": "2026-09-19T05:05:00.000Z",
  "resourcesFetchedAt": "2026-09-19T05:05:00.000Z",
  "intervalSec": 300,
  "total": { "usdPerHour": 1.104532, "usdPerDay": 26.508768, "usdPerMonth": 806.30836 },
  "categories": [
    { "category": "ec2",  "label": "EC2 노드",     "count": 6, "usdPerHour": 0.686721, "usdPerMonth": 501.306, "sharePct": 62.2, "unpricedCount": 1 },
    { "category": "ebs",  "label": "EBS",          "count": 9, "usdPerHour": 0.124932, "usdPerMonth": 91.200,  "sharePct": 11.3, "unpricedCount": 0 },
    { "category": "lb",   "label": "로드밸런서",    "count": 2, "usdPerHour": 0.0504,   "usdPerMonth": 36.792,  "sharePct": 4.6,  "unpricedCount": 1 },
    { "category": "ipv4", "label": "퍼블릭 IPv4",   "count": 2, "usdPerHour": 0.01,     "usdPerMonth": 7.300,   "sharePct": 0.9,  "unpricedCount": 0 },
    { "category": "controlPlane", "label": "컨트롤 플레인", "count": 16, "usdPerHour": 0.232479, "usdPerMonth": 169.710, "sharePct": 21.0, "unpricedCount": 0,
      "byKind": [
        { "kind": "master_ec2",      "label": "마스터 EC2",        "count": 3, "usdPerHour": 0.156,    "usdPerMonth": 113.880 },
        { "kind": "etcd_ebs",        "label": "etcd 볼륨",         "count": 6, "usdPerHour": 0.014992, "usdPerMonth": 10.944 },
        { "kind": "master_root_ebs", "label": "마스터 루트 볼륨",   "count": 3, "usdPerHour": 0.023987, "usdPerMonth": 17.511 },
        { "kind": "api_lb",          "label": "API 서버 LB",       "count": 1, "usdPerHour": 0.0225,   "usdPerMonth": 16.425, "estimated": true },
        { "kind": "master_ipv4",     "label": "마스터 퍼블릭 IPv4", "count": 3, "usdPerHour": 0.015,    "usdPerMonth": 10.950 }
      ],
      "apiLb": { "state": "assumed", "candidateCount": 1, "text": "API 서버 LB로 추정 (1개)" },
      "notes": [ { "code": "API_LB_ASSUMED", "text": "API 서버 LB로 추정 (1개)" } ] }
  ],
  "resources": {
    "ec2": [
      {
        "key": "node:ip-10-0-12-34.ap-northeast-2.compute.internal",
        "nodeName": "ip-10-0-12-34.ap-northeast-2.compute.internal",
        "instanceId": "i-0a1b2c3d4e5f67890",
        "nodeGroup": "nodes-ap-northeast-2a",
        "instanceType": "m6i.large",
        "capacityType": "on_demand",
        "zone": "ap-northeast-2a",
        "architecture": "amd64",
        "priced": true,
        "unitPrice": { "usdPerHour": 0.096, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z", "zone": null },
        "spotFallback": false,
        "usdPerHour": 0.096,
        "usdPerMonth": 70.08,
        "notes": []
      },
      {
        "key": "node:ip-10-0-40-7.ap-northeast-2.compute.internal",
        "nodeName": "ip-10-0-40-7.ap-northeast-2.compute.internal",
        "instanceId": "i-0f9e8d7c6b5a43210",
        "nodeGroup": "spot-batch",
        "instanceType": "m6i.large",
        "capacityType": "spot",
        "zone": "ap-northeast-2c",
        "architecture": "amd64",
        "priced": true,
        "unitPrice": { "usdPerHour": 0.0342, "source": "spot_price_history", "asOf": "2026-09-19T04:00:00.000Z", "zone": "ap-northeast-2c" },
        "spotFallback": false,
        "usdPerHour": 0.0342,
        "usdPerMonth": 24.966,
        "notes": []
      },
      {
        "key": "node:ip-10-0-41-9.ap-northeast-2.compute.internal",
        "nodeName": "ip-10-0-41-9.ap-northeast-2.compute.internal",
        "instanceId": "i-01234abcd5678ef90",
        "nodeGroup": "spot-batch",
        "instanceType": "c7i.xlarge",
        "capacityType": "spot",
        "zone": "ap-northeast-2a",
        "architecture": "amd64",
        "priced": true,
        "unitPrice": { "usdPerHour": 0.2072, "source": "on_demand_fallback", "asOf": "2026-09-18T18:00:00.000Z", "zone": null },
        "spotFallback": true,
        "usdPerHour": 0.2072,
        "usdPerMonth": 151.256,
        "notes": [ { "code": "SPOT_PRICE_FALLBACK", "text": "스팟 시세 조회 실패 (온디맨드 기준 상한)" } ]
      },
      {
        "key": "node:ip-10-0-50-2.ap-northeast-2.compute.internal",
        "nodeName": "ip-10-0-50-2.ap-northeast-2.compute.internal",
        "instanceId": "i-0aa11bb22cc33dd44",
        "nodeGroup": "gpu-nodes",
        "instanceType": "g6e.xlarge",
        "capacityType": "on_demand",
        "zone": "ap-northeast-2a",
        "architecture": "amd64",
        "priced": false,
        "unitPrice": null,
        "spotFallback": false,
        "usdPerHour": null,
        "usdPerMonth": null,
        "notes": [ { "code": "UNPRICED", "text": "단가 없음 · 합계 제외" } ]
      }
    ],
    "ebs": [
      {
        "key": "vol:vol-0123456789abcdef0",
        "volumeId": "vol-0123456789abcdef0",
        "volumeType": "gp2",
        "sizeBytes": 53687091200,
        "iops": 150,
        "throughputMibps": null,
        "attachment": { "type": "pvc", "namespace": "data", "name": "data-postgres-0", "nodeName": "ip-10-0-12-35.ap-northeast-2.compute.internal" },
        "priced": true,
        "unitPrice": { "usdPerGbMonth": 0.114, "usdPerIopsMonth": null, "usdPerMibpsMonth": null, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.007808,
        "usdPerMonth": 5.7,
        "notes": []
      }
    ],
    "lb": [
      {
        "key": "lb:k8s-prod-api-3f2a1b",
        "name": "k8s-prod-api-3f2a1b",
        "lbType": "alb",
        "attachedTo": [ { "kind": "Ingress", "namespace": "prod", "name": "api" } ],
        "healthyTargets": 3,
        "priced": true,
        "unitPrice": { "usdPerHour": 0.0252, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.0252,
        "usdPerMonth": 18.396,
        "notes": []
      }
    ],
    "ipv4": [
      {
        "key": "ipv4:ip-10-0-12-34.ap-northeast-2.compute.internal",
        "nodeName": "ip-10-0-12-34.ap-northeast-2.compute.internal",
        "count": 1,
        "priced": true,
        "unitPrice": { "usdPerHour": 0.005, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.005,
        "usdPerMonth": 3.65,
        "notes": []
      }
    ],
    "controlPlane": [
      {
        "key": "cp:node:i-0a1b2c3d4e5f67890",
        "kind": "master_ec2",
        "nodeName": "i-0a1b2c3d4e5f67890",
        "instanceId": "i-0a1b2c3d4e5f67890",
        "nodeGroup": "control-plane-ap-northeast-2a",
        "instanceType": "t3.medium",
        "capacityType": "on_demand",
        "zone": "ap-northeast-2a",
        "architecture": "amd64",
        "priced": true,
        "unitPrice": { "usdPerHour": 0.052, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z", "zone": null },
        "spotFallback": false,
        "usdPerHour": 0.052,
        "usdPerMonth": 37.96,
        "notes": []
      },
      {
        "key": "cp:vol:vol-0e1d2c3b4a5968770",
        "kind": "etcd_ebs",
        "volumeId": "vol-0e1d2c3b4a5968770",
        "volumeType": "gp3",
        "sizeBytes": 21474836480,
        "iops": 3000,
        "throughputMibps": 125,
        "etcdCluster": "main",
        "nodeName": "i-0a1b2c3d4e5f67890",
        "priced": true,
        "unitPrice": { "usdPerGbMonth": 0.0912, "usdPerIopsMonth": null, "usdPerMibpsMonth": null, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.002499,
        "usdPerMonth": 1.824,
        "notes": []
      },
      {
        "key": "cp:lb:a1b2c3d4e5f6789012345678",
        "kind": "api_lb",
        "name": "a1b2c3d4e5f6789012345678",
        "lbType": "nlb",
        "attachedTo": [],
        "healthyTargets": 3,
        "identification": { "confidence": "assumed", "matchedBy": ["cluster_tag", "no_service_or_ingress_ownership"], "candidateCount": 1 },
        "priced": true,
        "unitPrice": { "usdPerHour": 0.0225, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.0225,
        "usdPerMonth": 16.425,
        "notes": [ { "code": "API_LB_ASSUMED", "text": "API 서버 LB로 추정" } ]
      },
      {
        "key": "cp:ipv4:i-0a1b2c3d4e5f67890",
        "kind": "master_ipv4",
        "nodeName": "i-0a1b2c3d4e5f67890",
        "count": 1,
        "priced": true,
        "unitPrice": { "usdPerHour": 0.005, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.005,
        "usdPerMonth": 3.65,
        "notes": []
      }
    ]
  },
  "pricing": {
    "source": "pricing_api",
    "fetchedAt": "2026-09-18T18:00:00.000Z",
    "nextRefreshAt": "2026-09-19T18:00:00.000Z",
    "cacheUsed": false,
    "cacheFetchedAt": null
  },
  "spotPrice": { "fetchedAt": "2026-09-19T04:00:00.000Z", "cacheTtlSec": 3600, "fallbackCount": 1 },
  "unpricedCount": 2,
  "outOfCluster": { "count": 4, "byCategory": { "ec2": 1, "ebs": 2, "lb": 1 } },
  "hoursPerMonth": 730,
  "monthEnd": { "...": "summary.monthEnd.estimated와 같음 (null 가능)" },
  "stale": false
}
```

| 필드 | 설명 |
|---|---|
| `total` | 단가 있는 리소스만 합한 값. `unpricedCount > 0`이면 화면은 합계 옆 "일부 리소스 제외 (N개)" |
| `categories[].sharePct` | 합계 대비. 합 100(반올림 오차 가능, 화면이 맞추지 않음) |
| `resources.ec2[].unitPrice.source` | `pricing_api`(온디맨드 공시 단가) \| `spot_price_history`(실제 스팟 시세, `zone`·`asOf`=시세 조회 시각) \| `on_demand_fallback`(스팟 시세 조회 실패 → 온디맨드 상한, `spotFallback: true`) |
| `resources.*.priced` | `false`면 단가 없음: `unitPrice`·`usdPerHour`·`usdPerMonth` null, 합계 제외, `notes`에 `UNPRICED` |
| `resources.ebs[].attachment.type` | `pvc`(PVC `namespace/name`) \| `node_root`(노드 루트 볼륨, `nodeName`) \| `other`(클러스터 노드에 붙었지만 PVC 아님) |
| `resources.ebs[].sizeBytes` | GiB 단위 볼륨 × 1024³ |
| `resources.lb[].lbType` | `alb` \| `nlb` \| `clb`. `attachedTo`가 비면 배분에서 "공용". `healthyTargets`: 어드바이저 R-LBIDLE 근거 |
| `categories[].apiLb` | **`controlPlane` 카테고리에만** 있다. `state`: `assumed`(후보 1개) \| `ambiguous`(2개 이상) \| `not_found`(0개). `candidateCount`는 0·1·N 그대로. `text`는 화면에 그대로 찍는 서버 문장. **후보가 0개여서 `api_lb` 행이 없을 때도 이 객체는 항상 있다** — 화면이 "행이 없다"로 세 경우를 구분하지 않아도 되게 한다(AC-KOPS30, 디자이너 요청 5) |
| `categories[].byKind` | **`controlPlane` 카테고리에만** 있는 하위 종류 분해(`ControlPlaneCostKind` 순서 고정: `master_ec2` → `etcd_ebs` → `master_root_ebs` → `api_lb` → `master_ipv4`). 다른 카테고리에는 이 필드가 없다. 합계는 카테고리 `usdPerHour`와 같다 |
| `resources.controlPlane[]` | 하나의 배열에 **여러 종류가 섞여 있고** 각 행의 `kind`로 구분한다. 행 모양은 `kind`에 따라 `ec2`·`ebs`·`lb`·`ipv4` 행과 같고 `kind`·`nodeName` 등이 더 붙는다. 마스터 EC2·마스터 EBS·마스터 퍼블릭 IPv4는 `resources.ec2`·`ebs`·`ipv4`에 **중복으로 들어가지 않는다**(AC-KOPS29) |
| `resources.controlPlane[].etcdCluster` | `main` \| `events` \| `null`. 마스터에 붙어 있고 PVC도 루트 볼륨도 아닌 EBS를 etcd 볼륨으로 본다(kOps는 마스터당 2개, 기본 gp3 20GB). **어느 쪽인지 확실히 알 수 없으면 `null`**이고 화면은 "etcd 볼륨"으로만 적는다 — 볼륨 태그의 etcd 클러스터 이름 규칙은 아직 확인하지 못했다(**확인 필요**) |
| `resources.controlPlane[].identification` | `api_lb` 행에만 있다. `confidence`: `assumed`(아래 후보 규칙으로 추정) \| `ambiguous`(후보 2개 이상). **`confirmed`는 아직 쓰지 않는다** — kOps NLB의 확정 이름·태그 규칙을 실클러스터에서 확인하지 못했다 |
| ~~`resources.eks[]`~~, ~~`supportTier`~~ | **삭제**(AC-KOPS08). kOps에는 컨트롤 플레인 관리 요금도 지원 등급 단가도 없다. `eks:DescribeCluster`를 호출하지 않는다. 클러스터 버전은 쿠버네티스 API 서버 버전(`cluster-status` `cluster.version`)만 쓴다 |
| `stale` | 리소스 조회(`awsResources`) 출처가 stale이면 `true`(마지막 추정을 그대로 보여 줌). mock은 항상 `false` |
| `pricing.cacheUsed` | Pricing API 실패 시 만료된 캐시 단가 사용 → 화면 "단가 캐시 사용 (날짜)" 칩 |
| `outOfCluster` | 태그·쿠버네티스 대조로 식별되지 않아 합계에 넣지 않은 리소스 수(명세 C8, 참고용) |

- 행의 `usdPerHour`·`usdPerMonth`는 섹션 `kind: "estimated"`, `asOf`를 상속. `unitPrice.asOf`는 단가 조회 시각(별도).
- 리소스 ↔ 클러스터 식별(명세 C8):
  - EC2: 노드 `spec.providerID`(`aws:///<az>/<instance-id>`) ↔ `DescribeInstances`. 구매 옵션은 `InstanceLifecycle`(spot) 우선, 없으면 노드 레이블.
  - EBS: **EBS CSI 드라이버가 붙이는 볼륨 태그**(`kubernetes.io/created-for/pvc/namespace`, `kubernetes.io/created-for/pvc/name`, `ebs.csi.aws.com/cluster`) ↔ PVC, 노드 루트 볼륨은 인스턴스의 블록 디바이스 매핑.
  - LB: 서비스 `status.loadBalancer.ingress[].hostname`·인그레스 status ↔ ELB `DNSName`, 보조로 태그 `service.k8s.aws/stack`, `ingress.k8s.aws/stack`, `kubernetes.io/service-name`.
  - 클러스터 소속 판별(EC2·EBS·LB 공통): 태그 `kubernetes.io/cluster/<K8S_CLUSTER_NAME>`. kOps도 자기가 만든 리소스에 이 태그를 붙이므로 **그대로 쓴다**(AC-KOPS05).
  - 노드그룹 귀속: EC2 태그 **`kops.k8s.io/instancegroup`** 하나만 본다(kOps InstanceGroup 이름). `eks:nodegroup-name`·`karpenter.sh/*` 태그는 **보지 않는다**(AC-KOPS04).
  - 충돌: 명세 C8은 "PV의 볼륨 ID"로 대조한다고 했으나 RBAC 목록에 `persistentvolumes`가 없다. → 선택: **RBAC를 늘리지 않고 EBS CSI 볼륨 태그로 대조**한다. 태그가 없는 오래된 in-tree 볼륨은 "클러스터 외"로 분류될 수 있다(한계로 보고서에 기록).

**컨트롤 플레인 분류 규칙** (새 AWS 호출 없음. 이미 받은 목록을 다시 나누는 것뿐이다)

| 하위 종류 | 판별 |
|---|---|
| `master_ec2` | 쿠버네티스 노드 중 `role: 'control_plane'`(`cluster-status.md` 1.1)의 `spec.providerID` → EC2 인스턴스. **EC2 태그가 아니라 노드 라벨에서 출발**한다(역할 태그 접두어 상수의 실제 문자열을 확인하지 못했으므로 태그에 의존하지 않는다) |
| `etcd_ebs` | 마스터 인스턴스에 붙어 있고 **PVC도 루트 볼륨도 아닌** EBS |
| `master_root_ebs` | 마스터 인스턴스의 루트 볼륨(블록 디바이스 매핑) |
| `api_lb` | 아래 후보 규칙 |
| `master_ipv4` | 마스터 인스턴스에 붙은 퍼블릭 IPv4 주소 수 |

**API 서버 LB 식별 — 후보 규칙 (추정. 확정 아님)**

> **확인 필요 (명세 U2).** kOps가 만드는 API 서버 **NLB의 정확한 이름·`Name` 태그 규칙을 아직 확인하지 못했다.** (CLB 시절 이름 `api-<하이픈 클러스터 이름>-<suffix>`만 확인됐다.) **U2는 틀리면 금액이 조용히 틀리는 항목**이라 실클러스터 확인 우선순위가 가장 높다. 확인 전까지 서버는 아래 **후보 규칙**만 쓰고 결과에 **반드시 "추정" 표시**를 붙인다. 확정 규칙이 나오면 이 절과 `identification.confidence`에 `confirmed`를 추가한다.

후보 규칙: 다음을 **모두** 만족하는 로드밸런서를 `api_lb` 후보로 본다.
1. `kubernetes.io/cluster/<K8S_CLUSTER_NAME>` 태그가 있다, **그리고**
2. 어떤 쿠버네티스 Service·Ingress에도 귀속되지 않는다 — 태그 `service.k8s.aws/stack`·`kubernetes.io/service-name`·`ingress.k8s.aws/stack`이 없고, LoadBalancer Service·Ingress의 `status` hostname과도 맞지 않는다.

후보 개수별 동작 (AC-KOPS30)

| 후보 수 | 동작 |
|---|---|
| **1개** | `controlPlane`의 `api_lb` 행으로 넣고 `identification.confidence: "assumed"`. **카테고리 `apiLb.state: "assumed"`**, `notes`에 `API_LB_ASSUMED`("API 서버 LB로 추정"). 화면: neutral 칩 "추정" |
| **2개 이상** | 후보를 **전부** `controlPlane`에 넣고 각 행 `identification.confidence: "ambiguous"`, `candidateCount: N`. **카테고리 `apiLb.state: "ambiguous"`**, `notes`에 `API_LB_AMBIGUOUS`("API 서버 LB 후보 N개 — 확인 필요"). 화면: **warn 칩**. 금액은 합산한다(빼면 총액이 줄어 더 틀린다) |
| **0개** | `api_lb` 행이 **없다**. **카테고리 `apiLb.state: "not_found"`, `candidateCount: 0`**, `notes`에 `API_LB_NOT_FOUND`("API 서버 LB를 찾지 못했습니다 — 내부 LB이거나 LB 없는 구성일 수 있습니다", **정보**). `available`은 `true`이고 **오류가 아니다**. 화면: 내역 안 info 한 줄 |

- `api_lb`로 분류된 LB는 `lb` 카테고리에서 **빠진다**(중복 금지).
- **오류 없음(항상 200).** 계산 불가면 `available: false` + `unavailable`, 금액 null.

| `unavailable.code` | 언제 |
|---|---|
| `AWS_NOT_CONFIGURED` | AWS 자격 증명 없음 |
| `AWS_ACCESS_DENIED` | 읽기 권한 없음 |
| `PRICING_UNAVAILABLE` | 단가 조회 실패 |
| **`CLUSTER_NAME_NOT_CONFIGURED`** | **live 모드인데 `K8S_CLUSTER_NAME`이 비어 있음.** AWS 리소스를 어느 클러스터 것인지 고를 수 없으므로 추정 전체가 `available: false`다. message: `클러스터 이름이 설정되지 않았습니다 (K8S_CLUSTER_NAME)`. 이때도 **클러스터 표시 이름은 kubeconfig 컨텍스트로 채우고**(`cluster-status.md` 2.1), **mock 값을 섞지 않는다**(AC-KOPS33, `common.md` 2.4). mock 모드에서는 발생하지 않는다 |

- 워커 노드가 0대여도 `controlPlane` 카테고리만 있는 정상 응답이다(200). 마스터도 0대면 `categories`가 비고 `total`이 0이다.

#### 3.1.1 화면 도움말 고정 문구 (kOps 전환)

서버가 내려보내는 값이 아니라 **화면이 상수로 가지는 문구**다. 계약에 적어 두는 이유는 프론트·퍼블리싱·디자인이 같은 문장을 쓰게 하기 위해서다(AC-KOPS31·AC-KOPS35).

- 비용 화면 상단 도움말: **"kOps 클러스터에는 EKS 같은 컨트롤 플레인 관리 요금이 없습니다. 대신 마스터 EC2·etcd 볼륨·API 서버 LB 실비가 '컨트롤 플레인' 항목으로 잡힙니다."**
- "이 추정에 포함되지 않는 것" 목록에 **2줄 추가**(기존 NAT 게이트웨이·데이터 전송비·EBS 스냅샷 항목은 그대로):
  - **"Route53 호스팅 존·쿼리 요금"** — `route53:*` 읽기 권한이 없고(권한을 늘리지 않는다), `--dns=none` 구성이면 존이 아예 없어 있다고 가정하면 거짓 금액이 된다.
  - **"kOps state store(S3) 저장·etcd 백업 용량 요금"** — `s3:*` 읽기 권한이 없고, state store 버킷은 여러 클러스터가 공유할 수 있어 이 클러스터 몫을 가르는 규칙이 자의적이다.
- 노드그룹 집계 툴팁: **"목표 대수는 표시하지 않습니다(실제로 붙어 있는 노드만 셉니다)."** — `autoscaling:*` 권한을 추가하지 않기 때문(D2).
- `api_lb` 행 툴팁: **"API 서버 LB로 추정했습니다. 클러스터 태그가 있고 Service·Ingress에 귀속되지 않는 로드밸런서를 기준으로 합니다."**

### 3.2 `GET /api/cost/allocation` (네임스페이스별 배분)

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `hideSystem` | boolean (기본 false) | 시스템 네임스페이스 행 숨김. **숨긴 금액은 `hiddenSystem` 행으로 합쳐 보여 합계가 유지**된다 |
| `sort` | `usdPerHour`·`namespace`·`sharePct` | 기본 `usdPerHour:desc`. 고정 행(미할당·공용)은 정렬과 무관하게 맨 아래 |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "available": true,
  "unavailable": null,
  "kind": "estimated",
  "asOf": "2026-09-19T05:05:00.000Z",
  "rows": [
    {
      "namespace": "batch",
      "isSystem": false,
      "usdPerHour": 0.4528,
      "usdPerMonth": 330.544,
      "sharePct": 41.0,
      "breakdown": { "nodeUsdPerHour": 0.4312, "storageUsdPerHour": 0.0216, "lbUsdPerHour": 0 },
      "warnings": [ { "code": "REQUESTS_MISSING", "text": "requests 미설정 파드 3개", "count": 3 } ]
    }
  ],
  "pinnedRows": [
    { "key": "unallocated",    "label": "미할당(유휴)",   "usdPerHour": 0.3093, "usdPerMonth": 225.789, "sharePct": 28.0, "breakdown": { "nodeUsdPerHour": 0.3093, "storageUsdPerHour": 0, "lbUsdPerHour": 0 } },
    { "key": "shared_cluster", "label": "공용(클러스터)", "usdPerHour": 0.259079, "usdPerMonth": 189.128, "sharePct": 23.5, "breakdown": { "nodeUsdPerHour": 0, "storageUsdPerHour": 0.0166, "lbUsdPerHour": 0, "controlPlaneUsdPerHour": 0.232479, "ipv4UsdPerHour": 0.01 } },
    { "key": "shared",         "label": "공용",           "usdPerHour": 0.0252, "usdPerMonth": 18.396,  "sharePct": 2.3,  "breakdown": { "nodeUsdPerHour": 0, "storageUsdPerHour": 0, "lbUsdPerHour": 0.0252 } }
  ],
  "hiddenSystem": null,
  "total": { "usdPerHour": 1.104532, "usdPerMonth": 806.30836 },
  "unallocatedPct": 28.0,
  "rulesVersion": 1
}
```
- 배분 규칙(명세 3.2 1~7 + kops-support 3.5.6, 화면 "계산 방법"에 노출): 파드 몫 = **워커** 노드 시간당 × (CPU requests 비율 + 메모리 requests 비율) ÷ 2, 나머지 = `unallocated`, PVC 볼륨 → PVC 네임스페이스, LB → 서비스·인그레스 네임스페이스(식별 불가 → `shared`), **컨트롤 플레인 전체(마스터 EC2·etcd/루트 EBS·API 서버 LB·마스터 퍼블릭 IPv4)·워커 루트 볼륨·워커 퍼블릭 IPv4 → `shared_cluster`**, 완료 파드 제외. **단가 없는 노드는 배분 대상에서 빠진다**(합계와 일치 유지).
- **마스터 노드 비용은 파드에 배분되지 않는다**(AC-KOPS15). 마스터 위의 컨트롤 플레인 static pod에도 배분하지 않는다. 마스터 몫은 전부 `shared_cluster` 행이다.
- `breakdown`의 **`eksUsdPerHour`는 `controlPlaneUsdPerHour`로 바뀌었다**(구 이름은 남기지 않는다). 대시보드 자체 DB의 소모율 기록도 `cost_rate_samples.control_plane_usd_per_hour`(구 `eks_usd_per_hour`)를 쓴다 — 마이그레이션은 DBA 담당이고 **기존 행을 보존한다**(급증 판단 7일 기준선, AC-KOPS34).
- `shared_cluster` 행 설명 문구(화면 툴팁): "마스터 EC2·etcd 볼륨·API 서버 LB·노드 루트 볼륨·퍼블릭 IPv4처럼 특정 네임스페이스에 귀속시킬 수 없는 비용".
- `total`은 `/api/cost/estimate`의 `total`과 **같은 값**이다(반올림 오차 $0.01 이내, 명세 수용 기준).
- 값 0인 고정 행은 서버가 뺀다. `hiddenSystem`: `hideSystem=true`일 때 `{ "key": "hidden_system", "label": "시스템 네임스페이스 (숨김)", ... }`.
- `unallocatedPct ≥ 40`이면 화면 R-UNALLOC 칩(어드바이저 사전 점검과 같은 기준, 서버가 `advisor.prechecks.unallocatedPct` 제공 → 필드 `unallocatedWarnPct`로도 준다).
- 오류: 400(쿼리).

### 3.3 `GET /api/cost/rate-series`

| 쿼리 | 형식 |
|---|---|
| `range` | `24h` \| `7d`(기본) \| `30d` \| `90d` |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "kind": "estimated",
  "asOf": "2026-09-19T05:05:00.000Z",
  "range": "7d",
  "stepSec": 300,
  "points": [
    { "t": "2026-09-12T05:10:00.000Z", "usdPerHour": 0.62, "status": "ok" },
    { "t": "2026-09-19T05:05:00.000Z", "usdPerHour": 1.104532, "status": "warning" }
  ],
  "baseline": {
    "state": "ready",
    "collectedHours": 168,
    "requiredHours": 24,
    "baselineFrom": null,
    "medianUsdPerHour": 0.62,
    "warnAtUsdPerHour": 1.12,
    "critAtUsdPerHour": 1.62
  },
  "retentionDays": 90
}
```
- `stepSec`: 24h·7d는 300(원본 5분 표본), 30d는 1800, 90d는 3600(구간 평균으로 서버가 줄임). 결측 구간은 점이 없다(화면이 간격 > 2 × stepSec이면 선을 끊음).
- `baseline.warnAtUsdPerHour` = max(중앙값 × `warnRatio`, 중앙값 + `warnAbsUsdPerHour`), `critAtUsdPerHour` = max(중앙값 × `critRatio`, 중앙값 + `critAbsUsdPerHour`) — 배수와 절대액 조건을 합친 값(디자인 요청). `state: "collecting"`이면 중앙값·임계값 null(화면 "기준 수집 중").
- **`baseline.baselineFrom`** (2026-09-24 신설, 설정 `cost.spike.rate.baselineFrom`, 기본 `null`): 이 시각 **이전 표본을 급증 판단 기준선에서 제외**한다. 응답에는 적용 중인 값을 그대로 돌려준다.
  - `null`이면 **기존 동작 그대로**다(기록 전체에서 `baselineDays`만큼).
  - 값이 있으면 `baseline.collectedHours`는 **`max(baselineFrom, now - baselineDays)` 이후** 표본만 세고, 그 결과 `minBaselineHours`에 못 미치면 `state: "collecting"` + 이유 코드 `SPIKE_BASELINE_COLLECTING`("기준 수집 중")이 된다. **kOps 전환 직후에는 이 상태가 최대 `minBaselineHours`(기본 24시간) 동안 정상적으로 나타난다.**
  - 쓰는 이유: 비용 모델이 바뀌면(예: `eks` → `controlPlane` 재분류) 전환 앞뒤 표본의 성격이 달라 한 기준선에 섞으면 **거짓 급증**이 잡힌다. 그래서 전환 시각을 넣어 앞쪽을 끊는다. **기록 자체는 지우지 않는다**(대시보드 자체 DB `cost_rate_samples`의 기존 행은 보존된다 — AC-KOPS34).
  - `rate-series` 차트의 `points[]`는 **잘라내지 않는다**(전환 이전 구간도 그대로 그린다). 기준선 계산에서만 뺀다. 화면은 `baselineFrom` 위치에 구분선·주석("비용 모델 전환")을 그릴 수 있다.
- 대시보드 자체 DB가 없으면(Docker 없이 실행) 메모리에 쌓인 표본만 준다: `"persistence": "memory"` 필드 추가, 재시작 시 초기화.
- 오류: 400.

---

## 4. 예산·급증 상세

### 4.1 `GET /api/cost/status`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "status": { "...": "summary.status와 같음" },
  "budget": { "...": "summary.budget와 같음" },
  "spike": {
    "status": { "...": "summary.spike.status" },
    "rate": {
      "status": "warning",
      "reasons": [ { "code": "SPIKE_RATE_WARNING", "text": "+77% (+$0.48/h) vs 7일 중앙값 $0.62/h", "status": "warning" } ],
      "baselineState": "ready",
      "collectedHours": 168,
      "requiredHours": 24,
      "baselineFrom": null,
      "currentUsdPerHour": 1.104532,
      "medianUsdPerHour": 0.62,
      "deltaUsdPerHour": 0.484532,
      "deltaPct": 78.1,
      "warnAtUsdPerHour": 1.12,
      "critAtUsdPerHour": 1.62,
      "kind": "estimated",
      "asOf": "2026-09-19T05:05:00.000Z",
      "causes": [
        { "change": "added",   "category": "ec2", "key": "node:ip-10-0-60-1.ap-northeast-2.compute.internal", "text": "EC2 노드 +3대 (m6i.large 온디맨드)", "deltaUsdPerHour": 0.288 },
        { "change": "changed", "category": "ebs", "key": "vol:vol-0fedcba9876543210", "text": "EBS gp3 50 GiB → 200 GiB", "deltaUsdPerHour": 0.0183 },
        { "change": "removed", "category": "lb",  "key": "lb:k8s-old-web-1a2b3c", "text": "로드밸런서 삭제 (ALB)", "deltaUsdPerHour": -0.0252 }
      ],
      "causesBaselineAt": "2026-09-16T03:00:00.000Z"
    },
    "daily": {
      "status": "ok",
      "available": true,
      "unavailable": null,
      "reasons": [],
      "date": "2026-09-17",
      "usd": 31.2,
      "baselineAvgUsd": 22.1,
      "deltaUsd": 9.1,
      "deltaPct": 41.2,
      "kind": "actual",
      "asOf": "2026-09-19T01:00:00.000Z",
      "spikedServices": [
        { "service": "EC2 - Other", "displayName": "EC2 - 기타", "status": "warning", "usd": 12.4, "baselineAvgUsd": 6.1, "deltaUsd": 6.3, "deltaPct": 103.3 }
      ]
    }
  },
  "thresholds": {
    "budget": { "warnPct": 90, "overPct": 100 },
    "rate": { "warnRatio": 1.3, "warnAbsUsdPerHour": 0.5, "critRatio": 2.0, "critAbsUsdPerHour": 1.0, "baselineDays": 7, "minBaselineHours": 24, "baselineFrom": null },
    "daily": { "warnRatio": 1.3, "warnAbsUsd": 5, "critRatio": 2.0, "critAbsUsd": 10, "serviceWarnAbsUsd": 5, "baselineDays": 7 }
  }
}
```
- `causes`: 기준 시점(7일 중앙값에 가장 가까운 소모율 표본의 `resources` 기록, `causesBaselineAt`) 대비 새로 생긴·바뀐·없어진 리소스. `change`: `added` \| `changed` \| `removed`. 최대 10개, `|deltaUsdPerHour|` 큰 순. 급증 주의·급증일 때만 채우고 그 외 `[]`.
- `daily.date`: 완전히 반영된 최근 날(보통 그저께). 비교 기준은 그 전 7일 평균(명세 3.6 B).
- 예산 판단 사유 예: `월말 예측 $845 (예산 $800의 106%)`, `확정 누적 $812 (예산 $800의 102%)`(critical), `월말 추정 ≈ $830 (예산 $800의 104%, 추정 기준)`, 누적이 경과율보다 크게 앞서면(누적% − 경과% ≥ 10) 두 번째 이유 `누적 64%가 이번 달 경과 60%보다 앞섬`.
- 오류: 없음.

---

## 5. 확정 비용 (Cost Explorer)

### 5.1 `GET /api/cost/actual`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "available": true,
  "unavailable": null,
  "kind": "actual",
  "asOf": "2026-09-19T01:00:00.000Z",
  "metric": "UnblendedCost",
  "scope": "account",
  "tagFilter": null,
  "settledThrough": "2026-09-17",
  "delayNotice": "청구 데이터는 최대 24시간 지연",
  "month": { "start": "2026-09-01", "end": "2026-09-30", "daysInMonth": 30 },
  "monthToDate": {
    "amountUsd": 512.33,
    "lastMonthSamePeriodUsd": 470.12,
    "changeUsd": 42.21,
    "changePct": 9.0
  },
  "lastMonthTotalUsd": 781.4,
  "services": {
    "top": [
      { "service": "Amazon Elastic Compute Cloud - Compute", "displayName": "EC2 - 컴퓨트", "mtdUsd": 312.0, "lastMonthSamePeriodUsd": 280.0, "deltaUsd": 32.0, "deltaPct": 11.4, "sharePct": 60.9, "spikeStatus": null },
      { "service": "EC2 - Other", "displayName": "EC2 - 기타", "mtdUsd": 71.2, "lastMonthSamePeriodUsd": 40.3, "deltaUsd": 30.9, "deltaPct": 76.7, "sharePct": 13.9, "spikeStatus": "warning" }
    ],
    "other": { "serviceCount": 14, "mtdUsd": 21.9, "lastMonthSamePeriodUsd": 20.2, "deltaUsd": 1.7, "deltaPct": 8.4, "sharePct": 4.3 },
    "totalUsd": 512.33
  },
  "daily": {
    "days": 30,
    "chartTopServices": ["Amazon Elastic Compute Cloud - Compute", "EC2 - Other", "Amazon Elastic Container Service for Kubernetes", "Amazon Elastic Load Balancing", "Amazon Virtual Private Cloud", "Amazon Simple Storage Service", "AmazonCloudWatch"],
    "items": [
      {
        "date": "2026-09-17",
        "totalUsd": 31.2,
        "unsettled": false,
        "spikeStatus": null,
        "byService": [ { "service": "Amazon Elastic Compute Cloud - Compute", "usd": 18.1 }, { "service": "_other", "usd": 1.2 } ]
      },
      { "date": "2026-09-18", "totalUsd": 14.9, "unsettled": true, "spikeStatus": null, "byService": [] }
    ],
    "baselineAvgUsd": 22.1
  },
  "forecast": {
    "available": true,
    "unavailable": null,
    "kind": "forecast",
    "asOf": "2026-09-19T01:00:00.000Z",
    "period": { "start": "2026-09-19", "end": "2026-09-30" },
    "remainingUsd": 332.87,
    "monthEndUsd": 845.2,
    "lowUsd": 790.4,
    "highUsd": 900.1,
    "confidencePct": 80,
    "cumulative": [
      { "date": "2026-09-19", "usd": 541.1, "lowUsd": 536.0, "highUsd": 547.0 },
      { "date": "2026-09-30", "usd": 845.2, "lowUsd": 790.4, "highUsd": 900.1 }
    ]
  },
  "monthCumulative": [
    { "date": "2026-09-01", "usd": 26.4 },
    { "date": "2026-09-17", "usd": 512.33 }
  ],
  "refresh": { "...": "5.2 응답과 같음" },
  "stale": false,
  "staleReason": null
}
```

| 필드 | 설명 |
|---|---|
| `settledThrough` | 확정 반영 기준일(UTC 날짜). 화면 "9월 17일까지 반영 · 최대 24시간 지연" |
| `scope` / `tagFilter` | `account`(계정 전체, 명세 C4) \| `tag_filter` + `{ key, values }` |
| `services.top` | 이번 달 누적 상위 10. `displayName`은 서버가 매핑(모르는 서비스는 원문). `spikeStatus`: 서비스 일별 급증 `warning`/`critical`/null |
| `services.other` | 나머지 합 ("기타", 맨 아래 고정) |
| `daily.items` | 최근 30일(오래된 → 최근). `unsettled: true`: 오늘·어제 등 아직 채워지는 날(화면 흐리게+빗금). `byService`: `chartTopServices` 7개 + `_other`(나머지 합) — 화면 서비스별 누적 막대용 |
| `daily.items[].spikeStatus` | 그 날이 일별 급증 판단 대상이었고 warning/critical이면 값 |
| `forecast` | `monthEndUsd` = `monthToDate.amountUsd` + `remainingUsd`(서버 합산). `cumulative`: 누적·예측 차트용 누적 곡선(예측 구간 포함) |
| `monthCumulative` | 1일 ~ `settledThrough` 확정 누적 곡선 |
| `stale` / `staleReason` | 항상 있음. 캐시가 만료됐는데 새 조회에 실패해 마지막 성공 값을 보여 주면 `stale: true` + `staleReason`(실패 메시지), 아니면 `false` / `null` |

- 이 섹션의 모든 숫자는 `kind: "actual"`(forecast 블록은 `forecast`)과 `asOf`(CE 조회 시각)를 상속한다.
- **변형**
  - CE 사용 불가(권한 없음·미활성화): `available: false`, `unavailable: { "code": "CE_ACCESS_DENIED", "message": "Cost Explorer 사용 불가: AccessDenied" }` (그 밖의 코드: `CE_NOT_ENABLED`, `CE_THROTTLED`, `AWS_NOT_CONFIGURED`, `CE_ERROR`), 데이터 필드 null, `refresh`는 채움. **실시간 추정 영역은 영향 없음.**
  - AWS 예측 불가(이력 부족, 월말 직전): `forecast.available: false`, `forecast.unavailable: { "code": "CE_FORECAST_UNAVAILABLE", "message": "AWS 예측 불가 (데이터 부족)" }` → 예산 판단은 추정 월말.
  - 호출 한도 도달: 데이터는 캐시 그대로, `refresh.disabledReason: "daily_limit"`, `refresh.limitReached: true`(화면 "호출 한도 도달 · 캐시 표시 중").
  - 캐시가 만료됐는데 새 조회에 실패: 마지막 성공 캐시를 그대로 주고 `stale: true` 필드 + `staleReason`.
- 오류: 없음(항상 200).

### 5.2 `GET /api/cost/explorer/refresh` (새로고침 상태)

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "state": "idle",
  "canRefresh": false,
  "disabledReason": "cooldown",
  "lastFetchedAt": "2026-09-19T01:00:00.000Z",
  "lastCallAt": "2026-09-19T04:32:22.000Z",
  "lastManualAt": "2026-09-19T04:32:22.000Z",
  "nextAvailableAt": "2026-09-19T05:32:22.000Z",
  "nextScheduledAt": "2026-09-19T07:00:00.000Z",
  "cacheTtlSec": 21600,
  "cooldownSec": 3600,
  "todayCalls": 6,
  "dailyLimit": 40,
  "limitReached": false,
  "dayBoundary": "UTC",
  "dailyResetAt": "2026-09-20T00:00:00.000Z",
  "callsPerRefresh": 2,
  "maxCallsPerRefresh": 4,
  "refreshEstimatedCostUsd": 0.04,
  "callCostUsd": 0.01,
  "monthCalls": 120,
  "monthCallCost": { "amountUsd": 1.2, "kind": "estimated", "asOf": "2026-09-19T05:06:00.000Z" },
  "lastError": null
}
```

| 필드 | 설명 |
|---|---|
| `state` | `idle` \| `refreshing` |
| `canRefresh` / `disabledReason` | 버튼 활성 여부. `disabledReason`: `null` \| `cooldown`(마지막 호출 후 1시간) \| `daily_limit` \| `mock` \| `in_progress` \| `not_configured` |
| `nextAvailableAt` | 수동 새로고침이 가능해지는 시각(쿨다운 기준). 한도 도달이면 `dailyResetAt` |
| `nextScheduledAt` | 다음 자동 조회(캐시 만료) 시각 |
| `todayCalls`, `dailyLimit` | 오늘(UTC) 실제 AWS 호출 수(실패 포함, DBA `cost_explorer_call_logs`) / 상한(기본 40) |
| `callsPerRefresh` | 한 번 새로고침에 드는 보통 호출 수(GetCostAndUsage 1페이지 + GetCostForecast 1 = 2) |
| `maxCallsPerRefresh` | 한 번 새로고침의 최대 호출 수 = GetCostAndUsage 최대 페이지(3) + GetCostForecast 1 = 4 |
| `refreshEstimatedCostUsd` | 새로고침 1회 **최대** 예상 비용(USD) = `maxCallsPerRefresh` × `callCostUsd`(기본 $0.04). 수동 새로고침 확인창에 그대로 표시(화면은 계산하지 않음). mock에서도 같은 값 |
| `monthCallCost` | 이번 달 CE 호출 추정 비용(호출 수 × $0.01). `kind: estimated` |
| `lastError` | 마지막 호출 실패 `{ code, message, at }` |

- 쿨다운 기준: **마지막 과금 호출**(성공, 또는 쓰로틀 외 과금되는 실패) 시각 + `cooldownSec`. 권한 없음·미활성화(`AccessDenied`, `OptInRequired`)로 실패한 호출은 과금되지 않으므로 쿨다운을 시작하지 않는다(디자인: CE 사용 불가 시 재시도 활성). 일일 호출 수에는 모두 센다.
- 날짜 경계는 UTC(CE 날짜와 같은 기준). 화면은 `dailyResetAt`을 로컬 시각으로 보인다.
- mock: `canRefresh: false`, `disabledReason: "mock"`, 호출 수 0.

### 5.3 `POST /api/cost/explorer/refresh` (수동 새로고침)

요청 본문 없음(또는 `{}`).

**응답 202** — 조회를 시작함. 결과는 `cost.actual.updated`·`cost.refresh.updated`로 온다.
```json
{ "accepted": true, "refresh": { "...": "5.2 응답 (state: refreshing, canRefresh: false, disabledReason: in_progress)" } }
```

**에러**
| HTTP | code | details | 언제 |
|---|---|---|---|
| 429 | `CE_REFRESH_COOLDOWN` | `{ nextAvailableAt, retryAfterSec, lastCallAt }` + `Retry-After` | 마지막 호출 후 1시간 미만 |
| 429 | `CE_DAILY_LIMIT_REACHED` | `{ todayCalls, dailyLimit, resetsAt, retryAfterSec }` + `Retry-After` | 오늘 호출 수 + `callsPerRefresh` > 상한 |
| 409 | `CE_REFRESH_IN_PROGRESS` | `{ startedAt }` | 이미 조회 중(자동·수동) |
| 409 | `LIVE_MODE_ONLY` | - | mock 모드 (AWS 호출 없음) |
| 503 | `SOURCE_UNAVAILABLE` | `{ source }` | AWS 자격 증명·리전 설정 없음 |

429 예:
```json
{
  "statusCode": 429,
  "code": "CE_DAILY_LIMIT_REACHED",
  "message": "오늘 Cost Explorer 호출 한도에 도달했습니다 (40/40회). 캐시를 사용합니다.",
  "details": { "todayCalls": 40, "dailyLimit": 40, "resetsAt": "2026-09-20T00:00:00.000Z", "retryAfterSec": 68040 },
  "path": "/api/cost/explorer/refresh",
  "timestamp": "2026-09-19T05:06:00.000Z"
}
```
- 탭이 여러 개여도 서버에서 한 번만 호출된다(진행 중이면 409). 브라우저는 AWS를 직접 부르지 않는다.
- CE 호출은 고정 리전 엔드포인트 `us-east-1`로, Pricing API는 `us-east-1`로 한다(클러스터 리전과 무관). 단가 조회 필터의 `regionCode`는 클러스터 리전.

---

## 6. 설정 (대시보드 자체 DB `settings`만)

**클러스터·AWS에 쓰기가 아니다.** 대시보드 자체 DB의 `settings` 테이블(`cost.budget`, `cost.spike`, `cost.explorer`)만 바꾼다.

- 충돌: 명세 `aws-cost` 6절은 "예산을 화면에서 편집"을 범위 밖으로 두었고, DBA `schema.md`도 "설정 편집 UI는 범위 밖"이다. PM 지시는 "예산 등 설정 조회/변경 엔드포인트". → 선택: **API는 제공**하고(운영자가 SQL 대신 쓸 수 있고, 프론트가 나중에 붙일 수 있음) 이번 디자인에는 편집 화면이 없으므로 화면 반영은 PM·디자이너 결정으로 남긴다. 환경 변수가 설정된 값은 바꿀 수 없다(아래).

### 6.1 `GET /api/cost/settings`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:06:00.000Z",
  "persistence": "database",
  "budget": {
    "monthlyBudgetUsd": 800,
    "warnPct": 90,
    "overPct": 100,
    "lockedByEnv": ["monthlyBudgetUsd"]
  },
  "spike": {
    "rate":  { "baselineDays": 7, "minBaselineHours": 24, "baselineFrom": null, "warnRatio": 1.3, "warnAbsUsdPerHour": 0.5, "critRatio": 2.0, "critAbsUsdPerHour": 1.0 },
    "daily": { "baselineDays": 7, "warnRatio": 1.3, "warnAbsUsd": 5, "critRatio": 2.0, "critAbsUsd": 10, "serviceWarnAbsUsd": 5 },
    "lockedByEnv": []
  },
  "explorer": {
    "metric": "UnblendedCost",
    "cacheTtlSec": 21600,
    "manualRefreshCooldownSec": 3600,
    "dailyCallLimit": 40,
    "callCostUsd": 0.01,
    "costAllocationTagFilter": null,
    "lockedByEnv": []
  },
  "estimation": {
    "resourceRefreshSec": 300,
    "rateSampleIntervalSec": 300,
    "pricingCacheTtlSec": 86400,
    "spotPriceCacheTtlSec": 3600,
    "hoursPerMonth": 730,
    "readOnly": true
  },
  "updatedAt": "2026-09-19T00:00:00.000Z"
}
```
- 값 적용 우선순위: 환경 변수(명시된 경우) > `settings` 테이블 > 코드 기본값(DBA `mergeSetting`). `lockedByEnv`: 환경 변수로 고정된 필드 이름(예: `COST_MONTHLY_BUDGET_USD` → `monthlyBudgetUsd`).
- `persistence`: `database` \| `memory`(대시보드 DB 없음. 조회만 가능).
- `estimation`은 조회 전용(주기·캐시는 AWS 호출량에 직결되므로 API로 바꾸지 않는다).

### 6.2 `PATCH /api/cost/settings`

요청(부분 갱신. 보낸 블록만 바뀐다):
```json
{
  "budget": { "monthlyBudgetUsd": 900, "warnPct": 85 },
  "spike": { "rate": { "warnAbsUsdPerHour": 0.75 } },
  "explorer": { "dailyCallLimit": 30, "costAllocationTagFilter": { "key": "kubernetes.io/cluster/prod.k8s.example.com", "values": ["owned"] } }
}
```

검증(DTO + class-validator):
| 필드 | 규칙 |
|---|---|
| `budget.monthlyBudgetUsd` | `null`(예산 숨김) 또는 0 초과 ~ 10,000,000 |
| `budget.warnPct`, `budget.overPct` | 1~1000, `warnPct < overPct` |
| `spike.rate.warnRatio`, `critRatio` | 1.0 초과 ~ 100, `warnRatio < critRatio` |
| `spike.rate.warnAbsUsdPerHour`, `critAbsUsdPerHour` | 0 이상 ~ 1,000, warn ≤ crit |
| `spike.rate.baselineDays` | 1~30 / `minBaselineHours` 1~168 |
| `spike.rate.baselineFrom` | `null` 또는 ISO 8601 UTC 시각. **미래 시각은 400**. 이 시각 **이전** 표본은 소모율 급증 기준선에서 제외한다 |
| `spike.daily.*Ratio`, `*AbsUsd`, `serviceWarnAbsUsd` | 위와 같은 방식 |
| `explorer.metric` | `UnblendedCost` \| `AmortizedCost` |
| `explorer.cacheTtlSec` | 3600 ~ 86400 (**1시간 미만 불가**: 호출 비용 보호) |
| `explorer.manualRefreshCooldownSec` | 3600 ~ 86400 (명세 "1시간 이내 비활성"보다 짧게 못 함) |
| `explorer.dailyCallLimit` | 1 ~ 200 |
| `explorer.costAllocationTagFilter` | `null` 또는 `{ key: 1~128자, values: 1~20개, 각 1~256자 }` |
| `explorer.callCostUsd` | 변경 불가(요청에 있으면 400) |

**응답 200**: 6.1과 같은 전체 설정.
- 변경 후 서버는 예산·급증 상태를 즉시 재계산해 `cost.status.updated`를 보낸다. `metric`·`tagFilter`가 바뀌면 CE 캐시 키가 바뀌므로 **다음 조회부터** 반영되고(자동으로 즉시 호출하지 않음 — 비용 통제), 응답 `explorer`에 `"pendingRefresh": true`가 붙는다.

**에러**
| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 위 규칙 위반 |
| 409 | `SETTING_LOCKED_BY_ENV` | 환경 변수로 고정된 필드를 바꾸려 함. `details.fields: ["monthlyBudgetUsd"]` |
| 503 | `DASHBOARD_DB_UNAVAILABLE` | 대시보드 DB 연결 없음 (메모리 값은 바꾸지 않는다: 재시작 시 사라지는 변경 방지) |

---

## 7. SSE 이벤트 (토픽 `cost`)

봉투·순서·heartbeat는 `common.md` 5절.

| 이벤트 | 언제 | payload |
|---|---|---|
| `cost.snapshot` | 연결 직후, 시나리오 변경 후 | `{ summary, estimate, allocation, actual, status, refresh }` — 각각 해당 REST 응답(`dataSource`·`generatedAt` 제외). 소모율 시계열은 크기 때문에 넣지 않는다(REST `rate-series`) |
| `cost.estimate.updated` | 추정 재계산(5분, 또는 노드·PVC·서비스 변경 후 10초 debounce, 단가·스팟 시세 갱신) | `{ estimate, allocation, summary }` |
| `cost.actual.updated` | CE 조회 완료(자동·수동, 실패 포함) | `{ actual, summary }` |
| `cost.status.updated` | 예산·급증 상태 변경, 설정 변경 | `{ status, summary }` |
| `cost.refresh.updated` | 새로고침 상태 변화(시작·종료·쿨다운 해제·한도 도달·일자 변경) | `{ refresh }` (5.2) |
| `cost.rate.sampled` | 5분 소모율 기록 | `{ point: { t, usdPerHour, status }, baseline: <3.3 baseline> }` — 소모율 차트 끝에 점 추가 |

- 출처 매핑(stale): `awsResources`·`pricing`·`spotPrice` → `estimate`·`allocation`·`summary.rate`·`spike.rate`, `costExplorer` → `actual`·`summary.monthToDate`·`monthEnd.forecast`·`spike.daily`, `kube` → `allocation`.
- 금액 값은 계산할 때마다 조금씩 달라지므로 서버는 **합계가 $0.0001 넘게 바뀌었거나 리소스 구성이 바뀐 경우에만** `cost.estimate.updated`를 보낸다(5분 주기라도 변화 없으면 생략, 단 `asOf` 갱신을 위해 최소 15분에 1번은 보낸다).

## 8. 판단 이유 코드 (`Reason.code`)

| code | 등급 | text 예 |
|---|---|---|
| `BUDGET_OK` | ok | (이유 없음 — ok는 빈 배열) |
| `BUDGET_FORECAST_OVER_WARN` | warning | `월말 예측 $845 (예산 $800의 106%)` |
| `BUDGET_ESTIMATE_OVER_WARN` | warning | `월말 추정 ≈ $830 (예산 $800의 104%, 추정 기준)` |
| `BUDGET_OVER` | critical | `확정 누적 $812 (예산 $800의 102%)` |
| `BUDGET_PACE_AHEAD` | (보조, 상위 등급 따라감) | `누적 64%가 이번 달 경과 60%보다 앞섬` |
| `BUDGET_UNKNOWN` | unknown | `예측·추정 모두 없음` |
| `SPIKE_RATE_WARNING` / `SPIKE_RATE_CRITICAL` | warning/critical | `+77% (+$0.48/h) vs 7일 중앙값 $0.62/h` |
| `SPIKE_BASELINE_COLLECTING` | ok | `기준 수집 중 (기록 14시간 / 24시간)`. `baselineFrom`이 설정되면 그 시각 이후 표본만 세므로 **전환 직후 최대 24시간 동안 이 상태가 정상적으로 나타난다** (3.3) |
| `SPIKE_DAILY_WARNING` / `SPIKE_DAILY_CRITICAL` | warning/critical | `9월 17일 $31.20 vs 7일 평균 $15.10 (+107%)` |
| `SPIKE_SERVICE` | warning/critical | `급증한 서비스 2개: EC2 - 기타, Elastic Load Balancing` |
| `AWS_NOT_CONFIGURED` | unknown | `AWS 자격 증명 없음` |
| `AWS_ACCESS_DENIED` | unknown | `권한 없음: ec2:DescribeInstances` |
| `CLUSTER_NAME_NOT_CONFIGURED` | unknown | `클러스터 이름이 설정되지 않았습니다 (K8S_CLUSTER_NAME)` (live 전용. mock으로 대체하지 않는다) |
| `PRICING_UNAVAILABLE` | unknown | `단가 조회 실패` |
| `API_LB_ASSUMED` | (정보) | `API 서버 LB로 추정 (1개)` |
| `API_LB_AMBIGUOUS` | warning | `API 서버 LB 후보 2개 — 확인 필요` |
| `API_LB_NOT_FOUND` | (정보) | `API 서버 LB를 찾지 못했습니다 (내부 LB이거나 LB 없는 구성일 수 있습니다)` |
| `CE_ACCESS_DENIED` / `CE_NOT_ENABLED` / `CE_ERROR` | unknown | `Cost Explorer 사용 불가: AccessDenied` |
| `CE_FORECAST_UNAVAILABLE` | (정보) | `AWS 예측 불가 (데이터 부족)` |

- 급증 판단: `SPIKE_BASELINE_COLLECTING`은 명세상 "판단하지 않음"이라 `unknown`이 아니라 `ok` 등급 + 이 사유로 둔다(알 수 없음으로 두면 비용 전체 상태가 불필요하게 회색이 됨). 화면은 코드로 "기준 수집 중" 칩을 보인다.

## 9. 에러 코드 요약

| HTTP | code | 엔드포인트 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | `allocation`, `rate-series` 쿼리, `PATCH settings` |
| 409 | `CE_REFRESH_IN_PROGRESS`, `LIVE_MODE_ONLY` | `POST explorer/refresh` |
| 409 | `SETTING_LOCKED_BY_ENV` | `PATCH settings` |
| 429 | `CE_REFRESH_COOLDOWN`, `CE_DAILY_LIMIT_REACHED` | `POST explorer/refresh` |
| 503 | `SOURCE_UNAVAILABLE` | `POST explorer/refresh` (AWS 설정 없음) |
| 503 | `DASHBOARD_DB_UNAVAILABLE` | `PATCH settings` |

조회 엔드포인트는 출처 실패 시에도 200 + `available: false` + `unavailable`.

## 10. 내부 제공 (공개 API 아님)

어드바이저 스냅샷용으로 cost 모듈이 **프로세스 안에서** 제공한다(HTTP 엔드포인트를 만들지 않는다).
- 현재 비용 스냅샷: 소모율 내역(카테고리·노드그룹 합계·볼륨·LB), 네임스페이스 배분, 확정 누적·서비스별 상위 10, 월말 예측, 예산 상태.
- 대체 인스턴스 타입 후보 단가: 현재 노드 인스턴스 타입마다 (1) 같은 크기 Graviton(예: m6i.large → m7g.large), (2) 한 단계 작은 크기, (3) 같은 타입 스팟 최근 시세. 모두 Pricing API·스팟 시세 캐시에서 계산(추가 권한 없음).
- gp2 → gp3 GB 단가 차이.
형식은 `docs/api/architecture-advisor.md` B.2 `cost` 블록.

## 11. 명세·디자인·DBA 충돌과 선택 (이 문서)

1. **`kind` 값 이름** — 디자인 `estimate/confirmed/forecast` vs PM `estimated/actual/forecast`. → PM 값(`common.md` 1.7). 프론트가 토큰 이름으로 매핑.
2. **스팟 필드 이름** — 디자인 요청 `spotPriceAz`, `spotPriceAt`, `spotFallback`. → `unitPrice.zone`, `unitPrice.asOf`, `unitPrice.source = "spot_price_history" | "on_demand_fallback"`, `spotFallback`로 준다(단가 출처를 한 필드로 모음). 의미는 같다.
3. **확정 반영 기준일·예측 구간 필드** — 디자인 요청 이름(`settledThrough`, `low/high/confidence`, 일별 `unsettled`, `nextAvailableAt`, `todayCalls`, `dailyLimit`)을 그대로 쓴다. 예측 구간은 `Money` 객체(`low`/`high`) 또는 `lowUsd`/`highUsd`(섹션 안), `confidence`는 `confidencePct`.
4. **예산 편집** — 명세 6절 범위 밖 vs PM 지시. → API 제공, 화면은 PM 결정(6절).
5. **PV 볼륨 ID 대조(명세 C8) vs RBAC에 persistentvolumes 없음** — EBS CSI 태그로 대조(3.1).
6. **일일 호출 수 날짜 경계** — DBA가 backend에 맡김. → UTC(5.2).
7. **급증 "기준 수집 중" 등급** — 명세는 "판단하지 않고 표시"만 규정. → `ok` + `SPIKE_BASELINE_COLLECTING`(8절).
8. ~~**EKS 지원 등급 기준 버전**~~ — **폐기(2026-09-24, kOps 전환)**. kOps에는 확장 지원 단가가 존재하지 않는다. `resources.eks[].supportTier`와 `eks:DescribeCluster` 호출을 삭제했고, 어드바이저 규칙 `R-EKSVER`도 삭제했다(`architecture-advisor.md` A.4). 쿠버네티스 커뮤니티 EOL 기준의 대체 규칙(`R-K8SVER`)은 **이번 범위 밖**(PM 결정 Q7).
9. **(kops-support) `api_lb` 식별 규칙이 미확인이다 (U2)** — kOps NLB의 이름·태그 규칙을 확인하지 못했다. 선택: **후보 규칙 + "추정" 표시 + 후보 수별 동작(0/1/N)**을 계약에 먼저 적고, 확정 규칙은 백엔드가 실클러스터에서 확인한 뒤 3.1에 채운다. 추측을 확정으로 쓰지 않기 위해 `identification.confidence`에 `confirmed` 값을 **아직 두지 않았다**. **이 항목이 틀리면 금액이 조용히 틀리므로 실클러스터 확인 우선순위 1순위다.**
10. **(kops-support) 마스터 판별을 EC2 태그로 하지 않는다** — 역할 태그 접두어 상수(`k8s.io/role/`로 보이지만 값을 소스에서 직접 확인하지 못했다, 명세 U3)에 의존하면 틀릴 수 있다. → **쿠버네티스 노드 라벨 → `providerID` → 인스턴스** 경로만 쓴다. 결과적으로 `cluster-status`의 `NodeItem.role`과 비용의 마스터 집합이 **항상 같다**(숫자가 어긋나지 않는다).
11. **(kops-support) etcd 볼륨의 main/events 구분** — 볼륨 태그의 etcd 클러스터 이름 규칙을 확인하지 못했다. → `etcdCluster`를 `null` 가능으로 두고 화면은 "etcd 볼륨"으로만 적는다. 금액에는 영향이 없다(둘 다 `etcd_ebs`).
12. **(kops-support) `controlPlane`을 카테고리로 둘 것인가, 축을 하나 더 둘 것인가** — `controlPlane`은 리소스 종류가 아니라 **역할** 축이라 `ec2`·`ebs`와 층이 다르다. 대안은 모든 행에 `role: 'worker' | 'control_plane'`을 붙이고 카테고리는 그대로 두는 것이었다. → **명세 3.5.1의 결정(카테고리 교체)을 따른다.** 이유: 화면이 이미 카테고리 단위로 구성돼 있고(디자인 `aws-cost.md`), "컨트롤 플레인이 시간당 얼마인가"가 kOps 사용자의 핵심 질문이다. 하위 분해는 `byKind`로 제공한다.

## 12. 변경 이력
- 2026-09-24 (kops-support 구현 P4, backend 4단계): **비용 모델 kOps 전환 완료.**
  - 카테고리가 `eks` → **`controlPlane`**(순서 `ec2 → ebs → lb → ipv4 → controlPlane` 고정), `resources.eks[]` → **`resources.controlPlane[]`**(행마다 `kind`), `categories[].byKind`·`categories[].apiLb`·`categories[].notes` 추가. `AwsResourceSnapshot.eks`·`PriceBook.eks`·AmazonEKS 단가 조회를 **삭제**했다(AC-KOPS32: Pricing API에 AmazonEKS 호출이 더 이상 없다).
  - **중복 계상 없음(AC-KOPS29)**: 마스터 EC2·마스터 루트/etcd EBS·마스터 퍼블릭 IPv4는 `ec2`·`ebs`·`ipv4`에서 빠진다. 마스터 판별은 **노드 라벨(`role`)에서 출발**하고 EC2 역할 태그에 의존하지 않는다. mock에서 카테고리 합계 = 전체 추정 소모율(오차 0), 배분 합계 = 추정 합계(오차 0)를 확인했다.
  - `api_lb`는 계약의 **후보 규칙**(클러스터 태그 + Service·Ingress 비귀속)으로만 판별하고 0/1/N 각각의 동작(`not_found`·`assumed`·`ambiguous`)을 구현했다. `identification.confidence`에 **`confirmed`는 쓰지 않는다**(U2 미확인). **부작용 주의**: 클러스터 태그가 있고 쿠버네티스에 귀속되지 않는 LB는 **무엇이든 API 서버 LB 후보가 된다**(bastion LB 등) — 그래서 2개 이상이면 `ambiguous` 경고를 띄운다.
  - `resources.controlPlane[].etcdCluster`는 **항상 `null`**이다(볼륨 태그의 main/events 구분 규칙 미확인). 화면은 "etcd 볼륨"으로만 적는다.
  - **`CLUSTER_NAME_NOT_CONFIGURED`**(AC-KOPS33): live인데 `K8S_CLUSTER_NAME`이 비면 추정 전체가 `available: false`이고 `awsResources` 출처가 `not_configured`가 된다. mock 값을 섞지 않는다.
  - **`cost.spike.rate.baselineFrom` 반영 완료**(DBA 요청 5): 기준선 표본의 하한을 `baselineDays`와 `baselineFrom` 중 **늦은 쪽**으로 잡는다. `null`이면 지금까지와 완전히 같은 동작이다. 설정 PATCH DTO에는 **열지 않았다**(운영자가 손으로 바꿀 값이 아니고, 병합이 스프레드라 다른 항목을 PATCH해도 값이 보존된다).
  - mock 세계에 마스터 etcd 볼륨 6개(main/events × 3, gp3 20GB)와 마스터 퍼블릭 IPv4를 추가해 `byKind` 5종이 모두 보인다.
- 2026-09-24 (kops-support 구현 P1·P2, backend 4단계):
  - **`cost-store.ts`의 조용한 저장 실패를 고쳤다**: `eksUsdPerHour` → `controlPlaneUsdPerHour`(DB 열 `control_plane_usd_per_hour`), `StoredRateSample.byCategory.eks` → `controlPlane`, 배분 `breakdown.eksUsdPerHour` → **`controlPlaneUsdPerHour`**. `prisma generate` 재실행 완료. 타입이 못 잡는 자리라 **회귀 테스트**(`src/cost/store/cost-store.spec.ts`)로 고정했다 — Prisma 인자 이름을 `prisma/schema.prisma`의 필드 목록과 대조하고, 구 이름을 되돌리면 실패한다.
  - **배분(AC-KOPS15)**: 마스터 노드 EC2 비용을 파드에 배분하지 않고 `shared_cluster`의 `nodeUsdPerHour`로 넣는다. 마스터 위 컨트롤 플레인 파드에도 배분하지 않는다. **배분 합계 = 추정 합계(±$0.01)는 그대로 성립**한다(테스트로 고정).
  - **삭제**: `eks:DescribeCluster` 호출과 `describeEksCluster` 게이트웨이 메서드, `@aws-sdk/client-eks` 의존성, `eksSupportTier`(파일 `eks-support.ts` → **`instance-types.ts`**), `resources.eks[].supportTier`, 확장 지원 단가 조회. 클러스터 버전은 **쿠버네티스 API 서버에서만** 온다 — 클러스터 인벤토리를 쓸 수 없으면 `resources.eks[]` 행 자체가 없다(전에는 AWS 조회로 채웠다).
  - **변경**: EC2 노드그룹 귀속 태그가 `kops.k8s.io/instancegroup` 하나로(하위 호환 없음), 클러스터 이름 env가 **`K8S_CLUSTER_NAME`**. EC2 필터 태그 `kubernetes.io/cluster/<이름>`은 **그대로**(kOps도 같다, F3·D9).
  - **아직 없음(P4)**: 카테고리 이름은 코드에서 여전히 `'eks'`이고 `resources.eks[]`·`categories[].category`도 그대로다. `controlPlane` 카테고리·`ControlPlaneCostKind`·`byKind`·`api_lb` 식별·`CLUSTER_NAME_NOT_CONFIGURED`·도움말 문구는 P4에서 넣는다. **DB 열과 배분 breakdown만 먼저 새 이름**이다(위 첫 항목의 이유).
  - **DBA 요청 5(`cost.spike.rate.baselineFrom`) 미반영**: 급증 판단이 아직 이 값을 읽지 않는다(값이 `null`이면 지금과 같은 동작이므로 깨지는 것은 없고, 전환 시점 오탐 방지 효과만 없다). P4에서 `cost-status.ts`와 함께 처리한다.
- 2026-09-24 (kops-support 계약, backend 3단계): 대상 환경 **EKS → kOps**. 구현 전 계약만 갱신했다.
  - **삭제**: 카테고리 `eks`, `resources.eks[]`, `resources.eks[].supportTier`, `eks:DescribeCluster` 호출과 AWS 권한 목록의 `eks:*`, 배분 `breakdown.eksUsdPerHour`, 11절 8번(EKS 지원 등급). 구 이름을 읽는 하위 호환은 두지 않는다.
  - **추가**: 카테고리 **`controlPlane`**(순서는 마지막 자리 그대로), `ControlPlaneCostKind` 5종, `categories[].byKind`, `resources.controlPlane[]`(행마다 `kind`), `api_lb` 후보 규칙과 `identification`·후보 0/1/N 동작, `unavailable.code`에 **`CLUSTER_NAME_NOT_CONFIGURED`**, 이유 코드 `API_LB_*`, 배분 `breakdown.controlPlaneUsdPerHour`, 3.1.1 화면 도움말 고정 문구(상단 안내·Route53·S3 state store·목표 대수 미표시).
  - **변경**: 노드그룹 귀속 태그가 `kops.k8s.io/instancegroup` 하나로, 배분 규칙 6번이 "컨트롤 플레인 전체 + 워커 루트 볼륨 + 워커 퍼블릭 IPv4 → `shared_cluster`"로, 클러스터 이름 env가 `EKS_CLUSTER_NAME` → **`K8S_CLUSTER_NAME`**(EC2 태그 필터 값도 겸함).
  - **AWS 호출·권한은 늘지 않는다**(AC-KOPS32): `eks:*` 삭제, `autoscaling:*`·`route53:*`·`s3:*` 추가 없음. EC2 필터 태그 `kubernetes.io/cluster/<name>`는 그대로.
  - **확인 필요(실클러스터)**: **U2(API 서버 NLB 이름·태그 규칙 — 1순위)**, etcd 볼륨의 main/events 구분 태그. 11절 9·11번 참고. 확정 전까지 계약은 "추정" 표시를 강제한다.
  - **DBA 완료분 반영**: `cost_rate_samples.eks_usd_per_hour` → **`control_plane_usd_per_hour`**(손으로 쓴 RENAME이라 **기존 행이 보존된다**, AC-KOPS34. 같은 행 `resources` jsonb의 `kind: 'eks'` → `'controlPlane'`도 함께). 설정 **`cost.spike.rate.baselineFrom`**(기본 `null`) 신설 — 3.3·4.1·6.1·6.2·8절에 반영했다. 이 계약은 새 이름만 참조한다.
  - **다음 단계(구현) 주의**: `apps/api/src/cost/store/cost-store.ts`의 `eksUsdPerHour` 필드는 `...data` 전개로 넘어가 **TypeScript 초과 속성 검사에 걸리지 않고**, `saveRateSample`의 `try/catch`가 Prisma 예외를 삼킨다 → 안 고치면 빌드·테스트가 통과하는데 **소모율 표본만 조용히 저장되지 않는다**(급증 판단이 말라 죽는다). 이름 교체와 함께 `prisma generate` 재실행이 필요하다. 상세는 `docs/reports/kops-support/backend.md`.
- 2026-09-19 (4단계 마무리): `summary.monthEnd.estimated`·`estimate.monthEnd` null 조건 명시, `estimate.stale`, `actual.stale`·`staleReason`(항상 포함), CE 상태 `maxCallsPerRefresh`·`refreshEstimatedCostUsd` 추가, EKS 지원 등급 기준 버전(11절 8번). mock 인벤토리는 cluster mock과 같다(`common.md` 6.1).
