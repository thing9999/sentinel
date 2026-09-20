import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listRules, maskValue, scanPaths, scanText, summarize } from '../lib/scan.mjs';
import {
  countCloudFormationResources,
  countTerraformResources,
  extractAccountIds,
  maskAccountId,
} from '../lib/meta.mjs';

const rules = (text) => scanText(text).map((f) => f.rule);

describe('scanText: 양성 (잡아야 하는 것)', () => {
  const positives = [
    ['CFN 비밀번호', '            MasterUserPassword: "S3cretPassw0rd!"', 'secret-key-value'],
    ['HCL 비밀번호', '    master_password = "S3cretPassw0rd!"', 'secret-key-value'],
    ['JSON 토큰', '  "AuthToken": "abcdefghijkl",', 'secret-key-value'],
    ['따옴표 없는 YAML 값', '  ClientSecret: abcdef123456 # from console', 'secret-key-value'],
    ['SecretString 원문', "  SecretString: '{\"password\":\"x\"}'", 'secret-key-value'],
    ['AWS 액세스 키 ID', '  Value: AKIAIOSFODNN7EXAMPLE', 'aws-access-key-id'],
    ['AWS 임시 키 ID', 'key = "ASIAIOSFODNN7EXAMPLE"', 'aws-access-key-id'],
    ['AWS 비밀 키', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'aws-secret-access-key'],
    ['PEM 개인 키', '-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['OpenSSH 개인 키', '-----BEGIN OPENSSH PRIVATE KEY-----', 'private-key'],
    ['서명 URL', '  Location: https://s3.amazonaws.com/x?X-Amz-Security-Token=abc&X-Amz-Signature=def', 'presigned-url'],
    ['JWT', '  Value: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'jwt'],
    ['연결 문자열', '  DATABASE_URL: postgres://app:hunter2@db.internal:5432/app', 'url-credentials'],
    ['GitHub 토큰', '  Value: ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'vendor-token'],
    ['CFN Lambda 환경변수 블록', '            Environment:', 'env-block'],
    ['CFN Variables 블록', '                Variables:', 'env-block'],
    ['TF environment 블록', '  environment {', 'env-block'],
    ['TF variables 블록', '    variables = {', 'env-block'],
    ['JSON Environment 배열', '  "Environment": [', 'env-block'],
    ['CodeBuild EnvironmentVariables', '      EnvironmentVariables:', 'env-block'],
  ];
  for (const [name, line, rule] of positives) {
    it(name, () => assert.ok(rules(line).includes(rule), `${line} → ${JSON.stringify(rules(line))}`));
  }

  it('UserData·CA 데이터는 warn', () => {
    const f = scanText('    UserData: "IyEvYmluL2Jhc2g="\n  certificate-authority-data: LS0t');
    assert.deepEqual(f.map((x) => [x.rule, x.severity]), [['user-data', 'warn'], ['kubeconfig-ca', 'warn']]);
  });

  it('줄 번호와 파일 이름을 돌려준다', () => {
    const f = scanText('a: 1\nb: 2\nPassword: "abcdefgh"\n', 'cloudformation.yml');
    assert.deepEqual(f.map(({ file, line }) => [file, line]), [['cloudformation.yml', 3]]);
  });

  it('보고 메시지에 비밀값 원문이 들어가지 않는다', () => {
    const [f] = scanText('MasterUserPassword: "S3cretPassw0rd!"');
    assert.ok(!f.message.includes('S3cretPassw0rd!'));
    assert.ok(f.message.includes('S3****'));
  });
});

describe('scanText: 음성 (잡으면 안 되는 것)', () => {
  const negatives = [
    ['비밀번호 정책 설정', '      MinimumPasswordLength: 14'],
    ['비밀번호 정책 불리언', '      RequireSymbols: true'],
    ['시크릿 ARN', '      SecretArn: "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:db-AbCdEf"'],
    ['!Ref 참조', '      MasterUserPassword: !Ref DbPassword'],
    ['동적 참조', '      MasterUserPassword: "{{resolve:secretsmanager:prod/db:SecretString:password}}"'],
    ['TF 변수 참조', '  master_password = var.db_password'],
    ['TF 보간 참조', '  master_password = "${var.db_password}"'],
    ['빈 값', '  Password: ""'],
    ['블록 시작', '  SecretString: |'],
    ['자리표시자', '  password: <password>'],
    ['태그 Environment (TF)', '    Environment = "prod"'],
    ['태그 Environment (YAML 값)', '      Environment: dev'],
    ['태그 키', '        Key: "Environment"'],
    ['일반 리소스', '        Type: "AWS::EKS::Cluster"'],
    ['CIDR', '            CidrBlock: "10.0.0.0/16"'],
    ['ARN 역할', '            RoleArn: "arn:aws:iam::123456789012:role/eks-cluster-role"'],
    ['일반 URL', '  Endpoint: https://ABCDEF.gr7.ap-northeast-2.eks.amazonaws.com'],
    ['Terraform provider', '            source = "hashicorp/aws"'],
    ['TokenValidity 설정', '      AccessTokenValidity: 60'],
    ['EnableTokenRevocation', '      EnableTokenRevocation: true'],
  ];
  for (const [name, line] of negatives) {
    it(name, () => assert.deepEqual(scanText(line), []));
  }

  it('allow 마커가 있는 줄은 건너뛴다', () => {
    assert.deepEqual(scanText('            Environment:  # snapshot-scan: allow'), []);
  });
});

describe('summarize / scanPaths', () => {
  it('error 가 있으면 실패, warn 은 strict 일 때만 실패', () => {
    const warnOnly = scanText('UserData: "x"');
    assert.equal(summarize(warnOnly).passed, true);
    assert.equal(summarize(warnOnly, { strict: true }).passed, false);
    assert.equal(summarize(scanText('Password: "abcdefgh"')).passed, false);
    assert.deepEqual(summarize([]), { errors: 0, warnings: 0, strict: false, passed: true });
  });

  it('폴더를 재귀로 스캔하고 템플릿 확장자만 읽는다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-snapshot-scan-'));
    try {
      fs.mkdirSync(path.join(dir, 'a'));
      fs.writeFileSync(path.join(dir, 'a', 'cloudformation.yml'), 'Password: "abcdefgh"\n');
      fs.writeFileSync(path.join(dir, 'terraform.tf'), 'name = "ok"\n');
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'Password: "abcdefgh"\n');
      const { files, findings } = scanPaths([dir]);
      assert.equal(files.length, 2);
      assert.equal(findings.length, 1);
      assert.ok(findings[0].file.endsWith('cloudformation.yml'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('폴더를 돌 때 대시보드 휴지통(.trash)은 건너뛰고, 직접 준 경로면 스캔한다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-snapshot-scan-'));
    try {
      const trashed = path.join(dir, '.trash', '20260915-101010__20260919T050210123Z');
      fs.mkdirSync(trashed, { recursive: true });
      fs.writeFileSync(path.join(trashed, 'terraform.tf'), 'Password: "abcdefgh"\n');
      fs.mkdirSync(path.join(dir, '20260919-031500'));
      fs.writeFileSync(path.join(dir, '20260919-031500', 'terraform.tf'), 'name = "ok"\n');
      const whole = scanPaths([dir]);
      assert.equal(whole.files.length, 1);
      assert.equal(whole.findings.length, 0);
      const direct = scanPaths([path.join(dir, '.trash')]);
      assert.equal(direct.findings.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listRules: 규칙 ID·등급·설명 (정규식 없음), secret-key-value 포함', () => {
    const rules = listRules();
    const ids = rules.map((r) => r.id);
    assert.ok(ids.includes('env-block'));
    assert.equal(ids.at(-1), 'secret-key-value');
    for (const r of rules) {
      assert.deepEqual(Object.keys(r).sort(), ['description', 'id', 'severity']);
      assert.ok(r.severity === 'error' || r.severity === 'warn');
    }
    // scanText 가 내는 규칙은 모두 목록에 있다
    const hit = scanText('UserData: x\nPassword: "abcdefgh"\nenvironment {\n');
    for (const f of hit) assert.ok(ids.includes(f.rule), f.rule);
  });
});

describe('meta', () => {
  it('ARN 에서 계정 ID 를 뽑고 마스킹한다', () => {
    const ids = extractAccountIds('arn:aws:iam::123456789012:role/x', 'arn:aws:eks:ap-northeast-2:210987654321:cluster/y arn:aws:s3:::bucket');
    assert.deepEqual(ids, ['123456789012', '210987654321']);
    assert.equal(maskAccountId('123456789012'), '********9012');
  });
  it('리소스 개수를 센다', () => {
    assert.equal(countCloudFormationResources('Resources:\n    A:\n        Type: "AWS::EKS::Cluster"\n    B:\n        Type: AWS::EC2::VPC\n'), 2);
    assert.equal(countCloudFormationResources('# No resources generated'), 0);
    assert.equal(countTerraformResources('resource "aws_vpc" "A" {\n}\nresource "aws_eks_cluster" "B" {}\n'), 2);
  });
  it('maskValue', () => {
    assert.equal(maskValue('abc'), '****');
    assert.equal(maskValue('abcdef'), 'ab****(6자)');
  });
});

// ---------------------------------------------------------------------------
// k8s-snapshot (docs/api/k8s-snapshot.md 2절): profile 옵션. AWS 결과는 바뀌지 않아야 한다.
// ---------------------------------------------------------------------------
const CORPUS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'scan-corpus');
const BASELINE = path.join(CORPUS_DIR, '..', 'scan-corpus-aws-baseline.json');

describe('profile: AWS 스캔 결과 불변', () => {
  it('코퍼스 결과가 k8s 규칙 추가 전 기준선과 같다 (인자 없음·aws 프로필)', () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    for (const f of Object.keys(base)) {
      const text = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8');
      assert.deepEqual(scanText(text, f), base[f], f);
      assert.deepEqual(scanText(text, f, { profile: 'aws' }), base[f], f);
    }
  });
  it('aws 프로필 결과에 k8s 규칙이 없다', () => {
    const text = fs.readFileSync(path.join(CORPUS_DIR, 'k8s-like.yaml'), 'utf8');
    assert.ok(scanText(text).every((f) => !f.rule.startsWith('k8s-')));
  });
  it('listRules() 인자 없음은 k8s 규칙을 포함하지 않는다', () => {
    const ids = listRules().map((r) => r.id);
    assert.ok(ids.every((id) => !id.startsWith('k8s-')));
    assert.equal(ids.at(-1), 'secret-key-value');
  });
  it('listRules({profile:k8s}) 는 공통 + k8s 5개, secret-key-value 는 마지막', () => {
    const ids = listRules({ profile: 'k8s' }).map((r) => r.id);
    for (const id of ['k8s-env-literal', 'k8s-secret-object', 'k8s-dockerconfig', 'k8s-configmap-secretish', 'k8s-last-applied'])
      assert.ok(ids.includes(id), id);
    assert.equal(ids.at(-1), 'secret-key-value');
    assert.equal(ids.length, listRules().length + 5);
  });
});

describe('profile k8s: 쿠버네티스 규칙', () => {
  const k8s = (text) => scanText(text, 'f.yaml', { profile: 'k8s' });
  const envYaml = (value, name = 'POSTGRES_PASSWORD') =>
    ['spec:', '  containers:', '    - name: pg', '      env:', `        - name: ${name}`, `          value: ${value}`].join('\n');
  const only = (list, rule) => list.filter((x) => x.rule === rule);

  it('k8s-env-literal: 비밀값 이름 + 리터럴 → 오류, value 줄, 값 원문 없음', () => {
    const f = only(k8s(envYaml('example-password')), 'k8s-env-literal');
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 6);
    assert.equal(f[0].severity, 'error');
    assert.ok(!f[0].message.includes('example-password'));
  });
  it('k8s-env-literal: valueFrom·자리표시자·$(VAR)·비밀 아닌 이름·allow 는 통과', () => {
    const vf = ['env:', '- name: DB_PASSWORD', '  valueFrom:', '    secretKeyRef:', '      name: pg', '      key: password'].join('\n');
    assert.equal(only(k8s(vf), 'k8s-env-literal').length, 0);
    assert.equal(only(k8s(envYaml('<POSTGRES_PASSWORD>')), 'k8s-env-literal').length, 0);
    assert.equal(only(k8s(envYaml('$(OTHER_VAR)')), 'k8s-env-literal').length, 0);
    assert.equal(only(k8s(envYaml('info', 'LOG_LEVEL')), 'k8s-env-literal').length, 0);
    assert.equal(k8s(envYaml('x-real-value # snapshot-scan: allow')).length, 0);
  });
  it('k8s-env-literal: 흐름 매핑·순서 바뀜·블록 스칼라·같은 들여쓰기 목록', () => {
    assert.equal(only(k8s('env:\n- {name: API_TOKEN, value: abcdefgh}'), 'k8s-env-literal').length, 1);
    assert.equal(only(k8s('env:\n  - value: abcdefgh\n    name: API_TOKEN'), 'k8s-env-literal').length, 1);
    assert.equal(only(k8s('env:\n- name: A_SECRET\n  value: |\n    multi\n'), 'k8s-env-literal').length, 1);
  });
  it('k8s-secret-object: kind Secret 의 data/stringData 값마다 오류', () => {
    const t = ['apiVersion: v1', 'kind: Secret', 'metadata:', '  name: s', 'data:', '  username: YWRtaW4=', '  other: ""'].join('\n');
    const f = only(k8s(t), 'k8s-secret-object');
    assert.equal(f.length, 1);
    assert.equal(f[0].line, 6);
    assert.ok(!f[0].message.includes('YWRtaW4='));
  });
  it('k8s-secret-object: 다른 문서의 kind 와 섞이지 않는다', () => {
    const t = ['kind: ConfigMap', 'data:', '  a: b', '---', 'kind: Secret', 'metadata: {name: x}'].join('\n');
    assert.equal(only(k8s(t), 'k8s-secret-object').length, 0);
  });
  it('k8s-dockerconfig: .dockerconfigjson 값, 한 줄 JSON auths, 블록 auths.auth', () => {
    assert.ok(only(k8s('  .dockerconfigjson: eyJhdXRocyI6e319'), 'k8s-dockerconfig').length);
    assert.ok(only(k8s('x: \'{"auths":{"r.io":{"auth":"dXNlcjpwYXNz"}}}\''), 'k8s-dockerconfig').length);
    assert.ok(only(k8s('auths:\n  r.io:\n    auth: dXNlcjpwYXNz'), 'k8s-dockerconfig').length);
  });
  it('k8s-configmap-secretish: 키 이름만 경고, 같은 줄에 secret-key-value 가 있으면 중복 없음', () => {
    const t = ['kind: ConfigMap', 'data:', '  DB_PASSWORD: ""', '  API_TOKEN: real-token-value', '  LOG_LEVEL: info'].join('\n');
    const f = k8s(t);
    assert.deepEqual(only(f, 'k8s-configmap-secretish').map((x) => x.line), [3]);
    assert.deepEqual(only(f, 'secret-key-value').map((x) => x.line), [4]);
  });
  it('k8s-last-applied: 경고', () => {
    const f = k8s('  annotations:\n    kubectl.kubernetes.io/last-applied-configuration: |\n      {}');
    assert.equal(f.filter((x) => x.rule === 'k8s-last-applied' && x.severity === 'warn').length, 1);
    // JSON 키 형태도 잡는다
    const j = k8s('{\n  "annotations": {\n    "kubectl.kubernetes.io/last-applied-configuration": "{}"\n  }\n}');
    assert.equal(j.filter((x) => x.rule === 'k8s-last-applied').length, 1);
  });
  it('k8s-last-applied: metadata.json 정리 규칙 요약(값 안의 이름)은 걸리지 않는다', () => {
    const meta = [
      '{',
      '  "cleanup": {',
      '    "rulesVersion": 1,',
      '    "summary": [',
      '      "metadata.annotations[\\"kubectl.kubernetes.io/last-applied-configuration\\"]",',
      '      "status"',
      '    ]',
      '  }',
      '}',
    ].join('\n');
    assert.deepEqual(scanText(meta, 'metadata.json', { profile: 'k8s' }), []);
  });
  it('일반적인 CLI 출력 YAML(secretKeyRef, imagePullSecrets, automountServiceAccountToken) 은 발견 없음', () => {
    const t = [
      'apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: api', '  namespace: prod', 'spec:', '  template:', '    spec:',
      '      automountServiceAccountToken: false', '      imagePullSecrets:', '        - name: ecr-pull', '      containers:', '        - name: api',
      '          image: repo/api:1.0', '          env:', '            - name: LOG_LEVEL', '              value: info', '            - name: DB_PASSWORD',
      '              valueFrom:', '                secretKeyRef:', '                  name: pg', '                  key: password',
      '      volumes:', '        - name: tls', '          secret:', '            secretName: tls-cert',
    ].join('\n');
    assert.deepEqual(k8s(t), []);
  });
  it('scanPaths k8s: .trash 와 .<id>.partial 폴더를 건너뛴다 (aws 프로필은 .partial 을 건너뛰지 않음)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-scan-'));
    try {
      for (const d of ['20260919-000000', '.trash/x', '.20260919-010000.partial']) {
        fs.mkdirSync(path.join(dir, d), { recursive: true });
        fs.writeFileSync(path.join(dir, d, 'a.yaml'), 'password: realvalue1\n');
      }
      assert.equal(scanPaths([dir], { profile: 'k8s' }).files.length, 1);
      assert.equal(scanPaths([dir]).files.length, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
