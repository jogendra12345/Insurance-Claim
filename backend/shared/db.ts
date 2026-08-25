import { Pool } from "pg";

// Mirrors backend/api/src/db.ts's pattern (duplicated per package rather
// than cross-imported, matching how .env is already duplicated per package
// in this repo).
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://claimflow:claimflow@localhost:5432/claimflow",
});
