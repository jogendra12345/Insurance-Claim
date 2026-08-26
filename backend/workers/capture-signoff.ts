import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-signoff. Supervisor Sign-off has no output variable
// that needs writing to `claims` (status is already 'approved' from
// capture-review-decision) — this worker exists solely to satisfy §13's
// "every user-task completion writes audit_log" rule for that task.
interface CaptureSignoffVariables {
  claimId: string;
}

const JOB_TYPE = "capture-signoff";

zeebeClient.createWorker<CaptureSignoffVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId } = job.variables;

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "signed_off",
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
