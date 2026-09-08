import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { notifyRole } from "../shared/reviewer-notifications";
import { computeBusinessDeadline } from "../shared/business-days";

// .claude/specs/generic/sla-review-escalation.md — auto-escalate-review.
// Fires from Adjuster/Investigator/Legal Review's interrupting timer
// boundary event (24 business hours, see backend/shared/business-days.ts)
// when nobody completes the review in time. One-way, single hop:
// adjuster -> investigator -> legal -> supervisor (Legal Review is the
// DMN's top tier, so its timeout falls back to the new Supervisor Review
// task rather than a further role review). `toRole` is which BPMN
// exclusive-gateway branch fired this instance of the worker — set as a
// literal per boundary event, not derived here.
interface AutoEscalateReviewVariables {
  claimId: string;
  fromRole: "adjuster" | "investigator" | "legal";
  toRole: "investigator" | "legal" | "supervisor";
}

// `toRole` values aren't the same strings as users.role for legal
// ("legal-reviewer") — .claude/specs/generic/reviewer-task-notification-emails.md.
const TO_ROLE_TO_USER_ROLE: Record<string, string> = {
  investigator: "investigator",
  legal: "legal-reviewer",
  supervisor: "supervisor",
};
const TO_ROLE_TO_TASK_LABEL: Record<string, string> = {
  investigator: "Investigator Review",
  legal: "Legal Review",
  supervisor: "Supervisor Review",
};
const FROM_ROLE_TO_TASK_LABEL: Record<string, string> = {
  adjuster: "Adjuster Review",
  investigator: "Investigator Review",
  legal: "Legal Review",
};

const JOB_TYPE = "auto-escalate-review";

interface AutoEscalateReviewOutput {
  confirmedRole: string;
  slaDeadline: string;
}

zeebeClient.createWorker<AutoEscalateReviewVariables, Record<string, unknown>, AutoEscalateReviewOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, fromRole, toRole } = job.variables;

    await pool.query(`UPDATE claims SET confirmed_role = $1, updated_at = now() WHERE id = $2`, [toRole, claimId]);

    // capture-review-decision (SPEC.md §12) reads `confirmedRole` as a
    // process variable, not from `claims` — must be set explicitly here or
    // it stays stale at whatever the original Triage Review confirmed,
    // desyncing the process variable from the `claims` row this just wrote.

    const { notifiedCount: reviewersNotified } = await notifyRole(
      TO_ROLE_TO_USER_ROLE[toRole],
      claimId,
      TO_ROLE_TO_TASK_LABEL[toRole],
      FROM_ROLE_TO_TASK_LABEL[fromRole]
    );

    const slaDeadline = computeBusinessDeadline(new Date()).toISOString();

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "review_sla_escalated",
      detail: { slaBusinessHours: 24, fromRole, toRole, reviewersNotified, slaDeadline },
    });

    return job.complete({ confirmedRole: toRole, slaDeadline });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
