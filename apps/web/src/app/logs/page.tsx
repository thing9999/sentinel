import type { Metadata } from "next";
import { Suspense } from "react";

import { LogsPage } from "@/features/logs/LogsPage";

export const metadata: Metadata = { title: "로그" };

export default function Page() {
  return (
    <Suspense>
      <LogsPage />
    </Suspense>
  );
}
