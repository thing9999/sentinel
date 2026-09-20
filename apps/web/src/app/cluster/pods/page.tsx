import type { Metadata } from "next";
import { Suspense } from "react";

import { PodsPage } from "@/features/cluster-status/PodsPage";

export const metadata: Metadata = { title: "파드" };

export default function Page() {
  return (
    <Suspense>
      <PodsPage />
    </Suspense>
  );
}
