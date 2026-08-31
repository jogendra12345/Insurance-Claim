import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { mockNotificationProvider, resendNotificationProvider } from "../shared/notification-provider";

// SPEC.md §12 / .claude/specs/worker/notify-claimant.md — notify-claimant.
// Runs on both the approved path (after trigger-settlement) and the denied
// path (after draft-denial-letter) — same job type, different `decision`.
// Reads claimant name/email and (on the deny path) denial_letter_text back
// from `claims` via claimId, rather than taking them as process-variable
// inputs — the real Resend provider needs actual content to send, not just
// claimId/decision.
interface NotifyClaimantVariables {
  claimId: string;
  decision: "approve" | "deny";
}

interface NotifyClaimantOutput {
  notificationSent: boolean;
}

const JOB_TYPE = "notify-claimant";

// Picked once at worker startup: falls back to the mock (console.log) when
// RESEND_API_KEY isn't set, so a dev machine without the key still runs
// instead of failing every claim into an Operate incident.
const provider = process.env.RESEND_API_KEY ? resendNotificationProvider : mockNotificationProvider;
if (provider === mockNotificationProvider) {
  console.log(`${JOB_TYPE}: RESEND_API_KEY not set — using mockNotificationProvider (no real email will send)`);
}

zeebeClient.createWorker<NotifyClaimantVariables, Record<string, unknown>, NotifyClaimantOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, decision } = job.variables;

    const { rows } = await pool.query<{
      claimant_name: string;
      claimant_email: string;
      denial_letter_text: string | null;
    }>(`SELECT claimant_name, claimant_email, denial_letter_text FROM claims WHERE id = $1`, [claimId]);
    const claim = rows[0];
    if (!claim) {
      throw new Error(`notify-claimant: no claims row for claimId ${claimId}`);
    }

    const { notificationSent } = await provider.send({
      claimId,
      claimantName: claim.claimant_name,
      claimantEmail: claim.claimant_email,
      decision,
      denialLetterText: decision === "deny" ? claim.denial_letter_text : null,
    });

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "claimant_notified",
      detail: {
        decision,
        notificationSent,
        includedDenialLetter: decision === "deny" && claim.denial_letter_text !== null,
        provider: provider === resendNotificationProvider ? "resend" : "mock",
      },
    });

    return job.complete({ notificationSent });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
