import type { Metadata } from "next";
import "./globals.css";
import { TopBar } from "@/components/TopBar";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { AuthProvider } from "@/lib/auth-context";

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

// Who is logged in is resolved in the browser from this tab's sessionStorage
// (lib/auth-context.tsx) — the server can't see it, by design: each tab has
// its own login (.claude/specs/generic/auth-role-based-access.md, 2026-10-05).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <TopBar />
          {children}
          {/* Claimant-only chat assistant — .claude/specs/generic/portal-claims-assistant.md */}
          <AssistantChat />
        </AuthProvider>
      </body>
    </html>
  );
}
