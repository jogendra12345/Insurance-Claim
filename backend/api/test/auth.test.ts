// Per-tab bearer-token sessions — .claude/specs/generic/auth-role-based-access.md,
// addendum 2026-10-05. Runs against the local Postgres (RUNNING-LOCALLY.md §2-3)
// with throwaway users created and deleted here; no email is sent (the reset
// test writes the one-time code's hash straight to the DB).
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { hashPassword } from "../src/auth";
import { pool } from "../src/db";

const PASSWORD = "test-password-1";
const claimant = { email: `auth-test-claimant-${randomUUID()}@claimflow.test`, id: "" };
const staff = { email: `auth-test-adjuster-${randomUUID()}@claimflow.test`, id: "" };

async function createUser(email: string, role: string): Promise<string> {
  const { rows } = await pool.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`, [
    email,
    await hashPassword(PASSWORD),
    role,
  ]);
  return rows[0].id;
}

async function login(email: string, password = PASSWORD) {
  return request(app).post("/api/auth/login").send({ email, password });
}

beforeAll(async () => {
  claimant.id = await createUser(claimant.email, "claimant");
  staff.id = await createUser(staff.email, "adjuster");
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[claimant.id, staff.id]]);
  await pool.end();
});

describe("login", () => {
  it("returns a bearer token and the user, and sets no cookie", async () => {
    const res = await login(claimant.email);
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe("bearer");
    expect(typeof res.body.access_token).toBe("string");
    expect(res.body.user).toMatchObject({ id: claimant.id, email: claimant.email, role: "claimant" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("issues an HS256 JWT with sub, role, iat and exp", async () => {
    const { body } = await login(claimant.email);
    const decoded = jwt.decode(body.access_token, { complete: true }) as jwt.Jwt;
    const payload = decoded.payload as jwt.JwtPayload;
    expect(decoded.header.alg).toBe("HS256");
    expect(payload.sub).toBe(claimant.id);
    expect(payload.role).toBe("claimant");
    expect(payload.exp! - payload.iat!).toBe(Number(process.env.SESSION_TTL_HOURS ?? 8) * 3600);
  });

  it("rejects a wrong password", async () => {
    const res = await login(claimant.email, "wrong-password");
    expect(res.status).toBe(401);
    expect(res.body.access_token).toBeUndefined();
  });
});

describe("protected routes", () => {
  it("return 401 with WWW-Authenticate: Bearer when no token is sent", async () => {
    for (const path of ["/api/auth/me", "/api/claims", "/api/tasks"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.headers["www-authenticate"], path).toBe("Bearer");
    }
  });

  it("return 401 for a malformed token, a wrong signature, or an expired token", async () => {
    const forged = jwt.sign({ sub: claimant.id, email: claimant.email, role: "claimant", ver: 0 }, "not-the-secret");
    const expired = jwt.sign(
      { sub: claimant.id, email: claimant.email, role: "claimant", ver: 0, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.SESSION_SECRET!
    );
    for (const token of ["garbage", forged, expired]) {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it("return 200 with a valid token, for the user the token belongs to", async () => {
    const { body } = await login(claimant.email);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: claimant.id, email: claimant.email, role: "claimant" });
    const claims = await request(app).get("/api/claims").set("Authorization", `Bearer ${body.access_token}`);
    expect(claims.status).toBe(200);
  });

  it("keep two users' tokens independent (two tabs, two logins)", async () => {
    const a = (await login(claimant.email)).body.access_token;
    const b = (await login(staff.email)).body.access_token;
    const meA = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${a}`);
    const meB = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${b}`);
    expect(meA.body.email).toBe(claimant.email);
    expect(meB.body.email).toBe(staff.email);
  });

  it("still enforce roles: a claimant can't reach staff task endpoints", async () => {
    const { body } = await login(claimant.email);
    const res = await request(app).get("/api/tasks").set("Authorization", `Bearer ${body.access_token}`);
    expect(res.status).toBe(403);
  });
});

describe("routes closed alongside the change", () => {
  it("POST /api/claims requires a login", async () => {
    const res = await request(app).post("/api/claims").field("policyNumber", "POL-100013");
    expect(res.status).toBe(401);
  });

  it("POST /api/policies requires admin", async () => {
    expect((await request(app).post("/api/policies").send({})).status).toBe(401);
    const { body } = await login(staff.email);
    const res = await request(app).post("/api/policies").set("Authorization", `Bearer ${body.access_token}`).send({});
    expect(res.status).toBe(403);
  });
});

describe("CORS", () => {
  it("allows the Authorization header and no longer allows credentials", async () => {
    const res = await request(app)
      .options("/api/auth/me")
      .set("Origin", process.env.CORS_ORIGIN ?? "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization");
    expect(res.headers["access-control-allow-headers"]).toMatch(/authorization/i);
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("password reset", () => {
  it("still works, and revokes tokens issued before it", async () => {
    const oldToken = (await login(claimant.email)).body.access_token;
    const otp = "123456";
    await pool.query(
      `UPDATE users SET reset_otp_hash = $1, reset_otp_expires_at = now() + interval '10 minutes', reset_otp_attempts = 0
       WHERE id = $2`,
      [await hashPassword(otp), claimant.id]
    );

    const reset = await request(app).post("/api/auth/verify-otp").send({ email: claimant.email, otp, newPassword: "new-password-2" });
    expect(reset.status).toBe(200);
    expect(reset.headers["set-cookie"]).toBeUndefined();
    expect(reset.body.access_token).toBeUndefined(); // reset doesn't log in

    const stale = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${oldToken}`);
    expect(stale.status).toBe(401);

    expect((await login(claimant.email)).status).toBe(401);
    const fresh = await login(claimant.email, "new-password-2");
    expect(fresh.status).toBe(200);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${fresh.body.access_token}`);
    expect(me.status).toBe(200);
  });
});
