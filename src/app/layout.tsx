import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Manrope } from "next/font/google";
import "./globals.css";

// Same pairing as the PHP system: Manrope for display, Plex Thai for body copy.
const bodyFont = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TMT Drug Master Platform",
  description: "ระบบจัดการบัญชียาและมาตรฐาน TMT/TTMT สำหรับสถานบริการ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
