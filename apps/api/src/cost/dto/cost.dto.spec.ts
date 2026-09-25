import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AllocationQueryDto,
  CostSettingsPatchDto,
  RateSeriesQueryDto,
} from './cost.dto';

const errorsOf = <T extends object>(cls: new () => T, plain: object) =>
  validateSync(plainToInstance(cls, plain), { whitelist: true });

const flat = (errs: ReturnType<typeof validateSync>): string[] => {
  const out: string[] = [];
  const walk = (es: typeof errs, p: string) => {
    for (const e of es) {
      const f = p ? `${p}.${e.property}` : e.property;
      if (e.constraints) out.push(f);
      if (e.children?.length) walk(e.children, f);
    }
  };
  walk(errs, '');
  return out;
};

describe('cost DTO 검증', () => {
  it('정상 PATCH 본문 (계약 6.2 예시)', () => {
    expect(
      errorsOf(CostSettingsPatchDto, {
        budget: { monthlyBudgetUsd: 900, warnPct: 85 },
        spike: { rate: { warnAbsUsdPerHour: 0.75 } },
        explorer: {
          dailyCallLimit: 30,
          costAllocationTagFilter: {
            key: 'kubernetes.io/cluster/prod.k8s.example.com',
            values: ['owned'],
          },
        },
      }),
    ).toEqual([]);
  });

  it('monthlyBudgetUsd: null 허용, 0 이하 거부', () => {
    expect(
      errorsOf(CostSettingsPatchDto, { budget: { monthlyBudgetUsd: null } }),
    ).toEqual([]);
    expect(
      flat(errorsOf(CostSettingsPatchDto, { budget: { monthlyBudgetUsd: 0 } })),
    ).toEqual(['budget.monthlyBudgetUsd']);
  });

  it('CE 캐시 TTL·쿨다운 1시간 미만 거부, callCostUsd 변경 거부', () => {
    const f = flat(
      errorsOf(CostSettingsPatchDto, {
        explorer: {
          cacheTtlSec: 60,
          manualRefreshCooldownSec: 10,
          callCostUsd: 0,
        },
      }),
    );
    expect(f).toEqual(
      expect.arrayContaining([
        'explorer.cacheTtlSec',
        'explorer.manualRefreshCooldownSec',
        'explorer.callCostUsd',
      ]),
    );
  });

  it('배수는 1 초과, 태그 필터 값 1~20개', () => {
    const f = flat(
      errorsOf(CostSettingsPatchDto, {
        spike: { rate: { warnRatio: 1 } },
        explorer: {
          costAllocationTagFilter: { key: 'k', values: [] },
          metric: 'Blended',
        },
      }),
    );
    expect(f).toEqual(
      expect.arrayContaining([
        'spike.rate.warnRatio',
        'explorer.costAllocationTagFilter.values',
        'explorer.metric',
      ]),
    );
  });

  it('조회 쿼리', () => {
    expect(errorsOf(RateSeriesQueryDto, { range: '30d' })).toEqual([]);
    expect(flat(errorsOf(RateSeriesQueryDto, { range: '1y' }))).toEqual([
      'range',
    ]);
    expect(
      errorsOf(AllocationQueryDto, {
        hideSystem: 'true',
        sort: 'namespace:asc',
      }),
    ).toEqual([]);
    expect(
      flat(errorsOf(AllocationQueryDto, { hideSystem: 'yes', sort: 'x:asc' })),
    ).toEqual(['hideSystem', 'sort']);
  });
});
