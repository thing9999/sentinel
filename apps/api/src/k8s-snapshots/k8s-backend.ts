import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fsp, type Stats } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import {
  BackendError,
  type EntryType,
  type ExpectedVersion,
  type RawEntry,
  type RawSnapshot,
} from '../aws-snapshots/backend';
import { sha256Version } from '../aws-snapshots/text-utils';
import {
  NOTES_FILE,
  PARTIAL_DIR_RE,
  ROOT_IGNORED,
  SNAPSHOT_ID_RE,
  TMP_FILE_RE,
  TRASH_DIR,
  TRASH_ID_RE,
} from './k8s.constants';

/**
 * k8s 스냅샷 저장소 (docs/api/k8s-snapshot.md 1.1, 9절).
 * ASM 백엔드와 같은 규칙이지만 파일이 하위 폴더(<ns>/<kind>/<name>.yaml)에 있어 경로 구성 요소마다 링크를 검사한다.
 * 경로 형식(PATH_RULES)은 호출 전에 서비스가 검사한다. 여기서는 파일 시스템 안전만 본다.
 */

export interface K8sTrashItem {
  trashId: string;
  snapshotId: string;
  topNames: string[];
  fileCount: number;
  sizeBytes: number;
  notes: Buffer | null;
  metadata: Buffer | null;
}

export interface K8sBackend {
  readonly kind: 'fs' | 'memory';
  probeRoot(): Promise<{ writable: boolean }>;
  listRoot(): Promise<{ snapshots: string[]; unrecognized: string[] }>;
  fingerprint(id: string): Promise<string | null>;
  readSnapshot(id: string, maxReadBytes: number): Promise<RawSnapshot | null>;
  readFile(
    id: string,
    rel: string,
  ): Promise<{ bytes: Buffer; mtimeMs: number } | null>;
  /** expected: 현재 버전(sha256:…) / 'absent'(없어야 함, notes.json 첫 저장) / null(확인 안 함) */
  writeFileAtomic(
    id: string,
    rel: string,
    bytes: Buffer,
    expected: ExpectedVersion,
  ): Promise<{ mtimeMs: number }>;
  moveToTrash(id: string, trashId: string): Promise<void>;
  listTrash(): Promise<K8sTrashItem[]>;
  restore(trashId: string, snapshotId: string): Promise<void>;
  purge(trashId: string): Promise<void>;
}

const SAFE_REL_RE = /^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;
function assertRel(rel: string): string[] {
  if (!SAFE_REL_RE.test(rel))
    throw new BackendError('PATH_REJECTED', 'bad relative path');
  const parts = rel.split('/');
  if (parts.some((p) => p === '.' || p === '..' || p === ''))
    throw new BackendError('PATH_REJECTED', 'bad relative path');
  return parts;
}

function errnoOf(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function typeOf(st: Stats): EntryType {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await fsp.lstat(p);
  } catch (err) {
    if (errnoOf(err) === 'ENOENT' || errnoOf(err) === 'ENOTDIR') return null;
    throw err;
  }
}

function mapWriteError(err: unknown): never {
  if (err instanceof BackendError) throw err;
  const code = errnoOf(err);
  if (code === 'EROFS') throw new BackendError('READ_ONLY', 'ro', code);
  throw new BackendError('WRITE_FAILED', 'failed', code);
}

export class FsK8sBackend implements K8sBackend {
  readonly kind = 'fs' as const;
  private rootReal: string | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly scannable: readonly string[],
  ) {}

  private async root(): Promise<string> {
    if (this.rootReal) return this.rootReal;
    await this.probeRoot();
    return this.rootReal!;
  }

  async probeRoot(): Promise<{ writable: boolean }> {
    const abs = resolve(this.rootDir);
    let st: Stats;
    try {
      st = await fsp.stat(abs);
    } catch (err) {
      this.rootReal = null;
      const code = errnoOf(err);
      if (code === 'ENOENT' || code === 'ENOTDIR')
        throw new BackendError('ROOT_MISSING', 'not found', code);
      throw new BackendError('ROOT_UNREADABLE', 'unreadable', code);
    }
    if (!st.isDirectory()) {
      this.rootReal = null;
      throw new BackendError('ROOT_MISSING', 'not a directory', 'ENOTDIR');
    }
    try {
      this.rootReal = await fsp.realpath(abs);
      await fsp.access(this.rootReal, fsConstants.R_OK);
    } catch (err) {
      throw new BackendError('ROOT_UNREADABLE', 'unreadable', errnoOf(err));
    }
    let writable = true;
    try {
      await fsp.access(this.rootReal, fsConstants.W_OK);
    } catch {
      writable = false;
    }
    return { writable };
  }

  private async inside(p: string, base: string): Promise<boolean> {
    const real = await fsp.realpath(p);
    return real.startsWith(base + sep);
  }

  private async snapshotDir(id: string): Promise<string | null> {
    if (!SNAPSHOT_ID_RE.test(id))
      throw new BackendError('PATH_REJECTED', 'bad id');
    const root = await this.root();
    const dir = join(root, id);
    const st = await lstatOrNull(dir);
    if (!st) return null;
    if (st.isSymbolicLink() || !st.isDirectory())
      throw new BackendError('PATH_REJECTED', 'not a plain directory');
    if (!(await this.inside(dir, root)))
      throw new BackendError('PATH_REJECTED', 'outside root');
    return dir;
  }

  /**
   * 스냅샷 안 파일 경로. 중간 폴더·파일 모두 lstat 으로 링크 거부.
   * 없으면 null. 파일이 아니면 PATH_REJECTED.
   */
  private async filePath(
    id: string,
    rel: string,
  ): Promise<{ dir: string; abs: string; st: Stats | null } | null> {
    const parts = assertRel(rel);
    const dir = await this.snapshotDir(id);
    if (!dir) return null;
    let cur = dir;
    for (let i = 0; i < parts.length; i++) {
      cur = join(cur, parts[i]);
      const st = await lstatOrNull(cur);
      if (!st)
        return i === parts.length - 1 ? { dir, abs: cur, st: null } : null;
      if (st.isSymbolicLink())
        throw new BackendError('PATH_REJECTED', 'symlink in path');
      if (i < parts.length - 1 && !st.isDirectory())
        throw new BackendError('PATH_REJECTED', 'not a directory');
      if (i === parts.length - 1) {
        if (!st.isFile())
          throw new BackendError('PATH_REJECTED', 'not a regular file');
        if (!(await this.inside(cur, await this.root())))
          throw new BackendError('PATH_REJECTED', 'outside root');
        return { dir, abs: cur, st };
      }
    }
    return null;
  }

  async listRoot() {
    const root = await this.root();
    const names = (await fsp.readdir(root)).sort();
    const snapshots: string[] = [];
    const unrecognized: string[] = [];
    for (const name of names) {
      if (ROOT_IGNORED.has(name) || PARTIAL_DIR_RE.test(name)) continue;
      const st = await lstatOrNull(join(root, name));
      if (!st) continue;
      if (SNAPSHOT_ID_RE.test(name) && st.isDirectory() && !st.isSymbolicLink())
        snapshots.push(name);
      else unrecognized.push(name);
    }
    return { snapshots, unrecognized };
  }

  private async walk(
    dir: string,
    rel: string,
    out: { entry: RawEntry; abs: string }[],
  ): Promise<void> {
    const names = (await fsp.readdir(dir)).sort();
    for (const name of names) {
      const abs = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = await lstatOrNull(abs);
      if (!st) continue;
      const type = typeOf(st);
      out.push({
        abs,
        entry: {
          path: relPath,
          type,
          size: type === 'file' ? st.size : null,
          mtimeMs: st.mtimeMs,
          content: null,
          readError: null,
        },
      });
      if (type === 'directory') await this.walk(abs, relPath, out);
    }
  }

  async fingerprint(id: string): Promise<string | null> {
    const dir = await this.snapshotDir(id);
    if (!dir) return null;
    const st = await fsp.lstat(dir);
    const list: { entry: RawEntry; abs: string }[] = [];
    await this.walk(dir, '', list);
    return [
      `.:${st.mtimeMs}`,
      ...list.map(
        ({ entry: e }) => `${e.path}:${e.type}:${e.size ?? '-'}:${e.mtimeMs}`,
      ),
    ].join('|');
  }

  async readSnapshot(
    id: string,
    maxReadBytes: number,
  ): Promise<RawSnapshot | null> {
    const dir = await this.snapshotDir(id);
    if (!dir) return null;
    const st = await fsp.lstat(dir);
    const list: { entry: RawEntry; abs: string }[] = [];
    await this.walk(dir, '', list);
    for (const { entry, abs } of list) {
      if (entry.type !== 'file') continue;
      const base = entry.path.split('/').pop()!;
      const dot = base.lastIndexOf('.');
      const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
      if (!this.scannable.includes(ext) || TMP_FILE_RE.test(base)) continue;
      if ((entry.size ?? 0) > maxReadBytes) {
        entry.readError = 'TOO_LARGE';
        continue;
      }
      try {
        entry.content = await fsp.readFile(abs);
      } catch (err) {
        entry.readError = errnoOf(err);
      }
    }
    return { id, dirMtimeMs: st.mtimeMs, entries: list.map((x) => x.entry) };
  }

  async readFile(id: string, rel: string) {
    const f = await this.filePath(id, rel);
    if (!f || !f.st) return null;
    return { bytes: await fsp.readFile(f.abs), mtimeMs: f.st.mtimeMs };
  }

  async writeFileAtomic(
    id: string,
    rel: string,
    bytes: Buffer,
    expected: ExpectedVersion,
  ): Promise<{ mtimeMs: number }> {
    const f = await this.filePath(id, rel);
    if (!f) throw new BackendError('NOT_FOUND', 'snapshot or folder not found');
    // 새 파일은 notes.json 만 (expected 'absent'). 리소스 파일 새로 만들기는 없다 (AC-K24)
    if (!f.st && !(rel === NOTES_FILE && expected === 'absent'))
      throw new BackendError('NOT_FOUND', 'file not found');
    const target = f.abs;
    const check = async (): Promise<Stats | null> => {
      const st = await lstatOrNull(target);
      if (st && (!st.isFile() || st.isSymbolicLink()))
        throw new BackendError('PATH_REJECTED', 'not a regular file');
      if (expected === 'absent') {
        if (st) throw new BackendError('VERSION_CONFLICT', 'exists');
      } else if (expected !== null) {
        if (!st) throw new BackendError('NOT_FOUND', 'file not found');
        const cur = sha256Version(await fsp.readFile(target));
        if (cur !== expected)
          throw new BackendError('VERSION_CONFLICT', 'changed');
      }
      return st;
    };
    const before = await check();
    const base = rel.split('/').pop()!;
    const tmp = join(
      dirname(target),
      `.${base}.sentinel-tmp-${randomBytes(6).toString('hex')}`,
    );
    try {
      const fh = await fsp.open(
        tmp,
        'wx',
        before ? before.mode & 0o777 : 0o644,
      );
      try {
        await fh.writeFile(bytes);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await check();
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      mapWriteError(err);
    }
    const st = await fsp.lstat(target);
    return { mtimeMs: st.mtimeMs };
  }

  private async trashDir(create: boolean): Promise<string | null> {
    const root = await this.root();
    const dir = join(root, TRASH_DIR);
    const st = await lstatOrNull(dir);
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory())
        throw new BackendError('PATH_REJECTED', 'trash is not a directory');
      return dir;
    }
    if (!create) return null;
    try {
      await fsp.mkdir(dir);
    } catch (err) {
      mapWriteError(err);
    }
    return dir;
  }

  async moveToTrash(id: string, trashId: string): Promise<void> {
    const dir = await this.snapshotDir(id);
    if (!dir) throw new BackendError('NOT_FOUND', 'snapshot not found');
    const trash = (await this.trashDir(true))!;
    const dest = join(trash, trashId);
    if (await lstatOrNull(dest)) throw new BackendError('EXISTS', 'exists');
    try {
      await fsp.rename(dir, dest);
    } catch (err) {
      mapWriteError(err);
    }
  }

  private async trashItemDir(trashId: string): Promise<string | null> {
    if (!TRASH_ID_RE.test(trashId))
      throw new BackendError('PATH_REJECTED', 'bad trash id');
    const trash = await this.trashDir(false);
    if (!trash) return null;
    const p = join(trash, trashId);
    const st = await lstatOrNull(p);
    if (!st) return null;
    if (st.isSymbolicLink() || !st.isDirectory())
      throw new BackendError('PATH_REJECTED', 'not a plain directory');
    if (!(await this.inside(p, await fsp.realpath(trash))))
      throw new BackendError('PATH_REJECTED', 'outside trash');
    return p;
  }

  async listTrash(): Promise<K8sTrashItem[]> {
    const trash = await this.trashDir(false);
    if (!trash) return [];
    const out: K8sTrashItem[] = [];
    for (const name of (await fsp.readdir(trash)).sort()) {
      const m = TRASH_ID_RE.exec(name);
      if (!m) continue;
      const p = join(trash, name);
      const st = await lstatOrNull(p);
      if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
      const list: { entry: RawEntry; abs: string }[] = [];
      await this.walk(p, '', list);
      const readTop = async (file: string): Promise<Buffer | null> => {
        const e = list.find((x) => x.entry.path === file);
        if (!e || e.entry.type !== 'file') return null;
        return fsp.readFile(e.abs).catch(() => null);
      };
      out.push({
        trashId: name,
        snapshotId: m[1],
        topNames: list
          .filter((x) => !x.entry.path.includes('/'))
          .map((x) => x.entry.path),
        fileCount: list.filter((x) => x.entry.type === 'file').length,
        sizeBytes: list.reduce((a, x) => a + (x.entry.size ?? 0), 0),
        notes: await readTop(NOTES_FILE),
        metadata: await readTop('metadata.json'),
      });
    }
    return out;
  }

  async restore(trashId: string, snapshotId: string): Promise<void> {
    const src = await this.trashItemDir(trashId);
    if (!src) throw new BackendError('NOT_FOUND', 'trash item not found');
    const dest = join(await this.root(), snapshotId);
    if (await lstatOrNull(dest)) throw new BackendError('EXISTS', 'exists');
    try {
      await fsp.rename(src, dest);
    } catch (err) {
      mapWriteError(err);
    }
  }

  async purge(trashId: string): Promise<void> {
    const src = await this.trashItemDir(trashId);
    if (!src) throw new BackendError('NOT_FOUND', 'trash item not found');
    try {
      await fsp.rm(src, { recursive: true, force: false });
    } catch (err) {
      mapWriteError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// 메모리 백엔드 (mock). 실제 파일 시스템을 읽거나 쓰지 않는다 (AC-K42).
// ---------------------------------------------------------------------------

export interface MemFile {
  bytes: Buffer;
  mtimeMs: number | { ageMs: number };
}
export interface MemSnapshot {
  files: Map<string, MemFile>;
  /** 링크 등 특수 항목 (예상 밖 파일 재현) */
  specials?: Map<string, EntryType>;
  dirMtimeMs: number | { ageMs: number };
  rev: number;
}
export interface MemTree {
  snapshots: Map<string, MemSnapshot>;
  trash: Map<string, MemSnapshot>;
  unrecognized: string[];
}

const mt = (v: number | { ageMs: number }) =>
  typeof v === 'number' ? v : Date.now() - v.ageMs;

export function cloneMemTree(t: MemTree): MemTree {
  const cs = (s: MemSnapshot): MemSnapshot => ({
    files: new Map([...s.files].map(([k, f]) => [k, { ...f }])),
    specials: new Map(s.specials ?? []),
    dirMtimeMs: s.dirMtimeMs,
    rev: s.rev,
  });
  return {
    snapshots: new Map([...t.snapshots].map(([k, s]) => [k, cs(s)])),
    trash: new Map([...t.trash].map(([k, s]) => [k, cs(s)])),
    unrecognized: [...t.unrecognized],
  };
}

export class MemoryK8sBackend implements K8sBackend {
  readonly kind = 'memory' as const;
  private rev = 1;

  constructor(private readonly tree: MemTree) {}

  probeRoot() {
    return Promise.resolve({ writable: true });
  }

  listRoot() {
    return Promise.resolve({
      snapshots: [...this.tree.snapshots.keys()].sort(),
      unrecognized: [...this.tree.unrecognized],
    });
  }

  fingerprint(id: string) {
    const s = this.tree.snapshots.get(id);
    return Promise.resolve(s ? String(s.rev) : null);
  }

  private toRaw(id: string, s: MemSnapshot): RawSnapshot {
    const types = new Map<string, EntryType>();
    for (const p of s.files.keys()) types.set(p, 'file');
    for (const [p, t] of s.specials ?? []) types.set(p, t);
    for (const p of [...types.keys()]) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++)
        if (!types.has(parts.slice(0, i).join('/')))
          types.set(parts.slice(0, i).join('/'), 'directory');
    }
    const sorted = [...types.keys()].sort((a, b) => {
      const pa = a.split('/');
      const pb = b.split('/');
      for (let i = 0; i < Math.min(pa.length, pb.length); i++)
        if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
      return pa.length - pb.length;
    });
    const dm = mt(s.dirMtimeMs);
    return {
      id,
      dirMtimeMs: dm,
      entries: sorted.map((p) => {
        const f = s.files.get(p);
        return {
          path: p,
          type: types.get(p)!,
          size: f ? f.bytes.length : null,
          mtimeMs: f ? mt(f.mtimeMs) : dm,
          content: f ? f.bytes : null,
          readError: null,
        };
      }),
    };
  }

  readSnapshot(id: string) {
    const s = this.tree.snapshots.get(id);
    return Promise.resolve(s ? this.toRaw(id, s) : null);
  }

  readFile(id: string, rel: string) {
    assertRel(rel);
    const s = this.tree.snapshots.get(id);
    if (!s) return Promise.resolve(null);
    if (s.specials?.has(rel))
      return Promise.reject(new BackendError('PATH_REJECTED', 'special'));
    const f = s.files.get(rel);
    return Promise.resolve(
      f ? { bytes: f.bytes, mtimeMs: mt(f.mtimeMs) } : null,
    );
  }

  writeFileAtomic(
    id: string,
    rel: string,
    bytes: Buffer,
    expected: ExpectedVersion,
  ): Promise<{ mtimeMs: number }> {
    assertRel(rel);
    const s = this.tree.snapshots.get(id);
    if (!s)
      return Promise.reject(
        new BackendError('NOT_FOUND', 'snapshot not found'),
      );
    const cur = s.files.get(rel);
    if (!cur && !(rel === NOTES_FILE && expected === 'absent'))
      return Promise.reject(new BackendError('NOT_FOUND', 'file not found'));
    if (expected === 'absent' && cur)
      return Promise.reject(new BackendError('VERSION_CONFLICT', 'exists'));
    if (expected !== null && expected !== 'absent') {
      if (!cur)
        return Promise.reject(new BackendError('NOT_FOUND', 'file not found'));
      if (sha256Version(cur.bytes) !== expected)
        return Promise.reject(new BackendError('VERSION_CONFLICT', 'changed'));
    }
    const now = Date.now();
    s.files.set(rel, { bytes: Buffer.from(bytes), mtimeMs: now });
    s.rev = ++this.rev + 1000;
    return Promise.resolve({ mtimeMs: now });
  }

  moveToTrash(id: string, trashId: string) {
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

  listTrash(): Promise<K8sTrashItem[]> {
    const out: K8sTrashItem[] = [];
    for (const [trashId, s] of [...this.tree.trash].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const m = TRASH_ID_RE.exec(trashId);
      if (!m) continue;
      const top = new Set<string>();
      for (const p of s.files.keys()) top.add(p.split('/')[0]);
      out.push({
        trashId,
        snapshotId: m[1],
        topNames: [...top].sort(),
        fileCount: s.files.size,
        sizeBytes: [...s.files.values()].reduce(
          (a, f) => a + f.bytes.length,
          0,
        ),
        notes: s.files.get(NOTES_FILE)?.bytes ?? null,
        metadata: s.files.get('metadata.json')?.bytes ?? null,
      });
    }
    return Promise.resolve(out);
  }

  restore(trashId: string, snapshotId: string) {
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

  purge(trashId: string) {
    if (!this.tree.trash.delete(trashId))
      return Promise.reject(new BackendError('NOT_FOUND', 'not found'));
    return Promise.resolve();
  }
}
