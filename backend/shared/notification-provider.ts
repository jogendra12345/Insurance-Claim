// SPEC.md §12 / CLAUDE.md originally called for a mock-only implementation
// in v1. Per explicit product direction this now has real email-sending
// implementations alongside the mock — selected at runtime by
// notify-claimant based on which provider's env vars are set, so a dev
// machine with neither still runs (falls back to the mock) instead of
// failing every denied/approved claim into an Operate incident.
import nodemailer from "nodemailer";
export interface NotificationContext {
  claimId: string;
  claimantName: string;
  claimantEmail: string;
  decision: "approve" | "deny";
  denialLetterText?: string | null;
  policyNumber: string;
  claimType: string;
  claimAmount: number;
  incidentDate: string;
  incidentDescription: string;
  settlementId?: string | null;
}

export interface NotificationProvider {
  send(context: NotificationContext): Promise<{ notificationSent: boolean }>;
}

export const mockNotificationProvider: NotificationProvider = {
  async send({ claimId, decision }) {
    console.log(`[mockNotificationProvider] claim ${claimId}: notifying claimant of decision "${decision}"`);
    return { notificationSent: true };
  },
};

// Where the "View your claim" link in the email points — same origin the
// claimant portal itself runs on (frontend/portal). No existing env-var
// convention for this in backend/ (only backend/api's CORS_ORIGIN, which is
// the inverse direction), so introduced here.
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Unified layout for both outcomes — a status banner, an optional body
// section (the AI-drafted denial letter on the deny path), then a shared
// claim-details table and a status-page link. Inline styles throughout:
// email clients don't reliably support <style> blocks.
function buildEmail(context: NotificationContext): { subject: string; html: string; text: string } {
  const isDeny = context.decision === "deny";
  const subject = isDeny ? "Update on your insurance claim" : "Your insurance claim has been approved";
  const statusColor = isDeny ? "#b91c1c" : "#15803d";
  const statusLabel = isDeny ? "Claim Denied" : "Claim Approved";
  const claimUrl = `${FRONTEND_URL}/claims/${context.claimId}`;

  const bodyParagraph = isDeny
    ? escapeHtml(
        context.denialLetterText ?? `We're sorry to inform you that your claim has been denied.`
      ).replace(/\n/g, "<br/>")
    : `Good news — your claim has been approved and settlement is being processed.`;

  const detailRows: Array<[string, string]> = [
    ["Claim ID", context.claimId],
    ["Policy Number", context.policyNumber],
    ["Claim Type", context.claimType],
    ["Claim Amount", formatCurrency(context.claimAmount)],
    ["Incident Date", formatDate(context.incidentDate)],
    ["Incident Description", context.incidentDescription],
  ];
  if (!isDeny) {
    detailRows.push(["Settlement ID", context.settlementId ?? "—"]);
  }

  const detailRowsHtml = detailRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;color:#111827;">${escapeHtml(String(value))}</td></tr>`
    )
    .join("");

  // Kept deliberately plain — a heavily-styled "marketing template" look
  // (colored pill banners, translucent backgrounds) is itself a spam-filter
  // signal, on top of this already relaying through a personal Gmail
  // account rather than dedicated transactional infra. A closing
  // organization line reads closer to a legitimate transactional email.
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827;">
  <p>Dear ${escapeHtml(context.claimantName)},</p>
  <p style="color:${statusColor};font-weight:bold;">${statusLabel}</p>
  <p>${bodyParagraph}</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px;">${detailRowsHtml}</table>
  <p><a href="${claimUrl}" style="color:#2563eb;">View your claim</a></p>
  <p style="color:#6b7280;font-size:13px;">If you have any questions, please contact us and reference your claim ID above.</p>
  <p>Sincerely,<br/>Claims Department<br/>ClaimFlow AI Insurance Services</p>
</div>`.trim();

  const textDetailLines = detailRows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const textBodyParagraph = isDeny
    ? context.denialLetterText ?? `We're sorry to inform you that your claim has been denied.`
    : `Good news — your claim has been approved. Settlement is being processed.`;
  const text = `Dear ${context.claimantName},\n\n${textBodyParagraph}\n\n${textDetailLines}\n\nView your claim: ${claimUrl}`;

  return { subject, html, text };
}

const RESEND_API_BASE = "https://api.resend.com";
// Resend's shared sandbox sender — works with no domain verification, but
// (per Resend's free-tier rules) only delivers to the email address the
// Resend account itself was signed up with.
const SANDBOX_FROM = "ClaimFlow AI <onboarding@resend.dev>";

export const resendNotificationProvider: NotificationProvider = {
  async send(context) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set (see backend/workers/.env.example)");
    }

    const { subject, html, text } = buildEmail(context);

    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SANDBOX_FROM,
        to: context.claimantEmail,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }

    return { notificationSent: true };
  },
};

// Gmail SMTP via Nodemailer — sends to any recipient with no domain
// verification, unlike resendNotificationProvider above (whose free-tier
// sandbox only delivers to the Resend account's own signup address). Relays
// through a real Gmail mailbox using an App Password (myaccount.google.com/apppasswords,
// requires 2-Step Verification on the account), not the account password
// itself. Lower sending limits than a dedicated email API (~500/day) and
// mail arrives "from" a personal Gmail address, but unblocks real delivery
// to arbitrary claimant addresses immediately — no DNS/domain ownership
// needed, which the Resend path does require (see PREREQUISITES.md).
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

export const gmailNotificationProvider: NotificationProvider = {
  async send(context) {
    const user = process.env.GMAIL_USER;
    if (!user || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD is not set (see backend/workers/.env.example)");
    }

    const { subject, html, text } = buildEmail(context);

    await getGmailTransporter().sendMail({
      from: `"ClaimFlow AI" <${user}>`,
      replyTo: user,
      to: context.claimantEmail,
      subject,
      html,
      text,
    });

    return { notificationSent: true };
  },
};
