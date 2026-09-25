# Sentinel

**kOps로 만든 쿠버네티스 클러스터**와 AWS 비용을 한곳에서 보는 **조회 전용** 대시보드. 클러스터와 모니터링 대상 DB에 쓰기 작업을 하지 않는다.
컨트롤 플레인(마스터)도 사용자 소유 EC2이므로 워커와 나눠서 보여 준다.

> 상태: 개발 중. 모든 기능이 mock 데이터로만 검증됐고 **실제 kOps 클러스터·AWS 계정에는 아직 붙여 보지 않았다.**

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

> **api와 agent-bridge는 반드시 함께 배포·재시작한다.** 어드바이저 스냅샷 형식이 바뀔 때마다 `promptVersion`을 올리고(현재 **`advisor-v2`**) 브리지는 **그 버전만** 받는다.
> 한쪽만 올리면 분석 요청이 400 `unsupported_prompt_version`으로 떨어져 **어드바이저만 조용히 죽는다**(다른 화면은 멀쩡해 보인다).
> 버전 상수는 `apps/api/src/advisor/run/advisor-run.service.ts`와 `apps/agent-bridge/src/agent/output-schema.ts` 두 곳에 있다.

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

- **AWS**: `pricing:GetProducts`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ec2:Describe*`(인스턴스·볼륨·스팟 가격), `elasticloadbalancing:Describe*`. `autoscaling:*`·`route53:*`·`s3:*`는 쓰지 않는다
- **쿠버네티스**: pods, nodes, namespaces, events, pvc, services, deployments, statefulsets, daemonsets, ingresses, pdb, hpa, metrics — get/list/watch. **secrets는 제외**

### 대시보드용 kubeconfig (클러스터 밖에서 실행할 때)

> ⚠️ **이 절차는 kOps 문서와 `docs/specs/kops-support.md` 3.6을 근거로 쓴 것이고, 실제 kOps 클러스터에서 실행해 확인하지 않았다.** API 서버 주소(`https://api.<클러스터 이름>`)는 **추정**이다(3번의 `kubectl config view`로 실제 값을 꺼내는 쪽이 확실하다).

> **`kops export kubeconfig --admin`으로 만든 kubeconfig를 마운트하지 마세요.**
> 그 파일에는 **cluster-admin 인증서**가 들어 있어 "조회 전용"이 코드 규율로만 지켜지고 권한으로는 전혀 막히지 않는다.
> 대시보드는 `deploy/rbac.yaml`의 ServiceAccount `sentinel-api` 토큰만 담은 kubeconfig를 **읽기 전용**으로 마운트한다.

1. RBAC를 적용한다: `kubectl apply -f deploy/rbac.yaml`
2. 토큰을 발급한다(사람이 `kubectl`로. 대시보드는 secrets를 읽지 않고 토큰을 스스로 발급·갱신하지 않는다):
   ```bash
   kubectl -n sentinel create token sentinel-api --duration=8760h > /tmp/sa.token
   ```
3. API 서버 주소와 CA 인증서를 kubeconfig에 담는다(클라이언트 인증서는 넣지 않는다). kOps는 보통 `https://api.<클러스터 이름>`이지만(**확인 필요**), 아래처럼 실제 값을 꺼내는 쪽이 확실하다.
   ```bash
   kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}'
   kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}'
   ```
   위 두 값 + 토큰으로 `~/.kube/sentinel.config`를 만들고 `KUBECONFIG_HOST_PATH=~/.kube/sentinel.config`로 마운트한다.
4. **쓰기 권한이 없는지 확인한다** (권장 검증):
   ```bash
   KUBECONFIG=~/.kube/sentinel.config kubectl auth can-i --list
   ```
   결과에 `create`·`update`·`patch`·`delete`와 `secrets`가 **없어야 한다**. 있으면 admin kubeconfig를 쓴 것이다.
   (이 확인은 실제 클러스터가 있어야 할 수 있다 — 저장소에는 아직 검증 기록이 없다.)

- 토큰이 만료되면 대시보드는 죽지 않고 `kube` 출처를 `unavailable` + `KUBE_AUTH_FAILED`("인증 실패 — 토큰이 만료됐을 수 있습니다")로 표시한다. **mock 데이터로 대체하지 않는다.** 그때는 2번을 다시 실행한다.
- 클러스터 **안**에 배포할 때(`deploy/app.example.yaml`)는 `serviceAccountName: sentinel-api` + in-cluster 설정을 쓰므로 kubeconfig가 필요 없다.

## 테스트

```bash
npm test --prefix apps/api              # 452
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
