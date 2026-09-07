"use client";

import { useState } from "react";
import { ApiError, forgotPassword, verifyOtp } from "@/lib/api";

type Step = "email" | "code";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { message } = await forgotPassword(email);
      setInfo(message);
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp({ email, otp, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError(null);
    setBusy(true);
    try {
      const { message } = await forgotPassword(email);
      setInfo(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main style={{ maxWidth: "380px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.35rem" }}>Password reset</h1>
        <p style={{ color: "var(--text-muted)" }}>Your password has been reset — you can now log in with your new password.</p>
        <a href="/login" style={{ color: "var(--primary)", fontWeight: 600 }}>
          Go to login
        </a>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "380px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.35rem" }}>Forgot password</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0, marginBottom: "1.75rem" }}>
        {step === "email"
          ? "Enter your account email and we'll send you a verification code."
          : "Enter the code we sent, and choose a new password."}
      </p>

      {step === "email" ? (
        <form onSubmit={handleSendCode} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <FormField label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </FormField>
          {error && (
            <div role="alert" style={{ fontSize: "0.85rem", color: "var(--danger-fg)" }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={busy} className="transition btn-press" style={buttonStyle(busy)}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {info && (
            <div role="status" style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {info}
            </div>
          )}
          <FormField label="Verification code" hint="6 digits, from the email">
            <input
              required
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="New password" hint="At least 8 characters">
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />
          </FormField>
          {error && (
            <div role="alert" style={{ fontSize: "0.85rem", color: "var(--danger-fg)" }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={busy} className="transition btn-press" style={buttonStyle(busy)}>
            {busy ? "Resetting…" : "Reset password"}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="transition"
            style={{ border: "none", background: "none", color: "var(--primary)", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: "0.85rem", textAlign: "left" }}
          >
            Resend code
          </button>
        </form>
      )}

      <p style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
        <a href="/login" style={{ color: "var(--primary)", fontWeight: 600 }}>
          Back to login
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
