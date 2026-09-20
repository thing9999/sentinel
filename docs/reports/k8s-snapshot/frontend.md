# k8s-snapshot · frontend 작업 보고

> 파일 위치: `docs/reports/k8s-snapshot/frontend.md`

## 2026-09-19 23:55 · 6단계 통합 (스냅샷 메뉴 Kubernetes 탭 페이지 + 사이드바 합산 연동)

### 1. 요청 내용
- PM 요청: "스냅샷" 메뉴 Kubernetes 탭 페이지(목록·상세·휴지통)와 사이드바 합산 연동. backend 구현이 동시에 진행 중이라 **계약 문서 기준으로 구현하고 테스트는 fixture로**. api 서버는 띄우지 않는다(실제 API 연결 확인은 PM이 다음에 따로 요청).
- 다른 담당 요청 (모두 처리)
  - designer: 라우트 `/snapshots/k8s`, `/snapshots/k8s/[id]`, `/snapshots/k8s/trash`(기존 `/snapshots`·`[id]`·`trash` 경로·쿼리 불변). 목록 머리 `스냅샷` + `LinkTabs`(AWS 목록 포함), `/snapshots/**` 전체를 현재 메뉴로. 상세 쿼리 `view`·`file`·`line`·`res`·`kind`·`hidden`. 상세 탭 전환 중 파일 편집 유지. 페이지를 떠나면 요청 드리프트 갱신 중단. URL 쿼리 = API 값. 드리프트 열 정렬 없음. `DriftBadge`→`DriftStatus` 매핑(16절). 지난 결과 흐름(6.8). 409 `K8S_DRIFT_UNAVAILABLE`이면 배지 재조회.
  - backend: 사이드바 메뉴는 `GET /api/snapshot-menu` + 토픽 `snapshot-menu`(드리프트 미반영). 드리프트 탭이 열려 있는 동안 60초마다 `POST …/drift {force:false}` 임대 갱신.
  - publisher: `MockGroupId`에 `k8s-snapshots`, `ShellClient`·`mock-scenarios.ts`의 `ScenarioGroupKey`→`ScenarioGroupId`(잘못된 캐스트 제거). `app/snapshots/page.tsx` title·목록 h1 `스냅샷`. 드리프트 열 셀 `DriftStatus srPrefix=""`, 상세 파일 상태 배지 `StatusBadge srPrefix="파일 상태: "`.
  - publisher(flake): `features/aws-snapshots/pages.test.tsx` 저장 흐름 테스트 안정화 + 전체 vitest 3회 연속 통과 확인.
  - 공통: 대시보드는 클러스터·AWS에 쓰지 않는다. 적용·내보내기 버튼 없음(CLI 안내·복사용 kubectl 명령만).
- 쓰기 영역: `apps/web/src/app/**`, `features/**`, `charts/**`, apps/web 루트 설정.

### 2. 참고한 문서
- 명세 `docs/specs/k8s-snapshot.md`(0·4·5절, AC-K01~K44), `docs/specs/aws-snapshot-manager.md`(U1·3.4·AC-21 변경분)
- 디자인 `docs/design/k8s-snapshot.md`(전체, 특히 2·3·3.5.1·4·5·6.8·10·16절), `docs/design/components.md` 14·15절, `docs/design/status.md` 10절, `docs/design/shell.md`
- 계약 `docs/api/k8s-snapshot.md`(0~14·16·19절), `docs/api/common.md`(2.3·5·6절)
- 보고서 `docs/reports/k8s-snapshot/{publisher,designer,backend,README}.md`, `docs/reports/aws-snapshot-manager/frontend.md`
- 재사용 코드: `features/aws-snapshots/*`(저장 check→confirm→PUT, 422 재확인, 409 충돌, 이탈 가드, SSE 재조회 카운터, JSON Content-Type), `components/ui/k8s/*`·`LinkTabs`·`LabeledStatus` 인터페이스

### 3. 작업 내용
1. **공통·스트림**
   - `common/types.ts`: `SourceId`에 `k8sSnapshotStore`, `MockGroupId`에 `k8s-snapshots`, `StreamTopic`·`ALL_TOPICS`에 `k8s-snapshots`·`snapshot-menu`.
   - `stream/reducer.ts`: `k8sSnapshots` 상태(aws와 같은 `seq`/`resetSeq`/`changed`/`removed`/`trashSeq` 카운터 + 스냅샷별 드리프트 배지 `drift`·`driftSeq`·`autoTargetId`), `snapshotMenu` 상태(메뉴·탭 통째 교체). 이벤트 5종을 `STREAM_EVENT_TYPES`에 추가. `.drift`는 목록 재조회 키(`seq`)를 올리지 않는다(계약 13절 "목록 다시 조회 불필요"). `.snapshot`이 오면 드리프트 배지 캐시를 비운다(REST로 다시 받음).
   - `stream/client.ts`: `BASE_TOPICS = ["overview", "snapshot-menu"]`(사이드바는 새 토픽). `aws-snapshots`는 더 이상 기본 구독이 아니고 AWS 화면(`useSnapshotsView`)이 `useTopics`로 구독한다. 토픽 순서에 두 토픽 추가.
2. **사이드바·MOCK 배지** (`shell/*`)
   - `nav.ts`: `snapshotMenuNavPatch(menu)` — 서버 `menu.status`·`menu.count`를 그대로, crit면 `커밋 금지`, `showIcon:false`면 아이콘·숫자 없음, 서버 stale·heartbeat 끊김이면 stale. 드리프트는 넣지 않는다. 기존 `snapshotNavPatch`(AWS 요약 기반)는 없앴다.
   - `ShellClient.tsx`: `stream.snapshotMenu.menu`로 스냅샷 메뉴를 그린다. `onScenarioChange` 타입 `ScenarioGroupId`.
   - `mock-scenarios.ts`: `SCENARIO_GROUPS` 타입 가드로 걸러 `ScenarioGroupId`를 그대로 넘긴다(캐스트 제거).
   - `/snapshots/**` 현재 위치 강조는 `SideNav`가 이미 `href/` 접두어로 판단한다(확인만).
3. **스냅샷 머리 공용** `features/snapshot-menu/`
   - `types.ts`: 계약 12절 `SnapshotMenu`·탭·payload·응답.
   - `SnapshotsHeader.tsx`: h1 `스냅샷` + `LinkTabs`(AWS `/snapshots`, Kubernetes `/snapshots/k8s`, 탭 전환은 쿼리 없는 기본 경로 링크) + 탭 안내 줄. 탭 배지는 `tabs.*`(included=false면 없음, stale, crit `커밋 금지`, 커밋 금지 pill), Kubernetes 탭은 `latestDrift`가 `DRIFT_DIFF`일 때만 `DriftCountChip`(`차이 N`, 툴팁 `최신 스냅샷 드리프트: 차이 3건 (변경 1 · 삭제 1 · 추가 1) · 15:12 계산`) + `srText`. 데이터는 스트림(기본 구독) → 없으면 `GET /api/snapshot-menu` 한 번.
   - AWS 목록(`aws-snapshots/SnapshotListPage.tsx`)의 머리를 이 컴포넌트로 바꿨다(본문 불변). `app/snapshots/page.tsx` title `스냅샷`.
4. **Kubernetes 기능 모듈** `features/k8s-snapshots/`
   - `types.ts`: 계약 5~13절 타입(목록 행·배지·요약·cli·facets·상세 files/tree/counts/folder/metadata/secretRefs·파일·검사·저장·라벨·휴지통·드리프트 응답·SSE payload). ASM과 같은 모양은 aws 타입 재사용. 계약에 없는 필드는 두지 않았다.
   - `api.ts`: refresh `{}`, 파일 check/PUT(`path` 쿼리, 60초), notes, DELETE `?confirm=`, restore `{}`, purge, `requestDrift(id, force)`(`{force}` JSON, 30초).
   - `model.ts`(순수 함수): `driftCellView`(16절 매핑: stale → `DRIFT_NOT_COMPUTED` → status, critical은 unknown + 콘솔 경고 1회, 요청 대기 `계산 중`, `computing`은 값 유지 + 스피너, kube 출처 stale이면 계산된 배지를 stale로), 3.5.1 짧은 문구·버튼 비활성 사유 표, URL 필터(값 = API 값)·정렬(`snapshotAt:desc` 등), 범위·증감 문구, 파일 트리(`tree` 서버 순서 + `files[]` 경로 키 + 예상 밖 파일, 표시 필터 5종·개수, 마커: 스캔·파일 문제·드리프트·Helm·저장 안 됨, 비교 불가 종류 `eye-off` 툴팁), 발견 변환(상세 `files[]`에 있는 경로만 이동), 편집기 마커, 상세 탭 항목, 드리프트 목록(구분 필터·숨긴 차이 스위치·서버 순서 네임스페이스→종류 묶음), `unparsable` 요약, Secret `via` 문구.
   - `hooks.ts`: `useK8sSnapshotsView`(토픽 구독, 요약·카운터·드리프트 배지·kube stale), `useDetailQuery`(상세 쿼리 6개를 상태로 두고 URL은 replace로 맞춤, 링크·뒤로 가기로 URL이 바뀌면 그 값을 따름), `useDriftData`(탭이 열려 있을 때만 GET, `POST force:true`, 409 → 배지·상세 재조회, **임대 갱신: 응답에 `lease`가 있고 탭이 열려 있고 브라우저 탭이 보일 때만 `renewAfterSec`(60초)마다 `POST {force:false}`**, 탭을 옮기거나 페이지를 떠나면 타이머 해제, 다시 보이면 재조회), CLI 안내 펼침 저장소 `sentinel.snapshots.k8s.cliGuide`.
   - `K8sListPage.tsx`(디자인 3절): 요약 띠(파일 상태만 + 폴더·대시보드 클러스터 + `최신 드리프트` 칸), FilterBar(파일 MultiSelect·드리프트 MultiSelect·클러스터 Select·검색, 개수 `facets`), 9열 표(파일/드리프트/스냅샷/클러스터/범위/리소스/현재 스캔/마지막 수정/동작, 1280 미만 범위·마지막 수정 숨김). 드리프트 셀은 셀 전체가 `?view=drift` 링크(행 이동 막음), `k8s-snapshots.drift` 배지로 행만 교체. 빈 상태 + CLI 안내(서버 `cli.settings`·`exitCodes`), 설정 없음 UnknownState, 쓰기 불가 Banner, 휴지통 이동 알림.
   - `K8sDetailPage.tsx`(4절): 브레드크럼 `Kubernetes 스냅샷 › ID`, 제목 옆 파일 상태 lg, 아래 줄 `LabeledStatus 드리프트`(배지 md + 사유 + 계산 시각 + `드리프트 보기`/`드리프트 계산`) + ID·클러스터·컨텍스트·CLI 버전 줄, A 요약 카드(판단 사유·라벨·메모·`notices` 칩·커밋/적용 안 함 안내 + `DATA_NOT_INCLUDED` 문구), 상세 탭 5개(`?view=`). 편집 컨트롤러는 페이지에 있어서 탭을 옮겨도 편집이 남는다.
   - `FileEditor.tsx`(5.4, 10.1): AWS 편집기와 같은 흐름을 경로 기반으로. 파일 머리(경로·경로 복사(저장소 기준)·저장 안 됨 점·리소스 식별·Helm·드리프트 칩 링크·보기 전용), 툴바, 알림 슬롯(원본 편집 안내, YAML 해석 실패·여러 문서·경로 불일치·중복·런타임 필드, 외부 변경·충돌·실패·저장 결과 + `드리프트를 다시 계산합니다 (30초 이내).`), 저장 check→확인(① 오류 → ② YAML → ⑥ 경로·내용 → ⑤ 여러 문서 → ④ 경고)→PUT, 422 missing 합쳐 재확인, 409 충돌 창, 이탈 가드(같은 상세 안에서 `file`을 바꾸지 않는 링크는 통과), 편집 중 삭제 창.
   - `FilesTab.tsx`(5.1~5.3): 탐색 패널(`리소스 N | 스캔 발견 N`, 오류가 있으면 스캔 보기 + 첫 오류 파일·줄을 기본으로 연다) — 트리 보기(검색·표시 필터·모두 펼치기/접기·결과 줄·`ResourceTree` 가상 렌더링) / 스캔 보기(ASM 스캔 패널 + `truncateFile` + k8s 규칙 도움말 + CLI 재스캔 명령).
   - `DriftTab.tsx`(6절): 실행 안 함 안내 + 드리프트 규칙 도움말(`GET /drift-rules`), `DriftSummary`(계약 값 그대로: 모드 문구, 갱신 중, 5칸 필터, 숨긴 차이 스위치 `hidden=1`, 비교 불가 칩 `uncomparable`·`counts.uncomparable`, `unparsable`·`addedCheck`·`notices` 안내), 리소스 목록(`kind=` SegmentedControl·검색·`ResourceTree variant=drift`, 선택 `res=`), 리소스 차이(변경: `FieldDiffTable` 서버 순서·가린 값·숨긴 그룹·`fieldsTruncated` / 삭제됨·추가됨 요약 / 숨긴 차이만), 명령 블록(서버 `commands` 텍스트 + 복사, `commandsNote`, `snapshotCluster`, `fileDocuments ≥ 2` 경고, 추가됨은 명령 없음). 6.8 상태별 모습 전부(계산 안 함, 지난 결과 전체/요약만 + `지난 결과 보기`, 계산 요청 중 스켈레톤, 알 수 없음 사유 8종, 차이 없음, stale, 계산 실패 + 이전 결과 유지, 요청 오류).
   - `InfoTabs.tsx`: 리소스 수(요약 줄·종류별·네임스페이스별·제외 규칙, 합계 행은 서버 `counts.total`), Secret 참조(안내·이름 목록 복사·표·`via` 문구·optional·참조 리소스 파일 열기, 없음·손상 neutral), 메타데이터(표/원문 JSON, 클러스터 ID 관계 note, 종류별 내보내기 결과 표·부분 내보내기 경고, 손상 시 원문 편집기 + 오류 줄).
   - `dialogs.tsx`: 라벨·메모(ASM과 같은 흐름), 휴지통 이동(ID 입력, 시각·라벨·클러스터·파일 상태 `srPrefix="파일 상태: "`, `folder` 요약 + 최상위 목록).
   - `K8sTrashPage.tsx`(10.3): `리전` 대신 `클러스터` 열, 파일 수 = `fileCount`, 복원(409 `SNAPSHOT_ID_EXISTS` 안내)·영구 삭제.
   - `shared.tsx`: 쓰기 불가 Banner(k8s 문구), 출처 없음(k8s 경로 안내), CLI 안내, 드리프트 배지 1·2줄 조각, 스캔 규칙 도움말(k8s 처리 방법 2줄 추가), 드리프트 규칙 도움말.
5. **라우트** `app/snapshots/k8s/page.tsx`(Suspense), `app/snapshots/k8s/[id]/page.tsx`(ID별 `key`, Suspense), `app/snapshots/k8s/trash/page.tsx`. 정적 `k8s`가 `[id]`보다 우선이라 기존 AWS 경로와 겹치지 않는다.
6. **이탈 가드 확장** `aws-snapshots/hooks.ts useLeaveGuard`에 선택 인자 `allowInPage(url)`(기본 없음 = 기존 동작). k8s 상세는 같은 경로에서 `file`을 바꾸지 않는 링크(드리프트 칩 등 상세 탭 이동)를 막지 않는다.
7. **테스트**
   - 새 `k8s-snapshots/model.test.ts` 24건(매핑·필터·정렬·트리·탭·드리프트 목록·메뉴·탭 배지·BASE_TOPICS·MOCK 그룹·리듀서), `k8s-snapshots/pages.test.tsx` 21건(목록·상세·편집 흐름·드리프트 탭·임대 갱신(가짜 타이머)·휴지통), 픽스처 `__fixtures__/k8s-snapshots.ts`(계약 예시 모양).
   - 기존 테스트 갱신: aws `model.test.ts`(옛 사이드바 테스트 제거 → 새 메뉴 테스트는 k8s 쪽), aws `pages.test.tsx`(h1 `스냅샷` + 탭 확인), `stream/connection.test.ts`(기본 토픽).
   - **flake 안정화**: `aws-snapshots/pages.test.tsx`와 `features/pages.test.tsx`의 테스트별 `await import(...)`를 정적 import로 바꾸고 `configure({ asyncUtilTimeout: 3000 })`. 전체 실행 시간이 약 25초 → 약 8.5초로 줄었다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/app/snapshots/page.tsx` | 수정 | title `스냅샷` |
| `apps/web/src/app/snapshots/k8s/page.tsx` | 추가 | k8s 목록 라우트 |
| `apps/web/src/app/snapshots/k8s/[id]/page.tsx` | 추가 | k8s 상세 라우트(ID별 key) |
| `apps/web/src/app/snapshots/k8s/trash/page.tsx` | 추가 | k8s 휴지통 라우트 |
| `apps/web/src/features/common/types.ts` | 수정 | `k8sSnapshotStore`, `k8s-snapshots`, 토픽 2개 |
| `apps/web/src/features/stream/reducer.ts` | 수정 | `k8sSnapshots`·`snapshotMenu` 상태, 이벤트 5종 |
| `apps/web/src/features/stream/client.ts` | 수정 | `BASE_TOPICS = overview, snapshot-menu`, 토픽 순서 |
| `apps/web/src/features/stream/connection.test.ts` | 수정 | 기본 토픽 기대값 |
| `apps/web/src/features/shell/nav.ts` | 수정 | `snapshotMenuNavPatch`(서버 합산) |
| `apps/web/src/features/shell/ShellClient.tsx` | 수정 | 메뉴는 `snapshotMenu`, `ScenarioGroupId` |
| `apps/web/src/features/shell/mock-scenarios.ts` | 수정 | 타입 가드로 `ScenarioGroupId`(캐스트 제거) |
| `apps/web/src/features/snapshot-menu/types.ts` | 추가 | 계약 12절 타입 |
| `apps/web/src/features/snapshot-menu/SnapshotsHeader.tsx` | 추가 | `스냅샷` + LinkTabs 머리, 탭 배지 |
| `apps/web/src/features/aws-snapshots/SnapshotListPage.tsx` | 수정 | 머리를 `SnapshotsHeader`로 |
| `apps/web/src/features/aws-snapshots/hooks.ts` | 수정 | `aws-snapshots` 토픽 구독, `useLeaveGuard allowInPage` |
| `apps/web/src/features/aws-snapshots/model.test.ts` | 수정 | 옛 사이드바 테스트 제거 |
| `apps/web/src/features/aws-snapshots/pages.test.tsx` | 수정 | 정적 import·3초 대기(flake), h1·탭 확인 |
| `apps/web/src/features/pages.test.tsx` | 수정 | 정적 import·3초 대기(같은 flake 패턴) |
| `apps/web/src/features/k8s-snapshots/types.ts` | 추가 | 계약 타입 |
| `apps/web/src/features/k8s-snapshots/api.ts` | 추가 | 쓰기·계산 요청 |
| `apps/web/src/features/k8s-snapshots/model.ts` | 추가 | 순수 함수 |
| `apps/web/src/features/k8s-snapshots/hooks.ts` | 추가 | 스트림 뷰, 상세 쿼리, 드리프트 데이터·임대 |
| `apps/web/src/features/k8s-snapshots/shared.tsx` | 추가 | 공용 조각·도움말 |
| `apps/web/src/features/k8s-snapshots/K8sListPage.tsx` | 추가 | 목록 |
| `apps/web/src/features/k8s-snapshots/K8sDetailPage.tsx` | 추가 | 상세(머리·요약·탭) |
| `apps/web/src/features/k8s-snapshots/FileEditor.tsx` | 추가 | 편집 컨트롤러·카드·확인 창 |
| `apps/web/src/features/k8s-snapshots/FilesTab.tsx` | 추가 | 탐색 패널 + 편집기 |
| `apps/web/src/features/k8s-snapshots/DriftTab.tsx` | 추가 | 드리프트 탭 |
| `apps/web/src/features/k8s-snapshots/InfoTabs.tsx` | 추가 | 리소스 수·Secret 참조·메타데이터 |
| `apps/web/src/features/k8s-snapshots/dialogs.tsx` | 추가 | 라벨·메모, 휴지통 이동 |
| `apps/web/src/features/k8s-snapshots/K8sTrashPage.tsx` | 추가 | 휴지통 |
| `apps/web/src/features/k8s-snapshots/model.test.ts` | 추가 | 단위 24건 |
| `apps/web/src/features/k8s-snapshots/pages.test.tsx` | 추가 | 페이지 통합 21건 |
| `apps/web/src/features/__fixtures__/k8s-snapshots.ts` | 추가 | 계약 모양 픽스처 |
| `docs/reports/k8s-snapshot/frontend.md` | 추가 | 이 보고서 |

`components/ui/**`·`styles/**`(퍼블리셔 영역), apps/web 루트 설정은 바꾸지 않았다.

### 5. 주요 결정과 이유
- **사이드바 메뉴 = `snapshot-menu` 토픽, `aws-snapshots`는 기본 구독에서 뺌**: 계약 12.2 "사이드바는 더 이상 `aws-snapshots.summary`로 메뉴를 그리지 않는다". 모든 페이지가 AWS 요약을 받을 이유가 없어 AWS 화면이 스스로 구독하게 했다(`useSnapshotsView` 안 `useTopics`). AWS 화면 동작·재조회 키는 그대로다.
- **목록 필터·정렬은 서버(쿼리 = API 값)**: 대안은 ASM처럼 전체를 받아 브라우저에서 거르기. 드리프트 필터는 서버 판단(`not_computed`에 `last_result` 포함 등)이고 `facets`도 서버 값이라 화면이 다시 판단하지 않게 서버 필터를 썼다. 검색은 SearchInput 기본 200ms 지연 뒤 조회.
- **상세 쿼리 상태 = 화면 상태 + URL replace**: 버튼으로 탭·파일·리소스를 바꾸면 바로 반영하고 URL을 replace로 맞춘다. 링크·뒤로 가기로 URL이 바뀌면 그 값을 따른다. `file`이 URL에서 빠진 이동(예: 드리프트 탭 링크)은 열린 파일을 유지한다 → 상세 탭을 오가도 편집이 남는다.
- **이탈 가드 `allowInPage`**: 드리프트 칩처럼 같은 상세 안에서 탭만 바꾸는 링크까지 "페이지 이탈"로 막으면 디자인 4.5("탭 전환 시 편집 유지")와 어긋난다. 기본값 없음이라 AWS 동작은 그대로다. 다른 파일을 여는 링크는 계속 확인을 받는다.
- **chips 줄의 `드리프트 보기`·`드리프트 계산`은 링크가 아니라 버튼**: 같은 페이지의 탭 전환(+ 계산 요청)이라 버튼이 맞고, 편집 중 이탈 확인이 뜨지 않는다.
- **임대 갱신은 응답에 `lease`가 있을 때만**: 자동 대상(`lease: null`)이나 결과 없는 스냅샷에서 탭을 열었다고 요청하지 않는다(6.8 "돌아오면 자동으로 다시 요청하지 않는다"). 탭 숨김 중에는 갱신을 멈춘다(폴링 규칙) → 120초 넘게 숨기면 서버가 계산을 멈추고, 다시 보이면 재조회해 `last_result` 모습이 된다.
- **헤더 드리프트 배지 우선순위**: 드리프트 탭이 열려 있으면 탭 응답, 아니면 스트림 `.drift`, 없으면 상세 응답.
- **`비교 불가 N개`는 서버 `counts.uncomparable`**: 칩 합계와 다를 수 있어도 서버 값이 기준(common.md 2.2).
- **flake 원인과 처리**: 테스트마다 `await import(페이지)` 뒤 여러 `findBy*`를 기본 1초로 기다리는 구조가 전체 실행 부하에서 1초·5초를 넘겼다. 정적 import(모듈 변환을 파일 로드 때 한 번) + `asyncUtilTimeout 3000`. 같은 패턴인 `features/pages.test.tsx`도 이번 전체 실행 중 개요 테스트가 5초 제한에 한 번 걸려 함께 고쳤다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 errors, 0 warnings) | |
| `apps/web/node_modules/.bin/tsc --noEmit -p apps/web` | 통과 (0건) | |
| `npx vitest run` (apps/web 전체) 3회 연속 | **17 files, 295 passed** ×3 | 약 8.5초/회. 새 45건 포함(k8s model 24 + pages 21), 옛 사이드바 테스트 4건 제거 |
| 첫 전체 실행(정적 import 전환 전) | 294 passed / 1 failed | `features/pages.test.tsx` 개요 테스트 5초 타임아웃(단독 실행은 통과) → 같은 flake 패턴이라 정적 import로 고침 |
| `npm run build --prefix apps/web` | 통과 | `/snapshots/k8s`(static), `/snapshots/k8s/[id]`(dynamic), `/snapshots/k8s/trash`(static), 기존 `/snapshots`·`[id]`·`trash` 그대로 |
| api·web 서버 실행, 실제 API·SSE 연결, 브라우저 시각 확인(1024/1280/1440, 다크) | **생략** | 지시대로 서버를 띄우지 않음(backend 구현 중). 다음 단계에서 PM이 요청 |

**수용 기준 (fixture로 확인한 것)**
- AC-K16: 메뉴 상태·숫자는 서버 `menu` 그대로, 드리프트 미반영, `showIcon:false`면 없음 (단위).
- AC-K17: `/snapshots`는 AWS 목록(탭 현재 = AWS), 기존 AWS 상세·휴지통 테스트 그대로 통과 (페이지).
- AC-K18: k8s 상세는 `/snapshots/k8s/<id>`만 부른다(`/k8s-snapshots/:id`) (페이지·단위).
- AC-K19(프론트 쪽): AWS 화면 기존 테스트 39건 통과, AWS API·토픽 이름 불변.
- AC-K20·K39: 목록·상세·드리프트에 내보내기·적용·커밋 버튼 없음, `kubectl delete` 문자열 없음, 추가됨은 명령 없음, 명령은 텍스트 + 복사.
- AC-K22·K23: 편집 check(path 쿼리)→확인(비밀값·경로 불일치·여러 문서)→PUT confirm, 422 재확인, 409 충돌(덮어쓰기 없음), `metadata.json` 편집 버튼 없음.
- AC-K25(프론트 쪽): 라벨·메모 창, 휴지통 이동(ID 입력, `?confirm=`), 복원 `{}`·같은 ID 거부.
- AC-K26(프론트 쪽): 설정 없음 → 예시 없이 UnknownState + k8s 경로 안내.
- AC-K35·K36: 다른 클러스터 → 알 수 없음 + 계산 버튼 비활성, 계산 안 함 → `POST {force:true}`, 409 → 재조회.
- AC-K37(프론트 쪽): 저장 응답 `driftRecompute: scheduled`면 재계산 안내.
- AC-K38(프론트 쪽): 가린 값은 서버 문자열만 표시(원문을 만들지 않음).
- AC-K40(프론트 쪽): 배지 stale 매핑(서버 stale·kube 출처 stale).
- 계약 10.8 임대: 가짜 타이머로 60초 뒤 `POST {force:false}`, 언마운트 뒤 추가 요청 없음.

### 7. 남은 이슈·한계
- **실제 API·SSE로 확인하지 않았다.** 특히 `BASE_TOPICS`에 `snapshot-menu`가 들어가 있어, backend 스트림이 이 토픽을 모르는 이름으로 거부하면(400) **앱 전체 SSE가 연결되지 않는다**. backend 완료 후 가장 먼저 확인할 항목이다.
- 실제 연결 때 확인할 것: 모든 k8s 엔드포인트 응답 모양(특히 `files[].resourceKey`·`documents`·`duplicateOf`, `tree`, `counts`, 드리프트 `resources[]`·`lease`), `k8s-snapshots.drift` payload·`autoTargetId`, `snapshot-menu.*` payload, CORS/Origin(`POST …/drift`·`refresh`), mock 시나리오 10개 예시·전환(AC-K41~K44, 예시 `20260910-000000` 지난 결과 보기), 수백 파일 트리 성능, 헤드리스 브라우저 조작·스크린샷(1024/1280/1440·다크).
- 목록 행의 `scope`에는 제외 목록이 없어(계약 5절) `exclude` 모드 범위 문구를 `일부 제외 · <내보낸 네임스페이스>`로 보인다(디자인 예 `제외 batch`와 다름).
- Secret 참조 탭 안내 첫 문장을 `secret-refs.json`의 `note`로 바꾸는 규칙(디자인 8절)은 상세 응답에 `note`가 없어 고정 문구만 쓴다.
- `CLUSTER_SYNCING`·`SNAPSHOT_FILES_PENDING`의 `hourglass` 아이콘은 `UnknownState`에 아이콘 prop이 없어 Card + 아이콘으로 같은 모양을 흉내 냈다.
- PageHeader `status`에 `srPrefix`를 넘길 수 없어 상세 제목 옆 파일 상태 배지는 스크린리더에 `상태: 커밋 금지`로 읽힌다(디자인 `파일 상태: …`). 휴지통 이동 창·목록 셀은 `srPrefix`를 적용했다.
- 목록 머리의 PageHeader 아래 여백(24px)이 탭 줄 위에 그대로 있다(디자인 0px). 드리프트 셀 링크의 hover 배경(`bg.hover`)도 스타일이 없다.
- 브라우저 뒤로/앞으로는 AWS와 같은 가드를 쓴다(편집 중 확인). 상세 쿼리만 바뀌는 뒤로 가기는 URL 값을 따른다.

### 8. 다른 담당 요청
- `publisher 요청`
  1. `PageHeader.status`에 `srPrefix` 전달(상세 파일 상태 `파일 상태: `, 디자인 14절).
  2. `PageHeader`에 탭 줄 슬롯(또는 아래 여백 0 옵션) — 디자인 2.3 "탭이 머리의 일부, 여백 0".
  3. `UnknownState`에 `icon` prop(`hourglass`, 6.8 동기화 중·파일 확인 전).
  4. 표 안 링크 셀(드리프트 셀 전체 링크) hover `bg.hover` 스타일 또는 `DataTable` 링크 셀 지원(3.4).
- `backend 요청`
  1. 스트림이 `snapshot-menu`·`k8s-snapshots` 토픽을 받는지 먼저 확인해 주세요(프론트 기본 구독 = `overview,snapshot-menu`).
  2. (선택) 상세 `secretRefs`에 `note`, 목록 `scope`에 제외 목록 — 있으면 디자인 문구대로 바꿀 수 있다(없어도 동작).
- `designer 요청`(확인만): ① chips 줄 `드리프트 보기`/`드리프트 계산`을 링크 대신 버튼으로(탭 전환·편집 유지) ② `Secret 목록 없음` 보조 칩을 누를 수 있는 ghost sm 버튼으로 ③ `exclude` 모드 범위 문구 ④ 동기화 중 상태를 Card + hourglass로.
- `PM 요청`: 실제 API 연결 확인 때 7절 목록을 봐 주세요. `apps/web/.next`는 기본 주소(`http://localhost:3001`)로 다시 빌드된 상태다.

### 9. 다음 담당이 알아야 할 점
- 진입점: `app/snapshots/k8s/**` → `features/k8s-snapshots/{K8sListPage,K8sDetailPage,K8sTrashPage}.tsx`. AWS·k8s 목록 머리는 `features/snapshot-menu/SnapshotsHeader.tsx`.
- 스트림: 사이드바는 `stream.snapshotMenu`(기본 구독). k8s 화면은 `useK8sSnapshotsView()`가 `k8s-snapshots`를 구독하고 재조회 키 `seq`/`resetSeq`/`changedSeq(id)`/`removedSeq(id)`/`trashSeq`/`driftSeq(id)`, 배지 `driftFor(id)`를 준다.
- 상세 상태: `useDetailQuery()`(URL 쿼리), 편집 `useK8sFileEditor()`(열린 파일·세션·확인 창·이탈), 드리프트 `useDriftData(id, active)`(조회·계산·임대). 편집 컨트롤러가 상세 페이지에 있어서 상세 탭을 옮겨도 편집이 남는다.
- 파일 요청은 반드시 상세 `files[].path` 값만 `path` 쿼리로 보낸다(목록에 없는 경로는 요청하지 않음).
- 테스트: `features/k8s-snapshots/pages.test.tsx`는 `@/lib/api`의 `apiFetch`를 가로채 경로·메서드·본문·쿼리를 기록한다. 픽스처는 `features/__fixtures__/k8s-snapshots.ts`(계약 예시 값). 실제 API가 나오면 픽스처와 응답을 대조해 차이를 고친다.

## 2026-09-20 00:30 · 후속: 계약 변경·디자인 결정·publisher 새 prop 반영 + 실제 API(mock) 연결 확인

### 1. 요청 내용
- PM 후속 5건: ① backend 계약 변경(`docs/api/k8s-snapshot.md` 20절) 반영 ② designer 결정(3.4 exclude 문구, 4.2 드리프트 보기/계산 = Button ghost sm + `?view=drift` replace, 4.4 `Secret 목록 없음` ghost sm·칩 줄 28px 가운데 정렬, 6.8 hourglass) ③ publisher 새 prop(`PageHeader status.srPrefix`·`tabs`, `UnknownState icon`, `TableLinkCell`) ④ mock api :3031 + web :3032로 실제 연결·헤드리스 Chrome 확인 ⑤ 스크린샷 30장(`scratchpad/shots-k8s/`). lint·typecheck·vitest 3회·build 재확인, 자기 PID만 종료, `.next`는 기본 주소로 재빌드.

### 2. 참고한 문서
- `docs/api/k8s-snapshot.md` 5·6.3·20절, `docs/design/k8s-snapshot.md` 3.4·4.2·4.4·6.8·13절, `docs/reports/k8s-snapshot/publisher.md` 23:42 섹션, `docs/reports/k8s-snapshot/backend.md`

### 3. 작업 내용
1. **계약 변경 반영**
   - 타입: `scope.excludeNamespaces: string[]`, `secretRefs.note: string | null`, `counts.byNamespace[].namespace: string | null`.
   - 범위 문구: 제외 목록이 있으면 `제외 <목록>`, 없을 때만 `일부 제외 · 내보냄 <목록>` + 디자인 툴팁(`scopeRuleTooltip`).
   - Secret 참조 안내 첫 문장 = 서버 `note`(없으면 고정 문구). 리소스 수 네임스페이스 표에서 `null`은 `클러스터 범위`.
   - 확인만 하고 코드 변경이 필요 없던 것: "순서 다름"(`changed` + reason + list 값은 `FieldDiffTable`이 이미 reason을 표시), 조건부 기본값 reason(서버 문구 그대로 표시), `addedCheck: null`(`skipped_scope_unknown`일 때만 안내), `computing` 항상 false(버튼의 `계산 중`은 POST 대기로 이미 표시).
2. **디자인 결정 반영**: 드리프트 보기/계산은 이미 Button + `patch({view})`(URL replace)였음을 확인. 보조 칩 줄을 `alignItems: center`, `minHeight: 28`로 바꿨다.
3. **publisher 새 prop 적용**: 상세 `PageHeader status.srPrefix="파일 상태: "`, `SnapshotsHeader`의 `PageHeader tabs={<LinkTabs/>}`(AWS·k8s 목록), 동기화 중·파일 확인 전 = `UnknownState icon="hourglass"`(Card로 흉내 내던 것을 없앰), 목록 드리프트 셀 = `TableLinkCell`.
4. **실제 연결에서 찾아 고친 것 (내 영역)**
   - **임대 갱신이 실제로는 한 번도 가지 않던 버그**: 타이머를 응답 `generatedAt`마다 다시 걸었다. 그런데 요청 계산 중에는 `k8s-snapshots.drift`가 자주 와서 결과를 다시 조회하므로 60초에 닿지 못했다. 이제는 마지막 임대 요청(계산·갱신 POST) 시각을 기준으로 1초 간격으로 확인한다. 실제 확인 결과 60초 뒤 `{force:false}` 1회가 가고, 탭을 떠나면 70초 동안 추가 요청이 없다.
   - 지난 결과(전체 결과, 차이 없음)에서 `지난 결과 보기`를 누르면 빈 목록이 나오던 것을 `스냅샷과 클러스터가 같습니다`로 고쳤다.
   - 목록 표가 1440px에서 오른쪽 열(마지막 수정·동작)이 잘렸다. 파일·드리프트 열에 `maxWidth`를 주고 사유 1줄을 말줄임 + 툴팁으로 바꿨다. AWS 목록도 1024px에서 같은 문제라 상태·사유 열에 `maxWidth` 208을 줬다.
   - 안내 줄(ⓘ + 긴 문구)에서 아이콘과 글이 두 줄로 나뉘던 것을 고쳤다(`flexWrap: nowrap` + span).
   - 1024~1279px: 파일 탭은 4:8 비율을 유지한다(디자인 13절, `spanMd`). 드리프트 탭은 목록을 위(트리 약 280px)·차이를 아래로 쌓는다. 이를 위해 `common/hooks.ts`에 `useMediaQuery`를 추가했다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/k8s-snapshots/types.ts` | 수정 | `excludeNamespaces`, `secretRefs.note`, `byNamespace.namespace` null |
| `apps/web/src/features/k8s-snapshots/model.ts` | 수정 | exclude 문구·툴팁 |
| `apps/web/src/features/k8s-snapshots/hooks.ts` | 수정 | 임대 갱신 기준 = 마지막 임대 요청 시각 |
| `apps/web/src/features/k8s-snapshots/K8sListPage.tsx` | 수정 | `TableLinkCell`, 열 maxWidth·사유 말줄임, 범위 툴팁 |
| `apps/web/src/features/k8s-snapshots/K8sDetailPage.tsx` | 수정 | `srPrefix`, 보조 칩 줄 28px 가운데 |
| `apps/web/src/features/k8s-snapshots/DriftTab.tsx` | 수정 | `UnknownState icon`, 지난 결과 차이 없음, 1024 쌓기, 안내 줄 |
| `apps/web/src/features/k8s-snapshots/FilesTab.tsx` | 수정 | 1024 4:8, 안내 줄 |
| `apps/web/src/features/k8s-snapshots/InfoTabs.tsx` | 수정 | `note`, 클러스터 범위 네임스페이스 |
| `apps/web/src/features/k8s-snapshots/shared.tsx` | 수정 | 안내 줄 |
| `apps/web/src/features/k8s-snapshots/model.test.ts` | 수정 | exclude 문구 테스트 |
| `apps/web/src/features/snapshot-menu/SnapshotsHeader.tsx` | 수정 | `PageHeader tabs` |
| `apps/web/src/features/aws-snapshots/SnapshotListPage.tsx` | 수정 | 상태·사유 열 maxWidth·말줄임 |
| `apps/web/src/features/common/hooks.ts` | 수정 | `useMediaQuery` |
| `apps/web/src/features/__fixtures__/k8s-snapshots.ts` | 수정 | 새 필드 |

### 5. 주요 결정과 이유
- **임대 갱신 기준 시각**: 서버는 요청 시점부터 120초 임대를 준다(10.8). 따라서 기준은 "마지막으로 임대를 요청한 때"이지 "마지막으로 결과를 받은 때"가 아니다. 결과 재조회(SSE)는 임대를 늘리지 않는다.
- **1024 드리프트 탭 쌓기는 `useMediaQuery`**: 목록 높이를 넓은 화면(작업 영역)과 좁은 화면(280px)에서 다르게 둬야 해서, CSS(퍼블리셔 영역) 대신 인라인 높이로 처리했다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 | |
| `tsc --noEmit -p apps/web` | 통과 | |
| `npx vitest run` ×3 | **303 passed** ×3 | publisher 새 테스트 포함 |
| `npm run build` (기본 주소) | 통과 | 번들에 `localhost:3001`만 있음(3031 없음) 확인 |
| api mock `:3031`(`PORT=3031 DATA_SOURCE=mock CORS_ORIGIN=http://localhost:3032 npm run start:dev`) + web `:3032`(build + `next start`) | 기동 | |
| API 응답 모양 대조(node 스크립트) | 일치 | 목록 10행·facets·요약(`dashboardCluster`, `latestDrift`), 상세 `files`·`tree`·`counts`·`secretRefs.note`·`notices`·`cli.scan`, 드리프트 `resources`·`fields`·`lease`·`addedCheck`, 파일 `commands`, 휴지통 `cluster`·`fileCount`. 잘못된 path 400, refresh Origin 허용 200 / 다른 Origin 403, 다른 클러스터 POST 409 `K8S_DRIFT_UNAVAILABLE`+`details.reasonCode` |
| 헤드리스 Chrome 흐름(`scratchpad/flow.mjs`) | **41/41 통과** ×2, 브라우저 콘솔·네트워크 오류 0 | 아래 AC 목록 |
| 헤드리스 Chrome 임대(`scratchpad/lease.mjs`) | 통과(수정 후) | 수정 전에는 65초 동안 갱신 0회(버그) → 수정 후 60초 `{force:false}` 1회, 탭을 떠난 뒤 70초 동안 0회 |
| 스크린샷 30장 | 저장 | `C:\Users\thing\AppData\Local\Temp\claude\c--myscript-sentinel\9fb3458f-20c8-41d4-acf1-bc5178a75b8e\scratchpad\shots-k8s\{k8s-list,k8s-detail-files,k8s-detail-drift,k8s-trash,aws-list}-{1024,1280,1440}-{light,dark}.png`. 문서 가로 넘침 0. 1차 촬영에서 깨짐 4건(목록 열 잘림 k8s·AWS, 안내 줄 줄바꿈, 1024 쌓임 빈 공간)을 고친 뒤 다시 찍음 |
| 종료 | 자기 PID만 | api(npm 24300 → nest·node 트리, bash 6812), web(5160, 이전 9652·25548·9552), 헤드리스 Chrome(스크립트 종료). 3031·3032 해제 확인. 8756 등 다른 프로세스는 건드리지 않음 |

**AC-K별 (실제 API + 헤드리스 Chrome)**
- K16: 사이드바 `스냅샷` 합산 6(AWS 3 + k8s 3) + `/snapshots/k8s`에서 현재 위치. 탭 배지 AWS 3·Kubernetes 3·`차이 3`.
- K17: `/snapshots` = AWS 탭(현재 AWS), AWS 상세·휴지통 정상.
- K18: k8s 상세는 `/snapshots/k8s/<id>`만 연다.
- K20·K39: 내보내기·적용 버튼 없음, `kubectl diff/apply`는 복사만, `kubectl delete` 없음.
- K21: 상태 사유(비밀값 의심·부분 내보내기·YAML 해석 실패·경로 불일치·메타 손상·진행 중)가 행에 보임.
- K22·K23: 편집 → check → 확인 창(비밀값 + 경로 불일치) → PUT `confirm:["secret_errors","identity_changed"]` 200 → 재스캔 문구 → 파일 상태에 `경로와 내용 불일치`. `conflict-once` → 409 충돌 창.
- 상세 탭 전환 뒤에도 편집 내용 유지.
- K25: 휴지통 복원 `POST {}` 성공.
- K26: `not-configured`/`unavailable`/`read-only`/`write-disabled` 화면.
- K30·K31·K33: 숨긴 차이(기본값 4·관리 1), 관리 필드(HPA), 비교 불가 칩(ConfigMap·CronJob·NetworkPolicy).
- K35: `cluster-disconnected` → `클러스터 연결 없음`, 다른 클러스터 → 계산 버튼 비활성·서버 409.
- K36: 계산 안 함 → `드리프트 계산` = `POST {"force":true}`(`content-type: application/json`) → `요청 계산` 결과.
- K38: 가린 값 `값 다름 (de****(5자))`만 보임.
- K41: 기본 예시 10행.
- K43: `empty`·`not-configured`·`unavailable`·`read-only`·`write-disabled`·`conflict-once`·`cluster-disconnected`·`no-drift` 전환.
- K44: 드리프트 클러스터 값 `api:1.4.2` = 클러스터 화면 워크로드 이미지.
- 지난 결과: `20260910-000000` → `지난 계산 … 차이 없음` + `지난 결과 보기` → 안내.
- SSE: 스트림 요청 `topics=overview,k8s-snapshots,snapshot-menu`.
- 브라우저에서 직접 확인하지 않은 것: K24(경로 거부는 API 400만 확인), K28·K37의 30초 반영(클러스터·파일 외부 변경 재현 안 함), K40(kube stale은 단위 테스트만), 409 `K8S_DRIFT_UNAVAILABLE` 경쟁(버튼이 비활성이라 UI로 재현 불가 → fixture 테스트·API로만).

### 7. 남은 이슈·한계
- 목록 `범위` 1줄 `네임스페이스 5 · 종류 17`이 136px 열에서 말줄임된다(디자인 폭 그대로). 2줄 규칙 문구에는 툴팁이 있다.
- AWS 목록 1024px에서 동작 열의 휴지통 아이콘이 표 오른쪽 끝에 몇 px 붙어 보인다(잘림은 아님). 열 폭 합이 본문 폭과 거의 같아서다.
- 상세 제목 옆 aria-live 문구(디자인 14절 `스냅샷 파일 상태 …`)는 없다(publisher 보고서 7절과 같음).
- 스크린샷 비교(이전 대비 차이 자동 검사)는 하지 않았다. 눈으로 본 것은 1440 라이트(목록·파일·드리프트), 1024 라이트·다크 일부, 1280 다크 휴지통이다.

### 8. 다른 담당 요청
- `designer 요청`(확인만): ① 목록 `범위` 1줄 문구가 136px에서 말줄임되는 것을 허용할지(`NS 5 · 종류 17` 같은 줄임 표기 검토) ② 1024 드리프트 탭 목록 높이(머리 포함 380px, 트리 약 280px).
- publisher·backend 요청 없음.

### 9. 다음 담당이 알아야 할 점
- 검증 스크립트(커밋 안 함): `scratchpad/cdp.mjs`(최소 CDP 드라이버, 전용 프로필), `flow.mjs`(41항목), `lease.mjs`(임대·AC-K44), `shots.mjs`(스크린샷), `probe.mjs`(API 모양).
- `.next`는 기본 주소(`http://localhost:3001`)로 다시 빌드해 두었다.
- 임대 갱신은 `useDriftData`의 `leaseSentAt` 기준이다. 결과를 다시 조회해도 임대 타이머는 리셋되지 않는다.
