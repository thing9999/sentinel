# aws-cost · frontend 작업 보고

> 파일 위치: `docs/reports/aws-cost/frontend.md`
> 공통(셸·단일 스트림·차트 라이브러리 선택·검증 방법)은 `docs/reports/cluster-status/frontend.md`.

## 2026-09-19 12:50 · 5a 프론트 통합 (비용 화면 `/cost`)

### 1. 요청 내용
- PM 5a 중 aws-cost: 추정/확정/예측 구분 표시, 스팟 시세 실패 라벨, CE 수동 새로고침(다음 가능 시각, 429 처리), 예산 상태 표시(편집 화면은 범위 밖), 차트(시간당 소모율, 일별 확정 막대 + 월말 예측). 금액·상태·합계는 서버 값 그대로.

### 2. 참고한 문서
- `docs/specs/aws-cost.md`(3·4·5절), `docs/design/aws-cost.md`, `docs/design/status.md` 3·4.9·8.2, `docs/api/aws-cost.md`, `docs/api/common.md` 1.7·3.1
- `docs/reports/aws-cost/{publisher,designer,backend}.md`(4단계 B 구현 포함)

### 3. 작업 내용
- 데이터: `cost` 토픽(`cost.snapshot` = summary·estimate·allocation·actual·status·refresh, 이후 `cost.*.updated`로 블록 교체). 소모율 추이만 REST `GET /api/cost/rate-series?range=` + 스트림 `cost.rate.sampled` 점을 끝에 붙임(같은 5분 해상도일 때만).
- 화면 구성(`features/aws-cost/`):
  - `CostPage`: PageHeader(`계산 방법`, `이 추정에 포함되지 않는 것` Drawer) → CostStatusBanner(warn/crit/unknown일 때만, 이유 최대 2개 + `외 N건`, 급증이면 `원인 보기` 앵커) → KPI 타일 → 실시간 추정 섹션(`Section kind="estimate"` 점선 세로선) → 네임스페이스 배분 → 확정 비용(CE) → 데이터 출처·호출 정보(접힘).
  - `CostKpis`: 타일 1 추정 시간당(≈, dashed, `$/일·$/월`, 조회 시각, 경고 칩 단가 없음·스팟 시세 실패·클러스터 외·단가 캐시, 최대 2 + `외 N`), 타일 2 확정 누적(`N월 N일까지 반영 · 최대 24시간 지연`, 지난달 같은 기간, `계정 전체 기준`), 타일 3 AWS 예측(80% 구간, 추정 월말 + 추정 배지) / 예측 불가 시 추정 월말 변형(`AWS 예측 불가 (사유)` 칩, 방식 문구), 타일 4 예산(BudgetGauge, `초과` 문구, `추정 기준` caption, 미설정이면 타일 없음 → 4열), 타일 5 급증(실시간[추정]·일별[확정] 두 줄, 기준 수집 중 칩, CE 없음 문구).
  - `CostCharts`: 소모율 추이(추정 점선 `6 3`, 7일 중앙값 기준선, 주의·급증 임계선, 기간 24시간/7일/30일/90일, 기준 수집 중 칩, 툴팁 `≈` + 추정 배지), 이번 달 누적·월말 예측(확정 실선, AWS 예측 점선 + 80% 띠 + 말일 원, 추정 월말 마름모 또는 점선, 예산선·90%선, 오늘 선), 일별 30일(합계|서비스별 누적 상위 7 + 기타, 미확정 흐리게 + 빗금 + `미확정`, 급증 아이콘, 7일 평균선).
  - `CostTables`: 카테고리 구성(구성비 막대 + 5행 + 서버 합계), 급증 원인(추가/변경/삭제 칩, 시간당 영향 부호), 리소스 내역(카테고리 그룹 행, 금액 1위·단가 없음 카테고리 기본 펼침, 단가 없음 행 warn 막대·맨 아래·`단가 없음 · 합계 제외`, 스팟 단가 셀 `스팟 시세 · AZ · HH:mm`, 시세 실패는 서버 note `스팟 시세 조회 실패 (온디맨드 기준 상한)` 칩, 서버 합계 + `일부 리소스 제외 (N개)`, 단가 출처·스팟 시세·클러스터 외 footer), 네임스페이스 배분(열 머리글 `[추정]`, 고정 행 미할당·공용(클러스터)·공용 + 툴팁, 서버 합계, requests 미설정 경고, 미할당 ≥ `unallocatedWarnPct`면 R-UNALLOC 링크 칩), 서비스별(상위 10 + 기타 고정 + 서버 합계, 증감 화살표·색 없음, 급증 배지, 급증 서비스 InlineAlert).
  - `CeRefresh`: 버튼 활성·사유는 서버 `canRefresh`·`disabledReason`·`nextAvailableAt`(cooldown `HH:mm 이후 가능 (마지막 호출 후 1시간)`, daily_limit `오늘 호출 한도 도달 (N/M회) · 캐시 사용 중`, mock `MOCK 모드: AWS를 호출하지 않습니다`, in_progress `조회 중`), 확인 Dialog, `POST /api/cost/explorer/refresh` 202 → 응답 refresh를 스트림 `cost.refresh.updated`가 올 때까지 사용, 429 `CE_REFRESH_COOLDOWN`/`CE_DAILY_LIMIT_REACHED`는 서버 메시지 + details의 다음 가능·초기화 시각, 409·503은 서버 메시지.
  - `help.tsx`: 명세 3.1 표·3.2 규칙 1~7·3.8 목록 6개를 문장 그대로.
- stale: 추정 15분(출처 awsResources·pricing·spotPrice 또는 `estimate.asOf`), 확정 18시간(costExplorer 또는 `actual.asOf`) → 타일 stale 칩·값 회색, 차트 stale 칩.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/aws-cost/types.ts` | 추가 | 계약 타입 |
| `apps/web/src/features/aws-cost/{CostPage,CostKpis,CostCharts,CostTables,CeRefresh,help}.tsx` | 추가 | 비용 화면 |
| `apps/web/src/app/cost/page.tsx` | 수정 | 연결 |
| `apps/web/src/charts/{DailyBarChart,MonthProjectionChart,TimeSeriesChart}.tsx` | 추가 | 공통 보고서 참고 |

### 5. 주요 결정과 이유
- **계산 없음**: 합계·비율·월 환산·예산 %·예측 합산은 모두 서버 값. 예외로 표시만 위한 값: 막대 길이의 나머지(100 − 비율), 예산 게이지 경과 일 `ceil(daysElapsed)/daysInMonth`(라벨), BudgetGauge 내부 비율(퍼블리셔 컴포넌트).
- **CE 확인 Dialog 문구 변경**: 디자인 `호출 약 4회 · 약 $0.04가 청구됩니다`는 호출 수 × 단가 곱셈이 필요 → 금액 계산 금지 규칙과 충돌. `호출 약 N회 · 호출당 $0.01가 청구됩니다. 오늘 N/M회 사용.`으로 서버 값만 표시(디자인 확인 필요).
- **리소스 내역 열 통일**: DataTable이 열 집합 1개라 카테고리별 열 대신 `리소스 · 유형 · 구매 옵션·연결 · 단가 · 시간당[추정] · 월 환산[추정] · 비고`로 합침(각 카테고리 정보는 해당 칸에 표시).
- **`summary.monthEnd.estimated` null 처리**: 계약은 객체지만 B 구현 보고(8절)대로 null 가능 → 타일 3·예산·차트에서 방어.
- 네임스페이스 배분 `hideSystem` 스위치는 두지 않음(디자인에 없음, 스냅샷은 기본값).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| lint / typecheck / test / build | 통과 | 공통 보고서 |
| 페이지 렌더 테스트 3개 | 통과 | 추정·확정·AWS 예측 배지, 반영 기준일 문구, 스팟 시세 실패·단가 없음 라벨, mock 새로고침 비활성 사유, 도움말 버튼, 서버 합계, 급증 원인 / CE 사용 불가 시 확정만 unknown·추정 유지 / 예산 미설정 시 타일 없음 |
| 실제 api(mock) + next start 스크린샷 1440px | 통과 | KPI·추이·구성·내역·배분·누적 예측·일별·서비스별 모두 실데이터 렌더, 콘솔 오류 0 |
| 360px | 가로 스크롤 | 1024px 미만 비지원(shell.md) |
| CE 실제 호출·429 | 미확인 | mock은 `disabledReason: mock`이라 버튼 비활성. 429 처리는 코드만(5b) |

### 7. 남은 이슈·한계
- 429·409 응답 처리와 `cost.refresh.updated` 반영은 live CE가 있어야 확인 가능(5b).
- 추정 금액 `≈`는 MoneyValue가 붙임. 표 셀 단위는 열 머리글에 없어서 셀에 `/h`·`/월`이 생략됨(디자인 3.2: 머리글에 단위가 있으면 생략) → 머리글 문구 `시간당`·`월 환산`으로 단위를 대신함.
- 소모율 30일·90일 범위는 REST 값만(스트림 5분 표본은 해상도가 달라 붙이지 않음).

### 8. 다른 담당 요청
- `디자이너 요청`: CE 확인 Dialog 문구(총 청구 추정 금액 대신 `호출당 $0.01`) 확인.
- `백엔드 요청(계약)`: `summary.monthEnd.estimated` null 가능, `estimate.stale` 추가를 `docs/api/aws-cost.md`에 반영.

### 9. 다음 담당이 알아야 할 점
- 스트림 없이도 REST만으로 같은 모양이 필요하면 `GET /api/cost/summary|estimate|allocation|actual|status|explorer/refresh`를 합치면 `cost.snapshot`과 같다(현재 화면은 스냅샷만 사용).

#### 수용 기준 (프론트 몫) — `docs/specs/aws-cost.md` 5절
| 기준 | 판정 | 근거 |
|---|---|---|
| mock에서 추정·내역·배분·확정 누적·서비스별·일별·월말 예측·예산·급증 표시 + MOCK 배지 | 충족 | 실제 api(mock) 화면 확인 |
| 예산·급증·예측 불가·CE 불가·단가 없음 재현(시나리오 전환) | 충족(UI) | MOCK 배지 Popover `비용` 그룹, `/dev/mock`. 전환 후 각 화면 모습은 테스트로 일부 확인 |
| mock에서 AWS 호출 없음 | 해당 없음(서버) | 브라우저는 AWS를 부르지 않음 |
| 모든 금액에 추정/확정/AWS 예측 라벨 | 충족 | 타일·섹션·열 머리글·툴팁 배지. 어드바이저 절감액은 추정/LLM 추정 |
| 추정 금액 `≈` + 다른 시각 처리 | 충족 | ≈, dashed 테두리·세로선, 점선 |
| 확정에 `N월 N일까지 반영, 최대 24시간 지연` | 충족 | 타일 2, 섹션 보조 줄 |
| 도움말에 3.8 항목 전부 | 충족 | `help.tsx` 6개 |
| 노드 추가 → 5분 안 반영 | 충족(화면 몫) | `cost.estimate.updated` 즉시 반영 |
| 단가 없음 표시 + 합계 옆 `일부 리소스 제외` | 충족 | 행 칩·합계 칩(테스트) |
| 스팟 시세 + 조회 시각 / 실패 라벨 | 충족 | 단가 셀 `스팟 시세 · AZ · HH:mm`, 실패 칩(테스트) |
| 배분 합계 = 추정 합계 | 충족(서버 값) | 두 표 모두 서버 합계 그대로 |
| requests 미설정 경고 | 충족 | 배분 경고 칩 |
| CE 캐시·재호출 없음 | 해당 없음(서버) | 탭 수와 무관(브라우저 호출 없음) |
| 마지막 호출 1시간 미만 → 버튼 비활성 + 다음 가능 시각 | 충족(코드) / live 미확인 | `disabledReason: cooldown` 문구·429 처리 |
| 예산 주의·초과 표시 | 충족(서버 판단) | `초과` 문구 |
| 예산 미설정 → 숨김·오류 없음 | 충족 | 테스트 |
| 예측 불가 → 추정 월말·`추정 기준` | 충족 | 타일 3 변형, 예산 `추정 기준` caption, 서버 이유 문장 |
| CE 권한 없음 → 확정·예측만 알 수 없음 | 충족 | 테스트 |
| 급증 판단·원인 목록·기준 수집 중 | 충족(표시) | 원인 카드, 기준 수집 중 칩 |
