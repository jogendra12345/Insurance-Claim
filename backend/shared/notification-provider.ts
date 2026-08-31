// SPEC.md §12 / CLAUDE.md originally called for a mock-only implementation
// in v1. Per explicit product direction this now has a real email-sending
// implementation (Resend) alongside the mock — selected at runtime by
// notify-claimant based on whether RESEND_API_KEY is set, so a dev machine
// without the key still runs (falls back to the mock) instead of failing
// every denied/approved claim into an Operate incident.
export interface NotificationContext {
  claimId: string;
  claimantName: string;
  claimantEmail: string;
  decision: "approve" | "deny";
  denialLetterText?: string | null;
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

const RESEND_API_BASE = "https://api.resend.com";
// Resend's shared sandbox sender — works with no domain verification, but
// (per Resend's free-tier rules) only delivers to the email address the
// Resend account itself was signed up with.
const SANDBOX_FROM = "ClaimFlow AI <onboarding@resend.dev>";

function buildEmail(context: NotificationContext): { subject: string; text: string } {
  if (context.decision === "deny") {
    return {
      subject: "Update on your insurance claim",
      text:
        context.denialLetterText ??
        `Dear ${context.claimantName},\n\nYour claim (${context.claimId}) has been denied. Contact us with questions.\n\nClaims Department`,
    };
  }
  return {
    subject: "Your insurance claim has been approved",
    text: `Dear ${context.claimantName},\n\nGood news — your claim (${context.claimId}) has been approved. Settlement is being processed.\n\nClaims Department`,
  };
}

export const resendNotificationProvider: NotificationProvider = {
  async send(context) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set (see backend/workers/.env.example)");
    }

    const { subject, text } = buildEmail(context);

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
