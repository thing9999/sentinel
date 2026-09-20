# k8s-snapshot 진행 현황

쿠버네티스 매니페스트 스냅샷(CLI `deploy/k8s-snapshot/`) + 대시보드 "스냅샷" 메뉴 Kubernetes 탭 + 드리프트 비교. 명세: [docs/specs/k8s-snapshot.md](../../specs/k8s-snapshot.md)

| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [planner.md](planner.md) | 완료 (aws-snapshot-manager 명세 U1·3.4·AC-21도 맞춤) |
| 2. 열린 질문 확인 | 사용자 | 이 문서 | 완료: Q1~Q4 모두 권장안 (2026-09-19) |
| 3. 설계 | designer / dba | [designer.md](designer.md) / [dba.md](dba.md) | designer 완료 / dba 완료(스키마 변경 없음, 백업 안내 보완 → planner) |
| 4. API 계약 | backend | [backend.md](backend.md) | 완료 (`docs/api/k8s-snapshot.md`, 명세 차이 20개 16절 — PM 승인) |
| 5. 구현 | backend / publisher | [backend.md](backend.md) / [publisher.md](publisher.md) | publisher 완료(vitest 254 pass, mock 그룹 `k8s-snapshots`) / backend 완료(세션 재시작으로 중단 후 새 에이전트가 마무리; api test 376·e2e·CLI aws 105/k8s 65 pass, curl 확인) |
| 6. 통합 | frontend | [frontend.md](frontend.md) | 완료 (실제 mock API·헤드리스 Chrome 41항목, 스크린샷 30장, 임대 갱신 버그 수정) |
| 7. 검증 | PM | 이 문서 | 완료 (아래) |

## 사용자 결정 (2026-09-19)
- Q1 Secret: 읽지 않음. 워크로드가 참조하는 이름만 `secret-refs.json`
- Q2 드리프트는 사이드바 메뉴 상태에 반영하지 않음 (탭·목록에만)
- Q3 대시보드 RBAC 늘리지 않음. 밖의 종류는 "비교 불가"
- Q4 클러스터 ID 없는 스냅샷은 드리프트 계산 안 함 ("알 수 없음")

## PM 결정
- aws-snapshot-manager 명세의 메뉴 이름·상태 합산(U1·3.4·AC-21)을 이 명세 5.5에 맞춰 planner가 수정
- CLAUDE.md에 기능 5 추가, 기능 4 메뉴 이름을 "스냅샷"(AWS 탭)으로 변경

## 7단계 검증 (PM, 2026-09-20)
- api: lint 0 / tsc 0 / jest 376 pass (1 skip 기존) / e2e pass (backend 보고)
- CLI: aws-snapshot 105 pass (AWS 스캔 결과 불변 포함) / k8s-snapshot 65 pass
- web: lint 0 / tsc 0 / vitest 303 pass / build pass (`.next`는 기본 :3001로 재빌드)
- 스크린샷 30장 중 k8s 목록 1280 라이트·드리프트 1440 다크·드리프트 1024 라이트 PM 확인: 설계대로
- 남은 LISTEN 포트 없음 (3021·3031·3032 해제)

### 수용 기준
| 구분 | AC |
|---|---|
| 확인: CLI 테스트 | K01–K13 (AC 번호 달린 테스트), K15 (README·`rbac/export-readonly.yaml`) |
| 확인: api 테스트·curl | K14, K19, K24, K31, K32, K38 |
| 확인: 실제 mock API + 헤드리스 Chrome | K16–K18, K20–K23, K25, K26, K29(스크린샷), K30, K31, K33, K35, K36, K38, K39, K41, K43, K44 |
| 부분 (구조·단위 테스트만) | K27·K34 (외부 호출 없음·get/list/watch만 — 설계상 informer 캐시만 읽음, 전용 테스트는 CLI 쪽만), K40 (stale 단위 테스트만) |
| 확인 못 함 | K28·K37 (외부 변경 30초 반영 미재현), K42 (mock에서 실제 파일 비접근 — 명시 테스트 못 찾음) |

### 남은 이슈
- 가린 값 표기 `(de****(5자))` 괄호 중첩
- 긴 페이지에서 사이드바 배경 끊김 (기존 셸)
- 목록 범위 열 첫 줄 136px 말줄임, AWS 목록 1024에서 휴지통 아이콘이 표 끝에 붙음, 1024 드리프트 목록 높이 380px (designer 확인 요청 미처리)
- 실제 클러스터 미검증: 기본값 표(가짜 차이 억제) 실측 필요
- docker 없음: compose 마운트 미검증 (aws-snapshot-manager AC-48·49와 동일)
- db 5432 포트 바인딩 (이전 기능부터 사용자 확인 대기)
