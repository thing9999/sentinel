import type { Metadata } from "next";

import { MockScenarioPage } from "@/features/shell/MockScenarioPage";

export const metadata: Metadata = { title: "mock 시나리오 (개발용)", robots: { index: false } };

export default function Page() {
  return <MockScenarioPage />;
}
