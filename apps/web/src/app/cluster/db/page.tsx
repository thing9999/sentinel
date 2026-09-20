import type { Metadata } from "next";

import { DbPage } from "@/features/cluster-status/DbPage";

export const metadata: Metadata = { title: "데이터베이스" };

export default function Page() {
  return <DbPage />;
}
