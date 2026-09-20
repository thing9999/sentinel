# bootstrap · frontend 작업 보고

> 파일 위치: `docs/reports/bootstrap/frontend.md`

## 2026-09-19 10:53 · apps/web 뼈대(scaffold)

### 1. 요청 내용
- PM 요청: `apps/web`에 Next.js(App Router, TS strict, ESLint, `src/`, alias `@/*`, Tailwind 없음) 뼈대만 생성. 기능 화면 로직은 만들지 않음.
- 이번에 한해 `apps/web` 루트 설정 파일과 `src/` 폴더 구조 생성 권한 (퍼블리셔 영역 `components/ui`, `styles`는 빈 파일·최소 리셋만).
- 포함 범위: 스크립트(dev/build/start/lint/typecheck), `src/lib/api.ts` fetch 래퍼, `src/lib/sse.ts` SSE 구독 훅 뼈대, 라우트 뼈대(`/`, `/cluster`, `/cost`, `/advisor`), 공통 레이아웃 상단 내비, vitest + SSE 순수 로직 테스트.
- 제외: 차트 라이브러리 설치, git 초기화.

### 2. 참고한 문서
- `CLAUDE.md`, `.claude/agents/frontend.md`, `docs/HANDOFF.md`
- `docker-compose.yml` (web 환경 변수 `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL`), `apps/web/Dockerfile.dev` (node:22)
- `node_modules/next/dist/docs/` (Next 16: `connection()`, 환경 변수 인라인 규칙)
- `docs/api/*`는 아직 비어 있음 → `/api/health` 응답 형식은 계약 없이 방어적으로 처리

### 3. 작업 내용
1. `apps/web`가 비어 있지 않아(Dockerfile.dev, .dockerignore) scratchpad 임시 폴더에서 `create-next-app@latest` 실행 (`--ts --eslint --app --src-dir --no-tailwind --import-alias "@/*" --use-npm --skip-install --disable-git --no-turbopack`) 후 복사. 기존 두 파일 유지. 생성된 버전: **Next 16.3.5, React 19.2.8, ESLint 9 (flat config)**.
2. 템플릿 잔여물 삭제: `public/*.svg`, `page.module.css`, 기본 `globals.css`, `README.md`, 기본 페이지. `public/`은 빈 폴더라 제거.
3. `npm install` → vitest 추가 시 `@types/node@^20`과 vitest 5 peer 충돌 → `@types/node`를 `^22`로 올림 (Dockerfile.dev 런타임 node:22와 일치).
4. `package.json`: 이름 `@sentinel/web`, 스크립트 `dev/build/start/lint/typecheck/test/test:watch`, `engines.node >=22`.
5. `next.config.ts`: `turbopack.root`를 `apps/web`으로 고정. (상위 `C:\myscript\package-lock.json` 때문에 워크스페이스 루트를 잘못 추론하는 경고가 났음)
6. 폴더 구조
   - `src/app` (layout, `/`, `/cluster`, `/cost`, `/advisor`)
   - `src/features/{cluster-status,aws-cost,architecture-advisor}/index.ts` (빈 모듈)
   - `src/charts/index.ts` (빈 모듈)
   - `src/components/ui/index.ts` (퍼블리셔 영역, `export {}`만)
   - `src/styles/globals.css` (퍼블리셔 영역, box-sizing·margin·폰트 상속 등 최소 리셋만)
   - `src/lib` (api, sse, sse-core, health)
7. `src/lib/api.ts`
   - `getApiBaseUrl()`: 서버 `API_INTERNAL_URL` → `NEXT_PUBLIC_API_URL` → `http://localhost:3001`, 브라우저 `NEXT_PUBLIC_API_URL` → 기본값.
   - `apiUrl(path, query?)`: `<base>/api<path>` 생성.
   - `apiFetch<T>(path, { query, body, timeoutMs(기본 10s), signal, ...RequestInit })`: `cache: "no-store"` 기본, 객체 body는 JSON 직렬화, 응답 JSON 파싱.
   - `ApiError` (`kind: network | timeout | http | parse | aborted`, `url`, `status?`, `body?`), `isApiError()`.
8. `src/lib/sse-core.ts` (순수 로직, 테스트 대상)
   - `computeBackoffDelay(attempt, {baseMs=1000, maxMs=30000, factor=2, jitter=0.2}, random)`
   - `createBatcher(onFlush, scheduler)`: 한 프레임에 쌓인 이벤트를 한 번에 flush (`push/flush/clear/size`)
   - `createFrameScheduler()`: rAF, 없으면 setTimeout(16)
   - `latestReceivedAt(items)`, 타입 `ConnectionStatus = "connecting" | "open" | "disconnected"`
9. `src/lib/sse.ts` — `useEventSource<T>(path | null, { eventTypes, parse, onBatch, backoff, withCredentials, pauseWhenHidden })` → `{ status, lastEventAt, retryCount }`
   - 브라우저 기본 재연결 대신 `onerror`에서 닫고 지수 백오프로 직접 재연결, `onopen`에서 시도 횟수 초기화
   - `visibilitychange`: hidden이면 대기 중 재연결 취소·연결 닫음·남은 배치 flush·`disconnected`; visible이면 즉시 재연결
   - 이벤트는 rAF 단위로 묶어 `onBatch` 한 번 호출, `lastEventAt`도 배치당 한 번 갱신
   - `onBatch/parse/backoff`는 ref로 보관 → 참조가 바뀌어도 재연결하지 않음
10. `src/lib/health.ts`: `getHealth()` — `/api/health`를 3초 타임아웃으로 호출하고 `dataSource`(`mock|live`)만 방어적으로 읽음. 실패 시 `{ ok: false, error }`.
11. 라우트
    - `layout.tsx`: `lang="ko"`, 제목 템플릿 `%s · Sentinel`, 상단 `<nav>` 정적 링크 4개 (스타일 없음, `app-header/app-nav/app-main` 클래스만 부여)
    - `/`: 서버 컴포넌트, `await connection()`으로 요청 시 렌더(빌드 시 API 호출 안 함), API 상태·데이터 소스 모드 표시 + 세 기능 링크
    - `/cluster`, `/cost`, `/advisor`: 제목 + "준비 중"
12. `vitest.config.mts` (node 환경, `@` alias), `src/lib/sse-core.test.ts` 8개 테스트.
13. `apps/web/.env.example` 추가, `.gitignore`에 `!.env.example` 추가 (생성된 `.env*` 규칙이 example까지 무시하던 문제).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/web/package.json`, `package-lock.json` | 추가 | 의존성, 스크립트, engines |
| `apps/web/tsconfig.json` | 추가 | create-next-app 기본 (strict, `@/*` → `./src/*`) |
| `apps/web/eslint.config.mjs` | 추가 | next core-web-vitals + typescript (flat config) |
| `apps/web/next.config.ts` | 추가 | `turbopack.root` 고정 |
| `apps/web/vitest.config.mts` | 추가 | vitest 설정 |
| `apps/web/next-env.d.ts` | 추가 | Next 생성 파일 (gitignore됨) |
| `apps/web/.gitignore` | 추가 | 기본 + `!.env.example` |
| `apps/web/.env.example` | 추가 | `NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL` |
| `apps/web/AGENTS.md`, `apps/web/CLAUDE.md` | 추가 | create-next-app이 만든 Next 16 에이전트 안내 (`next dev`가 다시 생성함) |
| `apps/web/src/app/layout.tsx` | 추가 | 공통 레이아웃 + 상단 내비 |
| `apps/web/src/app/page.tsx` | 추가 | 개요 (health·dataSource, 기능 링크) |
| `apps/web/src/app/{cluster,cost,advisor}/page.tsx` | 추가 | "준비 중" 페이지 |
| `apps/web/src/app/favicon.ico` | 추가 | 템플릿 기본 아이콘 (퍼블리셔가 교체 가능) |
| `apps/web/src/lib/api.ts` | 추가 | fetch 래퍼, `ApiError` |
| `apps/web/src/lib/sse-core.ts` | 추가 | 백오프·배처 순수 로직 |
| `apps/web/src/lib/sse.ts` | 추가 | `useEventSource` 훅 |
| `apps/web/src/lib/sse-core.test.ts` | 추가 | 단위 테스트 8개 |
| `apps/web/src/lib/health.ts` | 추가 | `/api/health` 조회 |
| `apps/web/src/features/*/index.ts`, `src/charts/index.ts` | 추가 | 빈 모듈 |
| `apps/web/src/components/ui/index.ts` | 추가 | 퍼블리셔 영역, 빈 export |
| `apps/web/src/styles/globals.css` | 추가 | 퍼블리셔 영역, 최소 리셋 |
| `apps/web/Dockerfile.dev`, `.dockerignore` | 유지 | 변경 없음 |

### 5. 주요 결정과 이유
- **SSE 순수 로직을 `sse-core.ts`로 분리**: 훅 파일은 React·브라우저 API에 묶여 있어 테스트가 어렵다. 백오프·배칭을 주입 가능한 형태(`random`, `FrameScheduler`)로 분리해 jsdom 없이 node 환경 vitest로 검증.
- **브라우저 기본 재연결 대신 직접 백오프**: EventSource 기본 재연결은 간격 제어가 안 되고(서버 `retry:`에 의존) 상태 노출이 애매함. `onerror`에서 닫고 직접 재연결.
- **숨김 탭 상태를 `disconnected`로 표현**: 요청된 상태 3개만 유지. 별도 `paused` 상태는 두지 않음 (필요하면 디자인 확정 후 추가).
- **첫 연결을 `queueMicrotask`로 미룸**: React 19 hooks lint의 effect 내 동기 setState 규칙 회피 및 불필요한 이중 렌더 방지.
- **`@types/node` ^22**: vitest 5 peer 요구 + Docker 런타임 node:22와 일치. (로컬은 Node 24지만 22 API 기준으로 타입 체크하는 편이 안전)
- **`/` 는 `connection()`으로 동적 렌더**: 빌드 시점에 API가 없어도 빌드가 성공해야 하고, 모드는 요청마다 확인해야 하므로.
- **health 응답은 `unknown`**: 계약 문서가 없어 필드를 가정하지 않기 위해 `dataSource`만 방어적으로 읽고 없으면 "알 수 없음" 표시.
- **Tailwind·차트 라이브러리 미설치**: 지시대로. 스타일은 퍼블리셔 토큰 CSS 변수로.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint` | 통과 | 경고 0 |
| `npm run typecheck` | 통과 | `tsc --noEmit` |
| `npm test` | 통과 | 1 파일, 8 테스트 |
| `npm run build` | 통과 | `/` 동적(ƒ), 나머지 정적(○) |
| `next start` 스모크 (API 없음) | 통과 | `/`에 "API에 연결할 수 없음 (network)", `/cost`에 "준비 중" |
| `next start` 스모크 (스텁 API `{dataSource:"mock"}`) | 통과 | `/`에 "연결됨 · 데이터 소스: mock" (`API_INTERNAL_URL`로 호출 확인) |
| `useEventSource` 실제 SSE 연결 | 생략 | API SSE 엔드포인트가 아직 없음. 훅 자체 테스트(jsdom/EventSource 목)도 아직 없음 |
| `docker compose` 실행 | 생략 | 로컬에 Docker 없음 |

### 7. 남은 이슈·한계
- `useEventSource` 훅은 단위 테스트 없음 (순수 로직만 테스트). 실제 SSE 엔드포인트가 생기면 통합 확인 필요.
- 내비게이션 현재 위치 표시(active) 없음 — 클라이언트 컴포넌트가 필요하므로 디자인 확정 후.
- `NEXT_PUBLIC_API_URL`은 빌드 시 인라인되므로 이미지 하나로 여러 환경 배포 시 값이 고정됨. 배포(`deploy/`) 설계 시 고려 필요 (대안: Next Route Handler 프록시로 동일 출처 사용).
- CORS: 브라우저가 `http://localhost:3001`로 직접 호출(SSE 포함)하므로 API의 `CORS_ORIGIN` 설정이 필요 (compose에는 이미 있음).
- `favicon.ico`는 템플릿 기본값.

### 8. 다른 담당 요청
- `백엔드 요청`: `docs/api/`에 `GET /api/health` 계약 작성 — 최소 `{ status: "ok", dataSource: "mock" | "live" }`. 프론트는 현재 `dataSource`만 읽음.
- `백엔드 요청`: 모든 경로를 `/api` 전역 prefix 아래에 둘 것 (`app.setGlobalPrefix("api")`), CORS 허용 origin `http://localhost:3000` (Docker 없이 실행할 때도).
- `백엔드 요청`: SSE 계약에 이벤트 이름(`event:`), data JSON 형식, `id:`/`Last-Event-ID` 재전송 지원 여부, heartbeat(주석 라인) 주기를 명시. 프론트는 끊김 감지·재연결을 클라이언트에서 하므로 heartbeat 15~30초 권장. 스냅샷(초기 상태) 이벤트가 연결 직후 오는지도 명시.
- `퍼블리셔 요청`: `src/styles/globals.css`에 디자인 토큰(CSS 변수, 라이트/다크) 추가, 레이아웃 클래스 `app-header`, `app-nav`, `app-main` 스타일.
- `퍼블리셔 요청`: 연결 상태 배지(connecting/open/disconnected + "마지막 갱신 HH:mm:ss" 표시), 페이지 제목/섹션, "준비 중"·빈 상태·에러(API 연결 실패) 컴포넌트를 `components/ui`에 제공.

### 9. 다음 담당이 알아야 할 점
- 실행 (Docker 없이): `npm install --prefix apps/web` → `npm run dev --prefix apps/web` → http://localhost:3000 (API는 `npm run start:dev --prefix apps/api`, 기본 :3001)
- 검증: `npm run lint|typecheck|test|build --prefix apps/web`
- 환경 변수: `apps/web/.env.example` 참고 (`.env.local`로 복사). 브라우저 쪽은 `process.env.NEXT_PUBLIC_API_URL`을 **리터럴로** 참조해야 인라인된다.
- API 호출: `apiFetch<T>("/cluster/summary")` → `<base>/api/cluster/summary`. 실패는 `ApiError`의 `kind`로 분기.
- SSE: 클라이언트 컴포넌트(`"use client"`)에서
  ```ts
  const { status, lastEventAt } = useEventSource<Payload>("/cluster/stream", {
    eventTypes: ["snapshot", "pod"],
    onBatch: (events) => dispatch(events),
  });
  ```
  `onBatch`는 프레임당 1회 호출된다. 경로가 `null`이면 구독하지 않는다.
- Next 16 사용 중 — API가 학습 데이터와 다를 수 있으므로 `apps/web/node_modules/next/dist/docs/`를 먼저 확인 (`apps/web/AGENTS.md` 참고).
- 테스트 파일은 `src/**/*.test.ts(x)`, node 환경. 컴포넌트 테스트가 필요하면 jsdom 환경 추가 필요.
