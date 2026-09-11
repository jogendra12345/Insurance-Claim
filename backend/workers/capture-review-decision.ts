import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { notifyRole } from "../shared/reviewer-notifications";

// Mirrors the "Needs Second Sign-off?" gateway's condition in
// process/claim-case-process.bpmn (SPEC.md §10 step 15) — kept in sync by
// hand; see .claude/specs/generic/reviewer-task-notification-emails.md's
// Open Questions for the drift risk this duplication carries.
const SUPERVISOR_SIGNOFF_THRESHOLD = 50000;

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
  infoRequestedReason?: string;
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
    const { claimId, decision, denialReason, infoRequestedReason, confirmedRole } = job.variables;
    const status = STATUS_BY_DECISION[decision];

    // The review task's form requires `decision` and `denialReason` (when
    // denying) or `infoRequestedReason` (when requesting more info), but
    // fail loudly into a visible Operate incident rather than writing an
    // invalid/incomplete row if it's ever missing anyway — e.g. someone
    // completes the task via the raw API instead of the form.
    if (!status) {
      throw new Error(
        `capture-review-decision: decision must be one of ${Object.keys(STATUS_BY_DECISION).join(", ")}, got ${JSON.stringify(decision)}`
      );
    }
    if (decision === "deny" && !denialReason) {
      throw new Error("capture-review-decision: denialReason is required when decision is 'deny'");
    }
    if (decision === "moreInfo" && !infoRequestedReason) {
      throw new Error("capture-review-decision: infoRequestedReason is required when decision is 'moreInfo'");
    }

    await pool.query(
      `UPDATE claims SET decision = $1, denial_reason = $2, info_requested_reason = $3, status = $4, updated_at = now() WHERE id = $5`,
      [decision, denialReason ?? null, infoRequestedReason ?? null, status, claimId]
    );

    let reviewersNotified: number | null = null;
    if (decision === "approve") {
      const { rows } = await pool.query(`SELECT claim_amount FROM claims WHERE id = $1`, [claimId]);
      const claimAmount = Number(rows[0]?.claim_amount ?? 0);
      if (claimAmount > SUPERVISOR_SIGNOFF_THRESHOLD) {
        reviewersNotified = (await notifyRole("supervisor", claimId, "Supervisor Sign-off")).notifiedCount;
      }
    }

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "decision_recorded",
      detail: {
        decision,
        denialReason: denialReason ?? null,
        infoRequestedReason: infoRequestedReason ?? null,
        confirmedRole,
        reviewersNotified,
      },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
