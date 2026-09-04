import { Router } from "express";
import { pool } from "../db";
import { clearSessionCookie, hashPassword, setSessionCookie, verifyPassword } from "../auth";

export const authRouter = Router();

function serializeUser(row: any) {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
}

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
      [email, passwordHash]
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
