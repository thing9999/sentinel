"use client";

/**
 * 상세 화면 A~D 영역 (docs/design/aws-snapshot-manager.md 4.4·4.5·4.7·4.8·4.9).
 * 값·상태·사유는 서버 값 그대로. 사용자 입력(라벨·메모·파일 이름)은 텍스트로만.
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  Button,
  Card,
  Chip,
  CodeEditor,
  CommandLine,
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
  ScanFindingList,
  SegmentedControl,
  Skeleton,
  StatusIcon,
  Timestamp,
  type Column,
  type KeyValueItem,
  type Status,
} from "@/components/ui";

import { useApi } from "../common/hooks";
import { badgeProps } from "../stream/stale";
import { markChip } from "./dialogs";
import { atExportCompareText, folderRows, formatSize, snapshotTimeLabel, type FolderRow } from "./model";
import { ScanRulesHelp } from "./shared";
import type { FileResponse, MetadataFields, ResourceCounts, SnapshotDetailData } from "./types";
import type { TemplateEditorController } from "./TemplateEditor";

// ---------------------------------------------------------------- A. 요약 카드 (4.4)

export function SummaryCard({
  detail,
  onEditNotes,
  notesDisabledReason,
  highlight,
}: {
  detail: SnapshotDetailData;
  onEditNotes: () => void;
  notesDisabledReason?: string;
  highlight: boolean;
}) {
  const [memoOpen, setMemoOpen] = useState(false);
  const b = badgeProps(detail.status);
  const reasons = detail.status.reasons;
  const hasReasons = reasons.length > 0;
  const cardStatus = b.status === "crit" ? "crit" : b.status === "warn" ? "warn" : undefined;
  const memo = detail.notes.memo ?? detail.memo;
  const label = detail.notes.label ?? detail.label;
  const longMemo = Boolean(memo && (memo.split("\n").length > 6 || memo.length > 400));

  const notes = (
    <section aria-label="라벨·메모" className="stack-sm" style={{ background: highlight ? "var(--color-bg-selected)" : undefined, transition: "background 200ms" }}>
      <div className="row-between">
        <h3 className="text-caption text-strong">라벨·메모</h3>
        {label || memo ? (
          <Button variant="ghost" size="sm" icon="pencil" onClick={onEditNotes} disabled={Boolean(notesDisabledReason)} disabledReason={notesDisabledReason}>
            편집
          </Button>
        ) : null}
      </div>
      {label || memo ? (
        <>
          {label ? <p className="text-strong" style={{ overflowWrap: "anywhere" }}>{label}</p> : null}
          {memo ? (
            <p
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                maxHeight: memoOpen ? undefined : 120,
                overflow: memoOpen ? undefined : "hidden",
              }}
            >
              {memo}
            </p>
          ) : null}
          {longMemo ? (
            <span>
              <Button variant="ghost" size="sm" onClick={() => setMemoOpen((v) => !v)} aria-expanded={memoOpen}>
                {memoOpen ? "접기" : "더 보기"}
              </Button>
            </span>
          ) : null}
          {detail.notes.updatedAt ? (
            <p className="text-caption-tertiary" suppressHydrationWarning>
              {snapshotTimeLabel(detail.notes.updatedAt, "—")} 수정
            </p>
          ) : null}
        </>
      ) : (
        <div className="row gap-2">
          <span className="text-caption-tertiary">라벨·메모 없음</span>
          <Button variant="ghost" size="sm" icon="tag" onClick={onEditNotes} disabled={Boolean(notesDisabledReason)} disabledReason={notesDisabledReason}>
            라벨·메모 추가
          </Button>
        </div>
      )}
    </section>
  );

  return (
    <Card padding="lg" status={cardStatus} as="section" aria-label="요약">
      <div className="stack-lg">
        {hasReasons ? (
          <Grid>
            <GridItem span={7} spanMd={12}>
              <section aria-label="판단 사유" className="stack-sm">
                <h3 className="text-caption text-strong">판단 사유</h3>
                <ul className="list-plain stack-sm">
                  {reasons.map((r, i) => {
                    const st: Status = r.status === "critical" ? "crit" : r.status === "warning" ? "warn" : r.status === "ok" ? "ok" : "unknown";
                    return (
                      <li key={`${r.code}-${i}`} className="row row-start gap-2" style={{ minHeight: 28 }}>
                        <StatusIcon status={st} size={14} />
                        <span className={st === "crit" ? "text-strong" : undefined} style={st === "crit" ? { color: "var(--color-status-crit-fg)" } : undefined}>
                          {r.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </GridItem>
            <GridItem span={5} spanMd={12}>
              {notes}
            </GridItem>
          </Grid>
        ) : (
          notes
        )}
        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 16 }}>
          <InlineAlert
            tone="info"
            icon="hand"
            title="대시보드는 커밋·적용하지 않습니다"
            description={
              <span className="stack-sm">
                <span>커밋 전 deploy/aws-snapshot/README.md &apos;커밋 전 체크리스트&apos;를 확인하고 터미널에서 git diff로 직접 확인하세요.</span>
                <span>적용(복원)은 README 7장 절차에 따라 직접 하세요.</span>
              </span>
            }
          />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- D. 스캔 패널 (4.5)

export function ScanPanel({
  detail,
  ctl,
  scanCommand,
  stale,
  onEditNotes,
}: {
  detail: SnapshotDetailData;
  ctl: TemplateEditorController;
  scanCommand: string;
  stale: boolean;
  onEditNotes?: () => void;
}) {
  const [filesOpen, setFilesOpen] = useState(false);
  const cur = detail.scan.current;
  const unreadable = detail.status.reasons.some((r) => r.code === "FILE_UNREADABLE");
  // 라벨·메모 파일의 발견은 편집기로 이동할 수 없으니 라벨·메모 편집 버튼을 붙인다 (components.md 11.2 비이동 action)
  const findings = ctl.scanFindings.map((f, i) =>
    cur.findings[i]?.fileKind === "notes" && onEditNotes
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

  return (
    <Card as="section" padding="md" aria-label="비밀값 스캔" style={{ height: "100%" }}>
      <div className="stack">
        <div className="row-between">
          <h3 className="text-h3">비밀값 스캔</h3>
          <ScanRulesHelp />
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
            {cur.summary.strict ? (
              <Chip size="sm" tone="neutral" icon="lock" label="strict" tooltip="내보내기 때 --strict: 경고도 커밋 금지로 판단합니다" />
            ) : null}
          </div>
          <p className="text-caption-tertiary" suppressHydrationWarning>
            현재 파일 기준{cur.scannedAt ? ` · ${snapshotTimeLabel(cur.scannedAt, "—")} 스캔` : ""}
          </p>
          <p className="text-caption">{atExportCompareText(detail.scan.atExport, cur.summary)}</p>
          <span>
            <Button variant="ghost" size="sm" icon="chevron-down" aria-expanded={filesOpen} onClick={() => setFilesOpen((v) => !v)}>
              스캔한 파일 {formatCount(cur.scannedFiles.length)}개
            </Button>
          </span>
          {filesOpen ? (
            <ul className="list-plain">
              {cur.scannedFiles.map((f) => (
                <li key={f} className="text-mono text-caption" style={{ lineHeight: "20px" }}>
                  {f}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {ctl.session ? <InlineAlert tone="info" compact title="줄 번호는 마지막 저장 기준입니다. 저장하면 다시 계산합니다." /> : null}
        <div style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
          {cur.findings.length === 0 ? (
            <EmptyState size="sm" icon="circle-check" iconTone="ok" title="발견 없음" description="현재 파일에서 스캔 규칙에 걸린 줄이 없습니다." />
          ) : (
            <ScanFindingList findings={findings} selectedId={ctl.selectedId} onSelect={ctl.selectFinding} maxHeight={360} label="스캔 발견 목록" />
          )}
        </div>
        <p className="text-caption row row-start gap-1-5">
          <Icon name="info" size={14} />
          스캐너는 모든 비밀값을 잡는다는 보장이 없습니다. 커밋 전 diff를 직접 확인하세요.
        </p>
        <div className="stack-sm">
          <span className="text-caption">CLI로 같은 결과 확인</span>
          <CommandLine command={scanCommand} copyLabel="재스캔 명령 복사" fullWidth />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- C. 리소스 수 (4.7)

interface ResourceRow {
  key: string;
  label: ReactNode;
  counts: ResourceCounts | null;
  delta?: ResourceCounts | null;
  strong?: boolean;
  chip?: ReactNode;
  warnZero?: boolean;
}

function countCell(v: number | null | undefined, opts: { strong?: boolean; delta?: number | null; warnZero?: boolean; missing?: boolean }) {
  if (opts.missing) return <span className="text-caption-tertiary">파일 없음</span>;
  if (v === null || v === undefined) return <span className="text-caption-tertiary">-</span>;
  return (
    <span className={`row row-end gap-1 tabular${opts.strong ? " text-strong" : ""}`}>
      {opts.warnZero && v === 0 ? <StatusIcon status="warn" size={12} /> : null}
      {formatCount(v)}
      {opts.delta !== undefined && opts.delta !== null ? (
        <span className="text-caption-tertiary">({opts.delta === 0 ? "0" : opts.delta > 0 ? `+${formatCount(opts.delta)}` : `−${formatCount(-opts.delta)}`})</span>
      ) : null}
    </span>
  );
}

export function ResourcesCard({ detail }: { detail: SnapshotDetailData }) {
  const r = detail.resources;
  const missing = (kind: "cloudformation" | "terraform") => !detail.files.find((f) => f.kind === kind)?.exists;
  const rows: ResourceRow[] = [
    { key: "current", label: "현재 파일", counts: r.current, strong: true, warnZero: true },
    {
      key: "export",
      label: (
        <span className="row gap-2">
          내보내기 당시
          {r.changedSinceExport ? <Chip size="sm" tone="info" label="내보내기 후 변경됨" /> : null}
        </span>
      ),
      counts: r.atExport,
    },
    {
      key: "previous",
      label: r.previous ? (
        <span className="row gap-2">
          직전 스냅샷
          <Link href={`/snapshots/${r.previous.snapshotId}`} className="text-link text-mono text-caption">
            {r.previous.snapshotId}
          </Link>
        </span>
      ) : (
        "직전 스냅샷"
      ),
      counts: r.previous?.counts ?? null,
    },
  ];
  const columns: Column<ResourceRow>[] = [
    { id: "label", header: "구분", minWidth: 120, render: (row) => row.label },
    {
      id: "cfn",
      header: "CloudFormation",
      width: 112,
      align: "right",
      numeric: true,
      render: (row) =>
        row.key === "previous" && !row.counts
          ? "-"
          : countCell(row.counts?.cloudformation, {
              strong: row.strong,
              warnZero: row.warnZero,
              missing: row.key === "current" && missing("cloudformation"),
              delta: row.key === "previous" && r.delta ? r.delta.cloudformation : undefined,
            }),
    },
    {
      id: "tf",
      header: "Terraform",
      width: 112,
      align: "right",
      numeric: true,
      render: (row) =>
        row.key === "previous" && !row.counts
          ? "-"
          : countCell(row.counts?.terraform, {
              strong: row.strong,
              warnZero: row.warnZero,
              missing: row.key === "current" && missing("terraform"),
              delta: row.key === "previous" && r.delta ? r.delta.terraform : undefined,
            }),
    },
  ];
  return (
    <Card as="section" padding="md" aria-label="리소스 수" style={{ height: "100%" }}>
      <div className="stack">
        <div className="row gap-2" style={{ alignItems: "baseline" }}>
          <h3 className="text-h3">리소스 수</h3>
          <span className="text-caption-tertiary">CLI와 같은 규칙으로 셉니다</span>
        </div>
        <DataTable caption="리소스 수" density="compact" columns={columns} rows={rows} rowKey={(row) => row.key} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- 폴더 내용 (4.8)

export function FolderCard({ detail }: { detail: SnapshotDetailData }) {
  const rows = folderRows(detail);
  const present = rows.filter((r) => r.mark !== "missing");
  const total = present.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);
  const hasOdd = rows.some((r) => r.mark === "unexpected" || r.mark === "raw");
  const columns: Column<FolderRow>[] = [
    { id: "name", header: "파일", minWidth: 160, render: (r) => <span className="text-mono text-caption">{r.name}</span> },
    { id: "size", header: "크기", width: 80, align: "right", numeric: true, render: (r) => (r.mark === "missing" ? "—" : formatSize(r.sizeBytes)) },
    {
      id: "modified",
      header: "수정",
      width: 112,
      render: (r) => (r.modifiedAt ? <Timestamp value={r.modifiedAt} format="auto" /> : "—"),
    },
    {
      id: "mark",
      header: "표시",
      width: 120,
      render: (r) =>
        markChip(r.mark),
    },
  ];
  return (
    <Card as="section" padding="md" aria-label="폴더 내용" style={{ height: "100%" }}>
      <div className="stack">
        <div className="row gap-2" style={{ alignItems: "baseline" }}>
          <h3 className="text-h3">폴더 내용</h3>
          <span className="text-caption-tertiary">
            파일 {formatCount(present.length)}개 · {formatSize(total)}
          </span>
        </div>
        <DataTable caption="폴더 내용" density="compact" columns={columns} rows={rows} rowKey={(r) => r.key} />
        {hasOdd ? (
          <p className="text-caption">대시보드는 이 파일을 열거나 고치거나 지우지 않습니다. 폴더를 휴지통으로 옮기면 함께 옮겨집니다.</p>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- B. 메타데이터 (4.9)

const yesNo = (v: boolean | null | undefined) => (v === true ? "예" : v === false ? "아니요" : "—");
const dash = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : v);

function metadataItems(detail: SnapshotDetailData, m: MetadataFields): KeyValueItem[] {
  const notices = new Set(detail.notices.map((n) => n.code));
  const reasons = new Set(detail.status.reasons.map((r) => r.code));
  const noticeText = (code: string) => detail.notices.find((n) => n.code === code)?.text;
  const mono = (v: ReactNode) => <span className="text-mono">{v}</span>;
  const items: KeyValueItem[] = [
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
    { label: "리전", value: mono(dash(m.region)) },
    { label: "프로필 이름", value: mono(dash(m.profile)) },
    {
      label: "필터",
      value: (
        <span className="stack-sm">
          <span>검색 {m.searchFilter ? mono(m.searchFilter) : "없음"}</span>
          <span>정규식 {m.regexFilter ? mono(m.regexFilter) : "없음"}</span>
        </span>
      ),
      note: notices.has("FILTER_NONE") ? { tone: "info", text: noticeText("FILTER_NONE") ?? "필터 없음(선택한 서비스의 리전 내 전체)" } : undefined,
    },
    {
      label: "서비스",
      value: m.services ? (
        <span>
          {m.services.mode === "include" ? "포함" : "제외"}: <span className="text-mono" style={{ overflowWrap: "anywhere" }}>{m.services.list.join(", ") || "—"}</span>
        </span>
      ) : (
        "—"
      ),
    },
    {
      label: "민감 서비스",
      value: yesNo(m.allowSensitiveServices),
      note: reasons.has("SENSITIVE_SERVICES_ALLOWED") ? { tone: "warn", text: "민감 서비스 포함으로 내보냄" } : undefined,
    },
    { label: "기본 리소스", value: yesNo(m.includeDefaultResources) },
    {
      label: "DeletionPolicy",
      value: mono(dash(m.cfnDeletionPolicy)),
      note: notices.has("DELETION_POLICY_NOT_RETAIN") ? { tone: "info", text: noticeText("DELETION_POLICY_NOT_RETAIN") ?? "README는 Retain 권장" } : undefined,
    },
    {
      label: "former2",
      value: (
        <span className="stack-sm">
          <span className="text-mono">{dash(m.former2?.version)}</span>
          {m.former2?.args && m.former2.args.length > 0 ? (
            <span className="text-mono text-caption" style={{ overflowWrap: "anywhere" }}>
              {m.former2.args.join(" ")}
            </span>
          ) : null}
        </span>
      ),
    },
    { label: "Node", value: mono(dash(m.node)) },
    {
      label: "계정 ID",
      value: (
        <span className="stack-sm">
          <span className="text-mono">{m.account?.ids?.join(", ") || "—"}</span>
          {m.account?.note ? <span className="text-caption">{m.account.note}</span> : null}
        </span>
      ),
      note: reasons.has("ACCOUNT_ID_UNMASKED") ? { tone: "warn", text: "계정 ID 원문" } : undefined,
    },
    {
      label: "내보내기 당시 리소스 수",
      value: m.resources ? `CloudFormation ${m.resources.cloudformation ?? "—"} / Terraform ${m.resources.terraform ?? "—"}` : "—",
      note: notices.has("RESOURCES_CHANGED_SINCE_EXPORT")
        ? { tone: "info", text: noticeText("RESOURCES_CHANGED_SINCE_EXPORT") ?? "내보내기 후 변경됨" }
        : undefined,
    },
    {
      label: "raw 데이터",
      value: m.rawData ? (m.rawData.saved ? `저장함${m.rawData.location ? ` (${m.rawData.location})` : ""}` : "저장 안 함") : "—",
      note: notices.has("RAW_DATA_ELSEWHERE") ? { tone: "info", text: noticeText("RAW_DATA_ELSEWHERE") ?? "raw 데이터는 .raw/에 있으며 이 화면에서 다루지 않음" } : undefined,
    },
    {
      label: "내보내기 당시 스캔",
      value: m.secretScan ? (
        <span className="row gap-2">
          <ScanCounts errors={m.secretScan.errors} warnings={m.secretScan.warnings} srPrefix="내보내기 당시 스캔" />
          {m.secretScan.strict ? <Chip size="sm" tone="neutral" icon="lock" label="strict" /> : null}
          {m.secretScan.rules.length > 0 ? <span className="text-mono text-caption">{m.secretScan.rules.join(", ")}</span> : null}
        </span>
      ) : (
        "—"
      ),
    },
  ];
  return items;
}

/** "JSON 해석 실패 (줄 3, 열 5)" → 3 */
export function errorLine(text: string | null | undefined): number | null {
  const m = text?.match(/줄\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

export function MetadataSection({ id, detail }: { id: string; detail: SnapshotDetailData }) {
  const [view, setView] = useState<"table" | "raw">("table");
  const meta = detail.metadata;
  const metaFile = detail.files.find((f) => f.kind === "metadata");
  const wantRaw = meta.state === "corrupt" || view === "raw";
  const raw = useApi<FileResponse>(wantRaw && metaFile?.exists ? `/aws-snapshots/${encodeURIComponent(id)}/files/metadata` : null, undefined, metaFile?.version ?? "");
  const showToggle = meta.state === "ok" || meta.state === "schema_mismatch";
  const unknown = badgeProps(detail.status).status === "unknown";

  let body: ReactNode;
  if (meta.state === "missing") {
    body = (
      <InlineAlert
        tone={unknown ? "neutral" : "warn"}
        icon={unknown ? "hourglass" : undefined}
        title="metadata.json이 없습니다"
        description="내보내기가 중단됐거나 손으로 만든 폴더일 수 있습니다."
      />
    );
  } else if (meta.state === "corrupt") {
    const line = errorLine(meta.error);
    body = (
      <div className="stack">
        <InlineAlert
          tone="crit"
          title="metadata.json을 읽을 수 없습니다 (JSON 해석 실패)"
          description={meta.error ? `${line ? `${line}번째 줄 근처 · ` : ""}${meta.error}` : undefined}
        />
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
          <KeyValueList columns={2} labelWidth={160} items={metadataItems(detail, meta.fields ?? {})} />
        </Card>
      </div>
    );
  }

  return (
    <section aria-labelledby="snapshot-metadata-title" className="stack">
      <div className="row-between gap-2" style={{ flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 id="snapshot-metadata-title" className="text-h3" style={{ fontSize: 18 }}>
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
