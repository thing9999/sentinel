# API 계약: aws-cost

- 작성: backend, 2026-09-19 (3단계 계약. 구현 전)
- 공통 규약: `docs/api/common.md` (특히 1.7 금액 `kind`·`asOf`, 2절 상태, 5절 SSE, 6절 mock 시나리오)
- 명세: `docs/specs/aws-cost.md` / 디자인: `docs/design/aws-cost.md`, `status.md` 3·4.9절 / DBA: `docs/db/schema.md` 2.1~2.5, `apps/api/src/database/settings-defaults.ts`
- 모든 금액·배분·예산·급증 판단은 **서버가 계산**한다. 화면은 금액을 더하거나 계산하지 않는다.
- AWS 호출은 `CLAUDE.md` 읽기 전용 권한만: `pricing:GetProducts`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeSpotPriceHistory`, `elasticloadbalancing:Describe*`, `eks:DescribeCluster`. mock 모드는 **AWS 호출 0회**. mock의 노드·파드·PVC·LB는 cluster mock 인벤토리와 같다(`common.md` 6.1 "그룹 사이의 관계").

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
| `awsResources` | EC2 인스턴스, EBS 볼륨, 로드밸런서, EKS 클러스터 | 5분 + 쿠버네티스 노드·PVC·서비스 변경 시 즉시(10초 debounce) | 15분 |
| `pricing` | 공시 단가 (Pricing API) | 24시간 캐시, 처음 보는 타입은 즉시 | 72시간 |
| `spotPrice` | 스팟 시세 | 1시간 캐시 (타입·AZ별) | 3시간 |
| `costExplorer` | 확정·예측 | 6시간 캐시 (자체 DB 영속) | 18시간 |
| `kube` | 노드·파드 requests·PVC·서비스·인그레스 (배분·식별) | watch | 45초 |

---

## 1. 공통 타입

```ts
type MoneyKind = 'estimated' | 'actual' | 'forecast';
interface Money { amountUsd: number; kind: MoneyKind; asOf: string }

type CostCategory = 'ec2' | 'ebs' | 'lb' | 'ipv4' | 'eks';   // 화면 순서: EC2 노드 → EBS → 로드밸런서 → 퍼블릭 IPv4 → EKS 컨트롤 플레인

interface Unavailable { code: string; message: string }       // 영역을 계산할 수 없을 때 사유
```

- **금액 `kind`·`asOf` 규칙**(`common.md` 1.7): 단독 금액은 `Money`. 표·목록은 섹션 객체에 `kind`·`asOf`가 있고 행의 숫자(`usdPerHour` 등)는 그것을 상속한다.
- 금액 필드 이름: `usdPerHour`(시간당), `usdPerDay`(= ×24), `usdPerMonth`(= ×730, 명세 가정 C9), 누적·총액은 `amountUsd`/`...Usd`.
- 단가: `usdPerHour`(인스턴스·LB·IPv4·EKS), `usdPerGbMonth`(EBS 용량), `usdPerIopsMonth`, `usdPerMibpsMonth`(gp3/io 추가 성능).

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
| `spike.rate` | 타일 5 줄1. `baselineState`: `collecting`(기록 24시간 미만 → 판단 안 함. 등급은 `ok` + reason `SPIKE_BASELINE_COLLECTING`, 8절) \| `ready` |
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
    { "category": "ec2",  "label": "EC2 노드",          "count": 6, "usdPerHour": 0.7176,   "usdPerMonth": 523.848,  "sharePct": 65.0, "unpricedCount": 1 },
    { "category": "ebs",  "label": "EBS",               "count": 9, "usdPerHour": 0.124932, "usdPerMonth": 91.2,     "sharePct": 11.3, "unpricedCount": 0 },
    { "category": "lb",   "label": "로드밸런서",         "count": 2, "usdPerHour": 0.0504,   "usdPerMonth": 36.792,   "sharePct": 4.6,  "unpricedCount": 1 },
    { "category": "ipv4", "label": "퍼블릭 IPv4",        "count": 2, "usdPerHour": 0.01,     "usdPerMonth": 7.3,      "sharePct": 0.9,  "unpricedCount": 0 },
    { "category": "eks",  "label": "EKS 컨트롤 플레인",  "count": 1, "usdPerHour": 0.1,      "usdPerMonth": 73.0,     "sharePct": 9.1,  "unpricedCount": 0 }
  ],
  "resources": {
    "ec2": [
      {
        "key": "node:ip-10-0-12-34.ap-northeast-2.compute.internal",
        "nodeName": "ip-10-0-12-34.ap-northeast-2.compute.internal",
        "instanceId": "i-0a1b2c3d4e5f67890",
        "nodeGroup": "batch",
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
        "nodeGroup": "spot-workers",
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
        "nodeGroup": "spot-workers",
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
        "nodeGroup": "gpu",
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
    "eks": [
      {
        "key": "eks:prod-eks",
        "clusterName": "prod-eks",
        "version": "1.34",
        "supportTier": "standard",
        "priced": true,
        "unitPrice": { "usdPerHour": 0.1, "source": "pricing_api", "asOf": "2026-09-18T18:00:00.000Z" },
        "usdPerHour": 0.1,
        "usdPerMonth": 73.0,
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
| `resources.eks[].supportTier` | `standard` \| `extended`(확장 지원 단가, 화면 warn 칩). 기준 버전 `version`(major.minor)은 `eks:DescribeCluster` 값 우선, 없으면 **클러스터 API 서버 버전**(`cluster-status` `cluster.version`). 둘 다 없으면 EKS 행 없음 |
| `stale` | 리소스 조회(`awsResources`) 출처가 stale이면 `true`(마지막 추정을 그대로 보여 줌). mock은 항상 `false` |
| `pricing.cacheUsed` | Pricing API 실패 시 만료된 캐시 단가 사용 → 화면 "단가 캐시 사용 (날짜)" 칩 |
| `outOfCluster` | 태그·쿠버네티스 대조로 식별되지 않아 합계에 넣지 않은 리소스 수(명세 C8, 참고용) |

- 행의 `usdPerHour`·`usdPerMonth`는 섹션 `kind: "estimated"`, `asOf`를 상속. `unitPrice.asOf`는 단가 조회 시각(별도).
- 리소스 ↔ 클러스터 식별(명세 C8):
  - EC2: 노드 `spec.providerID`(`aws:///<az>/<instance-id>`) ↔ `DescribeInstances`. 구매 옵션은 `InstanceLifecycle`(spot) 우선, 없으면 노드 레이블.
  - EBS: **EBS CSI 드라이버가 붙이는 볼륨 태그**(`kubernetes.io/created-for/pvc/namespace`, `kubernetes.io/created-for/pvc/name`, `ebs.csi.aws.com/cluster`) ↔ PVC, 노드 루트 볼륨은 인스턴스의 블록 디바이스 매핑.
  - LB: 서비스 `status.loadBalancer.ingress[].hostname`·인그레스 status ↔ ELB `DNSName`, 보조로 태그 `service.k8s.aws/stack`, `ingress.k8s.aws/stack`, `kubernetes.io/service-name`.
  - EKS: `eks:DescribeCluster`(이름 `EKS_CLUSTER_NAME`). `supportTier`는 버전과 EKS 지원 일정표(서버 설정)로 판단.
  - 충돌: 명세 C8은 "PV의 볼륨 ID"로 대조한다고 했으나 RBAC 목록에 `persistentvolumes`가 없다. → 선택: **RBAC를 늘리지 않고 EBS CSI 볼륨 태그로 대조**한다. 태그가 없는 오래된 in-tree 볼륨은 "클러스터 외"로 분류될 수 있다(한계로 보고서에 기록).
- 오류: 없음(항상 200). 계산 불가면 `available: false` + `unavailable`(`AWS_NOT_CONFIGURED`, `AWS_ACCESS_DENIED`, `PRICING_UNAVAILABLE`), 금액 null. 노드 0개면 EKS만 있는 정상 응답.

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
    { "key": "shared_cluster", "label": "공용(클러스터)", "usdPerHour": 0.1266, "usdPerMonth": 92.418,  "sharePct": 11.5, "breakdown": { "nodeUsdPerHour": 0, "storageUsdPerHour": 0.0166, "lbUsdPerHour": 0, "eksUsdPerHour": 0.1, "ipv4UsdPerHour": 0.01 } },
    { "key": "shared",         "label": "공용",           "usdPerHour": 0.0252, "usdPerMonth": 18.396,  "sharePct": 2.3,  "breakdown": { "nodeUsdPerHour": 0, "storageUsdPerHour": 0, "lbUsdPerHour": 0.0252 } }
  ],
  "hiddenSystem": null,
  "total": { "usdPerHour": 1.104532, "usdPerMonth": 806.30836 },
  "unallocatedPct": 28.0,
  "rulesVersion": 1
}
```
- 배분 규칙(명세 3.2 1~7, 화면 "계산 방법"에 노출): 파드 몫 = 노드 시간당 × (CPU requests 비율 + 메모리 requests 비율) ÷ 2, 나머지 = `unallocated`, PVC 볼륨 → PVC 네임스페이스, LB → 서비스·인그레스 네임스페이스(식별 불가 → `shared`), EKS·노드 루트 볼륨·퍼블릭 IPv4 → `shared_cluster`, 완료 파드 제외. **단가 없는 노드는 배분 대상에서 빠진다**(합계와 일치 유지).
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
    "medianUsdPerHour": 0.62,
    "warnAtUsdPerHour": 1.12,
    "critAtUsdPerHour": 1.62
  },
  "retentionDays": 90
}
```
- `stepSec`: 24h·7d는 300(원본 5분 표본), 30d는 1800, 90d는 3600(구간 평균으로 서버가 줄임). 결측 구간은 점이 없다(화면이 간격 > 2 × stepSec이면 선을 끊음).
- `baseline.warnAtUsdPerHour` = max(중앙값 × `warnRatio`, 중앙값 + `warnAbsUsdPerHour`), `critAtUsdPerHour` = max(중앙값 × `critRatio`, 중앙값 + `critAbsUsdPerHour`) — 배수와 절대액 조건을 합친 값(디자인 요청). `state: "collecting"`이면 중앙값·임계값 null(화면 "기준 수집 중").
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
    "rate": { "warnRatio": 1.3, "warnAbsUsdPerHour": 0.5, "critRatio": 2.0, "critAbsUsdPerHour": 1.0, "baselineDays": 7, "minBaselineHours": 24 },
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
    "rate":  { "baselineDays": 7, "minBaselineHours": 24, "warnRatio": 1.3, "warnAbsUsdPerHour": 0.5, "critRatio": 2.0, "critAbsUsdPerHour": 1.0 },
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
  "explorer": { "dailyCallLimit": 30, "costAllocationTagFilter": { "key": "kubernetes.io/cluster/prod-eks", "values": ["owned"] } }
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
| `SPIKE_BASELINE_COLLECTING` | ok | `기준 수집 중 (기록 14시간 / 24시간)` |
| `SPIKE_DAILY_WARNING` / `SPIKE_DAILY_CRITICAL` | warning/critical | `9월 17일 $31.20 vs 7일 평균 $15.10 (+107%)` |
| `SPIKE_SERVICE` | warning/critical | `급증한 서비스 2개: EC2 - 기타, Elastic Load Balancing` |
| `AWS_NOT_CONFIGURED` | unknown | `AWS 자격 증명 없음` |
| `AWS_ACCESS_DENIED` | unknown | `권한 없음: ec2:DescribeInstances` |
| `PRICING_UNAVAILABLE` | unknown | `단가 조회 실패` |
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
8. **EKS 지원 등급 기준 버전** — (PM 결정 2026-09-19) 클러스터 버전을 기준으로 한다. `eks:DescribeCluster` 값이 있으면 우선, 없으면 API 서버 버전(3.1 `resources.eks[].supportTier`).

## 12. 변경 이력
- 2026-09-19 (4단계 마무리): `summary.monthEnd.estimated`·`estimate.monthEnd` null 조건 명시, `estimate.stale`, `actual.stale`·`staleReason`(항상 포함), CE 상태 `maxCallsPerRefresh`·`refreshEstimatedCostUsd` 추가, EKS 지원 등급 기준 버전(11절 8번). mock 인벤토리는 cluster mock과 같다(`common.md` 6.1).
