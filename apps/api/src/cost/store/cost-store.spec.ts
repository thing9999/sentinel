import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CostStore, type StoredRateSample } from './cost-store';

/**
 * `saveRateSample`의 Prisma 인자 검증.
 *
 * 이 자리는 **타입이 잡아주지 않는다**: `data`를 별도 변수로 만들어 `...data`로 펼치므로
 * TypeScript 초과 속성 검사에 걸리지 않고, `try/catch`가 Prisma 런타임 예외를 경고 로그로
 * 삼킨다. 열 이름이 틀리면 lint·tsc·build가 모두 통과하는데 표본만 조용히 저장되지 않아
 * 급증 판단의 기준선이 말라 죽는다 (kops-support AC-KOPS34, DBA 보고서 8절 요청 1).
 * → 실제 스키마의 필드 이름과 대조하는 이 테스트가 유일한 방어선이다.
 */

/** apps/api/prisma/schema.prisma의 model CostRateSample 필드 이름 (스키마가 진실) */
function schemaFieldNames(): Set<string> {
  const text = readFileSync(
    join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const m = /model CostRateSample \{([\s\S]*?)\n\}/.exec(text);
  if (!m) throw new Error('schema.prisma에서 model CostRateSample을 찾지 못함');
  const names = new Set<string>();
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('/') || t.startsWith('@@'))
      continue;
    const f = /^([A-Za-z_][A-Za-z0-9_]*)\s+\S/.exec(t);
    if (f) names.add(f[1]);
  }
  return names;
}

const sample = (): StoredRateSample => ({
  sampledAt: new Date('2026-09-24T05:00:00.000Z'),
  totalUsdPerHour: 1.5,
  byCategory: { ec2: 0.9, ebs: 0.2, lb: 0.05, controlPlane: 0.32, ipv4: 0.03 },
  nodeCount: 9,
  unpricedCount: 0,
  resources: [],
});

interface Captured {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

function storeWithFakeDb(): { store: CostStore; calls: Captured[] } {
  const calls: Captured[] = [];
  const prisma = {
    isConnected: true,
    costRateSample: {
      upsert: (args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        // Prisma는 모르는 인자를 런타임에 거부한다. 같은 조건을 흉내 낸다.
        const allowed = schemaFieldNames();
        for (const key of [
          ...Object.keys(args.create),
          ...Object.keys(args.update),
        ]) {
          if (!allowed.has(key)) throw new Error(`Unknown argument \`${key}\``);
        }
        calls.push({ create: args.create, update: args.update });
        return Promise.resolve({});
      },
    },
  };
  return {
    store: new CostStore(prisma as never),
    calls,
  };
}

describe('CostStore.saveRateSample (DB 인자)', () => {
  it('모든 인자 이름이 schema.prisma의 CostRateSample 필드에 있다', async () => {
    const { store, calls } = storeWithFakeDb();
    const warn = jest
      .spyOn(
        (store as unknown as { logger: { warn: (m: string) => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await store.saveRateSample('live', sample());

    // 예외가 삼켜지면 경고만 남고 조용히 저장이 빠진다 → 경고가 있으면 실패로 본다
    expect(warn).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    const allowed = schemaFieldNames();
    for (const key of Object.keys(calls[0].create))
      expect([key, allowed.has(key)]).toEqual([key, true]);
    warn.mockRestore();
  });

  it('컨트롤 플레인 금액이 control_plane 열(controlPlaneUsdPerHour)로 간다', async () => {
    const { store, calls } = storeWithFakeDb();
    await store.saveRateSample('live', sample());
    const data = calls[0].create;
    expect(data.controlPlaneUsdPerHour).toBe(0.32);
    // 구 이름은 남기지 않는다 (AC-KOPS34, 하위 호환 없음)
    expect(data).not.toHaveProperty('eksUsdPerHour');
    expect(calls[0].update).toMatchObject({ controlPlaneUsdPerHour: 0.32 });
  });

  it('schema.prisma에 eks_usd_per_hour가 남아 있지 않다', () => {
    const text = readFileSync(
      join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    expect(text).toContain('control_plane_usd_per_hour');
    expect(/@map\("eks_usd_per_hour"\)/.test(text)).toBe(false);
  });

  it('DB가 없으면 메모리에만 쌓고 예외를 내지 않는다', async () => {
    const store = new CostStore(null);
    await store.saveRateSample('live', sample());
    expect(store.persistence).toBe('memory');
    const rows = await store.listRateSamples(
      'live',
      new Date('2026-09-01T00:00:00.000Z'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].totalUsdPerHour).toBe(1.5);
  });
});
