import { Router } from "express";
import multer from "multer";
import { pool } from "../db";
import { serializeClaim } from "../serializers";
import { BUCKET, minioClient, publicUrl } from "../storage";

export const claimsRouter = Router();

// Documents upload to MinIO (generic/object-storage-provisioning.md) — buffers
// held in memory just long enough to hand off to minioClient.putObject, never
// written to local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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

// GET /api/claims/:id — SPEC.md §7's single-claim status endpoint.
claimsRouter.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM claims WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Claim not found." });
    }
    res.json(serializeClaim(result.rows[0]));
  } catch (err) {
    console.error("GET /api/claims/:id failed:", err);
    res.status(500).json({ message: "Couldn't load that claim." });
  }
});

// POST /api/claims — SPEC.md §5/§7 (BUILD-PLAN.md feature #3). Zeebe process
// kickoff (BUILD-PLAN.md feature #4) isn't wired up yet — this only writes the
// claims/claim_documents/audit_log rows for now.
claimsRouter.post("/", upload.array("documents"), async (req, res) => {
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
      `SELECT id, carrier_id, insurance_type FROM policies WHERE policy_number = $1`,
      [policyNumber]
    );
    if (policyResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: `No policy found for ${policyNumber}.` });
    }
    const policy = policyResult.rows[0];

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
    res.status(201).json(serializeClaim(claim));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/claims failed:", err);
    res.status(500).json({ message: "Submitting the claim failed." });
  } finally {
    client.release();
  }
});
