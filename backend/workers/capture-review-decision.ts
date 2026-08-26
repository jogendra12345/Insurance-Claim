import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-review-decision. Bridges the role-specific review
// task's (Adjuster/Investigator/Legal) `decision`/`denialReason` output onto
// `claims`, and maps the decision to the claim's overall status. Sits on the
// single merged flow from all three review tasks before Gateway_Decision
// (process/claim-case-process.bpmn), so it runs exactly once regardless of
// which reviewer completed it.
interface CaptureReviewDecisionVariables {
  claimId: string;
  decision: "approve" | "deny" | "moreInfo";
  denialReason?: string;
  confirmedRole: string;
}

const STATUS_BY_DECISION: Record<CaptureReviewDecisionVariables["decision"], string> = {
  approve: "approved",
  deny: "denied",
  moreInfo: "awaiting_info",
};

const JOB_TYPE = "capture-review-decision";

zeebeClient.createWorker<CaptureReviewDecisionVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, decision, denialReason, confirmedRole } = job.variables;
    const status = STATUS_BY_DECISION[decision];

    await pool.query(
      `UPDATE claims SET decision = $1, denial_reason = $2, status = $3, updated_at = now() WHERE id = $4`,
      [decision, denialReason ?? null, status, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "decision_recorded",
      detail: { decision, denialReason: denialReason ?? null, confirmedRole },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
