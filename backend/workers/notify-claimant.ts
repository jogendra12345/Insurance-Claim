import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { gmailNotificationProvider, mockNotificationProvider, resendNotificationProvider } from "../shared/notification-provider";

// SPEC.md §12 / .claude/specs/worker/notify-claimant.md — notify-claimant.
// Runs on both the approved path (after trigger-settlement) and the denied
// path (after draft-denial-letter) — same job type, different `decision`.
// Reads everything the email body needs straight from `claims` via
// claimId, rather than taking it as process-variable input — the real
// Resend provider sends a detailed HTML email (claim details, amount,
// incident info, settlement/denial content), not just claimId/decision.
interface NotifyClaimantVariables {
  claimId: string;
  decision: "approve" | "deny";
}

interface NotifyClaimantOutput {
  notificationSent: boolean;
}

const JOB_TYPE = "notify-claimant";

// Picked once at worker startup, preferring Gmail SMTP over Resend over the
// mock (console.log): Gmail delivers to any claimant address today (relays
// through a real mailbox via an App Password), whereas Resend's free-tier
// sandbox only delivers to the account's own signup address until a domain
// is verified (see PREREQUISITES.md). Falls back to the mock when neither
// is configured, so a dev machine without either still runs instead of
// failing every claim into an Operate incident.
const provider = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
  ? gmailNotificationProvider
  : process.env.RESEND_API_KEY
    ? resendNotificationProvider
    : mockNotificationProvider;
const providerName =
  provider === gmailNotificationProvider ? "gmail" : provider === resendNotificationProvider ? "resend" : "mock";
if (provider === mockNotificationProvider) {
  console.log(`${JOB_TYPE}: no GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY set — using mockNotificationProvider (no real email will send)`);
}

zeebeClient.createWorker<NotifyClaimantVariables, Record<string, unknown>, NotifyClaimantOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, decision } = job.variables;

    const { rows } = await pool.query<{
      claimant_name: string;
      claimant_email: string;
      denial_letter_text: string | null;
      policy_number: string;
      claim_type: string;
      claim_amount: string;
      incident_date: Date;
      incident_description: string;
      settlement_id: string | null;
    }>(
      `SELECT claimant_name, claimant_email, denial_letter_text, policy_number, claim_type,
              claim_amount, incident_date, incident_description, settlement_id
       FROM claims WHERE id = $1`,
      [claimId]
    );
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
      policyNumber: claim.policy_number,
      claimType: claim.claim_type,
      claimAmount: Number(claim.claim_amount),
      incidentDate: claim.incident_date.toISOString(),
      incidentDescription: claim.incident_description,
      settlementId: decision === "approve" ? claim.settlement_id : null,
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
        provider: providerName,
      },
    });

    return job.complete({ notificationSent });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
