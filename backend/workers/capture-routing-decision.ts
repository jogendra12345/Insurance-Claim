import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { notifyRole } from "../shared/reviewer-notifications";
import { computeBusinessDeadline } from "../shared/business-days";

// SPEC.md §12 — capture-routing-decision. Bridges the DMN business rule
// task's `assignedRole` process variable onto the `claims` row: the DMN
// decision itself has no way to write to Postgres, so this service task
// runs right after it (see process/claim-case-process.bpmn).
interface CaptureRoutingDecisionVariables {
  claimId: string;
  assignedRole: string;
}

const JOB_TYPE = "capture-routing-decision";

interface CaptureRoutingDecisionOutput {
  slaDeadline: string;
}

zeebeClient.createWorker<CaptureRoutingDecisionVariables, Record<string, unknown>, CaptureRoutingDecisionOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, assignedRole } = job.variables;

    await pool.query(
      `UPDATE claims SET assigned_role = $1, status = 'triage', updated_at = now() WHERE id = $2`,
      [assignedRole, claimId]
    );

    const { notifiedCount } = await notifyRole("triage-team", claimId, "Triage Review");

    // .claude/specs/generic/sla-review-escalation.md — Triage Review's
    // interrupting timer boundary event reads this via a `timeDate` FEEL
    // expression; auto-confirm-triage fires if nobody completes the task
    // by this deadline.
    const slaDeadline = computeBusinessDeadline(new Date()).toISOString();

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "routed",
      detail: { assignedRole, reviewersNotified: notifiedCount, slaDeadline },
    });

    return job.complete({ slaDeadline });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
