# aws-cost · publisher 작업 보고

> 파일 위치: `docs/reports/aws-cost/publisher.md`
> 공통 작업(토큰·셸·공통 컴포넌트·검증 전체)은 `docs/reports/cluster-status/publisher.md`. 이 파일은 비용 화면에서 쓰는 금액 컴포넌트 부분만 적는다.

## 2026-09-19 11:55 · 4단계 퍼블리싱 (금액 컴포넌트)

### 1. 요청 내용
- PM 요청(4단계 퍼블리싱) 중 aws-cost 관련: components.md 3절 금액 컴포넌트, status.md 3절(추정/확정/예측 시각 언어, 금액 표기, 예산 게이지) 구현.

### 2. 참고한 문서
- `docs/design/aws-cost.md`, `docs/design/status.md` 3절·4.9·8.2, `docs/design/components.md` 3절, `docs/design/tokens.json`(`color.*.cost`, `border.style`, `chart.hatch`)
- `docs/api/common.md`(MoneyKind)

### 3. 작업 내용
- `components/ui/cost/`: `MoneyValue`, `RangeValue`, `CostKindBadge`, `MetricTile`, `BudgetGauge` + `cost.module.css`.
- `components/ui/format.ts`: `formatMoney`, `formatMoneyRange`, `formatPercent` (status.md 3.2 표 전체를 테스트로 확인).
- `Section kind="estimate"`: 추정 섹션 왼쪽 3px dashed 세로선 + 내용 왼쪽 16px (aws-cost.md 2.4).
- `ChartFrame kind="estimate"`, `ChartLegend dashed/hatched` 스와치: 비용 차트 카드·범례 틀.
- `api-map.ts`: `costKindFromApi()`, `projectedKindFromBasis()`.

금액 시각 언어 구현 요약:
| 구분 | 기호 | 배지 | 테두리 |
|---|---|---|---|
| 추정 `estimate` | `≈ `(cost.estimate.fg, 숫자 본체 text.primary, 기울임 없음) + 스크린리더 `추정 약` | `추정`(calculator, dashed) | MetricTile·Card dashed `cost.estimate.border` |
| 확정 `confirmed` | 없음 | `확정`(receipt) | `border.subtle` |
| AWS 예측 `forecast` | 없음 | `AWS 예측`(trending-up) | solid `cost.forecast.border` |
| LLM 추정 `llmEstimate` | `≈ ` | `LLM 추정`(sparkles, dashed) | 추정과 같음 |

- 추정 금액 툴팁(필수) `공시 단가 기준, 할인·데이터 전송비 미포함 · 13:05 조회`는 `asOf`를 주면 자동으로 붙는다.
- 확정 `settledThrough`(ISO 날짜 또는 `9월 17일`) → `9월 17일까지 반영 · 최대 24시간 지연`.
- 예측 `range` → 아래 줄 `80% 구간 $790 – $900`.
- stale 타일: estimate의 dashed는 유지하고 테두리 색만 `status.stale.border` + `데이터 오래됨 · HH:mm 기준` 칩, 값은 `status.stale.valueText` (aws-cost.md 3절 마지막 문단).
- BudgetGauge: 눈금 최대 = max(예산×1.2, 예측 상한, 예측), 확정 누적 실색, 누적→예측 45° 빗금(`chart.hatch` 토큰), 예측 구간 2px 선, 90%·100% 표시선(라벨이 겹치지 않게 90%는 선 왼쪽, 예산은 오른쪽), 범례, 요약 줄. 스크린리더에는 요약 한 문장(role=img).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/components/ui/cost/{MoneyValue,CostKindBadge,MetricTile,BudgetGauge}.tsx`, `cost.module.css` | 추가 | 금액 컴포넌트 |
| `apps/web/src/components/ui/format.ts` | 추가 | 금액·% 표기 (공통) |
| `apps/web/src/components/ui/api-map.ts` | 추가 | MoneyKind 변환 (공통) |

### 5. 주요 결정과 이유
- **금액 컴포넌트는 디자인 키(`CostKind`)를 받는다.** API `estimated/actual/forecast`는 프론트가 `costKindFromApi()`로 바꾼다(status.md 8.2). 모르는 kind는 null → 금액을 `—`로 표시하도록 프론트가 `amount={null}`을 넘긴다.
- **합계는 계산하지 않는다.** DataTable `totalRow`에 서버 합계를 그대로 넣는다.
- **MetricTile 높이 `min-height: 136px`**: 타일 1(값 + 보조 줄 3 + 경고 칩)이 136px 고정에 들어가지 않아서.
- **표에서는 셀마다 배지를 달지 않는다**: `Column.headerBadge`에 `<CostKindBadge kind="estimate" />`, 셀은 `MoneyValue size="sm" showUnit={false}`.
- 월 단위 `$10 미만 2자리 / 이상 0자리`, `<$0.01/h`, `−`(U+2212), en dash 범위는 `format.ts`가 처리한다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm test --prefix apps/web` | 통과 | format 테스트(금액·%) + MoneyValue/CostKindBadge/MetricTile 렌더 테스트 |
| lint / typecheck / build | 통과 | 공통 보고서 참고 |
| 360~1440px 가로 넘침 | 통과 | 미리보기의 KPI 타일·BudgetGauge 포함 |

### 7. 남은 이슈·한계
- 비용 차트 3종(소모율 추이, 일별 막대, 누적·예측)은 frontend `charts/` 몫. 틀(`ChartFrame`)과 범례(`ChartLegend` dashed/hatched)만 제공.
- `CostStatusBanner`는 별도 컴포넌트를 만들지 않았다. `Banner tone=warn|crit|neutral` + `StatusBadge label="초과"|"급증"` + `ReasonText` 조합으로 만든다.
- 리소스 내역 카테고리 그룹 표는 `DataTable groupRow` + `rowAccent`(단가 없음 행 warn 막대)로 구성해야 하며, 실제 데이터로는 아직 확인하지 않았다.

### 8. 다른 담당 요청
- `frontend 요청`: KPI 타일 조합 예 — 타일 1 `<MetricTile kind="estimate" badge={<CostKindBadge kind="estimate"/>} value={<MoneyValue amount={x} kind="estimate" unit="hour" size="xl" asOf={t}/>} lines=[…] footer={<Chip tone="warn" …/>}/>`. 예산 미설정이면 `state="hidden"`.
- `frontend 요청`: CE 새로고침 버튼은 `Button variant="secondary" size="sm" icon="refresh-cw" disabled disabledReason="14:05 이후 가능 (마지막 호출 후 1시간)"`, 확인은 `Dialog size="sm"`.

### 9. 다음 담당이 알아야 할 점
| 컴포넌트 | props | 프론트가 넘길 값 |
|---|---|---|
| `MoneyValue` | `amount: number\|null`, `kind: CostKind`, `unit: "hour"\|"day"\|"month"\|"total"\|"unitPrice"\|"gbMonth"`, `delta?`, `size?: "sm"\|"md"\|"lg"\|"xl"`, `showBadge?`, `badgeDetail?`, `asOf?`, `settledThrough?`, `range?: {low; high; confidence}`, `unknownReason?`, `showUnit?`, `stale?`, `loading?`, `tooltip?` | `kind` = `costKindFromApi(api.kind)`; 금액은 서버 값 그대로 |
| `RangeValue` | `low`, `high`, `confidence`(0.8), `kind?`, `unit?` | 서버 예측 구간 |
| `CostKindBadge` | `kind`, `detail?` | 섹션 머리·열 머리글·타일 |
| `MetricTile` | `label`, `value`, `kind?: CostKind\|"plain"`, `badge?`, `lines?`, `status?`, `footer?`, `state?: "ready"\|"loading"\|"unknown"\|"hidden"`, `unknownReason?`, `staleAt?`, `staleFormat?`, `href?` | CE 사용 불가: `state="unknown" unknownReason="Cost Explorer 사용 불가: AccessDenied"` |
| `BudgetGauge` | `budget`, `confirmed`, `projected`, `projectedKind: "forecast"\|"estimate"`, `projectedRange?`, `warnRatio?`, `elapsedRatio`, `elapsedLabel` | `projectedKind = projectedKindFromBasis(projectedBasis)` |
| `Section` | `kind="estimate"`로 추정 섹션 세로선 | 실시간 추정, 네임스페이스 배분 섹션 |
| `ChartFrame` | `kind="estimate"`, `legend` (`dashed`: 추정·예측 선, `hatched`: 미확정 막대), `plotChips`(`기준 수집 중`) | |
