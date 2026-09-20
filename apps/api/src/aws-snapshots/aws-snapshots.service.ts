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
import { Observable, Subject } from 'rxjs';
import { parseAllDocuments } from 'yaml';
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
import {
  analyzeSnapshot,
  parseNotes,
  sortFindings,
  summarizeFindings,
  type Analysis,
  type ResourceCounts,
  type ScanFinding,
  type ScanSummary,
} from './analyzer';
import {
  BackendError,
  type RawTrashItem,
  type SnapshotBackend,
} from './backend';
import type { NotesDto, SnapshotListQueryDto } from './dto';
import { FsBackend } from './fs-backend';
import { cloneTree, MemoryBackend, type MemTree } from './memory-backend';
import { buildEmptyTree, buildMockTree } from './mock-fixtures';
import {
  defaultLibDir,
  loadScanner,
  type SnapshotScanner,
} from './scanner-loader';
import {
  CLI_COMMANDS,
  compactStamp,
  compactStampToIso,
  EDITABLE_KINDS,
  FILE_KINDS,
  FILE_NAME,
  LABEL_MAX,
  MEMO_MAX,
  MOCK_SCENARIOS,
  NOTES_FILE,
  SETUP_HINT,
  snapshotIdToIso,
  TRASH_ID_RE,
  VIEW_MIN_BYTES,
  type ConfirmValue,
  type FileKind,
  type SnapshotMockScenario,
} from './snapshot.constants';
import {
  decodeLikeCli,
  restoreFormat,
  sha256Version,
  toLfText,
  truncateAtLine,
} from './text-utils';

export const TOPIC = 'aws-snapshots';

export type WriteBlockCode =
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
  reasonCode: WriteBlockCode | null;
  reasonText: string | null;
}

const OK: WriteAbility = { allowed: true, reasonCode: null, reasonText: null };
const block = (code: WriteBlockCode, text: string): WriteAbility => ({
  allowed: false,
  reasonCode: code,
  reasonText: text,
});

const BLOCK_TEXT: Record<WriteBlockCode, string> = {
  WRITE_DISABLED: '쓰기 기능이 꺼져 있습니다 (AWS_SNAPSHOT_WRITE_ENABLED)',
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

const MOCK_OPTIONS: {
  id: SnapshotMockScenario;
  label: string;
  description: string;
}[] = [
  {
    id: 'default',
    label: '예시 스냅샷 (기본)',
    description: '정상·주의·커밋 금지·알 수 없음·큰 파일 9개 + 휴지통 1개',
  },
  { id: 'empty', label: '스냅샷 0개', description: '빈 상태 + CLI 안내' },
  {
    id: 'unavailable',
    label: '폴더 없음',
    description: '스냅샷 폴더를 찾을 수 없음',
  },
  {
    id: 'not-configured',
    label: '설정 없음',
    description: 'AWS_SNAPSHOT_DIR 설정 없음',
  },
  { id: 'read-only', label: '읽기 전용', description: '편집·라벨·삭제 비활성' },
  {
    id: 'write-disabled',
    label: '쓰기 기능 꺼짐',
    description: '편집·라벨·삭제 비활성',
  },
  {
    id: 'conflict-once',
    label: '다음 저장 충돌',
    description: '다음 저장 한 번을 409로 응답 후 기본으로 복귀',
  },
];

interface Config {
  dir: string | null;
  libDir: string;
  writeEnabled: boolean;
  inProgressMin: number;
  editMax: number;
  viewMax: number;
  pollSec: number;
  displayPath: string | null;
}

interface CacheEntry {
  fp: string;
  a: Analysis;
}

/**
 * aws-snapshot-manager (docs/api/aws-snapshot-manager.md).
 * 로컬 스냅샷 폴더만 읽고 쓴다. AWS·쿠버네티스·DB·git·CLI 실행 없음. PrismaService 비의존.
 */
@Injectable()
@TopicSourceProvider()
@MockScenarioTargetProvider()
export class AwsSnapshotsService
  implements
    OnApplicationBootstrap,
    OnModuleDestroy,
    TopicSource,
    MockScenarioTarget
{
  readonly topic = TOPIC;
  readonly group = 'snapshots' as const;
  readonly scenarios = MOCK_SCENARIOS;
  readonly options = MOCK_OPTIONS;
  readonly defaultScenario = 'default';

  private readonly logger = new Logger(AwsSnapshotsService.name);
  private readonly cfg: Config;
  private scanner: SnapshotScanner | null = null;
  private backend: SnapshotBackend | null = null;
  private mockTree: MemTree | null = null;
  private mockBackend: MemoryBackend | null = null;
  private emptyBackend: MemoryBackend | null = null;
  private scenario: SnapshotMockScenario = 'default';

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

  private readonly events = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.events.asObservable();
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

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly registry: SourceRegistry,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    const view = config.get('AWS_SNAPSHOT_VIEW_MAX_BYTES', { infer: true });
    const dir = config.get('AWS_SNAPSHOT_DIR', { infer: true });
    this.cfg = {
      dir: dir ? resolve(dir) : null,
      libDir:
        config.get('AWS_SNAPSHOT_LIB_DIR', { infer: true }) ?? defaultLibDir(),
      writeEnabled: config.get('AWS_SNAPSHOT_WRITE_ENABLED', { infer: true }),
      inProgressMin: config.get('AWS_SNAPSHOT_IN_PROGRESS_MIN', {
        infer: true,
      }),
      editMax: config.get('AWS_SNAPSHOT_EDIT_MAX_BYTES', { infer: true }),
      viewMax: Math.max(view, VIEW_MIN_BYTES),
      pollSec: config.get('AWS_SNAPSHOT_POLL_INTERVAL_SEC', { infer: true }),
      displayPath:
        config.get('AWS_SNAPSHOT_DISPLAY_PATH', { infer: true }) ?? dir ?? null,
    };
    this.rootState = mode === 'mock' ? 'mock' : 'syncing';
  }

  get editMaxBytes(): number {
    return this.cfg.editMax;
  }

  // ------------------------------------------------------------------ 시작·주기

  onApplicationBootstrap(): void {
    this.ready = this.init();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** 테스트·컨트롤러가 초기화 완료를 기다릴 때 */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private async init(): Promise<void> {
    if (this.mode === 'live' && !this.cfg.dir) {
      this.rootState = 'not_configured';
      this.registry.update('snapshotStore', {
        state: 'not_configured',
        error: null,
      });
      return;
    }
    try {
      this.scanner = await loadScanner(this.cfg.libDir);
    } catch (err) {
      const msg = `스캐너를 불러올 수 없습니다 (AWS_SNAPSHOT_LIB_DIR)`;
      this.logger.warn(
        `${msg}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.rootState = 'unavailable';
      this.rootError = { code: 'SCANNER_UNAVAILABLE', message: msg };
      this.registry.markFailure('snapshotStore', this.rootError, {
        state: 'unavailable',
      });
      return;
    }
    if (this.mode === 'mock') {
      this.buildMock();
    } else {
      this.backend = new FsBackend(
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
  }

  private buildMock(): void {
    this.mockTree = cloneTree(buildMockTree());
    this.mockBackend = new MemoryBackend(
      this.mockTree,
      this.scanner!.scannableExtensions,
    );
    this.emptyBackend = new MemoryBackend(
      buildEmptyTree(),
      this.scanner!.scannableExtensions,
    );
    this.backend =
      this.scenario === 'empty' ? this.emptyBackend : this.mockBackend;
  }

  /** 주기 확인·수동 새로고침. 진행 중이면 그것이 끝난 뒤 한 번 더 확인한다 */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
      return this.refreshing;
    }
    // 진행 중인 확인은 바뀌기 전 상태(예: mock 재설정 전 저장소)를 읽고 있을 수 있다 →
    // 끝난 뒤 한 번 더 확인한다 (여러 번 불려도 한 번만 덧붙인다)
    this.queued ??= this.refreshing.then(() => {
      this.queued = null;
      return this.refresh();
    });
    return this.queued;
  }

  private analyze(raw: Parameters<typeof analyzeSnapshot>[0]): Analysis {
    return analyzeSnapshot(raw, this.scanner!, {
      nowMs: Date.now(),
      inProgressMinutes: this.cfg.inProgressMin,
    });
  }

  private async doRefresh(): Promise<void> {
    const backend = this.backend;
    if (!backend || !this.scanner) return;
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
        if (await this.refreshEntry(id)) changed = true;
      }
      const trash = await backend.listTrash();
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
      this.registry.markSuccess('snapshotStore', this.lastCheckedAt);
    } catch (err) {
      changed = this.onRefreshFailure(err, nowMs) || changed;
    }
    if (changed) this.bump();
  }

  /** 한 스냅샷 지문 비교 후 바뀌었으면 다시 분석. 바뀌었으면 true */
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
    // metadata 없음: 시간이 지나면 판단(진행 중 ↔ 없음)이 바뀌므로 매번 다시 분석
    if (cur && cur.fp === fp && cur.a.metadata.state !== 'missing')
      return false;
    const raw = await backend.readSnapshot(id);
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
      this.registry.markFailure('snapshotStore', this.rootError, {
        state: 'unavailable',
      });
    } else {
      this.rootError = {
        code: code === 'ROOT_UNREADABLE' ? 'ROOT_UNREADABLE' : 'READ_FAILED',
        message: `스냅샷 폴더를 읽을 수 없습니다 (${errno ?? 'EIO'})`,
      };
      if (this.lastSuccessMs === null) {
        this.rootState = 'unavailable';
        this.registry.markFailure('snapshotStore', this.rootError, {
          state: 'unavailable',
        });
      } else if (nowMs - this.lastSuccessMs >= 90_000) {
        this.rootState = 'stale';
        this.registry.markFailure('snapshotStore', this.rootError, {
          state: 'stale',
        });
      }
      this.logger.warn(`스냅샷 폴더 확인 실패 (${errno ?? code})`);
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
    this.events.next({ event: `${TOPIC}.changed`, data: payload });
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
    void this.snapshot().then((evs) => evs.forEach((e) => this.events.next(e)));
  }

  // ------------------------------------------------------------------ mock 시나리오

  currentScenario(): string {
    return this.scenario;
  }

  setScenario(name: string): void {
    if (!(MOCK_SCENARIOS as readonly string[]).includes(name))
      throw new Error(`unknown scenario ${name}`);
    this.scenario = name as SnapshotMockScenario;
    if (this.mode !== 'mock' || !this.mockBackend) return;
    const next = name === 'empty' ? this.emptyBackend! : this.mockBackend;
    if (next !== this.backend) {
      this.backend = next;
      this.cache.clear();
      this.tracker.clear();
      this.trashCount = 0;
      this.unrecognized = [];
    }
    this.revision++;
    void this.refresh().then(() => this.emitSnapshot());
  }

  resetData(): void {
    if (this.mode !== 'mock' || !this.scanner) return;
    this.buildMock();
    this.cache.clear();
    this.tracker.clear();
    this.trashCount = 0;
    this.unrecognized = [];
    this.revision++;
    void this.refresh().then(() => this.emitSnapshot());
  }

  /** mock 시나리오로 보정한 출처 상태 */
  private effectiveState(): SourceState {
    if (this.mode === 'mock') {
      if (this.rootState !== 'mock') return this.rootState; // 스캐너 없음
      if (this.scenario === 'not-configured') return 'not_configured';
      if (this.scenario === 'unavailable') return 'unavailable';
      return 'mock';
    }
    return this.rootState;
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

  private actions(a: Analysis) {
    const g = this.globalWrite();
    const inProg = a.inProgress
      ? block('EXPORT_MAYBE_IN_PROGRESS', BLOCK_TEXT.EXPORT_MAYBE_IN_PROGRESS)
      : OK;
    const first = (...list: WriteAbility[]) =>
      list.find((x) => !x.allowed) ?? OK;
    return {
      editTemplates: first(g, inProg),
      editNotes: first(
        g,
        inProg,
        a.notes.corrupt ? block('NOTES_CORRUPT', BLOCK_TEXT.NOTES_CORRUPT) : OK,
      ),
      delete: first(g, inProg),
    };
  }

  private fileEditable(a: Analysis, kind: FileKind): WriteAbility {
    const f = a.files[kind];
    const snap = this.actions(a).editTemplates;
    if (!snap.allowed) return snap;
    if (!EDITABLE_KINDS.includes(kind))
      return block('FILE_KIND_READ_ONLY', BLOCK_TEXT.FILE_KIND_READ_ONLY);
    if (!f.exists) return block('FILE_MISSING', BLOCK_TEXT.FILE_MISSING);
    if (f.readError)
      return block('FILE_UNREADABLE', BLOCK_TEXT.FILE_UNREADABLE);
    if ((f.sizeBytes ?? 0) > this.cfg.editMax)
      return block('FILE_TOO_LARGE', BLOCK_TEXT.FILE_TOO_LARGE);
    if (f.encoding !== 'utf-8') return block('NOT_UTF8', BLOCK_TEXT.NOT_UTF8);
    if (f.eol === 'mixed')
      return block('MIXED_LINE_ENDINGS', BLOCK_TEXT.MIXED_LINE_ENDINGS);
    return OK;
  }

  private statusInfo(a: Analysis): StatusInfo {
    return {
      status: a.status,
      reasons: a.reasons,
      updatedAt: a.analyzedAt,
      statusChangedAt: this.tracker.track(a.id, a.status, a.analyzedAt),
      stale: this.effectiveState() === 'stale',
    };
  }

  private analyses(): Analysis[] {
    if (!this.sourceUsable()) return [];
    return [...this.cache.values()].map((c) => c.a);
  }

  /** 같은 region의 바로 이전 스냅샷 */
  private previousMap(list: Analysis[]): Map<string, Analysis> {
    const out = new Map<string, Analysis>();
    const last = new Map<string, Analysis>();
    for (const a of [...list].sort((x, y) => (x.id < y.id ? -1 : 1))) {
      if (!a.region) continue;
      const p = last.get(a.region);
      if (p) out.set(a.id, p);
      last.set(a.region, a);
    }
    return out;
  }

  private listItem(a: Analysis, prev: Analysis | undefined) {
    const cur = a.resources.current;
    const delta = (k: keyof ResourceCounts): number | null => {
      const p = prev?.resources.current[k];
      return cur[k] === null || p === null || p === undefined
        ? null
        : cur[k] - p;
    };
    const atExport = a.resources.atExport;
    return {
      id: a.id,
      snapshotAt: a.snapshotAt,
      status: this.statusInfo(a),
      label: a.notes.label,
      memo: a.notes.memo,
      notesUpdatedAt: a.notes.updatedAt,
      region: a.region,
      scope: a.scope,
      resources: {
        current: cur,
        atExport,
        changedSinceExport:
          atExport !== null &&
          (atExport.cloudformation !== cur.cloudformation ||
            atExport.terraform !== cur.terraform),
        previous: prev
          ? { snapshotId: prev.id, counts: prev.resources.current }
          : null,
        delta: prev
          ? {
              cloudformation: delta('cloudformation'),
              terraform: delta('terraform'),
            }
          : null,
      },
      scan: a.scan.summary,
      lastModifiedAt: a.lastModifiedAt,
      modifiedByDashboard: a.modifiedByDashboard,
      former2Version: a.former2Version,
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
          '스냅샷 폴더가 설정되지 않았습니다 (AWS_SNAPSHOT_DIR)',
          'unknown',
        ),
      );
    } else if (s === 'unavailable' || s === 'syncing') {
      reasons.push(
        reason(
          'SOURCE_UNAVAILABLE',
          this.mode === 'mock' && this.scenario === 'unavailable'
            ? '스냅샷 폴더를 찾을 수 없습니다: /data/aws-snapshots'
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
            ? {
                ...SETUP_HINT,
                reasonText: finalReasons[0]?.text ?? null,
              }
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
    };
  }

  private envelope() {
    return { dataSource: this.mode, generatedAt: new Date().toISOString() };
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

  /** 스냅샷 하나에 맞춘 CLI 안내 (재스캔 명령에 ID를 채움) */
  private cliFor(id: string) {
    return {
      ...CLI_COMMANDS,
      scan: CLI_COMMANDS.scan.replace('<id>', id),
    };
  }

  /**
   * "내보내기 진행 중일 수 있음" 판단 근거 (명세 3.3, 30분 기준).
   * metadata.json이 있으면 판단 대상이 아니므로 untilAt은 null.
   */
  private exportProgress(a: Analysis) {
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

  async list(q: SnapshotListQueryDto) {
    await this.ready;
    const all = this.analyses();
    const prev = this.previousMap(all);
    let items = all.map((a) => this.listItem(a, prev.get(a.id)));
    const regions = [
      ...new Set(all.map((a) => a.region).filter((r): r is string => !!r)),
    ].sort();
    if (q.status?.length)
      items = items.filter((i) => q.status!.includes(i.status.status));
    if (q.region?.length)
      items = items.filter(
        (i) => i.region !== null && q.region!.includes(i.region),
      );
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((i) =>
        [i.id, i.label ?? '', i.memo ?? ''].some((t) =>
          t.toLowerCase().includes(needle),
        ),
      );
    }
    const sort = parseSort(q.sort) ?? { field: 'snapshotAt', dir: 'desc' };
    const byId = (x: { id: string }, y: { id: string }) =>
      x.id < y.id ? 1 : x.id > y.id ? -1 : 0; // 최신순
    items.sort((x, y) => {
      if (sort.field === 'status') {
        const c = compareStatusDesc(x.status.status, y.status.status);
        const r = sort.dir === 'desc' ? c : -c;
        return r || byId(x, y);
      }
      return sort.dir === 'desc' ? byId(x, y) : -byId(x, y);
    });
    const page = paginate(all.length, items, q);
    return {
      ...this.envelope(),
      revision: this.revision,
      summary: this.buildSummary(),
      ...page.meta,
      regions,
      items: page.items,
      cli: CLI_COMMANDS,
    };
  }

  // ------------------------------------------------------------------ 공통 확인

  private requireReadable(): void {
    if (!this.sourceUsable() || !this.backend || !this.scanner) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SOURCE_UNAVAILABLE',
        '스냅샷 폴더를 사용할 수 없습니다.',
        { source: this.registry.get('snapshotStore') },
      );
    }
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

  /** 쓰기는 stale에서도 503 */
  private requireReadableStrict(): never {
    throw new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'SOURCE_UNAVAILABLE',
      '스냅샷 폴더를 사용할 수 없습니다.',
      { source: this.registry.get('snapshotStore') },
    );
  }

  private mapBackendError(
    err: unknown,
    ctx: { id?: string; kind?: FileKind; trashId?: string },
  ): never {
    if (!(err instanceof BackendError)) throw err;
    switch (err.code) {
      case 'NOT_FOUND':
        if (ctx.trashId)
          throw resourceNotFound(
            { kind: 'AwsSnapshotTrashItem', id: ctx.trashId },
            '휴지통 항목이 없습니다.',
          );
        if (ctx.kind)
          throw resourceNotFound(
            { kind: 'AwsSnapshotFile', id: ctx.id, fileKind: ctx.kind },
            '파일이 없습니다.',
          );
        throw resourceNotFound(
          { kind: 'AwsSnapshot', id: ctx.id },
          '스냅샷이 없습니다.',
        );
      case 'PATH_REJECTED':
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'SNAPSHOT_PATH_REJECTED',
          '허용되지 않는 경로입니다 (심볼릭 링크 또는 스냅샷 루트 밖).',
        );
      case 'VERSION_CONFLICT':
        throw this.conflict(ctx.kind ?? null, null, null);
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
          `스냅샷 쓰기 실패 id=${ctx.id ?? ctx.trashId ?? '-'} kind=${ctx.kind ?? '-'} errno=${err.errno ?? '-'}`,
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
    kind: FileKind | 'notes' | null,
    currentVersion: string | null,
    modifiedAt: string | null,
  ): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      'SNAPSHOT_VERSION_CONFLICT',
      kind === 'notes'
        ? '다른 곳에서 라벨·메모가 바뀌었습니다. 입력을 복사한 뒤 다시 불러오세요.'
        : '다른 곳에서 파일이 바뀌었습니다. 편집 내용을 복사한 뒤 다시 불러오세요.',
      { fileKind: kind, currentVersion, currentModifiedAt: modifiedAt },
    );
  }

  /** mock conflict-once: 한 번 409 후 기본으로 */
  private consumeMockConflict(): boolean {
    if (this.mode === 'mock' && this.scenario === 'conflict-once') {
      this.setScenario('default');
      return true;
    }
    return false;
  }

  /** 한 스냅샷을 최신으로 (없으면 404, 링크면 403) */
  private async fresh(id: string): Promise<Analysis> {
    try {
      const changed = await this.refreshEntry(id);
      if (changed) this.bump();
    } catch (err) {
      this.mapBackendError(err, { id });
    }
    const c = this.cache.get(id);
    if (!c)
      throw resourceNotFound({ kind: 'AwsSnapshot', id }, '스냅샷이 없습니다.');
    return c.a;
  }

  // ------------------------------------------------------------------ 상세·파일

  async detail(id: string) {
    await this.ready;
    this.requireReadable();
    const a = await this.fresh(id);
    const prev = this.previousMap(this.analyses()).get(id);
    return {
      ...this.envelope(),
      revision: this.revision,
      cli: this.cliFor(id),
      snapshot: {
        ...this.listItem(a, prev),
        files: FILE_KINDS.map((k) => {
          const f = a.files[k];
          return {
            kind: k,
            name: f.name,
            exists: f.exists,
            sizeBytes: f.sizeBytes,
            lineCount: f.lineCount,
            modifiedAt: f.modifiedAt,
            version: f.version,
            eol: f.eol,
            bom: f.bom,
            encoding: f.encoding,
            indent: f.indent,
            editable: this.fileEditable(a, k),
            viewTruncated: (f.sizeBytes ?? 0) > this.cfg.viewMax,
          };
        }),
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

  async file(
    id: string,
    kind: FileKind,
    res?: { setHeader(k: string, v: string): void },
  ) {
    await this.ready;
    this.requireReadable();
    const a = await this.fresh(id);
    let cur: { bytes: Buffer; mtimeMs: number } | null;
    try {
      cur = await this.backend!.readFile(id, FILE_NAME[kind]);
    } catch (err) {
      this.mapBackendError(err, { id, kind });
    }
    if (!cur)
      throw resourceNotFound(
        { kind: 'AwsSnapshotFile', id, fileKind: kind },
        '파일이 없습니다.',
      );
    const version = sha256Version(cur.bytes);
    const truncated = cur.bytes.length > this.cfg.viewMax;
    const shown = truncateAtLine(cur.bytes, this.cfg.viewMax);
    const f = a.files[kind];
    res?.setHeader('ETag', `"${version}"`);
    res?.setHeader('Cache-Control', 'no-store');
    const text = decodeLikeCli(cur.bytes);
    return {
      ...this.envelope(),
      snapshotId: id,
      kind,
      name: FILE_NAME[kind],
      content: toLfText(shown),
      version,
      sizeBytes: cur.bytes.length,
      lineCount: f.lineCount,
      eol: f.eol,
      bom: f.bom,
      encoding: f.encoding,
      indent: f.indent,
      modifiedAt: new Date(cur.mtimeMs).toISOString(),
      truncated,
      returnedBytes: shown.length,
      editable: truncated
        ? block('FILE_TOO_LARGE', BLOCK_TEXT.FILE_TOO_LARGE)
        : this.fileEditable(a, kind),
      findings: a.scan.findings.filter((x) => x.file === FILE_NAME[kind]),
      resourceCount:
        kind === 'cloudformation'
          ? this.scanner!.countCloudFormationResources(text)
          : kind === 'terraform'
            ? this.scanner!.countTerraformResources(text)
            : null,
    };
  }

  async scanRules() {
    await this.ready;
    if (!this.scanner) this.requireReadableStrict();
    if (!this.scanner.listRules)
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SOURCE_UNAVAILABLE',
        '스캐너 lib에 규칙 목록(listRules)이 없습니다.',
        { source: this.registry.get('snapshotStore') },
      );
    return {
      ...this.envelope(),
      allowMarker: this.scanner.allowMarker,
      scannableExtensions: this.scanner.scannableExtensions,
      rules: this.scanner.listRules(),
    };
  }

  async refreshNow() {
    await this.ready;
    await this.refresh();
    return this.getSummary();
  }

  // ------------------------------------------------------------------ 편집

  private async runCheck(id: string, kind: FileKind, content: string) {
    if (!(EDITABLE_KINDS as readonly string[]).includes(kind)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SNAPSHOT_FILE_NOT_EDITABLE',
        '이 파일은 편집할 수 없습니다.',
        { reasonCode: 'FILE_KIND_READ_ONLY' },
      );
    }
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
      cur = await this.backend!.readFile(id, FILE_NAME[kind]);
    } catch (err) {
      this.mapBackendError(err, { id, kind });
    }
    if (!cur)
      throw resourceNotFound(
        { kind: 'AwsSnapshotFile', id, fileKind: kind },
        '파일이 없습니다.',
      );
    const f = a.files[kind];
    const fileBlock = [
      (f.sizeBytes ?? 0) > this.cfg.editMax ? 'FILE_TOO_LARGE' : null,
      f.encoding !== 'utf-8' ? 'NOT_UTF8' : null,
      f.eol === 'mixed' ? 'MIXED_LINE_ENDINGS' : null,
    ].find((x) => x !== null);
    if (fileBlock)
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SNAPSHOT_FILE_NOT_EDITABLE',
        BLOCK_TEXT[fileBlock as WriteBlockCode],
        { reasonCode: fileBlock },
      );
    const lf = content.replace(/\r\n/g, '\n');
    const bytes = restoreFormat(lf, {
      eol: f.eol ?? 'lf',
      bom: f.bom ?? false,
    });
    if (bytes.length > this.cfg.editMax)
      throw new ApiException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'SNAPSHOT_FILE_TOO_LARGE',
        `편집 상한(${this.cfg.editMax} bytes)을 넘었습니다.`,
        { maxBytes: this.cfg.editMax, sizeBytes: bytes.length },
      );
    const name = FILE_NAME[kind];
    const text = decodeLikeCli(bytes);
    const fileFindings = sortFindings(
      this.scanner!.scanText(text, name).map((x) => ({ ...x, fileKind: kind })),
    );
    const errors = fileFindings.filter((x) => x.severity === 'error').length;
    const warnings = fileFindings.length - errors;
    const syntax =
      kind === 'cloudformation'
        ? { checked: true, errors: yamlErrors(lf) }
        : { checked: false, errors: [] as YamlError[] };
    const before = a.resources.current[kind as 'cloudformation' | 'terraform'];
    const after =
      kind === 'cloudformation'
        ? this.scanner!.countCloudFormationResources(text)
        : this.scanner!.countTerraformResources(text);
    const merged: ScanFinding[] = [
      ...a.scan.findings.filter((x) => x.file !== name),
      ...fileFindings,
    ];
    const snapshotScanAfter: ScanSummary = summarizeFindings(
      this.scanner!,
      merged,
      a.scan.summary.strict,
    );
    const confirmationsRequired: ConfirmValue[] = [];
    if (errors > 0) confirmationsRequired.push('secret_errors');
    if (syntax.errors.length > 0) confirmationsRequired.push('yaml_syntax');
    if (before !== null && after < before)
      confirmationsRequired.push('resource_decrease');
    return {
      a,
      cur,
      bytes,
      check: {
        findings: fileFindings,
        errors,
        warnings,
        syntax,
        resources: { before, after },
        unchanged: bytes.equals(cur.bytes),
        snapshotScanAfter,
        confirmationsRequired,
      },
    };
  }

  async check(id: string, kind: FileKind, content: string) {
    await this.ready;
    this.requireReadable();
    const r = await this.runCheck(id, kind, content);
    return { ...this.envelope(), snapshotId: id, kind, check: r.check };
  }

  async save(
    id: string,
    kind: FileKind,
    body: { content: string; baseVersion: string; confirm?: string[] },
  ) {
    await this.ready;
    this.requireReadable();
    this.requireWritable();
    if (!(EDITABLE_KINDS as readonly string[]).includes(kind))
      return this.runCheck(id, kind, body.content) as never; // 403
    const pre = await this.fresh(id);
    if (pre.inProgress)
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SNAPSHOT_EXPORT_IN_PROGRESS',
        '내보내기 진행 중일 수 있어 저장할 수 없습니다.',
      );
    const r = await this.runCheck(id, kind, body.content);
    const curVersion = sha256Version(r.cur.bytes);
    if (this.consumeMockConflict() || curVersion !== body.baseVersion)
      throw this.conflict(
        kind,
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
      if (missing.includes('resource_decrease'))
        parts.push(
          `리소스 ${r.check.resources.before}개 → ${r.check.resources.after}개`,
        );
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
    if (r.check.unchanged) {
      return {
        ...this.envelope(),
        saved: false,
        snapshotId: id,
        kind,
        version: curVersion,
        modifiedAt: new Date(r.cur.mtimeMs).toISOString(),
        sizeBytes: r.cur.bytes.length,
        check: r.check,
        rescan: { before, after: before },
        snapshot: this.listItem(r.a, this.previousMap(this.analyses()).get(id)),
        revision: this.revision,
      };
    }
    let written: { mtimeMs: number };
    try {
      written = await this.backend!.writeFileAtomic(
        id,
        FILE_NAME[kind],
        r.bytes,
        body.baseVersion,
      );
    } catch (err) {
      if (err instanceof BackendError && err.code === 'VERSION_CONFLICT') {
        const now = await this.backend!.readFile(id, FILE_NAME[kind]).catch(
          () => null,
        );
        throw this.conflict(
          kind,
          now ? sha256Version(now.bytes) : null,
          now ? new Date(now.mtimeMs).toISOString() : null,
        );
      }
      this.mapBackendError(err, { id, kind });
    }
    const newVersion = sha256Version(r.bytes);
    await this.recordTemplateEdit(id, kind, newVersion, written.mtimeMs);
    this.logger.log(
      `스냅샷 템플릿 저장 id=${id} kind=${kind} bytes=${r.bytes.length}`,
    );
    const a = await this.fresh(id);
    this.pending.changed.add(id);
    this.bump();
    return {
      ...this.envelope(),
      saved: true,
      snapshotId: id,
      kind,
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
      snapshot: this.listItem(a, this.previousMap(this.analyses()).get(id)),
      revision: this.revision,
    };
  }

  /** notes.json templateEdits 갱신 (실패해도 저장은 성공) */
  private async recordTemplateEdit(
    id: string,
    kind: FileKind,
    version: string,
    mtimeMs: number,
  ): Promise<void> {
    try {
      const cur = await this.backend!.readFile(id, NOTES_FILE);
      const notes = parseNotes(cur?.bytes ?? null);
      if (notes.corrupt) return;
      const base: Record<string, unknown> = notes.raw ?? {
        schemaVersion: 1,
        tool: 'sentinel dashboard',
        snapshotId: id,
        label: '',
        memo: '',
        updatedAt: null,
      };
      const edits = (
        typeof base.templateEdits === 'object' && base.templateEdits !== null
          ? base.templateEdits
          : {}
      ) as Record<string, unknown>;
      const next = {
        ...base,
        templateEdits: {
          ...edits,
          [kind]: { savedAt: new Date(mtimeMs).toISOString(), version },
        },
      };
      await this.backend!.writeFileAtomic(
        id,
        NOTES_FILE,
        Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'),
        cur ? sha256Version(cur.bytes) : 'absent',
      );
    } catch (err) {
      this.logger.warn(
        `notes.json templateEdits 기록 실패 id=${id} (${err instanceof BackendError ? err.code : 'ERROR'})`,
      );
    }
  }

  async saveNotes(id: string, body: NotesDto) {
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
      const errs = this.scanner!.scanText(text, field).filter(
        (f) => f.severity === 'error',
      );
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
    this.logger.log(`스냅샷 라벨·메모 저장 id=${id}`);
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

  private trashView(t: RawTrashItem) {
    const notes = parseNotes(t.notes);
    let region: string | null = null;
    if (t.metadata) {
      try {
        const m = JSON.parse(t.metadata.toString('utf8')) as {
          region?: unknown;
        };
        region = typeof m.region === 'string' ? m.region : null;
      } catch {
        region = null;
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
      region,
      files: t.topNames.slice(0, 50),
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
    this.logger.log(`스냅샷 휴지통 이동 id=${id} trashId=${trashId}`);
    this.cache.delete(id);
    this.tracker.forget(id);
    this.pending.removed.add(id);
    this.pending.trash = true;
    this.trashCount++;
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
    this.logger.log(`스냅샷 복원 trashId=${trashId}`);
    this.trashCount = Math.max(0, this.trashCount - 1);
    this.pending.trash = true;
    const a = await this.fresh(snapshotId);
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
    this.logger.log(`스냅샷 영구 삭제 trashId=${trashId}`);
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
}

export interface YamlError {
  line: number;
  column: number;
  code: string;
  message: string;
}

/** YAML 구문 오류 (CloudFormation 태그는 경고로만 나오므로 오류가 아니다). 파서 원문 메시지는 쓰지 않는다 */
export function yamlErrors(text: string): YamlError[] {
  const out: YamlError[] = [];
  try {
    for (const doc of parseAllDocuments(text, { prettyErrors: true })) {
      for (const e of doc.errors) {
        out.push({
          line: e.linePos?.[0]?.line ?? 0,
          column: e.linePos?.[0]?.col ?? 0,
          code: e.code,
          message: `YAML 구문 오류 (${e.code})`,
        });
        if (out.length >= 50) return out;
      }
    }
  } catch {
    out.push({
      line: 0,
      column: 0,
      code: 'PARSE_FAILED',
      message: 'YAML 구문 오류 (PARSE_FAILED)',
    });
  }
  return out;
}
