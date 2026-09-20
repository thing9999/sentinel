import type { Metadata } from "next";
import { Suspense } from "react";

import { SnapshotListPage } from "@/features/aws-snapshots/SnapshotListPage";

export const metadata: Metadata = { title: "스냅샷" };

export default function Page() {
  return (
    <Suspense>
      <SnapshotListPage />
    </Suspense>
  );
}
