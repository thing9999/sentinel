"use client";

/**
 * 퍼블리셔 컴포넌트 미리보기 (라우트 연결은 frontend 요청).
 * 모든 데이터는 이 파일 안의 고정 예시다(fetch·SSE 없음).
 */
import { useState } from "react";

import { AlertsLogsPreview } from "./AlertsLogsPreview";
import { ControlPlanePreview } from "./ControlPlanePreview";
import { K8sSnapshotPreview } from "./K8sSnapshotPreview";
import { Snapshot3DPreview } from "./Snapshot3DPreview";
import { SnapshotPreview } from "./SnapshotPreview";

import {
  AppShell,
  Banner,
  BridgeStatusBar,
  BudgetGauge,
  Button,
  CategoryChip,
  ChartFrame,
  Chip,
  CodeBlock,
  ConnectionBanner,
  ConnectionIndicator,
  CostKindBadge,
  DataTable,
  DEFAULT_NAV_FOOTER_ITEMS,
  DEFAULT_NAV_ITEMS,
  Dialog,
  DistributionBar,
  Drawer,
  EmptyState,
  ErrorState,
  ExampleBadge,
  FilterBar,
  Grid,
  GridItem,
  HelpPopover,
  InlineAlert,
  JsonTree,
  KeyValueList,
  MetricTile,
  MoneyValue,
  MultiSelect,
  NoExecuteNotice,
  PageHeader,
  RangeValue,
  ReasonText,
  ResourceName,
  RiskBadge,
  RunProgressPanel,
  RunResultAlert,
  SearchInput,
  Section,
  SegmentedControl,
  Select,
  SeverityBadge,
  SeverityMatrix,
  SideNav,
  Skeleton,
  SourceLabel,
  StaleNotice,
  StatusBadge,
  StatusCard,
  Stepper,
  SuggestionCard,
  SummaryStrip,
  SummaryStripItem,
  Switch,
  TabPanel,
  Tabs,
  ThemeMenu,
  Timestamp,
  TopBar,
  UnknownState,
  UsageBar,
  type Column,
  type SortState,
  type ThemeChoice,
} from "../index";

const T0 = "2026-09-19T05:02:10.000Z";

interface PodRow {
  id: string;
  status: "ok" | "warn" | "crit" | "unknown" | "stale";
  name: string;
  ns: string;
  reason: string[];
  restarts: number;
  cpu: string;
  mem: number;
  node: string;
}

const PODS: PodRow[] = [
  {
    id: "1",
    status: "crit",
    name: "api-server-deployment-7f9c8d6b5-x2kq9",
    ns: "prod",
    reason: ["CrashLoopBackOff · 최근 1시간 재시작 6회"],
    restarts: 6,
    cpu: "120m",
    mem: 0.97,
    node: "ip-10-0-12-34.ap-northeast-2.compute.internal",
  },
  {
    id: "2",
    status: "warn",
    name: "batch-worker-5d8f7c9b4-abcde",
    ns: "batch",
    reason: ["최근 1시간 재시작 2회"],
    restarts: 2,
    cpu: "850m",
    mem: 0.81,
    node: "ip-10-0-40-12.ap-northeast-2.compute.internal",
  },
  {
    id: "3",
    status: "ok",
    name: "web-6c7d8e9f0-zzz11",
    ns: "prod",
    reason: [],
    restarts: 0,
    cpu: "40m",
    mem: 0.32,
    node: "ip-10-0-12-34.ap-northeast-2.compute.internal",
  },
];

const POD_COLUMNS: Column<PodRow>[] = [
  { id: "status", header: "상태", width: 112, render: (r) => <StatusBadge status={r.status} size="sm" /> },
  {
    id: "name",
    header: "이름",
    minWidth: 240,
    maxWidth: 360,
    sortable: true,
    render: (r) => <ResourceName name={r.name} kind="pod" href={`/cluster/pods/${r.ns}/${r.name}`} maxWidth={360} />,
  },
  { id: "ns", header: "네임스페이스", width: 140, render: (r) => r.ns },
  { id: "reason", header: "사유", minWidth: 200, render: (r) => <ReasonText reasons={r.reason} status={r.status} /> },
  { id: "restarts", header: "재시작(1h)", width: 96, numeric: true, sortable: true, render: (r) => r.restarts },
  { id: "cpu", header: "CPU", width: 96, numeric: true, hideBelow: 1280, render: (r) => r.cpu },
  {
    id: "mem",
    header: "메모리",
    width: 160,
    render: (r) => <UsageBar value={r.mem} status={r.status === "stale" ? "stale" : r.mem > 0.95 ? "crit" : r.mem > 0.8 ? "warn" : "ok"} size="sm" warnAt={0.8} critAt={0.95} label={`${Math.round(r.mem * 100)}%`} name="메모리 사용률" />,
  },
  { id: "node", header: "노드", width: 160, render: (r) => <ResourceName name={r.node} kind="node" /> },
];

export function UiPreview() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [segment, setSegment] = useState("all");
  const [ns, setNs] = useState<string[]>([]);
  const [group, setGroup] = useState("all");
  const [hideSystem, setHideSystem] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [tab, setTab] = useState("summary");
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sugg, setSugg] = useState(true);

  return (
    <AppShell
      navOpen={navOpen}
      onNavClose={() => setNavOpen(false)}
      topBar={
        <TopBar
          cluster={{ name: "prod-eks", version: "v1.30", region: "ap-northeast-2" }}
          dataSource="mock"
          scenarios={[
            { id: "normal", label: "정상", group: "cluster", active: true },
            { id: "crash", label: "파드 장애", group: "cluster", active: false },
            { id: "budget", label: "예산 초과", group: "cost", active: false },
          ]}
          onScenarioChange={() => undefined}
          connection={<ConnectionIndicator status="reconnecting" retryCount={3} lastEventAt={T0} />}
          themeToggle={<ThemeMenu value={theme} onChange={setTheme} />}
          onMenuClick={() => setNavOpen((o) => !o)}
          menuOpen={navOpen}
        />
      }
      banner={
        <ConnectionBanner lastEventAt={T0} retryCount={3} nextRetryInMs={8000} onRetryNow={() => undefined} />
      }
      nav={
        <SideNav
          footerItems={DEFAULT_NAV_FOOTER_ITEMS}
          items={DEFAULT_NAV_ITEMS.map((it) =>
            it.href === "/alerts"
              ? // 상태 점 없이 count 만 (components.md 21.1)
                { ...it, count: 3, countTone: "crit" as const, countLabel: "안 읽음 3건" }
              : it.href === "/cluster/pods"
                ? { ...it, status: "crit" as const }
                : it.href === "/cluster/db"
                  ? { ...it, status: "warn" as const }
                  : it.href === "/advisor"
                    ? { ...it, busy: true }
                    : it.href === "/snapshots"
                      ? { ...it, status: "crit" as const, statusLabel: "커밋 금지", count: 2 }
                      : it,
          )}
          currentPath="/cluster/pods"
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
      }
    >
      <PageHeader
        title="UI 미리보기"
        breadcrumbs={[{ label: "개요", href: "/" }, { label: "미리보기" }]}
        status={{ status: "crit", reason: ["파드 api-7f9c… CrashLoopBackOff", "노드 ip-10-0-12-34 NotReady"] }}
        subtitle="퍼블리셔 컴포넌트 전체 모습 (고정 예시 데이터)"
        actions={<HelpPopover label="계산 방법" title="계산 방법" content={<p>모든 값은 서버가 계산합니다.</p>} />}
        chips={<Chip label="시스템" icon="settings" />}
      />

      <div className="page-stack">
        <Section title="상태 표시">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-2)", alignItems: "center" }}>
            {(["ok", "warn", "crit", "unknown"] as const).map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
            <StatusBadge status="stale" staleAt={T0} previousStatus="crit" previousReason="최근 1시간 재시작 6회" />
            <StatusBadge status="crit" variant="solid" size="lg" />
            <StatusBadge status="warn" variant="dot" />
            <StatusBadge status="crit" label="초과" />
            <StatusBadge status="unknown" label="진행 중" busy size="sm" />
            <Chip label="스케줄 제외" icon="ban" />
            <Chip label="오래됨 2" tone="stale" icon="clock-alert" />
            <StaleNotice staleAt={T0} />
          </div>
          <SummaryStrip
            overall={{ status: "crit", reason: ["파드 api-7f9c… CrashLoopBackOff", "노드 NotReady", "DB 연결 82%"] }}
            meta="prod-eks · v1.30 · ap-northeast-2"
            updatedAt={T0}
          >
            <SummaryStripItem label="노드 Ready" value="5/6" status="crit" href="/cluster/nodes" />
            <SummaryStripItem label="파드" value="2 · 3 · 51" href="/cluster/pods" />
            <SummaryStripItem label="워크로드" value="1 · 0 · 23" href="/cluster/workloads" />
            <SummaryStripItem label="Warning 15분" value="7" href="/cluster/events" />
            <SummaryStripItem label="DB" value={<StatusBadge status="warn" />} href="/cluster/db" />
          </SummaryStrip>
          <Grid columns={5} columnsMd={3} columnsSm={2}>
            <StatusCard
              title="노드"
              icon="server"
              status="crit"
              primary="Ready 5/6"
              items={[{ label: "ip-10-0-12-34", href: "/cluster/nodes/ip-10-0-12-34", status: "crit", detail: "NotReady 3분", mono: true }]}
              href="/cluster/nodes"
            />
            <StatusCard
              title="워크로드"
              icon="boxes"
              status="warn"
              primary="24개"
              counts={[
                { status: "crit", count: 0 },
                { status: "warn", count: 1 },
                { status: "ok", count: 23 },
              ]}
              reason={["api ready 0/3"]}
              href="/cluster/workloads"
            />
            <StatusCard title="파드" icon="box" status="ok" primary="56개" href="/cluster/pods" />
            <StatusCard title="이벤트" icon="bell-ring" status="ok" primary="Warning 7건 (15분)" staleAt={T0} href="/cluster/events" />
            <StatusCard title="DB" icon="database" status="warn" primary="연결 82%" state="loading" />
          </Grid>
          <UsageBar value={1.18} status="warn" warnAt={0.7} critAt={0.9} secondary={0.6} label="2,360m / 2,000m (118%)" name="CPU limits" />
          <UsageBar value={0.37} status="ok" approximate label="18.4 GiB / 50 GiB (37%)" name="PVC 사용률" />
        </Section>

        <Section title="금액" kind="estimate" badges={<CostKindBadge kind="estimate" />} actions="13:05 조회 · 5분마다 갱신">
          <Grid columns={4} columnsMd={2}>
            <MetricTile
              label="추정 시간당 소모율"
              kind="estimate"
              badge={<CostKindBadge kind="estimate" />}
              value={<MoneyValue amount={1.1} kind="estimate" unit="hour" size="xl" asOf={T0} />}
              lines={["≈ $26.40/일 · ≈ $803/월", "13:05 조회"]}
              footer={<Chip label="단가 없음 2개 제외" tone="warn" icon="triangle-alert" />}
            />
            <MetricTile
              label="이번 달 확정 누적"
              kind="confirmed"
              badge={<CostKindBadge kind="confirmed" />}
              value={<MoneyValue amount={512} kind="confirmed" unit="total" size="xl" />}
              lines={[<MoneyValue key="s" amount={512} kind="confirmed" unit="total" size="sm" settledThrough="2026-09-17" />]}
            />
            <MetricTile
              label="월말 예측"
              kind="forecast"
              badge={<CostKindBadge kind="forecast" />}
              value={<MoneyValue amount={845} kind="forecast" unit="total" size="xl" />}
              lines={[<RangeValue key="r" low={790} high={900} confidence={0.8} />]}
            />
            <MetricTile label="Cost Explorer" state="unknown" unknownReason="Cost Explorer 사용 불가: AccessDenied" value={null} />
          </Grid>
          <BudgetGauge
            budget={800}
            confirmed={512}
            projected={845}
            projectedKind="forecast"
            projectedRange={{ low: 790, high: 900 }}
            elapsedRatio={0.63}
            elapsedLabel="19/30일"
          />
          <p>
            <MoneyValue amount={0.004} kind="estimate" unit="hour" /> · <MoneyValue amount={-12} kind="confirmed" unit="month" delta /> ·{" "}
            <MoneyValue amount={null} kind="confirmed" unit="total" unknownReason="Cost Explorer 사용 불가" />
          </p>
        </Section>

        <Section title="입력과 표">
          <FilterBar resultText="파드 412개 중 3개 표시" onReset={() => setSegment("all")}>
            <SegmentedControl
              label="상태"
              value={segment}
              onChange={setSegment}
              options={[
                { value: "all", label: "전체", count: 412 },
                { value: "crit", label: "장애", count: 2, status: "crit" },
                { value: "warn", label: "주의", count: 3, status: "warn" },
              ]}
            />
            <MultiSelect label="네임스페이스" value={ns} onChange={setNs} options={[{ value: "prod", label: "prod", count: 30 }, { value: "batch", label: "batch", count: 12 }]} />
            <Select label="노드그룹" value={group} onChange={setGroup} options={[{ value: "all", label: "전체" }, { value: "batch", label: "batch", count: 3 }]} />
            <Switch label="시스템 숨기기" checked={hideSystem} onChange={setHideSystem} />
            <SearchInput value={query} onChange={setQuery} placeholder="이름·노드·워크로드 검색" />
          </FilterBar>
          <DataTable
            caption="파드 목록"
            columns={POD_COLUMNS}
            rows={PODS}
            rowKey={(r) => r.id}
            rowStatus={(r) => r.status}
            sort={sort}
            onSortChange={setSort}
            selectedKey="2"
            expandable={{
              render: (r) => <KeyValueList columns={2} items={[{ label: "네임스페이스", value: r.ns }, { label: "노드", value: r.node }]} />,
              expandedKeys: expanded,
              onToggle: (k) => setExpanded((e) => (e.includes(k) ? e.filter((x) => x !== k) : [...e, k])),
            }}
            countText="파드 412개 중 3개 표시"
            pendingReorder={3}
            onApplyReorder={() => undefined}
            totalRow={{ name: "합계", restarts: 8 }}
          />
          <DataTable caption="빈 표" columns={POD_COLUMNS} rows={[]} rowKey={(r) => r.id} state="filteredEmpty" onResetFilters={() => undefined} />
          <DistributionBar label="파드 상태 분포" segments={[{ value: 2, status: "crit", label: "장애" }, { value: 3, status: "warn", label: "주의" }, { value: 51, status: "ok", label: "정상" }]} />
          <Tabs idBase="pv" label="보기" value={tab} onChange={setTab} items={[{ id: "summary", label: "요약" }, { id: "json", label: "JSON", count: 12 }]} />
          <TabPanel idBase="pv" id="summary" value={tab}>
            <Timestamp value={T0} relative />
          </TabPanel>
          <TabPanel idBase="pv" id="json" value={tab}>
            <JsonTree data={{ cluster: { name: "prod-eks", nodes: 6 }, secret: "[가림]", flags: [true, null, 3] }} />
          </TabPanel>
        </Section>

        <Section title="알림·빈 상태">
          <Banner tone="warn" title="예산: 월말 예측 $845 (예산 $800의 106%)" description="(추정 기준)" actions={<Button size="sm">원인 보기</Button>} />
          <InlineAlert tone="info" compact title="쿠버네티스는 이벤트를 1시간만 보관합니다." />
          <Grid columns={3}>
            <EmptyState icon="circle-check" iconTone="ok" title="주의·장애 항목이 없습니다" />
            <UnknownState reason="metrics-server 없음" hint="EKS 애드온 metrics-server를 설치하면 표시됩니다" />
            <ErrorState title="API 서버에 연결할 수 없습니다" onRetry={() => undefined} retryLabel="지금 다시 시도" />
          </Grid>
          <Skeleton lines={3} />
          <Grid>
            <GridItem span={6} spanMd={12}>
              <ChartFrame
                title="클러스터 CPU"
                badges={<StatusBadge status="ok" />}
                legend={[
                  { label: "CPU", color: "var(--color-chart-cpu)" },
                  { label: "추정", color: "var(--color-cost-estimate-solid)", dashed: true },
                ]}
                state="stale"
                staleAt={T0}
                observedMinutes={23}
                tableView={{ pressed: false, onToggle: () => undefined }}
              >
                <div role="img" aria-label="차트 자리" style={{ height: "100%", background: "var(--color-bg-surface-sunken)" }} />
              </ChartFrame>
            </GridItem>
            <GridItem span={6} spanMd={12}>
              <ChartFrame title="클러스터 메모리" state="unknown" unknownReason="metrics-server 없음" />
            </GridItem>
          </Grid>
          <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap" }}>
            <Button variant="primary" icon="play" size="lg">
              분석 실행
            </Button>
            <Button variant="secondary" icon="eye" onClick={() => setDrawer(true)}>
              보낼 데이터 보기
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDialog(true)}>
              분석 취소
            </Button>
            <Button disabled disabledReason="Claude Code 로그인 필요">
              비활성
            </Button>
            <Button loading>조회 중</Button>
          </div>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="보낼 데이터 미리보기" subtitle="13:40 생성 · 48.2 KB" size="lg" footer={<Button onClick={() => setDrawer(false)}>닫기</Button>}>
            <JsonTree data={{ a: 1 }} />
          </Drawer>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="분석을 취소할까요?"
            description='진행 중인 결과는 저장되지 않고 이력에 "취소됨"으로 남습니다.'
            confirmLabel="분석 취소"
            cancelLabel="계속 기다리기"
            tone="danger"
            onConfirm={() => setDialog(false)}
          />
        </Section>

        <Section title="어드바이저" badges={<SourceLabel source="rule" detail="LLM 미사용" />}>
          <BridgeStatusBar
            bridge="unreachable"
            command="npm run dev --prefix apps/agent-bridge"
            checkedAt={T0}
            onRecheck={() => undefined}
            previewButton={<Button icon="eye">보낼 데이터 보기</Button>}
            runButton={<Button variant="primary" size="lg" icon="play">예시 분석 실행</Button>}
          />
          <RunProgressPanel
            run={{
              id: "r1",
              startedAt: T0,
              stage: "receive",
              delayed: true,
              example: true,
              lastReceivedAt: T0,
              receivedChars: 3214,
              stages: [
                { id: "snapshot", label: "스냅샷 수집", state: "done", detail: "0:03" },
                { id: "precheck", label: "사전 점검", state: "done", detail: "0:01" },
                { id: "request", label: "분석 요청", state: "done", detail: "0:02" },
                { id: "receive", label: "응답 수신 중", state: "active" },
                { id: "finalize", label: "결과 정리", state: "pending" },
              ],
            }}
            onCancel={() => setDialog(true)}
          />
          <RunResultAlert
            reason="invalid_response"
            rawResponse={["<script>alert(1)</script>", "**bold** https://example.com"].join("\n")}
            onRetry={() => undefined}
            onDismiss={() => undefined}
          />
          <RunResultAlert
            reason="budget_exceeded"
            message="분석 비용이 상한 $2.00을 넘어 중단했습니다."
            onOpenPreview={() => setDrawer(true)}
            onRetry={() => undefined}
            retryDisabled
            retryDisabledReason="브리지 미실행"
          />
          <Stepper steps={[{ id: "a", label: "완료", state: "done" }, { id: "b", label: "오류", state: "error" }, { id: "c", label: "건너뜀", state: "skipped" }]} />
          <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
            <SeverityBadge severity="high" />
            <SeverityBadge severity="medium" size="md" />
            <RiskBadge level="medium" />
            <CategoryChip category="cost" />
            <CategoryChip category="db" onClick={() => undefined} pressed count={3} />
            <SourceLabel source="rule" ruleId="R-GP2" />
            <SourceLabel source="llm" />
            <ExampleBadge />
          </div>
          <NoExecuteNotice />
          <SeverityMatrix
            cells={{
              cost: { high: 1, medium: 3, low: 0 },
              reliability: { high: 1, medium: 2, low: 4 },
              performance: { high: 0, medium: 1, low: 2 },
              security: { high: 0, medium: 1, low: 3 },
              db: { high: 0, medium: 0, low: 2 },
            }}
            selected={{ category: "cost", severity: "medium" }}
            onCellClick={() => undefined}
            footnote="판단 보류 2건 (관측 23분)"
          />
          <SuggestionCard
            priority={1}
            title="batch 노드그룹을 Graviton(m7g.large)으로 전환"
            category="cost"
            severity="high"
            targets={[
              { name: "batch", kind: "노드그룹", href: "/cluster/nodes?group=batch" },
              { name: "ghost-worker", kind: "Deployment", missing: true },
            ]}
            evidence={[{ text: "batch 노드 평균 CPU 18%", field: "nodes[batch].cpu.avg", value: "18%" }]}
            linkedRules={["R-GRAVITON", "R-NODEIDLE"]}
            savings={{ monthly: 84.1, formula: "($0.0960 − $0.0768)/h × 730h × 6대 = $84.10/월", source: "server" }}
            steps={[{ text: "노드그룹 인스턴스 타입을 바꿉니다.", code: { language: "bash", code: "eksctl create nodegroup --instance-types m7g.large" } }]}
            risk={{ level: "medium", reason: "arm64 이미지가 없는 워크로드는 실행되지 않음" }}
            verify="kubectl get nodes -L kubernetes.io/arch"
            unverified
            expanded={sugg}
            onToggle={() => setSugg((s) => !s)}
            onRuleClick={() => undefined}
          />
          <CodeBlock language="yaml" code={"apiVersion: v1\nkind: Pod\nmetadata:\n  name: <b>not-html</b>"} />
        </Section>
        <SnapshotPreview />
        <K8sSnapshotPreview />
        <Snapshot3DPreview />
        <ControlPlanePreview />
        <AlertsLogsPreview />
      </div>
    </AppShell>
  );
}
