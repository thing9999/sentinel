# aws-snapshot 진행 현황

Former2로 현재 AWS 설정을 CloudFormation/Terraform으로 내보내 git에 저장하는 **대시보드 밖 도구** (`deploy/aws-snapshot/`).
적용(복원)은 사람이 수동으로만 한다 (change set / plan 검토 후). 도구성 작업이라 기획·디자인·프론트 단계 없음.

| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 구현 (내보내기·비밀값 스캔·IAM 정책·복원 가이드·테스트) | backend | [backend.md](backend.md) | 완료 (2026-09-19) |
| 검증 | PM | 이 문서 | 부분 완료 |

## 검증 (PM, 2026-09-19)
- `npm test --prefix deploy/aws-snapshot`: 88 pass / 0 fail
- `--dry-run --config .env.example`: exit 0, 파일 생성 없음
- 루트 `.gitignore`에 `.raw/` 추가 (backend 요청 반영)
- CLAUDE.md 확정 결정에 도구 권한 범위 한 줄 추가

## 못 한 검증
- 실제 AWS 계정 대상 내보내기 (자격증명 없음). 첫 실행 결과로 기본 서비스 목록·스캐너 규칙 보정 필요
- IAM 정책 Access Analyzer 검사, 복원 명령 실행, macOS/Linux 실행
- `npm audit`: former2 의존성(aws-sdk v2, uuid)의 moderate 2건 / low 1건, 수정 버전 없음
