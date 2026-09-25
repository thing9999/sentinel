/**
 * k8s-snapshot 계약(docs/api/k8s-snapshot.md) 예시 모양의 테스트 픽스처.
 * 값은 계약 예시·mock 기본 시나리오(14.2·14.3)를 따른다. 비밀값은 누가 봐도 가짜인 값만.
 */
import type { StatusInfo } from "../common/types";
import type {
  DriftBadge,
  DriftResponse,
  K8sCli,
  K8sDetailResponse,
  K8sFileCheck,
  K8sFileInfo,
  K8sFileResponse,
  K8sListResponse,
  K8sSnapshotDetailData,
  K8sSnapshotListItem,
  K8sSnapshotSummary,
  K8sTrashResponse,
} from "../k8s-snapshots/types";
import type { SnapshotMenuPayload } from "../snapshot-menu/types";

export const T = "2026-09-19T06:12:00.000Z";
export const CLUSTER_ID = "7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e";
const V = (c: string) => `sha256:${c.repeat(64)}`;

const st = (status: StatusInfo["status"], reasons: StatusInfo["reasons"] = [], stale = false): StatusInfo => ({
  status,
  reasons,
  updatedAt: T,
  statusChangedAt: T,
  stale,
});

const ALLOW = { allowed: true, reasonCode: null, reasonText: null };

export function driftBadge(over: Partial<DriftBadge> = {}): DriftBadge {
  return {
    status: st("warning", [{ code: "DRIFT_DIFF", text: "차이 3건 (변경 1 · 삭제 1 · 추가 1)", status: "warning" }]),
    mode: "auto",
    computing: false,
    computed: true,
    computedAt: "2026-09-19T06:11:40.000Z",
    lastResultStatus: "warning",
    counts: { compared: 24, same: 21, added: 1, deleted: 1, changed: 1, hidden: { default: 14, managed: 1 }, uncomparable: 11, unparsable: 0 },
    resultAvailable: true,
    ...over,
  };
}

export const NOT_COMPUTED: DriftBadge = {
  status: st("unknown", [{ code: "DRIFT_NOT_COMPUTED", text: "계산 안 함", status: "unknown" }]),
  mode: "none",
  computing: false,
  computed: false,
  computedAt: null,
  lastResultStatus: null,
  counts: null,
  resultAvailable: false,
};

export const MISMATCH: DriftBadge = {
  ...NOT_COMPUTED,
  status: st("unknown", [{ code: "CLUSTER_MISMATCH", text: "다른 클러스터의 스냅샷 (staging.k8s.example.com)", status: "unknown" }]),
};

export const LAST_RESULT_OK: DriftBadge = {
  status: st("unknown", [{ code: "DRIFT_NOT_COMPUTED", text: "계산 안 함", status: "unknown" }]),
  mode: "last_result",
  computing: false,
  computed: true,
  computedAt: "2026-09-18T05:02:00.000Z",
  lastResultStatus: "ok",
  counts: { compared: 24, same: 24, added: 0, deleted: 0, changed: 0, hidden: { default: 10, managed: 0 }, uncomparable: 11, unparsable: 0 },
  resultAvailable: true,
};

export function k8sSummary(over: Partial<K8sSnapshotSummary> = {}): K8sSnapshotSummary {
  return {
    status: st("critical", [{ code: "SNAPSHOTS_COMMIT_BLOCKED", text: "커밋 금지 스냅샷 1개", status: "critical" }]),
    counts: { total: 4, critical: 1, warning: 0, unknown: 0, ok: 3 },
    unrecognized: { count: 0, names: [] },
    trashCount: 1,
    root: { configured: true, displayPath: "deploy/k8s-snapshot/snapshots", state: "mock", setup: null },
    writable: ALLOW,
    lastCheckedAt: T,
    limits: { editMaxBytes: 5242880, viewMaxBytes: 20971520, inProgressMinutes: 30, labelMaxLength: 60, memoMaxLength: 2000 },
    dashboardCluster: { state: "ok", id: CLUSTER_ID, name: "prod.k8s.example.com", context: "prod.k8s.example.com", serverVersion: "v1.34.1" },
    latestDrift: { snapshotId: "20260919-061000", drift: driftBadge() },
    ...over,
  };
}

export const K8S_CLI: K8sCli = {
  install: "npm install --prefix deploy/k8s-snapshot",
  configure: "deploy/k8s-snapshot/.env.example 을 .env 로 복사한 뒤 KUBE_CONTEXT 를 채우세요",
  dryRun: "npm run export:dry --prefix deploy/k8s-snapshot",
  export: "npm run export --prefix deploy/k8s-snapshot",
  scan: "npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>",
  readme: "deploy/k8s-snapshot/README.md",
  settings: [
    { name: "KUBE_CONTEXT", required: true, text: "내보내기 전용 컨텍스트 이름 (필수, 비우면 종료코드 2)" },
    { name: "KUBECONFIG", required: false, text: "kubeconfig 경로 (비우면 사용자 기본)" },
  ],
  exitCodes: [
    { code: 0, text: "성공, 스캔 통과" },
    { code: 1, text: "비밀값 의심 — 커밋 금지, 정리 후 재스캔" },
    { code: 2, text: "설정 오류 (폴더 없음)" },
    { code: 3, text: "클러스터 접속 실패·권한 없음·리소스 0개 (폴더 지움)" },
    { code: 4, text: "부분 성공 — 일부 종류를 읽지 못함 (metadata.kinds 확인)" },
  ],
};

function item(over: Partial<K8sSnapshotListItem> & { id: string }): K8sSnapshotListItem {
  return {
    snapshotAt: `${over.id.slice(0, 4)}-${over.id.slice(4, 6)}-${over.id.slice(6, 8)}T${over.id.slice(9, 11)}:${over.id.slice(11, 13)}:00.000Z`,
    status: st("ok"),
    drift: NOT_COMPUTED,
    label: null,
    memo: null,
    notesUpdatedAt: null,
    cluster: { id: CLUSTER_ID, context: "sentinel-snapshot", name: "prod.k8s.example.com", serverVersion: "v1.34.1", relation: "same" },
    scope: {
      namespaceMode: "all_except_system",
      namespaces: ["batch", "data", "default", "monitoring", "prod"],
      missingNamespaces: [],
      excludeNamespaces: [],
      systemIncluded: [],
      kindCount: 17,
      optionalKinds: [],
      customResources: [],
      includeHelmManaged: true,
    },
    resources: { current: { total: 35, files: 35 }, atExport: { total: 35 }, changedSinceExport: false, previous: { snapshotId: "20260918-230000", total: 34 }, delta: 1 },
    helmManaged: 2,
    partialKinds: [],
    scan: { errors: 0, warnings: 0, strict: false, passed: true, rules: [] },
    lastModifiedAt: "2026-09-19T06:10:42.000Z",
    modifiedByDashboard: false,
    cliVersion: "0.1.0",
    actions: { editFiles: ALLOW, editNotes: ALLOW, delete: ALLOW, computeDrift: ALLOW },
    exportInProgress: { active: false, metadataMissing: false, lastChangeAt: T, untilAt: null, thresholdMinutes: 30 },
    ...over,
  };
}

export const K8S_ITEMS: K8sSnapshotListItem[] = [
  item({ id: "20260919-061000", drift: driftBadge() }),
  item({
    id: "20260919-020000",
    drift: MISMATCH,
    cluster: { id: "c3a9e0f2-5b6d-4e7f-8a9b-0c1d2e3f4a5b", context: "staging", name: "staging.k8s.example.com", serverVersion: "v1.34.1", relation: "other" },
    actions: {
      editFiles: ALLOW,
      editNotes: ALLOW,
      delete: ALLOW,
      computeDrift: { allowed: false, reasonCode: "CLUSTER_MISMATCH", reasonText: "다른 클러스터의 스냅샷" },
    },
  }),
  item({
    id: "20260918-230000",
    status: st("critical", [{ code: "SCAN_SECRET_ERRORS", text: "비밀값 의심 1건 (k8s-env-literal)", status: "critical" }]),
    scan: { errors: 1, warnings: 0, strict: false, passed: false, rules: ["k8s-env-literal"] },
    label: "kOps 1.31 업그레이드 전",
    resources: { current: { total: 34, files: 34 }, atExport: { total: 35 }, changedSinceExport: true, previous: null, delta: null },
  }),
  item({ id: "20260910-000000", drift: LAST_RESULT_OK }),
];

export function k8sListResponse(over: Partial<K8sListResponse> = {}): K8sListResponse {
  const items = over.items ?? K8S_ITEMS;
  return {
    dataSource: "mock",
    generatedAt: T,
    revision: 17,
    summary: k8sSummary(),
    total: items.length,
    filteredTotal: items.length,
    offset: 0,
    limit: null,
    facets: {
      cluster: { same: 3, other: 1, unknown: 0 },
      drift: { ok: 0, warning: 1, unknown: 1, not_computed: 2 },
      status: { ok: 3, warning: 0, critical: 1, unknown: 0 },
    },
    items,
    cli: K8S_CLI,
    ...over,
  };
}

function fileInfo(path: string, over: Partial<K8sFileInfo> = {}): K8sFileInfo {
  const seg = path.split("/");
  const isRes = seg.length === 3;
  const kindMap: Record<string, string> = { deployments: "Deployment", statefulsets: "StatefulSet", services: "Service", configmaps: "ConfigMap", ingresses: "Ingress" };
  const group: Record<string, string> = { deployments: "apps", statefulsets: "apps", ingresses: "networking.k8s.io" };
  const resource = isRes
    ? { apiGroup: group[seg[1]] ?? "", apiVersion: group[seg[1]] ? `${group[seg[1]]}/v1` : "v1", kind: kindMap[seg[1]] ?? "Thing", namespace: seg[0], name: seg[2].replace(/\.yaml$/, "") }
    : null;
  return {
    path,
    fileType: path === "metadata.json" ? "metadata" : path === "secret-refs.json" ? "secret_refs" : seg[1] === "namespace.yaml" ? "namespace" : "resource",
    resource,
    resourceKey: resource ? `${resource.apiGroup || "core"}/${resource.kind}/${resource.namespace}/${resource.name}` : null,
    documents: resource ? [resource] : [],
    expected: resource ? { apiGroup: resource.apiGroup, kind: resource.kind, namespace: resource.namespace, name: resource.name } : null,
    parse: "ok",
    parseError: null,
    pathMatches: true,
    duplicate: false,
    duplicateOf: [],
    runtimeFields: [],
    helmManaged: false,
    comparable: Boolean(resource && seg[1] !== "configmaps"),
    findings: { errors: 0, warnings: 0 },
    drift: null,
    exists: true,
    sizeBytes: 2211,
    lineCount: 88,
    modifiedAt: "2026-09-19T06:10:42.000Z",
    version: V("a"),
    eol: "lf",
    bom: false,
    encoding: "utf-8",
    indent: { style: "spaces", size: 2 },
    editable: path.endsWith(".json") ? { allowed: false, reasonCode: "FILE_KIND_READ_ONLY", reasonText: "이 파일은 보기 전용입니다" } : ALLOW,
    viewTruncated: false,
    ...over,
  };
}

/** 예시 1(최신, 드리프트 주의) + 예시 3(k8s-env-literal)을 섞은 상세 */
export function k8sDetailData(over: Partial<K8sSnapshotDetailData> = {}): K8sSnapshotDetailData {
  const base = K8S_ITEMS[2];
  return {
    ...base,
    drift: NOT_COMPUTED,
    files: [
      fileInfo("metadata.json"),
      fileInfo("secret-refs.json"),
      fileInfo("data/configmaps/postgres-config.yaml"),
      fileInfo("data/namespace.yaml"),
      fileInfo("data/statefulsets/postgres.yaml", { findings: { errors: 1, warnings: 0 }, version: V("b") }),
      fileInfo("prod/deployments/api.yaml", { drift: "changed", helmManaged: false }),
      fileInfo("prod/namespace.yaml"),
    ],
    tree: [
      {
        namespace: "data",
        system: false,
        namespaceFile: "data/namespace.yaml",
        count: 2,
        kinds: [
          { kindDir: "statefulsets", kind: "StatefulSet", count: 1, drift: "comparable", paths: ["data/statefulsets/postgres.yaml"] },
          { kindDir: "configmaps", kind: "ConfigMap", count: 1, drift: "not_in_rbac", paths: ["data/configmaps/postgres-config.yaml"] },
        ],
      },
      {
        namespace: "prod",
        system: false,
        namespaceFile: "prod/namespace.yaml",
        count: 1,
        kinds: [{ kindDir: "deployments", kind: "Deployment", count: 1, drift: "comparable", paths: ["prod/deployments/api.yaml"] }],
      },
    ],
    counts: {
      total: { current: 34, atExport: 35, previous: null, delta: null, helmManaged: 2, excludedByRule: 11 },
      byKind: [
        { kindDir: "deployments", kind: "Deployment", custom: false, current: 6, atExport: 6, previous: 5, delta: 1, drift: "comparable" },
        { kindDir: "configmaps", kind: "ConfigMap", custom: false, current: 8, atExport: 8, previous: 8, delta: 0, drift: "not_in_rbac" },
      ],
      byNamespace: [
        { namespace: "data", system: false, current: 12, atExport: 12 },
        { namespace: "prod", system: false, current: 18, atExport: 19 },
      ],
      excluded: [{ kindDir: "configmaps", kind: "ConfigMap", count: 5, reason: "auto_created", text: "자동 생성 (kube-root-ca.crt)" }],
    },
    folder: {
      fileCount: 38,
      sizeBytes: 1468006,
      topLevel: [
        { name: "data", type: "directory", fileCount: 12 },
        { name: "prod", type: "directory", fileCount: 18 },
        { name: "metadata.json", type: "file", fileCount: 1 },
      ],
    },
    extraFiles: [],
    metadata: {
      state: "ok",
      error: null,
      fields: {
        schemaVersion: 1,
        snapshotId: "20260918-230000",
        snapshotIdTimezone: "UTC",
        createdAt: "2026-09-18T23:00:42.311Z",
        tool: { name: "sentinel-k8s-snapshot", version: "0.1.0", node: "v22.12.0", client: "@kubernetes/client-node 2.0.0" },
        cluster: { id: CLUSTER_ID, idSource: "kube-system-namespace-uid", context: "sentinel-snapshot", name: "prod.k8s.example.com", serverVersion: "v1.34.1" },
        scope: {
          namespaces: { mode: "all_except_system", include: [], exclude: [], system: ["kube-system"], systemIncluded: [] },
          exported: ["data", "prod"],
          missing: [],
          kinds: { default: ["deployments", "statefulsets"], optional: [], custom: [], excluded: [] },
          includeHelmManaged: true,
        },
        kinds: {
          deployments: { kind: "Deployment", apiVersion: "apps/v1", namespaced: true, result: "ok", exported: 6, excludedByRule: 0, forbiddenNamespaces: [] },
        },
        resources: { total: 35, helmManaged: 2 },
        cleanup: { rulesVersion: 1, summary: ["status", "metadata.uid"] },
        secrets: { mode: "refs_only", read: false, referenced: 1, file: "secret-refs.json" },
        secretScan: { errors: 0, warnings: 0, strict: false, passed: true, rules: [], profile: "k8s" },
      },
    },
    scan: {
      current: {
        summary: { errors: 1, warnings: 0, strict: false, passed: false, rules: ["k8s-env-literal"] },
        scannedFiles: ["data/statefulsets/postgres.yaml", "metadata.json"],
        findings: [
          {
            file: "data/statefulsets/postgres.yaml",
            fileType: "resource",
            line: 41,
            rule: "k8s-env-literal",
            severity: "error",
            message: '환경 변수 "POSTGRES_PASSWORD" 에 리터럴 값이 들어 있습니다 (ex****(16자)). valueFrom.secretKeyRef 로 바꾸세요',
          },
        ],
        scannedAt: T,
      },
      atExport: { errors: 1, warnings: 0, strict: false, passed: false, rules: ["k8s-env-literal"] },
    },
    secretRefs: {
      state: "ok",
      count: 1,
      note: "Secret 값은 담지 않습니다. 복원 전에 아래 Secret 을 별도 보관소에서 다시 만드세요.",
      secrets: [
        {
          namespace: "data",
          secretName: "postgres-credentials",
          keys: ["POSTGRES_PASSWORD"],
          optional: false,
          referencedBy: [{ kind: "StatefulSet", name: "postgres", via: "env.valueFrom.secretKeyRef", container: "postgres" }],
        },
      ],
    },
    notes: { label: "kOps 1.31 업그레이드 전", memo: null, updatedAt: null, version: V("d"), fileExists: true },
    notices: [
      { code: "DATA_NOT_INCLUDED", text: "이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 스냅샷의 PVC 를 적용하면 빈 볼륨이 새로 만들어집니다 (README 8장)" },
      { code: "HELM_MANAGED", text: "Helm 관리 리소스 2개 — Helm 으로 복원 권장" },
    ],
    ...over,
  };
}

export function k8sDetailResponse(over: Partial<K8sSnapshotDetailData> = {}): K8sDetailResponse {
  const snapshot = k8sDetailData(over);
  return { dataSource: "mock", generatedAt: T, revision: 17, cli: { ...K8S_CLI, scan: `npm run scan --prefix deploy/k8s-snapshot -- snapshots/${snapshot.id}` }, snapshot };
}

export function k8sFileResponse(path: string, content = "apiVersion: apps/v1\nkind: StatefulSet\n"): K8sFileResponse {
  const readOnly = path.endsWith(".json");
  return {
    dataSource: "mock",
    generatedAt: T,
    snapshotId: "20260918-230000",
    path,
    fileType: readOnly ? "metadata" : "resource",
    resource: null,
    content,
    version: path === "data/statefulsets/postgres.yaml" ? V("b") : V("a"),
    sizeBytes: content.length,
    lineCount: content.split("\n").length,
    eol: "lf",
    bom: false,
    encoding: "utf-8",
    indent: { style: "spaces", size: 2 },
    modifiedAt: T,
    truncated: false,
    returnedBytes: content.length,
    editable: readOnly ? { allowed: false, reasonCode: "FILE_KIND_READ_ONLY", reasonText: "이 파일은 보기 전용입니다" } : ALLOW,
    findings: [],
    commands: readOnly ? null : { note: "대시보드는 이 명령을 실행하지 않습니다", diff: `kubectl diff -f deploy/k8s-snapshot/snapshots/20260918-230000/${path}`, apply: `kubectl apply -f deploy/k8s-snapshot/snapshots/20260918-230000/${path}` },
  };
}

export function k8sCheck(over: Partial<K8sFileCheck> = {}): K8sFileCheck {
  return {
    findings: [],
    errors: 0,
    warnings: 0,
    syntax: { checked: true, errors: [] },
    documents: 1,
    identity: { expected: { apiGroup: "apps", kind: "StatefulSet", namespace: "data", name: "postgres" }, actual: { apiGroup: "apps", apiVersion: "apps/v1", kind: "StatefulSet", namespace: "data", name: "postgres" }, matches: true },
    runtimeFields: [],
    unchanged: false,
    snapshotScanAfter: { errors: 0, warnings: 0, strict: false, passed: true, rules: [] },
    confirmationsRequired: [],
    ...over,
  };
}

export function driftResponse(over: Partial<DriftResponse> = {}): DriftResponse {
  return {
    dataSource: "mock",
    generatedAt: T,
    snapshotId: "20260919-061000",
    drift: driftBadge(),
    lease: null,
    target: { clusterId: CLUSTER_ID, context: "prod.k8s.example.com", name: "prod.k8s.example.com", serverVersion: "v1.34.1", sourceState: "mock" },
    snapshotCluster: { id: CLUSTER_ID, context: "sentinel-snapshot", name: "prod.k8s.example.com", serverVersion: "v1.34.1" },
    rulesVersion: 1,
    addedCheck: "checked",
    uncomparable: [
      { apiGroup: "", kind: "ConfigMap", count: 8, reason: "NOT_IN_RBAC", text: "대시보드 권한 밖이라 비교하지 않음" },
      { apiGroup: "batch", kind: "CronJob", count: 1, reason: "NOT_IN_RBAC", text: "대시보드 권한 밖이라 비교하지 않음" },
    ],
    unparsable: [],
    resources: [
      {
        key: "apps/Deployment/prod/api",
        apiGroup: "apps",
        apiVersion: "apps/v1",
        kind: "Deployment",
        namespace: "prod",
        name: "api",
        change: "changed",
        file: "prod/deployments/api.yaml",
        fileDocuments: 1,
        helmManaged: false,
        counts: { changed: 2, default: 1, managed: 1 },
        fields: [
          {
            path: "spec.template.spec.containers[api].image",
            category: "changed",
            reason: null,
            snapshot: { kind: "scalar", value: "registry.example.com/api:1.4.1" },
            cluster: { kind: "scalar", value: "registry.example.com/api:1.4.2" },
          },
          {
            path: "spec.template.spec.containers[api].env[LOG_LEVEL].value",
            category: "changed",
            reason: null,
            managedRule: null,
            snapshot: { kind: "masked", text: "값 다름 (de****(5자))", preview: "de****(5자)" },
            cluster: { kind: "masked", text: "값 다름 (****)", preview: "****" },
          },
          {
            path: "spec.replicas",
            category: "managed",
            reason: "HPA가 관리",
            managedRule: "HPA_REPLICAS",
            snapshot: { kind: "scalar", value: 5 },
            cluster: { kind: "scalar", value: 3 },
          },
          {
            path: "spec.template.spec.containers[api].terminationMessagePolicy",
            category: "default",
            reason: "기본값 File",
            managedRule: null,
            snapshot: null,
            cluster: { kind: "scalar", value: "File" },
          },
        ],
        fieldsTruncated: false,
        summary: null,
        commands: {
          diff: "kubectl diff -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/deployments/api.yaml",
          apply: "kubectl apply -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/deployments/api.yaml",
        },
      },
      {
        key: "networking.k8s.io/Ingress/prod/api-public",
        apiGroup: "networking.k8s.io",
        kind: "Ingress",
        namespace: "prod",
        name: "api-public",
        change: "deleted",
        file: "prod/ingresses/api-public.yaml",
        helmManaged: false,
        counts: { changed: 0, default: 0, managed: 0 },
        fields: [],
        fieldsTruncated: false,
        summary: { images: [], replicas: null },
        commands: {
          diff: "kubectl diff -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/ingresses/api-public.yaml",
          apply: "kubectl apply -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/ingresses/api-public.yaml",
        },
      },
      {
        key: "apps/Deployment/prod/payments",
        apiGroup: "apps",
        kind: "Deployment",
        namespace: "prod",
        name: "payments",
        change: "added",
        file: null,
        helmManaged: false,
        counts: { changed: 0, default: 0, managed: 0 },
        fields: [],
        fieldsTruncated: false,
        summary: { images: ["registry.example.com/payments:0.9.1"], replicas: 0 },
        commands: null,
      },
    ],
    commandsNote: "대시보드는 이 명령을 실행하지 않습니다. kubectl diff 는 서버 측 dry-run 이라 적용할 클러스터에 쓰기 권한이 있는 컨텍스트가 필요합니다. 적용 전 kubectl diff 로 확인하세요",
    notices: [],
    ...over,
  };
}

export function menuPayload(over: Partial<SnapshotMenuPayload> = {}): SnapshotMenuPayload {
  return {
    menu: {
      status: st("critical", [{ code: "SNAPSHOTS_COMMIT_BLOCKED", text: "커밋 금지 스냅샷 3개 (AWS 2 · Kubernetes 1)", status: "critical" }]),
      count: 3,
      showIcon: true,
    },
    tabs: {
      aws: { included: true, sourceState: "mock", status: st("critical"), critical: 2 },
      k8s: { included: true, sourceState: "mock", status: st("critical"), critical: 1, latestDrift: { snapshotId: "20260919-061000", drift: driftBadge() } },
    },
    ...over,
  };
}

export const K8S_TRASH: K8sTrashResponse = {
  dataSource: "mock",
  generatedAt: T,
  total: 1,
  filteredTotal: 1,
  offset: 0,
  limit: null,
  items: [
    {
      trashId: "20260901-000000__20260910T010203000Z",
      snapshotId: "20260901-000000",
      snapshotAt: "2026-09-01T00:00:00.000Z",
      deletedAt: "2026-09-10T01:02:03.000Z",
      label: "옛 스냅샷",
      cluster: { context: "sentinel-snapshot", name: "prod.k8s.example.com" },
      files: ["data", "prod", "metadata.json"],
      fileCount: 30,
      sizeBytes: 120000,
      restore: ALLOW,
    },
  ],
};
