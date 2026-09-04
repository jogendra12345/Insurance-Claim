"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, signup } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SignupPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await signup({ email, password, policyNumber });
      refresh();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: "380px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.35rem" }}>Sign up</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0, marginBottom: "1.75rem" }}>
        Claimants only — we verify your policy number and email match a policy on file before creating your account.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <FormField label="Policy number" hint="As the policyholder or a listed dependent on that policy">
          <input required value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} style={inputStyle} />
        </FormField>
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
        {error && (
          <div role="alert" style={{ fontSize: "0.85rem", color: "var(--danger-fg)" }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} className="transition btn-press" style={buttonStyle(busy)}>
          {busy ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Already have an account?{" "}
        <a href="/login" style={{ color: "var(--primary)", fontWeight: 600 }}>
          Log in
        </a>
      </p>
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
