# aws-snapshot-manager · frontend 작업 보고

> 파일 위치: `docs/reports/aws-snapshot-manager/frontend.md`

## 2026-09-19 19:45 · 6단계 통합 (`/snapshots` 목록·상세/편집·휴지통, 사이드바 연동)

### 1. 요청 내용
- PM 요청: `/snapshots` 페이지(목록·상세/편집·휴지통)와 사이드바 "AWS 스냅샷" 메뉴 연동.
- 다른 담당이 넘긴 frontend 요청 (모두 처리)
  - publisher: `MockGroupId`에 `"snapshots"` 추가 / `nav.ts`에 `/snapshots` 매핑(status, crit일 때만 `statusLabel: "커밋 금지"`, count) / 편집 라이브러리 결정(기본 `PlainCodeEngine` vs CodeMirror 6 어댑터), 기본 엔진이면 편집 중 줄 바꿈 비활성 / `features/__fixtures__/fixtures.ts` 타입 오류 3건 정리.
  - backend: 쓰기 요청은 모두 `Content-Type: application/json`(복원·새로고침도 `{}`), mock 그룹 키 `snapshots`, SSE 토픽 `aws-snapshots`(`changed` 받으면 REST 재조회), 422면 `details.missing`을 `confirm`에 넣어 재요청, 409는 충돌 안내, 편집 내용은 LF로 전송.
  - PM 결정: 요약 `root.state === "not_configured"`면 사이드바 상태 아이콘을 그리지 않음. 페이지 안에서는 unknown + 설정 안내.
  - 내보내기·적용 버튼 없음(CLI 안내만).
- 쓰기 영역: `apps/web/src/app/**`, `features/**`, `charts/**`, apps/web 루트 설정.
- 검증: web lint·typecheck·test(새 테스트)·build, api mock :3011 + web :3012로 HTTP 흐름 확인. 3000/3001/3002/3100 사용 금지, 자기 PID만 종료.

### 2. 참고한 문서
- `docs/specs/aws-snapshot-manager.md` (3절 표시·판단·편집·삭제·보안, 4절 갱신, 5절 AC-01~51)
- `docs/design/aws-snapshot-manager.md` (전체), `docs/design/components.md` 11~13절, `docs/design/status.md` 9절, `docs/design/shell.md` 3절
- `docs/api/aws-snapshot-manager.md` (0~18절, 특히 1.2 WriteAbility, 4 버전·충돌, 6~9 엔드포인트, 11 SSE, 12 mock, 18 변경 이력), `docs/api/common.md` (2·3·5·6절)
- `docs/reports/aws-snapshot-manager/{publisher,backend}.md`
- 기존 구현 관례: `features/stream/*`(단일 SSE·리듀서·stale), `features/common/hooks.ts`(useApi·useUrlQuery), `features/cluster-status/NodesPage.tsx`·`aws-cost/CostPage.tsx`, `features/shell/*`, `components/ui/__preview__/SnapshotPreview.tsx`
- `apps/web/node_modules/next/dist/docs` (Link `onNavigate`는 링크 단위라 전역 이탈 방지에는 쓰지 않음)

### 3. 작업 내용
1. **기존 타입 오류 정리**: `fixtures.ts`에 aws-cost 계약 필드(`maxCallsPerRefresh`, `refreshEstimatedCostUsd`, `estimate.stale`, `actual.stale`·`staleReason`)를 채워 `tsc` 오류 3건을 없앴다.
2. **공통·스트림 연동**
   - `common/types.ts`: `SourceId`에 `snapshotStore`, `MockGroupId`에 `snapshots`, `StreamTopic`에 `aws-snapshots`.
   - `stream/client.ts`: `BASE_TOPICS = ["overview", "aws-snapshots"]`. 사이드바가 모든 페이지에서 스냅샷 메뉴 요약을 받는다(계약 11절 "앱 레이아웃 스트림 1개가 구독").
   - `stream/reducer.ts`: `snapshots` 상태 추가. `aws-snapshots.snapshot`은 요약 교체 + `resetSeq`, `aws-snapshots.changed`는 요약 교체 + `changed[id]`/`removed[id]`/`trashSeq` **카운터**로 남긴다(한 프레임에 이벤트 여러 개가 묶여도 ID 변경을 잃지 않게). 행 데이터는 저장하지 않는다(스트림에 없음).
3. **사이드바·MOCK 배지**
   - `shell/nav.ts`: `snapshotNavPatch()` — crit면 `커밋 금지` + critical 수 숫자, `not_configured`면 아이콘·숫자 없음(PM 결정), `unavailable`은 unknown 아이콘, stale/스트림 끊김이면 stale. overview가 없어도 스냅샷 메뉴는 요약으로 그린다.
   - `shell/ShellClient.tsx`: 스냅샷 메뉴의 끊김 판단은 kube 출처와 무관하게 heartbeat 무수신(45초)만 쓴다. `onScenarioChange`는 `ScenarioGroupKey`(snapshots 포함)로.
   - `shell/mock-scenarios.ts`: 배지 그룹 캐스팅을 `ScenarioGroupKey`로 → MOCK 배지 Popover에 "AWS 스냅샷" 그룹이 나온다.
4. **기능 모듈 `features/aws-snapshots/`**
   - `types.ts`: 계약 5~11절 타입(목록 행, 요약, 상세, 파일, 검사·저장, 라벨·메모, 휴지통, SSE payload). 계약에 없는 필드는 두지 않았다.
   - `api.ts`: 쓰기 요청 7개(refresh, check, PUT 파일, PUT notes, DELETE, restore, purge). 객체 본문은 `apiFetch`가 JSON 헤더를 붙인다. refresh·restore는 `{}`, DELETE는 본문 없이 `?confirm=`. 템플릿 check/PUT은 60초 타임아웃.
   - `model.ts`(순수 함수): ID 형식, 시각(항상 날짜 포함 + UTC 툴팁), 범위 요약, 리소스 수·직전 대비(U+2212), 크기, 필터(상태·리전·라벨/메모/ID 검색)·정렬(최신순 기본, 상태 나쁜 순), 발견 → `ScanFindingList`/편집기 마커/파일 탭, 폴더 내용 행, 재스캔·저장 결과·당시 대비 문구, 쓰기 불가 Banner, 출처 unknown, 오류 코드 → 문구.
   - `hooks.ts`: `useSnapshotsView()`(요약·재조회 카운터·stale), localStorage 불리언 저장소(`sentinel.snapshots.wrap`, `sentinel.snapshots.cliGuide`), `useFlash`, **`useLeaveGuard`**(저장하지 않은 변경이 있을 때 앱 안 링크 클릭을 window 캡처 단계에서 가로채 확인 창을 띄우고, 탭 닫기·새로고침은 `beforeunload`).
   - `SnapshotListPage.tsx`(디자인 3절): 요약 띠(커밋 금지/주의/알 수 없음 링크, 폴더 위치, 인식하지 못한 항목 칩, 마지막 확인 + 지금 다시 읽기), MOCK 안내, 쓰기 불가 Banner, 새 스냅샷 만들기 안내 토글, FilterBar(상태 MultiSelect·리전·검색, URL 쿼리 `status`·`region`·`q`·`sort`), 56px 2줄 표(9열, 1280 미만에서 직전 대비·former2 숨김, 200행 초과 가상 스크롤), 동작 열(라벨·메모 편집·휴지통 이동, 비활성 사유), 빈 상태 + CLI 안내, 출처 unknown이면 UnknownState + 설정 안내(예시 데이터 없음), 휴지통 이동 후 `?trashed=<id>` 알림.
   - `SnapshotDetailPage.tsx`(디자인 4절): 브레드크럼·제목(로컬 시각)·상태 배지(`커밋 금지`)·ID 복사·리전·former2, 라벨·메모 편집/삭제 버튼(비활성 사유), 진행 중 InlineAlert(hourglass), A 요약 카드(판단 사유, 라벨·메모 pre-wrap·더 보기, 커밋·적용 안 함 안내), D 스캔 패널 + E 템플릿 편집기 나란히(4:8), C 리소스 수 + 폴더 내용(6:6), B 메타데이터(표/원문 JSON, 없음·손상·형식 다름 안내, 손상 시 원문 CodeEditor + 오류 줄 강조). 400/404/403/503/네트워크 상태별 화면. 편집 중 스냅샷이 지워지면 마지막 상세를 유지하고 "스냅샷이 없습니다" 창(편집 복사).
   - `TemplateEditor.tsx`(디자인 5·6절): `useTemplateEditor()` 컨트롤러 + 카드. 탭 3개(발견 등급·개수, 파일 없음, 보기 전용, 저장 안 됨 점), 툴바(줄 수·크기·수정·줄바꿈·인코딩, 편집 중/저장하지 않은 변경/방금 바뀜/보기 전용 칩, 줄 바꿈 토글, 편집·편집 취소·저장), 알림 슬롯(원본 편집 안내, 외부 변경·충돌 고정 경고, 저장 실패, 저장 결과 + 재스캔 문구 + 경고 목록, 큰 파일 안내). 저장 흐름은 `check`(검사 중) → 확인 사유가 있으면 확인 창(오류 목록·YAML 줄·리소스 감소·접힌 경고) → `PUT`(저장 중, `confirm`). PUT 422면 `details.missing`을 합쳐 다시 확인, 409면 충돌 창(내 편집 복사 / 최신 내용 불러오기만, 덮어쓰기 없음). 탭 전환·다른 파일 발견 클릭·편집 취소·최신 불러오기·앱 안 링크 이동은 변경이 있으면 확인. 보기 모드에서 파일 버전이 바뀌면 자동 교체 + `방금 바뀜` 5초(자기 저장 제외), 편집 중이면 알림만. `Ctrl/Cmd+S`, Tab 들여쓰기 단위(`files[].indent`).
   - `DetailSections.tsx`: SummaryCard, ScanPanel(ScanCounts md, strict 칩, 당시 대비, 스캔한 파일 접기, 편집 중 줄 번호 안내, 발견 목록 — metadata는 안내, notes는 `라벨·메모 편집` 액션, 한계 문구, CLI 재스캔 명령), ResourcesCard, FolderCard(없음/예상 밖/raw/라벨·메모 칩), MetadataSection.
   - `dialogs.tsx`: 라벨·메모 편집(60/2000자 카운터·초과 입력 거부, 422 비밀값 → 규칙 ID·필드만 + 해당 필드 invalid, 409 → 내 입력 복사/최신 불러오기, 400 필드 오류), 휴지통 이동(TypeToConfirmDialog: 시각·라벨·상태, 파일 목록 칩, git·raw 안내).
   - `TrashPage.tsx`(디자인 7절): 표(스냅샷·라벨·리전·옮긴 시각·파일·동작), 복원 창(409 `SNAPSHOT_ID_EXISTS` → 안내 + 기존 스냅샷 링크 + 확인 비활성), 영구 삭제(ID 입력), 빈 상태, 쓰기 불가 비활성.
   - `shared.tsx`: SnapshotTime, MockNotice, WriteBlockBanner, SourceUnknown(설정·마운트 안내 + CommandLine 복사), RowActionButton, CliGuide(CommandSteps + 종료코드 표 + IAM·적용 안내), ScanRulesHelp(Drawer, `GET /scan-rules` + 처리 방법 + 한계 문구).
5. **라우트** `app/snapshots/page.tsx`(Suspense), `app/snapshots/[id]/page.tsx`(ID마다 `key`로 편집 상태 초기화), `app/snapshots/trash/page.tsx`(정적 `trash`가 `[id]`보다 우선).
6. **테스트**: `aws-snapshots/model.test.ts`(순수 함수·사이드바·배지 그룹·리듀서 24건), `aws-snapshots/pages.test.tsx`(목록·상세·휴지통 통합 17건), `__fixtures__/snapshots.ts`(계약 모양 가짜 응답), `stream/connection.test.ts` 기대 토픽 갱신.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/app/snapshots/page.tsx` | 추가 | 목록 라우트 |
| `apps/web/src/app/snapshots/[id]/page.tsx` | 추가 | 상세 라우트(ID별 key) |
| `apps/web/src/app/snapshots/trash/page.tsx` | 추가 | 휴지통 라우트 |
| `apps/web/src/features/aws-snapshots/types.ts` | 추가 | 계약 타입 |
| `apps/web/src/features/aws-snapshots/model.ts` | 추가 | 표시·필터·정렬·오류 문구 순수 함수 |
| `apps/web/src/features/aws-snapshots/api.ts` | 추가 | 쓰기 요청 |
| `apps/web/src/features/aws-snapshots/hooks.ts` | 추가 | 스트림 뷰, 저장소, 이탈 방지 |
| `apps/web/src/features/aws-snapshots/shared.tsx` | 추가 | 공용 조각 |
| `apps/web/src/features/aws-snapshots/dialogs.tsx` | 추가 | 라벨·메모, 휴지통 이동 창 |
| `apps/web/src/features/aws-snapshots/SnapshotListPage.tsx` | 추가 | 목록 |
| `apps/web/src/features/aws-snapshots/SnapshotDetailPage.tsx` | 추가 | 상세 |
| `apps/web/src/features/aws-snapshots/TemplateEditor.tsx` | 추가 | 편집기 컨트롤러·카드·확인 창 |
| `apps/web/src/features/aws-snapshots/DetailSections.tsx` | 추가 | 상세 A~D |
| `apps/web/src/features/aws-snapshots/TrashPage.tsx` | 추가 | 휴지통 |
| `apps/web/src/features/aws-snapshots/model.test.ts` | 추가 | 단위 테스트 24건 |
| `apps/web/src/features/aws-snapshots/pages.test.tsx` | 추가 | 페이지 통합 테스트 17건 |
| `apps/web/src/features/__fixtures__/snapshots.ts` | 추가 | 테스트 픽스처 |
| `apps/web/src/features/__fixtures__/fixtures.ts` | 수정 | aws-cost 필드 누락 3건(타입 오류) 정리 |
| `apps/web/src/features/common/types.ts` | 수정 | `snapshotStore`, `snapshots`, `aws-snapshots` |
| `apps/web/src/features/stream/client.ts` | 수정 | 기본 토픽에 `aws-snapshots` |
| `apps/web/src/features/stream/reducer.ts` | 수정 | `snapshots` 상태·이벤트 2종 |
| `apps/web/src/features/stream/connection.test.ts` | 수정 | 기본 토픽 기대값 |
| `apps/web/src/features/shell/nav.ts` | 수정 | 스냅샷 메뉴 상태·숫자·문구 |
| `apps/web/src/features/shell/ShellClient.tsx` | 수정 | 스냅샷 요약 전달, `ScenarioGroupKey` |
| `apps/web/src/features/shell/mock-scenarios.ts` | 수정 | 배지 그룹 `snapshots` 포함 |
| `docs/reports/aws-snapshot-manager/frontend.md` | 추가 | 이 보고서 |

`components/ui/**`·`styles/**`(퍼블리셔 영역)와 apps/web 루트 설정은 바꾸지 않았다.

### 5. 주요 결정과 이유
- **편집 엔진: 기본 `PlainCodeEngine` 사용 (CodeMirror 6 어댑터 만들지 않음)**
  - 검토: CodeMirror 6은 편집 중 줄 바꿈·undo 기록·IME·선택 동작이 더 좋지만 의존성 5~6개 추가, `decorations`·gutter·가상 렌더링을 어댑터에 다시 맞춰야 하고 스타일 클래스가 퍼블리셔 영역이라 요청이 오가야 한다.
  - 선택 이유: 기본 엔진이 명세 동작(가상 렌더링, 발견 줄 배경·gutter, 이동·강조, Tab 들여쓰기, Ctrl/Cmd+S, 잠금)을 이미 충족하고 헤드리스 브라우저에서 5.5 MB 파일 보기·편집 흐름이 오류 없이 동작했다. 주 용도(비밀값 줄 정리·allow 주석)는 짧은 줄 편집이다.
  - 결과: **편집 중에는 줄 바꿈 토글을 비활성**(`aria-disabled`, 라벨 `줄 바꿈 (편집 중에는 쓸 수 없음)`), 보기 모드에서만 저장값(`sentinel.snapshots.wrap`)을 적용한다. 필요해지면 `engine` prop으로 교체 가능.
- **저장은 `check` → (확인 창) → `PUT` 두 단계**: 디자인 5.6의 `검사 중` → `저장 중` 표시와 "취소하면 파일이 바뀌지 않는다"(AC-23)를 그대로 따르려고. PUT이 그래도 422면 `details.missing`을 합쳐 다시 묻는다(검사 후 파일이 바뀐 경우 대비).
- **스트림 이벤트 → 재조회 키**: 목록은 이 토픽 이벤트마다(`seq`), 상세는 `resetSeq`·`changed[id]`·`removed[id]`, 휴지통은 `resetSeq`·`trashSeq`. 서버가 1초 debounce하므로 추가 묶음 처리는 하지 않았다(리듀서는 기존대로 rAF 배치).
- **편집 중에는 파일 재조회 키를 편집 시작 버전으로 고정**: 외부 변경이 편집 내용을 덮어쓰지 않고, 상세의 `files[].version`과 비교해 "이 파일이 다른 곳에서 바뀌었습니다"만 띄운다(계약 4절).
- **편집 중 스냅샷 삭제**: 상세 404가 와도 마지막 상세를 유지해 편집기를 살려 두고 "스냅샷이 없습니다" 창에서 편집 내용 복사만 제공(디자인 6.5).
- **이탈 방지는 전역 캡처 리스너**: 사이드바·브레드크럼 링크는 퍼블리셔 컴포넌트라 Link `onNavigate`를 달 수 없다. window 캡처 단계에서 같은 출처 링크 클릭만 가로채고 새 탭 열기·해시 이동은 막지 않는다.
- **목록은 전체를 한 번 받아 브라우저에서 필터·정렬**(계약 6.2 허용). 상태 정렬은 서버 상태 순서만 쓰고 다시 판단하지 않는다.
- **사이드바 스냅샷 메뉴의 stale**: 서버 `summary.status.stale` 또는 heartbeat 45초 무수신. kube 출처 stale(watchStale)은 섞지 않았다(로컬 파일과 무관).
- **상세 화면의 CLI 재스캔 명령**은 계약 6.2 `cli.scan`과 같은 고정 문구(`DEFAULT_CLI`)에 ID를 채운다. 상세 응답에는 `cli` 블록이 없다(아래 backend 요청).
- **"휴지통 N" 헤더 액션은 링크(text-link)**: 디자인은 ghost 버튼이지만 페이지 이동이라 `<a>`가 맞고, 링크 모양 버튼 컴포넌트가 없다(publisher 요청).
- **비활성 아이콘 버튼**: `IconButton`에 비활성 사유가 없어 `aria-disabled` + 라벨에 사유 + 인라인 색으로 처리했다(publisher 요청).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0 errors, 0 warnings) | |
| `npx tsc --noEmit -p apps/web` (`apps/web/node_modules/.bin/tsc`) | 통과 (0건) | 기존 fixtures 오류 3건 해소. 루트에서 `npx tsc`는 typescript 미설치 안내가 떠서 apps/web의 tsc로 실행 |
| `npx vitest run` (apps/web 전체) | 13 files, **194 passed** | 새 41건(model 24, pages 17) 포함, 기존 153건 유지 |
| `NEXT_PUBLIC_API_URL=http://localhost:3011 next build` | 통과 | `/snapshots`(static), `/snapshots/[id]`(dynamic), `/snapshots/trash`(static) |
| api mock `:3011`(`npm run start:dev`, PORT=3011, DATA_SOURCE=mock, CORS_ORIGIN=http://localhost:3012) + web `next start -p 3012` | 통과 | PID 8756(:3100 next dev)과 같은 폴더라 dev 대신 build+start로 띄움(지시대로 우회). 8756은 건드리지 않음 |
| HTTP: 페이지 SSR | 200 | `/snapshots`, `/snapshots/20260919-031500`, `/snapshots/trash`, `/snapshots/..%2Fetc`(→ "올바른 스냅샷 ID가 아닙니다" SSR) |
| HTTP: Origin `http://localhost:3012`로 UI 요청 순서 재현 | 통과 | CORS preflight PUT/DELETE 204 · 목록 9개 critical 3 · 파일 조회 · check(`secret_errors` 필요) · PUT 확인 없음 422 → `confirm` 넣어 200(critical 유지, modifiedByDashboard) · 옛 baseVersion 409 · text/plain 415 · refresh `{}` 200 · 라벨·메모 422(값 누출 없음)/200/409 · DELETE 확인 불일치 400/진행 중 409/200 → 상세 404 → 복원 200 · 휴지통 영구 삭제 200 · 시나리오 read-only/not-configured/conflict-once/default |
| HTTP: SSE `topics=overview,aws-snapshots` | 통과 | `aws-snapshots.snapshot` 수신, 라벨 저장 후 `aws-snapshots.changed`(changedIds) 수신, 라벨 원문 없음 |
| 헤드리스 Chrome(DevTools 프로토콜, scratchpad 전용 프로필) 실제 렌더·조작 | **37항목 모두 통과, 콘솔·네트워크 오류 0** | 목록 로드·MOCK·커밋 금지·필터 URL·사이드바 `커밋 금지 3개` 배지 / 상세 A~E·발견 클릭→terraform 탭 / 편집→원본 편집 안내→저장 전 확인(오류 남음)→저장→재스캔 문구·커밋 금지 유지 / conflict-once → 충돌 창(덮어쓰기 버튼 없음)→고정 경고 / 브레드크럼 클릭 → 이탈 확인 → 버리기 → 목록 / 진행 중·메타 손상·5.5MB 보기 전용 / 휴지통 / not-configured UnknownState + 사이드바 상태 아이콘 없음 / read-only Banner |
| 종료 | 자기 PID만 | api(nest watch 17904 → 1532 → 23292), web(npx 17348 → 1496 → 23484), 헤드리스 Chrome(21712 트리, CDP 실행분은 스크립트가 종료)을 `taskkill /PID … /T`로 종료. :3011·:3012 해제 확인, :3100(8756) 그대로 |
| 화면 폭별(1024/1280/1440)·다크 테마 시각 확인 | **생략** | 1440×1000 헤드리스로 텍스트·동작만 확인, 스크린샷 비교·반응형 레이아웃 확인은 하지 않음 |

**수용 기준 확인 현황 (프론트 관점)**
- 확인함(테스트·HTTP·브라우저): AC-01, 04(시나리오 전환: not-configured·read-only·conflict-once는 브라우저, empty는 테스트, unavailable·write-disabled는 단위 테스트·API 응답만), 05, 06, 07, 11, 12, 13, 14, 15(탭 `파일 없음`은 단위 테스트), 16·17(진행 중 표시·비활성), 18(사유 문구는 서버 값 표시), 21, 22, 23, 25(서버 재스캔 결과 표시), 30, 31(탭 전환·앱 안 링크), 32, 33, 34, 35, 37, 38, 39, 40(화면 ID 검사 + 서버 400), 45, 47, 51.
- 부분·미확인: AC-24(경고만 저장 경로는 코드·문구 단위 테스트만, 브라우저 미확인), AC-26·27(YAML 구문·리소스 감소 확인 창은 코드만, 실제 데이터로 미확인), AC-36(서버 400 → 필드 오류 표시 코드만), AC-31의 브라우저 뒤로/앞으로(막을 수 없음, 아래 7절).
- 프론트 범위 밖(백엔드·인프라): AC-02·03·08·09·10·20·28·29·41~44·46·48~50 — backend 보고서 참고. 화면은 서버 값을 그대로 쓴다.

### 7. 남은 이슈·한계
- **브라우저 뒤로/앞으로(popstate)는 이탈 확인을 못 한다**(App Router에 차단 API 없음). 앱 안 링크·탭 닫기·새로고침만 막는다.
- 디자인 3.4 "새 행 1500ms 강조"·"재정렬 보류"(status.md 5.2)는 구현하지 않았다(행은 즉시 반영). 라벨·메모 저장 후 상세 요약 카드 1500ms 강조는 구현.
- 가상 스크롤은 행 200개 초과에서만 켠다(DataTable `virtualized`). 수백 개 규모 실측은 안 함.
- 기본 편집 엔진: 편집 중 줄 바꿈 없음, 보기 모드 드래그 선택으로 화면 밖 줄 복사 불가(publisher 보고서 7절과 같음). 5 MB 편집 입력 지연은 실측하지 않음.
- 스캔 패널 높이를 편집기 작업 영역과 정확히 맞추지 않았다(발견 목록 최대 360px 내부 스크롤). 1024~1279px에서 D 머리를 E 위 한 줄 띠로 올리는 배치(디자인 10절)는 하지 않고 세로로 쌓기만 한다.
- `apps/web/.next`(production build 산출물)가 `NEXT_PUBLIC_API_URL=http://localhost:3011`로 빌드된 상태다. 이 산출물로 `next start`를 하면 3011을 부른다. 다른 용도로 쓰기 전에 다시 `npm run build`가 필요하다(`next dev`의 `.next/dev`에는 영향 없음).
- 검증 중 `npm run start:dev --prefix apps/api`(nest watch)가 `apps/api/dist`를 다시 빌드했다(내용 변경 없음, backend 영역 산출물).

### 8. 다른 담당 요청
- `publisher 요청`
  1. `IconButton`에 `disabledReason`(aria-disabled + 사유 툴팁 + `text.disabled` 색) 추가. 지금은 표 동작 열·줄 바꿈 토글에서 라벨에 사유를 붙이고 인라인 색으로 흉내 낸다(`features/aws-snapshots/shared.tsx` `RowActionButton`, `TemplateEditor.tsx`).
  2. 링크 모양 버튼(ghost md `href`) — 목록 헤더 `휴지통 3`을 디자인대로 ghost 버튼 모양으로 두려면 필요. 지금은 `text-link` 링크.
  3. `Chip`에 `tooltip` prop — `보기 전용`·`strict`·`raw 데이터` 칩 툴팁을 지금은 감싼 `span title`로 준다.
  4. `Card`에 편집 모드 테두리(2px `accent.default`) variant — 지금은 인라인 style.
- `backend 요청`
  1. (선택) 상세 응답(6.3) 또는 요약(6.1)에 `cli` 블록을 넣어 주면 상세 화면 재스캔 명령을 고정 문구 대신 서버 값으로 쓸 수 있다.
  2. (선택) `EXPORT_MAYBE_IN_PROGRESS` 안내의 "12분 전"은 지금 `lastModifiedAt` 기준 상대 시각으로 만든다. 판단 기준 시각(폴더 재귀 mtime 최댓값)이 따로 있으면 필드로 주면 정확해진다.
- `designer 요청`(확인만): ① 편집 중 줄 바꿈 토글 비활성 표시 방식 ② 헤더 `휴지통`을 링크로 둔 점 ③ 브라우저 뒤로/앞으로는 이탈 확인이 없는 점.
- `PM 요청`: 1024/1280/1440px·다크 테마 실제 화면 확인(스크린샷 비교)을 검증 단계에서 해 주세요. `.next` production 산출물은 3011 기준이므로 필요하면 다시 빌드.

### 9. 다음 담당이 알아야 할 점
- 진입점: `app/snapshots/**` → `features/aws-snapshots/{SnapshotListPage,SnapshotDetailPage,TrashPage}.tsx`.
- 스트림: `aws-snapshots`는 `BASE_TOPICS`라 페이지에서 따로 `useTopics`하지 않는다. 재조회 키는 `useSnapshotsView()`의 `seq`/`resetSeq`/`changedSeq(id)`/`removedSeq(id)`/`trashSeq`.
- 편집 상태는 `useTemplateEditor()` 한 곳에 있다(탭·대상 줄·세션·확인 창·충돌·이탈). 스캔 패널은 같은 컨트롤러의 `selectFinding`을 쓴다.
- 쓰기 요청 추가 시 `api.ts`처럼 객체 본문(JSON) 또는 `{}`를 보낸다. 서버 Origin 검사가 있어 web 주소가 api `CORS_ORIGIN`에 있어야 한다(로컬 검증 시 `CORS_ORIGIN=http://localhost:3012`).
- 테스트: `features/aws-snapshots/pages.test.tsx`는 `@/lib/api`의 `apiFetch`를 가로채 호출(경로·메서드·본문·쿼리)을 기록한다. 픽스처는 `features/__fixtures__/snapshots.ts`.
- 브라우저 검증 스크립트(DevTools 프로토콜)는 커밋하지 않았다(작업용 scratchpad). 필요하면 같은 방식으로 `chrome --headless=new --remote-debugging-port`를 쓰되 전용 `--user-data-dir`와 자기 PID 종료를 지킨다.

## 2026-09-19 20:05 · 후속: 뒤로 가기 가드, publisher 새 prop, backend 새 필드, 화면 폭·테마 확인

### 1. 요청 내용
- PM 후속 4건
  1. designer 수정 요청(AC-31): 저장 안 한 편집이 있으면 `history.pushState`로 가드를 쌓는다. popstate가 오면 가드를 다시 쌓고 6.4 확인 창(`계속 편집`/`변경 버리기`)을 띄운다. 버리기면 가드를 치우고 이전 페이지로 간다. 저장·편집 취소 때 가드를 제거한다. 테스트와 헤드리스 확인을 함께 한다.
  2. publisher 새 prop 적용: `IconButton disabled disabledReason`, `ButtonLink`, `Chip tooltip`, `Card editing`.
  3. backend 새 필드 적용: 상세 `cli.scan`, `exportInProgress`(untilAt 등). 버튼 활성은 계속 `actions`를 따른다.
  4. 시각 확인: 목록·상세·편집 중·휴지통 × 1024/1280/1440 × 라이트/다크 스크린샷을 찍는다. 내 영역의 깨짐은 직접 고친다.

### 2. 참고한 문서
- `docs/reports/aws-snapshot-manager/publisher.md` 19:44 섹션 (새 prop)
- `docs/api/aws-snapshot-manager.md` 5절 `ExportProgress`, 6.1·6.3 `cli`, 18절 변경 이력
- `docs/design/aws-snapshot-manager.md` 6.4
- `apps/web/node_modules/next/dist/client/components/app-router.js` (Next의 pushState 패치·popstate 처리)

### 3. 작업 내용
1. **브라우저 뒤로 가드** (`hooks.ts` `useLeaveGuard`, `TemplateEditor.tsx`)
   - 변경이 생기면 같은 URL로 가드 항목을 push한다. 상태는 `{ sentinelSnapshotEditGuard: <토큰> }`이고, Next 내부 상태(`__NA`·트리)는 Next의 pushState 패치가 복사한다.
   - 뒤로 가기(popstate)가 오면 가드를 다시 push해 URL과 화면을 그대로 두고, 확인 창(`back`)을 띄운다.
   - `변경 버리기`면 `history.go(-2)`로 가드와 현재 항목을 건너 이전 페이지로 간다.
   - 앱 안 링크 이동을 확인한 뒤에는 `router.replace(href)`로 가드 항목 자리를 새 페이지로 바꾼다. 그래서 뒤로 가면 편집하던 페이지로 돌아온다.
   - 저장·편집 취소, 또는 내용을 원래대로 되돌려 변경이 없어지면 `history.back()`으로 가드를 치운다. 이때 생기는 popstate는 무시한다.
   - 가드마다 토큰을 붙여 앞으로 가기로 자기 가드에 돌아온 경우와 구분한다. 다른 화면이 남긴 가드와도 구분된다.
   - "스냅샷이 없습니다" 창의 `목록으로`도 같은 경로(`leaveTo`)를 쓴다.
2. **publisher 새 prop**
   - `RowActionButton`과 줄 바꿈 토글 → `IconButton disabled disabledReason`. 줄 바꿈 사유는 `편집 중에는 줄 바꿈을 쓸 수 없습니다`.
   - 목록 헤더 휴지통 → `ButtonLink`(icon `trash-2`, suffix 개수).
   - `span title`로 감싸던 칩 → `Chip tooltip`(보기 전용, strict, raw 데이터).
   - 편집기 Card 인라인 style → `Card editing`.
3. **backend 새 필드**
   - `types.ts`: `ExportProgress`, `SnapshotListItem.exportInProgress`, `SummaryResponse.cli`, `DetailResponse.cli` 추가.
   - 상세 재스캔 명령은 `data.cli.scan`을 쓴다. 필드가 없는 옛 응답이면 고정 문구로 대신한다.
   - 진행 중 안내는 `exportInProgress.active`일 때 보인다. 문구는 `lastChangeAt` 상대 시각 + `untilAt`(`HH:mm까지(30분 기준)`)으로 만든다.
   - 버튼 활성·비활성은 그대로 `actions`를 따른다.
4. **레이아웃 수정** (스크린샷에서 발견, 내 영역)
   - 목록 표가 1440px에서도 오른쪽 열(마지막 수정·former2·동작)이 잘렸다. 리전·범위 열이 줄바꿈 없는 범위 문구 때문에 늘어난 것이 원인이다. 열 `maxWidth` 176과 1줄 말줄임(블록 + 최대 폭)을 넣고, 스냅샷 열 `maxWidth` 240, 라벨 말줄임을 추가했다.
   - 상세의 판단 사유·한계 문구·CLI 안내·폴더 목록에서 아이콘과 글이 세로로 나뉘었다. `.row-start`/`.row-end`가 `.row`와 함께 써야 하는 수식 클래스인데 단독으로 썼기 때문이다. 모두 `row row-start` / `row row-end`로 고쳤다.
5. **테스트**
   - `pages.test.tsx` 2건 추가: ① 뒤로 → 확인 창 → 계속 편집이면 URL·내용 유지 → 다시 뒤로 → 버리기면 `history.go(-2)` ② 변경을 되돌리면 가드 제거(`history.back`).
   - 기존 테스트를 새 동작에 맞췄다: 링크 이동은 `router.replace`, 비활성 버튼 이름은 사유 없이 라벨만 두고 사유는 `aria-describedby`로 확인.
   - 픽스처에 `exportInProgress`·`cli`를 추가했다.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/src/features/aws-snapshots/hooks.ts` | 수정 | `useLeaveGuard`에 history 가드, `leaveTo`/`leaveBack` |
| `apps/web/src/features/aws-snapshots/TemplateEditor.tsx` | 수정 | 뒤로 확인(`back`), 가드 연동, `Card editing`, 줄 바꿈 `disabledReason`, `Chip tooltip` |
| `apps/web/src/features/aws-snapshots/SnapshotDetailPage.tsx` | 수정 | `cli.scan`, `exportInProgress` 안내 |
| `apps/web/src/features/aws-snapshots/SnapshotListPage.tsx` | 수정 | `ButtonLink`, 리전·범위/스냅샷 열 폭·말줄임 |
| `apps/web/src/features/aws-snapshots/shared.tsx` | 수정 | `RowActionButton` → `IconButton disabledReason`, `row` 클래스 수정 |
| `apps/web/src/features/aws-snapshots/DetailSections.tsx` | 수정 | `Chip tooltip`, `row` 클래스 수정 |
| `apps/web/src/features/aws-snapshots/dialogs.tsx` | 수정 | raw 칩 `tooltip`, `row` 클래스 수정 |
| `apps/web/src/features/aws-snapshots/types.ts` | 수정 | `ExportProgress`, `cli` |
| `apps/web/src/features/aws-snapshots/pages.test.tsx` | 수정 | 가드 테스트 2건, 기대값 갱신 |
| `apps/web/src/features/__fixtures__/snapshots.ts` | 수정 | `exportInProgress`, 상세 `cli` |

### 5. 주요 결정과 이유
- **링크 확인 후 `router.replace`**: 가드 항목을 그대로 두고 push하면 뒤로 가기가 한 번 더 필요하다(같은 URL 두 번). replace로 가드 자리를 새 페이지로 바꾸면 history가 편집 전과 같은 모양이 된다.
- **가드 토큰**: 테스트(jsdom)와 실제 브라우저 모두에서 이전 편집이 남긴 가드 항목에 뒤로 가서 닿을 수 있다. `true` 표식만 보면 이를 "앞으로 가기로 자기 가드에 돌아옴"으로 오인해 확인 창을 건너뛴다. 그래서 push할 때마다 고유 토큰을 쓴다.
- **Next 호환**: Next 16의 pushState 패치가 `__NA`·트리를 가드 항목에 복사한다. 따라서 가드 항목으로 오가는 popstate는 Next가 같은 URL 복원으로 처리하고 새로고침하지 않는다(코드로 확인).
- 편집 중 삭제 버튼(휴지통 이동) 뒤 `router.push`는 가드 경로를 거치지 않는다. 이 경우 가드 항목(같은 URL)이 history에 하나 남을 수 있다. 영향은 뒤로 가기 한 번이 더 필요한 정도라 남은 이슈로 둔다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/web` | 통과 (0/0) | |
| `apps/web/node_modules/.bin/tsc --noEmit -p apps/web` | 통과 | |
| `npx vitest run` (apps/web) | 14 files, **203 passed** | 새 가드 테스트 2건 포함 (publisher 새 테스트 포함) |
| `NEXT_PUBLIC_API_URL=http://localhost:3011 next build` | 통과 | 레이아웃 수정 후 다시 빌드 |
| 헤드리스 Chrome 가드 확인 (1440 라이트) | 8항목 통과, 콘솔·네트워크 오류 0 | 뒤로 → 확인 창 / 계속 편집 → URL·내용 유지 / 다시 뒤로 → 버리기 → `/snapshots` / 편집 취소 뒤 뒤로 → 확인 없이 이동 / 진행 중 `untilAt` 문구 / `cli.scan` 명령 |
| 스크린샷 24장 | 저장 | `C:\Users\thing\AppData\Local\Temp\claude\c--myscript-sentinel\9fb3458f-20c8-41d4-acf1-bc5178a75b8e\scratchpad\shots\` `{list,detail,edit,trash}-{1024,1280,1440}-{light,dark}.png` (상세·편집은 스캔 오류가 있는 `20260919-031500`) |
| 스크린샷 검토 | 1차에서 깨짐 2건 → 수정 후 재촬영 | 목록 표 오른쪽 잘림, 아이콘·글 세로 분리(4절). 재촬영본에서 목록은 1440에서 전체 열이 들어가고 1024에서 상세가 세로로 쌓인다. 다크 대비 문제는 눈에 띄지 않았다 |
| 서버 | api `:3011`(nest watch 7520 트리), web `:3012`(build+start, 27684 → 24264 트리) | 8756(:3100)과 다른 에이전트의 nest(11396)는 건드리지 않음. 종료 뒤 :3011·:3012 해제 확인 |

- 촬영 1차에서 상세 화면이 모두 "API 응답 시간 초과(10초)"로 나왔다. API는 정상(curl 0.08초)이었다. 원인은 헤드리스 Chrome이 이전 페이지의 SSE 연결을 bfcache로 붙잡아 호스트당 연결 상한(6)이 찬 것으로 판단했다. `--disable-features=BackForwardCache`와 페이지 사이 `about:blank` 이동으로 해결했다. 실제 사용에서도 같은 호스트의 탭을 많이 열면 SSE가 연결을 차지하는 일반적인 한계가 있다(이 기능 고유 문제는 아님).
- 종료 중 PowerShell로 PID를 찾을 때 출력에 `\r`이 붙어 첫 `taskkill` 호출들은 실행되지 않았다. 그 목록에는 조회 명령 자신의 셸 프로세스가 섞여 있었다. 이후 부모 체인을 따라 확인한 내 PID(24264 트리)만 종료했다.

### 7. 남은 이슈·한계
- **빌드 산출물 주소**: `apps/web/.next`(production build)가 `NEXT_PUBLIC_API_URL=http://localhost:3011`로 빌드된 채 남아 있다. 이 산출물로 `next start` 하면 브라우저가 :3011을 부른다. 다른 용도로 쓰기 전에 `npm run build --prefix apps/web`(원하는 API 주소)로 다시 빌드해야 한다. `next dev`에는 영향이 없다.
- 직전 대비 열(80px)은 `−18 / −17`처럼 두 줄로 줄바꿈된다. 디자인 폭을 지키느라 그대로 두었다(designer 확인).
- 편집 중 삭제로 목록에 이동하면 가드 항목이 history에 하나 남을 수 있다(5절).
- 탭 닫기·새로고침은 계속 브라우저 기본 확인(`beforeunload`)을 쓴다.

### 8. 다른 담당 요청
- `designer 요청`(확인만): 직전 대비 열 80px에서 두 줄 줄바꿈되는 모양을 허용할지 판단해 주세요.
- `PM 요청`: `.next` production 산출물이 :3011 기준이다. 다른 검증에 쓰기 전에 다시 빌드해 주세요.
- publisher 요청 없음. 스크린샷에서 UI 컴포넌트 자체의 깨짐은 보지 못했다.

### 9. 다음 담당이 알아야 할 점
- 이탈 방지는 `useLeaveGuard(active, onAttempt, navigate)` 하나로 처리한다. `onAttempt`는 `{type:"href"}`나 `{type:"back"}`을 받는다. 확인 뒤에는 반환된 `leaveTo(href)` / `leaveBack()`을 쓴다. 직접 `router.push`하면 가드 항목이 남는다.
- history 가드 표식 키: `HISTORY_GUARD_KEY = "sentinelSnapshotEditGuard"`(값은 토큰 문자열).
