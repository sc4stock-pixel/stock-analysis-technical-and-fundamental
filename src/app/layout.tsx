import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TA Dashboard V12.5.6",
  description: "Stock Technical Analysis — Regime-Adaptive Scoring & Backtest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
