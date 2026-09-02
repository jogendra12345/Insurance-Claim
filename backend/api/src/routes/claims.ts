import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { pool } from "../db";
import { serializeClaim, serializeClaimDocument, serializeFraudIndicator } from "../serializers";
import { BUCKET, minioClient, publicUrl } from "../storage";
import { CLAIM_CASE_PROCESS_ID, camundaRestClient, zeebeClient } from "../zeebe";

export const claimsRouter = Router();

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
// Tasklist's CSP (img-src: data: 'self' blob:) blocks <img> from loading a
// plain MinIO URL, so an inline preview needs a data: URI embedded directly
// in the process variable instead. Zeebe variables aren't meant to carry
// blobs, so this is capped well under the file upload limit — large images
// just don't get an inline preview (the document link still works for
// every file, this size cap only affects the bonus inline render).
const INLINE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

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
const CLAIM_SELECT_WITH_PROVIDER = `
  SELECT claims.*, p.npi AS provider_npi, p.tax_id AS provider_tax_id,
         p.facility_name AS provider_facility_name, p.facility_address AS provider_facility_address
  FROM claims
  LEFT JOIN providers p ON p.id = claims.provider_id
`;

claimsRouter.get("/", async (req, res) => {
  const policyNumber = req.query.policyNumber;

  try {
    const result =
      typeof policyNumber === "string" && policyNumber.trim()
        ? await pool.query(`${CLAIM_SELECT_WITH_PROVIDER} WHERE claims.policy_number = $1 ORDER BY claims.created_at DESC`, [
            policyNumber.trim(),
          ])
        : await pool.query(`${CLAIM_SELECT_WITH_PROVIDER} ORDER BY claims.created_at DESC`);
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
    const claimResult = await pool.query(`${CLAIM_SELECT_WITH_PROVIDER} WHERE claims.id = $1`, [req.params.id]);
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ message: "Claim not found." });
    }
    const documentsResult = await pool.query(
      `SELECT * FROM claim_documents WHERE claim_id = $1 ORDER BY created_at`,
      [req.params.id]
    );
    const fraudIndicatorsResult = await pool.query(
      `SELECT * FROM claim_fraud_indicators WHERE claim_id = $1 ORDER BY confidence DESC`,
      [req.params.id]
    );
    // Most recent human-actor audit_log row — when a reviewer (triage,
    // review-decision, sign-off, validation-exception) last acted on this
    // claim, distinct from claims.updated_at which AI/system steps bump too.
    const lastReviewerActionResult = await pool.query(
      `SELECT created_at FROM audit_log WHERE claim_id = $1 AND actor_type = 'human' ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json({
      ...serializeClaim(claimResult.rows[0]),
      documents: documentsResult.rows.map(serializeClaimDocument),
      fraudIndicators: fraudIndicatorsResult.rows.map(serializeFraudIndicator),
      lastReviewerActionAt: lastReviewerActionResult.rows[0]?.created_at ?? null,
    });
  } catch (err) {
    console.error("GET /api/claims/:id failed:", err);
    res.status(500).json({ message: "Couldn't load that claim." });
  }
});

// FNOL extended-field formats — .claude/specs/db/fnol_extended_fields.md.
// Same shapes the client validates; re-checked here since the client-side
// check is trivially bypassable.
const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/i;
const CPT_OR_HCPCS_PATTERN = /^(\d{5}|[A-Z]\d{4})$/i;
const NPI_PATTERN = /^[0-9]{10}$/;

// POST /api/claims — SPEC.md §5/§7 (BUILD-PLAN.md feature #3), plus Zeebe
// process kickoff (BUILD-PLAN.md feature #4 —
// .claude/specs/generic/process-orchestration-kickoff.md), plus the FNOL
// extended fields (.claude/specs/db/fnol_extended_fields.md,
// .claude/specs/generic/fnol_form_ui_update.md).
claimsRouter.post("/", uploadDocuments, async (req, res) => {
  const {
    policyNumber,
    claimType,
    claimantName,
    claimantEmail,
    incidentDate,
    incidentDescription,
    claimAmount,
    diagnosisCode,
    procedureCode,
    providerNpi,
    providerTaxId,
    facilityName,
    facilityAddress,
    serviceDateFrom,
    serviceDateTo,
    totalBilledAmount,
    coordinationOfBenefits,
    attested,
  } = req.body;

  if (
    !policyNumber ||
    !claimType ||
    !claimantName ||
    !claimantEmail ||
    !incidentDate ||
    !incidentDescription ||
    !claimAmount ||
    !diagnosisCode ||
    !procedureCode ||
    !providerNpi ||
    !providerTaxId ||
    !facilityName ||
    !facilityAddress ||
    !serviceDateFrom ||
    !totalBilledAmount ||
    coordinationOfBenefits === undefined ||
    coordinationOfBenefits === ""
  ) {
    return res.status(400).json({ message: "Missing required claim fields." });
  }
  if (attested !== "true") {
    return res.status(400).json({ message: "You must attest that the information provided is accurate to submit a claim." });
  }
  if (!ICD10_PATTERN.test(diagnosisCode)) {
    return res.status(400).json({ message: "Diagnosis code must be a valid ICD-10 code (e.g. E11.9)." });
  }
  if (!CPT_OR_HCPCS_PATTERN.test(procedureCode)) {
    return res.status(400).json({ message: "Procedure code must be a valid CPT (5 digits) or HCPCS (letter + 4 digits) code." });
  }
  if (!NPI_PATTERN.test(providerNpi)) {
    return res.status(400).json({ message: "Provider NPI must be exactly 10 digits." });
  }
  if (Number.isNaN(Number(totalBilledAmount)) || Number(totalBilledAmount) <= 0) {
    return res.status(400).json({ message: "Total billed amount must be greater than 0." });
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return res.status(400).json({ message: "At least one supporting document is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const policyResult = await client.query(
      `SELECT id, carrier_id, insurance_type, coverage_amount, policyholder_name FROM policies WHERE policy_number = $1`,
      [policyNumber]
    );
    if (policyResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: `No policy found for ${policyNumber}.` });
    }
    const policy = policyResult.rows[0];

    if (Number(claimAmount) > Number(policy.coverage_amount)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Requested claim amount must be less than or equal to the policy's coverage amount (${Number(policy.coverage_amount).toLocaleString()}).`,
      });
    }

    // Find-or-create the provider by NPI. Per the locked db spec: on a
    // match, reuse the existing row as-is — a newly submitted
    // facility/tax-id for an NPI already on file is discarded, not written.
    const existingProvider = await client.query(`SELECT * FROM providers WHERE npi = $1`, [providerNpi]);
    const providerRow =
      existingProvider.rowCount && existingProvider.rowCount > 0
        ? existingProvider.rows[0]
        : (
            await client.query(
              `INSERT INTO providers (npi, tax_id, facility_name, facility_address) VALUES ($1, $2, $3, $4) RETURNING *`,
              [providerNpi, providerTaxId, facilityName, facilityAddress]
            )
          ).rows[0];
    const providerId = providerRow.id;

    const claimResult = await client.query(
      `INSERT INTO claims (
         carrier_id, insurance_type, policy_number, policy_id, claim_type,
         claimant_name, claimant_email, incident_date, incident_description,
         claim_amount, status, provider_id, diagnosis_code, procedure_code,
         service_date_from, service_date_to, total_billed_amount,
         coordination_of_benefits, attestation_signed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'submitted', $11, $12, $13, $14, $15, $16, $17, now())
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
        providerId,
        diagnosisCode,
        procedureCode,
        serviceDateFrom,
        serviceDateTo || serviceDateFrom,
        totalBilledAmount,
        coordinationOfBenefits === "true",
      ]
    );
    const claim = claimResult.rows[0];
    // serializeClaim reads these joined-style column names — attach them
    // here so the POST response matches what GET returns, without a second
    // round-trip query.
    claim.provider_npi = providerRow.npi;
    claim.provider_tax_id = providerRow.tax_id;
    claim.provider_facility_name = providerRow.facility_name;
    claim.provider_facility_address = providerRow.facility_address;

    // Collected alongside the DB inserts so the Zeebe process variables set
    // below (for Tasklist form document links/previews) don't need a second
    // query. contentType lets the Tasklist form tell image uploads (which it
    // can preview inline via an "image" component) apart from PDFs (which it
    // can't — no native inline PDF viewer outside Camunda's own document
    // service, which this app doesn't use; see HOSTING.md-adjacent decision
    // in chat history).
    const documentVariables: Array<{ name: string; url: string; contentType: string; dataUri: string | null }> = [];
    for (const file of files) {
      const objectKey = `${Date.now()}-${file.originalname}`;
      await minioClient.putObject(BUCKET, objectKey, file.buffer, file.size, {
        "Content-Type": file.mimetype,
      });
      const fileUrl = publicUrl(objectKey);
      await client.query(
        `INSERT INTO claim_documents (claim_id, file_url) VALUES ($1, $2)`,
        [claim.id, fileUrl]
      );
      const canInlinePreview = file.mimetype.startsWith("image/") && file.size <= INLINE_PREVIEW_MAX_BYTES;
      documentVariables.push({
        name: file.originalname,
        url: fileUrl,
        contentType: file.mimetype,
        dataUri: canInlinePreview ? `data:${file.mimetype};base64,${file.buffer.toString("base64")}` : null,
      });
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
          // pg returns `numeric` columns as strings to avoid float precision
          // loss — cast explicitly so FEEL comparisons in the DMN table and
          // BPMN gateway conditions (`claimAmount > 50000`) get a number,
          // not a string (a string there fails with NOT_COMPARABLE).
          claimAmount: Number(claim.claim_amount),
          // Below this line: not read by any BPMN/DMN condition — carried
          // purely so the Tasklist review forms (TriageReviewForm,
          // ReviewDecisionForm) can render a "Policy & claim details" and
          // "Documents" section without a custom review UI (CLAUDE.md).
          policyholderName: policy.policyholder_name,
          coverageAmount: Number(policy.coverage_amount),
          claimantName: claim.claimant_name,
          claimantEmail: claim.claimant_email,
          // pg parses `date` columns into JS Date objects, which the Zeebe
          // SDK rejects outright ("Date type not supported in variables") —
          // serialize explicitly, same reasoning as the claimAmount cast above.
          incidentDate: claim.incident_date.toISOString(),
          incidentDescription: claim.incident_description,
          diagnosisCode: claim.diagnosis_code,
          procedureCode: claim.procedure_code,
          serviceDateFrom: claim.service_date_from.toISOString(),
          serviceDateTo: claim.service_date_to ? claim.service_date_to.toISOString() : null,
          totalBilledAmount: Number(claim.total_billed_amount),
          coordinationOfBenefits: claim.coordination_of_benefits,
          providerFacilityName: providerRow.facility_name,
          providerNpi: providerRow.npi,
          documents: documentVariables,
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

      // Idempotency guard: createProcessInstance is not idempotent, and the
      // Zeebe gRPC client auto-retries it on transient broker errors. If an
      // earlier attempt's response timed out client-side but had already
      // reached the broker, a later retry starts a second process instance
      // for the same claimId — both then run concurrently against the same
      // claim. claimId is unique per submission (freshly generated above),
      // so any other instance carrying it is definitively a duplicate from
      // this retry race, never a legitimate second process. Detect and
      // cancel it here rather than leaving two instances racing each other.
      const claimIdVariables = await camundaRestClient.searchVariables({
        filter: { name: "claimId", value: JSON.stringify(claim.id) },
      });
      const duplicateProcessInstanceKeys = [
        ...new Set(
          claimIdVariables.items
            .map((variable: { processInstanceKey: string }) => variable.processInstanceKey)
            .filter((key: string) => key !== processInstanceKey)
        ),
      ];
      for (const duplicateKey of duplicateProcessInstanceKeys) {
        try {
          await camundaRestClient.cancelProcessInstance({ processInstanceKey: duplicateKey });
          await pool.query(
            `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
             VALUES ($1, 'system', 'backend/api', 'duplicate-process-cancelled', $2)`,
            [claim.id, JSON.stringify({ cancelledProcessInstanceKey: duplicateKey, keptProcessInstanceKey: processInstanceKey })]
          );
        } catch (cancelErr) {
          // Already completed/cancelled, or a genuine race with another
          // cleanup — not fatal either way, the kept instance is unaffected.
          console.error(`Failed to cancel duplicate process instance ${duplicateKey} for claim ${claim.id}:`, cancelErr);
        }
      }
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
