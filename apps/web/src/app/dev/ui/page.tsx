import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { UiPreview } from "@/components/ui/__preview__/UiPreview";

export const metadata: Metadata = { title: "UI 미리보기 (개발용)", robots: { index: false } };

/**
 * 퍼블리셔 컴포넌트 미리보기 (개발용).
 * 프로덕션 빌드(`next start`)에서는 404. 검증 목적으로 켜려면 서버 환경 변수 `SENTINEL_UI_PREVIEW=1`.
 */
export default async function Page() {
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.SENTINEL_UI_PREVIEW !== "1") notFound();
  return <UiPreview />;
}
