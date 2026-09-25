// @vitest-environment jsdom
/**
 * alerts·logs 통합 계층의 **되돌아오기 쉬운 결정**만 고정한다.
 * (컴포넌트 모양은 퍼블리셔 테스트가, 서버 판정은 api 테스트가 덮는다)
 */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isDispatchState, type LogLine } from "@/components/ui";

import { ALERTS_HREF, alertsNavPatch, severityTone, tabTitleWithCount } from "./badge";
import { hasUnknownDispatch, mergeRows, pickNotices, toChipDispatch } from "./model";
import type { AlertGap, AlertRow } from "./types";
import { collectMatches, stepIndex } from "../logs/find";
import { parseWorkloadKey, readLogsQuery } from "../logs/href";
import { redactionRulesOf } from "../logs/RedactionRulesPopover";
import { applyBatch, initialStreamState } from "../stream/reducer";
import { BASE_TOPICS } from "../stream/client";
import type { StreamEnvelope } from "../common/types";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/alerts",
  useSearchParams: () => nav.params,
}));

afterEach(() => {
  cleanup();
  nav.params = new URLSearchParams();
});

let seq = 0;
const ev = (type: string, payload: unknown) => ({
  type,
  envelope: {
    seq: ++seq,
    topic: type.split(".")[0] as StreamEnvelope["topic"],
    emittedAt: new Date().toISOString(),
    payload,
  },
  receivedAt: Date.now(),
});

const row = (patch: Partial<AlertRow> = {}): AlertRow => ({
  id: "a1",
  key: "area:pods",
  area: "pods",
  areaLabel: "파드",
  severity: "critical",
  severityLabel: "장애",
  kind: "transition",
  transition: { from: "ok", to: "critical" },
  reason: { code: "POD_WAITING_CRASHLOOP", text: "CrashLoopBackOff", status: "critical" },
  targets: [{ ref: { kind: "Pod", namespace: "prod", name: "api-1" }, status: "critical", reason: "CrashLoopBackOff", href: "/cluster/pods/prod/api-1" }],
  targetTotal: 2,
  occurredAt: "2026-09-25T14:02:05.000Z",
  lastSeenAt: "2026-09-25T14:12:05.000Z",
  resolvedAt: null,
  durationMs: 1_075_000,
  repeatCount: 2,
  dedupe: { windowMin: 15, lastEventAt: "2026-09-25T14:12:05.000Z" },
  flapping: null,
  suppressedAreas: 0,
  unknownGap: null,
  mitigations: [],
  relatedAlertId: null,
  relation: null,
  restart: null,
  href: "/cluster/pods",
  logHref: "/logs?namespace=prod&pod=api-1",
  logTarget: { ref: { kind: "Pod", namespace: "prod", name: "api-1" }, gone: false, deletedAt: null, stackSearch: false, unavailableReason: null },
  read: false,
  readAt: null,
  dispatch: [{ channel: "discord", state: "skipped_mock", label: "보내지 않음 (mock)", at: null, attempts: 0, responseCode: null, detail: null, nextRetryAt: null }],
  dataSource: "mock",
  createdAt: "2026-09-25T14:02:05.000Z",
  ...patch,
});

const gap = (patch: Partial<AlertGap> = {}): AlertGap => ({
  id: "gap-1",
  from: "2026-09-25T09:12:00.000Z",
  to: "2026-09-25T09:31:00.000Z",
  minutes: 19,
  unknownPrevious: false,
  ...patch,
});

describe("alerts — 배지는 서버 값이고 목록은 전역 상태에 들지 않는다", () => {
  it("`alerts` 토픽은 모든 페이지가 구독한다 (배지·탭 제목)", () => {
    expect(BASE_TOPICS).toContain("alerts");
  });

  it("AC-ALERT37: `alerts.created`를 받아도 리듀서가 항목을 저장하지 않는다 (배지만 갱신)", () => {
    const alert = row();
    const state = applyBatch(initialStreamState, [
      ev("alerts.snapshot", {
        badge: { unreadCount: 3, worstSeverity: "critical", updatedAt: "2026-09-25T14:19:40.000Z" },
        watch: { lastObservedAt: "2026-09-25T14:02:10.000Z", keyCount: 8, keys: [] },
        dispatch: { mode: "mock", modeSource: "data_source", outbound: false },
        persistence: "memory",
        warmup: { active: false, endsAt: null },
        notices: [],
      }),
      ev("alerts.created", { alert, badge: { unreadCount: 4, worstSeverity: "critical", updatedAt: "2026-09-25T14:20:00.000Z" } }),
    ]);
    expect(state.alerts.badge.unreadCount).toBe(4);
    expect(state.alerts.seq).toBe(2);
    // 상태 전체를 문자열로 만들어 항목의 특징 값이 **하나도** 없는지 본다
    const dump = JSON.stringify(state);
    expect(dump).not.toContain("CrashLoopBackOff");
    expect(dump).not.toContain("api-1");
    expect(dump).not.toContain(alert.id);
  });

  it("배지: 0이면 그리지 않고, 끊겨도 0으로 내리지 않는다(마지막 값 + 기준 시각)", () => {
    expect(alertsNavPatch({ unreadCount: 0, worstSeverity: null, updatedAt: null }, true).count).toBeUndefined();
    // 값을 받기 전에는 자리도 비운다
    expect(alertsNavPatch({ unreadCount: 3, worstSeverity: "critical", updatedAt: null }, false).count).toBeUndefined();
    const live = alertsNavPatch({ unreadCount: 3, worstSeverity: "warning", updatedAt: "2026-09-25T14:02:10.000Z" }, true);
    expect(live.count).toBe(3);
    expect(live.countTone).toBe("warn");
    expect(live.countLabel).toBe("안 읽음 3건");
    const down = alertsNavPatch({ unreadCount: 3, worstSeverity: "critical", updatedAt: "2026-09-25T14:02:10.000Z" }, true, true);
    expect(down.count).toBe(3);
    expect(down.countLabel).toMatch(/안 읽음 3건 · \d{2}:\d{2}:\d{2} 기준/);
  });

  it("배지 색은 서버 worstSeverity 를 그대로 옮긴다", () => {
    expect(severityTone("critical")).toBe("crit");
    expect(severityTone("warning")).toBe("warn");
    expect(severityTone("unknown")).toBe("unknown");
  });

  it("탭 제목 `(3) 파드 · Sentinel` — 0이면 접두어 없음, 100건 이상은 `99+`", () => {
    expect(tabTitleWithCount("파드 · Sentinel", 3)).toBe("(3) 파드 · Sentinel");
    expect(tabTitleWithCount("(3) 파드 · Sentinel", 0)).toBe("파드 · Sentinel");
    expect(tabTitleWithCount("Sentinel", 128)).toBe("(99+) Sentinel");
    // 두 번 붙지 않는다
    expect(tabTitleWithCount("(3) Sentinel", 4)).toBe("(4) Sentinel");
  });

  it("알림 메뉴 경로는 `/alerts` 하나뿐이다 (상단바 벨 없음)", () => {
    expect(ALERTS_HREF).toBe("/alerts");
  });
});

describe("alerts — 정지 구간은 어떤 필터로도 사라지지 않는다", () => {
  it("항목이 0건이어도 정지 구간 줄은 남는다", () => {
    expect(mergeRows([], [gap()]).filter((r) => r.type === "gap")).toHaveLength(1);
  });

  it("시각 순으로 섞이고 구간이 끝난 자리에 온다", () => {
    const rows = mergeRows([row({ occurredAt: "2026-09-25T14:02:05.000Z" }), row({ id: "a2", occurredAt: "2026-09-25T08:00:00.000Z" })], [gap()]);
    expect(rows.map((r) => r.type)).toEqual(["item", "gap", "item"]);
  });
});

describe("alerts — 발송 칩은 서버 값이고 모르는 상태에서 터지지 않는다", () => {
  it("컴포넌트가 모르는 `skipped_*`는 칩으로 넘기지 않는다 (틀린 문구를 쓰지 않는다)", () => {
    // 통합 2차: 1차에 예로 쓴 `skipped_no_pair`는 퍼블리셔가 `DISPATCH_SPEC`에 넣었다 → 앞으로 생길 값으로 바꿔 검사한다
    const future = "skipped_future_reason" as AlertRow["dispatch"][number]["state"];
    const item = row({
      dispatch: [
        { channel: "discord", state: future, label: "보내지 않음 (새 사유)", at: null, attempts: 0, responseCode: null, detail: null, nextRetryAt: null },
        { channel: "discord", state: "sent", label: "보냄", at: null, attempts: 1, responseCode: 204, detail: null, nextRetryAt: null },
      ],
    });
    const chips = toChipDispatch(item);
    expect(chips).toHaveLength(1);
    expect(chips[0].state).toBe("sent");
    expect(hasUnknownDispatch(item)).toBe(true);
    // 넘기는 상태는 전부 컴포넌트 표에 있다(있으면 문구가 나온다)
    for (const c of chips) expect(isDispatchState(c.state)).toBe(true);
    // 상속 키에 속지 않는다(`in` 이었으면 칩으로 넘어갔다)
    expect(toChipDispatch(row({ dispatch: [{ ...item.dispatch[1], state: "toString" as AlertRow["dispatch"][number]["state"] }] }))).toHaveLength(0);
  });

  it("퍼블리셔가 넣은 2종(`skipped_no_pair`·`skipped_circuit_open`)은 프론트 변경 없이 칩으로 나간다", () => {
    const item = row({
      dispatch: (["skipped_no_pair", "skipped_circuit_open"] as const).map((state) => ({
        channel: "discord" as const, state, label: "서버 문구", at: null, attempts: 0, responseCode: null, detail: null, nextRetryAt: null,
      })),
    });
    expect(toChipDispatch(item).map((c) => c.state)).toEqual(["skipped_no_pair", "skipped_circuit_open"]);
    expect(hasUnknownDispatch(item)).toBe(false);
  });
});

describe("alerts — 안내 줄", () => {
  it("우선순위대로 최대 2개, 미설정은 warn 이 아니다(오류가 아니다)", () => {
    const picked = pickNotices([
      { code: "ALERTS_DISPATCH_MOCK", level: "info", text: "mock" },
      { code: "ALERTS_DISCORD_NOT_CONFIGURED", level: "info", text: "미설정" },
      { code: "ALERTS_HISTORY_MEMORY_ONLY", level: "warn", text: "DB 없음" },
    ]);
    expect(picked.map((p) => p.notice.code)).toEqual(["ALERTS_HISTORY_MEMORY_ONLY", "ALERTS_DISCORD_NOT_CONFIGURED"]);
    expect(picked[1].tone).toBe("neutral");
  });
});

describe("logs — 링크와 가림 표시", () => {
  // 통합 3차: 화면이 링크를 만드는 함수(`logsHref`·`logsHrefFromPodKey`)를 지웠다 — 링크는 전부 서버 `logHref` 그대로다.
  it("URL 의 `at`·`workload`를 읽는다(서버 링크가 쓰는 이름). 찾기 입력값 자리는 없다", () => {
    const p = new URLSearchParams("namespace=prod&workload=Deployment%2Fprod%2Fapi&follow=1");
    const r = readLogsQuery((k) => p.get(k));
    expect(r.workload).toEqual({ key: "Deployment/prod/api", kind: "Deployment", namespace: "prod", name: "api" });
    expect(r.follow).toBe(true);
    expect(r.at).toBeNull();
    const a = new URLSearchParams("namespace=prod&pod=api-1&at=2026-09-25T14%3A02%3A05.000Z");
    expect(readLogsQuery((k) => a.get(k)).at).toBe("2026-09-25T14:02:05.000Z");
    expect(Object.keys(r)).not.toContain("q");
    expect(parseWorkloadKey("ReplicaSet/prod/api-7f9c")).toBeNull();
    expect(parseWorkloadKey("prod/api")).toBeNull();
  });

  it("서버가 만든 `?namespace=`와 디자인 문구의 `?ns=` 둘 다 읽는다", () => {
    const p1 = new URLSearchParams("namespace=prod&pod=api-1");
    expect(readLogsQuery((k) => p1.get(k)).namespace).toBe("prod");
    const p2 = new URLSearchParams("ns=prod&pod=api-1");
    expect(readLogsQuery((k) => p2.get(k)).namespace).toBe("prod");
  });

  it("가림 팝오버는 `label`만 모으고 규칙 `id`를 화면으로 내보내지 않는다", () => {
    const line: LogLine = {
      id: "q1:1",
      kind: "line",
      segments: [
        { t: "text", v: "postgres://" },
        { t: "masked", v: "ap****(12자)", rules: [{ id: "conn_string", label: "접속 문자열 자격 증명" }], confidence: "high" },
        { t: "text", v: "@db:5432/app" },
        { t: "masked", v: "9f****(40자)", rules: [{ id: "long_opaque", label: "긴 불투명 문자열" }], confidence: "suspect" },
      ],
    };
    const rules = redactionRulesOf(line);
    expect(rules.map((r) => r.label)).toEqual(["접속 문자열 자격 증명", "긴 불투명 문자열"]);
    expect(JSON.stringify(rules)).not.toContain("conn_string");
    expect(JSON.stringify(rules)).not.toContain("long_opaque");
    expect(rules[1].confidence).toBe("suspect");
  });
});

describe("로그 화면 안에서 찾기 (RL5)", () => {
  const line = (id: string, text: string): LogLine => ({ id, kind: "line", segments: [{ t: "text", v: text }] });
  const lines = [line("a", "GET /healthz 200"), line("b", "POST /orders 500 . done"), line("c", "GET /healthz 200 GET")];

  it("글자 그대로 찾고(정규식 아님) 줄 순서대로 모든 일치를 편다", () => {
    expect(collectMatches(lines, "GET")).toEqual([
      { lineId: "a", index: 0 },
      { lineId: "c", index: 0 },
      { lineId: "c", index: 1 },
    ]);
    // `.`은 마침표만 찾는다
    expect(collectMatches(lines, ".")).toEqual([{ lineId: "b", index: 0 }]);
    expect(collectMatches(lines, "")).toEqual([]);
  });

  it("`Enter`(+1)·`Shift+Enter`(-1)는 끝에서 처음으로 돈다", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

// 설정 화면(P2) 테스트는 `features/settings/settings.test.tsx`로 옮겼다(통합 2차). 1차의 "자리만" 검사는 더 이상 맞지 않는다.
