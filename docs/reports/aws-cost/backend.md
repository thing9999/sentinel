# aws-cost · backend 작업 보고

> 파일 위치: `docs/reports/aws-cost/backend.md`

## 2026-09-19 · API 계약 (3단계)

### 1. 요청 내용
- PM 요청: `docs/api/aws-cost.md` 작성(구현 없음). 실시간 시간당 소모율(구성 요소별·노드별·네임스페이스 배분), 시계열, Cost Explorer 확정 비용·월말 예측, 예산·급증 상태. 모든 금액에 `kind`(estimated|actual|forecast)·`asOf`. 스팟 시세 필드(출처, 조회 실패 시 온디맨드 상한 플래그). CE 새로고침(다음 가능 시각, 이번 달 호출 수·예상 비용, 수동 새로고침 엔드포인트와 429 형식). 예산 등 설정 조회/변경(대시보드 자체 DB만). SSE 이벤트.
- 공통 규약은 `docs/api/common.md`(보고: `docs/reports/cluster-status/backend.md`).

### 2. 참고한 문서
- `CLAUDE.md`(AWS 읽기 권한 목록), `docs/specs/aws-cost.md`
- `docs/design/aws-cost.md`, `status.md` 3절(추정/확정/예측)·4.9절(비용 차트)·5.2(정렬)
- `docs/db/schema.md` 2.1~2.5, `apps/api/src/database/settings-defaults.ts`(`cost.budget`, `cost.spike`, `cost.explorer`, `cost.estimation`)
- `docs/reports/aws-cost/designer.md` 8절, `aws-cost/dba.md` 9절

### 3. API 계약 (`docs/api/aws-cost.md`)
| 메서드·경로 | 용도 |
|---|---|
| `GET /api/cost/summary` | 비용 전체 상태 + KPI 타일 5개(추정 시간당·일·월, 확정 누적·지난달 같은 기간, AWS 예측 월말·80% 구간, 추정 월말(방식·계산식), 예산, 급증 A·B) |
| `GET /api/cost/estimate` | 합계, 카테고리 5개(ec2/ebs/lb/ipv4/eks), 리소스 내역(노드·볼륨·LB·IPv4·EKS 행), 단가 출처·조회 시각, 단가 없음·스팟 대체·클러스터 외 수 |
| `GET /api/cost/allocation` | 네임스페이스 배분(명세 3.2 규칙) + 고정 행(`unallocated`, `shared_cluster`, `shared`) + 합계(= estimate 합계) |
| `GET /api/cost/rate-series?range=24h\|7d\|30d\|90d` | 소모율 추이 + 7일 중앙값·주의/급증 임계값(배수와 절대액을 합친 값) |
| `GET /api/cost/status` | 예산·급증 상세, 급증 원인(`added/changed/removed`), 서비스 급증, 기준값 |
| `GET /api/cost/actual` | CE 확정: 이번 달 누적, 서비스별 상위 10 + 기타, 일별 30일(`unsettled`), 지난달, 예측(누적 곡선 포함), `settledThrough` |
| `GET /api/cost/explorer/refresh` | 새로고침 상태: `canRefresh`, `disabledReason`, `nextAvailableAt`, `nextScheduledAt`, `todayCalls`/`dailyLimit`, `callsPerRefresh`, `monthCalls`, `monthCallCost`(estimated) |
| `POST /api/cost/explorer/refresh` | 수동 새로고침 → 202. 429 `CE_REFRESH_COOLDOWN`/`CE_DAILY_LIMIT_REACHED`(+`Retry-After`, `details.retryAfterSec`), 409 `CE_REFRESH_IN_PROGRESS`/`LIVE_MODE_ONLY`, 503 `SOURCE_UNAVAILABLE` |
| `GET /api/cost/settings` | 예산·급증 기준·CE 설정(+ 조회 전용 추정 주기), `lockedByEnv` |
| `PATCH /api/cost/settings` | 부분 갱신(대시보드 DB `settings`만). 400 검증, 409 `SETTING_LOCKED_BY_ENV`, 503 `DASHBOARD_DB_UNAVAILABLE` |

- 스팟 필드: `unitPrice.source` = `pricing_api` \| `spot_price_history`(`zone`·`asOf` = 시세 AZ·조회 시각) \| `on_demand_fallback`, 행 플래그 `spotFallback`, 노트 `SPOT_PRICE_FALLBACK`("스팟 시세 조회 실패 (온디맨드 기준 상한)").
- 단가 없음: `priced: false`, 금액 null, 합계 제외, `UNPRICED` 노트, `unpricedCount`.
- SSE(`cost` 토픽): `cost.snapshot`, `cost.estimate.updated`, `cost.actual.updated`, `cost.status.updated`, `cost.refresh.updated`, `cost.rate.sampled`.
- 판단 이유 코드: `BUDGET_*`, `SPIKE_*`(기준 수집 중은 `ok` + `SPIKE_BASELINE_COLLECTING`), `AWS_*`, `PRICING_UNAVAILABLE`, `CE_*`.
- 내부 제공(HTTP 없음): 어드바이저용 비용 스냅샷, 대체 인스턴스 타입 후보 단가(Graviton 동급·한 단계 작은 크기·스팟), gp2/gp3 GB 단가.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/aws-cost.md` | 추가 | aws-cost REST·SSE 계약 |
| `docs/reports/aws-cost/backend.md` | 추가 | 이 보고서 |

(코드 변경 없음)

### 5. 주요 결정과 이유
- **`kind` 값 `estimated/actual/forecast`** — 디자인 요청(`estimate/confirmed/forecast`)과 충돌, PM 지시를 따름. 프론트가 토큰 이름으로 매핑.
- **금액 `kind`·`asOf` 부착 방식**: 단독 값은 `Money{amountUsd, kind, asOf}`, 표는 섹션에 한 번(행 상속). 모든 행에 반복하면 응답이 커지고, 디자인도 표는 열 머리글에 배지 한 번.
- **CE 호출 묶기**: 새로고침 1회에 `GetCostAndUsage`(일별 + 서비스 그룹, 지난달 1일~오늘) + `GetCostForecast` = 보통 2회, 페이지네이션 포함 최대 4회(명세 목표 4회 이하). `callsPerRefresh`로 화면 Dialog에 안내.
- **쿨다운 기준**: 마지막 과금 호출 + 1시간. 권한 없음·미활성화 실패는 과금되지 않으므로 쿨다운을 시작하지 않음(디자인: CE 사용 불가 시 재시도 활성). 일일 호출 수에는 포함.
- **날짜 경계 UTC** (DBA가 backend에 결정 위임). CE 날짜가 UTC라 기준을 맞춤. `dailyResetAt`을 줘서 화면이 로컬 시각으로 표시.
- **설정 변경 API 제공** — 명세 6절·DBA 문서는 "예산 편집 범위 밖", PM은 "설정 조회/변경 엔드포인트" 요청. API는 만들고 화면 반영은 PM·디자이너 결정으로 남김. 환경 변수로 고정된 값은 409, 캐시 TTL·쿨다운은 1시간 미만 불가(호출 비용 보호), 추정 주기는 조회 전용.
- **metric·태그 필터 변경 시 즉시 CE를 부르지 않음**(`pendingRefresh: true`) — 설정 변경이 곧 과금으로 이어지지 않게.
- **EBS ↔ PVC 대조는 EBS CSI 볼륨 태그로** — 명세 C8은 PV 볼륨 ID 대조를 말하지만 RBAC에 persistentvolumes가 없음. RBAC를 늘리지 않음.
- **급증 "기준 수집 중" = ok + 사유 코드** — unknown으로 두면 비용 전체 상태가 불필요하게 회색.
- **Pricing·CE 엔드포인트 리전 `us-east-1`** 고정, 단가 필터의 regionCode는 클러스터 리전.
- **소모율 추이 해상도**: 24h·7d 5분 원본, 30d 30분, 90d 1시간(서버가 평균으로 줄임).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint:check --prefix apps/api` | 통과 | 코드 변경 없음 |
| `npm test --prefix apps/api` | 통과 | 6 suites, 41 passed, 1 skipped |
| AWS 실제 호출 | 생략 | 계약 단계. 권한·응답 형식(CE GroupBy SERVICE 이름, Spot 시세 형식)은 구현 단계에서 확인 |

### 7. 남은 이슈·한계
- EKS CSI 태그가 없는 오래된 in-tree 볼륨은 "클러스터 외"로 분류될 수 있음.
- EKS 확장 지원 판정은 버전 ↔ 지원 일정표(서버 설정)에 의존. 일정표 갱신 필요.
- 서비스 `displayName` 매핑은 주요 서비스만(모르는 서비스는 원문).
- 대시보드 DB 없이 실행하면 소모율 기록·CE 캐시가 메모리뿐(재시작 시 초기화, CE 재호출 발생 가능) → 응답에 `persistence: "memory"`.
- `cost.estimate.updated`는 변화가 있을 때만(최소 15분에 1번) 보냄 → 화면 stale 기준(15분)과 맞물림. 구현 시 경계 확인 필요.

### 8. 다른 담당 요청
- `PM 요청`: 예산·급증 설정 편집 화면을 이번 범위에 넣을지 결정(API는 준비됨, 명세 6절은 범위 밖으로 둠).
- `frontend 요청`: `kind` 매핑(`estimated→estimate`, `actual→confirmed`), 합계·비율·월 환산을 계산하지 말고 서버 값 사용, 표의 금액은 섹션 `kind`·`asOf` 상속, 새로고침 버튼 상태는 `refresh.canRefresh`·`disabledReason`·`nextAvailableAt`으로.
- `designer 요청`: 없음(요청 필드 모두 반영. 스팟 필드 이름만 `unitPrice.zone/asOf/source` + `spotFallback`으로 모음 — 의미 동일).
- `DBA 요청`: 없음. 기존 `cost_*` 테이블·`settings` 키로 충분. (CE 캐시 kind enum은 호출을 묶어도 기존 값 중 하나로 저장 가능 — 구현 때 `daily`·`forecast` 키 사용 예정)

### 9. 다음 담당이 알아야 할 점
- 배분 합계 = 추정 합계(±$0.01)가 수용 기준. 단가 없는 노드는 배분에서도 빼야 맞는다.
- 7일 중앙값·수집 여부 쿼리는 DBA 보고서 9절 예시 그대로.
- mock 시나리오 ID(`normal`, `budget-warning`, `budget-over`, `spike-warning`, `spike-critical`, `forecast-unavailable`, `ce-unavailable`, `ce-limit-reached`, `unpriced`, `spot-fallback`, `baseline-collecting`, `no-budget`)는 `common.md` 6.1. mock은 AWS 호출 0회·CE 호출 로그 기록 안 함.

## 2026-09-19 · 구현 (4단계, B 파트: `apps/api/src/cost/**`)

### 1. 요청 내용
- PM 요청: 4단계 백엔드 B 파트(AWS 비용). 쓰기 영역은 `apps/api/src/cost/**`(+ 이 보고서).
- 실시간 추정(인벤토리 × 단가: Pricing API·스팟 시세·EBS·LB·IPv4·EKS), 네임스페이스 배분, 소모율 5분 기록, Cost Explorer(누적·서비스별·일별·예측) 캐시·호출 기록·수동 새로고침 제한, 예산·급증 판단, `PATCH /api/cost/settings`, 모든 금액 `kind`·`asOf`, `CostTopicSource`·mock 대상·어드바이저 스냅샷, mock 모드(AWS 0회), live·자격 증명 없음 → unknown.
- 클러스터 인벤토리는 `src/cost` 안에 포트(`ClusterInventoryPort`)로 정의하고, live 어댑터는 A 완료 후 PM이 연결.

### 2. 참고한 문서
- `CLAUDE.md`(AWS 읽기 권한·확정 결정), `docs/api/common.md`, `docs/api/aws-cost.md`, `docs/api/architecture-advisor.md` B.2 `cost` 블록, `docs/specs/aws-cost.md`
- `docs/db/schema.md` 2.1~2.5, `docs/reports/aws-cost/dba.md` 9절, 이 보고서 3단계 섹션(계약 결정)
- `apps/api/prisma/schema.prisma`, `apps/api/src/database/settings-defaults.ts`·`prisma.service.ts`(import만)
- A가 먼저 만든 공용 파일(import만, 수정 없음): `src/common/extension-points.ts`(이미 있어서 새로 만들지 않음), `api-error.ts`(`ApiException`·`validationFailed`), `status.ts`(`StatusChangeTracker`·`sortReasons`·`worstStatus`), `source-registry.service.ts`(`SourceRegistry`), `overview-summary.ts`(개요 카드 확장점)

### 3. 작업 내용

**구조** (계산은 순수 함수, AWS·DB 접근은 경계 클래스에 모음)

| 층 | 파일 | 역할 |
|---|---|---|
| 포트 | `cluster-inventory.port.ts` | 클러스터 인벤토리 최소 인터페이스 + live 기본값 `NotConfiguredClusterInventory` |
| AWS 경계 | `aws/aws-gateway.ts`, `aws/aws-sdk.gateway.ts` | 읽기 전용 호출 8종만 있는 `CostAwsGateway` 인터페이스와 SDK v3 구현. 오류 분류(`classifyAwsError`), 메시지에서 ARN·계정 ID·액세스 키 가림 |
| 저장 | `store/cost-store.ts` | Prisma(`price_cache`, `cost_rate_samples`, `cost_explorer_cache`, `cost_explorer_call_logs`, `settings`) + DB가 없을 때 메모리로 대체 |
| 설정 | `settings/cost-settings.service.ts`, `cost.options.ts` | env > settings 테이블 > 코드 기본값, `lockedByEnv`, PATCH 검증·저장 |
| 단가 | `pricing/price.service.ts` | 메모리 → DB → AWS 순서로 캐시. 같은 키 동시 조회는 1회, 실패하면 만료된 캐시 사용(`cacheUsed`), 실패 후 5분 백오프, 음성 캐시 |
| 추정 | `estimate/estimator.ts`, `estimate/allocation.ts`, `estimate/eks-support.ts` | 리소스 행·카테고리·합계, 네임스페이스 배분, EKS 지원 등급·대체 인스턴스 후보 |
| CE | `explorer/cost-explorer.service.ts`, `explorer/ce-normalize.ts`, `explorer/service-names.ts` | 유일한 CE 호출 경로. 캐시·잠금·상한·쿨다운·호출 기록, 화면용 요약 |
| 판단 | `status/cost-status.ts` | 소모율 기준(7일 중앙값)·급증 A·원인, 일별 급증 B(서비스별 포함), 예산, 추정 월말 |
| mock | `mock/mock-world.ts` | 시나리오 12개의 인벤토리·AWS 리소스·단가·CE 결과·소모율 기록 (결정적 난수) |
| 조립 | `cost.service.ts` | 상태 보관, 주기 작업, 모든 응답 모양 생성(`recompute`), SSE 이벤트 |
| 노출 | `cost.controller.ts`, `dto/cost.dto.ts`, `cost.extensions.ts`, `cost.module.ts` | REST 10개, DTO 검증, 확장점 4개 |

**실시간 추정 (계약 3.1)**
1. 인벤토리(포트 스냅샷, 메모리)의 노드 providerID에서 인스턴스 ID를 뽑아 `DescribeInstances`. 인벤토리가 없으면 태그 `kubernetes.io/cluster/<EKS_CLUSTER_NAME>`로 조회.
2. `DescribeVolumes`: 클러스터 인스턴스에 붙은 볼륨 + `ebs.csi.aws.com/cluster` 태그 볼륨. PVC 대조는 (1) 포트의 `volumeHandle`, (2) CSI 태그 `kubernetes.io/created-for/pvc/{namespace,name}`가 인벤토리 PVC와 일치할 때. 루트 볼륨은 인스턴스 블록 디바이스 매핑으로 찾는다. 어디에도 해당하지 않으면 "클러스터 외".
3. ELBv2 `DescribeLoadBalancers/DescribeTags/DescribeTargetGroups/DescribeTargetHealth`: 서비스·인그레스 status 호스트 이름 ↔ DNSName, 보조로 태그(`service.k8s.aws/stack`, `ingress.k8s.aws/stack`, `kubernetes.io/service-name`, `elbv2.k8s.aws/cluster`, `kubernetes.io/cluster/<name>`). LB·EKS 조회가 실패해도 치명적이지 않다(이전 값 유지).
4. `eks:DescribeCluster(EKS_CLUSTER_NAME)` → 버전 → 표준/확장 지원 등급(서버 일정표).
5. 단가 없이 한 번 계산해 필요한 단가 목록을 뽑고(`priceNeedsOf`), `PriceService.resolve`로 모은 뒤 다시 계산한다. 스팟은 `DescribeSpotPriceHistory`(타입·AZ·`Linux/UNIX`, 최신 1건, 1시간 캐시). 실패하거나 결과가 없으면 온디맨드 상한 + `spotFallback: true` + `SPOT_PRICE_FALLBACK` 노트.
6. EBS 월 비용 = GiB × GB-월 단가 + (gp3: 3000 초과 IOPS·125 초과 MiB/s, io1/io2: 전체 IOPS) × 단가. 시간당 = ÷730.
7. 단가가 없는 리소스는 `priced:false`, 금액 null, 합계에서 빠지고 `unpricedCount`에 센다. Pricing 조회가 모두 실패하고 캐시도 없으면 `PRICING_UNAVAILABLE`.
8. 주기: 리소스 5분, 인벤토리 `changes$`는 10초 debounce(최소 간격 30초), 동시 1건. `cost.estimate.updated`는 합계가 $0.0001 넘게 바뀌었거나 리소스 구성이 바뀌었을 때만 보내고, 아니어도 15분에 1번은 보낸다.

**배분 (계약 3.2)**: 명세 규칙 1~7 그대로. requests 합이 할당 가능량을 넘는 비정상 데이터는 노드 비용 안으로 비례 축소(합계 보존). 여러 네임스페이스에 붙은 LB는 균등 분할. `hideSystem`은 시스템 행을 `hidden_system` 행으로 합친다. "배분 합계 = 추정 합계"를 모든 mock 시나리오에서 테스트로 고정했다.

**소모율 기록**: `rateSampleIntervalSec`(5분) 경계로 내린 시각으로 `cost_rate_samples`에 upsert(카테고리별 금액·노드 수·단가 없음 수·`resources` 요약). `awsResources`가 stale이면 기록하지 않는다. 7일 중앙값은 최대 2,016행을 읽어 JS로 계산(원시 SQL 없음). 급증 원인의 기준 시점 = 중앙값에 가장 가까운 표본의 `resources`.

**Cost Explorer (계약 5절)**
- 새로고침 한 번 = `GetCostAndUsage`(DAILY, GroupBy SERVICE, 지난달 1일 ~ 어제) + `GetCostForecast`(DAILY, 80%, 오늘 ~ 월말) = 2회. CAU 페이지는 최대 3.
- 요청 키 = sha256(작업·달·지표·태그 필터 등). 날짜는 키에 넣지 않아서 TTL 안에서는 날이 바뀌어도 다시 부르지 않는다. 캐시는 DB에 영속하므로 재시작해도 재호출이 없다.
- 동기 잠금(`busy`)을 첫 await 전에 잡아서 자동·수동·여러 탭이 겹쳐도 1회만 호출한다. 실패는 오류 행으로 1시간 캐시(예측 데이터 부족은 일반 TTL). 만료 후 재조회가 실패하면 마지막 성공 캐시를 유지하고 1시간 뒤 재시도하며 `stale: true`, `staleReason`을 붙인다.
- 권한 없음·미활성화로 CAU가 실패하면 같은 이유로 실패할 예측 호출은 하지 않는다.
- 호출 기록: 실제 호출 1회 = 1행(실패 포함). 과금되지 않는 실패(권한 없음·미활성화·자격 증명 없음·쓰로틀)는 `estimated_cost_usd = 0`이라 쿨다운 기준(마지막 과금 호출 = `estimated_cost_usd > 0`)에서 빠지고, 일일 호출 수에는 들어간다.
- 일일 상한: 오늘(UTC) 호출 수 + 이번 호출 수 > 상한이면 자동 조회는 건너뛰고(`limitReached`), 수동은 429.
- TTL은 설정·env 어느 쪽이든 최소 3600초로 강제(호출 비용 보호). 쿨다운도 최소 3600초.

**예산·급증 (계약 4·8절)**: 명세 3.5·3.6·3.7 그대로. 예산은 AWS 예측을 우선 쓰고, 없으면 추정 월말(`추정 기준`). `BUDGET_PACE_AHEAD`는 주의·초과일 때만 보조 이유로 붙인다. 급증 A 임계값 = max(중앙값×배수, 중앙값+절대액). 기록이 24시간 미만이면 `ok` + `SPIKE_BASELINE_COLLECTING`. 급증 B는 UTC 그저께 vs 그 전 7일 평균, 서비스별은 `serviceWarnAbsUsd`. 전체 상태 = 예산·급증 A·B 중 최악이고, 이유 앞에 `예산: `, `급증(추정): `, `급증(확정): `를 붙인다.

**REST (계약 그대로)**: `GET summary/estimate/allocation/rate-series/status/actual/explorer/refresh/settings`, `POST explorer/refresh`(202), `PATCH settings`. 모든 조회는 메모리 상태로 답하고 AWS를 부르지 않는다(테스트로 고정). 오류는 A의 `ApiException`을 쓴다(Retry-After + `details.retryAfterSec`).

**확장점 (`cost.extensions.ts`)**
- `CostTopicSource` (@TopicSourceProvider, topic `cost`): `snapshot()` = `cost.snapshot` 1개. `events$` = `cost.estimate.updated`/`cost.actual.updated`/`cost.status.updated`/`cost.refresh.updated`/`cost.rate.sampled`, 시나리오 전환 시 `cost.snapshot`.
- `CostMockScenarioTarget` (@MockScenarioTargetProvider, group `cost`): 시나리오 12개. 인터페이스 밖 추가 속성 `options`(id·label·description)와 `defaultScenario`는 A의 `GET /api/mock/scenarios` 메뉴용.
- `CostAdvisorSnapshot` (@AdvisorSnapshotContributorProvider, section `cost`): `architecture-advisor.md` B.2 `cost` 블록(소모율·카테고리·노드그룹, 배분+고정 행, 확정 요약, 예측, 예산, 대체 인스턴스 후보(Graviton 동급·한 단계 작은 크기·스팟), gp2/gp3 GB 단가). 인스턴스 ID·볼륨 ID·LB 이름은 넣지 않는다(테스트로 확인).
- `CostOverviewSummary` (A의 `OverviewSummaryProviderDecorator`, section `cost`): `cluster-status.md` 2.1 `cost` 블록 `{ status, rate, monthToDate, budgetStatus, available }`.
- `SourceRegistry`(A)에 `awsResources`·`pricing`·`spotPrice`·`costExplorer` 상태를 올린다(live만, 레지스트리가 없으면 건너뜀).

**mock (AWS 호출 0회)**: SDK 게이트웨이를 만들지 않고(`COST_AWS_GATEWAY` = null), 시나리오 세계를 실제 계산 코드(`computeEstimate`·`computeAllocation`·판단 함수)에 그대로 넣는다. 노드 5대(general on-demand m6i.xlarge 2, batch 1, spot 2) + PVC 4 + LB 4(1개는 클러스터 외) + 다른 클러스터 CSI 볼륨 2 + EKS 1.34. 스팟 시세가 15분마다 ±4% 변해서 소모율이 조금씩 움직이고, 1분마다 재계산, 5분마다 기록한다. 소모율 기록은 90일(기준 수집 중 시나리오는 14시간), CE 일별은 지난달 1일~어제(서비스 13개), 예측은 80% 구간. 예산은 날짜와 무관하게 시나리오가 재현되도록 현재 누적·예측 값에서 역산한다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/cost/cost.module.ts` | 수정 | 뼈대 → provider·컨트롤러 등록, 게이트웨이 팩토리(mock이거나 리전 없음 → null) |
| `apps/api/src/cost/cost.service.ts` | 추가 | 오케스트레이터 |
| `apps/api/src/cost/cost.controller.ts` | 추가 | REST 10개 |
| `apps/api/src/cost/cost.extensions.ts` | 추가 | TopicSource·MockScenarioTarget·AdvisorSnapshot·OverviewSummary |
| `apps/api/src/cost/cost.options.ts` | 추가 | env → 옵션, `COST_OPTIONS`·`COST_CLOCK` 토큰 |
| `apps/api/src/cost/cost.types.ts` | 추가 | 도메인·응답 타입 |
| `apps/api/src/cost/cost-util.ts` | 추가 | 반올림·금액 문장·UTC 날짜 |
| `apps/api/src/cost/cluster-inventory.port.ts` | 추가 | 인벤토리 포트 |
| `apps/api/src/cost/aws/aws-gateway.ts` | 추가 | AWS 포트·오류 분류 |
| `apps/api/src/cost/aws/aws-sdk.gateway.ts` | 추가 | SDK v3 구현 |
| `apps/api/src/cost/store/cost-store.ts` | 추가 | Prisma/메모리 저장 |
| `apps/api/src/cost/settings/cost-settings.service.ts` | 추가 | 설정 합성·PATCH |
| `apps/api/src/cost/pricing/price.service.ts` | 추가 | 단가·스팟 캐시 |
| `apps/api/src/cost/estimate/{estimator,allocation,eks-support}.ts` | 추가 | 추정·배분·EKS 등급·대체 후보 |
| `apps/api/src/cost/explorer/{cost-explorer.service,ce-normalize,service-names}.ts` | 추가 | CE 조회·정규화 |
| `apps/api/src/cost/status/cost-status.ts` | 추가 | 예산·급증 판단 |
| `apps/api/src/cost/mock/mock-world.ts` | 추가 | mock 시나리오 데이터 |
| `apps/api/src/cost/dto/cost.dto.ts` | 추가 | 쿼리·PATCH DTO |
| `apps/api/src/cost/test-helpers.ts` | 추가 | 테스트용 가짜 게이트웨이·픽스처 (빌드에 포함되지만 부작용 없음) |
| `apps/api/src/cost/**/*.spec.ts` (8개) | 추가 | 단위·모듈 테스트 104개 |
| `docs/reports/aws-cost/backend.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유
- **CE 캐시 키에서 날짜 제외**: 날짜를 넣으면 UTC 자정마다 키가 바뀌어 TTL과 무관하게 호출이 생긴다. 달·지표·필터만 넣고 실제 기간은 `request`에 기록한다.
- **TTL·쿨다운 최소 3600초 강제**: env `COST_EXPLORER_CACHE_TTL_SEC`가 `@Min(0)`이라 0이 들어오면 호출이 폭주할 수 있다. 설정 합성 단계에서 막는다.
- **과금 여부는 `estimated_cost_usd`로 표현**: 스키마를 바꾸지 않고, 쿨다운(과금 호출 기준)과 이번 달 CE 비용을 같은 컬럼으로 계산한다.
- **실패 캐시 + 마지막 성공 값 유지**: 오류도 1시간 캐시해서 재시도 폭주를 막는다. 성공 캐시가 있으면 지우지 않고 만료 시각만 늦춰 `stale`로 표시한다(DB 행 하나로 해결).
- **확정 누적(MTD)은 어제까지 합산, `settledThrough`는 UTC 그저께**: CE 예측이 오늘부터 시작하므로 어제를 빼면 월말 예측에서 하루가 빠진다. 어제는 일별 차트에서 `unsettled: true`. (계약 예시는 MTD를 `settledThrough`까지로 보였지만, 합계가 맞도록 이렇게 정했다. frontend·PM 참고)
- **추정 월말(`actual_plus_rate`)의 남은 시간 = 오늘 0시(UTC) ~ 월말**: MTD가 어제까지이므로 빈 구간이나 겹침이 없다.
- **급증 원인의 EC2 추가·삭제는 타입·구매 옵션별로 묶음**: 계약 예시 "EC2 노드 +3대 (m6i.large 온디맨드)"와 같은 모양.
- **live인데 인벤토리 없음(포트 미연결)**: 추정은 클러스터 태그 인스턴스로 계속하고, 배분만 `SOURCE_NOT_CONFIGURED`.
- **LB·EKS 조회 실패는 치명적이지 않게**: ELB 권한 하나만 빠져도 추정 전체가 unknown이 되는 것을 피한다.
- **mock 예산은 시나리오가 정함**: 날짜와 무관하게 주의·초과를 재현하려고 현재 누적·예측에서 역산한다. mock에서 `PATCH` 예산은 저장만 되고(DB가 있을 때) 화면 값에는 반영되지 않는다.
- **계약의 "4b 스키마"**: 문서에 4b 절이 없어서 `architecture-advisor.md` B.2 `cost` 블록으로 해석했다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 통과 | 프로젝트 전체 |
| `npx eslint "src/cost/**/*.ts"` | 통과 (0건) | `--fix`는 `src/cost`에만 적용 |
| `npm run lint:check --prefix apps/api` | 실패 313건, **모두 A 영역** | `src/cluster`, `src/common`, `src/config`, `src/db-health`, `src/health`, `src/stream` (A 작업 중, 대부분 prettier). `src/cost`는 0건 |
| `npm test --prefix apps/api` | 통과 | 13 suites, 143 passed, 1 skipped (cost 8 suites 104개 포함) |
| 실제 AWS 호출 | 건너뜀 | 자격 증명 없음. Pricing 필터(IPv4·EKS·EBS IOPS/처리량 usagetype)와 CE 응답 형식은 문서 기준 가정 |
| `nest build` | 건너뜀 | 지시(dist 충돌 방지) |

테스트로 고정한 호출 폭주 방지: 캐시가 유효한 동안 50회 확인 + 재시작 → 추가 호출 0회, 동시 10회 → 1회, 수동 3탭 → 409 + 1회, 권한 없음 실패 → 1시간 동안 재호출 없음, 일일 상한 → 자동·수동 모두 차단, 페이지 최대 3, GET 반복(7종 × 20회) → AWS 0회, mock 12개 시나리오 → AWS 0회.

### 7. 남은 이슈·한계
- CLB(Classic) 미지원: `@aws-sdk/client-elastic-load-balancing`(v1)이 설치돼 있지 않다. CLB는 추정에서 빠지고 계정 비용(CE)에는 포함된다.
- Pricing API 필터·usagetype 패턴(퍼블릭 IPv4 `PublicIPv4:InUseAddress`, EKS `AmazonEKS-Hours:perCluster`/`extendedSupport`, EBS `System Operation`/`Provisioned Throughput`)은 실제 응답으로 확인하지 않았다. 틀려도 해당 리소스가 "단가 없음"으로 보일 뿐 합계가 부풀지는 않는다.
- io2 구간 요금은 첫 구간(가장 비싼) 단가를 쓴다 → 상한 쪽 추정.
- EKS 지원 등급은 버전 일정표(`eks-support.ts`)에 의존한다. 새 버전이 나오면 갱신 필요.
- EBS CSI 태그가 없는 in-tree 볼륨은 "클러스터 외"로 분류된다(3단계 결정 그대로).
- CE 예측 80% 구간의 월말 하한·상한은 일별 구간의 합이라 실제 구간보다 넓다.
- 보존 정리(`purgeExpiredData`)는 cost 모듈에서 호출하지 않는다. 여러 기능의 테이블을 함께 지우므로 A 또는 PM이 한 곳에서 호출하는 편이 맞다.
- DB 없이 live로 실행하면 CE 캐시·소모율 기록이 메모리에만 있어 재시작 시 CE를 다시 부를 수 있다(`rate-series` 응답에 `persistence: "memory"`).
- live 인벤토리 어댑터가 아직 연결되지 않았다(9절). 연결 전에는 배분이 unknown.

### 8. 다른 담당 요청
- `A/PM 요청` (env, `src/config/env.validation.ts`): 새 변수 선언 — `EKS_CLUSTER_NAME`(선택), `COST_MONTHLY_BUDGET_USD`(선택, >0), `COST_EXPLORER_METRIC`(선택, `UnblendedCost|AmortizedCost`), `COST_EXPLORER_DAILY_CALL_LIMIT`(선택, 1~200). 지금은 `ConfigService.get`(process.env 대체)으로 읽고 없으면 기본값을 쓴다. `COST_EXPLORER_CACHE_TTL_SEC`의 `@Min(0)`은 `@Min(3600)`으로 바꿔 주기 바람(코드에서도 강제 중). `.env.example`에도 위 항목 추가.
- `PM 요청` (live 연결): `CostModule`의 `CLUSTER_INVENTORY_PORT` provider를 `ClusterStateService` 어댑터로 교체하고 `ClusterModule`을 imports에 추가(9절 시그니처). `changes$`(노드·PVC·서비스·인그레스 변경)까지 연결하면 5분을 기다리지 않고 10초 뒤 재계산한다.
- `A 요청` (mock API): `GET /api/mock/scenarios`의 cost 메뉴 이름·설명은 `CostMockScenarioTarget.options`, 기본값은 `defaultScenario`('normal'). `POST /api/mock/reset`은 `setScenario('normal')`만 호출하면 시계열까지 초기화된다.
- `A 요청` (보존 정리): `purgeExpiredData`를 하루 1회 + 시작 시 호출하는 곳을 한 군데 둘 것.
- `frontend 요청`: `summary.monthToDate.amount`는 어제까지 합(어제는 미확정), `settledThrough`는 그저께. `summary.monthEnd.estimated`는 추정할 수 없을 때 `null`. 추가 필드: `actual.stale`/`staleReason`, `estimate.stale`. mock `ce-limit-reached` 시나리오는 `disabledReason: "daily_limit"`(그 밖의 mock은 `"mock"`).
- `DBA 요청`: 없음. (과금 여부는 `estimated_cost_usd = 0`으로 표현. 별도 `billable` 컬럼이 필요해지면 다시 요청)
- `패키지 요청`(선택, PM 판단): CLB까지 추정하려면 `@aws-sdk/client-elastic-load-balancing`.

### 9. 다음 담당이 알아야 할 점

**`ClusterInventoryPort` 시그니처** (`apps/api/src/cost/cluster-inventory.port.ts`, 토큰 `CLUSTER_INVENTORY_PORT`)
```ts
interface ClusterInventoryPort {
  snapshot(): ClusterInventorySnapshot;          // 메모리에서 즉시 반환 (쿠버네티스 API 호출 없음)
  readonly changes$?: Observable<void>;          // 노드·PVC·서비스·인그레스 변경 알림 (선택)
}
interface ClusterInventorySnapshot {
  state: 'ok' | 'syncing' | 'stale' | 'unavailable' | 'not_configured';
  updatedAt: Date | null;
  nodes: { name: string; providerId: string | null /* aws:///az/i-... */; instanceType: string | null;
           capacityType: 'on_demand' | 'spot' | null; zone: string | null; nodeGroup: string | null;
           architecture: string | null; allocatable: { cpuMillicores: number; memoryBytes: number } }[];
  pods: { namespace: string; name: string; nodeName: string | null; phase: string;
          cpuMillicores: number | null /* 컨테이너 requests 합, 없으면 null */; memoryBytes: number | null }[];
  pvcs: { namespace: string; name: string; sizeBytes: number | null; storageClass: string | null;
          volumeHandle: string | null /* PV 권한이 없으면 null → CSI 태그로 대조 */ }[];
  loadBalancers: { kind: 'Service' | 'Ingress'; namespace: string; name: string;
                   hostnames: string[] /* status.loadBalancer.ingress[].hostname */ }[];
}
```
연결 예 (PM, `cost.module.ts`):
```ts
imports: [ClusterModule],
{ provide: CLUSTER_INVENTORY_PORT, inject: [ClusterStateService],
  useFactory: (s: ClusterStateService): ClusterInventoryPort => new ClusterStateInventoryAdapter(s) }
```
- 노드 레이블 해석: `capacityType` ← `eks.amazonaws.com/capacityType`(ON_DEMAND/SPOT) 또는 `karpenter.sh/capacity-type`(on-demand/spot), `nodeGroup` ← `eks.amazonaws.com/nodegroup` 또는 `karpenter.sh/nodepool`.
- mock 모드는 포트를 쓰지 않는다(자체 세계). live에서만 필요하다.

**기타**
- 시계 주입: `COST_CLOCK` 토큰(테스트용). 주기 작업 on/off는 `CostOptions.timers`(모듈에서는 true).
- 다른 모듈이 비용 값을 쓰려면 export된 `CostService`의 `getSummary()`/`overviewSummary()`/`advisorCostBlock()`를 쓴다. 자기 API를 HTTP로 부르지 말 것.
- CE를 부르는 코드는 `CostExplorerService` 하나뿐이다. 새 경로가 생겨도 이 클래스를 거쳐야 캐시·잠금·상한이 지켜진다.

---

## 2026-09-19 · 모듈 연결 (4단계 마무리: cost ↔ cluster)

### 1. 요청 내용
- PM 요청: (1) `CLUSTER_INVENTORY_PORT`를 `ClusterStateService.inventorySnapshot()`·`changes$`로 잇는 어댑터, `CostModule` → `ClusterModule` import, 순환 참조 확인, mock 인벤토리 출처 판단 (2) `MockScenarioTarget` 선택 필드 정식화 (3) `docs/api/cluster-status.md` DaemonSet 설명 정정, `docs/api/common.md` 반영 (4) lint·tsc·test·build + mock :3031 기동 확인.
- 작업 중 추가(PM): `ADVISOR_MAX_TURNS` env 선언(정수 1~5, 기본값 없음) + `.env.example`.
- 제약: `src/advisor/**`, `apps/agent-bridge/**` 수정 금지(C 작업 중). 프로세스 종료는 PID 지정.

### 2. 참고한 문서
- `CLAUDE.md`, `docs/reports/cluster-status/backend.md` 4단계 A 9·10절, 이 보고서 4단계 B 9절, `src/cost/cluster-inventory.port.ts`, `src/cost/cost.module.ts`, `src/common/extension-points.ts`, `src/common/overview-summary.ts`, `src/stream/mock-scenario.service.ts`, `src/cluster/mock/*`, `src/cluster/kube/extract.ts`(DaemonSet), `deploy/rbac.yaml`

### 3. 작업 내용

#### 3.1 live·mock 공통 인벤토리 어댑터
- 새 파일 `src/cost/cluster-state.inventory.ts`: `ClusterStateInventoryAdapter implements ClusterInventoryPort`
  - `snapshot()` = `ClusterStateService.inventorySnapshot()` (메모리 캐시만).
  - `changes$`: `ClusterStateService.changes$`는 평가마다(최대 500ms에 1회 + **15초마다**) 울린다. 그대로 넘기면 live에서 10초 debounce + 30초 최소 간격마다 `refreshEstimate()`가 돌아 **AWS Describe* 호출이 30초마다** 생긴다. 그래서 **노드·PVC·LB 호스트 이름·인벤토리 상태의 지문**(`inventoryFingerprint`, 순서 무관)이 바뀔 때만 알린다. 파드만 바뀐 경우는 알리지 않는다(배분은 5분 주기 갱신에서 반영). 기준 지문은 구독 시점에 잡는다(`defer`).
  - `backedByCluster = true` (포트의 새 선택 필드, 3.2).
- `CostModule`: `imports: [ClusterModule]`, `CLUSTER_INVENTORY_PORT`를 `inject: [ClusterStateService]` → 어댑터로 교체. `NotConfiguredClusterInventory`는 포트 파일에 남김(단위 테스트용).
- **순환 참조 없음**: `ClusterModule`은 `DiscoveryModule`만 import하고 cluster 코드에 cost import가 없다. 개요 카드는 `DiscoveryService`로 `CostOverviewSummary`를 찾는다. 의존 방향은 Cost → Cluster, DbHealth → Cluster, Advisor → Discovery만. `nest build`와 앱 기동으로 확인.

#### 3.2 포트 변경 (하위 호환, 모두 선택 필드)
- `ClusterInventoryPort.backedByCluster?: boolean`: 클러스터 캐시에 연결된 구현인지 표시. mock 세계 출처 판단용.
- `InventoryPvc.phase?: string`: mock 세계가 Bound PVC에만 볼륨을 만들 때 쓴다. `ClusterStateService.inventorySnapshot()`(`ClusterInventoryView`)이 `phase`를 채운다.

#### 3.3 mock 인벤토리 출처 결정: **cluster mock 인벤토리를 쓴다**
이유:
- 권장대로 두 화면(클러스터·비용)의 노드·파드가 일치해야 한다. 자체 세계를 유지하면 노드 이름·수(5대 vs 6대), 노드그룹(`general/batch/spot-workers` vs `system/batch/app`), 네임스페이스가 서로 달라 개요 카드와 어드바이저 스냅샷(cluster 블록과 cost 블록)이 모순된다.
- live와 같은 경로(포트 → 추정 계산)를 mock에서도 거치므로 어댑터와 포트가 mock에서도 늘 검증된다.
- cluster 시나리오(no-cluster, kube-stale, empty 등)가 비용 화면에도 자연스럽게 반영된다(live와 같은 동작).

구현 (`src/cost/mock/mock-world.ts`, `src/cost/cost.service.ts`):
- `buildMockWorld(scenario, now, base?)`: `base`(cluster 인벤토리)가 있으면 `buildMockWorldFromCluster`를 쓴다.
  - 인벤토리: base의 노드·파드·PVC·LB 그대로.
  - EC2: 노드마다 1대. 인스턴스 ID는 providerID에서 뽑는다(없거나 형식이 다르면 노드 이름으로 결정적 생성). 스팟 노드는 퍼블릭 IPv4 1개, 루트 볼륨 gp3 20GiB.
  - EBS: **Bound** PVC마다 1개(Pending·Lost는 볼륨 없음). 종류는 storageClass(gp3/gp2/io2 등, 그 밖은 gp3). 붙는 노드는 `<claim>-<pod>` 이름 규칙의 파드 → 같은 네임스페이스 파드 순으로 추정.
  - ELB: LoadBalancer 서비스·인그레스 호스트 이름마다 1개. 인그레스 → ALB, `*.elb.<region>.amazonaws.com` → NLB, 그 밖 → CLB. **live는 CLB를 조회하지 않으므로(SDK 없음) CLB는 `unpriced` 시나리오에서만** 넣는다(그래서 `normal`에 단가 없음 경고가 생기지 않는다).
  - 클러스터 밖 리소스(다른 클러스터 볼륨 2개, 마케팅 ALB)와 대상 없는 태그 NLB는 자체 세계와 같은 상수(`OTHER_CLUSTER_VOLUMES`, `UNATTACHED_LBS`)를 공유.
  - 시나리오 가상 노드: `spike-warning` +3, `spike-critical` +6(m6i.xlarge 온디맨드, burst 파드), `unpriced` GPU 노드(g6e.xlarge, trainer 파드). **이 노드들은 비용 화면에만 있다**. cluster mock은 비용 시나리오를 모른다(모듈 간 결합을 늘리지 않으려는 선택). 계약 `common.md` 6.1에 적었다.
- `base`가 없으면 기존 자체 세계(단위 테스트·포트 미연결).
- `CostService.buildWorld()`:
  - 포트가 `backedByCluster`가 아니면 자체 세계(기존 테스트 그대로).
  - 연결돼 있으면 `snapshot()`이 `ok|stale`일 때 그것을 base로 쓰고 기억한다(`lastMockBase`). 쓸 수 없으면(no-cluster 등) AWS 쪽은 마지막 base(없으면 자체 세계)로 만들고 인벤토리는 그 상태 그대로 넘긴다 → EC2는 AWS 목록으로 추정, 배분은 `SOURCE_NOT_CONFIGURED`/`SOURCE_SYNCING`(live와 같은 규칙).
  - mock 추정은 계산할 때마다(시나리오 전환, 60초 틱) 세계를 다시 만든다. 기준 소모율(급증 원인 비교용 `normal` 세계)도 같은 base로 만든다.
  - 시작 시: 생성자 시점에는 cluster mock이 아직 비어 있을 수 있어 `start()`(onApplicationBootstrap)에서 다시 만든다.
  - `timers`가 켜져 있으면 포트 `changes$`(1초 debounce)를 구독한다. cluster 시나리오를 바꾸면 다시 계산하고 `cost.snapshot`을 보낸다(common.md 6 "시나리오를 바꾸면 영향 받는 토픽의 snapshot 재전송").
- 단가: `m7g.xlarge` 스팟 기준가(0.0672) 추가(cluster mock 스팟 노드 타입). `spot-fallback`의 실패 타입은 c7i.xlarge 스팟 노드가 있으면 그것(자체 세계, 기존 동작), 없으면 이름순 마지막 스팟 노드의 타입 → 대체 1건 유지.
- cluster mock 노드 providerID를 EC2 ID 형식(`i-0` + 16진수 16자리)으로 수정(`src/cluster/mock/mock-world.ts`). 이전 값은 36진수라 `instanceIdFromProviderId`와 `listNodes().instanceId`가 null이었다(cluster 쪽 버그이기도 함).

#### 3.4 공유 인터페이스 (`src/common/extension-points.ts`)
- `MockScenarioTarget`에 선택 필드 추가: `options?`(id·label·description?), `defaultScenario?`, `readonly fastTimers?: boolean`(getter 가능), `setFastTimers?(value)`. `setScenario` 주석에 HttpException 전파 동작을 적었다.
- `src/stream/mock-scenario.service.ts`: 구조적 캐스트(`MockTargetExtras`)를 없애고 인터페이스 필드를 직접 읽는다. `fastTimers`는 예전 함수 형태도 받도록 `MockTargetCompat` 타입만 남김.
- 구현체 컴파일 확인: cluster(`MockClusterService`), db(`DbHealthService`), cost(`CostMockScenarioTarget`), advisor(`AdvisorMockScenarios`, getter `fastTimers` + `setFastTimers`). **advisor 파일은 수정하지 않음**, `tsc` 0건.
- `OverviewSummaryProvider`(`overview-summary.ts`)는 변경 없음. 이번 연결 후 `CostOverviewSummary`가 개요 `cost` 블록을 채우는 것을 기동으로 확인.

#### 3.5 계약 문서
- `docs/api/cluster-status.md`: 1.2 `replicas.desired`(DaemonSet = `desiredNumberScheduled`)와 `source`(모두 `watch`, `derived_from_pods`는 예약값), 6.1 DaemonSet을 watch 기준으로 다시 씀(RBAC `daemonsets` 포함, 판단 규칙), 9절 `DAEMONSET_DESIRED_UNKNOWN` 폐기 표시, 12절 1번 "해결", 13절 변경 이력 신설. 구현(`extractDaemonSet`, `kube-watcher`의 daemonsets informer)과 대조해 작성.
- `docs/api/common.md`: 6.1에 "그룹 사이의 관계 (cluster → cost)" 추가, 8절 변경 이력(응답 모양 변경 없음, 내부 확장점 정식화는 API에 영향 없음).
- `docs/api/aws-cost.md`: 머리말에 mock 인벤토리가 cluster mock과 같다는 한 줄 추가.

#### 3.6 추가 요청: `ADVISOR_MAX_TURNS`
- `src/config/env.validation.ts`: `@IsOptional() @IsInt() @Min(1) @Max(5) ADVISOR_MAX_TURNS?`. 기본값 없음(advisor가 env → settings → 코드 기본값 순서로 판단).
- 루트 `.env.example`에 주석과 함께 추가, `docker-compose.yml` api 환경에 `ADVISOR_MAX_TURNS: ${ADVISOR_MAX_TURNS:-}` 추가(다른 ADVISOR_* 변수와 같은 방식).

### 4. 변경 파일
| 파일 | 내용 |
|---|---|
| `apps/api/src/cost/cluster-state.inventory.ts` (신규) | 어댑터 + 인벤토리 지문 |
| `apps/api/src/cost/cluster-state.inventory.spec.ts` (신규) | 어댑터 테스트 3개 |
| `apps/api/src/cost/cost.module.ts` | ClusterModule import, 포트 provider 교체 |
| `apps/api/src/cost/cluster-inventory.port.ts` | 주석, `backedByCluster?`, `InventoryPvc.phase?` |
| `apps/api/src/cost/cost.service.ts` | `buildWorld`, `lastMockBase`, mock 배분 unknown 처리, 인벤토리 변경 구독과 snapshot 재전송 |
| `apps/api/src/cost/mock/mock-world.ts` | `buildMockWorldFromCluster`, 공유 상수, m7g.xlarge 스팟, spot-fallback 타입 선택 |
| `apps/api/src/cost/cost.service.spec.ts` | cluster mock 인벤토리 포트로 12개 시나리오 재현 + 대조·unknown 테스트 |
| `apps/api/src/cost/cost.module.spec.ts` | CommonModule·PrismaModule·검증된 env로 부팅, `/api/cluster/nodes` ↔ `/api/cost/estimate` 노드 일치와 배분 네임스페이스 테스트 |
| `apps/api/src/cluster/mock/mock-world.ts` | providerID를 EC2 ID 형식으로 |
| `apps/api/src/cluster/state/cluster-state.service.ts` | `inventorySnapshot().pvcs[].phase` |
| `apps/api/src/common/extension-points.ts` | `MockScenarioTarget` 선택 필드 |
| `apps/api/src/stream/mock-scenario.service.ts` | 인터페이스 필드 직접 사용 |
| `apps/api/src/config/env.validation.ts` | `ADVISOR_MAX_TURNS` |
| `.env.example`, `docker-compose.yml` | `ADVISOR_MAX_TURNS` |
| `docs/api/cluster-status.md`, `docs/api/common.md`, `docs/api/aws-cost.md` | 3.5 |

### 5. 주요 결정과 이유
- **changes$ 지문 필터**: live에서 AWS 호출 폭주를 막는다(3.1). 파드 변화는 비용 리소스 목록을 바꾸지 않는다.
- **mock은 cluster 인벤토리 사용**(3.3). 비용 시나리오 가상 노드만 예외로 두고 계약에 적었다.
- **CLB는 unpriced에서만**: live가 CLB를 가져오지 못하는 현실과 맞춘다.
- **인벤토리를 쓸 수 없을 때 AWS 쪽은 마지막 base**: 클러스터 연결이 끊겨도 AWS 리소스는 그대로 있다는 live의 의미와 같다.
- **포트 필드 추가는 선택 필드로만**: B의 포트 사용처와 테스트를 깨지 않는다.

### 6. 검증 결과
| 명령 | 결과 |
|---|---|
| `npm run lint:check --prefix apps/api` | 0건 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 0건 |
| `npm test --prefix apps/api` | 29 suites, 285 passed, 1 skipped |
| `npm run build --prefix apps/api` | 성공 (`dist/`) |
| `DATA_SOURCE=mock PORT=3031 node dist/main.js` | 기동 성공. `/api/cluster/nodes` 6개 = `/api/cost/estimate`의 `resources.ec2[].nodeName` 6개 **일치**(모두 instanceId 대조됨, 단가 없음 0, 총 $0.8689/h). EBS: 노드 루트 6 + PVC 4(data-postgres-0/1, data-redis-0, grafana; Pending `scratch` 제외). LB: api(NLB), web(ALB), 태그 NLB. cost `summary.status` ok |
| 시나리오 전환(같은 기동) | cluster `no-cluster` → 비용 EC2 6행 유지(nodeName 없음), 배분 `SOURCE_NOT_CONFIGURED`. cluster `healthy` → 배분 복구, SSE `cost.snapshot` 재전송 확인. cost `spike-warning` → EC2 9행. `POST /api/mock/reset` 200. `/api/advisor/snapshot-preview` 200 |
| 종료 | 띄운 프로세스만 PID로 종료(`kill <pid>`), 포트 응답 없음 확인 |

### 7. 남은 이슈·한계
- mock EKS 버전: 비용 mock은 `1.34`(표준 지원), cluster mock은 `v1.30.4`. 1.30은 2026-09 기준 확장 지원($0.60/h)이라 맞추면 normal 비용이 크게 바뀐다. 포트에 버전 필드가 없어 이번에는 그대로 뒀다. 그 결과 어드바이저 스냅샷에서 cluster.version(1.30)과 비용 EKS 단가(표준)가 어긋난다. 정리 방법: cluster mock 버전을 1.34로 올리거나 포트에 버전을 추가(PM 판단).
- 비용 시나리오 `spike-*`·`unpriced`의 가상 노드는 비용 화면에만 있다(계약에 명시).
- mock PVC 볼륨이 붙은 노드는 이름 규칙으로 추정한다(정확하지 않을 수 있음, 비용 합계에는 영향 없음).
- live에서 파드만 바뀌면 배분은 다음 주기(기본 5분)까지 이전 값을 보여준다.

### 8. 다른 담당 요청
- `PM 판단`: 7절 EKS 버전 불일치 처리.
- `frontend 참고`: cluster mock 시나리오를 바꾸면 비용 화면도 바뀐다(`cost.snapshot` 재전송). 비용 급증 시나리오의 추가 노드는 클러스터 화면에 없다.
- `C(advisor) 참고`: `MockScenarioTarget`에 `fastTimers`/`setFastTimers`가 정식 선택 필드가 됐다. 현재 구현(getter + 메서드)이 그대로 호환되므로 수정할 필요 없음. `ADVISOR_MAX_TURNS` env 선언 완료.
- `DBA 요청`: 없음.

### 9. 다음 담당이 알아야 할 점
- 포트 연결: `CostModule` → `ClusterStateInventoryAdapter(ClusterStateService)`. 비용 쪽에 클러스터 데이터가 더 필요하면 `ClusterInventoryView`(cluster)와 `ClusterInventorySnapshot`(cost)을 **함께** 늘리고 선택 필드로 추가할 것.
- `changes$`를 울리는 조건은 `inventoryFingerprint()`에 있다. 비용에 영향을 주는 필드를 추가하면 지문에도 넣을 것.
- mock 세계를 만드는 곳은 `CostService.buildWorld()` 한 곳이다.

---

## 2026-09-19 · 계약 정리 + EKS 버전 기준 (4단계 마무리 후속)

### 1. 요청 내용
- PM(프론트 5a 결과): (1) `summary.monthEnd.estimated` null 조건 명시 (2) 프론트가 찾은 "계약에 없는 필드" 처리 (3) CE 상태에 `refreshEstimatedCostUsd` 추가 + 계약.
- PM 결정(EKS 버전): 클러스터 버전을 기준으로 삼는다. 포트·스냅샷에 `kubernetesVersion`(선택)을 추가하고, live에서는 `eks:DescribeCluster` 값을 우선한다. mock 클러스터 버전은 1.34로 올린다. 확장 지원 케이스는 시나리오 또는 테스트로 고정한다.
- 제약: 프로세스는 PID로만 종료, 포트는 3031만 사용.

### 2. 참고한 문서
- `docs/reports/cluster-status/frontend.md`(5a 검증 표 "추가 필드만"·8절 백엔드 요청), `docs/reports/aws-cost/frontend.md`(5절·8절), `docs/api/aws-cost.md`, `docs/api/cluster-status.md` 2.1, `src/cost/estimate/eks-support.ts`, `src/advisor/precheck/precheck-rules.ts`(R-EKSVER, 읽기만)

### 3. 작업 내용

#### 3.1 프론트가 찾은 필드: 모두 **의도된 필드 → 계약에 추가** (응답에서 뺀 것 없음)
| 필드 | 판단 | 반영 |
|---|---|---|
| `summary.monthEnd.estimated` null 가능 | 의도됨 | `aws-cost.md` 2.1 표: 실시간 추정이 없을 때(`rate.available: false`와 같은 조건 — `AWS_NOT_CONFIGURED`, `SOURCE_SYNCING`, 리소스·단가 조회 실패 + 이전 추정 없음) null. CE가 없는 것만으로는 null이 아니다(`elapsed_rate`). `estimate.monthEnd`도 같음 |
| `estimate.stale` | 의도됨 (`awsResources` 출처 stale 표시) | 3.1 예시·표에 추가. mock은 항상 false |
| `actual.stale` / `staleReason` | 의도됨 (계약 5.1 "변형"에 있었지만 예시·표에 없었음) | 5.1 예시·표에 추가, **항상 포함**으로 명시 |
| `status.thresholds.*` | 계약 4절에 이미 같은 키로 있음 | 변경 없음. 프론트 fixture가 `thresholds: {}`라 추가 필드로 보인 것 |
| `overview.advisor.status` | 의도됨 (`OverviewSummaryProvider`가 요구하는 `StatusInfo`, `nav.advisor`·`nav.stale.advisor` 근거) | `cluster-status.md` 2.1 예시·표에 추가. 요약을 못 만들 때의 대체 블록에도 `status: unknown`을 넣음(`overview.service.ts`, 계약 문구와 일치시킴) |

#### 3.2 CE 새로고침 예상 비용
- `RefreshView`에 `maxCallsPerRefresh`(= GetCostAndUsage 최대 페이지 3 + GetCostForecast 1 = 4)와 `refreshEstimatedCostUsd`(= `maxCallsPerRefresh × callCostUsd`, 기본 $0.04)를 추가했다. live(`CostExplorerService.refreshView`)와 mock 모두 같은 값을 준다. `callsPerRefresh`(보통 2)는 그대로 둔다.
- 확인창에 "최대 N회"를 화면 계산 없이 보여 줄 수 있게 `maxCallsPerRefresh`도 같이 내린다.
- 계약 `aws-cost.md` 5.2 예시·표에 반영했다. `/api/cost/explorer/refresh`, `/api/cost/actual`의 `refresh`, `cost.snapshot`·`cost.refresh.updated`의 refresh 모두 같은 모양이다.

#### 3.3 EKS 지원 등급 = 클러스터 버전 기준 (PM 결정)
- 포트: `ClusterInventorySnapshot.kubernetesVersion?: string | null`(major.minor). `ClusterStateService.inventorySnapshot()`이 API 서버 버전(`store.info.version`, 예 `v1.34.1`)에서 `1.34`를 만든다. 어댑터 지문에도 넣어서 버전이 바뀌면 `changes$`가 울린다. 정규화 함수 `k8sMinorVersion()`은 `cluster-inventory.port.ts`에 있다.
- live(`fetchAwsResources`): `eks:DescribeCluster` 결과(이전 성공값 포함)가 있으면 그 버전을 쓰고, 없으면 인벤토리 버전으로 EKS 행을 만든다(`name` = `EKS_CLUSTER_NAME` 또는 `eks-cluster`). 인벤토리를 쓸 수 없고 DescribeCluster도 없으면 EKS 행은 없다(기존과 같음).
- mock: cluster mock 버전 `v1.30.4` → **`v1.34.1`**(kubelet `v1.34.1-eks-…`, kube-proxy 이미지 `v1.34.1-eksbuild.2`). 비용 mock 세계의 EKS 버전은 base 인벤토리 버전을 쓴다(없으면 기존 1.34). normal 비용 값은 그대로다(표준 $0.10/h).
- 어드바이저 스냅샷 cluster 블록: `supportTier`를 null 대신 클러스터 버전으로 계산한다(`cluster-advisor.snapshot.ts`, 비용과 같은 일정표 `eksSupportTier`). 이제 R-EKSVER 사전 점검이 실제 버전으로 동작한다. mock 1.34는 standard라 규칙이 걸리지 않는다.
- **확장 지원 케이스는 테스트로 고정**했다(시나리오 추가 안 함). 새 시나리오를 만들면 계약 목록·프론트 메뉴가 바뀌고, 기존 시나리오에 섞으면 그 시나리오의 뜻이 흐려지기 때문이다.
  - mock: cluster mock 인벤토리 1.34 → standard $0.10/h, 버전을 1.30으로 바꾼 인벤토리 → extended $0.60/h
  - live: DescribeCluster 1.34 + 클러스터 1.30 → 1.34 standard(DescribeCluster 우선), DescribeCluster 없음 + 클러스터 1.31 → 1.31 extended

### 4. 변경 파일
| 파일 | 내용 |
|---|---|
| `apps/api/src/cost/cost.types.ts` | `RefreshView.maxCallsPerRefresh`, `refreshEstimatedCostUsd` |
| `apps/api/src/cost/explorer/cost-explorer.service.ts` | `MAX_CALLS_PER_REFRESH`, `refreshEstimatedCostUsd()` |
| `apps/api/src/cost/cost.service.ts` | mock 상태에 새 필드, live EKS 버전 대체 |
| `apps/api/src/cost/cluster-inventory.port.ts` | `kubernetesVersion?`, `k8sMinorVersion()` |
| `apps/api/src/cost/cluster-state.inventory.ts` | 지문에 버전 포함 |
| `apps/api/src/cost/mock/mock-world.ts` | 파생 세계 EKS 버전 = 클러스터 버전 |
| `apps/api/src/cost/cost.service.spec.ts` | EKS 등급 테스트(mock 2, live 2), CE 예상 비용 테스트 |
| `apps/api/src/cluster/state/cluster-state.service.ts` | `inventorySnapshot().kubernetesVersion` |
| `apps/api/src/cluster/mock/mock-world.ts` | 클러스터 버전 1.34 |
| `apps/api/src/cluster/cluster-advisor.snapshot.ts` | `supportTier` 계산 |
| `apps/api/src/cluster/overview.service.ts` | 대체 advisor 블록에 `status` |
| `apps/api/src/common/overview-summary.ts` | 주석(advisor 요약에 `status`) |
| `docs/api/aws-cost.md` | 2.1·3.1·5.1·5.2 표와 예시, 11절 8번, 12절 변경 이력(신설). 3.1 예시의 EKS 버전을 1.30 standard → 1.34로 정정(1.30은 이미 확장 지원) |
| `docs/api/cluster-status.md` | 2.1 `advisor.status`, 13절 이력 |

### 5. 주요 결정과 이유
- 프론트가 찾은 필드는 모두 화면이 쓸 수 있는 의미 있는 값이라 빼지 않고 계약에 넣었다.
- `refreshEstimatedCostUsd`는 **최대치**로 잡았다(페이지 3개 기준). 확인창에서 비용을 적게 말하지 않기 위해서다.
- EKS 버전을 인벤토리로 대체하는 것은 DescribeCluster가 없을 때뿐이다. 두 값이 다를 수 있는 업그레이드 도중에는 AWS 값이 과금 기준이므로 DescribeCluster를 우선한다.

### 6. 검증 결과
| 명령 | 결과 |
|---|---|
| `npm run lint:check --prefix apps/api` | 0건 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 0건 |
| `npm test --prefix apps/api` | 29 suites, 289 passed, 1 skipped |
| `npm run build --prefix apps/api` | 성공 |
| mock :3031 기동 (PID 지정 종료) | 클러스터·비용 노드 6개 일치. EKS `1.34 standard $0.10/h`. `/api/cost/explorer/refresh` → `callsPerRefresh 2, maxCallsPerRefresh 4, refreshEstimatedCostUsd 0.04`. `/api/cost/actual` → `stale false, staleReason null`. `/api/overview` → `advisor.status` 있음, `cluster.version v1.34.1`. `/api/advisor/snapshot-preview` cluster → `version 1.34, supportTier standard` |

### 7. 남은 이슈·한계
- advisor 예시 응답 fixture(`src/advisor/mock/mock-fixtures.ts`, C 영역)는 여전히 `version: '1.30', supportTier: 'standard'`다. 1.30은 일정표상 확장 지원이라 예시 내용과 맞지 않는다(예시 응답일 뿐 계산에는 쓰이지 않음).
- live에서 DescribeCluster 권한이 없고 `EKS_CLUSTER_NAME`도 없으면 EKS 행 이름은 `eks-cluster`로 나온다.

### 8. 다른 담당 요청
- `frontend 요청`: 확인창은 `refreshEstimatedCostUsd`(최대 예상 비용)와 `maxCallsPerRefresh`를 그대로 표시한다. `summary.monthEnd.estimated`·`estimate.monthEnd` null 방어는 유지, `actual.stale/staleReason`은 항상 온다.
- `designer 참고`: 확인창 값은 "최대" 기준이다(기본 4회 · $0.04).
- `C(advisor) 참고`: 7절 fixture 버전(선택). 스냅샷 `cluster.supportTier`가 이제 채워져 R-EKSVER가 live 버전으로 동작한다.
- `DBA 요청`: 없음.

### 9. 다음 담당이 알아야 할 점
- EKS 등급의 입력 순서: `DescribeCluster(이번 조회) → 이전 DescribeCluster 성공값 → 인벤토리 kubernetesVersion`. 모두 `fetchAwsResources()` 한 곳에서 정한다.
- 호출 수 상수(`CALLS_PER_REFRESH`, `MAX_CAU_PAGES`, `MAX_CALLS_PER_REFRESH`)는 `explorer/cost-explorer.service.ts`에 있다. 페이지 상한을 바꾸면 예상 비용도 따라 바뀐다.
