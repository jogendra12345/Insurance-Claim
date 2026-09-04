"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, login } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ email, password });
      refresh();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: "380px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.35rem" }}>Log in</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0, marginBottom: "1.75rem" }}>
        Claimants and staff both log in here.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <FormField label="Email">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </FormField>
        <FormField label="Password">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </FormField>
        {error && (
          <div role="alert" style={{ fontSize: "0.85rem", color: "var(--danger-fg)" }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} className="transition btn-press" style={buttonStyle(busy)}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Not a claimant yet?{" "}
        <a href="/signup" style={{ color: "var(--primary)", fontWeight: 600 }}>
          Sign up
        </a>
      </p>
    </main>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</span>
      {children}
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
