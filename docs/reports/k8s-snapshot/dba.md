# k8s-snapshot · DBA 작업 보고

## 2026-09-19 · DBA 검토 (드리프트 보관 여부, Postgres 데이터 백업 안내 문구)

### 1. 요청 내용
- PM 전달, planner 요청 2건 (명세 7절 DBA 항목).
  1. 드리프트 결과를 대시보드 자체 DB에 보관해야 하는지 판단. 기본 전제는 메모리에서 계산하고 보관하지 않는 것.
  2. 명세 3.9의 Postgres(클러스터 안 StatefulSet) 데이터 백업 안내 문구 검토. 스냅샷에 PV 데이터가 없다는 설명, `pg_dump`/볼륨 스냅샷 안내가 정확한지 본다. 수정 제안은 "planner 요청"으로만 남기고 명세는 고치지 않는다.
- 사용자 확정 전제: 스냅샷·라벨·메모·휴지통은 파일로 관리한다(aws-snapshot-manager와 같음). 드리프트는 현재 클러스터와 비교해서 계산하는 값이다.

### 2. 참고한 문서
- `docs/specs/k8s-snapshot.md`: 0절, 3.6, 3.8, 3.9, 4.5~4.7, 5.3, 7절(범위 밖), DBA 항목
- `docs/reports/aws-snapshot-manager/dba.md`: 이전 판단(스키마 변경 없음)
- `deploy/aws-snapshot/README.md` 7.4, 8장: 명세 3.9가 참조하는 백업 안내 원문
- `docs/reports/TEMPLATE.md`

### 3. 작업 내용

#### 3.1 드리프트 결과 보관: **스키마 변경 없음**
| 데이터 | 저장 위치 | DB 필요 |
|---|---|---|
| 최신 스냅샷의 드리프트 결과 | 서버 메모리. 클러스터 변경이 있으면 30초 안에, 변경이 없어도 5분마다 다시 계산한다(4.5) | 없음 |
| 최신이 아닌 스냅샷의 드리프트 결과 | 사용자가 요청할 때만 계산하고, 화면을 떠나면 계산을 멈춘다(4.5). 짧은 메모리 캐시면 된다 | 없음 |
| 목록 드리프트 열의 "마지막 계산 결과 + 계산 시각" | 메모리. 재시작하면 "계산 안 함"으로 돌아가도 명세와 맞는다 | 없음 |
| 스냅샷·라벨·메모·휴지통 | 스냅샷 폴더 안 파일(U2) | 없음 |

- 결론: **Prisma 모델 추가 없음, 마이그레이션 없음, `settings` 키 추가 없음.**

#### 3.2 Postgres 데이터 백업 안내 문구 검토
명세 3.9 문구: "이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 데이터는 `pg_dump` 논리 백업 또는 EBS 볼륨 스냅샷으로 따로 보관하세요(`deploy/aws-snapshot/README.md` 8장)." 복원 순서: 매니페스트 적용 → 빈 StatefulSet 기동 → 데이터 복원.

| 항목 | 판정 | 내용 |
|---|---|---|
| "스냅샷은 PV 데이터를 담지 않는다" | 정확 | PVC·StatefulSet의 정의(`volumeClaimTemplates`)만 담긴다. 정리 규칙이 PVC `spec.volumeName`을 지우므로(3.6), 스냅샷의 PVC를 적용하면 기존 볼륨이 아니라 **새 빈 볼륨**이 만들어진다. 문구에 이 점을 적어 두면 오해를 막을 수 있다 |
| `pg_dump` 논리 백업 | 부족 | `pg_dump`는 **데이터베이스 하나**만 백업한다. 역할(모니터링 계정 포함), 비밀번호 해시, 역할에 준 권한 같은 전역 객체는 빠진다. 전역 객체는 `pg_dumpall --globals-only`로 따로 받아야 한다. 이 결과에는 비밀번호 해시가 들어가므로 암호화해서 보관해야 한다 |
| 옵션 `-Fc` (README 8장) | 맞음 | 사용자 지정 형식이라 압축되고 `pg_restore`로 골라서 복원할 수 있다. 명세 문구에는 옵션이 없고 README가 설명한다. 화면 문구를 짧게 유지하려면 옵션은 README에 두는 것이 맞다 |
| 암호화 보관 권고 (README 8장) | 맞음, 보강 필요 | 덤프 파일은 운영 데이터 원본이다. **git이나 `deploy/k8s-snapshot/snapshots/` 안에 두면 안 된다**는 점을 분명히 적어야 한다. 스냅샷 폴더는 git에 커밋하는 곳이고, 폴더 안에 두면 대시보드가 "예상 밖 파일"로 표시한다 |
| `kubectl exec … pg_dump` 실행 권한 | 명시 필요 | `pods/exec` 권한이 필요하다. 대시보드 RBAC와 내보내기 전용 역할에는 이 권한이 없고 앞으로도 넣지 않는다. 사람이 자기 운영 권한으로 실행하는 절차라는 점을 적어야 한다. 비밀번호를 명령줄 인자로 넘기지 말고, 컨테이너 안의 환경 변수나 `.pgpass`를 쓰게 한다 |
| Windows PowerShell 리다이렉트 | 주의 문구 필요 | Windows PowerShell 5.1에서 `kubectl exec … pg_dump -Fc > file`처럼 `>`로 받으면 바이너리 덤프가 텍스트로 인코딩되어 **파일이 깨진다**. 파드 안에서 `-f /tmp/x.dump`로 쓴 뒤 `kubectl cp`로 가져오거나 Git Bash를 쓰도록 안내해야 한다 (이 팀의 개발 환경이 Windows) |
| 버전 | 추가 권장 | 복원에 쓰는 `pg_restore`는 덤프와 같은 메이저 버전이거나 더 새 버전이어야 한다. 복원 대상 서버도 같은 메이저 버전이거나 더 새 버전이어야 한다(Postgres 이미지 태그를 스냅샷의 StatefulSet과 맞춘다) |
| EBS 볼륨 스냅샷 | 조건 명시 필요 | ① 크래시 일관성 스냅샷이다. 데이터와 WAL이 **같은 볼륨 하나**에 있으면 Postgres가 복구 과정(WAL 재생)으로 일관된 상태를 되찾는다. WAL이나 테이블스페이스가 다른 볼륨에 있으면 볼륨 사이의 시점이 어긋날 수 있어 믿을 수 없다. ② `VolumeSnapshot`은 EKS 기본 구성에 없다. snapshot-controller, CRD, EBS CSI용 `VolumeSnapshotClass`가 있어야 한다. 없으면 AWS 콘솔이나 CLI의 EBS 스냅샷을 쓴다. ③ EBS 볼륨은 가용 영역(AZ)에 묶인다. 복원한 볼륨과 파드가 같은 AZ에 있어야 한다 |
| 복원 순서 "매니페스트 적용 → 빈 StatefulSet 기동 → 데이터 복원" | `pg_dump` 경로에서만 맞음 | 두 가지를 보강해야 한다. ① **Secret을 먼저 만들어야 한다**(`secret-refs.json`, 5.3 G). 공식 Postgres 이미지는 첫 기동 때 `POSTGRES_PASSWORD`로 초기화하므로 Secret이 없으면 파드가 뜨지 않는다. ② **볼륨 스냅샷 경로는 순서가 다르다**. StatefulSet보다 먼저 `volumeClaimTemplates` 이름 규칙(`<템플릿>-<sts>-<순번>`, 예: `data-postgres-0`)에 맞는 PVC를 스냅샷에서 만들어야 한다(`dataSource: VolumeSnapshot`, 또는 복원한 EBS 볼륨을 정적 PV로 연결). 그다음 StatefulSet을 적용한다. 스냅샷에 담긴 같은 이름의 PVC YAML을 먼저 적용하면 빈 볼륨이 붙는다 |
| 시점 복구(PITR) | 한계 안내 | `pg_dump`는 백업을 시작한 시점만 담는다. 특정 시점으로 되돌리는 복구(WAL 보관 + `pg_basebackup`)는 이 안내의 범위 밖이라고 한 줄 적어 두면 기대치를 맞출 수 있다 |

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/reports/k8s-snapshot/dba.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **드리프트 결과를 DB에 보관하지 않음**
  - 파생값이다: 스냅샷 파일(원본)과 현재 클러스터로 언제든 다시 계산할 수 있다. 최신 스냅샷은 5분마다 자동으로 다시 계산되므로, 재시작해도 최대 5분 뒤 복구된다.
  - 드리프트 이력 그래프와 알림은 명세 7절에서 범위 밖이다. 과거 결과를 조회할 요구가 없다.
  - 스냅샷 파일을 편집하거나 git pull하거나 휴지통으로 옮기면 DB에 남은 결과가 원본과 어긋난다. 무효화 규칙을 따로 두어야 해서 복잡도만 늘어난다.
  - 결과에는 클러스터 운영 값(이미지, 어노테이션, 리소스 설정)이 들어 있다. DB에 쌓으면 노출 범위가 넓어진다. env·command는 가려져 있어도 마찬가지다.
  - DB 없이 실행하는 경우(`npm run start:dev`, mock)에도 같은 방식으로 동작하게 하려는 원칙이 aws-snapshot-manager와 같다.
- **이 결정을 뒤집을 조건**: 드리프트 이력, 알림 중복 방지, 여러 api 인스턴스 사이에 결과를 공유하는 요구가 생길 때. 그때는 결과 원문이 아니라 요약(스냅샷 ID, 계산 시각, 추가·삭제·변경 건수, 상태)만 담는 테이블을 마이그레이션(up/down)으로 설계한다.
- 백업 문구는 명세를 직접 고치지 않았다. 명세는 planner 영역이고, 요청받은 범위도 검토까지다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 코드·스키마 변경이 없어 `prisma validate`, 마이그레이션 실행, 로컬 `db`에서 `pg_dump`/`pg_restore` 실습이 필요 없다. 문구 검토는 Postgres 16과 EKS EBS CSI 문서 기준 지식으로 했고, 실제 클러스터에서 재현하지는 않았다 |

### 7. 남은 이슈·한계
- 백엔드 계약(`docs/api/k8s-snapshot.md`)이 아직 없다. 계약에 드리프트 보관이 들어가면 DBA가 다시 검토해야 한다.
- 대상 Postgres StatefulSet이 WAL을 별도 볼륨에 두는지 확인하지 않았다. EBS 스냅샷 안내는 단일 볼륨을 전제로 조건부로 썼다.

### 8. 다른 담당 요청
- `planner 요청` (명세 3.9 문구 수정 제안, 화면용 짧은 문구)
  > "이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 스냅샷의 PVC를 적용하면 빈 볼륨이 새로 만들어집니다. 데이터는 `pg_dump`(데이터베이스별) + `pg_dumpall --globals-only`(역할) 논리 백업, 또는 EBS 볼륨 스냅샷으로 따로 **암호화해서** 보관하세요. 백업 파일은 git이나 스냅샷 폴더에 두지 마세요(README)."
- `planner 요청` (명세 3.9 복원 순서를 두 경로로 나누기)
  - 논리 백업: Secret 다시 만들기(`secret-refs.json`) → 매니페스트 적용 → 빈 StatefulSet 기동·준비 확인 → 전역 객체 복원(`psql`) → `pg_restore`(같은 메이저 버전이거나 더 새 버전)
  - 볼륨 스냅샷: Secret 다시 만들기 → StatefulSet보다 **먼저** 스냅샷에서 PVC 만들기(이름 `<템플릿>-<sts>-<순번>`, `dataSource` 또는 정적 PV, 같은 AZ). 스냅샷에 있는 같은 이름의 PVC YAML은 적용하지 않는다 → 나머지 매니페스트 적용 → StatefulSet 기동(WAL 재생으로 복구)
- `planner 요청` (AC-K15 README 안내에 넣을 항목): `pods/exec`는 사람의 운영 권한으로 실행하고 대시보드·내보내기 역할에는 넣지 않는다. 비밀번호는 명령줄 인자로 넘기지 않는다. Windows PowerShell에서는 `>` 리다이렉트로 덤프를 받지 않는다(`-f` + `kubectl cp`). EBS 스냅샷은 크래시 일관성만 보장하고, VolumeSnapshot은 snapshot-controller가 설치돼 있어야 쓸 수 있다. PITR은 범위 밖이다.
- `backend 요청` (참고): `deploy/aws-snapshot/README.md` 8장 Postgres 행에도 위 보강(전역 객체, PowerShell 리다이렉트, 볼륨 스냅샷 복원 순서)을 반영하는 것을 권장한다. k8s-snapshot README가 이 장을 참조한다.

### 9. 다음 담당이 알아야 할 점
- 드리프트 서비스는 `PrismaService`에 의존하지 않게 만든다(메모리 계산). DB 없이 실행하는 경우와 mock에서도 같은 코드 경로를 쓴다.
- 모니터링 대상 DB 조회 쿼리(`apps/api/src/database/health/**`)와 `docs/db/monitor-account.sql`은 바뀌지 않았다. 복원 뒤 모니터링 계정은 `pg_dumpall --globals-only` 결과를 복원하거나 `docs/db/monitor-account.sql`을 다시 실행해서 되살린다.
