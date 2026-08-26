import { Router } from "express";
import { pool } from "../db";

export const providersRouter = Router();

function serializeProvider(row: any) {
  return {
    id: row.id,
    npi: row.npi,
    taxId: row.tax_id,
    facilityName: row.facility_name,
    facilityAddress: row.facility_address,
  };
}

// GET /api/providers — backs the claim submission form's provider picker
// (autofills facility name/address/tax ID on NPI selection, per the
// find-or-create-by-NPI behavior in POST /api/claims).
providersRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM providers ORDER BY facility_name`);
    res.json(result.rows.map(serializeProvider));
  } catch (err) {
    console.error("GET /api/providers failed:", err);
    res.status(500).json({ message: "Couldn't load providers." });
  }
});
