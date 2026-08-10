import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import ToastProvider from "./components/ToastProvider";

// weight: "variable" (not a discrete array) — verified against the build
// output that requesting discrete weights ["500","600","700","800"] here
// made next/font fetch the SAME underlying variable-font file 4 times over
// but mislabel each copy with a single fixed font-weight, so every weight
// rendered identically (confirmed via md5 + fontTools: one file, one fvar
// wght axis 200-1000, referenced by all 4 @font-face weight declarations).
// "variable" tells next/font to declare it honestly as one range-based
// face (font-weight: 200 1000), letting the browser actually interpolate.
const nunito = Nunito({ subsets: ["latin", "vietnamese"], weight: "variable" });

export const metadata: Metadata = {
  title: "Flight Price Tracker",
  description: "Personal flight price tracking dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className={nunito.className}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
