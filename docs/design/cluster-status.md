# 화면 설계: cluster-status

- 작성: designer, 2026-09-19
- 명세: `docs/specs/cluster-status.md`
- 공통: `docs/design/shell.md`(셸), `docs/design/status.md`(상태·차트·표 규칙), `docs/design/components.md`(컴포넌트), `docs/design/tokens.json`
- 그리드: 12열, gutter 16px, 본문 패딩 24px. 아래 "N열"은 12열 기준 차지 폭.

## 0. 화면 목록

| # | 화면 | 경로 | 목적 |
|---|---|---|---|
| 1 | 개요 | `/` | 5초 안에 "지금 문제가 있는가, 어디인가" |
| 2 | 노드 목록 | `/cluster/nodes` | 노드 상태·사용률 |
| 3 | 노드 상세 | `/cluster/nodes/[name]` | 조건·용량·추이·올라간 파드 |
| 4 | 워크로드 목록 | `/cluster/workloads` | ready/desired, 롤아웃, 파드 분포 (행 펼침으로 소속 파드) |
| 5 | 파드 목록 | `/cluster/pods` | 수백 행, 필터, 문제 파드 먼저 |
| 6 | 파드 상세 | `/cluster/pods/[namespace]/[name]` | 컨테이너 상태·사유·이벤트·소속 |
| 7 | 이벤트 | `/cluster/events` | 최근 1시간 Warning |
| 8 | DB 상세 | `/cluster/db` | Postgres 쿠버네티스 쪽 + 내부 지표 |

- 워크로드 상세 화면은 따로 두지 않는다. 파드 상세의 "소속 워크로드" 링크는 `/cluster/workloads?focus=<kind>/<namespace>/<name>`으로 가서 해당 행을 펼치고 `bg.selected`로 강조, 화면 가운데로 스크롤한다.
- 목록 필터·정렬은 URL 쿼리에 둔다(뒤로 가기·링크 공유).

## 1. 정보 우선순위 (모든 화면 공통)

1. **전체 상태와 그 이유** (가장 크고 왼쪽 위)
2. **장애·주의 항목 이름과 사유** (카드 안 문제 항목, "지금 확인할 항목" 목록, 목록의 기본 정렬)
3. 수량(Ready 5/6, 파드 분포)
4. 추이(차트)
5. 메타데이터(버전, 생성 시각 등)

정상 항목은 시각적으로 조용하게: ok는 subtle 배지만, 카드 왼쪽 막대 없음, 사이드바 아이콘 없음.

---

## 2. 개요 `/`

### 2.1 레이아웃 (1440px 기준, 본문 폭 1440 − 232 − 48 = 1160px)

```
PageHeader: "개요"                                         [시스템 네임스페이스 숨기기 ◯]
┌ SummaryStrip (12열, 88px) ─────────────────────────────────────────────────────┐
│ [● 장애] 파드 api-7f9c… CrashLoopBackOff 외 2건 │ 노드 │ 파드      │ 워크로드 │ 이벤트 │ DB   │ 마지막 갱신 │
│ prod-eks · v1.30 · ap-northeast-2              │ 5/6  │ 2·3·51   │ 1·0·23  │ 7     │ 주의 │ 14:02:10   │
└────────────────────────────────────────────────────────────────────────────────┘
┌ 노드 ────┐┌ 워크로드 ┐┌ 파드 ────┐┌ 이벤트 ──┐┌ DB ──────┐   ← StatusCard ×5 (각 ≈ 219px, 176px 높이)
└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
┌ 지금 확인할 항목 (12열) ────────────────────────────────────────────────────────┐
│ [장애] 파드  prod / api-7f9c…-x2kq9   CrashLoopBackOff · 최근 1시간 재시작 6회   2분 전 │
│ [장애] 노드  ip-10-0-12-34            NotReady 3분                              3분 전 │
│ [주의] DB    postgres                 연결 82% (max 100)                        1분 전 │
│ … 최대 8행                                                        [모두 보기 (13)] │
└────────────────────────────────────────────────────────────────────────────────┘
┌ 클러스터 CPU (6열, 240px) ──────────┐┌ 클러스터 메모리 (6열, 240px) ─────────┐
│ 사용 / requests / limits 막대 3개    ││ 동일                                  │
│ 추이 1시간 (주의 70%, 장애 90% 점선)  ││ (주의 75%, 장애 90%)                   │
└────────────────────────────────────┘└──────────────────────────────────────┘
┌ 비용 요약 (6열) ────────────────────┐┌ 어드바이저 요약 (6열) ─────────────────┐
└────────────────────────────────────┘└──────────────────────────────────────┘
```

### 2.2 SummaryStrip (명세 3.1)

| 칸 | 폭 | 내용 |
|---|---|---|
| 전체 상태 | 320px | `StatusBadge size=lg variant=solid`(ok면 subtle) + ReasonText(1줄, crit이면 빨강 600). 아래 caption `prod-eks · v1.30 · ap-northeast-2` |
| 노드 | 최소 120px | label `노드 Ready`, value `5/6` (Ready < 전체면 앞에 상태 아이콘) → `/cluster/nodes` |
| 파드 | 최소 160px | label `파드`, value `2 · 3 · 51` 각 숫자 앞 12px 아이콘(crit, warn, ok). 0인 칸은 `text.disabled` → `/cluster/pods` |
| 워크로드 | 최소 160px | 파드와 같은 형식 → `/cluster/workloads` |
| 이벤트 | 최소 120px | label `Warning 15분`, value `7` → `/cluster/events` |
| DB | 최소 120px | label `DB`, value `StatusBadge md` → `/cluster/db` |
| 마지막 갱신 | 140px, 오른쪽 정렬 | label `마지막 갱신`, value `14:02:10`(metricSm, tabular). stale이면 `status.stale.valueText` |

- 1280~1439px: 전체 상태 칸 280px, 나머지 칸 최소 폭 100px. 1024~1279px: 두 줄(1줄: 전체 상태 + 마지막 갱신, 2줄: 5개 수량 칸), 높이 136px.
- MOCK 배지는 상단바에 있으므로 띠에 반복하지 않는다(명세 3.1의 "데이터 소스"는 상단바가 담당).

### 2.3 영역 카드 5개 (`StatusCard`)

순서 고정: 노드 → 워크로드 → 파드 → 이벤트 → DB. 순서를 바꾸지 않고 강조로 우선순위를 준다(crit 카드는 solid 배지 + 2px 빨강 테두리 + 왼쪽 막대).

| 카드 | 아이콘 | primary | counts | 문제 항목(최대 3) | 링크 |
|---|---|---|---|---|---|
| 노드 | `server` | `Ready 5/6` | - | 장애·주의 노드 이름(ResourceName kind=node) + 사유 | `/cluster/nodes?status=crit,warn` (문제 없으면 필터 없음) |
| 워크로드 | `boxes` | `24개` | 장애 · 주의 · 정상 | 이름 + `ready 0/3` | `/cluster/workloads?status=…` |
| 파드 | `box` | `56개` | 장애 · 주의 · 정상 | 이름 + 대기 사유 | `/cluster/pods` (기본 정렬이 장애 먼저) |
| 이벤트 | `bell-ring` | `Warning 7건 (15분)` | - | reason + 대상 | `/cluster/events` |
| DB | `database` | `연결 82%` 또는 대표 지표 | - | 주의·장애 지표 이름 + 값 | `/cluster/db` |

- 카드 폭: ≥1440px 5열 한 줄(각 (본문폭 − 64) ÷ 5). 1280~1439px: 한 줄 유지(최소 폭 200px). 1024~1279px: 3 + 2 두 줄.
- 카드 높이 176px 고정. 구성(위→아래): 머리(아이콘 20 + 제목 h3 + 오른쪽 배지 md, 높이 24px) → 12px → primary(metricMd 20/28) + counts(caption) → 8px → 문제 항목 목록(행 20px, caption, 최대 3행) 또는 ReasonText 2줄 → 하단 `목록 보기 →`(caption, link색, 하단 16px 고정).
- 카드가 정상이면 문제 항목 자리를 비워 둔다(스파크라인·장식 없음. 정상은 조용하게).

### 2.4 지금 확인할 항목

- 서버가 준 crit·warn 항목을 모아 crit → warn, 같은 등급은 상태가 바뀐 시각 최근 순. 최대 8행.
- 행(40px): StatusBadge sm | 영역 라벨(caption, 폭 56px: 노드/워크로드/파드/이벤트/DB) | ResourceName(최대 360px, 네임스페이스 포함 `ns / name`) | ReasonText(flex) | 상태 변경 시각 상대(`2분 전`, 폭 72px, 오른쪽 정렬).
- 행 클릭 → 해당 상세(파드·노드·DB) 또는 목록 focus.
- 0건이면 섹션 전체를 한 줄 카드(48px)로: `circle-check` 16px `status.ok.fg` + `주의·장애 항목이 없습니다` (body, text.secondary).
- 9건 이상이면 오른쪽 아래 `모두 보기 (13)` 버튼(ghost sm). 여러 영역이 섞여 있으므로 목록 페이지가 아니라 Drawer(md 480px)로 전체 목록을 연다.

### 2.5 CPU·메모리 영역 (명세 3.6)

- 카드 2개(각 6열). 카드 머리: 제목 `클러스터 CPU` + StatusBadge md + ReasonText.
- 막대 3줄(각 행 높이 28px): `사용량` / `requests 합계` / `limits 합계` — 라벨 폭 96px, UsageBar md(사용량 행만 warnAt·critAt 표시선), 오른쪽 값 `1,250m / 8,000m (16%)`. limits는 100% 초과 가능(오버커밋) → 초과 표시.
- 아래 TimeSeriesChart 240px: 사용률 %, 0~100 고정, 임계선 주의·장애.
- 기간: 1시간(Prometheus 있으면 `1시간 | 6시간 | 24시간` SegmentedControl sm, 기본 1시간).
- metrics-server 없음: 카드 본문 전체를 UnknownState(sm): `알 수 없음 (metrics-server 없음)` + hint `EKS 애드온 metrics-server를 설치하면 표시됩니다`. 카드 배지 unknown.

### 2.6 비용·어드바이저 요약 카드 (다른 기능 진입점)

- 비용(6열, 높이 136px, MetricTile 변형): 제목 `비용` + 비용 전체 상태 배지. 본문 `≈ $1.10/h`(추정, 배지) · `이번 달 확정 $512`(확정 배지) · 예산 상태 한 줄. → `/cost`. 상세 형식은 `aws-cost.md` 2.3과 같은 MoneyValue 규칙.
- 어드바이저(6열, 높이 136px): 제목 `어드바이저` + 사전 점검 요약 배지(`높음 2건`). 본문: 사전 점검 `높음 2 · 중간 7 · 낮음 11`, 마지막 분석 `9월 18일 14:03 · 제안 9건`, 브리지 상태 dot. → `/advisor`.
- 두 기능 API가 실패하면 해당 카드만 UnknownState(sm). 개요의 다른 영역에 영향 없음.

### 2.7 상태별 모습

| 상태 | 모습 |
|---|---|
| 로딩(최초 스냅샷 전) | SummaryStrip 스켈레톤(88px, 칸 경계 유지), 카드 5개 스켈레톤(176px), 확인 항목 스켈레톤 3행, 차트 스켈레톤 240px |
| 빈 클러스터(노드 0) | 명세상 전체 장애. SummaryStrip crit `노드 0개`, 노드 카드 crit, 파드·워크로드 카드는 `0개` + ok, 확인 항목 1행(`노드가 없습니다`) |
| 연결 끊김 | 전역 배너(`shell.md`), 값 유지, 45초(메트릭) / heartbeat×3 후 개별 stale: 카드 dashed 테두리, 배지 `데이터 오래됨 · HH:mm:ss 기준`, SummaryStrip 마지막 갱신 값 stale 색 |
| 클러스터 연결 없음(live, kubeconfig 없음) | SummaryStrip 전체 상태 `알 수 없음` + 이유 `클러스터 연결 없음`, 노드·워크로드·파드·이벤트 카드 unknown(UnknownState 대신 카드 모양 유지, primary `—`), DB 카드는 DB 접속 결과대로(DB 접속은 별도) |
| API 오류 | 셸 ErrorState(lg) (`shell.md` 5절) |
| mock | 상단바 MOCK 배지만. 화면은 live와 동일 |

---

## 3. 노드 목록 `/cluster/nodes`

### 3.1 레이아웃

```
PageHeader "노드"  [StatusBadge 영역 상태] 이유
FilterBar: [상태 SegmentedControl: 전체 6 | 장애 1 | 주의 1 | 정상 4 | 알 수 없음 0] [노드그룹 ▾] [AZ ▾] [구매 옵션 ▾] [검색 240px]
DataTable (12열, 행 40px)
```

### 3.2 열

| 열 | 폭 | 내용 |
|---|---|---|
| 상태 | 112px | StatusBadge sm (+ `스케줄 제외` 칩은 이름 열 뒤) |
| 이름 | 최소 200, 최대 280px | ResourceName kind=node + 칩(`스케줄 제외`, `스팟`) |
| 사유 | flex, 최소 200px | ReasonText |
| 노드그룹 | 140px | text |
| 인스턴스 타입 | 112px | mono 12 |
| AZ | 120px | `ap-northeast-2a` |
| CPU | 140px | UsageBar sm + `62%` (warnAt 70, critAt 90) |
| 메모리 | 140px | UsageBar sm + `81%` (75, 90) |
| requests | 120px | `CPU 88% · Mem 64%` caption, 85% 이상 값은 warn 아이콘 12px |
| 파드 | 80px | `23/29`, 오른쪽 정렬 |
| 경과 | 72px | `12일` |

- kubelet 버전·할당 가능량은 목록에서 빼고 상세에 둔다(폭 절약).
- 정렬: 상태 → 이름. 행 클릭 → 노드 상세.

### 3.3 상태별
- 로딩: 스켈레톤 6행. 빈(노드 0): EmptyState lg `노드가 없습니다` + 설명 `클러스터에 Ready 노드가 없으면 모든 워크로드가 실행되지 않습니다.`(상태는 SummaryStrip과 같게 crit). metrics-server 없음: CPU·메모리 열 셀에 `—` + 열 머리글에 `circle-help` 아이콘과 툴팁 `metrics-server 없음`. 연결 끊김·stale: `status.md` 2.2.

## 4. 노드 상세 `/cluster/nodes/[name]`

```
Breadcrumb: 노드 › ip-10-0-12-34
PageHeader: ip-10-0-12-34.ap-northeast-2.compute.internal [StatusBadge lg] 이유
            칩: m6i.large · 온디맨드 · ap-northeast-2a · batch · kubelet v1.30.2 · 12일
┌ 조건 (4열) ──────────┐┌ 용량 (8열) ─────────────────────────────────────────┐
│ Ready        True ✓  ││ CPU    사용량 UsageBar md  1,250m / 1,930m (65%)      │
│ MemoryPressure False ││        requests            1,700m / 1,930m (88%) ⚠    │
│ DiskPressure  False  ││ 메모리 사용량 …                                         │
│ PIDPressure   False  ││        requests …                                      │
│ NetworkUnavail False ││ 파드   23 / 29                                          │
│ 스케줄 가능    예     ││                                                        │
└──────────────────────┘└────────────────────────────────────────────────────────┘
┌ CPU 추이 (6열, 240px) ┐┌ 메모리 추이 (6열, 240px) ┐
┌ 이 노드의 파드 (12열) — 파드 목록과 같은 표, 노드 열 제외 ───────────────────────┐
┌ 관련 Warning 이벤트 (12열) — 이벤트 표, 대상이 이 노드 또는 이 노드의 파드 ──────────┐
```

- 조건 표: 행 32px, 조건 이름(body) | 값(mono) | 상태 아이콘 16px(정상이면 `circle-check` ok, 문제면 해당 상태) | 지속 시간(`3분째`). 문제 조건 행은 배경 `status.<key>.bg`.
- 노드를 찾을 수 없음(삭제됨): EmptyState lg `노드를 찾을 수 없습니다` + `삭제되었거나 이름이 바뀌었을 수 있습니다` + 버튼 `노드 목록으로`.

## 5. 워크로드 목록 `/cluster/workloads`

FilterBar: 상태 SegmentedControl | 종류 SegmentedControl(`전체 | Deployment | StatefulSet | DaemonSet`) | 네임스페이스 MultiSelect | 시스템 숨기기 Switch | 검색.

| 열 | 폭 | 내용 |
|---|---|---|
| 펼침 | 32px | chevron |
| 상태 | 112px | StatusBadge sm |
| 종류 | 112px | `Deployment` caption |
| 네임스페이스 | 140px | text + 시스템이면 `시스템` 칩 |
| 이름 | 최소 200, 최대 320px | ResourceName + `중지됨` 칩(desired 0) |
| 준비 | 88px | `2/3` (ready/desired), 오른쪽 정렬, 불일치면 앞에 상태 아이콘 12px |
| 업데이트 | 72px | `3/3` |
| 사유 | flex, 최소 200px | ReasonText (`롤아웃 진행 중`, `ProgressDeadlineExceeded`) |
| 파드 분포 | 120px | DistributionBar 8px (crit/warn/ok 세그먼트) + 툴팁 |
| 이미지 | 200px | mono 12, 가운데 말줄임, 여러 컨테이너면 첫 번째 + `외 1` |
| 마지막 롤아웃 | 96px | 상대 시각 |

- 펼친 영역: 소속 파드 표(파드 목록과 같은 열, compact 32px, 최대 10행 + `파드 목록에서 보기`), 조건 메시지.
- `?focus=` 로 들어오면 해당 행 펼침 + `bg.selected`.

## 6. 파드 목록 `/cluster/pods` (수백 행)

### 6.1 레이아웃

```
PageHeader "파드"  [영역 상태 배지] 이유
FilterBar (48px):
  [상태: 전체 412 | 장애 2 | 주의 3 | 정상 405 | 알 수 없음 2]  [네임스페이스 ▾ 180px]
  [시스템 숨기기 ◯] [완료된 파드 보기 ◯] [검색 이름·노드·워크로드 240px]            파드 412개 중 412개 표시
DataTable (virtualized, 높이 = 뷰포트 − 상단 요소, 최소 400px)
```

- 상태 SegmentedControl: 각 항목 앞 12px 상태 아이콘 + 개수. 기본 `전체`.
- `시스템 숨기기` 기본 꺼짐(명세 A6: 기본 표시). `완료된 파드 보기` 기본 꺼짐(Succeeded Job 파드 숨김).
- 검색: 이름·노드·워크로드 부분 일치, 200ms 디바운스, `/` 단축키.

### 6.2 열

| 열 | 폭 | 내용 |
|---|---|---|
| 상태 | 112px | StatusBadge sm |
| 이름 | 최소 240, 최대 360px | ResourceName kind=pod (끝 16자 보존) |
| 네임스페이스 | 140px | text + `시스템` 칩 |
| 사유 | flex, 최소 200px | ReasonText: 대기 사유(mono 12 `CrashLoopBackOff`) + ` · 최근 1시간 재시작 6회` |
| 준비 | 64px | `1/2` |
| 재시작(1h) | 96px | 숫자, 1~2 warn 아이콘, 3 이상 crit 아이콘. 관측 1시간 미만이면 머리글 옆 `관측 23분` 칩 |
| 누적 재시작 | 88px | 숫자 `text.secondary` |
| CPU | 96px | `120m` |
| 메모리 | 160px | `412 MiB` + UsageBar sm(limit 대비, warnAt 80 critAt 95). limit 없으면 막대 없이 `limit 없음` caption |
| 노드 | 160px | ResourceName kind=node, 링크 |
| 경과 | 72px | `3시간 4분` |

- 기본 정렬: 상태 → 최근 1시간 재시작 내림차순 → 네임스페이스 → 이름.
- 행 클릭 → 파드 상세. 노드 셀 클릭은 노드 상세(이벤트 전파 중지).
- 실시간 재정렬 보류 규칙: `status.md` 5.2.
- 1280px 미만: `누적 재시작`, `경과` 열을 숨긴다.

### 6.3 상태별
| 상태 | 모습 |
|---|---|
| 로딩 | FilterBar 활성(개수 자리 스켈레톤), 표 스켈레톤 10행 |
| 파드 0개 | EmptyState lg `파드가 없습니다` |
| 필터 결과 없음 | `필터 조건에 맞는 파드가 없습니다` + `필터 초기화` |
| metrics-server 없음 | CPU·메모리 셀 `—`, 머리글 툴팁 |
| 클러스터 연결 없음 | 표 대신 UnknownState lg `알 수 없음 (클러스터 연결 없음)` + hint `kubeconfig를 확인하세요` |
| 연결 끊김 | 배너 + heartbeat×3 후 상태 셀 stale |

## 7. 파드 상세 `/cluster/pods/[namespace]/[name]`

```
Breadcrumb: 파드 › prod
PageHeader: prod / api-7f9c8d6b5-x2kq9 [장애 lg] CrashLoopBackOff · 최근 1시간 재시작 6회
            칩: Running · QoS Burstable · 경과 3시간 4분
┌ 컨테이너 (8열) ─────────────────────────────────────┐┌ 정보 (4열) KeyValueList ─────┐
│ 컨테이너 카드 ×N                                      ││ 네임스페이스  prod            │
│  api  [장애] 대기: CrashLoopBackOff                   ││ 소속 워크로드 Deployment api → │
│   준비 아니오 · 재시작 1h 6 / 누적 41                  ││ 노드         ip-10-0-12-34 → │
│   마지막 종료: OOMKilled (137) · 14:01:52              ││ phase        Running         │
│   CPU  120m  requests 250m  limits 500m               ││ QoS          Burstable       │
│   메모리 UsageBar 498 MiB / 512 MiB (97%)              ││ 시작         9월 19일 10:58  │
│  sidecar [정상] …                                    ││ 파드 IP      10.0.12.87      │
└──────────────────────────────────────────────────────┘└──────────────────────────────┘
┌ CPU 추이 (6열, 160px) ┐┌ 메모리 추이 (6열, 160px, limit 대비 %, 80/95 임계선) ┐
┌ 관련 Warning 이벤트 (12열) ─────────────────────────────────────────────────────────┐
```

- 컨테이너 카드: Card md 패딩 16px, 카드 간 12px. 머리: 컨테이너 이름(mono 13 600) + StatusBadge sm + 상태 텍스트. 본문 KeyValueList 2열. 문제 컨테이너가 위.
- 종료 사유 `OOMKilled`는 mono + crit/warn 아이콘. 종료 코드 괄호.
- 소속 워크로드·노드 링크는 `text.link` + `chevron-right` 12px. (명세 수용 기준: 이동 가능)
- 이벤트 표에서 대상이 이 파드인 것만. 없으면 한 줄 `최근 1시간 Warning 이벤트 없음`.
- 파드 삭제됨: EmptyState lg `파드를 찾을 수 없습니다` + `재생성되었으면 워크로드에서 새 파드를 찾으세요` + 버튼 `워크로드 보기`(알고 있으면) / `파드 목록으로`.

## 8. 이벤트 `/cluster/events`

- PageHeader 아래 InlineAlert(info, compact): `쿠버네티스는 이벤트를 1시간만 보관합니다.`
- FilterBar: `심각 reason만` Switch | 네임스페이스 | 대상 종류(`Pod | Node | Deployment | …`) | reason MultiSelect | 검색.

| 열 | 폭 | 내용 |
|---|---|---|
| 심각 | 40px | 심각 reason이면 `octagon-x` 16px crit, 아니면 `triangle-alert` 16px warn (툴팁 `심각 reason`) |
| 마지막 발생 | 96px | `14:01:52` |
| 네임스페이스 | 140px | |
| 대상 | 최소 240, 최대 320px | `Pod` caption + ResourceName 링크 |
| reason | 160px | mono 12 |
| message | flex, 최소 280px | 2줄 말줄임, 행 클릭 시 펼쳐 전체(펼친 영역 mono 12, `break-word`) |
| 횟수 | 64px | `×12` |

- 정렬: 마지막 발생 내림차순. 새 이벤트가 들어오면 맨 위에 추가하되, 스크롤이 맨 위가 아니면 표 위에 `새 이벤트 3건` 버튼(누르면 맨 위로).
- 빈 상태: EmptyState lg `circle-check` `최근 1시간 Warning 이벤트가 없습니다`.

## 9. DB 상세 `/cluster/db`

### 9.1 레이아웃

```
PageHeader: "데이터베이스" [주의 lg] 연결 82% (max 100)
            보조 줄: Postgres 16.4 · data / postgres (StatefulSet)
┌ 핵심 지표 MetricTile ×6 (각 2열, 높이 136px) ─────────────────────────────────────────┐
│ 접속 응답  │ 연결 사용률   │ 긴 쿼리(5분+) │ idle in tx(5분+) │ 잠금 대기(1분+) │ 캐시 적중률 │
│ 42 ms  ok │ 82% ⚠ 82/100 │ 3건 ⚠ 최장 12분│ 1건 ⚠ 12분       │ 0건 ok          │ 99.2% ok    │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ 쿠버네티스 (6열) ──────────────────────┐┌ 저장소·안정성 (6열) ─────────────────────────┐
│ StatefulSet ready 1/1 [정상]            ││ PVC  data-postgres-0  Bound  [정상]           │
│ 파드 표 (compact): postgres-0 [정상] …   ││   UsageBar md 18.4 GiB / 50 GiB (37%) [근사치]│
│                                         ││ 트랜잭션 ID 나이  1.2억 [정상]                 │
│                                         ││ 데드락(직전 대비) 0 [정상]                     │
│                                         ││ 복제 지연  [해당 없음] standby 없음            │
└─────────────────────────────────────────┘└───────────────────────────────────────────────┘
┌ 세션 (8열) ─────────────────────────────────────┐┌ 상태별 세션 (4열) ─────────────┐
│ 가장 오래된 세션 표                               ││ active 12 / idle 60 /          │
│ 사용자 | DB | 상태 | 경과 | 대기 이벤트 유형      ││ idle in tx 1 (DistributionBar) │
│ ⓘ 쿼리 원문은 수집·표시하지 않습니다               ││ 커밋 124.3/s · 롤백 0.4/s      │
└─────────────────────────────────────────────────┘└────────────────────────────────┘
┌ DB별 크기 (12열) 표: DB 이름 | 크기 | 비율 막대 ──────────────────────────────────────┐
```

- 핵심 지표 타일: label + 값(metricLg) + StatusBadge sm(오른쪽 위) + 보조 줄(ReasonText 또는 `82 / 100`). 연결 사용률 타일에는 UsageBar md(warnAt 70, critAt 90).
- 1280~1439px: 타일 6개 한 줄 유지(각 최소 160px). 1024~1279px: 3 × 2.
- 캐시 적중률 판단 보류(블록 1,000 미만): 값 옆 `판단 보류` 칩, 배지는 이전 상태 유지(서버 값).
- 세션 표 위 InlineAlert(info, compact) 고정: `쿼리 원문은 수집·표시하지 않습니다.` 세션 표 열: 사용자(120px) | DB(120px) | 상태(140px, `idle in transaction`은 warn 아이콘) | 경과(96px, 5분 이상 warn 아이콘, 30분 이상 crit 아이콘) | 대기 이벤트 유형(flex). 기본 정렬 경과 내림차순, 최대 20행.
- DB 추이 그래프는 명세에 없으므로 두지 않는다.

### 9.2 상태별

| 상태 | 모습 |
|---|---|
| 로딩 | 타일 6개 스켈레톤, 두 카드 스켈레톤 |
| DB 접속 실패(파드는 떠 있음) | PageHeader 장애 + 이유 `연결 실패: 인증 실패`. 접속 응답 타일 crit(`실패`), 나머지 DB 내부 타일은 unknown(`—`, 이유 `DB 접속 실패로 조회 불가`). 쿠버네티스 카드는 정상 표시 |
| DB 파드 없음 | PageHeader 장애 + 이유 `DB 파드 없음 (ready 0/1)`(파드 쪽이 대표 사유). DB 내부 타일 unknown |
| DB 설정 없음(대상 StatefulSet 미지정) | 전체 UnknownState lg `모니터링할 DB가 설정되지 않았습니다` + hint `.env의 DB 대상(네임스페이스/StatefulSet)과 모니터링 계정을 설정하세요` |
| standby 없음 | 복제 지연 행 `해당 없음` 칩, 상태 배지 없음 |
| 45초 이상 갱신 없음 | DB 내부 타일 모두 stale(dashed, 배지 교체, 값 회색) |
| 연결 끊김 | 전역 배너 + 위 stale |

---

## 10. 컴포넌트 사용 목록 (이 기능)

| 컴포넌트 | variant / size / state |
|---|---|
| SummaryStrip / SummaryStripItem | state: ready, loading |
| StatusCard | status 5종, state: ready/loading/error, stale, interactive |
| StatusBadge | sm(표), md(카드·타일), lg(PageHeader·띠) / subtle, solid(띠·crit 카드), dot(사이드바) |
| ReasonText | lines 1(표·띠), 2(카드) |
| UsageBar | sm(표), md(상세·개요) / warnAt·critAt / approximate |
| DataTable | default 40px, compact 32px(펼친 영역, DB 파드) / virtualized(파드) / expandable(워크로드, 이벤트) |
| ResourceName | kind: pod, node, workload, pvc |
| FilterBar, SegmentedControl(md), MultiSelect, Switch, SearchInput | |
| MetricTile | kind=plain (DB) |
| KeyValueList | 1열(노드 정보), 2열(컨테이너) |
| DistributionBar | 8px (워크로드, 세션) |
| Chip | 스케줄 제외, 중지됨, 해당 없음, 근사치, 관측 N분, 판단 보류, 시스템, 스팟 |
| TimeSeriesChart | md 240px(개요·노드), sm 160px(파드) / unit percent |
| InlineAlert | info compact (이벤트 보관, 쿼리 원문) |
| EmptyState, UnknownState, ErrorState, Skeleton | sm, lg |
| Drawer md | 지금 확인할 항목 전체 |
| ConnectionBanner, ConnectionIndicator, DataSourceBadge | 셸 |
