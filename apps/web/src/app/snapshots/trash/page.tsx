import type { Metadata } from "next";

import { TrashPage } from "@/features/aws-snapshots/TrashPage";

export const metadata: Metadata = { title: "AWS 스냅샷 휴지통" };

export default function Page() {
  return <TrashPage />;
}
