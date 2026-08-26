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

const VALID_ROLES = ["adjuster", "investigator", "legal"];

const JOB_TYPE = "capture-triage-review";

zeebeClient.createWorker<CaptureTriageReviewVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, confirmedRole, assignedRole } = job.variables;

    // Task_TriageReview's form requires this field, but fail loudly (into a
    // visible Operate incident) rather than silently writing NULL if it's
    // ever missing anyway — e.g. someone completes the task via the raw API
    // instead of the form.
    if (!VALID_ROLES.includes(confirmedRole)) {
      throw new Error(
        `capture-triage-review: confirmedRole must be one of ${VALID_ROLES.join(", ")}, got ${JSON.stringify(confirmedRole)}`
      );
    }

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
