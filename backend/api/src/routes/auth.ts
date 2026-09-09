import { randomInt } from "node:crypto";
import { Router } from "express";
import { pool } from "../db";
import { clearSessionCookie, hashPassword, requireRole, setSessionCookie, STAFF_ROLES, verifyPassword } from "../auth";
import { sendEmail } from "../../../shared/email-sender";

export const authRouter = Router();

function serializeUser(row: any) {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

// Generic response for both forgot-password endpoints' non-error paths —
// never reveals whether a given email has an account (.claude/specs/generic/
// forgot-password-otp-reset.md "enumeration-avoidance").
const GENERIC_OTP_SENT_MESSAGE = "If that email has an account, we've sent a verification code.";
const GENERIC_OTP_INVALID_MESSAGE = "Invalid or expired code.";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// POST /api/auth/signup — claimant self-registration only. Gated by a
// lightweight policy-match check (.claude/specs/generic/
// auth-role-based-access.md "Claimant signup verification"): the submitted
// policyNumber + email must match an existing policy's policyholder_email
// or one of its policy_dependents.email rows — the exact same check
// validate-claim already performs (SPEC.md §9 "Authorized claimants").
// Staff roles are never created here; they're seeded directly into `users`.
authRouter.post("/signup", async (req, res) => {
  const { email, password, policyNumber } = req.body ?? {};
  if (!email || !password || !policyNumber) {
    return res.status(400).json({ message: "Email, password, and policy number are all required." });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  try {
    const normalizedEmail = String(email).toLowerCase();

    const { rows: policyRows } = await pool.query(
      `SELECT id, policyholder_email FROM policies WHERE policy_number = $1`,
      [policyNumber]
    );
    const policy = policyRows[0] as { id: string; policyholder_email: string } | undefined;
    let matched = false;
    if (policy) {
      const isPolicyholder = policy.policyholder_email.toLowerCase() === normalizedEmail;
      const { rowCount } = await pool.query(
        `SELECT id FROM policy_dependents WHERE policy_id = $1 AND lower(email) = $2 LIMIT 1`,
        [policy.id, normalizedEmail]
      );
      matched = isPolicyholder || (rowCount ?? 0) > 0;
    }
    if (!matched) {
      return res.status(400).json({ message: "Policy number and email don't match our records." });
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'claimant') RETURNING *`,
      [String(email).trim(), passwordHash]
    );
    const user = rows[0];
    setSessionCookie(res, { userId: user.id, email: user.email, role: user.role });
    res.status(201).json(serializeUser(user));
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "An account with that email already exists." });
    }
    console.error("POST /api/auth/signup failed:", err);
    res.status(500).json({ message: "Couldn't create the account." });
  }
});

// POST /api/auth/register-staff — admin-only. Creates a non-claimant
// (staff) account directly, the app-level equivalent of the seeded staff
// rows described in ROADMAP.md ("no admin UI in this pass") — this is that
// admin UI. Deliberately separate from /signup: no policy-match gate, and
// the role is caller-chosen rather than hardcoded to 'claimant'.
authRouter.post("/register-staff", requireRole("admin"), async (req, res) => {
  const { email, password, role } = req.body ?? {};
  if (!email || !password || !role) {
    return res.status(400).json({ message: "Email, password, and role are all required." });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }
  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be a staff role." });
  }

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING *`,
      [String(email).trim(), passwordHash, role]
    );
    res.status(201).json(serializeUser(rows[0]));
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "An account with that email already exists." });
    }
    console.error("POST /api/auth/register-staff failed:", err);
    res.status(500).json({ message: "Couldn't create the account." });
  }
});

function otpEmailBody(code: string): { subject: string; html: string; text: string } {
  const subject = "Your ClaimFlow AI verification code";
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111827;">
  <p>Use this code to reset your ClaimFlow AI password:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:4px;text-align:center;margin:24px 0;">${code}</p>
  <p style="color:#6b7280;font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
</div>`.trim();
  const text = `Your ClaimFlow AI verification code: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`;
  return { subject, html, text };
}

// POST /api/auth/forgot-password — .claude/specs/generic/
// forgot-password-otp-reset.md (Locked). Always responds 200 with the same
// generic message regardless of whether the email matches an account, to
// avoid leaking which emails have one.
authRouter.post("/forgot-password", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, email, reset_otp_sent_at FROM users WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = rows[0] as { id: string; email: string; reset_otp_sent_at: Date | null } | undefined;

    if (user) {
      const withinCooldown =
        user.reset_otp_sent_at && Date.now() - new Date(user.reset_otp_sent_at).getTime() < OTP_RESEND_COOLDOWN_MS;

      if (!withinCooldown) {
        const code = String(randomInt(100000, 1000000));
        const otpHash = await hashPassword(code);
        await pool.query(
          `UPDATE users
           SET reset_otp_hash = $1, reset_otp_expires_at = now() + interval '10 minutes',
               reset_otp_attempts = 0, reset_otp_sent_at = now()
           WHERE id = $2`,
          [otpHash, user.id]
        );
        const { subject, html, text } = otpEmailBody(code);
        await sendEmail({ to: user.email, subject, html, text });
      }
    }

    res.json({ message: GENERIC_OTP_SENT_MESSAGE });
  } catch (err) {
    console.error("POST /api/auth/forgot-password failed:", err);
    // Still generic on error — an internal failure shouldn't leak whether
    // the email matched a user either.
    res.json({ message: GENERIC_OTP_SENT_MESSAGE });
  }
});

// POST /api/auth/verify-otp — verifies the code and sets newPassword in the
// same call (Open Question 1, resolved at lock: the user chooses their own
// new password, nothing is emailed here).
authRouter.post("/verify-otp", async (req, res) => {
  const { email, otp, newPassword } = req.body ?? {};
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "Email, code, and new password are all required." });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, reset_otp_hash, reset_otp_expires_at, reset_otp_attempts FROM users WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = rows[0] as
      | { id: string; reset_otp_hash: string | null; reset_otp_expires_at: Date | null; reset_otp_attempts: number }
      | undefined;

    const expired = !user?.reset_otp_hash || !user.reset_otp_expires_at || new Date(user.reset_otp_expires_at) < new Date();
    if (!user || expired) {
      return res.status(400).json({ message: GENERIC_OTP_INVALID_MESSAGE });
    }
    if (user.reset_otp_attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ message: GENERIC_OTP_INVALID_MESSAGE });
    }

    const matches = await verifyPassword(String(otp), user.reset_otp_hash!);
    if (!matches) {
      await pool.query(`UPDATE users SET reset_otp_attempts = reset_otp_attempts + 1 WHERE id = $1`, [user.id]);
      return res.status(400).json({ message: GENERIC_OTP_INVALID_MESSAGE });
    }

    const passwordHash = await hashPassword(newPassword);
    await pool.query(
      `UPDATE users
       SET password_hash = $1, reset_otp_hash = NULL, reset_otp_expires_at = NULL,
           reset_otp_attempts = 0, reset_otp_sent_at = NULL
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    res.json({ message: "Your password has been reset — log in with your new password." });
  } catch (err) {
    console.error("POST /api/auth/verify-otp failed:", err);
    res.status(500).json({ message: "Couldn't reset your password." });
  }
});

// POST /api/auth/login — claimant and staff both log in here.
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }
    setSessionCookie(res, { userId: user.id, email: user.email, role: user.role });
    res.json(serializeUser(user));
  } catch (err) {
    console.error("POST /api/auth/login failed:", err);
    res.status(500).json({ message: "Couldn't log in." });
  }
});

// POST /api/auth/logout
authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

// GET /api/auth/me — lets the frontend know who's logged in (or isn't) on load.
authRouter.get("/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not logged in." });
  }
  res.json({ id: req.user.userId, email: req.user.email, role: req.user.role });
});
