import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { TopBar } from "@/components/TopBar";
import { AuthProvider } from "@/lib/auth-context";
import type { AuthUser } from "@/lib/types";

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

// Resolves who's logged in during SSR (server-to-server call, forwarding
// the incoming session cookie) so the first HTML the browser paints
// already reflects the real logged-in state — a client-only fetch can't
// do that, since the server-rendered HTML paints before any client JS
// runs. Every full page load in this app hits this (nav links are plain
// <a href>, not next/link), so getting this right here is what actually
// fixes the tab-label flash, not anything client-side.
async function resolveUser(): Promise<AuthUser | null> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  const cookie = headers().get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(`${apiBaseUrl}/api/auth/me`, {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null; // backend/api unreachable — render logged-out, client refresh() will retry
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialUser = await resolveUser();

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider initialUser={initialUser}>
          <TopBar />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
