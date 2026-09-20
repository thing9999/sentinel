import type { Metadata } from "next";
import { Suspense } from "react";

import { EventsPage } from "@/features/cluster-status/EventsPage";

export const metadata: Metadata = { title: "이벤트" };

export default function Page() {
  return (
    <Suspense>
      <EventsPage />
    </Suspense>
  );
}
