"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, registerStaff } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ROLES, type Role } from "@/lib/types";

export default function RegisterStaffPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("triage-team");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== "admin") {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  if (authLoading || !user || user.role !== "admin") {
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const created = await registerStaff({ email, password, role });
      setSuccess(`Account created for ${created.email} (${created.role}).`);
      setEmail("");
      setPassword("");
      setRole("triage-team");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: "380px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.35rem" }}>Register a new user</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0, marginBottom: "1.75rem" }}>
        Admin only — creates a staff account with the role you choose below.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <FormField label="Email">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </FormField>
        <FormField label="Password" hint="At least 8 characters">
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </FormField>
        <FormField label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={inputStyle}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FormField>
        {error && (
          <div role="alert" style={{ fontSize: "0.85rem", color: "var(--danger-fg)" }}>
            {error}
          </div>
        )}
        {success && (
          <div role="status" style={{ fontSize: "0.85rem", color: "var(--success-fg, var(--primary))" }}>
            {success}
          </div>
        )}
        <button type="submit" disabled={busy} className="transition btn-press" style={buttonStyle(busy)}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </main>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{hint}</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.55rem 0.7rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  width: "100%",
};

const buttonStyle = (busy: boolean): React.CSSProperties => ({
  padding: "0.65rem 1.1rem",
  borderRadius: "var(--radius-sm)",
  border: "none",
  background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
  color: "var(--primary-contrast)",
  fontWeight: 600,
  cursor: busy ? "default" : "pointer",
  opacity: busy ? 0.7 : 1,
});
