/**
 * 스냅샷 저장소 추상화. live = 파일 시스템(FsBackend), mock = 메모리(MemoryBackend).
 * 상태 판단·스캔·버전 규칙은 서비스·분석기가 두 백엔드에 똑같이 적용한다.
 */

export type EntryType = 'file' | 'directory' | 'symlink' | 'other';

export interface RawEntry {
  /** 스냅샷 폴더 기준 상대 경로, '/' 구분 */
  path: string;
  type: EntryType;
  size: number | null;
  mtimeMs: number;
  /** 스캔 대상(확장자)·알려진 파일이면 내용. 읽기 실패면 null + readError */
  content: Buffer | null;
  readError: string | null;
}

export interface RawSnapshot {
  id: string;
  dirMtimeMs: number;
  /** CLI scanPaths와 같은 순서: 폴더마다 이름 정렬, 깊이 우선 */
  entries: RawEntry[];
}

export interface RootListing {
  snapshots: string[];
  unrecognized: string[];
}

export interface RawTrashItem {
  trashId: string;
  snapshotId: string;
  topNames: string[];
  sizeBytes: number;
  notes: Buffer | null;
  metadata: Buffer | null;
}

export type BackendErrorCode =
  | 'ROOT_MISSING'
  | 'ROOT_UNREADABLE'
  | 'NOT_FOUND'
  | 'PATH_REJECTED'
  | 'VERSION_CONFLICT'
  | 'EXISTS'
  | 'READ_ONLY'
  | 'WRITE_FAILED';

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    message: string,
    readonly errno?: string,
  ) {
    super(message);
  }
}

/** 쓰기 전 확인할 현재 버전(sha256:…). 문자열 'absent' = 파일이 없어야 함, null = 확인 안 함 */
export type ExpectedVersion = string | null;

export interface SnapshotBackend {
  readonly kind: 'fs' | 'memory';
  /** 루트 확인. 없으면 ROOT_MISSING, 못 읽으면 ROOT_UNREADABLE */
  probeRoot(): Promise<{ writable: boolean }>;
  listRoot(): Promise<RootListing>;
  /** 스냅샷 폴더 지문 (바뀌었는지 비교용). 없으면 null */
  fingerprint(id: string): Promise<string | null>;
  /** 없으면 null. 링크·루트 밖이면 PATH_REJECTED */
  readSnapshot(id: string): Promise<RawSnapshot | null>;
  /** 스냅샷 바로 아래 파일. 없으면 null */
  readFile(
    id: string,
    name: string,
  ): Promise<{ bytes: Buffer; mtimeMs: number } | null>;
  writeFileAtomic(
    id: string,
    name: string,
    bytes: Buffer,
    expected: ExpectedVersion,
  ): Promise<{ mtimeMs: number }>;
  moveToTrash(id: string, trashId: string): Promise<void>;
  listTrash(): Promise<RawTrashItem[]>;
  restore(trashId: string, snapshotId: string): Promise<void>;
  purge(trashId: string): Promise<void>;
}
