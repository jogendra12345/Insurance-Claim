// .claude/specs/generic/reviewer-task-notification-emails.md — emails
// everyone with a given role when a review task they can act on opens
// (Triage Review, Validation Exception Review, Adjuster/Investigator/Legal
// Review, Supervisor Sign-off). Best-effort: a send failure here must never
// fail the claim-processing job it's called from.
import { pool } from "./db";
import { sendEmail } from "./email-sender";

// Same origin the claimant portal itself runs on — mirrors
// notification-provider.ts's own FRONTEND_URL (not exported from there, so
// duplicated here per this repo's "duplicate per file/package" convention).
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

// Test-mode override (see the spec's lock note, 2026-09-07): this is a small
// internal test app, so every reviewer notification is redirected here
// instead of each matched user's real email. Change this one constant to
// restore real per-reviewer delivery.
const TEST_RECIPIENT = "ayanchou2015@gmail.com";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function notifyRole(role: string, claimId: string, taskLabel: string): Promise<{ notifiedCount: number }> {
  try {
    const { rows } = await pool.query(`SELECT email FROM users WHERE role = $1`, [role]);
    if (rows.length === 0) {
      return { notifiedCount: 0 };
    }

    const tasksUrl = `${FRONTEND_URL}/tasks`;
    const subject = `${taskLabel} task waiting — claim ${claimId}`;
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111827;">
  <p>A new <strong>${escapeHtml(taskLabel)}</strong> task is waiting on claim <strong>${escapeHtml(claimId)}</strong>.</p>
  <p><a href="${tasksUrl}" style="color:#2563eb;">Open your tasks</a></p>
</div>`.trim();
    const text = `A new ${taskLabel} task is waiting on claim ${claimId}.\n\nOpen your tasks: ${tasksUrl}`;

    await Promise.all(
      rows.map((row: { email: string }) =>
        sendEmail({ to: TEST_RECIPIENT, subject: `[${row.email}] ${subject}`, html, text })
      )
    );

    return { notifiedCount: rows.length };
  } catch (err) {
    console.error(`notifyRole(${role}) failed for claim ${claimId}:`, err);
    return { notifiedCount: 0 };
  }
}
