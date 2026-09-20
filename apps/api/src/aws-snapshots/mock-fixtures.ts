import type { MemSnapshot, MemTree } from './memory-backend';
import { FILE_NAME, NOTES_FILE, snapshotIdToIso } from './snapshot.constants';
import { sha256Version } from './text-utils';

/**
 * mock 예시 스냅샷 (계약 12절, 명세 3.12).
 * 비밀값은 누가 봐도 가짜인 값만 쓴다 (AWS 문서 예시 키, "example" 비밀번호).
 */

const MIN = 60_000;

function cfn(count: number, extra = ''): string {
  const lines = [
    'AWSTemplateFormatVersion: "2010-09-09"',
    'Description: Former2 export (sentinel mock)',
    'Resources:',
  ];
  for (let i = 1; i <= count; i++) {
    lines.push(
      `  Subnet${i}:`,
      '    Type: AWS::EC2::Subnet',
      '    DeletionPolicy: Retain',
      '    Properties:',
      '      VpcId: !Ref Vpc1',
      `      CidrBlock: 10.0.${i % 250}.0/24`,
    );
  }
  return `${lines.join('\n')}\n${extra}`;
}

function tf(count: number, extra = ''): string {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(
      `resource "aws_subnet" "subnet_${i}" {`,
      '  vpc_id     = aws_vpc.vpc_1.id',
      `  cidr_block = "10.0.${i % 250}.0/24"`,
      '}',
      '',
    );
  }
  return `${out.join('\n')}${extra}`;
}

function mapping(count: number): string {
  const obj: Record<string, string> = {};
  for (let i = 1; i <= count; i++) obj[`Subnet${i}`] = `subnet-0${1000 + i}`;
  return `${JSON.stringify(obj, null, 2)}\n`;
}

interface MetaOpts {
  region?: string;
  cfn: number;
  tf: number;
  scan?: {
    errors: number;
    warnings: number;
    rules: string[];
    strict?: boolean;
  };
  searchFilter?: string | null;
  services?: { mode: 'include' | 'exclude'; list: string[] };
}

function metadata(id: string, o: MetaOpts): string {
  const scan = o.scan ?? { errors: 0, warnings: 0, rules: [] };
  const strict = scan.strict ?? false;
  const meta = {
    schemaVersion: 1,
    tool: 'sentinel deploy/aws-snapshot',
    createdAt: new Date(
      Date.parse(snapshotIdToIso(id)!) + 70_000,
    ).toISOString(),
    snapshotId: id,
    snapshotIdTimezone: 'UTC',
    region: o.region ?? 'ap-northeast-2',
    profile: 'snapshot-export',
    searchFilter: o.searchFilter === undefined ? 'prod-eks' : o.searchFilter,
    regexFilter: null,
    services: o.services ?? {
      mode: 'exclude',
      list: ['SecretsManager', 'SSM', 'Lambda'],
    },
    allowSensitiveServices: false,
    includeDefaultResources: false,
    cfnDeletionPolicy: 'Retain',
    former2: {
      version: '0.2.83',
      args: [
        'generate',
        '--output-cloudformation',
        '<snapshot>/cloudformation.yml',
        '--output-terraform',
        '<snapshot>/terraform.tf',
      ],
    },
    node: 'v22.12.0',
    account: {
      masked: true,
      ids: ['********9012'],
      note: '템플릿 안의 ARN 에는 계정 ID 가 원문으로 남아 있습니다',
    },
    resources: { cloudformation: o.cfn, terraform: o.tf },
    rawData: { saved: false, location: null },
    secretScan: {
      errors: scan.errors,
      warnings: scan.warnings,
      strict,
      passed: scan.errors === 0 && (!strict || scan.warnings === 0),
      rules: scan.rules,
    },
  };
  return `${JSON.stringify(meta, null, 2)}\n`;
}

function snap(
  id: string,
  files: Record<string, string | Buffer>,
  mtime: number | { ageMs: number } = Date.parse(snapshotIdToIso(id)!) + 70_000,
): MemSnapshot {
  return {
    files: new Map(
      Object.entries(files).map(([k, v]) => [
        k,
        {
          bytes: Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'),
          mtimeMs: mtime,
        },
      ]),
    ),
    dirMtimeMs: mtime,
    rev: 1,
  };
}

const USER_DATA_CFN = [
  '  Node1:',
  '    Type: AWS::EC2::Instance',
  '    Properties:',
  '      InstanceType: m6i.large',
  '      UserData: !Base64 |',
  '        #!/bin/bash',
  '        /etc/eks/bootstrap.sh prod-eks',
  '',
].join('\n');

const SECRET_CFN = [
  '  AppConfig:',
  '    Type: AWS::SSM::Parameter',
  '    Properties:',
  '      Type: String',
  '      Value: postgres://app:example-password@db.example.internal/app',
  '',
].join('\n');

const SECRET_TF = [
  'resource "aws_lambda_function" "api" {',
  '  function_name = "api"',
  '  environment {',
  '    variables = {',
  '      DB_HOST = "db.example.internal"',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

/** 편집 상한(5 MB)을 넘는 큰 템플릿 (약 5.5 MB) */
function bigCfn(): string {
  const unit = 150; // 대략 리소스 1개당 바이트
  const count = Math.ceil((5.5 * 1024 * 1024) / unit);
  return cfn(count);
}

export const MOCK_IDS = {
  inProgress: '20260919-045500',
  secrets: '20260919-031500',
  userData: '20260918-120000',
  ok: '20260917-090000',
  metaCorrupt: '20260916-150000',
  mappingMissing: '20260915-101010',
  tfMissing: '20260914-080000',
  labeled: '20260912-020000',
  big: '20260910-000000',
  trash: '20260901-000000__20260910T010203000Z',
} as const;

let bigCache: string | null = null;

export function buildMockTree(): MemTree {
  const t = new Map<string, MemSnapshot>();
  const I = MOCK_IDS;

  // 7. 내보내기 진행 중일 수 있음: metadata 없음, 항상 5분 전 변경
  t.set(
    I.inProgress,
    snap(
      I.inProgress,
      { [FILE_NAME.cloudformation]: cfn(12), [FILE_NAME.terraform]: tf(12) },
      { ageMs: 5 * MIN },
    ),
  );
  // 3. 장애: 스캔 오류 (url-credentials, env-block) + user-data 경고
  t.set(
    I.secrets,
    snap(I.secrets, {
      [FILE_NAME.cloudformation]: cfn(40, USER_DATA_CFN + SECRET_CFN),
      [FILE_NAME.terraform]: tf(42, SECRET_TF),
      [FILE_NAME.mapping]: mapping(42),
      [FILE_NAME.metadata]: metadata(I.secrets, {
        cfn: 42,
        tf: 43,
        scan: {
          errors: 3,
          warnings: 1,
          rules: ['env-block', 'url-credentials', 'user-data'],
        },
      }),
    }),
  );
  // 2. 주의: UserData 경고 1건
  t.set(
    I.userData,
    snap(I.userData, {
      [FILE_NAME.cloudformation]: cfn(59, USER_DATA_CFN),
      [FILE_NAME.terraform]: tf(60),
      [FILE_NAME.mapping]: mapping(60),
      [FILE_NAME.metadata]: metadata(I.userData, {
        cfn: 60,
        tf: 60,
        scan: { errors: 0, warnings: 1, rules: ['user-data'] },
      }),
    }),
  );
  // 1. 정상 (다른 리전)
  t.set(
    I.ok,
    snap(I.ok, {
      [FILE_NAME.cloudformation]: cfn(18),
      [FILE_NAME.terraform]: tf(18),
      [FILE_NAME.mapping]: mapping(18),
      [FILE_NAME.metadata]: metadata(I.ok, {
        region: 'us-east-1',
        cfn: 18,
        tf: 18,
        searchFilter: null,
      }),
    }),
  );
  // 4. 장애: metadata.json 손상
  t.set(
    I.metaCorrupt,
    snap(I.metaCorrupt, {
      [FILE_NAME.cloudformation]: cfn(30),
      [FILE_NAME.terraform]: tf(30),
      [FILE_NAME.mapping]: mapping(30),
      [FILE_NAME.metadata]:
        '{\n  "schemaVersion": 1,\n  "region": "ap-northeast-2",\n',
    }),
  );
  // 6. 주의: mapping 없음 + 예상 밖 파일
  t.set(
    I.mappingMissing,
    snap(I.mappingMissing, {
      [FILE_NAME.cloudformation]: cfn(3),
      [FILE_NAME.terraform]: tf(3),
      [FILE_NAME.metadata]: metadata(I.mappingMissing, {
        cfn: 3,
        tf: 3,
        searchFilter: 'prod-ekss',
      }),
      'notes.txt': '필터 오타로 거의 비어 있음\n',
      '.env': 'EXAMPLE_ONLY=1\n',
    }),
  );
  // 5. 장애: terraform.tf 없음
  t.set(
    I.tfMissing,
    snap(I.tfMissing, {
      [FILE_NAME.cloudformation]: cfn(25),
      [FILE_NAME.mapping]: mapping(25),
      [FILE_NAME.metadata]: metadata(I.tfMissing, { cfn: 25, tf: 25 }),
    }),
  );
  // 8. 라벨·메모 + 내보내기 후 편집 (CloudFormation 42 → 40), 대시보드에서 수정
  const labeledCfn = cfn(40);
  const labeled = snap(I.labeled, {
    [FILE_NAME.cloudformation]: labeledCfn,
    [FILE_NAME.terraform]: tf(42),
    [FILE_NAME.mapping]: mapping(42),
    [FILE_NAME.metadata]: metadata(I.labeled, { cfn: 42, tf: 42 }),
    [NOTES_FILE]: `${JSON.stringify(
      {
        schemaVersion: 1,
        tool: 'sentinel dashboard',
        snapshotId: I.labeled,
        label: 'EKS 1.30 업그레이드 전',
        memo: '노드그룹 m6i.large 3대 시점, 복원 기준',
        updatedAt: '2026-09-13T01:00:00.000Z',
        templateEdits: {
          cloudformation: {
            savedAt: '2026-09-13T01:05:00.000Z',
            version: sha256Version(Buffer.from(labeledCfn, 'utf8')),
          },
        },
      },
      null,
      2,
    )}\n`,
  });
  t.set(I.labeled, labeled);
  // 9. 편집 상한을 넘는 큰 템플릿
  bigCache ??= bigCfn();
  t.set(
    I.big,
    snap(I.big, {
      [FILE_NAME.cloudformation]: bigCache,
      [FILE_NAME.terraform]: tf(20),
      [FILE_NAME.mapping]: mapping(20),
      [FILE_NAME.metadata]: metadata(I.big, {
        cfn: (bigCache.match(/^\s+Type:\s*AWS::/gm) ?? []).length,
        tf: 20,
      }),
    }),
  );

  const trash = new Map<string, MemSnapshot>();
  const trashedId = '20260901-000000';
  trash.set(
    I.trash,
    snap(trashedId, {
      [FILE_NAME.cloudformation]: cfn(5),
      [FILE_NAME.terraform]: tf(5),
      [FILE_NAME.mapping]: mapping(5),
      [FILE_NAME.metadata]: metadata(trashedId, { cfn: 5, tf: 5 }),
      [NOTES_FILE]: `${JSON.stringify(
        {
          schemaVersion: 1,
          tool: 'sentinel dashboard',
          snapshotId: trashedId,
          label: '테스트 내보내기',
          memo: '',
          updatedAt: '2026-09-01T00:10:00.000Z',
        },
        null,
        2,
      )}\n`,
    }),
  );

  return { snapshots: t, trash, unrecognized: ['old-backup'] };
}

export function buildEmptyTree(): MemTree {
  return { snapshots: new Map(), trash: new Map(), unrecognized: [] };
}
