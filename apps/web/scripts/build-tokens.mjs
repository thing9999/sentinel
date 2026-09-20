#!/usr/bin/env node
/**
 * docs/design/tokens.json -> apps/web/src/styles/tokens.css
 *
 * 단일 출처는 tokens.json 이다. tokens.css 는 직접 고치지 말고 이 스크립트로 다시 만든다.
 *   npm run tokens --prefix apps/web
 *   node apps/web/scripts/build-tokens.mjs --check   (생성 결과가 파일과 다르면 exit 1)
 *
 * 이름 규칙 (tokens.json $meta.cssVariableNaming 기준)
 * - 경로를 '-'로 잇고 camelCase 는 kebab-case 로 바꾼다. 소수점 키(0.5)는 '-'(0-5)로 바꾼다.
 *   color.light.bg.surfaceRaised -> --color-bg-surface-raised
 *   spacing.0.5                  -> --spacing-0-5
 *   zIndex.banner                -> --z-index-banner
 * - color.<theme>.*, shadow.<theme>.* 는 테마 블록으로 나눈다.
 * - typography.<name> -> --font-<name>-size / -line / -weight / -letter-spacing (+ -family)
 *   와 font 단축 속성용 --font-<name> ("<weight> <size>/<line> <family>").
 *   typography.fontFamily.sans -> --font-family-sans, typography.numeric -> --font-numeric
 * - 배열은 -0, -1 ... 로 푼다 (color.chart.series -> --color-chart-series-0..7).
 * - "$" 로 시작하는 키($meta, $reason, $description)는 변수로 만들지 않는다.
 * - prefers-reduced-motion: reduce 이면 --motion-duration-* 를 0ms 로 덮는다 (motion.$reason).
 *   예외: --motion-duration-status-highlight (status.md 1.6, 외곽선은 페이드 없이 2000ms 표시)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const SRC = resolve(webRoot, "../../docs/design/tokens.json");
const OUT = resolve(webRoot, "src/styles/tokens.css");

const THEMES = ["light", "dark"];

const kebab = (key) =>
  String(key)
    .replace(/\./g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

const isMeta = (key) => String(key).startsWith("$");

/** 객체를 평탄화해 [이름, 값] 목록으로 만든다. */
function flatten(value, path, out) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, [...path, String(i)], out));
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (isMeta(k)) continue;
      flatten(v, [...path, kebab(k)], out);
    }
    return out;
  }
  out.push([`--${path.join("-")}`, String(value)]);
  return out;
}

function typographyVars(typography) {
  const out = [];
  const families = typography.fontFamily ?? {};
  for (const [k, v] of Object.entries(families)) {
    if (isMeta(k)) continue;
    out.push([`--font-family-${kebab(k)}`, v]);
  }
  if (typography.numeric?.fontVariantNumeric) {
    out.push(["--font-numeric", typography.numeric.fontVariantNumeric]);
  }
  for (const [name, spec] of Object.entries(typography)) {
    if (isMeta(name) || name === "fontFamily" || name === "numeric") continue;
    const n = kebab(name);
    const family = spec.fontFamily ? `var(--font-family-${kebab(spec.fontFamily)})` : "var(--font-family-sans)";
    out.push([`--font-${n}-size`, spec.fontSize]);
    out.push([`--font-${n}-line`, spec.lineHeight]);
    out.push([`--font-${n}-weight`, String(spec.fontWeight)]);
    out.push([`--font-${n}-letter-spacing`, spec.letterSpacing ?? "0px"]);
    out.push([`--font-${n}-family`, family]);
    out.push([`--font-${n}`, `${spec.fontWeight} ${spec.fontSize}/${spec.lineHeight} ${family}`]);
  }
  return out;
}

const PREFIX = {
  spacing: "spacing",
  radius: "radius",
  size: "size",
  border: "border",
  chart: "chart",
  opacity: "opacity",
  zIndex: "z-index",
  motion: "motion",
  breakpoint: "breakpoint",
};

function build(tokens) {
  const base = [];
  for (const [group, value] of Object.entries(tokens)) {
    if (isMeta(group) || group === "color" || group === "shadow") continue;
    if (group === "typography") {
      base.push(...typographyVars(value));
      continue;
    }
    const prefix = PREFIX[group] ?? kebab(group);
    flatten(value, [prefix], base);
  }

  const themed = {};
  for (const theme of THEMES) {
    const vars = [];
    flatten(tokens.color?.[theme] ?? {}, ["color"], vars);
    flatten(tokens.shadow?.[theme] ?? {}, ["shadow"], vars);
    themed[theme] = vars;
  }

  // 테마 간 키가 같은지 확인 (tokens.json $meta: 두 테마는 같은 키를 가진다)
  const lightKeys = new Set(themed.light.map(([k]) => k));
  const darkKeys = new Set(themed.dark.map(([k]) => k));
  const missing = [...lightKeys].filter((k) => !darkKeys.has(k)).concat([...darkKeys].filter((k) => !lightKeys.has(k)));
  if (missing.length) {
    throw new Error(`light/dark 테마 키가 다릅니다: ${missing.join(", ")}`);
  }

  // status.md 1.6: 상태 악화 강조는 움직임 줄이기에서도 "페이드 없이 켜고 끈다" -> 지속 시간은 유지한다.
  const reduced = base
    .filter(([k]) => k.startsWith("--motion-duration-") && k !== "--motion-duration-status-highlight")
    .map(([k]) => [k, "0ms"]);

  const block = (vars, indent) => vars.map(([k, v]) => `${indent}${k}: ${v};`).join("\n");
  const src = relative(dirname(OUT), SRC).replace(/\\/g, "/");

  return `/*
 * 자동 생성 파일: 직접 수정하지 마세요.
 * 출처: ${src} (v${tokens.$meta?.version ?? "?"}, ${tokens.$meta?.updated ?? "?"})
 * 다시 만들기: npm run tokens --prefix apps/web
 */

/* 테마와 무관한 토큰 + 기본(라이트) 테마 */
:root,
[data-theme="light"] {
${block(base, "  ")}

  color-scheme: light;
${block(themed.light, "  ")}
}

/* 다크 테마: 사용자가 고른 경우 */
[data-theme="dark"] {
  color-scheme: dark;
${block(themed.dark, "  ")}
}

/* 다크 테마: 지정이 없고 OS 설정이 다크인 경우 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${block(themed.dark, "    ")}
  }
}

/* 움직임 줄이기: duration 0ms (pulse·shimmer 정지는 각 컴포넌트 CSS가 처리) */
@media (prefers-reduced-motion: reduce) {
  :root {
${block(reduced, "    ")}
  }
}
`;
}

const tokens = JSON.parse(readFileSync(SRC, "utf8"));
const css = build(tokens);

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    // 없으면 다름
  }
  if (current.replace(/\r\n/g, "\n") !== css) {
    console.error("tokens.css 가 tokens.json 과 다릅니다. npm run tokens --prefix apps/web 를 실행하세요.");
    process.exit(1);
  }
  console.log("tokens.css 최신 상태");
} else {
  writeFileSync(OUT, css, "utf8");
  console.log(`생성: ${relative(process.cwd(), OUT)}`);
}
