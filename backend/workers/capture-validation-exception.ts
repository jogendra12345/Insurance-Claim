import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-validation-exception. v1's Validation Exception
// Review is reject-only (no resolve-and-continue path yet, §14), so a
// completed review always terminates the claim.
interface CaptureValidationExceptionVariables {
  claimId: string;
}

const JOB_TYPE = "capture-validation-exception";

zeebeClient.createWorker<CaptureValidationExceptionVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId } = job.variables;

    await pool.query(`UPDATE claims SET status = 'denied', updated_at = now() WHERE id = $1`, [claimId]);

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "validation_exception_reviewed",
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
