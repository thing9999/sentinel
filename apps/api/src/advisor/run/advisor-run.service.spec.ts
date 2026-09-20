import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AdvisorSnapshotContributorProvider,
  type AdvisorSnapshotContributor,
  type TopicEvent,
} from '../../common/extension-points';
import { PrismaService } from '../../database/prisma.service';
import { AdvisorEvents } from '../advisor-events';
import { AdvisorOverviewSummaryProvider } from '../advisor-overview.summary';
import { AdvisorSettingsService } from '../advisor-settings.service';
import { AdvisorTopicSource } from '../advisor-topic.source';
import { AdvisorService } from '../advisor.service';
import type { Run } from '../advisor.types';
import { ApiError } from '../api-error';
import { AdvisorBridgeService } from '../bridge/advisor-bridge.service';
import type { FetchFn } from '../bridge/bridge-client';
import { AdvisorMockScenarios } from '../mock/advisor-mock-scenarios';
import { AdvisorScenarioState } from '../mock/advisor-scenario.state';
import {
  exampleLlmOutput,
  mockClusterContribution,
} from '../mock/mock-fixtures';
import { AdvisorPrecheckService } from '../precheck/advisor-precheck.service';
import { AdvisorSnapshotService } from '../snapshot/advisor-snapshot.service';
import { AdvisorRunRepository } from './advisor-run.repository';
import { AdvisorRunService } from './advisor-run.service';

/** 원본 조각(env·어노테이션)을 실수로 섞어 보내는 클러스터 섹션 제공자 */
@Injectable()
@AdvisorSnapshotContributorProvider()
class LeakyClusterContributor implements AdvisorSnapshotContributor {
  readonly section = 'cluster' as const;
  contribute(): Promise<unknown> {
    const c = mockClusterContribution();
    const w = c.workloads![0] as unknown as Record<string, unknown>;
    w.annotations = {
      'kubectl.kubernetes.io/last-applied-configuration': 'DB_PASSWORD=hunter2',
    };
    (w.containers as Record<string, unknown>[])[0].env = [
      { name: 'DB_PASSWORD', value: 'hunter2' },
    ];
    return Promise.resolve(c);
  }
}

type BridgeBehavior = {
  healthStatus?: number;
  health?: Record<string, unknown>;
  advise?: (body: Record<string, unknown>, signal: AbortSignal) => Response;
};

const RESULT_OK = {
  type: 'result',
  subtype: 'success',
  isError: false,
  structuredOutput: exampleLlmOutput(),
  resultText: null,
  durationMs: 50_000,
  durationApiMs: 48_000,
  numTurns: 2,
  totalCostUsd: 0.4182,
  stopReason: 'end_turn',
  usage: {
    inputTokens: 18_000,
    outputTokens: 6_000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 400,
  },
  permissionDenials: 0,
  errors: [],
};

function ndjson(
  lines: unknown[],
  signal?: AbortSignal,
  holdOpen = false,
): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines)
        controller.enqueue(enc.encode(`${JSON.stringify(l)}\n`));
      if (!holdOpen) controller.close();
      signal?.addEventListener('abort', () => {
        try {
          controller.error(new DOMException('aborted', 'AbortError'));
        } catch {
          // 이미 닫힘
        }
      });
    },
  });
  return new Response(body, { status: 200 });
}

function fakeBridge(b: BridgeBehavior): {
  fetchFn: FetchFn;
  calls: string[];
  adviseBodies: Record<string, unknown>[];
} {
  const calls: string[] = [];
  const adviseBodies: Record<string, unknown>[] = [];
  const handle = (url: string, init: RequestInit): Response => {
    const path = new URL(url).pathname;
    calls.push(`${init.method ?? 'GET'} ${path}`);
    if (path === '/health') {
      return new Response(
        JSON.stringify(
          b.health ?? {
            status: 'ok',
            sdkVersion: '0.3.277',
            claudeCodeAvailable: true,
            claudeCodeVersion: '2.1.277',
            auth: { state: 'ok', checkedAt: new Date().toISOString() },
            usageLimit: { limited: false, retryAt: null },
            busy: false,
          },
        ),
        { status: b.healthStatus ?? 200 },
      );
    }
    if (path === '/v1/advise') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      adviseBodies.push(body);
      return b.advise ? b.advise(body, init.signal!) : ndjson([RESULT_OK]);
    }
    if (path.endsWith('/cancel'))
      return new Response('{"cancelled":true}', { status: 202 });
    return new Response('{}', { status: 404 });
  };
  const fetchFn = ((url: string, init: RequestInit) =>
    Promise.resolve().then(() => handle(url, init))) as unknown as FetchFn;
  return { fetchFn, calls, adviseBodies };
}

async function setup(
  env: Record<string, string>,
  bridge: BridgeBehavior = {},
  extraProviders: unknown[] = [],
) {
  const fake = fakeBridge(bridge);
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService({
          AGENT_BRIDGE_URL: 'http://bridge:3002',
          ...env,
        }),
      },
      { provide: PrismaService, useValue: { isConnected: false } },
      AdvisorEvents,
      AdvisorSettingsService,
      AdvisorScenarioState,
      AdvisorSnapshotService,
      AdvisorPrecheckService,
      AdvisorBridgeService,
      AdvisorRunRepository,
      AdvisorRunService,
      AdvisorService,
      AdvisorTopicSource,
      AdvisorMockScenarios,
      AdvisorOverviewSummaryProvider,
      ...(extraProviders as never[]),
    ],
  }).compile();
  moduleRef.get(AdvisorBridgeService).fetchFn = fake.fetchFn;
  await moduleRef.init();
  const events: TopicEvent[] = [];
  const sub = moduleRef
    .get(AdvisorEvents)
    .events$.subscribe((e) => events.push(e));
  const finished = () =>
    new Promise<Run>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('finished 이벤트 없음')),
        4_000,
      );
      const check = setInterval(() => {
        const f = events.find((e) => e.event === 'advisor.run.finished');
        if (f) {
          clearTimeout(timer);
          clearInterval(check);
          resolve((f.data as { run: Run }).run);
        }
      }, 10);
    });
  return {
    moduleRef,
    runs: moduleRef.get(AdvisorRunService),
    advisor: moduleRef.get(AdvisorService),
    bridge: moduleRef.get(AdvisorBridgeService),
    scenarios: moduleRef.get(AdvisorMockScenarios),
    overview: moduleRef.get(AdvisorOverviewSummaryProvider),
    topic: moduleRef.get(AdvisorTopicSource),
    events,
    finished,
    fake,
    close: async () => {
      sub.unsubscribe();
      await moduleRef.close();
    },
  };
}

const MOCK_LIVE = { DATA_SOURCE: 'mock', ADVISOR_BRIDGE: 'live' };

describe('AdvisorRunService (가짜 브리지)', () => {
  it('mock 스냅샷으로 실제 분석: 202 → progress → finished(succeeded), 동시 1건', async () => {
    const t = await setup(MOCK_LIVE);
    try {
      const first = await t.runs.start(false);
      expect(first.created).toBe(true);
      expect(first.run.isExample).toBe(false);
      expect(first.run.stage).toBe('request');
      expect(first.run.stages.slice(0, 2).map((s) => s.state)).toEqual([
        'done',
        'done',
      ]);
      const second = await t.runs.start(false);
      expect(second).toMatchObject({
        created: false,
        run: { id: first.run.id },
      });

      const run = await t.finished();
      expect(run.status).toBe('succeeded');
      expect(run.suggestions?.length).toBe(5);
      expect(run.llm).toMatchObject({
        costUsd: 0.4182,
        numTurns: 2,
        durationApiMs: 48_000,
        outputTokens: 6_000,
      });
      // 진행 줄이 없었으므로 receiving은 skipped, 나머지는 done
      expect(run.stages.map((s) => s.state)).toEqual([
        'done',
        'done',
        'done',
        'skipped',
        'done',
      ]);
      expect(t.events.some((e) => e.event === 'advisor.run.progress')).toBe(
        true,
      );
      // 브리지로 보낸 요청: 스냅샷만 + limits
      const body = t.fake.adviseBodies[0];
      expect(body).toMatchObject({
        runId: first.run.id,
        promptVersion: 'advisor-v1',
        limits: { maxTurns: 5, maxBudgetUsd: 2 },
      });
      expect(JSON.stringify(body.snapshot)).not.toContain('ip-10-0-');
      // 이력(메모리)과 최신 결과
      const ov = await t.advisor.overview();
      expect(ov.persistence).toBe('memory');
      expect(ov.activeRun).toBeNull();
      expect(ov.latestResult?.id).toBe(first.run.id);
      expect(ov.latestResult?.freshness).toEqual({ stale: false, reasons: [] });
      expect(ov.history.total).toBe(3); // mock 예시 이력 2건 + 이번 1건
    } finally {
      await t.close();
    }
  });

  it('로그인 만료 → failed/login_required, 브리지 상태도 login_required', async () => {
    const t = await setup(MOCK_LIVE, {
      advise: () =>
        ndjson([
          { type: 'accepted' },
          { type: 'error', code: 'login_required', message: 'x' },
        ]),
    });
    try {
      await t.runs.start(false);
      const run = await t.finished();
      expect(run).toMatchObject({
        status: 'failed',
        failureReason: 'login_required',
        stage: 'request',
      });
      expect(run.errorMessage).toContain('`claude`로 다시 로그인');
      expect(run.stages.find((s) => s.id === 'request')?.state).toBe('error');
      expect(t.bridge.status().state).toBe('login_required');
    } finally {
      await t.close();
    }
  });

  it('예산 초과 → budget_exceeded, 형식 오류 → invalid_response + 원문', async () => {
    const t = await setup(MOCK_LIVE, {
      advise: (body) =>
        ndjson([
          body.runId && t2Mode.mode === 'budget'
            ? {
                ...RESULT_OK,
                subtype: 'error_max_budget_usd',
                isError: true,
                structuredOutput: null,
                totalCostUsd: 2.03,
              }
            : { ...RESULT_OK, structuredOutput: null, resultText: '형식 아님' },
        ]),
    });
    try {
      t2Mode.mode = 'budget';
      await t.runs.start(false);
      const a = await t.finished();
      expect(a).toMatchObject({
        status: 'failed',
        failureReason: 'budget_exceeded',
        llm: { costUsd: 2.03 },
      });
      expect(a.errorMessage).toBe(
        '분석 비용이 상한 $2.00을 넘어 중단했습니다.',
      );
      t.events.length = 0;
      t2Mode.mode = 'invalid';
      const started = await t.runs.start(false);
      const b = await t.finished();
      expect(b).toMatchObject({
        status: 'failed',
        failureReason: 'invalid_response',
        hasRawResponse: true,
      });
      await expect(t.runs.rawResponse(started.run.id)).resolves.toBe(
        '형식 아님',
      );
    } finally {
      await t.close();
    }
  });

  it('취소 → cancelled (브리지 cancel 호출 + 연결 abort)', async () => {
    const t = await setup(MOCK_LIVE, {
      advise: (_b, signal) =>
        ndjson(
          [
            { type: 'accepted' },
            {
              type: 'progress',
              phase: 'receiving',
              receivedChars: 10,
              lastReceivedAt: 'x',
            },
          ],
          signal,
          true,
        ),
    });
    try {
      const { run } = await t.runs.start(false);
      await new Promise((r) => setTimeout(r, 50));
      const c = await t.runs.cancel(run.id);
      expect(c.cancelling).toBe(true);
      const again = await t.runs.cancel(run.id);
      expect(again.cancelling).toBe(true);
      const done = await t.finished();
      expect(done.status).toBe('cancelled');
      expect(t.fake.calls).toContain(`POST /v1/runs/${run.id}/cancel`);
      await expect(t.runs.cancel(run.id)).rejects.toMatchObject({
        code: 'RUN_NOT_ACTIVE',
      });
    } finally {
      await t.close();
    }
  });

  it('브리지 연결 거부 → 409 BRIDGE_NOT_READY (live)', async () => {
    const t = await setup({ DATA_SOURCE: 'live' }, { healthStatus: 500 });
    try {
      const err = await t.runs.start(false).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('BRIDGE_NOT_READY');
    } finally {
      await t.close();
    }
  });

  it('live인데 스냅샷 제공자가 없으면 503 SNAPSHOT_UNAVAILABLE', async () => {
    const t = await setup({ DATA_SOURCE: 'live' });
    try {
      const err = await t.runs.start(false).catch((e: unknown) => e);
      expect((err as ApiError).code).toBe('SNAPSHOT_UNAVAILABLE');
      expect(
        (
          await t.advisor.prechecksView({
            includeSystem: false,
            category: null,
            severity: null,
            held: null,
          })
        ).status.status,
      ).toBe('unknown');
    } finally {
      await t.close();
    }
  });

  it('섹션 제공자를 찾아 쓰고, 원본 조각은 보내기 전에 걸러진다', async () => {
    const t = await setup({ DATA_SOURCE: 'live' }, {}, [
      LeakyClusterContributor,
    ]);
    try {
      const preview = await t.advisor.snapshotPreview(false);
      const text = JSON.stringify(preview.snapshot);
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('DB_PASSWORD');
      expect(text).not.toContain('last-applied-configuration');
      expect(preview.snapshot.db).toBeNull(); // live + db 제공자 없음 → unavailable
      expect(preview.snapshot.cost).toBeNull();
      expect(preview.meta.transmissionNotice).toContain('Anthropic');
    } finally {
      await t.close();
    }
  });

  it('mock 시나리오: bridge-down이면 409, 진행 중엔 시나리오 변경 409, topic snapshot', async () => {
    const t = await setup({ DATA_SOURCE: 'mock' });
    try {
      t.scenarios.setScenario('bridge-down');
      await expect(t.runs.start(false)).rejects.toMatchObject({
        code: 'BRIDGE_NOT_READY',
      });
      t.scenarios.setScenario('example');
      const { run } = await t.runs.start(false);
      expect(run.isExample).toBe(true);
      expect(run.limits).toEqual({ slowAfterSec: 10, timeoutSec: 20 });
      expect(() => t.scenarios.setScenario('normal')).toThrow(ApiError);
      const snap = await t.topic.snapshot();
      expect(snap[0].event).toBe('advisor.snapshot');
      expect((snap[0].data as { activeRun: Run }).activeRun.id).toBe(run.id);
      await t.runs.cancel(run.id);
      expect((await t.finished()).status).toBe('cancelled');
      expect(() => t.scenarios.setScenario('nope')).toThrow(ApiError);
    } finally {
      await t.close();
    }
  });
  it('개요 요약 카드(advisor): 사전 점검·최근 실행·브리지·진행 중', async () => {
    const t = await setup({ DATA_SOURCE: 'mock' });
    try {
      let changed = 0;
      const sub = t.overview.changes$.subscribe(() => (changed += 1));
      const before = await t.overview.summary();
      expect(before).toMatchObject({
        available: true,
        bridge: 'unreachable',
        busy: false,
      });
      expect(before.precheck.status).toBe(before.status.status);
      expect(before.lastRun?.status).toBe('succeeded'); // mock 예시 이력
      t.scenarios.setScenario('example');
      const { run } = await t.runs.start(false);
      expect(t.overview.busy()).toBe(true);
      expect((await t.overview.summary()).lastRun).toMatchObject({
        id: run.id,
        status: 'running',
        finishedAt: null,
      });
      await t.runs.cancel(run.id);
      await t.finished();
      expect(t.overview.busy()).toBe(false);
      expect(changed).toBeGreaterThan(0);
      sub.unsubscribe();
    } finally {
      await t.close();
    }
  });
});

const t2Mode: { mode: 'budget' | 'invalid' } = { mode: 'budget' };
