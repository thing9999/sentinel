import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as fsp, type Stats } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import {
  BackendError,
  type EntryType,
  type ExpectedVersion,
  type RawEntry,
  type RawSnapshot,
  type RawTrashItem,
  type RootListing,
  type SnapshotBackend,
} from './backend';
import {
  KNOWN_FILES,
  NOTES_FILE,
  ROOT_IGNORED,
  SNAPSHOT_ID_RE,
  TRASH_DIR,
  TRASH_ID_RE,
  FILE_NAME,
} from './snapshot.constants';
import { sha256Version } from './text-utils';

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

/**
 * 파일 시스템 백엔드 (live). 계약 1.1 경로 규칙:
 * - 식별자 형식은 호출 전에 검사됨 (그래도 여기서 한 번 더 확인)
 * - lstat으로 링크·정션을 거부하고 따라가지 않는다
 * - realpath가 루트 안인지 확인한다
 * - 폴더를 새로 만드는 것은 휴지통(.trash)뿐. 루트는 만들지 않는다
 */
export class FsBackend implements SnapshotBackend {
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

  private async insideRoot(p: string, base?: string): Promise<boolean> {
    const root = base ?? (await this.root());
    const real = await fsp.realpath(p);
    return real.startsWith(root + sep);
  }

  /** 스냅샷 폴더 경로. 없으면 null, 링크·루트 밖·폴더 아님이면 PATH_REJECTED */
  private async snapshotDir(id: string): Promise<string | null> {
    if (!SNAPSHOT_ID_RE.test(id))
      throw new BackendError('PATH_REJECTED', 'bad id');
    const root = await this.root();
    const dir = join(root, id);
    const st = await lstatOrNull(dir);
    if (!st) return null;
    if (st.isSymbolicLink() || !st.isDirectory())
      throw new BackendError('PATH_REJECTED', 'not a plain directory');
    if (!(await this.insideRoot(dir, root)))
      throw new BackendError('PATH_REJECTED', 'outside root');
    return dir;
  }

  async listRoot(): Promise<RootListing> {
    const root = await this.root();
    const names = (await fsp.readdir(root)).sort();
    const snapshots: string[] = [];
    const unrecognized: string[] = [];
    for (const name of names) {
      if (ROOT_IGNORED.has(name)) continue;
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
    const dir = await this.snapshotDir(id); // 링크·루트 밖이면 PATH_REJECTED
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

  async readSnapshot(id: string): Promise<RawSnapshot | null> {
    const dir = await this.snapshotDir(id);
    if (!dir) return null;
    const st = await fsp.lstat(dir);
    const list: { entry: RawEntry; abs: string }[] = [];
    await this.walk(dir, '', list);
    for (const { entry, abs } of list) {
      if (entry.type !== 'file') continue;
      const base = entry.path.split('/').pop()!;
      const scannable = this.scannable.includes(extname(base).toLowerCase());
      if (!scannable && !KNOWN_FILES.has(entry.path)) continue;
      try {
        entry.content = await fsp.readFile(abs);
      } catch (err) {
        entry.readError = errnoOf(err);
      }
    }
    return { id, dirMtimeMs: st.mtimeMs, entries: list.map((x) => x.entry) };
  }

  async readFile(
    id: string,
    name: string,
  ): Promise<{ bytes: Buffer; mtimeMs: number } | null> {
    const dir = await this.snapshotDir(id);
    if (!dir) return null;
    const p = join(dir, name);
    const st = await lstatOrNull(p);
    if (!st) return null;
    if (!st.isFile() || st.isSymbolicLink())
      throw new BackendError('PATH_REJECTED', 'not a regular file');
    return { bytes: await fsp.readFile(p), mtimeMs: st.mtimeMs };
  }

  async writeFileAtomic(
    id: string,
    name: string,
    bytes: Buffer,
    expected: ExpectedVersion,
  ): Promise<{ mtimeMs: number }> {
    if (!KNOWN_FILES.has(name) || name === FILE_NAME.metadata)
      throw new BackendError('PATH_REJECTED', 'not writable file');
    const dir = await this.snapshotDir(id);
    if (!dir) throw new BackendError('NOT_FOUND', 'snapshot not found');
    const target = join(dir, name);
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
    const tmp = join(
      dir,
      `.${name}.sentinel-tmp-${randomBytes(6).toString('hex')}`,
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
      await check(); // 쓰기 직전 버전 재확인
      await fsp.rename(tmp, target);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      if (err instanceof BackendError) throw err;
      const code = errnoOf(err);
      if (code === 'EROFS')
        throw new BackendError('READ_ONLY', 'read-only file system', code);
      throw new BackendError('WRITE_FAILED', 'write failed', code);
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
      const code = errnoOf(err);
      if (code === 'EROFS') throw new BackendError('READ_ONLY', 'ro', code);
      throw new BackendError('WRITE_FAILED', 'mkdir failed', code);
    }
    return dir;
  }

  private mapWriteError(err: unknown): never {
    if (err instanceof BackendError) throw err;
    const code = errnoOf(err);
    if (code === 'EROFS') throw new BackendError('READ_ONLY', 'ro', code);
    throw new BackendError('WRITE_FAILED', 'failed', code);
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
      this.mapWriteError(err);
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
    const trashReal = await fsp.realpath(trash);
    if (!(await this.insideRoot(p, trashReal)))
      throw new BackendError('PATH_REJECTED', 'outside trash');
    return p;
  }

  async listTrash(): Promise<RawTrashItem[]> {
    const trash = await this.trashDir(false);
    if (!trash) return [];
    const out: RawTrashItem[] = [];
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
        sizeBytes: list.reduce((a, x) => a + (x.entry.size ?? 0), 0),
        notes: await readTop(NOTES_FILE),
        metadata: await readTop(FILE_NAME.metadata),
      });
    }
    return out;
  }

  async restore(trashId: string, snapshotId: string): Promise<void> {
    const src = await this.trashItemDir(trashId);
    if (!src) throw new BackendError('NOT_FOUND', 'trash item not found');
    const root = await this.root();
    const dest = join(root, snapshotId);
    if (await lstatOrNull(dest)) throw new BackendError('EXISTS', 'exists');
    try {
      await fsp.rename(src, dest);
    } catch (err) {
      this.mapWriteError(err);
    }
  }

  async purge(trashId: string): Promise<void> {
    const src = await this.trashItemDir(trashId);
    if (!src) throw new BackendError('NOT_FOUND', 'trash item not found');
    try {
      // fs.rm은 안의 심볼릭 링크를 따라가지 않고 링크만 지운다
      await fsp.rm(src, { recursive: true, force: false });
    } catch (err) {
      this.mapWriteError(err);
    }
  }
}
