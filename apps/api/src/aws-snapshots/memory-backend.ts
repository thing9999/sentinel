import { extname } from 'node:path';
import {
  BackendError,
  type ExpectedVersion,
  type RawEntry,
  type RawSnapshot,
  type RawTrashItem,
  type RootListing,
  type SnapshotBackend,
} from './backend';
import {
  FILE_NAME,
  KNOWN_FILES,
  NOTES_FILE,
  SNAPSHOT_ID_RE,
  TRASH_ID_RE,
} from './snapshot.constants';
import { sha256Version } from './text-utils';

export interface MemFile {
  bytes: Buffer;
  /** 고정 mtime, 또는 "지금 - ageMs" (mock 내보내기 진행 중 재현) */
  mtimeMs: number | { ageMs: number };
}

export interface MemSnapshot {
  /** 상대 경로 → 파일. 하위 폴더는 경로로 표현 (a/b.yml) */
  files: Map<string, MemFile>;
  /** 빈 폴더 등 파일 없는 폴더 */
  dirs?: Set<string>;
  dirMtimeMs: number | { ageMs: number };
  rev: number;
}

export interface MemTree {
  snapshots: Map<string, MemSnapshot>;
  trash: Map<string, MemSnapshot>;
  unrecognized: string[];
}

function resolveMtime(v: number | { ageMs: number }): number {
  return typeof v === 'number' ? v : Date.now() - v.ageMs;
}

function cloneSnapshot(s: MemSnapshot): MemSnapshot {
  return {
    files: new Map([...s.files].map(([k, f]) => [k, { ...f }])),
    dirs: new Set(s.dirs ?? []),
    dirMtimeMs: s.dirMtimeMs,
    rev: s.rev,
  };
}

/**
 * 메모리 백엔드 (mock). 실제 파일 시스템을 읽거나 쓰지 않는다 (AC-02).
 * 버전 확인·충돌·휴지통 규칙은 FsBackend와 같다.
 */
export class MemoryBackend implements SnapshotBackend {
  readonly kind = 'memory' as const;
  private rev = 1;

  constructor(
    private readonly tree: MemTree,
    private readonly scannable: readonly string[],
  ) {}

  probeRoot(): Promise<{ writable: boolean }> {
    return Promise.resolve({ writable: true });
  }

  listRoot(): Promise<RootListing> {
    return Promise.resolve({
      snapshots: [...this.tree.snapshots.keys()].sort(),
      unrecognized: [...this.tree.unrecognized],
    });
  }

  fingerprint(id: string): Promise<string | null> {
    const s = this.tree.snapshots.get(id);
    return Promise.resolve(s ? String(s.rev) : null);
  }

  private toRaw(id: string, s: MemSnapshot): RawSnapshot {
    const paths = new Set<string>([...s.files.keys(), ...(s.dirs ?? [])]);
    // 중간 폴더도 항목으로
    for (const p of [...paths]) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++)
        paths.add(parts.slice(0, i).join('/'));
    }
    // CLI 순서: 폴더마다 이름 정렬, 깊이 우선
    const sorted = [...paths].sort((a, b) => {
      const pa = a.split('/');
      const pb = b.split('/');
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
      }
      return pa.length - pb.length;
    });
    const dirMtime = resolveMtime(s.dirMtimeMs);
    const entries: RawEntry[] = sorted.map((p) => {
      const f = s.files.get(p);
      if (!f)
        return {
          path: p,
          type: 'directory',
          size: null,
          mtimeMs: dirMtime,
          content: null,
          readError: null,
        };
      const base = p.split('/').pop()!;
      const readable =
        this.scannable.includes(extname(base).toLowerCase()) ||
        KNOWN_FILES.has(p);
      return {
        path: p,
        type: 'file',
        size: f.bytes.length,
        mtimeMs: resolveMtime(f.mtimeMs),
        content: readable ? f.bytes : null,
        readError: null,
      };
    });
    return { id, dirMtimeMs: dirMtime, entries };
  }

  readSnapshot(id: string): Promise<RawSnapshot | null> {
    const s = this.tree.snapshots.get(id);
    return Promise.resolve(s ? this.toRaw(id, s) : null);
  }

  readFile(
    id: string,
    name: string,
  ): Promise<{ bytes: Buffer; mtimeMs: number } | null> {
    const f = this.tree.snapshots.get(id)?.files.get(name);
    return Promise.resolve(
      f ? { bytes: f.bytes, mtimeMs: resolveMtime(f.mtimeMs) } : null,
    );
  }

  writeFileAtomic(
    id: string,
    name: string,
    bytes: Buffer,
    expected: ExpectedVersion,
  ): Promise<{ mtimeMs: number }> {
    if (!KNOWN_FILES.has(name) || name === FILE_NAME.metadata)
      return Promise.reject(new BackendError('PATH_REJECTED', 'not writable'));
    const s = this.tree.snapshots.get(id);
    if (!s)
      return Promise.reject(
        new BackendError('NOT_FOUND', 'snapshot not found'),
      );
    const cur = s.files.get(name);
    if (expected === 'absent' && cur)
      return Promise.reject(new BackendError('VERSION_CONFLICT', 'exists'));
    if (expected !== null && expected !== 'absent') {
      if (!cur)
        return Promise.reject(new BackendError('NOT_FOUND', 'file not found'));
      if (sha256Version(cur.bytes) !== expected)
        return Promise.reject(new BackendError('VERSION_CONFLICT', 'changed'));
    }
    const now = Date.now();
    s.files.set(name, { bytes: Buffer.from(bytes), mtimeMs: now });
    s.rev = ++this.rev + 1000;
    return Promise.resolve({ mtimeMs: now });
  }

  moveToTrash(id: string, trashId: string): Promise<void> {
    const s = this.tree.snapshots.get(id);
    if (!s)
      return Promise.reject(
        new BackendError('NOT_FOUND', 'snapshot not found'),
      );
    if (this.tree.trash.has(trashId))
      return Promise.reject(new BackendError('EXISTS', 'exists'));
    this.tree.snapshots.delete(id);
    this.tree.trash.set(trashId, s);
    return Promise.resolve();
  }

  listTrash(): Promise<RawTrashItem[]> {
    const out: RawTrashItem[] = [];
    for (const [trashId, s] of [...this.tree.trash].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const m = TRASH_ID_RE.exec(trashId);
      if (!m) continue;
      const top = new Set<string>();
      for (const p of [...s.files.keys(), ...(s.dirs ?? [])])
        top.add(p.split('/')[0]);
      out.push({
        trashId,
        snapshotId: m[1],
        topNames: [...top].sort(),
        sizeBytes: [...s.files.values()].reduce(
          (a, f) => a + f.bytes.length,
          0,
        ),
        notes: s.files.get(NOTES_FILE)?.bytes ?? null,
        metadata: s.files.get(FILE_NAME.metadata)?.bytes ?? null,
      });
    }
    return Promise.resolve(out);
  }

  restore(trashId: string, snapshotId: string): Promise<void> {
    const s = this.tree.trash.get(trashId);
    if (!s || !SNAPSHOT_ID_RE.test(snapshotId))
      return Promise.reject(new BackendError('NOT_FOUND', 'not found'));
    if (this.tree.snapshots.has(snapshotId))
      return Promise.reject(new BackendError('EXISTS', 'exists'));
    this.tree.trash.delete(trashId);
    s.rev = ++this.rev + 1000;
    this.tree.snapshots.set(snapshotId, s);
    return Promise.resolve();
  }

  purge(trashId: string): Promise<void> {
    if (!this.tree.trash.delete(trashId))
      return Promise.reject(new BackendError('NOT_FOUND', 'not found'));
    return Promise.resolve();
  }
}

export function cloneTree(t: MemTree): MemTree {
  return {
    snapshots: new Map([...t.snapshots].map(([k, s]) => [k, cloneSnapshot(s)])),
    trash: new Map([...t.trash].map(([k, s]) => [k, cloneSnapshot(s)])),
    unrecognized: [...t.unrecognized],
  };
}
