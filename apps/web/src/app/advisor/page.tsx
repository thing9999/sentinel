import type { Metadata } from "next";

import { AdvisorPage } from "@/features/architecture-advisor/AdvisorPage";

export const metadata: Metadata = { title: "어드바이저" };

export default function Page() {
  return <AdvisorPage />;
}
