# Sentinel

EKS 클러스터와 AWS 비용을 한곳에서 보는 **조회 전용** 대시보드. 클러스터와 모니터링 대상 DB에 쓰기 작업을 하지 않는다.

> 상태: 개발 중. 모든 기능이 mock 데이터로만 검증됐고 **실제 EKS 클러스터·AWS 계정에는 아직 붙여 보지 않았다.**

## 무엇을 하나

| 기능 | 내용 |
|---|---|
| **cluster-status** | 노드·워크로드·파드·이벤트·PVC와 클러스터 안 Postgres 상태 |
| **aws-cost** | 실시간 소모율(현재 리소스 × Pricing API 단가) + 확정 비용·월말 예측(Cost Explorer, 6시간 캐시) |
| **architecture-advisor** | 클러스터·비용 스냅샷을 로컬 Claude Code에 넘겨 개선 제안. **조언만 하고 아무것도 바꾸지 않는다** |
| **aws-snapshot-manager** | Former2로 뜬 AWS 스냅샷(CloudFormation·Terraform) 목록·상세·편집·휴지통 |
| **k8s-snapshot** | 쿠버네티스 매니페스트 스냅샷과 **드리프트**(스냅샷 vs 현재 클러스터) 비교 |
| **snapshot-3d** | 스냅샷을 three.js 3D 구성도로. 종류별 블록 모양, 드리프트 겹쳐 보기, 관계 표 대체 보기 |

## 구조

```
apps/api            NestJS. 쿠버네티스 informer, AWS 조회, SSE, 스냅샷 파일 API  (:3001)
apps/web            Next.js 화면                                                (:3000)
apps/agent-bridge   어드바이저용 Node 서비스. 호스트에서 실행                    (:3002)
deploy/             쿠버네티스 매니페스트, RBAC
  aws-snapshot/     Former2 내보내기 CLI (대시보드 밖, 사람이 실행)
  k8s-snapshot/     매니페스트 내보내기 CLI (대시보드 밖, 사람이 실행)
docs/               specs(기획) · design(디자인) · api(계약) · reports(작업 기록)
```

## 로컬 실행

Node 22 이상이 필요하다.

**Docker로**

```bash
cp .env.example .env          # 값 채우기
docker compose up --build     # web :3000, api :3001, db :5432
```

**Docker 없이 (mock 데이터)**

```bash
npm install --prefix apps/api && npm install --prefix apps/web
DATA_SOURCE=mock npm run start:dev --prefix apps/api   # :3001
npm run dev --prefix apps/web                          # :3000
```

어드바이저를 쓰려면 호스트에서 따로 띄운다. Claude Code 로그인 정보를 쓰기 때문에 컨테이너가 아니라 호스트에서 돈다.

```bash
npm run dev --prefix apps/agent-bridge   # :3002
```

`DATA_SOURCE=mock`이 기본값이다. `live`인데 연결 설정이 없는 출처는 mock으로 바꾸지 않고 `unknown`으로 표시한다.

## 스냅샷 CLI

대시보드는 스냅샷을 **읽고 고치기만** 한다. 뜨는 것과 적용하는 것은 사람이 직접 한다.

```bash
# AWS: Former2로 CloudFormation·Terraform 내보내기
cp deploy/aws-snapshot/.env.example deploy/aws-snapshot/.env
npm run export --prefix deploy/aws-snapshot -- --dry-run   # 실행할 명령만 확인
npm run export --prefix deploy/aws-snapshot

# 쿠버네티스: 네임스페이스별 매니페스트 내보내기
cp deploy/k8s-snapshot/.env.example deploy/k8s-snapshot/.env
npm run export --prefix deploy/k8s-snapshot
```

두 CLI 모두 **대시보드와 분리된 사람용 권한**을 쓴다. AWS는 별도 IAM 역할(`ReadOnlyAccess` + 거부 정책), 쿠버네티스는 별도 kubeconfig다. 내보낸 파일은 비밀값 스캔을 거치며, 의심되는 값이 있으면 종료 코드 1로 끝나고 커밋을 막는다.

적용(복원) 절차는 각 CLI의 `README.md`에 있다. CloudFormation은 change set, Terraform은 plan을 사람이 검토한 뒤 실행한다.

## 권한

읽기 전용으로만 쓴다.

- **AWS**: `pricing:GetProducts`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ec2:Describe*`(인스턴스·볼륨·스팟 가격), `elasticloadbalancing:Describe*`, `eks:DescribeCluster`
- **쿠버네티스**: pods, nodes, namespaces, events, pvc, services, deployments, statefulsets, daemonsets, ingresses, pdb, hpa, metrics — get/list/watch. **secrets는 제외**

## 테스트

```bash
npm test --prefix apps/api              # 398
npm test --prefix apps/web              # 455
npm test --prefix deploy/aws-snapshot   # 105
npm test --prefix deploy/k8s-snapshot   # 65
```

CI(`.github/workflows/ci.yml`)가 푸시·PR마다 lint, 타입체크, 테스트, 빌드를 돌린다.

## 알아둘 것

- **인증이 없다.** 스냅샷 파일을 쓰는 API가 있어서 api 포트는 `127.0.0.1`에만 연다. 팀이 함께 쓰려면 인증을 먼저 붙여야 한다.
- 비밀값(DB 비밀번호, 모니터링 계정, kubeconfig)은 `.env`와 로컬 파일에만 둔다. 저장소에는 `.env.example`만 있다.
- 어드바이저는 도구가 `StructuredOutput` 하나뿐이고 파일·셸·웹 도구가 모두 꺼져 있다. 한도는 5턴·$2·600초. mock 모드에서는 `ADVISOR_BRIDGE=live`일 때만 실제로 호출한다.
- 팀 운영 규칙과 확정된 결정은 [CLAUDE.md](CLAUDE.md)에, 기능별 명세·디자인·API 계약·작업 기록은 [docs/](docs/)에 있다.
