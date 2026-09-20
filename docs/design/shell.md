# 앱 공통 셸 (상단바·좌측 내비·전역 연결 상태·MOCK 배지)

- 작성: designer, 2026-09-19
- 토큰: `docs/design/tokens.json`, 상태·연결 규칙: `docs/design/status.md` 2절
- 컴포넌트 props: `docs/design/components.md` 1절
- 기존 뼈대(`apps/web/src/app/layout.tsx`)의 클래스 `app-header`, `app-nav`, `app-main`을 그대로 쓴다.

## 1. 전체 구조

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TopBar (56px, sticky top 0)                                               │
├──────────────────────────────────────────────────────────────────────────┤
│ ConnectionBanner (40px, 끊김일 때만, sticky top 56px)                       │
├───────────┬──────────────────────────────────────────────────────────────┤
│ SideNav   │ app-main                                                     │
│ 232px     │  padding 24px, max-width 1600px (왼쪽 정렬)                    │
│ (64px)    │  PageHeader                                                  │
│           │  페이지 본문 (12열 그리드, gutter 16px)                          │
└───────────┴──────────────────────────────────────────────────────────────┘
```

| 영역 | 크기 | 배경 | 경계 |
|---|---|---|---|
| TopBar | 높이 56px, 전체 폭 | `bg.surface` | 아래 1px `border.subtle` |
| ConnectionBanner | 높이 40px, 전체 폭 | `connection.bannerBg` | 없음 |
| SideNav | 폭 232px(펼침) / 64px(접힘), 높이 = 뷰포트 − 56px, sticky | `bg.surface` | 오른쪽 1px `border.subtle` |
| app-main | 나머지 폭, 패딩 24px(상하좌우), 내용 최대 폭 1600px | `bg.canvas` | - |

### 1.1 반응형

| 뷰포트 폭 | SideNav | 본문 그리드 |
|---|---|---|
| ≥ 1440px | 펼침 232px (사용자가 접을 수 있음) | 12열 |
| 1280 ~ 1439px | 접힘 64px 기본 (아이콘 + 툴팁) | 12열 |
| 1024 ~ 1279px | 숨김, TopBar 왼쪽 메뉴 버튼으로 오버레이 드로어(폭 232px, scrim `bg.scrim`) | 12열, 카드 행은 화면별 규칙대로 줄바꿈 |
| < 1024px | 지원 대상 아님. 레이아웃은 1024px 기준으로 가로 스크롤 | - |

접힘 상태는 localStorage `sentinel.nav.collapsed`에 저장.

## 2. TopBar

```
[≡] [◆ Sentinel]  prod-eks · v1.30 · ap-northeast-2      [MOCK 데이터] ● 실시간 14:02:10  [◐]
 └ 1024~1279만    └ 로고 영역 200px   └ 클러스터 정보 (flex)                └ 오른쪽 영역 (gap 12px)
```

| 요소 | 사양 |
|---|---|
| 메뉴 버튼 | 1024~1279px에서만. IconButton md(32px), 아이콘 `menu` 20px, 왼쪽 여백 16px |
| 로고 | 왼쪽 여백 16px(메뉴 버튼 있으면 8px), 아이콘 `radar` 24px `accent.default` + `Sentinel` h3 16/24 600. 영역 폭 200px(SideNav 접힘 시에도 동일) |
| 클러스터 정보 | body 14/20 `text.secondary`: `클러스터이름 · v1.30 · ap-northeast-2`. 클러스터 연결 없음이면 `클러스터 연결 없음`(text.tertiary) + `circle-help` 14px |
| MOCK 배지 | `DataSourceBadge` mode="mock". `status.md` 2.4. live면 `LIVE` 텍스트(caption, text.tertiary) |
| 연결 표시 | `ConnectionIndicator`. `status.md` 2.3. 최소 폭 140px(시각 자리 흔들림 방지, 시각은 tabular) |
| 테마 토글 | IconButton md, 아이콘 `sun`/`moon`/`monitor`(system). 누르면 Popover 메뉴 3항목(라이트/다크/시스템) |
| 오른쪽 여백 | 16px |

- 전역 검색, 알림 벨, 사용자 메뉴는 두지 않는다(범위 밖: 로그인·알림 없음).

## 3. SideNav

### 3.1 항목

| 순서 | 라벨 | 아이콘 | 경로 | 상태 점 |
|---|---|---|---|---|
| 1 | 개요 | `layout-dashboard` | `/` | 클러스터 전체 상태 |
| - | (그룹 라벨) 클러스터 | - | - | - |
| 2 | 노드 | `server` | `/cluster/nodes` | 노드 영역 상태 |
| 3 | 워크로드 | `boxes` | `/cluster/workloads` | 워크로드 영역 상태 |
| 4 | 파드 | `box` | `/cluster/pods` | 파드 영역 상태 |
| 5 | 이벤트 | `bell-ring` | `/cluster/events` | 이벤트 영역 상태 |
| 6 | 데이터베이스 | `database` | `/cluster/db` | DB 상태 |
| - | (그룹 라벨) 비용·개선 | - | - | - |
| 7 | 비용 | `circle-dollar-sign` | `/cost` | 비용 전체 상태(예산·급증 최악) |
| 8 | 어드바이저 | `lightbulb` | `/advisor` | 사전 점검 요약 상태 (+ 분석 중이면 스피너) |
| - | (그룹 라벨) 로컬 파일 | - | - | - |
| 9 | 스냅샷 (2026-09-19 `k8s-snapshot`으로 `AWS 스냅샷`에서 변경) | `archive` | `/snapshots` (`/snapshots/k8s/**`도 현재 위치) | **AWS·Kubernetes 스냅샷 파일 상태 중 최악**(서버 값, crit 문구 `커밋 금지`) + **양쪽 커밋 금지 수 합** 숫자 배지(서버 값, 0이면 숨김). 드리프트는 넣지 않는다. 한쪽이 설정 없음이면 그쪽 제외, 둘 다 설정 없음이면 아이콘 없음. `aws-snapshot-manager.md` 2절, `k8s-snapshot.md` 2.1 |

- `/cluster`는 `/`로 이동(프론트 결정: redirect).

### 3.2 모양

| 요소 | 펼침(232px) | 접힘(64px) |
|---|---|---|
| 목록 패딩 | 위 12px, 좌우 8px | 위 12px, 좌우 8px |
| 그룹 라벨 | 높이 28px, 위 여백 12px, 좌 12px, micro 11/14 500 `text.tertiary` | 1px `border.subtle` 구분선(좌우 12px 여백) |
| 항목 | 높이 36px, 패딩 좌 12px 우 8px, radius 6px, 아이콘 20px + 간격 12px + 라벨 body 14/20 | 48×40px, 아이콘 20px 가운데, 라벨은 오른쪽 툴팁 |
| 상태 표시 | 항목 오른쪽 끝에 상태 아이콘 14px(`status.md` 1절 아이콘, `status.<key>.fg`). `ok`는 표시하지 않음. `unknown`/`stale`도 표시 | 아이콘 오른쪽 위 모서리에 8px 원 `status.<key>.solid` + 1.5px `bg.surface` 테두리. 툴팁에 `노드 · 장애` |
| 기본 | 글자 `text.secondary`, 아이콘 `text.tertiary` | 같음 |
| hover | 배경 `bg.hover` | 같음 |
| 현재 위치 | 배경 `accent.subtle`, 글자·아이콘 `accent.default`, 글자 600, 왼쪽 3px 막대 `accent.default`(항목 안쪽, radius 2px) | 배경 `accent.subtle`, 아이콘 `accent.default` |
| 포커스 | `shadow.focus` | 같음 |
| 접기 버튼 | 목록 맨 아래(하단 고정), 높이 36px, 아이콘 `panel-left-close` 20px + `메뉴 접기` | 아이콘 `panel-left-open` |

- 상태 아이콘은 색만이 아니라 모양(삼각형/팔각형/물음표/시계)으로 구분된다. 접힘 상태의 점은 보조이고 툴팁 문구가 필수.
- 숫자 배지(`NavItem.count`, 펼침에서만): 상태 아이콘 오른쪽 4px, 높이 18px, 최소 폭 18px, 패딩 0 5px, radius pill, 배경 `status.<key>.bg`, 1px `status.<key>.border`, 글자 `status.<key>.fg` micro 11/14 600 tabular, 99 초과 `99+`. 현재는 스냅샷 메뉴만 쓴다(`components.md` 12.1). 접힘 툴팁 `스냅샷 · 커밋 금지 3개`.

## 4. PageHeader

| 요소 | 사양 |
|---|---|
| 높이 | 최소 48px, 아래 여백 24px |
| 브레드크럼(상세 화면만) | caption 12/16 `text.tertiary`, 구분 `chevron-right` 12px, 위에 4px 여백으로 제목 위에 |
| 제목 | h1 24/32 700 |
| 제목 옆 | 상태 배지(lg) + 판단 이유(상세 화면), 또는 없음 |
| 오른쪽 | 페이지 액션(버튼 md, 간격 8px), 필터 토글 등 |
| 제목 아래 보조 줄 | caption `text.secondary` (예: `Postgres 16 · data / postgres`) |

## 5. 전역 상태별 셸 모습

| 상태 | TopBar | 배너 | 본문 |
|---|---|---|---|
| 최초 로딩(API 응답 전) | 연결 표시 `연결 중`, 클러스터 정보 자리 스켈레톤 200×14px | 없음 | 각 페이지 로딩 스켈레톤 |
| API 연결 불가(최초 스냅샷 실패) | `API 연결 없음` | 표시(`API에 연결할 수 없습니다 - 재시도 중`) | 페이지 전체 ErrorState(lg): 아이콘 `unplug` 40px, `API 서버에 연결할 수 없습니다`, 보조 `http://localhost:3001 응답 없음 · 자동으로 다시 시도합니다`, 버튼 `지금 다시 시도` |
| 스트림 끊김(데이터 있음) | `연결 끊김` | 표시 | 값 유지, `status.md` 2.2 규칙으로 개별 stale |
| mock | MOCK 배지 | - | 정상 |
| live + 클러스터 연결 없음 | 클러스터 정보 `클러스터 연결 없음` | 없음(API는 연결됨) | 클러스터 영역 `알 수 없음(클러스터 연결 없음)`, 비용·어드바이저는 각자 규칙 |

## 6. 공통 페이지 여백 규칙

- 섹션 사이 세로 간격 32px. 섹션 제목(h2 18/26)과 내용 사이 12px.
- 카드 내부 패딩 16px(sm 카드 12px), 카드 사이 16px(gutter).
- 카드: 배경 `bg.surface`, 1px `border.subtle`, radius 8px, shadow `xs`. 클릭 가능한 카드는 hover 시 `border.default` + shadow `sm`.
