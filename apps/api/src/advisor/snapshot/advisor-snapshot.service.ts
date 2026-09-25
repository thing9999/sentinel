import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
  ADVISOR_SNAPSHOT_METADATA,
  type AdvisorSnapshotContributor,
  type AdvisorSnapshotSection,
} from '../../common/extension-points';
import { AdvisorSettingsService } from '../advisor-settings.service';
import {
  mockClusterContribution,
  mockCostContribution,
  mockDbSection,
} from '../mock/mock-fixtures';
import { buildAdvisorSnapshot, type BuiltSnapshot } from './snapshot-builder';
import type {
  ClusterContribution,
  CostContribution,
  SnapshotDb,
  SnapshotSections,
} from './snapshot.types';

const CONTRIBUTE_TIMEOUT_MS = 5_000;
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** 기여 값 모양 정규화 (값 자체는 builder의 허용 목록 복사에서 다시 걸러진다) */
export function normalizeSection(section: 'db', v: unknown): SnapshotDb | null;
export function normalizeSection(
  section: 'cost',
  v: unknown,
): CostContribution | null;
export function normalizeSection(
  section: 'cluster',
  v: unknown,
): ClusterContribution | null;
export function normalizeSection(
  section: AdvisorSnapshotSection,
  v: unknown,
): unknown {
  if (!isObj(v)) return null;
  if (section === 'db') {
    if (isObj(v.db)) return v.db;
    return 'vendor' in v || 'connections' in v ? v : null;
  }
  if (section === 'cost') {
    if ('cost' in v) return v;
    // 비용 기여자는 cost 블록을 평평하게 돌려준다. 스냅샷 최상위로 올려야 하는
    // 목록(controlPlaneVolumes 등)은 여기서 함께 꺼낸다
    return 'currency' in v || 'rate' in v
      ? {
          cost: v,
          ...(Array.isArray(v.controlPlaneVolumes)
            ? { controlPlaneVolumes: v.controlPlaneVolumes }
            : {}),
          ...(Array.isArray(v.unattachedVolumes)
            ? { unattachedVolumes: v.unattachedVolumes }
            : {}),
        }
      : null;
  }
  return v;
}

export interface CollectedSections {
  sections: SnapshotSections;
  /** 섹션별로 실제 기여자 값을 썼는지, mock 대체인지, 없음인지 */
  origin: Record<
    AdvisorSnapshotSection,
    'contributor' | 'mock_fallback' | 'unavailable'
  >;
}

/**
 * @AdvisorSnapshotContributorProvider()가 붙은 provider(A: cluster·db, B: cost)를 찾아 섹션을 모은다.
 * 섹션이 없거나 실패하면 그 섹션은 unavailable (mock 모드에서는 내장 mock 값으로 대체).
 */
@Injectable()
export class AdvisorSnapshotService {
  private readonly logger = new Logger(AdvisorSnapshotService.name);
  private warned = new Set<string>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly settings: AdvisorSettingsService,
  ) {}

  private contributors(): AdvisorSnapshotContributor[] {
    const out: AdvisorSnapshotContributor[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      const metatype: unknown = wrapper.metatype;
      if (!instance || !metatype || typeof metatype !== 'function') continue;
      if (!Reflect.getMetadata(ADVISOR_SNAPSHOT_METADATA, metatype)) continue;
      const c = instance as Partial<AdvisorSnapshotContributor>;
      if (typeof c.contribute === 'function' && typeof c.section === 'string') {
        out.push(c as AdvisorSnapshotContributor);
      }
    }
    return out;
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(msg);
  }

  private async call(c: AdvisorSnapshotContributor): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        c.contribute(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('시간 초과')),
            CONTRIBUTE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async collect(now: Date = new Date()): Promise<CollectedSections> {
    const mock = this.settings.dataSource === 'mock';
    const bySection = new Map<
      AdvisorSnapshotSection,
      AdvisorSnapshotContributor
    >();
    for (const c of this.contributors()) {
      if (!bySection.has(c.section)) bySection.set(c.section, c);
    }
    const result: CollectedSections = {
      sections: { cluster: null, db: null, cost: null },
      origin: {
        cluster: 'unavailable',
        db: 'unavailable',
        cost: 'unavailable',
      },
    };
    const fetchOne = async (
      section: AdvisorSnapshotSection,
    ): Promise<unknown> => {
      const c = bySection.get(section);
      if (!c) {
        this.warnOnce(
          `missing:${section}`,
          `어드바이저 스냅샷 '${section}' 섹션 제공자가 없습니다${mock ? ' (mock 값 사용)' : ''}.`,
        );
        return undefined;
      }
      try {
        return await this.call(c);
      } catch (err) {
        this.logger.warn(
          `어드바이저 스냅샷 '${section}' 섹션 수집 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      }
    };
    const [cluster, db, cost] = await Promise.all([
      fetchOne('cluster'),
      fetchOne('db'),
      fetchOne('cost'),
    ]);

    const c = normalizeSection('cluster', cluster);
    const d = normalizeSection('db', db);
    const k = normalizeSection('cost', cost);
    if (c) {
      result.sections.cluster = c;
      result.origin.cluster = 'contributor';
    } else if (mock) {
      result.sections.cluster = mockClusterContribution();
      result.origin.cluster = 'mock_fallback';
    }
    if (d) {
      result.sections.db = d;
      result.origin.db = 'contributor';
    } else if (mock) {
      result.sections.db = mockDbSection();
      result.origin.db = 'mock_fallback';
    }
    if (k) {
      result.sections.cost = k;
      result.origin.cost = 'contributor';
    } else if (mock) {
      result.sections.cost = mockCostContribution(now);
      result.origin.cost = 'mock_fallback';
    }
    return result;
  }

  /** 스냅샷 생성. 클러스터·비용이 모두 없으면 null */
  async build(
    includeSystem: boolean,
    now: Date = new Date(),
  ): Promise<{ built: BuiltSnapshot | null; collected: CollectedSections }> {
    const collected = await this.collect(now);
    const s = await this.settings.get();
    const built = buildAdvisorSnapshot(collected.sections, {
      now,
      dataSource: this.settings.dataSource,
      includeSystem,
      systemNamespaces: this.settings.systemNamespaces,
      maxWorkloads: s.limits.maxWorkloads,
      maxNodes: s.limits.maxNodes,
      thresholds: s.prechecks,
    });
    return { built, collected };
  }
}
