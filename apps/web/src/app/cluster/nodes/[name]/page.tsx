import type { Metadata } from "next";

import { safeDecode } from "@/features/common/params";
import { NodeDetailPage } from "@/features/cluster-status/NodeDetailPage";

export const metadata: Metadata = { title: "노드 상세" };

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <NodeDetailPage name={safeDecode(name)} />;
}
