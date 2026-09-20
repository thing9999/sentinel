import type { Metadata } from "next";

import { SnapshotDetailPage } from "@/features/aws-snapshots/SnapshotDetailPage";
import { safeDecode } from "@/features/common/params";

export const metadata: Metadata = { title: "AWS 스냅샷 상세" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decoded = safeDecode(id);
  // ID 가 바뀌면 편집 상태를 새로 시작한다
  return <SnapshotDetailPage key={decoded} id={decoded} />;
}
