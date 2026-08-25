import type { Metadata } from "next";
import "./globals.css";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "ClaimFlow AI — Claimant Portal",
  description: "Submit a claim and check on active claims.",
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem("claimflow-theme") === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <TopBar />
        {children}
      </body>
    </html>
  );
}
