import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 기본값은 `.next` 그대로다(기존 동작 불변).
  // 개발 서버(:3000)가 `.next` 를 쓰는 동안 번들 크기를 재야 할 때만
  // `NEXT_DIST_DIR=.next-build npx next build` 로 출력 폴더를 갈라 충돌을 피한다.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // 상위 폴더(C:\myscript 등)의 다른 lockfile을 워크스페이스 루트로 잘못 추론하지 않도록 고정
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
