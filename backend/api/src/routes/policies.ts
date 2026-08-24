import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "../db";

export const policiesRouter = Router();

function serializePolicy(row: any) {
  return {
    id: row.id,
    policyNumber: row.policy_number,
    policyholderName: row.policyholder_name,
    insuranceType: row.insurance_type,
    status: row.status,
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    premiumAmount: Number(row.premium_amount),
    coverageAmount: Number(row.coverage_amount),
    deductibleAmount: Number(row.deductible_amount),
    copayAmount: Number(row.copay_amount),
    coinsuranceRate: Number(row.coinsurance_rate),
    createdAt: row.created_at,
  };
}

// GET /api/policies — list policies for the claimant portal's policy-number
// dropdown and the Policies tab. Not documented as a numbered SPEC.md §7
// endpoint yet alongside POST/GET /api/claims — fold into a proper api-type
// spec once backend/api's other endpoints are built.
policiesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM policies ORDER BY policy_number`);
    res.json(result.rows.map(serializePolicy));
  } catch (err) {
    console.error("GET /api/policies failed:", err);
    res.status(500).json({ message: "Couldn't load policies." });
  }
});

// POST /api/policies — adds a policy from the Policies tab's "add policy" panel.
// carrier_id isn't claimant/operator-entered in this demo (no real carrier
// concept exposed yet, per SPEC.md §14's tenant-isolation future work) — a
// fresh id is generated server-side per new policy.
policiesRouter.post("/", async (req, res) => {
  const {
    policyNumber,
    policyholderName,
    insuranceType,
    status,
    effectiveDate,
    expiryDate,
    premiumAmount,
    coverageAmount,
    deductibleAmount,
    copayAmount,
    coinsuranceRate,
  } = req.body;

  if (
    !policyNumber ||
    !policyholderName ||
    !status ||
    !effectiveDate ||
    !expiryDate ||
    premiumAmount === undefined ||
    premiumAmount === "" ||
    coverageAmount === undefined ||
    coverageAmount === "" ||
    deductibleAmount === undefined ||
    deductibleAmount === "" ||
    copayAmount === undefined ||
    copayAmount === "" ||
    coinsuranceRate === undefined ||
    coinsuranceRate === ""
  ) {
    return res.status(400).json({ message: "Missing required policy fields." });
  }
  if (!["active", "lapsed", "cancelled"].includes(status)) {
    return res.status(400).json({ message: "status must be active, lapsed, or cancelled." });
  }
  const premium = Number(premiumAmount);
  const coverage = Number(coverageAmount);
  const deductible = Number(deductibleAmount);
  const copay = Number(copayAmount);
  const coinsurance = Number(coinsuranceRate);
  if (Number.isNaN(premium) || premium < 0) {
    return res.status(400).json({ message: "Premium amount must be 0 or greater." });
  }
  if (Number.isNaN(coverage) || coverage <= 0) {
    return res.status(400).json({ message: "Coverage amount must be greater than 0." });
  }
  if (Number.isNaN(deductible) || deductible < 0) {
    return res.status(400).json({ message: "Deductible amount must be 0 or greater." });
  }
  if (Number.isNaN(copay) || copay < 0) {
    return res.status(400).json({ message: "Copay amount must be 0 or greater." });
  }
  if (Number.isNaN(coinsurance) || coinsurance < 0 || coinsurance > 1) {
    return res.status(400).json({ message: "Coinsurance rate must be between 0 and 1." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO policies (policy_number, carrier_id, insurance_type, policyholder_name, status, effective_date, expiry_date, premium_amount, coverage_amount, deductible_amount, copay_amount, coinsurance_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        policyNumber,
        randomUUID(),
        insuranceType || "health",
        policyholderName,
        status,
        effectiveDate,
        expiryDate,
        premium,
        coverage,
        deductible,
        copay,
        coinsurance,
      ]
    );
    res.status(201).json(serializePolicy(result.rows[0]));
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: `A policy with number ${policyNumber} already exists.` });
    }
    console.error("POST /api/policies failed:", err);
    res.status(500).json({ message: "Couldn't add policy." });
  }
});

// DELETE /api/policies/:id — blocked (FK ON DELETE RESTRICT) while any claim
// still references this policy; reported back as a clear 409 rather than a
// raw database error.
policiesRouter.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM policies WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Policy not found." });
    }
    res.status(204).send();
  } catch (err: any) {
    if (err.code === "23503") {
      return res
        .status(409)
        .json({ message: "Can't delete this policy — one or more claims still reference it." });
    }
    console.error("DELETE /api/policies/:id failed:", err);
    res.status(500).json({ message: "Couldn't delete policy." });
  }
});
