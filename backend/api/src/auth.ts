import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { pool } from "./db";

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

// Per-tab sessions: a bearer token the frontend keeps in sessionStorage,
// not a cookie (every tab shares a cookie, so a second login in another tab
// replaced the first). .claude/specs/generic/auth-role-based-access.md,
// addendum 2026-10-05.

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is not set.");
  }
  return value;
}

function ttlSeconds(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 8);
  return Math.round((Number.isFinite(hours) && hours > 0 ? hours : 8) * 3600);
}

interface TokenClaims {
  sub: string;
  email: string;
  role: Role;
  /** users.token_version at issue time — a password reset bumps it, revoking older tokens. */
  ver: number;
}

/** HS256 JWT: sub, email, role, ver, iat, exp. */
export function issueAccessToken(user: SessionUser, tokenVersion: number): string {
  const claims: TokenClaims = { sub: user.userId, email: user.email, role: user.role, ver: tokenVersion };
  return jwt.sign(claims, secret(), { algorithm: "HS256", expiresIn: ttlSeconds() });
}

/** The login/signup response body. */
export function tokenResponse(user: SessionUser, tokenVersion: number, publicUser: unknown) {
  return { access_token: issueAccessToken(user, tokenVersion), token_type: "bearer" as const, user: publicUser };
}

/** Signature + expiry only; the token version is checked against the DB in attachUser. */
export function verifyAccessToken(token: string): (SessionUser & { tokenVersion: number }) | null {
  try {
    const claims = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as jwt.JwtPayload & Partial<TokenClaims>;
    if (!claims.sub || !claims.email || !claims.role || typeof claims.ver !== "number") return null;
    return { userId: claims.sub, email: claims.email, role: claims.role, tokenVersion: claims.ver };
  } catch {
    return null;
  }
}

function bearerToken(req: Request): string | undefined {
  const header = req.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// Reads "Authorization: Bearer <token>" (if any) and attaches req.user —
// same {userId, email, role} shape the cookie session produced, so routes
// and role checks are unchanged. An invalid, expired or revoked token just
// leaves req.user unset; requireAuth/requireRole then answer 401.
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) return next();
  try {
    const { rows } = await pool.query(`SELECT token_version FROM users WHERE id = $1`, [claims.userId]);
    if (rows[0] && rows[0].token_version === claims.tokenVersion) {
      req.user = { userId: claims.userId, email: claims.email, role: claims.role };
    }
    next();
  } catch (err) {
    next(err);
  }
}

function unauthorized(res: Response) {
  res.set("WWW-Authenticate", "Bearer");
  return res.status(401).json({ message: "Login required." });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return unauthorized(res);
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res);
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed for your role." });
    }
    next();
  };
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
