/**
 * **계약 6절 표에 없는 코드는 나가지 않는다** (PM 결정 2026-09-25 — 계약이 정본이다).
 * `src/logs`가 문자열로 내보낼 수 있는 `LOG_*` 코드를 모두 모아 `docs/api/logs.md` 6절 표와 대조한다.
 * 환경 변수 이름(`LOG_MAX_LINES` 등)과 DI 토큰은 코드가 아니므로 뺀다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname);
const CONTRACT = resolve(__dirname, '../../../../docs/api/logs.md');
const ENV = resolve(__dirname, '../config/env.validation.ts');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('logs 안내 코드 ⊆ 계약 6절 표', () => {
  it('src/logs가 내보내는 LOG_* 코드는 전부 계약 6절 표에 있다', () => {
    const envNames = new Set(
      [...readFileSync(ENV, 'utf8').matchAll(/^\s+(LOG_[A-Z_]+)[?!]?:/gm)].map(
        (m) => m[1],
      ),
    );
    const emitted = new Set<string>();
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'(LOG_[A-Z_]+)'/g)) {
        if (!envNames.has(m[1]) && m[1] !== 'LOG_BACKEND_PORT')
          emitted.add(m[1]);
      }
    }
    const md = readFileSync(CONTRACT, 'utf8');
    const section = md.slice(
      md.indexOf('## 6. 안내 코드'),
      md.indexOf('## 7. 전용 스트림 이벤트'),
    );
    expect(section.length).toBeGreaterThan(100);
    const inTable = new Set(
      [...section.matchAll(/`(LOG_[A-Z_]+)`/g)].map((m) => m[1]),
    );
    const missing = [...emitted].filter((c) => !inTable.has(c)).sort();
    expect(missing).toEqual([]);
    // 대조가 실제로 돌았는지 (0개와 0개를 비교하는 일이 없게)
    expect(emitted.size).toBeGreaterThan(20);
  });
});
