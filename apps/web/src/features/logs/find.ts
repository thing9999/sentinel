/**
 * 로그 "화면 안에서 찾기" (docs/design/logs.md 6.3·12절). 순수 함수만 둔다.
 * 찾은 줄로 옮기는 스크롤은 `LogLineList`가 `currentMatch`로 직접 한다(통합 3차에 `revealLine`을 지웠다).
 *
 * - 글자 그대로 찾는다(정규식 아님 — `findMatches`). 서버로 보내지 않는다(`direct`는 서버 검색이 없다).
 * - 찾기 입력값은 여기 어디에도 저장하지 않는다(명세 3.3.4). 호출 측 `useState`에만 있다.
 */
import { findMatches, lineText, type LogLine } from "@/components/ui";

export type Match = { lineId: string; index: number };

/** 화면 안에서 찾기 — 글자 그대로 일치(정규식 아님, `findMatches`). 줄 순서대로 모든 일치를 편다 */
export function collectMatches(lines: LogLine[], query: string): Match[] {
  if (!query) return [];
  const out: Match[] = [];
  for (const l of lines) {
    const hits = findMatches(lineText(l), query);
    for (let i = 0; i < hits.length; i += 1) out.push({ lineId: l.id, index: i });
  }
  return out;
}

/** 다음(+1)·이전(-1) 일치의 순번. 끝에서 처음으로 돈다 */
export function stepIndex(current: number, delta: number, total: number): number {
  return total === 0 ? 0 : (((current + delta) % total) + total) % total;
}
