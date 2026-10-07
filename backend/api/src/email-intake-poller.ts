import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { processInboundEmail, sweepDrafts, type InboundEmail } from "./email-intake";

// Gmail IMAP receiver for email claim intake (.claude/specs/generic/
// email-claim-intake.md Decision 1): every EMAIL_INTAKE_POLL_SECONDS, fetch
// unseen INBOX mail from the dedicated claims account, hand each message to
// processInboundEmail(), mark it seen, then run the reminder/expiry sweep
// (Decision 3). Off unless EMAIL_INTAKE_ENABLED=true.

function headerValues(parsed: ParsedMail, name: string): string[] {
  return parsed.headerLines
    .filter((h) => h.key.toLowerCase() === name)
    .map((h) => h.line.slice(h.line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim());
}

export function toInboundEmail(parsed: ParsedMail): InboundEmail {
  const from = parsed.from?.value?.[0]?.address ?? "";
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? parsed.references.split(/\s+/) : [];
  const autoSubmitted = headerValues(parsed, "auto-submitted")[0]?.toLowerCase();
  const precedence = headerValues(parsed, "precedence")[0]?.toLowerCase();
  return {
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    from,
    subject: parsed.subject ?? "",
    text: parsed.text ?? "",
    // Inline images (signature logos etc.) aren't claim documents.
    attachments: parsed.attachments
      .filter((a) => !a.related)
      .map((a) => ({ filename: a.filename ?? "attachment", contentType: a.contentType, content: a.content, size: a.size })),
    authResults: headerValues(parsed, "authentication-results"),
    automated:
      (!!autoSubmitted && autoSubmitted !== "no") ||
      ["bulk", "list", "junk"].includes(precedence ?? "") ||
      headerValues(parsed, "list-id").length > 0,
  };
}

async function pollOnce(): Promise<void> {
  const client = new ImapFlow({
    host: process.env.EMAIL_INTAKE_IMAP_HOST || "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.EMAIL_INTAKE_IMAP_USER!, pass: process.env.EMAIL_INTAKE_IMAP_PASSWORD! },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids) {
      try {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (message && message.source) await processInboundEmail(toInboundEmail(await simpleParser(message.source)));
      } catch (err) {
        // At-most-once: the Message-ID is already recorded as processed, so
        // a retry would be skipped anyway — log it rather than loop on it.
        console.error(`Email intake failed on IMAP uid ${uid}:`, err);
      }
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

export function startEmailIntakePoller(): void {
  if (process.env.EMAIL_INTAKE_ENABLED !== "true") {
    console.log("Email claim intake is off (EMAIL_INTAKE_ENABLED is not 'true').");
    return;
  }
  if (!process.env.EMAIL_INTAKE_IMAP_USER || !process.env.EMAIL_INTAKE_IMAP_PASSWORD) {
    console.warn("EMAIL_INTAKE_ENABLED=true but EMAIL_INTAKE_IMAP_USER / EMAIL_INTAKE_IMAP_PASSWORD are not set — email intake not started.");
    return;
  }
  const seconds = Math.max(15, Number(process.env.EMAIL_INTAKE_POLL_SECONDS ?? 60));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollOnce();
      await sweepDrafts();
    } catch (err) {
      console.error("Email intake poll failed:", err);
    } finally {
      running = false;
    }
  };
  console.log(`Email claim intake polling ${process.env.EMAIL_INTAKE_IMAP_USER} every ${seconds}s.`);
  void tick();
  setInterval(tick, seconds * 1000);
}
