"use client";

/**
 * 상세 드리프트 탭 `?view=drift` (docs/design/k8s-snapshot.md 6절).
 * - 데이터: GET …/drift (서버 값만: 상태·건수·분류·가림을 화면에서 계산하지 않는다). 계산 요청은 POST …/drift.
 * - 요청 계산(`on_demand`)은 탭이 열려 있는 동안 60초마다 임대 갱신(hooks.useDriftData).
 * - 명령은 텍스트 + 복사만. 추가된 리소스에는 명령을 보이지 않는다. 삭제·스케일·롤아웃 명령 없음.
 */
import { useMemo, useState, type ReactNode } from "react";

import {
  Button,
  Card,
  CommandLine,
  CopyButton,
  DriftKindChip,
  DriftSummary,
  EmptyState,
  ErrorState,
  FieldDiffTable,
  formatCount,
  formatTime,
  Grid,
  GridItem,
  Icon,
  InlineAlert,
  KeyValueList,
  NoExecuteNotice,
  ResourceTree,
  SearchInput,
  SegmentedControl,
  Skeleton,
  UnknownState,
  type DriftKind,
  type FieldDiffRow,
} from "@/components/ui";

import { useMediaQuery } from "../common/hooks";
import { WORK_HEIGHT } from "./FilesTab";
import type { DetailQuery, DriftData } from "./hooks";
import {
  buildDriftTree,
  computeBlockReason,
  driftCellView,
  driftCode,
  driftDiffCount,
  kindVersionText,
  unparsableText,
  visibleDriftResources,
  type DriftListKind,
} from "./model";
import { DriftRulesHelp } from "./shared";
import type { DriftAbility, DriftResource, DriftResponse } from "./types";

const NO_EXECUTE_TEXT = "대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요.";
const DEFAULT_COMMANDS_NOTE = "kubectl diff는 서버 측 dry-run이라 실행하는 계정에 쓰기(patch) 권한이 필요합니다.";

export function DriftTab({
  drift,
  ability,
  kubeStale,
  query,
  patch,
  onOpenFile,
  viewLast,
  setViewLast,
}: {
  drift: DriftData;
  ability: DriftAbility | null;
  kubeStale: boolean;
  query: DetailQuery;
  patch: (p: Partial<DetailQuery>) => void;
  onOpenFile: (path: string) => void;
  viewLast: boolean;
  setViewLast: (v: boolean) => void;
}) {
  const data = drift.data;
  const computeReason = computeBlockReason(ability);

  const body = (() => {
    // 계산 요청 중 (이전 전체 결과가 없을 때): 스켈레톤 + 안내
    if (drift.pending && (!data || !data.drift.computed || data.resources.length === 0)) {
      return (
        <div className="stack" aria-busy="true">
          <p className="text-caption">클러스터에서 읽는 중입니다. 쿠버네티스 API는 읽기만 합니다.</p>
          <DriftSummary status={{ state: "computing" }} state="loading" />
          <Grid>
            <GridItem span={4} spanMd={12}>
              <Skeleton lines={10} />
            </GridItem>
            <GridItem span={8} spanMd={12}>
              <Skeleton lines={6} />
            </GridItem>
          </Grid>
        </div>
      );
    }
    if (!data) {
      if (drift.loadError) {
        return <ErrorState size="sm" title="드리프트 결과를 불러오지 못했습니다" description={drift.loadError.message} onRetry={drift.reload} retryLabel="다시 시도" />;
      }
      return <DriftSummary status={{ state: "unknown" }} state="loading" />;
    }
    return (
      <DriftBody
        data={data}
        drift={drift}
        computeReason={computeReason}
        kubeStale={kubeStale}
        query={query}
        patch={patch}
        onOpenFile={onOpenFile}
        viewLast={viewLast}
        setViewLast={setViewLast}
      />
    );
  })();

  return (
    <div className="stack">
      <div className="row-between gap-2" style={{ flexWrap: "wrap" }}>
        <NoExecuteNotice text={NO_EXECUTE_TEXT} />
        <DriftRulesHelp />
      </div>
      {drift.error ? (
        <InlineAlert
          tone="crit"
          compact
          live
          title={
            data?.drift.computed && data.drift.computedAt
              ? `드리프트를 다시 계산하지 못했습니다. 이전 결과(${formatTime(data.drift.computedAt, "shortTime")})를 보여 줍니다.`
              : "드리프트를 계산하지 못했습니다"
          }
          description={drift.error.text}
          action={
            <Button variant="secondary" size="sm" onClick={() => drift.compute(true)}>
              다시 시도
            </Button>
          }
        />
      ) : null}
      {body}
    </div>
  );
}

function ComputeButton({
  label,
  variant = "primary",
  icon = "git-compare",
  reason,
  drift,
}: {
  label: string;
  variant?: "primary" | "secondary";
  icon?: "git-compare" | "refresh-cw";
  reason?: string;
  drift: DriftData;
}) {
  return (
    <Button
      variant={variant}
      icon={icon}
      onClick={() => drift.compute(true)}
      loading={drift.pending}
      disabled={Boolean(reason)}
      disabledReason={reason}
    >
      {drift.pending ? "계산 중" : label}
    </Button>
  );
}

/** 알 수 없음 사유별 모습 (디자인 6.8) */
function UnknownView({ data, drift, computeReason, onMeta }: { data: DriftResponse; drift: DriftData; computeReason?: string; onMeta: () => void }) {
  const code = driftCode(data.drift);
  const text = data.drift.status.reasons[0]?.text;
  const disabledButton = <ComputeButton label="드리프트 계산" drift={drift} reason={computeReason ?? "지금은 계산할 수 없습니다"} />;
  switch (code) {
    case "CLUSTER_NOT_CONNECTED":
      return <UnknownState size="lg" reason="클러스터 연결 없음" hint={<span className="stack-sm"><span>{text}</span><span>대시보드가 클러스터에 연결되면 다시 계산합니다.</span></span>} />;
    case "CLUSTER_SYNCING":
      return (
        <UnknownState
          size="lg"
          icon="hourglass"
          reason="클러스터 동기화 중"
          hint={
            <span className="stack-sm">
              <span>대시보드가 클러스터 리소스 목록을 처음 읽는 중입니다.</span>
              <span>끝나면 최신 스냅샷은 자동으로 계산하고, 이 버튼도 쓸 수 있게 됩니다. 일부 종류만 읽은 상태로 비교하면 삭제됨이 잘못 나올 수 있어 기다립니다.</span>
            </span>
          }
          action={disabledButton}
        />
      );
    case "DASHBOARD_CLUSTER_UNKNOWN":
      return (
        <UnknownState
          size="lg"
          reason="대시보드가 연결된 클러스터를 확인할 수 없음"
          hint={
            <span className="stack-sm">
              <span>{text}</span>
              <span>
                대시보드가 kube-system 네임스페이스를 읽지 못해 어느 클러스터에 연결됐는지 모릅니다. 다른 클러스터와 잘못 비교하지 않도록 계산하지 않습니다.
                deploy/rbac.yaml의 namespaces 읽기 권한과 클러스터 연결을 확인하세요.
              </span>
            </span>
          }
          action={disabledButton}
        />
      );
    case "CLUSTER_MISMATCH":
      return (
        <UnknownState
          size="lg"
          reason="다른 클러스터의 스냅샷"
          hint={
            <span className="stack-sm" style={{ textAlign: "left" }}>
              <KeyValueList
                columns={1}
                labelWidth={120}
                items={[
                  { label: "스냅샷", value: <span className="text-mono">{data.snapshotCluster?.name ?? data.snapshotCluster?.context ?? "—"}</span> },
                  { label: "대시보드", value: <span className="text-mono">{data.target?.name ?? data.target?.context ?? "—"}</span> },
                ]}
              />
              <span>다른 클러스터의 스냅샷은 비교하지 않습니다. 파일 보기·편집·삭제는 할 수 있습니다.</span>
            </span>
          }
          action={disabledButton}
        />
      );
    case "CLUSTER_ID_MISSING":
      return (
        <UnknownState
          size="lg"
          reason="스냅샷의 클러스터를 확인할 수 없음"
          hint={
            <span className="stack-sm">
              <span>metadata.json에 클러스터 ID가 없습니다 (없음·손상·형식 다름).</span>
              <span>잘못된 클러스터와 비교하면 전부 추가·삭제로 보일 수 있어 계산하지 않습니다. metadata.json을 먼저 확인하세요.</span>
            </span>
          }
          action={
            <span className="row gap-2">
              {disabledButton}
              <Button variant="ghost" onClick={onMeta}>
                메타데이터 보기
              </Button>
            </span>
          }
        />
      );
    case "NO_COMPARABLE_RESOURCES":
      return (
        <div className="stack">
          <UnknownState size="lg" reason="비교할 수 있는 리소스 없음" hint="이 스냅샷의 종류는 모두 대시보드 권한 밖입니다." />
          {data.uncomparable.length > 0 ? (
            <DriftSummary
              status={{ state: "unknown", srPrefix: "드리프트: " }}
              notComparable={data.uncomparable.map((u) => ({ kind: u.kind, count: u.count, reason: u.reason, text: u.text }))}
              totalUncomparable={data.drift.counts?.uncomparable}
            />
          ) : null}
        </div>
      );
    case "SNAPSHOT_FILES_PENDING":
      return <UnknownState size="lg" icon="hourglass" reason="스냅샷 파일 확인 전" hint="내보내기가 진행 중일 수 있습니다." />;
    case "DRIFT_RULES_UNAVAILABLE":
      return (
        <UnknownState
          size="lg"
          reason="드리프트 규칙을 불러올 수 없음"
          hint={
            <span className="stack-sm">
              <span>{text}</span>
              <span>api의 k8s 규칙 lib 위치 설정(K8S_SNAPSHOT_LIB_DIR)을 확인하세요.</span>
            </span>
          }
          action={disabledButton}
        />
      );
    case "DRIFT_FAILED":
      return <UnknownState size="lg" reason="드리프트 계산 실패" hint={text} action={<ComputeButton label="다시 계산" icon="refresh-cw" drift={drift} reason={computeReason} />} />;
    default:
      return <UnknownState size="lg" reason={text ?? "알 수 없음"} action={computeReason ? undefined : <ComputeButton label="드리프트 계산" drift={drift} />} />;
  }
}

function DriftBody({
  data,
  drift,
  computeReason,
  kubeStale,
  query,
  patch,
  onOpenFile,
  viewLast,
  setViewLast,
}: {
  data: DriftResponse;
  drift: DriftData;
  computeReason?: string;
  kubeStale: boolean;
  query: DetailQuery;
  patch: (p: Partial<DetailQuery>) => void;
  onOpenFile: (path: string) => void;
  viewLast: boolean;
  setViewLast: (v: boolean) => void;
}) {
  const badge = data.drift;
  const code = driftCode(badge);
  const stale = badge.status.stale || (kubeStale && badge.computed && code !== "DRIFT_NOT_COMPUTED");
  const hasResult = badge.computed && badge.counts !== null;

  // 계산 안 함 / 지난 결과 (6.8)
  if (code === "DRIFT_NOT_COMPUTED" && !stale) {
    const last = badge.mode === "last_result" && badge.computedAt && badge.lastResultStatus;
    if (last && badge.resultAvailable && viewLast && hasResult) {
      return (
        <ResultView
          data={data}
          drift={drift}
          computeReason={computeReason}
          stale={false}
          lastResult
          query={query}
          patch={patch}
          onOpenFile={onOpenFile}
        />
      );
    }
    const lastLine = last
      ? `지난 계산 ${formatTime(badge.computedAt!, "autoShort")} · ${badge.lastResultStatus === "warning" ? `차이 ${formatCount(driftDiffCount(badge))}건` : "차이 없음"}`
      : null;
    return (
      <Card padding="lg">
        <EmptyState
          size="lg"
          icon="git-compare"
          title="이 스냅샷은 드리프트를 자동으로 계산하지 않습니다"
          description={
            <span className="stack-sm">
              <span>같은 클러스터의 최신 스냅샷만 자동으로 계산합니다. 지금 클러스터와 비교하려면 계산하세요. 쿠버네티스 API는 읽기만 합니다.</span>
              {lastLine ? <span className="text-caption-tertiary">{lastLine}</span> : null}
              {last && !badge.resultAvailable ? (
                <span className="text-caption-tertiary">필드 차이는 계산 뒤 10분만 보관해 지금은 볼 수 없습니다.</span>
              ) : null}
            </span>
          }
          action={
            <span className="row gap-2">
              <ComputeButton label={last ? "다시 계산" : "드리프트 계산"} icon={last ? "refresh-cw" : "git-compare"} drift={drift} reason={computeReason} />
              {last && badge.resultAvailable && hasResult ? (
                <Button variant="secondary" onClick={() => setViewLast(true)}>
                  지난 결과 보기
                </Button>
              ) : null}
            </span>
          }
        />
      </Card>
    );
  }

  if (badge.status.status !== "ok" && badge.status.status !== "warning" && !stale) {
    // DRIFT_FAILED 인데 이전 결과가 있으면 지우지 않는다
    if (code === "DRIFT_FAILED" && hasResult && data.resources.length > 0) {
      return (
        <div className="stack">
          <InlineAlert
            tone="neutral"
            compact
            title={`마지막 계산이 실패했습니다.${badge.computedAt ? ` 이전 결과(${formatTime(badge.computedAt, "shortTime")})를 보여 줍니다.` : ""}`}
            action={<ComputeButton label="다시 계산" icon="refresh-cw" variant="secondary" drift={drift} reason={computeReason} />}
          />
          <ResultView data={data} drift={drift} computeReason={computeReason} stale={false} query={query} patch={patch} onOpenFile={onOpenFile} />
        </div>
      );
    }
    return <UnknownView data={data} drift={drift} computeReason={computeReason} onMeta={() => patch({ view: "meta" })} />;
  }

  return <ResultView data={data} drift={drift} computeReason={computeReason} stale={stale} query={query} patch={patch} onOpenFile={onOpenFile} />;
}

function ResultView({
  data,
  drift,
  computeReason,
  stale,
  lastResult = false,
  query,
  patch,
  onOpenFile,
}: {
  data: DriftResponse;
  drift: DriftData;
  computeReason?: string;
  stale: boolean;
  lastResult?: boolean;
  query: DetailQuery;
  patch: (p: Partial<DetailQuery>) => void;
  onOpenFile: (path: string) => void;
}) {
  const badge = data.drift;
  const counts = badge.counts;
  const kind = query.kind;
  const showHidden = query.hidden;
  const [search, setSearch] = useState("");
  // 1024~1279px: 목록을 위(최대 280px), 차이를 아래로 쌓는다 (디자인 13절)
  const wide = useMediaQuery("(min-width: 1280px)");
  const [expandedHidden, setExpandedHidden] = useState<Record<string, boolean>>({});

  // 지난 결과 보기: 배지는 lastResultStatus 로 (6.8)
  const view = lastResult
    ? { state: badge.lastResultStatus === "warning" ? ("changed" as const) : ("none" as const), count: driftDiffCount(badge), line2: "", refreshing: false }
    : driftCellView(badge, { kubeStale: stale });
  const reason =
    view.state === "changed" && counts
      ? [[counts.changed ? `변경 ${formatCount(counts.changed)}` : "", counts.deleted ? `삭제 ${formatCount(counts.deleted)}` : "", counts.added ? `추가 ${formatCount(counts.added)}` : ""].filter(Boolean).join(" · ")]
      : badge.status.reasons.map((r) => r.text);

  const visible = useMemo(() => visibleDriftResources(data.resources, kind, showHidden), [data.resources, kind, showHidden]);
  const nodes = useMemo(() => buildDriftTree(visible), [visible]);
  const selected = query.res ? (data.resources.find((r) => r.key === query.res) ?? null) : (visible[0] ?? null);
  const selectedGone = query.res !== null && selected === null;
  const noDiff = lastResult ? badge.lastResultStatus === "ok" : badge.status.status === "ok";
  const listVisible = !noDiff || (showHidden && visible.length > 0);

  const notices: ReactNode[] = [];
  const up = unparsableText(data.unparsable);
  if (up) {
    notices.push(
      <InlineAlert
        key="unparsable"
        tone="neutral"
        compact
        icon="file-warning"
        title={up}
        action={
          <Button variant="ghost" size="sm" onClick={() => patch({ view: "files" })}>
            파일 탭에서 보기
          </Button>
        }
      />,
    );
  }
  const addedSkipped = data.addedCheck === "skipped_scope_unknown" || data.notices.some((n) => n.code === "ADDED_NOT_CHECKED");
  if (addedSkipped) {
    const t = data.notices.find((n) => n.code === "ADDED_NOT_CHECKED")?.text ?? "범위를 알 수 없어 추가된 리소스는 확인하지 않음";
    notices.push(<InlineAlert key="added" tone="neutral" compact icon="circle-help" title={t} />);
  }
  for (const n of data.notices) {
    if (n.code === "ADDED_NOT_CHECKED") continue;
    notices.push(<InlineAlert key={`n-${n.code}`} tone="neutral" compact icon="info" title={n.text} />);
  }

  const summary = (
    <DriftSummary
      status={{
        state: view.state,
        count: view.count,
        staleAt: "staleAt" in view ? view.staleAt : undefined,
        previous: "previous" in view ? view.previous : undefined,
        refreshing: badge.computing,
      }}
      reason={reason.filter(Boolean)}
      computedAt={badge.computedAt ?? undefined}
      target={data.target ? { name: data.target.name ?? data.target.context ?? "—", context: data.target.context } : undefined}
      mode={badge.mode === "none" ? undefined : lastResult ? "last_result" : badge.mode}
      refreshing={badge.computing}
      onRecompute={computeReason ? undefined : () => drift.compute(true)}
      recomputeLoading={drift.pending}
      counts={counts ? { changed: counts.changed, deleted: counts.deleted, added: counts.added, same: counts.same, compared: counts.compared } : undefined}
      activeFilter={kind === "all" ? undefined : kind}
      onFilter={(k: DriftKind) => {
        if (k === "same") patch({ kind: "all", hidden: true, res: null });
        else patch({ kind: kind === k ? "all" : k, res: null });
      }}
      hidden={counts?.hidden}
      showHidden={showHidden}
      onShowHiddenChange={(v) => patch({ hidden: v })}
      notComparable={data.uncomparable.map((u) => ({ kind: u.kind, count: u.count, reason: u.reason, text: u.text }))}
      totalUncomparable={counts?.uncomparable}
      notices={notices}
      state={stale ? "stale" : lastResult ? "lastResult" : "ready"}
    />
  );

  return (
    <div className="stack">
      {lastResult && badge.computedAt ? (
        <InlineAlert
          tone="neutral"
          icon="history"
          title={`지난 결과입니다 (${formatTime(badge.computedAt, "autoShort")} 계산)`}
          description="지금 클러스터와 다를 수 있고 자동으로 갱신하지 않습니다. 필드 차이는 계산 뒤 10분 동안만 볼 수 있습니다."
          action={<ComputeButton label="다시 계산" icon="refresh-cw" drift={drift} reason={computeReason} />}
        />
      ) : null}
      {summary}
      {!listVisible ? (
        <Card padding="lg">
          <EmptyState
            size="sm"
            icon="circle-check"
            iconTone="ok"
            title="스냅샷과 클러스터가 같습니다"
            description={counts && counts.hidden.default + counts.hidden.managed > 0 ? "숨긴 차이는 요약에서 볼 수 있습니다." : undefined}
          />
        </Card>
      ) : (
        <Grid>
          <GridItem span={4} spanMd={12}>
            <Card padding="none" aria-label="드리프트 리소스 목록" style={{ height: wide ? WORK_HEIGHT : 380, display: "flex", flexDirection: "column" }}>
              <div className="stack-sm" style={{ padding: 12 }}>
                <SegmentedControl<DriftListKind>
                  size="sm"
                  label="드리프트 구분"
                  value={kind}
                  onChange={(v) => patch({ kind: v, res: null })}
                  options={[
                    { value: "all", label: "전체", count: counts ? counts.changed + counts.deleted + counts.added : undefined },
                    { value: "changed", label: "변경", count: counts?.changed },
                    { value: "deleted", label: "삭제", count: counts?.deleted },
                    { value: "added", label: "추가", count: counts?.added },
                  ]}
                />
                <SearchInput value={search} onChange={setSearch} placeholder="리소스 이름 검색" label="리소스 이름 검색" width={352} shortcut={false} />
              </div>
              <div style={{ flex: 1, minHeight: 0, padding: "0 12px 12px" }}>
                <ResourceTree
                  label="드리프트 리소스"
                  nodes={nodes}
                  variant="drift"
                  selectedId={selected?.key ?? null}
                  onSelect={(n) => patch({ res: n.id })}
                  defaultExpandedIds={allIds(nodes)}
                  key={`${kind}:${showHidden}`}
                  query={search.trim()}
                  height="100%"
                  state={visible.length === 0 ? "filteredEmpty" : "ready"}
                  filteredEmptyText="이 구분의 리소스가 없습니다"
                />
              </div>
            </Card>
          </GridItem>
          <GridItem span={8} spanMd={12}>
            <ResourceDiff
              resource={selected}
              gone={selectedGone}
              data={data}
              showHidden={showHidden}
              hiddenExpanded={selected ? Boolean(expandedHidden[selected.key]) : false}
              onHiddenToggle={() => selected && setExpandedHidden((m) => ({ ...m, [selected.key]: !m[selected.key] }))}
              onOpenFile={onOpenFile}
            />
          </GridItem>
        </Grid>
      )}
    </div>
  );
}

function allIds(nodes: { id: string; children?: { id: string; children?: unknown[] }[] }[]): string[] {
  const out: string[] = [];
  const walk = (ns: { id: string; children?: unknown[] }[]) => {
    for (const n of ns) {
      if (n.children && n.children.length > 0) {
        out.push(n.id);
        walk(n.children as { id: string; children?: unknown[] }[]);
      }
    }
  };
  walk(nodes);
  return out;
}

/** C. 리소스 차이 (디자인 6.5·6.6) */
function ResourceDiff({
  resource,
  gone,
  data,
  showHidden,
  hiddenExpanded,
  onHiddenToggle,
  onOpenFile,
}: {
  resource: DriftResource | null;
  gone: boolean;
  data: DriftResponse;
  showHidden: boolean;
  hiddenExpanded: boolean;
  onHiddenToggle: () => void;
  onOpenFile: (path: string) => void;
}) {
  if (!resource) {
    return (
      <Card padding="lg" style={{ minHeight: 240 }}>
        {gone ? (
          <EmptyState size="sm" icon="circle-check" iconTone="ok" title="이 리소스는 이제 차이가 없습니다" description="다시 계산한 결과 스냅샷과 클러스터가 같습니다." />
        ) : (
          <EmptyState size="sm" icon="file-text" title="왼쪽 목록에서 리소스를 고르세요" />
        )}
      </Card>
    );
  }
  const r = resource;
  const title = `${r.namespace ? `${r.namespace} / ` : ""}${r.name}`;
  const rows: FieldDiffRow[] = r.fields.map((f) => ({
    path: f.path,
    category: f.category,
    reason: f.reason,
    managedRule: f.managedRule ?? null,
    snapshot: f.snapshot,
    cluster: f.cluster,
  }));
  const kv = (
    <KeyValueList
      columns={1}
      labelWidth={120}
      items={[
        { label: "종류", value: r.kind },
        { label: "네임스페이스", value: r.namespace ? <span className="text-mono">{r.namespace}</span> : "—" },
        { label: "이름", value: <span className="text-mono">{r.name}</span> },
        ...(r.summary && r.summary.images.length > 0
          ? [
              {
                label: "이미지",
                value: (
                  <span className="stack-sm">
                    {r.summary.images.map((img) => (
                      <span key={img} className="text-mono" style={{ overflowWrap: "anywhere", fontSize: 12 }}>
                        {img}
                      </span>
                    ))}
                  </span>
                ),
              },
            ]
          : []),
        ...(r.summary && r.summary.replicas !== null ? [{ label: "replicas", value: <span className="tabular">{r.summary.replicas}</span> }] : []),
      ]}
    />
  );
  return (
    <Card padding="none" aria-label={`${r.name} 드리프트`}>
      <div className="stack-sm" style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border-subtle)" }}>
        <span className="row gap-2">
          <DriftKindChip kind={r.change} size="md" />
          <span className="text-caption">{kindVersionText(r)}</span>
        </span>
        <div className="row-between gap-2">
          <span className="row gap-1 min-w-0">
            <span className="text-mono text-strong truncate" title={title} style={{ fontSize: 13 }}>
              {title}
            </span>
            <CopyButton text={r.name} size="sm" label="리소스 이름 복사" />
          </span>
          {r.file ? (
            <Button variant="ghost" size="sm" icon="file-text" onClick={() => onOpenFile(r.file!)}>
              파일 보기
            </Button>
          ) : null}
        </div>
      </div>
      <div className="stack" style={{ padding: "16px 16px 20px" }}>
        {r.helmManaged ? (
          <InlineAlert tone="info" compact icon="ship-wheel" title="Helm이 관리하는 리소스입니다. kubectl apply보다 Helm으로 복원하세요." />
        ) : null}
        {r.change === "deleted" ? (
          <>
            <p className="text-caption">스냅샷에 있지만 지금 클러스터에는 없습니다.</p>
            {kv}
          </>
        ) : r.change === "added" ? (
          <>
            <InlineAlert
              tone="info"
              title="스냅샷에 없는 리소스입니다"
              description="이 리소스를 기록하려면 CLI로 새 스냅샷을 만드세요. 대시보드는 삭제 명령을 제안하지 않습니다."
            />
            {kv}
          </>
        ) : (
          <FieldDiffTable
            caption={`${r.name} 필드 차이`}
            rows={rows}
            showHidden={showHidden}
            hiddenExpanded={hiddenExpanded || r.change === "same"}
            onHiddenToggle={onHiddenToggle}
            truncated={r.fieldsTruncated}
            hiddenOnlyText={r.change === "same" ? "이 리소스는 숨긴 차이만 있어 같음으로 셉니다." : undefined}
          />
        )}
        {r.change !== "added" && r.commands ? <CommandBlock resource={r} data={data} /> : null}
      </div>
    </Card>
  );
}

/** 명령 블록 (디자인 6.5): 서버 문자열 그대로, 복사만 */
function CommandBlock({ resource, data }: { resource: DriftResource; data: DriftResponse }) {
  const cmds = resource.commands;
  if (!cmds) return null;
  const sc = data.snapshotCluster;
  return (
    <section className="stack-sm" style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 16 }} aria-label="직접 실행할 명령">
      <h4 className="text-caption text-strong">직접 실행할 명령 (복사만)</h4>
      {resource.fileDocuments !== undefined && resource.fileDocuments >= 2 ? (
        <InlineAlert tone="warn" compact title={`이 파일에는 리소스 ${formatCount(resource.fileDocuments)}개가 들어 있어 명령이 모두 적용합니다.`} />
      ) : null}
      <CommandLine command={cmds.diff} copyLabel="diff 명령 복사" fullWidth />
      <CommandLine command={cmds.apply} copyLabel="apply 명령 복사" fullWidth />
      <p className="text-caption row row-start gap-1-5" style={{ flexWrap: "nowrap" }}>
        <Icon name="info" size={12} />
        <span>{data.commandsNote ?? DEFAULT_COMMANDS_NOTE}</span>
      </p>
      <p className="text-caption row row-start gap-1-5" style={{ flexWrap: "nowrap" }}>
        <Icon name="info" size={12} />
        <span>
          실행 전 대상 클러스터를 확인하세요 (스냅샷: {sc?.name ?? "—"} · 컨텍스트 {sc?.context ?? "—"}).
        </span>
      </p>
    </section>
  );
}
