/*
 * components.md 16.12 / snapshot-3d.md 4.10 · status.md 11.6.
 *
 * 쿠버네티스 **종류 이름 → lucide 아이콘** 매핑의 **코드 단일 출처**다.
 * 이 표를 다른 파일(프론트 `graph/*`, 표·패널·범례)에 복제하지 않는다 — 표가 두 벌이면 어긋난다.
 * 새 종류가 생기면 `snapshot-3d.md` 4.10에 줄을 먼저 넣고 여기에 더한다.
 *
 * 규칙:
 *  - 색은 층 5가지뿐이라(5.2) 같은 층 안의 종류는 **아이콘으로만** 갈린다.
 *  - 표식 아이콘 집합(`octagon-x`·`triangle-alert`·`square-dot`/`-minus`/`-plus`·`eye-off`·
 *    `file-warning`·`ship-wheel`·`circle-dashed`·`file-question`)과 **겹치는 글리프를 쓰지 않는다**(11.6).
 *  - 모르는 종류에도 자리를 비우지 않는다(대체 `box`). 빈 자리는 "깨졌다"로 읽힌다.
 *  - 아이콘은 혼자 서지 않는다 → 언제나 `aria-hidden`. 종류는 옆 글자·툴팁으로 읽힌다.
 */
import { Icon, type IconName } from "../icons";
import type { VizLayer } from "./viz";

/** 판(네임스페이스·클러스터 범위·해석 실패·유령) 아이콘 — `PlateLabel`·관계 표 판 그룹 행 */
export type KindIconPlate = "namespace" | "cluster" | "unparsed" | "ghost";

/** 대체 아이콘. 모르는 종류도 빈 자리를 두지 않는다 (4.10) */
export const FALLBACK_KIND_ICON: IconName = "box";

/** `custom: true`(사용자 지정 리소스)는 종류 이름과 무관하게 이 아이콘이다 */
export const CUSTOM_KIND_ICON: IconName = "shapes";

/** snapshot-3d.md 4.10 표 (k8s 종류 23줄). 키는 `blocks[].kind` 원문 */
export const KIND_ICON: Record<string, IconName> = {
  // 워크로드
  Deployment: "boxes",
  StatefulSet: "database",
  DaemonSet: "grid-2x2",
  CronJob: "timer",
  Job: "briefcase",
  ReplicaSet: "copy",
  Pod: "box",
  // 서비스 · 진입
  Service: "network",
  Ingress: "door-open",
  // 저장·설정
  PersistentVolumeClaim: "hard-drive",
  // PV는 PVC와 같은 아이콘. 둘은 언제나 다른 판(네임스페이스 / 클러스터 범위)에 있어 위치·이름으로 갈린다(11.6)
  PersistentVolume: "hard-drive",
  ConfigMap: "settings-2",
  Secret: "key-round",
  // 곁
  HorizontalPodAutoscaler: "trending-up",
  PodDisruptionBudget: "life-buoy",
  NetworkPolicy: "shield",
  ServiceAccount: "user-round",
  Role: "scroll-text",
  ClusterRole: "scroll-text",
  RoleBinding: "link",
  ClusterRoleBinding: "link",
  ResourceQuota: "gauge",
  LimitRange: "ruler",
  CustomResourceDefinition: "shapes",
  // 판 그 자체 (블록이 아니라 판·표 그룹 행에서 쓴다)
  Namespace: "folder",
};

/** snapshot-3d.md 4.10 표 (판 4줄) */
export const PLATE_ICON: Record<KindIconPlate, IconName> = {
  namespace: "folder",
  cluster: "globe",
  unparsed: "file-warning",
  ghost: "circle-dashed",
};

/**
 * 종류 이름 → 아이콘 이름. 컴포넌트를 쓸 수 없는 자리(three.js 재질·텍스처, 다른 컴포넌트의 `icon` prop)를 위해
 * 이름만 돌려준다. **매핑을 읽는 곳은 이 함수와 `KindIcon` 둘뿐이다.**
 */
export function kindIconName(kind?: string | null, custom?: boolean): IconName {
  if (custom) return CUSTOM_KIND_ICON;
  if (!kind) return FALLBACK_KIND_ICON;
  return KIND_ICON[kind] ?? FALLBACK_KIND_ICON;
}

/** 판 종류 → 아이콘 이름 */
export function plateIconName(plate: KindIconPlate): IconName {
  return PLATE_ICON[plate];
}

export interface KindIconProps {
  /** `blocks[].kind` 원문(`Deployment`). 비어 있으면 `box` */
  kind?: string | null;
  /** `blocks[].custom`. true 면 `kind` 와 무관하게 `shapes` */
  custom?: boolean;
  /** 판 아이콘이 필요할 때. `kind` 보다 먼저 본다 */
  plate?: KindIconPlate;
  /** 블록 윗면·묶음 블록 16 / 패널·표 14(기본) / 범례 12 */
  size?: 12 | 14 | 16;
  className?: string;
}

/**
 * 종류 아이콘. **언제나 장식(`aria-hidden`)** 이다 — 종류 이름이 옆에 글자로 있거나 툴팁(`Deployment · api`)이 있다.
 * 색은 부모 글자색(currentColor)을 따른다: 패널·표는 `text.secondary`, 블록 윗면은 `viz.kind.*.onFill`.
 * 2단계(AWS 구성도)에서 같은 컴포넌트에 AWS 리소스 타입 매핑을 더한다(그래서 prop 이름이 `kind` 다).
 */
export function KindIcon({ kind, custom, plate, size = 14, className }: Readonly<KindIconProps>) {
  const name = plate ? plateIconName(plate) : kindIconName(kind, custom);
  return <Icon name={name} size={size} className={className} />;
}

/* ───────────────────────── 종류 → 3D 블록 모양 (components.md 16.12 / snapshot-3d.md 4.11.2) ─────────────────────────
 *
 * 아이콘 표와 **같은 파일**에 둔다. 표가 둘로 갈리면 "아이콘은 Job인데 모양은 CronJob" 같은 어긋남이 생긴다.
 * 쓰는 쪽은 둘이다 — 프론트의 three.js 지오메트리(features 아래 `graph`)와 퍼블리셔의 `ShapeSwatch`(16.13).
 *
 * 규칙(4.11.0):
 *  - 모양은 **종류**를 뜻하고 **상태를 뜻하지 않는다**(status.md 11.1). 유령·드리프트·스캔은 모양을 바꾸지 않는다.
 *  - 모든 모양이 같은 봉투(4u × 3u × 4u, 상단 평면 3u)를 쓴다. 발자국·앵커·카메라 계산이 그대로다.
 *  - 모르는 종류는 비우지 않고 기본형 `box` 다 — `box` 는 "이 다섯(또는 하나)이 아닌 것"이라는 뜻을 가진 자리다.
 */

/** 3D 블록 모양 9종 (8종 + 곁 타일). snapshot-3d.md 4.11.1 */
export type VizShape = "box" | "stack" | "cylinder" | "panel" | "roof" | "chamfer" | "gate" | "diamond" | "tile";

/** 기본형. 모르는 종류·런타임 산물(Pod·ReplicaSet)·곁이 아닌 층의 사용자 지정 리소스가 모두 여기로 온다 */
export const FALLBACK_KIND_SHAPE: VizShape = "box";

/** 곁 층(`layer === "aux"`)은 종류와 무관하게 곁 타일이다 — 높이 0.75u = 화면 3.5px이라 윤곽으로 나눌 여지가 없다 */
export const AUX_KIND_SHAPE: VizShape = "tile";

/** snapshot-3d.md 4.11.2 표. 키는 `blocks[].kind` 원문 */
export const KIND_SHAPE: Record<string, VizShape> = {
  // 워크로드 (Pod·ReplicaSet·그 밖은 기본형 `box`)
  Deployment: "stack",
  StatefulSet: "cylinder",
  DaemonSet: "panel",
  CronJob: "roof",
  Job: "chamfer",
  // 서비스 · 진입
  Service: "diamond",
  Ingress: "gate",
  // 저장·설정 (PVC·PV 는 같은 드럼 — 언제나 다른 판에 있어 위치·이름으로 갈린다)
  PersistentVolumeClaim: "cylinder",
  PersistentVolume: "cylinder",
  ConfigMap: "panel",
  Secret: "chamfer",
};

/**
 * 종류 → 3D 블록 모양. **매핑을 읽는 곳은 이 함수 하나뿐이다.**
 * `layer` 는 서버가 준 값(`blocks[].layer`)을 그대로 넘긴다 — 화면이 종류 → 층 표를 따로 갖지 않는다.
 */
export function kindShape(kind?: string | null, opts?: { custom?: boolean; layer?: VizLayer }): VizShape {
  // 곁 층이 먼저다: 곁은 사용자 지정이든 아니든 타일이고, 위치(판 가장자리 띠)와 중립색으로 이미 갈린다
  if (opts?.layer === "aux") return AUX_KIND_SHAPE;
  if (opts?.custom) return FALLBACK_KIND_SHAPE;
  if (!kind) return FALLBACK_KIND_SHAPE;
  return KIND_SHAPE[kind] ?? FALLBACK_KIND_SHAPE;
}
