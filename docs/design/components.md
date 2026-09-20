# 공통 UI 컴포넌트 목록과 props

- 작성: designer, 2026-09-19
- 구현 위치: 퍼블리셔 `apps/web/src/components/ui/**`, 스타일 `apps/web/src/styles/**`
- 차트(9절)는 프론트 영역(`apps/web/src/charts/**`)이다. 모양 규칙은 여기와 `status.md` 4절.
- 토큰: `docs/design/tokens.json`. 상태·금액·표 규칙: `docs/design/status.md`. 셸: `docs/design/shell.md`.
- 세 기능(`cluster-status`, `aws-cost`, `architecture-advisor`)에서 공통으로 쓰도록 묶었다. 기능 전용 컴포넌트는 10절(어드바이저), 11절(AWS 스냅샷), 14절(Kubernetes 스냅샷·드리프트), 16절(3D 구성도)에 따로 둔다. 12절은 AWS 스냅샷, 15절은 Kubernetes 스냅샷, 17절은 3D 구성도 때문에 기존 컴포넌트에 더한 props다.
- 공통 타입:

```ts
type Status = "ok" | "warn" | "crit" | "unknown" | "stale";
type Size = "sm" | "md" | "lg";
type CostKind = "estimate" | "confirmed" | "forecast" | "llmEstimate";
type Severity = "high" | "medium" | "low";
type AdvisorCategory = "cost" | "reliability" | "performance" | "security" | "db";
type IsoTime = string; // 서버가 준 ISO 8601
```

- 모든 컴포넌트는 `className?: string`을 받는다(표에서 생략). 색은 토큰 CSS 변수로만 지정한다(hex 직접 사용 금지).
- 표의 "state"는 컴포넌트가 스스로 그려야 하는 모습이다.

---

## 1. 셸

### 1.1 `AppShell`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| topBar | ReactNode | - | `TopBar` |
| nav | ReactNode | - | `SideNav` |
| banner | ReactNode | - | `ConnectionBanner`(없으면 영역 없음) |
| children | ReactNode | - | 페이지 |

치수·반응형: `shell.md` 1절.

### 1.2 `TopBar`
| prop | 타입 | 설명 |
|---|---|---|
| cluster | `{ name: string; version?: string; region?: string } \| null` | null이면 `클러스터 연결 없음` |
| clusterLoading | boolean | 스켈레톤 200×14px |
| dataSource | `"mock" \| "live" \| null` | `DataSourceBadge`로 전달 |
| connection | ReactNode | `ConnectionIndicator` |
| onMenuClick | () => void | 1024~1279px 메뉴 버튼 |

### 1.3 `SideNav`
| prop | 타입 | 설명 |
|---|---|---|
| items | `NavItem[]` | `{ href; label; icon; status?: Status; busy?: boolean; group?: string }` |
| currentPath | string | 현재 위치 강조 |
| collapsed | boolean | 64px 모드 |
| onToggleCollapsed | () => void | |

state: default / hover / current / focus. `busy`면 상태 아이콘 자리에 12px 스피너(어드바이저 분석 중).

### 1.4 `ConnectionIndicator`
| prop | 타입 | 설명 |
|---|---|---|
| status | `"connecting" \| "open" \| "reconnecting" \| "disconnected" \| "apiDown"` | |
| lastEventAt | IsoTime \| null | `HH:mm:ss` 표시 |
| retryCount | number | 재연결 중 `(3회째)` |
| justReconnected | boolean | `다시 연결됨` 칩 3000ms |

최소 폭 140px, 높이 24px. 모양: `status.md` 2.3.

### 1.5 `ConnectionBanner`
| prop | 타입 | 설명 |
|---|---|---|
| lastEventAt | IsoTime \| null | `마지막 갱신 14:02:10` |
| retryCount | number | |
| nextRetryInMs | number \| null | `다음 시도 8초 후` (1초 단위 갱신) |
| message | string? | 기본 `연결 끊김`. API 불가면 `API에 연결할 수 없습니다` |
| onRetryNow | () => void | `지금 다시 연결` |

표시 지연 5000ms는 호출 측(프론트)이 제어. 높이 40px.

### 1.6 `DataSourceBadge`
| prop | 타입 | 설명 |
|---|---|---|
| mode | `"mock" \| "live"` | live면 `LIVE` 텍스트 |
| scenarios | `{ id; label; group: "cluster" \| "cost" \| "advisor"; active: boolean }[]?` | 있으면 클릭 시 Popover(폭 320px, 그룹별 라디오 목록) |
| onScenarioChange | (group, id) => void | |

state: static(시나리오 없음, 툴팁만) / interactive / open.

### 1.7 `PageHeader`
| prop | 타입 | 설명 |
|---|---|---|
| title | string | h1 |
| breadcrumbs | `{ label; href? }[]?` | 상세 화면 |
| status | `{ status: Status; reason?: string; staleAt?: IsoTime }?` | 제목 옆 lg 배지 + 이유 |
| subtitle | ReactNode? | 보조 줄 |
| actions | ReactNode? | 오른쪽 |
| chips | ReactNode? | 제목 아래 보조 칩 |

---

## 2. 상태 표시

### 2.1 `StatusBadge`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| status | Status | - | |
| size | Size | `md` | sm 20 / md 24 / lg 32px |
| variant | `"subtle" \| "solid" \| "dot"` | `subtle` | |
| label | string? | 상태 기본 문구 | `status.md` 1.2의 허용 문구만 |
| staleAt | IsoTime? | - | status=stale일 때 `· 14:02:10 기준` |
| previousStatus | Status? | - | stale 툴팁 `마지막 상태: …` |
| highlight | boolean | false | 상태 악화 강조 외곽선 2000ms |

접근성: `aria-label="상태: <문구>[, <이유>]"`.

### 2.2 `StatusIcon`
| prop | 타입 | 기본 |
|---|---|---|
| status | Status | - |
| size | `12 \| 14 \| 16 \| 20 \| 40` | 16 |
| title | string? | 스크린리더 문구 |

### 2.3 `ReasonText`
| prop | 타입 | 설명 |
|---|---|---|
| reasons | string[] | 첫 번째를 표시, 나머지 `외 N건` |
| status | Status | crit이면 `status.crit.fg` 600 |
| lines | `1 \| 2` | 기본 1, 카드에서만 2 |

### 2.4 `StatusCard` (개요의 영역 카드, 비용·어드바이저 요약 카드)
| prop | 타입 | 설명 |
|---|---|---|
| title | string | h3 |
| icon | IconName | 20px |
| status | Status | 오른쪽 위 배지 (crit이면 solid, 나머지 subtle), 크기 md |
| primary | ReactNode | 대표 수치(metricMd 20/28) 예 `Ready 5/6` |
| counts | `{ status: Status; count: number }[]?` | `장애 2 · 주의 3 · 정상 51` (각 앞에 12px 아이콘) |
| reason | string[]? | ReasonText |
| items | `{ label: string; href: string; status: Status }[]?` | 문제 항목 최대 3개 |
| href | string? | 카드 전체 링크 |
| footerLabel | string? | 기본 `목록 보기` |
| staleAt | IsoTime? | stale 모습 |
| staleCount | number? | `오래됨 N` 칩 |
| state | `"ready" \| "loading" \| "error"` | |
| errorMessage | string? | |

치수: 높이 176px 고정(내용 넘치면 items를 줄임), 패딩 16px, radius 8px. crit일 때 테두리 2px `status.crit.border` + 왼쪽 3px `status.crit.solid`. warn일 때 왼쪽 3px `status.warn.solid`. state: ok/warn/crit/unknown/stale/loading/error/hover/focus.

### 2.5 `SummaryStrip` / `SummaryStripItem`
| prop (Strip) | 타입 | 설명 |
|---|---|---|
| overall | `{ status: Status; reason: string[] }` | 왼쪽 블록 |
| meta | ReactNode | 클러스터 이름·버전·리전 |
| updatedAt | IsoTime | 오른쪽 `마지막 갱신 14:02:10` |
| children | SummaryStripItem[] | |
| state | `"ready" \| "loading"` | |

| prop (Item) | 타입 | 설명 |
|---|---|---|
| label | string | caption `text.secondary` |
| value | ReactNode | metricMd |
| status | Status? | 값 앞 16px 아이콘 |
| href | string? | 클릭 시 이동 |

치수: 높이 88px, 왼쪽 블록 폭 320px, 항목 최소 폭 120px, 항목 사이 1px 세로 구분선(높이 40px, `border.subtle`), 좌우 패딩 20px.

### 2.6 `UsageBar`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| value | number (0~1+) | - | 사용률 |
| status | Status | - | 채움 색 `status.<key>.solid` |
| warnAt | number? | - | 표시선 |
| critAt | number? | - | 표시선 |
| secondary | number? | - | requests 비율 등(채움 뒤 1px 세로선 `text.secondary` + 툴팁) |
| label | ReactNode? | - | 오른쪽 `62%` 또는 `1,250m / 2,000m` |
| size | `"sm" \| "md"` | `md` | sm: 높이 4px(표 안), md: 높이 8px |
| width | number? | 100% | px |
| approximate | boolean | false | 오른쪽에 `근사치` 칩 |

모양: 트랙 `bg.surfaceSunken`, radius 2px(sm)/4px(md). 표시선은 2px 폭, 막대 높이 + 4px(위아래 2px 돌출), 주의선 `chart.thresholdWarn`, 장애선 `chart.thresholdCrit`. 100% 초과는 채움을 100%로 자르고 끝에 2px 흰색 틈 + `초과` 아이콘(`chevrons-right` 12px). stale이면 채움 `status.stale.solid`.

### 2.7 `Chip`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| label | string | - | |
| icon | IconName? | - | 12px |
| tone | `"neutral" \| Status \| "info"` | `neutral` | |
| size | `"sm" \| "md"` | `sm` | 20 / 24px |
| dashed | boolean | false | stale·unverified 등 |
| onRemove | () => void? | - | 필터 칩 제거 버튼 `x` 12px |

### 2.8 `StaleNotice` (차트·영역 오른쪽 위 칩)
| prop | 타입 |
|---|---|
| staleAt | IsoTime |
| label | string? (기본 `데이터 오래됨`) |

---

## 3. 금액 (비용·어드바이저)

### 3.1 `MoneyValue`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| amount | number \| null | - | null이면 `—` + `unknownReason` 툴팁 |
| kind | CostKind | - | estimate/llmEstimate면 `≈ ` 접두 |
| unit | `"hour" \| "day" \| "month" \| "total" \| "unitPrice" \| "gbMonth"` | - | 소수점 규칙 `status.md` 3.2 |
| delta | boolean | false | 부호 표시(+ / −) |
| size | `"sm" \| "md" \| "lg" \| "xl"` | `md` | sm table 13/20, md metricSm 16/24, lg metricMd 20/28, xl metricLg 28/36 |
| showBadge | boolean | false | 오른쪽에 `CostKindBadge` |
| asOf | IsoTime? | - | 툴팁 `HH:mm 조회` |
| settledThrough | string? | - | 확정 `9월 17일까지 반영` |
| range | `{ low: number; high: number; confidence: number }?` | - | 예측 `80% 구간 $790 – $900` (아래 줄 caption) |
| unknownReason | string? | - | |

state: default / unknown(`—`) / stale(valueText 색) / loading(스켈레톤, size별 폭 80/96/120/160px).

### 3.2 `CostKindBadge`
| prop | 타입 | 설명 |
|---|---|---|
| kind | CostKind | 문구 `추정` / `확정` / `AWS 예측` / `LLM 추정` |
| detail | string? | 문구 뒤 ` · 서버 계산` 같은 보조 |
| size | `"sm"` | 20px 고정 |

### 3.3 `MetricTile` (KPI 타일, 세 기능 공용)
| prop | 타입 | 설명 |
|---|---|---|
| label | string | caption-strong `text.secondary` |
| value | ReactNode | 보통 `MoneyValue size="xl"` 또는 숫자 metricLg |
| kind | `CostKind \| "plain"` | estimate면 테두리 dashed `cost.estimate.border`, forecast면 solid `cost.forecast.border`, confirmed/plain은 `border.subtle` |
| badge | ReactNode? | 오른쪽 위 (`CostKindBadge` 또는 `StatusBadge`) |
| lines | ReactNode[]? | 보조 줄(caption), 최대 3줄 |
| status | Status? | 왼쪽 3px 막대 (warn/crit만) |
| footer | ReactNode? | 경고 칩 등 |
| state | `"ready" \| "loading" \| "unknown" \| "hidden"` | |
| unknownReason | string? | `알 수 없음 (Cost Explorer 사용 불가: AccessDenied)` |
| href | string? | |

치수: 높이 136px 고정, 패딩 16px, radius 8px.

### 3.4 `BudgetGauge`
| prop | 타입 | 설명 |
|---|---|---|
| budget | number | |
| confirmed | number | 확정 누적 |
| projected | number \| null | 월말 예측 값 |
| projectedKind | `"forecast" \| "estimate"` | |
| projectedRange | `{ low; high }?` | |
| warnRatio | number | 기본 0.9 (서버 값) |
| elapsedRatio | number | 이번 달 경과율 |
| elapsedLabel | string | `19/30일` |

모양: `status.md` 3.3. 폭 100%, 게이지 영역 높이 32px(막대 8px + 라벨 14px + 여백).

### 3.5 `RangeValue`
월말 예측의 `$790 – $900` 표시 전용. props: `low`, `high`, `confidence`(0.8 → `80% 구간`), `kind`.

---

## 4. 버튼·입력

### 4.1 `Button`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| variant | `"primary" \| "secondary" \| "ghost" \| "danger"` | `secondary` | |
| size | Size | `md` | sm 28 / md 32 / lg 40px |
| icon | IconName? | - | 왼쪽 16px(lg 20px) |
| loading | boolean | false | 아이콘 자리에 스피너, 클릭 무시, 폭 유지 |
| disabled | boolean | false | |
| disabledReason | string? | - | 비활성일 때 툴팁 + `aria-describedby` |
| fullWidth | boolean | false | |

| variant | 배경 / 글자 / 테두리 | hover | pressed | disabled |
|---|---|---|---|---|
| primary | `accent.default` / `accent.onAccent` / 없음 | `accent.hover` | `accent.pressed` | 배경 `bg.surfaceSunken`, 글자 `text.disabled` |
| secondary | `bg.surface` / `text.primary` / 1px `border.default` | `bg.hover` | `bg.pressed` | 글자 `text.disabled`, 테두리 `border.subtle` |
| ghost | 투명 / `text.secondary` / 없음 | `bg.hover` | `bg.pressed` | 글자 `text.disabled` |
| danger | `bg.surface` / `danger.default` / 1px `danger.default` | 배경 `status.crit.bg` | 배경 `danger.default`, 글자 `danger.onDanger` | 글자 `text.disabled` |

패딩 좌우: sm 10px, md 12px, lg 16px. radius 6px. 글자: sm caption-strong 12/16, md·lg body-strong 14/20. 포커스 `shadow.focus`(danger는 `focusDanger`).

### 4.2 `IconButton`
props: `icon`, `label`(필수, aria-label + 툴팁), `size`(sm 24 / md 32 / lg 40), `variant`(`ghost` 기본 / `secondary`). 아이콘 sm 14 / md 16 / lg 20.

### 4.3 `CopyButton`
props: `text`, `label`(기본 `복사`), `size`(`sm` | `md`), `showLabel`(기본 true). 누르면 1500ms 동안 아이콘 `check` + 문구 `복사됨`, `aria-live="polite"`.

### 4.4 `SearchInput`
props: `value`, `onChange`, `placeholder`, `debounceMs`(기본 200), `width`(기본 240px). 높이 32px, 왼쪽 아이콘 `search` 16px, 값 있으면 오른쪽 `x` 버튼. 단축키 `/`로 포커스.

### 4.5 `Select` / `MultiSelect`
props: `options: { value; label; count?: number; icon? }[]`, `value`, `onChange`, `label`(버튼 앞 문구), `width`(기본 180px), `searchable`(옵션 10개 초과 시 true). 높이 32px. MultiSelect 버튼 문구: 0개 `네임스페이스: 전체`, 1개 `네임스페이스: batch`, 2개 이상 `네임스페이스: 3개`. 목록 Popover 최대 높이 320px.

### 4.6 `SegmentedControl`
props: `options: { value; label; count?: number; status?: Status }[]`, `value`, `onChange`, `size`(`sm` 28 / `md` 32). 선택 항목 배경 `bg.surface` + shadow xs, 트랙 `bg.surfaceSunken`, radius 6px, 트랙 패딩 2px. `status`가 있으면 라벨 앞 12px 상태 아이콘, `count`는 라벨 뒤 caption `text.tertiary`.

### 4.7 `Switch`
props: `checked`, `onChange`, `label`(오른쪽 문구, body). 트랙 32×18px, 손잡이 14px. 켜짐 트랙 `accent.default`.

### 4.8 `FilterBar`
props: `children`(필터 컨트롤들), `resultText`(`파드 412개 중 37개 표시`), `onReset`(필터가 기본값이 아니면 `필터 초기화` ghost sm 표시). 높이 48px, 컨트롤 간격 8px, 아래 여백 12px. 1280px 미만에서 줄바꿈 허용.

---

## 5. 오버레이

### 5.1 `Tooltip`
props: `content`, `delayMs`(기본 400), `side`(`top` 기본), `maxWidth`(기본 320px). 배경 `text.primary`, 글자 `text.inverse`, caption 12/16, 패딩 6px 8px, radius 4px. 다크 테마는 배경 `bg.surfaceRaised` + 1px `border.default` + 글자 `text.primary`.

### 5.2 `Popover`
props: `trigger`, `children`, `width`(기본 280px), `align`. 배경 `bg.surfaceRaised`, 1px `border.default`, radius 8px, shadow md, 패딩 12px.

### 5.3 `Drawer`
props: `open`, `onClose`, `title`, `subtitle?`, `size`(`md` 480 / `lg` 640px), `footer?`, `children`. 오른쪽에서 열림, 높이 = 뷰포트, scrim `bg.scrim`, shadow lg, 머리글 높이 56px(패딩 좌우 20px, 닫기 IconButton md), 본문 패딩 20px 스크롤. `Esc`로 닫힘, 포커스 가둠.

### 5.4 `Dialog`
props: `open`, `onClose`, `title`, `description`, `confirmLabel`, `cancelLabel`(기본 `닫기`), `tone`(`default` | `danger`), `size`(`sm` 400 / `md` 560px). 패딩 24px, radius 12px, shadow lg, 버튼 오른쪽 정렬 간격 8px.

### 5.5 `HelpPopover`
"계산 방법", "이 추정에 포함되지 않는 것" 같은 긴 도움말. props: `label`, `title`, `content`(ReactNode), `mode`(`popover` 폭 400px | `drawer` md). 트리거는 ghost sm 버튼 + 아이콘 `circle-help`.

---

## 6. 알림·빈 상태

### 6.1 `Banner` (페이지 상단 전체 폭 안내)
props: `tone`(`info` | `warn` | `crit` | `neutral`), `icon?`, `title`, `description?`, `actions?`, `closable`(기본 false, **2026-09-20 표준 이름**) / `onClose?` / `closeLabel?`. 이전 이름 `dismissible`·`onDismiss`는 **deprecated**이며 당분간 함께 받는다(`closable ?? dismissible`, 6.2 마지막 항목). 높이 최소 48px, 패딩 12px 16px, radius 8px, 배경 `<tone>.bg`, 왼쪽 3px `<tone>.solid`, 제목 body-strong, 설명 caption. neutral은 `bg.surfaceSunken` + `border.strong`. (연결 끊김은 `ConnectionBanner`를 쓴다.)

### 6.2 `InlineAlert` (카드·섹션 안)
props: `tone`, `title`, `description?`, `action?`, `compact`(true면 한 줄 32px). 패딩 8px 12px, radius 6px, 아이콘 16px.

**닫기 (2026-09-20 추가, `snapshot-3d` 9.5·9.9)**
- `closable?: boolean`(기본 false), `onClose?: () => void`, `closeLabel?: string`(**기본 `이 안내 닫기`** — 2026-09-20 (4) 구현에 맞춰 확정). 두 값이 **모두 있을 때만** 닫기 버튼을 그린다.
- **기본값이 `Banner`(6.1, 기본 `닫기`)와 다른 이유**: `Banner`는 페이지 위에 하나뿐이라 `닫기`로 충분하지만, `InlineAlert`는 **한 카드 안에 여러 개가 겹칠 수 있다**(3D 보기는 최대 2개를 쌓는다). 목록에서 `닫기` 버튼이 연달아 읽히면 무엇을 닫는지 알 수 없다.
- **같은 화면에 닫을 수 있는 알림이 둘 이상이면 `closeLabel`을 반드시 준다.** `snapshot-3d` 9.5 저사양 → `3D 속도 안내 닫기`, 9.9 잘림 → `일부만 표시 안내 닫기`.
- `closable`이면 오른쪽 끝에 `IconButton` sm `x`(24 × 24px, 클릭 영역 32 × 32px)를 두고, `action`이 함께 있으면 **`action` 다음 8px**에 놓는다. `compact`에서도 같은 자리.
- 닫기는 **화면 상태일 뿐**이다. 서버에 알리지 않고, 다시 뜰 조건은 부르는 쪽이 정한다(예: `snapshot-3d` 9.5·9.9는 "이 스냅샷을 보는 동안 다시 뜨지 않음").
- **닫기를 붙이면 안 되는 알림**: 사용자가 할 일이 남아 있거나 데이터가 잘못 읽힐 수 있는 것(WebGL 없음 안내 9.3, 구성 변경 9.8, 관계 표의 잘림 안내 9.9). 이 셋은 `closable`을 주지 않는다.
- `aria`: 버튼 `aria-label = closeLabel`.
- **낭독 규칙 (2026-09-20 (4) 수정 — 문서를 구현에 맞춘다)**: `InlineAlert`는 기본적으로 `role`을 두지 않는다. **`live`를 준 알림만 `role="status"`** 다. 이전 서술("`crit`이면 `alert`, 아니면 `status`")은 **틀렸다** — 화면에 원래 있던 알림까지 모두 낭독돼 소음이 된다(한 화면에 알림이 3~4개인 상세 화면이 있다).
- `live`를 주는 기준: **사용자가 보고 있는 동안 새로 나타나는 알림**만. `snapshot-3d` 기준 → 9.4 데이터 오류 · 9.5 저사양 · 9.8 구성 변경 = `live`, 9.3 WebGL 없음 · 9.9 잘림 = `live` 아님(탭을 열 때부터 있던 것이라 화면 낭독 순서에서 읽힌다).

**이름을 `closable`/`onClose`로 통일 (2026-09-20 판단)**
- `Banner`(6.1)는 `dismissible`/`onDismiss`, `InlineAlert`는 `closable`/`onClose`로 갈라져 있었다. **`closable` / `onClose` / `closeLabel`을 표준으로 삼는다** — 닫는 장치가 `x` 버튼이고, `Dialog`·`Drawer`·`Popover`가 이미 `onClose`를 쓰므로 한 낱말로 모인다(`dismiss`를 쓰는 컴포넌트는 `Banner` 하나뿐이었다).
- **하위 호환**: `Banner`는 두 이름을 **당분간 함께 받는다**. `closable ?? dismissible`, `onClose ?? onDismiss`로 읽고, `dismissible`/`onDismiss`는 **더 이상 쓰지 않음(deprecated)** 으로 표시만 한다. 지금 쓰는 곳이 바뀌지 않으므로 **이번 작업에서 사용처를 고치지 않는다.**
- 새로 쓰는 곳은 `closable`/`onClose`만 쓴다. 기존 사용처 정리는 별도 작업으로 미룬다(`Banner`를 쓰는 화면이 여러 기능에 걸쳐 있어 한 번에 바꾸면 회귀 범위가 커진다).

### 6.3 `EmptyState`
props: `icon`, `title`, `description?`, `action?`, `size`(`sm` 높이 200px, 아이콘 24px / `lg` 높이 320px, 아이콘 40px). 가운데 정렬, 아이콘 `text.tertiary`, 제목 body-strong, 설명 caption `text.secondary` 최대 폭 400px.

### 6.4 `UnknownState`
출처 없음·권한 없음. props: `reason`(서버 사유), `title`(기본 `알 수 없음`), `hint?`(해결 방법), `size`, `icon?`(`"circle-help"` 기본 \| `"hourglass"`). EmptyState 모양 + 아이콘 `status.unknown.fg`(크기는 EmptyState와 같음: sm 24px / lg 40px). `hourglass`는 기다리면 풀리는 알 수 없음(클러스터 동기화 중, 스냅샷 파일 확인 전)에만 쓴다. 다른 아이콘은 받지 않는다(알 수 없음이 여러 모양으로 퍼지지 않게). 색은 두 아이콘 모두 `status.unknown.fg`. (2026-09-19 k8s-snapshot 추가)

### 6.5 `ErrorState`
API 오류. props: `title`, `detail?`(오류 종류: network/timeout/http 5xx), `onRetry?`, `size`. 아이콘 `unplug`(network/timeout) 또는 `server-crash`(http). 색은 `text.tertiary`(빨강 금지: 장애와 혼동 방지).

### 6.6 `Skeleton`
props: `width`, `height`, `radius`(기본 4px), `lines?`. 배경 `skeleton.base`, shimmer `skeleton.highlight` 1500ms. 표시 지연 150ms(빨리 끝나는 로딩에서 깜박임 방지).

### 6.7 `Spinner`
props: `size`(12 | 16 | 20 | 40). 선 2px, `accent.default`, 회전 800ms linear.

---

## 7. 표

### 7.1 `DataTable<T>`
| prop | 타입 | 설명 |
|---|---|---|
| columns | `Column<T>[]` | 아래 |
| rows | T[] | |
| rowKey | (row) => string | |
| sort | `{ columnId; dir: "asc" \| "desc" } \| null` | null = 기본 정렬(서버 또는 호출 측) |
| onSortChange | (sort) => void | 순환 규칙 `status.md` 5.2 |
| density | `"default" \| "compact"` | 40 / 32px |
| virtualized | boolean | 200행 초과 시 true |
| height | number \| "auto" | 가상 스크롤 시 px |
| rowStatus | (row) => Status? | crit 행 왼쪽 3px 막대 |
| selectedKey | string? | |
| onRowClick | (row) => void? | 행 전체 클릭(키보드 Enter) |
| expandable | `{ render: (row) => ReactNode; expandedKeys; onToggle }?` | |
| pinnedBottomRows | T[]? | 미할당·공용·기타 행(배경 `bg.surfaceSunken`) |
| totalRow | ReactNode? | 합계 행(bodyStrong, 위 2px `border.default`) |
| state | `"ready" \| "loading" \| "empty" \| "filteredEmpty" \| "unknown" \| "error"` | |
| emptyProps / unknownReason / onRetry / onResetFilters | | |
| pendingReorder | number? | `새 순서로 정렬 (N건 변경)` 링크 표시 |
| onApplyReorder | () => void | |
| caption | string | 스크린리더용 표 제목 |

`Column<T>`: `{ id; header: ReactNode; headerBadge?: ReactNode; width?: number; minWidth?: number; maxWidth?: number; align?: "left" \| "right" \| "center"; sortable?: boolean; render: (row) => ReactNode; numeric?: boolean; sticky?: "left" }`.

### 7.2 `ResourceName`
props: `name`, `keepTail`(기본 16), `href?`, `copyable`(기본 true), `maxWidth`(px), `kind?`(`pod` | `node` | ...; node면 첫 `.` 앞만 표시). 가운데 말줄임·툴팁·복사: `status.md` 5.3.

### 7.3 `KeyValueList` (상세 화면 메타)
props: `items: { label; value: ReactNode; hint?: string }[]`, `columns`(1 | 2), `labelWidth`(기본 120px). 행 높이 최소 32px, 라벨 caption `text.secondary`, 값 body.

### 7.4 `DistributionBar` (워크로드의 파드 상태 분포, 네임스페이스 구성비)
props: `segments: { value: number; status?: Status; color?: string; label: string }[]`, `height`(4 | 8px), `width`. 세그먼트 사이 1px `bg.surface` 틈, 툴팁에 각 라벨·값.

---

## 8. 기타 구조

### 8.1 `Section`
props: `title`(h2), `badges?`(제목 옆), `meta?`(제목 아래 caption), `actions?`(오른쪽), `children`, `collapsible?`, `defaultCollapsed?`. 섹션 간 32px, 제목-내용 12px.

### 8.2 `Card`
props: `padding`(`sm` 12 | `md` 16 | `lg` 20px), `interactive`, `kind`(`default` | `estimate` dashed | `stale` dashed), `status?`(왼쪽 3px 막대 warn/crit), `children`. radius 8px, 1px `border.subtle`, shadow xs.

### 8.3 `Tabs`
props: `items: { id; label; count?; status? }[]`, `value`, `onChange`. 높이 40px, 선택 탭 아래 2px `accent.default`, 글자 body(선택 600).

### 8.4 `Timestamp`
props: `value: IsoTime`, `format`(`time` HH:mm:ss | `shortTime` HH:mm | `auto` — `status.md` 6절), `relative`(보조 `3분 전` 병기). 툴팁에 전체 시각. tabular.

### 8.5 `Duration` / `ElapsedTimer`
- `Duration`: props `ms`, `style`(`table` `4분 12초` | `timer` `4:12`).
- `ElapsedTimer`: props `startedAt: IsoTime`, `serverNow?: IsoTime`(시계 차이 보정), `tickMs`(기본 1000). metricSm 16/24 tabular.

### 8.6 `Stepper` (진행 단계)
props: `steps: { id; label; state: "pending" \| "active" \| "done" \| "error" \| "skipped"; detail?: string }[]`, `orientation`(`horizontal` 기본). 단계 원 20px: pending 1.5px `border.strong` 빈 원 / active `accent.default` 채움 + 안쪽 12px 스피너(흰색) / done `status.ok.solid` + `check` 12px / error `status.crit.solid` + `x` 12px / skipped `bg.surfaceSunken` + `minus`. 연결선 2px, done 구간 `status.ok.solid`, 나머지 `border.default`. 라벨 caption(active는 captionStrong `text.primary`), detail은 micro `text.tertiary`. 단계 최소 폭 120px.

### 8.7 `CodeBlock`
| prop | 타입 | 설명 |
|---|---|---|
| code | string | **텍스트로만** 렌더(HTML 해석 금지, 문법 강조 없음) |
| language | string? | 머리글 왼쪽 라벨(`bash`, `yaml`), 없으면 `코드` |
| maxHeight | number | 기본 320px, 넘치면 세로 스크롤 |
| wrap | boolean | 기본 false(가로 스크롤) |

모양: 머리글 32px(`code.headerBg`, 좌우 12px, 라벨 micro `text.secondary`, 오른쪽 `CopyButton size="sm"`), 본문 패딩 12px 16px, 배경 `code.bg`, 글자 `code.fg` code 13/20, 1px `code.border`, radius 6px.

### 8.8 `JsonTree`
props: `data: unknown`, `defaultExpandDepth`(기본 1), `searchable`(기본 true), `maxHeight?`. 줄 높이 22px, 들여쓰기 16px, mono 12/20. 키 `text.secondary`, 문자열 `status.ok.fg`, 숫자 `accent.default`, 불리언·null `cost.estimate.fg`, 가려진 값(`[가림]`) `status.warn.fg` + 배경 `status.warn.bg`. 접기 아이콘 `chevron-right` 12px. 배열·객체 접힘 시 `[12개]`, `{8개}` 요약.

---

## 9. 차트 (프론트 구현, `apps/web/src/charts`)

모든 차트 공통 props: `height`, `state`(`ready` | `loading` | `empty` | `unknown` | `stale`), `unknownReason?`, `staleAt?`, `observedMinutes?`(관측 N분 칩), `ariaLabel`(요약). 모양: `status.md` 4절.

| 컴포넌트 | 주요 props | 쓰는 곳 |
|---|---|---|
| `TimeSeriesChart` | `series: { id; label; color; points: [t, v][]; dash? }[]`, `range: "1h" \| "24h" \| "7d" \| "30d" \| "90d"`, `unit: "percent" \| "millicore" \| "bytes" \| "usdPerHour" \| "count"`, `thresholds?: { level: "warn" \| "crit"; value; label }[]`, `reference?: { value; label }`, `yMax?` | CPU·메모리 추이, 소모율 추이 |
| `Sparkline` | `points`, `color`, `status?` | 개요 카드 |
| `DailyBarChart` | `days: { date; total; unsettled: boolean; status?: Status; byService?: Record<string, number> }[]`, `mode: "total" \| "byService"`, `reference?` | 일별 확정 비용 |
| `MonthProjectionChart` | `confirmed: [day, cum][]`, `forecast?: { points; band: [day, low, high][]; end }`, `estimateEnd?`, `budget?`, `warnRatio?`, `today` | 이번 달 누적·예측 |
| `ChartTooltip` | `time`, `rows: { label; color; value: string; status?: Status; dashed? }[]`, `badge?` | 공통 |
| `ChartLegend` | `items: { label; color; dashed? }[]` | 공통 |

---

## 10. 어드바이저 전용

### 10.1 `BridgeStatusBar`
| prop | 타입 | 설명 |
|---|---|---|
| bridge | `"connected" \| "login_required" \| "usage_limit" \| "unreachable" \| "unknown"` | API `BridgeState` 값 그대로. 배지 매핑 `status.md` 8.3 |
| message | string | 안내 문구 |
| command | string? | 실행·로그인 명령(인라인 코드 + CopyButton) |
| retryAt | IsoTime? | 사용량 한도 해제 시각 |
| checkedAt | IsoTime | `14:02 확인` |
| onRecheck | () => void | `다시 확인` ghost sm |
| runButton | ReactNode | `분석 실행` 버튼 |
| previewButton | ReactNode | `보낼 데이터 보기` |
| exampleMode | boolean | mock + 브리지 없음 → `예시 응답` 배지 |

높이 최소 72px, 패딩 16px 20px, Card. 레이아웃은 `architecture-advisor.md` 2.1.

### 10.2 `RunProgressPanel`
| prop | 타입 | 설명 |
|---|---|---|
| run | `{ id; startedAt; stage; stages: Stepper steps; lastReceivedAt?; receivedChars?; delayed: boolean; example: boolean }` | |
| onCancel | () => void | 취소 확인 Dialog를 연다 |
| cancelling | boolean | 버튼 loading |

state: running / delayed(3분 초과) / cancelling. 상세 `architecture-advisor.md` 3절.

### 10.3 `RunResultAlert`
실패·취소 결과. props: `reason: "bridge_unavailable" \| "login_required" \| "usage_limit" \| "timeout" \| "invalid_response" \| "budget_exceeded" \| "interrupted" \| "other" \| "cancelled"`(API `failureReason` 값 그대로, 취소는 `status: cancelled`를 `"cancelled"`로), `message`(서버 `errorMessage`), `command?`(복사용 명령), `rawResponse?`(접힌 디버그 영역, CodeBlock wrap=true maxHeight 400), `onDismiss`, `onRetry?`(자동 재시도 없음. 사용자가 누를 때만, 브리지 연결됨일 때만 활성), `onOpenPreview?`(`budget_exceeded`의 `보낼 데이터 보기`). 사유별 tone·아이콘·문구: `architecture-advisor.md` 2.4 표.

### 10.4 `SeverityBadge`
props: `severity: Severity`, `size`(`sm` | `md`). 문구 `높음`/`중간`/`낮음`, 아이콘 high `octagon-alert`, medium `triangle-alert`, low `info`. 색 `advisor.severity.<key>`, subtle 모양(StatusBadge와 같은 치수).

### 10.5 `RiskBadge` (적용 위험도)
props: `level: Severity`, `reason?`. 문구 `위험도 낮음`/`위험도 중간`/`위험도 높음`. **outline 모양**(배경 투명, 1px `advisor.severity.<key>.border`, 글자 `.fg`), 아이콘 `shield-alert` 12px. 심각도 배지와 모양이 달라 한 카드 안에서 혼동되지 않게 한다.

### 10.6 `CategoryChip`
props: `category: AdvisorCategory`, `size`(`sm` | `md`). 문구·아이콘: 비용 절감 `piggy-bank`, 안정성 `life-buoy`, 성능 `gauge`, 보안 `shield`, DB `database`. 색 `advisor.category.<key>`.

### 10.7 `SourceLabel`
props: `source: "rule" \| "llm"`, `ruleId?`. 문구: `규칙 기반 · R-GP2`(아이콘 `ruler`) / `AI 제안`(아이콘 `sparkles`). 색 `advisor.source.<key>`, 높이 20px. rule은 채운 배경, llm은 outline.

### 10.8 `SuggestionCard`
| prop | 타입 | 설명 |
|---|---|---|
| priority | number | 1..N |
| title | string | |
| category | AdvisorCategory | |
| severity | Severity | |
| targets | `{ name; kind; href? }[]` | |
| evidence | `{ text: string; field?: string; value?: string }[]` | |
| linkedRules | string[] | R-ID |
| savings | `{ monthly: number; formula: string; source: "server" \| "llm" } \| null` | |
| steps | `{ text: string; code?: { language?; code } }[]` | |
| risk | `{ level: Severity; reason: string }` | |
| verify | string? | 확인 방법 |
| unverified | boolean | 근거 확인 불가 |
| expanded | boolean | |
| onToggle | () => void | |

state: collapsed / expanded / unverified(collapsed·expanded 모두) / hover / focus. 치수·배치 `architecture-advisor.md` 4절.

### 10.9 `NoExecuteNotice`
props 없음(문구 고정). `대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.` 높이 40px, 패딩 8px 12px, 배경 `advisor.noExecute.bg`, 왼쪽 3px `advisor.noExecute.border`, 아이콘 `hand` 16px, 글자 body-strong `advisor.noExecute.fg`, radius 6px.

### 10.10 `SeverityMatrix` (사전 점검 요약)
props: `cells: Record<AdvisorCategory, Record<Severity, number>>`, `onCellClick(category, severity)`, `selected?`. 5행(카테고리) × 3열(높음/중간/낮음) + 합계 열. 셀 48×32px, 0이면 `—` `text.disabled`, 1 이상이면 숫자 captionStrong + 배경 `advisor.severity.<key>.bg`. 행 머리는 CategoryChip sm.

---

## 11. AWS 스냅샷 전용 (`aws-snapshot-manager`)

화면 배치·문구는 `docs/design/aws-snapshot-manager.md`. 11.4·11.5·11.6은 범용이라 다른 기능에서도 쓸 수 있다.

```ts
type ScanLevel = "error" | "warn"; // API 값 그대로 (status.md 9.2)
```

### 11.1 `CodeEditor` (템플릿 보기·편집 겸용)
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| value | string | - | 파일 내용. **텍스트로만** 렌더(문법 강조·HTML 해석 없음) |
| fileName | string | - | 접근성 라벨 `terraform.tf 편집기, 1,284줄` |
| mode | `"view" \| "edit"` | `view` | edit이면 입력 가능 |
| locked | boolean | false | 저장 전 검사·저장 중 입력 잠금(`aria-readonly`) |
| onChange | (value: string) => void | - | edit일 때 |
| markers | `{ line: number; level: ScanLevel; items: { ruleId: string; description: string }[] }[]` | `[]` | gutter 아이콘 + 줄 배경. 한 줄에 여러 항목이면 가장 나쁜 등급 |
| targetLine | number \| null | null | 이동 대상 줄(3px `accent.default` 안쪽 막대 + 줄 번호 강조, 위 1/3 위치로 스크롤). 값이 바뀔 때마다 이동 |
| onTargetAnnounce | (text: string) => void | - | 이동 후 live 영역 문구 전달(`terraform.tf 212번째 줄, 오류 env-block`) |
| wrap | boolean | false | 줄 바꿈. **view 모드에서만 적용**(edit에서는 무시, 호출 측이 토글을 비활성) |
| indentUnit | string | `"  "` | Tab 키가 넣는 문자열 |
| onSaveShortcut | () => void | - | edit일 때 `Ctrl/Cmd+S` |
| height | number \| string | - | px 또는 CSS 값(`clamp(...)`) |
| highlightLine | number \| null | null | 읽기 전용 강조(메타데이터 손상 위치) — 배경 `status.crit.bg` |
| state | `"ready" \| "loading"` | `ready` | loading: 스켈레톤 12줄 |

- 치수·색: `aws-snapshot-manager.md` 5.2. gutter 배경 `code.headerBg`, 줄 번호 mono 12/20 `text.secondary`, 표시 칸 20px, 본문 code 13/20.
- **가상 렌더링 필수**: 보이는 줄만 DOM에 둔다. 20 MB 파일 스크롤이 끊기지 않아야 한다.
- 키보드: Tab = indentUnit 입력, `Esc` 다음 `Tab`/`Shift+Tab`은 포커스 이동. `Esc`만으로 모드를 바꾸지 않는다.
- state: view / edit / locked / wrap(view만) / loading / hover(gutter 아이콘 툴팁, hover 전용·포커스 대상 아님 — 키보드 경로는 ScanFindingList) / focus(`shadow.focus`는 Card 바깥이 아니라 코드 영역 안쪽 2px `border.focus` 테두리).
- 탭·툴바·알림 슬롯은 이 컴포넌트 밖(프론트가 Tabs·Button·InlineAlert로 조립).
- 줄바꿈 문자: 편집 라이브러리가 CRLF를 LF로 바꿔 다루더라도 `onChange` 값과 표시 줄 수가 원본 줄과 1:1이어야 한다. 원본 줄바꿈 복원 책임은 계약(`docs/api/aws-snapshot-manager.md`)에 따른다.

### 11.2 `ScanFindingList`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| findings | `{ id: string; level: ScanLevel; file: string; line: number; ruleId: string; description: string; navigable: boolean; hint?: string; action?: ReactNode }[]` | - | 서버 순서 그대로. `description`은 서버가 가린 문구(원문 없음) |
| variant | `"default" \| "compact"` | `default` | |
| selectedId | string \| null | null | `aria-current` |
| onSelect | (finding) => void | - | `navigable`일 때만 |
| maxItems | number? | - | 넘으면 `외 N건`(caption `text.tertiary`) |
| maxHeight | number? | - | px, 넘치면 세로 스크롤 |

| variant | 항목 모양 |
|---|---|
| default | 최소 높이 52px, 패딩 8px 12px, 항목 사이 1px `border.subtle`. 1줄: 등급 아이콘 14px(`octagon-x` `status.crit.fg` / `triangle-alert` `status.warn.fg`) + 4px + 등급 문구 captionStrong(`오류`/`경고`, 같은 색) + 8px + `terraform.tf:212` mono 12/20 `text.primary`. 2줄(왼쪽 들여쓰기 18px): 규칙 ID 상자(높이 18px, 패딩 0 4px, radius 4px, 배경 `bg.surfaceSunken`, mono 11/14 `text.secondary`) + 6px + 설명 caption `text.secondary` 1줄 말줄임(툴팁 전체) |
| compact | 높이 32px 한 줄: 아이콘 12px + `terraform.tf:212` mono 12 + 규칙 ID 상자 + 설명(말줄임) |

- state: hover(`bg.hover`, 커서 pointer) / selected(`bg.selected` + 왼쪽 3px `accent.default`) / focus(`shadow.focus` 안쪽) / 비이동(`navigable: false`: hover 배경 없음, 2줄 아래 3줄에 `hint` caption `text.tertiary`, 예 `metadata.json은 대시보드에서 편집할 수 없습니다`, 또는 `action`(예 ghost sm `라벨·메모 편집`)).
- 각 항목은 `<button>`(비이동은 `<div>`), 목록은 `<ul>`.

### 11.3 `ScanCounts`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| errors | number \| null | - | |
| warnings | number \| null | - | |
| size | `"sm" \| "md"` | `sm` | sm: 아이콘 12px + caption 12/16(오류 부분 captionStrong). md: 아이콘 16px + metricSm 16/24 |
| layout | `"inline" \| "stacked"` | `inline` | stacked: 오류 줄 위, 경고 줄 아래(표 2줄 셀) |
| state | `"ready" \| "unknown" \| "stale"` | `ready` | |

- 0인 등급은 그리지 않는다. 둘 다 0이면 `circle-check` `status.ok.fg` + `발견 없음`(`text.secondary`).
- 오류: `octagon-x` + `오류 2`(`status.crit.fg`). 경고: `triangle-alert` + `경고 1`(`status.warn.fg`). inline 구분 ` · `(`text.tertiary`).
- unknown: `circle-help` `status.unknown.fg` + `스캔할 수 없음`(`text.tertiary`). stale: 숫자 `status.stale.valueText`, 아이콘 유지.
- 스크린리더: `현재 스캔 오류 2건, 경고 1건`.

### 11.4 `TextField` / `TextArea`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| label | string | - | 필드 위, captionStrong `text.secondary`, 아래 4px |
| value / onChange | string / (v) => void | - | |
| maxLength | number? | - | 넘는 입력(붙여넣기 포함)은 받지 않고 `error`를 띄운다(호출 측) |
| showCount | boolean | false | 필드 아래 오른쪽 caption `text.tertiary` `12/60`, 상한 도달 시 `status.warn.fg` |
| placeholder | string? | - | `text.tertiary` |
| hint | string? | - | 필드 아래 왼쪽 caption `text.secondary` |
| error | string? | - | 필드 아래 왼쪽 caption `danger.default` + `octagon-x` 12px, 테두리 `danger.default`, `aria-invalid` |
| mono | boolean | false | 글자 code 13/20 mono (ID 입력) |
| disabled | boolean | false | 배경 `bg.surfaceSunken`, 글자 `text.disabled` |
| rows / minHeight / maxHeight | (TextArea) | 7 / 144px / 320px | 세로 크기 조절만 |

치수: TextField 높이 32px, 패딩 0 12px. TextArea 패딩 8px 12px. 공통: 배경 `bg.surface`, 1px `border.default`, radius 6px, 글자 body 14/20. hover 테두리 `border.strong`, focus 테두리 `accent.default` + `shadow.focus`. 오류와 카운터는 한 줄(높이 16px, 위 4px)에 좌우로.

### 11.5 `TypeToConfirmDialog`
| prop | 타입 | 설명 |
|---|---|---|
| open / onClose | | |
| title / description | string / ReactNode | |
| expected | string | 입력해야 하는 값(스냅샷 ID). 앞뒤 공백을 뺀 입력이 정확히 같을 때만 확인 활성 |
| inputLabel | ReactNode | `확인을 위해 스냅샷 ID 20260915-101010을 입력하세요` |
| confirmLabel / confirmLoadingLabel | string | `휴지통으로 이동` / `옮기는 중` |
| loading | boolean | |
| error | ReactNode? | 본문 맨 위 InlineAlert crit |
| onConfirm | () => void | |
| children | ReactNode | 요약·파일 목록·안내 |

Dialog md(560px) tone danger 기반. 입력은 TextField mono, `autocomplete="off"`, `spellcheck=false`, 붙여넣기 허용, 열릴 때 포커스. 불일치 중 오류 문구 없음, 확인 버튼 `aria-disabled` + 사유 `스냅샷 ID를 입력하세요`. Enter는 일치할 때만 확인.

### 11.6 `CommandSteps`
| prop | 타입 | 설명 |
|---|---|---|
| steps | `{ id: string; title: string; command?: string; text?: ReactNode }[]` | command가 있으면 CommandLine, 없으면 text |
| titleWidth | number | 기본 120px |

한 단계: 번호 원 20px(`bg.surfaceSunken`, captionStrong `text.secondary`) + 12px + 제목 bodyStrong(titleWidth) + 내용(flex). 단계 간 12px. 1280px 미만에서는 제목 위, 내용 아래로 쌓는다. 명령은 텍스트로만(실행 수단 없음).

---

## 12. 기존 컴포넌트 확장 (`aws-snapshot-manager`에서 필요)

### 12.1 `SideNav` `NavItem`
- `count?: number` — 1 이상일 때 상태 아이콘 오른쪽 4px에 숫자 배지(높이 18px, 최소 폭 18px, 패딩 0 5px, radius pill, 배경 `status.<status>.bg`, 1px `status.<status>.border`, 글자 `status.<status>.fg` micro 11/14 600 tabular, 99 초과 `99+`, `aria-hidden`). 접힘 모드에서는 그리지 않는다.
- `statusLabel?: string` — 상태 문구 대체(`커밋 금지`, `status.md` 1.2). 스크린리더 `, 커밋 금지 2개`, 접힘 툴팁 `AWS 스냅샷 · 커밋 금지 2개`.

### 12.2 `SummaryStrip`
- `overall.label?: string` — 왼쪽 배지 문구 대체(`커밋 금지`). aria-live 문구도 이 값을 쓴다.
- `updatedLabel?: string` — 기본 `마지막 갱신`, 스냅샷은 `마지막 확인`.
- `actions?: ReactNode` — 마지막 확인 시각 오른쪽 8px(새로고침 IconButton md).
- `updatedStale` true일 때 시각 오른쪽에 StaleNotice를 둘 수 있게 `updatedExtra?: ReactNode`.

### 12.3 `DataTable`
- `density: "comfortable"` 추가 — 행 높이 56px, 셀 위아래 패딩 8px, 2줄 셀(1줄 table 13/20, 2줄 caption 12/16 `text.secondary`, 줄 간 4px). 가상 스크롤 행 높이도 56px.

### 12.4 `Tabs` `TabItem`
- `dirty?: boolean` — 라벨 뒤 4px에 8px 원 `accent.default`, sr `저장 안 됨`.
- `suffix?: string` — 라벨 뒤 caption `text.tertiary`(`보기 전용`, `파일 없음`).
- `mono?: boolean` — 라벨 mono 12/20(파일 이름).
- `status`는 기존대로 12px 아이콘(발견 최악 등급 → `crit`/`warn`, 파일 없음 → `crit`).

### 12.5 `KeyValueList` item
- `note?: { tone: "warn" | "info" | "crit"; text: string }` — 값 아래 4px caption, 아이콘 12px(`triangle-alert` `status.warn.fg` / `info` `info.fg` / `octagon-x` `status.crit.fg`) + 문구 `text.secondary`.

### 12.6 `Dialog`
- `confirmDisabled?: boolean`, `confirmDisabledReason?: string` — 확인 버튼 `aria-disabled` + 툴팁.
- 확인 없이 닫기만 있는 창(충돌)은 기존 `confirmLabel` 생략으로 된다.
- `initialFocus?: "cancel" | "confirm" | "content"` — TypeToConfirmDialog는 `content`(입력)에 포커스.

### 12.7 `DataSourceBadge`
- 시나리오 그룹에 AWS 스냅샷 추가(표시 이름 `AWS 스냅샷`, 순서 맨 뒤). 그룹 키는 계약(`docs/api/common.md` 6절)을 따른다.
- Kubernetes 스냅샷 그룹은 15.2.

---

## 13. 아이콘 목록 (lucide 이름)

상태: `circle-check`, `triangle-alert`, `octagon-x`, `circle-help`, `clock-alert`
셸: `radar`, `menu`, `layout-dashboard`, `server`, `boxes`, `box`, `bell-ring`, `database`, `circle-dollar-sign`, `lightbulb`, `panel-left-close`, `panel-left-open`, `sun`, `moon`, `monitor`, `unplug`, `flask-conical`
비용: `calculator`, `receipt`, `trending-up`, `building-2`, `zap`
어드바이저: `sparkles`, `ruler`, `piggy-bank`, `life-buoy`, `gauge`, `shield`, `shield-alert`, `octagon-alert`, `info`, `hand`, `play`, `square`(취소), `eye`(보낼 데이터 보기), `history`, 실패 사유 `key-round`, `timer-off`, `file-warning`, `wallet`, `rotate-ccw`
공통: `search`, `x`, `chevron-right`, `chevron-down`, `arrow-up`, `arrow-down`, `copy`, `check`, `minus`, `ban`, `pause`, `tilde`, `timer`, `hourglass`, `settings`, `server-crash`, `external-link`, `refresh-cw`, `chevrons-right`
Kubernetes 스냅샷(추가): `git-compare`(드리프트 계산·탭 칩), `square-plus` / `square-minus` / `square-dot`(드리프트 추가·삭제·변경), `eye-off`(비교 불가·숨긴 차이·가린 값), `ship-wheel`(Helm 관리), `link-2-off`(다른 클러스터), `globe`(클러스터 범위), `layers`(종류 노드), `file-text`(리소스 파일), `chevrons-up-down` / `chevrons-down-up`(모두 펼치기·접기), `settings-2`(기본값 차이), `bot`(관리 필드), `git-branch`(형상관리 안내). 기존 재사용: `folder`, `server`, `key-round`(Secret 참조), `file-warning`(파일 문제), `file-question`(예상 밖 파일), `lock`, `minus`(계산 안 함), `database`(데이터 백업 안내), `settings`(시스템)
3D 구성도(추가, `snapshot-3d`): `table-2`(표 보기), `zoom-in` / `zoom-out`(확대·축소), `maximize`(카메라 초기화 · `일부가 화면 밖` 칩), `circle-dashed`(유령 블록), `unlink`(대상 없음·연결 못 찾음), `chevron-up`(검색 이전 결과), `waypoints`(주변만 보기), `shapes`(사용자 지정 리소스).
3D 종류 아이콘(추가, 2026-09-20 · `snapshot-3d.md` 4.10 · `KindIcon` 16.12): `hard-drive`(PVC·PV), `network`(Service), `door-open`(Ingress), `grid-2x2`(DaemonSet), `briefcase`(Job), `user-round`(ServiceAccount), `scroll-text`(Role·ClusterRole), `link`(RoleBinding·ClusterRoleBinding). 종류 아이콘으로 **재사용**: `boxes`(Deployment), `database`(StatefulSet), `timer`(CronJob), `copy`(ReplicaSet), `box`(Pod·대체), `settings-2`(ConfigMap), `key-round`(Secret), `trending-up`(HPA), `life-buoy`(PDB), `shield`(NetworkPolicy), `gauge`(ResourceQuota), `ruler`(LimitRange), `shapes`(CRD·사용자 지정), `folder`(Namespace 판), `globe`, `file-warning`, `circle-dashed`. lucide 버전에 `user-round`가 없으면 `user`, `grid-2x2`가 없으면 `layout-grid`. 기존 재사용: `file-question`(판 알약 `namespace.yaml 없음`), `box`(3D 보기 탭·블록), `layers`(층·범례), `globe`, `file-warning`, `eye-off`, `ship-wheel`, `square-dot`/`square-minus`/`square-plus`, `octagon-x`/`triangle-alert`, `key-round`, `git-compare`, `file-text`, `check` / `tilde`(확정·추정), `circle-help`, `chevrons-right`(관계 이동), `chevrons-down-up`(범례 접기), `settings`, `hourglass`, `x`
AWS 스냅샷(추가): `archive`(메뉴), `tag`(라벨·메모), `trash-2`(삭제·휴지통), `undo-2`(복원), `pencil`(편집), `save`(저장), `terminal`(CLI 안내), `folder`(폴더 위치), `file-x`(파일 없음), `file-question`(예상 밖 파일, lucide 버전에 따라 `file-question-mark`), `file-pen`(원본 편집 안내), `sticky-note`(메모 있음), `wrap-text`(줄 바꿈), `lock`(보기 전용·쓰기 불가). 기존 재사용: `file-warning`(raw 데이터), `hourglass`(내보내기 진행 중), `hand`(커밋·적용 안 함), `info`, `circle-help`

크기: 12 / 14 / 16 / 20 / 24 / 40px(`size.icon`), 선 굵기 2px(12·14px는 2.25px).

---

## 14. Kubernetes 스냅샷·드리프트 전용 (`k8s-snapshot`)

화면 배치·문구는 `docs/design/k8s-snapshot.md`, 드리프트 규칙은 `status.md` 10절. 새 토큰 없음.

```ts
// 2026-09-19 계약(docs/api/k8s-snapshot.md) 값에 맞춤: removed → deleted, change → changed
type DriftKind = "added" | "deleted" | "changed" | "same";          // API resources[].change 그대로
type DriftFieldClass = "changed" | "default" | "managed";            // API fields[].category 그대로
type DiffValueData =                                                 // API DiffValue 그대로, null = (없음)
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "list"; items: (string | number | boolean | null)[] }
  | { kind: "masked"; text: string; preview: string }
  | null;
```

### 14.1 `LinkTabs` (페이지 이동 탭)
기존 `Tabs`(8.3)는 한 페이지 안 패널 전환(`role="tablist"`)이다. 스냅샷 메뉴의 AWS / Kubernetes 탭은 **서로 다른 URL**이라 링크 목록으로 따로 둔다(탭 패턴에 링크를 넣으면 스크린리더가 "탭"으로 읽고 Enter가 페이지를 바꿔 기대와 다르다).

| prop | 타입 | 설명 |
|---|---|---|
| items | `{ href: string; label: string; status?: Status; count?: number; countTone?: Status; trailing?: ReactNode; srText?: string }[]` | `status`: 14px 아이콘(`ok`는 호출 측이 넘기지 않음). `count` ≥ 1이면 pill(`countTone` 색, 기본 `crit`). `trailing`: 드리프트 칩 등 |
| currentHref | string | 일치 항목 `aria-current="page"` |
| label | string | `<nav aria-label>` (예 `스냅샷 종류`) |

모양: `<nav>` 안 `<a>` 목록. 높이 40px, 항목 패딩 0 16px, 항목 내부 간격 6px, 라벨 body 14/20(현재 600 `text.primary`, 나머지 `text.secondary`), 현재 항목 아래 2px `accent.default`, 목록 아래 1px `border.subtle` 전체 폭. pill: 높이 18px, 최소 폭 18px, 패딩 0 5px, radius pill, `status.<countTone>.bg`/`border`/`fg`, micro 11/14 600 tabular, 99 초과 `99+`. state: default / hover(`bg.hover`) / current / focus(`shadow.focus`). 링크라 화살표 키 이동 없음(Tab 이동).

### 14.2 `LabeledStatus`
| prop | 타입 | 설명 |
|---|---|---|
| label | string | 앞 라벨 captionStrong `text.tertiary` (`드리프트`) |
| children | ReactNode | 배지(보통 `DriftStatus`) |
| reason | string? | ReasonText 1줄 |
| meta | ReactNode? | 뒤 caption `text.tertiary` (`· 15:12 계산`) |
| action | ReactNode? | 맨 뒤 8px (ghost sm 버튼. 같은 페이지 탭 전환이면 `<button>`, 다른 페이지로 가면 링크) |
| size | `"sm" \| "md"` | 간격: 라벨-배지 6px, 배지-사유 8px |

### 14.3 `DriftStatus` / `DriftKindIcon` / `DriftKindChip`
**`DriftStatus`**
| prop | 타입 | 설명 |
|---|---|---|
| state | `"changed" \| "none" \| "unknown" \| "notComputed" \| "computing" \| "stale"` | 호출 측이 API 값을 매핑 |
| count | number? | changed일 때 `차이 N건` |
| size | Size | StatusBadge 크기 그대로(sm 20 / md 24 / lg 32) |
| staleAt / previous | IsoTime? / `{ count?: number }`? | stale 배지·툴팁 `마지막 결과: 차이 3건` |
| lastResult | `{ state: "changed" \| "none"; count?: number; computedAt: IsoTime }`? | notComputed일 때 2줄 문구(호출 측 배치). API `mode: last_result`의 `lastResultStatus`(`warning` → changed, `ok` → none)·`counts`·`computedAt` |
| refreshing | boolean? | API `computing: true`. 배지(또는 계산 안 함 문구) 뒤 4px에 Spinner 12px(`aria-label="갱신 중"`). 값은 그대로 |

모양: changed → StatusBadge warn `차이 N건`, none → ok `차이 없음`, unknown → unknown `알 수 없음`, stale → stale 배지. notComputed → 배지 없이 `minus` 12px + caption `계산 안 함` `text.tertiary`(`aria-label="드리프트: 계산 안 함"`). computing(이 화면이 보낸 계산 요청 응답 대기) → Spinner 12px + caption `계산 중` `text.secondary`. 배지 `aria-label="드리프트: 차이 3건[, 사유]"`. API → state 매핑은 `k8s-snapshot.md` 16절.

**`DriftKindIcon`**: props `kind: DriftKind`, `size`(12 | 14 | 16). changed `square-dot` / deleted `square-minus` / added `square-plus`, 색 `text.secondary`. `same`은 그리지 않음. `title`로 sr 문구(`변경`/`삭제`/`추가`).

**`DriftKindChip`**: props `kind`, `size`(`sm` 20px | `md` 24px), `href?`. Chip neutral(배경 `bg.surfaceSunken`, 글자 `text.secondary`, radius 4px, 패딩 0 6px(sm)/0 8px(md), 아이콘 12/14px, micro 11/14 500(sm) / captionStrong 12/16(md)) + 문구 `변경됨`/`삭제됨`/`추가됨`/`같음`. `href`가 있으면 링크(hover `bg.hover`, focus 링).

### 14.4 `ResourceTree`
| prop | 타입 | 설명 |
|---|---|---|
| nodes | `TreeNode[]` | `{ id; kind: "group" \| "namespace" \| "resourceKind" \| "file"; label: string; icon?: IconName; mono?: boolean; count?: number; children?: TreeNode[]; disabled?: boolean; disabledReason?: string; chips?: ReactNode; markers?: TreeMarkers; tooltip?: string }` |
| TreeMarkers | `{ scan?: { level: ScanLevel; count: number }; fileIssue?: string; drift?: { kind: DriftKind; detail?: string }; helm?: boolean; dirty?: boolean; notComparable?: string; hiddenOnly?: number }` | 표시 순서 고정: scan → fileIssue → drift → helm → dirty (`k8s-snapshot.md` 5.2) |
| variant | `"files" \| "drift"` | drift: 파일 아이콘 자리에 `DriftKindIcon`, 오른쪽 caption(`필드 2`/`삭제됨`/`추가됨`/`숨김 3`) |
| selectedId | string \| null | |
| onSelect | (node) => void | 잎(file)만. disabled 제외 |
| expandedIds / onExpandedChange | string[] / (ids) => void | 제어형 |
| query | string? | 일치 잎의 조상 자동 펼침, 나머지 숨김(호출 측이 걸러도 됨) |
| height | number \| string | 가상 렌더링 컨테이너 높이 |
| state | `"ready" \| "loading" \| "empty" \| "filteredEmpty"` | loading: 스켈레톤 12행(28px, 막대 12px, 폭 40~80%) |
| label | string | `role="tree"` aria-label |

치수: 행 28px, 들여쓰기 16px/깊이, 왼쪽 패딩 8px, 펼침 칸 16px(`chevron-right` 12px, 90° 회전), 아이콘 14px + 6px, 마커 아이콘 12px 간격 4px, 개수 caption `text.tertiary` tabular. 잎 이름은 `ResourceName`(keepTail 8, copyable false). 접힌 노드는 하위 마커를 집계해 보인다(scan 최악+합계, fileIssue 아이콘만, drift `square-dot` + 차이 리소스 수). state: hover `bg.hover` / selected `bg.selected` + 안쪽 왼쪽 3px `accent.default` / focus `shadow.focus` 안쪽 / disabled 글자 `text.disabled` + 툴팁 사유. **가상 렌더링 필수**(1,000행). 키보드: WAI-ARIA tree(↑↓←→ Home End Enter `*`), roving tabindex.

### 14.5 `DriftSummary`
| prop | 타입 | 설명 |
|---|---|---|
| status | `DriftStatus` props | 줄 ① 배지 lg |
| reason | string[] | |
| computedAt | IsoTime | `15:12:04 계산` |
| target | `{ name: string; context?: string \| null }` | API `target`. `비교 대상 prod-eks (sentinel-prod)` |
| mode | `"auto" \| "on_demand" \| "last_result"` | API `drift.mode` 그대로. 줄 ① 둘째 줄 문구(`k8s-snapshot.md` 6.3) |
| refreshing | boolean | API `computing`. Spinner 12px + `갱신 중 · ` |
| onRecompute | () => void? | `on_demand`: `다시 계산` secondary sm / `last_result`: primary sm |
| counts | `{ changed; deleted; added; same; compared: number }` | API `counts` 필드 이름 그대로. 줄 ② 칸 |
| activeFilter / onFilter | `DriftKind \| "all"` / (k) => void | 칸 `aria-pressed` |
| hidden | `{ default: number; managed: number }` | API `counts.hidden` 그대로. 줄 ③, 합 0이면 줄 없음 |
| showHidden / onShowHiddenChange | boolean / (v) => void | Switch |
| notComparable | `{ kind: string; count: number; reason: string; text: string }[]` | API `uncomparable[]` 그대로. 줄 ④. `reason`: `NOT_IN_RBAC` 실선 칩 `ConfigMap 8` / `FORBIDDEN` dashed 칩 `… · 권한 거부` / `API_VERSION_MISMATCH` dashed 칩 `… · API 버전 다름` / 그 밖 실선. 툴팁 `text`(+ 사유별 안내) |
| totalUncomparable | number | `counts.uncomparable`, 라벨 `비교 불가 N개` |
| notices | ReactNode[]? | 줄 ⑤ InlineAlert neutral compact들(호출 측이 `unparsable`·`addedCheck`·`notices`로 만든다) |
| state | `"ready" \| "loading" \| "stale" \| "lastResult"` | stale: 카드 1px dashed `status.stale.border`, 수치 valueText. lastResult: 카드 1px dashed `border.strong`, 줄 ① 배지 앞 caption `지난 결과` |

Card padding 20px, 줄 사이 1px `border.subtle` + 위아래 16px. 칸: 최소 폭 120px, 높이 56px, 라벨 caption + 값 metricMd 20/28 tabular, 칸 사이 1px 세로선(높이 40px). 차이 있음이어도 왼쪽 warn 막대 없음. 칸 라벨 순서: `변경`(changed) · `삭제`(deleted) · `추가`(added) · `같음` · `비교한 리소스`.

### 14.6 `FieldDiffTable`
| prop | 타입 | 설명 |
|---|---|---|
| rows | `{ path: string; category: DriftFieldClass; reason: string \| null; managedRule?: string \| null; snapshot: DiffValueData; cluster: DiffValueData }[]` | API `fields[]` 그대로(행 키는 `path`). 서버 순서 그대로(`changed` → `managed` → `default`, 같은 분류는 경로순) |
| showHidden | boolean | true면 숨긴 행(default·managed)을 펼친 상태로 |
| hiddenExpanded / onHiddenToggle | boolean / () => void | 그룹 행 접힘 제어 |
| truncated | boolean? | API `fieldsTruncated`. true면 표 끝 안내 행 `필드 차이가 많아 500건까지만 보여 줍니다. 전체는 kubectl diff로 확인하세요.`(36px, `bg.surfaceSunken`, caption `text.secondary`, `info` 12px) |
| state | `"ready" \| "loading"` | loading: 스켈레톤 6행 |
| caption | string | 스크린리더 표 제목 |

`DataTable` 기반(머리글 36px). 열: 필드(flex 최소 200px, mono 12/20, `.` 뒤·`[` 앞 `<wbr>`, 말줄임 없음) / 스냅샷 값 176px / 화살표 24px(`→` `text.tertiary`, aria-hidden) / 클러스터 값 176px / 분류 128px(`changed` → caption `변경`, `default` → Chip `기본값 차이`(`settings-2`) + 아래 caption `reason`, `managed` → Chip `관리 필드`(`bot`) + 아래 caption `reason`). 행 최소 40px, 셀 패딩 10px 12px, 위 정렬. 숨긴 행(`default`·`managed`): 배경 `bg.surfaceSunken`, 글자 `text.secondary`. 숨긴 그룹 행 36px `bg.surfaceSunken`: `chevron-right` + `숨긴 차이 3건` + caption `(기본값 차이 2 · 관리 필드 1)`. 정렬 없음. 두 값이 표시 글자는 같고 JSON 타입만 다르면(`8080` ↔ `"8080"`) 두 셀의 `DiffValue`에 `showType` true. 여러 줄 값 `더 보기`는 행 확장 영역(`bg.surfaceSunken`, 패딩 12px 16px)에 두 값을 좌우 2단(각 50%, 간 16px)으로.

### 14.7 `DiffValue`
props: `value: DiffValueData`(API `DiffValue` 그대로, `null` = 없음), `maxLines`(기본 3), `showType`(기본 false), `onExpand?`.
- `scalar` 문자열: mono 12/20 `text.primary`, 따옴표 없이, `white-space: pre-wrap`, `overflow-wrap: anywhere`. 숫자·불리언: JSON 표기. `value: null`: mono `null` `text.tertiary`.
- `list`: 항목마다 한 줄, 앞 `- `(`text.tertiary`), mono 12/20.
- `masked`: `MaskedValue`(`text`만 쓴다).
- `null`: caption `(없음)` `text.tertiary`.
- maxLines(줄 또는 목록 항목) 넘으면 잘라 보이고 아래 링크 버튼 `더 보기 (N줄)` / `더 보기 (N개)`.
- `showType`: 값 뒤 6px에 micro 11/14 `text.tertiary` `문자열`/`숫자`/`불리언`.
- **텍스트로만 렌더**, 단위·표기 변환 없음. 객체 조각은 오지 않는다(계약).

### 14.8 `MaskedValue`
props: `text`(서버가 가린 문자열), `tooltip?`(기본 `운영 값이라 가립니다. 스냅샷 파일 쪽 원문은 파일 보기에서 확인하세요.`). 높이 22px 인라인 상자, 패딩 0 6px, radius 4px, 배경 `bg.surfaceSunken`, 1px dashed `border.default`, 아이콘 `eye-off` 12px `text.tertiary` + 4px + mono 12/20 `text.secondary`. warn 색 금지(`status.md` 10.5). 값을 복사하는 버튼을 두지 않는다.

---

## 15. 기존 컴포넌트 확장 (`k8s-snapshot`에서 필요)

### 15.1 `SideNav`
- props 변경 없음. 스냅샷 항목 `label: "스냅샷"`(기본 항목 목록 `SideNav.tsx`의 `/snapshots` 라벨). `count`·`status`는 서버 합산 값. 현재 위치 판단은 `/snapshots`로 시작하는 경로 전체(프론트).

### 15.2 `DataSourceBadge`
- 시나리오 그룹 추가: 키 **`k8s-snapshots`**(계약 `docs/api/k8s-snapshot.md` 14.4), 표시 이름 `Kubernetes 스냅샷`, 순서 `snapshots` 뒤(맨 뒤). `SCENARIO_GROUPS = ["cluster", "db", "cost", "advisor", "snapshots", "k8s-snapshots"]`. **그룹은 하나뿐**이며 드리프트 시나리오(`cluster-disconnected`, `no-drift`)도 이 그룹 안에 있다. 별도 드리프트 그룹·표시 이름은 없다.

### 15.3 `ScanFindingList`
- `truncateFile?: boolean` — 파일 표기(`data/statefulsets/postgres.yaml:41`)가 폭을 넘으면 가운데 말줄임, 뒤쪽 `<파일 이름>:<줄>`을 남긴다. 툴팁 전체 경로. 기본 false(AWS는 파일 이름이 짧다).

### 15.4 `NoExecuteNotice`
- `text?: string` — 기본 문구(`대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.`) 대체. 드리프트 탭: `대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요.` 모양 그대로.

---

## 16. 3D 구성도 전용 (`snapshot-3d`, 1단계)

화면 배치·치수·문구는 `docs/design/snapshot-3d.md`, 색·표식 규칙은 `status.md` 11절. 새 토큰: `color.*.viz`, `opacity.vizDimmed`, `opacity.vizGhost`.
**3D 캔버스(three.js) 자체는 프론트 영역**이다. 여기 컴포넌트는 캔버스를 감싸는 틀과 2D 오버레이·표까지다. 캔버스는 `canvasSlot`으로 받는다.

```ts
type VizLayer = "storage" | "workload" | "service" | "ingress" | "aux";   // 서버 blocks[].layer 그대로
type Certainty = "confirmed" | "estimated";                               // 서버 edges[].certainty 그대로
type GhostReason = "not_in_snapshot" | "secret" | "autocreated" | "cluster_scope" | "drift_added";
type SceneState =
  | "ready" | "loadingData" | "loadingChunk" | "building"
  | "empty" | "filteredEmpty" | "unsupported" | "chunkFailed" | "contextLost"
  | "error" | "unknown" | "stale";
```

### 16.1 `Scene3DFrame`
| prop | 타입 | 설명 |
|---|---|---|
| state | `SceneState` | 9절 상태별 모습. `unsupported`/`chunkFailed`/`contextLost`는 캔버스 대신 `tableSlot`을 그리고 알림을 얹는다 |
| toolbarA / toolbarB | ReactNode | 48px / 40px, 각각 아래 1px `border.subtle` |
| canvasSlot | ReactNode | 높이 = `height` − 88px |
| tableSlot | ReactNode | 관계 표(보기 전환·자동 전환 시) |
| infoBar / cameraControls | ReactNode? | 캔버스 위 오버레이(왼쪽 위 / 오른쪽 아래, 여백 12px). **`legend` 슬롯은 없앴다**(2026-09-20): 범례가 도구 막대 B의 Popover로 나가면서 캔버스 오버레이는 둘뿐이다. 프론트는 `legend`를 더 이상 넘기지 않는다 |
| notice | ReactNode \| ReactNode[]? | 캔버스 위쪽 가운데 알림(잘림·구성 변경·저사양), 최대 폭 420px. **배열이면 세로로 쌓고 간격 8px, 최대 2개까지만 그린다**(`snapshot-3d.md` 9.9) |
| height | number \| string | 기본 `clamp(480px, calc(100vh - 176px), 960px)` |
| stale | boolean | 카드 1px dashed `status.stale.border` |
| skipLinkHref | string | 캔버스 앞 `sr-only` 건너뛰기 링크 `표로 보기` |
| onRetry / onReenable | () => void? | `chunkFailed` / `contextLost` 액션 |

`Card` padding 0, radius 8px, 1px `border.subtle`. 상태별 본문은 `snapshot-3d.md` 9절 문구를 그대로 쓴다(로딩 문구는 150ms 지연).

- **컴포넌트가 안에서 그리는 알림은 `live`를 고정으로 켠다 (2026-09-20 (5), publisher 요청 ② 수용)**: `chunkFailed` · `contextLost` · `error`(= `snapshot-3d.md` 9.4)의 `InlineAlert`는 사용자가 누르지 않았는데 나타나므로 `live`(→ `role="status"`, 6.2)다. 프론트가 prop으로 줄 수 없는 자리라 컴포넌트가 정한다.
- 반대로 `unsupported`(9.3)의 알림은 **탭을 여는 순간부터 있는 사실**이라 `live`를 켜지 않는다. 3D 보기에서 `live`를 켜는 알림은 **9.4 · 9.5 · 9.8** 세 곳뿐이고, 9.5·9.8은 프론트가 `notice`로 넘긴다.

### 16.2 `SceneToolbar`
- `rowA`: 보기 전환 `SegmentedControl` sm(`3D` `box` / `표` `table-2`, 폭 120px) · 필터 `MultiSelect` 4개(네임스페이스 160 / 종류 140 / 관계 140 / 표식 140px) · `SearchInput` 200px + 결과 `3/12` + `chevron-up`·`chevron-down` · (오른쪽) 결과 수 caption + ghost sm `필터 초기화`. 높이 48px, 패딩 0 12px, 항목 간 8px.
- `rowB`: `Switch` sm `드리프트 겹쳐 보기` + 계산 시각 caption · `Select` 152px 라벨 밀도 · `Switch` sm `주변만 보기` · (오른쪽) `HelpPopover` + ghost sm `범례`. 높이 40px.
- 비활성 항목은 `aria-disabled` + 사유 툴팁(포커스 가능). 1280px 미만에서 관계·표식 필터를 `필터 ▾` 팝오버 하나로 접는다.
- **종류 필터 옵션(2026-09-20 (8) 변경)**: 각 종류 앞이 층 색 사각 10px → **`ShapeSwatch` 14px `tone="layer"`**(그 종류의 모양을 층 색으로 채운 실루엣) + 개수. **옵션 그룹 제목(층 이름)은 두지 않는다**(2026-09-20 (8-1) PM 결정 — 견본과 층 색으로 충분하고 `MultiSelect`에 그룹 구조를 더하지 않는다). 옵션 순서는 층 순서 그대로. 다른 필터(네임스페이스·관계·표식)는 바뀌지 않는다.

### 16.3 `CameraControls`
props: `view`(`top` \| `iso` \| `front`), `onView`, `onReset`, `onZoomIn`, `onZoomOut`.
세로 묶음. 시점 `SegmentedControl` sm 3칸(폭 88px) + 8px + `IconButton` sm 3개(`maximize` / `zoom-in` / `zoom-out`, 32×32px, 간격 8px). 배경 `bg.surface` 92%, 1px `border.default`, radius 8px, shadow sm, padding 4px. 툴팁에 단축키(`카메라 초기화 (0)`).

### 16.4 `SceneInfoBar`
props: `items: SceneInfoItem[]`, `mockBadge?`, `staleAt?`.
`SceneInfoItem = { id; icon?; text; tone?: "neutral" | "crit" | "warn"; href?; onClick?: () => void; actionLabel?: string; tooltip? }`
칩 목록(`Chip` neutral sm, 간격 6px, 최대 폭 480px). 순서: mock 배지 → 개수 → 드리프트 → stale → 리소스 밖 발견 → 묶어 보기·간소화 → `circle-help` 안내. 칩 배경만 쓰고 줄 전체에 판을 깔지 않는다.

**2026-09-20 (5) 변경 2건** (`snapshot-3d.md` 6.4)

- **`onClick` 추가.** `href`가 있으면 `<a>`, `onClick`이 있으면 `<button>`, 둘 다 없으면 `<span>`으로 그린다. **`href`와 `onClick`을 동시에 받으면 `href`를 무시하고 개발 모드에서 경고**한다(같은 칩이 링크이면서 동작이면 키보드·가운데 클릭 동작이 어긋난다). 쓰는 곳: `일부가 화면 밖`(카메라 축소), `일부만 표시`(알림으로 포커스), `사용자 지정 N`(종류 필터 좁히기).
- `actionLabel`: `onClick`·`href` 칩의 접근 이름을 `"<text> — <actionLabel>"`로 만든다(`일부가 화면 밖 — 전체가 보이게 축소`). 없으면 `text`만 쓴다.
- **줄바꿈하지 않는다(한 줄 고정, 높이 20px).** 칩 폭 합계가 480px을 넘으면 뒤에서부터 합쳐 `+N` Chip 하나로 만든다. 정보 줄 높이가 상수여야 캔버스 카메라의 안전 영역이 상수가 된다(`snapshot-3d.md` 4.9-1).

**2026-09-20 (6) 변경 — `+N`의 `Popover`를 만들지 않는다 (PM 결정, (5)의 마지막 줄을 철회한다)**

- `+N` Chip은 **툴팁 하나만** 갖는다. 툴팁 내용 = 합쳐진 칩들의 `text`를 순서대로 **` · `로 이은 한 줄 문자열**(아이콘·줄바꿈 없음). 예: `묶어 보기 · 라벨 19개 숨김 · 일부가 화면 밖`.
- `+N` Chip에는 **`href`·`onClick`을 주지 않는다** → `<span>`으로 그리고 **탭 정지점이 아니다**. 합쳐지기 전 칩이 갖고 있던 동작은 `+N`으로 옮기지 않는다(한 요소에 서로 다른 동작 여러 개를 담을 방법이 없다).
- 구현상 필요한 것은 **합쳐진 `SceneInfoItem[]`을 `text`로 이어 `tooltip`에 넣는 것**뿐이다. `Popover`·`onOpenChange`·펼침 상태 같은 prop을 만들지 않는다.
- 근거: `snapshot-3d.md` 6.4 — 정보 줄은 읽는 자리지 조작 자리가 아니고, 캔버스 위에 여는 면을 하나 더 만들면 범례를 캔버스 밖으로 뺀 결정(6.5)과 어긋난다.

### 16.5 `SceneLegend` (2026-09-20 변경: 캔버스 오버레이 → **Popover 내용**)
props: `layers: { layer: VizLayer; label: string; example: string; exampleKind?: string }[]`, `onClose`.
**`collapsed` / `onCollapsedChange`는 없앤다.** 도구 막대 B의 `범례` 버튼에 붙는 `Popover`(폭 **280px**, 버튼 아래 8px 오른쪽 정렬, 최대 높이 = 캔버스 높이 − 24px, 넘치면 안쪽 스크롤) 안에 그린다. 캔버스를 가리지 않는다(`snapshot-3d.md` 6.5).
패딩 12px. 머리 24px(captionStrong `범례` + 오른쪽 `IconButton` sm `x` `닫기`). 내용 micro 11/14, 줄 간 6px: 층 5줄(색 사각 12px = `viz.kind.*.fill` + 1px `edge` + **대표 종류 아이콘 12px**(`KindIcon`, `exampleKind`)) → **모양 절**(아래) → 유령(dashed 사각) → 관계 2줄(24px 실선 `확정` / dashed `추정`) → 표식 아이콘 6개 → **판 표식 줄**(20px 알약 예시 + caption `원은 블록, 알약은 판(네임스페이스)`) → 맨 아래 caption 2줄(**`블록 색은 층, 모양은 종류를 뜻합니다. 상태가 아닙니다.`** / `상태·드리프트는 블록 위 아이콘으로 표시합니다.`).

**모양 절 (2026-09-20 (8) 추가 — `snapshot-3d.md` 4.11 · 6.5)**
- prop 추가: `shapes: { shape: VizShape; label: string }[]` (9항목 고정 순서 — `stack` `Deployment` / `cylinder` `StatefulSet · PVC` / `panel` `DaemonSet · ConfigMap` / `roof` `CronJob` / `chamfer` `Job · Secret` / `diamond` `Service` / `gate` `Ingress` / `box` `그 밖 · Pod` / `tile` `곁 리소스 (HPA · PDB 외)`).
- 제목 captionStrong 11/14 `text.secondary` `모양 = 종류` + 아래 6px. 항목 = `ShapeSwatch` 16px `tone="neutral"` + 4px + micro 11/14 `text.secondary`.
- **2열**(항목 폭 124px, 열 간격 8px = 내부 폭 256px), 줄 간 6px → 5줄 · 110px. 팝오버 전체 높이 약 440px로 기준 장면(최대 592px)에서는 스크롤이 없다.
**종류 아이콘 해설(4.10의 20여 줄)은 넣지 않는다** — 팝오버가 화면을 넘고, 종류 아이콘은 언제나 종류 이름과 함께 나타난다. 관계 표 보기에서도 **같은 버튼·같은 팝오버**를 쓴다.

### 16.6 `BlockDetailPanel`
| prop | 타입 | 설명 |
|---|---|---|
| block | `{ id; layer: VizLayer; kind; custom?: boolean; apiVersion; name; namespace \| null; file \| null; documentIndex?; documentCount?; ghost?: { reason: GhostReason; text } }` \| null | null이면 `EmptyState` sm `블록을 고르세요`. ① 식별 줄의 종류 아이콘 14px은 `KindIcon`(16.12)이 `kind`·`custom`으로 고른다 |
| markers | `BlockMarkers` props | ③ 표식 줄 |
| notes | `{ code; text }[]` | ④ `InlineAlert` neutral compact 목록 |
| incoming / outgoing | `RelationItem` props[] | ⑤ 관계. 8개 초과면 `더 보기 (N개)` |
| actions | `{ file?: { href }; drift?: { href }; secrets?: { href }; disabledReason?: string }` | ⑥ 바닥 고정 버튼(secondary md, 폭 100%) |
| onSelectRelated | (blockId) => void | 관계 항목을 누르면 그 블록 선택 |
| onClear | () => void | 머리 `x` (`선택 해제 (Esc)`) |

폭 376px, `Card` padding 0, 내부 스크롤, 바닥 버튼 영역 고정(위 1px `border.subtle`, 패딩 12px 16px). **값(env·command·어노테이션·셀렉터 원문)을 표시하는 자리를 두지 않는다.**

### 16.7 `RelationItem`
props: `direction`(`in` \| `out`), `peer: { layer; kind; name; ghost?: boolean }`, `evidence: string`, `ruleLabel: string`, `certainty: Certainty`, `optional?: boolean`, `onSelect`.
높이 44px, 전체가 **`<button>` 하나**. 1줄: 방향 아이콘 `chevrons-right` 12px `text.tertiary` + 층 색 사각 10px + 종류 caption `text.secondary` + 이름 mono 12/20(가운데 말줄임 140px) + (오른쪽) `CertaintyChip`. 2줄: caption `text.tertiary` `<evidence> · <ruleLabel>`. 오른쪽 아래 `chevrons-right` 12px `text.tertiary`는 **장식 아이콘**(`aria-hidden="true"`, 포커스·클릭 대상 아님) — 행 전체가 이미 "이 블록 선택" 버튼이다. hover `bg.hover`(장식 아이콘 색 `text.secondary`로), focus `shadow.focus` 안쪽. 유령 상대는 이름 뒤 Chip neutral sm `유령`.
- **중첩 버튼 금지**(2026-09-20 publisher 구현 반영): `<button>` 안의 `<button>`은 HTML에서 유효하지 않고, 스크린리더가 같은 항목을 두 번 읽으며 탭 정지점이 관계 수의 2배가 된다. 동작은 같다(행 어디를 눌러도 상대 블록 선택). 행 접근 이름은 `Service api 선택, 확정, 셀렉터`.

### 16.8 `RelationTable`
| prop | 타입 | 설명 |
|---|---|---|
| rows | `{ id; depth; type: "group" \| "resource"; ... }[]` | 트리를 평탄화한 행. 그룹 = 네임스페이스·층 |
| (그룹 행 추가 필드, 2026-09-20) | `groupKind: "plate" \| "layer"`, `plateKind?: "namespace" \| "cluster" \| "unparsed" \| "ghost"`, `markers?: BlockMarkers props`, `notes?`, `location?: string \| null`, `actions?: { file?: { href }; drift?: { href } }`, `emptyHint?: string`, `count: number`, `totalCount: number` | `plate` 그룹 행만 표식·위치·동작 열을 채운다(`snapshot-3d.md` 8.3). `layer` 행은 세 열을 비운다. `emptyHint`(`표시할 리소스 없음`)가 있으면 자식 0이어도 행을 남기고 펼침 화살표를 비활성으로. **개수 표기(2026-09-20 확정)**: `count === totalCount`면 `(11)`, 다르면 **`(3 / 11)`**(보이는 수 / 전체 수), 자식이 0이면 `(0 / 11)`. `title`은 `보이는 리소스 3개, 전체 11개`. 판 그룹 행 아이콘 14px은 `plateKind`로 고른다(`namespace` `folder` / `cluster` `globe` / `unparsed` `file-warning` / `ghost` `circle-dashed`) |
| expandedIds / onExpandedChange | string[] / (ids) => void | 그룹 펼침 |
| selectedId | string \| null | `bg.selected` + 왼쪽 3px `accent.default` |
| onToggleRow | (id) => void | 리소스 행 펼침 → 관계 목록(`RelationItem` 2열) |
| summary | string | 표 위 caption (`블록 128개(유령 6) · 관계 164개 …`) |
| sort | `"default" \| "markers"` | `표식` 열만 정렬 가능 |
| state | `"ready" \| "loading" \| "empty" \| "filteredEmpty"` | |

리소스 행의 종류 아이콘 14px도 `KindIcon`(16.12)을 쓴다.
`DataTable` default 40px 기반. 열: 종류·이름(flex 최소 320px, 들여쓰기 16px × depth) / 위치 136 / 표식 200 / 들어옴 72(오른쪽) / 나감 72(오른쪽) / 동작 176px. 200행 초과 가상 스크롤. 펼침 영역 배경 `bg.surfaceSunken`, 패딩 12px 16px.
그룹 행 **클릭 영역 분리**: `chevron` + 이름만 펼침/접힘 토글이고, 표식·동작 버튼은 각자 동작(클릭 전파 막음). 판 그룹 행은 `selectedId` 대상이 아니다(판은 선택하지 않는다). 행 `aria-level`(판 1 / 층 2) + `aria-expanded`.

### 16.9 `BlockMarkers`
props: `scan?: { level: ScanLevel; count: number }`, `drift?: { kind: DriftKind; fieldCount?: number }`, `fileIssue?: { code; text }`, `helm?: boolean`, `notComparable?: { reason; text }`, `ghost?: { reason: GhostReason; text }`, `variant`(`overlay` 3D 위 \| `inline` 패널·표 \| **`plate` 판 라벨**), `max`(기본 3).
2026-09-20 추가 props (`snapshot-3d.md` 4.1.1·7.4):
- `notes?: { code: string; text: string; count?: number }[]` — 파일 문제 외 표시 문구를 칩·알약으로 그린다(`custom_resource` → `shapes` + `사용자 지정 리소스`, `namespace_file_missing` → `file-question` + `namespace.yaml 없음`). 순서는 표식 뒤(⑤ 정보).
- `hrefs?: { scan?: string; drift?: string }` — 값이 있으면 그 표식만 `<a>`로 렌더(판 표식 클릭 이동). 없으면 `<span>` + 툴팁.
- `density?: 0 | 1 | 2 | 3` — `plate` 전용 축소 단계. 0 전체(아이콘+문구) / 1 아이콘만 / 2 순위 1위 아이콘 + 총계 숫자 하나 / 3 순위 1위 아이콘만(폭 20px). 어느 단계에서도 표식이 **하나는 남는다**.

`overlay`: 18px **원**, 배경 `viz.label.bg`, 1px `border.default`, 아이콘 12px, 간격 4px, 넘치면 `+N`(micro `text.tertiary`). **자리 잡기는 프론트 몫**이다 — 2026-09-20부터 표식 줄은 블록 라벨 상자의 **맨 윗줄**이고 블록 오버레이 한 덩어리로 움직인다(`snapshot-3d.md` 4.8). 이 컴포넌트는 줄 하나를 그릴 뿐 좌표를 갖지 않는다.
`inline`: 아이콘 12px + 문구(`변경 2`, `오류 1`, `유령`, `Helm`, `비교 불가`, `사용자 지정`), 줄바꿈 허용.
`plate`: 높이 20px **모서리 radius 4px 알약**, 패딩 0 6px, 배경 `viz.label.bg`, 1px `border.default`, 아이콘 12px + 4px + micro 11/14 문구, 알약 간 4px, 최대 3 + `+N`.
**순서 고정**: 스캔 → 드리프트 → 파일 문제 → Helm → 유령·정보(notes). 모든 아이콘에 `title`(스크린리더 문구)과 툴팁.
**원 = 블록, 알약 = 판**(`status.md` 11.5). 같은 아이콘·색·문구를 쓰므로 모양이 유일한 구분이다.

### 16.10 `CertaintyChip`
props: `certainty: Certainty`, `optional?: boolean`, `size`(`sm` 20px).
`Chip` neutral: `확정`(`check` 12px) / `추정`(`tilde` 12px). `optional`이면 뒤 4px에 Chip neutral sm `선택 참조`. 색으로 구분하지 않는다(문구 + 아이콘). 관계선의 실선/대시와 짝을 이룬다.

### 16.11 `PlateLabel` (2026-09-20 추가)

3D 캔버스 위 **판(네임스페이스) 라벨 상자**. 위치(투영 좌표)와 축소 단계 계산은 **프론트**가 하고, 이 컴포넌트는 주어진 단계대로 그리기만 한다.

| prop | 타입 | 설명 |
|---|---|---|
| name | string | 판 이름. 가운데 말줄임(뒤 8자 보존) |
| kind | `"namespace" \| "cluster" \| "unparsed" \| "ghost"` | 이름 앞 아이콘: `namespace` **없음**(2026-09-20 (4) 확정 — 판 대부분이 네임스페이스라 잡음이고 P2·P3에서 이름을 밀어낸다), `cluster` `globe` 14px + `클러스터 범위`, `unparsed` `file-warning` 14px + `해석 실패`, `ghost` `circle-dashed` 12px + 이름 + caption `스냅샷에 없음`(caption이 사라지는 P2·P3에서도 아이콘은 남는다) |
| system | boolean | 이름 뒤 6px Chip `시스템`(`settings`) |
| resourceCount / ghostCount | number | 2줄 caption `리소스 11 · 유령 5` |
| markers | `BlockMarkers` props (`variant: "plate"`) | 3줄. 없으면 줄을 만들지 않는다 |
| density | `0 \| 1 \| 2 \| 3` | P0~P3(`snapshot-3d.md` 4.1.1). 상자 폭 = P0 200 / P1 `A` / P2 84 / P3 64px |
| onNameClick / onNameDoubleClick | () => void | 그 판만 필터 / `namespace.yaml`로 이동 |

- 상자는 **아래쪽 끝 기준**으로 위로 쌓는다(줄 간 4px). 1줄 이름 captionStrong 12/16, 2줄 caption 11/14 `text.tertiary`, 3줄 알약 20px.
- 배경은 각 줄의 halo(`viz.label.bg`)만 쓰고 상자 전체에 판을 깔지 않는다(블록 라벨과 같은 규칙).
- 캔버스 안이라 **탭 정지점이 아니다**. 같은 정보·같은 동작이 관계 표 판 그룹 행(16.8)에 버튼으로 있다.

### 16.12 `KindIcon` (2026-09-20 추가)

쿠버네티스 **종류 이름 → lucide 아이콘** 매핑을 담는 곳. 표 원본은 `snapshot-3d.md` 4.10이고, **코드에서는 이 컴포넌트 한 곳에만** 둔다(프론트·퍼블리셔가 각자 표를 갖지 않게).

| prop | 타입 | 설명 |
|---|---|---|
| kind | `string \| null` | `blocks[].kind` 원문(`Deployment`). `null`이면 `box` |
| custom | `boolean?` | `blocks[].custom`. true면 `kind`와 무관하게 `shapes` |
| plate | `"namespace" \| "cluster" \| "unparsed" \| "ghost"?` | 판 아이콘이 필요할 때. `folder` / `globe` / `file-warning` / `circle-dashed` |
| size | `12 \| 14 \| 16` | 기본 14. **블록·묶음 블록 오버레이 12**(2026-09-20 (5): 윗면 16px 폐지 — `snapshot-3d.md` 4.3), 패널·표 14, 범례 12 |
| color | `string?` | 기본 `text.secondary`. (`viz.kind.*.onFill`을 쓰던 윗면 자리는 없어졌다) |

- 매핑(4.10 요약): `Deployment` `boxes` · `StatefulSet` `database` · `DaemonSet` `grid-2x2` · `CronJob` `timer` · `Job` `briefcase` · `ReplicaSet` `copy` · `Pod` `box` · `Service` `network` · `Ingress` `door-open` · `PersistentVolumeClaim`/`PersistentVolume` `hard-drive` · `ConfigMap` `settings-2` · `Secret` `key-round` · `HorizontalPodAutoscaler` `trending-up` · `PodDisruptionBudget` `life-buoy` · `NetworkPolicy` `shield` · `ServiceAccount` `user-round` · `Role`/`ClusterRole` `scroll-text` · `RoleBinding`/`ClusterRoleBinding` `link` · `ResourceQuota` `gauge` · `LimitRange` `ruler` · `CustomResourceDefinition` `shapes` · 그 밖 `box`.
- **모르는 종류에도 빈 자리를 두지 않는다**(`box`). 항상 `aria-hidden="true"`(종류 이름이 옆에 글자로 있다).
- 2단계(AWS 구성도)에서 같은 컴포넌트에 AWS 리소스 타입 매핑을 더한다. 그래서 prop 이름을 `kind`(k8s 용어 아님)로 두었다.

**`kindShape()` — 종류 → 3D 블록 모양 (2026-09-20 (8) 추가, `snapshot-3d.md` 4.11.2)**

```ts
type VizShape = "box" | "stack" | "cylinder" | "panel" | "roof" | "chamfer" | "gate" | "diamond" | "tile";
export function kindShape(kind: string | null, opts?: { custom?: boolean; layer?: VizLayer }): VizShape;
```

- 매핑: `Deployment` `stack` · `StatefulSet` `cylinder` · `DaemonSet` `panel` · `CronJob` `roof` · `Job` `chamfer` · `Service` `diamond` · `Ingress` `gate` · `PersistentVolumeClaim`/`PersistentVolume` `cylinder` · `ConfigMap` `panel` · `Secret` `chamfer` · **`layer === "aux"`이면 종류와 무관하게 `tile`** · 그 밖(`Pod`·`ReplicaSet`·모르는 종류·곁이 아닌 층의 사용자 지정) `box`.
- **아이콘 매핑(`KindIcon`)과 한 파일에 둔다.** 표가 둘로 갈리면 "아이콘은 Job인데 모양은 CronJob" 같은 어긋남이 생긴다. 쓰는 쪽은 둘이다 — 프론트의 3D 지오메트리(`apps/web/src/features/.../graph`)와 퍼블리셔의 `ShapeSwatch`.
- `layer`는 **서버가 주는 값**을 그대로 넘긴다(화면이 종류 → 층 표를 따로 갖지 않는다는 규칙과 같다).

### 16.13 `ShapeSwatch` (2026-09-20 (8) 추가)

3D 블록 모양의 **2D 실루엣 견본**. 쓰는 자리는 두 곳뿐이다 — 범례의 「모양 = 종류」 절(16.5)과 종류 필터 옵션(16.2).

| prop | 타입 | 설명 |
|---|---|---|
| shape | `VizShape` | `kindShape()`의 결과 |
| size | `14 \| 16` | 14 = 종류 필터 옵션, 16 = 범례 |
| tone | `"neutral" \| "layer"` | `neutral`(기본, 범례): 면 `bg.canvas` + 윤곽 1px `border.strong` + 윗면 경계선 1px `border.default`. `layer`(종류 필터): 면 `viz.kind.<layer>.fill` + 윤곽 1px `viz.kind.<layer>.edge` |
| layer | `VizLayer?` | `tone="layer"`일 때만 |

- 실루엣은 **기본 시점(방위 −35°·고도 30°)에서 본 윤곽**을 고정 path로 그린다(SVG). 장면에서 보는 각도와 같아야 대조가 된다. 밝기 3단은 쓰지 않고 **윤곽 + 윗면 경계선 1개**만 그린다(14~16px에서 3단은 뭉갠다).
- `aria-hidden="true"` — 견본 옆에 언제나 종류 문구가 글자로 있다.
- 모양 정의(치수·비율)는 `snapshot-3d.md` 4.11.1 표가 원본이다. 견본은 그 비율을 따르되 픽셀 격자에 맞춰 반올림한다.

---

## 17. 기존 컴포넌트 확장 (`snapshot-3d`에서 필요)

### 17.1 `DataTable`
- `rowIndent?: number | ((row) => number)` — 행 첫 열 왼쪽에 `16px × rowIndent` 들여쓰기. 트리 모양 표(관계 표)는 행마다 깊이가 달라 **함수 형태**를 쓴다(2026-09-20 publisher 구현 반영). `groupRow`와 함께 쓸 수 있다.
- 행 `aria-level` / `aria-expanded`를 넘길 수 있게 `rowAria?: { level?: number; expanded?: boolean }`.

### 17.2 `Tabs`
- props 변경 없음. Kubernetes 스냅샷 상세 탭이 5개 → **6개**가 된다(`3d`, 라벨 `3D 보기`, 아이콘·숫자 없음).

### 17.3 `Chip`
- props 변경 없음. 층 색 사각(12px, `viz.kind.*.fill` + 1px `edge`)은 Chip이 아니라 호출 측이 그리는 단순 `<span>`이다.

### 17.4 `SegmentedControl` (2026-09-20 publisher 구현 반영)
- 옵션에 `icon?: IconName`, `tooltip?: string`, `disabledReason?: string` 추가. `disabledReason`이 있으면 그 칸은 `aria-disabled`(포커스는 받는다) + 사유 툴팁 — 3D를 쓸 수 없는 브라우저의 `3D` 칸(`snapshot-3d.md` 9.3)이 이 경우다.
- `orientation?: "horizontal" | "vertical"`(기본 `horizontal`). `vertical`은 카메라 오버레이의 시점 3칸(폭 88px, 16.3)에 쓴다. 세로일 때 칸 높이 28px, 구분선은 칸 사이 가로 1px `border.subtle`.

### 17.5 `Switch` (2026-09-20 publisher 구현 반영)
- `disabledReason?: string` 추가. 값이 있으면 `aria-disabled`(포커스 가능) + 사유 툴팁이고, 실제 `disabled` 속성을 쓰지 않는다 — 드리프트 겹쳐 보기·주변만 보기 스위치는 **왜 못 쓰는지**가 화면의 핵심 정보라 키보드로도 사유에 닿아야 한다(`snapshot-3d.md` 6.2·10.2).

### 17.6 `InlineAlert` (2026-09-20 추가)
- `closable` / `onClose` / `closeLabel`(6.2). 3D 보기에서 닫을 수 있는 알림은 **저사양 권고(9.5)와 캔버스 위 잘림 알림(9.9)** 둘뿐이다. 구성 변경(9.8)·WebGL 없음(9.3)·관계 표의 잘림 안내는 닫기를 주지 않는다.
- `Banner`의 `dismissible`/`onDismiss`와 이름을 `closable`/`onClose`로 **통일**하되, `Banner`는 옛 이름을 당분간 함께 받는다(6.2 마지막 항목의 하위 호환 규칙).

### 17.7 `Popover` (2026-09-20 추가)
- 범례(16.5)가 도구 막대 B 버튼에 붙는 팝오버가 되면서 필요한 것: `align?: "start" | "end"`(기본 `start`. 범례는 `end` = 오른쪽 정렬), `maxHeight?: number | string`(넘치면 안쪽 스크롤). 나머지 동작(`Esc`·바깥 클릭 닫힘, 닫으면 여는 버튼으로 포커스 복귀)은 기존 그대로.
