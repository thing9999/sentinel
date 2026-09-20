# k8s-snapshot · planner 작업 보고

> 파일 위치: `docs/reports/k8s-snapshot/planner.md`

## 2026-09-19 · 기능 명세 초안 작성

### 1. 요청 내용
- PM 요청: 쿠버네티스 매니페스트 스냅샷 + 드리프트 비교 기능 명세 `docs/specs/k8s-snapshot.md` 작성.
- 범위(사용자 확정): ① CLI `deploy/k8s-snapshot/`(사람용 별도 컨텍스트, 런타임 필드 제거, Secret 값 제외, 비밀값 스캔, aws-snapshot 패턴 재사용) ② "AWS 스냅샷" 메뉴를 "스냅샷"으로 넓혀 AWS / Kubernetes 탭, k8s 스냅샷 관리는 aws-snapshot-manager 규칙 재사용 ③ 기존 대시보드 읽기 전용 RBAC 안에서 스냅샷 vs 현재 클러스터 드리프트(추가/삭제/변경, 필드 diff, 기본값 가짜 차이 대책). 대시보드는 클러스터·AWS에 쓰지 않음, 적용·내보내기 버튼 없음, RBAC 확장은 열린 질문. mock 예시, Postgres·PV 데이터는 범위 밖(안내만).

### 2. 참고한 문서
- `CLAUDE.md`
- `docs/specs/aws-snapshot-manager.md`, `docs/api/aws-snapshot-manager.md`(0·1·5·6·9~15절), `docs/design/aws-snapshot-manager.md`(화면 경로·메뉴)
- `deploy/aws-snapshot/README.md`, `deploy/aws-snapshot/lib/config.mjs`, `deploy/aws-snapshot/lib/scan.mjs`
- `deploy/rbac.yaml`
- `docs/specs/cluster-status.md`(시스템 네임스페이스 가정 A6, RBAC), `docs/api/common.md`(SourceId, not_configured 규칙)
- 확인만: `apps/web/src/app/snapshots/{page,[id]/page,trash/page}.tsx` 존재(기존 URL 호환 근거), `apps/api/src/cluster/kube/extract.ts` 존재(informer가 추린 값만 보관할 가능성)

### 3. 작업 내용
1. ASM 명세·계약에서 재사용할 규칙(목록·상세·편집·라벨·휴지통·경로 보안·mock 메모리·출처 처리)을 표로 대응시키고, k8s에서 달라지는 점만 기술(5.0).
2. CLI 명세(3절): 컨텍스트 필수, 클러스터 식별(kube-system UID), 내보낼 종류(기본/선택/항상 제외 + 드리프트 비교 가능 여부), 네임스페이스 범위 규칙, 런타임 필드 정리 규칙 표, 쿠버네티스 전용 스캔 규칙 제안, 폴더 구조(리소스 1개 = 파일 1개)와 metadata 항목, 설정, 종료코드(부분 성공 4 신설), 데이터 백업 안내.
3. 드리프트 명세(4절): 경계(get/list/watch만, 서버 측 dry-run 금지), 비교 가능/불가 종류, 짝 맞추기와 추가/삭제/변경 정의(스냅샷 범위 규칙 재적용), 기본값 잡음 대책 7단계(같은 정리 규칙, 값 정규화, 키 기반 목록 매칭, 기본값 표, 관리 필드, 숨긴 차이 펼침, 스냅샷 편집으로 맞춤), 계산 대상·주기, 상태 판단(장애 없음), 표시 규칙과 값 가림.
4. 화면 명세(5절): 파일 상태 판단 표(ASM 3.3 대응), 목록·상세·편집 차이, 메뉴 확장과 기존 URL/API/토픽 호환, CLI 안내, mock 예시 10종 + 시나리오.
5. 수용 기준 AC-K01~K44, 범위 밖, 역할별 전달, 기존 문서 충돌, 열린 질문 Q1~Q4 + 사소한 결정 목록.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/specs/k8s-snapshot.md` | 추가 | 기능 명세 초안 |
| `docs/reports/k8s-snapshot/planner.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **Secret 처리(Q1 권장 A)**: 쿠버네티스에는 "값 없이 목록만" 권한이 없으므로, 내보내기 역할에 secrets 권한 자체를 주지 않고 워크로드 참조에서 Secret 이름만 모으는 안을 권장. 대안 B(키 이름 뼈대), C(완전 제외) 비교.
- **드리프트는 장애가 없다 / 메뉴 상태에 넣지 않음(Q2 권장 A)**: 스냅샷은 과거 기록이라 시간이 지나면 거의 항상 차이가 나므로, 넣으면 "커밋 금지" 신호가 흐려진다.
- **RBAC 확장 안 함(Q3 권장 A)**: 사용자 기본 전제. 확장 시 후보(비밀값 적은 종류)와 제외(configmaps·secrets)를 적어 둠.
- **cluster.id = kube-system 네임스페이스 UID**: 대시보드 기존 RBAC(namespaces get)로 대조 가능, 비밀값 아님. 없으면 계산 안 함(Q4 권장 A).
- **기본값 필드는 내보낼 때 지우지 않음**: 버전별 기본값이 바뀔 수 있어 지우면 되살릴 수 없음. 잡음은 드리프트 쪽 표·분류로 처리하고 숨긴 차이는 펼쳐 볼 수 있게(투명성).
- **리소스 1개 = 파일 1개**: git diff·파일 단위 편집·짝 맞추기·`kubectl apply -R`에 유리.
- **스캐너 규칙 한 벌 + k8s 규칙 추가**: 기존 `env-block`은 k8s `env:`를 잡지 못하고 `secret-key-value`는 `name:`/`value:`가 다른 줄이라 못 잡음(`lib/scan.mjs` 확인) → `k8s-env-literal` 등 제안. 구현·위치는 백엔드.
- **부분 성공 종료코드 4 신설**: 권한 없는 종류를 조용히 넘기지 않기 위해.
- **자동 드리프트는 최신 스냅샷만**: 오래된 스냅샷을 모두 계산하면 비용·잡음이 큼.
- **드리프트 값 가림(env value·command·args·스캐너 규칙 해당)**: 클러스터 쪽 값은 운영 데이터이고 CLAUDE.md의 env/command 원칙과 맞춤. 어노테이션은 ALB 설정 확인에 필요해 보임.
- **기존 AWS URL·API·토픽 불변, k8s 별도 경로**: 두 스냅샷 ID 형식이 같아 ID로 종류를 추측할 수 없음.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 작업이라 실행할 검증 없음. 참고 문서와의 일관성은 읽기로만 확인 |

### 7. 남은 이슈·한계
- 열린 질문 Q1~Q4 미결(사용자 확인 필요).
- 기본값 표·관리 필드 표는 예시만 적음. 쿠버네티스 버전별 최종 표는 백엔드가 확인해야 함.
- 기존 informer가 `spec` 전체를 보관하는지 확인하지 않음(백엔드 확인 사항으로 넘김).
- mock 드리프트의 클러스터 쪽 값을 기존 mock 클러스터 데이터와 맞추는 방법은 미정(백엔드).
- CLI의 클러스터 호출 방식(kubectl / 클라이언트 라이브러리) 미정(백엔드).

### 8. 다른 담당 요청
- `PM 요청`: `CLAUDE.md` 확정된 결정에 기능 5 `k8s-snapshot` 추가, 기능 4 메뉴 이름 "AWS 스냅샷" → "스냅샷". ASM 명세 U1·3.4·AC-21을 이 명세 5.5로 갱신할지 결정(갱신하면 planner가 수정).
- `backend 요청`: 명세 8절 백엔드 항목(CLI·README·스캐너 규칙 추가·정리/기본값 규칙 공유·계약 `docs/api/k8s-snapshot.md`·드리프트 데이터 경로·compose 마운트·`deploy/aws-snapshot/README.md` 8장 갱신·`common.md` 추가).
- `designer 요청`: 메뉴 이름·탭, 두 배지(파일/드리프트), 리소스 트리, 드리프트 화면, `shell.md` 메뉴 라벨.
- `dba 요청`: 드리프트 결과를 DB에 보관하기로 하면 협의, 데이터 백업 안내 문구 검토.

### 9. 다음 담당이 알아야 할 점
- 명세는 ASM을 기준 원본으로 참조한다. "그대로"라고 적힌 절은 ASM·ASM-API를 그대로 따르면 된다.
- 수용 기준 번호는 `AC-K01~K44`(ASM AC 번호와 구분).
- 드리프트 상태와 파일 상태는 별도 축이다. 드리프트는 장애가 없다.
- 대시보드 RBAC(`deploy/rbac.yaml`)는 이 기능으로 바뀌면 안 된다(AC-K33).

## 2026-09-19 · 열린 질문 Q1~Q4 결정 반영

### 1. 요청 내용
- PM 전달: 사용자가 Q1~Q4를 모두 권장안으로 확정했다.
  - Q1: Secret은 읽지 않고 참조 이름만 `secret-refs.json`에 남긴다.
  - Q2: 드리프트는 메뉴 상태에 반영하지 않는다.
  - Q3: 대시보드 RBAC를 늘리지 않는다.
  - Q4: `cluster.id`가 없으면 드리프트를 계산하지 않는다.
- 열린 질문을 "결정됨"으로 바꾸고, 조건부·권장안 표현을 확정 문구로 정리한다. 의미는 바꾸지 않는다.
- PM 결정에 따라 ASM 명세 U1·3.4·AC-21도 수정한다(자세한 내용은 `docs/reports/aws-snapshot-manager/planner.md` 같은 날짜 섹션).
- CLAUDE.md 기능 5 추가와 기능 4 메뉴 이름 변경은 PM이 반영했다.

### 2. 참고한 문서
- `docs/specs/k8s-snapshot.md`(직전 작성본), `docs/specs/aws-snapshot-manager.md`

### 3. 작업 내용
1. 머리말 상태를 "열린 질문 없음. Q1~Q4 결정됨 2026-09-19, 사용자: 모두 권장안"으로 바꿨다.
2. 9절: 열린 질문을 "없음"으로 하고, "결정됨 (2026-09-19, 사용자)" 요약 아래에 기존 선택지·권장 근거를 기록으로 남겼다.
3. 본문 조건부 표현 11곳을 확정 문구로 바꿨다.
   - 3.2: "Q1 권장안 기준" → "Q1 결정"
   - 3.4 Secret 행: "처리 방식은 Q1" → Q1 결정 내용(Secret은 읽지 않고, 참조 이름만 `secret-refs.json`에 남김)
   - 3.7: "(Q1)" → "(Q1 결정)"
   - 3.8 트리의 `secret-refs.json` 설명과 metadata `secrets` 항목
   - 4.1: "늘릴지는 Q3" → "Q3 결정"
   - 4.6: "Q4 기본" → "Q4 결정"
   - 5.0·5.3 G: "Q1 권장안" → "Q1 결정"
   - 5.5: "Q2 권장안" → "Q2 결정"
   - 7절 RBAC 확장 문구
4. 8절 충돌 목록을 고쳤다. CLAUDE.md는 "PM 반영 완료"로, ASM 수정 여부는 "PM 결정으로 수정함(ASM 9절 변경 이력)"으로 바꿨다.
5. 수용 기준(AC-K*)에는 조건부 표현이 없어 바꾸지 않았다.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/specs/k8s-snapshot.md` | 수정 | 머리말, 조건부 표현 11곳, 8절 충돌 목록 2줄, 9절 결정 기록 |
| `docs/specs/aws-snapshot-manager.md` | 수정 | U1 주석, 3.4, AC-21, 9절 변경 이력 |
| `docs/reports/k8s-snapshot/planner.md` | 수정 | 이 섹션 추가 |
| `docs/reports/aws-snapshot-manager/planner.md` | 수정 | 같은 날짜 섹션 추가 |

### 5. 주요 결정과 이유
- 의미 변경 금지 지시에 따라 문구만 확정형으로 바꿨다. 조항을 새로 넣거나 빼지 않았다.
- 9절 "사소한 결정" 목록 제목("다르면 알려 주세요")은 이번 결정 대상이 아니어서 그대로 두었다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| Grep `Q[1-4]\|권장` (k8s-snapshot.md) | 확인 | 수정 전 조건부 표현 위치를 찾는 데 썼다. 수정 후 다시 확인하지는 않았다 |

### 7. 남은 이슈·한계
- 없음. 열린 질문이 모두 결정됐다.

### 8. 다른 담당 요청
- 앞 섹션의 backend·designer·dba 요청은 그대로 유효하고, 이제 확정 조건이다.

### 9. 다음 담당이 알아야 할 점
- Secret 처리는 `secret-refs.json` 방식으로 확정됐다. 내보내기 역할 예시에 `secrets` 권한을 넣지 않는다.

## 2026-09-19 · 3.9 백업·복원 안내 문구 보강 (DBA 요청 반영)

### 1. 요청 내용
- PM 전달: `docs/reports/k8s-snapshot/dba.md` 8절의 "planner 요청"을 명세 3.9에 반영한다. 항목은 `pg_dumpall --globals-only`, 볼륨 스냅샷 복원 시 PVC를 StatefulSet보다 먼저 만들기, Secret 선행 생성, 덤프를 git·스냅샷 폴더 밖에 암호화 보관, PowerShell `>` 리다이렉트 주의, EBS 스냅샷 조건이다.
- 안내 문구만 바꾸고 다른 절과 AC의 의미는 바꾸지 않는다. backend가 지금 명세로 계약을 쓰고 있다.

### 2. 참고한 문서
- `docs/reports/k8s-snapshot/dba.md`(3.2, 8절, 9절)

### 3. 작업 내용
1. 3.9의 화면 문구를 DBA 제안 문구로 바꿨다. 빈 볼륨이 새로 만들어진다는 점, `pg_dump` + `pg_dumpall --globals-only`, 암호화 보관, git·스냅샷 폴더에 두지 말 것을 담았다.
2. 복원 순서를 두 경로로 나눴다.
   - 논리 백업: Secret → 매니페스트 → StatefulSet → 전역 객체 → `pg_restore` 순서.
   - 볼륨 스냅샷: Secret → 스냅샷에서 PVC를 먼저 만들고, 같은 이름의 PVC YAML은 적용하지 않음 → 나머지 매니페스트 → StatefulSet 순서.
3. README 주의 사항 목록을 추가했다(AC-K15 안내의 내용).
   - `pods/exec`는 사람의 운영 권한으로만 실행한다.
   - 비밀번호를 명령줄 인자로 넘기지 않는다.
   - 덤프는 git·스냅샷 폴더 밖에 암호화해서 보관한다.
   - PowerShell `>` 리다이렉트를 쓰지 않는다.
   - EBS 스냅샷은 크래시 일관성만 보장하고, VolumeSnapshot은 snapshot-controller가 필요하다.
   - PITR은 범위 밖이다.
4. 모니터링 계정 복원 방법 한 줄을 덧붙였다.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/specs/k8s-snapshot.md` | 수정 | 3.9 안내 문구만 |
| `docs/reports/k8s-snapshot/planner.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유
- 화면 문구는 짧게 두고, 복원 절차와 주의 사항은 "README에 둔다"고 적었다. DBA 검토대로 화면 문구를 짧게 유지하려는 것이다.
- 3.9 밖의 절과 AC는 고치지 않았다. AC-K15의 "Postgres·PV 데이터 백업 안내"가 새 주의 사항을 포함한다는 것은 3.9 안에만 적었다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 수정만 |

### 7. 남은 이슈·한계
- 없음.

### 8. 다른 담당 요청
- `backend 요청`: 명세 3.9의 복원 순서와 주의 사항을 `deploy/k8s-snapshot/README.md`에 반영해 주세요. `deploy/aws-snapshot/README.md` 8장 보강(DBA 권장)도 검토해 주세요.

### 9. 다음 담당이 알아야 할 점
- 계약 작성 중인 backend에게 영향은 없습니다. 3.9는 안내 문구이고 API·상태 판단과 관계가 없습니다.

## 2026-09-19 · 여러 문서 파일의 드리프트 비교 규칙 추가 (디자인 요청)
- 명세 4.3에 한 줄을 추가했다. 한 파일에 `---`로 여러 문서가 있으면 드리프트는 문서(리소스)별로 비교하고, 식별값은 기존 4.3의 apiGroup + kind + namespace + name을 쓴다(버전 제외, 빈 문서 무시). 권장안으로 정했다. 식별값은 designer가 제안한 apiVersion이 아니라 기존 4.3 정의를 따랐다. 버전을 넣으면 기존 식별 규칙의 뜻이 바뀌기 때문이다. 다른 내용은 바꾸지 않았다. 변경 파일은 `docs/specs/k8s-snapshot.md`이다.
