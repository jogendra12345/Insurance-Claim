"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const TABS = [
  { href: "/policies", label: "Policies", match: (path: string) => path.startsWith("/policies") },
  { href: "/", label: "Claims", match: (path: string) => path === "/" || path.startsWith("/claims") },
];

export function TopBar() {
  const pathname = usePathname();

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
          {TABS.map((tab) => {
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

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
