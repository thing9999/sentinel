# kops-support · 대상 환경 EKS → kOps 전환 (2026-09-24~)

명세: [`docs/specs/kops-support.md`](../../specs/kops-support.md) — 수용 기준 AC-KOPS01~46, 단계 P1~P5(P6은 다음 범위)

## 진행 현황

> **현재 상태 (2026-09-25)**: 구현 전 단계 완료. **`apps/api` 462개 전부 통과(실패 0)**, **`apps/web` 510개 전부 통과**. lint·build 통과.
> 남은 것은 **6단계 PM 검증(AC-KOPS01~46)**과 실클러스터·실 Postgres 확인뿐이다.

| # | 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|---|
| 1 | 기획 | planner | [planner.md](planner.md) | **완료** — 확인 11건(F1~F11)·미확인 8건(U1~U8) 분리, 열린 질문 Q1~Q9 |
| 1b | 기존 명세 충돌 반영 (+2회 후속) | planner | [planner.md](planner.md) | **완료** — 기존 명세 6개 반영, Q9 이름 변경, `snapshot-3d` 노드그룹 정합, AC 예시 이름 정리 |
| 2 | 디자인 (+4회 후속) | designer | [designer.md](designer.md) | **완료** — 개요 카드 6개(3×2), 컨트롤 플레인 섹션·구성요소 매트릭스, "보고 없음" vs "오래됨" 구분, 긴 FQDN, 비용 표 폭 예산. 새 컴포넌트 1개, **디자인 토큰 추가 0건(5회 연속)** |
| 2 | DBA | dba | [dba.md](dba.md) | **완료** — RENAME 마이그레이션(기존 행 보존), `resources` jsonb `kind` 동반 변경, `baselineFrom` 신설. PGlite 18/18·jest 157 통과. **실제 Postgres 16 미검증** |
| 3 | API 계약 | backend | [backend.md](backend.md) | **완료** — `docs/api/` 7개 갱신(+706/-123). `GET /api/cluster/control-plane` 신설, 가명 규칙 P1~P4, `KUBE_AUTH_FAILED` |
| 4 | 퍼블리싱 (+3회 후속) | publisher | [publisher.md](publisher.md) | **완료** — `ComponentMatrix` + 확장 3개, 상단바 FQDN, `ResourceName` 넘침 버그, 요약 강조 기본 동작화. lint·typecheck 0건 |
| 4 | 구현 P1·P2 (EKS 제거·분리 집계) | backend | [backend.md](backend.md) | **완료** — test 398 → 416. 워커 기준 집계, 배분 합계 오차 0 |
| 4 | 구현 P3·P4 (컨트롤 플레인·비용) | backend | [backend.md](backend.md) | **완료** — test 416 → 440. 시나리오 7개 재현, 카테고리 합계 오차 0, 매트릭스 빈 칸 0 |
| 4 | 구현 P5 (+2회 마무리) | backend | [backend.md](backend.md) | **완료** — 가명 P1~P4(스냅샷 `i-…` 0건 고정), 어드바이저 규칙 정리, mock kOps화, `deploy/` 문서. test 440 → 457 |
| 5 | 통합 (선행분 + 본편) | frontend | [frontend.md](frontend.md) | **완료** — 컨트롤 플레인 화면, 비용 카테고리, mock 정합. **vitest 510 전부 통과**. Edge로 시나리오 7개 실측 |
| 4 | SSE 변경 감지 마무리 | backend | [backend.md](backend.md) | **완료** — `statusChangedAt`을 volatile 키에 추가(코드 1줄). api **462 passed / 0 failed**. SSE 실관찰 75초×3+45초, `cluster.controlplane.updated` **총 0건** |
| 6 | 검증 (AC-KOPS01~46) | PM | | **착수 가능** |

### 다음 범위 (이번에 하지 않기로 한 것)
- **`deploy/kops-snapshot/`** — kOps `Cluster`/`InstanceGroup` 스냅샷 CLI. 8절 참조. 폴더 이름만 예약하고 코드·화면은 만들지 않았다
- 어드바이저 2단계 규칙(R-CP-EVEN·R-CP-AZ·R-CP-UNDERSIZE), 쿠버네티스 EOL 규칙(`R-K8SVER`), etcd 심층 지표(Prometheus), 컨트롤 플레인 추이 그래프

## PM 결정 기록

### CLAUDE.md 확정 (2026-09-24, 기획 전)
- 대상 환경을 **kOps 클러스터(EC2 컨트롤 플레인)**로 변경, EKS 미지원
- EKS 경로를 코드에서 **완전히 제거**. `PLATFORM` 분기 설정을 두지 않는다
- `autoscaling:DescribeAutoScalingGroups` **추가하지 않는다** (노드그룹은 노드 라벨로만)
- 컨트롤 플레인 모니터링은 **기존 RBAC 안에서 static pod 상태까지만**. Prometheus 심층 지표는 범위 밖
- AWS 권한 목록에서 `eks:DescribeCluster` 제거

### 기획 결과 검토 (PM, 2026-09-24)
- 명세 채택. 단계 구분 P1~P5와 AC-KOPS01~46을 그대로 수용한다.
- planner 권고를 그대로 채택한 열린 질문: **Q2**(사이드바 컨트롤 플레인 메뉴 신설 안 함), **Q3**(단일 마스터 기본 "주의" + `CONTROL_PLANE_HA_EXPECTED=false`로 끄기), **Q5**(어드바이저 실행 예시에 `kops` 명령 허용 — `--yes` 없는 형태 + 미실행 경고 필수), **Q6**(마스터에 워크로드 올리는 구성은 범위 밖 + 경고 한 줄), **Q7**(쿠버네티스 EOL 규칙 `R-K8SVER`는 이번 범위 밖)
- **AC-KOPS44(인스턴스 ID 노출)를 PM이 코드로 확인함.** `apps/api/src/advisor/snapshot/sanitize-snapshot.ts:158`은 IP 형태가 아닌 노드 이름을 원문 그대로 통과시킨다. kOps에서 노드 이름이 `i-0…`(F10)가 되면 인스턴스 ID가 로컬 Claude Code로 전송되어 `architecture-advisor` 명세 3.4("인스턴스 ID는 항상 제외")를 위반한다. **planner 지적이 사실임을 확인했다.**
- **U2(API 서버 NLB 이름·태그 규칙 미확인)**는 틀리면 비용이 조용히 틀리는 항목이다. 백엔드가 실클러스터에서 최우선 확인하고 `docs/api/aws-cost.md`에 확정 규칙을 적는다.

### 사용자 결정 (2026-09-24) — 열린 질문 9건 전부 종결
| # | 결정 | 비고 |
|---|---|---|
| Q1 | **개요 카드를 6개로 늘린다** | 컨트롤 플레인 전용 카드 추가 (planner 권고 채택) |
| Q2 | 사이드바 "컨트롤 플레인" 메뉴 **신설 안 함** | 노드 화면 섹션 + `nav.nodes`에 합산 (PM 판단) |
| Q3 | 단일 마스터는 기본 **"주의"**, `CONTROL_PLANE_HA_EXPECTED=false`로 끌 수 있다 | (PM 판단) |
| Q4 | 노드 목록 기본 필터 **`role=worker`** | "총 N대"가 항상 워커 기준 → 개요·비용 집계와 숫자 일치 |
| Q5 | 어드바이저 실행 예시에 `kops` 명령 **허용** | `--yes` 없는 형태만 + "대시보드는 실행하지 않습니다" 경고 필수 (PM 판단) |
| Q6 | 마스터에 워크로드를 올리는 구성은 **범위 밖** | 감지되면 경고 한 줄만 (PM 판단) |
| Q7 | 쿠버네티스 EOL 규칙(`R-K8SVER`)은 **이번 범위 밖** | (PM 판단) |
| Q8 | `deploy/kops-snapshot/`은 **다음 범위** | 이번엔 폴더 이름 예약 + 제약 기록만. 코드·화면 없음 |
| Q9 | mock 클러스터 이름을 **문서까지 일괄 변경** | `prod-eks`→`prod.k8s.example.com`, `staging-eks`·`bench-eks`도 함께 |

추가 PM 지시: 기존 명세(`cluster-status`, `aws-cost`, `architecture-advisor`, `k8s-snapshot`)의 충돌 문구는 **planner가 9절 충돌표대로 직접 반영**한다. 충돌표만 남겨두면 두 문서가 어긋난 채로 구현이 시작된다.

## 확정 이름 규약 (모든 담당 공통)
planner가 `docs/specs/`에서 확정. 다른 담당도 자기 영역에서 **정확히 같은 값**을 쓴다.
- `prod-eks` → `prod.k8s.example.com`
- `staging-eks` → `staging.k8s.example.com`
- `bench-eks` → `bench.k8s.example.com`

드리프트 짝 맞추기처럼 **클러스터 ID가 문서 간에 일치해야 하는 곳**이 있다. specs 안에서는 확인 완료(k8s-snapshot 4.6 ↔ snapshot-3d K-9 = `staging…`, 시간축·A-1·AC-3D51 = `prod…`). `docs/api/`·`docs/design/`·코드 픽스처는 각 담당이 바꾼 뒤 specs와 짝을 확인한다. (2026-09-24 backend·designer에 전달 완료)

## PM 검증 기록 (2026-09-24)
- **DBA가 보고한 "조용한 저장 실패" 위험을 PM이 코드로 확인함.** `apps/api/src/cost/store/cost-store.ts:253-262`의 `data`는 별도 변수로 만들어져 `...data`로 펼쳐지므로 **TypeScript 초과 속성 검사가 걸리지 않고**, `saveRateSample`의 `try/catch`가 Prisma 예외를 `this.warn`으로 삼킨다. `eksUsdPerHour:`를 그대로 두면 tsc·빌드가 모두 통과하는데 소모율 표본만 저장되지 않아 급증 판단이 말라 죽는다. **backend 구현 단계 최우선 항목**으로 전달 완료.
- DBA가 과거 값을 보존한 판단에 동의한다. EKS 관리 요금과 kOps 실비는 금액의 의미가 다르지만, 값을 지우면 ① 기준선이 끊기고 ② 행 불변식 `total = ec2+ebs+lb+controlPlane+ipv4`가 깨진다. 스키마 증설 없이 `baselineFrom` 한 필드로 오탐을 막은 것이 적절하다.
- `docs/db/schema.md:35`의 "환경: EKS + …" 문구는 **실제로 존재하지 않았다**(명세 7절의 줄 번호가 오래된 참조). 명세 10절의 다른 줄 번호도 같은 이유로 어긋날 수 있으니 각 담당은 줄 번호를 믿지 말고 검색으로 확인할 것.

## PM 결정 — 계약 단계에서 올라온 빈칸 2건 (2026-09-24)
1. **`kube-auth-failed` mock 시나리오를 유지한다.** AC-KOPS25는 `cp-*` 6개만 정했지만, AC-KOPS38(토큰 만료 시 mock으로 대체되지 않음)을 live 클러스터 없이 검증할 다른 수단이 없다. 시나리오를 빼면 그 수용 기준이 검증 불가가 된다.
2. **어드바이저 스냅샷 `cluster.nodeCount` 삭제 → `workerCount`/`controlPlaneCount` 승인.** D1(하위 호환 없음) 해석이 맞다.
   - **단, PM이 확인한 영향 지점**: `apps/api/src/advisor/run/run-model.ts:240-243`이 `prev.nodeCount !== current.nodeCount`로 "분석 후 노드 수가 N → M로 바뀌었습니다" 경고를 만든다. 이 필드가 사라지면 깨진다. **워커 수 변화와 마스터 수 변화를 각각 알리도록** 바꾼다 — 마스터 수 변화는 워커보다 중요한 신호라 뭉뚱그리면 안 된다.
   - 무관한 동명 필드는 건드리지 않는다: `precheck-rules.ts:826`의 `g.nodeCount`(노드그룹별 대수), `cost.types.ts:284`·`estimator.ts:355`·`cost-store.ts`의 비용 쪽 `nodeCount`.

## 다음 단계 인계 (4·5단계에서 쓸 것)

### 퍼블리싱
- 새 컴포넌트는 **`ComponentMatrix` 하나뿐**. 기존 확장 3개: `StatusCard.primarySub`, `SummaryStripItem.sub`/`subHref`, `ResourceName kind="cluster"`(앞 12자+뒤 8자 보존, sans). `Chip`·`SegmentedControl`은 props 변경 없음.
- 아이콘 `server-cog`(없으면 `cpu`), `CATEGORY_LABEL`에서 `eks` → `controlPlane`("컨트롤 플레인").
- 매트릭스 치수: 머리 열 220px sticky, 셀 폭 `clamp(140, (가용폭−220)÷N, 240)px`, 셀 48px + 간격 4px, 높이 296px 고정, 진짜 `<table>`.
- **디자이너 요청**: 글자 폭이 실측이 아니라 근사치다. 카드 머리와 매트릭스 머리 열 220px을 실측으로 확인할 것.

### 프론트
- **상단바에 `ResourceName kind="cluster"` + `tooltipExtra` + `shell.md` 2.1 축소 순서를 적용해야 한다. 현재 미적용이라 360px 동작이 아직 성립하지 않는다.**
- 카드 6장 3×2(376px), 노드 목록 기본 `?role=worker`, 앵커 `#control-plane`(`scroll-margin-top: 96px`).
- **쿼럼·HA·셀 상태는 전부 서버 값이다.** 화면에서 상태를 계산하지 않는 기존 원칙 유지.
- **"노드 미보고"를 stale로 그리면 안 된다**: 빗금 + solid 테두리 + `마지막 보고 HH:mm` / stale은 빗금 없음 + dashed + `HH:mm 기준`. 이 둘이 같아 보이면 장애를 놓친다.

## 퍼블리싱에서 올라온 인계 (2026-09-24)
- **frontend**: `columns[].reason`에는 마스터 표 `사유` 열과 **같은 서버 문자열**을 그대로 넘길 것 (화면에서 문장을 새로 만들지 않는다)
- **frontend**: `features/aws-cost/types.ts`·`CostTables.tsx`의 `CostCategory`/`CATEGORY_LABEL`을 `@/components/ui`의 **`COST_CATEGORY_LABEL`**(`eks`→`controlPlane`, "컨트롤 플레인")·**`CONTROL_PLANE_KIND_LABEL`**로 교체. 퍼블리셔가 영역 밖이라 직접 고치지 않았다. → 5단계에서 처리
- **backend(P3)**: ⑥ `columns[].reason`용 마스터 사유(마스터 표와 같은 값) ⑦ 셀 `detail`은 짧은 쪽부터 + 가능하면 `tooltip` 동봉 ⑧ 요약 `알 수 없음`에 `notReporting`·`missing` 합산(위 PM 결정) → P3 지시에 포함
- **designer**: `components.md` 18.1 `columns[]`에 열 머리 툴팁용 사유 필드 추가, 최소 셀 폭 140px에서 `meta`·`crit` 2행 문구가 말줄임된다는 점 문서화 → **전달 완료**

## PM 결정 — 요약의 "알 수 없음" 집계 (2026-09-24)
디자이너 권고를 채택한다: **매트릭스 셀에서는 `notReporting`과 `missing`을 구분해 보여주되, 요약 카운트에서는 `알 수 없음` 하나로 합친다.** 사용자에게 "없음"과 "모름"은 둘 다 "확인 안 됨"이다. 요약에서 둘을 갈라 놓으면 숫자만 늘고 판단에 도움이 되지 않는다. → P3 지시에 포함(퍼블리셔 요청 ①·디자이너 요청 ⑧ 동일 건)

## PM 결정 — 열 머리 툴팁의 칸 수 표기 (2026-09-24)
**최악 상태가 `ok`이면 칸 수를 붙이지 않는다** (`노드 정상 · 구성요소 정상`). 퍼블리셔 구현을 그대로 채택한다. 문서가 칸 수를 `[ ]`(선택)로만 적고 `ok`인 경우를 명시하지 않아 생긴 빈칸이었다.
근거: "정상은 조용하게" 원칙. 전부 정상인 열에서 "구성요소 정상 5"는 새 정보가 없고, 숫자가 붙어 있으면 오히려 눈길을 끈다. 숫자는 **문제가 있는 칸이 몇 개인지** 알릴 때만 의미가 있다. (되돌리려면 `cellWorst !== "ok"` 조건 한 줄만 지우면 된다.)

## P1·P2 결과 검토 (PM, 2026-09-24)
- PM이 넘긴 위험 2건 모두 처리됐다. **`cost-store` 회귀 테스트가 특히 좋다**: 가짜 Prisma가 `schema.prisma`의 필드 이름과 대조해 모르는 인자를 거부하고 경고 로그까지 확인한다. 일부러 옛 이름으로 되돌려 2건 실패 → 원복 재통과로 **방어선이 실제로 동작하는 것까지 확인**했다(그때도 lint·tsc는 통과했다 — 타입이 못 잡는 자리라는 진단이 맞았다는 뜻).
- `run-model` 신선도 경고를 `WORKER_COUNT_CHANGED`·`CONTROL_PLANE_COUNT_CHANGED` 둘로 분리하고, 과거 실행 기록(DB JSON)에 필드가 없을 때 가짜 경고가 나지 않도록 **두 값이 모두 숫자일 때만 비교**한 처리가 적절하다.
- backend가 계약 3단계의 누락(`SnapshotSummary.nodeCount`)을 구현 중 발견해 계약을 정정했다. 스냅샷 `cluster.nodeCount`만 나누고 **실행 기록 요약은 그대로 뒀는데, 신선도 경고의 근거가 후자였다.**
- 명세 10절의 줄 번호가 이번에도 여러 곳 어긋났다. 이제 이 명세의 줄 번호는 **참고용으로만** 쓴다.

## 즉시 처리 (P3 최우선)
**어드바이저 스냅샷 `platform`이 아직 `'eks'`다.** backend가 "P3~P5를 건드리지 마라"는 내 지시를 지켜 남겨뒀다(AC-KOPS43 = P5). 지시는 옳게 지켜졌지만, 그 결과 **지금 로컬 Claude Code에 `eks`라는 잘못된 환경 정보가 그대로 전달된다.** 한 단어 변경이고 분기 코드도 없으므로 P5를 기다리지 않고 P3에서 먼저 고친다.

## PM 결정 — 프론트 통합에서 올라온 판단 3건 (2026-09-24)
1. **역할 탭 개수를 SSE 스냅샷 분할로 만든 것을 승인한다.** 이 화면은 REST를 부르지 않고 `cluster.snapshot`으로 그리고, 계약 8.2가 "스냅샷 `nodes`에 마스터도 있고 화면이 `role`로 나눈다"고 명시한다. REST `roleCounts`를 따로 받으면 **실시간 표의 행 수와 탭 숫자가 어긋난다.** 서로 다른 출처를 더한 것이 아니라 서버가 붙인 `role`로 나누기만 했으므로 "상태를 화면에서 계산하지 않는다" 원칙에도 어긋나지 않는다.
2. **상단바 FQDN을 프론트가 적용하지 않은 것은 옳은 판단이다.** `TopBar`는 퍼블리셔 영역(`components/ui/shell/**`)이다. 영역을 넘지 않고 실측으로 문제를 특정해 넘긴 것이 규칙대로다. → 퍼블리셔에 전달 완료.
3. 디자이너 글자 폭 근사치가 **실제보다 8~10% 컸다**(`staging.k8s.example.com` 실측 154px vs 근사 168px). 결론("확정 세 이름은 360px에서 안 잘림")은 실측으로도 성립하므로 디자인 문서를 다시 고치지는 않는다.

## 실제 브라우저 렌더 — 최초 확인 (2026-09-24)
프론트가 **Playwright + 이미 설치된 Edge**를 써서 브라우저 다운로드 없이 실제 픽셀을 확인했다. 그동안 "헤드리스 브라우저가 없어 못 봤다"던 항목들을 같은 방법으로 확인할 수 있다는 뜻이다. 퍼블리셔에게 빗금 6px 간격·툴팁 렌더도 같은 방법으로 보라고 전달했다.

## P3·P4 결과 검토 (PM, 2026-09-24)
backend가 **지시에 없던 문제 3건을 스스로 찾아 고쳤다.** 전부 "테스트는 통과하는데 화면이 거짓말을 하는" 부류다.
1. **headline이 배지와 어긋났다.** 계약 9절 우선순위만 쓰면 `cp-component-crash`에서 status는 `critical`인데 headline은 주의 문장(`구성요소 4/5`)이 나온다. 화면은 headline을 그대로 찍으므로 사용자는 장애를 주의로 읽는다. → 등급 우선 → 계약 우선순위 순으로 정렬 변경.
2. **SSE 무한 발화.** `lastReportedAt`이 매 평가마다 바뀌어 `cluster.controlplane.updated`가 끝없이 나갔다. → 값은 응답에 두고 **변경 감지 키에서만** 제외.
3. **`kube-apiserver-healthcheck`를 `kube-apiserver`로 오인**(접두어 규칙). 안 고치면 healthcheck 장애가 apiserver 장애로 보인다. → 긴 접두어 우선 + 제외 목록.
- 추가로 **워커 파드 수에서 DaemonSet을 제외**했다. CNI·로그 수집은 설계상 마스터에 올라가므로 Q6 경고가 상시 켜져 의미를 잃는다. 타당한 판단이다.
- **함정 하나**: `priceNeedsOf`에 컨트롤 플레인 행을 넣지 않으면 마스터·etcd·API LB가 통째로 "단가 없음"이 된다(처음에 실제로 그랬다). 함께 고쳤다.

## 실제 브라우저 렌더가 잡아낸 것 (2026-09-24)
프론트가 Playwright + 설치된 Edge로 길을 연 뒤, **코드 리뷰·단위 테스트로는 전혀 보이지 않던 결함이 연달아 나왔다.** 이 방식이 이 프로젝트에서 유효하다는 증거로 기록해 둔다.
- `ResourceName kind="cluster"` **넘침·겹침**(프론트 발견) — 앞12/뒤8을 `flex-shrink:0` 별도 토막으로 둔 구조 자체가 원인. 퍼블리셔가 두 토막 구조로 바꿔 해결. 중간 수정안 2개(`overflow:hidden`만 / shrink 0.001)는 각각 **말줄임 2회**, **뒤 8자 32~72px 잘림**을 냈고 **실측으로만 드러났다.**
- **매트릭스 셀이 칸을 안 채우고 73px로 쪼그라들어 있었다** — `Tooltip.tooltipAnchor`(inline-flex)가 `cellAnchor`(block)를 이김. 특이도를 올려 236px로 해결.
- **장애 셀 2행이 잘렸다** — 줄 gap 2px 때문에 50px > 48px. gap 제거 + 패딩 1px.
- **빗금 6px 간격 확인 완료** — 3배 확대·회색조에서 또렷하고 "보고 없음" 열이 한눈에 갈린다. 조정 불필요. (추적 항목 해소)
- 상단바: 1440~900 전부 표시 / 768 리전 접힘 / 600·480·360 아이콘만, **모든 폭에서 헤더 넘침 0**. 360px에서 7px 넘치던 것을 대체 버튼 24px + 여백 12→8px로 해결.

## 디자이너가 스스로 잡은 자기 문서의 오류 (2026-09-24)
`shell.md` 2.1의 마지막 행이 **"블록을 숨기고 로고 오른쪽에 `circle-help` 버튼"**이었는데, **컨테이너 쿼리는 컨테이너 안쪽에만 걸리므로 버튼이 블록 밖이면 "가용 폭 < 160px" 조건을 CSS로 쓸 수 없다.** 즉 문서대로는 규칙이 성립하지 않았다. 구현(퍼블리셔)이 맞고 문서가 틀린 경우였고, 디자이너가 "조치 불필요"라고 전달받은 항목을 검토하다 발견해 고쳤다.
- 정정: 축소 기준이 뷰포트가 아니라 **블록에 남는 폭**, 대체 버튼은 **블록 안**, **1024px 미만에서도 `display:none` 금지 · 폭 24px로 축소**.

또 `keepHead` 제거를 받으면서 **문장 자체를 재서술**했다 — "앞 12자 + 뒤 8자 보존" → "뒤 8자를 고정 보존하고, 앞부분은 폭이 허락하는 만큼 남긴 뒤 그 끝에서 말줄임". 약속하는 것과 최선을 다하는 것을 갈랐다. 문장을 그대로 두면 다음 사람이 "문서가 12자를 약속했으니 토막을 나누자"로 되돌아가기 때문이다. **고정 토막을 쓰지 않는 이유(이중 말줄임 / flexbox 계수로 뒤 8자 손실)도 보고서가 아니라 스펙에 남겼다** — 구현 제약이 아니라 설계 제약이라는 판단이다.

## P5 결과 검토 + PM 결정 (2026-09-24)

### 채택한 backend 판단 2건
1. **맨 IPv4(`10.0.12.34`)를 문장 스캔 대상에서 제외.** 문장 속 IPv4를 노드 가명으로 바꾸면 **파드 IP·CIDR을 거짓으로 만든다.** 노드 이름으로 쓰인 IPv4는 실제 이름 치환 단계가 잡으므로 AC-KOPS44 합격 기준(`i-[0-9a-f]{8,17}` 0건)은 그대로 만족한다. 가명 처리의 목적은 식별자 유출 차단이지 IP 모양 문자열 전멸이 아니다.
2. **`controlPlaneVolumes[]` 신설.** AC-KOPS42는 "R-GP2 대상에 etcd 볼륨이 포함될 때"를 전제하는데, **정작 etcd·마스터 루트 볼륨이 스냅샷 어디에도 없었다.** `unattachedVolumes`에 넣으면 R-EBSIDLE이 "미연결"로 오탐하고 `storage[]`는 `namespace`가 필수라 맞지 않는다. 막힌 전제를 뚫은 판단이 맞다.

### PM 결정 — `deploy/`의 EKS 잔재 2건을 다르게 처리
- **`deploy/k8s-snapshot/lib`의 `eks:` 접두어 RBAC 제외 규칙 → 남긴다.** planner가 `docs/specs/k8s-snapshot.md` 3.4에서 이미 "EKS 잔재 — 다음 정리 때 삭제" 존치로 정했고, kOps에서 매칭되는 객체가 없어 무해하다. 지우면 CLI 테스트 65건을 함께 손봐야 하는데 이득이 없다. **AC-KOPS01의 "동작하는 코드 경로"는 `apps/api/src` 기준으로 판정한다.** 단 왜 남아 있는지 주석을 남긴다.
- **`deploy/aws-snapshot/README.md`의 EKS 복원 절차 문구 → 고친다.** 이쪽은 **사람이 읽고 그대로 따라 하는 절차 문서**라, 대상 환경이 바뀐 지금 그 절차는 틀린 안내다. "무해한 잔재"가 아니라 **해로운 오안내**다. kOps 복원 절차를 새로 쓰라는 뜻은 아니고(그건 `deploy/kops-snapshot/` = 다음 범위), EKS 전제를 걷어내고 한계를 적는 선까지.

### 배포 주의사항 (운영)
- **`promptVersion`이 `advisor-v1` → `advisor-v2`로 올라갔고 브리지는 v2만 받는다. api와 agent-bridge를 반드시 함께 배포해야 한다.** 따로 올리면 어드바이저가 조용히 죽는다.
- 로컬 `.env`의 `EKS_CLUSTER_NAME`을 **`K8S_CLUSTER_NAME`으로 직접 고쳐야 한다**(하위 호환 없음). `npm install` 후 `prisma generate` 필요.

## PM 결정 — 수용 기준의 예시 값은 실제 mock과 일치해야 한다 (2026-09-24)
planner가 `docs/specs/kops-support.md`의 예시 노드그룹 이름(`nodes-ap-northeast-2a`·`spot-batch`)이 확정 mock 이름과 다르다고 보고했다. **고치기로 했다.**
근거: 곧 PM이 AC-KOPS01~46을 mock으로 하나씩 확인한다. **기준의 예시 값이 실제 mock과 다르면 "기준을 만족한 것인지 구현이 틀린 것인지" 판단이 흐려진다.** 수용 기준은 그대로 실행해서 확인할 수 있어야 한다. 특히 AC-KOPS03은 검증 대상 기준이다.
함께 지시: AC-KOPS03의 핵심은 **라벨 키(`kops.k8s.io/instancegroup`)**이지 특정 이름이 아니라는 점이 문장에서 읽히게 할 것. 그러지 않으면 mock 이름이 또 바뀔 때 같은 혼선이 반복된다.

## PM 사전 대조 — 검증 준비 (2026-09-24)
planner가 "검증 전 확인해 둘 것"으로 남긴 두 지점을 PM이 코드로 대조했다. **둘 다 일치한다.**
- **AC-KOPS25의 mock 시나리오 ID 6개** — `apps/api/src/cluster/mock/mock-world.ts:32-37`에 `cp-healthy`·`cp-single`·`cp-node-down`·`cp-quorum-lost`·`cp-component-crash`·`cp-not-found`가 명세와 **철자까지 같다.** `kube-auth-failed`(:30)도 있다. 시나리오 전환으로 바로 검증할 수 있다.
- **AC-KOPS10의 "마스터 3대 + 워커 6대"** — backend P1·P2 실행 확인값(워커 6 / 마스터 3)과 일치. `mock-world.ts:785-789`가 마스터 대수를 시나리오별로 갈라 놓았고(`cp-not-found` 0대, `cp-single` 1대, 그 밖 3대) 기본 세계는 3대다.

즉 명세의 예시 값과 실제 mock이 어긋나 검증이 막히는 지점은 AC-KOPS03 하나뿐이었고, 그것도 정리됐다.

## PM 결정 — backend의 범위 초과 1건 유지 (2026-09-24)
backend가 `deploy/aws-snapshot/README.md`만 지시받고 **`deploy/k8s-snapshot/README.md` 3장(권한·컨텍스트)도 함께 고쳤다.** 보고하고 되돌릴 수 있음을 밝혔다. **유지한다.**
근거: PM이 세운 기준("사람이 따라 하는 절차 문서의 틀린 안내는 해롭다")이 `aws-snapshot`보다 여기에 더 강하게 걸린다. kOps에는 `aws eks create-access-entry`·`aws eks update-kubeconfig`가 **존재하지 않아** 그 자리에서 막히고, 3장은 이 CLI를 처음 쓸 때 반드시 거치는 첫 단계다.
backend가 추가로 잡은 것(지시에 없던 부분): **`kops export kubeconfig --admin`을 쓰면 4번의 `auth can-i` 확인이 통과해 버려 검증 자체가 무의미해진다** → 금지 경고 삽입. 타당하다.

## 배포 주의사항이 README에 없었다 (2026-09-24)
`promptVersion` 불일치 경고가 README에 **아예 없던 것**을 backend가 확인하고 추가했다. 한쪽만 올리면 400 `unsupported_prompt_version`으로 **어드바이저만 조용히 죽고 다른 화면은 멀쩡해 보인다.**

## 실클러스터 확인 우선순위 — PM이 알던 것과 달랐다 (2026-09-24)
PM은 **U2(API LB)를 1순위**로 추적해 왔으나, backend가 `deploy/` 문서를 정리하면서 **더 위험한 것을 짚었다.** 위험도 순서를 아래로 갱신한다.

| 순위 | 항목 | 틀렸을 때 |
|---|---|---|
| **①** | **`k8s.io/role/*` 역할 태그 접두어 (U3)** | **마스터를 지울 수 있다.** 복구 불가 영역 |
| ② | API 서버 LB 이름·태그 (U2) | 리소스를 못 지우고, **비용도 함께 조용히 틀린다** |
| ③ | kOps 보안 그룹 이름 (`masters.<클러스터>`·`nodes.<클러스터>`) | 지워야 할 것을 못 지움 |
| ④ | Route53 레코드 (`api.<클러스터>`) | 동일. `--dns=none`이면 레코드가 아예 없다(F9) |
| ⑤ | API 서버 주소 | kubeconfig 구성에서 막힘 |
| — | AC-KOPS37 (`kubectl auth can-i --list`) | 읽기 전용 여부를 확인할 수단이 없음 |

**비용이 틀리는 것보다 마스터를 지우는 것이 크다.** 문서에도 "이 태그만으로 마스터/워커를 가르지 말 것"을 명시했다.

## backend 마무리 방식 (기록해 둘 만한 판단)
- **"확인 필요"를 줄글에 덧붙이지 않고 2열 표로 바꿨다.** 그 목록은 사람이 한 줄씩 보며 리소스를 지우는 체크리스트라, 확인 상태가 **행마다 같은 열에** 보여야 눈에 띈다. 계약의 `api_lb`가 행마다 `confidence`를 두는 것과 같은 방식이다.
- **`state store S3 버킷은 지우지 말 것`을 별도 소제목으로 분리했다.** 전에는 "지울 것" 목록 안에 괄호로 붙어 있어 **흐름대로 읽으면 지울 것처럼 보였다.**
- **"확인 필요"와 함께 "확인하는 방법"을 적었다**(`kubectl config view --raw --minify -o jsonpath=…`). 표시만 하면 독자가 그 자리에서 막힌다.
- 확인됨/추정의 근거를 명세 0.2·0.3의 **F·U 번호로 통일**해 독자가 직접 따라갈 수 있게 했다.

## SSE 무한 발화 — 두 번째로 미해결 확인 (2026-09-24)
**backend가 P3에서 고쳤다고 본 것이 실제로는 멎지 않았다.** frontend가 진짜 api mock에 직접 구독해 75초 관찰한 결과, 컨트롤 플레인에 **아무 변화가 없는데 `cluster.controlplane.updated`가 15건**(15초마다 2건) 나갔다. 프레임 18KB → **약 8.6MB/시간/클라이언트**.

원인을 필드 단위로 특정:
- **A형(평가 루프마다)**: `status.updatedAt`, `node.status.updatedAt`, `masters.items[].lastReportedAt`, `components.columns[].lastReportedAt`, `components.items[].status.updatedAt`, `restarts.observedSec` — 의미가 바뀐 값이 **하나도 없다.** backend는 `lastReportedAt` 하나만 제외했는데 **같은 성격의 필드가 더 있었다.**
- **B형(메트릭 수집마다)**: `masters.totals.*`, `node.usage.*` — **계약 8.3이 이미 "usage만 바뀌면 upsert 대신 `metrics.updated`"로 정해 둔 것과 같은 상황.**

**교훈**: 개별 필드를 하나씩 빼는 방식으로는 같은 종류가 또 남는다. "시각·관측창처럼 매 평가마다 갱신되지만 의미가 바뀌지 않는 값"을 **한 부류로 묶어** 처리하도록 지시했다. 그리고 **코드 경로만 보고 "고쳤다"로 넘기지 말고 실제로 구독해서 멎은 것을 확인**하도록 했다 — 이번이 두 번째다.

**frontend가 화면에서 걸러내지 않은 것은 옳다.** 그건 서버 판단을 클라이언트에 복제하는 일이고 "상태를 화면에서 계산하지 않는다" 원칙에 어긋난다. 화면 영향은 없다(브라우저 60초 관찰에서 매트릭스 DOM 변경 0건).

## 실제 렌더에서 잡은 화면 결함 2건 (frontend, 2026-09-24)
1. **PageHeader 배지가 워커 영역만 보고 있었다.** 컨트롤 플레인이 `장애`인데 **제목은 `정상`**, 사이드바만 빨간 모순 상태였다. → `nav.nodes`(서버 합성값)로 교체.
2. **비용 리소스 표가 `종류` 열 때문에 1440px에서 161px 넘쳐 `apiLb`의 "추정" 칩이 스크롤 뒤로 숨었다.** 실클러스터 확인이 안 된 항목이라 확정 금액으로 오해하면 안 되는 표시다. → 금액 열을 줄여 19px까지 낮추고, **스크롤과 무관한 그룹 행에도 칩을 넣어** "추정 라벨은 반드시 보인다"를 폭에 의존하지 않게 했다.

## 사람 눈으로 확인된 것 (2026-09-24)
- **"보고 없음" vs "데이터 오래됨"** — 이 프로젝트에서 **처음으로 사람이 눈으로 확인**했다. 빗금+solid+`마지막 보고 00:09` vs 빗금없음+dashed+`09:16:13 기준`. 디자이너가 1차 설계에서 가장 신경 쓴 구분이 의도대로 나왔다.
- **어드바이저 인스턴스 ID 노출 0건** — 화면과 스냅샷 드로어 JSON 모두. 가명은 `control-plane-ap-northeast-2a-node-1` 형태. **노드 화면에는 실제 이름(`i-0…`)이 그대로** 보인다(의도대로 — 가명은 어드바이저로 나가는 스냅샷에만).
- 시나리오 7개 매트릭스 실측: `cp-healthy`(ok15) · `cp-node-down`(ok10+notReporting5) · `cp-component-crash`(ok13+crit1+missing1) · `cp-quorum-lost` · `cp-single` · `cp-not-found`(칸0, 워커 정상) · `kube-stale`(stale15). **빈 칸 0.**
- 1024/768/360px 모두 페이지 가로 스크롤 0.

## 디자이너의 비용 표 결정 — 표 하나를 고치지 않고 규칙을 만들었다 (2026-09-24)
**결정: 열 폭 조정. 이 표에 가로 스크롤은 쓰지 않는다.**
- 근거가 명확하다: 매트릭스에 스크롤을 허용한 이유는 **열 축이 가변**(마스터 1~5대)이라 폭을 정할 방법이 원리적으로 없기 때문인데, **비용 표는 열이 고정 7~8개**라 넘치면 열 구성이 틀린 것이다. 게다가 이 표의 오른쪽 끝은 `시간당`·`월 환산`·`비고`여서 **스크롤을 켜면 금액과 경고가 기본 화면에서 사라진다**(매트릭스는 sticky 첫 열로 "정체성"이 남지만, 여기서 숨는 것은 "값"이다).
- 폭을 고르게 깎지 않고 **빈 칸 많은 열을 없앴다**: `연결` 열(160px) 삭제 → `대상`의 보조 줄로 합침(하위 5종 중 값이 있는 것은 etcd·루트 볼륨 2종뿐인데 160px을 상시 차지했다). 여유 19px → **140px**(7배).

**재발 방지 규칙 2개를 `status.md`에 승격했다** — 이 표 하나 고치고 끝내지 않았다:
1. **5.6 표 폭 예산과 가로 스크롤(신설)** — 열 최소 합계 ≤ 본문 폭 − 60px, 가로 스크롤 예외는 **열 축이 가변인 표 하나뿐**, 넘칠 때 손대는 순서(① 값 드문 열을 보조 줄로 → ② 좁은 폭에서 근거 열 숨김 → ③ 화면 분할, **말줄임을 늘려 버티지 않는다**).
2. **3.1 "추정·확인 필요 표시는 레이아웃 사정으로 사라지지 않는다"** — frontend가 `apiLb`에 한 그룹 행 칩 병기를 **일반 규칙으로 승격**. 같은 위험이 스팟 시세 실패·단가 없음 칩에도 있어 개별 처리로 두면 다음 표에서 또 놓친다.

## "빈 함수를 넘겨야 동작하는 prop"을 없앴다 (2026-09-24)
frontend가 `ComponentMatrix`에 **빈 `onSummaryClick`을 넘겨 쓰고 있다**고 보고한 것이 설계 문제의 신호였다. 강조 동작은 컴포넌트 안에서 완결되는데 **핸들러가 없으면 `<span>`이 되어 "숫자를 누르면 깜박인다"가 통째로 사라지는** 구조였다.
- publisher 수정: **0이 아닌 요약 숫자는 핸들러 없이도 항상 `<button>`**, 강조는 기본 동작. `onSummaryClick`은 선택(있으면 강조에 **더해** 호출).
- **0인 항목은 버튼으로 만들지 않는다** — 강조할 칸이 없어 "눌러도 아무 일 없는 버튼"이 되고 Tab 순서만 늘어난다.
- 스위치 prop(`highlightOnSummaryClick` 같은)을 택하지 않은 판단이 옳다: **"켜야 동작한다"는 같은 함정을 이름만 바꿔 남긴다.**
- 결과: `ComponentMatrix`의 필수 prop은 `columns`·`rows`·`cells`·`caption` 넷뿐이고, **나머지를 빠뜨려도 화면이 조용히 기능을 잃지 않는다.**

PM 확인: publisher가 "3차에서 요청한 `keepHead?` 삭제도 함께"라고 했으나 **designer가 3회차에서 이미 처리했다**(`components.md` 1096행에 이유까지 남아 있다). 최신 문서를 보지 못한 것이라 중복 작업을 막았다.

## 설명을 어느 행에 두느냐가 구현을 바꿨다 (2026-09-24)
designer가 `onSummaryClick` 설명을 고치면서 **동작 설명을 콜백 행이 아니라 `summary` 행으로 옮겼다.** 근거: 설명이 콜백 행에 있으면 **"핸들러를 넘겨야 켜진다"로 읽혀 프론트가 빈 함수를 넘기는 우회를 하게 된다** — 실제로 그랬다. 그래서 성질(항상 버튼, 강조는 기본)은 `summary`에, 콜백은 "바깥에서 추가로 할 일"로 갈랐다.
- 원칙으로 승격: **"필수 prop은 `columns`·`rows`·`cells`·`caption` 넷뿐이고, 나머지를 빠뜨려도 화면이 조용히 기능을 잃지 않는다. 기능을 켜는 스위치 prop을 만들지 않는다."** publisher의 판단을 이 컴포넌트를 넘어 앞으로의 계약으로 올린 것이다.
- `cluster-status.md` 3.2.3의 같은 설명도 정렬했다 — 두 문서가 어긋나면 같은 혼동이 반복된다.

## SSE 건 결말 — 진짜 원인은 검증 환경이었다 (2026-09-25)
backend가 `statusChangedAt`을 volatile 키에 추가해 테스트가 전부 통과했다. 다만 **판단 근거와 정직 보고가 이 건의 핵심이다.**

**진단: 생산자 버그가 아니다(1번).** `statusChangedAt`은 `StatusChangeTracker.track()`이 **status 값이 바뀔 때만** 갱신하고, 런타임에서는 `ClusterStateService`가 트래커 **한 개를 계속 재사용**한다. 실측으로도 15초 간격 diff **73건 중 `statusChangedAt` 변화 0건**이었다. 테스트가 깨진 이유는 **스펙 헬퍼가 호출마다 새 트래커를 만들어** 두 번째 평가가 "처음 보는 키"가 됐기 때문 — 하네스가 런타임보다 엄격한 조건을 요구한 것이다.

**backend의 정직 보고**: **수정 전에도 런타임 재전송은 이미 0건이었다.** 15초 스팸은 어제 들어간 `lastReportedAt`·`observedSec`·`usage`·`totals` 제외로 멎어 있었고, 남아 있던 것은 트래커 수명에 의존하던 회귀 테스트 2건뿐이다. 이번 변경의 실효는 **트래커 초기화 경로에서의 18KB 재전송 차단 + 회귀 테스트 고정**이다.

### 진짜 교훈 — 고아 프로세스가 검증을 오염시켰다
**포트 3121을 어제 09:40:55에 시작된 다른 프로세스(PID 24548, `node dist/main`)가 점유하고 있었다.** backend가 3121로 띄운 프로세스는 EADDRINUSE로 죽었는데 **curl은 200을 반환했다** — 옛 빌드가 응답한 것이다.
→ **이전 두 번의 "SSE를 고쳤다"가 실제로는 옛 빌드를 측정한 것일 가능성이 높다.** 같은 건을 세 번 돌게 만든 원인이 코드가 아니라 검증 환경이었다.
→ backend는 규칙대로 남의 PID를 죽이지 않고 **포트 3123으로 옮겨** 자기가 띄운 PID(25488·11036)로만 관찰했다. 옳은 처리다.
→ **재발 방지**: 검증용 서버를 띄운 뒤에는 **기동한 PID가 실제로 그 포트를 듣고 있는지 확인**한 다음 측정한다. 응답 200은 "내 프로세스가 답했다"는 증거가 아니다.

## 남은 이슈 (PM 추적)
- **`snapshot-3d` 2~4단계는 여전히 `AWS::EKS::*` 전제다.** 보류 구간이라 의도적으로 고치지 않았다. 그 단계를 착수할 때 3.2 컴퓨트 층·A3/A4/A9, 3.4 짝 규칙·X4/X5, AC-3D34~56을 **ASG/Launch Template 중심으로 재설계**해야 한다. 이름만 통일해서 "EKS 클러스터 prod.k8s.example.com" 같은 어색한 문장이 남아 있다.
- `snapshot-3d` mock 노드그룹 이름(`ng-general`·`ng-spot`)은 cluster mock 인벤토리와 맞춰야 하는 값이라 planner가 손대지 않았다. **백엔드가 mock을 kOps InstanceGroup 형태로 바꿀 때 함께 맞춰야 한다.**
- **mock에서 `amazon-cloudwatch` 네임스페이스가 이제 "시스템 아님"으로 보인다.** `SYSTEM_NAMESPACES` 기본값에서 뺀 것(AC-KOPS09)의 부작용이고, P5에서 mock을 kOps 형태로 정리할 때 함께 사라진다.
- `R-EKSVER` 규칙 코드는 남아 있으나 `supportTier`가 항상 null이라 **발화하지 않는다**(mock 확인). 코드 삭제는 P5.
- 비용 카테고리 키는 아직 `'eks'`다(P4). DB 열과 배분 breakdown만 먼저 새 이름으로 바꿨다 — 그러지 않으면 저장이 조용히 깨지기 때문. 이음매는 `cost.service.ts`의 `controlPlane: byCat.eks ?? 0` 한 줄.
- **U2(API LB) 미확인 — 후보 규칙이 넓다.** "클러스터 태그가 있고 쿠버네티스에 귀속되지 않는 LB"는 무엇이든 후보가 되어, mock의 공용 LB 하나가 실제로 `api_lb`로 넘어갔다. 2개 이상이면 `ambiguous` 경고가 뜨지만 금액은 합산된다. 실클러스터 확인 1순위.
- **U4(미러 파드 이름 규칙) 미확인 — 틀리면 구성요소가 통째로 `missing`으로 보인다.** P3 구현이 여기 걸려 있다. 접두어는 상수 한곳에 모여 있어 확인 후 고치기 쉽다.
- `etcd_ebs`는 "마스터의 비-PVC·비-루트 볼륨" 추정이고 `etcdCluster`는 항상 null이다(main/events 구분 없음).
- 쿼럼은 마스터 **노드 수 근사**(`basis: "master_node_count"`)다. 실제 etcd 멤버 수가 아니다.
- **SSE를 실제로 구독해 본 적이 없다.** 코드 경로와 변경 키 제외만 확인했다 → 프론트 통합에서 확인.
- **`ResourceName kind="cluster"` 넘침 버그** — 남는 폭이 앞12자+뒤8자보다 좁으면 상자 밖으로 삐져나와 **옆 글자와 겹친다**(360px 개요에서 재현, 스크린샷 확보). 한 줄 고정인 상단바에서는 피할 수 없다. → 퍼블리셔 처리 중
- **상단바가 767px 이하에서 클러스터 정보를 통째로 숨기고 대체 표시가 없다.** 작은 화면에서 지금 보는 클러스터가 무엇인지 알 길이 없다. 768px에서는 리전이 툴팁 없이 잘리고, 긴 이름이 가운데가 아니라 끝에서 잘린다. → 퍼블리셔 처리 중
- **`/dev/ui`가 360px에서 문서 가로 스크롤(412px)이 난다.** 컨트롤 플레인 섹션·매트릭스를 다 숨겨도 그대로라 범인은 `CommandLine`/`CommandSteps`(긴 명령 줄)다. **스냅샷 화면이 같은 컴포넌트를 쓰므로 실제 사용자 화면에도 나타날 수 있다** — 확인 필요. 이번 범위 밖(별도 과제).
- **`/cluster/nodes`·`/pods`·`/events`에 dev 모드 hydration 불일치 경고가 있다.** 이번 변경 이전부터 있던 것이고(손대지 않은 pods·events에서도 동일) prod 빌드는 통과한다. **이번 범위 밖 — 별도 과제로 다룬다.**
- mock 이름 일괄 변경(Q9)이 절반만 됐다. `fixtures.ts`는 바뀌었지만 `__fixtures__/k8s-snapshots.ts`와 API mock은 아직 `prod-eks`다 → **P5에서 함께**
- `deploy/`의 kOps 문서에 `[확인 필요]` 5곳이 남아 있다 (위 우선순위 표 참조). 표시는 달았으므로 **실클러스터가 생기면 표시를 떼면서 기록**한다.
- **AC-KOPS37(`kubectl auth can-i --list`로 create/update/patch/delete·secrets 없음 확인) 미검증** — 실클러스터가 있어야 한다. backend가 통과로 세지 않고 README에 방법만 적었다. **검증 단계에서도 미검증으로 남긴다.**
- **브리지를 띄워 `advisor-v2` 프롬프트로 왕복해 보지 않았다**(Claude Code 사용량 소모). 배포 전 1회 확인 필요.
- **AC-KOPS42(R-GP2의 etcd 볼륨 표시) 검증이 막혀 있다.** `advisor: normal`에서 `controlPlaneVolumes[]`가 비어 있고 R-GP2 대상이 PVC뿐이라 분기가 나지 않는다. **gp2 etcd 볼륨이 있는 mock 조합**을 backend에 요청했다.
- `npx vitest run` 전체 실행에서 `k8s-snapshots/pages.test.tsx` 1건이 **한 번 실패 후 3회 통과**. 플레이크로 보이나 원인 미규명.
- 비용 표의 **다른 카테고리(EC2·EBS·LB·IPv4) 열 폭은 문서에 숫자가 없는 상태** 그대로다. 그쪽이 넘치면 `status.md` 5.6 예산으로 재계산이 필요하다.
- **다크 테마는 아직 육안으로 확인되지 않았다.**
- 폰트 실측이 폴백(Malgun Gothic/Consolas) 기준이다. Pretendard 웹폰트를 싣게 되면 `shell.md` 2.1의 폭 표를 다시 재야 한다(결론은 더 안전해지는 쪽).
- Pretendard·JetBrains Mono가 이 PC에 설치돼 있지 않다. 실측은 폴백 폰트(Malgun Gothic/Consolas) 기준이다. 실제 폰트에서는 mono 문자열이 조금 더 넓다(151.7px → 158.4px).
- 마스터 6대 이상일 때 구성요소 매트릭스는 **가로 스크롤로만** 처리된다. 실제로 6대 이상 쓰는 구성이 나오면 다시 봐야 한다.
- **마이그레이션이 실제 Postgres 16에서 미검증.** 이 PC에 Docker·psql이 없어 PGlite로만 확인했다. 로컬 compose가 가능해지면 `npm run db:migrate --prefix apps/api`를 한 번 돌려야 한다.

## 넘겨받은 요청 (PM 배분 예정)
- planner → backend: U2(API LB 식별 규칙), U4(미러 파드 이름 규칙), U5(추가 static pod 목록), U8(kOps에서 파드에 AWS 읽기 권한 주는 방법)을 실클러스터에서 확인
- planner → dba: `cost_rate_samples.eks_usd_per_hour` → `control_plane_usd_per_hour` 마이그레이션 (**기존 행 보존 필수** — 급증 판단 7일 기준선)
- planner → backend: `sanitize-snapshot.ts`에 인스턴스 ID 형태 노드 이름 가명 처리 추가 (AC-KOPS44)
