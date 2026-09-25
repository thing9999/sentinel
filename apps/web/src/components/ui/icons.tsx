import {
  Archive,
  ArrowDown,
  ArrowUp,
  Ban,
  BellRing,
  Box,
  Boxes,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsRight,
  CircleDashed,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  ClockAlert,
  Copy,
  Database,
  EqualApproximately,
  ExternalLink,
  Eye,
  FilePen,
  FileQuestionMark,
  FileWarning,
  FileX,
  FlaskConical,
  Folder,
  Gauge,
  Hand,
  History,
  Hourglass,
  Info,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Lock,
  Menu,
  Minus,
  Monitor,
  Moon,
  OctagonAlert,
  OctagonX,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  PiggyBank,
  Play,
  Radar,
  Receipt,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Search,
  Server,
  ServerCog,
  ServerCrash,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Square,
  StickyNote,
  Sun,
  Tag,
  Terminal,
  Timer,
  TimerOff,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Undo2,
  Unplug,
  Wallet,
  WrapText,
  X,
  Zap,
  Activity,
  ArrowDownToLine,
  Bot,
  Briefcase,
  ChevronsDownUp,
  ChevronsUpDown,
  DoorOpen,
  EyeOff,
  FileText,
  GitBranch,
  GitCompare,
  Globe,
  Grid2x2,
  HardDrive,
  Inbox,
  Layers,
  Link,
  Link2Off,
  Maximize,
  Network,
  Repeat,
  ScrollText,
  Send,
  Settings2,
  Shapes,
  ShipWheel,
  SquareDot,
  SquareMinus,
  SquarePlus,
  Table2,
  Unlink,
  UserRound,
  Waypoints,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import type { Status } from "./types";

/**
 * components.md 13절의 lucide 아이콘 이름.
 * `tilde`는 lucide-react 1.x 에 없어 `EqualApproximately`(≈ 모양)로 대체했다.
 */
const ICONS = {
  // 상태
  "circle-check": CircleCheck,
  "triangle-alert": TriangleAlert,
  "octagon-x": OctagonX,
  "circle-help": CircleHelp,
  "clock-alert": ClockAlert,
  // 셸
  radar: Radar,
  menu: Menu,
  "layout-dashboard": LayoutDashboard,
  server: Server,
  boxes: Boxes,
  box: Box,
  "bell-ring": BellRing,
  database: Database,
  "circle-dollar-sign": CircleDollarSign,
  lightbulb: Lightbulb,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  unplug: Unplug,
  "flask-conical": FlaskConical,
  // 비용
  calculator: Calculator,
  receipt: Receipt,
  "trending-up": TrendingUp,
  "building-2": Building2,
  zap: Zap,
  // 어드바이저
  sparkles: Sparkles,
  ruler: Ruler,
  "piggy-bank": PiggyBank,
  "life-buoy": LifeBuoy,
  gauge: Gauge,
  shield: Shield,
  "shield-alert": ShieldAlert,
  "octagon-alert": OctagonAlert,
  info: Info,
  hand: Hand,
  play: Play,
  square: Square,
  eye: Eye,
  history: History,
  // 어드바이저 실패 사유 (architecture-advisor.md 2.4)
  "key-round": KeyRound,
  "timer-off": TimerOff,
  "file-warning": FileWarning,
  wallet: Wallet,
  "rotate-ccw": RotateCcw,
  // 공통
  search: Search,
  x: X,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  copy: Copy,
  check: Check,
  minus: Minus,
  ban: Ban,
  pause: Pause,
  tilde: EqualApproximately,
  timer: Timer,
  hourglass: Hourglass,
  settings: Settings,
  /** 컨트롤 플레인(마스터 노드) 표시용 중립 칩 아이콘 (status.md 1.3, kops-support) */
  "server-cog": ServerCog,
  "server-crash": ServerCrash,
  "external-link": ExternalLink,
  "refresh-cw": RefreshCw,
  "chevrons-right": ChevronsRight,
  // AWS 스냅샷 (components.md 13절, aws-snapshot-manager)
  archive: Archive,
  tag: Tag,
  "trash-2": Trash2,
  "undo-2": Undo2,
  pencil: Pencil,
  save: Save,
  terminal: Terminal,
  folder: Folder,
  "file-x": FileX,
  /** lucide 1.x 이름은 `file-question-mark` (디자인 문서의 `file-question`과 같은 모양) */
  "file-question": FileQuestionMark,
  "file-pen": FilePen,
  "sticky-note": StickyNote,
  "wrap-text": WrapText,
  lock: Lock,
  // Kubernetes 스냅샷 (components.md 13절, k8s-snapshot)
  "git-compare": GitCompare,
  "square-plus": SquarePlus,
  "square-minus": SquareMinus,
  "square-dot": SquareDot,
  "eye-off": EyeOff,
  "ship-wheel": ShipWheel,
  "link-2-off": Link2Off,
  globe: Globe,
  layers: Layers,
  "file-text": FileText,
  "chevrons-up-down": ChevronsUpDown,
  "chevrons-down-up": ChevronsDownUp,
  "settings-2": Settings2,
  bot: Bot,
  "git-branch": GitBranch,
  // 3D 구성도 (components.md 13절, snapshot-3d)
  "table-2": Table2,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  maximize: Maximize,
  "circle-dashed": CircleDashed,
  unlink: Unlink,
  "chevron-up": ChevronUp,
  waypoints: Waypoints,
  /** 사용자 지정 리소스 (snapshot-3d.md 7.4) */
  shapes: Shapes,
  // 3D 종류 아이콘 (components.md 13절 · snapshot-3d.md 4.10 · KindIcon 16.12)
  "hard-drive": HardDrive,
  network: Network,
  "door-open": DoorOpen,
  "grid-2x2": Grid2x2,
  briefcase: Briefcase,
  "user-round": UserRound,
  "scroll-text": ScrollText,
  link: Link,
  // 알림·로그·설정 (components.md 13절, alerts·logs 2026-09-25)
  /** 사이드바 `알림` — `bell` 계열은 `이벤트`(bell-ring)와 20px 에서 갈리지 않는다 */
  inbox: Inbox,
  send: Send,
  repeat: Repeat,
  activity: Activity,
  "arrow-down-to-line": ArrowDownToLine,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export type IconSize = 10 | 12 | 14 | 16 | 20 | 24 | 40;

export const STATUS_ICON: Record<Status, IconName> = {
  ok: "circle-check",
  warn: "triangle-alert",
  crit: "octagon-x",
  unknown: "circle-help",
  stale: "clock-alert",
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** 있으면 스크린리더가 읽는다(role=img). 없으면 장식(aria-hidden). */
  title?: string;
  className?: string;
}

/** lucide 아이콘. 색은 currentColor(부모 글자색)를 따른다. */
export function Icon({ name, size = 16, title, className }: IconProps) {
  const Cmp = ICONS[name];
  // components.md 13절: 선 굵기 2px, 12·14px는 2.25px
  const strokeWidth = size <= 14 ? 2.25 : 2;
  if (title) {
    return (
      <Cmp
        width={size}
        height={size}
        strokeWidth={strokeWidth}
        className={className}
        role="img"
        aria-label={title}
        focusable="false"
      />
    );
  }
  return (
    <Cmp
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
