# 인수인계: 이전 대화에서 정한 것 (2026-09-19)

VS Code의 Claude Code 세션이 이 문서를 먼저 읽고 이어서 작업한다.

## 1. 개발 환경
- 스택: NestJS(`apps/api`) + Next.js(`apps/web`) 모노레포, 대시보드 자체 DB는 Postgres 16
- `docker compose up --build` → web :3000, api :3001, db :5432
- 환경 변수: `.env.example`을 `.env`로 복사 (kubeconfig 경로, 모니터링 대상 DB, Prometheus 주소)
- 아직 **가정**인 것:
  - 폴더 구조 `apps/api`, `apps/web` (다르면 `CLAUDE.md` 표와 `.claude/agents/*.md` 경로 수정)
  - ORM 미정 (Prisma / TypeORM 결정 후 DBA 영역을 좁힐 것)

## 2. 역할 분담 (오케스트레이션)
- 메인 세션 = PM. 직접 구현하지 않고 서브에이전트에게 나눠 맡긴다.
- 에이전트 6개: `planner`(기획), `designer`(디자인), `publisher`(퍼블리싱), `frontend`(프론트), `backend`(백엔드), `dba`(DBA)
- 역할별 쓰기 영역과 흐름은 `CLAUDE.md`, 실행은 `/feature <기능 설명>`
- 역할 간 인수인계는 `docs/specs`, `docs/design`, `docs/api`, `docs/db` 문서로 한다.
- 사용자는 메인 세션하고만 대화한다. 명세의 "열린 질문" 단계와 최종 보고에서만 개입한다.

## 3. 첫 기능: 쿠버네티스 연동 서버·DB 상태 대시보드
아직 명세 전. 대화에서 잡은 방향:

- **구조**: 브라우저 → Next.js → NestJS → 쿠버네티스 API / 모니터링 대상 DB. 브라우저는 쿠버네티스 API를 직접 부르지 않는다.
- **클러스터 접근**: `@kubernetes/client-node`. 클러스터 안에서는 ServiceAccount(`loadFromCluster`), 로컬에서는 kubeconfig(`loadFromDefault`).
- **권한**: 읽기 전용 ClusterRole (pods, nodes, deployments, statefulsets, events, namespaces, pvc에 get/list/watch, `metrics.k8s.io` pods/nodes). secrets는 제외.
- **서버 상태**: 노드 Ready·압박 상태·용량, 파드 phase·재시작·대기 사유, Deployment/StatefulSet ready/desired, Warning 이벤트, CPU/메모리(metrics-server).
- **이력 그래프**: 쿠버네티스 API는 현재 값만 주므로, 시간대별 추이가 필요하면 Prometheus 쿼리 API 사용.
- **DB 상태**:
  - 쿠버네티스 쪽: DB 파드/StatefulSet 상태, PVC 용량
  - DB 내부 (모니터링 전용 읽기 계정): `pg_stat_activity`, `pg_stat_database`, `pg_database_size()`, `pg_stat_replication` (또는 postgres_exporter)
- **실시간**: 파드/노드는 Watch API(informer)로 받아 NestJS 메모리에 캐시하고 SSE로 전달. 메트릭·DB 통계는 10~15초 간격 조회. 클러스터를 조회하는 쪽은 NestJS 하나뿐.
- **역할별 몫**: 기획=지표·경고 기준, DBA=상태 조회 쿼리·모니터링 계정, 백엔드=`cluster`·`db-health`·`stream` 모듈과 `deploy/rbac.yaml`, 디자인/퍼블리싱=상태 카드·표·배지, 프론트=SSE 구독·차트.

### 결정됨 (2026-09-19)
- 환경: EKS + 클러스터 안의 Postgres, ORM: Prisma
- 추가 기능: `aws-cost`(실시간 비용 추정·예측), `architecture-advisor`(로컬 Claude Code 연결). 상세는 `CLAUDE.md` "확정된 결정"
- 로컬 PC에 Docker·kubeconfig·AWS 자격 증명이 없음 → `DATA_SOURCE=mock` 기본

### 열린 질문
- 클러스터에 metrics-server / Prometheus가 설치돼 있는가? (CPU·메모리 그래프 출처가 달라짐)
- 대시보드 접근 인증 방식
- 대시보드도 같은 클러스터에 배포하는가?
