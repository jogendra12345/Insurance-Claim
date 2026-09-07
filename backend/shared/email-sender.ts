// Transport-selection logic shared between backend/workers' notify-claimant
// (via notification-provider.ts, which still owns the claim-specific email
// bodies) and backend/api's forgot-password flow (.claude/specs/generic/
// forgot-password-otp-reset.md) — neither an OTP code nor a generated
// password is claim-related, so this only deals in plain {to, subject,
// html, text} messages, not NotificationContext.
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_API_BASE = "https://api.resend.com";
// Resend's shared sandbox sender — works with no domain verification, but
// (per Resend's free-tier rules) only delivers to the email address the
// Resend account itself was signed up with.
const SANDBOX_FROM = "ClaimFlow AI <onboarding@resend.dev>";

let gmailTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getGmailTransporter() {
  if (!gmailTransporter) {
    gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return gmailTransporter;
}

// Gmail SMTP via Nodemailer — sends to any recipient with no domain
// verification, relaying through a real Gmail mailbox using an App
// Password (myaccount.google.com/apppasswords, requires 2-Step
// Verification), not the account password itself.
export async function sendViaGmail(message: EmailMessage): Promise<void> {
  const user = process.env.GMAIL_USER;
  if (!user || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD is not set");
  }

  await getGmailTransporter().sendMail({
    from: `"ClaimFlow AI" <${user}>`,
    replyTo: user,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}

export async function sendViaResend(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: SANDBOX_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

// Convenience wrapper for callers (e.g. backend/api's forgot-password
// routes) that just want "send this email somehow" without picking a
// provider themselves — same Gmail-preferred-over-Resend-preferred-over-mock
// ordering notify-claimant already uses. Falls back to a console-log mock
// when neither provider's env vars are set, so local dev without email
// credentials still exercises the whole flow end-to-end.
export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    await sendViaGmail(message);
    return { sent: true };
  }
  if (process.env.RESEND_API_KEY) {
    await sendViaResend(message);
    return { sent: true };
  }
  console.log(`[sendEmail mock] to=${message.to} subject="${message.subject}"\n${message.text}`);
  return { sent: true };
}
