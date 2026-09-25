// 퍼블리셔 영역: 공용 UI 컴포넌트. props 로만 동작한다(fetch·SSE·전역 상태 없음).
// 문서: docs/design/components.md, docs/reports/cluster-status/publisher.md

// 공통 타입·아이콘·포맷
export * from "./types";
export { Icon, STATUS_ICON, type IconName, type IconProps, type IconSize } from "./icons";
export * from "./format";
export { cx } from "./cx";
// API 값 → 디자인 키 변환 (status.md 8절)
export * from "./api-map";

// 1. 셸
export { AppShell, type AppShellProps } from "./shell/AppShell";
export { TopBar, type TopBarProps } from "./shell/TopBar";
export {
  SideNav,
  DEFAULT_NAV_ITEMS,
  DEFAULT_NAV_FOOTER_ITEMS,
  formatNavCount,
  navItemStatusText,
  type NavItem,
  type SideNavProps,
} from "./shell/SideNav";
export {
  ConnectionIndicator,
  ConnectionBanner,
  type ConnectionStatus,
  type ConnectionIndicatorProps,
  type ConnectionBannerProps,
} from "./shell/Connection";
export {
  DataSourceBadge,
  type DataSourceBadgeProps,
  type MockScenario,
  type ScenarioGroup,
  type ScenarioGroupKey,
  type ScenarioGroupId,
  SCENARIO_GROUPS,
} from "./shell/DataSourceBadge";
export { PageHeader, type PageHeaderProps, type Breadcrumb } from "./shell/PageHeader";
export { ThemeMenu, type ThemeMenuProps, type ThemeChoice } from "./shell/ThemeMenu";

// 2. 상태 표시
export { StatusBadge, type StatusBadgeProps } from "./status/StatusBadge";
export { StatusIcon, type StatusIconProps } from "./status/StatusIcon";
export { ReasonText, type ReasonTextProps } from "./status/ReasonText";
export { StatusCard, type StatusCardProps, type StatusCardItem } from "./status/StatusCard";
export {
  SummaryStrip,
  SummaryStripItem,
  type SummaryStripProps,
  type SummaryStripItemProps,
} from "./status/SummaryStrip";
export { UsageBar, type UsageBarProps } from "./status/UsageBar";
export { LabeledStatus, type LabeledStatusProps } from "./status/LabeledStatus";
export { Chip, StaleNotice, type ChipProps, type ChipTone, type StaleNoticeProps } from "./status/Chip";

// 3. 금액
export { MoneyValue, RangeValue, type MoneyValueProps, type RangeValueProps } from "./cost/MoneyValue";
export { CostKindBadge, type CostKindBadgeProps } from "./cost/CostKindBadge";
export { MetricTile, type MetricTileProps } from "./cost/MetricTile";
export { BudgetGauge, type BudgetGaugeProps } from "./cost/BudgetGauge";
export {
  COST_CATEGORY_ORDER,
  COST_CATEGORY_LABEL,
  CONTROL_PLANE_KIND_ORDER,
  CONTROL_PLANE_KIND_LABEL,
  type CostCategory,
  type ControlPlaneCostKind,
} from "./cost/costCategory";

// 4. 버튼·입력
export { Button, type ButtonProps, type ButtonVariant } from "./controls/Button";
export { IconButton, type IconButtonProps } from "./controls/IconButton";
export { ButtonLink, type ButtonLinkProps } from "./controls/ButtonLink";
export { CopyButton, type CopyButtonProps } from "./controls/CopyButton";
export { SearchInput, type SearchInputProps } from "./controls/SearchInput";
export {
  Select,
  MultiSelect,
  type SelectOption,
  type SelectProps,
  type MultiSelectProps,
} from "./controls/Select";
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from "./controls/SegmentedControl";
export { Switch, type SwitchProps } from "./controls/Switch";
export { FilterBar, type FilterBarProps } from "./controls/FilterBar";
export { TextField, TextArea, type TextFieldProps, type TextAreaProps } from "./controls/TextField";
export { SecretInput, type SecretInputProps, type SecretInputMode } from "./controls/SecretInput";

// 5. 오버레이
export { Tooltip, type TooltipProps } from "./overlay/Tooltip";
export { Popover, type PopoverProps, type PopoverTriggerProps } from "./overlay/Popover";
export { Drawer, type DrawerProps } from "./overlay/Drawer";
export { Dialog, type DialogProps } from "./overlay/Dialog";
export { HelpPopover, type HelpPopoverProps } from "./overlay/HelpPopover";
export {
  TypeToConfirmDialog,
  matchesExpected,
  type TypeToConfirmDialogProps,
} from "./overlay/TypeToConfirmDialog";

// 6. 알림·빈 상태
export { Banner, InlineAlert, type BannerProps, type InlineAlertProps, type AlertTone } from "./feedback/Banner";
export {
  EmptyState,
  UnknownState,
  ErrorState,
  type EmptyStateProps,
  type UnknownStateProps,
  type ErrorStateProps,
  type ErrorKind,
  type StateSize,
} from "./feedback/EmptyState";
export {
  CollapsibleNotice,
  type CollapsibleNoticeProps,
  type NoticeTone,
} from "./feedback/CollapsibleNotice";
export { Skeleton, type SkeletonProps } from "./feedback/Skeleton";
export { Spinner, type SpinnerProps } from "./feedback/Spinner";

// 7. 표
export {
  DataTable,
  nextSort,
  type Column,
  type SortState,
  type DataTableProps,
  type DataTableState,
  TwoLineCell,
  type TwoLineCellProps,
} from "./table/DataTable";
export { TableLinkCell, type TableLinkCellProps } from "./table/TableLinkCell";
export { ResourceName, type ResourceNameProps, type ResourceKind } from "./table/ResourceName";
export { KeyValueList, type KeyValueListProps, type KeyValueItem, type KeyValueNote } from "./table/KeyValueList";
export { DistributionBar, type DistributionBarProps, type DistributionSegment } from "./table/DistributionBar";

// 8. 기타 구조
export { Section, type SectionProps } from "./layout/Section";
export { Card, type CardProps } from "./layout/Card";
export { Grid, GridItem, type GridProps, type GridItemProps } from "./layout/Grid";
export { LinkTabs, linkTabSrText, type LinkTabsProps, type LinkTabItem } from "./layout/LinkTabs";
export { Tabs, TabPanel, tabIds, type TabsProps, type TabPanelProps, type TabItem } from "./layout/Tabs";
export {
  Timestamp,
  Duration,
  ElapsedTimer,
  type TimestampProps,
  type DurationProps,
  type ElapsedTimerProps,
} from "./layout/Time";
export { Stepper, type StepperProps, type Step, type StepState } from "./layout/Stepper";
export { CodeBlock, type CodeBlockProps } from "./layout/CodeBlock";
export { JsonTree, type JsonTreeProps } from "./layout/JsonTree";
export { CommandLine, type CommandLineProps } from "./layout/CommandLine";
export { CommandSteps, type CommandStepsProps, type CommandStep } from "./layout/CommandSteps";

// 9. 차트 틀 (차트 본체는 프론트 charts/)
export { ChartFrame, type ChartFrameProps, type ChartHeight } from "./chart-frame/ChartFrame";
export { ChartLegend, type ChartLegendProps, type ChartLegendItem } from "./chart-frame/ChartLegend";

// 10. 어드바이저 전용
export {
  SeverityBadge,
  SeverityIcon,
  RiskBadge,
  CategoryChip,
  SourceLabel,
  ExampleBadge,
  NoExecuteNotice,
  NO_EXECUTE_DEFAULT_TEXT,
  type SeverityBadgeProps,
  type RiskBadgeProps,
  type CategoryChipProps,
  type SourceLabelProps,
  type ExampleBadgeProps,
} from "./advisor/Labels";
export { SeverityMatrix, type SeverityMatrixProps } from "./advisor/SeverityMatrix";
export {
  BridgeStatusBar,
  BRIDGE_BADGE,
  BRIDGE_DEFAULT_MESSAGE,
  type BridgeState,
  type BridgeStatusBarProps,
} from "./advisor/BridgeStatusBar";
export { RunProgressPanel, type RunProgressPanelProps, type AdvisorRun } from "./advisor/RunProgressPanel";
export {
  RunResultAlert,
  RUN_RESULT_SPEC,
  DEFAULT_ADVISOR_TIMEOUT_SEC,
  DEFAULT_ADVISOR_SLOW_AFTER_SEC,
  formatLimitSec,
  RUN_REASON_LABEL,
  toRunFailReason,
  type RunResultAlertProps,
  type RunFailReason,
} from "./advisor/RunResultAlert";
export {
  SuggestionCard,
  type SuggestionCardProps,
  type SuggestionTarget,
  type SuggestionEvidence,
  type SuggestionStep,
} from "./advisor/SuggestionCard";

// 11. AWS 스냅샷 전용 (aws-snapshot-manager, components.md 11절)
export {
  CodeEditor,
  PlainCodeEngine,
  PLAIN_ENGINE_WRAP_IN_EDIT,
  CODE_EDITOR_DEFAULT_HEIGHT,
  type CodeEditorProps,
  type CodeEditorEngine,
  type CodeEditorEngineProps,
  type CodeEditorEngineHandle,
  type CodeEditorKeyAction,
  type CodeEditorMarker,
  type CodeEditorMarkerItem,
  type LineDecoration,
} from "./snapshot/CodeEditor";
export {
  splitLines,
  buildDecorations,
  targetAnnouncement,
  CODE_LINE_HEIGHT,
} from "./snapshot/codeEditorModel";
export {
  ScanFindingList,
  findingAriaLabel,
  splitFileLocation,
  type ScanFinding,
  type ScanFindingListProps,
} from "./snapshot/ScanFindingList";
export { ScanCounts, type ScanCountsProps } from "./snapshot/ScanCounts";
export { SCAN_LEVEL, scanLevelSpec, worstScanLevel, type ScanLevelSpec } from "./snapshot/scan";

// 14. Kubernetes 스냅샷·드리프트 전용 (k8s-snapshot, components.md 14절)
export {
  DRIFT_KIND,
  DRIFT_KIND_ORDER,
  formatDriftBreakdown,
  formatDriftCount,
  formatDriftLastResult,
  type DriftBreakdown,
  type DriftLastResult,
} from "./k8s/drift";
export {
  DriftStatus,
  DriftKindIcon,
  DriftKindChip,
  DriftCountChip,
  type DriftStatusProps,
  type DriftKindIconProps,
  type DriftKindChipProps,
  type DriftCountChipProps,
} from "./k8s/DriftStatus";
export {
  DiffValue,
  MaskedValue,
  MASKED_DEFAULT_TOOLTIP,
  countLines,
  scalarText,
  scalarTypeLabel,
  differsOnlyByType,
  diffValueLines,
  type DiffScalar,
  type DiffValueData,
  type DiffValueProps,
  type MaskedValueProps,
} from "./k8s/DiffValue";
export {
  FieldDiffTable,
  FIELDS_TRUNCATED_TEXT,
  pathWithBreaks,
  hiddenBreakdown,
  type FieldDiffRow,
  type FieldDiffTableProps,
} from "./k8s/FieldDiffTable";
export {
  DriftSummary,
  hiddenSummaryText,
  driftChangeText,
  notComparableChip,
  type DriftMode,
  type DriftSummaryProps,
  type DriftCounts,
  type DriftNotComparable,
  type DriftFilter,
} from "./k8s/DriftSummary";
export { ResourceTree, type ResourceTreeProps } from "./k8s/ResourceTree";
export {
  TREE_ROW_HEIGHT,
  countLeaves,
  allBranchIds,
  defaultExpandedIds,
  filterTree,
  flattenVisible,
  aggregateMarkers,
  treeRowSrText,
  treeVisibleRange,
  type TreeNode,
  type TreeNodeKind,
  type TreeMarkers,
  type FlatRow,
  type AggregateMarkers,
} from "./k8s/resourceTreeModel";

// 16. 3D 구성도 전용 (snapshot-3d 1단계, components.md 16절)
export {
  VIZ_LAYER,
  VIZ_LAYER_ORDER,
  GHOST_REASON_TEXT,
  GHOST_LABEL,
  CERTAINTY,
  OPTIONAL_REF_LABEL,
  LEGEND_NOTES,
  NO_EDGE_HINT,
  NOTE_SPEC,
  PLATE_MARKER_NOTE,
  blockMarkerItems,
  blockLocationText,
  blockSelectionAnnouncement,
  type VizLayer,
  type VizLayerSpec,
  type Certainty,
  type GhostReason,
  type SceneState,
  type MarkerTone,
  type BlockMarkerSource,
  type BlockMarkerItem,
  type BlockNote,
  type NoteSpec,
} from "./viz/viz";
export {
  KindIcon,
  kindIconName,
  plateIconName,
  kindShape,
  KIND_ICON,
  KIND_SHAPE,
  PLATE_ICON,
  FALLBACK_KIND_ICON,
  CUSTOM_KIND_ICON,
  FALLBACK_KIND_SHAPE,
  AUX_KIND_SHAPE,
  type KindIconProps,
  type KindIconPlate,
  type VizShape,
} from "./viz/KindIcon";
export { LayerSwatch, type LayerSwatchProps } from "./viz/LayerSwatch";
export { ShapeSwatch, SHAPE_PATH, type ShapeSwatchProps } from "./viz/ShapeSwatch";
export { BlockMarkers, type BlockMarkersProps } from "./viz/BlockMarkers";
export { CertaintyChip, type CertaintyChipProps } from "./viz/CertaintyChip";
export {
  RelationItem,
  RelationList,
  type RelationItemProps,
  type RelationListProps,
  type RelationPeer,
} from "./viz/RelationItem";
export {
  BlockDetailPanel,
  type BlockDetailPanelProps,
  type BlockDetailBlock,
  type BlockDetailAction,
  type BlockDetailActions,
} from "./viz/BlockDetailPanel";
export {
  RelationTable,
  type RelationTableProps,
  type RelationTableRow,
  type RelationGroupRow,
  type RelationResourceRow,
} from "./viz/RelationTable";
export { SceneInfoBar, type SceneInfoBarProps, type SceneInfoItem } from "./viz/SceneInfoBar";
export {
  SceneLegend,
  DEFAULT_LEGEND_LAYERS,
  DEFAULT_LEGEND_SHAPES,
  DEFAULT_LEGEND_MARKERS,
  SHAPE_SECTION_TITLE,
  type SceneLegendProps,
  type SceneLegendLayer,
  type SceneLegendShape,
  type SceneLegendMarker,
} from "./viz/SceneLegend";
export { CameraControls, type CameraControlsProps, type CameraView } from "./viz/CameraControls";
export {
  SceneToolbar,
  SceneToolbarItem,
  SceneSearchNav,
  type SceneToolbarProps,
  type SceneToolbarItemProps,
  type SceneSearchNavProps,
} from "./viz/SceneToolbar";
export { Scene3DFrame, SCENE_TEXT, MAX_NOTICES, type Scene3DFrameProps } from "./viz/Scene3DFrame";
export { PlateLabel, type PlateLabelProps, type PlateKind } from "./viz/PlateLabel";

// 18. 컨트롤 플레인 전용 (kops-support, components.md 18절)
export {
  ComponentMatrix,
  columnTooltip,
  type ComponentMatrixProps,
  type ComponentMatrixColumn,
  type ComponentMatrixRow,
  type ComponentMatrixCell,
  type CellState,
} from "./cluster/ComponentMatrix";

// 20. 알림·로그 전용 (alerts·logs, components.md 20절)
export {
  AlertItem,
  type AlertItemProps,
  type AlertTarget,
  type AlertDispatch,
} from "./alerts/AlertItem";
export { AlertGapRow, type AlertGapRowProps } from "./alerts/AlertGapRow";
export {
  ALERT_SEVERITY,
  DISPATCH_SPEC,
  GAP_EXPLAIN,
  GAP_UNKNOWN_PREVIOUS,
  alertChips,
  alertItemName,
  gapAriaLabel,
  gapRangeText,
  gapTime,
  gapTimeSpoken,
  isDispatchState,
  trimChips,
  type AlertChip,
  type AlertKind,
  type AlertSeverity,
  type DispatchState,
} from "./alerts/alertModel";
export { LogLineList, type LogLineListProps } from "./logs/LogLineList";
export { RedactionNotice, type RedactionNoticeProps } from "./logs/RedactionNotice";
export {
  LOG_ANCHOR_SEPARATOR_HEIGHT,
  LOG_CONFIDENCE_LABEL,
  LOG_GUTTER_WIDTH,
  LOG_LINE_HEIGHT,
  LOG_REDACTION_NOTICE,
  LOG_REDACTION_NO_RAW,
  anchorScrollTop,
  findMatches,
  formatLogTime,
  indexAtOffset,
  isNoticeLine,
  lineOffsets,
  lineText,
  logAnchorTimeText,
  logLineSrText,
  logListAnchor,
  logVisibleRange,
  maskedCount,
  maskedRules,
  noticeText,
  prefixText,
  splitByMatches,
  truncatedTail,
  type LogAnchorState,
  type LogLine,
  type LogLineKind,
  type LogListAnchor,
  type LogRuleRef,
  type LogSegment,
  type LogSource,
} from "./logs/logLineModel";
