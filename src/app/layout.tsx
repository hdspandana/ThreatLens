import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ThreatLens — Digital Abuse Evidence Analysis",
  description:
    "Privacy-first evidence intake, OCR verification, threat-signal analysis, and incident documentation assistant.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
