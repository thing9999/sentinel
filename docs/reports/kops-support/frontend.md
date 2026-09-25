# kops-support · frontend 작업 보고

> 파일 위치: `docs/reports/kops-support/frontend.md`
> 같은 기능에서 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다.

## 2026-09-24 08:30 · 백엔드 P1·P2 정합 맞추기 + 디자인 선행분 (컨트롤 플레인 화면 통합 제외)

### 1. 요청 내용

PM 지시: 백엔드 P1·P2가 끝나 **웹과 API가 어긋난 상태**를 맞추고, 디자인에서 올라온 선행 항목을 처리한다. **컨트롤 플레인 화면 통합은 이번 범위 밖**(백엔드 P3 진행 중).

1. **지금 어긋난 것(최우선)** — 배분 breakdown 필드 `eksUsdPerHour` → `controlPlaneUsdPerHour`. **카테고리 이름(`eks`)은 그대로**이므로 카테고리 라벨·순서는 건드리지 않는다(P4).
2. **노드 목록 역할 분리(AC-KOPS10~13, 16)** — `NodeItem.role`, 기본 `?role=worker`, `control_plane`·`all`. 서버가 `roleCounts`·`facets.roles`를 주므로 화면에서 더하지 않는다. `/api/cluster/metrics`의 `cpu`/`memory`와 `controlPlane`을 **더하지 않는다**. 개요 요약 띠의 노드 수는 워커 기준, 부제에 컨트롤 플레인 별도.
3. **상단바 긴 FQDN** — `shell.md` 2.1대로 `ResourceName kind="cluster"` + `tooltipExtra` + 축소 순서 적용.

하지 않을 것: `GET /api/cluster/control-plane` 연결(P3, 404), 비용 카테고리 라벨 교체(P4), 화면에서 상태 계산, `components/ui/**`·`styles/**`(퍼블리셔) 및 `apps/api/**`(백엔드 동시 작업 중) 수정.

검증: lint·typecheck·test·build + mock API 실제 화면 확인. 포트 웹 3123 / mock API 3124. 자기가 띄운 PID만 종료.

### 2. 참고한 문서

- `docs/reports/kops-support/README.md` — PM 결정 기록, "다음 단계 인계 > 프론트", 확정 이름 규약
- `docs/reports/kops-support/backend.md` — P1·P2 섹션 8절 "frontend 요청 1~4", 9절
- `docs/reports/kops-support/publisher.md` — 8절 프론트 요청 ①~③, 9절 인터페이스 요약, 7절 6번(TopBar 미적용)
- `docs/api/cluster-status.md` — 1.1 `NodeItem.role`, 2.1 `areas.controlPlane`, 3.1 `role` 일관성 표, 7.2 `scope`·`controlPlane`, 7.3 `scope`, 8.2 `cluster.snapshot`
- `docs/api/aws-cost.md` — 3.2 배분 `breakdown.controlPlaneUsdPerHour`
- `docs/design/shell.md` 2.1 — 긴 FQDN 처리, `docs/design/cluster-status.md` 2.2·2.5·3.3
- `docs/specs/kops-support.md` — 1.2 배경, 5절 AC-KOPS01~17
- 계약 확인용으로 **API 소스를 읽기만** 했다: `apps/api/src/cluster/cluster-query.service.ts`(roleCounts), `state/evaluate.ts`(`scope`), `cluster/types.ts`

### 3. 작업 내용

#### 3.1 배분 breakdown 필드 이름 (요청 1)

- `features/aws-cost/types.ts`의 `AllocationBreakdown.eksUsdPerHour?` → **`controlPlaneUsdPerHour?`** (주석에 구 이름과 근거 명시).
- `features/__fixtures__/fixtures.ts`의 `shared_cluster` 행 breakdown 값도 함께 교체.
- **카테고리는 손대지 않았다**: `CostCategory`의 `"eks"`, `CATEGORY_ORDER`/`CATEGORY_LABEL`(`CostTables.tsx`), `resources.eks[]`는 그대로다. 퍼블리셔가 만들어 둔 `COST_CATEGORY_LABEL`·`CONTROL_PLANE_KIND_LABEL`도 **쓰지 않았다**(P4 지시 대기).
- 배분 표에는 컨트롤 플레인 열이 없다(`docs/design/aws-cost.md` 2.6 열 정의: 노드·스토리지·LB 3개뿐). 마스터 몫은 `공용(클러스터)` 행의 금액에 포함돼 표시되고, breakdown은 타입·계약 정합용이다.

#### 3.2 노드 역할 분리 (요청 2)

**타입** (`features/cluster-status/types.ts`)
- `NodeRole = "worker" | "control_plane"` 신설, `NodeItem.role` 필수 필드 추가.
- `ControlPlaneArea`(계약 2.1 그대로) 추가 후 `Areas.controlPlane?`로 **optional** 연결 — 백엔드 P3 전에는 응답에 없다.
- `AttentionArea`에 `"control_plane"` 추가.
- `ClusterMetricsBody.scope`(`basis:"worker"`, worker/controlPlane 노드 수)와 `ClusterMetricsBody.controlPlane`(`ControlPlaneMetricsBlock`) 추가.
- `MetricsSeriesResponse.scope?`(`target=cluster`일 때만) 추가.

**선택자** (`features/cluster-status/selectors.ts`)
- `parseRoleFilter(v)` — `worker`(기본)·`control_plane`·`all`. 모르는 값은 `worker`로 떨어진다.
- `splitByRole(nodes)` — **서버가 준 `role`만** 보고 나눈다. 이름·라벨 추론 없음.
- `AREA_LABEL`에 `control_plane: "컨트롤 플레인"` 추가.

**노드 목록** (`features/cluster-status/NodesPage.tsx`)
- URL 쿼리 `?role=`. 기본은 워커만 그린다.
- FilterBar 맨 앞에 역할 `SegmentedControl` (`워커 6 | 컨트롤 플레인 3 | 전체 9`).
- 상태 개수·노드그룹/AZ/구매옵션 후보(facets)·결과 문구를 **모두 현재 역할 안에서** 계산 → 계약 3.1 일관성 표와 같은 동작(`role=worker`면 `control-plane-*` InstanceGroup이 후보에 나오지 않는다).
- 결과 문구: `워커 6개 중 6개 표시` / `컨트롤 플레인 3개 중 3개 표시` / `노드 9개 중 9개 표시`.
- 역할 전환 시 나머지 필터를 비운다(다른 역할에만 있는 값이 남아 "결과 0건"이 되는 것을 막는다).
- 이름 칸: 역할이 `control_plane`·`all`일 때만 `컨트롤 플레인` Chip(`server-cog`). 별도 열을 만들지 않았다(디자인 3.3.2).
- 노드그룹 열 머리에 `circle-help` + kOps InstanceGroup 툴팁(명세 3.3/D2), 폭 140 → **160px**(디자인 3.3.2).
- 빈 상태 문구를 역할별로 분리: 워커 0대면 `워커 노드가 없습니다`(AC-KOPS14 근거를 문구로 남김).

**개요** (`features/cluster-status/OverviewPage.tsx`)
- 요약 띠 노드 칸: 라벨 `노드 Ready (워커)`, 값은 서버 `areas.nodes.ready/total`(이미 워커 기준). 부제(`SummaryStripItem.sub`)에 `컨트롤 플레인 3/3` + `subHref`. `found: false`면 `컨트롤 플레인 —`.
- 클러스터 CPU·메모리 카드에 neutral Chip **`워커 기준`**(`server`) + 툴팁 `컨트롤 플레인 노드는 합계에서 빠집니다…`(디자인 2.5).
- metrics-server 없음 힌트를 **kOps 문구로 교체**: 기존 `EKS 애드온 metrics-server를 설치하면 표시됩니다` → `…kOps 클러스터 설정의 spec.metricsServer.enabled를 켜면 표시됩니다.` + 둘째 줄 파급 안내. **실행 명령(`kops edit/update cluster`)은 넣지 않았다**(AC-KOPS39).
- `cpu`/`memory`와 `controlPlane`을 더하는 코드는 **어디에도 없다**(회귀 테스트로 고정).

**픽스처** (`features/__fixtures__/fixtures.ts`)
- 마스터 3대(`control-plane-ap-northeast-2a/b/c`, `t3.medium`) 추가. `cluster.snapshot.nodes` = 워커 6 + 마스터 3 = 9대(계약 8.2).
- `metricsSnapshot.cluster`에 `scope`(worker 6 / controlPlane 3)·`controlPlane` 블록 추가. `cpu.allocatableMillicores`는 **워커 6 × 1930m 그대로**(마스터를 섞지 않았음을 테스트로 고정).
- `areas.controlPlane` 추가.
- mock 클러스터 이름 `prod-eks` → **`prod.k8s.example.com`**(PM 확정 이름 규약), `kubeletVersion` `v1.30.2-eks-1552ad0` → `v1.30.2`.

#### 3.3 긴 FQDN (요청 3) — **부분 적용, 상단바는 퍼블리셔 요청으로 넘김**

`shell.md` 2.1의 적용 대상은 두 곳이다: ① 상단바 클러스터 정보 ② 개요 요약 띠 클러스터 caption(같은 규칙, 최대 폭 288px).

- **② 요약 띠 caption은 적용했다.** `ResourceName kind="cluster"` + `maxWidth={288}` + `tooltipExtra`(`Kubernetes v1.30.4 · ap-northeast-2`). 내 영역(`features/**`)이고 `SummaryStrip.meta`가 `ReactNode`라 가능했다.
- **① 상단바는 적용하지 못했다.** `TopBar`의 공개 prop이 `cluster: { name: string; version?; region? } | null`이고 내부에서 문자열을 그대로 그린다. `ResourceName`을 넣으려면 `components/ui/shell/TopBar.tsx`와 `shell.module.css`를 고쳐야 하는데, 이번 지시의 "하지 않을 것"과 내 역할 규칙(퍼블리셔 영역은 요청으로 남긴다)에 모두 걸린다. **8절에 실측값과 함께 퍼블리셔 요청으로 남겼다.**
- 대신 **상단바가 실제로 어떻게 동작하는지 브라우저에서 실측**해 "무엇이 아직 성립하지 않는지"를 숫자로 확정했다(6절).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/aws-cost/types.ts` | 수정 | `AllocationBreakdown.eksUsdPerHour` → `controlPlaneUsdPerHour` |
| `apps/web/src/features/cluster-status/types.ts` | 수정 | `NodeRole`·`NodeItem.role`, `ControlPlaneArea`·`Areas.controlPlane?`, `AttentionArea`에 `control_plane`, `ClusterMetricsBody.scope`·`.controlPlane`, `ControlPlaneMetricsBlock`, `MetricsSeriesResponse.scope?` |
| `apps/web/src/features/cluster-status/selectors.ts` | 수정 | `parseRoleFilter`·`splitByRole`·`NodeRoleFilter`, `AREA_LABEL.control_plane` |
| `apps/web/src/features/cluster-status/NodesPage.tsx` | 수정 | 역할 필터·역할 탭·역할 칩·역할별 빈 상태·노드그룹 툴팁·결과 문구 |
| `apps/web/src/features/cluster-status/OverviewPage.tsx` | 수정 | `ClusterMeta`(ResourceName kind=cluster), `ControlPlaneSub`, `워커 기준` 칩, kOps metrics-server 문구 |
| `apps/web/src/features/__fixtures__/fixtures.ts` | 수정 | 마스터 3대, `role`, `scope`/`controlPlane`, `areas.controlPlane`, breakdown 이름, 클러스터 이름·kubelet 버전 |
| `apps/web/src/features/pages.test.tsx` | 수정 | URL 쿼리 홀더(`nav.params`), 노드 역할 테스트 6개, 개요 테스트 3개, 클러스터 이름 |
| `apps/web/src/features/mapping.test.ts` | 수정 | 역할 분류·`parseRoleFilter`·워커 기준 합계·breakdown 이름 테스트 5개 |
| `apps/web/src/features/stream/reducer.test.ts` | 수정 | 스냅샷 노드 6 → 9 (마스터 포함, 계약 8.2) |

`apps/web/src/components/ui/**`·`styles/**`·`apps/api/**`·`docs/`(이 보고서 제외)는 **건드리지 않았다.**

### 5. 주요 결정과 이유

1. **역할 칸 개수를 `GET /api/cluster/nodes`의 `roleCounts`가 아니라 스냅샷 분할로 만들었다.**
   - 노드 목록 화면은 REST가 아니라 **`cluster` 토픽 SSE(`cluster.snapshot` + `cluster.node.upsert`)로 그린다.** 계약 8.2가 "스냅샷 `nodes`에는 마스터도 들어 있다(`role`로 구분). 화면 노드 목록은 기본적으로 `role: 'worker'`만 그린다"라고 명시한 대로다.
   - 여기서 `roleCounts`를 REST로 따로 가져오면 **실시간 목록(행 수)과 한 번 받은 숫자(탭)가 어긋난다.** 노드가 하나 추가되면 표는 7행인데 탭은 `워커 6`으로 남는다.
   - 대안(REST 폴링으로 탭 숫자만 갱신)은 같은 값을 두 경로로 받는 셈이라 더 나쁘다.
   - PM 지시 "화면에서 더하지 마라"의 취지(서로 다른 출처의 값을 더해 새 숫자를 만들지 마라)는 지켰다: **같은 목록을 서버가 붙인 `role`로 나누기만** 하고, 어떤 노드가 마스터인지는 화면이 판단하지 않는다. `all = worker + control_plane`은 분할의 성질이라 자동으로 성립한다(테스트로 고정).
   - 다르게 하길 원하시면 알려 주십시오. 목록 자체를 REST 기반으로 바꾸는 큰 변경이 됩니다.
2. **`areas.controlPlane`을 optional 타입으로 뒀다.** 계약 2.1에 있는 필드지만 백엔드 P3 전에는 오지 않는다. 필수로 두면 지금 실행이 깨지고, 아예 안 만들면 P3 때 다시 손대야 한다. 값이 있을 때만 부제를 그리므로 **P3가 올라오면 코드 변경 없이 부제가 나타난다.**
3. **요약 띠 부제 링크를 `#control-plane`이 아니라 `?role=control_plane`으로 했다.** 디자인은 `#control-plane`이지만 그 섹션이 아직 없어서 지금 누르면 **워커 목록**이 보인다(사용자에게는 링크가 고장 난 것으로 보인다). P3에서 섹션이 생기면 `#control-plane`으로 바꾼다. → 9절에 인계.
4. **역할을 바꾸면 나머지 필터를 비운다.** `role=worker`에서 `nodeGroup=batch`를 고른 뒤 `컨트롤 플레인`으로 바꾸면 결과가 0건이 된다. 계약 3.1이 "facets는 현재 role 안의 값만"이라고 정했으므로, 후보에 없는 필터가 남아 있는 상태를 만들지 않았다.
5. **노드그룹 열 폭을 140 → 160px로 넓혔다.** 디자인 3.3.2 표가 160px이고, kOps InstanceGroup 이름(`control-plane-ap-northeast-2a`)이 140px에서 2줄로 접힌다(실측 확인).
6. **`ClusterMeta`의 행을 `nowrap`으로 묶지 않았다.** 처음엔 한 줄 고정으로 만들었는데 360px에서 **클러스터 이름이 상자 밖으로 삐져나와 `· v1.30.4 · ap-northeast-2`와 글자가 겹쳤다**(6절 스크린샷으로 확인·수정). 원인은 `ResourceName kind="cluster"`의 앞 12자/뒤 8자가 `flex-shrink: 0`이라 **최소 폭 아래로 줄지 않고 overflow가 visible**이라는 점이다(퍼블리셔 컴포넌트). 내 쪽에서는 줄바꿈 허용 + `overflow: hidden`으로 막았고, 컴포넌트 자체는 8절에 요청으로 남겼다.
7. **비용 카테고리·`COST_CATEGORY_LABEL` 교체를 하지 않았다.** 퍼블리셔 요청 ①로 올라와 있지만 PM이 "P4 이후 별도 지시"라고 못박았고, 지금 바꾸면 서버가 주는 `category: "eks"`와 라벨 맵의 키가 어긋나 라벨이 `undefined`가 된다.

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npx tsc --noEmit -p apps/web` | 통과 | |
| `npm run lint --prefix apps/web` | 통과 | 경고 0 |
| `npx vitest run` (apps/web) | **496 passed / 22 files** | 기준선 483 → **+13** (새 14개, 기존 3개 기대값 갱신) |
| `npx next build` (apps/web) | 통과 | 18 라우트 생성 |
| mock 화면 확인 (웹 3123 / 가짜 API 3124) | 통과 | 아래 |

**mock 화면 확인 방법**: 가짜 API는 `apps/api`를 띄우지 않고 **`features/__fixtures__/fixtures.ts`를 그대로 SSE·REST로 흘려 주는 scratch 서버**(3124)를 썼다. 백엔드가 `apps/api`에서 P3·P4를 동시에 작업 중이라 `nest start`가 같은 `dist/`를 쓰면 상대 작업을 방해할 수 있어 피했다. → 한계는 7절.

**실제 브라우저 렌더 확인(이번에 처음)**: 이 PC에 설치된 **Microsoft Edge를 Playwright `channel: "msedge"`로 구동**했다(브라우저 다운로드 없음, playwright 패키지는 스크래치패드에만 설치, 리포지터리 미변경). 확인한 것:

| 확인 | 결과 |
|---|---|
| 노드 목록 기본 | **워커 6행만**, 마스터 3대 안 보임, 결과 문구 `워커 6개 중 6개 표시` |
| 역할 탭 | `워커 6 · 컨트롤 플레인 3 · 전체 9`, 기본 선택 = 워커 |
| `?role=control_plane` | 마스터 3행 + `컨트롤 플레인` 칩, `컨트롤 플레인 3개 중 3개 표시` |
| `?role=all` | 9행, 마스터에만 칩 |
| 개요 요약 띠 | `노드 Ready (워커)` **5/6** (9/9 아님), 부제 `컨트롤 플레인 3/3` 링크 |
| 개요 CPU·메모리 카드 | `워커 기준` 칩 2개, 합계 `11,580m`(= 워커 6 × 1930m) |
| 상단바 360/480/768/900/1024/1280/1440px | **가로 스크롤 0** (scrollWidth == clientWidth 전부 일치) |

**상단바 실측 (Edge, body 14px 폴백 Segoe UI)**

| 폭 | 클러스터 정보 블록 | 이름 표시 |
|---|---|---|
| 1440 / 1280 / 1024 | 가용 864 / 704 / 404px | 전체 295px 표시, 잘림 없음 |
| 900 | 389px | 전체 표시 |
| 768 | 257px | **잘림**(끝 말줄임, 툴팁 없음 — 리전이 조용히 사라진다) |
| 767 이하(480·360 포함) | `display: none` | **블록 통째로 숨김, `circle-help` 대체 없음** |

문자열 폭 실측(디자이너 근사치와 비교):

| 이름 | 실측 | 디자이너 근사 |
|---|---|---|
| `prod.k8s.example.com` | 138px | 146px |
| `staging.k8s.example.com`(가장 긴 확정 이름) | **154px** | 168px |
| `bench.k8s.example.com` | 146px | 153px |
| `prod-ap-northeast-2.platform.k8s.example.com`(최악 가정) | 292px | 321px |
| ` · v1.30.4 · ap-northeast-2` | 157px | 157px(52+105) |

→ **`staging.k8s.example.com` 전체 문자열 = 311px ≤ 360px**. 디자이너의 "확정된 세 이름은 360px에서 잘리지 않는다"는 결론은 **실측으로도 성립한다**(근사치가 일관되게 과대평가였을 뿐 결론 동일).

**실패·건너뛴 검증**
- **`apps/api`(진짜 mock API)와의 통합 확인은 하지 않았다.** 위 이유(백엔드 동시 작업). 대신 `cluster-query.service.ts`·`evaluate.ts`·`cluster/types.ts`를 읽어 `roleCounts`·`scope`·`controlPlane`의 **필드 이름과 형태가 내 타입과 같은지 소스로 대조**했다. 실제 HTTP 응답으로는 확인하지 않았다.
- **`areas.controlPlane`은 실제 서버 응답으로 확인하지 못했다**(P3 전이라 존재하지 않음). 픽스처로만 확인했다. P3가 올라오면 요약 띠 부제가 실제로 뜨는지 다시 봐야 한다.
- 다크 테마·1280~1439px 구간의 카드 배치는 눈으로 보지 않았다.
- `apps/api`의 lint·test는 돌리지 않았다(내 영역 아님, `npm run lint --prefix apps/api`는 `--fix`라 남의 파일을 고친다).

**띄운 프로세스**: 웹 dev PID 22132(:3123), 가짜 API PID 22816(:3124). **두 PID만 지정해 종료**했고(`Stop-Process -Id 22132,22816`), 이미지 이름 일괄 종료는 하지 않았다. 종료 후 두 포트가 비었고 남은 자식 프로세스가 없는 것을 확인했다.

### 7. 남은 이슈·한계

1. **상단바 FQDN 처리(요청 3의 ①)가 미완이다.** `TopBar.tsx`·`shell.module.css`가 퍼블리셔 영역이라 손대지 않았다. 지금 상태에서 **레이아웃은 360px에서도 깨지지 않지만**, ⓐ 768px에서 리전이 툴팁 없이 잘리고 ⓑ 767px 이하에서 클러스터 정보가 통째로 사라지며 대체 수단이 없고 ⓒ 이름이 길어지면 가운데 말줄임이 아니라 **끝이 잘려** `prod-ap-nort…`가 아닌 `prod-ap-northeast-2.platfo…`처럼 뒤가 날아간다. 8절 퍼블리셔 요청 참고.
2. **노드 화면 PageHeader 배지가 역할과 무관하게 워커 영역 상태다.** 계약 3.1은 `role=control_plane`이면 `areas.controlPlane` 값이라고 정했지만 그 영역이 아직 없다(백엔드도 "P3까지의 임시 동작"으로 같은 상태). P3에서 함께 고친다.
3. **컨트롤 플레인 섹션·개요 6번째 카드·구성요소 매트릭스는 만들지 않았다**(지시대로). `ComponentMatrix`는 아직 어느 페이지에도 붙어 있지 않다.
4. **`/cluster/nodes`·`/cluster/pods`·`/cluster/events`에서 dev 모드 hydration 불일치 경고가 뜬다.** `/`(개요)에는 없다. **내 변경 전부터 있던 문제다**(내가 손대지 않은 `/cluster/pods`·`/cluster/events`에서도 동일하게 발생). SSR 시점에는 스트림 스냅샷이 없어 `PageHeader`에 상태 배지가 없는데, hydration 시점에는 이미 스냅샷이 도착해 배지가 생기는 형태다. 화면은 정상 동작하고 prod 빌드도 통과하지만, 별도 과제로 잡아야 한다(`useSyncExternalStore`의 `getServerSnapshot` 경로 점검).
5. **노드 표가 1440px에서 가로 스크롤이 난다**(열 합계 폭 > 본문 폭). 디자인의 열 폭을 그대로 따른 결과이고 표 안에서만 스크롤한다(페이지 가로 스크롤 없음). 이번 변경으로 생긴 것은 아니지만 역할 탭이 늘면서 더 눈에 띈다.
6. **mock 이름 일괄 변경이 절반만 됐다.** `features/__fixtures__/fixtures.ts`는 `prod.k8s.example.com`으로 바꿨지만, `features/__fixtures__/k8s-snapshots.ts`(`prod-eks`·`staging-eks` 다수, 드리프트 짝 맞추기에 쓰이는 값)와 `features/aws-snapshots/model.ts`의 예시 문구, `components/ui/__preview__/*`(퍼블리셔 영역)는 그대로다. `apps/api`의 mock도 아직 `prod-eks`다(백엔드 P5). **지금 나 혼자 바꾸면 API mock과 어긋나므로** P5와 함께 일괄로 해야 한다.
7. 픽스처 마스터 노드의 노드그룹 이름은 `apps/api` mock(`control-plane-ap-northeast-2a/b/c`)에 맞췄다. 워커 노드그룹(`batch`·`system`·`spot-workers`)은 kOps InstanceGroup 형식(`nodes-ap-northeast-2a`·`spot-batch`)이 아니지만, **API mock이 아직 그 이름이라 일부러 맞춰 뒀다**(P5에서 함께 바꿀 것).

### 8. 다른 담당 요청

- **퍼블리셔 요청 ① (상단바 FQDN, 이번 지시의 핵심 미완 항목)**: `components/ui/shell/TopBar.tsx`에서 클러스터 정보를 문자열이 아니라 `ResourceName kind="cluster"`로 그려 주기 바란다. 내 영역이 아니라 손대지 않았다. 필요한 모양은 이렇다.
  ```tsx
  // 지금: <span className={styles.clusterText}>{[name, version, region].filter(Boolean).join(" · ")}</span>
  <span className={styles.clusterText}>
    <ResourceName
      name={cluster.name}
      kind="cluster"
      maxWidth={240}          /* shell.md 2.1: ≥1440 240 / 1280~1439 200 / 1024~1279 160 */
      tooltipExtra={`Kubernetes ${cluster.version ?? "버전 알 수 없음"}${cluster.region ? ` · ${cluster.region}` : ""}`}
    />
    {rest ? <span className={styles.clusterRest}>{` · ${rest}`}</span> : null}
  </span>
  ```
  - 축소 순서(`shell.md` 2.1): 가용 폭 240~319px에서 **리전**을 빼고, 160~239px에서 **버전**도 빼고, 160px 미만이면 이름 최소 폭 120px + 가운데 말줄임. 버린 값은 **툴팁에 남긴다**. 컨테이너 쿼리(`container-type: inline-size` on `.clusterInfo`)로 CSS만으로 처리할 수 있다.
  - **767px 이하에서 `.clusterInfo { display: none }`인데 대체 수단이 없다.** 2.1 마지막 줄대로 로고 오른쪽에 `circle-help` 14px 버튼만 남기고 툴팁에 이름·버전·리전 세 값을 넣어 주기 바란다. 지금은 클러스터를 식별할 방법이 화면에 하나도 없다.
  - 실측 근거는 6절 표에 있다(가용 폭 768px→257px, 767px→0px, 이름 폭 138~292px).
- **퍼블리셔 요청 ② (`ResourceName kind="cluster"` 넘침)**: 남는 폭이 `keepHead(12자) + keepTail(8자)`보다 좁으면 **상자 밖으로 삐져나와 옆 글자와 겹친다.** `.rnKeptHead`·`.rnTail`이 둘 다 `flex-shrink: 0`이고 `.rnVisual`이 `overflow: visible`이라서다. 360px 개요 요약 띠에서 재현했고(스크린샷 확보), 내 쪽에서는 줄바꿈 허용으로 피했지만 **상단바처럼 한 줄 고정인 자리에서는 피할 수 없다.** `shell.md` 2.1의 "이름 최소 폭 120px을 지키고 가운데 말줄임"이 성립하려면 최소 폭 아래에서는 `keptHead`도 줄어들거나 `overflow: hidden`이 필요하다.
- **퍼블리셔 참고**: 프론트 요청 ②·③(`ComponentMatrix`의 `columns` 순서·`missing` 채움, 노드 상세 카드)은 컨트롤 플레인 섹션을 붙일 때(P3 이후 지시) 그대로 따르겠다. 프론트 요청 ①(`COST_CATEGORY_LABEL` 교체)은 PM 지시대로 **P4 이후**로 미뤘다.
- **백엔드 참고**: `frontend 요청 1~4`는 모두 반영했다. `cluster.controlplane.updated`가 기존 `cluster` 토픽이라는 안내도 확인했다(새 구독 없음). 다만 **`areas.controlPlane`이 P3에서 올라올 때 개요 요약 띠 부제가 자동으로 켜지도록** optional 필드로 만들어 뒀으니, 계약 2.1의 필드 이름(`found`·`masters.ready/total`·`quorum.state`·`haExpected`)이 그대로인지만 확인해 주기 바란다.
- **PM 참고 1**: 5절 1번(역할 탭 개수를 스냅샷 분할로 계산)이 "화면에서 더하지 마라" 지시와 충돌하는지 판단을 부탁드린다. 계약 8.2를 근거로 판단했다.
- **PM 참고 2**: 이번에 **Playwright + 설치된 Edge로 실제 픽셀 렌더를 확인하는 경로**를 찾았다(브라우저 다운로드 불필요). README "남은 이슈"의 *"UI가 실제 픽셀로 렌더된 것을 아무도 눈으로 보지 못했다"*를 해소할 수 있다. 다만 **빗금 vs dashed(보고 없음 vs 오래됨)** 확인은 `ComponentMatrix`가 아직 어느 페이지에도 붙어 있지 않아 `/dev/ui`에서 봐야 한다(퍼블리셔 영역 화면). 원하시면 다음 작업에서 `/dev/ui` 스크린샷도 찍어 보고하겠다.
- **디자이너 참고**: 문자열 폭 근사치(7.3px/자)가 실제(Segoe UI 폴백)보다 **일관되게 8~10% 크다**(6절 표). 결론은 그대로 성립하지만, 앞으로 여유가 빠듯한 계산에서는 실측값을 쓰는 편이 안전하다.

### 9. 다음 담당이 알아야 할 점

- **노드 목록은 REST가 아니라 `cluster` 토픽 SSE로 그린다.** `GET /api/cluster/nodes`는 이 화면이 부르지 않는다. 역할 분류 근거는 오직 `NodeItem.role`이다.
- **역할 필터 URL은 `?role=worker|control_plane|all`**, 기본값(`worker`)일 때는 쿼리를 URL에 쓰지 않는다. 모르는 값은 조용히 `worker`로 떨어진다(400을 화면에서 만들지 않는다).
- **개요 요약 띠 부제는 `areas.controlPlane`이 있을 때만 나온다.** 백엔드 P3가 이 필드를 내려보내기 시작하면 프론트 코드 변경 없이 켜진다. 그때 `CONTROL_PLANE_HREF`(`OverviewPage.tsx` 상단 상수)를 `/cluster/nodes#control-plane`으로 바꾸고 `scroll-margin-top: 96px`을 섹션에 붙이면 된다.
- **`ClusterMetricsBody.controlPlane`을 `cpu`/`memory`에 더하지 말 것.** 전체 용량이 필요하면 노드 목록 `role=all`을 쓴다(계약 7.2). `mapping.test.ts`의 "클러스터 합계와 컨트롤 플레인 블록을 더하지 않는다" 테스트가 이 불변식을 지킨다.
- **비용 카테고리는 아직 `eks`다.** `features/aws-cost/types.ts`의 `CostCategory`·`CostTables.tsx`의 `CATEGORY_ORDER`/`CATEGORY_LABEL`을 P4 이후에 `@/components/ui`의 `COST_CATEGORY_*`로 교체한다. **배분 `breakdown`만 이미 새 이름**(`controlPlaneUsdPerHour`)이다.
- **테스트에서 URL 쿼리를 바꾸려면** `pages.test.tsx`의 `nav.params`(vi.hoisted 홀더)에 새 `URLSearchParams`를 넣는다. `afterEach`에서 초기화된다.
- **검증용 가짜 API 서버**는 리포지터리에 넣지 않았다(스크래치패드). `apps/web/src/features/__fixtures__/fixtures.ts`를 `node --experimental-strip-types`로 그대로 import해 `/api/stream`(SSE) + 몇 개 REST를 흘려 주는 80줄짜리다. 같은 방식으로 다시 만들면 된다. 실제 API와의 정합은 이것으로 확인되지 않는다.

---

## 2026-09-24 09:35 · 통합 본편 (컨트롤 플레인 화면 + SSE + 비용 카테고리 + mock 이름 정리)

### 1. 요청 내용

PM 지시(선행분 채택 후 본편):

1. **컨트롤 플레인 화면** — 개요 6번째 카드(`areas.controlPlane`), 노드 화면 컨트롤 플레인 섹션 + 구성요소 매트릭스. `cellTooltip` 필수, `columns[].reason`은 마스터 표 `사유`와 같은 서버 문자열, 요약 "알 수 없음"은 `cellCounts.unknownTotal` 하나, `attention`의 `area: 'control_plane'`, `nav.nodes` 합산. **상태 계산 금지**.
2. **SSE** — 기존 `cluster` 토픽에 `cluster.controlplane.updated` 핸들러만 추가. **백엔드가 SSE를 실제로 구독해 본 적이 없으니 내가 실제로 구독해 불필요한 재렌더가 반복되지 않는지 확인** (이번 통합의 가장 중요한 검증).
3. **비용 화면** — 카테고리 `eks` → `controlPlane`(`@/components/ui`의 `COST_CATEGORY_LABEL`·`CONTROL_PLANE_KIND_LABEL` 사용), `resources.controlPlane[]`·`byKind`·`apiLb`(0개여도 항상 있음, `assumed`는 "추정" 라벨 필수), 도움말 고정 문구는 화면 상수(`docs/api/aws-cost.md` 3.1.1).
4. **남은 mock 이름 정리** — `prod.k8s.example.com` 등. 드리프트 클러스터 ID 짝 유지 확인.

작업 중 추가 지시 2건:
- **`ResourceName.keepHead` prop 제거**(퍼블리셔가 두 토막 구조로 변경). `keepTail`만 남음.
- **api mock이 kOps 형태로 확정**(P5): 노드 이름 전부 `i-0…`, 노드그룹 `nodes-system`·`nodes-batch`·`nodes-app-arm64`, kubelet `v1.34.1`, `aws-node` → cilium, ECR eks 이미지 → `registry.k8s.io`, `amazon-cloudwatch`·fluent-bit 없음. **어드바이저 화면에서는 인스턴스 ID가 가명으로 보여야 정상**, 일반 클러스터 화면에서는 실제 이름. 스냅샷에 `controlPlaneVolumes[]` 신설.

### 2. 참고한 문서

- `docs/api/cluster-status.md` — **1.6**(`ControlPlaneComponent`·`cellState` 7종·대응표), 2.1(`areas.controlPlane`), **3.3(`GET /api/cluster/control-plane` 전체 + 필드 표)**, 8.2(SSE `cluster.controlplane.updated`)
- `docs/api/aws-cost.md` — 1절(`CostCategory`·`ControlPlaneCostKind`), **3.1**(`byKind`·`apiLb`·`resources.controlPlane[]`·API LB 후보 0/1/N 표), **3.1.1 화면 도움말 고정 문구**, 3.2
- `docs/design/cluster-status.md` — **3.2 전체**(섹션 머리·마스터 합계·마스터 표·매트릭스·기타/한계 안내·상태별 모습), 2.2·2.3(카드 6개 3×2)·2.4
- `docs/design/aws-cost.md` — 2.5(b)(d) 카테고리 구성·컨트롤 플레인 내역 열, 2.6 배분, 2.9 계산 방법
- `docs/reports/kops-support/backend.md` P3·P4 섹션(8절 frontend 요청 1~5, 5절 결정 A~H)
- `docs/reports/kops-support/publisher.md` 9절(`ComponentMatrix` 인터페이스)

### 3. 작업 내용

#### 3.1 타입

- `cluster-status/types.ts`: `ControlPlaneComponentKind`·`ControlPlaneCellState`(서버 7종)·`ControlPlaneComponent`·`ControlPlaneMasterItem`·`ControlPlaneColumn`·**`ControlPlaneBody`**(계약 3.3 그대로) 추가. `ClusterSnapshot.controlPlane` 추가.
- `aws-cost/types.ts`: `CostCategory`·`ControlPlaneCostKind`를 **`@/components/ui`에서 재수출**(라벨·순서 정의가 한 곳뿐이 되게), `ControlPlaneResource`(한 배열에 여러 `kind`), `ApiLbInfo`, `CategoryRow`(+`byKind`·`apiLb`·`notes`), `resources.eks` → `resources.controlPlane`.

#### 3.2 SSE (기존 `cluster` 토픽)

- `stream/reducer.ts`: `cluster.snapshot`에서 `controlPlane`을 받고, **`cluster.controlplane.updated` 핸들러 1개** 추가(단일 객체 전체 교체). `STREAM_EVENT_TYPES`에 이벤트 이름 1줄. **새 토픽·새 구독 없음.**
- 회귀 테스트: 이벤트가 오면 `controlPlane`만 바뀌고 `nodes`·`pods` 캐시는 **같은 참조로 유지**되는지 고정.

#### 3.3 컨트롤 플레인 섹션 (새 파일 `ControlPlaneSection.tsx`)

- 섹션 머리: `StatusBadge`(서버 `status`) + 쿼럼 근사 `circle-help`(툴팁은 **서버 `limits.notes`의 `CP_QUORUM_APPROX` 문장**, 없으면 디자인 문구) + 대표 사유 `headline`(서버 문장 그대로) + 오른쪽 caption `마스터 3대 · 3개 AZ · 필수 구성요소 13/15`.
- 마스터 1대 + `haExpected: false`면 `단일 구성 확인됨` Chip.
- `workerPodCount` 합이 **1 이상일 때만** 경고 한 줄. `0`과 `null`은 둘 다 경고 없음(디자이너 요청 4).
- 마스터 합계 2행(UsageBar, **상태 배지 없음**), metrics 없으면 `— 알 수 없음 (metrics-server 없음)`.
- 마스터 표 10열(디자인 3.2.2). `사유` 열은 `masters.items[].reasonText` 서버 문장, `AZ` 열 머리는 `zoneSpread === "single_zone"`일 때만 warn 아이콘.
- **구성요소 매트릭스**: `components.columns`(열, `masters.items`와 zip해 노드 상태·`zone · instanceType` meta 보강) + `components.items`(칸, 15개 그대로) + `requiredKinds`(행). 셀은 `cellState`→`CellState` 이름 매핑만 하고 **`cellText`·`cellDetail`·`cellTooltip`을 그대로** 넘긴다. `clickable && podKey`면 파드 상세 링크.
- 요약은 `cellCounts`에서 `ok`/`warning`/`critical`/**`unknownTotal`**(+`stale > 0`이면 추가). `summaryText`(서버 문장)는 매트릭스 `caption`에 붙여 스크린리더가 같은 문장을 읽게 했다.
- 기타 구성요소: 접힘 Section + `필수 판정 제외` Chip + compact 표. 0개면 섹션 자체 숨김.
- 한계 안내: `limits.notes`에서 쿼럼 문장을 뺀 2줄을 InlineAlert(info)로 **상시** 표시. **마스터 0대여도 보인다**(AC-KOPS17·26).
- 마스터 0대: 섹션 본문을 UnknownState(서버 `notFoundReason.text` + 디자인 hint), 나머지 화면은 그대로.

#### 3.4 노드 화면·개요 연결

- `NodesPage`: 섹션을 맨 위에, 그 아래 `워커 노드` 제목 + `컨트롤 플레인 N대 보기`(`#control-plane`, 마스터 0대면 숨김). 역할이 워커가 아니면 InlineAlert(info) + `위로 가기`.
- **PageHeader 배지를 `nav.nodes`(서버 합성값)로 바꿨다.** 전에는 워커 영역만 보여, 컨트롤 플레인이 장애인데 제목 배지가 `정상`이고 사이드바만 빨간 모순이 실제로 화면에 나왔다(스크린샷 확인). 화면은 **값을 고르기만** 한다 — `nav.nodes`와 같은 상태인 영역의 서버 문장을 사유로 쓴다.
- `OverviewPage`: 카드 **6개 3×2**, 순서 고정(컨트롤 플레인 → 노드 → 워크로드 → 파드 → 이벤트 → DB). 컨트롤 플레인 카드는 `server-cog` + `마스터 2/3` + `primarySub 필수 구성요소 13/15` + 문제 항목 + footer `컨트롤 플레인 보기` → `/cluster/nodes#control-plane`. 요약 띠 부제 링크도 같은 앵커로 바꿨다.
- `OverviewPage.module.css`: "지금 확인할 항목" 영역 라벨 열 64 → **84px**(`컨트롤 플레인`이 두 줄로 접혔다, 디자인 2.4).

#### 3.5 비용 화면

- `CATEGORY_ORDER`·`CATEGORY_LABEL` 자체 정의를 지우고 **`COST_CATEGORY_ORDER`·`COST_CATEGORY_LABEL`**(퍼블리셔) 사용. 카테고리 구성 목록의 `컨트롤 플레인` 행에 `circle-help` + 고정 툴팁.
- 리소스 내역에 **`종류` 열**(맨 앞, `CONTROL_PLANE_KIND_LABEL` + 아이콘 5종) 신설. 컨트롤 플레인 그룹은 **하위 종류 고정 순서 → 시간당 내림차순**으로 정렬하고 **기본 펼침**.
- 컨트롤 플레인 행 설명: 마스터 EC2(이름·타입·AZ) / etcd·루트 볼륨(볼륨 ID·`gp3 20 GiB`·`마스터 · main|루트`) / API LB(이름·NLB·`API 서버`) / 마스터 IPv4(`주소 1개`). **`etcdCluster`가 null이면 "etcd 볼륨"으로만 적는다**(백엔드 결정 H).
- **`apiLb` 3경우**: `assumed` → neutral Chip(`tilde`) + 툴팁, `ambiguous` → warn Chip + 행 왼쪽 warn 막대, `not_found` → 그룹 맨 아래 info 행. **라벨은 행 `notes`가 아니라 `categories[].apiLb`(항상 있음)에서 만든다** — 서버가 note를 빠뜨려도 "추정"이 사라지지 않게.
- 도움말 상수(`help.tsx`): `CONTROL_PLANE_NOTICE`(실시간 추정 섹션 맨 위 InlineAlert + 계산 방법 Drawer 맨 위), `CONTROL_PLANE_CATEGORY_TOOLTIP`, `API_LB_TOOLTIP`, `NODE_GROUP_TARGET_TOOLTIP`. "포함되지 않는 것"에 **Route53·S3 2줄 추가**, 계산 방법의 `EKS 컨트롤 플레인` 항목을 하위 5종 설명으로 교체, 배분 규칙 6번을 컨트롤 플레인 문장으로 교체.

#### 3.6 mock 이름·형태 정리 (api mock 확정값에 맞춤)

- `fixtures.ts`: 노드 이름 9개 전부 `i-0…`(api mock과 **같은 값**), 워커 노드그룹 `nodes-batch`·`nodes-app-arm64`·`nodes-system`, 마스터 `control-plane-ap-northeast-2{a,b,c}`, kubelet·클러스터 버전 `v1.34.1`, `aws-node` → **cilium**, fluent-bit 이미지 → `registry.k8s.io/metrics-server`, 비용 GPU 노드 이름·노드그룹(`nodes-gpu`)·급증 원인 키도 인스턴스 ID 형태로.
- `__fixtures__/k8s-snapshots.ts`·`snapshots.ts`·`aws-snapshots/model.ts`: `prod-eks`→`prod.k8s.example.com`, `staging-eks`→`staging.k8s.example.com`, `v1.34.1-eks-8a2c1f0`→`v1.34.1`.
- `EKS에 배포한 대시보드…` → `클러스터 안에 배포한 대시보드…`(디자인 반영), 라벨 placeholder·예시 `EKS 1.30/1.34 업그레이드 전` → `kOps 1.31 업그레이드 전`(디자인 `aws-snapshot-manager.md` 422줄).
- **드리프트 짝 확인 완료**: `CLUSTER_ID`(대시보드 = 스냅샷 `relation:"same"` = 드리프트 `target.clusterId` = `snapshotCluster.id`)와 다른 클러스터 id(`c3a9e0f2…`, `relation:"other"`)를 **그대로 두고 이름만** 바꿨다. `CLUSTER_MISMATCH` 문구의 이름도 그 클러스터 이름과 일치한다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/cluster-status/ControlPlaneSection.tsx` | **추가** | 컨트롤 플레인 섹션 전체(머리·합계·마스터 표·매트릭스·기타·한계 안내) |
| `apps/web/src/features/cluster-status/types.ts` | 수정 | `ControlPlaneBody` 외 컨트롤 플레인 타입 5개, `ClusterSnapshot.controlPlane` |
| `apps/web/src/features/cluster-status/NodesPage.tsx` | 수정 | 섹션 배치, `워커 노드` 구분, 앵커 링크, 역할≠워커 InlineAlert, PageHeader를 `nav.nodes`로 |
| `apps/web/src/features/cluster-status/OverviewPage.tsx` | 수정 | 카드 6개 3×2 + 컨트롤 플레인 카드, 부제 앵커 |
| `apps/web/src/features/cluster-status/OverviewPage.module.css` | 수정 | 확인 항목 영역 라벨 열 84px |
| `apps/web/src/features/stream/reducer.ts` | 수정 | `cluster.controlplane.updated` 핸들러 + 스냅샷 `controlPlane` |
| `apps/web/src/features/aws-cost/types.ts` | 수정 | `controlPlane` 카테고리·`ControlPlaneResource`·`ApiLbInfo`·`CategoryRow` |
| `apps/web/src/features/aws-cost/CostTables.tsx` | 수정 | 라벨 한 곳 사용, `종류` 열, 하위 종류 정렬, `apiLb` 3경우, 열 폭 축소 |
| `apps/web/src/features/aws-cost/CostPage.tsx` | 수정 | 실시간 추정 섹션 맨 위 kOps 안내 |
| `apps/web/src/features/aws-cost/help.tsx` | 수정 | 고정 문구 4개 상수화, 계산 방법·포함되지 않는 것 갱신 |
| `apps/web/src/features/__fixtures__/fixtures.ts` | 수정 | 컨트롤 플레인 픽스처(15칸), 비용 controlPlane 리소스, 노드 이름·노드그룹·버전·cilium |
| `apps/web/src/features/__fixtures__/k8s-snapshots.ts`, `snapshots.ts` | 수정 | mock 클러스터 이름·라벨 |
| `apps/web/src/features/aws-snapshots/{model.ts,shared.tsx,dialogs.tsx}`, `k8s-snapshots/{shared.tsx,dialogs.tsx}` | 수정 | EKS 전제 문구 일반화, placeholder |
| `apps/web/src/features/{pages.test.tsx,mapping.test.ts,stream/reducer.test.ts}`, `aws-snapshots/*.test.*`, `k8s-snapshots/pages.test.tsx` | 수정 | 새 테스트 12개 + 기대값 갱신 |

`apps/web/src/components/ui/**`·`styles/**`·`apps/api/**`·`docs/`(이 보고서 제외)는 **건드리지 않았다.** `keepHead`는 **쓴 적이 없다**(전체 검색 0건).

### 5. 주요 결정과 이유

1. **PageHeader 배지를 `areas.nodes` → `nav.nodes`로 바꿨다.** 실제 화면에서 컨트롤 플레인이 `장애`인데 페이지 제목 배지가 `정상`이고 사이드바만 빨간 상태를 봤다(`cp-component-crash` 스크린샷). 디자인 3.1이 "두 섹션 상태의 최악(서버 값)"이라고 정했고 그 합성값이 `nav.nodes`다. 화면은 합성하지 않고 **고르기만** 한다.
2. **요약 줄을 `summaryText`(서버 문장)로 찍지 않고 `ComponentMatrix.summary`로 그렸다.** 디자인 3.2.3이 "숫자를 누르면 그 상태의 셀만 2000ms 깜박인다"를 요구하는데 서버 문장으로는 누를 수 없다. 숫자는 전부 서버 `cellCounts` 값이고(특히 "알 수 없음"은 `unknownTotal` 하나), `summaryText`는 매트릭스 `caption`에 붙여 스크린리더가 서버 문장을 읽도록 남겼다. 같은 문장을 두 번 그리지 않는다.
3. **`apiLb` 라벨을 행 `notes`가 아니라 `categories[].apiLb`에서 만든다.** 계약이 "후보 0개여도 이 객체는 항상 있다"고 보장하는 쪽이 `apiLb`다. 행 note에만 기대면 서버가 note를 빠뜨렸을 때 **"추정" 표시 없이 확정 금액처럼 보인다** — 이 화면에서 가장 위험한 실패 방식이라 보장된 쪽을 근거로 삼았다. 중복을 피해 `API_LB_*` note는 비고에서 걸러 낸다.
4. **`apiLb` 상태를 그룹 행에도 넣었다.** 리소스 표가 1440px에서 가로로 넘쳐(실측 +161px) `비고`가 스크롤 뒤로 가는 것을 확인했다. 금액 열을 줄여 넘침을 19px까지 줄이고, **스크롤과 무관하게 왼쪽에 늘 보이는 그룹 행**에도 같은 칩을 뒀다. "추정 라벨이 반드시 보여야 한다"는 요구를 폭에 의존하지 않게 만든 것이다.
5. **한계 안내를 `found: false`일 때도 그린다.** 처음엔 UnknownState로 본문을 통째로 대체했는데, 디자인 3.2.5가 "마스터 0대여도 한계 안내 2줄은 그대로 보인다(AC-KOPS17)"라고 정했다. 그 두 문장은 "여기 없는 것"에 대한 설명이라 컨트롤 플레인을 못 찾은 상황에서 더 필요하다.
6. **매트릭스 stale을 `badgeProps`가 합친 값에서 가져온다.** heartbeat 끊김(`watch.stale`)과 서버 `status.stale`(kube 출처 stale)이 둘 다 "데이터 오래됨"인데, 처음엔 heartbeat만 봤다. `kube-stale` 시나리오에서 배지만 stale이고 칸은 정상으로 보이는 모순이 났다. 두 경로를 한 자리(`badgeProps`)에서 합친다.
7. **서버가 반복해 보내는 `cluster.controlplane.updated`를 화면에서 걸러내지 않았다.** 화면이 "무엇이 의미 있는 변화인가"를 다시 판단하는 것은 서버 변경 감지를 클라이언트에 복제하는 일이고, 이 프로젝트의 "상태를 화면에서 계산하지 않는다" 원칙과 정면으로 어긋난다. 대신 **원인을 필드 단위로 특정해 backend에 넘겼다**(8절).

### 6. 검증 결과

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `npx tsc --noEmit -p apps/web` | 통과 | |
| `npm run lint --prefix apps/web` | 통과 | 경고 0 |
| `npx vitest run` | **508 passed / 22 files** | 기준선 496 → **+12** |
| `npx next build` | 통과 | 18 라우트 |
| 실제 브라우저(Edge + Playwright) + **진짜 mock API(`apps/api`, :3124)** | 통과 | 아래 |

**SSE 실구독 검증 (이번 통합의 최우선 항목)** — 진짜 `apps/api`를 mock으로 띄우고 `GET /api/stream?topics=cluster,metrics,overview`에 직접 붙어 75초간 관찰했다.

| 이벤트 | 75초 동안 |
|---|---|
| `cluster.event.upsert` | 16 |
| **`cluster.controlplane.updated`** | **15** (0s · 5s ×3 · 20s ×3 · 35s ×3 · 50s ×3 · 65s ×2) |
| `cluster.summary.updated` | 11 |
| `cluster.node.upsert` | 6 |

**→ 컨트롤 플레인에 아무 변화가 없는데도 15초마다 2건씩 계속 나간다.** 연속 payload를 필드 단위로 비교해 원인을 특정했다(자세한 필드 목록은 8절 backend 요청).
- 프레임 크기 **약 18KB** × 8건/분 ≈ **8.6MB/시간/클라이언트**.
- **화면 영향**: 브라우저에서 60초 관찰 결과 매트릭스 subtree DOM 변경 **0건**(React 재조정이 같은 결과를 내므로 사용자에게 보이는 깜박임은 없다). 섹션 전체 57건은 마스터 표의 `경과`(1초 시계)와 CPU·메모리 막대(메트릭 15초)라 이 이벤트와 무관하다.
- **결론**: 사용자에게 보이는 고장은 아니지만 **서버·네트워크·클라이언트 모두에서 낭비이고 원인은 서버 변경 감지 키다.** 화면에서 막지 않았다(결정 7).

**컨트롤 플레인 시나리오 전환 (진짜 mock API, 실제 픽셀)**

| 시나리오 | 매트릭스 칸(실측 `data-cell-state`) | 확인 |
|---|---|---|
| `cp-healthy` | ok 15 | 섹션 ok |
| `cp-node-down` | ok 10 · **notReporting 5** | 그 열 머리 배경 sunken + 아이콘, 칸에 **빗금 + solid + `마지막 보고 00:09`**, 요약 `알 수 없음 5` |
| `cp-component-crash` | ok 13 · **crit 1** · **missing 1** | crit 2px 테두리 + `CrashLoopBackOff · 재시작 4회`, missing dashed + `필수 구성요소가 보이지 않습니다`, 행·열 머리 `octagon-x` |
| `cp-quorum-lost` | ok 5 · notReporting 10 | |
| `cp-single` | ok 5 | 열 1개 |
| `cp-not-found` | 칸 0 | UnknownState + 서버 사유, 역할 탭 `컨트롤 플레인 0`, **워커 목록 정상**(AC-KOPS17), 한계 안내 유지 |
| `kube-stale` | **stale 15** | **빗금 없음 + dashed + `09:16:13 기준`** |

- **"보고 없음"과 "데이터 오래됨"이 눈으로 확실히 다르다**(빗금·테두리·아이콘·문구 4가지가 모두 다름). 스크린샷 2장으로 확인했다. **이 프로젝트에서 처음으로 사람이 눈으로 확인한 항목이다.**
- 열 머리 툴팁(`노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5`)이 서버 `columns[].reason`을 그대로 쓴다 — 마스터 표 `사유` 열과 같은 문자열인 것을 테스트로 고정.

**그 밖 화면 확인**
- 개요: 카드 6개 3×2, 컨트롤 플레인 맨 앞 + crit 강조, `마스터 3/3` · `필수 구성요소 13/15`, 요약 띠 `노드 Ready (워커) 6/6` + 부제 `컨트롤 플레인 3/3`, 확인 항목에 `컨트롤 플레인` 영역 행.
- 비용: kOps 안내 InlineAlert, 카테고리 `컨트롤 플레인` + `circle-help`, 내역 그룹 기본 펼침 + 종류 칩 5종 + `API 서버 LB로 추정 (1개)` 칩(그룹 행·비고 두 곳).
- 폭: **1024 / 768 / 360px 모두 페이지 가로 스크롤 0**(`scrollWidth == clientWidth`). 360px에서는 매트릭스가 자체 가로 스크롤 + `가로로 스크롤할 수 있습니다` 힌트, 머리 열 sticky 동작 확인.
- **어드바이저 인스턴스 ID 노출 0건**: 화면 본문·"보낼 데이터 보기" 드로어 JSON 모두 `i-0[0-9a-f]{8,17}` **0건**. 가명은 `control-plane-ap-northeast-2a-node-1` 형태로 나온다. 일반 노드 화면에서는 실제 이름(`i-0a1b…`)이 그대로 보인다 — 의도대로다.

**실패·건너뛴 검증 (숨기지 않는다)**
- **`npx vitest run` 전체 실행에서 `k8s-snapshots/pages.test.tsx`의 드리프트 탭 테스트가 한 번 실패했다.** 같은 파일 단독 실행과 이후 전체 실행 2회에서 모두 통과했다. **플레이크로 보지만 원인을 규명하지 못했다.** 이 파일은 이번에 이름 문자열만 바꿨다.
- **`controlPlaneVolumes[]`의 "etcd 볼륨 · IOPS 민감" 표시를 실제로 보지 못했다.** 진짜 mock의 `advisor: normal` 시나리오에서 `controlPlaneVolumes`가 **빈 배열**이고 R-GP2 대상이 PVC(`monitoring/grafana`)뿐이라 그 분기가 나오지 않는다. 다만 그 문구는 서버가 `summary`·`evidenceText`·`evidence[].text`로 내려보내고 어드바이저 화면은 **그 필드를 그대로 렌더**하므로(코드 확인) 데이터가 오면 자동으로 보인다. **화면 코드 변경은 없었다.** → 8절에 backend 확인 요청.
- **`promptVersion`은 웹 타입·화면 어디에도 없다**(전체 검색 0건). 브리지·실행 기록 내부 값이라 프론트에서 할 일이 없었다.
- dev 모드 hydration 불일치 경고는 **여전히 있다**(`/cluster/nodes`·`/pods`·`/events`). 지난 회차와 같은 기존 문제이고 이번 변경과 무관하다(개요에는 없음).
- 실제 Postgres·live kOps 클러스터는 이번에도 없다.
- 리소스 내역 표가 1440px에서 **19px 넘친다**(열 폭을 줄여 161 → 19px). 완전히 0으로 만들려면 디자인 열 폭을 더 줄여야 해서 그룹 행 칩으로 보완했다.

**띄운 프로세스**: 웹 dev PID 24180(:3123), 진짜 mock API PID 22092(:3124, `node dist/main.js`). **두 PID만 지정 종료**(`Stop-Process -Id`), 이미지 이름 일괄 종료 없음. 종료 후 포트·자식 프로세스 0 확인.
**`apps/api`를 다시 빌드하지 않았다** — 백엔드가 P5 작업 중이라 `nest start`(`deleteOutDir: true`)가 상대 `dist/`를 지우는 것을 피하려고, 09:08에 만들어진 기존 `dist`를 그대로 실행했다(P3·P4 결과물 포함 확인).

### 7. 남은 이슈·한계

1. **`cluster.controlplane.updated`가 15초마다 계속 나간다**(서버). 8절 참고. 화면에서 막지 않았다.
2. 리소스 내역 표 19px 넘침(위).
3. `etcdCluster`가 항상 null이라 연결 열이 `i-0a1b…`만 나온다(백엔드 결정 H). main/events 구분이 확정되면 문구가 자동으로 붙는다.
4. 매트릭스 `others[]`가 mock에서 12개(DaemonSet 파드 포함)라 접힘 섹션 제목이 `기타 컨트롤 플레인 구성요소 12개`다. 백엔드 7절 7번과 같은 항목 — 디자인 확인이 필요하다면 지금이 그 시점이다.
5. 마스터 표는 10열이라 1440px에서 오른쪽 몇 열(CPU·메모리·구성요소·경과)이 가로 스크롤 안에 있다. 디자인 열 폭 그대로다.
6. `workerPodCount` 경고는 **합계**로 한 줄만 띄운다(마스터별로 나누지 않음). 디자인 3.2.0이 한 줄이라 그대로 따랐다.
7. 어드바이저 화면의 `controlPlaneVolumes` 관련 표시는 데이터가 없어 미확인(6절).

### 8. 다른 담당 요청

- **backend 요청 ①(중요): `cluster.controlplane.updated`가 변화 없이 15초마다 2건씩 나갑니다.** 실구독으로 확인했습니다(75초에 15건, 프레임 18KB, 약 8.6MB/시간/클라이언트). `lastReportedAt`만 제외한 것으로는 멎지 않습니다. 연속 payload를 비교한 결과 **매 평가마다 바뀌는 필드가 더 있습니다**:
  - **A형(15초 평가 루프마다, 55개 필드)** — `status.updatedAt`, `masters.items[].node.status.updatedAt`, `masters.items[].lastReportedAt`, `components.columns[].lastReportedAt`, `components.items[].status.updatedAt`, **`components.items[].restarts.observedSec`**(관측 창이 늘어나는 값). 값의 의미가 바뀐 것이 하나도 없습니다.
  - **B형(메트릭 수집마다, 74개 필드)** — `masters.totals.cpu/memory.*`, `masters.items[].node.usage.*`. 이건 진짜 값 변화지만, 계약 8.3이 이미 *"메트릭 갱신으로 `usage`만 바뀐 경우에는 `cluster.*.upsert`를 보내지 않고 `metrics.updated`에 담는다"*고 정한 것과 같은 상황입니다. `masters.totals`는 `GET /api/cluster/metrics`의 `controlPlane`과 같은 값이라 화면에 이미 다른 경로로 옵니다.
  - **제안**: 변경 감지 키에서 `*.updatedAt`·`lastReportedAt`·`restarts.observedSec`·`usage`·`masters.totals`를 모두 빼고 **판단 결과(상태·셀 상태·문구·개수·쿼럼·HA)만** 키로 삼아 주십시오. 재현은 `node dist/main.js`(DATA_SOURCE=mock) + `GET /api/stream?topics=cluster` 60초 구독이면 됩니다.
- **backend 요청 ②**: `advisor: normal` 시나리오에서 `snapshot.controlPlaneVolumes`가 **빈 배열**이라 R-GP2의 "etcd 볼륨 포함 · IOPS 민감" 문구를 화면에서 확인하지 못했습니다. gp2 etcd 볼륨이 있는 mock 조합을 알려 주시면 바로 확인하겠습니다. 화면은 서버 문장을 그대로 렌더하므로 코드 변경은 필요 없습니다.
- **backend 참고**: `GET /api/cluster/control-plane` 응답 그대로 매트릭스를 그렸고 **빈 칸 0개**, `cellTooltip` 전부 반영을 실측 확인했습니다. `role=control_plane`의 `areaStatus`가 `areas.controlPlane`으로 바뀐 것도 확인했습니다.
- **publisher 요청 ①**: `ComponentMatrix`의 요약 숫자를 **버튼으로 만들려면 `onSummaryClick`을 반드시 넘겨야 합니다.** 강조(2000ms 깜박임)는 컴포넌트 안에서 끝나는데 핸들러가 없으면 `<span>`으로 그려져 **디자인 3.2.3의 "숫자를 누르면" 동작이 사라집니다.** 지금은 페이지에서 빈 함수를 넘겨 쓰고 있습니다 — `onSummaryClick`이 없어도 강조만은 동작하게 하거나, prop 주석에 "누르게 하려면 필수"를 적어 주시면 좋겠습니다.
- **publisher 참고**: `keepHead`는 쓴 적이 없어 영향이 없었습니다. 상단바 수정본에서 360px 넘침 0·`circle-help` 접근을 이번 스크린샷으로 함께 확인했습니다. 매트릭스 셀 폭·장애 셀 2행도 1024/1440px에서 정상입니다.
- **designer 참고**: 리소스 내역 표에 `종류` 열이 들어가면서 1440px에서 **161px 넘쳤습니다**. 금액 열을 150 → 120px로 줄여 19px까지 낮췄지만 0은 아닙니다. 열 폭을 문서에서 조정하실지, 가로 스크롤을 허용하실지 정해 주시면 맞추겠습니다.
- **PM 참고**: 6절의 "실패·건너뛴 검증" 4건(플레이크 1회, `controlPlaneVolumes` 미확인, hydration 경고, 표 19px 넘침)을 그대로 적었습니다.

### 9. 다음 담당이 알아야 할 점

- **컨트롤 플레인 화면은 `GET /api/cluster/control-plane`을 직접 부르지 않는다.** `cluster` 토픽 SSE(`cluster.snapshot.controlPlane` + `cluster.controlplane.updated`)로만 그린다. REST를 쓰면 실시간 목록과 숫자가 어긋난다.
- **셀·요약·사유는 전부 서버 값이다.** `cellState`→`CellState`는 **이름만 바꾸는 매핑**이고(`ControlPlaneSection.tsx`의 `CELL_STATE`) 판단이 아니다. 새 상태가 생기면 그 표에 한 줄만 추가하면 된다.
- **"알 수 없음" 숫자는 `cellCounts.unknownTotal` 하나만 쓴다.** `notReporting + unknown + missing`을 화면에서 더하지 말 것.
- **PageHeader 배지는 `nav.nodes`(서버 합성값)다.** 워커·컨트롤 플레인을 화면에서 비교해 최악을 고르지 말 것.
- **비용 라벨·순서는 `@/components/ui`의 `COST_CATEGORY_*`·`CONTROL_PLANE_KIND_*` 한 곳뿐이다.** `features/aws-cost/types.ts`는 그 타입을 재수출만 한다.
- **`apiLb`는 후보 0개여도 항상 있다.** "행이 없다"로 세 경우를 구분하지 말고 `apiLb.state`를 볼 것. `assumed`의 "추정" 라벨은 그룹 행과 비고 두 곳에 있다.
- **어드바이저로 나가는 값만 가명이다.** 노드 목록·상세·컨트롤 플레인 섹션에는 실제 이름(`i-0…`)이 나와야 정상이다. 어드바이저 화면에서 `i-0…`가 보이면 버그다(현재 0건).
- **드리프트 짝은 이름이 아니라 `CLUSTER_ID`로 맞춘다.** `__fixtures__/k8s-snapshots.ts`의 `CLUSTER_ID` 상수를 바꾸면 대시보드·스냅샷·드리프트 세 곳이 함께 깨진다.
- 검증용 가짜 API는 이번엔 쓰지 않았다. **진짜 `apps/api`의 기존 `dist`를 `PORT=3124 DATA_SOURCE=mock node dist/main.js`로 실행**했다(재빌드 없음 — `nest start`는 `deleteOutDir`로 남의 `dist`를 지운다). mock 시나리오 전환은 `PUT /api/mock/scenarios/cluster` 본문 `{"scenario":"cp-node-down"}`이다(`id`가 아니라 `scenario`).
