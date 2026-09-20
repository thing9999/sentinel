import type { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRegistry } from '../common/source-registry.service';
import type { EnvironmentVariables } from '../config/env.validation';
import { AwsSnapshotsService } from './aws-snapshots.service';

const ID = '20260918-120000';

function config(
  values: Partial<Record<keyof EnvironmentVariables, unknown>>,
): ConfigService<EnvironmentVariables, true> {
  const defaults: Partial<Record<keyof EnvironmentVariables, unknown>> = {
    AWS_SNAPSHOT_WRITE_ENABLED: true,
    AWS_SNAPSHOT_IN_PROGRESS_MIN: 30,
    AWS_SNAPSHOT_EDIT_MAX_BYTES: 5 * 1024 * 1024,
    AWS_SNAPSHOT_VIEW_MAX_BYTES: 20 * 1024 * 1024,
    AWS_SNAPSHOT_POLL_INTERVAL_SEC: 10,
  };
  const all = { ...defaults, ...values };
  return {
    get: (k: keyof EnvironmentVariables) => all[k],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

async function make(
  values: Partial<Record<keyof EnvironmentVariables, unknown>>,
): Promise<AwsSnapshotsService> {
  const svc = new AwsSnapshotsService(
    'live',
    new SourceRegistry('live'),
    config(values),
  );
  svc.onApplicationBootstrap();
  await svc.whenReady();
  return svc;
}

describe('AwsSnapshotsService (live)', () => {
  let root: string;
  let svc: AwsSnapshotsService | null = null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sentinel-live-'));
    const dir = join(root, ID);
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'terraform.tf'),
      'resource "aws_vpc" "a" {\r\n  cidr_block = "10.0.0.0/16"\r\n}\r\n',
    );
    writeFileSync(
      join(dir, 'cloudformation.yml'),
      'Resources:\n  Vpc:\n    Type: AWS::EC2::VPC\n',
    );
    writeFileSync(join(dir, 'logical-id-mapping.json'), '{}\n');
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify({
        schemaVersion: 1,
        snapshotId: ID,
        region: 'ap-northeast-2',
        resources: { cloudformation: 1, terraform: 1 },
        secretScan: {
          errors: 0,
          warnings: 0,
          strict: false,
          passed: true,
          rules: [],
        },
      }),
    );
  });

  afterEach(() => {
    svc?.onModuleDestroy();
    svc = null;
    rmSync(root, { recursive: true, force: true });
  });

  it('경로 설정이 없으면 not_configured, 예시 데이터 없음 (AC-45)', async () => {
    svc = await make({});
    const s = await svc.list({});
    expect(s.items).toEqual([]);
    expect(s.summary.root.state).toBe('not_configured');
    expect(s.summary.status.reasons[0].code).toBe('SOURCE_NOT_CONFIGURED');
  });

  it('폴더가 없으면 unavailable, 폴더를 만들지 않는다 (AC-46)', async () => {
    const missing = join(root, 'missing');
    svc = await make({ AWS_SNAPSHOT_DIR: missing });
    const s = await svc.getSummary();
    expect(s.summary.root.state).toBe('unavailable');
    expect(s.summary.status.reasons[0].code).toBe('SOURCE_UNAVAILABLE');
    expect(existsSync(missing)).toBe(false);
  });

  it('저장 시 CRLF를 유지하고 notes.json에 편집 기록, 휴지통은 루트 안 .trash (AC-28, AC-34, AC-38)', async () => {
    svc = await make({ AWS_SNAPSHOT_DIR: root });
    const list = await svc.list({});
    expect(list.items.map((i) => i.id)).toEqual([ID]);
    expect(list.items[0].status.status).toBe('ok');

    const f = await svc.file(ID, 'terraform');
    expect(f.eol).toBe('crlf');
    expect(f.content).not.toContain('\r');
    const edited = f.content.replace('10.0.0.0/16', '10.1.0.0/16');
    const r = await svc.save(ID, 'terraform', {
      content: edited,
      baseVersion: f.version,
    });
    expect(r.saved).toBe(true);
    expect(readFileSync(join(root, ID, 'terraform.tf'), 'utf8')).toBe(
      'resource "aws_vpc" "a" {\r\n  cidr_block = "10.1.0.0/16"\r\n}\r\n',
    );
    const notes = JSON.parse(
      readFileSync(join(root, ID, 'notes.json'), 'utf8'),
    ) as { templateEdits: { terraform: { version: string } } };
    expect(notes.templateEdits.terraform.version).toBe(r.version);
    expect(r.snapshot.modifiedByDashboard).toBe(true);
    // notes.json은 예상 밖 파일이 아니다
    expect(r.snapshot.status.status).toBe('ok');

    const d = await svc.detail(ID);
    await svc.saveNotes(ID, {
      label: '업그레이드 전',
      memo: '',
      baseVersion: d.snapshot.notes.version,
    });
    const del = await svc.moveToTrash(ID, ID);
    expect(existsSync(join(root, '.trash', del.trashItem!.trashId))).toBe(true);
    const listed = await svc.list({});
    expect(listed.items).toEqual([]);
    expect(listed.summary.unrecognized.count).toBe(0);
    const back = await svc.restore(del.trashItem!.trashId);
    expect(back.snapshot.label).toBe('업그레이드 전');
  });

  it('쓰기 스위치를 끄면 403 SNAPSHOT_WRITE_DISABLED', async () => {
    svc = await make({
      AWS_SNAPSHOT_DIR: root,
      AWS_SNAPSHOT_WRITE_ENABLED: false,
    });
    await expect(svc.moveToTrash(ID, ID)).rejects.toMatchObject({
      code: 'SNAPSHOT_WRITE_DISABLED',
    });
    const s = await svc.getSummary();
    expect(s.summary.writable.reasonCode).toBe('WRITE_DISABLED');
  });
});
