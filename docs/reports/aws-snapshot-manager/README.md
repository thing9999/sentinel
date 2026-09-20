# aws-snapshot-manager 진행 현황

대시보드 "AWS 스냅샷" 메뉴: `deploy/aws-snapshot/snapshots/` 목록·상세·수정·삭제. 명세: [docs/specs/aws-snapshot-manager.md](../../specs/aws-snapshot-manager.md)

| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [planner.md](planner.md) | 완료 |
| 2. 열린 질문 확인 | 사용자 | 이 문서 | 완료: Q1~Q4 모두 권장안 (2026-09-19) |
| 3. 설계 | designer / dba | [designer.md](designer.md) / [dba.md](dba.md) | 완료 / 완료(스키마 변경 없음) |
| 4. API 계약 | backend | [backend.md](backend.md) | 완료 (`docs/api/aws-snapshot-manager.md`, common.md 충돌 4건 정리) |
| 5. 구현 | backend / publisher | [backend.md](backend.md) / [publisher.md](publisher.md) | 완료 (api test 315 pass·e2e pass·CLI 90 pass / web vitest 153 pass, lint 통과) |
| 6. 통합 | frontend | [frontend.md](frontend.md) | 완료 (후속: 뒤로 가기 가드·새 prop·새 필드·레이아웃 2건) |
| 7. 검증 | PM | 이 문서 | 완료 (아래) |

## 사용자 결정 (2026-09-19)
- Q1 라벨·메모: 스냅샷 폴더 안 별도 파일
- Q2 삭제: 휴지통 (복원·영구 삭제, 자동 비우기 없음)
- Q3 스캔 오류 남은 템플릿: 재확인 후 저장, "커밋 금지" 상태 유지
- Q4 편집: 원본 직접 편집 + 안내 문구, README 7.1 문구 보완

## PM 결정
- live인데 스냅샷 폴더 설정이 없으면 사이드바 상태 아이콘을 그리지 않는다 (페이지 안은 unknown + 설정 안내)
- 루트 `docker-compose.yml`·`.env.example`은 이번 기능에 한해 backend가 수정 (api 포트 127.0.0.1 바인딩, 스냅샷 마운트)
- db 5432 포트 바인딩 축소는 범위 밖 — 남은 이슈

## 남은 이슈 (누적)
- db 5432 포트가 모든 인터페이스에 열려 있음 (사용자 확인 필요)
- docker 환경에서 compose 기동·AC-48·49 미확인 (이 PC에 docker 없음)
- 기본 편집 엔진은 편집 중 줄 바꿈 미지원, 줄 번호 옆 툴팁은 hover 전용 (designer 수용, 문서 반영)

## 7단계 검증 (PM, 2026-09-19)
- api: lint 0 / jest 315 pass (1 skip 기존) / e2e pass (backend 보고)
- CLI: node:test 90 pass
- web: lint 0 / tsc 0 / vitest 203 pass / next build pass
- 스크린샷 24장(목록·상세·편집·휴지통 × 1024/1280/1440 × 라이트/다크) PM 확인: 1280 목록·1440 상세 다크·1024 편집 라이트 이상 없음
- 남은 포트: :3100(PID 8756, 이 세션이 띄운 것 아님)만 LISTENING

### 수용 기준
| 구분 | AC |
|---|---|
| 확인 (테스트 + HTTP/브라우저) | 01, 03–07, 11–18, 21–23, 25, 30–35, 37–40, 45, 47, 51 |
| 확인 (백엔드 테스트·curl) | 02, 08, 09, 10, 20, 28, 29, 41–44, 46, 50 |
| 부분 (코드·단위 테스트만, 실제 흐름 미확인) | 24, 26, 27, 36 |
| 테스트 근거 못 찾음 | 19 (raw-data.json 장애 사유: 분석기 코드는 있으나 spec에 케이스 없음) |
| 미확인 (docker 없음) | 48, 49 |

### 남은 이슈 추가
- 긴 페이지에서 사이드바 배경이 중간에서 끊김 (기존 셸, publisher 확인 필요)
- 직전 대비 열(80px) 두 줄 줄바꿈 (designer 확인 요청 미처리)
- 편집 중 삭제 후 history 가드 항목 1개 잔존 가능
- apps/web/.next가 API :3011 기준 빌드로 남음 → 다른 용도 next start 전 재빌드
- npm audit: former2 의존성(aws-sdk v2, uuid) moderate 2 / low 1
