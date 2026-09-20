import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { merge, Observable, Subject } from 'rxjs';
import { parseNotes } from '../aws-snapshots/analyzer';
import { BackendError } from '../aws-snapshots/backend';
import {
  compactStamp,
  compactStampToIso,
} from '../aws-snapshots/snapshot.constants';
import {
  decodeLikeCli,
  restoreFormat,
  sha256Version,
  textFacts,
  toLfText,
  truncateAtLine,
} from '../aws-snapshots/text-utils';
import {
  ApiException,
  resourceNotFound,
  validationFailed,
} from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import {
  MockScenarioTargetProvider,
  TopicSourceProvider,
  type MockScenarioTarget,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import { paginate, parseSort } from '../common/list-query';
import {
  SourceRegistry,
  type SourceState,
} from '../common/source-registry.service';
import {
  compareStatusDesc,
  reason,
  StatusChangeTracker,
  statusFromReasons,
  type Reason,
  type Status,
  type StatusInfo,
} from '../common/status';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { ClusterObjectSource } from './drift/cluster-object-source';
import { COMPARABLE_KINDS } from './drift/comparable-kinds';
import { DriftService } from './drift/drift.service';
import type { RuleId } from './graph/graph-types';
import { K8sGraphService } from './graph/graph.service';
import type { K8sNotesDto, K8sSnapshotListQueryDto } from './dto';
import {
  analyzeK8sSnapshot,
  expectedOf,
  identityMatches,
  identityOf,
  parseYamlDocs,
  snapshotIdToIso,
  sortK8sFindings,
  summarizeK8s,
  yamlErrors,
  type K8sAnalysis,
  type K8sFileFact,
  type K8sScanFinding,
  type ScanSummary,
} from './k8s-analyzer';
import {
  cloneMemTree,
  FsK8sBackend,
  MemoryK8sBackend,
  type K8sBackend,
  type K8sTrashItem,
  type MemTree,
} from './k8s-backend';
import {
  defaultK8sLibDir,
  defaultScanLibDir,
  LibLoadError,
  loadK8sLibs,
  type K8sRules,
  type K8sScanner,
} from './k8s-libs';
import {
  buildK8sLargeTree,
  buildK8sMockTrees,
  K8S_MOCK_IDS,
  type K8sMockTrees,
} from './k8s-mock-fixtures';
import {
  CLI_COMMANDS,
  LABEL_MAX,
  MEMO_MAX,
  MOCK_OPTIONS,
  MOCK_SCENARIOS,
  NOTES_FILE,
  SETUP_HINT,
  STALE_AFTER_SEC,
  TOPIC,
  TRASH_ID_RE,
  VIEW_MIN_BYTES,
  type ConfirmValue,
  type K8sMockScenario,
} from './k8s.constants';

export type K8sWriteBlockCode =
  | 'WRITE_DISABLED'
  | 'READ_ONLY'
  | 'SOURCE_UNAVAILABLE'
  | 'EXPORT_MAYBE_IN_PROGRESS'
  | 'NOTES_CORRUPT'
  | 'FILE_KIND_READ_ONLY'
  | 'FILE_MISSING'
  | 'FILE_UNREADABLE'
  | 'FILE_TOO_LARGE'
  | 'NOT_UTF8'
  | 'MIXED_LINE_ENDINGS'
  | 'SNAPSHOT_ID_EXISTS';

export interface WriteAbility {
  allowed: boolean;
  reasonCode: K8sWriteBlockCode | null;
  reasonText: string | null;
}

const OK: WriteAbility = { allowed: true, reasonCode: null, reasonText: null };
const block = (code: K8sWriteBlockCode, text: string): WriteAbility => ({
  allowed: false,
  reasonCode: code,
  reasonText: text,
});

const BLOCK_TEXT: Record<K8sWriteBlockCode, string> = {
  WRITE_DISABLED: '쓰기 기능이 꺼져 있습니다 (K8S_SNAPSHOT_WRITE_ENABLED)',
  READ_ONLY: '스냅샷 폴더가 읽기 전용입니다',
  SOURCE_UNAVAILABLE: '스냅샷 폴더를 사용할 수 없습니다',
  EXPORT_MAYBE_IN_PROGRESS: '내보내기 진행 중일 수 있어 바꿀 수 없습니다',
  NOTES_CORRUPT: 'notes.json을 읽을 수 없어 라벨·메모를 바꿀 수 없습니다',
  FILE_KIND_READ_ONLY: '이 파일은 보기 전용입니다',
  FILE_MISSING: '파일이 없습니다',
  FILE_UNREADABLE: '파일을 읽을 수 없습니다',
  FILE_TOO_LARGE:
    '파일이 커서 대시보드에서 편집할 수 없습니다. 편집기로 여세요',
  NOT_UTF8: 'UTF-8 파일이 아니어서 편집할 수 없습니다',
  MIXED_LINE_ENDINGS:
    '줄바꿈(LF/CRLF)이 섞여 있어 편집할 수 없습니다 (편집기로 통일하세요)',
  SNAPSHOT_ID_EXISTS: '같은 ID의 스냅샷이 이미 있습니다',
};

const EDITABLE_TYPES = new Set(['resource', 'namespace']);
const DEFAULT_DISPLAY = 'deploy/k8s-snapshot/snapshots';

interface Config {
  dir: string | null;
  scanLibDir: string;
  k8sLibDir: string;
  writeEnabled: boolean;
  inProgressMin: number;
  editMax: number;
  viewMax: number;
  pollSec: number;
  displayPath: string | null;
}

interface CacheEntry {
  fp: string;
  a: K8sAnalysis;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * k8s-snapshot: 로컬 k8s 스냅샷 폴더 보기·편집·휴지통 + 드리프트 (docs/api/k8s-snapshot.md).
 * 파일 관리가 쓰는 곳은 스냅샷 폴더 안 파일뿐이다. 쿠버네티스·AWS·DB·git·kubectl·CLI 실행 없음 (AC-K27).
 * 드리프트는 DriftService 가 기존 informer 캐시를 읽기만 한다. PrismaService 비의존.
 */
@Injectable()
@TopicSourceProvider()
@MockScenarioTargetProvider()
export class K8sSnapshotsService
  implements
    OnApplicationBootstrap,
    OnModuleDestroy,
    TopicSource,
    MockScenarioTarget
{
  readonly topic = TOPIC;
  readonly group = 'k8s-snapshots' as const;
  readonly scenarios = MOCK_SCENARIOS;
  readonly options = MOCK_OPTIONS;
  readonly defaultScenario = 'default';

  private readonly logger = new Logger(K8sSnapshotsService.name);
  private readonly cfg: Config;
  private scanner: K8sScanner | null = null;
  private rules: K8sRules | null = null;
  private backend: K8sBackend | null = null;
  private mockBackends: {
    default: K8sBackend;
    noDrift: K8sBackend;
    empty: K8sBackend;
  } | null = null;
  /** 대규모 시나리오(`large`) 저장소. 고를 때 만든다 */
  private largeBackend: K8sBackend | null = null;
  private scenario: K8sMockScenario = 'default';

  private readonly cache = new Map<string, CacheEntry>();
  private unrecognized: string[] = [];
  private trashCount = 0;
  private rootWritable = true;
  private readOnlySticky = false;
  private rootState: SourceState;
  private rootError: { code: string; message: string } | null = null;
  private lastSuccessMs: number | null = null;
  private lastCheckedAt: string | null = null;
  private revision = 0;
  private readonly tracker = new StatusChangeTracker();

  private readonly own = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent>;
  private pending = {
    changed: new Set<string>(),
    removed: new Set<string>(),
    trash: false,
  };
  private debounce: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private ready: Promise<void> = Promise.resolve();
  /** 저장소 교체(mock 시나리오·reset) 세대. 교체 전에 시작한 확인 결과는 버린다 */
  private gen = 0;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly registry: SourceRegistry,
    private readonly drift: DriftService,
    private readonly graphSvc: K8sGraphService,
    private readonly clusterSource: ClusterObjectSource,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    const view = config.get('K8S_SNAPSHOT_VIEW_MAX_BYTES', { infer: true });
    const dir = config.get('K8S_SNAPSHOT_DIR', { infer: true });
    this.cfg = {
      dir: dir ? resolve(dir) : null,
      scanLibDir:
        config.get('AWS_SNAPSHOT_LIB_DIR', { infer: true }) ??
        defaultScanLibDir(),
      k8sLibDir:
        config.get('K8S_SNAPSHOT_LIB_DIR', { infer: true }) ??
        defaultK8sLibDir(),
      writeEnabled: config.get('K8S_SNAPSHOT_WRITE_ENABLED', { infer: true }),
      inProgressMin: config.get('K8S_SNAPSHOT_IN_PROGRESS_MIN', {
        infer: true,
      }),
      editMax: config.get('K8S_SNAPSHOT_EDIT_MAX_BYTES', { infer: true }),
      viewMax: Math.max(view, VIEW_MIN_BYTES),
      pollSec: config.get('K8S_SNAPSHOT_POLL_INTERVAL_SEC', { infer: true }),
      displayPath:
        config.get('K8S_SNAPSHOT_DISPLAY_PATH', { infer: true }) ?? dir ?? null,
    };
    this.rootState = mode === 'mock' ? 'mock' : 'syncing';
    this.events$ = merge(this.own.asObservable(), this.drift.events$);
  }

  get editMaxBytes(): number {
    return this.cfg.editMax;
  }

  /** 명령 예시·드리프트 명령에 쓰는 경로 */
  private get commandRoot(): string {
    if (this.mode === 'mock') return DEFAULT_DISPLAY;
    return (this.cfg.displayPath ?? DEFAULT_DISPLAY)
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');
  }

  // ------------------------------------------------------------------ 시작·주기

  onApplicationBootstrap(): void {
    this.ready = this.init();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private async init(): Promise<void> {
    if (this.mode === 'live' && !this.cfg.dir) {
      this.rootState = 'not_configured';
      this.registry.update('k8sSnapshotStore', {
        state: 'not_configured',
        error: null,
      });
      this.drift.start(null, null);
      return;
    }
    try {
      const libs = await loadK8sLibs(this.cfg.scanLibDir, this.cfg.k8sLibDir);
      this.scanner = libs.scanner;
      this.rules = libs.rules;
    } catch (err) {
      const code =
        err instanceof LibLoadError ? err.code : 'SCANNER_UNAVAILABLE';
      const msg =
        code === 'K8S_RULES_UNAVAILABLE'
          ? 'k8s 규칙 lib를 불러올 수 없습니다 (K8S_SNAPSHOT_LIB_DIR)'
          : '스캐너를 불러올 수 없습니다 (AWS_SNAPSHOT_LIB_DIR)';
      this.logger.warn(`${msg} (${code})`);
      this.rootState = 'unavailable';
      this.rootError = { code, message: msg };
      this.registry.markFailure('k8sSnapshotStore', this.rootError, {
        state: 'unavailable',
      });
      this.drift.start(null, null);
      return;
    }
    this.drift.start(
      { rules: this.rules, scanner: this.scanner },
      this.commandRoot,
    );
    if (this.mode === 'mock') {
      this.buildMock();
    } else {
      this.backend = new FsK8sBackend(
        this.cfg.dir!,
        this.scanner.scannableExtensions,
      );
      this.timer = setInterval(
        () => void this.refresh(),
        this.cfg.pollSec * 1000,
      );
      this.timer.unref();
    }
    await this.refresh();
    if (this.mode === 'mock')
      this.drift.seedLastResult(K8S_MOCK_IDS.lastResult);
  }

  private buildMock(): void {
    const trees: K8sMockTrees = buildK8sMockTrees(this.rules!);
    const mk = (t: MemTree) => new MemoryK8sBackend(cloneMemTree(t));
    this.mockBackends = {
      default: mk(trees.default),
      noDrift: mk(trees.noDrift),
      empty: mk(trees.empty),
    };
    this.backend = this.backendFor(this.scenario);
  }

  private backendFor(s: K8sMockScenario): K8sBackend {
    const b = this.mockBackends!;
    if (s === 'large') {
      // 대규모 예시는 고를 때만 만든다 (기본 목록·부팅이 느려지지 않게)
      this.largeBackend ??= new MemoryK8sBackend(
        buildK8sLargeTree(this.rules!),
      );
      return this.largeBackend;
    }
    return s === 'empty' ? b.empty : s === 'no-drift' ? b.noDrift : b.default;
  }

  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
      return this.refreshing;
    }
    this.queued ??= this.refreshing.then(() => {
      this.queued = null;
      return this.refresh();
    });
    return this.queued;
  }

  private analyze(raw: Parameters<typeof analyzeK8sSnapshot>[0]): K8sAnalysis {
    return analyzeK8sSnapshot(
      raw,
      { scanner: this.scanner!, rules: this.rules! },
      { nowMs: Date.now(), inProgressMinutes: this.cfg.inProgressMin },
    );
  }

  private async doRefresh(): Promise<void> {
    const backend = this.backend;
    if (!backend || !this.scanner) return;
    const gen = this.gen;
    const nowMs = Date.now();
    this.lastCheckedAt = new Date(nowMs).toISOString();
    let changed = false;
    try {
      const probe = await backend.probeRoot();
      this.rootWritable = probe.writable;
      const listing = await backend.listRoot();
      const present = new Set(listing.snapshots);
      for (const id of [...this.cache.keys()]) {
        if (!present.has(id)) {
          this.cache.delete(id);
          this.tracker.forget(id);
          this.pending.removed.add(id);
          changed = true;
        }
      }
      for (const id of listing.snapshots) {
        if (gen !== this.gen) return;
        if (await this.refreshEntry(id)) changed = true;
      }
      const trash = await backend.listTrash();
      if (gen !== this.gen) return;
      if (trash.length !== this.trashCount) {
        this.trashCount = trash.length;
        this.pending.trash = true;
        changed = true;
      }
      if (listing.unrecognized.join('\n') !== this.unrecognized.join('\n')) {
        this.unrecognized = listing.unrecognized;
        changed = true;
      }
      this.lastSuccessMs = nowMs;
      const prevState = this.rootState;
      this.rootState = this.mode === 'mock' ? 'mock' : 'ok';
      this.rootError = null;
      if (prevState !== this.rootState) changed = true;
      this.registry.markSuccess('k8sSnapshotStore', this.lastCheckedAt);
    } catch (err) {
      if (gen !== this.gen) return;
      changed = this.onRefreshFailure(err, nowMs) || changed;
    }
    if (gen !== this.gen) return;
    this.syncDrift();
    if (changed) this.bump();
  }

  private syncDrift(): void {
    this.drift.sync(this.analyses());
  }

  private async refreshEntry(id: string): Promise<boolean> {
    const backend = this.backend!;
    let fp: string | null;
    try {
      fp = await backend.fingerprint(id);
    } catch (err) {
      if (err instanceof BackendError && err.code === 'PATH_REJECTED') {
        if (this.cache.delete(id)) {
          this.pending.removed.add(id);
          return true;
        }
        return false;
      }
      throw err;
    }
    const cur = this.cache.get(id);
    if (fp === null) {
      if (cur) {
        this.cache.delete(id);
        this.pending.removed.add(id);
        return true;
      }
      return false;
    }
    if (cur && cur.fp === fp && cur.a.metadata.state !== 'missing')
      return false;
    const raw = await backend.readSnapshot(id, this.cfg.viewMax);
    if (!raw) return false;
    const a = this.analyze(raw);
    const same =
      cur !== undefined &&
      cur.fp === fp &&
      cur.a.status === a.status &&
      cur.a.reasons.map((r) => r.code).join() ===
        a.reasons.map((r) => r.code).join();
    this.cache.set(id, { fp, a: same ? cur.a : a });
    if (same) return false;
    this.pending.changed.add(id);
    return true;
  }

  private onRefreshFailure(err: unknown, nowMs: number): boolean {
    const code = err instanceof BackendError ? err.code : 'UNKNOWN';
    const errno =
      err instanceof BackendError
        ? err.errno
        : ((err as { code?: string })?.code ?? undefined);
    const prev = this.rootState;
    if (code === 'ROOT_MISSING') {
      this.rootState = 'unavailable';
      this.rootError = {
        code: 'ROOT_MISSING',
        message: `스냅샷 폴더를 찾을 수 없습니다: ${this.cfg.displayPath ?? ''}`,
      };
      if (this.cache.size) {
        for (const id of this.cache.keys()) this.pending.removed.add(id);
        this.cache.clear();
      }
      this.registry.markFailure('k8sSnapshotStore', this.rootError, {
        state: 'unavailable',
      });
    } else {
      this.rootError = {
        code: code === 'ROOT_UNREADABLE' ? 'ROOT_UNREADABLE' : 'READ_FAILED',
        message: `스냅샷 폴더를 읽을 수 없습니다 (${errno ?? 'EIO'})`,
      };
      if (this.lastSuccessMs === null) {
        this.rootState = 'unavailable';
        this.registry.markFailure('k8sSnapshotStore', this.rootError, {
          state: 'unavailable',
        });
      } else if (nowMs - this.lastSuccessMs >= STALE_AFTER_SEC * 1000) {
        this.rootState = 'stale';
        this.registry.markFailure('k8sSnapshotStore', this.rootError, {
          state: 'stale',
        });
      }
      this.logger.warn(`k8s 스냅샷 폴더 확인 실패 (${errno ?? code})`);
    }
    return prev !== this.rootState;
  }

  private bump(): void {
    this.revision++;
    if (this.debounce) return;
    this.debounce = setTimeout(() => this.flush(), 1000);
    this.debounce.unref();
  }

  private flush(): void {
    this.debounce = null;
    const payload = {
      revision: this.revision,
      changedIds: [...this.pending.changed].sort(),
      removedIds: [...this.pending.removed].sort(),
      trashChanged: this.pending.trash,
      summary: this.buildSummary(),
    };
    this.pending = { changed: new Set(), removed: new Set(), trash: false };
    this.own.next({ event: `${TOPIC}.changed`, data: payload });
  }

  /** 테스트용: 대기 중인 changed 이벤트를 바로 보낸다 */
  flushNow(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.flush();
    this.drift.flushNow();
  }

  snapshot(): Promise<TopicEvent[]> {
    return Promise.resolve([
      {
        event: `${TOPIC}.snapshot`,
        data: { revision: this.revision, summary: this.buildSummary() },
      },
    ]);
  }

  private emitSnapshot(): void {
    void this.snapshot().then((evs) => evs.forEach((e) => this.own.next(e)));
  }

  // ------------------------------------------------------------------ mock 시나리오

  currentScenario(): string {
    return this.scenario;
  }

  setScenario(name: string): void {
    if (!(MOCK_SCENARIOS as readonly string[]).includes(name))
      throw new Error(`unknown scenario ${name}`);
    this.scenario = name as K8sMockScenario;
    if (this.mode !== 'mock') return;
    this.drift.setDisconnected(name === 'cluster-disconnected');
    if (!this.mockBackends) return;
    const next = this.backendFor(this.scenario);
    if (next !== this.backend) {
      this.backend = next;
      this.gen++;
      this.cache.clear();
      this.graphSvc.clear();
      this.tracker.clear();
      this.trashCount = 0;
      this.unrecognized = [];
    }
    this.revision++;
    void this.refresh().then(() => this.emitSnapshot());
  }

  resetData(): void {
    if (this.mode !== 'mock' || !this.rules) return;
    this.gen++;
    this.largeBackend = null;
    this.buildMock();
    this.cache.clear();
    this.graphSvc.clear();
    this.tracker.clear();
    this.trashCount = 0;
    this.unrecognized = [];
    this.drift.clear();
    this.revision++;
    void this.refresh().then(() => {
      this.drift.seedLastResult(K8S_MOCK_IDS.lastResult);
      this.emitSnapshot();
    });
  }

  private effectiveState(): SourceState {
    if (this.mode === 'mock') {
      if (this.rootState !== 'mock') return this.rootState;
      if (this.scenario === 'not-configured') return 'not_configured';
      if (this.scenario === 'unavailable') return 'unavailable';
      return 'mock';
    }
    return this.rootState;
  }

  /** 메뉴 합산용 출처 상태 */
  sourceState(): SourceState {
    return this.effectiveState();
  }

  private sourceUsable(): boolean {
    const s = this.effectiveState();
    return s === 'ok' || s === 'mock' || s === 'stale';
  }

  // ------------------------------------------------------------------ 판단·보기

  private globalWrite(): WriteAbility {
    const s = this.effectiveState();
    if (s !== 'ok' && s !== 'mock')
      return block('SOURCE_UNAVAILABLE', BLOCK_TEXT.SOURCE_UNAVAILABLE);
    if (
      !this.cfg.writeEnabled ||
      (this.mode === 'mock' && this.scenario === 'write-disabled')
    )
      return block('WRITE_DISABLED', BLOCK_TEXT.WRITE_DISABLED);
    if (
      !this.rootWritable ||
      this.readOnlySticky ||
      (this.mode === 'mock' && this.scenario === 'read-only')
    )
      return block('READ_ONLY', BLOCK_TEXT.READ_ONLY);
    return OK;
  }

  private actions(a: K8sAnalysis) {
    const g = this.globalWrite();
    const inProg = a.inProgress
      ? block('EXPORT_MAYBE_IN_PROGRESS', BLOCK_TEXT.EXPORT_MAYBE_IN_PROGRESS)
      : OK;
    const first = (...list: WriteAbility[]) =>
      list.find((x) => !x.allowed) ?? OK;
    return {
      editFiles: first(g, inProg),
      editNotes: first(
        g,
        inProg,
        a.notes.corrupt ? block('NOTES_CORRUPT', BLOCK_TEXT.NOTES_CORRUPT) : OK,
      ),
      delete: first(g, inProg),
      computeDrift: this.drift.ability(a),
    };
  }

  private fileEditable(a: K8sAnalysis, f: K8sFileFact): WriteAbility {
    const snap = this.actions(a).editFiles;
    if (!snap.allowed) return snap;
    if (!EDITABLE_TYPES.has(f.fileType))
      return block('FILE_KIND_READ_ONLY', BLOCK_TEXT.FILE_KIND_READ_ONLY);
    if (f.readError)
      return block('FILE_UNREADABLE', BLOCK_TEXT.FILE_UNREADABLE);
    if ((f.sizeBytes ?? 0) > this.cfg.editMax)
      return block('FILE_TOO_LARGE', BLOCK_TEXT.FILE_TOO_LARGE);
    if (f.encoding !== 'utf-8') return block('NOT_UTF8', BLOCK_TEXT.NOT_UTF8);
    if (f.eol === 'mixed')
      return block('MIXED_LINE_ENDINGS', BLOCK_TEXT.MIXED_LINE_ENDINGS);
    return OK;
  }

  private statusInfo(a: K8sAnalysis): StatusInfo {
    return {
      status: a.status,
      reasons: a.reasons,
      updatedAt: a.analyzedAt,
      statusChangedAt: this.tracker.track(a.id, a.status, a.analyzedAt),
      stale: this.effectiveState() === 'stale',
    };
  }

  private analyses(): K8sAnalysis[] {
    if (!this.sourceUsable()) return [];
    return [...this.cache.values()].map((c) => c.a);
  }

  /** 같은 cluster.id 의 바로 이전 스냅샷 */
  private previousMap(list: K8sAnalysis[]): Map<string, K8sAnalysis> {
    const out = new Map<string, K8sAnalysis>();
    const last = new Map<string, K8sAnalysis>();
    for (const a of [...list].sort((x, y) => (x.id < y.id ? -1 : 1))) {
      const cid = a.cluster?.id;
      if (!cid) continue;
      const p = last.get(cid);
      if (p) out.set(a.id, p);
      last.set(cid, a);
    }
    return out;
  }

  private resourceCount(a: K8sAnalysis): number {
    return a.files
      .filter((f) => f.fileType === 'resource' || f.fileType === 'namespace')
      .reduce((n, f) => n + Math.max(1, f.documents.length), 0);
  }

  private exportProgress(a: K8sAnalysis) {
    const metadataMissing = a.metadata.state === 'missing';
    return {
      active: a.inProgress,
      metadataMissing,
      lastChangeAt: new Date(a.lastChangeMs).toISOString(),
      untilAt: metadataMissing
        ? new Date(
            a.lastChangeMs + this.cfg.inProgressMin * 60_000,
          ).toISOString()
        : null,
      thresholdMinutes: this.cfg.inProgressMin,
    };
  }

  private listItem(a: K8sAnalysis, prev: K8sAnalysis | undefined) {
    const total = this.resourceCount(a);
    const prevTotal = prev ? this.resourceCount(prev) : null;
    return {
      id: a.id,
      snapshotAt: a.snapshotAt,
      status: this.statusInfo(a),
      drift: this.drift.badge(a),
      label: a.notes.label,
      memo: a.notes.memo,
      notesUpdatedAt: a.notes.updatedAt,
      cluster: a.cluster
        ? { ...a.cluster, relation: this.drift.relation(a) }
        : null,
      scope: a.scope,
      resources: {
        current: { total, files: a.resourcesTotal },
        atExport: a.atExportTotal !== null ? { total: a.atExportTotal } : null,
        changedSinceExport:
          a.atExportTotal !== null && a.atExportTotal !== total,
        previous: prev ? { snapshotId: prev.id, total: prevTotal! } : null,
        delta: prev ? total - prevTotal! : null,
      },
      helmManaged: a.helmManaged,
      partialKinds: a.partialKinds,
      scan: a.scan.summary,
      lastModifiedAt: a.lastModifiedAt,
      modifiedByDashboard: a.modifiedByDashboard,
      cliVersion: a.cliVersion,
      actions: this.actions(a),
      exportInProgress: this.exportProgress(a),
    };
  }

  buildSummary() {
    const s = this.effectiveState();
    const list = this.analyses();
    const counts = {
      total: list.length,
      critical: 0,
      warning: 0,
      unknown: 0,
      ok: 0,
    };
    for (const a of list) counts[a.status]++;
    const reasons: Reason[] = [];
    if (s === 'not_configured') {
      reasons.push(
        reason(
          'SOURCE_NOT_CONFIGURED',
          'Kubernetes 스냅샷 폴더가 설정되지 않았습니다 (K8S_SNAPSHOT_DIR)',
          'unknown',
        ),
      );
    } else if (s === 'unavailable' || s === 'syncing') {
      reasons.push(
        reason(
          'SOURCE_UNAVAILABLE',
          this.mode === 'mock' && this.scenario === 'unavailable'
            ? '스냅샷 폴더를 찾을 수 없습니다: /data/k8s-snapshots'
            : (this.rootError?.message ?? '스냅샷 폴더를 확인하는 중입니다'),
          'unknown',
        ),
      );
    } else {
      if (counts.critical)
        reasons.push(
          reason(
            'SNAPSHOTS_COMMIT_BLOCKED',
            `커밋 금지 스냅샷 ${counts.critical}개`,
            'critical',
          ),
        );
      if (counts.warning)
        reasons.push(
          reason(
            'SNAPSHOTS_NEED_REVIEW',
            `주의 스냅샷 ${counts.warning}개`,
            'warning',
          ),
        );
      if (counts.unknown)
        reasons.push(
          reason(
            'SNAPSHOTS_UNKNOWN',
            `상태를 알 수 없는 스냅샷 ${counts.unknown}개`,
            'unknown',
          ),
        );
    }
    const judged = statusFromReasons(reasons);
    const status: Status =
      s === 'not_configured' || s === 'unavailable' || s === 'syncing'
        ? 'unknown'
        : judged.status;
    const finalReasons = [...judged.reasons];
    if (s === 'stale')
      finalReasons.push(
        reason(
          'SOURCE_STALE',
          '스냅샷 폴더 확인 실패, 마지막 결과 유지 중',
          status,
        ),
      );
    const now = this.lastCheckedAt ?? new Date().toISOString();
    const usable = s === 'ok' || s === 'mock' || s === 'stale';
    return {
      status: {
        status,
        reasons: finalReasons,
        updatedAt: this.lastCheckedAt,
        statusChangedAt: this.tracker.track('__summary__', status, now),
        stale: s === 'stale',
      } satisfies StatusInfo,
      counts,
      unrecognized: usable
        ? {
            count: this.unrecognized.length,
            names: this.unrecognized.slice(0, 20),
          }
        : { count: 0, names: [] },
      trashCount: usable ? this.trashCount : 0,
      root: {
        configured: s !== 'not_configured',
        displayPath:
          s === 'not_configured'
            ? null
            : this.mode === 'mock'
              ? '(예시 데이터)'
              : this.cfg.displayPath,
        state: s,
        setup:
          s === 'not_configured' || s === 'unavailable'
            ? { ...SETUP_HINT, reasonText: finalReasons[0]?.text ?? null }
            : null,
      },
      writable: this.globalWrite(),
      lastCheckedAt: this.lastCheckedAt,
      limits: {
        editMaxBytes: this.cfg.editMax,
        viewMaxBytes: this.cfg.viewMax,
        inProgressMinutes: this.cfg.inProgressMin,
        labelMaxLength: LABEL_MAX,
        memoMaxLength: MEMO_MAX,
      },
      dashboardCluster: this.drift.dashboardCluster(),
      latestDrift: usable ? this.drift.latest() : null,
    };
  }

  private envelope() {
    return { dataSource: this.mode, generatedAt: new Date().toISOString() };
  }

  private cliFor(id?: string) {
    return id
      ? { ...CLI_COMMANDS, scan: CLI_COMMANDS.scan.replace('<id>', id) }
      : CLI_COMMANDS;
  }

  async getSummary() {
    await this.ready;
    return {
      ...this.envelope(),
      revision: this.revision,
      summary: this.buildSummary(),
      cli: CLI_COMMANDS,
    };
  }

  private driftFilterValue(b: ReturnType<DriftService['badge']>): string {
    if (b.status.reasons.some((r) => r.code === 'DRIFT_NOT_COMPUTED'))
      return 'not_computed';
    return b.status.status === 'critical' ? 'unknown' : b.status.status;
  }

  async list(q: K8sSnapshotListQueryDto) {
    await this.ready;
    const all = this.analyses();
    const prev = this.previousMap(all);
    const rows = all.map((a) => this.listItem(a, prev.get(a.id)));
    const facets = {
      cluster: { same: 0, other: 0, unknown: 0 } as Record<string, number>,
      drift: { ok: 0, warning: 0, unknown: 0, not_computed: 0 } as Record<
        string,
        number
      >,
      status: { ok: 0, warning: 0, critical: 0, unknown: 0 } as Record<
        string,
        number
      >,
    };
    for (const r of rows) {
      facets.cluster[r.cluster?.relation ?? 'unknown']++;
      facets.drift[this.driftFilterValue(r.drift)]++;
      facets.status[r.status.status]++;
    }
    let items = rows;
    if (q.status?.length)
      items = items.filter((i) => q.status!.includes(i.status.status));
    if (q.drift?.length)
      items = items.filter((i) =>
        q.drift!.includes(this.driftFilterValue(i.drift)),
      );
    if (q.cluster?.length)
      items = items.filter((i) =>
        q.cluster!.includes(i.cluster?.relation ?? 'unknown'),
      );
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((i) =>
        [i.id, i.label ?? '', i.memo ?? '', i.cluster?.context ?? ''].some(
          (t) => t.toLowerCase().includes(needle),
        ),
      );
    }
    const sort = parseSort(q.sort) ?? { field: 'snapshotAt', dir: 'desc' };
    const byId = (x: { id: string }, y: { id: string }) =>
      x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
    items.sort((x, y) => {
      if (sort.field === 'status') {
        const c = compareStatusDesc(x.status.status, y.status.status);
        return (sort.dir === 'desc' ? c : -c) || byId(x, y);
      }
      return sort.dir === 'desc' ? byId(x, y) : -byId(x, y);
    });
    const page = paginate(all.length, items, q);
    return {
      ...this.envelope(),
      revision: this.revision,
      summary: this.buildSummary(),
      ...page.meta,
      facets,
      items: page.items,
      cli: CLI_COMMANDS,
    };
  }

  // ------------------------------------------------------------------ 공통 확인

  private requireReadable(): void {
    if (!this.sourceUsable() || !this.backend || !this.scanner || !this.rules) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SOURCE_UNAVAILABLE',
        'Kubernetes 스냅샷 폴더를 사용할 수 없습니다.',
        { source: this.registry.get('k8sSnapshotStore') },
      );
    }
  }

  private requireReadableStrict(): never {
    throw new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'SOURCE_UNAVAILABLE',
      'Kubernetes 스냅샷 폴더를 사용할 수 없습니다.',
      { source: this.registry.get('k8sSnapshotStore') },
    );
  }

  private requireWritable(): void {
    const s = this.effectiveState();
    if (s !== 'ok' && s !== 'mock') this.requireReadableStrict();
    const g = this.globalWrite();
    if (g.allowed) return;
    if (g.reasonCode === 'SOURCE_UNAVAILABLE') this.requireReadableStrict();
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      g.reasonCode === 'WRITE_DISABLED'
        ? 'SNAPSHOT_WRITE_DISABLED'
        : 'SNAPSHOT_READ_ONLY',
      `${g.reasonText}.`,
    );
  }

  /** 파일 경로 형식 (계약 1.1). 값은 오류에 넣지 않는다 */
  private assertPath(path: unknown): string {
    if (
      typeof path !== 'string' ||
      path.length > 600 ||
      !this.rules!.isRequestablePath(path)
    )
      throw validationFailed([
        {
          field: 'path',
          value: undefined,
          constraints: ['path must match snapshot file path rules'],
        },
      ]);
    return path;
  }

  private mapBackendError(
    err: unknown,
    ctx: { id?: string; path?: string; trashId?: string },
  ): never {
    if (!(err instanceof BackendError)) throw err;
    switch (err.code) {
      case 'NOT_FOUND':
        if (ctx.trashId)
          throw resourceNotFound(
            { kind: 'K8sSnapshotTrashItem', id: ctx.trashId },
            '휴지통 항목이 없습니다.',
          );
        if (ctx.path)
          throw resourceNotFound(
            { kind: 'K8sSnapshotFile', id: ctx.id, path: ctx.path },
            '파일이 없습니다.',
          );
        throw resourceNotFound(
          { kind: 'K8sSnapshot', id: ctx.id },
          '스냅샷이 없습니다.',
        );
      case 'PATH_REJECTED':
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'SNAPSHOT_PATH_REJECTED',
          '허용되지 않는 경로입니다 (심볼릭 링크 또는 스냅샷 루트 밖).',
        );
      case 'VERSION_CONFLICT':
        throw this.conflict(ctx.path ?? null, null, null);
      case 'EXISTS':
        throw new ApiException(
          HttpStatus.CONFLICT,
          'SNAPSHOT_ID_EXISTS',
          '같은 ID의 스냅샷이 이미 있어 복원할 수 없습니다.',
        );
      case 'READ_ONLY':
        this.readOnlySticky = true;
        this.bump();
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'SNAPSHOT_READ_ONLY',
          '스냅샷 폴더가 읽기 전용입니다.',
        );
      default:
        this.logger.warn(
          `k8s 스냅샷 쓰기 실패 id=${ctx.id ?? ctx.trashId ?? '-'} path=${ctx.path ?? '-'} errno=${err.errno ?? '-'}`,
        );
        throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          'SNAPSHOT_WRITE_FAILED',
          '파일을 쓰지 못했습니다. 원래 파일은 바뀌지 않았습니다.',
          { errno: err.errno ?? 'UNKNOWN' },
        );
    }
  }

  private conflict(
    path: string | null,
    currentVersion: string | null,
    modifiedAt: string | null,
  ) {
    return new ApiException(
      HttpStatus.CONFLICT,
      'SNAPSHOT_VERSION_CONFLICT',
      path === 'notes'
        ? '다른 곳에서 라벨·메모가 바뀌었습니다. 입력을 복사한 뒤 다시 불러오세요.'
        : '다른 곳에서 파일이 바뀌었습니다. 편집 내용을 복사한 뒤 다시 불러오세요.',
      path === 'notes'
        ? { fileKind: 'notes', currentVersion, currentModifiedAt: modifiedAt }
        : { path, currentVersion, currentModifiedAt: modifiedAt },
    );
  }

  private consumeMockConflict(): boolean {
    if (this.mode === 'mock' && this.scenario === 'conflict-once') {
      this.setScenario('default');
      return true;
    }
    return false;
  }

  private async fresh(id: string): Promise<K8sAnalysis> {
    try {
      const changed = await this.refreshEntry(id);
      if (changed) {
        this.syncDrift();
        this.bump();
      }
    } catch (err) {
      this.mapBackendError(err, { id });
    }
    const c = this.cache.get(id);
    if (!c)
      throw resourceNotFound({ kind: 'K8sSnapshot', id }, '스냅샷이 없습니다.');
    return c.a;
  }

  // ------------------------------------------------------------------ 상세

  private kindDriftState(
    kindDir: string,
    a: K8sAnalysis,
  ): 'comparable' | 'not_in_rbac' | 'forbidden' | 'api_version_mismatch' {
    const ck = COMPARABLE_KINDS.find((k) => k.id === kindDir);
    if (!ck) return 'not_in_rbac';
    if (
      this.mode !== 'mock' &&
      this.clusterSource.kindState(ck.id) === 'forbidden'
    )
      return 'forbidden';
    const mismatch = a.files.some(
      (f) =>
        f.kindDir === kindDir &&
        f.documents.some(
          (d) => d.kind === ck.kind && d.apiVersion !== ck.apiVersion,
        ),
    );
    return mismatch ? 'api_version_mismatch' : 'comparable';
  }

  private fileComparable(f: K8sFileFact): boolean {
    if (
      !EDITABLE_TYPES.has(f.fileType) ||
      f.parse !== 'ok' ||
      f.duplicate ||
      !f.resource
    )
      return false;
    const ck = COMPARABLE_KINDS.find(
      (k) => k.apiGroup === f.resource!.apiGroup && k.kind === f.resource!.kind,
    );
    if (!ck || ck.apiVersion !== f.resource.apiVersion) return false;
    return (
      this.mode === 'mock' ||
      this.clusterSource.kindState(ck.id) !== 'forbidden'
    );
  }

  private kindLabel(
    kindDir: string,
    a: K8sAnalysis,
  ): { kind: string; custom: boolean } {
    const k = this.rules!.kindById(kindDir);
    if (k) return { kind: k.kind, custom: false };
    const doc = a.files.find(
      (f) => f.kindDir === kindDir && f.resource,
    )?.resource;
    return { kind: doc?.kind ?? kindDir, custom: true };
  }

  private kindRank(kindDir: string): number {
    const i = this.rules!.KIND_CATALOG.findIndex((k) => k.id === kindDir);
    return i >= 0 ? i : 1000;
  }

  private detailParts(a: K8sAnalysis, prev: K8sAnalysis | undefined) {
    const meta = a.metaRaw;
    const scopeNs =
      meta && isObj(meta.scope) && isObj(meta.scope.namespaces)
        ? meta.scope.namespaces
        : null;
    const systemNs = new Set(
      Array.isArray(scopeNs?.system)
        ? (scopeNs.system as unknown[]).map(String)
        : [],
    );
    const fileDrift = this.drift.fileDrift(a);
    const files = a.files.map((f) => ({
      path: f.path,
      fileType: f.fileType,
      resource: f.resource,
      resourceKey: f.resourceKey,
      documents: f.documents,
      expected: f.expected,
      parse: f.parse,
      parseError: f.parseError,
      pathMatches: f.pathMatches,
      duplicate: f.duplicate,
      duplicateOf: f.duplicateOf,
      runtimeFields: f.runtimeFields,
      helmManaged: f.helmManaged,
      comparable: this.fileComparable(f),
      findings: f.findings,
      drift: fileDrift?.get(f.path) ?? null,
      exists: true,
      sizeBytes: f.sizeBytes,
      lineCount: f.lineCount,
      modifiedAt: f.modifiedAt,
      version: f.version,
      eol: f.eol,
      bom: f.bom,
      encoding: f.encoding,
      indent: f.indent,
      editable: this.fileEditable(a, f),
      viewTruncated: (f.sizeBytes ?? 0) > this.cfg.viewMax,
    }));

    // 트리
    const resFiles = a.files.filter((f) => EDITABLE_TYPES.has(f.fileType));
    const nsNames = [
      ...new Set(
        resFiles
          .map((f) => f.namespaceDir)
          .filter((x): x is string => x !== null),
      ),
    ].sort();
    const tree = nsNames.map((ns) => {
      const inNs = resFiles.filter(
        (f) => f.namespaceDir === ns && f.fileType === 'resource',
      );
      const nsFile = resFiles.find(
        (f) => f.fileType === 'namespace' && f.namespaceDir === ns,
      );
      const kindDirs = [...new Set(inNs.map((f) => f.kindDir!))].sort(
        (x, y) => this.kindRank(x) - this.kindRank(y) || (x < y ? -1 : 1),
      );
      return {
        namespace: ns,
        system: systemNs.has(ns),
        namespaceFile: nsFile?.path ?? null,
        count: inNs.length + (nsFile ? 1 : 0),
        kinds: kindDirs.map((kd) => {
          const paths = inNs
            .filter((f) => f.kindDir === kd)
            .map((f) => f.path)
            .sort();
          return {
            kindDir: kd,
            kind: this.kindLabel(kd, a).kind,
            count: paths.length,
            drift: this.kindDriftState(kd, a),
            paths,
          };
        }),
      };
    });
    const clusterScoped = resFiles.filter(
      (f) => f.fileType === 'resource' && f.namespaceDir === null,
    );
    if (clusterScoped.length) {
      const kds = [...new Set(clusterScoped.map((f) => f.kindDir!))].sort(
        (x, y) => this.kindRank(x) - this.kindRank(y) || (x < y ? -1 : 1),
      );
      tree.push({
        namespace: null as unknown as string,
        system: false,
        namespaceFile: null,
        count: clusterScoped.length,
        kinds: kds.map((kd) => {
          const paths = clusterScoped
            .filter((f) => f.kindDir === kd)
            .map((f) => f.path)
            .sort();
          return {
            kindDir: kd,
            kind: this.kindLabel(kd, a).kind,
            count: paths.length,
            drift: this.kindDriftState(kd, a),
            paths,
          };
        }),
      });
    }

    // 개수
    const resRaw = meta && isObj(meta.resources) ? meta.resources : null;
    const metaByKind = resRaw && isObj(resRaw.byKind) ? resRaw.byKind : {};
    const metaByNs =
      resRaw && isObj(resRaw.byNamespace) ? resRaw.byNamespace : {};
    const countBy = (list: K8sFileFact[], key: (f: K8sFileFact) => string) => {
      const m = new Map<string, number>();
      for (const f of list)
        m.set(key(f), (m.get(key(f)) ?? 0) + Math.max(1, f.documents.length));
      return m;
    };
    const kindKey = (f: K8sFileFact) => f.kindDir ?? 'namespaces';
    const curByKind = countBy(resFiles, kindKey);
    const prevByKind = prev
      ? countBy(
          prev.files.filter((f) => EDITABLE_TYPES.has(f.fileType)),
          kindKey,
        )
      : null;
    const kindIds = [
      ...new Set([...curByKind.keys(), ...Object.keys(metaByKind)]),
    ].sort((x, y) => this.kindRank(x) - this.kindRank(y) || (x < y ? -1 : 1));
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const byKind = kindIds.map((kd) => {
      const cur = curByKind.get(kd) ?? 0;
      const p = prevByKind ? (prevByKind.get(kd) ?? 0) : null;
      const lbl = this.kindLabel(kd, a);
      return {
        kindDir: kd,
        kind: lbl.kind,
        custom: lbl.custom,
        current: cur,
        atExport: resRaw ? (num(metaByKind[kd]) ?? 0) : null,
        previous: p,
        delta: p === null ? null : cur - p,
        drift: this.kindDriftState(kd, a),
      };
    });
    const curByNs = countBy(resFiles, (f) => f.namespaceDir ?? '_cluster');
    const byNamespace = [
      ...new Set([...curByNs.keys(), ...Object.keys(metaByNs)]),
    ]
      .sort()
      .map((ns) => ({
        namespace: ns === '_cluster' ? null : ns,
        system: systemNs.has(ns),
        current: curByNs.get(ns) ?? 0,
        atExport: resRaw ? (num(metaByNs[ns]) ?? 0) : null,
      }));
    const excluded: {
      kindDir: string;
      kind: string;
      count: number;
      reason: string;
      text: string;
    }[] = [];
    const exRaw =
      resRaw && isObj(resRaw.excludedByRule) ? resRaw.excludedByRule : {};
    let excludedTotal = 0;
    for (const [kd, v] of Object.entries(exRaw)) {
      if (!isObj(v)) continue;
      const kind = this.kindLabel(kd, a).kind;
      const names = Array.isArray(v.autoCreatedNames)
        ? (v.autoCreatedNames as unknown[]).map(String)
        : [];
      const add = (n: unknown, r: string, text: string) => {
        if (typeof n === 'number' && n > 0) {
          excluded.push({ kindDir: kd, kind, count: n, reason: r, text });
          excludedTotal += n;
        }
      };
      add(v.owned, 'owned', '컨트롤러 소유(ownerReferences)');
      add(
        v.autoCreated,
        'auto_created',
        names.length ? `자동 생성 (${names.join(', ')})` : '자동 생성',
      );
      add(v.helmExcluded, 'helm_excluded', 'Helm 제외 설정');
    }
    const total = this.resourceCount(a);
    const prevTotal = prev ? this.resourceCount(prev) : null;
    return {
      files,
      tree,
      counts: {
        total: {
          current: total,
          atExport: a.atExportTotal,
          previous: prevTotal,
          delta: prevTotal === null ? null : total - prevTotal,
          helmManaged: a.helmManaged,
          excludedByRule: resRaw ? excludedTotal : null,
        },
        byKind,
        byNamespace,
        excluded: resRaw ? excluded : [],
      },
    };
  }

  async detail(id: string) {
    await this.ready;
    this.requireReadable();
    const a = await this.fresh(id);
    const prev = this.previousMap(this.analyses()).get(id);
    const parts = this.detailParts(a, prev);
    return {
      ...this.envelope(),
      revision: this.revision,
      cli: this.cliFor(id),
      snapshot: {
        ...this.listItem(a, prev),
        files: parts.files,
        tree: parts.tree,
        counts: parts.counts,
        folder: a.folder,
        extraFiles: a.extraFiles,
        metadata: a.metadata,
        scan: {
          current: {
            summary: a.scan.summary,
            scannedFiles: a.scan.scannedFiles,
            findings: a.scan.findings,
            scannedAt: a.scan.scannedAt,
          },
          atExport: a.atExportScan,
        },
        secretRefs: {
          state: a.secretRefs.state,
          count: a.secretRefs.count,
          secrets: a.secretRefs.secrets,
          note: a.secretRefs.note,
        },
        notes: {
          label: a.notes.label,
          memo: a.notes.memo,
          updatedAt: a.notes.updatedAt,
          version: a.notes.version,
          fileExists: a.notes.fileExists,
        },
        notices: a.notices,
      },
    };
  }

  private commandsFor(id: string, path: string, fileType: string) {
    if (!EDITABLE_TYPES.has(fileType)) return null;
    const p = `${this.commandRoot}/${id}/${path}`;
    return {
      note: '대시보드는 이 명령을 실행하지 않습니다. 적용 전 kubectl diff 로 확인하세요',
      diff: `kubectl diff -f ${p}`,
      apply: `kubectl apply -f ${p}`,
    };
  }

  async file(
    id: string,
    rawPath: unknown,
    res?: { setHeader(k: string, v: string): void },
  ) {
    await this.ready;
    this.requireReadable();
    const path = this.assertPath(rawPath);
    const a = await this.fresh(id);
    let cur: { bytes: Buffer; mtimeMs: number } | null;
    try {
      cur = await this.backend!.readFile(id, path);
    } catch (err) {
      this.mapBackendError(err, { id, path });
    }
    if (!cur)
      throw resourceNotFound(
        { kind: 'K8sSnapshotFile', id, path },
        '파일이 없습니다.',
      );
    const version = sha256Version(cur.bytes);
    const truncated = cur.bytes.length > this.cfg.viewMax;
    const shown = truncateAtLine(cur.bytes, this.cfg.viewMax);
    const facts = textFacts(cur.bytes);
    const f = a.files.find((x) => x.path === path);
    const fileType = f?.fileType ?? this.rules!.classifyPath(path)!.type;
    res?.setHeader('ETag', `"${version}"`);
    res?.setHeader('Cache-Control', 'no-store');
    const factForEdit: K8sFileFact | undefined = f
      ? {
          ...f,
          sizeBytes: cur.bytes.length,
          encoding: facts.utf8 ? 'utf-8' : 'unknown',
          eol: facts.eol,
        }
      : undefined;
    return {
      ...this.envelope(),
      snapshotId: id,
      path,
      fileType,
      resource: f?.resource ?? null,
      content: toLfText(shown),
      version,
      sizeBytes: cur.bytes.length,
      lineCount: facts.lineCount,
      eol: facts.eol,
      bom: facts.bom,
      encoding: facts.utf8 ? 'utf-8' : 'unknown',
      indent: facts.indent,
      modifiedAt: new Date(cur.mtimeMs).toISOString(),
      truncated,
      returnedBytes: shown.length,
      editable: truncated
        ? block('FILE_TOO_LARGE', BLOCK_TEXT.FILE_TOO_LARGE)
        : factForEdit
          ? this.fileEditable(a, factForEdit)
          : block('FILE_KIND_READ_ONLY', BLOCK_TEXT.FILE_KIND_READ_ONLY),
      findings: a.scan.findings.filter((x) => x.file === path),
      commands: this.commandsFor(id, path, fileType),
    };
  }

  async scanRules() {
    await this.ready;
    if (!this.scanner) this.requireReadableStrict();
    return {
      ...this.envelope(),
      profile: 'k8s',
      allowMarker: this.scanner.allowMarker,
      scannableExtensions: this.scanner.scannableExtensions,
      rules: this.scanner.listRules({ profile: 'k8s' }),
    };
  }

  async driftRules() {
    await this.ready;
    if (!this.rules) this.requireReadableStrict();
    const r = this.rules;
    const kubeState = this.clusterSource.state().source;
    const informer = (id: string) => {
      if (this.mode === 'mock') return 'mock';
      if (kubeState === 'not_configured' || kubeState === 'unavailable')
        return 'not_configured';
      return this.clusterSource.kindState(id);
    };
    const condText: Record<string, string> = {
      hpaTarget: 'HPA의 scaleTargetRef가 이 워크로드',
      always: '항상',
      clusterGreater: '클러스터 값이 스냅샷 값보다 큼 (작아졌으면 변경)',
      snapshotAbsent: '스냅샷에 없음',
    };
    const whenText: Record<string, string> = {
      imagePullPolicy:
        '이미지 태그가 latest·없음이면 Always, 그 밖은 IfNotPresent',
      sameAsServiceAccountName: 'serviceAccountName 과 같은 값',
      singleIpFamily: '원소 하나짜리 목록 (["IPv4"] 또는 ["IPv6"])',
      targetPortEqualsPort: '같은 항목의 port 와 같은 값',
    };
    return {
      ...this.envelope(),
      rulesVersion: r.CLEANUP_RULES_VERSION,
      comparableKinds: COMPARABLE_KINDS.map((k) => ({
        id: k.id,
        apiGroup: k.apiGroup,
        apiVersion: k.apiVersion,
        kind: k.kind,
        rbacResource: k.rbacResource,
        informer: informer(k.id),
      })),
      uncomparableNote:
        'ConfigMap, ServiceAccount, Role, RoleBinding, NetworkPolicy, CronJob, Job, ResourceQuota, LimitRange, 클러스터 범위 종류, 사용자 지정 리소스는 대시보드 권한 밖이라 비교하지 않습니다',
      cleanup: [...(r.RULESETS[r.CLEANUP_RULES_VERSION]?.summary ?? [])],
      defaults: r.DEFAULTS.map((d) => ({
        kinds: d.kinds,
        path: d.path,
        value: d.value ?? null,
        note: d.when ? whenText[d.when] : null,
      })),
      managed: r.MANAGED_FIELDS.map((m) => ({
        id: m.id,
        kinds: m.kinds,
        path: m.path,
        reason: m.reason,
        condition:
          m.condition === 'snapshotAbsent' && m.clusterValue !== undefined
            ? `스냅샷에 없고 클러스터 값이 ${JSON.stringify(m.clusterValue)}`
            : condText[m.condition],
      })),
      masked: [...r.MASKED_PATHS, '스캐너 규칙에 걸리는 값'],
    };
  }

  async refreshNow() {
    await this.ready;
    await this.refresh();
    return this.getSummary();
  }

  // ------------------------------------------------------------------ 편집

  private async runCheck(id: string, path: string, content: string) {
    const cls = this.rules!.classifyPath(path)!;
    if (!EDITABLE_TYPES.has(cls.type))
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SNAPSHOT_FILE_NOT_EDITABLE',
        '이 파일은 편집할 수 없습니다.',
        {
          reasonCode: 'FILE_KIND_READ_ONLY',
        },
      );
    if (content.includes('\u0000'))
      throw validationFailed([
        {
          field: 'content',
          value: undefined,
          constraints: ['content must not contain NUL'],
        },
      ]);
    const a = await this.fresh(id);
    let cur: { bytes: Buffer; mtimeMs: number } | null;
    try {
      cur = await this.backend!.readFile(id, path);
    } catch (err) {
      this.mapBackendError(err, { id, path });
    }
    if (!cur)
      throw resourceNotFound(
        { kind: 'K8sSnapshotFile', id, path },
        '파일이 없습니다.',
      );
    const facts = textFacts(cur.bytes);
    const fileBlock = [
      cur.bytes.length > this.cfg.editMax ? 'FILE_TOO_LARGE' : null,
      !facts.utf8 ? 'NOT_UTF8' : null,
      facts.eol === 'mixed' ? 'MIXED_LINE_ENDINGS' : null,
    ].find((x) => x !== null);
    if (fileBlock)
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SNAPSHOT_FILE_NOT_EDITABLE',
        BLOCK_TEXT[fileBlock as K8sWriteBlockCode],
        { reasonCode: fileBlock },
      );
    const lf = content.replace(/\r\n/g, '\n');
    const bytes = restoreFormat(lf, {
      eol: facts.eol === 'crlf' ? 'crlf' : 'lf',
      bom: facts.bom,
    });
    if (bytes.length > this.cfg.editMax)
      throw new ApiException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'SNAPSHOT_FILE_TOO_LARGE',
        `편집 상한(${this.cfg.editMax} bytes)을 넘었습니다.`,
        { maxBytes: this.cfg.editMax, sizeBytes: bytes.length },
      );
    const text = decodeLikeCli(bytes);
    const fileFindings: K8sScanFinding[] = sortK8sFindings(
      this.scanner!.scanText(text, path, { profile: 'k8s' }).map((x) => ({
        file: x.file,
        fileType: cls.type,
        line: x.line,
        rule: x.rule,
        severity: x.severity,
        message: x.message,
      })),
    );
    const errors = fileFindings.filter((x) => x.severity === 'error').length;
    const warnings = fileFindings.length - errors;
    const body = lf.replace(/^\uFEFF/, '');
    const syntaxErrors = yamlErrors(body);
    const parsed = syntaxErrors.length
      ? { docs: [] as unknown[] }
      : parseYamlDocs(body);
    const expected = expectedOf(this.rules!, cls);
    const actual = parsed.docs.length
      ? identityOf(this.rules!, parsed.docs[0])
      : null;
    const runtimeFields = [
      ...new Set(parsed.docs.flatMap((d) => this.rules!.findRuntimeFields(d))),
    ].slice(0, 10);
    const merged = [
      ...a.scan.findings.filter((x) => x.file !== path),
      ...fileFindings,
    ];
    const snapshotScanAfter: ScanSummary = summarizeK8s(
      this.scanner!,
      merged,
      a.scan.summary.strict,
    );
    const matches = actual ? identityMatches(actual, expected) : null;
    const confirmationsRequired: ConfirmValue[] = [];
    if (errors > 0) confirmationsRequired.push('secret_errors');
    if (syntaxErrors.length > 0) confirmationsRequired.push('yaml_syntax');
    if (parsed.docs.length >= 2) confirmationsRequired.push('multi_document');
    if (matches === false) confirmationsRequired.push('identity_changed');
    return {
      a,
      cur,
      bytes,
      check: {
        findings: fileFindings,
        errors,
        warnings,
        syntax: { checked: true, errors: syntaxErrors },
        documents: parsed.docs.length,
        identity: { expected, actual, matches },
        runtimeFields,
        unchanged: bytes.equals(cur.bytes),
        snapshotScanAfter,
        confirmationsRequired,
      },
    };
  }

  async check(id: string, rawPath: unknown, content: string) {
    await this.ready;
    this.requireReadable();
    const path = this.assertPath(rawPath);
    const r = await this.runCheck(id, path, content);
    return { ...this.envelope(), snapshotId: id, path, check: r.check };
  }

  async save(
    id: string,
    rawPath: unknown,
    body: { content: string; baseVersion: string; confirm?: string[] },
  ) {
    await this.ready;
    this.requireReadable();
    const path = this.assertPath(rawPath);
    this.requireWritable();
    const cls = this.rules!.classifyPath(path)!;
    if (!EDITABLE_TYPES.has(cls.type))
      return this.runCheck(id, path, body.content) as never; // 403
    const pre = await this.fresh(id);
    if (pre.inProgress)
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SNAPSHOT_EXPORT_IN_PROGRESS',
        '내보내기 진행 중일 수 있어 저장할 수 없습니다.',
      );
    const r = await this.runCheck(id, path, body.content);
    const curVersion = sha256Version(r.cur.bytes);
    if (this.consumeMockConflict() || curVersion !== body.baseVersion)
      throw this.conflict(
        path,
        curVersion,
        new Date(r.cur.mtimeMs).toISOString(),
      );
    const confirmed = new Set(body.confirm ?? []);
    const missing = r.check.confirmationsRequired.filter(
      (c) => !confirmed.has(c),
    );
    if (missing.length) {
      const parts: string[] = [];
      if (missing.includes('secret_errors'))
        parts.push(`비밀값 의심 ${r.check.errors}건`);
      if (missing.includes('yaml_syntax'))
        parts.push(`YAML 구문 오류 ${r.check.syntax.errors.length}건`);
      if (missing.includes('multi_document'))
        parts.push(`한 파일에 여러 리소스 (${r.check.documents}개)`);
      if (missing.includes('identity_changed')) {
        const e = r.check.identity.expected;
        const x = r.check.identity.actual;
        const field =
          e && x
            ? x.name !== e.name
              ? 'metadata.name'
              : x.namespace !== e.namespace
                ? 'metadata.namespace'
                : 'kind'
            : '식별값';
        parts.push(`경로와 내용 불일치(${field})`);
      }
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'SNAPSHOT_CONFIRMATION_REQUIRED',
        `저장하려면 확인이 필요합니다: ${parts.join(', ')}`,
        { missing, check: r.check },
      );
    }
    const before = {
      errors: r.a.scan.summary.errors,
      warnings: r.a.scan.summary.warnings,
    };
    const prevOf = () => this.previousMap(this.analyses()).get(id);
    if (r.check.unchanged) {
      return {
        ...this.envelope(),
        saved: false,
        snapshotId: id,
        path,
        version: curVersion,
        modifiedAt: new Date(r.cur.mtimeMs).toISOString(),
        sizeBytes: r.cur.bytes.length,
        check: r.check,
        rescan: { before, after: before },
        snapshot: this.listItem(r.a, prevOf()),
        driftRecompute: 'none',
        revision: this.revision,
      };
    }
    let written: { mtimeMs: number };
    try {
      written = await this.backend!.writeFileAtomic(
        id,
        path,
        r.bytes,
        body.baseVersion,
      );
    } catch (err) {
      if (err instanceof BackendError && err.code === 'VERSION_CONFLICT') {
        const now = await this.backend!.readFile(id, path).catch(() => null);
        throw this.conflict(
          path,
          now ? sha256Version(now.bytes) : null,
          now ? new Date(now.mtimeMs).toISOString() : null,
        );
      }
      this.mapBackendError(err, { id, path });
    }
    const newVersion = sha256Version(r.bytes);
    await this.recordFileEdit(id, path, newVersion, written.mtimeMs, r.a);
    this.logger.log(
      `k8s 스냅샷 파일 저장 id=${id} path=${path} bytes=${r.bytes.length}`,
    );
    const driftRecompute = this.drift.willRecompute(id) ? 'scheduled' : 'none';
    const a = await this.fresh(id);
    this.syncDrift();
    this.pending.changed.add(id);
    this.bump();
    return {
      ...this.envelope(),
      saved: true,
      snapshotId: id,
      path,
      version: newVersion,
      modifiedAt: new Date(written.mtimeMs).toISOString(),
      sizeBytes: r.bytes.length,
      check: r.check,
      rescan: {
        before,
        after: {
          errors: a.scan.summary.errors,
          warnings: a.scan.summary.warnings,
        },
      },
      snapshot: this.listItem(a, prevOf()),
      driftRecompute,
      revision: this.revision,
    };
  }

  /** notes.json fileEdits 갱신 (실패해도 저장은 성공). 더는 없는 경로 항목은 지운다 */
  private async recordFileEdit(
    id: string,
    path: string,
    version: string,
    mtimeMs: number,
    a: K8sAnalysis,
  ) {
    try {
      const cur = await this.backend!.readFile(id, NOTES_FILE);
      const notes = parseNotes(cur?.bytes ?? null);
      if (notes.corrupt) return;
      const base: Obj = notes.raw ?? {
        schemaVersion: 1,
        tool: 'sentinel dashboard',
        snapshotId: id,
        label: '',
        memo: '',
        updatedAt: null,
      };
      const known = new Set(a.files.map((f) => f.path));
      const edits: Obj = {};
      if (isObj(base.fileEdits))
        for (const [p, v] of Object.entries(base.fileEdits))
          if (known.has(p)) edits[p] = v;
      edits[path] = { savedAt: new Date(mtimeMs).toISOString(), version };
      const next = { ...base, fileEdits: edits };
      await this.backend!.writeFileAtomic(
        id,
        NOTES_FILE,
        Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'),
        cur ? sha256Version(cur.bytes) : 'absent',
      );
    } catch (err) {
      this.logger.warn(
        `notes.json fileEdits 기록 실패 id=${id} (${err instanceof BackendError ? err.code : 'ERROR'})`,
      );
    }
  }

  async saveNotes(id: string, body: K8sNotesDto) {
    await this.ready;
    this.requireReadable();
    const marker = this.scanner!.allowMarker;
    const bad = (['label', 'memo'] as const).filter((k) =>
      body[k].includes(marker),
    );
    if (bad.length)
      throw validationFailed(
        bad.map((field) => ({
          field,
          value: undefined,
          constraints: [`${field} must not contain "${marker}"`],
        })),
      );
    this.requireWritable();
    const a = await this.fresh(id);
    if (a.inProgress)
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SNAPSHOT_EXPORT_IN_PROGRESS',
        '내보내기 진행 중일 수 있어 저장할 수 없습니다.',
      );
    if (a.notes.corrupt)
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SNAPSHOT_NOTES_CORRUPT',
        BLOCK_TEXT.NOTES_CORRUPT,
      );
    if (this.consumeMockConflict() || a.notes.version !== body.baseVersion)
      throw this.conflict('notes', a.notes.version, a.notes.updatedAt);
    const memo = body.memo.replace(/\r\n/g, '\n');
    const fields: string[] = [];
    const rules = new Set<string>();
    for (const [field, text] of [
      ['label', body.label],
      ['memo', memo],
    ] as const) {
      const errs = this.scanner!.scanText(text, field, {
        profile: 'k8s',
      }).filter((f) => f.severity === 'error');
      if (errs.length) {
        fields.push(field);
        errs.forEach((e) => rules.add(e.rule));
      }
    }
    if (fields.length) {
      const list = [...rules].sort();
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'SNAPSHOT_NOTES_SECRET_DETECTED',
        `라벨·메모에 비밀값으로 보이는 내용이 있어 저장하지 않았습니다 (${list.join(', ')})`,
        { fields, rules: list },
      );
    }
    const now = new Date().toISOString();
    const rest = { ...(a.notes.raw ?? {}) };
    for (const k of [
      'schemaVersion',
      'tool',
      'snapshotId',
      'label',
      'memo',
      'updatedAt',
    ])
      delete rest[k];
    const obj = {
      schemaVersion: 1,
      tool: 'sentinel dashboard',
      snapshotId: id,
      label: body.label,
      memo,
      updatedAt: now,
      ...rest,
    };
    try {
      await this.backend!.writeFileAtomic(
        id,
        NOTES_FILE,
        Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, 'utf8'),
        a.notes.fileVersion ?? 'absent',
      );
    } catch (err) {
      if (err instanceof BackendError && err.code === 'VERSION_CONFLICT') {
        const n = await this.fresh(id);
        throw this.conflict('notes', n.notes.version, n.notes.updatedAt);
      }
      this.mapBackendError(err, { id });
    }
    this.logger.log(`k8s 스냅샷 라벨·메모 저장 id=${id}`);
    const next = await this.fresh(id);
    this.pending.changed.add(id);
    this.bump();
    return {
      ...this.envelope(),
      notes: {
        label: next.notes.label,
        memo: next.notes.memo,
        updatedAt: next.notes.updatedAt,
        version: next.notes.version,
        fileExists: next.notes.fileExists,
      },
      snapshot: this.listItem(next, this.previousMap(this.analyses()).get(id)),
      revision: this.revision,
    };
  }

  // ------------------------------------------------------------------ 휴지통

  private trashView(t: K8sTrashItem) {
    const notes = parseNotes(t.notes);
    let cluster: { context: string | null; name: string | null } | null = null;
    if (t.metadata) {
      try {
        const m = JSON.parse(t.metadata.toString('utf8')) as {
          cluster?: { context?: unknown; name?: unknown };
        };
        if (isObj(m.cluster))
          cluster = {
            context:
              typeof m.cluster.context === 'string' ? m.cluster.context : null,
            name: typeof m.cluster.name === 'string' ? m.cluster.name : null,
          };
      } catch {
        cluster = null;
      }
    }
    const g = this.globalWrite();
    const exists = this.cache.has(t.snapshotId);
    return {
      trashId: t.trashId,
      snapshotId: t.snapshotId,
      snapshotAt: snapshotIdToIso(t.snapshotId),
      deletedAt: compactStampToIso(TRASH_ID_RE.exec(t.trashId)![2]),
      label: notes.label,
      cluster,
      files: t.topNames.slice(0, 50),
      fileCount: t.fileCount,
      sizeBytes: t.sizeBytes,
      restore: !g.allowed
        ? g
        : exists
          ? block('SNAPSHOT_ID_EXISTS', BLOCK_TEXT.SNAPSHOT_ID_EXISTS)
          : OK,
    };
  }

  private async trashItems() {
    if (!this.sourceUsable() || !this.backend) return [];
    const raw = await this.backend.listTrash();
    return raw
      .map((t) => this.trashView(t))
      .sort((x, y) => ((x.deletedAt ?? '') < (y.deletedAt ?? '') ? 1 : -1));
  }

  async listTrash() {
    await this.ready;
    const items = await this.trashItems();
    return {
      ...this.envelope(),
      total: items.length,
      filteredTotal: items.length,
      offset: 0,
      limit: null,
      items,
    };
  }

  async moveToTrash(id: string, confirm: string) {
    await this.ready;
    if (confirm !== id)
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'SNAPSHOT_CONFIRM_MISMATCH',
        '확인용 스냅샷 ID가 일치하지 않습니다.',
      );
    this.requireReadable();
    this.requireWritable();
    const a = await this.fresh(id);
    if (a.inProgress)
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SNAPSHOT_EXPORT_IN_PROGRESS',
        '내보내기 진행 중일 수 있어 삭제할 수 없습니다.',
      );
    const trashId = `${id}__${compactStamp(Date.now())}`;
    try {
      await this.backend!.moveToTrash(id, trashId);
    } catch (err) {
      this.mapBackendError(err, { id });
    }
    this.logger.log(`k8s 스냅샷 휴지통 이동 id=${id} trashId=${trashId}`);
    this.cache.delete(id);
    this.tracker.forget(id);
    this.pending.removed.add(id);
    this.pending.trash = true;
    this.trashCount++;
    this.syncDrift();
    this.bump();
    const items = await this.trashItems();
    return {
      ...this.envelope(),
      trashItem: items.find((t) => t.trashId === trashId) ?? null,
      summary: this.buildSummary(),
      revision: this.revision,
    };
  }

  private trashIdParts(trashId: string): string {
    const m = TRASH_ID_RE.exec(trashId);
    if (!m)
      throw validationFailed([
        { field: 'trashId', value: undefined, constraints: ['trashId format'] },
      ]);
    return m[1];
  }

  async restore(trashId: string) {
    await this.ready;
    const snapshotId = this.trashIdParts(trashId);
    this.requireReadable();
    this.requireWritable();
    try {
      await this.backend!.restore(trashId, snapshotId);
    } catch (err) {
      this.mapBackendError(err, { trashId });
    }
    this.logger.log(`k8s 스냅샷 복원 trashId=${trashId}`);
    this.trashCount = Math.max(0, this.trashCount - 1);
    this.pending.trash = true;
    const a = await this.fresh(snapshotId);
    this.syncDrift();
    this.pending.changed.add(snapshotId);
    this.bump();
    return {
      ...this.envelope(),
      snapshot: this.listItem(
        a,
        this.previousMap(this.analyses()).get(snapshotId),
      ),
      revision: this.revision,
    };
  }

  async purge(trashId: string, confirm: string) {
    await this.ready;
    const snapshotId = this.trashIdParts(trashId);
    if (confirm !== snapshotId)
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'SNAPSHOT_CONFIRM_MISMATCH',
        '확인용 스냅샷 ID가 일치하지 않습니다.',
      );
    this.requireReadable();
    this.requireWritable();
    try {
      await this.backend!.purge(trashId);
    } catch (err) {
      this.mapBackendError(err, { trashId });
    }
    this.logger.log(`k8s 스냅샷 영구 삭제 trashId=${trashId}`);
    this.trashCount = Math.max(0, this.trashCount - 1);
    this.pending.trash = true;
    this.bump();
    return {
      ...this.envelope(),
      purged: true,
      trashId,
      revision: this.revision,
    };
  }

  // ------------------------------------------------------------------ 3D 구성 그래프

  /**
   * GET /:id/graph (docs/api/snapshot-3d.md 2절).
   * 조회 전용: 파일을 다시 읽지 않고(분석 캐시), 드리프트를 계산하지 않는다(기존 결과만 겹침).
   */
  async graph(id: string, q: { rules?: string[]; drift?: string }) {
    await this.ready;
    this.requireReadable();
    const a = await this.fresh(id);
    const enabled = q.rules?.length ? new Set(q.rules as RuleId[]) : undefined;
    const g = this.graphSvc.build(a, this.rules!, {
      rules: enabled,
      drift: q.drift !== 'off',
    });
    return {
      ...this.envelope(),
      revision: this.revision,
      snapshotId: id,
      graph: {
        ...g,
        snapshotStatus: this.statusInfo(a),
        cluster: a.cluster
          ? { ...a.cluster, relation: this.drift.relation(a) }
          : null,
      },
    };
  }

  // ------------------------------------------------------------------ 드리프트

  async getDrift(id: string) {
    await this.ready;
    this.requireReadable();
    const a = await this.fresh(id);
    return { ...this.envelope(), ...this.drift.view(a) };
  }

  async requestDrift(id: string, force: boolean) {
    await this.ready;
    this.requireReadable();
    const a = await this.fresh(id);
    return { ...this.envelope(), ...this.drift.request(a, force) };
  }

  /** 메뉴 합산 (12절) */
  menuTab() {
    const s = this.buildSummary();
    return {
      included: this.effectiveState() !== 'not_configured',
      sourceState: this.effectiveState(),
      status: s.status,
      critical: s.counts.critical,
      warning: s.counts.warning,
      unknown: s.counts.unknown,
      latestDrift: s.latestDrift,
    };
  }
}
