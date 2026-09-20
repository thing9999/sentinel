import type { Metadata } from "next";
import { Suspense } from "react";

import { NodesPage } from "@/features/cluster-status/NodesPage";

export const metadata: Metadata = { title: "노드" };

export default function Page() {
  return (
    <Suspense>
      <NodesPage />
    </Suspense>
  );
}
