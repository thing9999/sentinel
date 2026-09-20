/**
 * AWS SDK v3 구현 (live 모드에서만 생성). 자격 증명은 기본 체인(`fromNodeProviderChain`, AWS_PROFILE 존중).
 * Pricing·Cost Explorer는 전역 엔드포인트 us-east-1, 나머지는 클러스터 리전.
 * 읽기 전용 호출만 있다 (생성·수정·삭제 명령 없음).
 */
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
  type Expression,
} from '@aws-sdk/client-cost-explorer';
import {
  DescribeInstancesCommand,
  DescribeSpotPriceHistoryCommand,
  DescribeVolumesCommand,
  EC2Client,
  type Filter,
  type Instance,
  type Tag,
  type Volume,
} from '@aws-sdk/client-ec2';
import { DescribeClusterCommand, EKSClient } from '@aws-sdk/client-eks';
import {
  DescribeLoadBalancersCommand,
  DescribeTagsCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  type LoadBalancer,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type {
  AwsEksCluster,
  AwsInstance,
  AwsLoadBalancer,
  AwsVolume,
  K8sRef,
} from '../cost.types';
import type { CauPage } from '../explorer/ce-normalize';
import type {
  CostAndUsageRequest,
  CostAwsGateway,
  CostForecastRequest,
  CostForecastResponse,
  PriceListProduct,
} from './aws-gateway';

const GLOBAL_REGION = 'us-east-1';
const MAX_DESCRIBE_PAGES = 20;

export class AwsSdkCostGateway implements CostAwsGateway {
  private readonly ec2: EC2Client;
  private readonly elb: ElasticLoadBalancingV2Client;
  private readonly eks: EKSClient;
  private readonly pricing: PricingClient;
  private readonly ce: CostExplorerClient;

  constructor(
    readonly region: string,
    profile?: string,
  ) {
    const credentials = fromNodeProviderChain(profile ? { profile } : {});
    const base = { credentials, maxAttempts: 2 };
    this.ec2 = new EC2Client({ ...base, region });
    this.elb = new ElasticLoadBalancingV2Client({ ...base, region });
    this.eks = new EKSClient({ ...base, region });
    this.pricing = new PricingClient({ ...base, region: GLOBAL_REGION });
    // CE는 재시도하면 호출 비용이 늘어나므로 1회만
    this.ce = new CostExplorerClient({
      credentials,
      region: GLOBAL_REGION,
      maxAttempts: 1,
    });
  }

  async describeInstances(q: {
    instanceIds?: string[];
    clusterName?: string | null;
  }): Promise<AwsInstance[]> {
    const out: AwsInstance[] = [];
    const run = async (input: {
      InstanceIds?: string[];
      Filters?: Filter[];
    }) => {
      let token: string | undefined;
      let pages = 0;
      do {
        const res = await this.ec2.send(
          new DescribeInstancesCommand({ ...input, NextToken: token }),
        );
        for (const r of res.Reservations ?? [])
          for (const i of r.Instances ?? []) {
            const inst = toInstance(i);
            if (inst) out.push(inst);
          }
        token = res.NextToken;
        pages += 1;
      } while (token && pages < MAX_DESCRIBE_PAGES);
    };
    if (q.instanceIds && q.instanceIds.length > 0) {
      for (let i = 0; i < q.instanceIds.length; i += 200) {
        await run({ InstanceIds: q.instanceIds.slice(i, i + 200) });
      }
    } else if (q.clusterName) {
      await run({
        Filters: [
          {
            Name: 'tag-key',
            Values: [`kubernetes.io/cluster/${q.clusterName}`],
          },
          { Name: 'instance-state-name', Values: ['pending', 'running'] },
        ],
      });
    }
    return out;
  }

  async describeVolumes(q: {
    attachedInstanceIds: string[];
  }): Promise<AwsVolume[]> {
    const byId = new Map<string, AwsVolume>();
    const run = async (filters: Filter[]) => {
      let token: string | undefined;
      let pages = 0;
      do {
        const res = await this.ec2.send(
          new DescribeVolumesCommand({ Filters: filters, NextToken: token }),
        );
        for (const v of res.Volumes ?? []) {
          const vol = toVolume(v);
          if (vol) byId.set(vol.volumeId, vol);
        }
        token = res.NextToken;
        pages += 1;
      } while (token && pages < MAX_DESCRIBE_PAGES);
    };
    for (let i = 0; i < q.attachedInstanceIds.length; i += 199) {
      await run([
        {
          Name: 'attachment.instance-id',
          Values: q.attachedInstanceIds.slice(i, i + 199),
        },
      ]);
    }
    // 붙지 않은 PVC 볼륨까지 보려면 CSI 태그로 한 번 더
    await run([{ Name: 'tag-key', Values: ['ebs.csi.aws.com/cluster'] }]);
    return [...byId.values()];
  }

  async describeLoadBalancers(): Promise<AwsLoadBalancer[]> {
    const lbs: LoadBalancer[] = [];
    let marker: string | undefined;
    let pages = 0;
    do {
      const res = await this.elb.send(
        new DescribeLoadBalancersCommand({ Marker: marker }),
      );
      lbs.push(...(res.LoadBalancers ?? []));
      marker = res.NextMarker;
      pages += 1;
    } while (marker && pages < MAX_DESCRIBE_PAGES);
    const relevant = lbs.filter(
      (l) =>
        l.LoadBalancerArn && (l.Type === 'application' || l.Type === 'network'),
    );
    const tagsByArn = new Map<string, Tag[]>();
    for (let i = 0; i < relevant.length; i += 20) {
      const res = await this.elb.send(
        new DescribeTagsCommand({
          ResourceArns: relevant
            .slice(i, i + 20)
            .map((l) => l.LoadBalancerArn!),
        }),
      );
      for (const d of res.TagDescriptions ?? [])
        if (d.ResourceArn) tagsByArn.set(d.ResourceArn, d.Tags ?? []);
    }
    // 대상 그룹 → LB별 healthy 대상 수
    const healthy = new Map<string, number>();
    let tgMarker: string | undefined;
    pages = 0;
    const tgs: { arn: string; lbArns: string[] }[] = [];
    do {
      const res = await this.elb.send(
        new DescribeTargetGroupsCommand({ Marker: tgMarker }),
      );
      for (const tg of res.TargetGroups ?? [])
        if (tg.TargetGroupArn)
          tgs.push({
            arn: tg.TargetGroupArn,
            lbArns: tg.LoadBalancerArns ?? [],
          });
      tgMarker = res.NextMarker;
      pages += 1;
    } while (tgMarker && pages < MAX_DESCRIBE_PAGES);
    const relevantArns = new Set(relevant.map((l) => l.LoadBalancerArn!));
    for (const tg of tgs) {
      const lbArns = tg.lbArns.filter((a) => relevantArns.has(a));
      if (lbArns.length === 0) continue;
      const res = await this.elb.send(
        new DescribeTargetHealthCommand({ TargetGroupArn: tg.arn }),
      );
      const n = (res.TargetHealthDescriptions ?? []).filter(
        (t) => t.TargetHealth?.State === 'healthy',
      ).length;
      for (const a of lbArns) healthy.set(a, (healthy.get(a) ?? 0) + n);
    }
    return relevant.map((l) => {
      const arn = l.LoadBalancerArn!;
      const tags = tagMap(tagsByArn.get(arn));
      return {
        name:
          l.LoadBalancerName ?? arn.split('/').slice(-2, -1)[0] ?? 'unknown',
        dnsName: l.DNSName ?? '',
        lbType: l.Type === 'network' ? 'nlb' : 'alb',
        tagRefs: refsFromLbTags(tags),
        clusterTags: clusterNamesFromTags(tags),
        healthyTargets: healthy.get(arn) ?? 0,
      };
    });
  }

  async describeEksCluster(name: string): Promise<AwsEksCluster | null> {
    const res = await this.eks.send(new DescribeClusterCommand({ name }));
    if (!res.cluster) return null;
    return {
      name: res.cluster.name ?? name,
      version: res.cluster.version ?? null,
    };
  }

  async getProducts(
    serviceCode: string,
    filters: Record<string, string>,
    maxPages = 3,
  ): Promise<PriceListProduct[]> {
    const out: PriceListProduct[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const res = await this.pricing.send(
        new GetProductsCommand({
          ServiceCode: serviceCode,
          FormatVersion: 'aws_v1',
          MaxResults: 100,
          NextToken: token,
          Filters: Object.entries(filters).map(([Field, Value]) => ({
            Type: 'TERM_MATCH',
            Field,
            Value,
          })),
        }),
      );
      const list: unknown = res.PriceList;
      if (Array.isArray(list)) {
        for (const item of list as unknown[]) {
          const p = parsePriceListItem(item);
          if (p) out.push(p);
        }
      }
      token = res.NextToken;
      pages += 1;
    } while (token && pages < maxPages);
    return out;
  }

  async getLatestSpotPrice(
    instanceType: string,
    zone: string,
  ): Promise<{ usdPerHour: number; timestamp: Date } | null> {
    const res = await this.ec2.send(
      new DescribeSpotPriceHistoryCommand({
        InstanceTypes: [instanceType as never],
        AvailabilityZone: zone,
        ProductDescriptions: ['Linux/UNIX'],
        StartTime: new Date(),
        MaxResults: 10,
      }),
    );
    let best: { usdPerHour: number; timestamp: Date } | null = null;
    for (const h of res.SpotPriceHistory ?? []) {
      const price = Number(h.SpotPrice);
      if (!Number.isFinite(price) || !h.Timestamp) continue;
      if (!best || h.Timestamp > best.timestamp)
        best = { usdPerHour: price, timestamp: h.Timestamp };
    }
    return best;
  }

  async getCostAndUsagePage(req: CostAndUsageRequest): Promise<CauPage> {
    const res = await this.ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: req.start, End: req.end },
        Granularity: 'DAILY',
        Metrics: [req.metric],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        Filter: tagExpression(req.tagFilter),
        NextPageToken: req.nextPageToken ?? undefined,
      }),
    );
    return {
      days: (res.ResultsByTime ?? []).map((r) => ({
        date: r.TimePeriod?.Start ?? '',
        groups: (r.Groups ?? []).map((g) => ({
          service: g.Keys?.[0] ?? 'Unknown',
          amount: Number(g.Metrics?.[req.metric]?.Amount ?? 0) || 0,
        })),
      })),
      nextPageToken: res.NextPageToken ?? null,
    };
  }

  async getCostForecast(
    req: CostForecastRequest,
  ): Promise<CostForecastResponse> {
    const res = await this.ce.send(
      new GetCostForecastCommand({
        TimePeriod: { Start: req.start, End: req.end },
        Granularity: 'DAILY',
        Metric:
          req.metric === 'AmortizedCost' ? 'AMORTIZED_COST' : 'UNBLENDED_COST',
        PredictionIntervalLevel: 80,
        Filter: tagExpression(req.tagFilter),
      }),
    );
    const num = (s: string | undefined): number | null => {
      if (s === undefined) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    return {
      totalUsd: num(res.Total?.Amount) ?? 0,
      days: (res.ForecastResultsByTime ?? []).map((f) => ({
        date: f.TimePeriod?.Start ?? '',
        mean: num(f.MeanValue) ?? 0,
        low: num(f.PredictionIntervalLowerBound),
        high: num(f.PredictionIntervalUpperBound),
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// 정리 도우미 (원본 → 최소 필드)
// ---------------------------------------------------------------------------

function tagMap(tags: Tag[] | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  for (const t of tags ?? []) if (t.Key) m[t.Key] = t.Value ?? '';
  return m;
}

function toInstance(i: Instance): AwsInstance | null {
  if (!i.InstanceId || !i.InstanceType) return null;
  const tags = tagMap(i.Tags);
  const publicIps = new Set<string>();
  for (const ni of i.NetworkInterfaces ?? [])
    for (const pip of ni.PrivateIpAddresses ?? [])
      if (pip.Association?.PublicIp) publicIps.add(pip.Association.PublicIp);
  if (publicIps.size === 0 && i.PublicIpAddress)
    publicIps.add(i.PublicIpAddress);
  const root = (i.BlockDeviceMappings ?? [])
    .filter((b) => b.DeviceName === i.RootDeviceName && b.Ebs?.VolumeId)
    .map((b) => b.Ebs!.VolumeId!);
  return {
    instanceId: i.InstanceId,
    instanceType: i.InstanceType,
    zone: i.Placement?.AvailabilityZone ?? null,
    lifecycle: i.InstanceLifecycle === 'spot' ? 'spot' : 'on_demand',
    architecture: normalizeArch(i.Architecture),
    publicIpv4Count: publicIps.size,
    rootVolumeIds: root,
    nodeGroupTag:
      tags['eks:nodegroup-name'] ??
      tags['karpenter.sh/nodepool'] ??
      tags['karpenter.sh/provisioner-name'] ??
      null,
  };
}

function normalizeArch(a: string | undefined): string | null {
  if (!a) return null;
  if (a === 'x86_64') return 'amd64';
  if (a === 'arm64') return 'arm64';
  return a;
}

function toVolume(v: Volume): AwsVolume | null {
  if (!v.VolumeId || !v.VolumeType) return null;
  const tags = tagMap(v.Tags);
  return {
    volumeId: v.VolumeId,
    volumeType: v.VolumeType,
    sizeGiB: v.Size ?? 0,
    iops: v.Iops ?? null,
    throughputMibps: v.Throughput ?? null,
    zone: v.AvailabilityZone ?? null,
    state: v.State ?? 'unknown',
    attachedInstanceIds: (v.Attachments ?? [])
      .map((a) => a.InstanceId)
      .filter((x): x is string => Boolean(x)),
    pvcNamespace: tags['kubernetes.io/created-for/pvc/namespace'] ?? null,
    pvcName: tags['kubernetes.io/created-for/pvc/name'] ?? null,
    csiManaged: 'ebs.csi.aws.com/cluster' in tags,
  };
}

/** `ns/name` 형태 태그를 K8sRef로 */
function splitRef(kind: K8sRef['kind'], v: string | undefined): K8sRef | null {
  if (!v) return null;
  const i = v.indexOf('/');
  if (i <= 0 || i === v.length - 1) return null;
  return { kind, namespace: v.slice(0, i), name: v.slice(i + 1) };
}

export function refsFromLbTags(tags: Record<string, string>): K8sRef[] {
  const refs: K8sRef[] = [];
  const svc =
    splitRef('Service', tags['service.k8s.aws/stack']) ??
    splitRef('Service', tags['kubernetes.io/service-name']);
  if (svc) refs.push(svc);
  // ingress.k8s.aws/stack: "ns/name" (단일 인그레스) 또는 그룹 이름(식별 불가)
  const ing = splitRef('Ingress', tags['ingress.k8s.aws/stack']);
  if (ing) refs.push(ing);
  return refs;
}

export function clusterNamesFromTags(tags: Record<string, string>): string[] {
  const out: string[] = [];
  if (tags['elbv2.k8s.aws/cluster']) out.push(tags['elbv2.k8s.aws/cluster']);
  for (const k of Object.keys(tags)) {
    const m = /^kubernetes\.io\/cluster\/(.+)$/.exec(k);
    if (m) out.push(m[1]);
  }
  return out;
}

function tagExpression(
  f: { key: string; values: string[] } | null,
): Expression | undefined {
  if (!f) return undefined;
  return { Tags: { Key: f.key, Values: f.values } };
}

/** Pricing API PriceList 항목(JSON 문자열) → 온디맨드 가격 차원만 */
export function parsePriceListItem(item: unknown): PriceListProduct | null {
  let obj: unknown = item;
  if (typeof item === 'string') {
    try {
      obj = JSON.parse(item) as unknown;
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as {
    product?: { attributes?: Record<string, unknown> };
    terms?: {
      OnDemand?: Record<string, { priceDimensions?: Record<string, unknown> }>;
    };
  };
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.product?.attributes ?? {}))
    if (typeof v === 'string') attributes[k] = v;
  const onDemand: PriceListProduct['onDemand'] = [];
  for (const term of Object.values(o.terms?.OnDemand ?? {})) {
    for (const dim of Object.values(term.priceDimensions ?? {})) {
      const d = dim as {
        unit?: unknown;
        description?: unknown;
        pricePerUnit?: { USD?: unknown };
      };
      const usd = Number(d.pricePerUnit?.USD);
      if (!Number.isFinite(usd)) continue;
      onDemand.push({
        unit: typeof d.unit === 'string' ? d.unit : '',
        usd,
        description: typeof d.description === 'string' ? d.description : '',
      });
    }
  }
  return { attributes, onDemand };
}
