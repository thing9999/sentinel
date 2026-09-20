import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkloadsPage } from "@/features/cluster-status/WorkloadsPage";

export const metadata: Metadata = { title: "워크로드" };

export default function Page() {
  return (
    <Suspense>
      <WorkloadsPage />
    </Suspense>
  );
}
