import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-validation-exception. Branches on resolutionAction:
// "resolve" lets a reviewer correct a data issue (e.g. a mistyped policy
// number) and continue into extract-evidence; "reject" denies the claim,
// same shape as capture-triage-review's reject branch.
interface CaptureValidationExceptionVariables {
  claimId: string;
  resolutionAction: "resolve" | "reject";
  correctedPolicyNumber?: string;
  resolutionNotes?: string;
  denialReason?: string;
}

const JOB_TYPE = "capture-validation-exception";

zeebeClient.createWorker<CaptureValidationExceptionVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, resolutionAction, correctedPolicyNumber, resolutionNotes, denialReason } = job.variables;

    if (resolutionAction === "reject") {
      if (!denialReason) {
        throw new Error("capture-validation-exception: denialReason is required when resolutionAction is 'reject'");
      }
      await pool.query(
        `UPDATE claims SET decision = 'deny', denial_reason = $1, status = 'denied', updated_at = now() WHERE id = $2`,
        [denialReason, claimId]
      );
      await writeAuditLog({
        claimId, actorType: "human", actorId: "tasklist",
        action: "validation_exception_rejected",
        detail: { denialReason },
      });
      return job.complete({});
    }

    const { rows: claimRows } = await pool.query(`SELECT * FROM claims WHERE id = $1`, [claimId]);
    const claim = claimRows[0];
    if (!claim) {
      throw new Error(`capture-validation-exception: no claims row for claimId ${claimId}`);
    }

    let policyMatchedAfterResolve = false;
    if (correctedPolicyNumber) {
      const { rows: policyRows } = await pool.query(
        `SELECT * FROM policies
         WHERE policy_number = $1 AND carrier_id = $2
           AND status = 'active'
           AND $3::date BETWEEN effective_date AND expiry_date`,
        [correctedPolicyNumber, claim.carrier_id, claim.incident_date]
      );
      const policy = policyRows[0] as { id: string } | undefined;
      policyMatchedAfterResolve = !!policy;
      await pool.query(
        `UPDATE claims SET policy_number = $1, policy_id = $2, status = 'validating', updated_at = now() WHERE id = $3`,
        [correctedPolicyNumber, policy?.id ?? null, claimId]
      );
    } else {
      await pool.query(`UPDATE claims SET status = 'validating', updated_at = now() WHERE id = $1`, [claimId]);
    }

    await writeAuditLog({
      claimId, actorType: "human", actorId: "tasklist",
      action: "validation_exception_resolved",
      detail: { correctedPolicyNumber: correctedPolicyNumber ?? null, policyMatchedAfterResolve, resolutionNotes: resolutionNotes ?? null },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
