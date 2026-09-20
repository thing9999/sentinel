import type { PriceListProduct } from '../aws/aws-gateway';
import { spotKey } from '../cost.types';
import { CostStore } from '../store/cost-store';
import { FakeGateway, awsError } from '../test-helpers';
import { PriceService, emptyNeeds, pickHourly } from './price.service';

const product = (
  usd: number,
  unit = 'Hrs',
  usagetype = 'x',
): PriceListProduct => ({
  attributes: { usagetype },
  onDemand: [{ unit, usd, description: '' }],
});

function setup() {
  let now = new Date('2026-09-19T05:00:00Z');
  const store = new CostStore(null);
  const gw = new FakeGateway();
  gw.products = (svc, f) => {
    if (svc === 'AmazonEC2' && f.instanceType === 'm6i.large')
      return [product(0.118)];
    if (svc === 'AmazonEC2' && f.productFamily === 'Storage')
      return [product(0.0912, 'GB-Mo')];
    return [];
  };
  gw.spot = (t, z) =>
    t === 'm6i.large' && z === 'ap-northeast-2c' ? 0.0395 : null;
  const svc = new PriceService(
    store,
    gw,
    () => ({ pricingSec: 86400, spotSec: 3600 }),
    () => now,
  );
  return {
    store,
    gw,
    svc,
    advance: (sec: number) => {
      now = new Date(now.getTime() + sec * 1000);
    },
  };
}

describe('PriceService (Pricing API 24시간 · 스팟 1시간 캐시)', () => {
  it('온디맨드 단가 조회 후 24시간 안에는 다시 부르지 않는다', async () => {
    const { svc, gw, advance } = setup();
    expect((await svc.onDemandQuote('m6i.large')).usd).toBe(0.118);
    advance(86399);
    await svc.onDemandQuote('m6i.large');
    expect(gw.calls.getProducts).toBe(1);
    advance(2);
    await svc.onDemandQuote('m6i.large');
    expect(gw.calls.getProducts).toBe(2);
  });

  it('같은 키 동시 조회는 한 번만', async () => {
    const { svc, gw } = setup();
    await Promise.all(
      Array.from({ length: 5 }, () => svc.onDemandQuote('m6i.large')),
    );
    expect(gw.calls.getProducts).toBe(1);
  });

  it('못 찾은 단가도 캐시한다 (음성 캐시)', async () => {
    const { svc, gw } = setup();
    expect((await svc.onDemandQuote('g6e.xlarge')).usd).toBeNull();
    await svc.onDemandQuote('g6e.xlarge');
    expect(gw.calls.getProducts).toBe(1);
  });

  it('조회 실패 시 만료된 캐시 단가를 쓰고 cacheUsed 표시', async () => {
    const { svc, gw, advance } = setup();
    await svc.onDemandQuote('m6i.large');
    advance(86401);
    gw.fail.getProducts = awsError('ThrottlingException');
    const q = await svc.onDemandQuote('m6i.large');
    expect(q).toMatchObject({ usd: 0.118, cacheUsed: true, failed: false });
  });

  it('스팟 시세는 1시간 캐시, 없으면 null(→ 온디맨드 상한)', async () => {
    const { svc, gw, advance } = setup();
    const needs = emptyNeeds();
    needs.instanceTypes.add('m6i.large');
    needs.spot.add('m6i.large|ap-northeast-2c');
    needs.spot.add('c7i.xlarge|ap-northeast-2a');
    const { book } = await svc.resolve(needs);
    expect(book.spot[spotKey('m6i.large', 'ap-northeast-2c')]?.usd).toBe(
      0.0395,
    );
    expect(book.spot[spotKey('c7i.xlarge', 'ap-northeast-2a')]).toBeNull();
    advance(1800);
    await svc.resolve(needs);
    expect(gw.calls.getLatestSpotPrice).toBe(2);
    advance(1801);
    await svc.resolve(needs);
    expect(gw.calls.getLatestSpotPrice).toBe(4);
  });

  it('스팟 조회 오류는 5분 동안 재시도하지 않는다', async () => {
    const { svc, gw, advance } = setup();
    gw.fail.getLatestSpotPrice = awsError('UnauthorizedOperation');
    await svc.spotQuote('m6i.large', 'ap-northeast-2c');
    await svc.spotQuote('m6i.large', 'ap-northeast-2c');
    expect(gw.calls.getLatestSpotPrice).toBe(1);
    advance(301);
    await svc.spotQuote('m6i.large', 'ap-northeast-2c');
    expect(gw.calls.getLatestSpotPrice).toBe(2);
  });

  it('모든 단가 조회가 실패하면 allFailed', async () => {
    const { svc, gw } = setup();
    gw.fail.getProducts = awsError('AccessDeniedException');
    const needs = emptyNeeds();
    needs.instanceTypes.add('m6i.large');
    const { book, stats } = await svc.resolve(needs);
    expect(book.meta.allFailed).toBe(true);
    expect(stats.pricing.failed).toBe(1);
  });

  it('pickHourly: 시간 단위 0 초과 첫 값', () => {
    expect(pickHourly([product(0, 'Hrs'), product(0.2, 'Hrs')])).toBe(0.2);
    expect(pickHourly([product(0.2, 'GB-Mo')])).toBeNull();
  });
});
