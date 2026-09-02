import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Connectivity PoC | TMT Drug Master",
  description: "หน้าทดสอบการเชื่อมต่อ Web, TMT API และ Windows Agent",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
