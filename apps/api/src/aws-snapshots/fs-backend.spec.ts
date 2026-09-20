import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeSnapshot } from './analyzer';
import { BackendError } from './backend';
import { FsBackend } from './fs-backend';
import {
  defaultLibDir,
  loadScanner,
  type SnapshotScanner,
} from './scanner-loader';
import { sha256Version } from './text-utils';

const ID = '20260919-031500';

const CFN = [
  'AWSTemplateFormatVersion: "2010-09-09"',
  'Resources:',
  '  Subnet1:',
  '    Type: AWS::EC2::Subnet',
  '    Properties:',
  '      VpcId: !Ref Vpc1',
  '  Param:',
  '    Type: AWS::SSM::Parameter',
  '    Properties:',
  '      Value: postgres://app:example-password@db.example.internal/app',
  '  Node:',
  '    Type: AWS::EC2::Instance',
  '    Properties:',
  '      UserData: !Base64 |',
  '        #!/bin/bash',
  '      Checked: postgres://a:example-pass@h/x # snapshot-scan: allow',
  '',
].join('\n');

const TF = [
  'resource "aws_subnet" "a" {',
  '  cidr_block = "10.0.1.0/24"',
  '}',
  'resource "aws_lambda_function" "api" {',
  '  environment {',
  '    variables = {',
  '      Password = "example-secret-value"',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');

let root: string;
let scanner: SnapshotScanner;

function makeSnapshot(id = ID): string {
  const dir = join(root, id);
  mkdirSync(join(dir, 'extra'), { recursive: true });
  writeFileSync(join(dir, 'cloudformation.yml'), CFN);
  writeFileSync(join(dir, 'terraform.tf'), TF);
  writeFileSync(
    join(dir, 'logical-id-mapping.json'),
    '{\n  "Subnet1": "subnet-1"\n}\n',
  );
  writeFileSync(
    join(dir, 'metadata.json'),
    JSON.stringify({
      schemaVersion: 1,
      snapshotId: id,
      region: 'ap-northeast-2',
      resources: { cloudformation: 3, terraform: 2 },
      secretScan: {
        errors: 0,
        warnings: 0,
        strict: false,
        passed: true,
        rules: [],
      },
    }),
  );
  writeFileSync(join(dir, 'extra', 'more.yaml'), 'ApiKey: "abcdefghijk"\n');
  writeFileSync(join(dir, 'README.txt'), 'Password: "notscanned"\n');
  return dir;
}

beforeAll(async () => {
  scanner = await loadScanner(defaultLibDir());
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sentinel-snap-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('CLI 규칙과 같은 결과 (AC-08, AC-09)', () => {
  it('스캔 발견(파일·줄·규칙·등급)과 리소스 수가 CLI scanPaths / meta.mjs와 같다', async () => {
    const dir = makeSnapshot();
    const cli = (await import(
      pathToFileURL(resolve(defaultLibDir(), 'scan.mjs')).href
    )) as {
      scanPaths: (p: string[]) => {
        files: string[];
        findings: {
          file: string;
          line: number;
          rule: string;
          severity: string;
        }[];
      };
    };
    const expected = cli.scanPaths([dir]);
    const be = new FsBackend(root, scanner.scannableExtensions);
    const raw = (await be.readSnapshot(ID))!;
    const a = analyzeSnapshot(raw, scanner, {
      nowMs: Date.now(),
      inProgressMinutes: 30,
    });

    const norm = (f: {
      file: string;
      line: number;
      rule: string;
      severity: string;
    }) =>
      `${f.file.replace(/\\/g, '/').split(`${ID}/`).pop()}:${f.line}:${f.rule}:${f.severity}`;
    expect(a.scan.findings.map(norm).sort()).toEqual(
      expected.findings.map(norm).sort(),
    );
    expect(a.scan.scannedFiles).toEqual(
      expected.files.map((f) => f.replace(/\\/g, '/').split(`${ID}/`).pop()),
    );
    expect(a.scan.summary.errors).toBeGreaterThan(0);
    expect(a.resources.current).toEqual({
      cloudformation: scanner.countCloudFormationResources(CFN),
      terraform: scanner.countTerraformResources(TF),
    });
    expect(a.status).toBe('critical');
    expect(a.files.terraform.eol).toBe('crlf');
    expect(a.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining([
        'SCAN_SECRET_ERRORS',
        'SCAN_WARNINGS',
        'UNEXPECTED_FILES',
      ]),
    );
    // 가린 값만 (원문 없음, AC-10)
    expect(JSON.stringify(a.scan.findings)).not.toContain(
      'example-secret-value',
    );
  });

  it('metadata 없음: 30분 이내면 unknown(진행 중), 지나면 warning', async () => {
    const dir = makeSnapshot();
    rmSync(join(dir, 'metadata.json'));
    const be = new FsBackend(root, scanner.scannableExtensions);
    const raw = (await be.readSnapshot(ID))!;
    const now = analyzeSnapshot(raw, scanner, {
      nowMs: Date.now(),
      inProgressMinutes: 30,
    });
    expect(now.inProgress).toBe(true);
    expect(now.reasons.some((r) => r.code === 'EXPORT_MAYBE_IN_PROGRESS')).toBe(
      true,
    );
    const later = analyzeSnapshot(raw, scanner, {
      nowMs: Date.now() + 31 * 60_000,
      inProgressMinutes: 30,
    });
    expect(later.inProgress).toBe(false);
    expect(later.reasons.some((r) => r.code === 'METADATA_MISSING')).toBe(true);
  });

  it('metadata 손상은 critical이고 나머지 파일은 그대로 분석된다 (AC-14)', async () => {
    const dir = makeSnapshot();
    writeFileSync(join(dir, 'metadata.json'), '{ "schemaVersion": 1,');
    const be = new FsBackend(root, scanner.scannableExtensions);
    const a = analyzeSnapshot((await be.readSnapshot(ID))!, scanner, {
      nowMs: Date.now(),
      inProgressMinutes: 30,
    });
    expect(a.metadata.state).toBe('corrupt');
    expect(a.metadata.error).toMatch(/^JSON 해석 실패/);
    expect(a.reasons[0].status).toBe('critical');
    expect(a.files.cloudformation.exists).toBe(true);
  });
});

describe('FsBackend 경로 규칙 (AC-20, AC-41)', () => {
  it('이름 형식이 안 맞는 항목·링크는 인식하지 못한 항목, .trash·.gitkeep은 제외', async () => {
    makeSnapshot();
    mkdirSync(join(root, 'old-backup'));
    writeFileSync(join(root, '.gitkeep'), '');
    mkdirSync(join(root, '.trash'));
    const outside = mkdtempSync(join(tmpdir(), 'sentinel-outside-'));
    try {
      symlinkSync(outside, join(root, '20260101-000000'), 'junction');
      const be = new FsBackend(root, scanner.scannableExtensions);
      const l = await be.listRoot();
      expect(l.snapshots).toEqual([ID]);
      expect(l.unrecognized.sort()).toEqual(['20260101-000000', 'old-backup']);
      await expect(be.readSnapshot('20260101-000000')).rejects.toMatchObject({
        code: 'PATH_REJECTED',
      });
      await expect(
        be.writeFileAtomic(
          '20260101-000000',
          'terraform.tf',
          Buffer.from('x'),
          null,
        ),
      ).rejects.toBeInstanceOf(BackendError);
      await expect(
        be.moveToTrash(
          '20260101-000000',
          `20260101-000000__20260919T000000000Z`,
        ),
      ).rejects.toMatchObject({
        code: 'PATH_REJECTED',
      });
    } finally {
      rmSync(join(root, '20260101-000000'), { recursive: false, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('루트가 없으면 ROOT_MISSING이고 폴더를 만들지 않는다 (AC-46)', async () => {
    const missing = join(root, 'nope');
    const be = new FsBackend(missing, scanner.scannableExtensions);
    await expect(be.probeRoot()).rejects.toMatchObject({
      code: 'ROOT_MISSING',
    });
    expect(existsSync(missing)).toBe(false);
  });

  it('metadata.json·임의 파일 이름은 쓸 수 없다 (AC-32, AC-42)', async () => {
    makeSnapshot();
    const be = new FsBackend(root, scanner.scannableExtensions);
    await expect(
      be.writeFileAtomic(ID, 'metadata.json', Buffer.from('{}'), null),
    ).rejects.toMatchObject({ code: 'PATH_REJECTED' });
    await expect(
      be.writeFileAtomic(ID, '../x.tf', Buffer.from('x'), null),
    ).rejects.toMatchObject({ code: 'PATH_REJECTED' });
  });
});

describe('FsBackend 쓰기 (AC-28, AC-29, AC-30, AC-38)', () => {
  it('버전이 다르면 VERSION_CONFLICT, 원래 파일 그대로', async () => {
    const dir = makeSnapshot();
    const be = new FsBackend(root, scanner.scannableExtensions);
    await expect(
      be.writeFileAtomic(
        ID,
        'terraform.tf',
        Buffer.from('new'),
        sha256Version('other'),
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(readFileSync(join(dir, 'terraform.tf'), 'utf8')).toBe(TF);
  });

  it('원자적 쓰기: 버전이 맞으면 바꾸고 임시 파일을 남기지 않는다', async () => {
    const dir = makeSnapshot();
    const be = new FsBackend(root, scanner.scannableExtensions);
    const cur = readFileSync(join(dir, 'terraform.tf'));
    await be.writeFileAtomic(
      ID,
      'terraform.tf',
      Buffer.from('a\r\nb\r\n'),
      sha256Version(cur),
    );
    expect(readFileSync(join(dir, 'terraform.tf'), 'utf8')).toBe('a\r\nb\r\n');
    const raw = (await be.readSnapshot(ID))!;
    expect(raw.entries.some((e) => e.path.includes('sentinel-tmp'))).toBe(
      false,
    );
    // notes.json 새로 만들기 (absent)
    await be.writeFileAtomic(ID, 'notes.json', Buffer.from('{}\n'), 'absent');
    await expect(
      be.writeFileAtomic(ID, 'notes.json', Buffer.from('{}\n'), 'absent'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('휴지통 이동 → 목록 → 복원(같은 ID 있으면 EXISTS) → 영구 삭제', async () => {
    const dir = makeSnapshot();
    const before = readFileSync(join(dir, 'terraform.tf'));
    const be = new FsBackend(root, scanner.scannableExtensions);
    const trashId = `${ID}__20260919T050210123Z`;
    await be.moveToTrash(ID, trashId);
    expect(existsSync(dir)).toBe(false);
    const t = await be.listTrash();
    expect(t.map((x) => x.trashId)).toEqual([trashId]);
    expect(t[0].topNames).toContain('terraform.tf');
    expect((await be.listRoot()).unrecognized).toEqual([]);

    makeSnapshot(); // 같은 ID가 다시 생김
    await expect(be.restore(trashId, ID)).rejects.toMatchObject({
      code: 'EXISTS',
    });
    rmSync(dir, { recursive: true, force: true });
    await be.restore(trashId, ID);
    expect(readFileSync(join(dir, 'terraform.tf'))).toEqual(before);

    await be.moveToTrash(ID, trashId);
    await be.purge(trashId);
    expect(await be.listTrash()).toEqual([]);
    await expect(be.purge(trashId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
