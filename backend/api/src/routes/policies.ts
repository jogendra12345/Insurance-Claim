import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "../db";

export const policiesRouter = Router();

const DEPENDENT_RELATIONSHIPS = ["spouse", "child", "other"] as const;
type DependentRelationship = (typeof DEPENDENT_RELATIONSHIPS)[number];

function serializePolicy(row: any) {
  return {
    id: row.id,
    policyNumber: row.policy_number,
    policyholderName: row.policyholder_name,
    policyholderEmail: row.policyholder_email,
    insuranceType: row.insurance_type,
    status: row.status,
    effectiveDate: row.effective_date,
    expiryDate: row.expiry_date,
    premiumAmount: Number(row.premium_amount),
    coverageAmount: Number(row.coverage_amount),
    createdAt: row.created_at,
  };
}

function serializeDependent(row: any) {
  return {
    id: row.id,
    policyId: row.policy_id,
    fullName: row.full_name,
    email: row.email,
    relationship: row.relationship,
    createdAt: row.created_at,
  };
}

// GET /api/policies — list policies for the claimant portal's policy-number
// dropdown and the Policies tab. Not documented as a numbered SPEC.md §7
// endpoint yet alongside POST/GET /api/claims — fold into a proper api-type
// spec once backend/api's other endpoints are built. No dependents here —
// keep the list payload light; use GET /:id for a single policy's dependents.
policiesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM policies ORDER BY policy_number`);
    res.json(result.rows.map(serializePolicy));
  } catch (err) {
    console.error("GET /api/policies failed:", err);
    res.status(500).json({ message: "Couldn't load policies." });
  }
});

// GET /api/policies/:id — a single policy plus its authorized-claimant
// dependents (SPEC.md §9 "Authorized claimants"), for the policy detail page.
policiesRouter.get("/:id", async (req, res) => {
  try {
    const policyResult = await pool.query(`SELECT * FROM policies WHERE id = $1`, [req.params.id]);
    if (policyResult.rowCount === 0) {
      return res.status(404).json({ message: "Policy not found." });
    }
    const dependentsResult = await pool.query(
      `SELECT * FROM policy_dependents WHERE policy_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json({
      ...serializePolicy(policyResult.rows[0]),
      dependents: dependentsResult.rows.map(serializeDependent),
    });
  } catch (err) {
    console.error("GET /api/policies/:id failed:", err);
    res.status(500).json({ message: "Couldn't load that policy." });
  }
});

// POST /api/policies — adds a policy from the Policies tab's "add policy" panel,
// optionally with authorized-claimant dependents (SPEC.md §9) in the same request.
// carrier_id isn't claimant/operator-entered in this demo (no real carrier
// concept exposed yet, per SPEC.md §14's tenant-isolation future work) — a
// fresh id is generated server-side per new policy.
policiesRouter.post("/", async (req, res) => {
  const {
    policyNumber,
    policyholderName,
    policyholderEmail,
    insuranceType,
    status,
    effectiveDate,
    expiryDate,
    premiumAmount,
    coverageAmount,
    dependents,
  } = req.body;

  if (
    !policyNumber ||
    !policyholderName ||
    !policyholderEmail ||
    !status ||
    !effectiveDate ||
    !expiryDate ||
    premiumAmount === undefined ||
    premiumAmount === "" ||
    coverageAmount === undefined ||
    coverageAmount === ""
  ) {
    return res.status(400).json({ message: "Missing required policy fields." });
  }
  if (!["active", "lapsed", "cancelled"].includes(status)) {
    return res.status(400).json({ message: "status must be active, lapsed, or cancelled." });
  }
  const premium = Number(premiumAmount);
  const coverage = Number(coverageAmount);
  if (Number.isNaN(premium) || premium < 0) {
    return res.status(400).json({ message: "Premium amount must be 0 or greater." });
  }
  if (Number.isNaN(coverage) || coverage <= 0) {
    return res.status(400).json({ message: "Coverage amount must be greater than 0." });
  }

  const dependentInputs = Array.isArray(dependents) ? dependents : [];
  for (const dependent of dependentInputs) {
    if (!dependent?.fullName || !dependent?.email || !dependent?.relationship) {
      return res.status(400).json({ message: "Each dependent needs a name, email, and relationship." });
    }
    if (!DEPENDENT_RELATIONSHIPS.includes(dependent.relationship)) {
      return res.status(400).json({ message: "Dependent relationship must be spouse, child, or other." });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const policyResult = await client.query(
      `INSERT INTO policies (policy_number, carrier_id, insurance_type, policyholder_name, policyholder_email, status, effective_date, expiry_date, premium_amount, coverage_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        policyNumber,
        randomUUID(),
        insuranceType || "health",
        policyholderName,
        policyholderEmail,
        status,
        effectiveDate,
        expiryDate,
        premium,
        coverage,
      ]
    );
    const policy = policyResult.rows[0];

    const dependentRows = [];
    for (const dependent of dependentInputs as Array<{ fullName: string; email: string; relationship: DependentRelationship }>) {
      const dependentResult = await client.query(
        `INSERT INTO policy_dependents (policy_id, full_name, email, relationship) VALUES ($1, $2, $3, $4) RETURNING *`,
        [policy.id, dependent.fullName, dependent.email, dependent.relationship]
      );
      dependentRows.push(dependentResult.rows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({ ...serializePolicy(policy), dependents: dependentRows.map(serializeDependent) });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({
        message: err.constraint === "policy_dependents_policy_id_email_key"
          ? "Two dependents on the same policy can't share an email."
          : `A policy with number ${policyNumber} already exists.`,
      });
    }
    console.error("POST /api/policies failed:", err);
    res.status(500).json({ message: "Couldn't add policy." });
  } finally {
    client.release();
  }
});

// DELETE /api/policies/:id — blocked (FK ON DELETE RESTRICT) while any claim
// still references this policy; reported back as a clear 409 rather than a
// raw database error. Dependents are removed automatically (ON DELETE CASCADE).
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
