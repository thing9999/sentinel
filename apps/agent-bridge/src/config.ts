import { isIP } from 'node:net';

export interface BridgeConfig {
  port: number;
  /** 실제로 바인딩할 호스트 (토큰이 없으면 항상 루프백) */
  host: string;
  /** 비어 있으면 로컬 전용 모드 */
  token: string | undefined;
  model: string | undefined;
  claudeCodePath: string | undefined;
  /** 요청한 BRIDGE_HOST가 토큰 없음 때문에 무시됐는지 */
  hostOverridden: boolean;
  /** 분석 출력 방식: SDK 구조화 출력(json_schema, 기본) 또는 텍스트 JSON(text, 대체 경로) */
  outputMode: 'json_schema' | 'text';
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const addr = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (addr === '::1') return true;
  return isIP(addr) === 4 && addr.startsWith('127.');
}

function nonEmpty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const port = Number(nonEmpty(env.BRIDGE_PORT) ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`BRIDGE_PORT가 올바르지 않습니다: ${env.BRIDGE_PORT}`);
  }
  const token = nonEmpty(env.BRIDGE_TOKEN);
  const requestedHost = nonEmpty(env.BRIDGE_HOST) ?? '127.0.0.1';

  // 토큰 없이 외부 인터페이스에 열지 않는다 (fail closed)
  const hostOverridden = !token && !isLoopbackHost(requestedHost);
  const host = hostOverridden ? '127.0.0.1' : requestedHost;

  const outputMode = nonEmpty(env.ADVISOR_OUTPUT_MODE) ?? 'json_schema';
  if (outputMode !== 'json_schema' && outputMode !== 'text') {
    throw new Error(
      `ADVISOR_OUTPUT_MODE는 json_schema 또는 text여야 합니다: ${outputMode}`,
    );
  }

  return {
    port,
    host,
    token,
    model: nonEmpty(env.AGENT_MODEL),
    claudeCodePath: nonEmpty(env.CLAUDE_CODE_PATH),
    hostOverridden,
    outputMode,
  };
}
