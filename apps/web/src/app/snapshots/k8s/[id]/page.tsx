import type { Metadata } from "next";
import { Suspense } from "react";

import { safeDecode } from "@/features/common/params";
import { K8sDetailPage } from "@/features/k8s-snapshots/K8sDetailPage";

export const metadata: Metadata = { title: "Kubernetes 스냅샷 상세" };

/** `/snapshots/k8s/[id]` — 같은 ID 가 AWS 쪽에 있어도 k8s 만 연다(AC-K18). `?view=&file=&line=&res=&kind=&hidden=` */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = safeDecode(id);
  // ID 가 바뀌면 편집·드리프트 상태를 새로 시작한다
  return (
    <Suspense>
      <K8sDetailPage key={decoded} id={decoded} />
    </Suspense>
  );
}
