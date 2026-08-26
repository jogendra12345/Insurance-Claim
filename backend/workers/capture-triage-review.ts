import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-triage-review. Bridges Triage Review's `confirmedRole`
// output onto `claims` — a human (Tasklist) completion has no way to write
// to Postgres on its own, so this service task runs right after it.
interface CaptureTriageReviewVariables {
  claimId: string;
  confirmedRole: string;
  assignedRole: string;
}

const JOB_TYPE = "capture-triage-review";

zeebeClient.createWorker<CaptureTriageReviewVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, confirmedRole, assignedRole } = job.variables;

    await pool.query(
      `UPDATE claims SET confirmed_role = $1, status = 'in_review', updated_at = now() WHERE id = $2`,
      [confirmedRole, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "triage_confirmed",
      detail: { confirmedRole, assignedRole, overridden: confirmedRole !== assignedRole },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
