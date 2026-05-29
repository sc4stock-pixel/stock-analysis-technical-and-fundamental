import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autopilot v17.0",
  description: "Autopilot v17.0 — SuperTrend + Minervini TT automated signal tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
