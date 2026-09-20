# snapshot-3d 진행 현황

스냅샷 3D 시각화(three.js). 명세: [docs/specs/snapshot-3d.md](../../specs/snapshot-3d.md) (AC-3D01~56, 4단계)

**이번 범위: 1단계만** — 공통 기반(3D 틀·관계 표 대체 보기·지연 로딩·접근성·성능) + K8s 구성도·드리프트 = AC-3D01~33

| 단계 | 담당 | 보고서 | 상태 |
|---|---|---|---|
| 1. 기획 | planner | [planner.md](planner.md) | 완료 |
| 2. 열린 질문 확인 | 사용자 | 이 문서 | 완료: Q1~Q4 모두 권장안, 범위는 1단계만 (2026-09-20) |
| 3. 설계 | designer | [designer.md](designer.md) | 완료 (viz 색 토큰 신설, 상세 탭 6개 `?view=3d`) |
| 4. API 계약 | backend | [backend.md](backend.md) | 완료 (`docs/api/snapshot-3d.md`, `GET /api/k8s-snapshots/:id/graph` 1개, 명세 차이 11개 16절 — PM 승인) |
| 5. 구현 | backend / publisher | [backend.md](backend.md) / [publisher.md](publisher.md) | 완료 — publisher(viz 컴포넌트 10종 + 판 표식, vitest 355 pass) / backend(`…/graph`, api test 398 pass, large p95 45~67ms) |
| 6. 통합 | frontend | [frontend.md](frontend.md) | 완료 (three.js, 번들 실측, 라벨·카메라 4회 조정) |
| 7. 검증 | PM | 이 문서 | 완료 (아래) |

## 사용자 결정 (2026-09-20)
- 범위: 1단계(AC-3D01~33)만. 2~4단계 보류
- Q1 통합 장면 짝: 자동 제안(이름 일치 + 시점 최근, 24시간 초과 경고) + 수동 선택 허용 (2단계 이후)
- Q2 대체 보기: 관계 표만 (2D 평면도 없음)
- Q3 블록 클릭: 한 번 = 선택·정보 패널, 더블클릭·Enter = 이동
- Q4 워크로드↔노드그룹: 스케줄 제약(nodeSelector·필수 nodeAffinity)이 있을 때만 점선 (2단계 이후)

## PM 결정
- dba 호출 안 함: planner가 "DBA 할 일 없음"으로 판단했고 이번 범위에 DB 작업 없음
- aws-snapshot-manager·k8s-snapshot 명세의 "범위 밖" 항목에 `snapshot-3d`에서 다룬다는 주석을 planner가 추가

## PM 결정 (2026-09-20)
- 정보 줄 `+N` 합침: publisher는 줄바꿈만 막고(`nowrap`, 마지막 칩만 말줄임), 합침 판단은 frontend. 추가 prop 없음
- `+N`의 내용은 **툴팁 한 줄로 충분**(Popover 만들지 않음). 이유: 칩 문구가 짧고, Popover를 열면 정보 줄이 임의 내용 담는 자리가 된다
  - 남은 문서 작업: `docs/design/snapshot-3d.md` 6.4의 "툴팁·Popover" 문구를 툴팁만으로 수정 (designer)

## 7단계 검증 (PM, 2026-09-20)
- web: lint 0 / tsc 0 / vitest 408 pass · api: lint 0 / jest 398 pass (1 skip 기존) · CLI: k8s 65 / aws 105 pass
- 번들 실측(전송량): 3D 미사용 라우트 변화 없음, 상세(파일 탭) 397.1 KB, **3D 탭 클릭 시에만 +144.8 KB**(3D 청크 gzip 130 KB, 한도 300 KB), 관계 표는 three.js 없이 동작
- 장면 실측(mock K-1, 1440×900): `fit` 1.00005 · `fillX` 0.9185 · `fillY` 0.8660 · `dx/dy` ≈0 · 이름 14/27 · 라벨 숨김 13 · **표식 블록 11/11 이름 표시** · 표식 숨김 0
- PM 화면 확인: 3D 장면(1440 라이트/다크, 1024), 선택 패널, 관계 표

### 수용 기준 (1단계 AC-3D01~33)
| 구분 | AC |
|---|---|
| 확인 | 3D01~06, 3D08~18, 3D20(백엔드 p95 45~67ms), 3D23~33 |
| 부분 | 3D07(저사양 감지·자동 간소화·컨텍스트 손실은 구현, "저사양 흉내 개발 설정" 없음), 3D22(묶어 보기 칩·안내·관계 표 전체 행은 되나 **3D 묶음 블록 미구현**) |
| 미측정 | 3D19(기준 장비 첫 화면 시간), 3D21(힙 증가 10% 이하) — 헤드리스는 소프트웨어 렌더라 무의미, `window.__sentinel3d.frameStats()` 준비됨 |
| 범위 밖(보류) | 3D34~56 (2~4단계) |

### 라벨 조정 경과 (4회)
계산 전제 오류 → 실측 기반으로 전환. 최종: 층 간격 16u 채택(A·B·C·D 실측 비교), 표식 블록 B2 보장 버그 수정으로 이름 7→14/27. designer가 **비율 목표를 폐기하고 불변 6개**로 교체(표식 숨김 0, 표식 블록 이름 표시, 라벨이 블록을 덮지 않음, 숨긴 수 고지, 카메라 fit, 결정적 배치). 원칙: **3D=구조, 관계 표=목록**.

### 남은 이슈
- 표식 블록 이름 보장의 대가로 라벨끼리 2군데 겹침(블록은 가리지 않음)
- 도구 막대 A의 결과 수가 정보 줄 칩과 중복 → 빼면 캔버스 +20px (미적용)
- AC-3D22 3D 묶음 블록, AC-3D19·21 실장비 측정
- `docs/design/snapshot-3d.md` 6.4 `+N` 문구(툴팁만)는 반영됨 / 이 저장소는 git 저장소가 아님 — 작업 중 `engine.ts` 메서드 소실 사고 1건(복구됨)

## 블록 모양 분화 (2026-09-20, 사용자 요청)
종류별 3D 모양 9종. designer가 **봉투 4u × 3u × 4u + 상단 평면 3u**로 고정해 발자국·앵커·bbox를 유지 → 라벨·카메라 규칙과 실측값이 그대로(`fit` 1.0000472 / `fillX` 0.9185386 / `fillY` 0.8659683, 소수 5자리 일치).

| 모양 | 종류 |
|---|---|
| 겹친 상자 `stack` | Deployment |
| 원통 `cylinder` | StatefulSet · PVC · PV |
| 얇은 판 `panel` | DaemonSet · ConfigMap |
| 박공 지붕 `roof` | CronJob (용마루 z, 사면 ±x) |
| 머리 깎은 상자 `chamfer` | Job · Secret |
| 아치 문 `gate` | Ingress |
| 다이아몬드 `diamond` | Service |
| 기본 상자 `box` | Pod · ReplicaSet · 사용자 지정 등 |
| 곁 타일 `tile` | 곁 층 전부 |

- 광원 방위 −45°→−78° + 밝기 100/82/64% 양자화 (이전에는 보이는 두 옆면이 같은 밝기라 꺾임이 안 읽힘)
- 인스턴싱 단위 `층 × 모양`(10조합), 블록 드로콜 20, 모양별 삼각형 224 ≤ 256
- 범례에 「모양 = 종류」 절, 종류 필터 옵션에 모양 견본(`ShapeSwatch`)
- **카메라 버그 수정**: 대규모(3,264블록) 첫 화면이 비던 문제 — 카메라 뒤 bbox 모서리를 제외(유효 모서리 `m`), `m<3`이면 보정 건너뛰고 직전 값 유지. 고치기 전 `dx ≈ −249,959` → 후 −406(유한, 장면 보임, 칩으로 전체 복귀)
- backend가 mock에 `Job report-backfill` 추가 → 실장면에서 stack↔chamfer 구분 확인. 기준 장면 블록 27→28, 이름 14/28, 표식 숨김 0

### 검증 (PM, 2026-09-20)
web lint 0 / tsc 0 / vitest **455 pass** · api jest **398 pass** · 그래프 API에 `Job` 블록 확인 · 3D 페이지 200

### 남은 이슈 (추가)
- 대규모 첫 화면 중심이 −406/−308px 치우침(장면은 보이고 칩으로 복귀). 완전 수렴하려면 bbox 모서리 대신 보이는 블록 앵커로 사각형을 잡아야 함 — 이번 범위에서 멈춤(PM 결정)

## 판 집계 버그 수정 (2026-09-20)
`plates[].byLayer`가 드리프트 "추가됨" 유령을 세지 않던 결함. 원인은 집계가 두 곳에서 일어나는데(`graph-builder.ts` 스냅샷 기준 → `graph.service.ts` 겹쳐 보기), 서비스가 `resourceCount`·`ghostCount`는 재집계하면서 `byLayer`만 1단계 값을 복사한 것. 유령을 `blocks[]`에 넣은 뒤 도는 같은 루프에서 함께 세도록 고침.
- 실제로 바뀐 값: `ns:prod.byLayer.workload` 3 → 4 (`drift=on`). `drift=off`는 원래 정상
- 테스트 불변식 추가: 판별 `resourceCount`/`ghostCount`/`byLayer`가 `blocks[]` 실제 집계와 일치, 모든 판 합 = `summary.blocks`
- mock `Job report-backfill`(batch 판) 추가로 K-1 기대값: 블록 34(유령 9) · 선 28 · 비교 불가 5
- 미검증: 유령 판(`ghost-ns:*`)은 mock에 케이스가 없어 실제 데이터로 확인 못 함
- 주의: `graph-builder.ts`에도 같은 집계가 남아 있고 서비스가 덮어쓴다 — 빌더 결과를 직접 쓰는 새 코드는 유령이 빠진 값을 보게 됨

### 최종 검증 (PM, 2026-09-20)
api jest 398 pass · web vitest 455 pass · 실행 중 API 응답에서 blocks 34 / edges 28 / `ns:prod.byLayer` = storage 2 · workload 4 · service 2 · ingress 2 · aux 6 (합 16 = 리소스 11 + 유령 5) 확인
