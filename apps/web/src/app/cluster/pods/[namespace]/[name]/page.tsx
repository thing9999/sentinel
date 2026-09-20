import type { Metadata } from "next";

import { safeDecode } from "@/features/common/params";
import { PodDetailPage } from "@/features/cluster-status/PodDetailPage";

export const metadata: Metadata = { title: "파드 상세" };

export default async function Page({ params }: { params: Promise<{ namespace: string; name: string }> }) {
  const { namespace, name } = await params;
  return <PodDetailPage namespace={safeDecode(namespace)} name={safeDecode(name)} />;
}
