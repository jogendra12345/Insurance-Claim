import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";

// .claude/specs/generic/auth-role-based-access.md — locked design.
export type Role =
  | "claimant"
  | "admin"
  | "triage-team"
  | "adjuster"
  | "investigator"
  | "legal-reviewer"
  | "supervisor";

export const STAFF_ROLES: Role[] = [
  "admin",
  "triage-team",
  "adjuster",
  "investigator",
  "legal-reviewer",
  "supervisor",
];

// Role -> BPMN candidate group. Not a string transform — names differ
// (e.g. "adjuster" the role vs. "adjusters" the candidate group).
export const ROLE_TO_CANDIDATE_GROUP: Partial<Record<Role, string>> = {
  "triage-team": "triage-team",
  adjuster: "adjusters",
  investigator: "investigators",
  "legal-reviewer": "legal-reviewers",
  supervisor: "supervisors",
  // admin has no single group — callers should special-case it to mean "all groups".
};

export interface SessionUser {
  userId: string;
  email: string;
  role: Role;
}

const COOKIE_NAME = "claimflow_session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is not set.");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Signed cookie carrying {userId, email, role} — no server-side sessions
// table (locked decision, see the spec's lock note). Logout just clears
// the cookie client-side; there's no revocation list in v1.
export function createSessionCookie(user: SessionUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookie(cookieValue: string | undefined): SessionUser | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, user: SessionUser) {
  res.cookie(COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// Reads the session cookie (if any) and attaches req.user. Does not reject
// unauthenticated requests — routes that need a logged-in user use
// requireAuth/requireRole below.
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = verifySessionCookie(req.cookies?.[COOKIE_NAME]) ?? undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Login required." });
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Login required." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed for your role." });
    }
    next();
  };
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
