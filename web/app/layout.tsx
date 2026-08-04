import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flight Price Tracker",
  description: "Personal flight price tracking dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
