import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { alreadyProcessed, processInboundEmail, sweepDrafts, type InboundEmail } from "./email-intake";
import { intakeAddress } from "./email-intake-mailer";

// Gmail IMAP receiver for email claim intake (.claude/specs/generic/
// email-claim-intake.md Decision 1): every EMAIL_INTAKE_POLL_SECONDS, fetch
// unseen INBOX mail from the dedicated claims account, hand each message to
// processInboundEmail(), mark it seen, then run the reminder/expiry sweep
// (Decision 3). Off unless EMAIL_INTAKE_ENABLED=true.
//
// Shared inbox (added 2026-10-07): when EMAIL_INTAKE_ADDRESS is a different
// address delivered to the same mailbox — a Gmail plus-address like
// you+claims@gmail.com — only mail sent to that address is handled. Anything
// else is left exactly as it was: not processed, not replied to, still unread.
// A shared inbox is also read by a person, who can open (mark read) a claim
// email before the next poll — so in that mode the read/unread flag is
// ignored: every message to the claims address from the last
// SHARED_LOOKBACK_DAYS is considered, and email_processed_messages decides
// what's new. EMAIL_INTAKE_UNTIL=YYYY-MM-DD stops polling after that day.

// Covers a draft's whole life (expiry after 14 days) plus a day.
const SHARED_LOOKBACK_DAYS = 15;

function headerValues(parsed: ParsedMail, name: string): string[] {
  return parsed.headerLines
    .filter((h) => h.key.toLowerCase() === name)
    .map((h) => h.line.slice(h.line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim());
}

// Signature logos are typically a few KB; a phone photo Gmail compressed
// inline was 29.8 KB (first live reply, 2026-10-07).
const INLINE_DOCUMENT_MIN_BYTES = 10 * 1024;

function sharedInbox(): boolean {
  return intakeAddress() !== (process.env.EMAIL_INTAKE_IMAP_USER ?? "").toLowerCase();
}

/** Whether a message was sent to the claims address (To, Cc, or the delivery headers). */
export function isAddressedTo(parsed: ParsedMail, address: string): boolean {
  const recipients = [parsed.to, parsed.cc]
    .flatMap((field) => (Array.isArray(field) ? field : field ? [field] : []))
    .flatMap((group) => group.value.map((v) => v.address ?? ""));
  const delivered = [...headerValues(parsed, "delivered-to"), ...headerValues(parsed, "x-original-to")];
  return [...recipients, ...delivered].some((a) => a.replace(/^<|>$/g, "").trim().toLowerCase() === address);
}

// Last day intake runs, inclusive, in the server's local time. null = no end date.
export function intakeEndPassed(now = new Date()): boolean {
  const until = process.env.EMAIL_INTAKE_UNTIL;
  if (!until) return false;
  const end = new Date(`${until}T23:59:59.999`);
  return !Number.isNaN(end.getTime()) && now > end;
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
    // Small inline images are signature logos, not claim documents — but a
    // photo pasted into the body (Gmail mobile does this) is inline too.
    attachments: parsed.attachments
      .filter((a) => !a.related || a.size >= INLINE_DOCUMENT_MIN_BYTES)
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
    const address = intakeAddress();
    const shared = sharedInbox();
    // Gmail narrows to the claims address server-side (deliveredto: matches
    // plus-addresses; combining it with is:unread or UNSEEN returns nothing on
    // Gmail, found 2026-10-07). The header check below is what actually
    // decides, for any server.
    const since = new Date(Date.now() - SHARED_LOOKBACK_DAYS * 86_400_000);
    const query = !shared
      ? { seen: false }
      : client.capabilities.has("X-GM-EXT-1")
        ? { gmraw: `deliveredto:${address} newer_than:${SHARED_LOOKBACK_DAYS}d` }
        : { to: address, since };
    const uids = (await client.search(query, { uid: true })) || [];
    for (const uid of uids) {
      try {
        if (shared) {
          // Cheap envelope fetch first — most of these were handled on an earlier poll.
          const head = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
          const messageId = head && head.envelope?.messageId;
          if (messageId && (await alreadyProcessed(messageId))) continue;
        }
        // source fetches use BODY.PEEK, so reading doesn't mark it seen.
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) continue;
        const parsed = await simpleParser(message.source);
        // Personal mail in a shared inbox: leave it untouched and unread.
        if (shared && !isAddressedTo(parsed, address)) continue;
        await processInboundEmail(toInboundEmail(parsed));
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
  if (intakeEndPassed()) {
    console.log(`Email claim intake ended on ${process.env.EMAIL_INTAKE_UNTIL} (EMAIL_INTAKE_UNTIL) — not started.`);
    return;
  }
  const seconds = Math.max(15, Number(process.env.EMAIL_INTAKE_POLL_SECONDS ?? 60));
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = async () => {
    if (running) return;
    if (intakeEndPassed()) {
      console.log(`Email claim intake ended on ${process.env.EMAIL_INTAKE_UNTIL} (EMAIL_INTAKE_UNTIL) — polling stopped.`);
      clearInterval(timer);
      return;
    }
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
  const scope = sharedInbox() ? ` (only mail to ${intakeAddress()})` : "";
  const until = process.env.EMAIL_INTAKE_UNTIL ? ` until ${process.env.EMAIL_INTAKE_UNTIL}` : "";
  console.log(`Email claim intake polling ${process.env.EMAIL_INTAKE_IMAP_USER}${scope} every ${seconds}s${until}.`);
  timer = setInterval(tick, seconds * 1000);
  void tick();
}
