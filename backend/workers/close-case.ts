import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 / .claude/specs/worker/close-case.md — close-case. Terminal
// service task on both the approved and denied paths. By the time this
// runs, capture-review-decision (or capture-triage-review's/
// capture-validation-exception's reject branch) already set claims.status
// to the same value — this is a confirming, idempotent write, not the sole
// writer (see SPEC.md's note directly under §10 step 16). decision is
// guaranteed to be "approve" or "deny" here: the "moreInfo" branch exits
// the process earlier, at step 14's gateway, and never reaches this worker.
interface CloseCaseVariables {
  claimId: string;
  decision: "approve" | "deny";
}

const STATUS_BY_DECISION: Record<CloseCaseVariables["decision"], string> = {
  approve: "approved",
  deny: "denied",
};

const JOB_TYPE = "close-case";

zeebeClient.createWorker<CloseCaseVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, decision } = job.variables;

    const status = STATUS_BY_DECISION[decision];
    if (!status) {
      throw new Error(`close-case: unexpected decision ${JSON.stringify(decision)}, expected "approve" or "deny"`);
    }

    await pool.query(
      `UPDATE claims SET status = $1, updated_at = now() WHERE id = $2`,
      [status, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "case_closed",
      detail: { decision, status },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
