import {
  mockClusterContribution,
  mockCostContribution,
  mockDbSection,
} from '../mock/mock-fixtures';
import { REDACTED } from './sanitize-snapshot';
import {
  buildAdvisorSnapshot,
  byteLength,
  limitWorkloads,
} from './snapshot-builder';
import type { SnapshotWorkload } from './snapshot.types';

const NOW = new Date('2026-09-19T05:00:00.000Z');
const sections = () => ({
  cluster: mockClusterContribution(),
  db: mockDbSection(),
  cost: mockCostContribution(NOW),
});

describe('buildAdvisorSnapshot', () => {
  it('클러스터·비용이 모두 없으면 null (503 SNAPSHOT_UNAVAILABLE)', () => {
    expect(
      buildAdvisorSnapshot(
        { cluster: null, db: mockDbSection(), cost: null },
        { now: NOW, dataSource: 'live', includeSystem: false },
      ),
    ).toBeNull();
  });

  it('mock 섹션 → 스냅샷·사전 점검·요약·해시', () => {
    const b = buildAdvisorSnapshot(sections(), {
      now: NOW,
      dataSource: 'mock',
      includeSystem: false,
    })!;
    expect(b.snapshot.schemaVersion).toBe(1);
    expect(b.snapshot.meta.generatedAt).toBe(NOW.toISOString());
    // 시스템 네임스페이스 제외
    expect(
      b.snapshot.workloads.some((w) => w.namespace === 'kube-system'),
    ).toBe(false);
    expect(b.snapshot.meta.systemNamespacesIncluded).toBe(false);
    // 사전 점검이 스냅샷에 함께 들어간다
    expect(b.snapshot.prechecks.length).toBe(b.prechecks.items.length);
    const cats = new Set(b.prechecks.items.map((i) => i.category));
    for (const c of ['cost', 'reliability', 'security', 'database'])
      expect(cats.has(c as never)).toBe(true);
    // 가림 1건 (mock 레이블의 가짜 AWS 키)
    expect(b.meta.redactedCount).toBe(1);
    expect(b.meta.redactedFields).toEqual([
      'workloads[prod/api].labels.app.kubernetes.io/version',
    ]);
    expect(
      b.snapshot.workloads.find((w) => w.name === 'api')?.labels[
        'app.kubernetes.io/version'
      ],
    ).toBe(REDACTED);
    // 요약
    expect(b.summary.workerCount).toBe(6);
    expect(b.summary.controlPlaneCount).toBe(3);
    expect(b.summary.instanceTypes).toEqual([
      { type: 'm6i.large', count: 4 },
      { type: 'm6i.xlarge', count: 2 },
    ]);
    expect(b.summary.estimatedMonthly?.amountUsd).toBeCloseTo(1.1003 * 730, 1);
    expect(b.summary.bytes).toBe(byteLength(b.snapshot));
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(b.snapshot)).not.toContain('ip-10-0-');
  });

  it('includeSystem=true면 시스템 네임스페이스 포함', () => {
    const b = buildAdvisorSnapshot(sections(), {
      now: NOW,
      dataSource: 'mock',
      includeSystem: true,
    })!;
    expect(
      b.snapshot.workloads.some((w) => w.namespace === 'kube-system'),
    ).toBe(true);
  });

  it('규모 제한: 문제 있는 워크로드 우선, 생략 수 기록', () => {
    const c = mockClusterContribution();
    const base = c.workloads![0];
    c.workloads = Array.from({ length: 20 }, (_, i): SnapshotWorkload => ({
      ...base,
      name: `w-${i}`,
      status: i === 17 ? 'critical' : 'ok',
      restarts24h: 0,
    }));
    const b = buildAdvisorSnapshot(
      { ...sections(), cluster: c },
      { now: NOW, dataSource: 'mock', includeSystem: false, maxWorkloads: 5 },
    )!;
    expect(b.snapshot.workloads).toHaveLength(5);
    expect(b.snapshot.workloads[0].name).toBe('w-17');
    expect(b.snapshot.meta.omitted.workloads).toBe(15);
    expect(b.summary.workloadCount).toBe(20);
  });

  it('512KB 초과 시 사용량 → 이벤트 순으로 줄인다', () => {
    const b = buildAdvisorSnapshot(sections(), {
      now: NOW,
      dataSource: 'mock',
      includeSystem: false,
      maxBytes: 20_000,
    })!;
    expect(b.meta.bytes).toBeLessThanOrEqual(20_000);
    expect(
      b.snapshot.workloads.every((w) =>
        w.containers.every((c) => c.usage === null),
      ),
    ).toBe(true);
  });

  it('limitWorkloads는 개수 이하면 그대로', () => {
    const list = mockClusterContribution().workloads!;
    expect(limitWorkloads(list, 100)).toEqual({ kept: list, omitted: 0 });
  });
});
