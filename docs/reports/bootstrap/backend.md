# bootstrap · backend 작업 보고

> 파일 위치: `docs/reports/bootstrap/backend.md`

## 2026-09-19 11:05 · api·agent-bridge 뼈대(scaffold)

### 1. 요청 내용
- PM이 요청. 기능 구현 전 **뼈대만** 만든다. cluster / db-health / cost / advisor 로직은 만들지 않는다(명세 병렬 작성 중).
- A. `apps/api`(NestJS): strict TS, ESLint + Prettier, Jest, `@nestjs/config` 검증, `main.ts` 전역 설정, `GET /api/health`, Prisma 뼈대(모델 없음) + 연결 실패 시 경고만 남기는 `PrismaService`, 앞으로 쓸 의존성 미리 설치, 빈 모듈 구조, 루트 `.env.example`·`docker-compose.yml` 변수 추가.
- B. `apps/agent-bridge`(호스트 Node 서비스 :3002): Fastify + Claude Agent SDK, `GET /health`, `POST /v1/ping-agent`, 안전 옵션을 `src/agent/options.ts` 한 곳에 모으고 테스트로 고정, `BRIDGE_HOST`·`BRIDGE_TOKEN` 지원, 실제 ping 확인.
- 환경: Windows 11, Node 24.16, npm 11. Docker 없음 → lint/test/build + 로컬 부팅으로 검증.

### 2. 참고한 문서
- `.claude/agents/backend.md`, `CLAUDE.md`("확정된 결정"), `docs/HANDOFF.md`, `docs/reports/TEMPLATE.md`
- SDK 타입 정의: `apps/agent-bridge/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (v0.3.277). `Options`(1449행~), `query()`(3040행), `SDKResultSuccess`/`SDKResultError`(5357행~), `SDKSystemMessage`(init, 5580행), `PermissionMode`, `SettingSource`
- Prisma 7 `prisma init` 결과물(스크래치 폴더에서 생성해 구조만 확인)

### 3. 작업 내용

#### A. `apps/api`
1. `@nestjs/cli@11 new`를 임시 폴더에 `--skip-git --package-manager npm --strict`로 만들고 `apps/api`로 복사(`Dockerfile.dev`, `.dockerignore` 유지). 샘플 AppController/Service/spec와 README는 삭제.
2. `tsconfig.json`에 `"strict": true`(개별 strict 플래그 대신). ESLint 9 flat config(typescript-eslint type-checked + prettier), `prisma.config.ts`·`dist`·`src/database/generated` 제외.
3. 설정: `src/config/env.validation.ts` — class-validator 기반 `EnvironmentVariables` + `validateEnv()`.
   - 기본값: `PORT=3001`, `DATA_SOURCE=mock`(mock|live만 허용), `CORS_ORIGIN=http://localhost:3000`, `AGENT_BRIDGE_URL=http://localhost:3002`, `COST_EXPLORER_CACHE_TTL_SEC=21600`
   - 선택: `DATABASE_URL`, `KUBECONFIG`, `MONITOR_DB_URL`, `PROMETHEUS_URL`, `AWS_REGION`, `AWS_PROFILE`, `AGENT_BRIDGE_TOKEN`
   - 빈 문자열은 "설정 안 됨"으로 처리(compose의 `${VAR:-}` 대응). 문자열 숫자는 숫자로 변환.
   - `ConfigModule.forRoot({ isGlobal, cache, envFilePath: ['.env', '../../.env'], validate })` — 로컬 실행 시 루트 `.env`도 읽는다.
4. `src/main.ts`: 전역 prefix `api`, `ValidationPipe({ whitelist: true, transform: true })`, CORS(`CORS_ORIGIN`, 쉼표로 여러 개 가능), `enableShutdownHooks()`.
5. `src/common/`: `DATA_SOURCE_MODE` 주입 토큰(`CommonModule`, 전역), 헬퍼 `shouldUseMock(mode, sourceConfigured)`, `isKubeConfigured()`(KUBECONFIG 또는 클러스터 안 `KUBERNETES_SERVICE_HOST`), `isAwsConfigured()`(AWS_REGION).
6. `src/health/`: `GET /api/health` → `{ status, dataSource, uptimeSec, checks: { db, kube, aws, agentBridge } }`. 각 체크는 `configured | not_configured`(설정 여부만, 연결 확인은 이후).
7. Prisma 7.10.0 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`):
   - `prisma/schema.prisma`: generator(`prisma-client`, `moduleFormat = "cjs"`, output `../src/database/generated/prisma`) + datasource(postgresql)만. **모델 없음**(DBA 몫).
   - `prisma.config.ts`: Prisma 7은 datasource URL을 schema가 아니라 여기서 받는다(`DATABASE_URL`).
   - `src/database/prisma.service.ts` + `prisma.module.ts`(전역): pg 드라이버 어댑터 사용. `DATABASE_URL`이 없으면 연결 시도 없이 경고, 연결 실패(`SELECT 1`)면 경고만 남기고 부팅 계속. `isConnected` getter 제공. 연결 타임아웃 5초.
   - `postinstall: prisma generate`, `prisma:generate` 스크립트. 생성물은 `.gitignore`.
8. 빈 모듈: `cluster`, `db-health`, `stream`, `cost`, `advisor` — 각각 빈 `@Module({})`로 AppModule에 등록. `ScheduleModule.forRoot()` 등록.
9. 미리 설치: `@kubernetes/client-node@2`, `pg`, `@aws-sdk/client-pricing`, `client-cost-explorer`, `client-ec2`, `client-elastic-load-balancing-v2`, `client-eks`, `credential-providers`, `class-validator`, `class-transformer`, `@nestjs/schedule@6`, `@nestjs/config@4`.
10. Jest: `moduleNameMapper`(`./x.js` → `./x`, Prisma 생성 코드용), `--experimental-vm-modules`로 실행(ESM 전용 패키지 로드용, 아래 결정 참고). 단위 테스트 3개 파일 + e2e 1개(`GET /api/health`).
11. `Dockerfile.dev`: postinstall의 `prisma generate`가 `npm ci` 단계에서 돌 수 있도록 `prisma/`, `prisma.config.ts`를 먼저 복사하게 최소 수정. `.dockerignore`에 `coverage`, `src/database/generated` 추가.
12. 루트 `.env.example`: `DATA_SOURCE`, `AWS_REGION`, `AWS_PROFILE`, `AWS_CONFIG_HOST_PATH`, `COST_EXPLORER_CACHE_TTL_SEC`, `AGENT_BRIDGE_URL`, `AGENT_BRIDGE_TOKEN` 추가(비밀값 없음).
13. 루트 `docker-compose.yml` api 서비스: 위 변수 추가, `AGENT_BRIDGE_URL: http://host.docker.internal:3002`, `extra_hosts: ["host.docker.internal:host-gateway"]`, `${AWS_CONFIG_HOST_PATH:-~/.aws}:/root/.aws:ro` 마운트.

#### B. `apps/agent-bridge`
1. ESM TypeScript 패키지(`"type": "module"`), Fastify 5, `@anthropic-ai/claude-agent-sdk@0.3.277`. 스크립트: `dev`(tsx watch), `build`(tsc), `start`, `lint`, `lint:fix`, `test`(vitest).
2. `src/config.ts`: `BRIDGE_PORT`(3002), `BRIDGE_HOST`(기본 127.0.0.1), `BRIDGE_TOKEN`, `AGENT_MODEL`, `CLAUDE_CODE_PATH`. **토큰 없이 비루프백 호스트를 지정하면 127.0.0.1로 강제**(fail closed, 경고 로그).
3. `src/http/auth.ts`(onRequest 훅): 토큰이 있으면 `x-bridge-token` 헤더 일치(timingSafeEqual) 필수 → 401. 토큰이 없으면(로컬 전용 모드) 루프백 주소 요청만 허용 → 403.
4. `src/agent/options.ts` — **안전 설정 한 곳**(`buildAdvisorOptions`). 호출자는 `systemPrompt`, `model`, `maxTurns`(1~3으로 잘림), `effort`, `thinking`, `maxBudgetUsd`, `includePartialMessages`, `outputFormat`, `abortController`, `pathToClaudeCodeExecutable`만 조정 가능하고 아래 값은 마지막에 덮어써서 바꿀 수 없다:
   - `tools: []`(내장 도구 전체 비활성), `allowedTools: []`, `disallowedTools: [Bash, Read, Write, Edit, WebFetch, WebSearch, Agent, Task, Skill, ...]`(이중 방어)
   - `permissionMode: 'dontAsk'`(사전 승인 없는 도구는 거부), `permissionPrompts: 'none'`, `allowDangerouslySkipPermissions: false`
   - `settingSources: []`(user/project/local 설정·CLAUDE.md 미로드), `mcpServers: {}` + `strictMcpConfig: true`, `plugins: []`, `skills: []`
   - `persistSession: false`, `maxTurns` 기본 1, `cwd`: 임시 빈 폴더(`%TEMP%/sentinel-agent-bridge`)
   - `env`: `process.env`에서 `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`(로컬 로그인 강제), `BRIDGE_TOKEN`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` 제거 + `CLAUDE_AGENT_SDK_CLIENT_APP` 설정
   - `options.test.ts`로 위 값과 "overrides로 덮어쓸 수 없음"을 고정.
5. `src/agent/sdk-info.ts`: SDK 버전(package.json), Claude Code 실행 파일 존재 여부(SDK의 플랫폼 optional 패키지 `@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]`의 `claude(.exe)` 또는 `CLAUDE_CODE_PATH`).
6. `src/agent/ping.ts`: `query({ prompt: 'Reply with OK', options })`를 순회하며 `system/init`(세션·모델·버전·apiKeySource·권한 모드·도구 목록)과 `result`(subtype, is_error, duration_ms, duration_api_ms, num_turns, total_cost_usd, stop_reason, usage, modelUsage, permission_denials, errors)를 모아 반환. 90초 타임아웃(AbortController). `queryFn`을 주입받아 테스트에서 가짜로 교체.
7. `src/server.ts`(`buildServer(config, deps)`), `src/main.ts`(루트가 아닌 `apps/agent-bridge/.env`를 `process.loadEnvFile`로 읽음, SIGINT/SIGTERM 종료).
8. `.env.example`, `.gitignore`, `.prettierrc`, `eslint.config.mjs`, `vitest.config.ts`, `tsconfig(.build).json`.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `apps/api/package.json`, `package-lock.json` | 추가 | NestJS 11, 의존성, 스크립트(postinstall prisma generate, jest ESM 플래그), jest 설정 |
| `apps/api/tsconfig.json`, `tsconfig.build.json`, `nest-cli.json` | 추가 | strict, build에서 prisma 설정 제외 |
| `apps/api/eslint.config.mjs`, `.prettierrc`, `.gitignore` | 추가 | ESLint 9 + Prettier, 생성물 무시 |
| `apps/api/Dockerfile.dev` | 수정 | `npm ci` 전에 `prisma/`, `prisma.config.ts` 복사 |
| `apps/api/.dockerignore` | 수정 | `coverage`, `src/database/generated` 추가 |
| `apps/api/prisma/schema.prisma` | 추가 | generator + datasource만 (모델 없음) |
| `apps/api/prisma.config.ts` | 추가 | Prisma 7 CLI 설정 (DATABASE_URL) |
| `apps/api/src/main.ts` | 추가 | prefix `/api`, ValidationPipe, CORS, 종료 훅 |
| `apps/api/src/app.module.ts` | 추가 | Config/Schedule/Common/Prisma/Health + 빈 모듈 5개 |
| `apps/api/src/config/env.validation.ts` (+ `.spec.ts`) | 추가 | 환경 변수 스키마·검증 |
| `apps/api/src/common/data-source.ts` (+ `.spec.ts`), `common.module.ts` | 추가 | `DATA_SOURCE_MODE` 토큰, mock 판단 헬퍼 |
| `apps/api/src/health/health.{controller,service,module}.ts` (+ `service.spec.ts`) | 추가 | `GET /api/health` |
| `apps/api/src/database/prisma.service.ts`, `prisma.module.ts` | 추가 | 연결 실패 시 경고만 (DBA 영역이지만 PM 지시로 작성) |
| `apps/api/src/{cluster,db-health,stream,cost,advisor}/*.module.ts` | 추가 | 빈 모듈 |
| `apps/api/test/app.e2e-spec.ts`, `test/jest-e2e.json` | 추가 | `/api/health` e2e |
| `apps/agent-bridge/**` (package.json, lock, tsconfig×2, eslint, prettier, vitest, .env.example, .gitignore) | 추가 | 브리지 프로젝트 설정 |
| `apps/agent-bridge/src/{main,server,config}.ts`, `src/http/auth.ts` | 추가 | Fastify 서버, 설정, 인증 훅 |
| `apps/agent-bridge/src/agent/{options,ping,sdk-info}.ts` | 추가 | 안전 옵션, ping, SDK 정보 |
| `apps/agent-bridge/src/{config,server}.test.ts`, `src/agent/options.test.ts` | 추가 | vitest 21개 |
| `.env.example` (루트) | 수정 | DATA_SOURCE, AWS_*, COST_EXPLORER_CACHE_TTL_SEC, AGENT_BRIDGE_* 추가 |
| `docker-compose.yml` | 수정 | api 환경 변수, extra_hosts, `~/.aws` 읽기 전용 마운트 |

### 5. 주요 결정과 이유
- **NestJS 11(CJS) 사용, 12 미사용** — 현재 `@nestjs/cli` 최신(12)은 ESM 전용 + oxlint + vitest 템플릿을 만든다. 요청이 ESLint + Prettier + Jest였고, ESM 환경의 Jest는 `jest.mock`이 동작하지 않는 등 불안정하므로 ESLint+Jest 템플릿이 기본인 11을 선택. `@nestjs/config`·`@nestjs/schedule` 최신(12.x)은 ESM 전용이라 Nest 11 호환 라인(`config@4`, `schedule@6`)으로 고정.
- **Jest를 `--experimental-vm-modules`로 실행** — `@kubernetes/client-node`(1.x부터 ESM 전용)를 CJS 앱에서 쓴다. 런타임(Node 22.12+/24)은 `require(esm)`로 문제 없음(빌드 결과로 확인). Jest는 이 플래그가 있어야 ESM 패키지를 require할 수 있어 스크립트에 넣었다(임시 테스트로 `KubeConfig` import 확인 후 삭제). 대안이던 client-node 0.22(CJS) 고정은 구버전이라 배제.
- **Prisma 7.10.0** — npm `latest` 태그가 8.0.0-rc라 안정판 7.10.0으로 고정. Prisma 7은 드라이버 어댑터가 필수라 `@prisma/adapter-pg` 추가, 새 `prisma-client` generator를 CJS로 생성.
- **health의 agentBridge는 항상 configured** — `AGENT_BRIDGE_URL`에 기본값이 있기 때문. 실제 도달 여부는 advisor 구현 시 `/health` 호출로 바꾼다.
- **aws 체크 기준 = AWS_REGION** — 자격 증명은 마운트된 `~/.aws`나 IRSA에서 오므로 설정 단계에서는 리전만 본다. 루트 `.env.example`의 `AWS_REGION`은 비워 둠(mock 기본 유지).
- **브리지: 토큰 없으면 127.0.0.1 강제** — "비어 있으면 로컬 전용 모드"를 fail-closed로 구현. `BRIDGE_HOST=0.0.0.0`만 설정하고 토큰을 빠뜨려도 외부에 열리지 않는다.
- **브리지: `permissionMode: 'dontAsk'`** — `'plan'`은 읽기 전용 도구를 허용할 수 있어, 사전 승인 없는 도구를 모두 거부하는 `dontAsk` + `permissionPrompts: 'none'`을 선택. 어차피 `tools: []`라 쓸 도구가 없다(ping에서 init 메시지 `tools: []`로 확인).
- **브리지: `ANTHROPIC_API_KEY` 제거** — 요청대로 API 키가 아닌 로컬 Claude Code 로그인을 쓰게 한다(ping 결과 `apiKeySource: "none"` = OAuth 로그인).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 | 오류·경고 0 |
| `npm test --prefix apps/api` | 통과 | 3 suites, 10 tests |
| `npm run test:e2e --prefix apps/api` | 통과 | 1 test (`GET /api/health`) |
| `npm run build --prefix apps/api` | 통과 | `dist/main.js` |
| `DATA_SOURCE=mock node dist/main.js` → `GET /api/health` | 통과 | `{"status":"ok","dataSource":"mock","uptimeSec":1,"checks":{"db":"not_configured","kube":"not_configured","aws":"not_configured","agentBridge":"configured"}}`, CORS 헤더 `Access-Control-Allow-Origin: http://localhost:3000` 확인 |
| 존재하지 않는 DB로 부팅 (`DATABASE_URL=postgres://u:p@localhost:5999/x`) | 통과 | 경고 `대시보드 DB 연결 실패 (앱은 계속 실행됩니다): PrismaClientKnownRequestError ECONNREFUSED` 후 정상 기동 |
| `npm run start:dev --prefix apps/api` | 통과 | 기동 후 `/api/health` 200, 종료 |
| `npm run lint --prefix apps/agent-bridge` | 통과 | 오류·경고 0 |
| `npm test --prefix apps/agent-bridge` | 통과 | 3 files, 21 tests |
| `npm run build --prefix apps/agent-bridge` | 통과 | `dist/main.js` |
| 브리지 `GET /health` | 통과 | `{"status":"ok","sdkVersion":"0.3.277","claudeCodeAvailable":true}` |
| 브리지 `POST /v1/ping-agent` (실제 로컬 Claude Code) | 통과 | `ok: true`, `text: "OK"`, 전체 3.8초(API 1.1초), `model: claude-opus-5[1m]`, `claudeCodeVersion: 2.1.277`, `apiKeySource: none`, `permissionMode: dontAsk`, **`tools: []`**, `num_turns: 1`, `total_cost_usd: 0.002505`(추정치, 구독 로그인이라 실제 청구 아님) |
| 브리지 토큰 모드 (`BRIDGE_HOST=0.0.0.0 BRIDGE_TOKEN=… npm run dev`) | 통과 | 헤더 없음 401, 올바른 헤더 200 |
| `docker compose up --build` | **생략** | 이 PC에 Docker 없음. compose/Dockerfile 변경은 문법·경로만 검토 |
| `npx prisma migrate` / 실제 Postgres 연결 | **생략** | 로컬 Postgres 없음, 모델도 없음 |

- 검증 후 띄운 프로세스(api :3001, bridge :3002, nest/tsx watcher)는 모두 종료함.

### 7. 남은 이슈·한계
- Docker 미검증: `Dockerfile.dev`(node:22-alpine)에서 `npm ci` → `prisma generate`가 도는지, `host.docker.internal:host-gateway`, `~/.aws` 마운트 동작은 Docker 있는 환경에서 확인 필요. `~/.aws`가 호스트에 없으면 Docker가 빈 폴더를 만든다.
- 컨테이너의 api가 호스트 브리지에 닿으려면 브리지를 `BRIDGE_HOST=0.0.0.0` + `BRIDGE_TOKEN` 설정으로 띄워야 한다(토큰 없으면 127.0.0.1 강제라 컨테이너에서 안 닿음). 루트 `.env`의 `AGENT_BRIDGE_TOKEN`과 브리지 `.env`의 `BRIDGE_TOKEN`을 같은 값으로.
- api의 health는 설정 여부만 표시. 실제 연결 확인(DB `isConnected`, kube API, 브리지 `/health`)은 각 기능 구현 시 추가.
- 브리지 스트리밍(SSE/NDJSON) 엔드포인트, 어드바이저 프롬프트는 아직 없음. ping만 있음.
- `maxBudgetUsd`는 아직 기본 적용하지 않음(구독 로그인에서는 추정치). 어드바이저 구현 때 결정.
- `npm audit`가 api 쪽 개발 의존성 경고를 보고함(Nest CLI 템플릿 기본 의존성). 이번 범위에서 조치하지 않음.
- ESLint `lint` 스크립트는 Nest 템플릿대로 `--fix` 포함. 검사만 하려면 `npm run lint:check`.

### 8. 다른 담당 요청
- `DBA 요청`: `apps/api/prisma/schema.prisma`에 모델 추가. 생성 경로는 `src/database/generated/prisma`(CJS, gitignore됨), import는 `./generated/prisma/client`. Prisma 7이라 URL은 `prisma.config.ts`의 `DATABASE_URL`. `PrismaService`(`src/database/prisma.service.ts`)는 PM 지시로 백엔드가 만들었으니 DBA 영역으로 인수해 주세요(연결 실패 시 경고만 남기는 동작은 유지 필요).
- `frontend 요청`: `GET /api/health` 응답 형식은 위 "검증 결과" 예시와 같음. 정식 계약은 3단계 `docs/api/`에 포함 예정.
- `PM 요청`: Docker 있는 환경에서 `docker compose up --build` 1회 확인.

### 9. 다음 담당이 알아야 할 점
- 실행:
  - api: `npm install --prefix apps/api`(postinstall로 prisma generate) → `npm run start:dev --prefix apps/api` → http://localhost:3001/api/health. `.env`는 `apps/api/.env` 또는 루트 `.env`를 읽음.
  - 브리지: `npm install --prefix apps/agent-bridge` → `npm run dev --prefix apps/agent-bridge` → http://127.0.0.1:3002/health, `curl -X POST http://127.0.0.1:3002/v1/ping-agent`. 이 PC에 Claude Code 로그인 필요.
- mock 판단: 모듈에서 `@Inject(DATA_SOURCE_MODE) mode` + `shouldUseMock(mode, isKubeConfigured(...))`처럼 쓴다. live여도 연결 정보가 없으면 mock.
- ESM 전용 패키지(`@kubernetes/client-node` 등)는 일반 `import`로 쓰면 된다(빌드 결과 `require(esm)`로 동작). Jest에서 모킹할 때는 `jest.mock('@kubernetes/client-node', () => ({...}))` 팩토리 방식 권장.
- **SDK에서 확인한 실제 이름** (v0.3.277 `sdk.d.ts`, 어드바이저 구현에 사용):
  - `query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query` — `Query`는 `AsyncGenerator<SDKMessage, void>` + `interrupt()`, `setPermissionMode()` 등
  - Options: `systemPrompt`(string | string[] | `{ type: 'preset', preset: 'claude_code', append?, excludeDynamicSections? }`), `tools`(string[] | `{ type: 'preset', preset: 'claude_code' }`, `[]` = 전부 끔), `allowedTools`, `disallowedTools`, `toolAliases`, `permissionMode`(`'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`), `permissionPrompts`(`'host' | 'none'`), `allowDangerouslySkipPermissions`, `canUseTool`, `maxTurns`, `maxBudgetUsd`, `model`, `fallbackModel`, `effort`(`'low'|'medium'|'high'|'xhigh'|'max'`), `thinking`(`{type:'adaptive'} | {type:'enabled', budgetTokens} | {type:'disabled'}`), `cwd`, `additionalDirectories`, `settingSources`(`('user'|'project'|'local')[]`, `[]` = 설정 파일 미로드), `settings`, `mcpServers`, `strictMcpConfig`, `plugins`, `skills`, `agents`, `hooks`, `env`(지정 시 process.env를 **대체**), `abortController`, `includePartialMessages`(스트리밍 델타 = `SDKPartialAssistantMessage`), `outputFormat`(`{ type: 'json_schema', schema }` → result의 `structured_output`), `persistSession`, `pathToClaudeCodeExecutable`, `stderr`
  - 메시지: `SDKMessage` 유니온. `type:'system', subtype:'init'` → `session_id, model, claude_code_version, apiKeySource, permissionMode, tools, mcp_servers`. `type:'assistant'` → `message`(Messages API 형식 content 블록). `type:'result'` → `subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'`, `is_error, result(성공 시), duration_ms, duration_api_ms, num_turns, total_cost_usd, stop_reason, usage, modelUsage, permission_denials, errors(실패 시), structured_output?, session_id`
- 안전 설정을 바꾸려면 `apps/agent-bridge/src/agent/options.ts`만 수정하고 `options.test.ts`를 함께 갱신할 것. 새 엔드포인트도 반드시 `buildAdvisorOptions()`를 거쳐 `query()`를 호출할 것.
