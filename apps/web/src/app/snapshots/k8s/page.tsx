import type { Metadata } from "next";
import { Suspense } from "react";

import { K8sListPage } from "@/features/k8s-snapshots/K8sListPage";

export const metadata: Metadata = { title: "스냅샷 · Kubernetes" };

export default function Page() {
  return (
    <Suspense>
      <K8sListPage />
    </Suspense>
  );
}
