import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { requireAuth, STAFF_ROLES } from "../auth";
import { pool } from "../db";
import { sendEmail } from "../../../shared/email-sender";
import { serializeAuditLogEntry, serializeClaim, serializeClaimDocument, serializeFraudIndicator } from "../serializers";
import { BUCKET, minioClient, publicUrl } from "../storage";
import { camundaRestClient } from "../zeebe";
import { ClaimValidationError, createClaim } from "../create-claim";

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

// .claude/specs/generic/auth-role-based-access.md "Scoping existing
// endpoints" — claimant sees only claims.claimant_email = their own email
// (case-insensitive, same match validate-claim uses); every staff role
// (including admin) is unscoped.
claimsRouter.get("/", requireAuth, async (req, res) => {
  const policyNumber = req.query.policyNumber;
  const scopeToOwnClaims = req.user!.role === "claimant";

  try {
    const conditions: string[] = [];
    const params: string[] = [];
    if (typeof policyNumber === "string" && policyNumber.trim()) {
      params.push(policyNumber.trim());
      conditions.push(`claims.policy_number = $${params.length}`);
    }
    if (scopeToOwnClaims) {
      params.push(req.user!.email);
      conditions.push(`lower(claims.claimant_email) = lower($${params.length})`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `${CLAIM_SELECT_WITH_PROVIDER} ${where} ORDER BY claims.created_at DESC`,
      params
    );
    res.json(result.rows.map(serializeClaim));
  } catch (err) {
    console.error("GET /api/claims failed:", err);
    res.status(500).json({ message: "Couldn't load claims." });
  }
});

// GET /api/claims/:id — SPEC.md §7's single-claim status endpoint. Includes
// this claim's documents so the claim detail page can offer a view toggle.
claimsRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    const claimResult = await pool.query(`${CLAIM_SELECT_WITH_PROVIDER} WHERE claims.id = $1`, [req.params.id]);
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ message: "Claim not found." });
    }
    if (
      req.user!.role === "claimant" &&
      claimResult.rows[0].claimant_email.toLowerCase() !== req.user!.email.toLowerCase()
    ) {
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

// GET /api/claims/:id/audit-log — staff-only (.claude/specs/generic/staff-audit-trail-view.md).
// Optional ?actorType=system|ai|human and ?from=/?to= narrow a long-lived
// claim's history; omitting all three returns the full trail. `from`/`to`
// are full ISO instants, not bare dates — the frontend resolves the
// caller's local calendar-day picks (a plain <input type="date">, no
// timezone of its own) into precise UTC instants client-side, using that
// browser's own timezone, before sending them here
// (.claude/specs/generic/time-zone-standardization.md) — so this route just
// compares instants directly and holds no timezone opinion of its own.
// Newest first (most recent action at the top) — the frontend renders
// rows in whatever order this returns, no client-side re-sort.
claimsRouter.get("/:id/audit-log", requireAuth, async (req, res) => {
  if (!STAFF_ROLES.includes(req.user!.role)) {
    return res.status(403).json({ message: "Not allowed for your role." });
  }
  try {
    const claimResult = await pool.query(`SELECT id FROM claims WHERE id = $1`, [req.params.id]);
    if (claimResult.rowCount === 0) {
      return res.status(404).json({ message: "Claim not found." });
    }
    const conditions: string[] = ["claim_id = $1"];
    const params: string[] = [req.params.id];
    const { actorType, from, to } = req.query;
    if (typeof actorType === "string" && actorType.trim()) {
      params.push(actorType.trim());
      conditions.push(`actor_type = $${params.length}`);
    }
    if (typeof from === "string" && from.trim()) {
      params.push(from.trim());
      conditions.push(`created_at >= $${params.length}::timestamptz`);
    }
    if (typeof to === "string" && to.trim()) {
      params.push(to.trim());
      conditions.push(`created_at < $${params.length}::timestamptz`);
    }
    const result = await pool.query(
      `SELECT * FROM audit_log WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      params
    );
    res.json(result.rows.map(serializeAuditLogEntry));
  } catch (err) {
    console.error("GET /api/claims/:id/audit-log failed:", err);
    res.status(500).json({ message: "Couldn't load that claim's audit history." });
  }
});

// .claude/specs/generic/claimant-more-info-resubmission.md — the BPMN
// element ID of the claimant-facing user task, located by processInstanceKey
// rather than through the staff /api/tasks candidate-group proxy (this task
// carries no candidate group at all — see the spec's Design section).
const CLAIMANT_PROVIDE_MORE_INFO_ELEMENT_ID = "Task_ClaimantProvideMoreInfo";

function ensureOwnClaim(req: Request, claim: { claimant_email: string } | undefined, res: Response): boolean {
  if (!claim) {
    res.status(404).json({ message: "Claim not found." });
    return false;
  }
  if (req.user!.role !== "claimant" || claim.claimant_email.toLowerCase() !== req.user!.email.toLowerCase()) {
    res.status(403).json({ message: "Not allowed for this claim." });
    return false;
  }
  return true;
}

// GET /api/claims/:id/pending-task — claimant-only. Returns the open
// Task_ClaimantProvideMoreInfo task for this claim (if any), or null.
claimsRouter.get("/:id/pending-task", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT claimant_email, status, process_instance_key, info_requested_reason FROM claims WHERE id = $1`, [
      req.params.id,
    ]);
    if (!ensureOwnClaim(req, rows[0], res)) return;
    const claim = rows[0];

    if (claim.status !== "awaiting_info" || !claim.process_instance_key) {
      return res.json({ task: null });
    }

    const { items } = await camundaRestClient.searchUserTasks({
      filter: {
        state: "CREATED",
        processInstanceKey: claim.process_instance_key,
        elementId: CLAIMANT_PROVIDE_MORE_INFO_ELEMENT_ID,
      },
    });
    const task = items[0];
    if (!task) {
      return res.json({ task: null });
    }
    res.json({
      task: {
        taskKey: task.userTaskKey,
        reason: claim.info_requested_reason,
        openedAt: task.creationDate,
      },
    });
  } catch (err) {
    console.error("GET /api/claims/:id/pending-task failed:", err);
    res.status(500).json({ message: "Couldn't check for a pending task." });
  }
});

// POST /api/claims/:id/resubmit — claimant-only. Adds documents (and an
// optional note) to a claim awaiting more info, then completes the
// underlying Zeebe user task so the process resumes back to the reviewing
// role that asked.
claimsRouter.post("/:id/resubmit", uploadDocuments, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Login required." });
  }

  const client = await pool.connect();
  try {
    const claimResult = await client.query(
      `SELECT claimant_email, status, process_instance_key, confirmed_role, info_requested_reason FROM claims WHERE id = $1`,
      [req.params.id]
    );
    if (!ensureOwnClaim(req, claimResult.rows[0], res)) {
      return;
    }
    const claim = claimResult.rows[0];

    if (claim.status !== "awaiting_info" || !claim.process_instance_key) {
      return res.status(400).json({ message: "This claim isn't waiting on more information right now." });
    }

    const { items } = await camundaRestClient.searchUserTasks({
      filter: {
        state: "CREATED",
        processInstanceKey: claim.process_instance_key,
        elementId: CLAIMANT_PROVIDE_MORE_INFO_ELEMENT_ID,
      },
    });
    const task = items[0];
    if (!task) {
      return res.status(400).json({ message: "There's no open request for more information on this claim." });
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";

    await client.query("BEGIN");
    for (const file of files) {
      const objectKey = `${Date.now()}-${file.originalname}`;
      await minioClient.putObject(BUCKET, objectKey, file.buffer, file.size, {
        "Content-Type": file.mimetype,
      });
      await client.query(`INSERT INTO claim_documents (claim_id, file_url) VALUES ($1, $2)`, [
        req.params.id,
        publicUrl(objectKey),
      ]);
    }

    // SPEC.md §13 — the API-layer act of submitting the resubmission gets
    // its own audit_log row, distinct from capture-claimant-resubmission's
    // process-layer row for the BPMN task completing.
    await client.query(
      `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
       VALUES ($1, 'human', $2, 'claimant_resubmission_submitted', $3)`,
      [req.params.id, req.user.userId, JSON.stringify({ note: note || null, documentCount: files.length })]
    );
    await client.query("COMMIT");

    await camundaRestClient.completeUserTask({
      userTaskKey: task.userTaskKey,
      variables: {
        claimId: req.params.id,
        resubmittedByUserId: req.user.userId,
        documentCount: files.length,
      },
    });

    // Best-effort confirmation email — a failed send doesn't block the
    // resubmission itself, same posture notify-claimant already takes on
    // provider failures.
    try {
      const claimUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/claims/${req.params.id}`;
      const claimantResult = await pool.query(`SELECT claimant_name, claimant_email FROM claims WHERE id = $1`, [req.params.id]);
      const claimant = claimantResult.rows[0];
      const testRecipient = "ayanchou2015@gmail.com";
      await sendEmail({
        to: testRecipient,
        subject: `[${claimant.claimant_email}] Your claim resubmission was received`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111827;"><p>Dear ${claimant.claimant_name},</p><p>We received the information you submitted, and your claim is back under review.</p><p><a href="${claimUrl}" style="color:#2563eb;">View your claim</a></p></div>`,
        text: `Dear ${claimant.claimant_name},\n\nWe received the information you submitted, and your claim is back under review.\n\nView your claim: ${claimUrl}`,
      });
    } catch (emailErr) {
      console.error(`Resubmission confirmation email failed for claim ${req.params.id}:`, emailErr);
    }

    const updatedResult = await pool.query(`${CLAIM_SELECT_WITH_PROVIDER} WHERE claims.id = $1`, [req.params.id]);
    res.json(serializeClaim(updatedResult.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /api/claims/:id/resubmit failed:", err);
    res.status(500).json({ message: "Submitting your update failed." });
  } finally {
    client.release();
  }
});

// POST /api/claims — SPEC.md §5/§7 (BUILD-PLAN.md feature #3), plus Zeebe
// process kickoff (BUILD-PLAN.md feature #4 —
// .claude/specs/generic/process-orchestration-kickoff.md), plus the FNOL
// extended fields (.claude/specs/db/fnol_extended_fields.md,
// .claude/specs/generic/fnol_form_ui_update.md). Validation/insert/Zeebe
// kickoff itself lives in ../create-claim.ts, shared with the WhatsApp
// webhook (.claude/specs/generic/claims-assistant.md) — this handler only
// adapts multipart/form-data into that shared function's input shape.
claimsRouter.post("/", uploadDocuments, async (req, res) => {
  const {
    policyNumber,
    claimType,
    claimantName,
    claimantEmail,
    claimantPhone,
    channel,
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

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  try {
    const claim = await createClaim(
      {
        policyNumber,
        claimType,
        claimantName,
        claimantEmail,
        claimantPhone,
        // channel defaults to 'portal' (today's only real portal-side value);
        // 'whatsapp' is only ever set by routes/whatsapp.ts.
        channel: channel === "whatsapp" ? "whatsapp" : "portal",
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
        coordinationOfBenefits: coordinationOfBenefits === "true",
        attested: attested === "true",
      },
      files
    );
    res.status(201).json(serializeClaim(claim));
  } catch (err) {
    if (err instanceof ClaimValidationError) {
      return res.status(400).json({ message: err.message });
    }
    console.error("POST /api/claims failed:", err);
    res.status(500).json({ message: "Submitting the claim failed." });
  }
});
