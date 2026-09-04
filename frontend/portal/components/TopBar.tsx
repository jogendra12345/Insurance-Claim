"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ROLES } from "@/lib/types";
import { ThemeToggle } from "./ThemeToggle";

// A claimant only ever has the one policy summary behind this tab
// (app/policies/page.tsx redirects them straight to it), so the tab reads
// "Policy" for them; staff still manage a whole list, so "Policies".
const TABS = (policyLabel: string) => [
  { href: "/policies", label: policyLabel, match: (path: string) => path.startsWith("/policies") },
  { href: "/", label: "Claims", match: (path: string) => path === "/" || path.startsWith("/claims") },
];

const STAFF_TAB = { href: "/tasks", label: "Tasks", match: (path: string) => path.startsWith("/tasks") };

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  const isClaimant = user?.role === "claimant";
  const tabs = isStaff ? [...TABS("Policies"), STAFF_TAB] : TABS(isClaimant ? "Policy" : "Policies");

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--surface) 88%, transparent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          maxWidth: "1040px",
          margin: "0 auto",
          padding: "0 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "2rem",
        }}
      >
        <a
          href="/"
          className="transition"
          style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "1rem 0", textDecoration: "none" }}
        >
          <span
            aria-hidden="true"
            className="logo-glow"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, var(--primary), var(--accent))",
              color: "var(--primary-contrast)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "0.95rem",
            }}
          >
            C
          </span>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem", color: "var(--text)" }}>
            ClaimFlow
          </span>
        </a>

        <nav style={{ display: "flex", gap: "0.25rem", height: "100%" }}>
          {tabs.map((tab) => {
            const active = tab.match(pathname);
            return (
              <a
                key={tab.href}
                href={tab.href}
                className="transition"
                style={{
                  padding: "1rem 0.25rem",
                  display: "flex",
                  alignItems: "center",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  color: active ? "var(--primary)" : "var(--text-muted)",
                  borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
                }}
              >
                {tab.label}
              </a>
            );
          })}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1rem" }}>
          {!loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.85rem" }}>
              {user ? (
                <>
                  <span style={{ color: "var(--text-muted)" }}>{user.email}</span>
                  <button
                    onClick={async () => {
                      await logout();
                      router.push("/login");
                    }}
                    className="transition"
                    style={{
                      border: "none",
                      background: "none",
                      color: "var(--text)",
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Log out
                  </button>
                </>
              ) : (
                <a href="/login" className="transition" style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none" }}>
                  Log in
                </a>
              )}
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
