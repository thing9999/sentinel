# 쿠버네티스 서버·DB 상태 대시보드: 팀 운영 규칙

모노레포: `apps/api` (NestJS), `apps/web` (Next.js), 쿠버네티스 매니페스트는 `deploy/`, 로컬 인프라는 `docker-compose.yml`.
대시보드는 **조회 전용**이다. 클러스터와 모니터링 대상 DB에 쓰기 작업을 하지 않는다.

## 메인 세션 = PM(오케스트레이터)
메인 세션은 직접 구현하지 않고, 작업을 쪼개서 아래 서브에이전트에게 맡기고 결과를 모은다.
(서브에이전트는 다른 서브에이전트를 부를 수 없으므로 조율은 항상 메인 세션이 한다.)

| 역할 | 에이전트 | 쓰기 권한 영역 |
|---|---|---|
| 기획 | `planner` | `docs/specs/**` |
| 디자인 | `designer` | `docs/design/**` |
| 퍼블리싱 | `publisher` | `apps/web/src/components/ui/**`, `apps/web/src/styles/**` |
| 프론트 | `frontend` | `apps/web/src/app/**`, `apps/web/src/features/**`, `apps/web/src/charts/**` |
| 백엔드 | `backend` | `apps/api/src/**` (database 제외), `apps/api` 루트 설정, `apps/agent-bridge/**`, `deploy/**`, `docs/api/**` |
| DBA | `dba` | `apps/api/src/database/**`, `apps/api/prisma/**`, `docs/db/**` |

`apps/web` 루트 설정 파일(package.json, next.config, tsconfig, eslint)은 `frontend`가 관리한다.

## 확정된 결정 (2026-09-19)
- 대상 환경: **EKS + 클러스터 안의 Postgres(StatefulSet)**
- 대시보드 자체 DB ORM: **Prisma** (`apps/api/prisma/schema.prisma`)
- 데이터 소스 모드: `DATA_SOURCE=mock|live`, 기본값 mock. live인데 연결 설정이 없는 출처는 mock으로 바꾸지 않고 `unknown`으로 표시한다(`docs/api/common.md`).
- `nodes/proxy` 권한은 추가하지 않는다. 예산은 API(`PATCH /api/cost/settings`)만 제공하고 편집 화면은 이번 범위 밖.
- 기능 3개:
  1. `cluster-status`: 쿠버네티스 서버·DB 상태 대시보드 (기본 구성)
  2. `aws-cost`: 실시간 AWS 비용 추정·예측. **혼합 방식**:
     - 실시간 소모율 = 현재 리소스(EKS 노드 인스턴스 타입, EBS/PVC, 로드밸런서, EKS 컨트롤 플레인) × AWS Pricing API 단가
     - 확정 비용·월말 예측 = Cost Explorer (`GetCostAndUsage`, `GetCostForecast`). 호출당 $0.01이므로 캐시 필수 (기본 6시간)
  3. `architecture-advisor`: 클러스터·비용 스냅샷을 **로컬 Claude Code**(Claude Agent SDK)에 넘겨 개선 제안을 받는다.
     - `apps/agent-bridge`: 호스트에서 실행되는 Node 서비스(:3002). Claude Code 로그인 정보를 쓰므로 컨테이너가 아닌 호스트에서 돈다.
     - api → `AGENT_BRIDGE_URL`(기본 `http://host.docker.internal:3002`) 호출, 결과를 SSE로 스트리밍
     - 어드바이저는 **조언만** 한다. 브리지는 파일·셸·웹 도구를 모두 끄고, 클러스터나 AWS를 변경하는 명령을 실행하지 않는다.
     - 한도: maxTurns 5, maxBudgetUsd $2.00, 타임아웃 600초, 지연 표시 300초. 허용 도구는 SDK 구조화 출력용 `StructuredOutput` 하나뿐 (다른 도구가 보이면 실행 중단)
     - mock 모드에서는 `ADVISOR_BRIDGE=live`일 때만 실제 Claude Code를 호출한다 (기본은 예시 응답, 사용량 소모 없음)
  5. `k8s-snapshot` (2026-09-19): 쿠버네티스 매니페스트 스냅샷 + 드리프트 (`docs/specs/k8s-snapshot.md`).
     - CLI `deploy/k8s-snapshot/`가 사람용 별도 kubeconfig로 내보낸다(대시보드 RBAC와 분리). Secret은 읽지 않고 워크로드가 참조하는 이름만 `secret-refs.json`에 남긴다
     - 대시보드 "스냅샷" 메뉴의 Kubernetes 탭에서 기능 4와 같은 규칙으로 관리. 적용·내보내기 버튼 없음
     - 드리프트는 대시보드의 기존 RBAC 범위 안에서만 비교하고(RBAC는 늘리지 않음, 밖의 종류는 "비교 불가"), 사이드바 메뉴 상태에는 반영하지 않는다. 클러스터 ID가 없는 스냅샷은 드리프트를 계산하지 않는다
  6. `snapshot-3d` (2026-09-20): 스냅샷 3D 시각화(three.js, `docs/specs/snapshot-3d.md`). 4단계 중 **1단계만 이번 범위**(공통 기반 + K8s 구성도·드리프트, AC-3D01~33). 2~4단계(AWS 구성도·시간축·통합 장면)는 보류
     - 조회 전용, 쓰기 없음. 3D는 보조이고 WebGL 없음·저사양·스크린리더용 **관계 표 대체 보기**로 같은 정보를 얻을 수 있어야 한다
     - 블록은 한 번 클릭 = 선택·정보 패널, 더블클릭·Enter = 해당 리소스 탭으로 이동. 통합 장면 짝은 자동 제안 + 수동 허용, 워크로드↔노드그룹은 스케줄 제약이 있을 때만 점선(2~4단계)
  4. `aws-snapshot-manager` (2026-09-19): 대시보드 "스냅샷" 메뉴(AWS 탭)에서 `deploy/aws-snapshot/snapshots/`를 목록·상세·수정·삭제한다 (`docs/specs/aws-snapshot-manager.md`).
     - 대시보드가 쓰는 곳은 **로컬 스냅샷 파일뿐**이다. AWS·클러스터 쓰기 없음, 내보내기 버튼 없음(CLI로만), 적용 버튼 없음(사용자가 직접 배포), git 커밋 없음
     - 라벨·메모는 스냅샷 폴더 안 별도 파일, 삭제는 휴지통(복원·영구 삭제), 스캔 오류가 남은 템플릿은 재확인 후 저장("커밋 금지" 표시), 템플릿은 원본을 직접 편집
- AWS 권한은 읽기 전용: `pricing:GetProducts`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeSpotPriceHistory`, `elasticloadbalancing:Describe*`, `eks:DescribeCluster`
- AWS 설정 스냅샷(`deploy/aws-snapshot/`, 2026-09-19): Former2로 CloudFormation/Terraform **내보내기만** 하는 대시보드 밖 사람용 도구. 대시보드와 분리된 별도 IAM 역할(`ReadOnlyAccess` + `iam/deny-sensitive-reads.json` 거부 정책)을 쓴다. 적용 스크립트는 만들지 않고, 적용은 사람이 change set / plan 검토 후 수동으로 한다
- 쿠버네티스 RBAC(읽기 전용 get/list/watch): pods, nodes, namespaces, events, persistentvolumeclaims, services, deployments, statefulsets, daemonsets, ingresses, poddisruptionbudgets, horizontalpodautoscalers, `metrics.k8s.io` pods/nodes. **secrets 제외**
- 어드바이저 스냅샷: 네임스페이스·워크로드·노드그룹 이름은 **원문 그대로** 전송. 비밀값·환경 변수·command/args·어노테이션 원문은 항상 제외
영역 밖 수정이 필요하면 에이전트는 직접 고치지 않고 보고에 "○○ 요청"으로 남긴다. PM이 해당 담당에게 넘긴다.

## 기본 흐름 (`/feature` 명령)
1. **기획**: `planner` → `docs/specs/<feature>.md` (지표, 상태 판단 기준, 갱신 주기). 열린 질문이 있으면 사용자에게 확인한 뒤 진행.
2. **설계 (병렬)**: `designer` → `docs/design/`, `dba` → DB 상태 조회 쿼리·모니터링 계정
3. **계약**: `backend` → `docs/api/<feature>.md` 먼저 작성 (REST 응답 + SSE 이벤트 형식)
4. **구현 (병렬)**: `backend` → API·informer·SSE·RBAC, `publisher` → UI 컴포넌트
5. **통합**: `frontend` → 페이지·상태·SSE 구독·차트
6. **검증**: 메인 세션이 수용 기준을 하나씩 확인하고 lint/test 결과를 모아 보고

단계 사이의 인수인계는 대화가 아니라 **`docs/` 문서**로 한다. 에이전트에게 일을 줄 때는 읽어야 할 문서 경로를 명시한다.

## 작업 보고서 (모든 에이전트 필수)
- 모든 담당 에이전트는 작업을 끝낼 때마다 `docs/reports/<feature>/<role>.md`에 **상세 작업 보고서**를 남긴다. 형식은 `docs/reports/TEMPLATE.md`.
  - 뼈대·공통 설정 작업의 feature 이름은 `bootstrap`
  - 같은 파일에 다시 작업하면 날짜·작업 이름 섹션을 **추가**한다 (이전 기록 삭제 금지)
- `docs/reports/**`는 모든 에이전트가 **자기 역할 파일만** 쓸 수 있다 (쓰기 영역 예외).
- 대화로 돌려주는 보고는 짧게 하고, 상세 내용은 보고서 경로로 대신한다.
- 검증 실패·건너뛴 단계도 숨기지 않고 보고서에 적는다.
- PM(메인 세션)은 단계가 끝날 때마다 `docs/reports/<feature>/README.md`에 진행 현황(단계·담당·보고서 링크·상태)을 갱신한다.

## 공통 규칙
- 커밋은 사용자가 요청할 때만 한다.
- 검증용으로 띄운 서버·프로세스는 **자기가 띄운 PID만** 종료한다. `taskkill /IM node.exe`, `Stop-Process -Name node`처럼 이미지 이름으로 일괄 종료하지 않는다. 여러 에이전트가 동시에 작업하므로 남의 프로세스까지 죽는다.
- 여러 에이전트가 동시에 일할 때 포트는 작업 지시에 적힌 것을 쓰고, 3000/3001/3002는 사용자가 쓸 수 있으니 피한다.
- 비밀값(DB 비밀번호, 모니터링 계정, kubeconfig)은 `.env`나 로컬 파일에만 두고 커밋하지 않는다. `.env.example`만 관리한다.
- 로컬 실행: `docker compose up --build` → web :3000, api :3001, db :5432
  - api 컨테이너는 호스트의 kubeconfig를 읽기 전용으로 마운트해서 클러스터에 접속한다.
  - 어드바이저 브리지는 호스트에서 별도로: `npm run dev --prefix apps/agent-bridge` → :3002
  - Docker 없이도: `npm run start:dev --prefix apps/api`, `npm run dev --prefix apps/web` (DATA_SOURCE=mock)
