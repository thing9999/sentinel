"use client";

/**
 * 컨트롤 플레인 UI 미리보기 (kops-support).
 * 문서: components.md 18·19절, cluster-status.md 3.2, status.md 2.5.
 * 모든 값은 이 파일 안의 고정 예시다(fetch·SSE 없음). 쿼럼·HA·셀 상태는 전부 "서버가 줬다"고 가정한 값이다.
 */
import {
  Chip,
  ComponentMatrix,
  Grid,
  InlineAlert,
  ResourceName,
  Section,
  StatusCard,
  SummaryStrip,
  SummaryStripItem,
  type ComponentMatrixCell,
  type ComponentMatrixColumn,
  type ComponentMatrixRow,
} from "../index";

const T0 = "2026-09-19T05:02:10.000Z";

const ROWS: ComponentMatrixRow[] = [
  { id: "kube-apiserver", label: "kube-apiserver" },
  { id: "kube-controller-manager", label: "kube-controller-manager" },
  { id: "kube-scheduler", label: "kube-scheduler" },
  { id: "etcd-manager-main", label: "etcd-manager-main" },
  { id: "etcd-manager-events", label: "etcd-manager-events" },
];

const COLUMNS: ComponentMatrixColumn[] = [
  { id: "a", name: "i-0a1b2c3d4e5f6a7b8", meta: "ap-northeast-2a · t3.medium", status: "ok" },
  {
    id: "c",
    name: "i-0c3d4e5f6a7b8c9d0",
    meta: "ap-northeast-2c · t3.medium",
    status: "warn",
    notReporting: true,
    reason: "NotReady 4분",
  },
  { id: "d", name: "i-0e5f6a7b8c9d0e1f2", meta: "ap-northeast-2d · t3.medium", status: "ok" },
];

function ready(columnId: string, rowId: string): ComponentMatrixCell {
  return {
    columnId,
    rowId,
    state: "ok",
    label: "Ready",
    href: `/cluster/pods/kube-system/${rowId}-${columnId}`,
    tooltip: `${rowId}-${columnId} · 정상 · Running`,
  };
}

function notReporting(columnId: string, rowId: string): ComponentMatrixCell {
  return {
    columnId,
    rowId,
    state: "notReporting",
    label: "노드 미보고",
    detail: "마지막 보고 04:58",
    href: `/cluster/pods/kube-system/${rowId}-${columnId}`,
    tooltip: "마스터가 NotReady라 미러 파드 상태를 믿을 수 없습니다 (마지막 보고 04:58)",
  };
}

const CELLS: ComponentMatrixCell[] = ROWS.flatMap((r) => [
  r.id === "kube-scheduler"
    ? {
        columnId: "a",
        rowId: r.id,
        state: "crit" as const,
        label: "장애",
        detail: "CrashLoopBackOff · 재시작 4회",
        href: "/cluster/pods/kube-system/kube-scheduler-i-0a1b2c3d4e5f6a7b8",
        tooltip:
          "kube-scheduler-i-0a1b… · 장애 · CrashLoopBackOff · 최근 1시간 재시작 4회 · 마지막 종료 OOMKilled 14:01:52",
      }
    : ready("a", r.id),
  notReporting("c", r.id),
  r.id === "etcd-manager-events"
    ? {
        columnId: "d",
        rowId: r.id,
        state: "missing" as const,
        label: "없음",
        detail: "필수 구성요소가 보이지 않습니다",
      }
    : ready("d", r.id),
]);

const SUMMARY = [
  { state: "ok" as const, count: 9 },
  { state: "warn" as const, count: 0 },
  { state: "crit" as const, count: 1 },
  { state: "unknown" as const, count: 5 },
];

const SINGLE_COLUMN: ComponentMatrixColumn[] = [
  { id: "a", name: "i-0a1b2c3d4e5f6a7b8", meta: "ap-northeast-2a · t3.medium", status: "ok" },
];
const SINGLE_CELLS = ROWS.map((r) => ready("a", r.id));

const SIX_COLUMNS: ComponentMatrixColumn[] = Array.from({ length: 6 }, (_, i) => ({
  id: `m${i}`,
  name: `i-0a1b2c3d4e5f6a7b${i}`,
  meta: `ap-northeast-2${"acd"[i % 3]} · t3.medium`,
  status: "ok" as const,
}));
const SIX_CELLS = SIX_COLUMNS.flatMap((c) => ROWS.map((r) => ready(c.id, r.id)));

export function ControlPlanePreview() {
  return (
    <>
      <Section
        title="컨트롤 플레인 (kops-support)"
        meta="components.md 18·19절 · cluster-status.md 3.2 · status.md 2.5"
      >
        <SummaryStrip
          overall={{ status: "warn", reason: ["마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실"] }}
          meta={
            <ResourceName
              name="prod-ap-northeast-2.platform.k8s.example.com"
              kind="cluster"
              maxWidth={240}
              tooltipExtra="Kubernetes v1.31.2 · ap-northeast-2"
            />
          }
          updatedAt={T0}
        >
          <SummaryStripItem
            label="노드 Ready (워커)"
            value="6/6"
            status="ok"
            href="/cluster/nodes"
            sub="컨트롤 플레인 3/3"
            subHref="/cluster/nodes#control-plane"
          />
          <SummaryStripItem label="파드" value="2 · 3 · 51" href="/cluster/pods" />
          <SummaryStripItem label="워크로드" value="1 · 0 · 23" href="/cluster/workloads" />
        </SummaryStrip>

        <Grid columns={3} columnsMd={2} columnsSm={1}>
          <StatusCard
            title="컨트롤 플레인"
            icon="server-cog"
            status="warn"
            primary="마스터 2/3"
            primarySub="필수 구성요소 10/15 · 알 수 없음 5"
            items={[
              {
                label: "i-0c3d4e5f6a7b8c9d0",
                href: "/cluster/nodes/i-0c3d4e5f6a7b8c9d0",
                status: "unknown",
                detail: "노드 미보고",
                mono: true,
              },
            ]}
            href="/cluster/nodes#control-plane"
            footerLabel="컨트롤 플레인 보기"
          />
          <StatusCard
            title="컨트롤 플레인"
            icon="server-cog"
            status="ok"
            primary="마스터 1/1"
            primarySub="필수 구성요소 5/5"
            href="/cluster/nodes#control-plane"
          />
          <StatusCard
            title="컨트롤 플레인"
            icon="server-cog"
            status="unknown"
            primary="—"
            primarySub="컨트롤 플레인 노드를 찾을 수 없습니다"
            href="/cluster/nodes#control-plane"
          />
        </Grid>

        {/* 긴 FQDN 이 좁은 상자에서도 밖으로 새지 않는지 (shell.md 2.1 / components.md 19.3) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-4)", alignItems: "center" }}>
          {[320, 200, 120, 80].map((w) => (
            <div
              key={w}
              data-cluster-name-box={w}
              style={{
                width: `${w}px`,
                padding: "var(--spacing-1)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
              }}
            >
              <ResourceName name="prod-ap-northeast-2.platform.k8s.example.com" kind="cluster" />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-2)", alignItems: "center" }}>
          <Chip label="컨트롤 플레인" icon="server-cog" />
          <Chip label="단일 구성 확인됨" icon="check" />
          <Chip label="필수 판정 제외" icon="minus" />
          <Chip label="워커 기준" icon="server" />
          <Chip label="API 서버 LB로 추정" icon="tilde" />
        </div>

        <ComponentMatrix
          caption="컨트롤 플레인 구성요소 상태 (마스터 3대)"
          columns={COLUMNS}
          rows={ROWS}
          cells={CELLS}
          summary={SUMMARY}
        />

        <InlineAlert
          tone="info"
          compact
          title="apiserver가 모두 중단되면 이 대시보드도 클러스터를 조회할 수 없어 '연결 끊김'으로 보입니다."
          description="etcd 내부 지표(fsync·리더 변경)는 표시하지 않습니다."
        />
      </Section>

      <Section title="구성요소 매트릭스 — 열 수·상태별" meta="1대 / 6대(가로 스크롤) / 전체 stale / 로딩 / 마스터 0대">
        <ComponentMatrix
          caption="컨트롤 플레인 구성요소 상태 (마스터 1대)"
          columns={SINGLE_COLUMN}
          rows={ROWS}
          cells={SINGLE_CELLS}
          summary={[
            { state: "ok", count: 5 },
            { state: "warn", count: 0 },
            { state: "crit", count: 0 },
            { state: "unknown", count: 0 },
          ]}
        />
        <ComponentMatrix
          caption="컨트롤 플레인 구성요소 상태 (마스터 6대)"
          columns={SIX_COLUMNS}
          rows={ROWS}
          cells={SIX_CELLS}
        />
        <ComponentMatrix
          caption="컨트롤 플레인 구성요소 상태 (데이터 오래됨)"
          columns={COLUMNS}
          rows={ROWS}
          cells={CELLS}
          staleAt={T0}
        />
        <ComponentMatrix caption="컨트롤 플레인 구성요소 상태 (불러오는 중)" columns={[]} rows={ROWS} cells={[]} state="loading" />
        <ComponentMatrix
          caption="컨트롤 플레인 구성요소 상태 (마스터 0대)"
          columns={[]}
          rows={ROWS}
          cells={[]}
          state="unknown"
          unknownReason="컨트롤 플레인 노드를 찾을 수 없습니다"
        />
      </Section>
    </>
  );
}
