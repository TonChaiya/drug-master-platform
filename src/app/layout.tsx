import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TMT Drug Master Platform",
  description: "ระบบจัดการบัญชียาและมาตรฐาน TMT/TTMT สำหรับสถานบริการ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
