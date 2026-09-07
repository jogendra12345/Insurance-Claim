"use client";

import { useEffect, useRef, useState } from "react";
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

function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

function UserMenu({ email, role, isAdmin }: { email: string; role: string; isAdmin: boolean }) {
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="transition btn-press"
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          border: "none",
          background: "linear-gradient(135deg, var(--primary), var(--accent))",
          color: "var(--primary-contrast)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.75rem",
          fontWeight: 700,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {initialsFor(email)}
      </button>

      {open && (
        <div
          className="animate-scale-in"
          style={{
            position: "absolute",
            top: "calc(100% + 0.5rem)",
            right: 0,
            minWidth: "220px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-card)",
            padding: "0.5rem",
            zIndex: 40,
          }}
        >
          <div style={{ padding: "0.5rem 0.6rem 0.65rem", borderBottom: "1px solid var(--border)", marginBottom: "0.35rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {email}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "capitalize" }}>{role}</div>
          </div>

          {isAdmin && (
            <a
              href="/admin/register"
              onClick={() => setOpen(false)}
              className="transition"
              style={{
                display: "block",
                padding: "0.5rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text)",
                textDecoration: "none",
              }}
            >
              Register new user
            </a>
          )}

          <button
            onClick={async () => {
              setOpen(false);
              await logout();
              router.push("/login");
            }}
            className="transition"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "0.5rem 0.6rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "none",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

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
                <UserMenu email={user.email} role={user.role} isAdmin={user.role === "admin"} />
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
