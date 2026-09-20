import type { Metadata } from "next";

import { CostPage } from "@/features/aws-cost/CostPage";

export const metadata: Metadata = { title: "비용" };

export default function Page() {
  return <CostPage />;
}
