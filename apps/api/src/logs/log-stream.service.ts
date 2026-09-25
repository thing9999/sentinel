/**
 * 로그 전용 SSE 연결 (docs/api/logs.md 2.3·7절).
 *
 * **공용 `/api/stream`과 완전히 분리한다** (AC-LOG22·23):
 * - 로그 본문은 공용 스트림의 어떤 이벤트에도 실리지 않는다. 토픽도 봉투 `topic` 값도 공유하지 않는다.
 * - 상한도 따로 센다: `LOG_MAX_STREAMS`(기본 3)는 `SSE_MAX_CLIENTS`(기본 20)와 **별개 카운터**다.
 *   로그 스트림이 3개 차도 공용 스트림과 다른 화면은 영향을 받지 않는다.
 * - `retry:`를 보내지 않는다 — 브라우저가 자동 재연결해도 그 `streamId`는 이미 소비됐다.
 *
 * 과부하 방어: **250ms 배치**(초당 4회 갱신), 초당 줄 수 상한, 유휴 일시정지, 최대 지속.
 * **로그를 어디에도 저장하지 않는다** — 배치 버퍼는 보내고 즉시 비운다.
 */
import {
  BeforeApplicationShutdown,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { Subscription } from 'rxjs';
import { ApiException } from '../common/api-error';
import { ClusterStore } from '../cluster/state/cluster-store';
import { podKey } from '../cluster/model';
import { DirectLogError, DirectLogSource } from './direct-source';
import { droppedLine, processLines } from './line-processor';
import { LogsOptions } from './logs.options';
import { LogsService } from './logs.service';
import { createLineRedactor, type LineRedactor } from './redact';
import {
  FLOOD_RATE_OF_MAX,
  mockBurstLines,
  mockFloodLines,
  mockStreamTiming,
  mockTailLine,
  type LogScenario,
} from './mock/mock-logs';
import { LogBackendService } from './backend/log-backend.service';
import type {
  LogLine,
  LogNotice,
  LogSelector,
  LogSourceId,
} from './logs.types';

const BATCH_MS = 250;
const HEARTBEAT_SEC = 15;
const PREPARE_TTL_MS = 30_000;
/** 유휴·최대 지속 검사 주기. mock 시간 단축 시나리오에서는 1초 (20초·30초를 제때 맞추려고) */
const WATCHDOG_MS = 5000;
const WATCHDOG_FAST_MS = 1000;
/** 시작 전 컨테이너를 기다릴 때 informer 변경 신호와 별도로 다시 보는 주기 (신호를 놓쳐도 붙게) */
const WAIT_RECHECK_MS = 2000;

/**
 * 스트림의 "시작 전" 안내. 스트림은 **실제로 기다렸다가 붙으므로** 약속하는 문구를 쓴다
 * (정지 조회 문구는 `logs.service.ts` `CONTAINER_NOT_STARTED_QUERY` — 따라가기를 권한다)
 */
const CONTAINER_NOT_STARTED_STREAM = {
  code: 'LOG_CONTAINER_NOT_STARTED',
  level: 'info' as const,
  text: '컨테이너가 아직 시작되지 않았습니다. 시작되면 자동으로 표시됩니다.',
};

interface BufferedLine {
  raw: string;
  prefix: { pod: string; container: string } | null;
  stream: 'stdout' | 'stderr' | null;
}

interface StreamEntry {
  id: string;
  source: LogSourceId;
  selector: LogSelector;
  container: string;
  limit: number;
  createdAt: number;
  expiresAt: number;
  res: Response | null;
  seq: number;
  lineSeq: number;
  redact: LineRedactor;
  /** 250ms 배치 버퍼. 여러 파드를 섞어 볼 때 **줄마다** 파드·컨테이너를 잃지 않게 함께 담는다 */
  buffer: BufferedLine[];
  /** 초당 상한 창 */
  windowStart: number;
  windowCount: number;
  droppedInWindow: number;
  lastTouch: number;
  batchTimer: NodeJS.Timeout | null;
  heartbeat: NodeJS.Timeout | null;
  watchdog: NodeJS.Timeout | null;
  mockTimer: NodeJS.Timeout | null;
  upstream: { close: () => void } | null;
  paused: boolean;
  closed: boolean;
  /** 유휴 일시정지 기준(ms). 설정값이고, mock `idle-pause`만 20초로 줄인다 */
  idlePauseMs: number;
  /** 최대 지속(ms). 설정값이고, mock `max-duration`만 30초로 줄인다 */
  maxDurationMs: number;
  /** mock `stream-notice`: 연결 뒤 이 시각에 초당 상한을 넘는 폭주를 한 번 넣는다 */
  burstAfterMs: number | null;
  burstTimer: NodeJS.Timeout | null;
  /**
   * stack 워크로드 합쳐보기에서 서버가 푼 파드. 조회 응답 `selector.resolvedPods`와 **같은 이름·같은 뜻**이다
   * (계약 2.3.2·7절). 워크로드를 풀지 않았으면 null
   */
  resolvedPods: string[] | null;
  /** 시작 전 컨테이너를 기다리는 중 (계약 6절 "파드 watch로 자동 재시도") */
  waitSub: Subscription | null;
  waitTimer: NodeJS.Timeout | null;
}

@Injectable()
export class LogStreamService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(LogStreamService.name);
  private readonly streams = new Map<string, StreamEntry>();

  constructor(
    private readonly options: LogsOptions,
    private readonly logs: LogsService,
    private readonly direct: DirectLogSource,
    private readonly backend: LogBackendService,
    private readonly store: ClusterStore,
  ) {}

  /** 지금 슬롯을 차지하고 있는 수 (준비 중 + 연결됨) */
  get openCount(): number {
    return this.streams.size;
  }

  get maxStreams(): number {
    return this.options.limits.maxStreams;
  }

  /**
   * 준비 단계. **연결 전에 상한·권한·파드 존재를 읽을 수 있는 JSON 오류로 돌려준다**
   * (EventSource는 오류 본문을 읽지 못한다).
   */
  prepare(
    source: LogSourceId,
    selector: LogSelector,
    limit: number,
  ): StreamEntry {
    this.sweep();
    if (this.streams.size >= this.maxStreams) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'LOG_STREAM_LIMIT_REACHED',
        // 펼쳐 둔 파드 상세 로그 섹션도 슬롯을 하나 쓴다(D1). 사용자가 슬롯을 차지한 곳을
        // 찾을 수 있어야 상한 안내가 쓸모 있다 (PM 결정 2026-09-25)
        `로그 보기를 동시에 ${this.maxStreams}개까지 열 수 있습니다. 다른 탭의 로그 화면이나 펼쳐 둔 파드 상세 로그를 닫아 주세요.`,
        { open: this.streams.size, max: this.maxStreams },
      );
    }
    // stack 워크로드 합쳐보기: 파드를 **준비 단계에서** 푼다. 풀지 않고 따라가면
    // 어댑터가 네임스페이스 전체를 따라간다(2026-09-25 수정 전 결함)
    let resolvedPods: string[] | null = null;
    if (
      source === 'stack' &&
      selector.workload &&
      !selector.pod &&
      !selector.pods?.length
    ) {
      const r = this.logs.resolveWorkloadPods(
        selector.namespace,
        selector.workload,
      );
      if (r.pods.length === 0) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          'LOG_WORKLOAD_NO_PODS',
          '이 워크로드의 파드를 찾지 못했습니다(지금 있는 파드도, 최근 1시간 안에 사라진 파드도 없습니다).',
        );
      }
      resolvedPods = r.pods;
      // 기존 동작 유지: `selector.pods`에도 같은 목록이 들어간다(hello.selector.pods)
      selector = { ...selector, pods: r.pods };
    }
    const now = Date.now();
    const limits = this.options.limits;
    // mock 시간 단축 시나리오 (계약 9절): 5분·30분을 기다리지 않고 화면을 확인한다.
    // **기준값만 줄이고 경로는 실제와 같다** — 같은 checkLimits·push·flush를 탄다
    const timing =
      this.options.dataSource === 'mock'
        ? mockStreamTiming(this.logs.currentScenario() as LogScenario)
        : null;
    const entry: StreamEntry = {
      id: `ls_${randomBytes(4).toString('hex')}`,
      source,
      selector,
      container: selector.container ?? this.logs.defaultContainerOf(selector),
      limit,
      createdAt: now,
      expiresAt: now + PREPARE_TTL_MS,
      res: null,
      seq: 0,
      lineSeq: 0,
      redact: createLineRedactor(this.options.extraPatterns),
      buffer: [],
      windowStart: now,
      windowCount: 0,
      droppedInWindow: 0,
      lastTouch: now,
      batchTimer: null,
      heartbeat: null,
      watchdog: null,
      mockTimer: null,
      upstream: null,
      paused: false,
      closed: false,
      idlePauseMs: timing?.idlePauseMs ?? limits.idlePauseSec * 1000,
      maxDurationMs: timing?.maxDurationMs ?? limits.maxStreamMin * 60_000,
      burstAfterMs: timing?.burstAfterMs ?? null,
      burstTimer: null,
      resolvedPods,
      waitSub: null,
      waitTimer: null,
    };
    this.streams.set(entry.id, entry);
    return entry;
  }

  describe(entry: StreamEntry): Record<string, unknown> {
    return {
      streamId: entry.id,
      url: `/api/logs/stream/${entry.id}`,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      source: this.logs.sourceInfo(entry.source),
      capabilities: this.logs.capabilitiesOf(entry.source),
      limits: {
        maxLinesPerSec: this.options.limits.maxLinesPerSec,
        idlePauseSec: this.options.limits.idlePauseSec,
        maxStreamMin: this.options.limits.maxStreamMin,
      },
      streams: { open: this.openCount, max: this.maxStreams },
      notices: [],
    };
  }

  /** SSE 연결. 없는·만료된 id는 404 */
  async attach(streamId: string, res: Response): Promise<void> {
    this.sweep();
    const entry = this.streams.get(streamId);
    if (!entry || entry.res !== null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'LOG_STREAM_NOT_FOUND',
        '없거나 이미 만료된 로그 스트림입니다. 다시 시작하세요.',
      );
    }
    entry.res = res;
    entry.lastTouch = Date.now();
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    res.on('close', () => this.destroy(entry));

    // **`retry:`를 보내지 않는다** (계약 2.3.2)
    this.send(entry, 'log.hello', {
      streamId: entry.id,
      source: this.logs.sourceInfo(entry.source),
      capabilities: this.logs.capabilitiesOf(entry.source),
      // `resolvedPods`: 조회 응답과 같은 이름 (2026-09-25 추가, 추가 전용 — 기존 `pods`는 그대로)
      selector: {
        ...entry.selector,
        container: entry.container,
        resolvedPods: entry.resolvedPods,
      },
      limits: {
        maxLinesPerSec: this.options.limits.maxLinesPerSec,
        idlePauseSec: this.options.limits.idlePauseSec,
        maxStreamMin: this.options.limits.maxStreamMin,
      },
      streams: { open: this.openCount, max: this.maxStreams },
      serverTime: new Date().toISOString(),
      heartbeatSec: HEARTBEAT_SEC,
    });

    entry.heartbeat = setInterval(() => {
      this.send(entry, 'log.heartbeat', {
        serverTime: new Date().toISOString(),
      });
    }, HEARTBEAT_SEC * 1000);
    entry.heartbeat.unref();

    const fast =
      entry.idlePauseMs < 60_000 ||
      entry.maxDurationMs < 60_000 ||
      entry.burstAfterMs !== null;
    entry.watchdog = setInterval(
      () => this.checkLimits(entry),
      fast ? WATCHDOG_FAST_MS : WATCHDOG_MS,
    );
    entry.watchdog.unref();

    if (entry.burstAfterMs !== null) {
      // mock `stream-notice`: 초당 상한을 넘는 줄을 한 번에 넣는다 → 실제 push·flush 경로가
      // 생략 줄(`kind: 'dropped'`)과 `log.notice`(`LOG_DROPPED_LINES`)를 만든다
      entry.burstTimer = setTimeout(() => {
        entry.burstTimer = null;
        for (const line of mockBurstLines(
          this.options.limits.maxLinesPerSec + 150,
        ))
          this.push(entry, line);
      }, entry.burstAfterMs);
      entry.burstTimer.unref();
    }

    try {
      await this.start(entry);
    } catch (err) {
      const notice = toNotice(err);
      this.send(entry, 'log.notice', notice);
      this.close(entry, 'source_error', notice.code, notice.text);
    }
  }

  /** 살아 있음 신호 (화면이 보이는 동안 60초마다) */
  touch(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'LOG_STREAM_NOT_FOUND',
        '없거나 이미 만료된 로그 스트림입니다.',
      );
    }
    entry.lastTouch = Date.now();
  }

  /** 종료. 이미 닫혔어도 204 (멱등) */
  closeById(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry) return;
    this.close(entry, 'client', 'LOG_STREAM_CLOSED', '연결을 닫았습니다.');
  }

  // --- 내부 -----------------------------------------------------------------

  private async start(entry: StreamEntry): Promise<void> {
    if (entry.source === 'stack') {
      await this.startStack(entry);
      return;
    }
    if (this.options.dataSource === 'mock') {
      if (this.logs.currentScenario() === 'kubelet-unreachable') {
        // live와 같은 경로: follow가 실패하면 attach가 log.notice + log.closing(source_error)
        throw new DirectLogError(
          'LOG_KUBELET_UNREACHABLE',
          '노드에 연결할 수 없어 로그를 읽지 못했습니다.',
        );
      }
      if (!this.logs.mockContainerStarted()) {
        // mock `container-starting`: live와 같은 대기 경로를 탄다 (시작 시각은 시나리오가 정한다)
        this.waitForContainer(
          entry,
          () => this.logs.mockContainerStarted(),
          () => this.startMock(entry),
        );
        return;
      }
      await this.startMock(entry);
      return;
    }

    const sel = entry.selector;
    const neverStarted = () =>
      this.logs.containerNeverStarted(
        sel.namespace,
        sel.pod ?? '',
        entry.container,
      );
    // informer 캐시상 아직 한 번도 돌지 않았으면 **연결을 닫지 않고** 기다렸다가 붙는다
    if (neverStarted()) {
      this.waitForContainer(
        entry,
        () => !neverStarted(),
        () => this.startDirect(entry),
      );
      return;
    }
    try {
      await this.startDirect(entry);
    } catch (err) {
      // 캐시가 한발 늦은 경우: 쿠버네티스가 "시작 전"(400)이라고 했고 캐시도 그렇다면 기다린다
      if (isNotStartedError(err) && neverStarted()) {
        this.waitForContainer(
          entry,
          () => !neverStarted(),
          () => this.startDirect(entry),
        );
        return;
      }
      throw err;
    }
  }

  /** mock direct 따라가기 (초기 줄 + 흐름). 시나리오별 흐름은 여기 한 곳 */
  private async startMock(entry: StreamEntry): Promise<void> {
    const scenario = this.logs.currentScenario() as LogScenario;
    // 초기 줄
    const initial = await this.logs
      .query(
        {
          selector: { ...entry.selector, container: entry.container },
          limit: entry.limit,
        },
        this.openCount,
      )
      .catch(() => null);
    if (initial) {
      this.send(entry, 'log.lines', {
        lines: initial.lines,
        initial: true,
        stats: initial.stats,
      });
    }
    if (scenario === 'flood') {
      // 초당 상한의 80%를 250ms마다 나눠 넣는다 → 생략 없이 2만 줄이 약 13초에 찬다 (AC-LOG51).
      // 줄은 실제와 같은 push → 250ms 배치 → processLines(가림) 경로를 탄다
      const perTick = Math.max(
        1,
        Math.floor(
          (this.options.limits.maxLinesPerSec * FLOOD_RATE_OF_MAX) / 4,
        ),
      );
      let seq = 1;
      entry.mockTimer = setInterval(() => {
        for (const line of mockFloodLines(seq, perTick)) this.push(entry, line);
        seq += perTick;
      }, BATCH_MS);
      entry.mockTimer.unref();
      return;
    }
    let n = 0;
    entry.mockTimer = setInterval(() => {
      n += 1;
      this.push(entry, mockTailLine(scenario, n));
      if (scenario === 'noisy') {
        for (let i = 0; i < 40; i += 1)
          this.push(entry, mockTailLine(scenario, n * 100 + i));
      }
    }, 700);
    entry.mockTimer.unref();
  }

  /** live direct 따라가기 (`pods/log` follow) */
  private async startDirect(entry: StreamEntry): Promise<void> {
    const sel = entry.selector;
    entry.upstream = await this.direct.follow({
      namespace: sel.namespace,
      pod: sel.pod ?? '',
      container: entry.container,
      tailLines: entry.limit,
      sinceSeconds: null,
      maxBytes: this.options.limits.maxBytes,
      onLine: (line) => this.push(entry, line),
      onError: (err) => {
        const notice = toNotice(err);
        this.send(entry, 'log.notice', notice);
        this.close(entry, 'source_error', notice.code, notice.text);
      },
      onEnd: () =>
        this.close(
          entry,
          'source_error',
          'LOG_STREAM_ENDED',
          '로그 출처 연결이 끝났습니다.',
        ),
    });
  }

  /**
   * 시작 전 컨테이너를 **연결을 닫지 않고 기다린다** (계약 6절 `LOG_CONTAINER_NOT_STARTED` "파드 watch로 자동 재시도").
   * - 안내를 한 번 보내고, informer 변경 신호(+ 2초 재확인)마다 시작됐는지 본다. 시작되면 붙는다
   * - 유휴 일시정지·최대 지속 상한은 **그대로** 적용된다(`checkLimits`가 기다림도 멈춘다)
   * - 기다리는 동안 파드가 사라지면 `LOG_POD_NOT_FOUND`로 닫는다
   */
  private waitForContainer(
    entry: StreamEntry,
    started: () => boolean,
    begin: () => Promise<void>,
  ): void {
    this.send(entry, 'log.notice', CONTAINER_NOT_STARTED_STREAM);
    let beginning = false;
    const check = (): void => {
      if (entry.closed || entry.paused || beginning) return;
      const sel = entry.selector;
      if (
        this.options.dataSource !== 'mock' &&
        !this.store.pods.has(podKey(sel.namespace, sel.pod ?? ''))
      ) {
        this.stopWaiting(entry);
        this.close(
          entry,
          'source_error',
          'LOG_POD_NOT_FOUND',
          '이 파드는 더 이상 존재하지 않습니다.',
        );
        return;
      }
      if (!started()) return;
      beginning = true;
      this.stopWaiting(entry);
      begin().catch((err: unknown) => {
        const notice = toNotice(err);
        this.send(entry, 'log.notice', notice);
        this.close(entry, 'source_error', notice.code, notice.text);
      });
    };
    entry.waitSub = this.store.changes$.subscribe(() => check());
    entry.waitTimer = setInterval(check, WAIT_RECHECK_MS);
    entry.waitTimer.unref();
  }

  private stopWaiting(entry: StreamEntry): void {
    entry.waitSub?.unsubscribe();
    entry.waitSub = null;
    if (entry.waitTimer) clearInterval(entry.waitTimer);
    entry.waitTimer = null;
  }

  /**
   * 외부 로그 스택 따라가기. 어댑터가 같은 `LogBackendPort`라 **mock·실제가 같은 코드**를 탄다.
   * 여기서도 줄은 `processLines`(→ 가림)를 거친다 — 스택에서 왔다고 건너뛰지 않는다.
   */
  private async startStack(entry: StreamEntry): Promise<void> {
    const port = this.backend.port;
    if (!port) {
      this.close(
        entry,
        'source_error',
        'LOG_BACKEND_UNAVAILABLE',
        '외부 로그 스택이 설정돼 있지 않습니다.',
      );
      return;
    }
    const initial = await this.logs
      .query(
        {
          source: 'stack',
          selector: { ...entry.selector, container: entry.container },
          limit: entry.limit,
        },
        this.openCount,
      )
      .catch(() => null);
    if (initial) {
      this.send(entry, 'log.lines', {
        lines: initial.lines,
        initial: true,
        stats: initial.stats,
      });
    }
    const pods = entry.selector.pods?.length
      ? entry.selector.pods
      : entry.selector.pod
        ? [entry.selector.pod]
        : [];
    const handle = port.tail(
      {
        selector: {
          namespace: entry.selector.namespace,
          pods,
          containers: entry.container ? [entry.container] : [],
          workload: entry.selector.workload ?? null,
        },
        limit: entry.limit,
        search: null,
      },
      {
        onEntries: (entries) => {
          const multi = pods.length > 1 || Boolean(entry.selector.workload);
          for (const e of entries) {
            this.push(
              entry,
              `${e.at} ${e.line}`,
              multi ? { pod: e.pod, container: e.container } : null,
              e.stream,
            );
          }
        },
        onError: (err) => {
          this.backend.reportFailure(err);
          this.send(entry, 'log.notice', {
            code: err.code,
            level: 'warn',
            text: err.message,
          });
          // **자동으로 직접 조회로 내려가지 않는다.** 화면이 전환 버튼을 그린다
          this.close(entry, 'source_error', err.code, err.message);
        },
      },
    );
    entry.upstream = handle;
  }

  /** 초당 상한을 적용하고 250ms 배치 버퍼에 넣는다 */
  private push(
    entry: StreamEntry,
    line: string,
    prefix: { pod: string; container: string } | null = null,
    stream: 'stdout' | 'stderr' | null = null,
  ): void {
    if (entry.closed || entry.paused) return;
    const now = Date.now();
    if (now - entry.windowStart >= 1000) {
      entry.windowStart = now;
      entry.windowCount = 0;
    }
    entry.windowCount += 1;
    if (entry.windowCount > this.options.limits.maxLinesPerSec) {
      entry.droppedInWindow += 1;
      return;
    }
    entry.buffer.push({ raw: line, prefix, stream });
    if (entry.batchTimer) return;
    entry.batchTimer = setTimeout(() => {
      entry.batchTimer = null;
      this.flush(entry);
    }, BATCH_MS);
    entry.batchTimer.unref();
  }

  private flush(entry: StreamEntry): void {
    if (entry.closed) return;
    const raw = entry.buffer;
    entry.buffer = [];
    const dropped = entry.droppedInWindow;
    entry.droppedInWindow = 0;
    if (raw.length === 0 && dropped === 0) return;

    const processed = processLines(
      raw.map((b) => b.raw),
      {
        idPrefix: entry.id,
        startSeq: entry.lineSeq,
        maxLineBytes: this.options.limits.maxLineBytes,
        redact: entry.redact,
        prefixes: raw.some((b) => b.prefix) ? raw.map((b) => b.prefix) : null,
        streams: raw.some((b) => b.stream) ? raw.map((b) => b.stream) : null,
      },
    );
    entry.lineSeq = processed.nextSeq;
    const lines: LogLine[] = processed.lines;
    if (dropped > 0) {
      entry.lineSeq += 1;
      lines.push(droppedLine(entry.id, entry.lineSeq, dropped));
      this.send(entry, 'log.notice', {
        code: 'LOG_DROPPED_LINES',
        level: 'warn',
        text: `초당 상한(${this.options.limits.maxLinesPerSec}줄)으로 ${dropped}줄이 생략됐습니다.`,
        details: { droppedLines: dropped },
      });
    }
    this.send(entry, 'log.lines', {
      lines,
      stats: {
        redactedCount: processed.stats.redactedCount,
        droppedLines: dropped,
      },
    });
  }

  /** 유휴 일시정지·최대 지속 검사 */
  private checkLimits(entry: StreamEntry): void {
    const now = Date.now();
    const idleMs = entry.idlePauseMs;
    const maxMs = entry.maxDurationMs;
    if (now - entry.createdAt >= maxMs) {
      this.close(
        entry,
        'max_duration',
        'LOG_STREAM_MAX_DURATION',
        // 문구 정본: design/logs.md 7.4 멈춤 안내 `30분`
        `연결을 ${durationKo(maxMs)}마다 끊습니다(서버 보호).`,
      );
      return;
    }
    if (!entry.paused && now - entry.lastTouch >= idleMs) {
      // "일시정지"는 화면 상태가 아니라 **실제 연결 해제**다
      entry.paused = true;
      entry.upstream?.close();
      entry.upstream = null;
      this.stopWaiting(entry);
      if (entry.mockTimer) {
        clearInterval(entry.mockTimer);
        entry.mockTimer = null;
      }
      this.send(entry, 'log.paused', {
        code: 'LOG_STREAM_IDLE_PAUSED',
        // 서버는 조작이 아니라 `touch` 신호로 판단한다. touch는 **화면이 보일 때만** 오므로
        // "조작이 없어"는 사실과 다르다 (문구 정본: design/logs.md 7.4 멈춤 안내 `유휴`)
        text: `이 화면이 ${durationKo(idleMs)} 동안 보이지 않아 따라가기를 멈췄습니다.`,
        resumable: true,
      });
    }
  }

  private send(entry: StreamEntry, event: string, payload: unknown): void {
    if (entry.closed || !entry.res) return;
    entry.seq += 1;
    const envelope = {
      seq: entry.seq,
      event,
      emittedAt: new Date().toISOString(),
      payload,
    };
    entry.res.write(`event: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`);
  }

  private close(
    entry: StreamEntry,
    reason: 'max_duration' | 'idle' | 'client' | 'source_error' | 'shutdown',
    code: string,
    text: string,
  ): void {
    if (entry.closed) return;
    this.send(entry, 'log.closing', {
      reason,
      code,
      text,
      resumable: reason !== 'client',
    });
    this.destroy(entry);
  }

  private destroy(entry: StreamEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    entry.upstream?.close();
    entry.upstream = null;
    if (entry.batchTimer) clearTimeout(entry.batchTimer);
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    if (entry.watchdog) clearInterval(entry.watchdog);
    if (entry.mockTimer) clearInterval(entry.mockTimer);
    if (entry.burstTimer) clearTimeout(entry.burstTimer);
    this.stopWaiting(entry);
    entry.buffer = [];
    try {
      entry.res?.end();
    } catch {
      // 이미 끊긴 연결
    }
    // 슬롯을 돌려준다
    this.streams.delete(entry.id);
  }

  /** 30초 안에 연결하지 않은 준비분은 버리고 슬롯을 돌려준다 */
  private sweep(): void {
    const now = Date.now();
    for (const entry of [...this.streams.values()]) {
      if (entry.res === null && now > entry.expiresAt) {
        this.streams.delete(entry.id);
      }
    }
  }

  beforeApplicationShutdown(): void {
    for (const entry of [...this.streams.values()]) {
      this.close(
        entry,
        'shutdown',
        'LOG_STREAM_SHUTDOWN',
        '서버가 종료됩니다.',
      );
    }
  }
}

/** 쿠버네티스가 "시작 전"이라고 한 오류인가 (client-node 2.0은 400 본문을 버리므로 400 코드도 본다) */
function isNotStartedError(err: unknown): boolean {
  if (!(err instanceof DirectLogError)) return false;
  return (
    err.code === 'LOG_CONTAINER_NOT_STARTED' ||
    (err.code === 'LOG_UPSTREAM_ERROR' && err.details?.status === 400)
  );
}

/** 서버 문구용 기간 표기: 60초 미만은 `N초`, 그 밖은 `N분` */
function durationKo(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}초`;
  if (sec % 60 === 0) return `${sec / 60}분`;
  return `${sec}초`;
}

function toNotice(err: unknown): LogNotice {
  if (err instanceof DirectLogError) {
    return {
      code: err.code,
      level: err.code === 'LOG_FORBIDDEN' ? 'error' : 'warn',
      text: err.message,
      ...(err.details ? { details: err.details } : {}),
    };
  }
  if (err instanceof ApiException) {
    return { code: err.code, level: 'error', text: err.message };
  }
  return {
    code: 'LOG_UPSTREAM_ERROR',
    level: 'error',
    text: '로그를 가져오지 못했습니다.',
  };
}
