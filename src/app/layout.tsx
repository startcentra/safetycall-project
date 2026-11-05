import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeCall Guardian | Hackathon Demo Starter",
  description: "연구 기반 실시간 보이스피싱 행동 코칭 — 단계별로 제작 중인 안전한 가상 시뮬레이터",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
