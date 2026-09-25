import { describe, expect, it } from "vitest";

import { detailData, FINDINGS, SNAP_ITEMS, snapshotSummary } from "../__fixtures__/snapshots";
import { applyBatch, initialStreamState } from "../stream/reducer";
import { toBadgeScenarios } from "../shell/mock-scenarios";
import {
  atExportCompareText,
  countsPair,
  deltaPair,
  fileTabs,
  filterItems,
  folderRows,
  formatSize,
  indentUnitOf,
  isSnapshotId,
  markersFor,
  notesSecretText,
  parseSortParam,
  parseStatusParam,
  rescanText,
  saveResultView,
  scopeSummary,
  snapshotTimeLabel,
  sortItems,
  sortParam,
  sourceUnknownView,
  toScanFindings,
  writeBlockBanner,
} from "./model";

describe("스냅샷 ID·시각", () => {
  it("ID 는 YYYYMMDD-HHmmss 만 허용한다 (경로 탐색 문자 거부)", () => {
    expect(isSnapshotId("20260919-031500")).toBe(true);
    for (const bad of ["..", "../x", "2026091-031500", "20260919-031500/", "%2e%2e", "20260919-031500\u0000", "trash"]) {
      expect(isSnapshotId(bad)).toBe(false);
    }
  });

  it("오늘이어도 날짜를 붙이고, 올해가 아니면 연도를 붙인다 (status.md 9.4)", () => {
    const iso = new Date(2026, 8, 19, 12, 15).toISOString();
    expect(snapshotTimeLabel(iso, "x", new Date(2026, 8, 19, 13, 0))).toBe("9월 19일 12:15");
    expect(snapshotTimeLabel(iso, "x", new Date(2027, 0, 1))).toBe("2026년 9월 19일 12:15");
    expect(snapshotTimeLabel(null, "20261399-000000")).toBe("20261399-000000");
  });
});

describe("목록 표시 문구", () => {
  it("범위 요약: 필터 + 서비스 앞 3개 + 외 N개", () => {
    expect(scopeSummary(SNAP_ITEMS[1].scope)).toBe("필터 prod.k8s.example.com · 제외 SecretsManager, SSM, Lambda 외 1개");
    expect(scopeSummary({ searchFilter: null, regexFilter: null, services: { mode: "include", list: ["EKS"] } })).toBe("필터 없음 · 포함 EKS");
    expect(scopeSummary(null)).toBe("—");
  });

  it("리소스 수·직전 대비: 부호는 U+2212, 0 은 0, 이전 없음은 -", () => {
    expect(countsPair({ cloudformation: 42, terraform: null })).toBe("42 / —");
    expect(deltaPair({ cloudformation: -18, terraform: 0 })).toBe("−18 / 0");
    expect(deltaPair({ cloudformation: 5, terraform: null })).toBe("+5 / —");
    expect(deltaPair(null)).toBe("-");
  });

  it("파일 크기는 1024 기준", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(49357)).toBe("48.2 KB");
    expect(formatSize(5242880)).toBe("5 MB");
    expect(formatSize(null)).toBe("—");
  });
});

describe("필터·정렬 (서버 상태를 다시 계산하지 않음)", () => {
  it("상태·리전·라벨/메모 검색(대소문자 무시)", () => {
    expect(filterItems(SNAP_ITEMS, { status: ["crit"], regions: [], q: "" }).map((i) => i.id)).toEqual(["20260919-031500", "20260912-020000"]);
    expect(filterItems(SNAP_ITEMS, { status: [], regions: ["us-east-1"], q: "" }).map((i) => i.id)).toEqual(["20260918-120000"]);
    expect(filterItems(SNAP_ITEMS, { status: [], regions: [], q: "kops 1.31" }).map((i) => i.id)).toEqual(["20260912-020000"]);
    expect(filterItems(SNAP_ITEMS, { status: [], regions: [], q: "M6I.LARGE" }).map((i) => i.id)).toEqual(["20260912-020000"]);
  });

  it("기본 최신순, 상태 정렬은 나쁜 순 다음 최신순", () => {
    const shuffled = [SNAP_ITEMS[3], SNAP_ITEMS[0], SNAP_ITEMS[2], SNAP_ITEMS[1]];
    expect(sortItems(shuffled, parseSortParam(null)).map((i) => i.id)).toEqual(SNAP_ITEMS.map((i) => i.id));
    expect(sortItems(shuffled, parseSortParam("status:desc")).map((i) => i.id)).toEqual([
      "20260919-031500",
      "20260912-020000",
      "20260918-120000",
      "20260919-045500",
    ]);
    expect(sortParam({ columnId: "snapshot", dir: "desc" })).toBeNull();
    expect(parseStatusParam("crit,bogus,warn")).toEqual(["crit", "warn"]);
  });
});

describe("스캔 발견 → 목록·편집기", () => {
  it("템플릿·매핑 발견만 이동 가능, metadata 는 안내 문구", () => {
    const f = toScanFindings(FINDINGS);
    expect(f.map((x) => x.navigable)).toEqual([true, true, true, false]);
    expect(f[3].hint).toContain("metadata.json은 대시보드에서 편집할 수 없습니다");
    expect(f[0].description).toBe(FINDINGS[0].message);
  });

  it("여백 표시는 파일별, 한 줄 여러 발견이면 가장 나쁜 등급", () => {
    const m = markersFor(
      [...FINDINGS, { file: "terraform.tf", fileKind: "terraform", line: 4, rule: "env-block", severity: "error", message: "x" }],
      "terraform",
    );
    expect(m.map((x) => [x.line, x.level, x.items.length])).toEqual([
      [2, "error", 1],
      [4, "error", 2],
    ]);
  });

  it("파일 탭: 발견 최악 등급·개수, 매핑 보기 전용, 없는 파일, 저장 안 됨", () => {
    const d = detailData();
    const files = d.files.map((f) => (f.kind === "mapping" ? { ...f, exists: false } : f));
    const tabs = fileTabs(files, FINDINGS, "terraform");
    expect(tabs.map((t) => t.label)).toEqual(["cloudformation.yml", "terraform.tf", "logical-id-mapping.json"]);
    expect(tabs[0]).toMatchObject({ status: "crit", count: 1 });
    expect(tabs[1]).toMatchObject({ status: "crit", count: 2, dirty: true });
    expect(tabs[2]).toMatchObject({ suffix: "파일 없음", suffixTone: "crit" });
    expect(fileTabs(d.files, [], null)[2].suffix).toBe("보기 전용");
  });

  it("들여쓰기 단위", () => {
    expect(indentUnitOf({ style: "tabs", size: null })).toBe("\t");
    expect(indentUnitOf({ style: "spaces", size: 4 })).toBe("    ");
    expect(indentUnitOf(null)).toBe("  ");
  });
});

describe("저장 결과·확인 문구", () => {
  it("재스캔 문구는 값이 같아도 → 로 보인다", () => {
    expect(rescanText({ errors: 2, warnings: 1 }, { errors: 1, warnings: 1 })).toBe("재스캔: 오류 2 → 1, 경고 1 → 1");
  });

  it("저장 후 상태별 알림: 오류 남음(커밋 금지), strict 경고, 경고만, 깨끗함", () => {
    expect(saveResultView({ errors: 1, warnings: 0, strict: false })).toMatchObject({ tone: "crit" });
    expect(saveResultView({ errors: 1, warnings: 0, strict: false }).title).toContain("커밋 금지");
    expect(saveResultView({ errors: 0, warnings: 1, strict: true }).title).toContain("strict");
    expect(saveResultView({ errors: 0, warnings: 1, strict: false })).toEqual({ tone: "warn", title: "저장했습니다 · 검토할 경고 1건" });
    expect(saveResultView({ errors: 0, warnings: 0, strict: false })).toEqual({ tone: "ok", title: "저장했습니다" });
  });

  it("내보내기 당시 대비", () => {
    expect(atExportCompareText({ errors: 3, warnings: 1 }, { errors: 2, warnings: 1 })).toBe("내보내기 당시 오류 3 · 경고 1 → 지금 오류 2 · 경고 1");
    expect(atExportCompareText({ errors: 2, warnings: 1 }, { errors: 2, warnings: 1 })).toBe("내보내기 당시와 같음");
    expect(atExportCompareText(null, { errors: 0, warnings: 0 })).toBe("내보내기 당시 기록 없음");
  });

  it("라벨·메모 비밀값 거부는 규칙 ID·필드만 (값 원문 없음)", () => {
    const r = notesSecretText({
      statusCode: 422,
      code: "SNAPSHOT_NOTES_SECRET_DETECTED",
      message: "x",
      details: { fields: ["memo"], rules: ["url-credentials"] },
      path: "/",
      timestamp: "",
    });
    expect(r).toEqual({ text: "규칙: url-credentials (메모)", fields: ["memo"] });
  });
});

describe("폴더 내용·쓰기 불가·출처", () => {
  it("알려진 파일 → 라벨·메모 → raw → 예상 밖(이름순)", () => {
    const rows = folderRows(detailData({ notes: { label: "a", memo: null, updatedAt: null, version: "v", fileExists: true } }));
    expect(rows.map((r) => [r.name, r.mark])).toEqual([
      ["cloudformation.yml", null],
      ["terraform.tf", null],
      ["logical-id-mapping.json", null],
      ["metadata.json", null],
      ["notes.json", "notes"],
      ["raw-data.json", "raw"],
      ["notes.txt", "unexpected"],
    ]);
  });

  it("쓰기 불가 Banner 는 읽기 전용·쓰기 꺼짐만", () => {
    expect(writeBlockBanner({ allowed: false, reasonCode: "READ_ONLY", reasonText: "x" })?.title).toBe("스냅샷 폴더가 읽기 전용입니다");
    expect(writeBlockBanner({ allowed: false, reasonCode: "WRITE_DISABLED", reasonText: "x" })?.title).toBe("쓰기 기능이 꺼져 있습니다");
    expect(writeBlockBanner({ allowed: false, reasonCode: "EXPORT_MAYBE_IN_PROGRESS", reasonText: "x" })).toBeNull();
    expect(writeBlockBanner({ allowed: true, reasonCode: null, reasonText: null })).toBeNull();
  });

  it("출처 설정 없음·폴더 없음은 UnknownState", () => {
    const nc = snapshotSummary({ root: { configured: false, displayPath: null, state: "not_configured", setup: null } });
    expect(sourceUnknownView(nc)?.reason).toBe("스냅샷 폴더가 설정되지 않았습니다");
    const un = snapshotSummary({
      root: {
        configured: true,
        displayPath: "/data",
        state: "unavailable",
        setup: { envVar: "AWS_SNAPSHOT_DIR", dockerMount: "a:b", localExample: "c", reasonText: "스냅샷 폴더를 찾을 수 없습니다: /data" },
      },
    });
    expect(sourceUnknownView(un)).toEqual({ reason: "스냅샷 폴더를 찾을 수 없습니다", detail: "스냅샷 폴더를 찾을 수 없습니다: /data" });
    expect(sourceUnknownView(snapshotSummary())).toBeNull();
  });
});

// 사이드바 "스냅샷" 메뉴는 k8s-snapshot 이후 `snapshot-menu` 토픽(AWS+k8s 합산)으로 그린다 → features/k8s-snapshots/model.test.ts

describe("MOCK 배지 시나리오 그룹", () => {
  it("snapshots 그룹(AWS 스냅샷)도 배지 Popover 에 넘긴다", () => {
    const s = toBadgeScenarios([
      {
        id: "snapshots",
        label: "AWS 스냅샷",
        active: "default",
        options: [
          { id: "default", label: "예시 스냅샷 (기본)", description: "" },
          { id: "conflict-once", label: "다음 저장 충돌", description: "" },
        ],
      },
    ]);
    expect(s).toEqual([
      { id: "default", label: "예시 스냅샷 (기본)", group: "snapshots", active: true },
      { id: "conflict-once", label: "다음 저장 충돌", group: "snapshots", active: false },
    ]);
  });
});

describe("스트림 리듀서 aws-snapshots", () => {
  const ev = (type: string, payload: unknown, seq: number) => ({
    type,
    envelope: { seq, topic: "aws-snapshots" as const, emittedAt: "", payload },
    receivedAt: 1,
  });

  it("snapshot 은 요약 교체 + resetSeq, changed 는 한 프레임에 여러 개여도 ID 별 카운터를 남긴다", () => {
    const summary = snapshotSummary();
    const s = applyBatch(initialStreamState, [
      ev("aws-snapshots.snapshot", { revision: 1, summary }, 1),
      ev("aws-snapshots.changed", { revision: 2, changedIds: ["a"], removedIds: [], trashChanged: false, summary }, 2),
      ev("aws-snapshots.changed", { revision: 3, changedIds: ["b"], removedIds: ["c"], trashChanged: true, summary }, 3),
    ]);
    expect(s.snapshots).toMatchObject({ revision: 3, seq: 3, resetSeq: 1, trashSeq: 3 });
    expect(s.snapshots?.changed).toEqual({ a: 2, b: 3 });
    expect(s.snapshots?.removed).toEqual({ c: 3 });
    expect(s.snapshotAt["aws-snapshots"]).toBe(1);
  });
});
