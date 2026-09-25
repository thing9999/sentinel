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
  CONTROL_PLANE_KIND_LABELS,
  CONTROL_PLANE_KINDS,
  COST_CATEGORIES,
  spotKey,
  type AwsInstance,
  type AwsResourceSnapshot,
  type CategoryRow,
  type CostCategory,
  type EbsRow,
  type Ec2Row,
  type ControlPlaneRow,
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
  /** 컨트롤 플레인(마스터) 내역. ec2·ebs·lb·ipv4에 중복으로 넣지 않는다 (AC-KOPS29) */
  const cp: ControlPlaneRow[] = [];
  const nodeByInstance = new Map<string, string>();
  const clusterInstanceIds = new Set<string>();
  /** 마스터 인스턴스 ID (EBS·IPv4 분류의 기준) */
  const masterInstanceIds = new Set<string>();
  const masterNodeNames = new Set<string>();
  const ipv4Sources: {
    key: string;
    nodeName: string | null;
    count: number;
    master: boolean;
  }[] = [];

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
    // 마스터 판별은 **노드 라벨에서 출발**한다 (역할 태그 규칙을 확인하지 못했으므로 태그에 의존하지 않는다)
    const isMaster = node?.role === 'control_plane';
    const key = nodeName
      ? `node:${nodeName}`
      : `instance:${inst?.instanceId ?? 'unknown'}`;
    const row = {
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
    };
    if (isMaster) {
      cp.push({ key: `cp:${key}`, kind: 'master_ec2', ...row });
      if (nodeName) masterNodeNames.add(nodeName);
      if (inst) masterInstanceIds.add(inst.instanceId);
    } else {
      ec2.push({ key, ...row });
    }
    if (inst) {
      clusterInstanceIds.add(inst.instanceId);
      if (nodeName) nodeByInstance.set(inst.instanceId, nodeName);
      if (inst.publicIpv4Count > 0) {
        ipv4Sources.push({
          key: `ipv4:${nodeName ?? inst.instanceId}`,
          nodeName,
          count: inst.publicIpv4Count,
          master: isMaster,
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
  const ipv4: Ipv4Row[] = [];
  for (const s of ipv4Sources) {
    const p = prices.ipv4;
    const usdPerHour = p ? r6(p.usd * s.count) : null;
    const row = {
      nodeName: s.nodeName,
      count: s.count,
      priced: p !== null,
      unitPrice: p
        ? ({
            usdPerHour: p.usd,
            source: 'pricing_api',
            asOf: p.fetchedAt,
          } as const)
        : null,
      usdPerHour,
      usdPerMonth: perMonth(usdPerHour),
      notes: p ? [] : [NOTE_UNPRICED],
    };
    if (s.master) cp.push({ key: `cp:${s.key}`, kind: 'master_ipv4', ...row });
    else ipv4.push({ key: s.key, ...row });
  }

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
    const row = priceVolume(v, attachment, prices, hoursPerMonth);
    const onMaster =
      v.attachedInstanceIds.some((id) => masterInstanceIds.has(id)) ||
      (attachment.nodeName !== null &&
        masterNodeNames.has(attachment.nodeName));
    // 마스터에 붙어 있고 PVC가 아닌 볼륨 → 컨트롤 플레인 (루트 볼륨 / etcd 볼륨)
    if (onMaster && attachment.type !== 'pvc') {
      cp.push({
        key: `cp:${row.key}`,
        kind: attachment.type === 'node_root' ? 'master_root_ebs' : 'etcd_ebs',
        volumeId: row.volumeId,
        volumeType: row.volumeType,
        sizeBytes: row.sizeBytes,
        iops: row.iops,
        throughputMibps: row.throughputMibps,
        // main/events 구분은 볼륨 태그 규칙을 확인하지 못해 null로 둔다 (계약 3.1)
        ...(attachment.type === 'other' ? { etcdCluster: null } : {}),
        nodeName: attachment.nodeName,
        priced: row.priced,
        unitPrice: row.unitPrice,
        usdPerHour: row.usdPerHour,
        usdPerMonth: row.usdPerMonth,
        notes: row.notes,
      });
      continue;
    }
    ebs.push(row);
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
  /**
   * API 서버 LB 후보 (계약 3.1 "후보 규칙 — 추정. 확정 아님", 명세 U2):
   * ① 클러스터 태그가 있고 ② 어떤 Service·Ingress에도 귀속되지 않는다.
   * kOps NLB의 확정 이름·태그 규칙은 실클러스터에서 확인하지 못했다 → 결과에 항상 "추정" 표시를 붙인다.
   */
  const apiLbCandidates: LbRow[] = [];
  for (const l of aws.loadBalancers) {
    const refs = dedupeRefs([
      ...(hostIndex.get(l.dnsName.toLowerCase()) ?? []),
      ...l.tagRefs,
    ]);
    const hasClusterTag =
      input.clusterName !== null && l.clusterTags.includes(input.clusterName);
    const member = refs.length > 0 || hasClusterTag;
    if (!member) {
      bumpOut('lb');
      continue;
    }
    const p = prices.lb[l.lbType] ?? null;
    const usdPerHour = p ? r6(p.usd) : null;
    const row: LbRow = {
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
    };
    if (hasClusterTag && refs.length === 0) apiLbCandidates.push(row);
    else lb.push(row);
  }
  const apiLbState: 'assumed' | 'ambiguous' | 'not_found' =
    apiLbCandidates.length === 0
      ? 'not_found'
      : apiLbCandidates.length === 1
        ? 'assumed'
        : 'ambiguous';
  for (const row of apiLbCandidates) {
    cp.push({
      key: `cp:${row.key}`,
      kind: 'api_lb',
      name: row.name,
      lbType: row.lbType,
      attachedTo: row.attachedTo,
      healthyTargets: row.healthyTargets,
      identification: {
        confidence: apiLbState === 'ambiguous' ? 'ambiguous' : 'assumed',
        matchedBy: ['cluster_tag', 'no_service_or_ingress_ownership'],
        candidateCount: apiLbCandidates.length,
      },
      priced: row.priced,
      unitPrice: row.unitPrice,
      usdPerHour: row.usdPerHour,
      usdPerMonth: row.usdPerMonth,
      notes: [
        ...row.notes,
        apiLbState === 'ambiguous'
          ? {
              code: 'API_LB_AMBIGUOUS',
              text: `API 서버 LB 후보 ${apiLbCandidates.length}개 — 확인 필요`,
            }
          : { code: 'API_LB_ASSUMED', text: 'API 서버 LB로 추정' },
      ],
    });
  }
  const apiLbInfo = {
    state: apiLbState,
    candidateCount: apiLbCandidates.length,
    text:
      apiLbState === 'assumed'
        ? 'API 서버 LB로 추정 (1개)'
        : apiLbState === 'ambiguous'
          ? `API 서버 LB 후보 ${apiLbCandidates.length}개 — 확인 필요`
          : 'API 서버 LB를 찾지 못했습니다 (내부 LB이거나 LB 없는 구성일 수 있습니다)',
  };

  // -------------------------------------------------------------- 합계
  const rowsByCat: Record<CostCategory, { usdPerHour: number | null }[]> = {
    ec2,
    ebs,
    lb,
    ipv4,
    controlPlane: cp,
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
  const categories: CategoryRow[] = catSums.map((c) => {
    const row: CategoryRow = {
      category: c.category,
      label: CATEGORY_LABELS[c.category],
      count: c.count,
      usdPerHour: r6(c.sum),
      usdPerMonth: r6(c.sum * hoursPerMonth),
      sharePct: totalHour > 0 ? Math.round((c.sum / totalHour) * 1000) / 10 : 0,
      unpricedCount: c.unpriced,
    };
    if (c.category !== 'controlPlane') return row;
    row.byKind = CONTROL_PLANE_KINDS.map((kind) => {
      const rows = cp.filter((r) => r.kind === kind);
      const sum = rows.reduce((a, r) => a + (r.usdPerHour ?? 0), 0);
      return {
        kind,
        label: CONTROL_PLANE_KIND_LABELS[kind],
        count: rows.length,
        usdPerHour: r6(sum),
        usdPerMonth: r6(sum * hoursPerMonth),
        ...(kind === 'api_lb' ? { estimated: true } : {}),
      };
    }).filter((k) => k.count > 0);
    // 후보가 0개여서 api_lb 행이 없을 때도 이 객체는 항상 있다 (AC-KOPS30)
    row.apiLb = apiLbInfo;
    row.notes = [
      {
        code:
          apiLbState === 'assumed'
            ? 'API_LB_ASSUMED'
            : apiLbState === 'ambiguous'
              ? 'API_LB_AMBIGUOUS'
              : 'API_LB_NOT_FOUND',
        text: apiLbInfo.text,
      },
    ];
    return row;
  });
  const unpricedCount = catSums.reduce((s, c) => s + c.unpriced, 0);
  const outCount = Object.values(outOfCluster).reduce((s, n) => s + n, 0);

  return {
    total: {
      usdPerHour: r6(totalHour),
      usdPerDay: r6(totalHour * 24),
      usdPerMonth: r6(totalHour * hoursPerMonth),
    },
    categories,
    resources: { ec2, ebs, lb, ipv4, controlPlane: cp },
    unpricedCount,
    spotFallbackCount: ec2.filter((r) => r.spotFallback).length,
    outOfCluster: { count: outCount, byCategory: outOfCluster },
    sampleResources: toSampleResources({
      ec2,
      ebs,
      lb,
      ipv4,
      controlPlane: cp,
    }),
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
  for (const r of res.controlPlane) {
    if (r.usdPerHour === null) continue;
    out.push({
      kind: 'controlPlane',
      key: r.key,
      type: r.instanceType ?? r.volumeType ?? r.lbType ?? null,
      // 하위 종류를 option에 담는다 (급증 원인 문장이 "마스터 EC2"를 구분할 수 있게)
      option: r.kind,
      az: r.zone ?? null,
      usdPerHour: r.usdPerHour,
      ...(r.sizeBytes !== undefined
        ? { sizeGiB: Math.round(r.sizeBytes / GIB) }
        : {}),
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
}

export function priceNeedsOf(dry: EstimateComputation): PriceNeedList {
  const types = new Set<string>();
  const spot = new Map<string, { type: string; zone: string }>();
  // 컨트롤 플레인 행(마스터 EC2·etcd/루트 EBS·API LB)도 같은 단가표를 쓴다.
  // 빠뜨리면 마스터가 통째로 "단가 없음"이 된다.
  const cpEc2 = dry.resources.controlPlane.filter(
    (r) => r.kind === 'master_ec2',
  );
  for (const r of [...dry.resources.ec2, ...cpEc2]) {
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
  const cpEbs = dry.resources.controlPlane.filter(
    (r) => r.volumeType !== undefined,
  ) as (EstimateComputation['resources']['ebs'][number] &
    EstimateComputation['resources']['controlPlane'][number])[];
  for (const v of [...dry.resources.ebs, ...cpEbs]) {
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
    lb: [
      ...new Set([
        ...dry.resources.lb.map((l) => l.lbType),
        ...dry.resources.controlPlane
          .map((r) => r.lbType)
          .filter((t): t is NonNullable<typeof t> => t !== undefined),
      ]),
    ],
    ipv4:
      dry.resources.ipv4.length > 0 ||
      dry.resources.controlPlane.some((r) => r.kind === 'master_ipv4'),
  };
}
