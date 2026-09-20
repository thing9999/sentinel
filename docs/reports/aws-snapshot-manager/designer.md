# aws-snapshot-manager · designer 작업 보고

> 파일 위치: `docs/reports/aws-snapshot-manager/designer.md`

## 2026-09-19 · 화면 설계 (목록·상세·편집·휴지통·확인 창)

### 1. 요청 내용
- PM 요청: `docs/specs/aws-snapshot-manager.md`(특히 7절)를 바탕으로 `docs/design/aws-snapshot-manager.md` 작성.
- 범위: 사이드바 메뉴, 목록·상세·편집·휴지통 화면, 확인 창들, 상태 표시 규칙(스캔 OK/경고/오류, 커밋 금지, 메타 손상, unknown), 빈/로딩/오류 상태, 반응형, 접근성. 기존 UI 컴포넌트로 되는지 먼저 확인하고 새로 필요한 것만 컴포넌트 스펙으로 정의. 코드 작성 금지.
- 전제: Q1~Q4 사용자 확정(라벨·메모는 폴더 안 별도 파일, 삭제는 휴지통(복원/영구 삭제), 오류 남은 템플릿은 재확인 후 저장 + 커밋 금지 유지, 원본 직접 편집 + 안내 문구).

### 2. 참고한 문서
- `docs/specs/aws-snapshot-manager.md` (전체)
- `docs/design/shell.md`, `status.md`, `components.md`, `tokens.json`, `architecture-advisor.md`(기능 화면 문서 형식)
- `apps/web/src/components/ui/**` (index.ts, SideNav, DataSourceBadge, SummaryStrip, Dialog, Tabs, CodeBlock, Banner/InlineAlert, BridgeStatusBar의 CommandLine, icons.tsx)
- `deploy/aws-snapshot/README.md` 4장(종료코드), 5장(스캔 규칙·처리 방법)
- `docs/api/common.md` 6절(mock 시나리오 그룹)
- `docs/reports/aws-snapshot-manager/README.md`

### 3. 작업 내용
1. 기존 컴포넌트 점검: 목록(DataTable·FilterBar·SummaryStrip), 확인 창(Dialog), 탭(Tabs), 메타데이터(KeyValueList·JsonTree·SegmentedControl), 명령 복사(CommandLine·CopyButton), 알림(Banner·InlineAlert), 빈 상태(EmptyState·UnknownState·ErrorState)는 기존으로 충분. 줄 번호·발견 줄 표시·편집이 되는 코드 영역, 스캔 발견 목록, 입력 필드, ID 입력 확인 창, 명령 단계 목록은 없어서 새로 정의.
2. `docs/design/aws-snapshot-manager.md` 작성
   - 0절 화면 목록(페이지 3개 + 확인 창 7개 + 도움말 Drawer), 1절 정보 우선순위
   - 2절 사이드바: 그룹 `로컬 파일` 신설, `AWS 스냅샷`(`archive`), 숫자 배지 치수, 개요에 넣지 않는다는 디자인 판단
   - 3절 목록: 요약 띠, FilterBar, 2줄 셀 56px 표(열 폭 합계를 1160px 안에 맞춤), 쓰기 불가 표시 공통 규칙(3.5), CLI 안내(3.6), 상태별 모습(3.7)
   - 4절 상세: 레이아웃(스캔 패널 4열 + 편집기 8열 나란히), PageHeader, 요약 카드, 스캔 패널, 리소스 수, 폴더 내용, 메타데이터(손상·없음·형식 다름 포함), 상태별 모습
   - 5절 편집기: 치수, 모드별 상태 표, 원본 편집 안내(Q4), 편집 불가 사유 우선순위, 저장 흐름과 저장 결과 알림
   - 6절 확인 창: 라벨·메모, 저장 전 확인(Q3), 충돌, 저장하지 않은 변경, 저장 실패, 휴지통 이동(ID 입력), 복원, 영구 삭제
   - 7절 휴지통, 8절 mock 시나리오 그룹, 9절 상태 표시 규칙 총괄 표, 10절 반응형, 11절 접근성, 12절 컴포넌트 사용 목록
3. `docs/design/components.md`: 11절(스냅샷 전용 새 컴포넌트 6종), 12절(기존 컴포넌트 확장 7건) 추가, 아이콘 목록을 13절로 옮기고 스냅샷 아이콘 추가.
4. `docs/design/status.md`: 적용 범위, 1.2 문구 대체(`커밋 금지`), 1.3 보조 라벨 4종, 5.2 기본 정렬 3건, 9절(스냅샷 규칙: 문구, 스캔 등급, 쓰기 불가, 시각, stale) 추가.
5. `docs/design/shell.md`: 3.1 메뉴 9번과 그룹 라벨, 3.2 숫자 배지 치수 추가.
6. `tokens.json`은 바꾸지 않음(5절 결정 참고).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/design/aws-snapshot-manager.md` | 추가 | 화면 설계 전체 |
| `docs/design/components.md` | 수정 | 11절 새 컴포넌트(CodeEditor, ScanFindingList, ScanCounts, TextField/TextArea, TypeToConfirmDialog, CommandSteps), 12절 기존 확장, 13절 아이콘(번호 이동 + 추가) |
| `docs/design/status.md` | 수정 | 1.2 `커밋 금지`, 1.3 보조 라벨, 5.2 정렬, 9절 추가 |
| `docs/design/shell.md` | 수정 | 메뉴 9번 `AWS 스냅샷`, 그룹 `로컬 파일`, 숫자 배지 |
| `docs/reports/aws-snapshot-manager/designer.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **crit 문구 `커밋 금지`, ok는 `정상` 유지**: crit 조건이 모두 "커밋하면 안 됨"이고 CLI README 종료코드 1 문구와 같다. ok를 `커밋 가능`으로 바꾸지 않은 이유는 스캐너가 모든 비밀값을 잡지 못하므로 화면이 커밋을 허락하는 것처럼 보이면 안 되기 때문. 같은 이유로 `통과`라는 말도 쓰지 않는다.
- **새 토큰 없음**: 줄 번호 `text.secondary`(on `code.headerBg`, 4.5:1 이상. `text.tertiary`는 약 3.9:1로 미달), 발견 줄 `status.<key>.bg`, 이동 대상 `accent.default`, 선택 `accent.subtleBorder`, 편집 모드 테두리 `accent.default`로 모두 표현된다.
- **스캔 패널과 편집기를 나란히**(명세 A~E 순서와 다름): 발견 항목 클릭 → 줄 이동을 스크롤 없이 하려고. 검토 대안: 명세 순서대로 세로 배치 → 클릭할 때마다 화면이 크게 튀어 비교가 어렵다.
- **목록 2줄 셀(56px)**: 3.1 항목 10개를 1160px에 넣으면 한 줄 셀로는 1600px 이상 필요. 상태+사유, 시각+라벨, 리전+범위를 묶어 1152px에 맞췄다. DataTable에 `comfortable` 밀도 추가 필요.
- **저장 전 확인은 창 1개로 합침**: 오류 남음·YAML 구문 오류·리소스 감소를 한 창에서 블록으로 보인다(창을 여러 번 띄우지 않음). 오류가 있으면 danger + `커밋 금지 상태로 저장`.
- **충돌 창에 확인 버튼 없음**: 강제 덮어쓰기 없음(명세 3.7). `최신 내용 불러오기`는 편집을 버리므로 danger 버튼.
- **쓰기 불가는 상태가 아님**: neutral/info + `lock`, 빨강·노랑 없음. 비활성 버튼은 `aria-disabled`로 포커스 가능하게 해 사유를 읽을 수 있게.
- **스냅샷 시각은 오늘이어도 날짜 포함**: 날짜로 구분하는 기록이라 `status.md` 6절 "오늘이면 시각만" 예외(9.4).
- **개요에 넣지 않음**(명세 3.4 질문에 대한 디자인 제안): 운영 장애 신호가 흐려진다.
- **문법 강조 없음**: 기존 CodeBlock 원칙(텍스트로만)과 같고, 사용자 입력 파일을 해석하는 코드를 늘리지 않는다.
- **메뉴 그룹 `로컬 파일` 신설**: `비용·개선`에 넣으면 운영 상태 메뉴처럼 보인다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 작업이라 실행할 lint/test 없음 |
| 수동 점검: 명세 7절 디자인 전달 사항 항목별 대조 | 통과 | 메뉴 배지·숫자, 목록/상세 구성, 편집기 표시(줄 번호·여백·편집 모드·미저장·상한 초과), 확인 창 4종 + 휴지통, 안내 3종 위치, 쓰기 비활성 이유, mock 그룹 모두 반영 |
| 수동 점검: AC-01~51 중 화면 관련 항목 | 통과 | AC-07(내보내기·적용 버튼 없음), AC-11, 12, 17, 23, 24, 27, 30~33, 37~39, 45~47, 51 반영 |
| 대비 계산(줄 번호, 발견 줄 위 코드 글자) | 통과 | 라이트/다크 모두 4.5:1 이상. 계산은 상대 휘도 근사값 |

- 목록 열 폭 합(1152px)은 계산만 했고 실제 렌더링 확인은 하지 않았다(퍼블리셔·프론트 확인 필요).

### 7. 남은 이슈·한계
- `live` + 폴더 설정 없음(EKS 배포 기본)이면 사이드바에 `알 수 없음` 아이콘이 항상 보인다(명세 3.11 그대로 따름). 쓰지 않는 기능이 계속 신호를 내는 것이라 PM 판단 필요: 설정 없음일 때 메뉴를 숨기거나 상태 아이콘을 그리지 않는 안.
- 규칙 도움말 표(README 5장 11개 규칙)는 서버가 주지 않으면 프론트가 문구를 복사해야 해서 CLI와 어긋날 수 있다(아래 백엔드 요청).
- 서버 사유·오류 문구, 설정 이름, 편집·보기 상한 값은 계약이 나오면 맞춰야 한다. 설계의 문구는 예시.
- 편집 중 줄 번호가 밀리면 발견 줄 표시가 어긋난다(마지막 저장 기준으로 둔다고 명시). 편집 중 실시간 재스캔은 범위 밖.
- 편집한 줄 표시(diff 여백)는 이번 설계에 넣지 않았다.

### 8. 다른 담당 요청
- `publisher 요청`: `components.md` 11절 새 컴포넌트 6종(CodeEditor, ScanFindingList, ScanCounts, TextField/TextArea, TypeToConfirmDialog, CommandSteps) 구현, 12절 기존 확장 7건(NavItem `count`·`statusLabel`, SummaryStrip `overall.label`·`updatedLabel`·`actions`·`updatedExtra`, DataTable `comfortable`, TabItem `dirty`·`suffix`·`mono`, KeyValueList `note`, Dialog `confirmDisabled`·`confirmDisabledReason`·`initialFocus`, DataSourceBadge 스냅샷 그룹), 13절 새 아이콘 14개 등록. `CommandLine`은 지금 `advisor/`에 있으니 공용 위치로 옮길지 판단.
- `frontend 요청`: CodeEditor용 편집 라이브러리 채택 결정(`apps/web/package.json`은 frontend 관리). 조건: 가상 렌더링(20 MB 보기), 문법 강조 없이 사용 가능, 줄 단위 장식(gutter 아이콘·줄 배경), Tab 들여쓰기 + Esc 후 Tab 포커스 이동. 예: CodeMirror 6. 줄바꿈(CRLF) 처리 방식을 백엔드와 맞출 것.
- `backend 요청`: 계약에 ① 스캔 규칙 목록(ID·등급·설명) 제공 검토(도움말 표를 CLI와 한 출처로), ② 편집기 표시용 파일 정보(줄 수, 크기, 줄바꿈 방식, 인코딩, 들여쓰기 단위), ③ 목록 요약용 서버 사유 문구와 메뉴 상태·커밋 금지 수, ④ 저장 전 검사 결과에 리소스 수 전후·YAML 구문 오류 줄, ⑤ 휴지통 항목 ID(같은 스냅샷 ID가 여러 번 들어갈 수 있으면), ⑥ mock 시나리오 그룹 키(설계 제안 `snapshots`)와 시나리오 7종, ⑦ 설정 없음·폴더 없음일 때 화면에 보일 설정 이름·마운트 안내 문구(hint)를 포함해 주세요.
- `PM 요청`: 7절 첫 항목(EKS 배포에서 메뉴 `알 수 없음` 상시 표시) 판단.

### 9. 다음 담당이 알아야 할 점
- 상태·사유·개수·리소스 수·스캔 결과는 모두 서버 값. 화면은 계산하지 않는다. 저장 전 검사도 서버 요청.
- 상태 문구는 crit만 `커밋 금지`로 바꾼다(`StatusBadge label`, NavItem `statusLabel`, SummaryStrip `overall.label`). 다른 상태 문구는 기본값.
- 사용자 입력(라벨·메모·예상 밖 파일 이름·템플릿)은 텍스트 노드로만 렌더. 자동 링크 금지.
- 비활성 버튼은 `disabled`가 아니라 `aria-disabled` + 사유 툴팁.
- 편집 중에는 어떤 경우에도 편집 내용을 화면에서 지우지 않는다(실패·충돌·삭제 모두 `내 편집 복사` 제공). 버리는 동작은 항상 확인 창을 거친다.
- 내보내기·적용·커밋 버튼은 어디에도 없다(AC-07). CLI 명령은 복사만.

## 2026-09-19 · 구현 차이 디자인 확인 (문서 확인만)

### 1. 요청 내용
- PM 요청: publisher·frontend 구현이 설계와 다른 5건을 수용/수정 필요로 판단하고 디자인 문서에 반영. 수용이면 문서를 구현에 맞게 고치고, 수정 필요면 담당과 구체 변경을 적는다.

### 2. 참고한 문서
- `docs/design/aws-snapshot-manager.md` 3.1, 3.4, 5.2, 6.4
- `docs/design/components.md` 11.1
- `docs/specs/aws-snapshot-manager.md` 3.7, AC-31

### 3. 작업 내용 (판단)
| # | 구현 차이 | 판단 | 이유 | 문서 반영 |
|---|---|---|---|---|
| 1 | (publisher) 편집 중 줄 바꿈 미지원, 토글 비활성 | **수용** | 명세 요구가 아니라 디자인 편의 기능. 편집 중 가로 스크롤이면 줄과 줄 번호가 1:1로 맞아 오히려 발견 줄 위치 확인이 쉽다 | 5.2: 줄 바꿈은 보기 모드에서만, 편집 중 토글 `aria-disabled` + 사유 `편집 중에는 줄 바꿈을 쓸 수 없습니다`. components.md 11.1 `wrap`은 view에서만 |
| 2 | (publisher) gutter 툴팁 hover 전용 | **수용** | 같은 정보(등급·규칙·설명)를 키보드로 쓸 수 있는 ScanFindingList와 이동 시 live 문구가 이미 준다. gutter 아이콘에 포커스를 주면 편집 영역 안 탭 순서가 복잡해진다 | 5.2: hover 전용, gutter 아이콘 `aria-hidden`, 키보드 경로는 발견 목록. components.md 11.1 state 문구 수정 |
| 3 | (frontend) 헤더 `휴지통`을 링크로 | **수용** | 다른 페이지로 가는 동작이라 링크가 의미상 맞다(새 탭 열기 가능) | 3.1: 링크, 모양은 ghost md 버튼과 같게(높이 32px, 패딩 0 12px, radius 6px, hover `bg.hover`, 밑줄 없음) |
| 4 | (frontend) 브라우저 뒤로/앞으로에 이탈 확인 없음 | **수정 필요** | 명세 3.7·AC-31 "페이지 이동 시 확인" 위반이고, 저장하지 않은 편집이 확인 없이 사라진다(설계 원칙: 버리는 동작은 항상 확인 창) | 6.4에 뒤로/앞으로 포함과 동작 명시 |
| 5 | (frontend) 목록 새 행 1500ms 강조·재정렬 보류 미구현 | **수용** | 갱신이 30초 단위로 드물고, 기본 정렬이 시각순이라 새 행이 맨 위에 붙어 기존 행 위치가 거의 안 바뀐다. 행이 밀려 잘못 누른 삭제도 ID 입력 확인에서 걸러진다 | 3.4: 새 행 강조·재정렬 보류를 이 표에 적용하지 않는다고 명시 |

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/design/aws-snapshot-manager.md` | 수정 | 3.1 휴지통 링크, 3.4 새 행 강조·재정렬 보류 제외, 5.2 줄 바꿈 보기 모드 한정·gutter 툴팁 hover 전용, 6.4 브라우저 뒤로/앞으로 확인 |
| `docs/design/components.md` | 수정 | 11.1 CodeEditor `wrap`·state 문구 |
| `docs/reports/aws-snapshot-manager/designer.md` | 수정 | 이 섹션 추가 |

### 5. 주요 결정과 이유
- 3절 표 "이유" 칸 참고. 수정 요구는 편집 내용이 확인 없이 사라지는 1건(#4)뿐이다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| (없음) | 생략 | 문서 확인 작업. 구현 화면은 직접 보지 않고 PM이 전달한 설명으로 판단했다 |

### 7. 남은 이슈·한계
- #4 수정 전까지 AC-31은 부분 충족(탭 전환·앱 안 링크만)이다.

### 8. 다른 담당 요청
- `frontend 요청` (#4): 저장하지 않은 변경이 생기면 `history.pushState`로 가드 항목을 하나 넣는다. `popstate`가 오면 가드를 다시 넣어 현재 페이지에 머문 채 `aws-snapshot-manager.md` 6.4 확인 창(`저장하지 않은 변경이 있습니다` / `계속 편집` / `변경 버리기`)을 띄운다. `변경 버리기`면 가드를 치우고 원래 가려던 이전 페이지로 이동(예: `history.go(-2)`). 저장·편집 취소로 변경이 없어지면 가드를 치운다. 확인 기준: 편집 후 브라우저 뒤로 → 창이 뜨고, `계속 편집` 시 URL과 편집 내용이 그대로, `변경 버리기` 시 이전 페이지로 이동.
- `publisher 요청`: 없음(#1, #2 수용). 다만 편집 중 줄 바꿈 토글에 비활성 사유 툴팁(`편집 중에는 줄 바꿈을 쓸 수 없습니다`)이 있는지 확인.

### 9. 다음 담당이 알아야 할 점
- 새 행 강조·재정렬 보류 제외는 스냅샷 목록 표에만 해당한다. `status.md` 5.2 공통 규칙은 그대로다.
