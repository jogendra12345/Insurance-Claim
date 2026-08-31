import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-validation-exception. Branches on resolutionAction:
// "resolve" lets a reviewer continue a claim into extract-evidence
// regardless of why validationPassed came back false, including "no policy
// matched at all" (claims.policy_id stays NULL in that case) — a deliberate
// human-override per SPEC.md §10 step 3; "reject" denies the claim, same
// shape as capture-triage-review's reject branch. There is deliberately no
// way to change the policy number here — see SPEC.md §9/§10 "Resolve"
// semantics.
interface CaptureValidationExceptionVariables {
  claimId: string;
  resolutionAction: "resolve" | "reject";
  denialReason?: string;
}

const JOB_TYPE = "capture-validation-exception";

interface CaptureValidationExceptionOutput {
  decision?: "deny";
}

zeebeClient.createWorker<CaptureValidationExceptionVariables, Record<string, unknown>, CaptureValidationExceptionOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, resolutionAction, denialReason } = job.variables;

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
      // Same reasoning as capture-triage-review's reject branch: this
      // merges into the shared denial path (draft-denial-letter →
      // notify-claimant → close-case), all of which take `decision` as a
      // process-variable input — must be set explicitly here since
      // ValidationExceptionReviewForm doesn't produce it.
      return job.complete({ decision: "deny" });
    }

    const { rows: claimRows } = await pool.query(`SELECT * FROM claims WHERE id = $1`, [claimId]);
    const claim = claimRows[0];
    if (!claim) {
      throw new Error(`capture-validation-exception: no claims row for claimId ${claimId}`);
    }

    await pool.query(`UPDATE claims SET status = 'validating', updated_at = now() WHERE id = $1`, [claimId]);

    await writeAuditLog({
      claimId, actorType: "human", actorId: "tasklist",
      action: "validation_exception_resolved",
      // Surfaces the override explicitly in the audit trail whenever this
      // resolve happened with no matched policy — the reviewer's sole
      // check, since no downstream step re-validates coverage/status/date
      // range for a claim with policy_id still NULL (SPEC.md §10 step 3).
      detail: { policyId: claim.policy_id, overrodeNoPolicyMatch: !claim.policy_id },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
