import { Pool } from "pg";

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://claimflow:claimflow@localhost:5432/claimflow",
});
