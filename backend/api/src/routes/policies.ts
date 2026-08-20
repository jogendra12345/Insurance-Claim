import { Router } from "express";
import { pool } from "../db";

export const policiesRouter = Router();

// GET /api/policies — list policies for the claimant portal's policy-number
// dropdown (frontend/portal). Not documented as a numbered SPEC.md §7 endpoint
// yet alongside POST/GET /api/claims — added to unblock the portal's dropdown;
// fold into a proper api-type spec once backend/api's other endpoints are built.
policiesRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, policy_number, policyholder_name, status
       FROM policies
       ORDER BY policy_number`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        policyNumber: row.policy_number,
        policyholderName: row.policyholder_name,
        status: row.status,
      }))
    );
  } catch (err) {
    console.error("GET /api/policies failed:", err);
    res.status(500).json({ message: "Couldn't load policies." });
  }
});
