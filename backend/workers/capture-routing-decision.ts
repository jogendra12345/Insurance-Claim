import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-routing-decision. Bridges the DMN business rule
// task's `assignedRole` process variable onto the `claims` row: the DMN
// decision itself has no way to write to Postgres, so this service task
// runs right after it (see process/claim-case-process.bpmn).
interface CaptureRoutingDecisionVariables {
  claimId: string;
  assignedRole: string;
}

const JOB_TYPE = "capture-routing-decision";

zeebeClient.createWorker<CaptureRoutingDecisionVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, assignedRole } = job.variables;

    await pool.query(
      `UPDATE claims SET assigned_role = $1, status = 'triage', updated_at = now() WHERE id = $2`,
      [assignedRole, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "routed",
      detail: { assignedRole },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
