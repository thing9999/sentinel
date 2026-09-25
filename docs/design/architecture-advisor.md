# 화면 설계: architecture-advisor

- 작성: designer, 2026-09-19 / 고침: 2026-09-24 (`kops-support` — 사전 점검 표에 etcd 볼륨 주석·컨트롤 플레인 규칙 이동 경로, 전송 안내 문구. **화면 구조·컴포넌트는 그대로**)
- 명세: `docs/specs/architecture-advisor.md` (결정 반영: 스냅샷의 리소스 이름은 원문 전송 — 가명화 화면 없음. 단 **노드 이름은 가명**, `docs/specs/kops-support.md` 3.7.3)
- 공통: `docs/design/shell.md`, `docs/design/status.md`, `docs/design/components.md` 10절(어드바이저 전용), `docs/design/tokens.json` (`color.*.advisor`)
- 그리드: 12열, gutter 16px.

## 0. 화면 목록

| # | 화면 | 경로 | 비고 |
|---|---|---|---|
| 1 | 어드바이저 | `/advisor` | 브리지 상태·실행 → 진행 → 사전 점검 → 최근 분석 결과 → 이력 |
| 2 | 지난 분석 결과 | `/advisor/runs/[id]` | 이력에서 연 과거 결과(읽기 전용) |
| 3 | 보낼 데이터 보기 | Drawer lg(640px) | 스냅샷 미리보기(JSON 트리) |
| 4 | 분석 취소 확인 | Dialog sm(400px) | |

**화면 어디에도 제안을 적용·실행하는 버튼을 두지 않는다.** 허용되는 동작은 복사, 펼치기, 필터, 링크 이동, 분석 실행·취소, 스냅샷 미리보기뿐이다.

## 1. 정보 우선순위

1. **분석을 지금 돌릴 수 있는가**(브리지 상태) / 진행 중이면 **어디까지 왔나**
2. **사전 점검에서 높음 심각도 항목**(LLM 없이 항상 보이는 결정적 결과)
3. 최근 분석의 **1~3순위 제안**(제목·예상 절감액)
4. 제안 상세(근거·실행 방법·위험도)
5. 이력, 스냅샷 메타

규칙 기반 사전 점검과 LLM 제안은 **섹션을 나누고**, 각 항목에 출처 라벨(`규칙 기반 · R-ID` / `AI 제안`)을 붙여 구분한다.

---

## 2. 어드바이저 `/advisor`

### 2.1 레이아웃 (1440px, 본문 1160px)

```
PageHeader: "어드바이저"   보조 줄: 어드바이저는 제안만 합니다. 클러스터와 AWS에 아무것도 실행하지 않습니다.
┌ BridgeStatusBar (12열, 72px) ────────────────────────────────────────────────────────────┐
│ [● 연결됨] Claude Code 브리지 · 14:02 확인 [다시 확인]         [👁 보낼 데이터 보기] [▶ 분석 실행] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
┌ RunProgressPanel (12열) — 진행 중 / 방금 실패했을 때만 ─────────────────────────────────────┐
─ 섹션: 사전 점검 [규칙 기반 · LLM 미사용] [높음 2건] ──────── 13:05 계산 · 5분마다 갱신 ──
┌ 요약 매트릭스 (4열) ─────┐┌ 사전 점검 결과 표 (8열) ────────────────────────────────────┐
└──────────────────────────┘└──────────────────────────────────────────────────────────────┘
─ 섹션: 최근 분석 결과 [AI 제안] ── 9월 19일 13:40 · 소요 2분 14초 · 제안 9건 ──────────────────
  [결과가 현재 상태와 다를 수 있음 Banner — 해당 시]
  메타 줄: 스냅샷 노드 6 · 워크로드 42 · 추정 월 ≈ $803 · 가림 1건 · 형식 오류로 제외 1건
  FilterBar: [카테고리 칩 ×5] [심각도 ▾] [출처: 전체 | 사전 점검 연결 | AI 단독]
  SuggestionCard ×N (12열, 세로 목록, 간격 12px)
─ 섹션: 분석 이력 ───────────────────────────────────────────────────────────────────────────
┌ 표 (12열, 최대 10행 + 더 보기) ────────────────────────────────────────────────────────────┐
```

- 1024~1279px: 사전 점검 매트릭스와 표를 세로로 쌓는다(각 12열).

### 2.2 BridgeStatusBar

| 요소 | 사양 |
|---|---|
| 컨테이너 | Card, 패딩 16px 20px, 최소 높이 72px, 좌우 두 영역(space-between) |
| 왼쪽 | StatusBadge md(브리지 문구) + 제목 `Claude Code 브리지`(bodyStrong) + 상태 메시지(body `text.secondary`) + caption `14:02 확인` + `다시 확인` ghost sm |
| 명령 안내 | 미실행·로그인 필요일 때 메시지 아래 인라인 코드 줄(높이 32px, `code.bg`, mono 13, 패딩 4px 8px, radius 4px) + CopyButton sm |
| 오른쪽 | `보낼 데이터 보기` secondary md(아이콘 `eye`) + 8px + `분석 실행` primary **lg(40px)** (아이콘 `play`) |
| 비활성 사유 | 분석 실행 버튼 아래 micro 11/14 `text.secondary`, 버튼 오른쪽 정렬, 최대 폭 280px. 툴팁에도 같은 문구 |

**브리지 상태별**

| 브리지 | 배지 (`status.md` 1.2) | 메시지 | 명령 줄 | 분석 실행 버튼 | 비활성 사유 |
|---|---|---|---|---|---|
| 연결됨 | ok `연결됨` | `호스트의 Claude Code로 분석할 수 있습니다.` | - | 활성 | - |
| 로그인 필요 | warn `로그인 필요` | `호스트의 Claude Code 로그인이 만료됐습니다. 호스트 터미널에서 다시 로그인한 뒤 다시 확인하세요.` | `claude` | 비활성 | `Claude Code 로그인 필요` |
| 사용량 한도 | warn `사용량 한도` | `Claude Code 사용량 한도에 도달했습니다.` + (알면) `15:30 이후 다시 사용할 수 있습니다.` | - | 비활성 | `사용량 한도 · 15:30 이후 가능` (시각 모르면 `사용량 한도`) |
| 미실행 | crit `미실행` | `어드바이저 브리지가 실행되고 있지 않습니다. 호스트에서 아래 명령으로 실행하세요.` | `npm run dev --prefix apps/agent-bridge` | 비활성 | `브리지 미실행` |
| 확인 중 | unknown `확인 중` | `브리지 상태를 확인하고 있습니다.` | - | 비활성 | `브리지 확인 중` |
| 분석 진행 중(어느 상태든) | 현재 브리지 배지 유지 | - | - | 비활성, 문구 `분석 진행 중` | `분석은 한 번에 1건만 실행됩니다` |
| mock + 브리지 없음 | crit `미실행` + 바로 옆에 `예시 응답` 배지(outline, `mode.example*`) | `MOCK 모드: 브리지가 없어 예시 응답으로 전체 흐름을 보여줍니다.` | - | **활성**, 문구 `예시 분석 실행` | - |

- 사전 점검·이력은 브리지 상태와 무관하게 항상 표시(명세 S2).
- 같은 `unreachable`(미실행)이라도 서버가 다른 원인 메시지를 주면(예: `브리지 토큰이 맞지 않습니다 (AGENT_BRIDGE_TOKEN 확인)`, `Claude Code 실행 파일을 찾을 수 없습니다`) 위 표의 고정 문구 대신 서버 `message`를 메시지 자리에 그대로 쓴다. 명령 줄은 서버 `command`가 있을 때만 보인다.
- 브리지 상태 확인은 30초 주기(명세 4절). 확인 결과가 바뀌면 배지 강조(`status.md` 1.6).

### 2.3 사전 점검 섹션

**섹션 머리**: 제목 `사전 점검` + SourceLabel rule(`규칙 기반 · LLM 미사용`, ruleId 없이) + 요약 StatusBadge md(`높음 2건` crit / `중간 7건` warn / `문제 없음` ok) + 오른쪽 `13:05 계산 · 5분마다 갱신` + Switch `시스템 네임스페이스 포함`(기본 꺼짐).

**(a) 요약 매트릭스 (4열)** — `SeverityMatrix`
- Card 패딩 16px. 5행(비용 절감, 안정성, 성능, 보안, DB) × 3열(높음, 중간, 낮음) + 합계 열. 열 머리는 SeverityBadge sm.
- 셀 클릭 → 오른쪽 표를 카테고리·심각도로 필터, 선택 셀 2px `accent.default` 테두리. 다시 누르면 해제.
- 아래 caption: `판단 보류 2건 (관측 23분)`.

**(b) 사전 점검 결과 표 (8열)**

| 열 | 폭 | 내용 |
|---|---|---|
| 펼침 | 32px | chevron |
| 심각도 | 88px | SeverityBadge sm |
| 규칙 | 104px | mono 12 `R-GP2` (툴팁: 규칙 설명) |
| 카테고리 | 104px | CategoryChip sm |
| 내용 | flex, 최소 240px | 한 줄 요약 `gp2 EBS 볼륨 3개` + caption 근거 `gp3 전환 시 GB 단가 −20%` |
| 대상 수 | 72px | `3` |
| 예상 월 절감 [추정] | 120px | `≈ $3.00/월` 또는 빈칸(절감액 없는 규칙) |

- 기본 정렬 `status.md` 5.2(심각도 → 대상 수 → ID), 판단 보류 행은 맨 아래 + 심각도 셀 대신 `판단 보류` Chip + 내용 `관측 23분 · 최소 60분 필요`.
- 기본 표시: 상위 8행 + `전체 27건 보기`(표 펼침, 가상 스크롤 없음).
- 펼친 행: 대상 리소스 목록(ResourceName 칩 목록, 최대 20개 + `외 N개`), 근거 수치(KeyValueList 1열), 절감액 계산식(mono 12 `(0.10 − 0.08) × 50 GB × 3 = $3.00/월`), `서버 계산` 라벨.
- 이 섹션의 절감액은 모두 **서버 계산 추정**이므로 열 머리글 배지 `추정`, 셀은 `≈`.
- 0건: 표 자리에 EmptyState sm `circle-check` `사전 점검에서 발견된 항목이 없습니다`.
- **2026-09-24 `kops-support`**(새 컴포넌트 없음, 표 규칙 그대로):
  - `R-GP2` 대상 목록에 etcd 볼륨이 섞이면 그 대상 칩 뒤에 neutral Chip `etcd 볼륨`(`database` 12px)을 붙이고, 펼친 행 근거 아래 caption `text.secondary` 한 줄 `etcd는 IOPS에 민감합니다 — 전환 시 성능 확인이 필요합니다.`를 둔다(AC-KOPS42). 심각도·색은 그대로다(주의 신호가 아니라 주석이다).
  - 컨트롤 플레인 규칙(`R-CP-HA`, `R-CP-SPOT`, `R-CP-RESTART`)의 대상은 마스터 노드·구성요소 파드다. 대상 칩은 `ResourceName kind=node`/`kind=pod` 그대로 쓰고, 행을 누르면 `/cluster/nodes#control-plane`으로 간다.
  - `R-EKSVER`는 없어졌다. 규칙 ID 목록을 화면에 하드코딩하지 않으므로(서버 값) 표 규칙은 바뀌지 않는다.

### 2.4 RunProgressPanel (분석 진행)

진행 중이거나, 마지막 실행이 실패·취소로 끝나고 사용자가 닫지 않았을 때 BridgeStatusBar 바로 아래에 표시. 다른 페이지에 갔다 돌아와도 서버 상태로 복원한다(명세 S4).

```
┌ Card (12열, 패딩 20px) ─────────────────────────────────────────────────────────────┐
│ 분석 진행 중  [예시 응답]                          경과 2:14                  [취소] │
│ (●)────(●)────(●)────(◉ spinner)────(○)                                              │
│ 스냅샷 수집  사전 점검  분석 요청  응답 수신 중     결과 정리                          │
│  0:03       0:01       0:02      수신 중 · 마지막 수신 2초 전 · 3,214자                │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ ⓘ 분석은 서버에서 계속 진행됩니다. 이 페이지를 떠나도 됩니다.                          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

| 요소 | 사양 |
|---|---|
| 머리 | 제목 `분석 진행 중`(h3) + (예시면) `예시 응답` 배지 + 오른쪽 ElapsedTimer(`경과 2:14`, metricSm tabular) + `취소` 버튼 secondary md(아이콘 `square`) |
| Stepper | 가로, 5단계: `스냅샷 수집` → `사전 점검` → `분석 요청` → `응답 수신 중` → `결과 정리`. 완료 단계 detail에 소요 `0:03` |
| 수신 표시 | 응답 수신 중 단계 detail: `수신 중` + 6px 점 `accent.default` pulse(1200ms, 불투명도 1 → 0.3) + `마지막 수신 2초 전` + 받은 글자 수 `3,214자`(서버가 주면). 마지막 수신 후 30초 이상이면 pulse 정지 + `응답 대기 중 · 마지막 수신 42초 전` |
| LLM 원문 스트림 | **화면에 흘려 보이지 않는다.** 결과 정리 전 텍스트는 검증 전이라 신뢰할 수 없고 형식이 깨질 수 있다. 진행감은 단계·경과·수신 표시로 준다 |
| 안내 줄 | 1px `border.subtle` 위 구분선 + caption `info` 아이콘 14px `분석은 서버에서 계속 진행됩니다. 이 페이지를 떠나도 됩니다.` |
| 사이드바 | 어드바이저 항목에 스피너(`busy`) |

**지연(3분 초과)**
- 패널 왼쪽 3px `status.warn.solid`, Stepper 아래 InlineAlert(warn): 제목 `평소보다 오래 걸리고 있습니다 (경과 4:12).` 설명 `계속 기다리거나 취소할 수 있습니다. 10분이 지나면 자동으로 실패 처리됩니다.` 액션 `분석 취소` danger sm.
- 머리의 `취소` 버튼은 그대로 유지(중복 허용: 경고 안의 버튼이 주 행동).

**취소 확인 Dialog (sm 400px)**: 제목 `분석을 취소할까요?`, 설명 `진행 중인 결과는 저장되지 않고 이력에 "취소됨"으로 남습니다.`, 확인 `분석 취소`(danger), 닫기 `계속 기다리기`. 확인 후 버튼 loading `취소 중`.

**결과 정리 완료** → 패널이 200ms 페이드아웃, 최근 분석 결과 섹션이 새 결과로 바뀌고 섹션 머리에 `방금 완료` Chip(ok, 5000ms).

**실패·취소** → 패널 자리에 `RunResultAlert`(Banner 모양, 닫기 가능):

API 값은 `docs/api/architecture-advisor.md` A.9(`status` / `failureReason`). 설명 칸의 문장은 서버 `errorMessage`를 그대로 쓰고, "안내"는 화면이 고정 문구로 덧붙인다. 아이콘은 Banner 제목 앞 20px(lucide).

| 사유 | API 값 | tone | 아이콘 | 제목 | 설명(`errorMessage`) + 안내 | 액션 |
|---|---|---|---|---|---|---|
| 로그인 필요 | `failed` / `login_required` | warn | `key-round` | `분석 실패 · 로그인 필요` | `호스트의 Claude Code 로그인이 만료됐습니다. 호스트 터미널에서 \`claude\`로 다시 로그인한 뒤 재시도하세요.` + 명령 줄 복사 | `다시 확인`(브리지) — 자동 재시도 없음 |
| 브리지 미실행 | `failed` / `bridge_unavailable` | crit | `unplug` | `분석 실패 · 브리지 미실행` | 서버 메시지 + 실행 명령 줄 복사 | `다시 확인` |
| 사용량 한도 | `failed` / `usage_limit` | warn | `hourglass` | `분석 실패 · 사용량 한도` | 서버 메시지(가능 시각 포함) | - |
| 시간 초과 | `failed` / `timeout` | crit | `timer-off` | `분석 실패 · 시간 초과 (10분)` | `브리지가 10분 안에 응답을 마치지 못했습니다.` | `다시 분석`(브리지 연결됨일 때만 활성) |
| 응답 형식 오류 | `failed` / `invalid_response` | crit | `file-warning` | `분석 실패 · 응답 형식 오류` | `응답을 제안 형식으로 해석할 수 없었습니다.` + 접힌 `원문 응답 보기 (디버그)` → CodeBlock(wrap, maxHeight 400px, 텍스트로만). `hasRawResponse: true`일 때만 | `다시 분석` |
| **비용 상한 초과** | `failed` / `budget_exceeded` | **warn** | `wallet` | `분석 실패 · 비용 상한 초과` | 서버 메시지(`분석 비용이 상한 $2.00을 넘어 중단했습니다.`, 금액은 `status.md` 3.2 규칙상 $10 미만 → 소수 2자리) + 안내 caption 2줄: ① `스냅샷이 크거나 응답이 길어져 한 번의 분석 비용 상한에 닿았습니다. 보낼 데이터 크기를 확인하세요.` ② `상한은 설정 advisor.limits.maxBudgetUsd(기본 $2.00)에서 바꿀 수 있습니다. 구독 로그인이면 실제 청구가 아니라 사용량 보호용 상한입니다.` | `보낼 데이터 보기`(secondary sm) + `다시 분석`(브리지 연결됨일 때만 활성). 자동 재시도 없음 |
| 서버 재시작으로 중단 | `failed` / `interrupted` | crit | `rotate-ccw` | `분석 실패 · 서버 재시작으로 중단` | `API 서버가 재시작되어 분석이 중단됐습니다.` | `다시 분석` |
| 취소됨 | `cancelled` / `null` | neutral | `square` | `분석을 취소했습니다` | 취소 시각 | `다시 분석` |
| 기타 | `failed` / `other` | crit | `octagon-x` | `분석 실패` | 서버 메시지(서버가 가림 처리) | `다시 분석` |

- 비용 상한 초과를 crit이 아니라 warn으로 두는 이유: 시스템 고장이 아니라 설정한 안전장치가 의도대로 동작한 결과이고, 사용자가 스냅샷 크기나 상한을 조정해 해결할 수 있다.
- 분석 이력 표(2.7)의 `사유` 열 문구는 위 표의 "사유" 칸을 그대로 쓴다(`비용 상한 초과`, `서버 재시작으로 중단` 포함). 목록에 없는 `failureReason` 값이 오면 `기타`로 표시한다.

실패해도 **이전 성공 결과는 최근 분석 결과 섹션에 그대로 남는다**(섹션 머리의 시각으로 구분).

### 2.5 최근 분석 결과 섹션

**섹션 머리**: 제목 `최근 분석 결과` + SourceLabel llm(`AI 제안`) + (mock 예시면) `예시 응답` 배지 + 오른쪽 caption `9월 19일 13:40 · 소요 2분 14초 · 제안 9건`.

**메타 줄**(caption `text.secondary`, 칩 나열, 간격 8px): `스냅샷 노드 6 · 워크로드 42` · `추정 월 ≈ $803`(추정 배지 sm) · `가림 1건`(warn Chip, 툴팁 `비밀값 패턴 검사로 가린 필드 수`) · `형식 오류로 제외 1건`(neutral Chip) · `생략 12개`(neutral, 규모 제한으로 생략한 워크로드) · 제안 수 `높음 2 · 중간 4 · 낮음 3`.

**결과가 현재 상태와 다를 수 있음**: Banner neutral(stale 색 계열: 배경 `status.stale.bg`, 왼쪽 3px `status.stale.border`, 아이콘 `clock-alert`), 제목 `결과가 현재 상태와 다를 수 있습니다`, 설명 서버 사유 `마지막 분석 후 7일이 지났습니다` 또는 `분석 후 노드 수가 6 → 9로 바뀌었습니다`, 액션 `다시 분석`(브리지 연결됨일 때만). 제안 카드는 흐리게 하지 않는다.

**FilterBar**
- 카테고리: CategoryChip 5개를 토글 칩으로(선택 시 `accent.default` 2px 테두리) + 개수.
- 심각도: MultiSelect `심각도: 전체`.
- 출처: SegmentedControl sm `전체 | 사전 점검 연결 | AI 단독`.
- 오른쪽: `모두 펼치기 / 모두 접기` ghost sm.

**제안 목록**: 우선순위 오름차순. `근거 확인 불가` 카드는 서버가 맨 아래로 보낸 순서 그대로, 그 앞에 구분 머리 `근거를 확인할 수 없는 제안 (2)`(caption-strong `status.warn.fg` + `triangle-alert` 14px, 위 여백 16px). 기본: 1순위 카드만 펼침.

### 2.6 SuggestionCard

**접힌 상태** (높이 76px, Card 패딩 16px, 카드 간 12px)

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ┌──┐ [비용 절감] [높음]  batch 노드그룹을 Graviton(m7g.large)으로 전환     ≈ $84/월 [서버 계산] ⌄ │
│ │ 1│ 대상 batch 노드그룹 외 2 · 위험도 중간 · 사전 점검 R-GRAVITON R-NODEIDLE · AI 제안        │
│ └──┘                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

| 요소 | 사양 |
|---|---|
| 우선순위 상자 | 40×40px, radius 6px, 배경 `bg.surfaceSunken`, 숫자 metricMd 20/28 `text.primary` tabular, 1~3순위는 배경 `accent.subtle` + 숫자 `accent.default` |
| 1줄 | CategoryChip sm + SeverityBadge sm + 제목(h3 16/24, 1줄 말줄임, 툴팁 전체) + 오른쪽 절감액 |
| 절감액 | MoneyValue kind estimate(서버 계산) 또는 llmEstimate, unit month, size md(`≈ $84/월`) + CostKindBadge `추정 · 서버 계산` 또는 `LLM 추정`. 절감액 없으면 비움(“—”도 쓰지 않음) |
| 2줄 | caption `text.secondary`: `대상 ` + 첫 대상 이름 + `외 N` · RiskBadge 텍스트형(`위험도 중간`, 아이콘 12px, 색 `advisor.severity.<key>.fg`) · 연결 사전 점검 R-ID(mono 11) · SourceLabel llm |
| 펼침 | 오른쪽 끝 IconButton sm `chevron-down`(펼침 시 180° 회전), 카드 머리 전체 클릭 가능, `aria-expanded` |

**펼친 상태** (접힌 머리 아래 1px `border.subtle` 구분, 본문 패딩 16px 위 20px 아래, 블록 간 20px)

| 블록 | 제목(captionStrong `text.secondary`, 아래 8px) | 내용 |
|---|---|---|
| 대상 | 대상 | ResourceName 칩 목록(높이 24px, mono 12, 배경 `bg.surfaceSunken`). 스냅샷에 있는 리소스는 클러스터 화면 링크, 없는 리소스는 링크 없이 점선 테두리 + `triangle-alert` 12px |
| 근거 | 근거 | 불릿 목록, body. 수치(`18%`, `$312`)는 서버가 준 field/value를 bodyStrong + tabular. 필드 이름은 mono 12 `text.tertiary` 괄호(`(nodes[batch].cpu.avg)`) |
| 예상 월 절감액 | 예상 월 절감액 | MoneyValue lg `≈ $84/월` + CostKindBadge. 아래 계산식은 CodeBlock이 아니라 mono 12 한 줄 박스(배경 `code.bg`, 패딩 8px 12px, radius 4px, 넘치면 줄바꿈): `($0.0960 − $0.0768)/h × 730h × 6대 = $84.10/월`. 출처 문구: `서버 계산: aws-cost 단가 기준` 또는 `LLM 추정: 스냅샷 단가로 LLM이 계산한 값입니다. 검증하세요.`(warn 아이콘 12px) |
| 실행 방법 | 실행 방법 | **맨 위 NoExecuteNotice** (`대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.`) → 12px → 번호 목록(단계 텍스트 body, 번호 원 20px `bg.surfaceSunken`) → 단계에 코드가 있으면 텍스트 아래 8px에 CodeBlock(language 라벨, 복사). 실행·적용 버튼 없음 |
| 적용 위험도 | 적용 위험도 | RiskBadge md(outline) + 이유 한 줄 body `스팟 회수 시 파드 재시작` |
| 확인 방법 | 적용 후 확인 | body 텍스트(있을 때만) |
| 연결된 사전 점검 | 연결된 사전 점검 | R-ID 링크 칩(mono 12, `ruler` 아이콘) → 사전 점검 표의 해당 행으로 스크롤 + 펼침 + 1500ms `bg.selected` 강조 |

**variant**

| variant | 모습 |
|---|---|
| default | 위 사양 |
| 1~3순위 | 우선순위 상자 accent 색 |
| unverified(근거 확인 불가) | 테두리 1px **dashed** `status.warn.border`, 접힌 머리 1줄 제목 앞에 warn Chip `근거 확인 불가`, 펼친 본문 맨 위 InlineAlert(warn, compact) `스냅샷에 없는 리소스를 언급합니다. 내용을 그대로 믿지 마세요.` |
| llm savings | 절감액 배지 `LLM 추정`, 계산식 필수 표시 |
| 예시 응답(run 단위) | 카드 자체는 같고 섹션 머리 `예시 응답` 배지로만 표시 |
| 지난 결과(`/advisor/runs/[id]`) | 같음 |

**안전 렌더링(프론트 필수)**: 제목·근거·단계·코드·이유 모두 **텍스트 노드로만** 렌더. HTML·마크다운 해석 금지(굵게·링크 문법도 해석하지 않음), URL 자동 링크 금지, 코드는 CodeBlock 텍스트. 대상 이름 링크는 서버가 스냅샷과 대조해 준 경우만 만든다.

### 2.7 분석 이력 섹션

| 열 | 폭 | 내용 |
|---|---|---|
| 시작 | 140px | `9월 19일 13:38` |
| 상태 | 112px | StatusBadge sm `완료`(ok) / `실패`(crit) / `취소됨`(unknown) / `진행 중`(스피너 12px + unknown 톤 `진행 중`) + (예시면) `예시` 칩 |
| 사유 | 160px | 실패 사유 `로그인 필요`, `시간 초과` 등, 완료면 빈칸 |
| 소요 | 80px | `2분 14초` |
| 제안 | 160px | `높음 2 · 중간 4 · 낮음 3` (각 숫자 앞 10px 심각도 아이콘) |
| 스냅샷 요약 | flex | `노드 6 · 워크로드 42 · 추정 월 ≈ $803` |

- 정렬: 시작 내림차순. 최근 10행 + `더 보기`(10행씩). 보관 기준 caption `최근 50건 또는 90일까지 보관`.
- 행 클릭 → `/advisor/runs/[id]` (실패 행도 열 수 있음: 실패 사유 + 원문 응답(형식 오류일 때)).
- 0건: EmptyState sm `아직 분석 이력이 없습니다`.

### 2.8 보낼 데이터 보기 (Drawer lg 640px)

| 영역 | 사양 |
|---|---|
| 머리 | 제목 `보낼 데이터 미리보기`, 부제 `13:40 생성 · 48.2 KB` |
| 전송 안내 | InlineAlert(info) 고정: `이 데이터는 호스트의 Claude Code를 거쳐 Anthropic으로 전송됩니다. 네임스페이스·워크로드·노드그룹(kOps InstanceGroup) 이름은 원문 그대로 전송됩니다. 노드 이름은 가명으로 바꿉니다. 비밀값·환경 변수·command/args·어노테이션 원문·IP·인스턴스 ID·계정 ID는 포함되지 않습니다.` (2026-09-24 `kops-support`: kOps에서는 노드 이름이 EC2 인스턴스 ID(`i-0…`)가 되므로 가명 처리 사실을 문구에 드러낸다, AC-KOPS44) |
| 메타 칩 | `가림 1건`(warn), `생략 12개`(neutral), `관측 60분`, `데이터 소스 live` |
| 탭 | `요약 | JSON` |
| 요약 탭 | KeyValueList: 클러스터·노드 수·워크로드 수·PVC 수·LB 수·이벤트 reason 수·DB·비용 요약·사전 점검 건수. 각 영역 옆 `JSON에서 보기` 링크 |
| JSON 탭 | JsonTree(defaultExpandDepth 1, 검색, 높이 = Drawer 본문 전체), 가려진 값 `[가림]` 강조 |
| 하단 footer | `JSON 복사` secondary md, `닫기` ghost md |
| 로딩 | 스냅샷 생성 중 스켈레톤 12행 + caption `스냅샷을 만들고 있습니다` |
| 오류 | ErrorState sm `스냅샷을 만들 수 없습니다` + 재시도 |

### 2.9 상태별 모습

| 상태 | 모습 |
|---|---|
| 로딩(최초) | BridgeStatusBar 배지 `확인 중`, 버튼 비활성. 사전 점검 매트릭스·표 스켈레톤, 결과 카드 스켈레톤 3개(76px), 이력 스켈레톤 3행 |
| 분석 이력 없음(한 번도 실행 안 함) | 최근 분석 결과 섹션 EmptyState lg: 아이콘 `lightbulb` 40px, `아직 분석을 실행하지 않았습니다`, 설명 `클러스터·비용 스냅샷을 로컬 Claude Code에 보내 개선 제안을 받습니다. 1~3분 정도 걸립니다.`, 액션 `분석 실행`(브리지 연결됨일 때만 활성, 아니면 비활성 + 사유) |
| 사전 점검 데이터 없음(클러스터·비용 모두 unknown) | 사전 점검 섹션 UnknownState sm `알 수 없음 (클러스터 연결 없음)` |
| 브리지 미실행·로그인 필요·사용량 한도 | 2.2 표. 나머지 섹션 정상 |
| 진행 중(다른 탭에서 시작한 분석 포함) | 2.4 패널, 분석 실행 버튼 비활성 `분석 진행 중` |
| 지연 | 2.4 지연 |
| 실패·취소 | 2.4 RunResultAlert |
| 연결 끊김(API 스트림) | 전역 배너. 진행 패널 경과 타이머는 계속 흐르되(클라이언트 시계) 수신 표시는 `연결 끊김 · 재연결 후 진행 상황을 다시 받습니다`로 바꾼다. 재연결 시 서버 상태로 복원 |
| 결과 오래됨 | 2.5 Banner |
| mock | 상단 MOCK 배지. 브리지 없으면 `예시 응답` 흐름. MOCK 배지 Popover `어드바이저` 그룹 시나리오: `브리지 미실행`, `로그인 필요`, `사용량 한도`, `지연`, `시간 초과`, `응답 형식 오류`, `정상` |

---

## 3. 지난 분석 결과 `/advisor/runs/[id]`

- Breadcrumb `어드바이저 › 분석 이력`. PageHeader 제목 `9월 12일 14:03 분석` + StatusBadge lg(`완료`/`실패`/`취소됨`) + 보조 줄 `소요 2분 41초 · 제안 8건`.
- 제목 아래 Banner neutral(stale 계열) 고정: `지난 분석 결과입니다. 현재 상태와 다를 수 있습니다.` + 액션 `최신 결과 보기`(→ `/advisor`).
- 본문: `당시 스냅샷 요약` 카드(KeyValueList 2열: 노드 수, 인스턴스 타입 구성, 워크로드 수, 추정 월 비용, 예산 상태, 사전 점검 건수, 가림 건수) + `당시 보낸 데이터 보기`(Drawer, 저장된 스냅샷 전문) → 제안 목록(2.5와 같은 FilterBar·카드).
- 실패 실행: 제안 목록 대신 RunResultAlert(닫기 없음) + 원문 응답(형식 오류일 때).
- 없는 ID(보관 기간 지남): EmptyState lg `분석 결과를 찾을 수 없습니다` + `최근 50건 또는 90일까지만 보관합니다` + `어드바이저로`.

---

## 4. 컴포넌트 사용 목록 (이 기능)

| 컴포넌트 | variant / size / state |
|---|---|
| BridgeStatusBar | bridge 5종 + exampleMode |
| Button | primary lg(분석 실행), secondary md(보낼 데이터, 취소), danger sm(지연 시 취소), ghost sm(다시 확인, 펼치기) / loading, disabled + disabledReason |
| RunProgressPanel | running / delayed / cancelling |
| Stepper | horizontal, 단계 state pending/active/done/error/skipped |
| ElapsedTimer | timer 스타일 |
| RunResultAlert | reason 7종 |
| Dialog | sm danger(취소 확인) |
| SeverityMatrix | 셀 선택 |
| DataTable | expandable(사전 점검), default(이력) |
| SeverityBadge | sm, md |
| RiskBadge | 텍스트형(접힌 카드), md outline(펼친 카드) |
| CategoryChip | sm(표·카드), 토글 칩(FilterBar) |
| SourceLabel | rule / llm |
| SuggestionCard | collapsed/expanded, default/top3/unverified/llmSavings |
| NoExecuteNotice | 고정 |
| CodeBlock | language 라벨, 복사, maxHeight 320 / 400(디버그, wrap) |
| CopyButton | sm |
| MoneyValue / CostKindBadge | estimate(서버 계산), llmEstimate |
| JsonTree | Drawer 안 |
| Drawer | lg 640px |
| Banner | neutral(결과 오래됨, 지난 결과), warn/crit(RunResultAlert) |
| InlineAlert | info(전송 안내, 진행 안내), warn(지연, 근거 확인 불가) |
| Chip | 가림 N건, 생략 N개, 형식 오류 제외, 판단 보류, 방금 완료, 예시 |
| EmptyState, UnknownState, ErrorState, Skeleton | |
