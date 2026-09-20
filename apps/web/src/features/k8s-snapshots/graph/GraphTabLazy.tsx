"use client";

/**
 * 3D 보기 탭 진입점. **탭을 열기 전에는 3D 코드(GraphTab·three.js)를 받지 않는다**(AC-3D01).
 * - 1단계: 이 파일이 `GraphTab`(three.js 없음, 관계 표까지 동작)을 동적으로 받는다.
 * - 2단계: `GraphTab` 이 3D를 실제로 그릴 때만 `scene/SceneCanvas`(three.js)를 받는다(AC-3D02).
 */
import dynamic from "next/dynamic";

import { Card, Skeleton } from "@/components/ui";

const Fallback = () => (
  <Card padding="md" aria-busy aria-label="3D 보기를 준비하고 있습니다">
    <Skeleton lines={8} />
  </Card>
);

export const GraphTabLazy = dynamic(() => import("./GraphTab").then((m) => m.GraphTab), {
  ssr: false,
  loading: Fallback,
});
