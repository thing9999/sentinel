import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // 별도 출력 폴더 (NEXT_DIST_DIR=… 로 갈라 쓰는 경우. 예: 번들 측정 `.next-build`,
    // 다른 담당의 개발 서버가 `.next` 를 쓰는 동안 띄우는 `.next-fedev`).
    // 빌드 산출물을 lint 하면 수천 건의 가짜 오류가 나와 진짜 오류가 묻힌다.
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
