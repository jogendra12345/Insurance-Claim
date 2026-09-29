// Seeds the local demo login accounts — one per staff role plus the sample
// claimants whose emails match a policy in claimflow_data.sql — all with the
// shared demo password below. Idempotent: existing accounts (matched
// case-insensitively on email, same as login) get their role and password
// reset, so re-running this always leaves every demo account usable.
// Staff accounts are seeded directly rather than self-registered, per
// migration 0010_add_users.sql. Local/demo use only.
//
//   cd backend/api && npm run seed:demo-users
import "dotenv/config";
import { hashPassword } from "../src/auth";
import { pool } from "../src/db";

const DEMO_PASSWORD = "claimflow123";

const DEMO_USERS: { email: string; role: string }[] = [
  { email: "admin1@claimflow.test", role: "admin" },
  { email: "triage1@claimflow.test", role: "triage-team" },
  { email: "adjuster1@claimflow.test", role: "adjuster" },
  { email: "investigator1@claimflow.test", role: "investigator" },
  { email: "legal1@claimflow.test", role: "legal-reviewer" },
  { email: "supervisor1@claimflow.test", role: "supervisor" },
  // Claimants — each email matches policies.policyholder_email, which is how
  // a claimant's claims/policies are scoped.
  { email: "ayanchou2015@gmail.com", role: "claimant" }, // POL-100013
  { email: "amina.al-farsi@example.com", role: "claimant" }, // POL-100001
  { email: "youssef.nasser@example.com", role: "claimant" }, // POL-100004
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const { email, role } of DEMO_USERS) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT ((lower(email))) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
             reset_otp_hash = NULL, reset_otp_expires_at = NULL, reset_otp_attempts = 0
       RETURNING (xmax = 0) AS created`,
      [email, passwordHash, role]
    );
    console.log(`${rows[0].created ? "created" : "updated"}  ${role.padEnd(14)} ${email}`);
  }
  console.log(`\nAll demo accounts use password: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error("seed-demo-users failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
