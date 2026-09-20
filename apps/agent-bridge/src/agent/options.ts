import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

/**
 * 어드바이저 안전 설정 (한 곳에서만 관리, 테스트로 고정: options.test.ts)
 *
 * 어드바이저는 "조언만" 한다. 파일·셸·웹 도구를 모두 끄고, 도구 실행이 불가능한
 * 권한 모드로 돌리며, 사용자/프로젝트 설정·MCP·플러그인을 불러오지 않는다.
 */

/** 명시적으로 차단할 내장 도구 (tools: [] 에 더한 이중 방어) */
export const DISALLOWED_TOOLS: readonly string[] = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Monitor',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  'Agent',
  'Task',
  'TaskStop',
  'TodoWrite',
  'Skill',
  'SlashCommand',
  'Workflow',
  'ListMcpResources',
  'ReadMcpResource',
  'CronCreate',
  'CronDelete',
  'RemoteTrigger',
  'ExitPlanMode',
  'EnterPlanMode',
  'AskUserQuestion',
];

/** 호출자가 바꿀 수 없는 고정값 */
/** PM 결정(2026-09-19): 3 → 5. 도구가 StructuredOutput뿐이라 턴은 스키마 재시도에만 쓰이고, 비용은 maxBudgetUsd가 막는다 */
export const MAX_TURNS_LIMIT = 5;

/** 서브프로세스에 넘기지 않을 환경 변수 */
const STRIPPED_ENV = [
  // 로컬 Claude Code 로그인(OAuth)을 쓰도록 API 키 경로를 막는다
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  // 브리지 자체 비밀값
  'BRIDGE_TOKEN',
  // 브리지가 Claude Code 세션 안에서 실행된 경우의 중첩 표시
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
];

/** 호출자가 조정할 수 있는 항목 (안전 관련 항목은 여기서 받지 않는다) */
export interface AdvisorQueryOverrides {
  systemPrompt?: string;
  model?: string;
  /** 1~MAX_TURNS_LIMIT로 잘린다 */
  maxTurns?: number;
  effort?: Options['effort'];
  thinking?: Options['thinking'];
  maxBudgetUsd?: number;
  includePartialMessages?: boolean;
  outputFormat?: Options['outputFormat'];
  abortController?: AbortController;
  pathToClaudeCodeExecutable?: string;
}

let sandboxDir: string | undefined;

/** 프로젝트 파일이 없는 빈 작업 디렉터리 (CLAUDE.md 등이 섞이지 않게) */
export function advisorWorkDir(): string {
  if (!sandboxDir) {
    sandboxDir = join(tmpdir(), 'sentinel-agent-bridge');
    mkdirSync(sandboxDir, { recursive: true });
  }
  return sandboxDir;
}

export function buildChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source };
  for (const key of STRIPPED_ENV) delete env[key];
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'sentinel-agent-bridge/0.0.1';
  return env;
}

function clampTurns(turns: number | undefined): number {
  if (turns === undefined || !Number.isFinite(turns)) return 1;
  return Math.min(MAX_TURNS_LIMIT, Math.max(1, Math.floor(turns)));
}

export function buildAdvisorOptions(
  overrides: AdvisorQueryOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Options {
  const { maxTurns, ...rest } = overrides;
  return {
    ...rest,
    // ---- 아래는 안전 고정값: overrides로 덮어쓸 수 없다 ----
    tools: [],
    allowedTools: [],
    disallowedTools: [...DISALLOWED_TOOLS],
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',
    allowDangerouslySkipPermissions: false,
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    plugins: [],
    skills: [],
    persistSession: false,
    maxTurns: clampTurns(maxTurns),
    cwd: advisorWorkDir(),
    env: buildChildEnv(env),
  };
}
