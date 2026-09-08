import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { notifyRole } from "../shared/reviewer-notifications";
import { computeBusinessDeadline } from "../shared/business-days";

// .claude/specs/generic/sla-review-escalation.md — auto-confirm-triage.
// Fires from Triage Review's interrupting timer boundary event (24 business
// hours, see backend/shared/business-days.ts) when nobody reviews or
// rejects it in time. Equivalent to a human choosing triageAction="review"
// and accepting assignedRole as-is (capture-triage-review's "review"
// branch), except actor_type is "system" and this is a separate worker
// (capture-triage-review is only ever reached via a real Triage Review task
// completion, so it can't be reused here).
interface AutoConfirmTriageVariables {
  claimId: string;
  assignedRole: string;
}

// confirmedRole values ("legal") aren't the same strings as users.role
// ("legal-reviewer") — .claude/specs/generic/reviewer-task-notification-emails.md.
const CONFIRMED_ROLE_TO_USER_ROLE: Record<string, string> = {
  adjuster: "adjuster",
  investigator: "investigator",
  legal: "legal-reviewer",
};
const CONFIRMED_ROLE_TO_TASK_LABEL: Record<string, string> = {
  adjuster: "Adjuster Review",
  investigator: "Investigator Review",
  legal: "Legal Review",
};

const JOB_TYPE = "auto-confirm-triage";

interface AutoConfirmTriageOutput {
  confirmedRole: string;
  slaDeadline: string;
}

zeebeClient.createWorker<AutoConfirmTriageVariables, Record<string, unknown>, AutoConfirmTriageOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, assignedRole } = job.variables;

    await pool.query(
      `UPDATE claims SET confirmed_role = $1, status = 'in_review', updated_at = now() WHERE id = $2`,
      [assignedRole, claimId]
    );

    const { notifiedCount: reviewersNotified } = await notifyRole(
      CONFIRMED_ROLE_TO_USER_ROLE[assignedRole],
      claimId,
      CONFIRMED_ROLE_TO_TASK_LABEL[assignedRole],
      "Triage Review"
    );

    const slaDeadline = computeBusinessDeadline(new Date()).toISOString();

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "triage_auto_confirmed",
      detail: { slaBusinessHours: 24, confirmedRole: assignedRole, reviewersNotified, slaDeadline },
    });

    return job.complete({ confirmedRole: assignedRole, slaDeadline });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
