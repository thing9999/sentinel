# 화면 설계: cluster-status

- 작성: designer, 2026-09-19 / 고침: 2026-09-24 (`kops-support` — 대상 환경 EKS → kOps)
- 명세: `docs/specs/cluster-status.md`, `docs/specs/kops-support.md`(3.1~3.4, 수용 기준 AC-KOPS10~26)
- 2026-09-24 바뀐 것: 개요 영역 카드 5개 → **6개**(컨트롤 플레인 추가, 3 × 2 배치) · 요약 띠 노드 수는 **워커 기준** + 컨트롤 플레인 부제 · 노드 화면에 **컨트롤 플레인 섹션**(마스터 표 + 구성요소 매트릭스 + 한계 안내) · 노드 목록 기본 필터 **워커만** · metrics-server 안내 문구 · mock 클러스터 이름 `prod.k8s.example.com`
- 공통: `docs/design/shell.md`(셸), `docs/design/status.md`(상태·차트·표 규칙), `docs/design/components.md`(컴포넌트), `docs/design/tokens.json`
- 그리드: 12열, gutter 16px, 본문 패딩 24px. 아래 "N열"은 12열 기준 차지 폭.

## 0. 화면 목록

| # | 화면 | 경로 | 목적 |
|---|---|---|---|
| 1 | 개요 | `/` | 5초 안에 "지금 문제가 있는가, 어디인가" |
| 2 | 노드 | `/cluster/nodes` | **컨트롤 플레인 섹션(위) + 워커 노드 목록(아래)**. 목록은 기본 워커만 |
| 3 | 노드 상세 | `/cluster/nodes/[name]` | 조건·용량·추이·올라간 파드 |
| 4 | 워크로드 목록 | `/cluster/workloads` | ready/desired, 롤아웃, 파드 분포 (행 펼침으로 소속 파드) |
| 5 | 파드 목록 | `/cluster/pods` | 수백 행, 필터, 문제 파드 먼저 |
| 6 | 파드 상세 | `/cluster/pods/[namespace]/[name]` | 컨테이너 상태·사유·이벤트·소속 |
| 7 | 이벤트 | `/cluster/events` | 최근 1시간 Warning |
| 8 | DB 상세 | `/cluster/db` | Postgres 쿠버네티스 쪽 + 내부 지표 |

- **컨트롤 플레인 화면을 따로 만들지 않는다**(2026-09-24 `kops-support`, PM Q2). 노드 화면 위쪽 섹션(`/cluster/nodes#control-plane`)이고 사이드바에도 항목을 늘리지 않는다(`shell.md` 3.1).
- 워크로드 상세 화면은 따로 두지 않는다. 파드 상세의 "소속 워크로드" 링크는 `/cluster/workloads?focus=<kind>/<namespace>/<name>`으로 가서 해당 행을 펼치고 `bg.selected`로 강조, 화면 가운데로 스크롤한다.
- 목록 필터·정렬은 URL 쿼리에 둔다(뒤로 가기·링크 공유).
- **로그 진입점 (2026-09-25 `logs`)**: 파드 상세 `로그` 섹션(7절, **기본 접힘** — 탭이 아니다, PM 결정 D1) · 파드 목록 이름 셀 hover 버튼 · 이벤트 행 `로그` 링크(8절) · 구성요소 매트릭스 칸 hover 버튼(3.2.3) · DB 파드 표 행. 모양·동작은 **`docs/design/logs.md` 0절 표**가 정본이고 이 문서는 자리만 가리킨다. `LOGS_ENABLED=false`면 이 진입점이 전부 사라진다.

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
│ [● 장애] 파드 api-7f9c… CrashLoopBackOff 외 2건 │ 노드(워커) │ 파드    │ 워크로드 │ 이벤트 │ DB   │ 마지막 갱신 │
│ prod.k8s.example.com · v1.31 · ap-northeast-2  │ 6/6       │ 2·3·51 │ 1·0·23  │ 7     │ 주의 │ 14:02:10   │
│                                                │ 컨트롤 플레인 3/3                                      │
└────────────────────────────────────────────────────────────────────────────────┘
┌ 컨트롤 플레인 ──┐┌ 노드 ──────────┐┌ 워크로드 ──────┐   ← StatusCard ×6 (각 376px, 176px 높이)
└────────────────┘└────────────────┘└────────────────┘
┌ 파드 ──────────┐┌ 이벤트 ────────┐┌ DB ────────────┐
└────────────────┘└────────────────┘└────────────────┘
┌ 지금 확인할 항목 (12열) ────────────────────────────────────────────────────────┐
│ [장애] 파드          prod / api-7f9c…-x2kq9  CrashLoopBackOff · 재시작 6회      2분 전 │
│ [주의] 컨트롤 플레인  i-0c3d4e5f6a7b8c9d0     NotReady 4분 · 쿼럼 유지(2/3)      4분 전 │
│ [장애] 노드          i-0a1b2c3d4e5f6a7b8     NotReady 3분                       3분 전 │
│ [주의] DB            postgres                연결 82% (max 100)                 1분 전 │
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
| 전체 상태 | 320px | `StatusBadge size=lg variant=solid`(ok면 subtle) + ReasonText(1줄, crit이면 빨강 600). 아래 caption `prod.k8s.example.com · v1.31 · ap-northeast-2` (클러스터 이름은 `ResourceName kind="cluster"`, 최대 폭 288px, `shell.md` 2.1 규칙) |
| 노드 | 최소 150px | label `노드 Ready (워커)`, value `6/6` (Ready < 전체면 앞에 상태 아이콘) → `/cluster/nodes`. **부제(`SummaryStripItem.sub`, caption 12/16 `text.secondary`)**: 상태 아이콘 12px + `컨트롤 플레인 3/3` → `/cluster/nodes#control-plane`. 컨트롤 플레인 상태가 ok면 아이콘 없음, `CONTROL_PLANE_NOT_FOUND`면 `컨트롤 플레인 —`(text.tertiary) |
| 파드 | 최소 160px | label `파드`, value `2 · 3 · 51` 각 숫자 앞 12px 아이콘(crit, warn, ok). 0인 칸은 `text.disabled` → `/cluster/pods` |
| 워크로드 | 최소 160px | 파드와 같은 형식 → `/cluster/workloads` |
| 이벤트 | 최소 120px | label `Warning 15분`, value `7` → `/cluster/events` |
| DB | 최소 120px | label `DB`, value `StatusBadge md` → `/cluster/db` |
| 마지막 갱신 | 140px, 오른쪽 정렬 | label `마지막 갱신`, value `14:02:10`(metricSm, tabular). stale이면 `status.stale.valueText` |

- **마스터를 워커에 더하지 않는다**(AC-KOPS10). 마스터 3 + 워커 6인 클러스터에서 이 칸은 `9/9`가 아니라 `6/6`이고, 컨트롤 플레인은 부제에만 나온다. 컨트롤 플레인을 띠의 독립 칸으로 만들지 않은 이유: 칸을 7개로 늘리면 1160px에서 수량 칸 폭이 140px → 116px로 줄어 `2 · 3 · 51`(파드)이 말줄임된다. 부제는 노드 칸 안에서 88px 높이를 더 쓰지 않는다(값 28px + 부제 16px = 44px ≤ 칸 내용 높이 48px).
- 1280~1439px: 전체 상태 칸 280px, 나머지 칸 최소 폭 100px(노드 칸만 130px). 1024~1279px: 두 줄(1줄: 전체 상태 + 마지막 갱신, 2줄: 5개 수량 칸), 높이 136px.
- MOCK 배지는 상단바에 있으므로 띠에 반복하지 않는다(명세 3.1의 "데이터 소스"는 상단바가 담당).

### 2.3 영역 카드 6개 (`StatusCard`) — 2026-09-24 `kops-support`로 5개 → 6개

순서 고정: **컨트롤 플레인** → 노드 → 워크로드 → 파드 → 이벤트 → DB. 순서를 바꾸지 않고 강조로 우선순위를 준다(crit 카드는 solid 배지 + 2px 빨강 테두리 + 왼쪽 막대).

- 컨트롤 플레인이 **맨 앞**인 이유: 아래에서 위로(컨트롤 플레인 → 노드 → 워크로드 → 파드) 쌓이는 순서이고, 마스터가 무너지면 뒤의 다섯 칸은 값 자체를 믿을 수 없다. 기존 5장의 상대 순서는 그대로라 사용자가 외운 자리는 한 칸씩만 밀린다.
- 노드 카드 안에 합치지 않은 이유(PM Q1): 마스터 장애가 `Ready 6/6 · 마스터 2/3` 둘째 줄로 들어가면 카드 배지 하나로 뭉뚱그려져 "노드 주의"로만 보인다. 컨트롤 플레인은 `overall` 집계에 들어가는 **독립 영역**(`areas.controlPlane`)이므로 카드도 독립이어야 배지·사유·문제 항목이 각자 선다.

| 카드 | 아이콘 | primary | counts / primarySub | 문제 항목(최대 3) | 링크 |
|---|---|---|---|---|---|
| **컨트롤 플레인** | `server-cog` | `마스터 3/3` | primarySub(caption) `필수 구성요소 15/15` | 마스터 이름 + 사유(`i-0c3d… NotReady 4분`), 구성요소 + 사유(`kube-scheduler · i-0a1b… 재시작 4회`) | `/cluster/nodes#control-plane` (footerLabel `컨트롤 플레인 보기`) |
| 노드 | `server` | `Ready 6/6` | - | 장애·주의 **워커** 노드 이름(ResourceName kind=node) + 사유 | `/cluster/nodes?status=crit,warn` (문제 없으면 필터 없음) |
| 워크로드 | `boxes` | `24개` | 장애 · 주의 · 정상 | 이름 + `ready 0/3` | `/cluster/workloads?status=…` |
| 파드 | `box` | `56개` | 장애 · 주의 · 정상 | 이름 + 대기 사유 | `/cluster/pods` (기본 정렬이 장애 먼저) |
| 이벤트 | `bell-ring` | `Warning 7건 (15분)` | - | reason + 대상 | `/cluster/events` |
| DB | `database` | `연결 82%` 또는 대표 지표 | - | 주의·장애 지표 이름 + 값 | `/cluster/db` |

- **카드 배치: 3 × 2 두 줄**(모든 지원 폭에서 같다). ≥1440px: 각 (1160 − 32) ÷ 3 = **376px**. 1280~1439px: 본문 1168px 기준 각 378px. 1024~1279px: 본문 976px 기준 각 314px. 줄 사이 간격 16px.
- **한 줄에 6장을 넣지 않은 이유(수치)**: 1160px에서 6장이면 카드 폭 180px, 안쪽 내용 폭 148px이다. 카드 머리 한 줄에 아이콘 20px + 간격 8px + 제목 `컨트롤 플레인`(h3 16/24) + 간격 8px + StatusBadge md `알 수 없음` = **228px**가 필요해 80px이 모자란다(2026-09-24 publisher 폰트 메트릭 실측: 제목 101.6px · 배지 90.4px. 설계 때 근사치 235px과 7px 차이이고 결론은 같다). 배지를 sm으로 줄이거나 문구를 빼면 "색만으로 구분하지 않는다"(`status.md` 1절)를 깨게 된다. 두 줄로 가면 카드가 376px로 넓어져 문제 항목(`prod / api-7f9c…-x2kq9 CrashLoopBackOff`)도 말줄임 없이 읽힌다.
- 두 줄이 차지하는 세로 176 × 2 + 16 = **368px**. 1080px 화면에서 "지금 확인할 항목" 첫 행이 대략 y=700px에 오므로 접히지 않는다(상단바 56 + 본문 패딩 24 + PageHeader 72 + 띠 88 + 16 + 368 + 16 + 섹션 제목 26 ≈ 666px).
- 카드 높이 176px 고정. 구성(위→아래): 머리(아이콘 20 + 제목 h3 + 오른쪽 배지 md, 높이 24px) → 12px → primary(metricMd 20/28) + counts 또는 primarySub(caption) → 8px → 문제 항목 목록(행 20px, caption, 최대 3행) 또는 ReasonText 2줄 → 하단 `목록 보기 →`(caption, link색, 하단 16px 고정).
- 카드가 정상이면 문제 항목 자리를 비워 둔다(스파크라인·장식 없음. 정상은 조용하게).
- 컨트롤 플레인 카드의 상태별 primary: 마스터 0대(`CONTROL_PLANE_NOT_FOUND`)면 primary `—`, primarySub `컨트롤 플레인 노드를 찾을 수 없습니다`, 배지 unknown. 마스터 1대 + HA 기대 켬이면 primary `마스터 1/1`, 배지 warn, 이유 `마스터 1대 (HA 아님)`. 마스터 NotReady가 있으면 primarySub의 구성요소 수에서 그 마스터 몫을 빼지 않고 `필수 구성요소 10/15 · 알 수 없음 5`로 적는다(숨기면 5칸이 사라진 것처럼 보인다).

### 2.4 지금 확인할 항목

- 서버가 준 crit·warn 항목을 모아 crit → warn, 같은 등급은 상태가 바뀐 시각 최근 순. 최대 8행.
- 행(40px): StatusBadge sm | 영역 라벨(caption, 폭 **84px**: 컨트롤 플레인/노드/워크로드/파드/이벤트/DB — `컨트롤 플레인`이 caption 12px에서 78px이라 56px에서 넓혔다) | ResourceName(최대 360px, 네임스페이스 포함 `ns / name`) | ReasonText(flex) | 상태 변경 시각 상대(`2분 전`, 폭 72px, 오른쪽 정렬).
- 영역 `control_plane` 행의 이동 위치: 대상이 마스터 노드면 노드 상세, 구성요소(미러 파드)면 `/cluster/nodes#control-plane`(해당 셀을 2000ms 강조). 컨트롤 플레인 파드는 `kube-system`이라 파드 목록의 "시스템 숨기기"에 가려질 수 있어 파드 상세로 곧장 보내지 않는다.
- 행 클릭 → 해당 상세(파드·노드·DB) 또는 목록 focus.
- 0건이면 섹션 전체를 한 줄 카드(48px)로: `circle-check` 16px `status.ok.fg` + `주의·장애 항목이 없습니다` (body, text.secondary).
- 9건 이상이면 오른쪽 아래 `모두 보기 (13)` 버튼(ghost sm). 여러 영역이 섞여 있으므로 목록 페이지가 아니라 Drawer(md 480px)로 전체 목록을 연다.

### 2.5 CPU·메모리 영역 (명세 3.6)

- 카드 2개(각 6열). 카드 머리: 제목 `클러스터 CPU` + neutral Chip `워커 기준`(`server` 12px) + StatusBadge md + ReasonText.
- **클러스터 합계는 워커 노드만 더한 값이다**(AC-KOPS12). 칩 툴팁: `컨트롤 플레인 노드는 합계에서 빠집니다. 마스터 사용률은 노드 화면의 컨트롤 플레인 섹션에 있습니다.` 마스터 합계를 이 카드에 겹쳐 그리지 않는다(마스터 3대와 워커 수십 대는 자릿수가 달라 한 축에 놓으면 워커 변화가 납작해진다).
- 막대 3줄(각 행 높이 28px): `사용량` / `requests 합계` / `limits 합계` — 라벨 폭 96px, UsageBar md(사용량 행만 warnAt·critAt 표시선), 오른쪽 값 `1,250m / 8,000m (16%)`. limits는 100% 초과 가능(오버커밋) → 초과 표시.
- 아래 TimeSeriesChart 240px: 사용률 %, 0~100 고정, 임계선 주의·장애.
- 기간: 1시간(Prometheus 있으면 `1시간 | 6시간 | 24시간` SegmentedControl sm, 기본 1시간).
- metrics-server 없음: 카드 본문 전체를 UnknownState(sm): `알 수 없음 (metrics-server 없음)` + hint `클러스터에 metrics-server가 설치돼 있지 않습니다. kOps 클러스터 설정의 spec.metricsServer.enabled를 켜면 표시됩니다.` 카드 배지 unknown. hint 아래 둘째 줄(caption `text.tertiary`): `사용률 판단·추이 그래프·마스터 사용률·어드바이저 일부 규칙이 '알 수 없음'이 됩니다. 노드·파드·워크로드·이벤트·DB·비용은 영향받지 않습니다.`
  - **안내에 실행 명령(`kops edit cluster`, `kops update cluster --yes`)을 넣지 않는다**(명세 3.4, AC-KOPS39). 조회 전용 대시보드는 설정 항목 이름까지만 알려 준다.

### 2.6 비용·어드바이저 요약 카드 (다른 기능 진입점)

- 비용(6열, 높이 136px, MetricTile 변형): 제목 `비용` + 비용 전체 상태 배지. 본문 `≈ $1.10/h`(추정, 배지) · `이번 달 확정 $512`(확정 배지) · 예산 상태 한 줄. → `/cost`. 상세 형식은 `aws-cost.md` 2.3과 같은 MoneyValue 규칙.
- 어드바이저(6열, 높이 136px): 제목 `어드바이저` + 사전 점검 요약 배지(`높음 2건`). 본문: 사전 점검 `높음 2 · 중간 7 · 낮음 11`, 마지막 분석 `9월 18일 14:03 · 제안 9건`, 브리지 상태 dot. → `/advisor`.
- 두 기능 API가 실패하면 해당 카드만 UnknownState(sm). 개요의 다른 영역에 영향 없음.

### 2.7 상태별 모습

| 상태 | 모습 |
|---|---|
| 로딩(최초 스냅샷 전) | SummaryStrip 스켈레톤(88px, 칸 경계 유지), 카드 6개 스켈레톤(176px, 3 × 2), 확인 항목 스켈레톤 3행, 차트 스켈레톤 240px |
| 빈 클러스터(**워커 0대**) | 명세상 전체 장애(AC-KOPS14). SummaryStrip crit `워커 노드 없음`, 노드 카드 crit `Ready 0/0`, 파드·워크로드 카드는 `0개` + ok, 확인 항목 1행(`워커 노드가 없습니다`). **마스터가 정상이어도 이 판단은 유지된다** — 컨트롤 플레인 카드는 자기 상태(ok)를 그대로 보인다 |
| 컨트롤 플레인 노드 0대 | 컨트롤 플레인 카드 unknown(primary `—`, 이유 `컨트롤 플레인 노드를 찾을 수 없습니다`), 나머지 카드·띠·차트는 정상 동작(AC-KOPS17) |
| 연결 끊김 | 전역 배너(`shell.md`), 값 유지, 45초(메트릭) / heartbeat×3 후 개별 stale: 카드 dashed 테두리, 배지 `데이터 오래됨 · HH:mm:ss 기준`, SummaryStrip 마지막 갱신 값 stale 색 |
| 클러스터 연결 없음(live, kubeconfig 없음) | SummaryStrip 전체 상태 `알 수 없음` + 이유 `클러스터 연결 없음`, 컨트롤 플레인·노드·워크로드·파드·이벤트 카드 unknown(UnknownState 대신 카드 모양 유지, primary `—`), DB 카드는 DB 접속 결과대로(DB 접속은 별도) |
| **apiserver 전면 중단** | 대시보드 자신이 클러스터를 조회할 수 없다. 화면은 컨트롤 플레인 `장애`가 아니라 전역 `연결 끊김` 배너 + 값 유지 + stale이다(`shell.md` 5절, 명세 3.2.2). 이 사실은 컨트롤 플레인 섹션 한계 안내 첫 줄로 상시 알린다(3.2.4) |
| API 오류 | 셸 ErrorState(lg) (`shell.md` 5절) |
| mock | 상단바 MOCK 배지만. 화면은 live와 동일 |

---

## 3. 노드 `/cluster/nodes`

한 화면에 두 섹션: **컨트롤 플레인**(위, 항상 표시) + **워커 노드 목록**(아래). 2026-09-24 `kops-support`로 개편.

### 3.1 레이아웃

```
PageHeader "노드"  [StatusBadge lg 영역 상태] 이유        ← 사이드바 `노드` 항목과 같은 값(워커·컨트롤 플레인 중 최악, 서버 값)
─ 컨트롤 플레인 (id="control-plane") ──── [주의] 마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실 ⓘ ──
┌ 마스터 합계 (폭 560px) CPU/메모리 UsageBar 2행 ───────────────────────────────┐
┌ 마스터 노드 표 (12열, 행 40px, 1~5행) ────────────────────────────────────────┐
  필수 15칸 · ✓ 정상 13 · △ 주의 0 · ⊗ 장애 1 · ? 알 수 없음 1
┌ 구성요소 매트릭스 (왼쪽 정렬, 폭 = 220 + 마스터 수 × 셀 폭) ───────────────────┐
│                          │ ⊗ i-0a1b…     │ △ i-0c3d…     │ i-0e5f…       │   ← 열 머리 40px
│                          │ 2a · t3.medium│ 2c · t3.medium│ 2d · t3.medium│      (⊗ = 이 열에 장애 칸)
│   kube-apiserver         │ ✓ Ready       │ ? 노드 미보고  │ ✓ Ready       │   ← 셀 48px
│   kube-controller-manager│ ✓ Ready       │   마지막 보고  │ ✓ Ready       │
│ ⊗ kube-scheduler         │ ⊗ 장애         │   04:58       │ ✓ Ready       │      (⊗ = 이 행에 장애 칸)
│   etcd-manager-main      │ ✓ Ready       │ ? 노드 미보고  │ ✓ Ready       │
│   etcd-manager-events    │ ✓ Ready       │ ? 노드 미보고  │ ✓ Ready       │
└───────────────────────────────────────────────────────────────────────────────┘
  ▸ 기타 컨트롤 플레인 구성요소 6개  [필수 판정 제외]
  ⓘ apiserver가 모두 중단되면 … / ⓘ etcd 내부 지표(fsync·리더 변경)는 …
─ 워커 노드 ─────────────────────────────────────── [↑ 컨트롤 플레인 3대 보기] ──
FilterBar: [역할: 워커 6 | 컨트롤 플레인 3 | 전체 9] [상태: 전체 6 | 장애 1 | 주의 1 | 정상 4 | 알 수 없음 0]
           [노드그룹 ▾] [AZ ▾] [구매 옵션 ▾] [검색 240px]              워커 6개 중 6개 표시
DataTable (12열, 행 40px)
```

- 두 섹션 사이 간격 32px(`shell.md` 6절). 컨트롤 플레인 섹션은 **"시스템 네임스페이스 숨기기" 필터와 무관하게 항상 보인다**(AC-KOPS19). 구성요소 파드는 `kube-system`이지만 이 섹션은 파드 목록이 아니라 컨트롤 플레인 영역의 상태 화면이다.
- PageHeader 배지 = 두 섹션 상태의 최악(서버 값). 화면이 다시 계산하지 않는다.

### 3.2 컨트롤 플레인 섹션 (신규)

#### 3.2.0 섹션 머리

| 요소 | 사양 |
|---|---|
| 제목 | h2 18/26 `컨트롤 플레인` (앵커 `#control-plane`, `scroll-margin-top: 96px` — 상단바 56 + 배너 40) |
| 상태 | StatusBadge md(`areas.controlPlane`) + ReasonText 1줄(서버 대표 사유. 우선순위 쿼럼 상실 → 구성요소 장애 → 마스터 NotReady → 재시작 → HA 아님 → AZ 편중) |
| 쿼럼 근사 안내 | 제목 줄 끝 `circle-help` 14px, 툴팁 `쿼럼은 etcd 멤버 목록이 아니라 마스터 노드 수로 근사합니다. etcd 멤버 조회는 대시보드 권한 밖입니다.` |
| 오른쪽 | caption `text.tertiary`: `마스터 3대 · 2개 AZ · 필수 구성요소 15/15` |
| crit일 때 | 섹션을 감싼 Card 왼쪽 3px `status.crit.solid` (warn은 막대 없음 — 1절 "정상·주의는 조용하게"의 연장) |
| 마스터 1대 + HA 판단 끔 | 배지 ok + 이유 `마스터 1대 (단일 구성, 확인됨)` + neutral Chip `단일 구성 확인됨`(`check`). 켜져 있으면 배지 warn + 이유 `마스터 1대 (HA 아님)` |
| 마스터에 워커 파드 있음 | 섹션 머리 아래 InlineAlert(warn, compact) 한 줄: `컨트롤 플레인 노드에 워커 파드가 3개 있습니다 — 용량·비용 배분에 반영되지 않습니다.` 서버가 개수를 줄 때만 표시(명세 Q6, 범위 밖 구성) |

#### 3.2.1 마스터 합계 (2행, 폭 560px)

- 행 28px, 라벨 폭 96px(`CPU 합계` / `메모리 합계`), UsageBar md(CPU warnAt 70 critAt 90, 메모리 75/90), 오른쪽 값 `1,050m / 6,000m (18%)`.
- 이 값은 **마스터만** 더한 것이고 개요의 클러스터 합계(워커 기준)와 겹치지 않는다(AC-KOPS12).
- metrics-server 없음: 막대 대신 `—` + caption `알 수 없음 (metrics-server 없음)`. 마스터 표의 CPU·메모리 열도 같다.

#### 3.2.2 마스터 노드 표 (DataTable, 행 40px)

| 열 | 폭 | 내용 |
|---|---|---|
| 상태 | 112px | StatusBadge sm |
| 이름 | 최소 200, 최대 280px | ResourceName kind=node + 칩(`스팟`, `스케줄 제외`). kOps 노드 이름은 보통 인스턴스 ID(`i-0c3d4e5f6a7b8c9d0`) |
| 사유 | flex, 최소 200px | ReasonText (`NotReady 4분`, `모두 같은 AZ`) |
| InstanceGroup | 160px | text. 보통 `control-plane-ap-northeast-2a` |
| 인스턴스 타입 | 112px | mono 12 |
| AZ | 120px | `ap-northeast-2a`. 마스터가 모두 같은 AZ면 이 열 머리글에 warn 아이콘 12px + 툴팁 `마스터가 모두 같은 AZ에 있습니다` |
| CPU | 140px | UsageBar sm + `18%` |
| 메모리 | 140px | UsageBar sm + `42%` |
| 구성요소 | 96px | `5/5` + 상태 아이콘 12px. 매트릭스의 해당 **열**과 같은 값 |
| 경과 | 72px | `12일` |

- 정렬 기본 상태 → 이름(`status.md` 5.2). 행 클릭 → 노드 상세. 열 순서는 매트릭스 열 순서와 **같다**(눈이 좌우로 옮겨 갈 때 자리를 다시 찾지 않게).
- 마스터는 1~5대이므로 가상 스크롤 없음. 표 높이는 행 수만큼.

#### 3.2.3 구성요소 매트릭스 (`ComponentMatrix`, **이번 기능의 유일한 새 컴포넌트**)

**축**: 행 = 필수 구성요소 5종(고정 순서 `kube-apiserver` → `kube-controller-manager` → `kube-scheduler` → `etcd-manager-main` → `etcd-manager-events`), 열 = 마스터(마스터 표와 같은 순서).

- **변하는 쪽(마스터 1~5대)을 열로 둔 이유**: 구성요소 이름은 길고(가장 긴 `kube-controller-manager` 22자 = mono 12px에서 **실측 151.7px**(폴백 Consolas) / **158.4px**(JetBrains Mono), 머리 열 220px에서 쓸 수 있는 폭 192px 안 — 2026-09-24 publisher 확인) 개수가 5로 고정이다. 이름을 왼쪽 머리 열에 한 번만 쓰면 되고, 마스터가 1대든 5대든 **세로 높이가 296px로 고정**돼 아래 내용이 밀리지 않는다.

| 항목 | 값 |
|---|---|
| 왼쪽 머리 열 | 폭 220px 고정, `position: sticky; left: 0`, 배경 `bg.surface`. 내용: 구성요소 이름 mono 12/20 + (그 행에 crit이 있으면) 앞에 `octagon-x` 12px |
| 셀 폭 | `clamp(140px, (가용 폭 − 220px) ÷ 마스터 수, 240px)`. 합이 가용 폭을 넘으면 가로 스크롤(첫 열 sticky, 오른쪽 가장자리 4px 그림자 `shadow.sm`) |
| 머리 행 | 높이 40px. 마스터 이름 ResourceName kind=node(최대 폭 = 셀 폭 − 24px) + 아래 micro `ap-northeast-2a · t3.medium`(1줄 말줄임, 툴팁 전체). 마스터가 Ready가 아니면 이름 앞 12px 상태 아이콘 + 그 **열 전체 배경** `bg.surfaceSunken` |
| 셀 | 높이 48px, 패딩 8px 10px, radius 4px, 셀 사이 간격 4px(격자선을 긋지 않고 **틈**으로 나눈다 — 칸 단위로 읽히게) |
| 셀 내용 | 1행: 상태 아이콘 14px + 문구(captionStrong 12/16). 2행: 보조 문구(micro 11/14 `text.secondary`, 1줄 말줄임, 툴팁 전체) |
| **최소 폭에서 잘리는 것** (2026-09-24 실측) | 셀 폭이 하한 140px일 때 내용 폭은 약 114~120px이라 **열 머리 `meta`(143.6px)와 crit 셀 2행 문구(`CrashLoopBackOff · 재시작 4회` 155.2px)가 넘친다.** 둘 다 **끝 말줄임 1줄 + 툴팁 전체**로 처리한다(줄을 늘리지 않는다 — 셀 48px 고정). `마지막 보고 04:58`(89.4px), 마스터 이름(125.4px)은 하한에서도 들어간다 |
| 전체 폭 | 마스터 3대면 220 + 3 × 240 = 940px(왼쪽 정렬, 12열을 채우지 않는다). 1대면 220 + 240 = 460px |
| 높이 | 머리 40 + (48 + 4) × 5 = 296px 고정 |

**셀 상태별 모습** (색 + 아이콘 + 문구 세 가지를 항상 함께)

| 상태 | 배경 | 테두리 | 아이콘 | 1행 문구 | 2행 보조 |
|---|---|---|---|---|---|
| 정상 | 없음(`bg.surface`) | 1px `border.subtle` | `circle-check` `status.ok.fg` | `Ready` | 없음(정상은 조용하게) |
| 주의 | `status.warn.bg` | 1px `status.warn.border` | `triangle-alert` | `주의` | 서버 사유 `재시작 2회 (1시간)` / `PodInitializing 3분` |
| 장애 | `status.crit.bg` | **2px** `status.crit.border` | `octagon-x` | `장애` | `CrashLoopBackOff · 재시작 4회` |
| **알 수 없음(노드 미보고)** | `status.unknown.bg` + **45° 빗금**(1px `status.unknown.border`, 간격 6px) | 1px **solid** `status.unknown.border` | `circle-help` | `노드 미보고` | `마지막 보고 04:58` |
| 알 수 없음(그 밖) | `status.unknown.bg` | 1px solid | `circle-help` | `알 수 없음` | 서버 사유 |
| 없음(구성요소가 보이지 않음) | 없음 | 1px **dashed** `border.default` | `minus` `text.tertiary` | `없음` | `필수 구성요소가 보이지 않습니다` |
| 데이터 오래됨 | 없음 | 1px **dashed** `status.stale.border` | `clock-alert` | `데이터 오래됨` | `14:02:10 기준` |

- **"노드 미보고"와 "데이터 오래됨"의 구분은 `status.md` 2.5 규칙 그대로**다. 마스터가 NotReady면 그 마스터의 5칸은 파드가 `Running`이어도 `노드 미보고`로 **강제**된다(AC-KOPS21, 서버 판단). 빗금·solid 테두리·`마지막 보고 HH:mm`이 stale(빗금 없음·dashed·`HH:mm 기준`)과 갈리는 세 가지 단서다.
- **어느 칸이 빨간지 한눈에**: ① crit 셀만 2px 테두리 + 채운 배경, ② crit이 있는 **행 머리와 열 머리에 `octagon-x` 12px 표식**(가로 스크롤 중이거나 열이 5개여도 어느 축인지 보인다), ③ 매트릭스 바로 위 한 줄 요약.
- **머리의 아이콘은 축마다 하나뿐**이다: 열 머리 = 마스터 노드 상태와 그 열 셀들의 최악 중 **더 나쁜 쪽** 하나, 행 머리 = 그 행 셀들의 최악. 최악이 `ok`면 아이콘을 그리지 않는다. 아이콘을 두 개 겹쳐 달지 않는다(무엇이 무엇을 가리키는지 흐려진다).
- **열 머리 툴팁**(2026-09-24 보탬): `노드 <상태 문구>[ (<사유>)] · 구성요소 <그 열 최악 상태 문구>[ <같은 상태 칸 수>]` → `노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5`. 괄호 안 사유는 서버가 주는 마스터 노드 사유(`ComponentMatrix.columns[].reason`, `components.md` 18.1)이고, 없으면 괄호를 뺀다. 칸 수는 그 열의 셀을 세어 만든다. **아이콘 하나로 줄인 정보를 툴팁에서 다시 펼치는 자리**라 두 축을 모두 적는다.
- **문구를 늘려야 할 때는 서버 쪽에서 줄인다**: 셀·머리 문구는 48px·40px 안에서 1줄씩이고 늘릴 자리가 없다. 사유가 길면 `detail`을 짧은 쪽부터(사유 코드 먼저) 채우고 나머지는 툴팁으로 보낸다. 말줄임을 없애려고 셀 높이나 행 수를 바꾸지 않는다(매트릭스 높이 296px 고정이 이 화면의 전제다).
- **한 줄 요약**(매트릭스 위 8px, caption 12/16): `필수 15칸 · 정상 13 · 주의 0 · 장애 1 · 알 수 없음 1` — 각 숫자 앞 12px 상태 아이콘, 0인 항목은 `text.disabled`이고 **버튼이 아니다**(강조할 칸이 없다). 0이 아닌 숫자는 **언제나 누를 수 있고**, 누르면 그 상태의 셀만 2000ms 외곽선(`status.<key>.solid` 2px)으로 깜박인다(`prefers-reduced-motion`이면 켜고 끄기만). 이 강조는 컴포넌트의 **기본 동작**이라 페이지가 따로 붙이지 않아도 된다(`components.md` 18.1).
- 셀 클릭: 해당 미러 파드가 있으면 파드 상세(`/cluster/pods/kube-system/<파드 이름>`)로. `노드 미보고`·`없음` 셀은 클릭 불가(`aria-disabled`, 툴팁에 사유). 셀 hover 툴팁: `kube-scheduler-i-0a1b… · 장애 · CrashLoopBackOff · 최근 1시간 재시작 4회 · 마지막 종료 OOMKilled 14:01:52`.
- **셀의 `로그` 버튼 (2026-09-25 `logs`, AC-LOG30)**: hover·focus 때만 셀 **오른쪽 아래 모서리에 겹쳐** `IconButton sm`(`scroll-text`, 24 × 24px, 배경 `bg.surface`, shadow xs, 셀 안쪽 4px). **셀 치수와 문구 폭은 바뀌지 않는다** — 자리를 상시 비워 두면 최소 셀 폭 140px에서 내용 폭이 114px → 90px로 줄어 2행 사유가 더 잘린다. 겹친 자리의 문구는 이미 툴팁에 전부 있다. `없음`(missing) 셀에는 그리지 않고, `노드 미보고`에는 **그린다**(조회가 성공할 수 있어 막지 않는다). props는 `components.md` 21.5, 화면은 `logs.md` 11절.
- 접근성: 진짜 `<table>`로 그린다(`<th scope="col">` 마스터, `<th scope="row">` 구성요소). 각 셀 `aria-label`은 `kube-scheduler, i-0a1b…, 장애, CrashLoopBackOff · 재시작 4회`. 색 없이도 아이콘 모양(원/삼각형/팔각형/물음표/시계/빼기)과 문구로 읽힌다.
- 마스터가 6대 이상이거나 1024px에서 가로 스크롤이 생기면 매트릭스 오른쪽 위에 caption `가로로 스크롤할 수 있습니다`(`text.tertiary`)를 둔다.

#### 3.2.4 기타 구성요소와 한계 안내

- **기타 컨트롤 플레인 구성요소**(명세 3.2.2 / U5): 매트릭스 아래 접힘 Section, 머리 `기타 컨트롤 플레인 구성요소 6개` + neutral Chip `필수 판정 제외`(`minus`, 툴팁 `있어도 없어도 정상입니다. 컨트롤 플레인 상태 판단에 넣지 않습니다.`). 펼치면 compact DataTable(행 32px): 이름(ResourceName kind=pod) | 마스터 | 상태(StatusBadge sm) | 사유. 0개면 섹션 자체를 숨긴다.
- **한계 안내 2줄**(AC-KOPS26): 컨트롤 플레인 섹션 **맨 아래 고정**, InlineAlert(info, compact, 2줄, 아이콘 `info` 16px 한 번). 접거나 닫을 수 없다.
  1. `apiserver가 모두 중단되면 이 대시보드도 클러스터를 조회할 수 없어 '연결 끊김'으로 보입니다.`
  2. `etcd 내부 지표(fsync·리더 변경)는 표시하지 않습니다.`
  - **왜 상시 표시인가**: 두 문장은 "여기 없는 것"에 대한 설명이라 문제가 생긴 뒤에 찾게 하면 늦다. 첫 줄은 장애 순간 화면이 '연결 끊김'으로 보이는 이유를 미리 알려 주고(그때 이 섹션은 stale이라 새 안내를 띄울 수 없다), 둘째 줄은 "etcd가 정상"이라는 과신을 막는다. 툴팁·팝오버에 숨기지 않는다.
  - 개요 화면 카드에는 넣지 않는다(카드 176px에 들어가지 않고, 같은 문장을 두 곳에서 관리하게 된다).

#### 3.2.5 컨트롤 플레인 섹션 상태별 모습

| 상태 | 모습 |
|---|---|
| 로딩 | 마스터 합계 2행 스켈레톤, 마스터 표 스켈레톤 3행, 매트릭스 스켈레톤(머리 40px + 5 × 48px, 셀 radius 4px) |
| 마스터 0대(`CONTROL_PLANE_NOT_FOUND`) | 섹션 본문 전체를 UnknownState(sm): `알 수 없음 (컨트롤 플레인 노드를 찾을 수 없습니다)` + hint `node-role.kubernetes.io/control-plane 라벨이 있는 노드가 없습니다. 워커 목록과 나머지 화면은 그대로 동작합니다.` 섹션 배지 unknown. 한계 안내 2줄은 그대로 보인다(AC-KOPS17) |
| 마스터가 1대뿐인 클러스터 | 매트릭스 열 1개(셀 폭 240px 상한). 나머지 규칙 동일. 배지는 3.2.0의 HA 규칙대로 |
| 마스터 3대 중 1대 NotReady(쿼럼 유지) | 섹션 warn + 이유 `마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실`. 그 열 머리에 상태 아이콘 + 열 배경 sunken, 셀 5칸 `노드 미보고` + `마지막 보고 04:58` |
| 쿼럼 상실 | 섹션 crit + 왼쪽 3px 막대. 이유는 서버 값(`마스터 1/3 Ready · 쿼럼 상실`) |
| 구성요소 장애 | 해당 셀 crit(2px) + 행·열 머리 `octagon-x` 표식 + 한 줄 요약 `장애 1` |
| 연결 끊김·45초 경과 | 매트릭스 전체 stale(`status.md` 2.2·2.5): 문구·아이콘·테두리(dashed)는 stale이 가져간다. `노드 미보고` 칸의 **빗금과 열 머리 표식은 남기고** 툴팁에 `마지막 상태: 노드 미보고 (마지막 보고 04:58)` |
| metrics-server 없음 | 마스터 합계·CPU·메모리 열만 `—`. 매트릭스는 영향 없음(파드 상태는 metrics API와 무관) |
| mock | 시나리오 `cp-healthy`·`cp-single`·`cp-node-down`·`cp-quorum-lost`·`cp-component-crash`·`cp-not-found`로 위 모습을 모두 재현할 수 있어야 한다(AC-KOPS25) |

### 3.3 워커 노드 목록

#### 3.3.1 FilterBar

| 요소 | 사양 |
|---|---|
| 역할 | SegmentedControl md, 옵션 `워커 6` / `컨트롤 플레인 3` / `전체 9` (개수는 `facets.roles` 서버 값). **기본 `워커`**(AC-KOPS11, PM Q4). URL 쿼리 `?role=worker\|control_plane\|all` |
| 상태 | SegmentedControl md. 개수는 **역할 필터를 적용한 뒤**의 값(`counts`가 필터와 일관, AC-KOPS11) |
| 노드그룹 | Select 160px. 값은 kOps InstanceGroup 이름(`nodes-ap-northeast-2a`, `spot-batch`). 열 머리글·필터 라벨 옆 `circle-help` 툴팁: `kOps InstanceGroup 이름입니다(노드 라벨 kops.k8s.io/instancegroup). 목표 대수는 표시하지 않습니다 — 실제로 붙어 있는 노드만 셉니다.` (명세 3.3 / D2) |
| AZ · 구매 옵션 · 검색 | 기존과 같음 |
| 오른쪽 | `워커 6개 중 6개 표시`(caption). 역할이 `전체`면 `노드 9개 중 9개 표시`, `컨트롤 플레인`이면 `컨트롤 플레인 3개` |

- **기본이 워커만인 이유**: "총 N대"라는 숫자가 개요 요약 띠·비용 배분·어드바이저와 항상 같은 뜻이 되게 한다(마스터를 섞으면 같은 화면 안에서 6과 9가 동시에 돌아다닌다).
- 역할이 `컨트롤 플레인` 또는 `전체`면 표 위에 InlineAlert(info, compact): `컨트롤 플레인 상세(구성요소·쿼럼)는 위 섹션에 있습니다.` + 링크 `위로 가기`.
- 섹션 머리 오른쪽에 링크 버튼 `컨트롤 플레인 3대 보기`(ghost sm, 아이콘 `arrow-up`) → `#control-plane`으로 스크롤하고 섹션에 포커스 + 2000ms 외곽선(`accent.default` 2px). 마스터가 0대면 이 버튼을 숨긴다.

#### 3.3.2 열

| 열 | 폭 | 내용 |
|---|---|---|
| 상태 | 112px | StatusBadge sm (+ `스케줄 제외` 칩은 이름 열 뒤) |
| 이름 | 최소 200, 최대 280px | ResourceName kind=node + 칩(`스케줄 제외`, `스팟`, 역할이 `전체`·`컨트롤 플레인`일 때만 `컨트롤 플레인`(`server-cog`)) |
| 사유 | flex, 최소 200px | ReasonText |
| 노드그룹 | 160px | text (kOps InstanceGroup 이름. 없으면 `—`) |
| 인스턴스 타입 | 112px | mono 12 |
| AZ | 120px | `ap-northeast-2a` |
| CPU | 140px | UsageBar sm + `62%` (warnAt 70, critAt 90) |
| 메모리 | 140px | UsageBar sm + `81%` (75, 90) |
| requests | 120px | `CPU 88% · Mem 64%` caption, 85% 이상 값은 warn 아이콘 12px |
| 파드 | 80px | `23/29`, 오른쪽 정렬 |
| 경과 | 72px | `12일` |

- 역할 열을 따로 두지 않고 이름 칸의 칩으로 표시한다(기본 필터가 워커라 대부분의 화면에서 열이 통째로 비고, 폭 96px을 상시 잡아먹는다).
- kubelet 버전·할당 가능량은 목록에서 빼고 상세에 둔다(폭 절약).
- 정렬: 상태 → 이름. 행 클릭 → 노드 상세.

#### 3.3.3 상태별
- 로딩: 스켈레톤 6행. **워커 0대**: EmptyState lg `워커 노드가 없습니다` + 설명 `워커 노드가 없거나 모두 NotReady이면 워크로드가 실행되지 않습니다. 컨트롤 플레인은 위 섹션에서 따로 확인하세요.`(상태는 SummaryStrip과 같게 crit, AC-KOPS14). metrics-server 없음: CPU·메모리 열 셀에 `—` + 열 머리글에 `circle-help` 아이콘과 툴팁 `metrics-server 없음 (spec.metricsServer.enabled)`. 연결 끊김·stale: `status.md` 2.2.

## 4. 노드 상세 `/cluster/nodes/[name]`

```
Breadcrumb: 노드 › i-0a1b2c3d4e5f6a7b8
PageHeader: i-0a1b2c3d4e5f6a7b8 [StatusBadge lg] 이유
            칩: m6i.large · 온디맨드 · ap-northeast-2a · nodes-ap-northeast-2a · kubelet v1.31.2 · 12일
            (마스터면 맨 앞에 `컨트롤 플레인` 칩(`server-cog`) + InstanceGroup `control-plane-ap-northeast-2a`)
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
- **마스터 노드일 때(2026-09-24 `kops-support`)**: `CPU 추이` 위에 카드 `컨트롤 플레인 구성요소 (12열)`를 추가한다. 내용은 3.2.3 매트릭스를 **열 1개**로 그린 것(왼쪽 머리 220px + 셀 240px, 높이 296px)이고 오른쪽에 링크 `전체 마스터와 비교 →`(`/cluster/nodes#control-plane`). 새 컴포넌트를 또 만들지 않는다.
- 마스터의 "이 노드의 파드" 표는 `kube-system` 미러 파드가 대부분이므로 표 위에 caption `컨트롤 플레인 구성요소는 위 카드에서 상태별로 볼 수 있습니다.`를 둔다.

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
| 이름 | 최소 240, 최대 360px | ResourceName kind=pod (끝 16자 보존). 서버 `logHref`가 있으면 복사 버튼 다음에 로그 아이콘 링크(행 hover·포커스 때 보이고, 터치에서는 항상 보인다. `components.md` 21.10, `logs.md` 0절) |
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
│   준비 아니오 · 재시작 1h 6 / 누적 41                  ││ 노드         i-0a1b2c3d…  → │
│   마지막 종료: OOMKilled (137) · 14:01:52              ││ phase        Running         │
│   CPU  120m  requests 250m  limits 500m               ││ QoS          Burstable       │
│   메모리 UsageBar 498 MiB / 512 MiB (97%)              ││ 시작         9월 19일 10:58  │
│  sidecar [정상] …                                    ││ 파드 IP      10.0.12.87      │
└──────────────────────────────────────────────────────┘└──────────────────────────────┘
┌ CPU 추이 (6열, 160px) ┐┌ 메모리 추이 (6열, 160px, limit 대비 %, 80/95 임계선) ┐
┌ 로그 (12열, 기본 접힘 56px · 펼치면 따라가기 켬 + 본문 480px — logs.md 9절) ── [로그 보기] [로그 화면에서 열기] ┐
┌ 관련 Warning 이벤트 (12열) ─────────────────────────────────────────────────────────┐
```

- 컨테이너 카드: Card md 패딩 16px, 카드 간 12px. 머리: 컨테이너 이름(mono 13 600) + StatusBadge sm + 상태 텍스트. 본문 KeyValueList 2열. 문제 컨테이너가 위.
- 종료 사유 `OOMKilled`는 mono + crit/warn 아이콘. 종료 코드 괄호.
- 소속 워크로드·노드 링크는 `text.link` + `chevron-right` 12px. (명세 수용 기준: 이동 가능)
- 이벤트 표에서 대상이 이 파드인 것만. 없으면 한 줄 `최근 1시간 Warning 이벤트 없음`.
- 파드 삭제됨: EmptyState lg `파드를 찾을 수 없습니다` + `재생성되었으면 워크로드에서 새 파드를 찾으세요` + 버튼 `워크로드 보기`(알고 있으면) / `파드 목록으로`.
- **`로그` 섹션 (2026-09-25 `logs`, AC-LOG13 · PM 결정 D1로 탭 → 섹션)**: 이 화면에는 **탭 줄이 없다**(섹션 나열). `CPU·메모리 추이` 아래, `관련 Warning 이벤트` 위에 `로그` 섹션을 **기본 접힘**으로 둔다. 제목 줄 오른쪽 `로그 보기`(ghost sm, `scroll-text`)로 펼친다. 펼치면 따라가기 켬, 본문 높이 480px 고정이다. `로그 닫기`를 누르거나 화면을 떠나면 연결을 끊는다. 가림 경고와 한계 문구는 섹션 안에서도 그대로 다 그린다. 접힌 동안에는 로그 API를 부르지 않는다. 사양은 **`docs/design/logs.md` 9절**이다. `LOGS_ENABLED=false`면 섹션이 없다.
  - 이 줄의 이전 판은 "탭 줄에 `로그` 탭을 더한다"였다. 처음 명세의 틀린 전제(파드 상세에 탭이 있다)를 따라간 것이라 고쳤다. **탭으로 되돌리지 않는다.**

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
| **ComponentMatrix** (신규, `components.md` 18.1) | 열 1~5, 셀 상태 7종(ok/warn/crit/unknown/notReporting/missing/stale), state: ready/loading/unknown |
| SummaryStrip / SummaryStripItem | state: ready, loading. **`sub` 추가**(노드 칸의 `컨트롤 플레인 3/3`, `components.md` 19.2) |
| StatusCard | status 5종, state: ready/loading/error, stale, interactive. **`primarySub` 추가**(컨트롤 플레인 카드, `components.md` 19.1) |
| StatusBadge | sm(표), md(카드·타일), lg(PageHeader·띠) / subtle, solid(띠·crit 카드), dot(사이드바) |
| ReasonText | lines 1(표·띠), 2(카드) |
| UsageBar | sm(표), md(상세·개요) / warnAt·critAt / approximate |
| DataTable | default 40px, compact 32px(펼친 영역, DB 파드) / virtualized(파드) / expandable(워크로드, 이벤트) |
| ResourceName | kind: pod, node, workload, pvc, **cluster**(요약 띠 caption, `components.md` 19.3) |
| FilterBar, SegmentedControl(md), MultiSelect, Switch, SearchInput | 역할 필터(`워커` 기본) SegmentedControl md |
| MetricTile | kind=plain (DB) |
| KeyValueList | 1열(노드 정보), 2열(컨테이너) |
| DistributionBar | 8px (워크로드, 세션) |
| Chip | 스케줄 제외, 중지됨, 해당 없음, 근사치, 관측 N분, 판단 보류, 시스템, 스팟, **컨트롤 플레인, 단일 구성 확인됨, 필수 판정 제외, 워커 기준**(`status.md` 1.3) |
| TimeSeriesChart | md 240px(개요·노드), sm 160px(파드) / unit percent |
| InlineAlert | info compact (이벤트 보관, 쿼리 원문) |
| EmptyState, UnknownState, ErrorState, Skeleton | sm, lg |
| Drawer md | 지금 확인할 항목 전체 |
| ConnectionBanner, ConnectionIndicator, DataSourceBadge | 셸 |
