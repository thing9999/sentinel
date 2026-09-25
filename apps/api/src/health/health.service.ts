import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_SOURCE_MODE, isAwsConfigured } from '../common/data-source';
import {
  SourceRegistry,
  type SourceState,
  type SourceStatus,
} from '../common/source-registry.service';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { sanitizeErrorMessage } from '../database/health';
import { PrismaService } from '../database/prisma.service';

export interface HealthCheck {
  state: SourceState;
  configured: boolean;
  message: string | null;
  checkedAt: string | null;
}

export type HealthCheckId =
  | 'kube'
  | 'metrics'
  | 'prometheus'
  | 'monitoredDb'
  | 'aws'
  | 'costExplorer'
  | 'agentBridge'
  | 'dashboardDb'
  | 'snapshotStore'
  | 'k8sSnapshotStore'
  /** 외부 로그 스택 (logs L2). **`not_configured`는 `degraded`가 아니다** (AC-LOG45) */
  | 'logBackend';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  dataSource: DataSourceMode;
  version: string;
  serverTime: string;
  startedAt: string;
  uptimeSec: number;
  checks: Record<HealthCheckId, HealthCheck>;
}

const STARTED_AT = new Date();
const BRIDGE_INTERVAL_MS = 30_000;
const BRIDGE_TIMEOUT_MS = 3_000;
const STATE_RANK: Record<SourceState, number> = {
  ok: 0,
  mock: 0,
  not_configured: 1,
  syncing: 2,
  stale: 3,
  unavailable: 4,
};

function readVersion(): string {
  const candidates = [
    join(process.cwd(), 'package.json'),
    join(__dirname, '..', '..', 'package.json'),
    join(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'api' && pkg.version) return pkg.version;
    } catch {
      // 다음 후보
    }
  }
  return '0.0.0';
}

/** AWS 자격 증명이 있어 보이는지 (호출하지 않고 존재만 확인) */
export function hasAwsCredentials(env: NodeJS.ProcessEnv): boolean {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return true;
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE) return true; // IRSA
  if (
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  )
    return true; // 컨테이너 자격 증명 공급자 등
  const dir = join(homedir(), '.aws');
  const credFile = env.AWS_SHARED_CREDENTIALS_FILE ?? join(dir, 'credentials');
  const cfgFile = env.AWS_CONFIG_FILE ?? join(dir, 'config');
  return (
    existsSync(credFile) || (Boolean(env.AWS_PROFILE) && existsSync(cfgFile))
  );
}

/**
 * `GET /api/health` (docs/api/common.md 4절). 캐시된 값만 돌려준다 (요청 시 외부 호출 없음).
 * - kube·metrics·prometheus·monitoredDb·costExplorer: SourceRegistry(각 모듈이 갱신)
 * - aws: awsResources·pricing·spotPrice 중 최악. 비용 모듈이 아직 갱신하지 않았으면 자격 증명 존재 여부만
 * - agentBridge: 어드바이저 모듈이 갱신하면 그 값, 아니면 여기서 30초마다 `/health`를 호출해 캐시
 * - dashboardDb: Prisma 연결 여부
 */
@Injectable()
export class HealthService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private readonly version = readVersion();
  private bridge: HealthCheck;
  private bridgeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly registry: SourceRegistry,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.bridge = {
      state: dataSource === 'mock' ? 'mock' : 'syncing',
      configured: dataSource !== 'mock',
      message: null,
      checkedAt: null,
    };
  }

  onApplicationBootstrap(): void {
    if (this.dataSource === 'mock') return;
    void this.pollBridge();
    this.bridgeTimer = setInterval(
      () => void this.pollBridge(),
      BRIDGE_INTERVAL_MS,
    );
    this.bridgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.bridgeTimer) clearInterval(this.bridgeTimer);
  }

  /** 브리지 `GET /health` (3초 타임아웃) */
  async pollBridge(): Promise<void> {
    const base = this.config.get('AGENT_BRIDGE_URL', { infer: true });
    const token = this.config.get('AGENT_BRIDGE_TOKEN', { infer: true });
    const at = new Date().toISOString();
    try {
      const res = await fetch(new URL('/health', base), {
        headers: token ? { 'x-bridge-token': token } : {},
        signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.bridge = {
        state: 'ok',
        configured: true,
        message: null,
        checkedAt: at,
      };
    } catch (err) {
      const e = err as { name?: string; cause?: { code?: string } };
      const why =
        e?.name === 'TimeoutError'
          ? '시간 초과'
          : e?.cause?.code === 'ECONNREFUSED'
            ? '연결 거부'
            : sanitizeErrorMessage(err, 120);
      this.bridge = {
        state: 'unavailable',
        configured: true,
        message: `${why} (${base})`,
        checkedAt: at,
      };
    }
  }

  private fromSource(s: SourceStatus): HealthCheck {
    const configured = s.state !== 'not_configured' && s.state !== 'mock';
    return {
      state: s.state,
      configured,
      message: s.error?.message ?? null,
      checkedAt: s.lastAttemptAt ?? s.lastSuccessAt,
    };
  }

  private awsCheck(): HealthCheck {
    const ids = ['awsResources', 'pricing', 'spotPrice'] as const;
    const list = ids.map((id) => this.registry.get(id));
    const touched = list.filter((s) => s.lastAttemptAt !== null);
    if (this.dataSource === 'mock')
      return {
        state: 'mock',
        configured: false,
        message: null,
        checkedAt: null,
      };
    if (touched.length > 0) {
      const worst = touched.reduce((a, b) =>
        STATE_RANK[b.state] > STATE_RANK[a.state] ? b : a,
      );
      return this.fromSource(worst);
    }
    const region = isAwsConfigured({
      AWS_REGION: this.config.get('AWS_REGION', { infer: true }),
    });
    const creds = hasAwsCredentials(process.env);
    if (!region)
      return {
        state: 'not_configured',
        configured: false,
        message: null,
        checkedAt: null,
      };
    if (!creds)
      return {
        state: 'not_configured',
        configured: false,
        message: 'AWS 자격 증명을 찾을 수 없습니다 (~/.aws, IRSA, 환경 변수)',
        checkedAt: null,
      };
    return {
      state: 'ok',
      configured: true,
      message: '자격 증명 있음 (아직 호출 전)',
      checkedAt: null,
    };
  }

  private dashboardDbCheck(): HealthCheck {
    if (this.dataSource === 'mock')
      return {
        state: 'mock',
        configured: false,
        message: null,
        checkedAt: null,
      };
    const configured = Boolean(
      this.config.get('DATABASE_URL', { infer: true }),
    );
    if (!configured)
      return {
        state: 'not_configured',
        configured: false,
        message: null,
        checkedAt: null,
      };
    const ok = this.prisma?.isConnected ?? false;
    return {
      state: ok ? 'ok' : 'unavailable',
      configured: true,
      message: ok ? null : '대시보드 DB 연결 실패',
      checkedAt: STARTED_AT.toISOString(),
    };
  }

  private bridgeCheck(): HealthCheck {
    const s = this.registry.get('agentBridge');
    if (this.dataSource === 'mock')
      return {
        state: 'mock',
        configured: false,
        message: null,
        checkedAt: null,
      };
    // 어드바이저 모듈이 갱신 중이면 그 값을 우선
    if (s.lastAttemptAt !== null && s.state !== 'not_configured')
      return this.fromSource(s);
    return this.bridge;
  }

  getHealth(): HealthResponse {
    const mock = this.dataSource === 'mock';
    const src = (
      id:
        | 'kube'
        | 'metrics'
        | 'prometheus'
        | 'monitoredDb'
        | 'costExplorer'
        | 'snapshotStore'
        | 'k8sSnapshotStore'
        | 'logBackend',
    ) =>
      mock
        ? {
            state: 'mock' as const,
            configured: false,
            message: null,
            checkedAt: null,
          }
        : this.fromSource(this.registry.get(id));
    const checks: Record<HealthCheckId, HealthCheck> = {
      kube: src('kube'),
      metrics: src('metrics'),
      prometheus: src('prometheus'),
      monitoredDb: src('monitoredDb'),
      aws: this.awsCheck(),
      costExplorer: src('costExplorer'),
      agentBridge: this.bridgeCheck(),
      dashboardDb: this.dashboardDbCheck(),
      snapshotStore: src('snapshotStore'),
      k8sSnapshotStore: src('k8sSnapshotStore'),
      logBackend: src('logBackend'),
    };
    const degraded = Object.values(checks).some(
      (c) => c.configured && (c.state === 'unavailable' || c.state === 'stale'),
    );
    const now = new Date();
    return {
      status: degraded ? 'degraded' : 'ok',
      dataSource: this.dataSource,
      version: this.version,
      serverTime: now.toISOString(),
      startedAt: STARTED_AT.toISOString(),
      uptimeSec: Math.floor((now.getTime() - STARTED_AT.getTime()) / 1000),
      checks,
    };
  }
}
