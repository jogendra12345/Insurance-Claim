import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaimFlow AI — Claimant Portal",
  description: "Submit a claim and check on active claims.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
