import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

function readJson(path: string): { version?: string } {
  return JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
}

/** 설치된 SDK 버전 (package.json의 exports에 없어 경로로 찾는다) */
export function getSdkVersion(): string {
  try {
    const entry = require.resolve(SDK_PACKAGE);
    return readJson(join(dirname(entry), 'package.json')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as
    { header?: { glibcVersionRuntime?: string } } | undefined;
  return report?.header?.glibcVersionRuntime === undefined;
}

/**
 * SDK가 쓰는 Claude Code 실행 파일이 있는지 확인한다.
 * - CLAUDE_CODE_PATH를 지정했으면 그 파일
 * - 아니면 SDK의 플랫폼별 optional 패키지(@anthropic-ai/claude-agent-sdk-<platform>-<arch>)
 * 로그인 여부까지는 알 수 없다 → POST /v1/ping-agent로 확인.
 */
export function findClaudeCodeExecutable(
  customPath?: string,
): string | undefined {
  if (customPath) return existsSync(customPath) ? customPath : undefined;
  const suffix = isMusl() ? '-musl' : '';
  const pkg = `${SDK_PACKAGE}-${process.platform}-${process.arch}${suffix}`;
  try {
    const dir = dirname(require.resolve(`${pkg}/package.json`));
    const bin = join(
      dir,
      process.platform === 'win32' ? 'claude.exe' : 'claude',
    );
    return existsSync(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}
