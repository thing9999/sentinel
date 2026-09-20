import type { Metadata } from "next";

import { RunDetailPage } from "@/features/architecture-advisor/RunDetailPage";
import { safeDecode } from "@/features/common/params";

export const metadata: Metadata = { title: "지난 분석 결과" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetailPage id={safeDecode(id)} />;
}
