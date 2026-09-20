import type { Metadata } from "next";

import { OverviewPage } from "@/features/cluster-status/OverviewPage";

export const metadata: Metadata = { title: "개요" };

export default function Page() {
  return <OverviewPage />;
}
