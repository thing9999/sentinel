"use client";

/**
 * Kubernetes 스냅샷 상세 · **3D 보기 탭** (`?view=3d`, docs/design/snapshot-3d.md).
 *
 * - 데이터는 `GET …/graph` **한 번**이다. 필터·검색·선택은 다시 조회하지 않고 응답 안에서 처리한다(AC-3D10·13).
 * - three.js 는 이 파일이 아니라 `./scene/SceneCanvas` 에 있고 **3D 를 실제로 볼 때만** import() 한다(AC-3D01).
 * - 관계 표는 three.js 없이 같은 응답으로 그려진다(AC-3D03·04).
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";

import {
  blockMarkerItems,
  blockSelectionAnnouncement,
  BlockDetailPanel,
  BlockMarkers,
  Button,
  CameraControls,
  DataSourceBadge,
  formatTime,
  Grid,
  GridItem,
  HelpPopover,
  InlineAlert,
  KindIcon,
  kindShape,
  LEGEND_NOTES,
  MultiSelect,
  NO_EDGE_HINT,
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
  SegmentedControl,
  Select,
  ShapeSwatch,
  Switch,
  type CameraView,
  type SceneInfoItem,
  type SceneState,
  type SelectOption,
} from "@/components/ui";

import { useMediaQuery } from "../../common/hooks";
import type { DetailQuery } from "../hooks";
import { DRIFT_BUTTON_REASON } from "../model";
import {
  activeRules,
  ALL_RULES,
  blockSubLine,
  buildRowSpecs,
  computeLayout,
  countText,
  countTooltip,
  defaultExpanded,
  defaultLabelDensity,
  filterGraph,
  isFiltered,
  markerSource,
  noticeAt,
  plateAnnouncement,
  primaryPatch,
  searchMatches,
  tableSummaryText,
  type GraphView,
  type LabelDensity,
  type MarkFilter,
} from "./model";
import { legendSeenStore, useStringStore, useWebglSupported, view3dStore } from "./store";
import type { LabelStep } from "./scene/engine";
import type { SceneCanvasHandle, SceneCanvasProps, SceneCommand } from "./scene/SceneCanvas";
import styles from "./graph.module.css";
import type { GraphBlock, RuleId } from "./types";
import { useGraphData } from "./useGraph";
import { blockActions, detailBlock, makeHref, panelNotes, plateHrefs, relationItems, tableRows } from "./view";
import type { K8sSnapshotsView } from "../hooks";


const KEY_HELP: [string, string][] = [
  ["방향키", "카메라 회전"],
  ["Shift + 방향키", "카메라 이동(팬)"],
  ["+ / -", "확대 / 축소"],
  ["0", "카메라 초기화"],
  ["1 / 2 / 3", "위에서 / 비스듬히 / 앞에서"],
  ["] / [", "다음 / 이전 블록 선택"],
  ["Home / End", "첫 / 마지막 블록"],
  ["PageDown / PageUp", "다음 / 이전 네임스페이스 판"],
  ["Enter", "선택한 블록으로 이동"],
  ["Esc", "선택 해제"],
  ["F", "주변만 보기"],
  ["T", "표로 보기"],
  ["?", "이 도움말"],
];

/** 6.4: 동작이 있는 칩(`href` 또는 `onClick`). 둘을 함께 주지 않는다 */
type InfoChip = SceneInfoItem & { onClick?: () => void; actionLabel?: string };

/** 정보 줄은 **한 줄**이다(6.4, 2026-09-20). 6개를 넘으면 6번부터를 `+N` 하나로 합치고 툴팁에 전부 적는다 */
const CORE_CHIPS = 5;
function oneLineChips(items: InfoChip[]): InfoChip[] {
  if (items.length <= CORE_CHIPS + 1) return items;
  const rest = items.slice(CORE_CHIPS);
  return [
    ...items.slice(0, CORE_CHIPS),
    {
      id: "more",
      icon: "info",
      text: `+${rest.length}`,
      tooltip: rest.map((r) => r.text).join(" · "),
    },
  ];
}

const LABEL_OPTIONS: SelectOption[] = [
  { value: "all", label: "전체" },
  { value: "selected", label: "선택·검색만" },
  { value: "off", label: "끄기" },
];

export interface GraphTabProps {
  id: string;
  query: DetailQuery;
  patch: (p: Partial<DetailQuery>) => void;
  stream: K8sSnapshotsView;
  dataSource: "mock" | "live" | null;
  /** 탭이 열려 있는가 (닫히면 임대 갱신을 멈춘다) */
  active: boolean;
}

export function GraphTab({ id, query, patch, stream, dataSource, active }: Readonly<GraphTabProps>) {
  const g = useGraphData(id, active, stream);
  const pathname = usePathname();
  const params = useSearchParams();
  const href = useMemo(() => makeHref(pathname, params), [pathname, params]);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendSeen, setLegendSeen] = useStringStore(legendSeenStore);

  const [storedView, setStoredView] = useStringStore(view3dStore);
  const webgl = useWebglSupported();

  const [Canvas, setCanvas] = useState<ComponentType<SceneCanvasProps & { ref?: React.Ref<SceneCanvasHandle> }> | null>(null);
  const [chunkFailed, setChunkFailed] = useState(false);
  const [chunkNonce, setChunkNonce] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [lowPerf, setLowPerf] = useState(false);
  const [lowPerfDismissed, setLowPerfDismissed] = useState(false);
  const [truncDismissed, setTruncDismissed] = useState(false);
  const [labelOverflow, setLabelOverflow] = useState({ names: 0, markers: 0 });
  const [offscreen, setOffscreen] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("iso");
  const [search, setSearch] = useState<{ q: string; i: number }>({
    q: "",
    i: 0,
  });
  const [openRows, setOpenRows] = useState<string[]>([]);
  const [sort, setSort] = useState<"default" | "markers">("default");
  const [hovered, setHovered] = useState<string | null>(null);
  const [plateHint, setPlateHint] = useState<{
    plateId: string;
    text: string;
  } | null>(null);
  const sceneRef = useRef<SceneCanvasHandle | null>(null);
  // 정보 줄 칩(JSX 밖에서 만드는 객체)에서 쓰려면 ref 가 아니라 상태여야 한다(렌더 중 ref 접근 금지)
  const [scene, setScene] = useState<SceneCanvasHandle | null>(null);
  const attachScene = useCallback((handle: SceneCanvasHandle | null) => {
    sceneRef.current = handle;
    setScene(handle);
  }, []);

  const graph = g.data?.graph ?? null;
  const userView: GraphView = query.gview ?? storedView;
  const forcedTable = !webgl || chunkFailed || contextLost;
  const showTable = forcedTable || userView === "table";
  const want3d = !showTable && graph?.state === "ok";
  const chunkReady = Canvas !== null;

  // three.js 청크는 3D 를 실제로 그릴 때만 받는다 (AC-3D01·02)
  useEffect(() => {
    if (!want3d || Canvas) return;
    let alive = true;
    import("./scene/SceneCanvas")
      .then((m) => {
        if (alive) setCanvas(() => m.default);
      })
      .catch(() => {
        if (alive) setChunkFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [want3d, Canvas, chunkNonce]);

  const layout = useMemo(() => (graph ? computeLayout(graph) : null), [graph]);
  const blocksById = useMemo(() => new Map((graph?.blocks ?? []).map((b) => [b.id, b])), [graph]);
  const driftOn = Boolean(graph?.drift.usable && query.gdrift);
  const filtered = useMemo(
    () => (graph ? filterGraph(graph, query, query.res) : null),
    // query 객체는 매 렌더 새로 만들어지지 않는다(useDetailQuery 가 값 객체를 유지)
    [graph, query],
  );

  /**
   * 블록 모양 (4.11). 매핑 표는 화면에 두지 않고 **퍼블리셔 `kindShape()` 한 곳**에서 온다 —
   * 아이콘(`KindIcon`)과 같은 파일이라 "아이콘은 Job인데 모양은 CronJob"이 생기지 않는다.
   * 모양은 `kind`·`custom`·`layer` 의 함수라 필터·카메라와 무관하다(결정적, AC-3D11).
   */
  const shapes = useMemo(() => {
    const out: Record<string, ReturnType<typeof kindShape>> = {};
    for (const b of graph?.blocks ?? []) out[b.id] = kindShape(b.kind, { custom: b.custom, layer: b.layer });
    return out;
  }, [graph]);

  /** 종류 → 층 (종류 필터 옵션의 모양 견본용). 서버가 준 `blocks[].layer` 만 쓴다 */
  const kindLayers = useMemo(() => {
    const out = new Map<string, GraphBlock["layer"]>();
    for (const b of graph?.blocks ?? []) if (b.kind && !out.has(b.kind)) out.set(b.kind, b.layer);
    return out;
  }, [graph]);

  const selected = query.res ? (blocksById.get(query.res) ?? null) : null;
  const visibleIds = filtered?.blockIds ?? new Set<string>();
  const selectionVisible = selected !== null && visibleIds.has(selected.id);

  const ruleLabel = useCallback(
    (rid: string) => {
      const r = graph?.rules.find((x) => x.id === rid);
      return r ? `${r.label}(${rid})` : rid;
    },
    [graph],
  );

  // ── 검색 (부분 일치·대소문자 무시, AC-3D10)
  const matches = useMemo(() => searchMatches(filtered?.blocks ?? [], query.gq), [filtered, query.gq]);
  // 검색어가 바뀌면 결과 위치를 처음으로 (렌더 중 조정 — 효과에서 setState 하지 않는다)
  if (search.q !== query.gq) setSearch({ q: query.gq, i: 0 });
  const searchIndex = search.q === query.gq ? search.i : 0;
  const setSearchIndex = (i: number) => setSearch({ q: query.gq, i });

  const select = useCallback(
    (blockId: string | null, focus = false) => {
      patch({ res: blockId });
      if (blockId && focus) sceneRef.current?.focusBlock(blockId);
    },
    [patch],
  );

  // 선택이 바뀌면 한 문장으로 읽는다 (7.1). 카메라 조작은 읽지 않는다
  const selectionMessage = useMemo(() => {
    if (!selected) return "";
    const d = filtered?.byBlock.get(selected.id);
    return blockSelectionAnnouncement({
      kind: selected.kind ?? "해석 실패",
      name: selected.name ?? selected.id,
      namespace: selected.namespace,
      markers: markerSource(driftOn ? selected.markers : { ...selected.markers, drift: null }, {
        ghost: selected.ghost,
        notes: selected.notes,
      }),
      incoming: d?.incoming.length ?? 0,
      outgoing: d?.outgoing.length ?? 0,
    });
  }, [selected, filtered, driftOn]);
  // 판에 들어갈 때(PageDown/PageUp)는 판 문장을 앞에 붙인다 (publisher 요청 ②)
  const liveMessage = plateHint && selected?.plateId === plateHint.plateId ? `${plateHint.text}. ${selectionMessage}` : selectionMessage;

  const goPrimary = useCallback(
    (block: GraphBlock) => {
      const p = primaryPatch(block.navigate);
      if (!p) return;
      patch({
        view: (p.view as DetailQuery["view"]) ?? "files",
        file: p.file ?? null,
        line: p.line ? Number(p.line) : null,
        res: p.res ?? block.navigate.resourceKey ?? null,
      });
    },
    [patch],
  );

  const setView = useCallback(
    (v: GraphView) => {
      patch({ gview: v });
      setStoredView(v);
    },
    [patch, setStoredView],
  );

  const onCommand = useCallback(
    (cmd: SceneCommand) => {
      const list = filtered?.blocks ?? [];
      if (list.length === 0) return;
      const at = selected ? list.findIndex((b) => b.id === selected.id) : -1;
      switch (cmd) {
        case "next":
          select(list[Math.min(list.length - 1, at + 1)].id, true);
          break;
        case "prev":
          select(list[Math.max(0, at <= 0 ? 0 : at - 1)].id, true);
          break;
        case "first":
          select(list[0].id, true);
          break;
        case "last":
          select(list[list.length - 1].id, true);
          break;
        case "nextPlate":
        case "prevPlate": {
          const plates = [...new Set(list.map((b) => b.plateId))];
          const cur = selected ? plates.indexOf(selected.plateId) : -1;
          const nextPlate = plates[cmd === "nextPlate" ? Math.min(plates.length - 1, cur + 1) : Math.max(0, cur - 1)];
          const first = list.find((b) => b.plateId === nextPlate);
          if (first) select(first.id, true);
          const plate = graph?.plates.find((p) => p.id === nextPlate);
          setPlateHint(plate ? { plateId: plate.id, text: plateAnnouncement(plate) } : null);
          break;
        }
        case "activate":
          if (selected) goPrimary(selected);
          break;
        case "clear":
          patch({ res: null, gfocus: false });
          break;
        case "focus":
          if (selected) patch({ gfocus: !query.gfocus });
          break;
        case "table":
          setView("table");
          break;
        case "help":
          document.querySelector<HTMLElement>("[data-scene-help] button")?.click();
          break;
      }
    },
    [filtered, selected, graph, query.gfocus, select, goPrimary, patch, setView],
  );

  const resetFilters = useCallback(
    () =>
      patch({
        gns: [],
        gkind: [],
        grel: null,
        gmark: [],
        gq: "",
        gfocus: false,
      }),
    [patch],
  );

  // ────────────────────────────────────────────── 상태 판정 (9절)
  const total = graph?.summary ?? null;
  const filteredNow = isFiltered(query);
  const sceneState: SceneState = (() => {
    if (g.loading) return "loadingData";
    if (g.error && !graph) return g.errorCode === "SOURCE_UNAVAILABLE" ? "unknown" : "error";
    if (!graph) return "loadingData";
    if (graph.state === "pending_export") return "unknown";
    if (graph.state === "empty") return "empty";
    if (!webgl) return "unsupported";
    if (chunkFailed) return "chunkFailed";
    if (contextLost) return "contextLost";
    if (!showTable && !chunkReady) return "loadingChunk";
    if (!showTable && (filtered?.blocks.length ?? 0) === 0) return "filteredEmpty";
    if (g.error) return "error";
    if (graph.snapshotStatus.stale) return "stale";
    return "ready";
  })();

  // ────────────────────────────────────────────── 정보 줄 (6.4)
  // publisher 가 `SceneInfoItem.onClick`·`actionLabel` 을 넣는 중이다(디자인 6.4). 먼저 넘겨 두면 도착하는 대로 동작한다
  const infoItems: InfoChip[] = [];
  if (graph && filtered && total) {
    infoItems.push({
      id: "counts",
      text: countText(filtered.blocks.length, filtered.edges.length, total, filteredNow),
      tooltip: countTooltip({
        blocks: total.blocks,
        ghosts: total.ghosts,
        edges: total.edges,
      }),
    });
    if (graph.drift.usable) {
      const at = graph.drift.computedAt ? `${formatTime(graph.drift.computedAt, "shortTime")} 계산` : null;
      infoItems.push({
        id: "drift",
        icon: "square-dot",
        text: query.gdrift ? [`차이 ${filtered.driftMarkers.toLocaleString("en-US")}건`, at].filter(Boolean).join(" · ") : "드리프트 숨김",
        tooltip: graph.drift.badge.status.reasons[0]?.text,
      });
    }
    if (graph.scan.outsideResources.errors + graph.scan.outsideResources.warnings > 0) {
      infoItems.push({
        id: "outside",
        icon: "octagon-x",
        tone: "crit",
        text: `리소스 밖 발견 ${(graph.scan.outsideResources.errors + graph.scan.outsideResources.warnings).toLocaleString("en-US")}건`,
        tooltip: "metadata.json의 발견은 블록이 없어 여기에 모읍니다",
        href: href({ view: "files", file: null, line: null }),
      });
    }
    if (total.truncated.blocks || total.truncated.edges) {
      infoItems.push({
        id: "truncated",
        icon: "triangle-alert",
        tone: "warn",
        text: "일부만 표시",
        tooltip: `블록 20,000개 · 관계 40,000개까지만 그립니다. 블록 ${total.truncated.droppedBlocks.toLocaleString("en-US")}개 · 관계 ${total.truncated.droppedEdges.toLocaleString("en-US")}개를 뺐습니다.`,
      });
    }
    for (const n of graph.notices) {
      if (noticeAt(n.code) !== "chip") continue;
      if (n.code === "GRAPH_TRUNCATED") continue;
      infoItems.push({
        id: n.code,
        icon: n.code === "CUSTOM_RESOURCES_PRESENT" ? "shapes" : n.code === "GROUPED_VIEW" ? "layers" : "info",
        text: n.code === "CUSTOM_RESOURCES_PRESENT" ? "사용자 지정" : n.code === "GROUPED_VIEW" ? "묶어 보기" : n.text,
        tooltip: n.text,
      });
    }
    if (offscreen) {
      infoItems.push({
        id: "offscreen",
        icon: "maximize",
        text: "일부가 화면 밖",
        tooltip: "블록을 읽을 수 있는 크기를 지켰습니다. 전체를 보려면 축소(−)하거나 네임스페이스 필터로 좁히세요.",
        actionLabel: "전체가 보이게 축소",
        onClick: scene ? () => scene.zoomToFitAll() : undefined,
      });
    }
    if (labelOverflow.names > 0) {
      infoItems.push({
        id: "hiddenNames",
        icon: "eye-off",
        text: `라벨 ${labelOverflow.names.toLocaleString("en-US")}개 숨김`,
        tooltip: "겹쳐서 이름을 숨겼습니다. 확대하거나 표 보기에서 전부 볼 수 있습니다.",
        actionLabel: "표로 보기",
        onClick: () => setView("table"),
      });
    }
    if (labelOverflow.markers > 0) {
      infoItems.push({
        id: "hiddenMarkers",
        icon: "triangle-alert",
        tone: "warn",
        text: `표식 ${labelOverflow.markers.toLocaleString("en-US")}개 숨김`,
        tooltip: "표식이 겹쳐 일부를 숨겼습니다. 표 보기에는 전부 있습니다.",
        actionLabel: "표로 보기",
        onClick: () => setView("table"),
      });
    }
    if (lowPerf)
      infoItems.push({
        id: "low",
        icon: "info",
        text: "간소화 켬",
        tooltip: "라벨을 줄이고 먼 블록을 단순하게 그립니다",
      });
  }

  // 정보 줄은 한 줄이다(6.4): 6개를 넘으면 뒤쪽을 `+N` 하나로 합친다
  const shownChips = oneLineChips(infoItems);

  // ────────────────────────────────────────────── 필터 옵션 (facets, 화면이 세지 않는다)
  const nsOptions: SelectOption[] = (graph?.facets.namespaces ?? []).map((n) => ({
    value: n.name ?? n.plateId,
    label: n.name ?? n.plateId,
    count: n.count,
  }));
  // 종류 필터 옵션: 층 색 사각 10px → **그 종류의 모양 견본**(6.1 · 4.11). 층은 서버가 준 `blocks[].layer` 에서 읽는다
  //  (화면이 종류 → 층 표를 따로 갖지 않는다).
  const kindOptions: SelectOption[] = (graph?.facets.kinds ?? []).map((k) => {
    const layer = kindLayers.get(k.kind);
    return {
      value: k.kind,
      label: k.kind,
      count: k.count,
      adornment: layer ? <ShapeSwatch shape={kindShape(k.kind, { layer })} size={14} tone="layer" layer={layer} /> : undefined,
    };
  });
  const ruleOptions: SelectOption[] = (graph?.rules ?? []).map((r) => ({
    value: r.id,
    label: r.label,
    count: r.count ?? undefined,
  }));
  const markOptions: SelectOption[] = graph
    ? [
        {
          value: "drift",
          label: "드리프트 있음",
          count: graph.facets.drift.changed + graph.facets.drift.deleted + graph.facets.drift.added,
        },
        {
          value: "scan",
          label: "스캔 발견 있음",
          count: graph.facets.scan.errorBlocks + graph.facets.scan.warningBlocks,
        },
        { value: "ghost", label: "유령", count: graph.facets.ghosts },
      ]
    : [];

  const labelDensity: LabelDensity = query.glabels ?? defaultLabelDensity(filtered?.blocks.length ?? 0);
  const effectiveDensity: LabelDensity = lowPerf && !query.glabels ? "selected" : labelDensity;

  // ────────────────────────────────────────────── 3D 라벨 목록 (4.7)
  const labels = useMemo(() => {
    if (!filtered) return [];
    const out: { id: string; score: number; markers: number; hasName: boolean }[] = [];
    for (const b of filtered.blocks) {
      const source = markerSource(driftOn ? b.markers : { ...b.markers, drift: null }, {
        ghost: b.ghost,
        notes: b.notes,
        variant: "overlay",
      });
      const markers = blockMarkerItems(source).length;
      // ① 점수: 스캔 오류 700 · 그 밖 표식 600 · 나머지 0 (선택·hover·검색·이웃은 엔진이 올린다)
      const score = b.markers.scan.level === "error" ? 700 : markers > 0 ? 600 : 0;
      const picked = b.id === query.res || b.id === hovered || matches.includes(b.id);
      if (effectiveDensity === "all" || markers > 0 || picked) {
        out.push({ id: b.id, score, markers, hasName: effectiveDensity !== "off" || picked });
      }
    }
    return out;
  }, [filtered, effectiveDensity, driftOn, query.res, hovered, matches]);

  /**
   * 4.7.1 ② 축소 사다리 **B0~B4**. 줄이는 것은 폭뿐이고 폰트는 micro 11/14 고정, 이름은 언제나 한 줄.
   * 버리는 순서는 보조 줄 → 이름 → 표식(표식이 마지막까지 남는다). B4 는 종류 아이콘만.
   */
  const renderBlockLabel = useCallback(
    (blockId: string, step: LabelStep) => {
      const b = blocksById.get(blockId);
      if (!b) return null;
      const source = markerSource(driftOn ? b.markers : { ...b.markers, drift: null }, {
        ghost: b.ghost,
        notes: b.notes,
        variant: "overlay",
      });
      const items = blockMarkerItems(source);
      const picked = b.id === query.res || b.id === hovered || matches.includes(b.id);
      const showName = step <= 3 && (effectiveDensity !== "off" || picked);
      const name = b.name ?? b.file?.path ?? b.id;
      const sub = step === 0 ? blockSubLine(b) : null;
      return (
        <span className={styles.blockLabel} data-step={step} data-ghost={b.ghost ? "true" : undefined}>
          {items.length > 0 ? <BlockMarkers variant="overlay" {...source} /> : null}
          {/* 종류 아이콘은 이름 줄 맨 앞 12px 이다(4.10 — 블록 윗면에는 그리지 않는다). B4 에서도 남는다 */}
          <span className={styles.blockNameRow} title={name}>
            <KindIcon kind={b.kind} custom={b.custom} size={12} className={styles.blockKind} />
            {showName ? <span className={styles.blockName}>{name}</span> : null}
          </span>
          {/* 보조 줄은 **한 줄**이다 (4.7). 나머지는 `+N` 으로 알리고 전체는 선택 패널·표에 있다 */}
          {sub ? (
            <span className={styles.blockSub} title={sub.all.join(" · ")}>
              {sub.text}
              {sub.rest > 0 ? ` +${sub.rest}` : ""}
            </span>
          ) : null}
        </span>
      );
    },
    [blocksById, driftOn, effectiveDensity, query.res, hovered, matches],
  );

  const renderPlateLabel = useCallback(
    (plateId: string, density: 0 | 1 | 2 | 3) => {
      const p = graph?.plates.find((x) => x.id === plateId);
      if (!p) return null;
      return (
        <PlateLabel
          name={p.name ?? plateId}
          kind={p.kind}
          system={p.system}
          resourceCount={p.resourceCount}
          ghostCount={p.ghostCount}
          density={density}
          markers={markerSource(driftOn ? p.markers : { ...p.markers, drift: null }, {
            notes: p.notes,
            hrefs: plateHrefs(p, href),
          })}
          onNameClick={() => patch({ gns: [p.name ?? plateId] })}
          onNameDoubleClick={() => {
            if (p.navigate.file)
              patch({
                view: "files",
                file: p.navigate.file,
                line: p.fileLine,
                res: null,
              });
          }}
        />
      );
    },
    [graph, driftOn, href, patch],
  );

  // ────────────────────────────────────────────── 관계 표 (8절)
  const [expandedIds, setExpandedIds] = useState<string[] | null>(null);
  const expanded = useMemo(
    () => new Set(expandedIds ?? (graph && filtered ? defaultExpanded(graph, filtered.blocks) : [])),
    [expandedIds, graph, filtered],
  );
  const rows = useMemo(() => {
    if (!graph || !filtered) return [];
    const emptyPlates = new Set(graph.plates.filter((p) => !filtered.blocks.some((b) => b.plateId === p.id)).map((p) => p.id));
    // `(3 / 11)` 는 **필터를 건 상태**에서만 (기본 켬 집합은 필터로 세지 않는다, 4.4).
    // 분모는 정보 줄 `블록 33개 중 12개` 와 같은 기준 = 서버 전체 블록 수
    const totalByPlate = new Map<string, number>();
    if (filteredNow) for (const b of graph.blocks) totalByPlate.set(b.plateId, (totalByPlate.get(b.plateId) ?? 0) + 1);
    const specs = buildRowSpecs(graph, filtered.blocks, {
      expanded,
      sort,
      driftOn,
    });
    return tableRows(specs, {
      graph,
      blocks: blocksById,
      byBlock: filtered.byBlock,
      driftOn,
      href,
      ruleLabel,
      totalByPlate,
      emptyPlates,
    });
  }, [graph, filtered, expanded, sort, driftOn, blocksById, href, ruleLabel, filteredNow]);

  // ────────────────────────────────────────────── 알림 (9.8·9.9·9.5, 최대 2개)
  const notices: React.ReactNode[] = [];
  if (total && (total.truncated.blocks || total.truncated.edges) && !truncDismissed) {
    notices.push(
      <InlineAlert
        key="trunc"
        tone="warn"
        title="구성이 너무 커서 일부만 그립니다"
        description={`표시하지 못한 블록 ${total.truncated.droppedBlocks.toLocaleString("en-US")}개 · 관계 ${total.truncated.droppedEdges.toLocaleString("en-US")}개. 표 보기도 같은 범위입니다. 네임스페이스 필터로 범위를 좁혀 보세요.`}
        closable
        closeLabel="일부만 표시 안내 닫기"
        onClose={() => setTruncDismissed(true)}
      />,
    );
  }
  if (g.change) {
    const lost = selected && g.pending && !g.pending.graph.blocks.some((b) => b.id === selected.id);
    const sign = (v: number) => (v > 0 ? `+${v}` : String(v));
    notices.push(
      <InlineAlert
        key="change"
        tone="info"
        live
        title={`구성이 바뀌었습니다 (블록 ${sign(g.change.blocks)} · 관계 ${sign(g.change.edges)})`}
        description={lost ? `고른 블록(${selected?.name ?? selected?.id})이 더 이상 없습니다.` : undefined}
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (lost) patch({ res: null });
              g.relayout();
            }}
          >
            다시 배치
          </Button>
        }
      />,
    );
  }
  if (lowPerf && !lowPerfDismissed) {
    notices.push(
      <InlineAlert
        key="low"
        tone="neutral"
        compact
        title="3D가 느립니다. 표로 보기를 권합니다."
        closable
        closeLabel="3D 속도 안내 닫기"
        live
        onClose={() => setLowPerfDismissed(true)}
        action={
          <Button variant="ghost" size="sm" icon="table-2" onClick={() => setView("table")}>
            표로 보기
          </Button>
        }
      />,
    );
  }

  // ────────────────────────────────────────────── 도구 막대
  const driftReason =
    graph?.drift.reasonText ??
    (graph?.drift.reasonCode ? DRIFT_BUTTON_REASON[graph.drift.reasonCode] : undefined) ??
    "드리프트 결과가 없습니다";
  const computeAbility = graph?.drift.actions.computeDrift;

  const ruleFilter = (
    <MultiSelect
      label="관계"
      width={160}
      options={ruleOptions}
      value={activeRules(query)}
      onChange={(v) =>
        patch({
          grel: v.filter((x): x is RuleId => (ALL_RULES as string[]).includes(x)),
        })
      }
    />
  );
  const markFilter = (
    <MultiSelect label="표식" width={140} options={markOptions} value={query.gmark} onChange={(v) => patch({ gmark: v as MarkFilter[] })} />
  );

  const toolbarA = (
    <SceneToolbar
      row="a"
      busy={g.loading}
      countText={filtered && total ? countText(filtered.blocks.length, filtered.edges.length, total, filteredNow) : undefined}
      trailing={
        filteredNow ? (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            필터 초기화
          </Button>
        ) : undefined
      }
    >
      <SegmentedControl
        size="sm"
        label="보기"
        value={showTable ? "table" : "3d"}
        onChange={(v) => setView(v as GraphView)}
        options={[
          {
            value: "3d",
            label: "3D",
            icon: "box",
            disabledReason: webgl ? undefined : "이 브라우저에서 3D를 쓸 수 없습니다",
          },
          { value: "table", label: "표", icon: "table-2" },
        ]}
      />
      {nsOptions.length > 1 ? (
        <MultiSelect label="네임스페이스" width={160} options={nsOptions} value={query.gns} onChange={(v) => patch({ gns: v })} />
      ) : null}
      <MultiSelect label="종류" width={140} options={kindOptions} value={query.gkind} onChange={(v) => patch({ gkind: v })} />
      {/* 관계·표식 필터는 **항상** 팝오버다: 캔버스 폭 766px 안에서 도구 막대 A 를 한 줄(48px)로 지켜야
          캔버스가 설계값 636px 을 유지한다(3절·6.1). 펼쳐 두면 두 줄이 되어 60px 을 잃는다 */}
      <SceneToolbarItem>
        <Popover
          label="관계·표식 필터"
          width={280}
          trigger={(p) => (
            <Button {...p} variant="secondary" size="sm" icon="settings-2">
              필터
            </Button>
          )}
        >
          <div className={styles.filterPopover}>
            {ruleFilter}
            {markFilter}
          </div>
        </Popover>
      </SceneToolbarItem>
      <SearchInput value={query.gq} onChange={(v) => patch({ gq: v })} placeholder="리소스 이름 검색" width={200} shortcut={false} />
      {/* 검색 결과 이동은 **검색 중에만** 둔다: 기본 상태에서 82px 을 아껴 도구 막대 A 가 한 줄(48px)로 남는다 */}
      {query.gq.trim() ? (
        <SceneSearchNav
          index={matches.length === 0 ? 0 : searchIndex + 1}
          total={matches.length}
          onPrev={() => {
            const next = (searchIndex - 1 + matches.length) % Math.max(1, matches.length);
            setSearchIndex(next);
            select(matches[next], true);
          }}
          onNext={() => {
            const next = (searchIndex + 1) % Math.max(1, matches.length);
            setSearchIndex(next);
            select(matches[next], true);
          }}
        />
      ) : null}
    </SceneToolbar>
  );

  const toolbarB = (
    <SceneToolbar
      row="b"
      trailing={
        <>
          <span data-scene-help>
            <HelpPopover
              label="3D 조작"
              title="3D 조작"
              content={
                <dl className={styles.keyList}>
                  {KEY_HELP.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              }
            />
          </span>
          {/* 범례는 캔버스 밖 Popover 다(6.5). 3D·관계 표 보기에서 같은 버튼·같은 팝오버를 쓴다 */}
          <Popover
            label="범례"
            width={280}
            align="end"
            maxHeight={520}
            open={legendOpen}
            onOpenChange={(open) => {
              setLegendOpen(open);
              if (open && legendSeen !== "1") setLegendSeen("1");
            }}
            trigger={(p) => (
              <Button {...p} variant="ghost" size="sm" icon="layers">
                <span className={styles.legendTrigger}>
                  범례
                  {/* 한 번도 열어 본 적이 없으면 8px 점 (2.3 `legendSeen`) */}
                  {legendSeen === "1" ? null : <span className={styles.newDot} aria-label="아직 보지 않음" />}
                </span>
              </Button>
            )}
          >
            <SceneLegend onClose={() => setLegendOpen(false)} />
          </Popover>
        </>
      }
    >
      <Switch
        checked={Boolean(graph?.drift.usable) && query.gdrift}
        onChange={(v) => patch({ gdrift: v })}
        label="드리프트 겹쳐 보기"
        disabled={!graph?.drift.usable}
        disabledReason={!graph?.drift.usable ? driftReason : undefined}
      />
      {graph?.drift.usable ? (
        <span className={styles.meta}>
          {graph.drift.badge.mode === "last_result" ? "지난 결과 · " : ""}
          {graph.drift.computedAt ? `${formatTime(graph.drift.computedAt, "shortTime")} 계산` : "계산 시각 없음"}
        </span>
      ) : (
        <span className={styles.meta}>계산 안 함</span>
      )}
      {!graph?.drift.usable && computeAbility?.allowed ? (
        <Button variant="ghost" size="sm" icon="git-compare" onClick={g.compute} loading={g.computing}>
          드리프트 계산
        </Button>
      ) : null}
      {!showTable ? (
        <>
          <Select
            label="라벨"
            width={152}
            options={LABEL_OPTIONS}
            value={effectiveDensity}
            onChange={(v) => patch({ glabels: v as LabelDensity })}
          />
          <Switch
            checked={query.gfocus}
            onChange={(v) => patch({ gfocus: v })}
            label="주변만 보기"
            disabled={!selectionVisible}
            disabledReason={!selectionVisible ? "블록을 먼저 고르세요" : undefined}
          />
        </>
      ) : null}
    </SceneToolbar>
  );

  // ────────────────────────────────────────────── 선택 패널
  const deg = selected ? filtered?.byBlock.get(selected.id) : undefined;
  const panel = (
    <BlockDetailPanel
      block={selected ? detailBlock(selected) : null}
      markers={
        selected
          ? markerSource(driftOn ? selected.markers : { ...selected.markers, drift: null }, {
              ghost: selected.ghost,
              notes: selected.notes,
              variant: "panel",
            })
          : undefined
      }
      notes={selected ? panelNotes(selected) : undefined}
      incoming={selected ? relationItems(deg?.incoming ?? [], "in", blocksById, ruleLabel) : []}
      outgoing={selected ? relationItems(deg?.outgoing ?? [], "out", blocksById, ruleLabel) : []}
      actions={selected ? blockActions(selected, driftOn, href) : undefined}
      onSelectRelated={(peerId) => peerId && select(peerId, true)}
      onClear={() => patch({ res: null, gfocus: false })}
    />
  );

  // 9.9 표 위 잘림 알림은 **닫기가 없다**(표에는 정보 줄이 없어 다른 단서가 없다)
  const truncated = Boolean(total && (total.truncated.blocks || total.truncated.edges));
  const tableTruncNotice =
    truncated && total ? (
      <InlineAlert
        tone="warn"
        title="구성이 너무 커서 일부만 그립니다"
        description={`표시하지 못한 블록 ${total.truncated.droppedBlocks.toLocaleString("en-US")}개 · 관계 ${total.truncated.droppedEdges.toLocaleString("en-US")}개. 3D 보기도 같은 범위입니다. 네임스페이스 필터로 범위를 좁혀 보세요.`}
      />
    ) : null;

  const table =
    graph && filtered && total ? (
      <>
        {tableTruncNotice}
        <RelationTable
          rows={rows}
          expandedIds={[...expanded]}
          onExpandedChange={setExpandedIds}
          selectedId={query.res}
          onSelectRow={(row) => select(row.id)}
          openRowIds={openRows}
          onToggleRow={(rid) => setOpenRows((prev) => (prev.includes(rid) ? prev.filter((x) => x !== rid) : [...prev, rid]))}
          onSelectRelated={(peerId) => peerId && select(peerId)}
          summary={tableSummaryText(
            {
              blocks: filtered.blocks.length,
              ghosts: filtered.ghosts,
              edges: filtered.edges.length,
              driftMarkers: filtered.driftMarkers,
              scanMarkers: filtered.scanMarkers,
            },
            total,
            filteredNow,
            total.truncated.droppedBlocks,
          )}
          sort={sort}
          onSortChange={setSort}
          state={rows.length === 0 ? (filteredNow ? "filteredEmpty" : "empty") : "ready"}
          onResetFilters={resetFilters}
        />
      </>
    ) : null;

  const ariaLabel = graph
    ? `Kubernetes 구성도, 네임스페이스 ${graph.summary.plates.toLocaleString("en-US")}개, 리소스 ${(filtered?.blocks.length ?? 0).toLocaleString("en-US")}개, 관계 ${(filtered?.edges.length ?? 0).toLocaleString("en-US")}개, 드리프트 차이 ${(filtered?.driftMarkers ?? 0).toLocaleString("en-US")}건, 스캔 표식 ${(filtered?.scanMarkers ?? 0).toLocaleString("en-US")}건`
    : "Kubernetes 구성도";

  const frame = (
    <Scene3DFrame
      state={sceneState}
      view={showTable ? "table" : "3d"}
      toolbarA={toolbarA}
      toolbarB={toolbarB}
      tableSlot={table}
      stale={graph?.snapshotStatus.stale}
      keepScene={Boolean(graph)}
      liveMessage={liveMessage}
      notice={notices}
      buildingCount={filtered?.blocks.length}
      skipLinkHref={href({ gview: "table" })}
      onShowTable={() => setView("table")}
      onRetry={() => {
        if (chunkFailed) {
          setChunkFailed(false);
          setChunkNonce((n) => n + 1);
        }
        g.reload();
      }}
      onReenable={() => setContextLost(false)}
      onResetFilters={resetFilters}
      unknownTitle={graph?.state === "pending_export" ? "스냅샷 파일 확인 전" : undefined}
      unknownReason={
        graph?.state === "pending_export"
          ? (graph.notices.find((n) => n.code === "EXPORT_MAYBE_IN_PROGRESS")?.text ?? "내보내기가 진행 중일 수 있습니다.")
          : (g.error?.message ?? undefined)
      }
      unknownIcon={graph?.state === "pending_export" ? "hourglass" : "circle-help"}
      errorDescription={g.error?.message}
      infoBar={
        // 정보 줄 `circle-help` 툴팁 둘째 줄은 범례 맨 아래 첫 줄과 **같은 문자열**이다(6.4-9 · 6.5).
        // 모양이 종류를 뜻하게 되면서(4.11) 문구가 바뀌었으므로 화면이 직접 적지 않고 `LEGEND_NOTES` 를 쓴다.
        infoItems.length > 0 ? (
          <SceneInfoBar
            items={shownChips}
            mockBadge={dataSource === "mock" ? <DataSourceBadge mode="mock" /> : undefined}
            staleAt={graph?.snapshotStatus.stale ? (graph.snapshotStatus.updatedAt ?? undefined) : undefined}
            hint={`${NO_EDGE_HINT} ${LEGEND_NOTES[0]}`}
          />
        ) : undefined
      }
      cameraControls={
        !showTable && sceneState === "ready" ? (
          <CameraControls
            view={cameraView}
            onView={(v) => {
              setCameraView(v);
              sceneRef.current?.viewpoint(v);
            }}
            onReset={() => {
              setCameraView("iso");
              sceneRef.current?.reset();
            }}
            onZoomIn={() => sceneRef.current?.zoomIn()}
            onZoomOut={() => sceneRef.current?.zoomOut()}
          />
        ) : undefined
      }
      canvasSlot={
        Canvas && layout && graph && filtered ? (
          <Canvas
            ref={attachScene}
            layout={layout}
            plates={graph.plates}
            blocks={filtered.blocks}
            edges={filtered.edges}
            shapes={shapes}
            buildKey={`${graph.version}|${filtered.blocks.length}|${filtered.edges.length}|${query.gns.join()}|${query.gkind.join()}|${activeRules(query).join()}|${query.gmark.join()}|${query.gq}|${query.gfocus ? query.res : ""}|${driftOn}`}
            keepCamera
            selectedId={query.res}
            neighborIds={[...(deg?.incoming ?? []).map((e) => e.from), ...(deg?.outgoing ?? []).map((e) => e.to)]}
            searchIds={matches}
            labels={labels}
            renderBlockLabel={renderBlockLabel}
            renderPlateLabel={renderPlateLabel}
            reducedMotion={reducedMotion}
            lowDetail={lowPerf}
            insets={{
              left: 12,
              right: 116,
              top: 44,
              bottom: 12,
            }}
            ariaLabel={filteredNow ? `${ariaLabel} 중 표시 ${filtered.blocks.length}개` : ariaLabel}
            ariaDescription="방향키로 회전, 대괄호 키로 블록 이동, 엔터로 이동, 표로 보려면 T."
            onSelect={(bid) => select(bid)}
            onActivate={(bid) => {
              const b = blocksById.get(bid);
              if (b) goPrimary(b);
            }}
            onHover={setHovered}
            onCommand={onCommand}
            onContextLost={() => setContextLost(true)}
            onLowPerformance={() => setLowPerf(true)}
            onLabelOverflow={setLabelOverflow}
            onOffscreen={setOffscreen}
          />
        ) : undefined
      }
    />
  );

  if (showTable) {
    return (
      <Grid>
        <GridItem span={12}>{frame}</GridItem>
      </Grid>
    );
  }
  return (
    <Grid>
      <GridItem span={8}>{frame}</GridItem>
      <GridItem span={4}>{panel}</GridItem>
    </Grid>
  );
}
