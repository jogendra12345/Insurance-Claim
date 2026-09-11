import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { notifyRole } from "../shared/reviewer-notifications";

// .claude/specs/generic/claimant-more-info-resubmission.md —
// capture-claimant-resubmission. Runs after the claimant completes
// Task_ClaimantProvideMoreInfo (via POST /api/claims/:id/resubmit), right
// before the process routes back to whichever role requested the info.
// The API-layer act of submitting already wrote its own audit_log row
// (`claimant_resubmission_submitted`); this is the process-layer act of the
// BPMN task completing (`claimant_resubmitted`).
interface CaptureClaimantResubmissionVariables {
  claimId: string;
  confirmedRole: "adjuster" | "investigator" | "legal" | "supervisor";
  resubmittedByUserId: string;
  documentCount: number;
}

// `confirmedRole` values aren't the same strings as users.role for legal
// ("legal-reviewer") — same mapping auto-escalate-review.ts already uses.
const ROLE_TO_USER_ROLE: Record<string, string> = {
  adjuster: "adjuster",
  investigator: "investigator",
  legal: "legal-reviewer",
  supervisor: "supervisor",
};
const ROLE_TO_TASK_LABEL: Record<string, string> = {
  adjuster: "Adjuster Review",
  investigator: "Investigator Review",
  legal: "Legal Review",
  supervisor: "Supervisor Review",
};

const JOB_TYPE = "capture-claimant-resubmission";

zeebeClient.createWorker<CaptureClaimantResubmissionVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, confirmedRole, resubmittedByUserId, documentCount } = job.variables;

    await pool.query(`UPDATE claims SET status = 'in_review', updated_at = now() WHERE id = $1`, [claimId]);

    const { rows } = await pool.query(`SELECT info_requested_reason FROM claims WHERE id = $1`, [claimId]);
    const infoRequestedReason = rows[0]?.info_requested_reason ?? null;

    // Best-effort: the reopened task is real regardless of whether this
    // email goes out (same reasoning as every other notifyRole() call).
    const { notifiedCount: reviewersNotified } = await notifyRole(
      ROLE_TO_USER_ROLE[confirmedRole],
      claimId,
      ROLE_TO_TASK_LABEL[confirmedRole]
    );

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: resubmittedByUserId,
      action: "claimant_resubmitted",
      detail: { infoRequestedReason, documentsAdded: documentCount, confirmedRole, reviewersNotified },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
