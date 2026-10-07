import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

// Replies from the dedicated claims mailbox (.claude/specs/generic/
// email-claim-intake.md Decision 1) — sent over that account's own Gmail SMTP,
// not shared/email-sender.ts's GMAIL_USER account, so they come from the
// address the claimant wrote to and thread under their email. Logs instead
// of sending when the intake account isn't configured, like whatsapp-client.ts.

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
}

export function intakeAddress(): string {
  return (process.env.EMAIL_INTAKE_ADDRESS || process.env.EMAIL_INTAKE_IMAP_USER || "claims@claimflow.local").toLowerCase();
}

/** A fresh RFC 5322 Message-ID on the claims address's domain, angle brackets included. */
export function newMessageId(): string {
  return `<${randomUUID()}@${intakeAddress().split("@")[1] ?? "claimflow.local"}>`;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_INTAKE_IMAP_USER, pass: process.env.EMAIL_INTAKE_IMAP_PASSWORD },
    });
  }
  return transporter;
}

export async function sendIntakeEmail(message: OutboundEmail): Promise<void> {
  if (!process.env.EMAIL_INTAKE_IMAP_USER || !process.env.EMAIL_INTAKE_IMAP_PASSWORD) {
    console.log(`[email-intake mock] to=${message.to} subject="${message.subject}" messageId=${message.messageId}\n${message.text}`);
    return;
  }
  await getTransporter().sendMail({
    from: `"ClaimFlow Claims" <${intakeAddress()}>`,
    // In case Gmail rewrites From to the account's main address, replies
    // still go to the claims address (shared-inbox mode only handles those).
    replyTo: intakeAddress(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo ?? undefined,
    references: message.references?.length ? message.references : undefined,
    // Marks these as automated so a claimant's out-of-office doesn't reply back.
    headers: { "Auto-Submitted": "auto-replied" },
  });
}
