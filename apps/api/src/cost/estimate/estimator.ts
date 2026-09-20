/**
 * 실시간 소모율 추정 (순수 함수). 명세 aws-cost 3.1, 계약 3.1.
 * 입력: 클러스터 인벤토리(포트) + 정리된 AWS 리소스 + 단가표. AWS·쿠버네티스를 직접 부르지 않는다.
 */
import {
  instanceIdFromProviderId,
  type ClusterInventorySnapshot,
  type InventoryNode,
} from '../cluster-inventory.port';
import { r6 } from '../cost-util';
import {
  CATEGORY_LABELS,
  COST_CATEGORIES,
  spotKey,
  type AwsInstance,
  type AwsResourceSnapshot,
  type CategoryRow,
  type CostCategory,
  type EbsRow,
  type Ec2Row,
  type EksRow,
  type EstimateComputation,
  type Ipv4Row,
  type K8sRef,
  type LbRow,
  type Note,
  type PriceBook,
  type SampleResource,
} from '../cost.types';

export const NOTE_UNPRICED: Note = {
  code: 'UNPRICED',
  text: '단가 없음 · 합계 제외',
};
export const NOTE_SPOT_FALLBACK: Note = {
  code: 'SPOT_PRICE_FALLBACK',
  text: '스팟 시세 조회 실패 (온디맨드 기준 상한)',
};
export const NOTE_PRICE_CACHE: Note = {
  code: 'PRICE_CACHE_USED',
  text: '단가 조회 실패 · 캐시 단가 사용',
};

const GIB = 1024 ** 3;
/** gp3 기본 포함 성능 */
const GP3_BASE_IOPS = 3000;
const GP3_BASE_THROUGHPUT = 125;

export interface EstimateInput {
  inventory: ClusterInventorySnapshot;
  aws: AwsResourceSnapshot;
  prices: PriceBook;
  hoursPerMonth: number;
  eksSupportTier: 'standard' | 'extended';
  /** LB 소속 판단용 (태그 elbv2.k8s.aws/cluster 등) */
  clusterName: string | null;
}

function inventoryUsable(inv: ClusterInventorySnapshot): boolean {
  return inv.state === 'ok' || inv.state === 'stale';
}

export function computeEstimate(input: EstimateInput): EstimateComputation {
  const { inventory, aws, prices, hoursPerMonth } = input;
  const perMonth = (h: number | null): number | null =>
    h === null ? null : r6(h * hoursPerMonth);
  const useInventory = inventoryUsable(inventory);

  const instancesById = new Map<string, AwsInstance>();
  for (const i of aws.instances) instancesById.set(i.instanceId, i);

  // -------------------------------------------------------------- EC2
  const ec2: Ec2Row[] = [];
  const nodeByInstance = new Map<string, string>();
  const clusterInstanceIds = new Set<string>();
  const ipv4Sources: { key: string; nodeName: string | null; count: number }[] =
    [];

  const addEc2 = (node: InventoryNode | null, inst: AwsInstance | null) => {
    const instanceType = inst?.instanceType ?? node?.instanceType ?? null;
    const zone = inst?.zone ?? node?.zone ?? null;
    const capacityType: 'on_demand' | 'spot' =
      inst?.lifecycle === 'spot'
        ? 'spot'
        : (node?.capacityType ?? inst?.lifecycle ?? 'on_demand');
    const notes: Note[] = [];
    let unitPrice: Ec2Row['unitPrice'] = null;
    let spotFallback = false;
    const od = instanceType ? (prices.onDemand[instanceType] ?? null) : null;
    if (instanceType && capacityType === 'spot') {
      const sq = zone
        ? (prices.spot[spotKey(instanceType, zone)] ?? null)
        : null;
      if (sq) {
        unitPrice = {
          usdPerHour: sq.usd,
          source: 'spot_price_history',
          asOf: sq.fetchedAt,
          zone: sq.zone,
        };
      } else if (od) {
        spotFallback = true;
        unitPrice = {
          usdPerHour: od.usd,
          source: 'on_demand_fallback',
          asOf: od.fetchedAt,
          zone: null,
        };
        notes.push(NOTE_SPOT_FALLBACK);
      }
    } else if (od) {
      unitPrice = {
        usdPerHour: od.usd,
        source: 'pricing_api',
        asOf: od.fetchedAt,
        zone: null,
      };
    }
    if (od?.cacheUsed && unitPrice && unitPrice.source !== 'spot_price_history')
      notes.push(NOTE_PRICE_CACHE);
    if (!unitPrice) notes.push(NOTE_UNPRICED);
    const usdPerHour = unitPrice ? r6(unitPrice.usdPerHour) : null;
    const nodeName = node?.name ?? null;
    const key = nodeName
      ? `node:${nodeName}`
      : `instance:${inst?.instanceId ?? 'unknown'}`;
    ec2.push({
      key,
      nodeName,
      instanceId: inst?.instanceId ?? null,
      nodeGroup: node?.nodeGroup ?? inst?.nodeGroupTag ?? null,
      instanceType,
      capacityType,
      zone,
      architecture: node?.architecture ?? inst?.architecture ?? null,
      priced: unitPrice !== null,
      unitPrice,
      spotFallback,
      usdPerHour,
      usdPerMonth: perMonth(usdPerHour),
      notes,
    });
    if (inst) {
      clusterInstanceIds.add(inst.instanceId);
      if (nodeName) nodeByInstance.set(inst.instanceId, nodeName);
      if (inst.publicIpv4Count > 0) {
        ipv4Sources.push({
          key: `ipv4:${nodeName ?? inst.instanceId}`,
          nodeName,
          count: inst.publicIpv4Count,
        });
      }
    }
  };

  if (useInventory) {
    for (const node of inventory.nodes) {
      const id = instanceIdFromProviderId(node.providerId);
      addEc2(node, id ? (instancesById.get(id) ?? null) : null);
    }
  } else {
    for (const inst of aws.instances) addEc2(null, inst);
  }

  // -------------------------------------------------------------- IPv4
  const ipv4: Ipv4Row[] = ipv4Sources.map((s) => {
    const p = prices.ipv4;
    const usdPerHour = p ? r6(p.usd * s.count) : null;
    return {
      key: s.key,
      nodeName: s.nodeName,
      count: s.count,
      priced: p !== null,
      unitPrice: p
        ? { usdPerHour: p.usd, source: 'pricing_api', asOf: p.fetchedAt }
        : null,
      usdPerHour,
      usdPerMonth: perMonth(usdPerHour),
      notes: p ? [] : [NOTE_UNPRICED],
    };
  });

  // -------------------------------------------------------------- EBS
  const outOfCluster: Partial<Record<CostCategory, number>> = {};
  const bumpOut = (c: CostCategory) => {
    outOfCluster[c] = (outOfCluster[c] ?? 0) + 1;
  };
  const rootVolumeOwner = new Map<string, string>();
  for (const inst of aws.instances) {
    if (!clusterInstanceIds.has(inst.instanceId)) continue;
    for (const v of inst.rootVolumeIds) rootVolumeOwner.set(v, inst.instanceId);
  }
  const pvcByHandle = new Map<string, { namespace: string; name: string }>();
  const pvcNames = new Set<string>();
  if (useInventory) {
    for (const p of inventory.pvcs) {
      if (p.volumeHandle) pvcByHandle.set(p.volumeHandle, p);
      pvcNames.add(`${p.namespace}/${p.name}`);
    }
  }

  const ebs: EbsRow[] = [];
  for (const v of aws.volumes) {
    const attachedToCluster = v.attachedInstanceIds.some((id) =>
      clusterInstanceIds.has(id),
    );
    const attachedNode =
      v.attachedInstanceIds
        .map((id) => nodeByInstance.get(id))
        .find((n) => n !== undefined) ?? null;
    let attachment: EbsRow['attachment'] | null = null;
    const byHandle = pvcByHandle.get(v.volumeId);
    const tagPvc =
      v.pvcNamespace && v.pvcName
        ? { namespace: v.pvcNamespace, name: v.pvcName }
        : null;
    if (byHandle) {
      attachment = { type: 'pvc', ...byHandle, nodeName: attachedNode };
    } else if (
      tagPvc &&
      (pvcNames.has(`${tagPvc.namespace}/${tagPvc.name}`) ||
        (!useInventory && attachedToCluster))
    ) {
      attachment = { type: 'pvc', ...tagPvc, nodeName: attachedNode };
    } else if (rootVolumeOwner.has(v.volumeId)) {
      attachment = {
        type: 'node_root',
        namespace: null,
        name: null,
        nodeName:
          nodeByInstance.get(rootVolumeOwner.get(v.volumeId) ?? '') ?? null,
      };
    } else if (attachedToCluster) {
      attachment = {
        type: 'other',
        namespace: null,
        name: null,
        nodeName: attachedNode,
      };
    }
    if (!attachment) {
      bumpOut('ebs');
      continue;
    }
    ebs.push(priceVolume(v, attachment, prices, hoursPerMonth));
  }

  // -------------------------------------------------------------- LB
  const hostIndex = new Map<string, K8sRef[]>();
  if (useInventory) {
    for (const a of inventory.loadBalancers) {
      for (const h of a.hostnames) {
        const k = h.toLowerCase();
        const list = hostIndex.get(k) ?? [];
        list.push({ kind: a.kind, namespace: a.namespace, name: a.name });
        hostIndex.set(k, list);
      }
    }
  }
  const lb: LbRow[] = [];
  for (const l of aws.loadBalancers) {
    const refs = dedupeRefs([
      ...(hostIndex.get(l.dnsName.toLowerCase()) ?? []),
      ...l.tagRefs,
    ]);
    const member =
      refs.length > 0 ||
      (input.clusterName !== null && l.clusterTags.includes(input.clusterName));
    if (!member) {
      bumpOut('lb');
      continue;
    }
    const p = prices.lb[l.lbType] ?? null;
    const usdPerHour = p ? r6(p.usd) : null;
    lb.push({
      key: `lb:${l.name}`,
      name: l.name,
      lbType: l.lbType,
      attachedTo: refs,
      healthyTargets: l.healthyTargets,
      priced: p !== null,
      unitPrice: p
        ? { usdPerHour: p.usd, source: 'pricing_api', asOf: p.fetchedAt }
        : null,
      usdPerHour,
      usdPerMonth: perMonth(usdPerHour),
      notes: p ? [] : [NOTE_UNPRICED],
    });
  }

  // -------------------------------------------------------------- EKS
  const eks: EksRow[] = [];
  if (aws.eks) {
    const tier = input.eksSupportTier;
    const p = prices.eks[tier];
    const usdPerHour = p ? r6(p.usd) : null;
    eks.push({
      key: `eks:${aws.eks.name}`,
      clusterName: aws.eks.name,
      version: aws.eks.version,
      supportTier: tier,
      priced: p !== null,
      unitPrice: p
        ? { usdPerHour: p.usd, source: 'pricing_api', asOf: p.fetchedAt }
        : null,
      usdPerHour,
      usdPerMonth: perMonth(usdPerHour),
      notes: p ? [] : [NOTE_UNPRICED],
    });
  }

  // -------------------------------------------------------------- 합계
  const rowsByCat: Record<CostCategory, { usdPerHour: number | null }[]> = {
    ec2,
    ebs,
    lb,
    ipv4,
    eks,
  };
  const catSums = COST_CATEGORIES.map((c) => {
    const rows = rowsByCat[c];
    const sum = rows.reduce((s, r) => s + (r.usdPerHour ?? 0), 0);
    return {
      category: c,
      count: rows.length,
      sum,
      unpriced: rows.filter((r) => r.usdPerHour === null).length,
    };
  });
  const totalHour = catSums.reduce((s, c) => s + c.sum, 0);
  const categories: CategoryRow[] = catSums.map((c) => ({
    category: c.category,
    label: CATEGORY_LABELS[c.category],
    count: c.count,
    usdPerHour: r6(c.sum),
    usdPerMonth: r6(c.sum * hoursPerMonth),
    sharePct: totalHour > 0 ? Math.round((c.sum / totalHour) * 1000) / 10 : 0,
    unpricedCount: c.unpriced,
  }));
  const unpricedCount = catSums.reduce((s, c) => s + c.unpriced, 0);
  const outCount = Object.values(outOfCluster).reduce((s, n) => s + n, 0);

  return {
    total: {
      usdPerHour: r6(totalHour),
      usdPerDay: r6(totalHour * 24),
      usdPerMonth: r6(totalHour * hoursPerMonth),
    },
    categories,
    resources: { ec2, ebs, lb, ipv4, eks },
    unpricedCount,
    spotFallbackCount: ec2.filter((r) => r.spotFallback).length,
    outOfCluster: { count: outCount, byCategory: outOfCluster },
    sampleResources: toSampleResources({ ec2, ebs, lb, ipv4, eks }),
    nodeCount: ec2.length,
  };
}

function priceVolume(
  v: AwsResourceSnapshot['volumes'][number],
  attachment: EbsRow['attachment'],
  prices: PriceBook,
  hoursPerMonth: number,
): EbsRow {
  const p = prices.ebs[v.volumeType];
  const storage = p?.storage ?? null;
  const notes: Note[] = [];
  let usdPerMonth: number | null = null;
  let unitPrice: EbsRow['unitPrice'] = null;
  if (storage) {
    let month = v.sizeGiB * storage.usd;
    const extraIops = extraIopsFor(v.volumeType, v.iops);
    const extraTp =
      v.volumeType === 'gp3' && v.throughputMibps !== null
        ? Math.max(0, v.throughputMibps - GP3_BASE_THROUGHPUT)
        : 0;
    if (extraIops > 0 && p?.iops) month += extraIops * p.iops.usd;
    if (extraTp > 0 && p?.throughput) month += extraTp * p.throughput.usd;
    usdPerMonth = month;
    unitPrice = {
      usdPerGbMonth: storage.usd,
      usdPerIopsMonth: extraIops > 0 && p?.iops ? p.iops.usd : null,
      usdPerMibpsMonth: extraTp > 0 && p?.throughput ? p.throughput.usd : null,
      source: 'pricing_api',
      asOf: storage.fetchedAt,
    };
    if (storage.cacheUsed) notes.push(NOTE_PRICE_CACHE);
  } else {
    notes.push(NOTE_UNPRICED);
  }
  const usdPerHour =
    usdPerMonth === null ? null : r6(usdPerMonth / hoursPerMonth);
  return {
    key: `vol:${v.volumeId}`,
    volumeId: v.volumeId,
    volumeType: v.volumeType,
    sizeBytes: Math.round(v.sizeGiB * GIB),
    iops: v.iops,
    throughputMibps: v.throughputMibps,
    attachment,
    priced: unitPrice !== null,
    unitPrice,
    usdPerHour,
    usdPerMonth: usdPerMonth === null ? null : r6(usdPerMonth),
    notes,
  };
}

/** 추가 과금되는 IOPS (gp3는 3000 초과분, io1/io2는 전체) */
export function extraIopsFor(volumeType: string, iops: number | null): number {
  if (iops === null) return 0;
  if (volumeType === 'gp3') return Math.max(0, iops - GP3_BASE_IOPS);
  if (volumeType === 'io1' || volumeType === 'io2') return iops;
  return 0;
}

function dedupeRefs(refs: K8sRef[]): K8sRef[] {
  const seen = new Set<string>();
  const out: K8sRef[] = [];
  for (const r of refs) {
    const k = `${r.kind}/${r.namespace}/${r.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function toSampleResources(
  res: EstimateComputation['resources'],
): SampleResource[] {
  const out: SampleResource[] = [];
  for (const r of res.ec2) {
    if (r.usdPerHour === null) continue;
    out.push({
      kind: 'ec2',
      key: r.key,
      type: r.instanceType,
      option: r.capacityType,
      az: r.zone,
      usdPerHour: r.usdPerHour,
      label: r.nodeGroup,
    });
  }
  for (const r of res.ebs) {
    if (r.usdPerHour === null) continue;
    out.push({
      kind: 'ebs',
      key: r.key,
      type: r.volumeType,
      option: r.attachment.type,
      az: null,
      usdPerHour: r.usdPerHour,
      sizeGiB: Math.round(r.sizeBytes / GIB),
    });
  }
  for (const r of res.lb) {
    if (r.usdPerHour === null) continue;
    out.push({
      kind: 'lb',
      key: r.key,
      type: r.lbType,
      option: null,
      az: null,
      usdPerHour: r.usdPerHour,
    });
  }
  for (const r of res.ipv4) {
    if (r.usdPerHour === null) continue;
    out.push({
      kind: 'ipv4',
      key: r.key,
      type: String(r.count),
      option: null,
      az: null,
      usdPerHour: r.usdPerHour,
    });
  }
  for (const r of res.eks) {
    if (r.usdPerHour === null) continue;
    out.push({
      kind: 'eks',
      key: r.key,
      type: r.supportTier,
      option: r.version,
      az: null,
      usdPerHour: r.usdPerHour,
    });
  }
  return out;
}

/** 단가 없이 한 번 계산해 필요한 단가 목록을 뽑는다 (행 구성 규칙을 한 곳에 두기 위해) */
export function emptyPriceBook(): PriceBook {
  return {
    onDemand: {},
    spot: {},
    ebs: {},
    lb: {},
    ipv4: null,
    eks: { standard: null, extended: null },
    meta: {
      fetchedAt: null,
      cacheUsed: false,
      cacheFetchedAt: null,
      allFailed: false,
      spotFetchedAt: null,
    },
  };
}

export interface PriceNeedList {
  instanceTypes: string[];
  spot: { type: string; zone: string }[];
  ebs: { volumeType: string; iops: boolean; throughput: boolean }[];
  lb: EstimateComputation['resources']['lb'][number]['lbType'][];
  ipv4: boolean;
  eks: boolean;
}

export function priceNeedsOf(dry: EstimateComputation): PriceNeedList {
  const types = new Set<string>();
  const spot = new Map<string, { type: string; zone: string }>();
  for (const r of dry.resources.ec2) {
    if (!r.instanceType) continue;
    types.add(r.instanceType);
    if (r.capacityType === 'spot' && r.zone)
      spot.set(spotKey(r.instanceType, r.zone), {
        type: r.instanceType,
        zone: r.zone,
      });
  }
  const ebs = new Map<
    string,
    { volumeType: string; iops: boolean; throughput: boolean }
  >();
  for (const v of dry.resources.ebs) {
    const cur = ebs.get(v.volumeType) ?? {
      volumeType: v.volumeType,
      iops: false,
      throughput: false,
    };
    if (extraIopsFor(v.volumeType, v.iops) > 0) cur.iops = true;
    if (v.volumeType === 'gp3' && (v.throughputMibps ?? 0) > 125)
      cur.throughput = true;
    ebs.set(v.volumeType, cur);
  }
  return {
    instanceTypes: [...types],
    spot: [...spot.values()],
    ebs: [...ebs.values()],
    lb: [...new Set(dry.resources.lb.map((l) => l.lbType))],
    ipv4: dry.resources.ipv4.length > 0,
    eks: dry.resources.eks.length > 0,
  };
}
