/*
 * snapshot-3d 1단계 공용 모델 (components.md 16절, snapshot-3d.md 4·5·7절, status.md 11절).
 *
 * 세 가지 축을 섞지 않는다(status.md 11.1):
 *   종류(층) = 블록 면 색 `viz.kind.*`  /  파일 스캔 = 표식 아이콘  /  드리프트 = 중립 표식 아이콘.
 * 여기 있는 값은 모두 **표현용**이다. 관계·드리프트·표식은 서버가 판단한 값을 그대로 그린다.
 */
import { DRIFT_KIND } from "../k8s/drift";
import type { IconName } from "../icons";
import { scanLevelSpec } from "../snapshot/scan";
import type { DriftKind, ScanLevel } from "../types";

/** 서버 `blocks[].layer` 그대로 (snapshot-3d.md 4.2) */
export type VizLayer = "storage" | "workload" | "service" | "ingress" | "aux";
/** 서버 `edges[].certainty` 그대로 */
export type Certainty = "confirmed" | "estimated";
/** 서버 `blocks[].ghost.reason` 그대로 */
export type GhostReason = "not_in_snapshot" | "secret" | "autocreated" | "cluster_scope" | "drift_added";

/** Scene3DFrame 상태 (snapshot-3d.md 9절) */
export type SceneState =
  | "ready"
  | "loadingData"
  | "loadingChunk"
  | "building"
  | "empty"
  | "filteredEmpty"
  | "unsupported"
  | "chunkFailed"
  | "contextLost"
  | "error"
  | "unknown"
  | "stale";

export interface VizLayerSpec {
  key: VizLayer;
  /** 범례·필터 그룹 제목 */
  label: string;
  /** 대표 종류 (범례 caption) */
  example: string;
  /** 대표 종류 이름 — 범례 층 줄의 아이콘 12px 을 `KindIcon` 이 고른다 (snapshot-3d.md 6.5) */
  exampleKind: string;
  /** 배치·정렬 순서 (status.md 11.4: 저장·설정 → 워크로드 → 서비스 → 진입 → 곁) */
  order: number;
}

export const VIZ_LAYER: Record<VizLayer, VizLayerSpec> = {
  storage: {
    key: "storage",
    label: "저장·설정",
    example: "PersistentVolumeClaim 외",
    exampleKind: "PersistentVolumeClaim",
    order: 0,
  },
  workload: { key: "workload", label: "워크로드", example: "Deployment 외", exampleKind: "Deployment", order: 1 },
  service: { key: "service", label: "서비스", example: "Service", exampleKind: "Service", order: 2 },
  ingress: { key: "ingress", label: "진입", example: "Ingress", exampleKind: "Ingress", order: 3 },
  aux: { key: "aux", label: "곁", example: "HPA · PDB 외", exampleKind: "HorizontalPodAutoscaler", order: 4 },
};

export const VIZ_LAYER_ORDER: VizLayer[] = ["storage", "workload", "service", "ingress", "aux"];

/** 유령 사유 기본 문구 (snapshot-3d.md 4.4). 서버 `ghost.text`가 있으면 그 값을 쓴다 */
export const GHOST_REASON_TEXT: Record<GhostReason, string> = {
  not_in_snapshot: "스냅샷에 없음",
  secret: "Secret — 이름만, 값 없음",
  autocreated: "자동 생성 또는 스냅샷에 없음",
  cluster_scope: "클러스터 범위, 스냅샷에 없을 수 있음",
  drift_added: "추가됨",
};

export const GHOST_LABEL = "유령";

/** 확정 / 추정: 색이 아니라 문구 + 아이콘 + 선 모양(실선/대시)으로 구분한다 (status.md 11.2) */
export const CERTAINTY: Record<Certainty, { label: string; icon: IconName; hint: string }> = {
  confirmed: { label: "확정", icon: "check", hint: "확정 관계 (실선)" },
  estimated: { label: "추정", icon: "tilde", hint: "추정 관계 (점선)" },
};

export const OPTIONAL_REF_LABEL = "선택 참조";

/**
 * 범례 맨 아래 상시 문구 (snapshot-3d.md 6.5, status.md 11.1).
 * 2026-09-20 (8): 블록 모양이 **종류**를 뜻하게 되어 첫 줄에 모양을 더했다 — 모양도 상태가 아니다.
 * 같은 문장을 정보 줄 `circle-help` 툴팁 둘째 줄이 함께 쓴다(6.4-9): 범례가 팝오버라 늘 보이지는 않는다.
 */
export const LEGEND_NOTES = [
  "블록 색은 층, 모양은 종류를 뜻합니다. 상태가 아닙니다.",
  "상태·드리프트는 블록 위 아이콘으로 표시합니다.",
] as const;

/** 범례 표식 모양 줄 (status.md 11.5) */
export const PLATE_MARKER_NOTE = "원은 블록, 알약은 판(네임스페이스)입니다.";

/** 보기 안 상시 안내 (snapshot-3d.md 4.5) */
export const NO_EDGE_HINT =
  "선이 없다고 관계가 없는 것은 아닙니다. 이 보기는 규칙 11가지(K1~K11)로 찾은 관계만 그립니다.";

/** 표식 색: 스캔만 상태색, 드리프트·유령·Helm 은 중립 (status.md 11.1) */
export type MarkerTone = "crit" | "warn" | "secondary" | "tertiary";

export interface NoteSpec {
  icon: IconName;
  /** 표 표식 열·패널 칩의 짧은 문구 */
  short: string;
  /** 판 알약·툴팁 문구 */
  label: string;
  /** `count` 가 있을 때 문구를 직접 만든다. 없으면 문구 뒤에 숫자를 붙인다 */
  withCount?: (count: number) => { short: string; label: string };
}

/**
 * 표시 문구(`notes[]`) 코드 → 아이콘·문구 (snapshot-3d.md 7.4, 4.1.1 ⑤, 6.6).
 * 등록되지 않은 code 도 버리지 않는다 — `info` 아이콘 + 서버 `text` 그대로 (6.6 마지막 규칙).
 *
 * `selector_missing`·`no_target`·`pvc_template_unmatched` 는 **관계를 그리지 못한 사유**(7.4 1순위, 아이콘 `unlink`)다.
 * 표식 원(블록 위)은 만들지 않는다 — 선택 패널은 ④ `InlineAlert`, 관계 표는 표식 열 문구로 쓴다.
 * 전문(서버 `text`)은 언제나 `BlockMarkerItem.text`(툴팁·스크린리더)에 남는다.
 */
export const NOTE_SPEC: Record<string, NoteSpec> = {
  selector_missing: { icon: "unlink", short: "셀렉터 없음", label: "셀렉터 없음 (수동 Endpoints·ExternalName)" },
  no_target: { icon: "unlink", short: "대상 없음", label: "대상 없음" },
  pvc_template_unmatched: {
    icon: "unlink",
    short: "맞는 PVC 없음",
    label: "PVC 템플릿 — 맞는 PVC 없음",
    withCount: (n) => ({
      short: `맞는 PVC 없음 (템플릿 ${n.toLocaleString("en-US")})`,
      label: `PVC 템플릿 ${n.toLocaleString("en-US")}개 — 맞는 PVC 없음`,
    }),
  },
  custom_resource: { icon: "shapes", short: "사용자 지정", label: "사용자 지정 리소스" },
  namespace_file_missing: { icon: "file-question", short: "namespace.yaml 없음", label: "namespace.yaml 없음" },
};

export interface BlockNote {
  code: string;
  /** 서버 문구 그대로 */
  text: string;
  count?: number;
}

export interface BlockMarkerSource {
  /** 현재 스캔 발견 (status.md 9.2) */
  scan?: { level: ScanLevel | string; count: number } | null;
  /** 서버 `resources[].change` (같음 `same` 은 표식 없음) */
  drift?: { kind: DriftKind; fieldCount?: number } | null;
  /** 경로 불일치 · 중복 정의 · 런타임 필드 남음 */
  fileIssue?: { code?: string; text: string } | null;
  helm?: boolean;
  /** 비교 불가(`uncomparable`) · 비교 못 함(`skipped`) + 사유 문구 */
  notComparable?: { reason?: string; text: string; kind?: "uncomparable" | "skipped" } | null;
  /** 유령 블록 사유 */
  ghost?: { reason: GhostReason; text?: string } | null;
  /** 파일 문제 밖의 표시 문구(⑤ 정보). `custom_resource`·`namespace_file_missing` 등 */
  notes?: BlockNote[] | null;
  /** 값이 있으면 그 표식만 링크가 된다 (판 알약 클릭 이동, snapshot-3d.md 4.1.1) */
  hrefs?: { scan?: string; drift?: string } | null;
}

export interface BlockMarkerItem {
  key: string;
  icon: IconName;
  tone: MarkerTone;
  /** 표·패널의 짧은 문구 (`변경 2`, `오류 1`, `유령`) */
  short: string;
  /** 판 알약 문구 (`변경 · 필드 1건`, `오류 1`) */
  plate: string;
  /** 툴팁·스크린리더 문구 (`변경됨 · 필드 2건`) */
  text: string;
  /** 있으면 `<a>` 로 그린다 */
  href?: string;
}

/**
 * 표식 목록. **순서 고정**: 스캔 → 드리프트 → 비교 불가 → 파일 문제 → Helm → 유령·정보(notes)
 * (snapshot-3d.md 4.8·4.1.1, 파일 탭 트리와 같은 순서).
 * 블록(원)과 판(알약)이 **같은 순서·같은 문구**를 쓴다. 모양만 다르다(status.md 11.5).
 */
export function blockMarkerItems(src: BlockMarkerSource): BlockMarkerItem[] {
  const items: BlockMarkerItem[] = [];
  const { scan, drift, fileIssue, helm, notComparable, ghost, notes, hrefs } = src;

  if (scan && scan.count > 0) {
    const spec = scanLevelSpec(scan.level);
    const n = scan.count.toLocaleString("en-US");
    items.push({
      key: "scan",
      icon: spec.icon,
      tone: spec.status === "crit" ? "crit" : spec.status === "warn" ? "warn" : "tertiary",
      short: `${spec.label} ${n}`,
      plate: `${spec.label} ${n}`,
      text: `스캔 ${spec.label} ${n}건`,
      href: hrefs?.scan,
    });
  }

  if (drift && drift.kind !== "same") {
    const spec = DRIFT_KIND[drift.kind];
    const fields = drift.fieldCount !== undefined && drift.fieldCount > 0 ? drift.fieldCount : null;
    if (spec.icon) {
      const n = fields ? fields.toLocaleString("en-US") : null;
      items.push({
        key: "drift",
        icon: spec.icon,
        tone: "secondary",
        short: n ? `${spec.short} ${n}` : spec.label,
        plate: n ? `${spec.short} · 필드 ${n}건` : spec.label,
        text: n ? `${spec.label} · 필드 ${n}건` : spec.label,
        href: hrefs?.drift,
      });
    }
  }

  if (notComparable) {
    const skipped = notComparable.kind === "skipped";
    const label = skipped ? "비교 못 함" : "비교 불가";
    items.push({
      key: "notComparable",
      icon: skipped ? "file-warning" : "eye-off",
      tone: skipped ? "warn" : "tertiary",
      short: label,
      plate: label,
      text: notComparable.text,
      href: hrefs?.drift,
    });
  }

  if (fileIssue) {
    items.push({
      key: "fileIssue",
      icon: "file-warning",
      tone: "warn",
      short: fileIssue.text,
      plate: fileIssue.text,
      text: fileIssue.text,
      href: hrefs?.scan,
    });
  }

  if (helm) {
    items.push({ key: "helm", icon: "ship-wheel", tone: "tertiary", short: "Helm", plate: "Helm", text: "Helm 관리" });
  }

  if (ghost) {
    const text = ghost.text ?? GHOST_REASON_TEXT[ghost.reason];
    items.push({
      key: "ghost",
      icon: "circle-dashed",
      tone: "tertiary",
      short: GHOST_LABEL,
      plate: GHOST_LABEL,
      text: `${GHOST_LABEL} · ${text}`,
    });
    // 2026-09-20 변경(snapshot-3d.md 4.4): Secret 유령에 `key-round` 표식을 더하지 않는다.
    // `key-round` 는 Secret 의 **종류 아이콘**(KindIcon, 4.10)이 되어 윗면·패널·표에 이미 있다.
    // 표식으로 한 번 더 두면 같은 아이콘이 한 블록에 두 번 나온다. 사유 문구는 위 `text` 에 그대로 남는다.
  }

  // ⑤ 정보: 파일 문제 밖의 표시 문구. 모르는 code 도 버리지 않고 서버 문구 그대로 보인다(6.6)
  for (const note of notes ?? []) {
    const spec = NOTE_SPEC[note.code];
    const counted = spec?.withCount && note.count !== undefined && note.count > 0 ? spec.withCount(note.count) : null;
    const n = !counted && note.count !== undefined && note.count > 1 ? ` ${note.count.toLocaleString("en-US")}` : "";
    items.push({
      key: `note:${note.code}`,
      icon: spec?.icon ?? "info",
      tone: "tertiary",
      short: counted?.short ?? `${spec?.short ?? note.text}${n}`,
      plate: counted?.label ?? `${spec?.label ?? note.text}${n}`,
      text: note.text,
    });
  }

  return items;
}

/** 블록 위치 문구: 네임스페이스 / 클러스터 범위 / 해석 실패 */
export function blockLocationText(namespace: string | null | undefined, unparsed = false): string {
  if (unparsed) return "해석 실패";
  return namespace ? namespace : "클러스터 범위";
}

/**
 * 선택이 바뀔 때 `aria-live="polite"`로 읽을 한 문장 (snapshot-3d.md 7.1).
 * 카메라 회전·확대는 읽지 않는다(소음). 선택이 바뀔 때만 호출 측이 값을 바꾼다.
 */
export function blockSelectionAnnouncement(block: {
  kind: string;
  name: string;
  namespace?: string | null;
  markers?: BlockMarkerSource;
  incoming?: number;
  outgoing?: number;
}): string {
  const parts: string[] = [`${block.kind} ${block.name}`];
  parts.push(block.namespace ? `${block.namespace} 네임스페이스` : "클러스터 범위");
  for (const m of blockMarkerItems(block.markers ?? {})) parts.push(m.text);
  parts.push(`들어오는 관계 ${(block.incoming ?? 0).toLocaleString("en-US")}개`);
  parts.push(`나가는 관계 ${(block.outgoing ?? 0).toLocaleString("en-US")}개`);
  return parts.join(", ");
}
