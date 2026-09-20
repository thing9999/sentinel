import type { Metadata } from "next";

import { K8sTrashPage } from "@/features/k8s-snapshots/K8sTrashPage";

export const metadata: Metadata = { title: "Kubernetes 스냅샷 휴지통" };

export default function Page() {
  return <K8sTrashPage />;
}
