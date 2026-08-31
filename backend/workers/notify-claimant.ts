import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { mockNotificationProvider } from "../shared/notification-provider";

// SPEC.md §12 / .claude/specs/worker/notify-claimant.md — notify-claimant.
// Runs on both the approved path (after trigger-settlement) and the denied
// path (after draft-denial-letter) — same job type, different `decision`.
// On the deny path, reads denial_letter_text back from `claims` via
// claimId rather than taking it as a process-variable input.
interface NotifyClaimantVariables {
  claimId: string;
  decision: "approve" | "deny";
}

interface NotifyClaimantOutput {
  notificationSent: boolean;
}

const JOB_TYPE = "notify-claimant";

zeebeClient.createWorker<NotifyClaimantVariables, Record<string, unknown>, NotifyClaimantOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, decision } = job.variables;

    let denialLetterText: string | null = null;
    if (decision === "deny") {
      const { rows } = await pool.query<{ denial_letter_text: string | null }>(
        `SELECT denial_letter_text FROM claims WHERE id = $1`,
        [claimId]
      );
      denialLetterText = rows[0]?.denial_letter_text ?? null;
    }

    const { notificationSent } = await mockNotificationProvider.send(claimId, decision);

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "claimant_notified",
      detail: { decision, notificationSent, includedDenialLetter: denialLetterText !== null },
    });

    return job.complete({ notificationSent });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
