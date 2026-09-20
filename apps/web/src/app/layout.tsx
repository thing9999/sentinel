import type { Metadata } from "next";

import { ShellClient } from "@/features/shell/ShellClient";
import { THEME_INIT_SCRIPT } from "@/features/shell/theme";
import { StreamProvider } from "@/features/stream/StreamProvider";

import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Sentinel",
    template: "%s · Sentinel",
  },
  description: "쿠버네티스 서버·DB 상태, AWS 비용, 아키텍처 조언 대시보드 (조회 전용)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 첫 페인트 전에 저장된 테마(data-theme)를 적용한다. 고정 문자열 스크립트(서버 데이터 없음). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <StreamProvider>
          <ShellClient>{children}</ShellClient>
        </StreamProvider>
      </body>
    </html>
  );
}
