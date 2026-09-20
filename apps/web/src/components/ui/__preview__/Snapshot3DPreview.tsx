"use client";

/**
 * snapshot-3d 1단계 표현 컴포넌트 미리보기 (/dev/ui). 고정 예시 데이터만 쓴다(fetch 없음).
 * 3D 캔버스 자체는 프론트 영역이라 여기서는 자리(canvasSlot)만 회색 판으로 흉내 낸다.
 */
import { useState } from "react";

import {
  BlockDetailPanel,
  Button,
  CameraControls,
  CertaintyChip,
  DEFAULT_LEGEND_SHAPES,
  HelpPopover,
  InlineAlert,
  kindShape,
  MultiSelect,
  PlateLabel,
  Popover,
  RelationTable,
  Scene3DFrame,
  SceneInfoBar,
  SceneLegend,
  SceneSearchNav,
  SceneToolbar,
  SceneToolbarItem,
  SearchInput,
  Section,
  SegmentedControl,
  Select,
  ShapeSwatch,
  Switch,
  type CameraView,
  type RelationItemProps,
  type RelationTableRow,
  type SceneState,
  type VizLayer,
  type VizShape,
} from "../index";

const INCOMING: RelationItemProps[] = [
  {
    direction: "in",
    peer: { id: "core/Service/prod/api", layer: "service", kind: "Service", name: "api" },
    evidence: "셀렉터",
    ruleLabel: "Service → 워크로드(K2)",
    certainty: "estimated",
  },
  {
    direction: "in",
    peer: { id: "autoscaling/HPA/prod/api", layer: "aux", kind: "HorizontalPodAutoscaler", name: "api" },
    evidence: "scaleTargetRef",
    ruleLabel: "HPA → 워크로드(K7)",
    certainty: "confirmed",
  },
];

const OUTGOING: RelationItemProps[] = [
  {
    direction: "out",
    peer: { id: "core/ConfigMap/prod/api-config", layer: "storage", kind: "ConfigMap", name: "api-config" },
    evidence: "envFrom",
    ruleLabel: "워크로드 → ConfigMap(K5)",
    certainty: "confirmed",
  },
  {
    direction: "out",
    peer: {
      id: "core/Secret/prod/postgres-credentials",
      layer: "storage",
      kind: "Secret",
      name: "postgres-credentials",
      ghost: true,
      ghostText: "Secret — 이름만, 값 없음",
    },
    evidence: "secretKeyRef",
    ruleLabel: "워크로드 → Secret(K6)",
    certainty: "confirmed",
    optional: true,
  },
];

const PLATE_MARKERS = {
  scan: { level: "warn" as const, count: 2 },
  drift: { kind: "changed" as const, fieldCount: 1 },
  notes: [{ code: "namespace_file_missing", text: "namespace.yaml 이 스냅샷에 없습니다" }],
};

const ROWS: RelationTableRow[] = [
  {
    id: "ns/prod",
    type: "group",
    groupKind: "plate",
    depth: 0,
    label: "prod",
    count: 42,
    location: "prod/namespace.yaml",
    markers: PLATE_MARKERS,
    actions: { file: { href: "#files" }, drift: { href: "#drift" } },
  },
  { id: "ns/prod/workload", type: "group", groupKind: "layer", depth: 1, label: "워크로드", count: 12, layer: "workload" },
  {
    id: "apps/Deployment/prod/api",
    type: "resource",
    depth: 2,
    layer: "workload",
    kind: "Deployment",
    name: "api",
    location: "prod",
    markers: { drift: { kind: "changed", fieldCount: 2 }, scan: { level: "warn", count: 1 } },
    incoming: 2,
    outgoing: 3,
    actions: {
      file: { href: "#files" },
      drift: { href: "#drift" },
    },
    relations: { incoming: INCOMING, outgoing: OUTGOING },
  },
  {
    id: "core/Secret/prod/postgres-credentials",
    type: "resource",
    depth: 2,
    layer: "storage",
    kind: "Secret",
    name: "postgres-credentials",
    location: "prod",
    ghost: true,
    markers: { ghost: { reason: "secret" } },
    incoming: 1,
    outgoing: 0,
    actions: { secrets: { href: "#secrets" } },
  },
];

/** 필터 중: 판·층 행이 `보이는 수 / 전체` 두 값을 보인다 (8.3) */
const FILTERED_ROWS: RelationTableRow[] = ROWS.map((row) =>
  row.type === "group" ? { ...row, count: row.groupKind === "layer" ? 3 : 12, totalCount: row.count } : row,
);

/** 모양 견본을 층 색으로 볼 때 쓰는 대표 층 (미리보기 전용 — 실제 층은 서버가 준다) */
const SHAPE_DEMO_LAYER: Record<VizShape, VizLayer> = {
  stack: "workload",
  cylinder: "workload",
  panel: "workload",
  roof: "workload",
  chamfer: "storage",
  diamond: "service",
  gate: "ingress",
  box: "workload",
  tile: "aux",
};

/** 종류 필터 옵션 예시 (6.1). 층은 **서버가 준 값**이고 화면이 종류 → 층 표를 따로 갖지 않는다 */
const KIND_FILTER: { kind: string; layer: VizLayer; count: number }[] = [
  { kind: "Deployment", layer: "workload", count: 12 },
  { kind: "StatefulSet", layer: "workload", count: 3 },
  { kind: "DaemonSet", layer: "workload", count: 2 },
  { kind: "CronJob", layer: "workload", count: 4 },
  { kind: "Job", layer: "workload", count: 1 },
  { kind: "Pod", layer: "workload", count: 6 },
  { kind: "Service", layer: "service", count: 9 },
  { kind: "Ingress", layer: "ingress", count: 2 },
  { kind: "PersistentVolumeClaim", layer: "storage", count: 5 },
  { kind: "ConfigMap", layer: "storage", count: 14 },
  { kind: "Secret", layer: "storage", count: 7 },
  { kind: "HorizontalPodAutoscaler", layer: "aux", count: 3 },
];

const STATES: SceneState[] = [
  "ready",
  "loadingData",
  "loadingChunk",
  "building",
  "empty",
  "filteredEmpty",
  "unsupported",
  "chunkFailed",
  "contextLost",
  "error",
  "unknown",
  "stale",
];

export function Snapshot3DPreview() {
  const [state, setState] = useState<SceneState>("ready");
  const [view, setView] = useState<"3d" | "table">("3d");
  const [camera, setCamera] = useState<CameraView>("iso");
  const [legendOpen, setLegendOpen] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [focus, setFocus] = useState(false);
  const [labels, setLabels] = useState("all");
  const [query, setQuery] = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>("apps/Deployment/prod/api");
  const [expanded, setExpanded] = useState<string[]>(["ns/prod", "ns/prod/workload"]);
  const [alertOpen, setAlertOpen] = useState(true);

  const toolbarA = (
    <SceneToolbar
      row="a"
      countText="블록 128 · 관계 164"
      trailing={
        <Button variant="ghost" size="sm">
          필터 초기화
        </Button>
      }
    >
      <SegmentedControl
        label="보기"
        size="sm"
        value={view}
        onChange={setView}
        options={[
          { value: "3d", label: "3D", icon: "box" },
          { value: "table", label: "표", icon: "table-2" },
        ]}
      />
      <MultiSelect
        label="네임스페이스"
        width={160}
        value={namespaces}
        onChange={setNamespaces}
        options={[
          { value: "prod", label: "prod", count: 42 },
          { value: "data", label: "data", count: 18 },
          { value: "monitoring", label: "monitoring", count: 9 },
        ]}
      />
      {/* 6.1 (2026-09-20 (8)): 종류 필터 옵션만 모양 견본을 쓴다 — 층 색으로 채운 실루엣 14px */}
      <MultiSelect
        label="종류"
        width={140}
        value={kinds}
        onChange={setKinds}
        options={KIND_FILTER.map((k) => ({
          value: k.kind,
          label: k.kind,
          count: k.count,
          adornment: <ShapeSwatch shape={kindShape(k.kind, { layer: k.layer })} size={14} tone="layer" layer={k.layer} />,
        }))}
      />
      <SceneToolbarItem collapseBelow={1280}>
        <MultiSelect
          label="관계"
          width={140}
          value={["K1", "K2"]}
          onChange={() => {}}
          options={[
            { value: "K1", label: "Ingress → Service" },
            { value: "K2", label: "Service → 워크로드" },
          ]}
        />
      </SceneToolbarItem>
      <SearchInput
        value={query}
        onChange={setQuery}
        width={200}
        placeholder="리소스 이름 검색"
        label="리소스 이름 검색"
        shortcut={false}
      />
      <SceneSearchNav index={3} total={12} onPrev={() => {}} onNext={() => {}} />
    </SceneToolbar>
  );

  const toolbarB = (
    <SceneToolbar
      row="b"
      trailing={
        <>
          <HelpPopover
            label="3D 조작"
            title="3D 조작"
            content={
              <ul style={{ margin: 0, paddingLeft: "var(--spacing-4)" }}>
                <li>방향키: 회전 · Shift+방향키: 이동</li>
                <li>+ / −: 확대·축소 · 0: 초기화</li>
                <li>[ / ]: 이전·다음 블록 · Enter: 이동 · T: 표로 보기</li>
              </ul>
            }
          />
          {/* 6.5: 범례는 캔버스 밖 Popover 280px(오른쪽 정렬·내부 스크롤) */}
          <Popover
            label="범례"
            width={280}
            align="end"
            maxHeight={520}
            open={legendOpen}
            onOpenChange={setLegendOpen}
            trigger={(p) => (
              <Button variant="ghost" size="sm" icon="layers" {...p}>
                범례
              </Button>
            )}
          >
            <SceneLegend onClose={() => setLegendOpen(false)} />
          </Popover>
        </>
      }
    >
      <Switch checked={overlay} onChange={setOverlay} label="드리프트 겹쳐 보기" />
      <Select
        label="라벨"
        width={152}
        value={labels}
        onChange={setLabels}
        options={[
          { value: "all", label: "전체" },
          { value: "selected", label: "선택·검색만" },
          { value: "off", label: "끄기" },
        ]}
      />
      <Switch
        checked={focus}
        onChange={setFocus}
        label="주변만 보기"
        disabled={!selected}
        disabledReason={!selected ? "블록을 먼저 고르세요" : undefined}
      />
    </SceneToolbar>
  );

  return (
    <Section title="3D 구성도 (snapshot-3d 1단계)" meta="components.md 16·17절 / snapshot-3d.md">
      <SceneToolbar row="b" label="미리보기 상태">
        <Select
          label="상태"
          width={200}
          value={state}
          onChange={(v) => setState(v as SceneState)}
          options={STATES.map((s) => ({ value: s, label: s }))}
        />
        <CertaintyChip certainty="confirmed" />
        <CertaintyChip certainty="estimated" optional />
      </SceneToolbar>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
          gap: "var(--size-grid-gutter)",
          alignItems: "start",
        }}
      >
        <Scene3DFrame
          state={state}
          view={view}
          height={560}
          toolbarA={toolbarA}
          toolbarB={toolbarB}
          skipLinkHref="#table"
          buildingCount={1240}
          canvasSlot={
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--spacing-6)",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "var(--spacing-6)",
                color: "var(--color-text-tertiary)",
                font: "var(--font-caption)",
              }}
            >
              <span style={{ width: "100%", textAlign: "center" }}>(three.js 캔버스 자리 — 프론트 영역)</span>
              {([0, 1, 2, 3] as const).map((d) => (
                <PlateLabel
                  key={d}
                  name={`prod-namespace-${d}`}
                  system={d === 0}
                  resourceCount={11}
                  ghostCount={5}
                  density={d}
                  markers={PLATE_MARKERS}
                  onNameClick={() => {}}
                />
              ))}
            </div>
          }
          tableSlot={
            <RelationTable
              rows={ROWS}
              expandedIds={expanded}
              onExpandedChange={setExpanded}
              selectedId={selected}
              onSelectRow={(r) => setSelected(r.id)}
              summary="블록 128개(유령 6) · 관계 164개 · 드리프트 표식 3 · 스캔 표식 2"
            />
          }
          infoBar={
            <SceneInfoBar
              items={[
                { id: "counts", text: "블록 128 · 관계 164" },
                { id: "drift", icon: "square-dot", text: "차이 3건 · 15:12 계산" },
                { id: "outside", icon: "octagon-x", tone: "crit", text: "리소스 밖 발견 1건" },
              ]}
            />
          }
          cameraControls={
            <CameraControls
              view={camera}
              onView={setCamera}
              onReset={() => setCamera("iso")}
              onZoomIn={() => {}}
              onZoomOut={() => {}}
            />
          }
          onRetry={() => setState("ready")}
          onReenable={() => setState("ready")}
          onShowTable={() => setView("table")}
          onResetFilters={() => setNamespaces([])}
          unknownTitle="스냅샷 파일 확인 전"
          unknownReason="내보내기가 진행 중일 수 있습니다."
          unknownIcon="hourglass"
          liveMessage="Deployment api, prod 네임스페이스, 변경됨 · 필드 2건, 들어오는 관계 2개, 나가는 관계 3개"
        />

        <BlockDetailPanel
          height={560}
          block={
            selected
              ? {
                  id: "apps/Deployment/prod/api",
                  layer: "workload",
                  kind: "Deployment",
                  apiVersion: "apps/v1",
                  name: "api",
                  namespace: "prod",
                  file: "prod/deployments/api.yaml",
                  documentIndex: 1,
                  documentCount: 2,
                }
              : null
          }
          markers={{ drift: { kind: "changed", fieldCount: 2 }, scan: { level: "warn", count: 1 }, helm: true }}
          notes={[{ code: "no_target", text: "셀렉터에 맞는 워크로드가 없습니다." }]}
          incoming={INCOMING}
          outgoing={OUTGOING}
          actions={{ file: { href: "#files" }, drift: { href: "#drift" } }}
          onClear={() => setSelected(null)}
          onSelectRelated={() => setSelected("apps/Deployment/prod/api")}
        />
      </div>

      {/* 모양 9종 실루엣 (4.11.1 · 16.13). 왼쪽 = 범례용 중립 16px, 오른쪽 = 종류 필터용 층 색 14px.
          같은 층 안에서 갈리는지(워크로드 stack ↔ chamfer 가 가장 가까운 쌍) 여기서 눈으로 확인한다 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--spacing-3) var(--spacing-5)",
          padding: "var(--spacing-3)",
          border: "var(--border-width-thin) solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-surface)",
        }}
      >
        {DEFAULT_LEGEND_SHAPES.map((s) => (
          <span
            key={s.shape}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--spacing-1)",
              font: "var(--font-micro)",
              color: "var(--color-text-secondary)",
            }}
          >
            <ShapeSwatch shape={s.shape} size={16} />
            <ShapeSwatch shape={s.shape} size={14} tone="layer" layer={SHAPE_DEMO_LAYER[s.shape]} />
            <span>
              {s.shape} · {s.label}
            </span>
          </span>
        ))}
      </div>

      {/* 필터 중 모습: 그룹 행 개수가 `보이는 수 / 전체`, 캔버스 알림은 닫기 있음 */}
      {alertOpen ? (
        <InlineAlert
          tone="warn"
          title="구성이 너무 커서 일부만 그립니다"
          description="표시하지 못한 블록 1,204개 · 관계 2,300개. 표 보기도 같은 범위입니다."
          closable
          onClose={() => setAlertOpen(false)}
        />
      ) : null}

      <RelationTable
        rows={FILTERED_ROWS}
        expandedIds={expanded}
        onExpandedChange={setExpanded}
        selectedId={selected}
        onSelectRow={(r) => setSelected(r.id)}
        summary="블록 128개 중 12개 · 관계 24개 · 드리프트 표식 3 · 스캔 표식 2"
      />
    </Section>
  );
}
