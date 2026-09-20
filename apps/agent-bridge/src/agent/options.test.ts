import { describe, expect, it } from 'vitest';
import {
  DISALLOWED_TOOLS,
  MAX_TURNS_LIMIT,
  buildAdvisorOptions,
  buildChildEnv,
} from './options.js';

describe('buildAdvisorOptions (어드바이저 안전 설정 고정)', () => {
  const opts = buildAdvisorOptions();

  it('내장 도구를 모두 끈다', () => {
    expect(opts.tools).toEqual([]);
    expect(opts.allowedTools).toEqual([]);
    for (const t of [
      'Bash',
      'Write',
      'Edit',
      'Read',
      'WebFetch',
      'WebSearch',
    ]) {
      expect(opts.disallowedTools).toContain(t);
    }
    expect(opts.disallowedTools).toEqual([...DISALLOWED_TOOLS]);
  });

  it('도구 실행이 불가능한 권한 모드', () => {
    expect(opts.permissionMode).toBe('dontAsk');
    expect(opts.permissionPrompts).toBe('none');
    expect(opts.allowDangerouslySkipPermissions).toBe(false);
    expect(opts.canUseTool).toBeUndefined();
  });

  it('사용자/프로젝트 설정·MCP·플러그인·스킬을 불러오지 않는다', () => {
    expect(opts.settingSources).toEqual([]);
    expect(opts.mcpServers).toEqual({});
    expect(opts.strictMcpConfig).toBe(true);
    expect(opts.plugins).toEqual([]);
    expect(opts.skills).toEqual([]);
    expect(opts.hooks).toBeUndefined();
    expect(opts.agents).toBeUndefined();
    expect(opts.persistSession).toBe(false);
  });

  it('maxTurns는 작게 (기본 1, 최대 MAX_TURNS_LIMIT)', () => {
    expect(opts.maxTurns).toBe(1);
    expect(buildAdvisorOptions({ maxTurns: 100 }).maxTurns).toBe(
      MAX_TURNS_LIMIT,
    );
    expect(buildAdvisorOptions({ maxTurns: 0 }).maxTurns).toBe(1);
    expect(MAX_TURNS_LIMIT).toBe(5);
  });

  it('overrides로 안전 설정을 덮어쓸 수 없다', () => {
    const hostile = {
      tools: ['Bash'],
      allowedTools: ['Bash'],
      disallowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['user', 'project'],
      mcpServers: { evil: { command: 'x' } },
      strictMcpConfig: false,
      cwd: '/',
    } as unknown as Parameters<typeof buildAdvisorOptions>[0];
    const o = buildAdvisorOptions(hostile);
    expect(o.tools).toEqual([]);
    expect(o.allowedTools).toEqual([]);
    expect(o.disallowedTools).toEqual([...DISALLOWED_TOOLS]);
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.allowDangerouslySkipPermissions).toBe(false);
    expect(o.settingSources).toEqual([]);
    expect(o.mcpServers).toEqual({});
    expect(o.strictMcpConfig).toBe(true);
    expect(o.cwd).not.toBe('/');
  });

  it('허용된 항목(systemPrompt, model)은 전달된다', () => {
    const o = buildAdvisorOptions({ systemPrompt: 'advise', model: 'm' });
    expect(o.systemPrompt).toBe('advise');
    expect(o.model).toBe('m');
  });
});

describe('buildChildEnv', () => {
  it('API 키·브리지 토큰·중첩 세션 표시를 제거한다', () => {
    const env = buildChildEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-x',
      ANTHROPIC_AUTH_TOKEN: 't',
      BRIDGE_TOKEN: 'secret',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
    });
    expect(env.PATH).toBe('/bin');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.BRIDGE_TOKEN).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toMatch(/^sentinel-agent-bridge/);
  });
});
