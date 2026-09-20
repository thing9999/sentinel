# cluster-status · designer 작업 보고

> 파일 위치: `docs/reports/cluster-status/designer.md`
> 세 기능(`cluster-status`, `aws-cost`, `architecture-advisor`) 공통 작업(토큰·상태 규칙·셸·컴포넌트)은 이 보고서에 적는다. 기능별 화면 보고는 [aws-cost/designer.md](../aws-cost/designer.md), [architecture-advisor/designer.md](../architecture-advisor/designer.md).

## 2026-09-19 · 2단계 디자인 (공통 토큰·셸·컴포넌트 + cluster-status 화면)

### 1. 요청 내용
- PM이 2단계(디자인)로 기능 3개의 화면 설계를 요청.
- 산출물: `tokens.json`(라이트/다크, 비용 추정·확정 구분 색, 어드바이저 심각도·카테고리 색), `status.md`(4단계 + stale, 차트, 비용 차트·금액 표기), 기능별 화면 문서 3개, `components.md`(세 기능 공통 컴포넌트 props), 앱 공통 셸.
- 추가 결정 반영: 스팟 노드는 실제 스팟 시세로 추정, 어드바이저 스냅샷의 리소스 이름은 원문 전송.

### 2. 참고한 문서
- `CLAUDE.md` (확정된 결정, 보고서 규칙)
- `docs/specs/cluster-status.md`, `docs/specs/aws-cost.md`, `docs/specs/architecture-advisor.md`
- `docs/reports/{cluster-status,aws-cost,architecture-advisor}/planner.md`
- `docs/reports/bootstrap/frontend.md` (라우트 뼈대 `/`, `/cluster`, `/cost`, `/advisor`, 클래스 `app-header/app-nav/app-main`, `useEventSource` 상태 `connecting|open|disconnected`, Tailwind 없음)
- `docs/HANDOFF.md`

### 3. 작업 내용
1. **토큰(`tokens.json`)**: color(light/dark 같은 키), spacing(4px 단위 13단계), radius(0/2/4/6/8/12/pill), typography(sans·mono, display~micro, metricLg/Md/Sm, code, resourceName), shadow(light/dark, focus 링). 색 그룹: bg, border, text, accent, danger, status(ok/warn/crit/unknown/stale 각 fg·bg·border·solid·onSolid), info, connection(끊김 배너), mode(MOCK·예시 응답), cost(estimate/confirmed/forecast/unsettled/예산선), advisor(severity/category/source/noExecute), chart(격자·축·임계선·시리즈 8색), code, skeleton.
   - 요청된 5개 범주 외에 size, border, chart, opacity, zIndex, motion, breakpoint 그룹을 추가하고 각 그룹에 `$reason`으로 기존 토큰으로 안 되는 이유를 적었다.
   - 대비: 본문 글자 4.5:1, 그래픽(선·막대) 3:1 기준으로 골랐다. 라이트 warn.solid를 #BF8C00(흰 배경 약 3.0:1)으로 어둡게, 임계선용 warn은 #B7860B로 분리.
2. **상태·차트·표 규칙(`status.md`)**: 상태별 문구·lucide 아이콘·모양(원/삼각형/팔각형/물음표/시계)·색, 배지 3크기·3변형, 허용 대체 문구(초과·급증·브리지 상태 등), 중립 보조 칩 목록, 판단 이유 표시, 정렬 순서(crit→warn→unknown→stale→ok), 상태 악화 강조. stale 판정(갱신 주기×3)과 표시, 전역 연결 상태 5종과 끊김 배너(빨강·노랑 금지, 5000ms 지연 표시), MOCK 배지. 비용 추정/확정/AWS 예측/LLM 추정 시각 언어, USD 금액 표기표, 예산 게이지. 차트 크기·선·축·임계선·툴팁·단위(CPU millicore, 메모리 MiB/GiB 1024 기준)·관측 구간, 비용 차트 3종(소모율 추이, 일별 확정 막대+미확정 빗금, 월 누적+예측 구간+예산선). 표 치수·기본 정렬(11개 표)·긴 파드 이름 가운데 말줄임(끝 16자 보존)·가상 스크롤. 시간 표기, 접근성 최소 기준.
3. **셸(`shell.md`)**: TopBar 56px, SideNav 232/64px(상태 아이콘 포함), 끊김 배너 40px, 본문 패딩 24px·최대 1600px, 반응형 4구간(≥1440 / 1280~1439 / 1024~1279 / <1024 비지원), 전역 상태별 셸 모습.
4. **컴포넌트(`components.md`)**: 셸 7개, 상태 8개, 금액 5개, 버튼·입력 8개, 오버레이 5개, 알림·빈 상태 7개, 표 4개, 구조 8개(Stepper, CodeBlock, JsonTree 포함), 차트 6개(프론트 영역), 어드바이저 전용 10개. props 타입, variant·size·state, 치수. 아이콘 목록.
5. **cluster-status 화면(`cluster-status.md`)**: 화면 8개(개요, 노드 목록·상세, 워크로드 목록, 파드 목록·상세, 이벤트, DB 상세). 개요는 SummaryStrip(88px) → 영역 카드 5개(176px, 순서 고정, crit는 solid 배지·빨강 테두리) → "지금 확인할 항목"(crit·warn 최대 8행) → CPU·메모리 → 비용·어드바이저 요약 카드. 목록별 열 폭·필터·정렬, 상세 레이아웃, 화면별 로딩/빈/끊김/클러스터 연결 없음/API 오류/mock 모습.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/design/tokens.json` | 추가 | 디자인 토큰 단일 출처 (라이트/다크) |
| `docs/design/status.md` | 추가 | 상태·stale·연결·비용 표기·차트·표·시간·접근성 규칙 |
| `docs/design/shell.md` | 추가 | 앱 공통 셸 |
| `docs/design/components.md` | 추가 | 공통 컴포넌트 목록과 props |
| `docs/design/cluster-status.md` | 추가 | cluster-status 화면 설계 |
| `docs/design/aws-cost.md` | 추가 | aws-cost 화면 설계 (보고: aws-cost/designer.md) |
| `docs/design/architecture-advisor.md` | 추가 | 어드바이저 화면 설계 (보고: architecture-advisor/designer.md) |
| `docs/reports/cluster-status/designer.md` | 추가 | 이 보고서 |
| `docs/reports/aws-cost/designer.md` | 추가 | 기능 보고서 |
| `docs/reports/architecture-advisor/designer.md` | 추가 | 기능 보고서 |

### 5. 주요 결정과 이유
- **셸 파일을 따로 둠(`shell.md`)** / 대안: components.md에 포함 / 이유: 레이아웃·반응형·전역 상태는 컴포넌트 props와 성격이 달라 프론트(레이아웃)와 퍼블리셔(컴포넌트)가 각각 찾기 쉽게.
- **stale과 연결 끊김은 회색 계열 + 점선 + 시계 아이콘, 배너는 짙은 슬레이트** / 이유: 명세 S4 "끊김을 장애로 오인하지 않게". 빨강·노랑을 쓰지 않는다.
- **stale을 unknown과 다른 상태로 분리**(모양: 시계, 점선 테두리) / 이유: unknown은 "출처 없음", stale은 "값은 있으나 오래됨"이라 조치가 다르다.
- **개요 카드 순서 고정, 강조로 우선순위** / 대안: 나쁜 카드 먼저 재정렬 / 이유: 위치가 바뀌면 아침 점검(S1)에서 매번 다시 찾아야 한다. 대신 "지금 확인할 항목" 목록이 나쁜 것 먼저 보여준다.
- **워크로드 상세 화면을 두지 않음** / 이유: 명세가 요구한 상세는 파드·노드·DB. 파드 → 워크로드 이동은 목록 `?focus=`로 해당 행 펼침.
- **CPU는 1,000m 이상도 millicore 유지**(툴팁만 코어 병기) / 이유: 역할 지시(CPU는 millicore), 표 안에서 단위가 섞이면 비교가 어렵다.
- **긴 파드 이름은 가운데 말줄임 + 끝 16자 보존 + mono** / 이유: 파드 이름의 앞(워크로드)과 끝(해시)이 모두 식별에 필요.
- **상태 색은 차트 시리즈 색으로 쓰지 않음** / 이유: 임계선과 혼동 방지.
- **아이콘 lucide 지정** / 이유: 모양으로 상태 구분하려면 아이콘이 확정돼야 함. 패키지 설치는 프론트 결정.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| tokens.json 문법 | 부분 확인 | 실행 도구(Node/Bash)가 없어 JSON 파서로 돌리지 못함. 정규식으로 후행 쉼표 0건, 줄 끝 누락 쉼표 0건 확인. 퍼블리셔가 불러올 때 파싱 확인 필요 |
| 색 대비 | 수동 계산 | 주요 조합(status fg on bg, text.tertiary on surface, 임계선 on surface)을 상대 휘도로 계산. 모든 조합을 도구로 검사하지는 않음 |
| 명세 대조 | 수동 | 각 명세 7절 "디자인" 항목과 수용 기준의 화면 관련 항목(판단 이유 한 줄, MOCK 배지, 끊김 배너, 근사치, 해당 없음, 기준선 점선)을 문서에서 확인 |

### 7. 남은 이슈·한계
- 실제 화면 시안(이미지)은 없다. 치수·색은 모두 문서 수치로만 정의.
- 폰트 Pretendard·JetBrains Mono는 설치·번들 여부 미정. 없으면 시스템 폰트(Segoe UI, Malgun Gothic, Consolas)로 떨어진다.
- 1024px 미만(모바일)은 지원 대상에서 뺐다.
- mock 시나리오 전환 UI(MOCK 배지 Popover)는 백엔드가 전환 API를 제공한다는 가정. 없으면 배지는 표시 전용.
- Watch 기반 데이터의 stale 기준은 SSE heartbeat 주기에 달려 있다(백엔드 계약 전).
- DB 추이 그래프는 명세에 없어 넣지 않았다.

### 8. 다른 담당 요청
- `publisher 요청`: `tokens.json`을 CSS 변수로 변환(`[data-theme]` 전환, `$reason`·`$meta` 키 제외), `components.md` 1~8절·10절 구현. 차트(9절) 제외.
- `frontend 요청`: `lucide-react` 추가 여부 결정(아이콘 이름은 `components.md` 11절). 차트 라이브러리 선택 시 `status.md` 4절(점선 패턴, 빗금 채움, 구간 띠, 결측 끊김)을 지원하는지 확인. 라우트 추가: `/cluster/nodes`, `/cluster/nodes/[name]`, `/cluster/workloads`, `/cluster/pods`, `/cluster/pods/[namespace]/[name]`, `/cluster/events`, `/cluster/db`, `/advisor/runs/[id]`; `/cluster`는 `/`로 이동. `useEventSource` 상태에 `reconnecting`(재시도 횟수)과 API 불가 구분이 필요(`ConnectionIndicator`).
- `backend 요청`(API 계약): 모든 지표에 `status`, `reasons[]`(첫 번째가 대표), `updatedAt`; 상태가 바뀐 시각(`statusChangedAt`, "지금 확인할 항목" 정렬용); SSE heartbeat 주기; 영역별 집계 상태와 사이드바용 요약; 서버 기준 시각(경과 타이머 보정); mock 시나리오 목록·전환 API(선택).

### 9. 다음 담당이 알아야 할 점
- 색·치수는 `tokens.json` 키로만 참조한다. 문서에 적힌 hex는 설명용이며 값이 다르면 `tokens.json`이 우선.
- 상태 문구는 `status.md` 1.1·1.2의 목록 밖 문구를 만들지 않는다. 판단 이유는 서버 문자열을 그대로 쓴다.
- 금액·상태·합계는 화면에서 계산하지 않는다(표시 반올림만). 합계 행은 서버 값.
- LLM 출력은 텍스트로만 렌더(HTML·마크다운 해석 금지).
- 문서 읽는 순서: `shell.md` → `status.md` → `components.md` → 기능별 문서.
