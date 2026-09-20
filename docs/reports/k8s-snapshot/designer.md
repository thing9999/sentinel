# k8s-snapshot · designer 작업 보고

## 2026-09-19 · 화면 설계 (스냅샷 메뉴 탭, k8s 목록·상세·드리프트)

### 1. 요청 내용
- PM 요청: `docs/specs/k8s-snapshot.md` 기반 디자인. Q1~Q4는 모두 권장안으로 확정(Q1 Secret 미열람 + `secret-refs.json`, Q2 드리프트는 메뉴 상태에 넣지 않음, Q3 RBAC 확대 없음 → "비교 불가", Q4 클러스터 ID 없음 → 드리프트 "알 수 없음").
- planner의 designer 요청: "스냅샷" 메뉴의 AWS/Kubernetes 탭, 파일 상태·드리프트 두 배지, 리소스 트리(네임스페이스 → 종류 → 리소스), 드리프트 화면(추가/삭제/변경 + 필드 diff, 비교 불가), `shell.md` 메뉴 라벨 변경.
- 조건: ASM 디자인 최대 재사용, 기존 `/snapshots` URL과 AWS 화면 호환, 코드 작성 금지.

### 2. 참고한 문서
- `docs/specs/k8s-snapshot.md` (전체, 1~9절)
- `docs/design/aws-snapshot-manager.md`, `docs/design/components.md`(1~13절), `docs/design/status.md`, `docs/design/shell.md`, `docs/design/tokens.json`
- 기존 UI 코드 확인: `apps/web/src/components/ui/layout/Tabs.tsx`(role=tablist 버튼 탭), `shell/SideNav.tsx`(`/snapshots` 라벨·count·statusLabel), `shell/DataSourceBadge.tsx`(`SCENARIO_GROUPS`), `table/DataTable.tsx`(`groupRow`, `expandable`, `hideBelow`), `layout/CommandLine.tsx`, 스냅샷 컴포넌트 목록
- `apps/web/src/app/snapshots/` 현재 경로(`page.tsx`, `[id]`, `trash`)

### 3. 작업 내용
1. **URL·탭 구조**(k8s-snapshot.md 2절): 기존 `/snapshots`, `/snapshots/[id]`, `/snapshots/trash` + 쿼리는 그대로 AWS. k8s는 `/snapshots/k8s`, `/snapshots/k8s/[id]`, `/snapshots/k8s/trash`. 탭 전환은 링크 이동(`LinkTabs`), 목록 두 곳에만 탭. 상세·휴지통은 브레드크럼(`AWS 스냅샷 ›` 그대로, `Kubernetes 스냅샷 ›` 신규).
2. **메뉴**: 라벨 `스냅샷`, 상태 = 양쪽 파일 상태 최악, 숫자 = 커밋 금지 합(서버 값), 드리프트 제외.
3. **목록(k8s 탭)**: 요약 띠에 `최신 드리프트` 칸 추가, 필터(파일·드리프트·클러스터·검색), 표 9열(파일 / 드리프트 / 스냅샷 / 클러스터 / 범위 / 리소스 / 현재 스캔 / 마지막 수정 / 동작, 합 1,160px), 드리프트 셀 6가지 모습(차이 있음·없음·알 수 없음·계산 안 함·지난 결과·계산 중·stale), CLI 안내(종료코드 0~4, 안내 4줄).
4. **상세**: PageHeader에 파일 상태 lg(제목 옆) + 드리프트 md(`LabeledStatus`, 아래 줄). A 요약 카드(ASM 재사용 + Helm·시스템 칩 + 데이터 미포함 안내). 상세 탭 5개(`파일`/`드리프트`/`리소스 수`/`Secret 참조`/`메타데이터`, `?view=`).
5. **파일 탭**: 탐색 패널 4열(SegmentedControl `리소스 | 스캔 발견`) + 편집기 8열. 리소스 트리 행 규격(28px, 들여쓰기 16px, 마커 순서, 접힌 노드 집계, 가상 렌더링, WAI-ARIA tree 키보드), 스캔 패널은 ASM 그대로 탐색 패널 안으로, 편집기는 파일 탭 줄 대신 40px 파일 머리.
6. **드리프트 탭**: 실행 안 함 안내 → `DriftSummary`(상태·계산 시각·개수 칸 5개·숨긴 차이 스위치·비교 불가 칩·부분 계산 안내) → 리소스 목록 4열 + 리소스 차이 8열(`FieldDiffTable`, 명령 블록). 삭제됨·추가됨 모습, 가린 값(`MaskedValue`), 상태별 11가지 모습(계산 안 함, 계산 중, 알 수 없음 5종, 차이 없음, stale, API 오류 등).
7. **리소스 수 / Secret 참조 / 메타데이터 탭**, 확인 창 차이(저장 전 확인에 여러 문서·경로 불일치 블록, 삭제 창 파일 요약), k8s 휴지통, mock 그룹, 상태 규칙 표, 반응형, 접근성, 컴포넌트 목록.
8. 공통 문서 갱신: `status.md`(1.2 문구, 1.3 칩, 5.2 정렬, 10절 드리프트 규칙 신설), `components.md`(14절 새 컴포넌트 8종, 15절 확장 4건, 아이콘), `shell.md`(메뉴 9번), `aws-snapshot-manager.md`(바뀐 점 머리 메모).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/design/k8s-snapshot.md` | 추가 | 화면 설계 전체(0~15절) |
| `docs/design/status.md` | 수정 | 적용 범위, 1.2 k8s 파일·드리프트 문구, 1.3 보조 칩 6종, 5.2 정렬 5행, 10절(두 축·드리프트 문구·구분·필드 분류·가림·토큰) |
| `docs/design/components.md` | 수정 | 머리 설명, 12.7 참조, 13 아이콘(k8s 추가분), 14절(LinkTabs, LabeledStatus, DriftStatus/DriftKindIcon/DriftKindChip, ResourceTree, DriftSummary, FieldDiffTable, DiffValue, MaskedValue), 15절(SideNav 라벨, DataSourceBadge 그룹, ScanFindingList `truncateFile`, NoExecuteNotice `text`) |
| `docs/design/shell.md` | 수정 | 3.1 메뉴 9번 라벨 `스냅샷` + 합산 규칙, 3.2 숫자 배지 설명 |
| `docs/design/aws-snapshot-manager.md` | 수정 | 머리에 "k8s-snapshot으로 바뀐 점" 한 항목 추가(메뉴 라벨, 목록 PageHeader 제목·탭). 본문은 그대로 |
| `docs/reports/k8s-snapshot/designer.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **탭 = 링크 이동, 탭 쿼리 없음**: 대안 `/snapshots?tab=k8s`. 두 탭의 필터 쿼리 이름이 달라 충돌하고, "`/snapshots?status=…`는 AWS를 연다"는 호환 약속을 가장 단순하게 지키는 방법이 경로 분리다. `k8s`는 ID 형식과 겹치지 않는다.
- **새 `LinkTabs`**: 기존 `Tabs`는 `role="tablist"` 패널 전환이라 URL 이동에 쓰면 접근성 의미가 틀린다. 모양은 같게 두고 `<nav>` + `<a aria-current>`로 분리.
- **AWS 상세·휴지통 불변**: 브레드크럼 `AWS 스냅샷 ›`도 그대로. 바뀌는 AWS 화면은 목록 머리(제목 `스냅샷` + 탭)뿐 — 기존 수용 기준 영향 최소화.
- **두 배지 구분**: 표는 열 분리, 상세는 파일 lg(제목 옆) / 드리프트 md(아래 줄 + `드리프트` 라벨), 탭·메뉴의 상태 아이콘·pill은 파일 상태 전용이고 드리프트는 neutral `git-compare` 칩. 드리프트 배지 문구는 `차이 N건`/`차이 없음`/`알 수 없음`(`정상`을 쓰지 않음: 스냅샷은 원하는 상태가 아니라 기록).
- **"계산 안 함"은 배지가 아님**: 명세 4.6 "디자인이 정함". `minus` + 회색 문구로 상태와 구분.
- **드리프트에 빨강·초록 diff 색을 쓰지 않음 / 새 토큰 없음**: 빨강은 이 대시보드에서 장애. 추가·삭제·변경은 사각형 아이콘(`square-plus/minus/dot`, 상태 아이콘 모양과 겹치지 않음) + 문구. 가린 값도 warn 색 대신 neutral dashed 상자(warn = 차이 있음과 혼동 방지).
- **드리프트 요약 카드에 warn 막대 없음**: 드리프트는 경보가 아니라 정보(명세 4.6).
- **목록에서 CLI 버전 열 제외**: 두 상태 열을 넣으면서 1,160px 안에 안 들어감. 시각 툴팁·메타데이터 탭에 둠. 직전 대비는 리소스 열 2줄로 합침.
- **클러스터 필터는 "연결된/다른/확인 불가" 3값**: 대시보드 클러스터가 하나라 비교 기준이 같은지·다른지.
- **상세를 탭 5개로 분리**: 파일 수백 개 + 드리프트 + Secret 참조 + 메타를 한 스크롤에 두면 편집 작업 영역이 밀린다. 파일 탭의 편집 버퍼는 다른 상세 탭으로 가도 유지.
- **탐색 패널에 트리와 스캔 발견을 SegmentedControl로 합침**: 편집기를 8열로 유지(ASM과 같은 폭). 오류가 있으면 스캔 보기 + 첫 발견 파일을 기본으로 연다.
- **추가된 리소스에 명령 블록 없음, 삭제 명령 제안 금지**: 조회 전용 원칙. 변경·삭제된 리소스만 `kubectl diff`/`apply` 복사.
- **삭제 확인 창의 파일 목록을 최상위 요약으로**: 파일 수백 개를 모두 나열하면 창이 쓸모없어짐.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 작업만. 코드·lint·test 대상 없음 |
| 열 폭 합계 수기 확인 | 통과 | 목록 9열 = 1,160px, 필드 차이 표 704px ≤ 736px, 12열 격자 계산(1열 82px) |
| 기존 코드와 문서 대조 | 확인 | `Tabs`가 버튼 탭임, `DataTable.groupRow`·`hideBelow` 존재, `SCENARIO_GROUPS` 끝이 `snapshots`, `CommandLine` 공용 위치 확인 |

- 화면 렌더링 검증은 하지 않았다(구현 전).

### 7. 남은 이슈·한계
- API 계약(`docs/api/k8s-snapshot.md`) 전이라 필드 이름·값(드리프트 상태 값, 리소스 키, 가린 문자열 형식, 결과 보관 여부, 계산 중 알림)은 가정이다. 계약이 나오면 문구·props 이름을 맞춰야 할 수 있다.
- "지난 결과 보기"(최신 아닌 스냅샷의 지난 드리프트 결과)는 백엔드가 결과를 보관할 때만 의미가 있다. 보관하지 않으면 해당 문구·버튼을 빼면 된다.
- 여러 문서(`---`) 파일의 드리프트 짝 맞추기 동작을 명세가 정하지 않아, 저장 전 확인 문구의 마지막 절(`드리프트는 첫 문서만…`)은 서버 동작에 맞춰 확정해야 한다.
- mock 시나리오 그룹이 하나면 `클러스터 연결 없음`·`드리프트 없음`이 파일 시나리오와 동시에 고를 수 없다. 그룹을 나눌지는 백엔드 계약 결정.
- CLI 설정 이름(`KUBE_CONTEXT` 등)은 계약 확정 전이라 안내 문구에 넣지 않았다.

### 8. 다른 담당 요청
- `publisher 요청`: `components.md` 14절 새 컴포넌트(`LinkTabs`, `LabeledStatus`, `DriftStatus`/`DriftKindIcon`/`DriftKindChip`, `ResourceTree`(가상 렌더링·tree 키보드), `DriftSummary`, `FieldDiffTable`, `DiffValue`, `MaskedValue`)와 15절 확장(`SideNav` 기본 라벨 `스냅샷`, `DataSourceBadge` 그룹 `Kubernetes 스냅샷`, `ScanFindingList.truncateFile`, `NoExecuteNotice.text`), 13절 새 아이콘 등록.
- `frontend 요청`: 경로 `/snapshots/k8s`, `/snapshots/k8s/[id]`, `/snapshots/k8s/trash` 추가(기존 경로·쿼리 불변), 목록 페이지 머리를 `스냅샷` + `LinkTabs`로(AWS 본문은 그대로), SideNav 현재 위치를 `/snapshots` 접두어 전체로, 상세 `?view=`·`file`·`line`·`res`·`kind`·`hidden` 쿼리, 파일 탭 편집 버퍼를 상세 탭 전환 중 유지, 드리프트 요청 계산은 화면 이탈 시 중지.
- `backend 요청`(계약 작성 시): 드리프트 상태 값·사유·건수·숨긴 차이 분류/이유·가린 문자열·비교 불가 종류(권한 밖/권한 거부 구분)·리소스 요약(이미지·replicas)·명령용 저장소 기준 파일 경로·계산 모드(자동/요청)·갱신 중 여부·지난 결과 보관 여부를 응답에 포함. 목록 행에 클러스터 동일 여부(`current|other|unknown`), 탭·메뉴 집계(파일 상태 최악, 커밋 금지 수, 최신 드리프트 건수)를 서버 값으로. mock 그룹 키·표시 이름(`Kubernetes 스냅샷`, 드리프트 분리 시 `Kubernetes 드리프트`).
- `planner 요청`(선택): 여러 문서 파일의 드리프트 처리 규칙을 명세에 한 줄 추가.

### 9. 다음 담당이 알아야 할 점
- 설계 본문: `docs/design/k8s-snapshot.md`. ASM과 같은 부분은 "ASM-D n.n 그대로"로만 적었으니 `docs/design/aws-snapshot-manager.md`를 함께 본다.
- 드리프트 규칙의 단일 출처는 `status.md` 10절. 드리프트는 사이드바·요약 띠 왼쪽·crit 막대·개요에 절대 들어가지 않는다.
- 새 토큰 없음. 드리프트 구분·가림에 상태 색을 새로 쓰지 말 것(neutral + 아이콘 모양).
- 드리프트 값(상태·분류·가림)은 서버 값만 표시하고 화면에서 다시 계산하지 않는다. 수량 표기도 원문 그대로.
- 명령 문자열은 텍스트 + 복사만. 추가된 리소스에는 명령을 보이지 않는다.

---

## 2026-09-19 · API 계약 대조 정리 (`docs/api/k8s-snapshot.md`)

### 1. 요청 내용
- PM: backend 계약 완료에 맞춰 디자인 문서만 정리. ① 저장 전 확인 ⑤ 마지막 절 → "문서마다 따로 비교" ② mock 그룹 `k8s-snapshots` 하나(드리프트 별도 그룹 없음) ③ 필터 값 클러스터 `same/other/unknown`, 드리프트 `ok/warning/unknown/not_computed` ④ "지난 결과 보기"를 계약(전체 결과 10분, 이후 요약만 `mode: last_result`)에 맞춤 ⑤ 새 사유 코드 `API_VERSION_MISMATCH`, `DASHBOARD_CLUSTER_UNKNOWN`, `CLUSTER_SYNCING` 표시 문구 ⑥ 그 밖의 가정(필드 이름, CLI 설정 이름) 대조. publisher 구현 중이라 컴포넌트 스펙 변경은 구체적으로.

### 2. 참고한 문서
- `docs/api/k8s-snapshot.md` 3.3, 4.2, 5, 6.1~6.4, 7.1~7.3, 9, 10.2~10.9, 11.1~11.4, 12, 13, 14.2~14.4, 16절

### 3. 작업 내용
- `k8s-snapshot.md`
  - 머리에 계약 참조(K8S-API), 새 16절 "API 값 ↔ 화면 매핑" 표.
  - 2.3 탭: `GET /api/snapshot-menu`의 `tabs.*.status/critical/included`, `latestDrift`의 `DRIFT_DIFF`일 때만 칩.
  - 3.2 요약 띠: `summary.dashboardCluster`(state별 문구), `summary.latestDrift`(null이면 `—`).
  - 3.3 필터: API 값 그대로(`drift` ok/warning/unknown/not_computed, `cluster` same/other/unknown, `facets` 개수, URL 쿼리 값도 API 값), 검색 placeholder `라벨·메모·ID·컨텍스트 검색`.
  - 3.4 표: 드리프트 열 **정렬 불가**로 변경(API 정렬 키 없음), 클러스터 열을 `cluster.relation`으로.
  - 3.5 드리프트 셀: `DriftBadge` → 모습 판단 순서(stale → `DRIFT_NOT_COMPUTED` → status), `computing`은 배지 옆 Spinner, `last_result` 문구. **3.5.1 사유 코드 12개 → 짧은 문구·버튼 비활성 사유 표** 신설(새 코드 3개 포함, `DRIFT_RULES_UNAVAILABLE`·`DRIFT_FAILED`도).
  - 3.6 CLI 안내: 서버 `cli.*` 값 사용, 설정 목록(`cli.settings`, `KUBE_CONTEXT` 필수 칩), 종료코드 표 2열(서버 `exitCodes`).
  - 4.2·4.4·4.5: 계산 버튼은 `actions.computeDrift`, 보조 칩은 `notices[].code` 매핑(11.4 코드 7종), `DATA_NOT_INCLUDED` 서버 문구 사용, Secret 참조 탭 상태 아이콘 제거(계약상 정보 문구뿐).
  - 5.2 트리: 데이터 출처(`tree`/`files`/`extraFiles`), 마커 매핑(`files[].drift`), 비교 불가 종류 툴팁에 `api_version_mismatch`.
  - 5.4 편집기: `parse` 값별 알림(`yaml_error`/`not_object`/`empty`/`too_large`), `multi_document` 알림 "문서마다 따로 비교".
  - 6.3 요약: `mode` `auto`/`on_demand`/`last_result` 문구, `computing`, 비교 불가 칩에 `API_VERSION_MISMATCH`(dashed `· API 버전 다름`), ⑤ `unparsable` 사유별 합산(중복 정의 별도 줄 제거), `addedCheck`, `notices`.
  - 6.4~6.7: `resources[].change`(`deleted`), `fields[].category`, 서버 정렬(변경 → 관리 → 기본값), `fieldsTruncated` 안내 행, `commands`·`commandsNote`·`snapshotCluster`·`fileDocuments ≥ 2` 경고, `summary.images/replicas`, `change: same`(숨긴 차이만) 모습. 값은 계약 `DiffValue`(scalar/list/masked/null) — **객체 YAML 조각 표시 제거**, 타입만 다를 때 타입 표시, list 표시 추가.
  - 6.8 상태: "지난 결과 · 전체 결과 있음 / 요약만 / 보는 중 10분 지남", `on_demand`, 새 사유 `CLUSTER_SYNCING`(hourglass), `DASHBOARD_CLUSTER_UNKNOWN`, `DRIFT_RULES_UNAVAILABLE`, `DRIFT_FAILED`, 409 `K8S_DRIFT_UNAVAILABLE` 처리. `CLUSTER_ID_MISSING` 제목을 `스냅샷의 클러스터를 확인할 수 없음`으로 바꿔 대시보드 쪽과 구분.
  - 8 Secret 참조: `keys`(참조 키 열), `optional` 칩, `via` 8종 → 문구 매핑, 안내 문구 수정(키 이름은 참조에 적힌 것만 앎), 손상·형식 다름은 neutral.
  - 7·10: `byKind[].drift` 4값, 저장 전 확인 ⑤ 문구 "드리프트는 문서마다 따로 비교합니다", ⑥에 `check.identity`, 삭제 창 `folder.topLevel`, 휴지통 `cluster`·`fileCount`.
  - 11 mock: 그룹 `k8s-snapshots` 하나, 라디오 문구 ↔ id 9개, 지난 결과 예시(`20260910-000000`).
- `components.md` 14·15절: 타입과 props를 계약 값으로(아래 publisher 요청).
- `status.md`: 10.2 unknown 사유 목록·계산 안 함 행, 5.2 드리프트 열 정렬 없음·필드 차이 순서.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/design/k8s-snapshot.md` | 수정 | 위 3절 전체, 16절 추가 |
| `docs/design/components.md` | 수정 | 14절 타입, 14.3 `DriftStatus.refreshing`·매핑, `DriftKindIcon` 키, 14.5 `DriftSummary` props, 14.6 `FieldDiffTable` rows·`truncated`, 14.7 `DiffValue` 재정의, 15.2 그룹 키 |
| `docs/design/status.md` | 수정 | 5.2 두 행, 10.2 두 행 |
| `docs/reports/k8s-snapshot/designer.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유
- **드리프트 열 정렬 제거**: 계약 `sort`는 `snapshotAt`·`status`만. 화면 정렬을 따로 두면 `limit`/`offset` 사용 시 결과가 틀린다. 필터(`drift`)로 대신한다.
- **"지난 결과 보기"는 `resultAvailable`일 때만**, 요약만 남은 경우는 문구 + `다시 계산`만. 지난 결과 화면은 dashed 카드 + `history` 안내로 "지금 값이 아님"을 표시(상태 색 없음).
- **새 사유 문구**: `CLUSTER_SYNCING`은 기다리면 풀리는 상태라 `hourglass` + 이유(일부만 읽고 비교하면 삭제됨 오판). `DASHBOARD_CLUSTER_UNKNOWN`은 "대시보드 쪽"을 모른다는 점을 제목·짧은 문구에 넣어 `CLUSTER_ID_MISSING`(스냅샷 쪽)과 구분. `API_VERSION_MISMATCH`는 권한 거부처럼 dashed 칩(권한 밖 기본 사유와 구분) + 파일을 고치면 비교된다는 안내.
- **값 표시**: 계약상 잎 단위 스칼라·목록만 오므로 YAML 조각 표시를 없애고, `8080`/`"8080"` 구분을 위해 "글자는 같고 타입만 다를 때"만 타입 표시.
- **Secret 참조 없음·손상은 상태 아이콘·warn 없이 neutral**: 계약 11.4 정보 문구(상태 영향 없음)와 맞춤.
- **URL 쿼리 값 = API 값**: 화면 전용 별칭을 만들지 않아 매핑 지점을 줄인다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 작업만 |
| 계약 대조(수기) | 확인 | 5·6.2·6.3·6.4·7.2·10.2·10.9·11.3·11.4·12.1·14.4 필드명·값을 설계 문서 16절 표에 대응 |
| 잔여 용어 grep (`removed`, `k8sSnapshots`, `Kubernetes 드리프트`, `파일 안 필드 순서`) | 0건 (설명 주석 1건 제외) | |

### 7. 남은 이슈·한계
- `DriftBadge`에 "계산 요청 대기" 표시는 계약에 없다(POST가 동기 응답). 화면의 `계산 중`은 프론트의 요청 대기 상태로만 그린다(계약 10.9와 같음).
- `CLEANUP_RULES_NEWER` 등 드리프트 쪽 notice는 문구를 서버 값 그대로 쓰기로 해 별도 디자인 문구가 없다.
- `too_large` 파일은 `unparsable` 사유로는 "해석 실패"에 합쳐 보인다(따로 세지 않음).

### 8. 다른 담당 요청
- `publisher 요청` (components.md 14·15절 변경분, 구현 중인 코드에 반영):
  1. 타입: `DriftKind`의 `"removed"` → **`"deleted"`**, `DriftFieldClass`의 `"change"` → **`"changed"`**. `DiffValueData`를 계약 `DiffValue`와 같은 모양으로(`{kind:"scalar",value}` / `{kind:"list",items}` / `{kind:"masked",text,preview}` / `null`). 이전의 `{type:"text"|"absent"|"masked"}`는 폐기.
  2. `DiffValue`(14.7): `scalar`(문자열 따옴표 없이, 숫자·불리언 JSON 표기, `null`은 `text.tertiary`), `list`(항목마다 `- ` 줄), `masked`(`text`만), `null` → `(없음)`. 새 prop `showType`(값 뒤 6px micro `text.tertiary` `문자열`/`숫자`/`불리언`). `더 보기`는 줄 또는 목록 항목 수 기준.
  3. `FieldDiffTable`(14.6): `rows` = `{ path, category, reason, managedRule?, snapshot, cluster }[]`(`id`·`cls`·`clsLabel`·`clsDetail` 제거, 행 키 `path`). 분류 셀은 `category`+`reason`으로 그린다. 새 prop `truncated`(표 끝 안내 행 36px). 글자가 같고 타입만 다른 행에서 `showType` 켬.
  4. `DriftSummary`(14.5): `mode`를 `"auto" | "on_demand" | "last_result"`로, `counts.removed` → `counts.deleted`, `hidden.defaults` → `hidden.default`, `target`을 `{ name, context }`로, `notComparable`을 `{ kind, count, reason, text }[]`(reason `NOT_IN_RBAC` 실선 / `FORBIDDEN`·`API_VERSION_MISMATCH` dashed, 문구 `· 권한 거부` / `· API 버전 다름`), 새 prop `totalUncomparable`, `state`에 `"lastResult"`(카드 1px dashed `border.strong` + 줄 ① 배지 앞 caption `지난 결과`). `last_result`의 `다시 계산`은 primary sm.
  5. `DriftStatus`(14.3): 새 prop `refreshing`(배지 뒤 4px Spinner 12px, `aria-label="갱신 중"`). `lastResult` 설명 보강(값 구조는 그대로).
  6. `DriftKindIcon`: `kind="deleted"` → `square-minus`.
  7. `DataSourceBadge`(15.2): 그룹 키 **`k8s-snapshots`**, `SCENARIO_GROUPS` 끝에 추가, 표시 이름 `Kubernetes 스냅샷`. 드리프트 별도 그룹 없음.
- `frontend 요청`: 쿼리 값을 API 값 그대로 사용(3.3), 드리프트 열 정렬 없음, `DriftBadge` → `DriftStatus` 매핑(16절), 6.8 지난 결과 흐름(`resultAvailable`), 409 `K8S_DRIFT_UNAVAILABLE` 시 배지 다시 조회.
- `backend 요청`: 없음(계약 그대로 수용). 확인 1건 — 목록 행의 `status.reasons` 외에 드리프트 사유 코드가 SSE `k8s-snapshots.drift`에도 같은 코드로 오는지(계약 13절 예시상 같음, 가정).

### 9. 다음 담당이 알아야 할 점
- 계약과 화면 개념의 대응은 `docs/design/k8s-snapshot.md` 16절 한 표에 모았다.
- 드리프트 알 수 없음 문구는 3.5.1(짧은)·6.8(드리프트 탭)에 있다. 표에 없는 코드는 서버 `text`를 그대로 쓴다.

## 2026-09-19 · frontend 구현 차이 검토 (문서만)

### 1. 요청 내용
- PM: `docs/reports/k8s-snapshot/frontend.md` 8절 `designer 요청` 4건이 디자인과 다른 점을 확인하고 각각 수용(문서를 구현에 맞게 수정) / 수정 필요(담당·구체 변경)로 판단.
  1. 상세 chips 줄 `드리프트 보기`·`드리프트 계산`을 링크 대신 버튼으로
  2. `Secret 목록 없음`을 누를 수 있는 ghost 버튼으로
  3. `exclude` 모드 범위 문구 `일부 제외 · <내보낸 네임스페이스>`
  4. 동기화 중(파일 확인 전 포함) 상태를 Card + `hourglass`로(publisher가 `UnknownState` `icon` prop 추가 중)

### 2. 참고한 문서
- `docs/design/k8s-snapshot.md` 3.4(범위 열), 4.2(chips 줄), 4.4(보조 칩 줄), 4.5, 6.8
- `docs/design/components.md` 4.1 Button, 6.3 EmptyState, 6.4 UnknownState, 14.2 LabeledStatus
- `docs/reports/k8s-snapshot/frontend.md` 5·7·8절
- `docs/api/k8s-snapshot.md` 3.2(`scope`), 5절 목록 `scope` 타입(`namespaces` = `scope.exported`, 제외 목록 없음)

### 3. 판단
| # | 항목 | 판단 | 이유 |
|---|---|---|---|
| 1 | `드리프트 보기`·`드리프트 계산` 버튼 | **수용** | 같은 상세 안의 탭 전환(+계산 요청)이라 의미상 `<button>`이 맞다. 링크면 이탈 가드와 부딪혀 4.5 "탭 전환 시 편집 유지"를 깨뜨린다. URL `?view=drift`는 replace로 맞추므로 새로고침·공유 규칙(4.1)도 유지된다 |
| 2 | `Secret 목록 없음` ghost 버튼 | **수용** | 칩 줄에서 이 항목만 동작이 있다. Chip은 비대화형 정보 표시로 정의돼 있어, 누르는 칩 variant를 새로 만드는 것보다 기존 Button ghost sm이 포커스·hover 규칙을 그대로 쓴다. 대가: 줄 높이가 20px 칩 옆 28px 버튼으로 섞임 → 세로 가운데 정렬, 줄 높이 28px로 명시 |
| 3 | `exclude` 범위 문구 | **수용(임시) + 문구 1곳 수정 필요** | 목록 응답에 제외 목록이 없어 `제외 batch`를 그릴 수 없다. 다만 `일부 제외 · data, prod`는 "data, prod가 제외됨"으로 잘못 읽힌다. `내보냄`을 붙여 `일부 제외 · 내보냄 data, prod`로 하고 툴팁에 의미를 적는다. backend가 제외 목록 필드를 추가하면 원래 문구 `제외 batch`로 돌아간다 |
| 4 | 동기화 중 Card + `hourglass` | **수용(임시) → publisher prop 반영 후 교체 필요** | 모양이 같으면 임시로 문제없다. 최종은 `UnknownState icon="hourglass"`(components 6.4에 `icon?` prop 정의 추가). 흉내 낸 Card는 UnknownState의 크기·색·aria 규칙이 따로 놀 수 있어 prop이 나오면 바꾼다 |

### 4. 작업 내용 (문서 수정)
- `k8s-snapshot.md` 4.2 chips 줄: `ghost sm 링크` → **Button ghost sm `<button>`** 2개, 누르면 탭을 바꾸고 URL은 replace, 편집 중 이탈 확인 없음·편집 유지.
- `k8s-snapshot.md` 4.4 보조 칩 줄: `SECRET_REFS_MISSING`/`SECRET_REFS_CORRUPT` → **Button ghost sm(28px)** `Secret 목록 없음`, 아이콘 `key-round` 16px, 툴팁 서버 `text`, 누르면 `secrets` 탭. 줄 세로 가운데 정렬·높이 28px.
- `k8s-snapshot.md` 3.4 범위 열: `exclude` 모드 임시 문구 `일부 제외 · 내보냄 data, prod`(쉼표+공백), 툴팁 `네임스페이스 제외 규칙 사용 · 내보낸 네임스페이스: data, prod (제외 목록은 상세 메타데이터 탭)`. 제외 목록 필드가 생기면 `제외 batch`.
- `k8s-snapshot.md` 6.8: 동기화 중·파일 확인 전 두 행을 `UnknownState lg icon="hourglass"`로 표기.
- `components.md` 6.4 `UnknownState`: `icon?: "circle-help"(기본) | "hourglass"` 추가. 색은 둘 다 `status.unknown.fg`, 크기 sm 24px / lg 40px. `hourglass`는 기다리면 풀리는 알 수 없음에만, 다른 아이콘은 받지 않음.
- `components.md` 14.2 `LabeledStatus.action` 설명: 같은 페이지 탭 전환이면 `<button>`, 다른 페이지면 링크.
- 새 토큰 없음.

### 5. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/design/k8s-snapshot.md` | 수정 | 3.4 범위 열, 4.2 chips 줄, 4.4 보조 칩 줄, 6.8 두 행 |
| `docs/design/components.md` | 수정 | 6.4 `UnknownState.icon`, 14.2 `LabeledStatus.action` |
| `docs/reports/k8s-snapshot/designer.md` | 수정 | 이 섹션 추가 |

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 작업만. 구현 코드·화면은 보지 않았다(frontend 보고서 기준 판단) |

### 7. 남은 이슈·한계
- 3번은 backend의 목록 `scope` 제외 목록 필드가 들어오기 전까지 임시 문구다.
- 4번은 publisher의 `UnknownState icon` prop이 끝나야 최종 모습이 된다.
- frontend 보고서 7절의 다른 차이(PageHeader `srPrefix`, 탭 줄 위 여백 24px, 드리프트 셀 hover, Secret 참조 `note` 고정 문구)는 이번 요청 범위 밖이라 판단하지 않았다. 모두 디자인이 바뀌지 않는 부분이라 기존 publisher/backend 요청대로 가면 된다.

### 8. 다른 담당 요청
- `frontend 요청`
  1. (3번) `exclude` 범위 문구를 `일부 제외 · <목록>` → `일부 제외 · 내보냄 <목록>`으로, 툴팁 `네임스페이스 제외 규칙 사용 · 내보낸 네임스페이스: <목록> (제외 목록은 상세 메타데이터 탭)`. backend가 제외 목록을 주면 `제외 <제외 목록>`.
  2. (4번) publisher의 `UnknownState icon` prop이 나오면 Card 흉내를 `UnknownState size="lg" icon="hourglass"`로 교체(동기화 중·파일 확인 전 2곳).
- `publisher 요청`: `UnknownState`에 `icon?: "circle-help" | "hourglass"`(기본 `circle-help`), 색 `status.unknown.fg`, 크기는 EmptyState와 같게(components 6.4). 다른 아이콘 값은 타입에서 막는다.
- `backend 요청`: (frontend 요청과 같음, 선택) 목록 `scope`에 제외 네임스페이스 목록 필드.

### 9. 다음 담당이 알아야 할 점
- 1·2번은 이제 디자인 문서가 구현과 같다. 추가 작업 없음.
- 같은 페이지 안 탭 전환은 버튼, 다른 페이지 이동은 링크 — 이 규칙을 `LabeledStatus.action` 설명에 적어 뒀다.
