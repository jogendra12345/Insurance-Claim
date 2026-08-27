import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-validation-exception. Branches on resolutionAction:
// "resolve" lets a reviewer continue a claim into extract-evidence when the
// exception was a duplicate-in-flight-claim or unauthorized-claimant
// failure (claims.policy_id is already set in both cases — validate-claim
// sets it whenever a policy matched, regardless of why validationPassed
// came back false); "reject" denies the claim, same shape as
// capture-triage-review's reject branch. There is deliberately no way to
// change the policy number here — see SPEC.md §9/§10 "Resolve" semantics.
interface CaptureValidationExceptionVariables {
  claimId: string;
  resolutionAction: "resolve" | "reject";
  denialReason?: string;
}

const JOB_TYPE = "capture-validation-exception";

zeebeClient.createWorker<CaptureValidationExceptionVariables, Record<string, unknown>, Record<string, never>>({
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
      return job.complete({});
    }

    const { rows: claimRows } = await pool.query(`SELECT * FROM claims WHERE id = $1`, [claimId]);
    const claim = claimRows[0];
    if (!claim) {
      throw new Error(`capture-validation-exception: no claims row for claimId ${claimId}`);
    }

    // A reviewer can only resolve a claim onto a policy that genuinely
    // matched — if validate-claim never matched one (policy_id is still
    // null), there's nothing to resolve onto and no policy-number-correction
    // path exists anymore (see the interface comment above). This shouldn't
    // be reachable from the form (Resolve is only offered when a policy
    // matched), so treat it as a data-integrity problem, not a normal
    // business outcome: fail into an Operate incident per CLAUDE.md's
    // no-custom-error-boundary convention, rather than silently letting the
    // claim continue with no matched policy.
    if (!claim.policy_id) {
      throw new Error(
        `capture-validation-exception: cannot resolve claim ${claimId} — no policy was matched (policy_id is null)`
      );
    }

    await pool.query(`UPDATE claims SET status = 'validating', updated_at = now() WHERE id = $1`, [claimId]);

    await writeAuditLog({
      claimId, actorType: "human", actorId: "tasklist",
      action: "validation_exception_resolved",
      detail: {},
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
