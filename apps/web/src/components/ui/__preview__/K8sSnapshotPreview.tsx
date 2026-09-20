"use client";

/**
 * k8s-snapshot 표현 컴포넌트 미리보기 (/dev/ui). 고정 예시 데이터만 쓴다.
 */
import { useMemo, useState } from "react";

import {
  Card,
  Chip,
  DiffValue,
  DriftCountChip,
  DriftKindChip,
  DriftKindIcon,
  DriftStatus,
  DriftSummary,
  FieldDiffTable,
  LabeledStatus,
  LinkTabs,
  MaskedValue,
  NoExecuteNotice,
  ResourceTree,
  ScanFindingList,
  SearchInput,
  Section,
  StatusBadge,
  defaultExpandedIds,
  type DriftKind,
  type FieldDiffRow,
  type TreeNode,
} from "../index";

const KINDS = ["Deployment", "StatefulSet", "Service", "ConfigMap"];

function buildTree(): TreeNode[] {
  const nss = ["app", "data", "batch", "monitoring", "kube-system"];
  const out: TreeNode[] = [
    {
      id: "g:files",
      kind: "group",
      label: "스냅샷 파일",
      icon: "archive",
      defaultCollapsed: true,
      children: [
        { id: "metadata.json", kind: "file", label: "metadata.json" },
        { id: "secret-refs.json", kind: "file", label: "secret-refs.json" },
      ],
    },
  ];
  for (const ns of nss) {
    const kinds: TreeNode[] = KINDS.map((k) => {
      const plural = `${k.toLowerCase()}s`;
      const leaves: TreeNode[] = Array.from({ length: ns === "app" ? 60 : 12 }, (_, i) => {
        const name = `${ns}-${k.toLowerCase()}-component-${i}`;
        return {
          id: `${ns}/${plural}/${name}.yaml`,
          kind: "file" as const,
          label: name,
          tooltip: `${ns}/${plural}/${name}.yaml`,
          markers:
            i === 1 && k === "StatefulSet"
              ? { scan: { level: "error", count: 1 }, drift: { kind: "changed" as DriftKind, detail: "필드 2건" }, helm: true }
              : i === 2 && k === "Deployment"
                ? { fileIssue: "YAML 해석 실패" }
                : i === 3 && k === "Service"
                  ? { drift: { kind: "deleted" as DriftKind } }
                  : undefined,
        };
      });
      return {
        id: `${ns}/${plural}`,
        kind: "resourceKind" as const,
        label: k,
        count: leaves.length,
        children: leaves,
        markers: k === "ConfigMap" ? { notComparable: "드리프트 비교 불가 (대시보드 권한 밖)" } : undefined,
      };
    });
    out.push({
      id: `ns:${ns}`,
      kind: "namespace",
      label: ns,
      count: kinds.reduce((a, k) => a + (k.count ?? 0), 0),
      chips: ns === "kube-system" ? <Chip label="시스템" icon="settings" /> : undefined,
      children: [{ id: `${ns}/namespace.yaml`, kind: "file", label: "namespace.yaml" }, ...kinds],
    });
  }
  out.push({
    id: "g:unexpected",
    kind: "group",
    label: "예상 밖 파일",
    icon: "file-question",
    iconTone: "warn",
    defaultCollapsed: true,
    children: [
      { id: "u:1", kind: "file", label: "notes.bak", disabled: true, disabledReason: "대시보드는 이 파일을 열거나 고치지 않습니다" },
    ],
  });
  return out;
}

const DIFF_ROWS: FieldDiffRow[] = [
  {
    path: "spec.template.spec.containers[api].image",
    category: "changed",
    reason: null,
    snapshot: { kind: "scalar", value: "registry.example.com/api:1.8.2" },
    cluster: { kind: "scalar", value: "registry.example.com/api:1.9.0" },
  },
  {
    path: "spec.template.spec.containers[api].env[DB_PASSWORD].value",
    category: "changed",
    reason: null,
    snapshot: { kind: "masked", text: "값 다름 (ex****(16자))", preview: "ex" },
    cluster: { kind: "masked", text: "값 다름 (ab****(16자))", preview: "ab" },
  },
  {
    path: "spec.template.spec.containers[api].ports[http].containerPort",
    category: "changed",
    reason: null,
    snapshot: { kind: "scalar", value: "8080" },
    cluster: { kind: "scalar", value: 8080 },
  },
  {
    path: "spec.template.spec.containers[api].args",
    category: "changed",
    reason: null,
    snapshot: { kind: "list", items: ["--port=8080", "--log=info", "--workers=2", "--timeout=30s", "--metrics"] },
    cluster: { kind: "list", items: ["--port=8080", "--log=debug", "--workers=4", "--timeout=30s", "--metrics"] },
  },
  {
    path: "spec.template.spec.containers[api].resources.limits.memory",
    category: "changed",
    reason: null,
    snapshot: null,
    cluster: { kind: "scalar", value: "1Gi" },
  },
  {
    path: "spec.replicas",
    category: "managed",
    reason: "HPA가 관리",
    managedRule: "hpa-replicas",
    snapshot: { kind: "scalar", value: 2 },
    cluster: { kind: "scalar", value: 5 },
  },
  {
    path: "spec.template.spec.containers[api].terminationMessagePolicy",
    category: "default",
    reason: "기본값 File",
    snapshot: null,
    cluster: { kind: "scalar", value: "File" },
  },
];

export function K8sSnapshotPreview() {
  const tree = useMemo(() => buildTree(), []);
  const [expanded, setExpanded] = useState<string[]>(() => defaultExpandedIds(tree));
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<DriftKind | "all">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  return (
    <Section title="Kubernetes 스냅샷 (k8s-snapshot)">
      <LinkTabs
        label="스냅샷 종류"
        currentHref="/snapshots/k8s"
        items={[
          { href: "/snapshots", label: "AWS", status: "crit", statusLabel: "커밋 금지", count: 2 },
          {
            href: "/snapshots/k8s",
            label: "Kubernetes",
            status: "warn",
            count: 1,
            trailing: <DriftCountChip count={3} tooltip="최신 스냅샷 드리프트: 차이 3건 (변경 2 · 삭제 1) · 15:12 계산" />,
            srText: "주의, 커밋 금지 1개, 드리프트 차이 3건",
          },
        ]}
      />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3)" }}>
          <div style={{ display: "flex", gap: "var(--spacing-2)", alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status="crit" label="커밋 금지" size="lg" srPrefix="파일 상태: " />
          </div>
          <LabeledStatus label="드리프트" reason="변경 2 · 삭제 1" meta="· 15:12 계산">
            <DriftStatus state="changed" count={3} reason="변경 2 · 삭제 1" refreshing />
          </LabeledStatus>
          <div style={{ display: "flex", gap: "var(--spacing-3)", flexWrap: "wrap", alignItems: "center" }}>
            <DriftStatus state="changed" count={3} size="sm" />
            <DriftStatus state="none" size="sm" />
            <DriftStatus state="unknown" size="sm" />
            <DriftStatus state="notComputed" />
            <DriftStatus state="computing" />
            <DriftStatus state="stale" size="sm" staleAt="2026-09-19T06:12:10Z" previous={{ count: 3 }} />
          </div>
          <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
            <DriftKindIcon kind="changed" />
            <DriftKindIcon kind="deleted" />
            <DriftKindIcon kind="added" />
            <DriftKindChip kind="changed" />
            <DriftKindChip kind="deleted" size="md" />
            <DriftKindChip kind="added" href="#drift" tooltip="드리프트에서 보기" />
            <DriftKindChip kind="same" />
            <MaskedValue text="값 다름 (ex****(16자))" />
            <DiffValue value={null} />
          </div>
          <ScanFindingList
            truncateFile
            onSelect={() => {}}
            findings={[
              {
                id: "1",
                level: "error",
                file: "data/statefulsets/postgres-primary-with-a-very-long-name.yaml",
                line: 41,
                ruleId: "k8s-env-literal",
                description: "env value 리터럴 PO****(12자)",
                navigable: true,
              },
            ]}
          />
        </div>
      </Card>

      <NoExecuteNotice text="대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요." />
      <DriftSummary
        status={{ state: "changed", count: 3 }}
        reason={["변경 2 · 삭제 1"]}
        computedAt="2026-09-19T06:12:04Z"
        target={{ name: "prod-eks", context: "sentinel-prod" }}
        mode="auto"
        counts={{ changed: 2, deleted: 1, added: 0, same: 39, compared: 42 }}
        activeFilter={filter}
        onFilter={(k) => setFilter(k === "same" ? "all" : k)}
        hidden={{ default: 12, managed: 1 }}
        showHidden={showHidden}
        onShowHiddenChange={setShowHidden}
        notComparable={[
          { kind: "ConfigMap", count: 8, reason: "NOT_IN_RBAC", text: "대시보드 RBAC에 없는 종류입니다" },
          { kind: "NetworkPolicy", count: 2, reason: "NOT_IN_RBAC", text: "대시보드 RBAC에 없는 종류입니다" },
          { kind: "Ingress", count: 3, reason: "FORBIDDEN", text: "클러스터가 읽기를 거부했습니다 (403)" },
          {
            kind: "HorizontalPodAutoscaler",
            count: 1,
            reason: "API_VERSION_MISMATCH",
            text: "파일 autoscaling/v1 · 대시보드 autoscaling/v2",
          },
        ]}
        totalUncomparable={14}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "var(--spacing-4)" }}>
        <Card padding="none">
          <div style={{ padding: "var(--spacing-3)" }}>
            <SearchInput value={q} onChange={setQ} placeholder="리소스 이름·경로 검색" label="리소스 검색" />
          </div>
          <ResourceTree
            label="리소스"
            nodes={tree}
            expandedIds={expanded}
            onExpandedChange={setExpanded}
            selectedId={selected}
            onSelect={(n) => setSelected(n.id)}
            query={q}
            height={360}
            onResetFilters={() => setQ("")}
          />
        </Card>
        <Card>
          <FieldDiffTable
            caption="api 필드 차이"
            rows={DIFF_ROWS}
            showHidden={showHidden}
            hiddenExpanded={groupOpen}
            onHiddenToggle={() => setGroupOpen((v) => !v)}
          />
        </Card>
      </div>
    </Section>
  );
}
