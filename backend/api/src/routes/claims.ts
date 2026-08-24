import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { pool } from "../db";
import { serializeClaim, serializeClaimDocument } from "../serializers";
import { BUCKET, minioClient, publicUrl } from "../storage";
import { CLAIM_CASE_PROCESS_ID, zeebeClient } from "../zeebe";
import { calculateAssignedClaimAmount, type ClaimType } from "../claimAmount";

export const claimsRouter = Router();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Documents upload to MinIO (generic/object-storage-provisioning.md) — buffers
// held in memory just long enough to hand off to minioClient.putObject, never
// written to local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// multer's errors (e.g. LIMIT_FILE_SIZE) are passed to Express's `next(err)`,
// not thrown into the route handler's try/catch — without this wrapper they
// fall through to Express's default error handler, which returns a bare 500
// with no JSON body the frontend can read a message out of.
function uploadDocuments(req: Request, res: Response, next: NextFunction) {
  upload.array("documents")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res
          .status(400)
          .json({ message: `Each file must be ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB or smaller.` });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      console.error("Document upload failed:", err);
      return res.status(500).json({ message: "Uploading the documents failed." });
    }
    next();
  });
}

// GET /api/claims — all claims, or /api/claims?policyNumber=... to scope to one
// policy (Follow-up dependency #1 in .claude/specs/generic/claimant-portal-ui.md).
claimsRouter.get("/", async (req, res) => {
  const policyNumber = req.query.policyNumber;

  try {
    const result =
      typeof policyNumber === "string" && policyNumber.trim()
        ? await pool.query(`SELECT * FROM claims WHERE policy_number = $1 ORDER BY created_at DESC`, [
            policyNumber.trim(),
          ])
        : await pool.query(`SELECT * FROM claims ORDER BY created_at DESC`);
    res.json(result.rows.map(serializeClaim));
  } catch (err) {
    console.error("GET /api/claims failed:", err);
    res.status(500).json({ message: "Couldn't load claims." });
  }
});

// GET /api/claims/:id — SPEC.md §7's single-claim status endpoint. Includes
// this claim's documents so the claim detail page can offer a view toggle.
claimsRouter.get("/:id", async (req, res) => {
  try {
    const claimResult = await pool.query(`SELECT * FROM claims WHERE id = $1`, [req.params.id]);
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ message: "Claim not found." });
    }
    const documentsResult = await pool.query(
      `SELECT * FROM claim_documents WHERE claim_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    res.json({
      ...serializeClaim(claimResult.rows[0]),
      documents: documentsResult.rows.map(serializeClaimDocument),
    });
  } catch (err) {
    console.error("GET /api/claims/:id failed:", err);
    res.status(500).json({ message: "Couldn't load that claim." });
  }
});

// POST /api/claims — SPEC.md §5/§7 (BUILD-PLAN.md feature #3), plus Zeebe
// process kickoff (BUILD-PLAN.md feature #4 —
// .claude/specs/generic/process-orchestration-kickoff.md).
claimsRouter.post("/", uploadDocuments, async (req, res) => {
  const { policyNumber, claimType, claimantName, claimantEmail, incidentDate, incidentDescription, claimAmount } =
    req.body;

  if (!policyNumber || !claimType || !claimantName || !claimantEmail || !incidentDate || !incidentDescription || !claimAmount) {
    return res.status(400).json({ message: "Missing required claim fields." });
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return res.status(400).json({ message: "At least one supporting document is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const policyResult = await client.query(
      `SELECT id, carrier_id, insurance_type, coverage_amount, deductible_amount, copay_amount, coinsurance_rate
       FROM policies WHERE policy_number = $1`,
      [policyNumber]
    );
    if (policyResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: `No policy found for ${policyNumber}.` });
    }
    const policy = policyResult.rows[0];

    // The ceiling a claimant may submit for — simulated adjudication
    // (backend/api/src/claimAmount.ts), not a free-form amount. Mirrored
    // client-side so the form pre-fills/caps to the same figure; re-checked
    // here since the client-side cap is trivially bypassable.
    const assignedAmount = calculateAssignedClaimAmount(claimType as ClaimType, {
      deductibleAmount: Number(policy.deductible_amount),
      copayAmount: Number(policy.copay_amount),
      coinsuranceRate: Number(policy.coinsurance_rate),
      coverageAmount: Number(policy.coverage_amount),
    });
    if (Number(claimAmount) > assignedAmount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Claim amount can't exceed the assigned amount for this claim (${assignedAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}).`,
      });
    }
    if (Number(claimAmount) <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Claim amount must be greater than 0." });
    }

    const claimResult = await client.query(
      `INSERT INTO claims (
         carrier_id, insurance_type, policy_number, policy_id, claim_type,
         claimant_name, claimant_email, incident_date, incident_description,
         claim_amount, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitted')
       RETURNING *`,
      [
        policy.carrier_id,
        policy.insurance_type,
        policyNumber,
        policy.id,
        claimType,
        claimantName,
        claimantEmail,
        incidentDate,
        incidentDescription,
        claimAmount,
      ]
    );
    const claim = claimResult.rows[0];

    for (const file of files) {
      const objectKey = `${Date.now()}-${file.originalname}`;
      await minioClient.putObject(BUCKET, objectKey, file.buffer, file.size, {
        "Content-Type": file.mimetype,
      });
      await client.query(
        `INSERT INTO claim_documents (claim_id, file_url) VALUES ($1, $2)`,
        [claim.id, publicUrl(objectKey)]
      );
    }

    // SPEC.md §13 — every write path leaves an audit_log row.
    await client.query(
      `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
       VALUES ($1, 'system', 'backend/api', 'submitted', $2)`,
      [claim.id, JSON.stringify({ source: "claimant-portal", documentCount: files.length })]
    );

    await client.query("COMMIT");

    // Process kickoff happens after commit, outside the DB transaction: the
    // claim/document rows are the durable record of submission regardless of
    // whether Zeebe is reachable. A failure here leaves a claim with a NULL
    // process_instance_key — a visible, queryable gap (WHERE
    // process_instance_key IS NULL), not a silent one; see "Failure handling"
    // in .claude/specs/generic/process-orchestration-kickoff.md.
    try {
      const { processInstanceKey } = await zeebeClient.createProcessInstance({
        bpmnProcessId: CLAIM_CASE_PROCESS_ID,
        variables: {
          claimId: claim.id,
          carrierId: claim.carrier_id,
          insuranceType: claim.insurance_type,
          policyNumber: claim.policy_number,
          claimType: claim.claim_type,
          claimAmount: claim.claim_amount,
        },
      });

      await pool.query(`UPDATE claims SET process_instance_key = $1 WHERE id = $2`, [
        processInstanceKey,
        claim.id,
      ]);
      claim.process_instance_key = processInstanceKey;

      await pool.query(
        `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
         VALUES ($1, 'system', 'backend/api', 'process-started', $2)`,
        [claim.id, JSON.stringify({ processInstanceKey })]
      );
    } catch (zeebeErr) {
      console.error(`Starting the process instance for claim ${claim.id} failed:`, zeebeErr);
    }

    res.status(201).json(serializeClaim(claim));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/claims failed:", err);
    res.status(500).json({ message: "Submitting the claim failed." });
  } finally {
    client.release();
  }
});
