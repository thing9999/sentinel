/**
 * Cost Explorer 호출 폭주 방지 (호출당 $0.01) — 어떤 경로로도 호출이 늘지 않음을 고정한다.
 */
import { ApiException } from '../../common/api-error';
import { SETTING_DEFAULTS } from '../../database/settings-defaults';
import type { ExplorerSettings } from '../settings/cost-settings.service';
import { CostStore } from '../store/cost-store';
import { FakeGateway, awsError } from '../test-helpers';
import {
  CALLS_PER_REFRESH,
  CostExplorerService,
} from './cost-explorer.service';

const settings = (p: Partial<ExplorerSettings> = {}): ExplorerSettings => ({
  ...(SETTING_DEFAULTS['cost.explorer'].value as ExplorerSettings),
  ...p,
});

function setup(
  p: Partial<ExplorerSettings> = {},
  start = '2026-09-19T05:00:00Z',
) {
  let now = new Date(start);
  const store = new CostStore(null);
  const gw = new FakeGateway();
  gw.cau = () => ({
    days: [
      { date: '2026-09-17', groups: [{ service: 'EC2', amount: 10 }] },
      { date: '2026-09-18', groups: [{ service: 'EC2', amount: 5 }] },
    ],
    nextPageToken: null,
  });
  gw.forecast = () => ({
    totalUsd: 100,
    days: [{ date: '2026-09-19', mean: 100, low: 90, high: 110 }],
  });
  const s = settings(p);
  const make = () =>
    new CostExplorerService(
      store,
      gw,
      () => Promise.resolve(s),
      () => now,
    );
  return {
    store,
    gw,
    make,
    ce: make(),
    advance: (sec: number) => {
      now = new Date(now.getTime() + sec * 1000);
    },
    setNow: (iso: string) => {
      now = new Date(iso);
    },
  };
}

describe('CostExplorerService 캐시·호출 제한', () => {
  it('첫 조회 = GetCostAndUsage 1 + GetCostForecast 1, 호출 기록 2행', async () => {
    const { ce, gw, store } = setup();
    expect(await ce.ensureFresh()).toBe('fetched');
    expect(gw.calls.getCostAndUsagePage).toBe(1);
    expect(gw.calls.getCostForecast).toBe(1);
    const stats = await store.ceCallStats(new Date('2026-09-19T06:00:00Z'));
    expect(stats.todayCalls).toBe(CALLS_PER_REFRESH);
    expect(stats.monthCostUsd).toBeCloseTo(0.02, 6);
    expect(ce.current().daily?.status).toBe('ok');
  });

  it('캐시 유효(6시간) 동안 반복 확인·재시작해도 다시 부르지 않는다', async () => {
    const { ce, gw, make, advance } = setup();
    await ce.ensureFresh();
    for (let i = 0; i < 50; i += 1) {
      advance(60);
      expect(await ce.ensureFresh()).toBe('fresh');
    }
    // API 재시작 (같은 저장소 = DB 캐시 영속)
    const restarted = make();
    expect(await restarted.ensureFresh()).toBe('fresh');
    expect(gw.ceCalls()).toBe(2);
  });

  it('상태 조회(refreshView)·load는 AWS를 부르지 않는다', async () => {
    const { ce, gw } = setup();
    for (let i = 0; i < 20; i += 1) {
      await ce.refreshView();
      await ce.load(true);
    }
    expect(gw.ceCalls()).toBe(0);
  });

  it('동시에 여러 번 확인해도 한 번만 호출 (동시 1건)', async () => {
    const { ce, gw } = setup();
    let release!: () => void;
    gw.ceGate = new Promise<void>((r) => (release = r));
    const runs = Array.from({ length: 10 }, () => ce.ensureFresh());
    await new Promise((r) => setImmediate(r));
    release();
    const results = await Promise.all(runs);
    expect(results.filter((r) => r === 'fetched')).toHaveLength(1);
    expect(gw.ceCalls()).toBe(2);
  });

  it('TTL 만료 후에만 다시 부른다', async () => {
    const { ce, gw, advance } = setup();
    await ce.ensureFresh();
    advance(6 * 3600 - 1);
    expect(await ce.ensureFresh()).toBe('fresh');
    advance(2);
    expect(await ce.ensureFresh()).toBe('fetched');
    expect(gw.ceCalls()).toBe(4);
  });

  it('TTL 설정이 1시간 미만이어도 계산은 설정값을 따르지만 설정 서비스가 최소 1시간을 보장한다 (여기선 1시간)', async () => {
    const { ce, gw, advance } = setup({ cacheTtlSec: 3600 });
    await ce.ensureFresh();
    advance(3599);
    expect(await ce.ensureFresh()).toBe('fresh');
    expect(gw.ceCalls()).toBe(2);
  });

  it('실패(권한 없음)해도 매 확인마다 재호출하지 않는다 (1시간 뒤 재시도, 예측은 건너뜀)', async () => {
    const { ce, gw, advance } = setup();
    gw.fail.getCostAndUsagePage = awsError(
      'AccessDeniedException',
      'User is not authorized to perform ce:GetCostAndUsage',
    );
    await ce.ensureFresh();
    expect(gw.calls.getCostAndUsagePage).toBe(1);
    expect(gw.calls.getCostForecast).toBe(0);
    expect(ce.current().dailyError?.code).toBe('CE_ACCESS_DENIED');
    for (let i = 0; i < 11; i += 1) {
      advance(300);
      await ce.ensureFresh();
    }
    expect(gw.calls.getCostAndUsagePage).toBe(1);
    advance(300);
    await ce.ensureFresh();
    expect(gw.calls.getCostAndUsagePage).toBe(2);
  });

  it('만료 후 재조회가 실패하면 마지막 성공 캐시를 유지하고 stale 표시', async () => {
    const { ce, gw, advance } = setup();
    await ce.ensureFresh();
    advance(6 * 3600 + 1);
    gw.fail.getCostAndUsagePage = awsError('InternalServerError');
    await ce.ensureFresh();
    const st = ce.current();
    expect(st.daily?.status).toBe('ok');
    expect(st.dailyStale).toBe(true);
    expect(st.dailyError?.code).toBe('CE_ERROR');
  });

  it('일일 상한: 오늘 호출 수 + 필요 호출 수 > 상한이면 부르지 않는다', async () => {
    const { ce, gw, advance } = setup({ dailyCallLimit: 3 });
    await ce.ensureFresh(); // 2회
    advance(6 * 3600 + 1); // 같은 날 11:00
    expect(await ce.ensureFresh()).toBe('limit');
    expect(gw.ceCalls()).toBe(2);
    const v = await ce.refreshView();
    expect(v.limitReached).toBe(true);
    expect(v.disabledReason).toBe('daily_limit');
    expect(v.nextAvailableAt).toBe('2026-09-20T00:00:00.000Z');
  });

  it('페이지네이션은 최대 3페이지까지만', async () => {
    const { ce, gw } = setup();
    gw.cau = () => ({ days: [], nextPageToken: 'more' });
    await ce.ensureFresh();
    expect(gw.calls.getCostAndUsagePage).toBe(3);
  });
});

describe('CostExplorerService 수동 새로고침', () => {
  const expectApi = async (
    p: Promise<unknown>,
    status: number,
    code: string,
  ) => {
    let err: unknown;
    try {
      await p;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApiException);
    const ex = err as ApiException;
    expect(ex.getStatus()).toBe(status);
    expect(ex.code).toBe(code);
    return ex;
  };

  it('마지막 과금 호출 후 1시간 미만 → 429 CE_REFRESH_COOLDOWN + Retry-After', async () => {
    const { ce, gw, advance } = setup();
    await ce.ensureFresh();
    advance(600);
    const ex = await expectApi(
      ce.requestManualRefresh(),
      429,
      'CE_REFRESH_COOLDOWN',
    );
    expect(ex.retryAfterSec).toBe(3000);
    expect(ex.details?.nextAvailableAt).toBe('2026-09-19T06:00:00.000Z');
    expect(gw.ceCalls()).toBe(2);
    const v = await ce.refreshView();
    expect(v.canRefresh).toBe(false);
    expect(v.disabledReason).toBe('cooldown');
  });

  it('쿨다운이 지나면 202 경로로 한 번 조회 (둘 다 다시 부름)', async () => {
    const { ce, gw, advance } = setup();
    await ce.ensureFresh();
    advance(3601);
    const v = await ce.requestManualRefresh();
    expect(v.state).toBe('refreshing');
    expect(v.disabledReason).toBe('in_progress');
    await ce.lastRun;
    expect(gw.ceCalls()).toBe(4);
  });

  it('진행 중이면 409 CE_REFRESH_IN_PROGRESS (여러 탭에서 눌러도 한 번)', async () => {
    const { ce, gw } = setup();
    let release!: () => void;
    gw.ceGate = new Promise<void>((r) => (release = r));
    await ce.requestManualRefresh();
    await expectApi(ce.requestManualRefresh(), 409, 'CE_REFRESH_IN_PROGRESS');
    await expectApi(ce.requestManualRefresh(), 409, 'CE_REFRESH_IN_PROGRESS');
    expect(await ce.ensureFresh()).toBe('busy');
    release();
    await ce.lastRun;
    expect(gw.ceCalls()).toBe(2);
  });

  it('권한 없음 실패는 과금되지 않으므로 쿨다운을 시작하지 않는다 (일일 수에는 셈)', async () => {
    const { ce, gw, store, advance } = setup();
    gw.fail.getCostAndUsagePage = awsError('AccessDeniedException');
    await ce.ensureFresh();
    advance(60);
    delete gw.fail.getCostAndUsagePage;
    await ce.requestManualRefresh();
    await ce.lastRun;
    const stats = await store.ceCallStats(new Date('2026-09-19T06:00:00Z'));
    expect(stats.todayCalls).toBe(3);
  });

  it('일일 상한 → 429 CE_DAILY_LIMIT_REACHED', async () => {
    const { ce, gw, advance } = setup({ dailyCallLimit: 3 });
    await ce.ensureFresh();
    advance(3601);
    const ex = await expectApi(
      ce.requestManualRefresh(),
      429,
      'CE_DAILY_LIMIT_REACHED',
    );
    expect(ex.details).toMatchObject({
      todayCalls: 2,
      dailyLimit: 3,
      resetsAt: '2026-09-20T00:00:00.000Z',
    });
    expect(gw.ceCalls()).toBe(2);
  });

  it('AWS 설정 없음 → 503 SOURCE_UNAVAILABLE, 자동 조회도 안 함', async () => {
    const store = new CostStore(null);
    const ce = new CostExplorerService(store, null, () =>
      Promise.resolve(settings()),
    );
    expect(await ce.ensureFresh()).toBe('not_configured');
    await expectApi(ce.requestManualRefresh(), 503, 'SOURCE_UNAVAILABLE');
    expect((await ce.refreshView()).disabledReason).toBe('not_configured');
  });

  it('예측 데이터 부족은 예측만 unavailable, 확정은 정상', async () => {
    const { ce, gw } = setup();
    gw.fail.getCostForecast = awsError('DataUnavailableException');
    await ce.ensureFresh();
    expect(ce.current().daily?.status).toBe('ok');
    expect(ce.current().forecastError?.code).toBe('CE_FORECAST_UNAVAILABLE');
  });
});
