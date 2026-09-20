/**
 * 3D 보기 URL 쿼리(`g` 접두사, 3D-D 2.2)와 관계 규칙 목록.
 *
 * 상세 화면의 `useDetailQuery` 가 이 파일만 import 한다 — 3D 를 열지 않은 페이지가
 * 3D 코드·UI 번들을 끌어오지 않게 하기 위해서다(AC-3D01).
 */
import type { RuleId } from "./types";

// ---------------------------------------------------------------- 쿼리 (3D-D 2.2)

export const GRAPH_VIEW_ID = "3d";
export type GraphView = "3d" | "table";
export type LabelDensity = "all" | "selected" | "off";
export type MarkFilter = "drift" | "scan" | "ghost";

export const ALL_RULES: RuleId[] = ["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10", "K11"];
/** 기본 켬 집합 (3D-D 4.6). `grel` 이 없으면 이 값 */
export const DEFAULT_RULES: RuleId[] = ["K1", "K2", "K3", "K4", "K5", "K6", "K7"];

export const isRuleId = (v: string): v is RuleId => (ALL_RULES as string[]).includes(v);
export const isMarkFilter = (v: string): v is MarkFilter => v === "drift" || v === "scan" || v === "ghost";

export const parseCsv = (v: string | null | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const joinCsv = (v: readonly string[]): string | null => (v.length > 0 ? v.join(",") : null);

export const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v) => b.includes(v));

/** 3D 전용 쿼리(`g` 접두사). `grel: null` = 기본 켬 집합 */
export interface GraphQuery {
  gview: GraphView | null;
  gns: string[];
  gkind: string[];
  grel: RuleId[] | null;
  gmark: MarkFilter[];
  gq: string;
  glabels: LabelDensity | null;
  gfocus: boolean;
  gdrift: boolean;
}

export const EMPTY_GRAPH_QUERY: GraphQuery = {
  gview: null,
  gns: [],
  gkind: [],
  grel: null,
  gmark: [],
  gq: "",
  glabels: null,
  gfocus: false,
  gdrift: true,
};

export const activeRules = (q: GraphQuery): RuleId[] => q.grel ?? DEFAULT_RULES;

/**
 * "필터를 건 상태"인가 (3D-D 4.4 개수 문구·6.1 [필터 초기화]).
 * 기본 켬 집합 그대로면 필터로 세지 않는다 — 기본 상태에서 `33개 중 27개`로 보이면 사용자가 필터를 건 것으로 오해한다.
 */
export function isFiltered(q: GraphQuery): boolean {
  return (
    q.gns.length > 0 ||
    q.gkind.length > 0 ||
    q.gmark.length > 0 ||
    q.gq.trim().length > 0 ||
    q.gfocus ||
    (q.grel !== null && !sameSet(q.grel, DEFAULT_RULES))
  );
}

