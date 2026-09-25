import type { Metadata } from "next";
import { Suspense } from "react";

import { AlertsPage } from "@/features/alerts/AlertsPage";

export const metadata: Metadata = { title: "알림" };

export default function Page() {
  return (
    <Suspense>
      <AlertsPage />
    </Suspense>
  );
}
