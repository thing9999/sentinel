# 화면 설계: k8s-snapshot (Kubernetes 스냅샷 + 드리프트)

- 작성: designer, 2026-09-19
- 명세: `docs/specs/k8s-snapshot.md` (Q1~Q4 모두 권장안으로 확정: Q1 Secret은 읽지 않고 참조 이름만 `secret-refs.json`, Q2 드리프트는 사이드바 메뉴 상태에 넣지 않음(탭·목록에만), Q3 대시보드 RBAC 확대 없음 → RBAC 밖 종류는 "비교 불가", Q4 클러스터 ID 없는 스냅샷은 드리프트 "알 수 없음")
- **재사용 원칙**: 목록·상세·편집기·저장 흐름·확인 창·휴지통·쓰기 불가 표시는 `docs/design/aws-snapshot-manager.md`(이하 **ASM-D**)를 그대로 쓴다. 이 문서는 **다른 점만** 정의한다. 절 번호를 적은 곳은 "ASM-D n.n 그대로"라는 뜻이다.
- 공통: `docs/design/shell.md`(3.1 메뉴 9번 라벨 "스냅샷"), `docs/design/status.md`(1.2 드리프트 문구, 1.3 보조 라벨, 5.2 정렬, 10절 이 기능 규칙), `docs/design/components.md`(14절 새 컴포넌트, 15절 기존 컴포넌트 확장, 13절 아이콘), `docs/design/tokens.json`(**새 토큰 없음**, 이유는 `status.md` 10.6)
- 그리드: 12열, gutter 16px. 기준 폭 1440px(사이드바 펼침 232px → 본문 1160px). 열 폭 계산: 1열 = 82px, n열 = 82n + 16(n−1) → 3열 278 · 4열 376 · 5열 474 · 7열 670 · 8열 768 · 12열 1160px.
- API 계약: `docs/api/k8s-snapshot.md`(이하 **K8S-API**). 2026-09-19 계약과 대조해 필드 이름·값·사유 코드를 맞췄다(16절 매핑표).
- 화면 어디에도 **내보내기·적용·커밋·삭제 명령 실행 버튼을 두지 않는다.** 드리프트 화면의 `kubectl` 명령은 텍스트 + 복사 버튼뿐이다. 추가된 리소스에 대해 `kubectl delete` 같은 삭제 명령은 예시로도 보이지 않는다.

## 0. 화면 목록

| # | 화면 | 경로 (제안, 최종은 프론트) | 형태 |
|---|---|---|---|
| 1 | 스냅샷 목록 · AWS 탭 | `/snapshots` (기존 그대로) | 페이지 (ASM-D 3절 + 2.3 탭 머리) |
| 2 | 스냅샷 목록 · Kubernetes 탭 | `/snapshots/k8s` | 페이지 |
| 3 | Kubernetes 스냅샷 상세 | `/snapshots/k8s/[id]` (`?view=files\|drift\|3d\|counts\|secrets\|meta`) | 페이지 + 상세 탭 **6개**(`3d`는 `snapshot-3d.md` 2.1, 2026-09-20 추가) |
| 4 | Kubernetes 휴지통 | `/snapshots/k8s/trash` | 페이지 |
| 5 | AWS 상세·AWS 휴지통 | `/snapshots/[id]`, `/snapshots/trash` (기존 그대로) | ASM-D 4·7절 그대로 |
| 6 | 라벨·메모 편집 / 저장 전 확인 / 저장 충돌 / 저장하지 않은 변경 / 휴지통 이동 / 복원 / 영구 삭제 | 상세·목록·휴지통 | ASM-D 6절 + 10절의 차이 |
| 7 | 스캔 규칙과 처리 방법 | 파일 탭 스캔 패널 | Drawer md 480px (ASM-D 4.5 + 쿠버네티스 규칙) |

## 1. 정보 우선순위

1. **커밋하면 안 되는 스냅샷이 있는가** — 사이드바 숫자(AWS+k8s 합), 탭의 커밋 금지 숫자, 요약 띠 `커밋 금지 N`, 표의 `파일` 열
2. **왜 안 되고 어디를 고치나** — 판단 사유(규칙 ID), 파일 탭의 스캔 발견 → 파일·줄
3. **지금 클러스터가 기록과 다른가** — `드리프트` 열·배지(`차이 N건`), 드리프트 탭의 변경·삭제·추가 목록과 필드 차이
4. 이 스냅샷이 무엇인가 — 시각, 라벨·메모, 클러스터, 범위, 리소스 수
5. 복원 준비 정보 — Secret 참조, 리소스 수, 메타데이터, CLI 안내

- 파일 상태(1·2)가 드리프트(3)보다 앞선다: 파일 상태는 "커밋하면 비밀값이 새는가"라는 즉시 위험이고, 드리프트는 "기록과 다르다"는 정보다(명세 4.6 "드리프트는 장애가 되지 않는다"). 그래서 상세 제목 옆 배지는 파일 상태가 lg, 드리프트는 그 아래 줄 md다.

---

## 2. 메뉴 · 탭 · URL

### 2.1 사이드바 메뉴 (`shell.md` 3.1 9번)

| 항목 | 이전 | 이후 |
|---|---|---|
| 라벨 | `AWS 스냅샷` | **`스냅샷`** |
| 아이콘·그룹·경로 | `archive` · `로컬 파일` · `/snapshots` | **그대로** |
| 상태 아이콘 | AWS 스냅샷 상태 최악 | **AWS·k8s 파일 상태 중 최악**(서버 값). 드리프트는 넣지 않는다(Q2). 한쪽이 설정 없음이면 그쪽은 빼고, 둘 다 설정 없음이면 아이콘을 그리지 않는다 |
| 숫자 배지 | AWS 커밋 금지 수 | **AWS + k8s 커밋 금지 수의 합**(서버 값. 화면이 더하지 않는다) |
| 현재 위치 강조 | `/snapshots` 아래 | `/snapshots`로 시작하는 모든 경로(`/snapshots/k8s/**` 포함) |
| 접힘 툴팁 | `AWS 스냅샷 · 커밋 금지 2개` | `스냅샷 · 커밋 금지 3개` |
| 스크린리더 | `, 커밋 금지 2개` | 같은 형식(합계 숫자) |

### 2.2 URL 설계 (기존 호환 필수, 명세 5.5)

| 경로 | 여는 것 | 비고 |
|---|---|---|
| `/snapshots` (+ `?status=&region=&q=`) | AWS 탭 목록 | 기존 즐겨찾기·쿼리 그대로. **탭 쿼리 없이 열면 AWS** |
| `/snapshots/[id]` | AWS 스냅샷 상세 | 기존 그대로. 브레드크럼 `AWS 스냅샷 › ID`도 그대로 |
| `/snapshots/trash` | AWS 휴지통 | 기존 그대로 |
| `/snapshots/k8s` (+ `?status=&drift=&cluster=&q=&sort=`, 값은 K8S-API 6.2 그대로) | Kubernetes 탭 목록 | `k8s`는 ID 형식 `^\d{8}-\d{6}$`와 겹치지 않는다 |
| `/snapshots/k8s/[id]` (+ `?view=&file=&line=&res=&kind=&hidden=`, 3D 보기 쿼리는 `snapshot-3d.md` 2.2) | Kubernetes 스냅샷 상세 | 같은 ID가 AWS 쪽에 있어도 이 경로는 k8s만 연다. 없으면 404 화면(4.9). **다른 종류로 자동 이동하거나 "AWS에서 찾기" 같은 추측 링크를 두지 않는다** |
| `/snapshots/k8s/trash` | Kubernetes 휴지통 | |

- 탭 전환은 **링크 이동**이다(탭 상태를 쿼리로 두지 않는다). 이유: 두 탭의 필터 쿼리 이름이 다르고(`region` ↔ `drift`·`cluster`), 기존 `/snapshots?status=…` 링크가 AWS를 연다는 약속을 쿼리 충돌 없이 지키기 위해.
- 탭 링크는 해당 탭의 **쿼리 없는 기본 경로**로 간다. 다른 탭으로 갔다 돌아왔을 때 필터는 초기화된다(브라우저 뒤로 가기로는 복원된다).
- 탭은 **목록 페이지 두 곳에만** 보인다. 상세·휴지통은 브레드크럼으로 돌아간다(편집 작업 영역 높이를 줄이지 않기 위해).

### 2.3 목록 페이지 머리 (두 탭 공통, ASM-D 3.1 머리를 바꾼다)

```
PageHeader: "스냅샷"                                              [휴지통 3] [>_ 새 스냅샷 만들기 안내 ⌄]
SnapshotTabs (LinkTabs 40px) ─────────────────────────────────────────────────────────────────────
 [ AWS  ⊗ (2) ]  [ Kubernetes  △ (1)  ▣ 차이 3 ]
─────────────────────────────────────────────────────────────────────────────────────────────────
 탭 안내 줄(caption): deploy/k8s-snapshot CLI로 내보낸 로컬 스냅샷입니다. 대시보드는 이 파일에만 쓰고, …
[mock InlineAlert] [쓰기 불가 Banner] [SummaryStrip] …(탭별 본문)
```

| 요소 | 사양 |
|---|---|
| PageHeader 제목 | h1 `스냅샷`(두 탭 공통). 이전 `AWS 스냅샷` 제목은 탭 라벨로 옮긴다 |
| PageHeader 액션 | **현재 탭 기준**: `휴지통` 링크(AWS → `/snapshots/trash`, k8s → `/snapshots/k8s/trash`, 숫자는 그 탭 휴지통 수) + `새 스냅샷 만들기 안내`(그 탭의 CliGuide 토글). 모양은 ASM-D 3.1 그대로. 출처 unknown이면 두 버튼 숨김(ASM-D 3.7) |
| 탭 줄 | `LinkTabs`(components.md 14.1). PageHeader 아래 여백 24px 대신 **0px**(탭이 머리의 일부), 탭 줄 아래 1px `border.subtle` 전체 폭 |
| 탭 항목 | 패딩 0 16px, 높이 40px, 항목 간 0px. 내용(왼→오, 간격 6px): 라벨 body 14/20(선택 600) → 상태 아이콘 14px(`GET /api/snapshot-menu`의 `tabs.<aws\|k8s>.status`, `ok`는 그리지 않음, `unknown`·`stale`은 그림. `included: false`면 그리지 않음) → 커밋 금지 숫자 pill(`tabs.*.critical`, NavCount와 같은 모양: 높이 18px, 최소 폭 18px, 패딩 0 5px, radius pill, `status.crit.bg`/`border`/`fg`, micro 11/14 600 tabular, 1 이상일 때만) → (Kubernetes 탭만) 드리프트 칩 |
| 드리프트 칩 (k8s 탭) | `tabs.k8s.latestDrift.drift`의 사유가 `DRIFT_DIFF`(차이 N건)일 때만: Chip neutral sm, 아이콘 `git-compare` 12px, 문구 `차이 3`, 툴팁 `최신 스냅샷 드리프트: 차이 3건 (변경 2 · 삭제 1) · 15:12 계산`. `차이 없음`·알 수 없음·계산 전이면 그리지 않는다. **상태 색·삼각형 아이콘을 쓰지 않는다**(탭의 상태 아이콘은 파일 상태 전용) |
| 탭 스크린리더 | `Kubernetes, 커밋 금지 1개, 드리프트 차이 3건` / `AWS, 주의`. 현재 탭 `aria-current="page"` |
| 탭 로딩 | 서버 집계 전에는 라벨만(아이콘·숫자 자리 비움, 스켈레톤 없음 — 탭 폭 흔들림 12px 이하) |
| 탭 안내 줄 | 탭 줄 아래 12px, caption `text.secondary`, 1줄. AWS: 기존 ASM-D 3.1 보조 줄 문구 그대로. Kubernetes: `deploy/k8s-snapshot CLI로 내보낸 로컬 스냅샷입니다. 대시보드는 이 파일에만 쓰고, 드리프트를 계산할 때 클러스터를 읽기만 합니다.` 아래 16px에 mock 안내·Banner·요약 띠 |

- AWS 탭 본문(요약 띠·FilterBar·표·빈 상태·CliGuide)은 **ASM-D 3.2~3.7 그대로**다. 바뀌는 것은 머리(제목·탭)뿐이다.

---

## 3. Kubernetes 목록 `/snapshots/k8s`

### 3.1 레이아웃 (1440px, 본문 1160px)

```
(2.3 머리)
[mock InlineAlert] [쓰기 불가 Banner]
┌ SummaryStrip (12열, 88px) ────────────────────────────────────────────────────────────────────────┐
│ [⊗ 커밋 금지] 커밋 금지 1개 · 20260919-061000 …  │ 전체 │ 커밋 금지 │ 주의 │ 알 수 없음 │ 최신 드리프트 │ 마지막 확인 [↻] │
│ 📁 deploy/k8s-snapshot/snapshots · 🖥 prod-eks     │  12  │ ⊗ 1       │ △ 3  │ ? 1        │ ▣ 차이 3건     │ 15:12:10        │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
[CliGuide 펼침 영역]
FilterBar: [파일: 전체 ▾] [드리프트: 전체 ▾] [클러스터: 전체 ▾] [🔍 라벨·메모 검색]        스냅샷 12개 중 12개 표시
┌ DataTable (comfortable 56px) ─────────────────────────────────────────────────────────────────────┐
│ 파일 │ 드리프트 │ 스냅샷 │ 클러스터 │ 범위 │ 리소스 │ 현재 스캔 │ 마지막 수정 │ 동작 │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 요약 띠 (ASM-D 3.2와 다른 점)

| 요소 | 사양 |
|---|---|
| 왼쪽 블록 | **파일 상태만**(ASM-D와 같음). 드리프트는 왼쪽 블록 상태에 넣지 않는다 |
| 왼쪽 둘째 줄 | 폴더 아이콘 + 폴더 위치(최대 폭 200px → **160px**, 가운데 말줄임) + 12px + 아이콘 `server` 14px `text.tertiary` + `대시보드 클러스터` caption `text.tertiary` + 4px + 클러스터 이름 mono 12/20(최대 폭 120px 말줄임, 툴팁 `prod-eks · 컨텍스트 sentinel-prod`). 값은 `summary.dashboardCluster`(`name`, `context`). `state`가 `not_configured`/`unavailable`이면 `클러스터 연결 없음`, `syncing`이면 `클러스터 동기화 중`, `id`가 `null`이면 이름 뒤 `(확인 불가)`(모두 `text.tertiary`, 아이콘 `circle-help`). 인식하지 못한 항목 Chip은 ASM-D 그대로(자리가 모자라면 이 줄 끝에서 말줄임되지 않고 폴더 위치가 먼저 줄어든다) |
| 항목 | `전체`, `커밋 금지`, `주의`, `알 수 없음` (ASM-D 그대로) + **`최신 드리프트`** |
| `최신 드리프트` 항목 | 값: `summary.latestDrift.drift`를 `DriftStatus` size sm(14.3)으로 — `차이 3건`(warn 아이콘 16px + metricMd 숫자) / `차이 없음`(ok 아이콘) / `알 수 없음`(unknown 아이콘) / `latestDrift: null`(자동 대상 없음)이면 `—`(`text.tertiary`). 라벨 아래 줄 없음. href: 최신 스냅샷 상세 `?view=drift`. 툴팁 `20260919-061000 기준 · 15:12 계산` |
| 폭 | 왼쪽 320px + 항목 5개(최소 120px) + 오른쪽 마지막 확인(약 180px) = 1100px 이하. 1280px 미만은 항목 최소 폭 96px(ASM-D 10절) |

### 3.3 FilterBar

| 컨트롤 | 사양 |
|---|---|
| 파일 | MultiSelect width 184px, 버튼 문구 `파일: 전체` / `파일: 커밋 금지` / `파일: 2개`. 옵션 ASM-D 3.3 상태 옵션 그대로 |
| 드리프트 | MultiSelect width 184px, `드리프트: 전체`. 옵션 순서와 API 값(`drift`): `차이 있음`(warn 아이콘) = `warning` → `알 수 없음`(unknown 아이콘) = `unknown` → `차이 없음`(ok 아이콘) = `ok` → `계산 안 함`(아이콘 `minus` `text.tertiary`) = `not_computed`. 개수는 `facets.drift`. `not_computed`는 지난 결과가 있는 스냅샷(`mode: last_result`)도 포함한다 |
| 클러스터 | Select width 200px, `클러스터: 전체`. 옵션과 API 값(`cluster`): `연결된 클러스터 (prod-eks)` = `same` / `다른 클러스터` = `other` / `확인할 수 없음` = `unknown`(스냅샷 ID 없음 또는 대시보드 클러스터 ID를 모름). 개수는 `facets.cluster`. 클러스터 이름별 옵션은 두지 않는다 |
| 검색 | SearchInput width 240px, placeholder `라벨·메모·ID·컨텍스트 검색`(API `q`가 이 네 가지에 부분 일치) |
| URL | 쿼리 이름·값을 API와 같게: `?status=critical,warning&drift=warning,not_computed&cluster=same&q=…&sort=snapshotAt:desc`. 화면 문구로 바꾸는 것은 표시 단계에서만 |

### 3.4 스냅샷 표 (`DataTable` density `comfortable` 56px)

| 열 | 폭 | 1줄 | 2줄 | 정렬 |
|---|---|---|---|---|
| 파일 | 176px | StatusBadge sm (`커밋 금지`/`주의`/`알 수 없음`/`정상`) | ReasonText 1줄(ASM-D 3.4 상태·사유 열과 같음) | 가능: 나쁜 순 → 시각 최신순 |
| 드리프트 | 160px | `DriftStatus` sm (3.5 표) | 사유: `변경 2 · 삭제 1` / `다른 클러스터` / `지난 결과 차이 3건 · 9월 18일` | **불가**(API 정렬 키는 `snapshotAt`·`status`뿐. 드리프트로 모아 보려면 필터를 쓴다) |
| 스냅샷 | flex, 최소 168px | 로컬 시각(ASM-D 3.4와 같음) | 라벨 + 메모 아이콘(ASM-D 같음) | 가능(**기본: 최신순**) |
| 클러스터 | 144px | 클러스터 이름(`cluster.name`, 없으면 `cluster.context`, `cluster`가 `null`이면 `—`) mono 12/20, 1줄 말줄임, 툴팁 `이름 prod-eks · 컨텍스트 sentinel-snapshot · v1.30.4-eks` | `cluster.relation`: `same` → caption `text.tertiary` `연결된 클러스터`. `other` → 아이콘 `link-2-off` 12px + `다른 클러스터`(`text.secondary`). `unknown` 또는 `cluster: null` → `circle-help` 12px + `확인할 수 없음` | 불가 |
| 범위 | 136px | `네임스페이스 5 · 종류 14` tabular | 규칙 요약 1줄 말줄임: `시스템 제외 전체` / `포함 app, data` / `exclude` 모드는 목록 응답에 제외 목록이 없는 동안 `일부 제외 · 내보냄 data, prod`(`scope.namespaces` = 내보낸 네임스페이스, 쉼표+공백 구분), 제외 목록 필드가 생기면 `제외 batch`. 시스템 네임스페이스 포함이면 끝에 ` · 시스템 포함`. 툴팁 전체(`exclude` 임시 문구의 툴팁: `네임스페이스 제외 규칙 사용 · 내보낸 네임스페이스: data, prod (제외 목록은 상세 메타데이터 탭)`) | 불가 |
| 리소스 | 96px, 오른쪽 | `128` tabular. 내보내기 당시와 다르면 숫자 앞 아이콘 `pencil` 12px `text.tertiary`(툴팁 `내보내기 당시 130개`) | `직전 −2`(부호 필수 U+2212, 같은 클러스터의 이전 스냅샷 대비, 툴팁 `20260918-061000 대비`). 이전 없음 `직전 -` | 불가 |
| 현재 스캔 | 96px | ScanCounts sm stacked(ASM-D 같음) | | 불가 |
| 마지막 수정 | 112px | Timestamp auto(날짜 포함) | `대시보드에서 수정`(ASM-D 같음) | 불가 |
| 동작 | 72px, 가운데 | IconButton sm `tag` + 4px + `trash-2`(ASM-D 같음, 항상 보임) | | - |

- 열 합: 176+160+168+144+136+96+96+112+72 = 1,160px.
- **CLI 버전 열은 두지 않는다**(명세 5.2 항목). 스냅샷 열 시각 툴팁 셋째 줄 `k8s-snapshot 0.1.0`과 상세 메타데이터 탭에 보인다. 이유: 파일·드리프트 두 상태 열을 넣으면서 1160px 안에 모든 열을 넣을 수 없고, 버전은 목록에서 비교할 일이 가장 적다.
- 행 클릭 → 상세(`?view=files`). **드리프트 셀 클릭 → 상세 `?view=drift`**(셀 전체가 링크, 동작 버튼과 같이 행 이동을 막는다. 셀 hover 시 `bg.hover` 위에 밑줄 없는 링크 모양, 포커스 가능).
- crit 행 막대: 파일 상태가 crit일 때만(`status.md` 5.1). 드리프트는 행 막대를 만들지 않는다.
- 새 행 강조·재정렬 보류는 적용하지 않는다(ASM-D 3.4와 같은 이유).

### 3.5 드리프트 셀 (`DriftStatus` sm) 모습

`DriftBadge`(K8S-API 5절) → 모습. 판단 순서: ① `status.stale` → ② 사유 코드 `DRIFT_NOT_COMPUTED` → ③ `status.status`. `computing: true`는 어느 경우든 1줄 배지 뒤 4px에 Spinner 12px(`aria-label="갱신 중"`)만 더한다(값은 그대로).

| `DriftBadge` | 1줄 | 2줄 |
|---|---|---|
| `status: warning` (`DRIFT_DIFF`), mode `auto`/`on_demand` | StatusBadge sm warn, 문구 `차이 N건`(N = `counts.added + deleted + changed`) | `변경 2 · 삭제 1`(`counts`에서 0인 구분 생략, 순서 변경 → 삭제 → 추가) |
| `status: ok` (`DRIFT_NO_DIFF`) | StatusBadge sm ok, `차이 없음` | 비움 |
| `status: unknown` + 그 밖의 사유 코드 | StatusBadge sm unknown, `알 수 없음` | 사유 짧은 문구(3.5.1 표) |
| `DRIFT_NOT_COMPUTED`, mode `none` | 배지 없음. 아이콘 `minus` 12px + caption `계산 안 함` `text.tertiary` | 비움 |
| `DRIFT_NOT_COMPUTED`, mode `last_result` | 위와 같음 | caption `text.tertiary`: `lastResultStatus`가 `warning`이면 `지난 결과 차이 3건 · 9월 18일 14:02`, `ok`면 `지난 결과 차이 없음 · 9월 18일 14:02`(`computedAt`). 상태 아이콘·색 없음. 전체 결과 보관 여부(`resultAvailable`)는 목록에 표시하지 않는다 |
| 계산 요청 대기(이 화면이 보낸 `POST` 응답 전) | Spinner 12px + caption `계산 중` `text.secondary` | 비움 |
| `status.stale: true` | StatusBadge sm stale `데이터 오래됨 · 15:12:10 기준`(툴팁 `마지막 결과: 차이 3건`) | 이전 사유를 `status.stale.valueText` 색으로 |

#### 3.5.1 드리프트 사유 코드 → 표시 문구 (K8S-API 11.3)

목록 2줄·상세 chips 줄에는 **짧은 문구**, 드리프트 탭에는 서버 `text`와 제목·안내(6.8)를 쓴다. 표에 없는 코드가 오면 서버 `text`를 그대로 쓴다.

| code | 목록 2줄 (짧은 문구) | 계산 버튼 비활성 사유(`actions.computeDrift.reasonText`가 없을 때 대체) |
|---|---|---|
| `DRIFT_DIFF` / `DRIFT_NO_DIFF` | 3.5 표 | (가능) |
| `DRIFT_NOT_COMPUTED` | 3.5 표 | (가능) |
| `CLUSTER_NOT_CONNECTED` | `클러스터 연결 없음` | `클러스터 연결 없음` |
| `CLUSTER_SYNCING` | `클러스터 동기화 중` | `클러스터 동기화 중` |
| `DASHBOARD_CLUSTER_UNKNOWN` | `대시보드 클러스터 확인 불가` | `대시보드가 연결된 클러스터를 확인할 수 없음` |
| `CLUSTER_MISMATCH` | `다른 클러스터` | `다른 클러스터의 스냅샷` |
| `CLUSTER_ID_MISSING` | `클러스터 확인 불가` | `스냅샷의 클러스터를 확인할 수 없음` |
| `SNAPSHOT_FILES_PENDING` | `파일 확인 전` | `스냅샷 파일 확인 전` |
| `NO_COMPARABLE_RESOURCES` | `비교할 리소스 없음` | `비교할 수 있는 리소스 없음` |
| `DRIFT_RULES_UNAVAILABLE` | `규칙을 불러올 수 없음` | `드리프트 규칙을 불러올 수 없음` |
| `DRIFT_FAILED` | `계산 실패` | (가능 — 다시 시도) |

- `DASHBOARD_CLUSTER_UNKNOWN`과 `CLUSTER_ID_MISSING`은 둘 다 "확인할 수 없음"이지만 **어느 쪽을 모르는지**가 다르다. 짧은 문구에서도 `대시보드`를 붙여 구분한다.
- `CLUSTER_SYNCING`은 기다리면 풀리는 상태라 오류처럼 보이지 않게 한다(드리프트 탭 아이콘 `hourglass`, 6.8).

- "계산 안 함"은 **상태가 아니다**. 배지 모양을 쓰지 않아 파일 상태 배지와 나란히 있어도 헷갈리지 않는다.

### 3.6 새 스냅샷 만들기 안내 (`CliGuide`, ASM-D 3.6 구조 그대로)

| 요소 | Kubernetes 탭 내용 |
|---|---|
| 첫 줄 | `새 스냅샷은 터미널에서 CLI로 만듭니다. 대시보드는 이 명령을 실행하지 않습니다.` |
| 단계 (CommandSteps) | 명령·문구는 **서버 `cli` 값**(K8S-API 6.2)을 쓴다. ① 설치 `cli.install` ② 설정: 텍스트 `cli.configure`(예 `deploy/k8s-snapshot/.env.example 을 .env 로 복사한 뒤 KUBE_CONTEXT 를 채우세요`) + 아래 8px에 설정 목록(`cli.settings`, 서버 순서): 한 줄 24px, 이름 인라인 코드(mono 12, `code.bg`, 패딩 0 4px, radius 4px) + `required`면 6px 뒤 Chip neutral sm `필수` + 8px + caption `text.secondary` 설명(`text`). 전체 목록은 README 안내 ③ 미리 보기 `cli.dryRun` ④ 내보내기 `cli.export` ⑤ 재스캔 `cli.scan`(상세에서는 ID가 채워진 값) |
| 종료코드 표 | 서버 `cli.exitCodes`(0~4). DataTable compact, 열 **2개**: `코드`(56px, mono) / `뜻`(서버 `text`, 폴더가 남는지·지워지는지는 문구 안에 있음). AWS의 `스냅샷 폴더` 열은 두지 않는다 |
| 안내 줄 (caption `text.secondary`, 아이콘 14px, 줄 간 8px) | `info` `내보내기 전용 읽기 역할과 컨텍스트는 deploy/k8s-snapshot/README.md를 따르세요. 대시보드 권한(sentinel-readonly)을 쓰지 않습니다.` / `hand` `대시보드에는 적용 기능이 없습니다. kubectl diff로 확인한 뒤 kubectl apply를 직접 실행하세요.` / `database` `Postgres 데이터와 PV 내용은 담지 않습니다. pg_dump 또는 EBS 볼륨 스냅샷으로 따로 보관하세요.` / `git-branch` `이 스냅샷을 운영 매니페스트의 출발점으로 쓰려면 README 'git으로 관리 시작하기'를 보세요.` |
| 펼침 저장 | localStorage `sentinel.snapshots.k8s.cliGuide`(AWS와 따로) |

### 3.7 목록 상태별 모습

ASM-D 3.7 표를 그대로 쓰고 문구·경로만 바꾼다.

| 상태 | 다른 점 |
|---|---|
| 스냅샷 0개 | EmptyState 아이콘 `archive`, 제목 `아직 Kubernetes 스냅샷이 없습니다`, 설명 같은 문장 + CliGuide(3.6) |
| 설정 없음 | hint ①~③의 경로를 `deploy/k8s-snapshot/snapshots`로. ③ `EKS에 배포한 대시보드에서는 이 기능을 쓰지 않습니다.` 그대로 |
| 클러스터 연결 없음 | 목록은 그대로(파일 관리는 클러스터와 무관). 요약 띠 `최신 드리프트` = 알 수 없음, 드리프트 열 = 알 수 없음 `클러스터 연결 없음` |
| AWS 쪽만 설정 없음 | Kubernetes 탭은 정상. AWS 탭 상태 아이콘 없음(2.1) |

---

## 4. Kubernetes 스냅샷 상세 `/snapshots/k8s/[id]`

### 4.1 레이아웃 (1440px, 본문 1160px)

```
Kubernetes 스냅샷 › 20260919-061000                                                  (브레드크럼)
9월 19일 15:10 스냅샷  [⊗ 커밋 금지] 비밀값 의심 1건 (k8s-env-literal)
  드리프트 [△ 차이 3건] 변경 2 · 삭제 1 · 15:12 계산  [드리프트 보기 →]                     (chips 줄)
  ID 20260919-061000 (UTC) [⧉] · prod-eks · 컨텍스트 sentinel-snapshot · k8s-snapshot 0.1.0   [🏷 라벨·메모 편집] [🗑 삭제]
[쓰기 불가 Banner / 내보내기 진행 중 InlineAlert — 해당 시]
┌ A. 요약 Card (12열) — 판단 사유 7열 │ 라벨·메모 5열 / 보조 칩 / 안내 ────────────────────────────┐
└──────────────────────────────────────────────────────────────────────────────────────────────┘
Tabs 40px: [⊗ 파일] [드리프트 3] [3D 보기] [리소스 수] [Secret 참조 7] [메타데이터]
┌ 탭 패널 ────────────────────────────────────────────────────────────────────────────────────┐
│ 파일: ┌ 탐색 패널 4열 ┐┌ 파일 편집기 8열 ┐                                                    │
│ 드리프트: 요약 Card 12열 / ┌ 리소스 목록 4열 ┐┌ 리소스 차이 8열 ┐                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- A 요약과 탭 사이 24px, 탭 줄과 패널 사이 16px.
- 상세 탭 상태는 URL `?view=`(기본 `files`)에 둔다. 새로고침·링크 공유로 같은 탭이 열린다.

### 4.2 PageHeader

| 요소 | 사양 |
|---|---|
| 브레드크럼 | `Kubernetes 스냅샷 › 20260919-061000`(ID mono). `Kubernetes 스냅샷`은 `/snapshots/k8s` 링크 |
| 제목 | h1 `9월 19일 15:10 스냅샷`(ASM-D 4.2 같음) |
| 제목 옆 (`status`) | **파일 상태** StatusBadge lg + ReasonText(ASM-D 같음). aria-live 문구 `스냅샷 파일 상태 커밋 금지: …` |
| chips 줄 (제목 아래 8px) | `LabeledStatus`(14.2): 라벨 `드리프트` + `DriftStatus` md + 사유 + 계산 시각 caption `text.tertiary` `· 15:12 계산` + 8px + **Button ghost sm**(`<button>`, 링크 아님) `드리프트 보기`(아이콘 `chevron-right` 16px 오른쪽, 누르면 상세 탭을 `drift`로 바꾸고 URL `?view=drift`는 replace로 맞춤. 이미 드리프트 탭이면 숨김). 계산 안 함이면 `드리프트 — 계산 안 함`(mode `last_result`면 뒤에 `· 지난 결과 차이 3건 · 9월 18일`) + **Button ghost sm** `드리프트 계산`(누르면 드리프트 탭으로 바꾼 뒤 계산 요청). 둘 다 같은 상세 안의 탭 전환이라 버튼으로 두고, 편집 중이어도 이탈 확인을 띄우지 않으며 열린 파일·편집 내용을 유지한다(4.5, 2026-09-19 구현 반영). 버튼 표시 조건은 `actions.computeDrift.allowed`. 계산 불가(알 수 없음)면 배지 + 사유(3.5.1 짧은 문구)만 |
| 보조 줄 | caption `text.secondary`: `ID` + ID mono + CopyButton sm · 클러스터 이름(mono) · `컨텍스트` + 컨텍스트 mono · `k8s-snapshot 0.1.0`. 다른 클러스터면 클러스터 이름 뒤 4px에 아이콘 `link-2-off` 12px + `다른 클러스터`. 메타 손상이면 클러스터·버전 자리 `메타데이터 없음` |
| 오른쪽 액션 | ASM-D 4.2 그대로(`라벨·메모 편집`, `삭제`). **내보내기·적용·커밋·드리프트 적용 버튼 없음** |

- 파일 상태 lg, 드리프트 md로 크기를 다르게 두는 이유: 1절 우선순위. 두 배지를 같은 줄에 두면 `주의`와 `차이 N건`(둘 다 warn 삼각형)이 한 덩어리로 읽힌다. 줄과 라벨(`드리프트`)로 나눈다.

### 4.3 상단 알림

ASM-D 4.3 그대로(읽기 전용·쓰기 꺼짐 Banner, 내보내기 진행 중일 수 있음 InlineAlert `hourglass`).

### 4.4 A. 요약 Card (ASM-D 4.4와 다른 점)

| 영역 | 사양 |
|---|---|
| 판단 사유(7열) · 라벨·메모(5열) | ASM-D 그대로(파일 상태 사유만. 드리프트 사유는 넣지 않는다) |
| 보조 칩 줄 (해당 시) | 두 영역 아래 16px, 칩 간 8px. 서버 `notices[].code`(K8S-API 11.4)로 그린다. Chip neutral sm: `HELM_MANAGED` → `Helm 관리 12개`(아이콘 `ship-wheel`, 툴팁 서버 `text`) · `SYSTEM_NAMESPACES_INCLUDED` → `시스템 네임스페이스 포함`(아이콘 `settings`, 툴팁 서버 `text`) · `STRICT_EXPORT` → `strict`(아이콘 `lock`, ASM-D 툴팁) · `MISSING_NAMESPACES` → `없던 네임스페이스`(아이콘 `circle-help`, 툴팁 서버 `text`) · `RESOURCES_CHANGED_SINCE_EXPORT` → Chip info sm `내보내기 후 변경됨`(툴팁 서버 `text`) · `SECRET_REFS_MISSING`/`SECRET_REFS_CORRUPT` → **Button ghost sm**(28px) `Secret 목록 없음`(아이콘 `key-round` 16px 왼쪽, 툴팁 서버 `text`, 누르면 상세 탭을 `secrets`로 바꿈 + URL `?view=secrets` replace. 이 항목만 누를 수 있어서 Chip이 아닌 버튼으로 둔다. Chip은 누를 수 없는 정보 표시이고, 누르는 칩을 따로 만들면 포커스·hover 규칙이 하나 더 생긴다). 보조 칩 줄은 세로 가운데 정렬, 이 버튼이 있으면 줄 높이 28px. 모두 상태에 영향 없는 정보. 모르는 코드는 Chip neutral + 서버 `text`(말줄임 240px) |
| 안내(하단, 닫을 수 없음) | InlineAlert info, 아이콘 `hand`, 제목 `대시보드는 커밋·적용하지 않습니다`, 설명 3줄(줄 간 4px): `커밋 전 터미널에서 git diff로 직접 확인하세요.` / `적용(복원)은 kubectl diff로 확인한 뒤 kubectl apply로 직접 하세요 (deploy/k8s-snapshot/README.md).` / 셋째 줄은 서버 `DATA_NOT_INCLUDED` 문구 그대로 + ` 복원 순서: 매니페스트 적용 → 빈 StatefulSet 기동 → 데이터 복원.`(서버 문구가 없으면 `이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 데이터는 pg_dump 논리 백업 또는 EBS 볼륨 스냅샷으로 따로 보관하세요.`) |

### 4.5 상세 탭 (`Tabs`, 기존 컴포넌트)

| 순서 | id (`?view=`) | 라벨 | 아이콘·숫자 |
|---|---|---|---|
| 1 | `files` (기본) | `파일` | 현재 스캔 최악 등급 아이콘 12px(오류 `crit`, 경고 `warn`) + `count` = 발견 수, `countLabel` `발견`. 발견 없으면 아이콘·숫자 없음 |
| 2 | `drift` | `드리프트` | 차이 있음이면 `count` = 차이 건수, `countLabel` `차이`. **상태 아이콘 없음**(파일 상태 아이콘과 혼동 방지). 알 수 없음·계산 안 함이면 숫자 없음 |
| 3 | `3d` | `3D 보기` | **없음**(아이콘·숫자 모두). 2026-09-20 추가, 설계는 `snapshot-3d.md` 2.1. 같은 숫자를 `파일`·`드리프트` 탭과 중복해 두지 않는다 |
| 4 | `counts` | `리소스 수` | 없음 |
| 5 | `secrets` | `Secret 참조` | `count` = `secretRefs.count`. 없음·손상이어도 상태 아이콘은 그리지 않는다(K8S-API 3.3: 정보 문구일 뿐 상태 영향 없음) |
| 6 | `meta` | `메타데이터` | 메타 손상 `crit`, 메타 없음·형식 다름·부분 내보내기·없던 네임스페이스 `warn` |

- 파일 탭에 편집 중 변경이 있을 때 다른 상세 탭으로 가면: 편집 상태를 **유지**한다(탭 패널을 언마운트하지 않거나 편집 버퍼를 보존). 저장하지 않은 변경 확인(ASM-D 6.4)은 페이지를 떠날 때만 띄운다. `파일` 탭 라벨 뒤에 `dirty` 점(8px `accent.default`, sr `저장 안 됨`).

---

## 5. 파일 탭 (탐색 패널 + 파일 편집기)

### 5.1 구성과 치수

```
┌ 탐색 패널 (4열 376px, Card padding 0) ┐┌ 파일 편집기 (8열 768px, Card padding 0) ────────────────┐
│ [ 리소스 128 | ⊗ 스캔 발견 2 ]  (48px) ││ 파일 머리 40px: app / statefulsets / postgres.yaml [⧉]   │
│ ──────────────────────────────────── ││                    StatefulSet · data/postgres [Helm] [▣ 변경됨] │
│ (리소스 보기)                          ││ 툴바 48px (ASM-D 5.2)                                    │
│ [🔍 리소스 이름·경로 검색          ]    ││ 알림 슬롯                                                │
│ [표시: 전체 ▾]           [⇕] [⇳]      ││ 코드 영역 (CodeEditor)                                   │
│ 리소스 128개 · 네임스페이스 5 · 종류 14 ││                                                          │
│ ▸ 📦 스냅샷 파일                        ││                                                          │
│ ▾ 📁 app                      42 ⊗1  ││                                                          │
│    📄 namespace.yaml                  ││                                                          │
│   ▾ ≡ Deployment               3     ││                                                          │
│      📄 api              ▣ ⎈          ││                                                          │
│ ▸ 🌐 클러스터 범위               6     ││                                                          │
│ ▸ ⚠ 예상 밖 파일                2     ││                                                          │
└──────────────────────────────────────┘└──────────────────────────────────────────────────────────┘
```

| 요소 | 사양 |
|---|---|
| 작업 영역 높이 | 두 패널 공통 `clamp(480px, calc(100vh - 176px), 960px)`(ASM-D 5.2 같음). 발견 항목 클릭·파일 열기 시 작업 영역이 화면에 들어오도록 스크롤(`scroll-margin-top: 72px`) |
| 두 패널 비율 | 모든 지원 폭(≥ 1024px)에서 4열 : 8열. 1024px에서 탐색 패널 330px, 편집기 645px |
| 탐색 패널 머리 | 높이 48px, 패딩 8px 12px, 아래 1px `border.subtle`. SegmentedControl sm 폭 100%: `리소스 128` / `스캔 발견 2`(최악 등급 아이콘 12px, 0건이면 아이콘 없이 `스캔 발견 0`) |
| 기본 보기 | 현재 스캔 오류가 1건 이상이면 `스캔 발견` + 첫 발견의 파일·줄을 연다. 아니면 `리소스` + 파일을 열지 않는다(편집기 빈 상태) |
| URL | `?view=files&file=<스냅샷 안 상대 경로>&line=41`. 경로 값은 서버가 목록에서 준 값만 쓴다(명세 5.4). 목록에 없는 경로면 편집기 빈 상태 + InlineAlert neutral compact `이 스냅샷에 없는 파일입니다.` |

### 5.2 리소스 트리 (`ResourceTree`, 14.4)

**툴바**(패딩 12px, 항목 간 8px)

| 요소 | 사양 |
|---|---|
| 검색 | SearchInput 폭 100%, placeholder `리소스 이름·경로 검색`. 부분 일치·대소문자 무시. 일치하는 리소스의 조상 노드를 자동으로 펼치고, 일치하지 않는 가지는 숨긴다. 이름 안 일치 글자는 강조하지 않는다(가운데 말줄임과 충돌) |
| 표시 필터 | Select width 176px `표시: 전체`. 옵션: `전체` / `스캔 발견 있음` / `파일 문제 있음`(YAML 해석 실패·경로 불일치·중복 정의·런타임 필드) / `드리프트 차이 있음`(계산된 경우만 옵션 표시) / `Helm 관리`. 각 개수 |
| 펼치기·접기 | 오른쪽 끝 IconButton sm `chevrons-up-down` `모두 펼치기` + 4px + `chevrons-down-up` `모두 접기` |
| 결과 줄 | caption `text.secondary` tabular: 필터 없음 `리소스 128개 · 네임스페이스 5 · 종류 14`, 필터·검색 중 `리소스 128개 중 3개` |

**노드 구조와 순서**

| 순서 | 최상위 노드 | 아이콘 14px | 자식 |
|---|---|---|---|
| 1 | `스냅샷 파일` | `archive` | `metadata.json`, `secret-refs.json`(있을 때). 둘 다 열면 보기 전용. `notes.json`은 트리에 두지 않는다(라벨·메모 창으로만, 명세 5.4) |
| 2… | 네임스페이스(이름순) | `folder` | ① `namespace.yaml`(종류 노드 없이 바로) ② 종류 노드(서버 순서. 서버가 순서를 주지 않으면 Deployment → StatefulSet → DaemonSet → Service → Ingress → PersistentVolumeClaim → PodDisruptionBudget → HorizontalPodAutoscaler → ConfigMap → ServiceAccount → Role → RoleBinding → NetworkPolicy → CronJob → Job → ResourceQuota → LimitRange → 사용자 지정 리소스(이름순)) → 리소스(이름순) |
| 뒤에서 2 | `클러스터 범위` (`_cluster/`가 있을 때만) | `globe` | 종류 → 리소스 |
| 맨 뒤 | `예상 밖 파일` (있을 때만) | `file-question` `status.warn.fg` | 파일 이름(텍스트로만). **열 수 없음**(행 `aria-disabled`, 툴팁 `대시보드는 이 파일을 열거나 고치지 않습니다`) |

**행 모양**

| 요소 | 사양 |
|---|---|
| 행 | 높이 28px, 왼쪽 패딩 8px + 깊이 × 16px, 오른쪽 패딩 8px. 펼침 칸 16px(`chevron-right` 12px, 펼치면 90° 회전, 잎 노드는 빈칸) + 아이콘 14px + 6px + 이름 + (flex) + 표시 영역 |
| 네임스페이스 이름 | mono 12/20 600 `text.primary`. 시스템 네임스페이스면 이름 뒤 6px에 Chip `시스템`(`settings`, `status.md` 1.3) |
| 종류 이름 | table 13/20 `text.primary`, 아이콘 `layers`. 사용자 지정 리소스는 `plural.group` mono 12 |
| 리소스 이름 | 아이콘 `file-text` `text.tertiary`, 이름 `ResourceName`(mono 12/20, 가운데 말줄임 keepTail 8, 툴팁 전체 경로 `app/deployments/api.yaml`, 복사 버튼 없음 — 편집기 머리에 있음) |
| 개수 | 네임스페이스·종류 행 오른쪽 caption `text.tertiary` tabular (`42`) |
| 표시 영역(오른쪽, 아이콘 12px, 간격 4px, 순서 고정) | ① 스캔: 최악 등급 아이콘(`octagon-x` `status.crit.fg` / `triangle-alert` `status.warn.fg`) + 개수 captionStrong 같은 색 ② 파일 문제: `file-warning` `status.warn.fg`(툴팁 서버 사유 `YAML 해석 실패` / `경로와 내용 불일치 (내용: Deployment app/api-v2)` / `중복 정의` / `런타임 필드 남음 (status, managedFields)`) ③ 드리프트(계산된 경우): `DriftKindIcon`(`square-dot` 변경 / `square-minus` 삭제, `text.secondary`, 툴팁 `드리프트: 변경 (필드 2건)`) ④ Helm: `ship-wheel` `text.tertiary`(툴팁 `Helm 관리`) ⑤ 저장 안 됨: 8px 원 `accent.default` |
| 접힌 노드 집계 | 네임스페이스·종류 행은 접혀 있을 때 ①(최악 등급 + 하위 발견 합계), ②(하위에 있으면 아이콘만), ③(`square-dot` + 하위 차이 리소스 수)을 개수 앞에 보인다. 펼치면 집계를 지우고 자식이 보인다 |
| 비교 불가 종류 | `tree[].kinds[].drift`가 `comparable`이 아닌 종류 행 이름 뒤 6px에 `eye-off` 12px `text.tertiary`. 툴팁: `not_in_rbac` → `드리프트 비교 불가 (대시보드 권한 밖)` / `forbidden` → `드리프트 비교 불가 (권한 거부)` / `api_version_mismatch` → `드리프트 비교 불가 (API 버전 다름)`. 드리프트 계산 가능 여부와 무관하게 표시(계약 그대로) |
| 데이터 출처 | 노드 = `snapshot.tree`(네임스페이스·종류 순서는 서버 순서 그대로, 클러스터 범위는 `namespace: null` 항목), 잎 정보 = `snapshot.files[]`(경로 키). 마커: 스캔 `files[].findings`, 파일 문제 `parse ≠ ok` / `pathMatches: false` / `duplicate` / `runtimeFields` 비어 있지 않음, 드리프트 `files[].drift`(`changed` → `square-dot`, `deleted` → `square-minus`, `same`·`uncomparable`·`skipped`·`null` → 없음. `skipped`는 파일 문제 마커로 이미 보임), Helm `helmManaged`. 예상 밖 파일 = `snapshot.extraFiles` |
| hover / 선택 / 포커스 | `bg.hover` / `bg.selected` + 안쪽 왼쪽 3px `accent.default` / `shadow.focus` 안쪽 |
| 기본 펼침 | 리소스 150개 이하: 모두 펼침. 초과: 네임스페이스만 펼치고 종류는 접음. `스냅샷 파일`·`예상 밖 파일`은 접음. 펼침 상태는 같은 스냅샷을 보는 동안 메모리에만 유지 |
| 많은 노드 | 보이는 행만 그린다(가상 렌더링). 1,000행에서 스크롤이 끊기지 않아야 한다 |
| 빈 결과 | 필터·검색 결과 0: 트리 자리에 EmptyState sm(높이 160px) `조건에 맞는 리소스가 없습니다` + ghost sm `필터 초기화` |
| 키보드 | WAI-ARIA tree: `role="tree"`/`treeitem`, `aria-expanded`, `aria-level`, ↑↓ 이동, → 펼침/첫 자식, ← 접힘/부모, Home/End, Enter 파일 열기, `*` 형제 모두 펼침. 한 트리가 하나의 탭 정지점(roving tabindex) |
| 스크린리더 이름 | `api, Deployment, app 네임스페이스, 스캔 오류 1건, 드리프트 변경, Helm 관리` |

### 5.3 스캔 발견 보기 (ASM-D 4.5 스캔 패널을 탐색 패널 안으로)

ASM-D 4.5의 머리(`비밀값 스캔` + 규칙 HelpPopover), 현재 스캔 요약(ScanCounts md, strict 칩), 당시 대비, 편집 중 안내, 발견 목록, 0건 EmptyState, 한계 문구, CLI 확인 명령을 **같은 순서·문구**로 탐색 패널 본문(패딩 12px)에 둔다. 다른 점:

| 요소 | 사양 |
|---|---|
| `스캔한 파일 N개` 접힘 줄 | 두지 않는다(파일이 많아 목록이 의미 없음). 대신 요약 아래 caption `리소스 파일 128개 + metadata.json을 스캔했습니다` |
| 발견 항목 파일 표기 | 스냅샷 안 상대 경로 `data/statefulsets/postgres.yaml:41`. 폭이 모자라면 **가운데 말줄임**(뒤쪽 `postgres.yaml:41`을 남김, keepTail = 파일 이름 + `:줄`), 툴팁 전체 경로. ScanFindingList `truncateFile`(15.3) |
| 발견 클릭 | 편집기에서 그 파일을 열고 그 줄로 이동(ASM-D 같음). 트리 보기로 바꾸지 않는다. 다른 파일에 저장하지 않은 변경이 있으면 ASM-D 6.4 확인 |
| CLI 확인 명령 | `npm run scan --prefix deploy/k8s-snapshot -- snapshots/20260919-061000` |
| 규칙 도움말 Drawer | ASM-D 4.5 Drawer에 **쿠버네티스 규칙 5개**(`k8s-env-literal` 오류 · `k8s-secret-object` 오류 · `k8s-dockerconfig` 오류 · `k8s-configmap-secretish` 경고 · `k8s-last-applied` 경고)를 규칙 표에 더한다(규칙 목록·문구는 서버·README 값). 처리 방법에 두 줄 추가(맨 앞): `env의 value: 리터럴을 지우고 valueFrom.secretKeyRef로 바꿉니다. Secret 이름을 모르면 우선 <POSTGRES_PASSWORD> 같은 자리표시자로 바꿉니다.` / `kind: Secret 파일은 스냅샷에 두지 않습니다. 값을 지우고 별도 보관소에서 관리하세요.` 나머지(`# snapshot-scan: allow`, 이미 푸시했으면 교체)는 그대로 |

### 5.4 파일 편집기 (ASM-D 5절과 다른 점)

| 요소 | 사양 |
|---|---|
| 파일 탭 줄 | **없음**. 대신 **파일 머리**(높이 40px, 좌우 패딩 16px, 아래 1px `border.subtle`, 배경 `bg.surface`) |
| 파일 머리 왼쪽 | 경로 mono 12/20 `text.primary`, 구분자 ` / `(`text.tertiary`): `app / statefulsets / postgres.yaml`. 넘치면 가운데 말줄임(파일 이름 보존), 툴팁 전체 경로 + 4px CopyButton sm(showLabel false, `경로 복사`, 복사 값 = 저장소 기준 경로 `deploy/k8s-snapshot/snapshots/<id>/data/statefulsets/postgres.yaml`) + 저장 안 됨 점(8px `accent.default`) |
| 파일 머리 오른쪽 (간격 8px) | 리소스 식별 caption `text.secondary`: `StatefulSet · data/postgres`(`files[].resource` 첫 문서 기준, `null`이면 생략) → Chip neutral sm `Helm 관리`(`ship-wheel`, `helmManaged`) → 드리프트 칩(`files[].drift`가 `changed`/`deleted`일 때, `DriftKindChip` sm — 누르면 `?view=drift&res=<files[].resourceKey>`, 툴팁 `드리프트에서 보기`) → Chip neutral sm `보기 전용`(`lock`, 해당 시) |
| 툴바·코드 영역·gutter·발견 줄·이동 줄 | ASM-D 5.2 그대로 |
| 모드·상태 | ASM-D 5.3 그대로 + 아래 표 |
| 원본 편집 안내 | ASM-D 5.4 제목 그대로, 설명 `비밀값 정리와 검토 주석(# snapshot-scan: allow), 드리프트 확인을 위한 맞춤에 쓰세요. 이 파일은 git에 커밋하는 스냅샷 원본입니다.` |
| 편집 불가 사유 우선순위 | ASM-D 5.5에서 "편집 불가 파일" = `metadata.json`, `secret-refs.json` |

| 추가 상태 | 모습 |
|---|---|
| 파일을 고르지 않음 | 파일 머리·툴바 없이 코드 영역 자리에 EmptyState sm(세로 가운데): 아이콘 `file-text`, 제목 `파일을 고르세요`, 설명 `왼쪽 리소스 목록에서 파일을 고르면 여기에서 보고 편집할 수 있습니다.` |
| 보기 전용(`metadata.json`, `secret-refs.json`) | Chip `보기 전용` 툴팁 `CLI가 기록한 파일이라 대시보드에서 편집하지 않습니다.` 편집 버튼 **없음**(ASM-D의 매핑 파일과 같은 처리) |
| YAML 해석 실패 파일 (`parse`: `yaml_error`/`not_object`/`empty`/`too_large`) | 보기·편집 가능(`too_large`는 ASM-D 보기 상한 규칙). 알림 슬롯 InlineAlert warn compact: `yaml_error` → `YAML로 읽을 수 없습니다 (12번째 줄). 이 리소스는 드리프트 비교에서 빠집니다.`(줄은 `parseError.line`, 서버 `message`는 툴팁) / `not_object` → `최상위가 YAML 매핑이 아닙니다. …빠집니다.` / `empty` → `빈 파일입니다. …빠집니다.` / `too_large` → `파일이 커서 해석하지 않았습니다. …빠집니다.` |
| 여러 문서 (`parse: multi_document`) | InlineAlert warn compact `한 파일에 리소스 2개가 들어 있습니다 (--- 구분). 드리프트는 문서마다 따로 비교합니다.`(개수 = `documents.length`) |
| 경로와 내용 불일치 / 중복 정의 | 알림 슬롯 InlineAlert warn compact `파일 경로와 내용이 다릅니다: 경로 Deployment app/api · 내용 Deployment app/api-v2` / `같은 리소스가 다른 파일에도 있습니다: app/deployments/api-copy.yaml` |
| 런타임 필드 남음 | InlineAlert info compact `런타임 필드가 남아 있습니다 (status, managedFields). 다시 적용하기 전에 지우는 것이 좋습니다.` |
| 저장 완료 알림 (ASM-D 5.6) | 설명 끝에 줄 추가(드리프트 자동 계산 대상이거나 드리프트가 계산된 스냅샷일 때): `드리프트를 다시 계산합니다 (30초 이내).` |

---

## 6. 드리프트 탭 `?view=drift`

### 6.1 구성

```
┌ NoExecuteNotice (40px) ✋ 대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요. ┐
┌ A. DriftSummary Card (12열) ─────────────────────────────────────────────────────────────────┐
│ [△ 차이 3건] 변경 2 · 삭제 1               15:12:04 계산 · 비교 대상 prod-eks (sentinel-prod)       │
│                                            자동 계산 · 클러스터 변경은 30초 안에 반영                │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ 변경 │ 삭제 │ 추가 │ 같음 │ 비교한 리소스                                                           │
│ ▣ 2  │ ▣ 1  │ ▣ 0  │ 39   │ 42                                                                  │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ 👁‍🗨 기본값 차이 12건 · 관리 필드 1건 숨김 (상태·건수에 넣지 않음)            [○ 숨긴 차이 보기]       │
│ 비교 불가 11개  [ConfigMap 8] [NetworkPolicy 2] [CronJob 1]  대시보드 권한 밖이라 비교하지 않습니다.   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
┌ B. 리소스 목록 (4열 376px) ────┐┌ C. 리소스 차이 (8열 768px) ──────────────────────────────────┐
│ [전체 3|변경 2|삭제 1|추가 0]   ││ [▣ 변경됨] Deployment · apps/v1                               │
│ [🔍 리소스 이름 검색        ]    ││ app / api                                   [📄 파일 보기]     │
│ ▾ app                         ││ ┌ 필드 │ 스냅샷 값 │ → │ 클러스터 값 │ 분류 ┐                        │
│   ▾ Deployment                ││ │ …containers[api].image │ …:1.8.2 │→│ …:1.9.0 │ 변경  │            │
│     ▣ api          필드 2     ││ │ 숨긴 차이 3건 ⌄                                  │            │
│   ▾ Ingress                   ││ └────────────────────────────────────────────────┘            │
│     ▣ api-public   삭제됨      ││ 직접 실행할 명령 (복사만)                                        │
│                               ││ [kubectl diff -f deploy/k8s-snapshot/…/api.yaml      ⧉]       │
│                               ││ [kubectl apply -f deploy/k8s-snapshot/…/api.yaml     ⧉]       │
└───────────────────────────────┘└──────────────────────────────────────────────────────────────┘
```

- 요소 간 세로 16px. B·C 높이 = 작업 영역 높이(5.1과 같은 `clamp`), 각자 내부 스크롤.

### 6.2 실행 안 함 안내

`NoExecuteNotice`(components.md 10.9) 문구 지정 확장(15.4): `대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요.` 탭 맨 위 고정, 닫을 수 없음. 드리프트 결과가 없는 상태(6.8)에서도 보인다.

### 6.3 A. 드리프트 요약 (`DriftSummary`, 14.5)

Card padding lg(20px). 줄 사이 1px `border.subtle` + 위아래 16px.

| 줄 | 사양 |
|---|---|
| ① 상태 | 왼쪽: `DriftStatus` lg(StatusBadge lg, 문구 `차이 3건` / `차이 없음` / `알 수 없음`) + 8px + ReasonText(서버 사유, 예 `변경 2 · 삭제 1`, `비교 42개, 비교 불가 11개`). 오른쪽(오른쪽 정렬, caption `text.secondary`, 2줄): 1줄 `15:12:04 계산`(`drift.computedAt`, Timestamp time, 오늘이 아니면 날짜 포함) + ` · 비교 대상 ` + `target.name` mono 12 + ` (target.context)`, 2줄은 `drift.mode`로: `auto` → `자동 계산 · 클러스터 변경은 30초 안에 반영` / `on_demand` → `요청 계산 · 이 화면을 떠나면 최대 2분 뒤 갱신을 멈춥니다` + 8px + `다시 계산` secondary sm(아이콘 `refresh-cw`) / `last_result`(지난 결과 보기 중, 6.8) → `지난 결과 · 지금은 갱신하지 않습니다` + 8px + `다시 계산` **primary** sm |
| 갱신 중 표시 | `drift.computing: true`이면(자동·요청 모두) 계산 시각 앞에 Spinner 12px + `갱신 중 · `. 값·선택은 그대로 둔다(지우지 않음). 서버는 500ms 넘게 걸릴 때만 알린다 |
| ② 개수 | `drift.counts`: `changed` / `deleted` / `added` / `same` / `compared`. 칸 5개(최소 폭 120px, 높이 56px, 칸 사이 1px 세로선 높이 40px `border.subtle`): 라벨 caption `text.secondary` + 값 metricMd 20/28 tabular. `변경`·`삭제`·`추가` 값 앞에 `DriftKindIcon` 16px(`square-dot`/`square-minus`/`square-plus`, `text.secondary`). 0이면 값 `0` `text.tertiary`, 아이콘 생략. `같음`, `비교한 리소스`는 아이콘 없음. 변경·삭제·추가·같음 칸은 누르면 B 필터를 바꾼다(`같음`을 누르면 필터 `전체` + 숨긴 차이 스위치 켬). 칸은 `<button>`, `aria-pressed`로 현재 필터 표시 |
| ③ 숨긴 차이 | 숨긴 차이가 1건 이상일 때만. 아이콘 `eye-off` 14px `text.tertiary` + body `기본값 차이 12건 · 관리 필드 1건 숨김` + caption `text.tertiary` ` (상태·건수에 넣지 않음)` + 오른쪽 Switch `숨긴 차이 보기`(기본 꺼짐, URL `hidden=1`). 켜면 B에 숨긴 차이만 있는 리소스가 나타나고 C 표의 숨긴 행이 펼쳐진다 |
| ④ 비교 불가 | `uncomparable[]`이 1개 이상일 때만. 라벨 captionStrong `text.secondary` `비교 불가 11개`(`counts.uncomparable`) + 8px + 항목별 Chip neutral sm, 칩 간 6px, 최대 8개 + `외 N종`(툴팁 나머지). 사유(`reason`)별 모양: `NOT_IN_RBAC` → 실선 `ConfigMap 8`(아이콘 `eye-off`) / `FORBIDDEN` → **dashed** `Ingress 3 · 권한 거부`(툴팁 `대시보드 RBAC에는 있지만 클러스터가 읽기를 거부했습니다. deploy/rbac.yaml 적용 상태를 확인하세요.`) / `API_VERSION_MISMATCH` → **dashed** `HorizontalPodAutoscaler 1 · API 버전 다름`(툴팁 서버 `text` + 줄바꿈 + `스냅샷 파일의 apiVersion이 대시보드가 읽는 버전과 달라 비교하지 않습니다. 파일을 고쳐 버전을 맞추면 비교합니다.`). 모르는 사유는 실선 + 툴팁 서버 `text`. 칩 뒤 caption `text.tertiary` `대시보드 권한·버전 밖이라 비교하지 않습니다. 드리프트 상태에 영향이 없습니다.` 줄이 넘치면 칩이 다음 줄로 |
| ⑤ 부분 계산 안내 (해당 시, 줄 간 8px) | InlineAlert neutral compact: ⓐ `unparsable[]`이 있으면 아이콘 `file-warning` `파일 문제로 비교 못 함 3개 (해석 실패 2 · 중복 정의 1)`(`reason`별 개수, 0인 것 생략: `yaml_error`·`too_large` → 해석 실패, `duplicate` → 중복 정의, `namespace_missing` → 네임스페이스 없음) + 링크 버튼 `파일 탭에서 보기`(`?view=files` + 트리 필터 `파일 문제 있음`) ⓑ `addedCheck: skipped_scope_unknown` 또는 notice `ADDED_NOT_CHECKED` → `circle-help` + 서버 문구(`범위를 알 수 없어 추가된 리소스는 확인하지 않음`) ⓒ 그 밖의 `notices[]`(예 `CLEANUP_RULES_NEWER`) → `info` + 서버 문구 |
| 카드 테두리 | 기본 1px `border.subtle`. 차이 있음이어도 왼쪽 warn 막대를 **두지 않는다**(드리프트는 장애·주의 경보가 아니라 정보. 파일 상태 카드와 구분). stale이면 1px dashed `status.stale.border` |

### 6.4 B. 리소스 목록 (`ResourceTree` variant `drift`)

| 요소 | 사양 |
|---|---|
| 머리 | 패딩 12px. SegmentedControl sm 폭 100%: `전체 3` / `변경 2` / `삭제 1` / `추가 0`(각 앞 `DriftKindIcon` 12px). URL `kind=changed\|deleted\|added`(계약 `resources[].change` 값) |
| 데이터 | `resources[]`(서버 정렬 네임스페이스 → 종류 → 이름 그대로). `change: same` 항목(숨긴 차이만 있음)은 스위치를 켰을 때만. 선택 키 = `resources[].key`(`res=`) |
| 검색 | SearchInput 폭 100%, `리소스 이름 검색`, 8px 아래 |
| 목록 | 네임스페이스 → 종류 → 리소스, 5.2 행 모양(28px)과 같음. 네임스페이스·종류는 이름순이 아니라 5.2 순서, 리소스는 이름순. 기본 모두 펼침 |
| 리소스 행 | `DriftKindIcon` 14px(아이콘 자리, `file-text` 대신) + 이름(ResourceName mono 12, keepTail 8) + 오른쪽 caption `text.tertiary`: 변경 `필드 2`, 삭제 `삭제됨`, 추가 `추가됨`, 숨긴 차이만(스위치 켬) `eye-off` 12px + `숨김 3` |
| 선택 | 기본 선택 = 목록 첫 리소스. URL `res=<서버 리소스 키>`. 선택 행 `bg.selected` + 3px `accent.default` |
| 갱신 중 선택 유지 | 다시 계산된 결과에서 선택 리소스가 사라지면 선택을 비우고 C에 6.6 "차이가 사라짐" 상태. 자동으로 다른 행을 고르지 않는다 |
| 0건(필터 결과) | EmptyState sm `이 구분의 리소스가 없습니다` |
| 스크린리더 | `api, Deployment, app 네임스페이스, 변경, 필드 2건` |

### 6.5 C. 리소스 차이 — 변경됨

**머리**(패딩 16px 20px, 아래 1px `border.subtle`)
- 1줄: `DriftKindChip` md(`변경됨`) + 8px + caption `text.secondary` `Deployment · apps/v1`(`kind` · `apiVersion`, 없으면 `apiGroup`, 코어는 `core`)
- 2줄: `app / api` code 13/20 600 `text.primary`(가운데 말줄임, 툴팁 전체) + 오른쪽 ghost sm `파일 보기`(아이콘 `file-text`, → `?view=files&file=<경로>`) + CopyButton sm `리소스 이름 복사`
- Helm 관리면 머리 아래 12px InlineAlert info compact(아이콘 `ship-wheel`) `Helm이 관리하는 리소스입니다. kubectl apply보다 Helm으로 복원하세요.`

**필드 차이 표** (`FieldDiffTable`, 14.6) — 카드 안 전체 폭(768 − 좌우 패딩 32 = 736px)

| 열 | 폭 | 내용 |
|---|---|---|
| 필드 | flex, 최소 200px | 필드 경로 mono 12/20 `text.primary`, **줄바꿈 허용**(말줄임하지 않음). 줄바꿈 위치는 `.` 뒤와 `[` 앞(`<wbr>`), 그래도 넘치면 `overflow-wrap: anywhere`. 이름 있는 목록 키는 서버 표기 그대로 `containers[api]` |
| 스냅샷 값 | 176px | `DiffValue`(14.7) |
| (화살표) | 24px, 가운데 | `→` caption `text.tertiary`, `aria-hidden` |
| 클러스터 값 | 176px | `DiffValue` |
| 분류 | 128px | `category`: `changed` → caption `text.secondary` `변경`. `default` → Chip neutral sm `기본값 차이`(아이콘 `settings-2`) + 아래 4px caption `text.tertiary` 서버 `reason`(예 `기본값 File`). `managed` → Chip neutral sm `관리 필드`(아이콘 `bot`) + 아래 caption 서버 `reason`(`HPA가 관리`, `kubectl rollout restart 기록`, `볼륨 확장`, `자동 할당`, `기본 StorageClass가 설정` 등) |

| 규칙 | 사양 |
|---|---|
| 데이터 | `resources[].fields[]`: `path`, `category`, `reason`, `snapshot`, `cluster`(`null` = 없음) |
| 행 | 최소 높이 40px, 셀 패딩 10px 12px, 위 정렬, 행 구분선 1px `border.subtle`. 머리글 36px(`status.md` 5.1) |
| 순서 | 서버 순서 그대로(`changed` → `managed` → `default`, 같은 분류는 경로순). 정렬 버튼 없음. 숨긴 행이 자연히 뒤에 온다 |
| 잘림 | `fieldsTruncated: true`면 표 맨 아래 행(높이 36px, 배경 `bg.surfaceSunken`, caption `text.secondary`, 아이콘 `info` 12px): `필드 차이가 많아 500건까지만 보여 줍니다. 전체는 kubectl diff로 확인하세요.` |
| 숨긴 차이 (스위치 꺼짐) | 보이는 행 뒤에 그룹 행(DataTable `groupRow`, 높이 36px, 배경 `bg.surfaceSunken`): `chevron-right` 12px + `숨긴 차이 3건` + caption `text.tertiary` ` (기본값 차이 2 · 관리 필드 1)`. 누르면 이 리소스만 펼침(스위치는 그대로) |
| 숨긴 차이 행 | 배경 `bg.surfaceSunken`, 필드·값 글자 `text.secondary`. 스위치 켬 또는 그룹 행 펼침일 때 보인다 |
| 보이는 차이 0 + 숨긴 차이만 | 표에 그룹 행만(펼친 상태로 시작) + 표 위 caption `이 리소스는 숨긴 차이만 있어 같음으로 셉니다.` |
| 스크린리더 | 행마다 `spec.template.spec.containers[api].image, 스냅샷 값 registry.example.com/api:1.8.2, 클러스터 값 registry.example.com/api:1.9.0, 변경` |

**명령 블록** (표 아래 16px, 위 1px `border.subtle` + 16px)
- 제목 captionStrong `text.secondary` `직접 실행할 명령 (복사만)`
- CommandLine fullWidth 2줄(간 8px): `resources[].commands.diff` / `resources[].commands.apply`(서버 문자열 그대로). `commands: null`이면 블록 전체를 그리지 않는다. 텍스트로만
- caption `text.secondary` + `info` 12px(줄 간 4px): 서버 `commandsNote` 그대로(없으면 `kubectl diff는 서버 측 dry-run이라 실행하는 계정에 쓰기(patch) 권한이 필요합니다.`) / `실행 전 대상 클러스터를 확인하세요 (스냅샷: ` + `snapshotCluster.name` + ` · 컨텍스트 ` + `snapshotCluster.context` + `).`
- `fileDocuments ≥ 2`면 명령 위에 InlineAlert warn compact `이 파일에는 리소스 2개가 들어 있어 명령이 모두 적용합니다.`(개수 = `fileDocuments`)
- **삭제·스케일·롤아웃 명령은 넣지 않는다.**

### 6.6 C. 리소스 차이 — 삭제됨·추가됨·그 밖

| 경우 | 모습 |
|---|---|
| 삭제됨 (`change: deleted`) | 머리 `DriftKindChip` md `삭제됨`. 본문: caption `스냅샷에 있지만 지금 클러스터에는 없습니다.` + 12px + KeyValueList 1열 labelWidth 120px: `종류`, `네임스페이스`(클러스터 범위면 `—`), `이름`(mono), `이미지`(`summary.images`, mono 12, 한 줄에 하나, 0개면 행 없음), `replicas`(`summary.replicas`, `null`이면 행 없음) + 명령 블록(6.5와 같음: 다시 만들려면 `kubectl diff`/`kubectl apply`) |
| 추가됨 (`change: added`) | 머리 `DriftKindChip` md `추가됨`. `파일 보기` 없음(`file: null`). 본문: InlineAlert info `스냅샷에 없는 리소스입니다` 설명 `이 리소스를 기록하려면 CLI로 새 스냅샷을 만드세요. 대시보드는 삭제 명령을 제안하지 않습니다.` + 같은 KeyValueList(이미지는 클러스터 쪽). **명령 블록 없음**(`commands: null`) |
| 숨긴 차이만 (`change: same`, 스위치 켬) | 머리 `DriftKindChip` md `같음` + 표(6.5 "보이는 차이 0 + 숨긴 차이만" 규칙) + 명령 블록 |
| 선택 없음 | EmptyState sm `왼쪽 목록에서 리소스를 고르세요` |
| 차이가 사라짐(갱신 후) | EmptyState sm 아이콘 `circle-check`(`status.ok.fg`), 제목 `이 리소스는 이제 차이가 없습니다`, 설명 `다시 계산한 결과 스냅샷과 클러스터가 같습니다.` |
| 필드 값 로딩 (REST 조회 중) | 표 스켈레톤 6행(행 40px, 막대 12px, 폭 60%) |

### 6.7 값 표시 (`DiffValue`, 가림 `MaskedValue`)

계약 `DiffValue`(K8S-API 10.9): `{ kind: 'scalar', value }` / `{ kind: 'list', items }` / `{ kind: 'masked', text, preview }` / `null`. **객체 조각(YAML 블록)은 오지 않는다**(차이는 잎 단위).

| 값 | 모습 |
|---|---|
| `scalar` 문자열(한 줄) | mono 12/20 `text.primary`, 따옴표 없이, `overflow-wrap: anywhere` |
| `scalar` 숫자·불리언·`null` | mono 12/20 `text.primary`, JSON 표기(`8080`, `true`, `null`). `null`은 `text.tertiary` |
| **타입만 다른 경우** | 양쪽 값의 표시 글자가 같고 JSON 타입이 다르면(`8080` ↔ `"8080"`) 두 셀 모두 값 뒤 6px에 micro 11/14 `text.tertiary` 타입 표시 `문자열` / `숫자` / `불리언`. 그 밖에는 타입 표시를 하지 않는다 |
| `scalar` 여러 줄 문자열 | `white-space: pre-wrap`. 최대 3줄(60px) 보이고 넘치면 셀 아래 링크 버튼 `더 보기 (12줄)` → 행 전체 폭 확장 영역(배경 `bg.surfaceSunken`, 패딩 12px 16px)에 스냅샷·클러스터 값을 좌우 2단(각 50%, 간 16px)으로 전체 표시 |
| `list` (스칼라 목록, `command`·`args`가 아닌 것, 또는 "순서 다름") | 항목마다 한 줄, 앞에 `- `(`text.tertiary`), mono 12/20. 최대 3줄 + `더 보기 (N개)` 규칙은 위와 같다 |
| 줄 단위 색 강조 | 하지 않는다(빨강·초록 diff 없음) |
| `null` (값 없음) | caption `text.tertiary` `(없음)` |
| 수량 | 서버 원문 표기 그대로(`1Gi`, `512Mi`). 화면이 단위를 바꾸거나 정규화하지 않는다 |
| **가린 값** `masked` (`env[].value`, `command`, `args`, 스캐너 규칙에 걸린 값) | `MaskedValue`(14.8): 높이 22px 상자, 패딩 0 6px, radius 4px, 배경 `bg.surfaceSunken`, 1px **dashed** `border.default`, 아이콘 `eye-off` 12px `text.tertiary` + 4px + 서버 `text`(예 `값 다름 (ex****(16자))`) mono 12/20 `text.secondary`. `preview`는 쓰지 않는다(`text`에 이미 들어 있음). 툴팁 `운영 값이라 가립니다. 스냅샷 파일 쪽 원문은 파일 보기에서 확인하세요.` 양쪽 셀 모두 서버가 준 가린 문자열만 보인다. 화면은 원문을 찾거나 다시 만들지 않는다 |
| 어노테이션 값 | 가리지 않는다(서버가 가려서 보내면 가린 모양으로) |

- 가린 값에 `warn` 색을 쓰지 않는다(JsonTree의 `[가림]` 색과 다르게 둔다). 이유: 이 화면에서 warn은 "차이 있음"을 뜻해, 가림을 문제로 읽게 만든다.

### 6.8 드리프트 탭 상태별 모습

| 상태 | 모습 |
|---|---|
| 자동 계산 결과 있음 | 6.1~6.7 |
| **계산 안 함** (`DRIFT_NOT_COMPUTED`, mode `none`) | 6.2 안내 + Card 안 EmptyState lg: 아이콘 `git-compare` 40px, 제목 `이 스냅샷은 드리프트를 자동으로 계산하지 않습니다`, 설명 `같은 클러스터의 최신 스냅샷만 자동으로 계산합니다. 지금 클러스터와 비교하려면 계산하세요. 쿠버네티스 API는 읽기만 합니다.`, 액션 primary md `드리프트 계산`(아이콘 `git-compare`) |
| **지난 결과 · 전체 결과 있음** (mode `last_result`, `resultAvailable: true`) | 위 EmptyState와 같되 설명 아래 caption `text.tertiary` `지난 계산 9월 18일 14:02 · 차이 3건`(`computedAt`·`lastResultStatus`·`counts`) + 액션 2개(간 8px): primary md `다시 계산`(아이콘 `refresh-cw`) + secondary md `지난 결과 보기`. `지난 결과 보기` → 6.1 전체 화면을 그리되 ① 요약 카드 테두리 1px dashed `border.strong`, ② 요약 위 InlineAlert neutral(아이콘 `history`, 닫을 수 없음) 제목 `지난 결과입니다 (9월 18일 14:02 계산)`, 설명 `지금 클러스터와 다를 수 있고 자동으로 갱신하지 않습니다. 필드 차이는 계산 뒤 10분 동안만 볼 수 있습니다.`, 액션 primary sm `다시 계산`, ③ 요약 ① 배지는 `lastResultStatus`로(`차이 3건`/`차이 없음`) 그리되 배지 앞에 caption `지난 결과` |
| **지난 결과 · 요약만** (mode `last_result`, `resultAvailable: false`) | 계산 안 함 EmptyState + caption `지난 계산 9월 18일 14:02 · 차이 3건` + 그 아래 caption `text.tertiary` `필드 차이는 계산 뒤 10분만 보관해 지금은 볼 수 없습니다.` + primary md `다시 계산`. `지난 결과 보기` 버튼 **없음** |
| 지난 결과를 보는 중 10분이 지남 | 화면에 있는 결과는 지우지 않는다(다음 조회에서 배지만 오면 그때 "요약만" 모습으로). 자동 재조회는 SSE `k8s-snapshots.drift`가 올 때만 |
| 계산 요청 중 | 버튼 loading `계산 중`. 요약·목록·차이 자리에 스켈레톤(요약 160px, 목록 10행, 표 6행) + 요약 자리 위 caption `클러스터에서 읽는 중입니다. 쿠버네티스 API는 읽기만 합니다.` |
| 요청 계산 결과 (mode `on_demand`) | 6.1~6.7. 이 화면이 열려 있는 동안 갱신된다(임대 갱신은 프론트, K8S-API 10.8) |
| 알 수 없음 · 클러스터 연결 없음 (`CLUSTER_NOT_CONNECTED`) | 6.2 안내 + UnknownState lg: 제목 `알 수 없음 (클러스터 연결 없음)`, 사유(서버 `text`), hint `대시보드가 클러스터에 연결되면 다시 계산합니다.` 계산 버튼 없음 |
| 알 수 없음 · 클러스터 동기화 중 (`CLUSTER_SYNCING`) | UnknownState lg `icon="hourglass"`(`status.unknown.fg`, components 6.4): 제목 `알 수 없음 (클러스터 동기화 중)`, 사유 `대시보드가 클러스터 리소스 목록을 처음 읽는 중입니다.`, hint `끝나면 최신 스냅샷은 자동으로 계산하고, 이 버튼도 쓸 수 있게 됩니다. 일부 종류만 읽은 상태로 비교하면 삭제됨이 잘못 나올 수 있어 기다립니다.` + `드리프트 계산` primary md aria-disabled, 사유 `클러스터 동기화 중` |
| 알 수 없음 · 대시보드 클러스터 확인 불가 (`DASHBOARD_CLUSTER_UNKNOWN`) | UnknownState lg: 제목 `알 수 없음 (대시보드가 연결된 클러스터를 확인할 수 없음)`, 사유 서버 `text`(예 `대시보드 클러스터를 확인할 수 없음 (namespaces 조회 불가)`), hint `대시보드가 kube-system 네임스페이스를 읽지 못해 어느 클러스터에 연결됐는지 모릅니다. 다른 클러스터와 잘못 비교하지 않도록 계산하지 않습니다. deploy/rbac.yaml의 namespaces 읽기 권한과 클러스터 연결을 확인하세요.` + 버튼 aria-disabled, 사유 `대시보드가 연결된 클러스터를 확인할 수 없음` |
| 알 수 없음 · 다른 클러스터 | UnknownState lg: 제목 `알 수 없음 (다른 클러스터의 스냅샷)`, 사유 KeyValueList 1열 labelWidth 120px: `스냅샷` `staging-eks`(mono) · `대시보드` `prod-eks`(mono), hint `다른 클러스터의 스냅샷은 비교하지 않습니다. 파일 보기·편집·삭제는 할 수 있습니다.` + `드리프트 계산` primary md **aria-disabled**, 사유 `다른 클러스터의 스냅샷` |
| 알 수 없음 · 스냅샷 클러스터 확인 불가(Q4, `CLUSTER_ID_MISSING`) | UnknownState lg: 제목 `알 수 없음 (스냅샷의 클러스터를 확인할 수 없음)`, 사유 `metadata.json에 클러스터 ID가 없습니다 (없음·손상·형식 다름).`, hint `잘못된 클러스터와 비교하면 전부 추가·삭제로 보일 수 있어 계산하지 않습니다. metadata.json을 먼저 확인하세요.` + 버튼 aria-disabled 사유 `클러스터를 확인할 수 없음` + 링크 버튼 `메타데이터 보기` |
| 알 수 없음 · 비교할 리소스 없음 | UnknownState lg: `알 수 없음 (비교할 수 있는 리소스 없음)`, 사유 `이 스냅샷의 종류는 모두 대시보드 권한 밖입니다.` + 6.3 ④ 비교 불가 칩 목록 |
| 알 수 없음 · 스냅샷 파일 확인 전 | UnknownState lg `icon="hourglass"`(components 6.4): `알 수 없음 (스냅샷 파일 확인 전)`, 사유 `내보내기가 진행 중일 수 있습니다.` |
| 차이 없음 | 요약 ① `차이 없음` + ② 개수(변경·삭제·추가 0) + ③④. B·C 자리 대신 Card EmptyState sm 아이콘 `circle-check` `status.ok.fg`, `스냅샷과 클러스터가 같습니다`, 설명 `숨긴 차이는 요약에서 볼 수 있습니다.`(숨긴 차이가 있을 때만) |
| stale (클러스터 출처 stale) | 요약 ① 배지를 stale 배지로 교체(툴팁 `마지막 결과: 차이 3건`), ② 값 `status.stale.valueText`, 카드 dashed. B·C는 값 유지. 계산 버튼은 그대로 |
| 알 수 없음 · 드리프트 규칙 없음 (`DRIFT_RULES_UNAVAILABLE`) | UnknownState lg: 제목 `알 수 없음 (드리프트 규칙을 불러올 수 없음)`, 사유 서버 `text`, hint `api의 k8s 규칙 lib 위치 설정(K8S_SNAPSHOT_LIB_DIR)을 확인하세요.` 버튼 aria-disabled |
| 알 수 없음 · 계산 실패 (`DRIFT_FAILED`) | UnknownState lg: 제목 `알 수 없음 (드리프트 계산 실패)`, 사유 서버 `text`, 액션 primary md `다시 계산`(허용됨). 이전 결과가 있으면 지우지 않고 요약 위 InlineAlert neutral compact `마지막 계산이 실패했습니다. 이전 결과(15:12)를 보여 줍니다.` + `다시 계산` |
| 계산 요청 거부 (409 `K8S_DRIFT_UNAVAILABLE`) | 버튼이 이미 비활성이어야 정상. 경쟁으로 409가 오면 `details.reasonCode`에 맞는 위 알 수 없음 모습으로 바꾼다(배지 다시 조회) |
| 계산 API 오류 (네트워크·5xx) | 요약 자리 ErrorState sm + `다시 시도`. 이전 결과가 있으면 지우지 않고 요약 위 InlineAlert crit compact `드리프트를 다시 계산하지 못했습니다. 이전 결과(15:12)를 보여 줍니다.` + `다시 시도` |
| 연결 끊김(전역) | 전역 배너. 값 유지 |
| mock | 상세 mock 안내(ASM-D 4.10) |

- 화면을 떠나면 요청 계산의 임대 갱신을 멈춘다(프론트). 돌아오면 자동으로 다시 요청하지 않고 서버가 준 배지(`on_demand`면 결과, `last_result`면 위 "지난 결과" 모습)를 보인다.
- 알 수 없음 사유별 제목·안내 문구의 짧은 판은 3.5.1 표와 같다. 스냅샷 쪽을 모르는 `CLUSTER_ID_MISSING`과 대시보드 쪽을 모르는 `DASHBOARD_CLUSTER_UNKNOWN`의 제목을 섞지 않는다.
- 다른 상세 탭에 있는 동안: 드리프트 값은 PageHeader chips 줄에서만 갱신된다.

---

## 7. 리소스 수 탭 `?view=counts`

```
┌ 요약 줄 (Card, 12열) 전체 128 (당시 130) · 직전 20260918-061000 126 (+2) · Helm 관리 12 · 제외 규칙으로 뺀 수 9 ┐
┌ 종류별 (7열 670px) ────────────────────────────┐┌ 네임스페이스별 (5열 474px) ─────────────────┐
┌ 제외 규칙으로 뺀 리소스 (12열) ────────────────────────────────────────────────────────────────┐
```

| 요소 | 사양 |
|---|---|
| 요약 줄 | Card padding md, KeyValueList 대신 한 줄 항목(항목 간 24px, 라벨 caption `text.secondary` + 값 bodyStrong tabular): `전체` `128`(내보내기 당시와 다르면 뒤에 caption `당시 130`) · `직전 스냅샷` ID 링크 mono 12(→ 그 상세) + `126 (+2)` · `Helm 관리` `12` · `제외 규칙으로 뺀 수` `9`. 이전 스냅샷 없음이면 `직전 스냅샷 -` |
| 종류별 표 | h3 `종류별` + caption `CLI와 같은 규칙으로 셉니다`. DataTable compact 32px. 열: 종류(flex, 종류 이름 table 13, 사용자 지정은 mono 12) / `현재`(80px 오른쪽) / `당시`(80px 오른쪽, 다르면 값 뒤 `pencil` 12px) / `직전 대비`(88px 오른쪽, `+2`/`−1`/`0`) / `드리프트`(120px, `byKind[].drift`): `comparable` = caption `text.tertiary` `비교함`, `not_in_rbac` = `eye-off` 12px + `비교 불가`, `forbidden` = `eye-off` + `권한 거부`, `api_version_mismatch` = `eye-off` + `API 버전 다름`. 정렬: 서버 순서(5.2의 종류 순서). 합계 행(서버 `counts.total`) |
| 네임스페이스별 표 | h3 `네임스페이스별`. 열: 네임스페이스(flex, mono 12, 시스템이면 Chip `시스템`) / `현재`(80px) / `당시`(80px). 정렬: 이름순. 합계 행 |
| 제외 규칙으로 뺀 리소스 | h3 `제외 규칙으로 뺀 리소스` + caption `CLI가 규칙에 따라 내보내지 않은 수입니다. 파일은 없습니다.` DataTable compact: 종류(flex) / 개수(80px) / 이유(서버 문구, 280px, 예 `컨트롤러 소유(ownerReferences)`, `자동 생성 (kube-root-ca.crt)`, `Helm 제외 설정`). 0개면 표 대신 caption `제외된 리소스 없음` |
| 메타 없음·손상 | `당시`, `직전 대비`, 제외 표는 `—` / InlineAlert neutral compact `metadata.json이 없어 내보내기 당시 값을 알 수 없습니다.` |
| 1024~1279px | 종류별·네임스페이스별 세로로(각 12열) |

---

## 8. Secret 참조 탭 `?view=secrets`

| 요소 | 사양 |
|---|---|
| 안내(상시, 닫을 수 없음) | InlineAlert info, 아이콘 `key-round`, 제목 `복원 전에 이 Secret들을 별도 보관소에서 만들어야 합니다`, 설명 `스냅샷과 대시보드는 Secret을 읽지 않습니다. 워크로드 매니페스트가 참조하는 이름과 참조에 적힌 키 이름만 모았습니다. 참조되지 않는 Secret·키와 Secret 타입은 알 수 없습니다.` (서버 `secret-refs.json`의 `note`가 있으면 설명 첫 문장을 그 문구로) |
| 머리 | 안내 아래 16px: caption `text.secondary` `Secret 7개 · 참조 12곳 · secret-refs.json` + 오른쪽 CopyButton md `이름 목록 복사`(복사 값: 한 줄에 `namespace/name`, 이름순) |
| 표 | 데이터 `secretRefs.secrets[]`. DataTable default 40px(여러 줄이면 행 높이 자동, 최소 40px). 열: `네임스페이스`(136px, mono 12) / `Secret 이름`(flex 최소 200px, ResourceName mono 12, keepTail 16, 복사 가능. `optional: true`면 이름 뒤 6px Chip neutral sm `optional`) / `참조 키`(160px, `keys` mono 12 한 줄에 하나, 비었으면 `—` `text.tertiary`) / `참조 방식`(176px, `referencedBy[].via` 중복 제거, Chip neutral sm 간 4px, 줄바꿈 허용) / `참조하는 리소스`(200px: 첫 항목 `StatefulSet postgres`(kind caption + name mono 12) + `외 2개`(`text.tertiary`, 툴팁 전체 목록 `kind name · via · container`)). 첫 항목을 누르면 파일 탭에서 그 리소스 파일 열기(같은 네임스페이스·kind·name의 `files[]` 경로가 있을 때만) |
| `via` → 문구 | `env.valueFrom.secretKeyRef` → `env 키 참조` · `envFrom.secretRef` → `envFrom` · `volumes.secret` → `볼륨` · `volumes.projected.secret` → `projected 볼륨` · `volumes.csi.nodePublishSecretRef` → `CSI 볼륨` · `imagePullSecrets` → `이미지 pull` · `serviceAccount.imagePullSecrets` → `SA 이미지 pull` · `ingress.tls` → `Ingress TLS`. 모르는 값은 원문 mono |
| 정렬 | 기본 네임스페이스 → 이름 오름차순. 네임스페이스·이름 열 정렬 가능 |
| 값 | **어떤 값도 보이지 않는다**(파일에 값이 없다). 참조 위치의 env 이름(`POSTGRES_PASSWORD`)은 이름이므로 툴팁에 보여도 된다(서버가 주는 경우) |
| 0개 | EmptyState sm 아이콘 `key-round` `참조하는 Secret이 없습니다` |
| 파일 없음 | EmptyState sm 아이콘 `file-x` `secret-refs.json이 없습니다`, 설명 `이전 버전 CLI로 만들었거나 파일이 지워졌습니다. 복원 전에 매니페스트의 secretKeyRef·envFrom·volumes·imagePullSecrets를 직접 확인하세요.` |
| 파일 손상·형식 다름 (`secretRefs.state`: `corrupt`/`schema_mismatch`) | InlineAlert **neutral**(상태 영향 없음이라 warn 대신, 아이콘 `file-warning`) `secret-refs.json을 읽을 수 없습니다 (JSON 해석 실패)` / `(형식이 다름)` + 링크 버튼 `파일 보기`(파일 탭, 보기 전용) |
| 없음 판단 | `secretRefs.state: missing` → 위 `파일 없음` 행 |

---

## 9. 메타데이터 탭 `?view=meta`

ASM-D 4.9 구조 그대로(섹션 머리, `표 | 원문 JSON` SegmentedControl, 없음·손상·형식 다름 처리, JsonTree). 표 항목만 다르다.

**KeyValueList columns 2, labelWidth 160px** (순서대로)

| 라벨 | 값 | note |
|---|---|---|
| 생성 시각 | 로컬 시각 + UTC 폴더 이름(mono) | `snapshotId` ≠ 폴더 이름이면 warn `폴더 이름과 다름` |
| CLI | `k8s-snapshot 0.1.0 · Node 22.9.0 · kubectl 1.30.2`(없는 항목 생략) | |
| 클러스터 이름 | mono 12, `null`이면 `알 수 없음`(`text.tertiary`) | |
| 컨텍스트 | mono 12 | |
| 클러스터 ID | mono 12(kube-system UID) + CopyButton sm | 대시보드와 같음 info `대시보드가 연결된 클러스터와 같음` / 다름 warn `대시보드가 연결된 클러스터와 다름 (prod-eks)` / 없음 warn `클러스터 ID 없음 — 드리프트를 계산하지 않음` / 클러스터 연결 없음 info `대시보드 클러스터 연결 없음 — 비교할 수 없음` |
| 서버 버전 | mono 12 `v1.30.4-eks-…` | |
| 네임스페이스 규칙 | `시스템 제외 전체` / `포함: app, data` / `제외: batch`(mono 목록) | 시스템 포함 warn `시스템 네임스페이스 포함` |
| 내보낸 네임스페이스 | mono 12 쉼표 목록 전체, 줄바꿈 허용 | |
| 없던 네임스페이스 | mono 12 목록, 없으면 `없음` | 1개 이상이면 warn `설정에 있지만 클러스터에 없던 네임스페이스` |
| 종류 | `기본 14 · 선택 2 · 사용자 지정 1`(툴팁에 전체 목록 mono) | |
| 리소스 | `128개 · Helm 관리 12 · 제외 9` | Helm 1개 이상 info `Helm 관리 리소스는 Helm으로 복원 권장` |
| 정리 규칙 | `rulesVersion 1`(mono) + 요약 caption | |
| Secret 처리 | `읽지 않음 · 참조 이름만 (secret-refs.json, 7개)` | info `Secret 값은 내보내지 않음` |
| strict | `예` / `아니요` | |
| 내보내기 당시 스캔 | ScanCounts sm inline | |

**종류별 결과 표** (KeyValueList 아래 16px, h3 `종류별 내보내기 결과`): DataTable compact. 열: 종류(flex) / 결과(160px) / 개수(80px 오른쪽). 결과: `내보냄`(caption `text.tertiary`) · `권한 없음` Chip warn sm(아이콘 `lock`) · `API 없음` Chip neutral sm(아이콘 `minus`) · `오류` Chip warn sm(아이콘 `triangle-alert`, 툴팁 서버 사유). 정렬: 권한 없음·오류 → API 없음 → 내보냄, 같으면 종류 순서. 부분 내보내기면 표 위 InlineAlert warn compact `일부 종류를 읽지 못했습니다 (networkpolicies: 권한 없음). 이 종류는 스냅샷에 없습니다.`

---

## 10. 확인 창 · 휴지통 (ASM-D 6·7절과 다른 점)

### 10.1 저장 전 확인 (ASM-D 6.2)

확인 사유에 두 가지를 더한다. **리소스 수 감소 블록(③)은 쓰지 않는다**(파일당 리소스 1개, 명세 5.4).

| 블록 | 사양 |
|---|---|
| ② YAML 구문 | ASM-D 그대로. 모든 리소스 YAML에 적용(AWS는 `cloudformation.yml`만이었음) |
| ⑤ 여러 문서 (신규) | InlineAlert warn: 제목 `문서 2개가 들어 있습니다 (--- 구분)`, 설명 `리소스 1개 = 파일 1개 규칙과 다릅니다. 저장하면 파일 상태가 주의가 되고, 드리프트는 문서마다 따로 비교합니다.` 조건: 검사 결과 `confirmationsRequired`에 `multi_document`(개수 = `check.documents`) |
| ⑥ 경로·내용 불일치 (신규) | 조건: `identity_changed`. InlineAlert warn: 제목 `파일 경로와 리소스가 다릅니다`, 본문 KeyValueList 1열 labelWidth 72px: `경로` `check.identity.expected`(`Deployment app/api`, mono) · `내용` `check.identity.actual`(`Deployment app/api-v2`, mono), 설명 `저장하면 파일 상태가 주의가 되고, 드리프트는 파일 내용 기준으로 짝을 맞춥니다.` |
| `kind: Secret` 값 | 스캔 오류(`k8s-secret-object`)라 블록 ①(오류)과 danger 확인(`커밋 금지 상태로 저장`)으로 처리. 별도 블록 없음 |
| 순서 | ① 오류 → ② YAML 구문 → ⑥ 경로·내용 → ⑤ 여러 문서 → ④ 경고(접힘) |
| tone·버튼 | ASM-D 그대로(오류 남음이면 danger) |

### 10.2 휴지통으로 이동 · 영구 삭제 (ASM-D 6.6·6.8)

| 요소 | 다른 점 |
|---|---|
| 요약 | `시각` · `라벨` · `클러스터`(mono, 다른 클러스터면 뒤에 `다른 클러스터`) · `상태` StatusBadge sm(파일 상태만) |
| 파일 목록 | 개별 파일 목록 대신 captionStrong `폴더 안 파일 128개 · 1.4 MB`(`folder.fileCount`·`sizeBytes`) + 최상위 목록(`folder.topLevel`, mono 12, 한 줄 20px, 최대 높이 160px 스크롤): 폴더는 `app/  42개`(`fileCount`), 파일은 이름만, `unexpected: true`는 이름 + Chip warn `예상 밖` |
| 안내 | ASM-D 문구에서 raw 데이터 줄 없음 |

### 10.3 Kubernetes 휴지통 `/snapshots/k8s/trash` (ASM-D 7절)

- 브레드크럼 `Kubernetes 스냅샷 › 휴지통`. 제목·보조 줄·Banner는 ASM-D 그대로.
- 표 열: ASM-D 7절에서 `리전`(136px) 대신 **`클러스터`**(136px, `cluster.name` mono 12, 없으면 `cluster.context`, `cluster: null`이면 `—`). `파일` 열 값은 `fileCount`(재귀 파일 수). 나머지 같음. 1024~1279px에서 `클러스터` 열 숨김.
- 휴지통 항목은 드리프트를 계산하지 않고 보이지 않는다.

### 10.4 라벨·메모 · 복원 · 저장 충돌 · 저장하지 않은 변경

ASM-D 6.1·6.3·6.4·6.5·6.7 그대로. 6.4의 "다른 파일 탭 클릭"은 **트리에서 다른 파일 열기**, **드리프트 목록의 `파일 보기`**, **발견 항목으로 다른 파일 열기**로 읽는다.

---

## 11. mock 시나리오 (MOCK 배지 Popover)

- `DataSourceBadge`에 그룹 **`k8s-snapshots`**(표시 이름 `Kubernetes 스냅샷`)를 추가한다(K8S-API 14.4). 순서: 클러스터 → DB → 비용 → 어드바이저 → AWS 스냅샷(`snapshots`) → **Kubernetes 스냅샷**. **그룹은 하나뿐**이다(드리프트 시나리오도 이 그룹 안. 별도 드리프트 그룹 없음).
- 라디오 문구 ↔ id(계약 값): `예시 스냅샷 (기본)` = `default` · `스냅샷 0개` = `empty` · `설정 없음` = `not-configured` · `폴더 없음` = `unavailable` · `읽기 전용` = `read-only` · `쓰기 기능 꺼짐` = `write-disabled` · `다음 저장 충돌` = `conflict-once` · `클러스터 연결 없음 (드리프트)` = `cluster-disconnected` · `드리프트 없음` = `no-drift`. 서버가 `label`을 주면 서버 값을 쓴다.
- 기본 시나리오의 예시 `20260910-000000`은 "지난 결과 · 전체 결과 있음"(6.8)을 확인하는 예시다(mock에서는 10분 뒤에도 전체 결과를 유지).
- 기본 시나리오에서 명세 5.7 예시 1~10과 휴지통 예시가 한 화면(목록)에 모두 보여야 한다. 예시 1(최신)의 드리프트 탭에서 변경·삭제·추가·숨긴 기본값 차이·관리 필드·비교 불가·가린 값이 모두 보여야 한다.

---

## 12. 상태 표시 규칙 (이 기능 전체)

`status.md` 10절에 공유 규칙을 올렸다. 화면별 모습:

**파일 상태** — ASM-D 9절 표 그대로 + 아래 행

| 경우 | 배지 | 사유 예 | 목록 | 상세 |
|---|---|---|---|---|
| `k8s-env-literal`·`k8s-secret-object`·`k8s-dockerconfig` 오류 | crit `커밋 금지` | `비밀값 의심 1건 (k8s-env-literal)` | crit 막대, `⊗ 오류 1` | 파일 탭 스캔 발견, 트리 아이콘 |
| 부분 내보내기 | warn `주의` | `일부 종류를 읽지 못함 (networkpolicies: 권한 없음)` | - | 메타데이터 탭 경고, 종류별 결과 표 |
| YAML 해석 실패 / 경로·내용 불일치 / 중복 정의 / 런타임 필드 남음 | warn `주의` | `YAML 해석 실패 2개` 등 | - | 트리 `file-warning`, 편집기 알림 슬롯 |
| 리소스 0개 / 예상 밖 파일 / `notes.json` 손상 | warn `주의` | ASM-D와 같은 형식 | - | 트리 `예상 밖 파일` 그룹 |

**드리프트 상태** — 파일 상태와 **다른 축**

| 경우 | 모습 | 목록 | 상세 헤더 | 드리프트 탭 |
|---|---|---|---|---|
| 차이 있음 (API warning) | warn 배지 `차이 N건` | 3.5 | chips 줄 md | 6.3 lg |
| 차이 없음 (ok) | ok 배지 `차이 없음` | 3.5 | md | 6.8 |
| 알 수 없음 (unknown) | unknown 배지 `알 수 없음` + 사유 | 3.5 | md | 6.8 UnknownState |
| 계산 안 함 (`DRIFT_NOT_COMPUTED`, mode `none`) | 배지 없음, `minus` + `계산 안 함` `text.tertiary` | 3.5 | `드리프트 — 계산 안 함` + 버튼 | 6.8 EmptyState |
| 지난 결과 (`DRIFT_NOT_COMPUTED`, mode `last_result`) | 위 + `지난 결과 차이 N건 · 날짜`(회색) | 3.5 | 위 + 지난 결과 문구 | 6.8 지난 결과(전체 결과 10분 / 요약만) |
| stale | stale 배지 | 3.5 | md stale | 6.8 |
| (API critical이 오면) | 설계상 없음 → unknown으로 보이고 콘솔 경고(`status.md` 8절 원칙) | | | |

- 상태·사유·건수·분류·가림은 **서버 값만** 쓴다(명세 4.6, `docs/api/common.md` 2.2). 화면은 다시 계산하지 않는다.
- 드리프트는 사이드바, 요약 띠 왼쪽 블록, 표의 crit 행 막대, 개요(`/`)에 영향을 주지 않는다.

---

## 13. 반응형

| 뷰포트 | 목록 (k8s 탭) | 상세 파일 탭 | 상세 드리프트 탭 |
|---|---|---|---|
| ≥ 1440px (본문 1160px) | 3.4 열 전체 | 탐색 4열 + 편집기 8열 | 요약 12열, 목록 4열 + 차이 8열 |
| 1280~1439px (본문 1168~1327px) | 같음 (늘어난 폭은 스냅샷 열) | 같음 | 같음 |
| 1024~1279px (본문 976~1231px) | `범위`, `마지막 수정` 열 숨김(상세에서 확인). 파일 176 → 168px, 드리프트 160 → 152px. 요약 띠 항목 최소 폭 96px. FilterBar 줄바꿈. 탭 줄 그대로(가로 스크롤 없음: 두 탭 합계 폭 < 400px) | 같은 4:8 비율(탐색 330px). 탐색 패널 머리 SegmentedControl 라벨 `리소스 128` / `발견 2`로 축약 | 요약 ② 칸 최소 폭 96px. 목록을 위(12열, 최대 높이 280px 스크롤), 차이를 아래(12열, 높이 작업 영역)로 쌓는다. 필드 차이 표 폭 < 736px면 값 열 176 → 144px |
| < 1024px | 지원 대상 아님(1024px 기준 가로 스크롤) | 같음 | 같음 |

- 상세 PageHeader의 chips 줄과 보조 줄은 1024px에서 줄바꿈을 허용한다(배지와 사유는 같은 줄에 붙여 둔다).

## 14. 접근성

- ASM-D 11절 전체 그대로.
- 두 배지 구분: 파일 배지 `aria-label="파일 상태: 커밋 금지, 비밀값 의심 1건 (k8s-env-literal)"`, 드리프트 배지 `aria-label="드리프트: 차이 3건, 변경 2 · 삭제 1"`. `LabeledStatus`의 보이는 라벨(`드리프트`)과 같은 말을 쓴다. 목록 표 열 머리글은 `파일`, `드리프트`.
- `계산 안 함`은 배지가 아니므로 `aria-label="드리프트: 계산 안 함"`을 텍스트에 붙인다.
- 드리프트 구분(추가·삭제·변경)은 모양이 다른 아이콘(`square-plus`/`square-minus`/`square-dot`) + 문구로 구분한다. 색으로 구분하지 않는다(모두 `text.secondary`).
- 필드 차이의 화살표는 `aria-hidden`, 행 읽기 문구는 6.5 스크린리더 규칙.
- 가린 값: `aria-label="가린 값, 값 다름, 앞 2글자 ex, 16자"`처럼 서버 문자열을 풀어 읽지 않고 그대로 읽어도 된다(서버 문자열이 이미 원문이 아님).
- 트리: 5.2 키보드. 편집기 포커스 이동 시 live 문구 `data/statefulsets/postgres.yaml 41번째 줄, 오류 k8s-env-literal`.
- 드리프트 재계산으로 값이 바뀌면 요약 ①만 `aria-live="polite"` `드리프트 차이 3건에서 2건으로 바뀜`. 목록·표는 알리지 않는다.
- 사용자 입력·파일 내용·리소스 이름·어노테이션 값·Secret 이름은 모두 텍스트 노드로만 렌더한다.

## 15. 컴포넌트 사용 목록 (이 기능)

| 컴포넌트 | 새/기존 | variant / size / state |
|---|---|---|
| **LinkTabs** | 새(components.md 14.1) | 항목 current / hover / focus, 상태 아이콘·커밋 금지 pill·드리프트 칩 |
| **LabeledStatus** | 새(14.2) | sm / md |
| **DriftStatus** | 새(14.3) | sm / md / lg, changed / none / unknown / notComputed(+ lastResult) / computing / stale |
| **DriftKindIcon / DriftKindChip** | 새(14.3) | added / deleted / changed / same, Chip sm / md |
| **ResourceTree** | 새(14.4) | variant files / drift, 행 default / hover / selected / focus / disabled, loading / empty / filteredEmpty |
| **DriftSummary** | 새(14.5) | ready / refreshing / stale / loading |
| **FieldDiffTable** | 새(14.6) | 행 change / default / managed, 숨긴 그룹 접힘·펼침, 값 확장, loading |
| **DiffValue / MaskedValue** | 새(14.7, 14.8) | 짧은 값 / 여러 줄 / 없음 / 가림 |
| NoExecuteNotice `text` | 기존 확장(15.4) | |
| ScanFindingList `truncateFile` | 기존 확장(15.3) | |
| DataSourceBadge 그룹 `k8s-snapshots` | 기존 확장(15.2) | |
| SideNav (라벨 `스냅샷`) | 기존(데이터만 변경) | |
| Tabs `count`·`countLabel`·`status`·`dirty` | 기존 | 상세 탭 6개(2026-09-20 `3D 보기` 추가, `snapshot-3d.md` 13절) |
| SummaryStrip `overall.label`, `updatedLabel`, `actions` | 기존(ASM) | |
| DataTable comfortable / compact / default, `groupRow` | 기존 | |
| CodeEditor, ScanCounts, TextField/TextArea, TypeToConfirmDialog, CommandSteps, CommandLine | 기존(ASM) | ASM-D 12절 그대로 |
| KeyValueList `note`, Dialog 확장 | 기존(ASM) | |
| StatusBadge, Chip, InlineAlert, Banner, EmptyState, UnknownState, ErrorState, Skeleton, StaleNotice, Switch, SegmentedControl, SearchInput, Select, MultiSelect, FilterBar, CopyButton, Button, IconButton, HelpPopover, JsonTree, ResourceName, Timestamp, Spinner | 기존 | |

## 16. API 값 ↔ 화면 매핑 (K8S-API 기준, 프론트 매핑용)

| 화면 개념 | API 필드·값 | 비고 |
|---|---|---|
| 파일 상태 | `status` (`StatusInfo`, 11.1 코드) | `status.md` 8.1 변환 + 9절 문구 |
| 드리프트 배지 | `drift: DriftBadge` — `status.status` `ok`/`warning`/`unknown`, `status.reasons[].code`, `status.stale`, `mode` `auto`/`on_demand`/`last_result`/`none`, `computing`, `computedAt`, `lastResultStatus`, `counts`, `resultAvailable` | `DriftStatus.state` 매핑: stale → `stale`; 코드 `DRIFT_NOT_COMPUTED` → `notComputed`(mode `last_result`면 `lastResult` 채움); `warning` → `changed`; `ok` → `none`; 그 밖 `unknown` → `unknown` |
| 드리프트 건수 | `counts.changed` / `deleted` / `added` / `same` / `compared`, `hidden.default` / `hidden.managed`, `uncomparable`, `unparsable` | 화면 구분 이름 "삭제"는 API `deleted` |
| 리소스 구분 | `resources[].change` `added`/`deleted`/`changed`/`same`, 파일 쪽 `files[].drift` `same`/`changed`/`deleted`/`uncomparable`/`skipped` | `DriftKind` = `added`\|`deleted`\|`changed`\|`same` |
| 필드 분류 | `fields[].category` `changed`/`default`/`managed`, `reason`, `managedRule` | |
| 값 | `DiffValue` `scalar`/`list`/`masked`, `null` = 없음 | 6.7 |
| 비교 불가 | `uncomparable[].reason` `NOT_IN_RBAC`/`FORBIDDEN`/`API_VERSION_MISMATCH`, 트리 `kinds[].drift` `comparable`/`not_in_rbac`/`forbidden`/`api_version_mismatch` | 6.3 ④, 5.2 |
| 클러스터 관계 | `cluster.relation` `same`/`other`/`unknown` | 3.4, 필터 `cluster` |
| 목록 필터 | `status` `ok,warning,critical,unknown` · `drift` `ok,warning,unknown,not_computed` · `cluster` `same,other,unknown` · `q` · `sort` `snapshotAt:desc\|asc`, `status:desc\|asc` · 개수 `facets` | 3.3 |
| 메뉴·탭 | `GET /api/snapshot-menu` `menu.status`/`count`/`showIcon`, `tabs.aws\|k8s.included`/`status`/`critical`, `tabs.k8s.latestDrift` | 2.1, 2.3 |
| 계산 버튼 | `actions.computeDrift` `allowed`/`reasonCode`/`reasonText` | 3.5.1 |
| 명령 | `resources[].commands.diff`/`apply`, `commandsNote`, `snapshotCluster`, `fileDocuments` | 6.5 |
| CLI 안내 | `cli.install`/`configure`/`dryRun`/`export`/`scan`/`readme`/`settings[]`/`exitCodes[]` | 3.6. 설정 이름은 `KUBE_CONTEXT` 등 서버 값 |
| 정보 문구 | `notices[].code` (11.4) | 4.4, 6.3 ⑤ |
| mock 그룹 | `k8s-snapshots` (하나) | 11절 |
