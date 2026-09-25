# 작업 보고서 현황 (PM 관리)

각 담당 에이전트의 상세 보고서는 `docs/reports/<feature>/<role>.md`, 형식은 [TEMPLATE.md](TEMPLATE.md).

## bootstrap · 뼈대 구성 (2026-09-19~)
| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| api·agent-bridge 뼈대 | backend | [bootstrap/backend.md](bootstrap/backend.md) | 완료 — api lint·test(10+e2e 1)·build 통과, bridge lint·test(21)·build 통과, 로컬 Claude Code ping 성공, docker 미검증 |
| web 뼈대 | frontend | [bootstrap/frontend.md](bootstrap/frontend.md) | 완료 — lint·typecheck·test(8)·build 통과, docker 미검증 |

### 넘겨받은 요청 (PM 배분 예정)
- frontend → backend: `GET /api/health` 계약, SSE 계약(이벤트 이름·data 형식, Last-Event-ID, heartbeat 주기, 초기 스냅샷 이벤트), 전역 prefix `/api`, CORS `http://localhost:3000` → **3단계 API 계약에 포함**
- frontend → publisher: 토큰 CSS 변수(라이트/다크), `app-header`/`app-nav`/`app-main` 스타일, 연결 상태 배지·페이지 제목·섹션·준비 중/빈 상태/에러 컴포넌트 → **4단계 퍼블리싱에 포함**
- 참고: `NEXT_PUBLIC_API_URL`은 빌드 시 고정 → 배포 단계에서 검토
- backend → dba: Prisma 모델 추가, `prisma.service.ts` 소유권 인수 → **DBA에 전달함**
- backend → PM: Docker 환경에서 `docker compose up --build` 확인 필요 (host-gateway, `~/.aws` 마운트, 컨테이너 내 prisma generate) → **이 PC에 Docker 없음, 사용자 확인 대기**
- designer → backend: 지표별 status·reasons[]·updatedAt·statusChangedAt, SSE heartbeat, 금액 kind(추정/확정/예측)·조회 시각·스팟 시세 필드·CE 새로고침 가능 시각/호출 수, 어드바이저 진행 이벤트·실패 사유 enum, mock 시나리오 전환 API(선택) → **3단계 API 계약에 포함**
- designer → publisher: components.md 1~8절·10절 구현, tokens.json → CSS 변수([data-theme]) → **4단계**
- designer → frontend: 추가 라우트, lucide 아이콘, 차트 요구사항(점선·빗금·구간 띠·결측 끊김), LLM 출력 텍스트 전용 렌더 → **5단계**
- dba → backend: prisma.config.ts seed 등록, .env.example MONITOR_DB_URL(sentinel_monitor, port-forward 15432), 기대 standby 수·대상 StatefulSet ns/name env 검증, 마이그레이션·시드 스크립트 → **4단계 백엔드 구현**
- PM 결정: `nodes/proxy` 권한 **추가 안 함** (PVC 사용량은 DB 크기+WAL 근사치 또는 Prometheus kubelet 지표)
- 계약에서 결정: 단일 SSE `/api/stream?topics=`, heartbeat 15초, Last-Event-ID 미지원(재연결 시 전체 스냅샷), 브리지 NDJSON, maxTurns 3 / maxBudgetUsd $2.00 / 600초
- PM 결정: RBAC에 `daemonsets` 추가, 예산 편집은 API만(화면은 범위 밖), live인데 설정 없으면 unknown
- 4단계 분할: A=공통·스트림·클러스터·DB(`src/common/extension-points.ts` 공유 인터페이스, DiscoveryService로 연결), B=비용, C=어드바이저+브리지. 비용의 live 인벤토리 어댑터(ClusterStateService→ClusterInventoryPort)는 A·B 완료 후 연결

## cluster-status · 쿠버네티스 서버·DB 상태
| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [cluster-status/planner.md](cluster-status/planner.md) | 완료 (열린 질문 2건 사용자 결정 반영) |
| 2. 디자인 / DBA | designer, dba | [designer](cluster-status/designer.md) · [dba](cluster-status/dba.md) | 디자인 완료 (tokens.json 파싱 PM 확인) / DBA 완료 — prisma validate·lint·tsc·jest(41) 통과, PGlite로 마이그레이션·쿼리 10개 실행 확인 |
| 3. API 계약 | backend | [backend](cluster-status/backend.md) | 완료 — docs/api/common·cluster-status·aws-cost·architecture-advisor |
| 4. 구현 / 퍼블리싱 | backend, publisher | [publisher](cluster-status/publisher.md) | 퍼블리싱 완료 — lint·typecheck·test(50)·build 통과, 360~1440px 가로 스크롤 없음 / **백엔드 A 완료** — lint·tsc 0건, test 266 통과, mock 기동 확인. live(informer·metrics·대상 DB)는 kubeconfig 없어 미실행 |
| 5. 통합 | frontend | [frontend](cluster-status/frontend.md) | **5a 완료** — lint·typecheck·test(110)·build 통과, 실제 mock API(:3091)로 전 페이지 확인. 퍼블리셔 보완 완료(test 118) / **5b 실제 동작 검증 진행 중** (어드바이저 클릭 흐름·CE 429·스트림 끊김 재연결·360px·테마·키보드, 실제 Claude 호출 없음) |
| 6. 검증 | PM | | 대기 |

## aws-cost · 실시간 AWS 비용 추정·예측
| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [aws-cost/planner.md](aws-cost/planner.md) | 완료 — 스팟 시세 권한 추가 결정 |
| 2. 디자인 / DBA | designer, dba | designer.md · dba.md | 디자인 완료 / DBA 완료 |
| 3. API 계약 | backend | backend.md | 완료 |
| 4. 구현 | backend B, publisher | backend.md · publisher.md | **B 완료** — tsc·test(cost 104) 통과, CE 호출 폭주 방지 테스트 고정, 실제 AWS 호출 0회(자격 증명 없음) |
| 5. 통합 | frontend | frontend.md | 5a 완료 / 5b 진행 중 |
| 6. 검증 | PM | | 대기 |

B 후속: live 인벤토리 어댑터 **연결 완료** (build 성공, mock에서 두 화면 노드 6개 일치) / PM 결정: EKS 버전은 클러스터 기준 → **반영 완료** (mock 1.34 standard, 연장 지원은 테스트로 고정) / 계약 정리·`refreshEstimatedCostUsd`(최대 $0.04) 완료 — test 289·build 통과 / env 선언은 A에 전달 / CLB(v1 ELB SDK 미설치)·Pricing 필터 실응답 미확인은 한계로 기록

## architecture-advisor · 아키텍처 개선 어드바이저 (로컬 Claude Code)
| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [architecture-advisor/planner.md](architecture-advisor/planner.md) | 완료 — 리소스 이름 원문 전송 결정 |
| 2. 디자인 / DBA | designer, dba | designer.md · dba.md | 디자인 완료 / DBA 완료 |
| 3. API 계약 | backend | backend.md | 완료 |
| 4. 구현 | backend C, dba 보완, designer 보완 | backend.md · dba.md · designer.md | **C 완료** — bridge lint·test(57)·build, api lint·tsc·test(262) 통과. 로컬 Claude Code 실제 분석 1회 성공(182.8초, 추정 $0.80, 제안 10건 스키마 통과, 취소·중복 실행 확인). Prisma 저장 경로는 실제 DB 미검증 / PM 결정 반영 완료(maxTurns 5, 지연 300초) / 개요 카드 확장점 C 진행 중 / settings 기본값 5·300 DBA 진행 중 |
| 5. 통합 | frontend | frontend.md | 5a 완료 / 5b 진행 중 |
| 6. 검증 | PM | | 대기 |

## kops-support · 대상 환경 EKS → kOps 전환 (2026-09-24~)
진행 현황·PM 결정 기록: [kops-support/README.md](kops-support/README.md) · 명세: [`docs/specs/kops-support.md`](../specs/kops-support.md)

| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [kops-support/planner.md](kops-support/planner.md) | 완료 — AC-KOPS01~46, 단계 P1~P5(P6 다음 범위), 열린 질문 Q1~Q9 |
| 2~6 | | | 대기 (Q1·Q4·Q8·Q9 사용자 결정 후 착수) |

PM 결정: EKS 완전 제거(플랫폼 분기 없음) / `autoscaling:*` 추가 안 함 / 컨트롤 플레인은 기존 RBAC 안 static pod 상태까지 / Q2·Q3·Q5·Q6·Q7은 planner 권고 채택.
PM 확인: `sanitize-snapshot.ts:158`이 IP 형태가 아닌 노드 이름을 원문 통과 → kOps 노드 이름(`i-0…`)이 어드바이저로 유출되는 문제 **사실 확인**(AC-KOPS44).
