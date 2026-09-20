/**
 * 회귀 테스트 (k8s-snapshot 10.1): informer 목록 함수를 타입 API → 원본 JSON 으로 바꿨다.
 * 같은 객체를 (1) ObjectSerializer 로 변환한 타입 객체 (이전 목록 함수 결과)와 (2) 원본 JSON (새 목록 함수·watch 결과)으로
 * extract*() 에 넣었을 때 화면용 결과가 완전히 같아야 한다.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { KubeConfig } from '@kubernetes/client-node';
// 이전 목록 함수(타입 API)가 쓰던 것과 같은 변환기
import { ObjectSerializer } from '@kubernetes/client-node/dist/gen/models/ObjectSerializer.js';
import {
  extractDaemonSet,
  extractDeployment,
  extractEvent,
  extractHpa,
  extractIngress,
  extractNode,
  extractPdb,
  extractPod,
  extractPvc,
  extractService,
  extractStatefulSet,
} from './extract';
import { makeRawLister, RawListError } from './raw-list';

const T = '2026-09-19T05:00:00Z';
const meta = (name: string, ns?: string) => ({
  name,
  ...(ns ? { namespace: ns } : {}),
  uid: `uid-${name}`,
  creationTimestamp: T,
  labels: { app: name, 'eks.amazonaws.com/nodegroup': 'ng-1' },
  annotations: {
    'service.beta.kubernetes.io/aws-load-balancer-type': 'nlb',
    'alb.ingress.kubernetes.io/group.name': 'grp',
  },
  ownerReferences: [
    {
      apiVersion: 'apps/v1',
      kind: 'ReplicaSet',
      name: 'rs',
      uid: 'x',
      controller: true,
    },
  ],
});
const cond = (type: string) => ({
  type,
  status: 'True',
  lastTransitionTime: T,
  lastUpdateTime: T,
  reason: 'R',
  message: 'm',
});
const container = {
  name: 'app',
  image: 'repo/app:1.0',
  resources: {
    requests: { cpu: '250m', memory: '256Mi' },
    limits: { cpu: '1', memory: '1Gi' },
  },
  readinessProbe: { httpGet: { path: '/', port: 8080 } },
  securityContext: {
    privileged: false,
    allowPrivilegeEscalation: false,
    runAsNonRoot: true,
  },
  env: [{ name: 'X', value: 'y' }],
};
const podSpec = {
  containers: [container],
  initContainers: [{ ...container, name: 'init' }],
  volumes: [
    { name: 'd', persistentVolumeClaim: { claimName: 'data' } },
    { name: 'h', hostPath: { path: '/x' } },
  ],
  serviceAccountName: 'sa',
  automountServiceAccountToken: false,
  hostNetwork: true,
  securityContext: { runAsNonRoot: true },
  nodeName: 'node-1',
};
const cstatus = (name: string) => ({
  name,
  ready: true,
  restartCount: 2,
  image: 'x',
  imageID: 'y',
  state: { running: { startedAt: T } },
  lastState: {
    terminated: {
      reason: 'OOMKilled',
      exitCode: 137,
      startedAt: T,
      finishedAt: T,
    },
  },
});

const CASES: [string, unknown, (o: never) => unknown][] = [
  [
    'V1Node',
    {
      metadata: meta('node-1'),
      spec: { providerID: 'aws:///x/i-1', unschedulable: true },
      status: {
        allocatable: { cpu: '1930m', memory: '7Gi', pods: '29' },
        capacity: { cpu: '2', memory: '8Gi', pods: '29' },
        conditions: [cond('Ready')],
        nodeInfo: { kubeletVersion: 'v1.34.1' },
      },
    },
    extractNode,
  ],
  [
    'V1Pod',
    {
      metadata: meta('pod-1', 'prod'),
      spec: podSpec,
      status: {
        phase: 'Running',
        podIP: '10.0.0.1',
        qosClass: 'Burstable',
        startTime: T,
        conditions: [cond('Ready')],
        containerStatuses: [cstatus('app')],
        initContainerStatuses: [
          {
            ...cstatus('init'),
            state: {
              terminated: { reason: 'Completed', exitCode: 0, finishedAt: T },
            },
          },
        ],
      },
    },
    extractPod,
  ],
  [
    'V1Deployment',
    {
      metadata: { ...meta('api', 'prod'), generation: 4 },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: 'api' } },
        template: { metadata: { labels: { app: 'api' } }, spec: podSpec },
      },
      status: {
        readyReplicas: 2,
        updatedReplicas: 3,
        availableReplicas: 2,
        observedGeneration: 4,
        conditions: [cond('Available')],
      },
    },
    extractDeployment,
  ],
  [
    'V1StatefulSet',
    {
      metadata: meta('pg', 'data'),
      spec: {
        replicas: 1,
        serviceName: 'pg',
        selector: { matchLabels: { app: 'pg' } },
        template: { metadata: { labels: { app: 'pg' } }, spec: podSpec },
        volumeClaimTemplates: [
          {
            metadata: { name: 'data' },
            spec: { resources: { requests: { storage: '10Gi' } } },
          },
        ],
      },
      status: {
        replicas: 1,
        readyReplicas: 1,
        currentRevision: 'a',
        updateRevision: 'b',
        conditions: [cond('X')],
      },
    },
    extractStatefulSet,
  ],
  [
    'V1DaemonSet',
    {
      metadata: meta('ds', 'kube-system'),
      spec: {
        selector: { matchLabels: { app: 'ds' } },
        template: { spec: podSpec },
      },
      status: {
        desiredNumberScheduled: 3,
        numberReady: 2,
        updatedNumberScheduled: 3,
        numberAvailable: 2,
        numberMisscheduled: 0,
        currentNumberScheduled: 3,
        conditions: [cond('X')],
      },
    },
    extractDaemonSet,
  ],
  [
    'CoreV1Event',
    {
      metadata: meta('ev', 'prod'),
      type: 'Warning',
      reason: 'BackOff',
      message: 'back-off',
      count: 3,
      firstTimestamp: T,
      lastTimestamp: T,
      eventTime: T,
      series: { count: 5, lastObservedTime: T },
      involvedObject: { kind: 'Pod', namespace: 'prod', name: 'p' },
      source: { component: 'kubelet' },
    },
    extractEvent,
  ],
  [
    'V1PersistentVolumeClaim',
    {
      metadata: meta('data', 'prod'),
      spec: {
        resources: { requests: { storage: '10Gi' } },
        storageClassName: 'gp3',
        volumeName: 'pv-1',
      },
      status: { phase: 'Bound', capacity: { storage: '10Gi' } },
    },
    extractPvc,
  ],
  [
    'V1Service',
    {
      metadata: meta('svc', 'prod'),
      spec: {
        type: 'LoadBalancer',
        loadBalancerClass: 'service.k8s.aws/nlb',
        ports: [{ port: 80 }],
      },
      status: {
        loadBalancer: { ingress: [{ hostname: 'x.elb.amazonaws.com' }] },
      },
    },
    extractService,
  ],
  [
    'V1Ingress',
    {
      metadata: meta('ing', 'prod'),
      spec: { ingressClassName: 'alb' },
      status: {
        loadBalancer: { ingress: [{ hostname: 'y.elb.amazonaws.com' }] },
      },
    },
    extractIngress,
  ],
  [
    'V1PodDisruptionBudget',
    {
      metadata: meta('pdb', 'prod'),
      spec: {
        selector: {
          matchLabels: { app: 'api' },
          matchExpressions: [{ key: 'k', operator: 'In', values: ['a'] }],
        },
      },
    },
    extractPdb,
  ],
  [
    'V2HorizontalPodAutoscaler',
    {
      metadata: meta('hpa', 'prod'),
      spec: {
        scaleTargetRef: {
          kind: 'Deployment',
          name: 'api',
          apiVersion: 'apps/v1',
        },
        minReplicas: 2,
        maxReplicas: 5,
      },
      status: { currentReplicas: 3, desiredReplicas: 3 },
    },
    extractHpa,
  ],
];

describe('extract*(): 원본 JSON 과 타입 객체의 결과가 같다 (informer 목록 함수 교체 회귀)', () => {
  for (const [type, raw, fn] of CASES) {
    it(type, () => {
      const typed = ObjectSerializer.deserialize(
        JSON.parse(JSON.stringify(raw)),
        type,
        '',
      ) as never;
      const fromTyped = fn(typed);
      const fromRaw = fn(JSON.parse(JSON.stringify(raw)) as never);
      expect(fromRaw).toEqual(fromTyped);
      // 타입 객체는 시각이 Date 였다 (원본은 문자열) — 그래도 결과가 같다
      expect(JSON.stringify(fromRaw)).not.toContain('Invalid');
    });
  }
});

describe('makeRawLister: GET 원본 JSON', () => {
  let server: Server;
  let port = 0;
  const seen: { method: string; url: string }[] = [];
  const body = {
    kind: 'DeploymentList',
    apiVersion: 'apps/v1',
    metadata: { resourceVersion: '42' },
    items: [
      {
        metadata: { name: 'api', namespace: 'prod', creationTimestamp: T },
        spec: { futureField: { x: 1 } },
      },
    ],
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '' });
      if (req.url === '/forbidden') {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const kc = () => {
    const k = new KubeConfig();
    k.loadFromOptions({
      clusters: [
        { name: 'c', server: `http://127.0.0.1:${port}`, skipTLSVerify: true },
      ],
      users: [{ name: 'u', token: 't' }],
      contexts: [{ name: 'x', cluster: 'c', user: 'u' }],
      currentContext: 'x',
    });
    return k;
  };

  it('모르는 필드·문자열 시각·resourceVersion 을 그대로 준다', async () => {
    const list = await makeRawLister(kc(), '/apis/apps/v1/deployments')();
    expect(list).toEqual(body);
    expect(seen.at(-1)).toEqual({
      method: 'GET',
      url: '/apis/apps/v1/deployments',
    });
  });

  it('403 은 statusCode 403 오류 (informer 권한 처리 그대로)', async () => {
    await expect(makeRawLister(kc(), '/forbidden')()).rejects.toMatchObject({
      statusCode: 403,
      code: 403,
    });
    await expect(makeRawLister(kc(), '/forbidden')()).rejects.toBeInstanceOf(
      RawListError,
    );
  });
});
