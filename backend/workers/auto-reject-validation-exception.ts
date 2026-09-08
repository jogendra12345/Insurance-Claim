import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// .claude/specs/generic/sla-review-escalation.md — auto-reject-validation-exception.
// Fires from Validation Exception Review's interrupting timer boundary event
// (24 business hours, see backend/shared/business-days.ts) when nobody
// resolves or rejects the exception in time. Same shape as
// capture-validation-exception's "reject" branch, except actor_type is
// "system" (a timeout, not a human decision) and the reason is fixed rather
// than reviewer-entered. No notifyRole() call — this denies the claim
// rather than opening a new review task.
interface AutoRejectValidationExceptionVariables {
  claimId: string;
}

const JOB_TYPE = "auto-reject-validation-exception";
const DENIAL_REASON = "Auto-rejected: validation exception unresolved after 24 business hours";

zeebeClient.createWorker<AutoRejectValidationExceptionVariables, Record<string, unknown>, { decision: "deny" }>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId } = job.variables;

    await pool.query(
      `UPDATE claims SET decision = 'deny', denial_reason = $1, status = 'denied', updated_at = now() WHERE id = $2`,
      [DENIAL_REASON, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "validation_exception_auto_rejected",
      detail: { slaBusinessHours: 24, denialReason: DENIAL_REASON },
    });

    // Merges into the shared denial path (draft-denial-letter →
    // notify-claimant → close-case), same as every other reject branch —
    // must be set explicitly since this branch never runs
    // ValidationExceptionReviewForm.
    return job.complete({ decision: "deny" });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
