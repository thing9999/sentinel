"use client";

/**
 * 상세 리소스 수·Secret 참조·메타데이터 탭 (docs/design/k8s-snapshot.md 7·8·9절). 값은 서버 값 그대로.
 * Secret 참조는 이름·키 이름만(값 없음). 메타데이터는 보기 전용.
 */
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import {
  Button,
  Card,
  Chip,
  CodeEditor,
  CopyButton,
  DataTable,
  EmptyState,
  formatCount,
  Grid,
  GridItem,
  Icon,
  InlineAlert,
  JsonTree,
  KeyValueList,
  ScanCounts,
  SegmentedControl,
  Skeleton,
  Timestamp,
  Tooltip,
  type Column,
  type KeyValueItem,
} from "@/components/ui";

import { errorLine } from "../aws-snapshots/DetailSections";
import { useApi } from "../common/hooks";
import { filePath } from "./api";
import { k8sDetailHref, KIND_DRIFT_TEXT, KIND_RESULT_LABEL, signedDelta, viaLabel } from "./model";
import type { K8sCounts, K8sFileResponse, K8sMetadataFields, K8sSnapshotDetailData, SecretRef } from "./types";

// ---------------------------------------------------------------- 리소스 수 (7절)

type KindRow = K8sCounts["byKind"][number] | { total: true };
type NsRow = K8sCounts["byNamespace"][number] | { total: true };
type ExRow = K8sCounts["excluded"][number];

const isTotal = (r: object): r is { total: true } => "total" in r;
const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatCount(v));

function DriftFlag({ flag }: { flag: K8sCounts["byKind"][number]["drift"] }) {
  if (flag === "comparable") return <span className="text-caption-tertiary">{KIND_DRIFT_TEXT.comparable}</span>;
  return (
    <span className="row gap-1 text-caption">
      <Icon name="eye-off" size={12} />
      {KIND_DRIFT_TEXT[flag]}
    </span>
  );
}

export function CountsTab({ detail }: { detail: K8sSnapshotDetailData }) {
  const c = detail.counts;
  const metaBroken = detail.metadata.state === "missing" || detail.metadata.state === "corrupt";
  const prev = detail.resources.previous;
  const kindColumns: Column<KindRow>[] = [
    {
      id: "kind",
      header: "종류",
      minWidth: 160,
      render: (r) => (isTotal(r) ? <span className="text-strong">합계</span> : r.custom ? <span className="text-mono">{r.kindDir}</span> : r.kind),
    },
    { id: "current", header: "현재", width: 80, align: "right", numeric: true, render: (r) => (isTotal(r) ? <span className="text-strong">{num(c.total.current)}</span> : num(r.current)) },
    {
      id: "atExport",
      header: "당시",
      width: 80,
      align: "right",
      numeric: true,
      render: (r) => {
        const v = isTotal(r) ? c.total.atExport : r.atExport;
        const cur = isTotal(r) ? c.total.current : r.current;
        return (
          <span className="row row-end gap-1">
            {num(v)}
            {v !== null && v !== undefined && v !== cur ? <Icon name="pencil" size={12} title="현재와 다름" /> : null}
          </span>
        );
      },
    },
    { id: "delta", header: "직전 대비", width: 88, align: "right", numeric: true, render: (r) => signedDelta(isTotal(r) ? c.total.delta : r.delta) },
    { id: "drift", header: "드리프트", width: 120, render: (r) => (isTotal(r) ? null : <DriftFlag flag={r.drift} />) },
  ];
  const nsColumns: Column<NsRow>[] = [
    {
      id: "ns",
      header: "네임스페이스",
      minWidth: 140,
      render: (r) =>
        isTotal(r) ? (
          <span className="text-strong">합계</span>
        ) : (
          <span className="row gap-1-5">
            {r.namespace === null ? <span>클러스터 범위</span> : <span className="text-mono">{r.namespace}</span>}
            {r.system ? <Chip size="sm" icon="settings" label="시스템" /> : null}
          </span>
        ),
    },
    { id: "current", header: "현재", width: 80, align: "right", numeric: true, render: (r) => (isTotal(r) ? num(c.byNamespace.reduce((a, b) => a + b.current, 0)) : num(r.current)) },
    { id: "atExport", header: "당시", width: 80, align: "right", numeric: true, render: (r) => (isTotal(r) ? num(c.total.atExport) : num(r.atExport)) },
  ];
  const exColumns: Column<ExRow>[] = [
    { id: "kind", header: "종류", minWidth: 160, render: (r) => r.kind },
    { id: "count", header: "개수", width: 80, align: "right", numeric: true, render: (r) => num(r.count) },
    { id: "reason", header: "이유", width: 280, render: (r) => r.text },
  ];

  return (
    <div className="stack">
      <Card padding="md" as="section" aria-label="리소스 수 요약">
        <div className="row gap-6" style={{ flexWrap: "wrap" }}>
          <SummaryItem label="전체">
            <span className="text-strong tabular">{num(c.total.current)}</span>
            {c.total.atExport !== null && c.total.atExport !== c.total.current ? <span className="text-caption-tertiary"> 당시 {num(c.total.atExport)}</span> : null}
          </SummaryItem>
          <SummaryItem label="직전 스냅샷">
            {prev ? (
              <span className="row gap-1-5">
                <Link href={k8sDetailHref(prev.snapshotId)} className="text-link text-mono" style={{ fontSize: 12 }}>
                  {prev.snapshotId}
                </Link>
                <span className="tabular">
                  {num(prev.total)} ({signedDelta(c.total.delta)})
                </span>
              </span>
            ) : (
              <span>-</span>
            )}
          </SummaryItem>
          <SummaryItem label="Helm 관리">
            <span className="tabular">{num(c.total.helmManaged)}</span>
          </SummaryItem>
          <SummaryItem label="제외 규칙으로 뺀 수">
            <span className="tabular">{num(c.total.excludedByRule)}</span>
          </SummaryItem>
        </div>
      </Card>
      {metaBroken ? <InlineAlert tone="neutral" compact title="metadata.json이 없어 내보내기 당시 값을 알 수 없습니다." /> : null}
      <Grid>
        <GridItem span={7} spanMd={12}>
          <section className="stack-sm" aria-labelledby="k8s-counts-kind">
            <div className="row gap-2" style={{ alignItems: "baseline" }}>
              <h3 id="k8s-counts-kind" className="text-h3">
                종류별
              </h3>
              <span className="text-caption-tertiary">CLI와 같은 규칙으로 셉니다</span>
            </div>
            <DataTable<KindRow>
              caption="종류별 리소스 수"
              density="compact"
              columns={kindColumns}
              rows={[...c.byKind, { total: true }]}
              rowKey={(r) => (isTotal(r) ? "__total" : r.kindDir)}
            />
          </section>
        </GridItem>
        <GridItem span={5} spanMd={12}>
          <section className="stack-sm" aria-labelledby="k8s-counts-ns">
            <h3 id="k8s-counts-ns" className="text-h3">
              네임스페이스별
            </h3>
            <DataTable<NsRow>
              caption="네임스페이스별 리소스 수"
              density="compact"
              columns={nsColumns}
              rows={[...c.byNamespace, { total: true }]}
              rowKey={(r) => (isTotal(r) ? "__total" : (r.namespace ?? "__cluster"))}
            />
          </section>
        </GridItem>
      </Grid>
      <section className="stack-sm" aria-labelledby="k8s-counts-excluded">
        <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <h3 id="k8s-counts-excluded" className="text-h3">
            제외 규칙으로 뺀 리소스
          </h3>
          <span className="text-caption-tertiary">CLI가 규칙에 따라 내보내지 않은 수입니다. 파일은 없습니다.</span>
        </div>
        {c.excluded.length === 0 ? (
          <p className="text-caption">{metaBroken ? "—" : "제외된 리소스 없음"}</p>
        ) : (
          <DataTable<ExRow> caption="제외 규칙으로 뺀 리소스" density="compact" columns={exColumns} rows={c.excluded} rowKey={(r) => `${r.kindDir}:${r.reason}`} />
        )}
      </section>
    </div>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="stack-sm" style={{ gap: 2 }}>
      <span className="text-caption">{label}</span>
      <span>{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------- Secret 참조 (8절)

export function SecretsTab({ detail, onOpenFile }: { detail: K8sSnapshotDetailData; onOpenFile: (path: string) => void }) {
  const refs = detail.secretRefs;
  const [sort, setSort] = useState<{ columnId: string; dir: "asc" | "desc" } | null>(null);
  const rows = useMemo(() => {
    const out = [...refs.secrets];
    if (sort) {
      const key = (r: SecretRef) => (sort.columnId === "name" ? r.secretName : `${r.namespace}/${r.secretName}`);
      out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (sort.dir === "asc" ? 1 : -1));
    }
    return out;
  }, [refs.secrets, sort]);
  const refCount = refs.secrets.reduce((a, s) => a + s.referencedBy.length, 0);
  const pathOf = (ns: string, kind: string, name: string) =>
    detail.files.find((f) => f.resource && f.resource.namespace === ns && f.resource.kind === kind && f.resource.name === name)?.path ?? null;
  const namesText = [...refs.secrets]
    .map((s) => `${s.namespace}/${s.secretName}`)
    .sort()
    .join("\n");

  const alert = (
    <InlineAlert
      tone="info"
      icon="key-round"
      title="복원 전에 이 Secret들을 별도 보관소에서 만들어야 합니다"
      description={`${refs.note ?? "스냅샷과 대시보드는 Secret을 읽지 않습니다."} 워크로드 매니페스트가 참조하는 이름과 참조에 적힌 키 이름만 모았습니다. 참조되지 않는 Secret·키와 Secret 타입은 알 수 없습니다.`}
    />
  );

  if (refs.state === "missing") {
    return (
      <div className="stack">
        {alert}
        <EmptyState
          size="sm"
          icon="file-x"
          title="secret-refs.json이 없습니다"
          description="이전 버전 CLI로 만들었거나 파일이 지워졌습니다. 복원 전에 매니페스트의 secretKeyRef·envFrom·volumes·imagePullSecrets를 직접 확인하세요."
        />
      </div>
    );
  }
  if (refs.state === "corrupt" || refs.state === "schema_mismatch") {
    return (
      <div className="stack">
        {alert}
        <InlineAlert
          tone="neutral"
          icon="file-warning"
          title={`secret-refs.json을 읽을 수 없습니다 (${refs.state === "corrupt" ? "JSON 해석 실패" : "형식이 다름"})`}
          action={
            <Button variant="ghost" size="sm" onClick={() => onOpenFile("secret-refs.json")}>
              파일 보기
            </Button>
          }
        />
      </div>
    );
  }

  const columns: Column<SecretRef>[] = [
    { id: "ns", header: "네임스페이스", width: 136, sortable: true, render: (r) => <span className="text-mono">{r.namespace}</span> },
    {
      id: "name",
      header: "Secret 이름",
      minWidth: 200,
      sortable: true,
      render: (r) => (
        <span className="row gap-1-5">
          <span className="text-mono" style={{ overflowWrap: "anywhere" }}>
            {r.secretName}
          </span>
          <CopyButton text={r.secretName} size="sm" label="Secret 이름 복사" />
          {r.optional ? <Chip size="sm" label="optional" /> : null}
        </span>
      ),
    },
    {
      id: "keys",
      header: "참조 키",
      width: 160,
      render: (r) =>
        r.keys.length > 0 ? (
          <span className="stack-sm" style={{ gap: 0 }}>
            {r.keys.map((k) => (
              <span key={k} className="text-mono" style={{ fontSize: 12 }}>
                {k}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-caption-tertiary">—</span>
        ),
    },
    {
      id: "via",
      header: "참조 방식",
      width: 176,
      render: (r) => (
        <span className="row gap-1" style={{ flexWrap: "wrap" }}>
          {Array.from(new Set(r.referencedBy.map((x) => x.via))).map((v) => {
            const l = viaLabel(v);
            return <Chip key={v} size="sm" label={l.text} mono={!l.known} />;
          })}
        </span>
      ),
    },
    {
      id: "by",
      header: "참조하는 리소스",
      width: 200,
      render: (r) => {
        const first = r.referencedBy[0];
        if (!first) return "—";
        const path = pathOf(r.namespace, first.kind, first.name);
        const label = (
          <span className="row gap-1">
            <span className="text-caption">{first.kind}</span>
            <span className="text-mono" style={{ fontSize: 12 }}>
              {first.name}
            </span>
          </span>
        );
        const rest = r.referencedBy.length - 1;
        return (
          <span className="row gap-1-5">
            {path ? (
              <button type="button" className="text-link" onClick={() => onOpenFile(path)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                {label}
              </button>
            ) : (
              label
            )}
            {rest > 0 ? (
              <Tooltip
                content={
                  <span className="stack-sm">
                    {r.referencedBy.map((x, i) => (
                      <span key={i}>
                        {x.kind} {x.name} · {x.via}
                        {x.container ? ` · ${x.container}` : ""}
                      </span>
                    ))}
                  </span>
                }
              >
                <span className="text-caption-tertiary">외 {formatCount(rest)}개</span>
              </Tooltip>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <div className="stack">
      {alert}
      <div className="row-between gap-2">
        <span className="text-caption tabular">
          Secret {formatCount(refs.count)}개 · 참조 {formatCount(refCount)}곳 · secret-refs.json
        </span>
        {refs.secrets.length > 0 ? <CopyButton text={namesText} label="이름 목록 복사" size="md" showLabel /> : null}
      </div>
      {refs.secrets.length === 0 ? (
        <EmptyState size="sm" icon="key-round" title="참조하는 Secret이 없습니다" />
      ) : (
        <DataTable<SecretRef>
          caption="Secret 참조"
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.namespace}/${r.secretName}`}
          sort={sort}
          onSortChange={(s) => setSort(s)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 메타데이터 (9절)

const dash = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v);
const mono = (v: ReactNode) => <span className="text-mono">{v}</span>;

function namespaceRule(m: K8sMetadataFields): string {
  const ns = m.scope?.namespaces;
  if (!ns?.mode) return "—";
  if (ns.mode === "include") return `포함: ${(ns.include ?? []).join(", ") || "—"}`;
  if (ns.mode === "exclude") return `제외: ${(ns.exclude ?? []).join(", ") || "—"}`;
  return "시스템 제외 전체";
}

function metadataItems(detail: K8sSnapshotDetailData, m: K8sMetadataFields): KeyValueItem[] {
  const reasons = new Set(detail.status.reasons.map((r) => r.code));
  const relation = detail.cluster?.relation;
  const tool = m.tool;
  const kinds = m.scope?.kinds;
  const nsSystemIncluded = m.scope?.namespaces?.systemIncluded ?? [];
  const missing = m.scope?.missing ?? [];
  const idNote =
    !m.cluster?.id
      ? { tone: "warn" as const, text: "클러스터 ID 없음 — 드리프트를 계산하지 않음" }
      : relation === "same"
        ? { tone: "info" as const, text: "대시보드가 연결된 클러스터와 같음" }
        : relation === "other"
          ? { tone: "warn" as const, text: "대시보드가 연결된 클러스터와 다름" }
          : { tone: "info" as const, text: "대시보드 클러스터를 확인할 수 없음 — 비교할 수 없음" };
  return [
    {
      label: "생성 시각",
      value: (
        <span className="stack-sm">
          {m.createdAt ? <Timestamp value={m.createdAt} format="auto" /> : "—"}
          <span className="text-caption-tertiary">
            snapshotId {mono(dash(m.snapshotId))} ({dash(m.snapshotIdTimezone)})
          </span>
        </span>
      ),
      note: reasons.has("SNAPSHOT_ID_MISMATCH") ? { tone: "warn", text: "폴더 이름과 다름" } : undefined,
    },
    {
      label: "CLI",
      value: [tool?.name && tool.version ? `k8s-snapshot ${tool.version}` : null, tool?.node ? `Node ${tool.node}` : null, tool?.client ?? null].filter(Boolean).join(" · ") || "—",
    },
    { label: "클러스터 이름", value: m.cluster?.name ? mono(m.cluster.name) : <span className="text-caption-tertiary">알 수 없음</span> },
    { label: "컨텍스트", value: mono(dash(m.cluster?.context)) },
    {
      label: "클러스터 ID",
      value: m.cluster?.id ? (
        <span className="row gap-1">
          {mono(m.cluster.id)}
          <CopyButton text={m.cluster.id} size="sm" label="클러스터 ID 복사" />
        </span>
      ) : (
        "—"
      ),
      note: idNote,
    },
    { label: "서버 버전", value: mono(dash(m.cluster?.serverVersion)) },
    {
      label: "네임스페이스 규칙",
      value: namespaceRule(m),
      note: nsSystemIncluded.length > 0 ? { tone: "warn", text: `시스템 네임스페이스 포함 (${nsSystemIncluded.join(", ")})` } : undefined,
    },
    { label: "내보낸 네임스페이스", value: <span className="text-mono" style={{ overflowWrap: "anywhere" }}>{(m.scope?.exported ?? []).join(", ") || "—"}</span> },
    {
      label: "없던 네임스페이스",
      value: missing.length > 0 ? mono(missing.join(", ")) : "없음",
      note: missing.length > 0 ? { tone: "warn", text: "설정에 있지만 클러스터에 없던 네임스페이스" } : undefined,
    },
    {
      label: "종류",
      value: (
        <Tooltip
          content={<span className="text-mono">{[...(kinds?.default ?? []), ...(kinds?.optional ?? []), ...(kinds?.custom ?? [])].join(", ") || "—"}</span>}
          maxWidth={360}
        >
          <span>
            기본 {formatCount(kinds?.default?.length ?? 0)} · 선택 {formatCount(kinds?.optional?.length ?? 0)} · 사용자 지정 {formatCount(kinds?.custom?.length ?? 0)}
          </span>
        </Tooltip>
      ),
    },
    {
      label: "리소스",
      value: `${num(m.resources?.total)}개 · Helm 관리 ${num(m.resources?.helmManaged)} · 제외 ${num(detail.counts.total.excludedByRule)}`,
      note: (m.resources?.helmManaged ?? 0) > 0 ? { tone: "info", text: "Helm 관리 리소스는 Helm으로 복원 권장" } : undefined,
    },
    {
      label: "정리 규칙",
      value: (
        <span className="stack-sm">
          {mono(`rulesVersion ${m.cleanup?.rulesVersion ?? "—"}`)}
          {m.cleanup?.summary && m.cleanup.summary.length > 0 ? (
            <span className="text-caption" style={{ overflowWrap: "anywhere" }}>
              {m.cleanup.summary.join(", ")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      label: "Secret 처리",
      value: `읽지 않음 · 참조 이름만 (${m.secrets?.file ?? "secret-refs.json"}, ${num(m.secrets?.referenced)}개)`,
      note: { tone: "info", text: "Secret 값은 내보내지 않음" },
    },
    { label: "strict", value: m.secretScan ? (m.secretScan.strict ? "예" : "아니요") : "—" },
    {
      label: "내보내기 당시 스캔",
      value: m.secretScan ? <ScanCounts errors={m.secretScan.errors} warnings={m.secretScan.warnings} srPrefix="내보내기 당시 스캔" /> : "—",
    },
  ];
}

interface KindResultRow {
  id: string;
  kind: string;
  result: string;
  exported: number | null;
  message: string | null;
}

const RESULT_ORDER: Record<string, number> = { forbidden: 0, error: 0, not_found: 1, ok: 2 };

function kindResultRows(m: K8sMetadataFields): KindResultRow[] {
  const entries = Object.entries(m.kinds ?? {});
  return entries
    .map(([id, k]) => ({ id, kind: k.kind ?? id, result: k.result ?? "ok", exported: k.exported ?? null, message: k.message ?? null }))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (RESULT_ORDER[a.r.result] ?? 3) - (RESULT_ORDER[b.r.result] ?? 3) || a.i - b.i)
    .map((x) => x.r);
}

const KIND_RESULT_COLUMNS: Column<KindResultRow>[] = [
  { id: "kind", header: "종류", minWidth: 160, render: (r) => r.kind },
  {
    id: "result",
    header: "결과",
    width: 160,
    render: (r) =>
      r.result === "ok" ? (
        <span className="text-caption-tertiary">{KIND_RESULT_LABEL.ok}</span>
      ) : r.result === "forbidden" ? (
        <Chip tone="warn" size="sm" icon="lock" label={KIND_RESULT_LABEL.forbidden} />
      ) : r.result === "not_found" ? (
        <Chip size="sm" icon="minus" label={KIND_RESULT_LABEL.not_found} />
      ) : (
        <Chip tone="warn" size="sm" icon="triangle-alert" label={KIND_RESULT_LABEL.error ?? r.result} tooltip={r.message ?? undefined} />
      ),
  },
  { id: "count", header: "개수", width: 80, align: "right", numeric: true, render: (r) => num(r.exported) },
];

export function MetaTab({ id, detail }: { id: string; detail: K8sSnapshotDetailData }) {
  const [view, setView] = useState<"table" | "raw">("table");
  const meta = detail.metadata;
  const metaFile = detail.files.find((f) => f.fileType === "metadata");
  const wantRaw = meta.state === "corrupt" || view === "raw";
  const raw = useApi<K8sFileResponse>(wantRaw && metaFile?.exists ? filePath(id) : null, { path: "metadata.json" }, metaFile?.version ?? "");
  const showToggle = meta.state === "ok" || meta.state === "schema_mismatch";
  const partial = detail.status.reasons.find((r) => r.code === "PARTIAL_EXPORT");

  let body: ReactNode;
  if (meta.state === "missing") {
    body = <InlineAlert tone="warn" title="metadata.json이 없습니다" description="내보내기가 중단됐거나 손으로 만든 폴더일 수 있습니다." />;
  } else if (meta.state === "corrupt") {
    const line = errorLine(meta.error);
    body = (
      <div className="stack">
        <InlineAlert tone="crit" title="metadata.json을 읽을 수 없습니다 (JSON 해석 실패)" description={meta.error ? `${line ? `${line}번째 줄 근처 · ` : ""}${meta.error}` : undefined} />
        {raw.data ? (
          <CodeEditor value={raw.data.content} fileName="metadata.json" mode="view" height={320} highlightLine={line} markers={[]} />
        ) : raw.error ? null : (
          <Skeleton lines={6} />
        )}
      </div>
    );
  } else if (view === "raw") {
    let parsed: unknown = undefined;
    let parseFailed = false;
    if (raw.data) {
      try {
        parsed = JSON.parse(raw.data.content);
      } catch {
        parseFailed = true;
      }
    }
    body = raw.data ? (
      parseFailed ? (
        <CodeEditor value={raw.data.content} fileName="metadata.json" mode="view" height={320} markers={[]} />
      ) : (
        <Card padding="md">
          <JsonTree data={parsed} defaultExpandDepth={2} searchable maxHeight={480} />
        </Card>
      )
    ) : raw.error ? (
      <InlineAlert tone="neutral" title="metadata.json 원문을 불러오지 못했습니다" description={raw.error.message} />
    ) : (
      <Skeleton lines={8} />
    );
  } else {
    const fields = meta.fields ?? {};
    const rows = kindResultRows(fields);
    body = (
      <div className="stack">
        {meta.state === "schema_mismatch" ? (
          <InlineAlert
            tone="warn"
            compact
            title={`${detail.status.reasons.find((r) => r.code === "METADATA_SCHEMA_MISMATCH")?.text ?? "메타데이터 형식이 다릅니다"}. 알 수 있는 항목만 표로 보여 줍니다.`}
          />
        ) : null}
        <Card padding="md">
          <KeyValueList columns={2} labelWidth={160} items={metadataItems(detail, fields)} />
        </Card>
        {rows.length > 0 ? (
          <section className="stack-sm" aria-labelledby="k8s-meta-kinds">
            <h3 id="k8s-meta-kinds" className="text-h3">
              종류별 내보내기 결과
            </h3>
            {partial ? <InlineAlert tone="warn" compact title={`${partial.text}. 이 종류는 스냅샷에 없습니다.`} /> : null}
            <DataTable caption="종류별 내보내기 결과" density="compact" columns={KIND_RESULT_COLUMNS} rows={rows} rowKey={(r) => r.id} />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="k8s-metadata-title" className="stack">
      <div className="row-between gap-2" style={{ flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 id="k8s-metadata-title" className="text-h3" style={{ fontSize: 18 }}>
            메타데이터
          </h2>
          <span className="text-caption-tertiary">metadata.json · CLI가 내보낼 때 기록 · 대시보드는 고치지 않습니다</span>
        </div>
        {showToggle ? (
          <SegmentedControl
            size="sm"
            label="메타데이터 보기 방식"
            value={view}
            onChange={(v) => setView(v)}
            options={[
              { value: "table", label: "표" },
              { value: "raw", label: "원문 JSON" },
            ]}
          />
        ) : null}
      </div>
      {body}
    </section>
  );
}
