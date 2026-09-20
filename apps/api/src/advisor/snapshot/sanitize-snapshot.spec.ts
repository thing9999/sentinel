import {
  cleanImage,
  isIpLikeNodeName,
  looksSecret,
  REDACTED,
  sanitizeSnapshot,
} from './sanitize-snapshot';

/** 기여자가 실수로 원본 객체 조각을 섞어 보낸 경우 */
function hostileInput() {
  return {
    meta: { generatedAt: '2026-09-19T05:00:00.000Z', dataSource: 'live' },
    cluster: {
      version: '1.30',
      region: 'ap-northeast-2',
      nodeCount: 1,
      arn: 'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod',
    },
    nodes: [
      {
        name: 'ip-10-0-12-34.ap-northeast-2.compute.internal',
        nodeGroup: 'general',
        instanceType: 'm6i.large',
        internalIP: '10.0.12.34',
        providerID: 'aws:///ap-northeast-2a/i-0abc1234def567890',
        allocatable: { cpuMillicores: 1930, memoryBytes: 1, pods: 29 },
        cpu: { requestsPct: 10 },
        memory: { requestsPct: 10 },
        status: 'ok',
        reasonCodes: ['NODE_READY', 'free text with spaces'],
        labels: { 'kubernetes.io/hostname': 'ip-10-0-12-34' },
      },
    ],
    workloads: [
      {
        kind: 'Deployment',
        namespace: 'prod',
        name: 'api',
        desired: 2,
        ready: 2,
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration':
            '{"spec":{"env":[{"name":"DB_PASSWORD","value":"hunter2"}]}}',
        },
        labels: {
          'app.kubernetes.io/name': 'api',
          'app.kubernetes.io/version': 'AKIAABCDEFGHIJKLMNOP',
          team: 'payments',
        },
        containers: [
          {
            name: 'api',
            image:
              '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2@sha256:' +
              'a'.repeat(64),
            env: [{ name: 'DB_PASSWORD', value: 'hunter2' }],
            envFrom: [{ secretRef: { name: 'db-secret' } }],
            command: ['/bin/sh', '-c', 'export TOKEN=abc && ./run'],
            args: ['--password=hunter2'],
            requests: { cpuMillicores: 100, memoryBytes: 1 },
            limits: { cpuMillicores: null, memoryBytes: null },
            probes: { readiness: true, liveness: true },
            security: {
              privileged: false,
              allowPrivilegeEscalation: false,
              runAsNonRoot: true,
            },
          },
        ],
        podSecurity: {
          hostNetwork: false,
          hostPID: false,
          hostPath: false,
          defaultServiceAccount: false,
          automountToken: false,
        },
      },
    ],
    storage: [
      {
        namespace: 'data',
        name: 'pg',
        volumeType: 'gp2',
        volumeRef: 'vol-0a1b2c3d4e5f60718',
        attached: true,
      },
    ],
    loadBalancers: [
      {
        ref: 'arn:aws:elasticloadbalancing:ap-northeast-2:123456789012:loadbalancer/app/k8s-prod/abc',
        type: 'alb',
        attachedTo: [],
        healthyTargets: 1,
      },
    ],
    events: {
      byReason: [
        {
          reason: 'BackOff',
          kind: 'Pod',
          count: 3,
          message:
            'Back-off restarting failed container api in pod api-7d9 (10.0.1.5)',
        },
      ],
    },
    db: {
      vendor: 'postgres',
      version: '16.4',
      replicas: 1,
      connections: { currentPct: 10, maxObservedPct: 20, max: 100 },
      sessions: [
        {
          user: 'app_user',
          clientAddr: '10.0.3.4',
          query: 'select * from users where password = $1',
        },
      ],
      locks: { items: [{ user: 'postgres' }] },
      databases: [{ name: 'app', bytes: 10, owner: 'app_user' }],
      resources: { qosClass: 'Burstable', requestsSet: true, limitsSet: false },
    },
  };
}

describe('sanitizeSnapshot (허용 목록 + 가명 + 비밀값 검사)', () => {
  const { snapshot, redactedFields, pseudonyms } =
    sanitizeSnapshot(hostileInput());
  const text = JSON.stringify(snapshot);

  it('환경 변수·envFrom·command/args·어노테이션 원문이 전혀 없다 (명세 수용 기준)', () => {
    expect(text).not.toContain('DB_PASSWORD');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db-secret');
    expect(text).not.toContain('last-applied-configuration');
    expect(text).not.toContain('/bin/sh');
    expect(text).not.toMatch(/"(env|envFrom|command|args|annotations)"/);
  });

  it('레이블 값의 AWS 액세스 키 형식 → "[가림]" + 가림 1건', () => {
    const w = snapshot.workloads[0];
    expect(w.labels['app.kubernetes.io/version']).toBe(REDACTED);
    expect(snapshot.meta.redactedCount).toBe(1);
    expect(redactedFields).toEqual([
      'workloads[prod/api].labels.app.kubernetes.io/version',
    ]);
  });

  it('표준 외 레이블·노드 레이블은 버린다', () => {
    expect(snapshot.workloads[0].labels).toEqual({
      'app.kubernetes.io/name': 'api',
      'app.kubernetes.io/version': REDACTED,
    });
    expect(text).not.toContain('payments');
    expect(text).not.toContain('kubernetes.io/hostname');
  });

  it('IP 형태 노드 이름은 가명, 매핑은 api 메모리에만', () => {
    expect(snapshot.nodes[0].name).toBe('general-node-1');
    expect(pseudonyms.nodes['general-node-1']).toBe(
      'ip-10-0-12-34.ap-northeast-2.compute.internal',
    );
    expect(text).not.toContain('10-0-12-34');
    expect(text).not.toContain('10.0.12.34');
    expect(text).not.toContain('i-0abc');
    expect(snapshot.meta.pseudonyms).toEqual({
      nodes: 1,
      volumes: 1,
      loadBalancers: 1,
    });
  });

  it('볼륨 ID·LB ARN은 가명, 계정 ID·ARN 없음', () => {
    expect(snapshot.storage[0].volumeRef).toBe('vol-1');
    expect(snapshot.loadBalancers[0].ref).toBe('lb-1');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('arn:aws');
  });

  it('이미지는 저장소 이름:태그만 (레지스트리 호스트·digest 제거)', () => {
    expect(snapshot.workloads[0].containers[0].image).toBe('api:1.4.2');
    expect(cleanImage('docker.io/library/nginx:1.27')).toBe(
      'library/nginx:1.27',
    );
    expect(cleanImage('nginx')).toBe('nginx');
    expect(cleanImage('localhost:5000/app:dev')).toBe('app:dev');
  });

  it('이벤트는 개수만, 메시지 없음', () => {
    expect(snapshot.events.byReason).toEqual([
      { reason: 'BackOff', kind: 'Pod', count: 3 },
    ]);
    expect(text).not.toContain('Back-off restarting');
  });

  it('DB 블록: 사용자 이름·클라이언트 주소·쿼리 원문 없음 (DBA 9절)', () => {
    expect(text).not.toContain('app_user');
    expect(text).not.toContain('10.0.3.4');
    expect(text).not.toContain('select * from');
    expect(snapshot.db?.databases).toEqual([{ name: 'app', bytes: 10 }]);
  });

  it('사유 코드는 코드 형식만', () => {
    expect(snapshot.nodes[0].reasonCodes).toEqual(['NODE_READY']);
  });

  it('멱등: 다시 정제해도 같은 결과, 가림 수 유지', () => {
    const again = sanitizeSnapshot(snapshot, pseudonyms);
    expect(again.snapshot).toEqual(snapshot);
    expect(again.redactedFields).toEqual([]);
  });

  it('이름 필드도 비밀값 검사 대상', () => {
    const r = sanitizeSnapshot({
      workloads: [
        {
          kind: 'Deployment',
          namespace: 'prod',
          name: 'token=abcdef',
          containers: [],
        },
      ],
    });
    expect(r.snapshot.workloads[0].name).toBe(REDACTED);
    expect(r.snapshot.meta.redactedCount).toBe(1);
  });
});

describe('looksSecret', () => {
  it.each([
    ['AKIAABCDEFGHIJKLMNOP', true],
    ['password=hunter2', true],
    ['-----BEGIN RSA PRIVATE KEY-----', true],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk', true],
    ['0123456789abcdef0123456789abcdef', true],
    ['dGhpc0lzQVZlcnlMb25nQmFzZTY0U3RyaW5nMTIzNDU2', true],
    ['postgres://u:secret@db:5432/app', true],
    ['my-very-long-deployment-name-for-the-payment-service', false],
    ['api:1.4.2', false],
    ['1.30', false],
    ['2026-09-19T05:00:00.000Z', false],
  ])('%s → %s', (s, expected) => {
    expect(looksSecret(s)).toBe(expected);
  });

  it('IP 형태 노드 이름 판별', () => {
    expect(isIpLikeNodeName('ip-10-0-12-34.ec2.internal')).toBe(true);
    expect(isIpLikeNodeName('worker-a')).toBe(false);
  });
});
