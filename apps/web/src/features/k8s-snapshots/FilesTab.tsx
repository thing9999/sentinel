"use client";

/**
 * 상세 파일 탭 (docs/design/k8s-snapshot.md 5절): 탐색 패널(4열: 리소스 트리 | 스캔 발견) + 파일 편집기(8열).
 * 트리 노드 순서는 서버 `tree`, 잎 정보는 `files[]`(경로 키), 예상 밖 파일은 `extraFiles`(열 수 없음).
 */
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  Chip,
  CommandLine,
  EmptyState,
  filterTree,
  formatCount,
  Grid,
  GridItem,
  Icon,
  IconButton,
  InlineAlert,
  ResourceTree,
  ScanCounts,
  ScanFindingList,
  SearchInput,
  SegmentedControl,
  Select,
  countLeaves,
  allBranchIds,
  defaultExpandedIds,
  worstScanLevel,
} from "@/components/ui";

import { atExportCompareText, snapshotTimeLabel } from "../aws-snapshots/model";
import { K8sFileEditor, type K8sEditorController } from "./FileEditor";
import { buildFileTree, TREE_FILTER_LABEL, type TreeFilter } from "./model";
import { K8sScanRulesHelp } from "./shared";
import type { K8sSnapshotDetailData } from "./types";

/** 작업 영역 높이 (ASM-D 5.2와 같음) */
export const WORK_HEIGHT = "clamp(480px, calc(100vh - 176px), 960px)";

type ExplorerMode = "tree" | "scan";

export function FilesTab({
  ctl,
  detail,
  scanCommand,
  stale,
  onEditNotes,
}: {
  ctl: K8sEditorController;
  detail: K8sSnapshotDetailData;
  scanCommand: string;
  stale: boolean;
  onEditNotes?: () => void;
}) {
  const errors = detail.scan.current.summary.errors;
  const [mode, setMode] = useState<ExplorerMode>(errors > 0 ? "scan" : "tree");
  return (
    <Grid>
      {/* 1024~1279px 에서도 4:8 비율 유지 (디자인 13절) */}
      <GridItem span={4} spanMd={4}>
        <Card padding="none" aria-label="탐색 패널" style={{ height: WORK_HEIGHT, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
            <SegmentedControl<ExplorerMode>
              size="sm"
              label="탐색 보기"
              value={mode}
              onChange={setMode}
              options={[
                { value: "tree", label: "리소스", count: countResourceFiles(detail) },
                {
                  value: "scan",
                  label: "스캔 발견",
                  count: detail.scan.current.findings.length,
                  status: worstScanLevel(detail.scan.current.findings.map((f) => f.severity))?.status,
                },
              ]}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: mode === "scan" ? "auto" : "hidden" }}>
            {mode === "tree" ? <TreeView ctl={ctl} detail={detail} /> : <ScanView ctl={ctl} detail={detail} scanCommand={scanCommand} stale={stale} onEditNotes={onEditNotes} />}
          </div>
        </Card>
      </GridItem>
      <GridItem span={8} spanMd={8}>
        <K8sFileEditor ctl={ctl} height={`calc(${WORK_HEIGHT} - 96px)`} />
      </GridItem>
    </Grid>
  );
}

const countResourceFiles = (d: K8sSnapshotDetailData) => d.files.filter((f) => f.fileType === "resource" || f.fileType === "namespace").length;

function TreeView({ ctl, detail }: { ctl: K8sEditorController; detail: K8sSnapshotDetailData }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TreeFilter>("all");
  const systemChip = useMemo(() => <Chip size="sm" icon="settings" label="시스템" />, []);
  const tree = useMemo(
    () => buildFileTree(detail, { filter, dirtyPath: ctl.dirtyPath, systemChip }),
    [detail, filter, ctl.dirtyPath, systemChip],
  );
  const [expanded, setExpanded] = useState<string[]>(() => defaultExpandedIds(tree.nodes, 150));
  const driftComputed = detail.files.some((f) => f.drift !== null);
  const filterOptions = (["all", "scan", "issues", "drift", "helm"] as TreeFilter[])
    .filter((k) => k !== "drift" || driftComputed)
    .map((k) => ({ value: k, label: TREE_FILTER_LABEL[k], count: k === "all" ? undefined : tree.counts[k] }));
  const filtering = filter !== "all" || search.trim() !== "";
  const shownCount = search.trim() ? countLeaves(filterTree(tree.nodes, search.trim()).nodes.filter((n) => n.id !== "g:extra")) : tree.shown;
  const resultText = filtering
    ? `리소스 ${formatCount(tree.resourceCount)}개 중 ${formatCount(shownCount)}개`
    : `리소스 ${formatCount(tree.resourceCount)}개 · 네임스페이스 ${formatCount(tree.namespaceCount)} · 종류 ${formatCount(tree.kindCount)}`;
  const empty = detail.files.length === 0 && detail.extraFiles.length === 0;
  const filteredEmpty = !empty && (tree.nodes.length === 0 || (search.trim() !== "" && shownCount === 0));

  return (
    <div className="stack-sm" style={{ padding: 12, height: "100%", display: "flex", flexDirection: "column" }}>
      <SearchInput value={search} onChange={setSearch} placeholder="리소스 이름·경로 검색" label="리소스 이름·경로 검색" width={352} />
      <div className="row-between gap-2">
        <Select label="표시" width={176} value={filter} onChange={(v) => setFilter(v as TreeFilter)} options={filterOptions} />
        <span className="row gap-1">
          <IconButton icon="chevrons-up-down" size="sm" label="모두 펼치기" onClick={() => setExpanded(allBranchIds(tree.nodes))} />
          <IconButton icon="chevrons-down-up" size="sm" label="모두 접기" onClick={() => setExpanded([])} />
        </span>
      </div>
      <p className="text-caption tabular">{resultText}</p>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResourceTree
          label="스냅샷 리소스"
          nodes={tree.nodes}
          variant="files"
          selectedId={ctl.openPath}
          onSelect={(n) => ctl.requestOpen(n.id)}
          expandedIds={expanded}
          onExpandedChange={setExpanded}
          query={search.trim()}
          height="100%"
          state={empty ? "empty" : filteredEmpty ? "filteredEmpty" : "ready"}
          emptyText="리소스 파일이 없습니다"
          onResetFilters={() => {
            setFilter("all");
            setSearch("");
          }}
        />
      </div>
    </div>
  );
}

/** 스캔 발견 보기 (디자인 5.3 = ASM-D 4.5 를 탐색 패널 안으로) */
function ScanView({
  ctl,
  detail,
  scanCommand,
  stale,
  onEditNotes,
}: {
  ctl: K8sEditorController;
  detail: K8sSnapshotDetailData;
  scanCommand: string;
  stale: boolean;
  onEditNotes?: () => void;
}) {
  const cur = detail.scan.current;
  const unreadable = detail.status.reasons.some((r) => r.code === "FILE_UNREADABLE");
  const findings = ctl.scanFindings.map((f, i) =>
    cur.findings[i]?.fileType === "notes" && onEditNotes
      ? {
          ...f,
          action: (
            <Button variant="ghost" size="sm" icon="tag" onClick={onEditNotes}>
              라벨·메모 편집
            </Button>
          ),
        }
      : f,
  );
  const resourceFiles = countResourceFiles(detail);
  return (
    <div className="stack" style={{ padding: 12 }}>
      <div className="row-between">
        <h3 className="text-h3">비밀값 스캔</h3>
        <K8sScanRulesHelp />
      </div>
      <div className="stack-sm">
        <div className="row-between">
          <ScanCounts
            size="md"
            errors={unreadable ? null : cur.summary.errors}
            warnings={unreadable ? null : cur.summary.warnings}
            state={unreadable ? "unknown" : stale ? "stale" : "ready"}
            unknownText="스캔할 수 없음 (파일을 읽을 수 없음)"
          />
          {cur.summary.strict ? <Chip size="sm" tone="neutral" icon="lock" label="strict" tooltip="내보내기 때 --strict: 경고도 커밋 금지로 판단합니다" /> : null}
        </div>
        <p className="text-caption-tertiary" suppressHydrationWarning>
          현재 파일 기준{cur.scannedAt ? ` · ${snapshotTimeLabel(cur.scannedAt, "—")} 스캔` : ""}
        </p>
        <p className="text-caption">리소스 파일 {formatCount(resourceFiles)}개 + metadata.json을 스캔했습니다</p>
        <p className="text-caption">{atExportCompareText(detail.scan.atExport, cur.summary)}</p>
      </div>
      {ctl.session ? <InlineAlert tone="info" compact title="줄 번호는 마지막 저장 기준입니다. 저장하면 다시 계산합니다." /> : null}
      <div style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
        {cur.findings.length === 0 ? (
          <EmptyState size="sm" icon="circle-check" iconTone="ok" title="발견 없음" description="현재 파일에서 스캔 규칙에 걸린 줄이 없습니다." />
        ) : (
          <ScanFindingList findings={findings} selectedId={ctl.selectedId} onSelect={ctl.selectFinding} maxHeight={360} label="스캔 발견 목록" truncateFile />
        )}
      </div>
      <p className="text-caption row row-start gap-1-5" style={{ flexWrap: "nowrap" }}>
        <Icon name="info" size={14} />
        <span>스캐너는 모든 비밀값을 잡는다는 보장이 없습니다. 커밋 전 diff를 직접 확인하세요.</span>
      </p>
      <div className="stack-sm">
        <span className="text-caption">CLI로 같은 결과 확인</span>
        <CommandLine command={scanCommand} copyLabel="재스캔 명령 복사" fullWidth />
      </div>
    </div>
  );
}
