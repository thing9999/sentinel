# snapshot-3d · 백엔드 작업 보고

> 파일 위치: `docs/reports/snapshot-3d/backend.md`
> 같은 기능에서 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다.

## 2026-09-20 · 4단계 API 계약 (1단계: K8s 구성도 + 드리프트)

### 1. 요청 내용

- PM 요청: 기능 `snapshot-3d` **4단계 = API 계약 문서만** 작성. 구현·코드 수정 금지.
- 산출물: `docs/api/snapshot-3d.md` (+ `docs/api/common.md` 필요한 추가), 보고서 `docs/reports/snapshot-3d/backend.md`.
- 범위: **1단계만** — 공통 기반 + K8s 구성도·드리프트(AC-3D01~33). AWS 구성도·시간축·통합 장면(AC-3D34~56)은 **보류**라 계약에 넣지 않고 확장 여지만 남긴다.
- 계약에 담을 것(요청 그대로): k8s 스냅샷 하나의 그래프 응답(노드·간선·관계 종류·근거·추출 실패 표시), 드리프트를 노드에 싣는 방법(중복 조회 없이), 관계 표 대체 보기가 같은 응답으로 그려지는지, 규모 제한·잘림·p95 1초·캐시, mock(cluster mock 인벤토리 **실제 이름**·대규모 시나리오), 비밀값 금지·조회 전용, AC 매핑·오류 코드, 기존 `/api/k8s-snapshots/**` 응답·SSE·mock 그룹 불변.
- 작업 중 코스 수정(PM 전달): designer 산출물 반영 — `blocks[].layer`(서버가 층 판단), `blocks[]` 배열 순서 = 배치 순서(좌표 없음), `edges[]{rule, certainty, evidence, optional}`(원문 금지), `blocks[].notes[]`, `summary{blocks, ghosts, edges, driftMarkers, scanMarkers, outsideFindings, grouped}`, 가능하면 `blocks[].fileLine`, 드리프트는 기존 `DriftBadge`/`resources[].change`/`actions.computeDrift` 재사용·새 호출 금지. URL 규칙(`?view=3d`, 선택은 `res=`, 3D 전용 필터는 `g` 접두사).

### 2. 참고한 문서·코드

- `CLAUDE.md`(기능 6 `snapshot-3d` 포함 확정 결정, 역할별 쓰기 영역)
- `docs/specs/snapshot-3d.md`(확정본. 0.2 가정, 3.0 공통 원칙, **3.1 K8s 구성도·관계 K1~K11**, 3.5~3.10, 4절 갱신·성능·번들, 5.0~5.2 AC-3D01~33, 6절 범위 밖, 7절 역할별 전달, 8절 Q1~Q4 결정)
- `docs/api/k8s-snapshot.md`(0절 화면↔엔드포인트, 1.1 경로 규칙, 3.1~3.5 폴더·메타·secret-refs·종류 목록, 5절 타입(`DriftBadge`·`DriftCounts`·`DriftAbility`), 6.3 상세 `files[]`·`documents`·`tree`, 10절 드리프트 전체, 11절 사유 코드, 13절 SSE, 14절 mock, 15절 env, 16절 예외)
- `docs/api/common.md`(1.3 요청, 1.4 응답·금지 값, 2.2 `StatusInfo`, 2.3 출처·stale, 3절 에러, 5절 SSE, 6.1 mock 그룹)
- `docs/design/snapshot-3d.md`(작업 중 완성됨: 2.1 탭 `?view=3d`, 2.2 URL `g*`, 4.1~4.9 판·층·블록·유령·선·라벨·표식, 6.4 정보 줄, 7 선택 패널, 8 관계 표, 9.6~9.8 상태, 10 겹쳐 보기·이동 규칙, **14절 백엔드 계약 요청표**, 15절 확장 여지)
- 코드: `apps/api/src/k8s-snapshots/{k8s-analyzer.ts,k8s-snapshots.service.ts,k8s-mock-fixtures.ts,k8s.constants.ts}`, `k8s-snapshots/drift/{drift.service.ts,mock-cluster-objects.ts,comparable-kinds.ts}`, `apps/api/src/cluster/mock/mock-world.ts`, `k8s-snapshots.http.spec.ts`(mock 기대값 확인)
- `docs/reports/snapshot-3d/planner.md`(남긴 이슈: mock 이름은 백엔드가 확정)

### 3. 작업 내용

1. **명세·디자인 대조**: 1단계 AC-3D01~33 중 백엔드 몫(AC-3D04·10~16·18·20·22·24~33)을 추려 필요한 값 목록을 만들고, 디자인 14절의 요청표(판·블록·층·순서·유령·표식·표시 문구·관계·요약)와 1:1로 맞췄다.
2. **코드 확인**(읽기만): `K8sAnalysis.docs[]`가 이미 파싱된 문서 객체를 들고 있고 스냅샷별 분석이 지문(`fp`)으로 캐시된다는 것을 확인 → 그래프는 **파일을 다시 읽지 않고** 이 캐시를 소비하는 구조로 잡았다. `DriftService.fileDrift()`/`badge()`/`view()`를 보고, 3D용으로는 **계산·임대 부작용이 없는 읽기 전용 접근자 `graphDrift()`** 를 새로 두기로 했다.
3. **엔드포인트 1개 설계**: `GET /api/k8s-snapshots/:id/graph`. 3D와 관계 표가 같은 응답을 쓰게 해 별도 엔드포인트·중복 조회를 없앴다. 쿼리는 `rules`(K1~K11 선택), `drift`(on/off) 둘뿐이고, 화면 필터·검색·선택(`g*`)은 서버로 가지 않는다.
4. **응답 구조 정의**: `graph.{state, version, builtAt, snapshotStatus, cluster, summary, layers, rules, plates, blocks, edges, groups, facets, drift, scan, notices}`.
   - 판 `plates[]`(namespace/cluster/unparsed/ghost), 블록 `blocks[]`(resource/ghost/unparsed) + `layer`(storage·workload·service·ingress·aux) + **배열 순서 = 배치 순서**, 간선 `edges[]`(`rule`·`certainty: confirmed|estimated`·`evidence` 문자열 + `evidenceItems[]`·`optional`·`toGhost`).
   - 표식 `markers{scan{errors,warnings,firstLine}, drift, fileIssue, helm}`, 표시 문구 `notes[]`(`selector_missing`·`no_target`·`pvc_template_unmatched`·`path_mismatch`·`duplicate`·`multi_document`·`runtime_fields`·`parse_failed`·`custom_resource`), 유령 `ghost{reason,text}`(디자인 5종 코드 그대로).
   - 이동 `navigate{primary, file, line, resourceKey, secretName}` — 디자인 10.4 규칙(스캔 발견 우선, 발견 줄 포함)을 **서버가 판단**.
5. **관계 추출 규칙 K1~K11**을 근거 코드·고정 문구·확실성·기본 켬 여부까지 표로 고정했다(5.1·5.3). 같은 (rule, from, to)는 선 1개로 합치고 근거를 쌓는다. 셀렉터·레이블·어노테이션 **값은 응답에 없다**.
6. **드리프트 겹치기**: `graph.drift`(기존 `DriftBadge`·`actions.computeDrift` 재사용 + `usable`·사유)와 블록별 `markers.drift{change, fieldCount, hidden, reason}`. 계산·임대는 **기존 `POST …/drift`** 그대로. `GET …/drift`는 필드 차이를 볼 때만 부른다.
7. **규모·성능·캐시**: `summary.grouped`(3,000 초과 묶어 보기), `truncated`(20,000/40,000 안전 상한), 그래프 LRU 캐시(키 = `graph.version`), 드리프트·스캔은 응답 시점에 얹어 캐시를 깨지 않음 → p95 1초 목표 근거와 측정 방법을 적었다.
8. **mock 실제 이름 확정**: `mock-world.ts` → `mock-cluster-objects.ts` → `k8s-mock-fixtures.ts`를 따라가 K-1의 판·리소스 목록을 전부 확인하고, 명세 3.10의 예시 이름과 다른 점을 계약에 적었다. AC-3D25가 요구하는 관계 중 실제로 없는 것(K5 ConfigMap 참조, K3 claimName)을 찾아 **드리프트 건수를 바꾸지 않는 보강**(클러스터 객체 + 스냅샷 양쪽에 같은 내용)을 정의했다. K-9(관계 예외 3종)·K-7(여러 문서 파일) 보강, 대규모 시나리오 `large`(1,000·3,200 리소스)도 구성표까지 정의했다.
9. **`common.md` 갱신**: 적용 문서 목록, 6.1 mock 그룹 `k8s-snapshots`에 `large` 추가, 8절 변경 이력(1.4 예외를 늘리지 않는다는 점 명시).
10. **designer 코스 수정 반영**: 처음 초안은 `zones/nodes/relation/inferred` 이름이었는데, 디자인 14절 요청에 맞춰 `plates/blocks/rule/estimated/notes/summary`로 **전면 개명**하고, `namespace.yaml`을 블록이 아니라 판으로(디자인 4.2) 바꿨다. `file.line`·`markers.scan.firstLine`·`navigate.line`을 새로 넣었다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/snapshot-3d.md` | 추가 | 1단계 API 계약 전체(19절). 엔드포인트 1개, 판·블록·간선·표식·유령·표시 문구·드리프트·스캔·요약·facets·규모·캐시·예외·mock·오류·env·AC 매핑·다르게 정한 점·불변 목록·확장 자리 |
| `docs/api/common.md` | 수정 | 적용 문서에 `snapshot-3d.md` 추가, 6.1 mock 그룹 `k8s-snapshots`에 시나리오 `large` 1행, 8절 변경 이력 1행 |
| `docs/reports/snapshot-3d/backend.md` | 추가 | 이 보고서 |

- **코드는 한 줄도 바꾸지 않았다**(요청대로 계약만).

### 5. 주요 결정과 이유

| 결정 | 대안 | 이유 |
|---|---|---|
| 새 문서 `docs/api/snapshot-3d.md` | K8S-API에 절 추가 | 2~4단계(AWS·시간축·통합)가 같은 문서로 자란다. K8S-API는 이미 1,600줄 |
| 엔드포인트 1개(`GET :id/graph`)에 관계 + 드리프트 + 스캔을 함께 | 그래프 / 드리프트 2회 조회 | 표식 수와 배지 건수가 같은 시점 결과라야 AC-3D27이 성립하고, 왕복 2회는 p95 1초에 불리 |
| 3D와 관계 표가 **같은 응답** | 표 전용 엔드포인트 | AC-3D04(같은 행 수·같은 이동)를 구조적으로 보장. 표는 three.js 없이 동작 |
| `blocks[]` 배열 순서 = 배치 순서, **좌표 없음** | 서버가 좌표 계산 | 디자인 14절 요청. 배치 규칙(격자·층 높이)은 디자인 몫이고, 서버는 결정적 순서만 보장하면 AC-3D11이 성립 |
| `namespace.yaml`은 판(블록 아님) | Namespace도 블록 | 디자인 4.2. 대신 AC-3D24 확인식을 `blocks + namespaceDocuments = documents + ghosts + unparsedBlocks`로 적고, Namespace 드리프트 표식은 **판**에 실어 표식 수가 드리프트 건수와 어긋나지 않게 함 |
| `rules` 쿼리 기본값 = 전체(K1~K11) | 기본 켬(K1~K7)만 내려보내기 | 관계 필터를 켤 때마다 재조회하면 AC-3D10(즉시 필터)·명세 3.6과 어긋남. 기본 표시 여부는 `rules[].defaultOn`으로 전달 |
| 드리프트는 **읽기 전용 접근자**로 겹치기(`graphDrift()`) | 그래프 요청 시 계산 | AC-3D13(쿠버네티스 호출 0건). 계산·임대는 기존 `POST …/drift`만 |
| 유령 블록을 항상 응답에 두고 `ghostFromRules`로 숨김 판단 | 기본 켬 관계의 유령만 내려보내기 | 표·개수에서 빠지면 3D와 표 수치가 달라진다. 화면은 관계 필터에 따라 숨기면 됨 |
| `evidence`(문자열) + `evidenceItems[]`(구조) 둘 다 | 문자열만 | 디자인은 문자열 하나만 요구했지만 같은 대상 다중 참조(예: envFrom + volume)의 근거를 표 펼침에서 나눠 보여 줄 수 있게 배열을 덧붙임. 화면은 문자열만 써도 됨 |
| `summary`에 이미지 문자열 없음 | 이미지 표시 | ECR 이미지에는 계정 ID가 들어간다(AC-3D14 취지). 3D·표에서 쓰지 않는 값 |
| mock 보강은 **클러스터 객체 + 스냅샷 양쪽에 동시** | 스냅샷 파일만 수정 | 한쪽만 고치면 드리프트 건수(변경 1·삭제 1·추가 1)가 달라져 AC-K44·기존 테스트가 깨진다 |
| 대규모 예시는 **다른 클러스터 ID**(`bench-eks`) | 대시보드 클러스터와 같게 | 같으면 자동 드리프트 대상이 바뀌어 기본 예시 동작이 흔들리고, mock에서 1,000개 리소스를 반복 비교하게 된다 |
| 대규모는 **별도 시나리오 `large`**, 관계 예외·다중 문서는 `default`에 | 모두 별도 시나리오 | 기본 목록 성능은 지키되(명세 3.10), AC-3D26·31은 기본 상태에서 바로 확인 |
| 잘림 상한 20,000 블록 / 40,000 선 | 상한 없음 | 손으로 만든 거대 폴더에서 서버가 멈추지 않게. 기준 규모·3,000 초과 예시에는 영향 없음 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과(출력 없음) | 코드 변경 없음, 회귀 확인용 |
| `npm test --prefix apps/api` | 통과 — 39 suites / 376 passed, 1 skipped | 코드 변경 없음. mock 기대값(파일 상태 10건, 드리프트 건수, 비교 불가 종류)이 계약의 전제와 같은지 확인 |
| 계약 내부 정합성(손 계산) | 통과 | K-1 판별 개수·유령 9·블록 33·선 26·facets 합계(1+1+1+18+4+0+8=33)를 서로 맞춤 |
| 실제 그래프 응답 측정(p95 1초) | **하지 않음** | 구현 전이라 불가. 구현 단계에서 mock `large`로 50회 측정해 이 보고서에 추가한다(AC-3D20) |

### 7. 남은 이슈·한계

1. **12.2·12.3의 mock 숫자는 손 계산값**이다(블록 33·선 26·유령 9 등). 구현에서 단위 테스트로 고정하고, 다르면 **계약을 먼저 고친다**고 계약에 적어 두었다.
2. **`file.line`(문서 시작 줄)** 은 `yaml` 문서 range로 계산할 계획이다. 파서가 주는 offset→줄 변환이 BOM·CRLF에서 어긋날 수 있어 구현에서 테스트가 필요하다. 못 주면 디자인 10.4 각주대로 파일 첫 줄로 간다.
3. **Namespace 리소스의 드리프트 표식을 판에 싣는다**고 정했는데, 디자인 4.1·8.2에는 판 표식·네임스페이스 그룹 행 표식이 그려져 있지 않다. mock에서는 Namespace가 항상 `same`이라 당장 보이지 않지만, 실제 클러스터에서 `changed`가 나오면 표식 수(AC-3D27)와 화면이 어긋날 수 있다 → designer 확인 필요(8절).
4. **K-7에 여러 문서 파일을 더하면** 그 스냅샷의 파일 상태 사유에 `MULTI_DOCUMENT_FILE`이 1개 늘어난다(상태 값 `warning`은 그대로, 기존 테스트 기대값은 상태 값만 본다). 구현에서 사유 배열을 검사하는 테스트가 생기면 함께 갱신해야 한다.
5. 대규모 시나리오의 선 수 "약 1,960"은 구성표에서 계산한 값이다. 생성기 구현에서 ±5% 벗어나면 계약 숫자를 고친다.
6. `rules`·`drift` 쿼리 외에 payload를 더 줄일 수단(필드 축약 모드, ETag/304)은 두지 않았다. ETag를 쓰면 CORS 노출 헤더(`common.md` 1.2)를 바꿔야 해서 이번에는 뺐다 — 필요해지면 확장 여지로 남겨 두었다.

### 8. 다른 담당 요청

- **designer 요청**: ① 네임스페이스 **판에 붙는 표식**(Namespace 리소스 자체의 드리프트·스캔·파일 문제)을 3D 판 라벨과 관계 표의 네임스페이스 그룹 행에 어떻게 그릴지 정해 주세요(7절 3). 계약은 `plates[].markers`·`plates[].notes`로 값을 줍니다. ② `blocks[].notes[]`의 `custom_resource`("사용자 지정 리소스 — 참조를 뽑지 않음") 표시 자리(블록 보조 줄 or 패널만)도 확인 부탁드립니다.
- **frontend 요청**: ① 3D 보기 데이터는 `GET /api/k8s-snapshots/:id/graph` **한 번**으로 끝납니다. 드리프트 배지·표식·계산 시각이 응답 안에 있으니 3D 탭에서 `GET …/drift`를 따로 부르지 마세요(드리프트 탭의 필드 차이를 볼 때만). ② 필터·검색·선택은 **재조회 없이** 응답 안에서 처리하세요(`rules` 쿼리는 payload 절감용). ③ 임대 갱신은 기존 규칙대로 `POST …/drift {"force": false}` 60초마다. ④ "구성이 바뀌었습니다"는 `graph.version` 비교로 판단하세요(표식만 바뀌면 값이 그대로입니다).
- **PM 참고**: 이 계약은 기존 `/api/k8s-snapshots/**`·`/api/aws-snapshots/**`·SSE·mock 그룹을 바꾸지 않습니다(17절 불변 목록). 유일한 추가는 새 라우트 1개와 mock 시나리오 `large` 1개입니다.
- **DBA 요청 없음**(스키마 변경 없음. 그래프는 메모리 캐시만).

### 9. 다음 담당이 알아야 할 점 (구현 단계 backend 포함)

- 구현 위치(계약 17절): `apps/api/src/k8s-snapshots/graph/{relations.ts, graph-builder.ts, graph.service.ts}`.
  - `relations.ts` = `K8sAnalysis.docs[]`만 받는 **순수 함수**(fs·클러스터 접근 없음, 단위 테스트 쉬움) — K1~K11 추출.
  - `graph-builder.ts` = 판·층·순서·요약·facets.
  - `graph.service.ts` = LRU 캐시(키 `graph.version`) + 드리프트·스캔 겹치기.
  - `DriftService`에는 **읽기 전용 접근자 `graphDrift(analysis)`만** 더한다(계산·임대 건드리지 않음). 기존 `fileDrift()`는 그대로.
- 그래프는 **파일을 다시 읽지 않는다**: `K8sSnapshotsService`의 분석 캐시(`docs[]`)를 쓰고, 캐시가 갱신될 때만 다시 만든다.
- 테스트에 꼭 넣을 것: ① 응답 JSON에 가림 대상 원문(env 값 `debug`/`info`, `example-password`, 셀렉터·어노테이션 값)이 없다 ② K-1 기대값(블록 33·유령 9·선 26·기본 켬 15) ③ 기존 mock 기대값(파일 상태 10건, 드리프트 변경 1·삭제 1·추가 1, 비교 불가 3종) 불변 ④ 같은 입력 두 번 → **같은 배열 순서** ⑤ 그래프 호출 중 쿠버네티스 클라이언트 호출 0회.
- mock 보강은 `mock-cluster-objects.ts`(클러스터 쪽)에 넣어야 스냅샷 파일과 자동으로 같아진다. 스냅샷 픽스처만 고치면 드리프트 건수가 깨진다.
- 화면 주소·탭 값은 디자인이 정한 대로(`?view=3d`, 선택 `res=`, 3D 필터 `g*`)이며, 서버는 `navigate`로 **탭 값과 인자만** 준다.

---

## 2026-09-20 · 5단계 구현 (K8s 구성 그래프 API)

### 1. 요청 내용

- PM: 계약 승인(16절 차이 11개 포함) → **5단계 구현**. 범위는 계약 전체: `GET /api/k8s-snapshots/:id/graph`, 관계 규칙 K1~K11, `plates`/`blocks`/`edges`/`notes`/`summary`, `DriftService.graphDrift()`(읽기 전용), 그래프 LRU 캐시, 잘림 상한, mock K-1 보강과 `large` 시나리오.
- 증명할 것: ① 기존 `/api/k8s-snapshots/**`·`/api/aws-snapshots/**`·SSE·mock 그룹 키 불변 ② mock 보강은 클러스터 객체와 스냅샷 **양쪽 동시** 적용으로 기존 드리프트 건수(3건) 불변 ③ 응답에 env·command/args·어노테이션·레이블·셀렉터 원문·ConfigMap/Secret 내용·이미지 문자열 없음.
- 성능: mock `large`로 p95 측정(AC-3D20 목표 1초), 수치를 보고서에.
- 제약: 사용자가 :3000·:3001을 쓰는 중 → 검증 서버는 **:3041**, 자기 PID만 종료. `apps/web`은 건드리지 않음(publisher 작업 중).
- 작업 중 코스 수정(publisher): 드리프트 `fieldCount`, 표식 사유 `text`, `evidence` 문구(값 금지), `ghost.reason` **5종 고정** 확인 → 계약·구현 일치를 확인하고 `markers.scan`에 `level`·`count`를 더했다.

### 2. 참고한 문서·코드

- `docs/api/snapshot-3d.md`(4단계에 쓴 계약 전체), `docs/api/k8s-snapshot.md`(5·6·10·11·14절), `docs/api/common.md`
- `docs/design/snapshot-3d.md`(4.1~4.8 판·층·블록·유령·선·표식, 8절 관계 표, 10.4 이동 규칙, 14절 필요한 값), `apps/web/src/components/ui/viz/viz.ts`(publisher 컴포넌트가 읽는 필드 이름 확인 — **읽기만** 했다)
- 코드: `k8s-analyzer.ts`(`docs[]`·`files[]`·`fileFindings`), `k8s-snapshots.service.ts`(분석 캐시·envelope·시나리오), `drift/drift.service.ts`(`badge`·`fileDrift`·`ability`), `drift/mock-cluster-objects.ts`, `k8s-mock-fixtures.ts`, `cluster/mock/mock-world.ts`

### 3. 작업 내용

1. **그래프 모듈 신설** `apps/api/src/k8s-snapshots/graph/`
   - `graph-types.ts`: 판·블록·선·표식·요약·facets 타입, 층 정의(`LAYERS`), 규칙 표(`RULES` K1~K11), 유령 사유 문구 5종, 표시 문구.
   - `relations.ts`: **순수 함수** `extractRelations(docs, enabled?)`. 파일·클러스터 접근 없이 문서 객체만 읽어 K1~K11을 뽑는다. 같은 (rule, from, to)는 선 1개로 합쳐 근거를 쌓고, 대상이 없으면 유령을 만들고, 셀렉터 없음·대상 없음·PVC 템플릿 미매칭은 표시 문구로 돌려준다.
   - `graph-builder.ts`: 판 구성(네임스페이스·클러스터 범위·해석 실패·유령), 블록 만들기(문서마다 1개, 여러 문서·중복 정의 id 규칙), 종류별 `summary` 화이트리스트, 결정적 정렬(판 → 층 → 종류 → 이름 → 문서), 차수 계산, 잘림 상한, `graph.version`(경로+파일 version sha256), 정보 문구.
   - `graph.service.ts`: LRU 캐시(키 = 스냅샷 id + 켠 규칙, 유효성 = 파일 지문)와 **응답 시점 겹쳐 보기**(드리프트·스캔·"추가됨" 유령·판 집계·요약·facets·groups).
2. **드리프트 읽기 전용 접근자** `DriftService.graphDrift(a)`: 배지·계산 가능 여부·`resourceKey → {change, fieldCount, hidden, reason}` 맵·"추가됨" 목록. 계산·임대·이벤트 부작용 없음. 기존 `fileDrift()`·`view()`·`request()`는 그대로.
3. **분석기 보강**: `parseYamlDocs`가 문서 시작 줄(`lines[]`)도 주고 `K8sFileFact.docLines[]`에 보관 → 블록 `file.line`과 여러 문서 파일의 이동 줄(디자인 10.4 요청).
4. **엔드포인트**: `GET /api/k8s-snapshots/:id/graph`(+ `K8sGraphQueryDto`: `rules`·`drift`). `:id/drift` 앞, catch-all 뒤에 두어 기존 라우팅을 건드리지 않았다.
5. **mock 보강(계약 12.2·12.3)** — 클러스터 객체와 스냅샷 **양쪽에 동시**:
   - `mock-cluster-objects.ts`에 `ENV_FROM_CONFIGMAP`(prod/api → `api-config`)과 `VOLUMES`(data/postgres → ConfigMap `postgres-config`, monitoring/grafana → PVC `grafana`)를 더했다. 예시 스냅샷이 같은 생성기에서 나오므로 양쪽이 같아 **드리프트 건수가 바뀌지 않는다**.
   - K-9(staging)에 관계 예외 3종(없는 ConfigMap 참조·대상 없는 Service 셀렉터·셀렉터 없는 Service), K-7에 문서 2개짜리 ConfigMap 파일.
   - 대규모 시나리오 `large`: 판 하나 50개 구성표대로 20판(1,000개)·64판(3,200개) 스냅샷 2개. **고를 때만 만든다**(부팅·기본 목록에 영향 없음). 클러스터 ID가 달라(`bench-eks`) 드리프트를 계산하지 않는다.
6. **설정**: `K8S_GRAPH_CACHE_SIZE`(8)·`K8S_GRAPH_GROUP_THRESHOLD`(3000)·`K8S_GRAPH_MAX_BLOCKS`(20000)·`K8S_GRAPH_MAX_EDGES`(40000)를 env 검증과 `.env.example`에 추가.
7. **테스트**: `graph/graph.http.spec.ts`(16개, AC별), `graph/relations.spec.ts`(6개, 순수 함수·잘림). 기존 스펙에는 provider·생성자 인자 한 줄씩만 더했다.
8. **계약 갱신**: 구현하며 달라진 7가지를 `docs/api/snapshot-3d.md` 19절 변경 이력에 적고 본문(4.2·4.5·5.1·10.1·10.2·12.2)을 고쳤다. `common.md` 8절에도 구현 줄을 더했다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/k8s-snapshots/graph/graph-types.ts` | 추가 | 그래프 타입·층·규칙 표·유령/표시 문구 |
| `apps/api/src/k8s-snapshots/graph/relations.ts` | 추가 | K1~K11 관계 추출 (순수 함수) |
| `apps/api/src/k8s-snapshots/graph/graph-builder.ts` | 추가 | 판·블록·선·순서·요약·facets·groups·잘림 |
| `apps/api/src/k8s-snapshots/graph/graph.service.ts` | 추가 | LRU 캐시 + 드리프트·스캔 겹쳐 보기 |
| `apps/api/src/k8s-snapshots/graph/graph.http.spec.ts` | 추가 | HTTP 테스트 16개 |
| `apps/api/src/k8s-snapshots/graph/relations.spec.ts` | 추가 | 순수 함수·잘림 테스트 6개 |
| `apps/api/src/k8s-snapshots/drift/drift.service.ts` | 수정 | `graphDrift()` 추가 (기존 메서드 불변) |
| `apps/api/src/k8s-snapshots/drift/mock-cluster-objects.ts` | 수정 | K-1 보강(envFrom ConfigMap, ConfigMap·PVC 볼륨) |
| `apps/api/src/k8s-snapshots/k8s-mock-fixtures.ts` | 수정 | K-9 예외 3종, K-7 여러 문서 파일, `large` 트리 생성기 |
| `apps/api/src/k8s-snapshots/k8s-analyzer.ts` | 수정 | `parseYamlDocs().lines`, `K8sFileFact.docLines` |
| `apps/api/src/k8s-snapshots/k8s-snapshots.service.ts` | 수정 | `graph()`, `K8sGraphService` 주입, `large` 지연 생성, 캐시 비우기 |
| `apps/api/src/k8s-snapshots/k8s-snapshots.controller.ts` | 수정 | `GET :id/graph` |
| `apps/api/src/k8s-snapshots/dto.ts` | 수정 | `K8sGraphQueryDto` |
| `apps/api/src/k8s-snapshots/k8s-snapshots.module.ts` | 수정 | provider 추가 |
| `apps/api/src/k8s-snapshots/k8s.constants.ts` | 수정 | mock 시나리오 `large` + 옵션 문구 |
| `apps/api/src/config/env.validation.ts` | 수정 | `K8S_GRAPH_*` 4개 |
| `apps/api/src/k8s-snapshots/k8s-snapshots.http.spec.ts`, `k8s-snapshots.live.spec.ts` | 수정 | 새 provider·생성자 인자 |
| `.env.example` | 수정 | `K8S_GRAPH_*` 4개 |
| `docs/api/snapshot-3d.md` | 수정 | 구현 반영 + 19절 변경 이력 |
| `docs/api/common.md` | 수정 | 8절 변경 이력 |
| `docs/reports/snapshot-3d/backend.md` | 수정 | 이 섹션 |

### 5. 주요 결정과 이유

| 결정 | 대안 | 이유 |
|---|---|---|
| 그래프는 **분석 캐시의 `docs[]`** 만 읽는다 | 파일을 다시 읽고 파싱 | p95 목표와 AC-3D13(추가 I/O 없음). 결과 p95 45 ms |
| 캐시 키 = (스냅샷 id + 켠 규칙), 유효성 = 파일 지문 | 시간 기반 TTL | 파일이 바뀌면 즉시 무효, 안 바뀌면 계속 재사용 |
| 드리프트는 **응답 시점**에 얹는다 | 캐시에 포함 | 드리프트만 바뀔 때 `graph.version`이 그대로라 화면이 "말없이 갱신"할 수 있다(3D-D 9.8) |
| `graphDrift()`를 DriftService에 둔다 | 그래프가 entries를 직접 읽음 | 드리프트 내부 상태(임대·보관)를 한 곳에 유지. 읽기 전용이라 부작용 없음 |
| 중복 정의·네임스페이스 없음 문서는 블록만, 관계 없음 | 관계도 뽑기 | 분석기가 이미 `docs[]`에서 빼고 드리프트도 `skipped`. 한 규칙으로 통일(계약 5.1 수정) |
| `large` 트리 지연 생성 | 부팅 때 미리 생성 | 3,200개를 항상 만들면 모든 mock 부팅·테스트가 느려진다 |
| `large`의 클러스터 ID를 다르게 | 대시보드 클러스터와 같게 | 자동 드리프트 대상이 바뀌어 기본 예시가 흔들리고 1,000개를 반복 비교하게 된다 |
| `markers.scan`에 `level`·`count` 추가 | 프론트가 계산 | publisher `BlockMarkers`가 그 모양을 받는다. "서버가 판단" 원칙과도 맞는다 |
| 응답 크기 2.0 MB를 그대로 둠 | 필드 축약·압축 | 로컬 전용·p95 45 ms. 줄여야 하면 `rules` 쿼리가 이미 있다(측정값을 계약 10.2에 기록) |

### 6. 검증 결과

| 명령·항목 | 결과 | 비고 |
|---|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 통과 | |
| `npm run lint --prefix apps/api` | 통과 (오류 0·경고 0) | |
| `npm test --prefix apps/api` | **41 suites / 398 passed, 1 skipped** | 기존 396 + 그래프 22. 기존 드리프트·파일 상태 기대값 그대로 |
| `npm run test:e2e --prefix apps/api` | 통과 (1/1) | |
| curl :3041 K-1 그래프 | 판 5 · 블록 33 · 유령 9 · 선 27(기본 15) · 드리프트 표식 3 · 54 KB | 계약 12.2 기대값과 일치 |
| curl 드리프트 건수 | `changed 1 · deleted 1 · added 1` | mock 보강 뒤에도 그대로(AC-K44) |
| curl `?drift=off` | 블록 32(추가됨 유령 없음)·표식 0·배지 유지 | |
| curl `?rules=K1,K2` | 선 6, 다른 규칙 `excluded: true`, Secret 유령 사라짐 | |
| curl 오류 | `rules=K99` → 400, 없는 ID → 404, `not-configured` → 503 | |
| curl 진행 중 스냅샷 | `state: pending_export`, 블록 0, 사유 문구 | |
| curl `cluster-disconnected` | `usable:false`·`CLUSTER_NOT_CONNECTED`·계산 버튼 비활성, 구성도는 그대로 | |
| **성능(AC-3D20)** mock `large` 50회 | **1,000 리소스: p50 25 ms · p95 45 ms**(첫 호출 63 ms) / **3,200 리소스: p50 62 ms · p95 67 ms**(첫 139 ms) | 목표 1초 대비 20배 이상 여유. 응답 2.0 MB / 6.3 MB |
| 비밀값 비노출 | `example-password`·env 값·`matchLabels`·`dkr.ecr`·`postgresql.conf`·어노테이션 키가 응답에 없음 | AC-3D14 |
| 기존 계약 불변 | 목록 10건·드리프트 문구·상세 필드·mock 시나리오 목록을 테스트로 고정 | AC-K19·AC-3D23 |
| 사용자 프로세스 | :3000·:3001 유지, 내 검증 서버(:3041)만 PID로 종료 후 :3001 health 200 확인 | |

### 7. 남은 이슈·한계

1. **응답 크기**: 기준 규모 2.0 MB(계약 초안 추정 0.6 MB). 로컬에서는 문제 없지만 프론트가 느리면 ① `rules=K1..K7`로 기본 켬만 받기 ② 응답 압축(현재 SSE 때문에 꺼져 있다) ③ `evidenceItems` 생략 모드 중에서 고르면 된다.
2. **판 표식**: Namespace 리소스의 드리프트·스캔은 `plates[].markers`로 내려가지만 디자인에 그릴 자리가 아직 없다(designer 요청 유지). mock에서는 Namespace가 항상 `same`이라 화면에는 나타나지 않는다.
3. **셀렉터 `matchExpressions`**: K8·K10은 `matchLabels`만 본다. 표현식만 쓰는 PDB·NetworkPolicy는 "대상 없음"으로 보인다.
4. **스냅샷에 Secret 문서가 있는 경우**(mock K-4 `legacy-creds`): 계약대로 K6은 항상 유령을 만들고, 그 Secret 블록 자체는 스캔 오류 표식이 붙은 일반 블록으로 남는다(선 연결 없음).
5. **`large` 전환 비용**: 4,200개 파일을 처음 분석·스캔할 때 몇 초 걸린다(그 뒤로는 캐시). 기본 시나리오에는 영향 없다.
6. 3,200개도 상한(20,000블록) 안이라 실제 잘림은 나지 않는다. 잘림 경로는 단위 테스트(`maxBlocks: 5`)로만 확인했다.

### 8. 다른 담당 요청

- **frontend 요청**: ① 3D 탭 데이터는 `GET …/graph` **한 번**(드리프트 배지·표식·계산 시각 포함). 필드 차이를 볼 때만 `GET …/drift`. ② 필터·검색·선택은 재조회 없이 응답 안에서(`rules`는 payload 절감용, 기본 전체). ③ `blocks[]` 순서 = 배치 순서, 좌표 없음. ④ "구성이 바뀌었습니다"는 `graph.version` 비교. ⑤ 임대는 기존 `POST …/drift`에 `{"force": false}` 60초. ⑥ 응답 2.0 MB(1,000 리소스) — 느리면 `rules=K1,K2,K3,K4,K5,K6,K7`. ⑦ 필드 매핑: 드리프트는 `markers.drift.change`(publisher 컴포넌트의 `kind`), 스캔은 `markers.scan.level`·`count`를 그대로.
- **designer 요청(유지)**: 네임스페이스 **판 표식** 자리, `notes[].custom_resource` 표시 자리.
- **DBA 요청 없음**(스키마 변경 없음, 메모리 캐시만).

### 9. 다음 담당이 알아야 할 점

- 관계 규칙은 `graph/relations.ts`만 보면 된다(순수 함수, `relations.spec.ts`). 판·층·순서는 `graph-builder.ts`, 겹쳐 보기·캐시는 `graph.service.ts`.
- **mock 규칙**: 클러스터 객체(`mock-cluster-objects.ts`)를 고치면 스냅샷도 같이 바뀌어 드리프트 건수가 유지된다. 스냅샷 픽스처만 고치면 건수가 깨진다(`k8s-snapshots.http.spec.ts`가 잡는다).
- 그래프 캐시는 시나리오 전환·`POST /api/mock/reset`에서 비우고, 파일 저장 뒤에는 지문이 바뀌어 자동으로 다시 만들어진다.
- 성능을 다시 재려면 mock으로 띄우고 `PUT /api/mock/scenarios/k8s-snapshots`에 `{"scenario":"large"}`를 보낸 뒤 `20260920-030000`(1,000)·`20260920-040000`(3,200)을 호출한다.
- `K8sFileFact.docLines`는 그래프 전용이다(상세 `files[]` 응답에는 넣지 않았다 — 기존 계약 불변).

---

## 2026-09-20 15:00 · mock 스냅샷에 `Job` 1개 추가 (3D 블록 모양 `chamfer` 회귀 점검용)

### 1. 요청 내용

- PM 요청(작은 후속 작업): `apps/api/src/k8s-snapshots/` mock 데이터에 **소유자 없는(= 내보내기 대상인) `Job` 1개**를 적절한 네임스페이스에 추가.
- 이유: 3D 블록 모양이 종류별로 갈렸는데(`docs/design/snapshot-3d.md` 4.11), mock 스냅샷 10개와 `large` 어디에도 `Job`이 없어 `chamfer` 모양을 실제 장면에서 회귀 점검할 수 없다(frontend 보고 2026-09-20 (8)).
- 조건: CLI 정리 규칙과 일관되게(`deploy/k8s-snapshot/lib/kinds.mjs`·`rules.mjs`의 자동 생성·소유자 규칙 — CronJob이 만든 Job은 제외 대상이니 **독립 Job**이어야 한다). 기존 기대값(블록 33·드리프트 3건·목록 리소스 수·기존 테스트)이 바뀌면 테스트와 계약 문서를 함께 갱신. **드리프트 건수는 3건 유지**.
- 검증: api lint·tsc·test·e2e + curl(포트 3041, 자기 PID만 종료). `apps/web` 금지, 사용자의 :3000·:3001 프로세스 건드리지 않기.

### 2. 참고한 문서·코드

- `docs/design/snapshot-3d.md` 4.11(블록 모양 8종), 4.11.1 `chamfer` 치수, **4.11.2 모양↔종류 표**(`Job` → `chamfer`, `Deployment` → `stack`, `CronJob` → `roof`), 4.11.6(`stack` ↔ `chamfer`가 가장 가까운 쌍 → "한 판에 Deployment와 Job이 함께 있는 장면" 스크린샷 요구)
- `docs/reports/snapshot-3d/frontend.md` 2026-09-20 (8) — 회귀 점검 장면 없음 보고
- `docs/api/snapshot-3d.md` 2.2(응답 예시), 3절(`plates[]` 타입), 10.1(`summary` 확인식), **12.2 K-1 기대값**, 19절 변경 이력
- `docs/api/k8s-snapshot.md` 3.5(종류 목록·tier), 3.7(제외 규칙), 10.2(비교 불가 사유), **14.3 mock 클러스터 값·예시 드리프트**, 20절 변경 이력
- `deploy/k8s-snapshot/lib/kinds.mjs`(`KIND_CATALOG`의 `jobs` = tier `optional`, `ALWAYS_EXCLUDED_KINDS`), `lib/rules.mjs`(`isAlwaysExcluded` = `ownerReferences` 있으면 제외, `isAutoCreated`), `lib/layout.mjs`(`classifyPath`)
- 코드: `k8s-mock-fixtures.ts`, `drift/comparable-kinds.ts`, `graph/graph-builder.ts`, `graph/relations.ts`(`WORKLOAD_KINDS`)

### 3. 작업 내용

1. **배치 위치 결정 — `extraObjects()`**. mock 예시 파일은 두 갈래로 만들어진다: ① cluster mock 인벤토리 → `COMPARABLE_KINDS`만 정리해서 YAML로(드리프트 대상) ② `extraObjects()` = 대시보드 RBAC 밖 종류를 손으로 쓴 파일(ConfigMap 2·NetworkPolicy 1·CronJob 1). `Job`은 `COMPARABLE_KINDS`(= 대시보드 RBAC)에 없으므로 ②에 넣었다. cluster mock 인벤토리에는 Job 개념이 없어 ①로는 만들 수 없다.
2. **`batch/jobs/report-backfill.yaml` 추가** (모든 예시 스냅샷 공통 `base`).
   - `ownerReferences` **없음** → CLI `isAlwaysExcluded`에 걸리지 않는 독립 Job(= 내보내기 대상). CronJob이 만든 Job은 `ownerReferences[kind=CronJob]`이 있어 제외된다.
   - `status`·`metadata.uid`·컨트롤러 생성 `spec.selector`(`batch.kubernetes.io/controller-uid`)·자동 라벨 없음 → `cleanObject`를 통과한 모양 그대로(사람이 쓴 매니페스트 모양). `findRuntimeFields`가 잡을 필드 없음 → 파일 상태 불변.
   - 네임스페이스는 **`batch`**를 골랐다: 이미 `Deployment report-generator`(`stack`)와 `CronJob nightly-report`(`roof`)가 있어 **한 판에 `stack`·`roof`·`chamfer`가 모인다**(디자인 4.11.6이 요구한 회귀 장면).
   - 비밀값·리터럴 없음(스캔 0건 유지). `args`·이미지는 계약상 응답에 나가지 않는 필드라 AC-3D14(값 비노출)에 영향 없음.
3. **예시 `metadata.json` 보정**: `jobs`는 `KIND_CATALOG`에서 tier `optional`이라, 기본 종류만 담던 `metadata()`의 `kinds` 맵과 `scope.kinds.optional`에 `jobs`를 넣었다(`OPTIONAL_MOCK_KINDS`). 이렇게 해야 상세 응답의 `current` = `atExport`(30 = 30)가 맞고 `scope.optionalKinds: ["jobs"]`로 "선택 종류를 켠 스냅샷" 경로도 실제로 한 번 돈다.
4. **기대값 변화 확인 → 테스트·계약 갱신** (아래 5·6절).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/k8s-snapshots/k8s-mock-fixtures.ts` | 수정 | `extraObjects()`에 `batch/jobs/report-backfill.yaml`(독립 Job) 추가, `OPTIONAL_MOCK_KINDS = {jobs}` 도입 → `metadata()`의 `kinds` 맵·`scope.kinds.optional`에 반영 |
| `apps/api/src/k8s-snapshots/graph/graph.http.spec.ts` | 수정 | AC-3D24 `summary` 기대값(documents 30·resourceBlocks 25·blocks 34·edges 28), `Job` 블록 존재·층·판 단언 추가, AC-3D25 `K9: 9`, AC-3D27 `uncomparable: 5`, 테스트 이름 숫자 갱신 |
| `apps/api/src/k8s-snapshots/k8s-snapshots.http.spec.ts` | 수정 | 드리프트 `uncomparable` 종류 목록에 `Job` 추가 |
| `docs/api/snapshot-3d.md` | 수정 | 2.2 `summary`·`facets.drift`·`plates[ns:batch]` 예시, 12.2 K-1 판 구성표·보강 설명·K9/전체 선 수·`summary` 줄·드리프트 표식 줄, 3절 `byLayer` 타입 주석, 19절 변경 이력 |
| `docs/api/k8s-snapshot.md` | 수정 | 14.3 비교 불가 파일 목록(+`batch/jobs/report-backfill.yaml`)과 설명 불릿, 10.9 `uncomparable` 예시에 `Job` 행, 20절 변경 이력 |
| `docs/reports/snapshot-3d/backend.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유

| 결정 | 대안 | 이유 |
|---|---|---|
| `extraObjects()`(모든 예시 공통)에 넣기 | 예시 1(`applyLatestChanges`)에만 넣기 | 공통에 넣으면 ConfigMap·CronJob과 같은 취급이라 픽스처가 단순하고, 어느 예시를 열어도 `chamfer`를 볼 수 있다. 예시 1에만 넣으면 "예시 1과 예시 2의 차이 = 드리프트"라는 픽스처 전제가 흐려진다 |
| 네임스페이스 `batch` | `prod`(가장 큰 판) | 디자인 4.11.6이 요구한 회귀 장면은 "한 판에 `Deployment`와 `Job`"이다. `batch`는 `Deployment`+`CronJob`이 이미 있어 `stack`/`roof`/`chamfer` 세 모양을 한 판에서 비교할 수 있다. `prod`는 블록 16개라 오히려 비교가 어렵다 |
| 클러스터 쪽에는 넣지 않음 | 지시대로 `mock-cluster-objects.ts`에도 같은 객체 추가 | `Job`은 대시보드 RBAC(`COMPARABLE_KINDS`)에 없어 **애초에 비교 대상이 아니다**(`NOT_IN_RBAC`). 클러스터 쪽에 넣어도 informer가 없어 비교되지 않고, RBAC를 늘리는 것은 Q3 결정 위반이다. 결과적으로 **드리프트 건수 3건은 그대로 유지**된다(요청 목표 달성) |
| `serviceAccountName` 지정 없음 | `report-runner` 같은 전용 SA 지정 | 전용 SA를 쓰면 K9가 **새 유령 블록**을 만들어 `ghosts` 9 → 10, `blocks` 35가 된다. 지정하지 않으면 기존 `batch/default` 유령을 공유해 유령 수가 그대로다(선만 1개 늘어난다) |
| ConfigMap/Secret 참조 없음 | `envFrom`으로 K5 예시 추가 | 이번 목적은 모양 회귀뿐이다. 참조를 더하면 K5·K6 기대값까지 흔들려 프론트 회귀 범위가 넓어진다 |
| 시나리오 `large`는 건드리지 않음 | `benchNamespace()`에 Job 추가 | `large`는 "20 × 50 = 1,000", "64 × 50 = 3,200"과 선 1,960/2,580이 성능 AC(AC-3D19·20·22)의 고정 기대값이다. Job 하나를 넣으면 판당 51개가 되어 세 숫자가 전부 바뀐다. 모양 회귀는 기본 시나리오에서 하면 충분하다 |
| `metadata.json`에 `jobs`를 optional로 명시 | `byKind`만 늘리고 `kinds` 맵은 그대로 두기 | 그대로 두면 상세 화면의 종류별 표에 `jobs`가 `atExport: 0`(내보내지 않은 종류)으로 보여 실제 파일과 모순된다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 통과 (오류 0) | 사용자의 :3001 `start:dev`가 깨지지 않게 먼저 확인 |
| `npm run lint --prefix apps/api` | 통과 | `--fix`가 새 코드 줄바꿈만 정리 |
| `npm run lint:check --prefix apps/api` | 통과 (경고 0) | |
| `npm test --prefix apps/api` | **41 suites / 398 passed · 1 skipped** | 갱신 전에는 4건 실패(아래 기대값 표) → 갱신 후 전부 통과 |
| `npm run test:e2e --prefix apps/api` | 통과 (1/1) | |
| curl `GET /api/k8s-snapshots/20260919-061000/graph` (:3041) | **`batch/Job/batch/report-backfill` 블록 확인** — `kind: "Job"`, `layer: "workload"`, `plateId: "ns:batch"`, `blockType: "resource"`, `markers.drift.change: "uncomparable"`/`NOT_IN_RBAC`, `degree {in:0,out:1}`(K9) | 모양 `chamfer` 매핑에 필요한 `kind`가 정상 전달됨 |
| curl 같은 응답의 `drift.badge.counts` | `changed 1 · deleted 1 · added 1` (**3건 유지**), `uncomparable 5` | 요청 목표 충족 |
| curl `GET /api/k8s-snapshots/20260919-061000` | `resources.current.total 30` = `atExport.total 30`, `scope.optionalKinds: ["jobs"]`, `kindCount 18` | 메타데이터 정합 |
| 프로세스 정리 | 검증 서버 **PID 29172(:3041)만** `Stop-Process -Id`로 종료, 포트 해제 확인. :3000·:3001은 손대지 않음 | 이미지 이름 일괄 종료 안 함 |

검증 서버는 `nest build`가 `apps/api/dist`를 지우는 것을 피하려고 **스크래치 폴더로 따로 컴파일**해서(`tsc -p tsconfig.build.json --outDir <scratch>/dist`, `NODE_PATH`로 node_modules 연결) 띄웠다. 사용자의 :3001 `start:dev`가 쓰는 `dist`를 건드리지 않기 위해서다.

**바뀐 기대값 (K-1 `20260919-061000`)**

| 값 | 전 | 후 |
|---|---|---|
| `summary.documents` | 29 | **30** |
| `summary.resourceBlocks` | 24 | **25** |
| `summary.blocks` | 33 | **34** (`drift=off`면 33) |
| `summary.edges` | 27 | **28** (K9 8 → **9**) |
| `facets.drift.uncomparable` | 4 | **5** (ConfigMap 2·NetworkPolicy 1·CronJob 1·**Job 1**) |
| `plates[ns:batch].resourceCount` | 3 | **4** (`byLayer.workload` 2 → 3) |
| 스냅샷별 리소스 수 | n | **n + 1** (모든 예시. prod 폴더만 있는 `20260919-064500`은 제외) |
| **그대로** | `ghosts` 9 · `edgesDefaultOn` 15 · `plates` 5 · `driftMarkers` 3 · `scanMarkers` 0 · 파일 상태 10건 · 시나리오 `large` | |

### 7. 남은 이슈·한계

1. **`plates[].byLayer`가 드리프트 "추가됨" 유령을 세지 않는다 (기존 버그, 이번 작업과 무관)**. `graph-builder.ts`의 판 집계 루프가 드리프트 유령을 `blocks[]`에 붙이기 전에 돌아서, `ns:prod`가 `byLayer.workload 3`을 주지만 실제 그 판·층의 블록은 4개다(`ghost:apps/Deployment/prod/payments` 누락). `resourceCount`/`ghostCount`는 정상이다. 프론트가 `byLayer`로 층 칸 수를 예약하면 1칸 모자랄 수 있다. **고치지 않았다** — frontend가 작업 중이라 기대값을 더 흔들지 않기 위해서이고, 고치면 `ns:prod.byLayer.workload`가 3 → 4로 바뀐다. PM 판단 필요.
2. **시나리오 `large`에는 여전히 `Job`이 없다**(위 5절 이유). 대규모 장면에서 `chamfer`를 봐야 하면 별도 작업으로 구성표(판당 50개)를 51개로 늘리고 AC-3D19·20·22 기대값 3개를 함께 고쳐야 한다.
3. `docs/api/snapshot-3d.md` 2.2의 `plates[]` 예시 중 **`ns:batch` 행만** 실제 응답 값으로 맞췄다. 나머지 판(`ns:data`·`ns:monitoring`·`ns:prod`)의 `byLayer` 예시는 1번 이슈와 얽혀 있어 손대지 않았다(1번을 정리할 때 함께 맞추는 게 맞다).
4. 이번 작업으로 `jobs`(tier `optional`) 경로가 mock에서 처음 실제로 돈다. 실제 CLI로 내보낸 스냅샷에서 선택 종류를 켜는 경로는 여전히 미검증이다(mock 한정).

### 8. 다른 담당 요청

- **frontend 요청**:
  1. **K-1 기대값이 바뀌었다** — 하드코딩한 스냅샷 값이 있으면 위 표대로 갱신(블록 33 → **34**, 선 27 → **28**, `drift=off` 32 → **33**).
  2. `chamfer` 회귀 스크린샷은 **`20260919-061000`의 `batch` 판**에서 찍으면 된다. 한 판에 `Deployment report-generator`(`stack`) · `CronJob nightly-report`(`roof`) · `Job report-backfill`(`chamfer`) · `PVC scratch`(`cylinder`)가 같이 있다(디자인 4.11.6이 요구한 `stack` ↔ `chamfer` 비교 장면).
  3. 블록 id는 `batch/Job/batch/report-backfill`(= `<apiGroup>/<Kind>/<ns>/<name>`), `layer: "workload"`.
  4. `plates[].byLayer`는 7-1 이슈가 있으니 **층 칸 수 계산에 쓰지 말고** `blocks[]`에서 직접 세라(0인 층은 키 자체가 없다 — 타입을 `Partial<Record<…>>`로 계약에 명시했다).
- **designer 요청 없음**(모양 매핑은 4.11.2 그대로, 새 종류 없음).
- **DBA 요청 없음**(스키마 변경 없음).
- **PM 판단 요청**: 7-1 `byLayer` 버그를 지금 고칠지(프론트 기대값 1개 추가 변동) 다음 작업으로 미룰지.

### 9. 다음 담당이 알아야 할 점

- mock 예시 리소스를 더 넣을 자리는 두 곳이다. **대시보드 RBAC 안 종류**는 `mock-cluster-objects.ts`(클러스터 쪽)에 넣어야 스냅샷과 클러스터가 함께 바뀌어 드리프트 건수가 유지되고, **RBAC 밖 종류**(ConfigMap·NetworkPolicy·CronJob·Job 등)는 `k8s-mock-fixtures.ts`의 `extraObjects()`에 넣으면 자동으로 `uncomparable NOT_IN_RBAC`가 되어 건수에 영향이 없다.
- `extraObjects()`에 넣는 객체는 **이미 정리된 모양**이어야 한다(`status`·`ownerReferences`·`metadata.uid` 금지). `ownerReferences`를 넣으면 CLI 규칙상 "내보내지 않는 리소스"가 되어 픽스처가 현실과 어긋난다.
- tier `optional`·`custom` 종류를 더 넣으면 `k8s-mock-fixtures.ts`의 `OPTIONAL_MOCK_KINDS`에도 추가해야 `metadata.json`의 `kinds`·`scope.kinds.optional`이 맞는다(안 맞으면 상세 화면에서 `atExport: 0`으로 보인다).
- 이 픽스처는 **모든 예시 스냅샷의 공통 base**다. 하나를 고치면 목록 11건 전부의 리소스 수가 바뀐다는 점을 기억할 것.

---

## 2026-09-20 16:00 · `plates[].byLayer` 집계 결함 수정 (PM 판단: 지금 고친다)

### 1. 요청 내용

- PM 판단: 바로 위 섹션 7-1에서 보고한 **`plates[].byLayer`가 드리프트 "추가됨" 유령을 세지 않는 문제**를 지금 고쳐라. "화면에 보이는 수가 실제 블록 수와 다른 건 데이터 결함이다."
- 함께 할 것: ① `ns:prod.byLayer.workload` 3 → 4처럼 바뀌는 기대값을 테스트·계약 문서(`docs/api/snapshot-3d.md` 12.2 K-1 기대값·해당 절)에 반영 ② 다른 집계(`resourceCount`·`ghostCount`·`summary`)와 **서로 모순되지 않는지 테스트로 고정** ③ `drift=off`일 때도 맞는지 확인 ④ 확정 수치를 대화 보고에 정확히 적기(판별 `byLayer` 포함).
- 검증: api lint·tsc·test·e2e, curl(:3041, 자기 PID만 종료). 사용자의 :3000·:3001 종료·재시작 금지, `apps/web` 금지.

### 2. 참고한 문서·코드

- `docs/api/snapshot-3d.md` 2.2(`plates[]` 응답 예시), **3절 `Plate` 타입**, 10.1(`summary` 확인식), 12.2 K-1 기대값, 19절 변경 이력
- 코드: `graph/graph.service.ts`(겹쳐 보기 적용부 `buildWithDrift`), `graph/graph-builder.ts`(판 집계 원본 루프 690~697), `graph/graph-types.ts`(`Plate.byLayer`)
- 앞 섹션(2026-09-20 15:00)의 7-1 이슈 기록

### 3. 작업 내용 (원인과 수정)

**원인** — 판 집계는 두 번 일어난다.

1. `graph-builder.ts`가 스냅샷 파일 기반 블록(유령 포함)으로 `resourceCount`·`ghostCount`·`byLayer`를 센다. 이 시점에는 **드리프트 "추가됨" 유령이 아직 없다**(드리프트는 그래프 뼈대 위에 나중에 얹는다).
2. `graph.service.ts`가 겹쳐 보기를 얹으며 판을 새로 만든다. 여기서 `resourceCount: 0`·`ghostCount: 0`으로 **초기화한 뒤 다시 세지만**, `byLayer`는 `{ ...p.byLayer }`로 **1단계 값을 그대로 복사**했다. 그 다음 `dv.added`로 "추가됨" 유령 블록을 `blocks[]`에 밀어 넣으므로, 유령 하나가 `byLayer`에서만 빠졌다.

**수정** (`graph.service.ts` 2곳, 2줄)

- 판 복사에서 `byLayer: { ...p.byLayer }` → **`byLayer: {}`** (resourceCount·ghostCount와 같은 방식으로 초기화)
- 다시 세는 루프(모든 블록 순회, "추가됨" 유령이 이미 들어온 뒤에 돈다)에 **`p.byLayer[b.layer] = (p.byLayer[b.layer] ?? 0) + 1;`** 추가

이렇게 하면 세 값이 **한 루프·한 데이터 소스**에서 나오므로 서로 어긋날 수 없다. `drift=off`·`usable=false`(클러스터 미연결 등)에서는 "추가됨" 유령 자체가 만들어지지 않아 자동으로 줄어든 값이 나온다. 잘림(`maxBlocks`)·유령 판(`ghost-ns:*`)·`_cluster` 판도 같은 루프를 타므로 함께 맞는다.

**테스트로 고정한 불변식** (`graph.http.spec.ts`에 헬퍼 `expectPlateCountsConsistent(g)` 추가)

1. 판별 `resourceCount` = 그 판의 `blockType !== 'ghost'` 블록 수
2. 판별 `ghostCount` = 유령 블록 수
3. 판별 `byLayer` = `blocks[]`에서 층별로 직접 센 값과 **완전히 일치**(키 집합까지)
4. 판별 `byLayer` 합 = `resourceCount + ghostCount`
5. 모든 판의 합 = `summary.blocks` = `blocks[].length` (판에 안 붙은 블록이 없다)

AC-3D24(기본, `drift=on`)와 `drift=off` 테스트 양쪽에서 호출하고, K-1의 판별 실제 수치도 함께 고정했다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/k8s-snapshots/graph/graph.service.ts` | 수정 | 겹쳐 보기 판 복사에서 `byLayer` 초기화 + 블록 재집계 루프에서 `byLayer` 재계산(2줄, 주석 1줄) |
| `apps/api/src/k8s-snapshots/graph/graph.http.spec.ts` | 수정 | 헬퍼 `plate()`·`expectPlateCountsConsistent()` 추가, AC-3D24에 판별 `resourceCount`/`ghostCount`/`byLayer` 기대값 + 불변식 검사, `drift=off` 테스트에 `blocks 33`·`ghosts 8`·판 집계·`ns:prod` 기대값 추가 |
| `docs/api/snapshot-3d.md` | 수정 | 2.2 `plates[]` 예시 4판 실제 값으로 정정, 3절 `byLayer` 주석 + **불변식 문단 신설**, 12.2에 **판 집계 기대값 표**(`drift=on`/`off`) 신설, 19절 변경 이력 |
| `docs/reports/snapshot-3d/backend.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유

| 결정 | 대안 | 이유 |
|---|---|---|
| `graph.service.ts`에서 다시 세기 | `graph-builder.ts`에서 미리 "추가됨" 유령까지 세도록 순서 바꾸기 | 빌더는 **드리프트를 모르는 순수 단계**다(캐시 단위도 빌더 결과 = 드리프트 무관). 드리프트를 빌더로 끌어오면 캐시가 드리프트마다 갈라진다. 이미 `resourceCount`·`ghostCount`를 서비스에서 다시 세고 있으므로 `byLayer`만 같은 자리로 옮기는 게 최소 변경이다 |
| 빌더 쪽 `byLayer` 집계는 그대로 둠 | 빌더에서 아예 빼기 | 빌더 결과를 그대로 쓰는 경로(내부 테스트·잘림 계산)가 있고, 서비스가 덮어쓰므로 응답에는 영향이 없다. 지금 빼면 빌더 단위 테스트가 불필요하게 흔들린다 |
| 불변식을 **헬퍼 하나**로 만들어 두 테스트에서 호출 | 테스트마다 숫자만 하드코딩 | 숫자만 박으면 mock을 고칠 때마다 또 어긋난다. 불변식(합·키 일치)은 픽스처가 바뀌어도 항상 참이라 회귀를 계속 막는다. 숫자 기대값은 그 위에 얹었다 |
| `byLayer`는 "블록 수"(유령 포함)로 확정 | "리소스 수"(유령 제외)로 바꾸기 | 화면(3D-D 4.3)이 `byLayer`를 **층에 놓을 칸 수**로 쓴다. 유령도 자리를 차지하므로 블록 수가 맞다. 유령 제외 값이 필요하면 `resourceCount`가 이미 있다. 계약 3절에 이 뜻을 못박았다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 통과 (오류 0) | :3001 `start:dev`가 깨지지 않게 먼저 확인 |
| `npm run lint --prefix apps/api` / `lint:check` | 통과 (경고 0) | |
| `npm test --prefix apps/api` | **41 suites / 398 passed · 1 skipped** | k8s-snapshots 6 suites / 66건 포함 |
| `npm run test:e2e --prefix apps/api` | 통과 (1/1) | |
| curl `GET …/graph` (:3041) | 아래 확정 수치표대로. 응답의 `byLayer`를 `blocks[]`로 재계산해 **전 판 일치** 확인 | |
| curl `GET …/graph?drift=off` (:3041) | `blocks 33`·`ghosts 8`, `ns:prod` `ghostCount 4`·`workload 3`, 나머지 판 동일. 재계산 **전 판 일치** | PM 요청 ③ |
| 프로세스 정리 | 검증 서버 **PID 26912(:3041)만** `Stop-Process -Id`로 종료, 포트 해제 확인. 종료 뒤 :3001 `/api/health` 200 재확인 | :3000·:3001 무손상 |

**확정 수치 — K-1 `20260919-061000`** (`drift=on` 기본 / `drift=off`)

| 판 | `resourceCount` | `ghostCount` | `byLayer` |
|---|---|---|---|
| `ns:batch` | 4 | 1 | `{ storage 1, workload 3, aux 1 }` (양쪽 같음) |
| `ns:data` | 7 | 2 | `{ storage 5, workload 2, service 1, aux 1 }` (양쪽 같음) |
| `ns:default` | 0 | 0 | `{}` (양쪽 같음) |
| `ns:monitoring` | 3 | 1 | `{ storage 1, workload 1, service 1, aux 1 }` (양쪽 같음) |
| `ns:prod` | 11 | **5 / 4** | **`{ storage 2, workload 4, service 2, ingress 2, aux 6 }`** / `{ storage 2, workload 3, service 2, ingress 2, aux 6 }` |
| 합 | 25 | 9 / 8 | **34 / 33** = `summary.blocks` |

- 이번 수정으로 **실제로 값이 바뀐 곳은 `ns:prod.byLayer.workload` 3 → 4 하나뿐**이다(`drift=on`일 때). `drift=off` 값은 원래부터 맞았다.
- `summary`·`facets`·`resourceCount`·`ghostCount`·선 수·드리프트 건수는 **전혀 바뀌지 않았다**.

### 7. 남은 이슈·한계

1. `docs/api/snapshot-3d.md` 2.2의 `plates[]` 예시를 실제 응답 값으로 맞추면서, 앞 섹션에서 "손대지 않았다"고 적었던 `ns:data`·`ns:monitoring`·`ns:prod` 예시도 함께 정정했다(이제 계약 예시 = 실제 응답).
2. 시나리오 `large`에는 드리프트가 없어(다른 클러스터 ID) "추가됨" 유령 경로를 타지 않는다 — 이 수정의 영향이 없고, 불변식 테스트도 기본 시나리오에서만 돌린다.
3. 유령 판(`ghost-ns:*`)이 생기는 경우는 mock 픽스처에 없다(추가됨 리소스의 네임스페이스가 항상 스냅샷에 있다). 같은 루프를 타므로 논리상 맞지만 **실제 데이터로는 미검증**이다.

### 8. 다른 담당 요청

- **frontend 요청**: `plates[].byLayer`를 **그대로 써도 된다**(층 칸 수 = 유령 포함 블록 수). 앞 섹션 8-4에서 "쓰지 말고 `blocks[]`에서 세라"고 한 것은 **철회**한다. 확정 수치는 위 표 그대로이며, K-1에서 바뀐 값은 `ns:prod.byLayer.workload` **3 → 4**(`drift=off`면 3) 하나다.
- designer·DBA 요청 없음.

### 9. 다음 담당이 알아야 할 점

- 판 집계(`resourceCount`·`ghostCount`·`byLayer`)는 이제 **`graph.service.ts`의 한 루프**에서만 계산된다. 블록을 더 얹는 코드를 넣을 때는 **그 루프보다 앞**에서 `blocks.push()` 해야 한다(드리프트 "추가됨" 유령이 그렇게 한다).
- `graph-builder.ts`에도 같은 집계가 남아 있지만 서비스가 덮어쓴다. 빌더 결과를 직접 쓰는 새 코드를 만들면 "추가됨" 유령이 빠진 값을 보게 되니 주의.
- `expectPlateCountsConsistent()`(`graph.http.spec.ts`)를 새 시나리오 테스트에도 호출해 두면 같은 종류의 회귀를 자동으로 막는다.
