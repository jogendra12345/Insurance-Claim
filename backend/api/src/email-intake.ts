import { pool } from "./db";
import { BUCKET, minioClient, publicUrl } from "./storage";
import { ClaimValidationError } from "./create-claim";
import {
  claimProgressLine,
  claimStatusCopy,
  getClaimStatusDetail,
  getClaimStatusList,
  getPolicyStatusList,
  isKnownEmail,
  nameForEmail,
  raiseClaimByEmail,
  type ClaimStatusDetail,
} from "./claims-assistant";
import {
  FORM_START,
  changedFormValues,
  checkSenderAuth,
  controlKeyword,
  detectIntent,
  fieldByKey,
  findShortRef,
  formValues,
  formatValue,
  isComplete,
  missingRequired,
  parseFormLines,
  renderForm,
  stripFormBlock,
  stripQuoted,
  stripSubjectPrefixes,
  type DraftDocument,
  type DraftState,
  type FormContext,
} from "./email-intake-form";
import { intakeAddress, newMessageId, sendIntakeEmail, type OutboundEmail } from "./email-intake-mailer";
import { generateContent, parseJsonResponse } from "../../shared/gemini-client";

// Email claim intake — .claude/specs/generic/email-claim-intake.md (Locked
// 2026-10-07). The receiver (email-intake-poller.ts, Gmail IMAP) hands each
// new email to processInboundEmail(); everything from there — sender checks,
// intent, the per-thread draft, the claim form, AI extraction, confirm-
// before-submit, createClaim() — lives here. A different receiver (an
// inbound-parse webhook) would only need to build the same InboundEmail.

export interface InboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size: number;
}

export interface InboundEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  subject: string;
  text: string;
  attachments: InboundAttachment[];
  // Every Authentication-Results header, topmost first.
  authResults: string[];
  // Auto-Submitted / Precedence: bulk|list|junk — out-of-office, lists, bounces.
  automated: boolean;
}

export interface AiExtraction {
  fields: Record<string, { value: string; confidence: "high" | "low"; source: "text" | "attachment"; correction?: boolean }>;
  model: string;
}

// Swappable for tests (test/email-intake.test.ts) — outbound mail, AI
// extraction, and document storage are the three side effects outside Postgres.
export const emailIntakeDeps = {
  send: sendIntakeEmail as (message: OutboundEmail) => Promise<void>,
  extract: extractFieldsWithAi as (text: string, attachments: InboundAttachment[], known: Record<string, string>) => Promise<AiExtraction | null>,
  storeDocument: storeDocument as (attachment: InboundAttachment) => Promise<DraftDocument>,
};

// ---------- Configuration ----------

const authservId = () => process.env.EMAIL_INTAKE_AUTHSERV_ID || "mx.google.com";
const reminderDays = () => Number(process.env.EMAIL_INTAKE_REMINDER_DAYS ?? 3);
const expiryDays = () => Number(process.env.EMAIL_INTAKE_EXPIRY_DAYS ?? 14);

// Decision 6 — the portal's own per-file limit (routes/claims.ts MAX_FILE_SIZE_BYTES).
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS_PER_DRAFT = 10;
const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

// ---------- Persistence ----------

interface DraftRow {
  id: string;
  sender_email: string;
  subject: string;
  thread_message_ids: string[];
  collected_fields: Record<string, unknown>;
  invalid_fields: Record<string, { value: string; error: string }>;
  low_confidence_fields: string[];
  documents: DraftDocument[];
  sent_forms: Record<string, Record<string, string>>;
  status: "collecting" | "awaiting_confirmation" | "submitted" | "abandoned" | "expired";
  claim_id: string | null;
}

function stateOf(draft: DraftRow): DraftState {
  return {
    collected: draft.collected_fields,
    invalid: draft.invalid_fields,
    lowConfidence: draft.low_confidence_fields,
    documents: draft.documents,
  };
}

async function saveDraft(
  draftId: string,
  patch: Partial<Pick<DraftRow, "status" | "claim_id" | "thread_message_ids" | "sent_forms">> & { state?: DraftState; touchInbound?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.state) {
    set("collected_fields", JSON.stringify(patch.state.collected));
    set("invalid_fields", JSON.stringify(patch.state.invalid));
    set("low_confidence_fields", patch.state.lowConfidence);
    set("documents", JSON.stringify(patch.state.documents));
  }
  if (patch.status) set("status", patch.status);
  if (patch.claim_id) set("claim_id", patch.claim_id);
  if (patch.thread_message_ids) set("thread_message_ids", patch.thread_message_ids);
  if (patch.sent_forms) set("sent_forms", JSON.stringify(patch.sent_forms));
  if (patch.touchInbound) sets.push("last_inbound_at = now()", "reminder_sent_at = NULL");
  params.push(draftId);
  await pool.query(`UPDATE email_claim_drafts SET ${[...sets, "updated_at = now()"].join(", ")} WHERE id = $${params.length}`, params);
}

async function loadDraft(draftId: string): Promise<DraftRow> {
  const { rows } = await pool.query(`SELECT * FROM email_claim_drafts WHERE id = $1`, [draftId]);
  return rows[0];
}

async function logEvent(
  sender: string,
  action: string,
  detail: unknown,
  opts: { draftId?: string | null; messageId?: string | null; actorType?: "system" | "ai" | "human" } = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO email_intake_events (draft_id, message_id, sender_email, actor_type, action, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
    [opts.draftId ?? null, opts.messageId ?? null, sender, opts.actorType ?? "system", action, detail === undefined ? null : JSON.stringify(detail)]
  );
}

// False if this Message-ID was already handled (IMAP re-fetch).
async function markProcessed(messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO email_processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING`,
    [messageId]
  );
  return rowCount === 1;
}

// ---------- Outbound ----------

function replySubject(subject: string): string {
  return `Re: ${stripSubjectPrefixes(subject) || "Your claim"}`;
}

// One-off reply (menu, status, unknown sender) — not part of a draft thread.
async function replyTo(email: InboundEmail, text: string): Promise<void> {
  await emailIntakeDeps.send({
    to: email.from,
    subject: replySubject(email.subject),
    text,
    messageId: newMessageId(),
    inReplyTo: email.messageId,
    references: [...email.references, ...(email.messageId ? [email.messageId] : [])].slice(-10),
  });
}

/**
 * Reply inside a draft's thread. Records our Message-ID on the draft so the
 * claimant's answer finds it, and the form values we showed, so an untouched
 * line in their reply isn't mistaken for a new answer.
 */
async function replyInThread(draft: DraftRow, state: DraftState, inReplyTo: string | null, text: string): Promise<void> {
  const messageId = newMessageId();
  const thread = draft.thread_message_ids;
  await emailIntakeDeps.send({
    to: draft.sender_email,
    subject: replySubject(draft.subject),
    text,
    messageId,
    inReplyTo: inReplyTo ?? thread[thread.length - 1] ?? null,
    references: thread.slice(-10),
  });
  const sentForms = { ...draft.sent_forms, [messageId]: formValues(state) };
  // Only the latest few forms matter as a baseline.
  const keep = Object.keys(sentForms).slice(-10);
  draft.thread_message_ids = [...thread, messageId];
  draft.sent_forms = Object.fromEntries(keep.map((k) => [k, sentForms[k]]));
  await saveDraft(draft.id, { thread_message_ids: draft.thread_message_ids, sent_forms: draft.sent_forms });
  await logEvent(draft.sender_email, "reply-sent", { messageId, status: draft.status }, { draftId: draft.id });
}

// ---------- Copy ----------

const SIGN_OFF = "\n\n— ClaimFlow Claims\n(This mailbox is automated. Reply to this email to continue.)";

const UNKNOWN_SENDER_REPLY =
  "Hello,\n\nThis email address isn't linked to a ClaimFlow policy, so we can't take a claim or share claim details from it. " +
  "Please email us from the address on your policy, or contact your insurer to add this address." +
  SIGN_OFF;

function menuText(name: string | null): string {
  return (
    `Hi${name ? ` ${name.split(" ")[0]}` : ""} — I'm the ClaimFlow claims assistant. Reply to this email with one of:\n\n` +
    "  RAISE A CLAIM — I'll send you a short form to fill in\n" +
    "  CLAIM STATUS — see where your claims are\n" +
    "  POLICY STATUS — see your policies\n\n" +
    "You can also just describe your claim and attach your bill — I'll work out the details." +
    SIGN_OFF
  );
}

function documentsLine(state: DraftState): string {
  return state.documents.length
    ? `Documents received: ${state.documents.map((d) => d.name).join(", ")}`
    : "⚠ Please attach at least one supporting document (bill, receipt or report — PDF or photo).";
}

function formReplyText(state: DraftState, ctx: FormContext, intro: string, notes: string[]): string {
  return [
    intro,
    ...notes.map((n) => `• ${n}`),
    "",
    documentsLine(state),
    "",
    renderForm(state, ctx, true),
    "",
    "Edit the lines marked ⚠ (and check any marked ?), then reply with the form. Reply CANCEL to discard this claim.",
  ].join("\n") + SIGN_OFF;
}

function confirmationText(state: DraftState, ctx: FormContext, notes: string[]): string {
  const checks = state.lowConfidence.length
    ? "\nLines marked ? were read from your email or documents by our assistant — please check them."
    : "";
  return [
    "Here's your claim — please check every line.",
    ...notes.map((n) => `• ${n}`),
    "",
    documentsLine(state),
    "",
    renderForm(state, ctx, true),
    checks,
    "Reply CONFIRM to submit it. By confirming, you state that this information is accurate to the best of your knowledge.",
    "To change something, edit the form and reply with it instead. Reply CANCEL to discard this claim.",
  ].join("\n") + SIGN_OFF;
}

function formatAmount(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${amount}`;
}

// Date only, UTC — same as the WhatsApp replies.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function claimDetailText(d: ClaimStatusDetail): string {
  const copy = claimStatusCopy(d.status);
  const lines = [
    `Claim ${d.shortRef}`,
    `Status: ${copy.label}`,
    `Progress: ${claimProgressLine(d.status)}`,
    "",
    `Type: ${titleCase(d.claimType)}`,
    `Amount: ${formatAmount(d.claimAmount)}`,
    `Filed: ${formatDate(d.createdAt)}`,
    `Last update: ${formatDate(d.updatedAt)}`,
  ];
  if (d.denialReason) lines.push("", `Reason: ${d.denialReason}`);
  if (d.infoRequestedReason) lines.push("", `Information needed: ${d.infoRequestedReason}`);
  if (d.caseSummary) lines.push("", "Case summary:", d.caseSummary);
  if (copy.next) lines.push("", `What happens next: ${copy.next}`);
  return lines.join("\n");
}

// ---------- Status intents ----------

async function replyClaimStatus(email: InboundEmail, sender: string, newText: string): Promise<void> {
  const ref = findShortRef(`${newText}\n${email.subject}`);
  if (ref) {
    const { rows } = await pool.query(
      `SELECT id FROM claims WHERE lower(claimant_email) = lower($1) AND id::text LIKE $2 || '%' LIMIT 1`,
      [sender, ref]
    );
    const detail = rows[0] ? await getClaimStatusDetail({ kind: "email", email: sender }, rows[0].id) : null;
    if (detail) {
      await replyTo(email, `${claimDetailText(detail)}\n\nReply CLAIM STATUS for all your claims.${SIGN_OFF}`);
      return;
    }
  }
  const claims = await getClaimStatusList({ kind: "email", email: sender });
  const lines = claims.length
    ? [
        claims.length === 1 ? "Here's your claim:" : `Here are your ${claims.length} most recent claims:`,
        "",
        ...claims.map(
          (c) => `${c.shortRef} · ${claimStatusCopy(c.status).label} · ${formatAmount(c.claimAmount)} · ${titleCase(c.claimType)} · filed ${formatDate(c.createdAt)}`
        ),
        "",
        "For details on one, reply with its reference, e.g. \"status " + claims[0].shortRef + "\".",
      ]
    : [ref ? `I couldn't find claim #${ref} for this email address.` : "I couldn't find any claims for this email address.", "", "Reply RAISE A CLAIM to start one."];
  await replyTo(email, lines.join("\n") + SIGN_OFF);
}

async function replyPolicyStatus(email: InboundEmail, sender: string): Promise<void> {
  const policies = await getPolicyStatusList({ kind: "email", email: sender });
  const lines = policies.length
    ? ["Your policies:", "", ...policies.map((p) => `${p.policyNumber} — ${titleCase(p.status)} (expires ${formatDate(p.expiryDate)})`)]
    : ["I couldn't find any policies for this email address."];
  await replyTo(email, lines.join("\n") + SIGN_OFF);
}

// ---------- Applying an email to a draft ----------

function isAllowedAttachment(a: InboundAttachment): boolean {
  const type = a.contentType.toLowerCase();
  if (ALLOWED_TYPES[type]) return true;
  const name = a.filename.toLowerCase();
  return Object.values(ALLOWED_TYPES).some((exts) => exts.some((ext) => name.endsWith(ext)));
}

async function storeDocument(a: InboundAttachment): Promise<DraftDocument> {
  const safeName = a.filename.replace(/[^\w.\-]+/g, "_");
  const objectKey = `${Date.now()}-${safeName}`;
  await minioClient.putObject(BUCKET, objectKey, a.content, a.size, { "Content-Type": a.contentType });
  return { name: a.filename, url: publicUrl(objectKey), contentType: a.contentType, size: a.size };
}

function acceptValue(state: DraftState, key: string, value: unknown): void {
  state.collected[key] = value;
  delete state.invalid[key];
  state.lowConfidence = state.lowConfidence.filter((k) => k !== key);
}

function rejectValue(state: DraftState, key: string, value: string, error: string): void {
  delete state.collected[key];
  state.invalid[key] = { value, error };
  state.lowConfidence = state.lowConfidence.filter((k) => k !== key);
}

/**
 * Folds one email into a draft's state: form lines first (exact, code-only),
 * then attachments, then the AI pass over leftover free text and new
 * attachments. Returns notes for the reply (rejected attachments etc.).
 */
async function applyEmail(
  draft: DraftRow | null,
  state: DraftState,
  ctx: FormContext,
  email: InboundEmail,
  newText: string,
  sender: string
): Promise<{ notes: string[]; formAnswers: number; aiAnswers: number }> {
  const notes: string[] = [];

  // 1. Form lines, compared with the form the claimant is replying to.
  const baseline =
    (email.inReplyTo && draft?.sent_forms[email.inReplyTo]) ||
    [...email.references].reverse().map((id) => draft?.sent_forms[id]).find(Boolean) ||
    formValues(state);
  const parsed = parseFormLines(email.text, newText);
  const changed = changedFormValues(parsed, baseline);
  for (const [key, raw] of Object.entries(changed)) {
    const field = fieldByKey(key)!;
    const result = field.parse(raw, ctx);
    if (result.ok) acceptValue(state, key, result.value);
    else rejectValue(state, key, raw, result.error);
  }
  // Sending the form back (in the new text) with a "?" line left as-is
  // counts as checking it.
  if (newText.includes(FORM_START)) {
    state.lowConfidence = state.lowConfidence.filter((k) => !(k in parsed.values));
  }

  // 2. Attachments (Decision 6).
  const fresh: InboundAttachment[] = [];
  for (const a of email.attachments) {
    if (!isAllowedAttachment(a)) {
      notes.push(`${a.filename} wasn't added — we accept PDF, JPEG, PNG or HEIC files.`);
    } else if (a.size > MAX_ATTACHMENT_BYTES) {
      notes.push(`${a.filename} wasn't added — files must be 10 MB or smaller.`);
    } else if (state.documents.length >= MAX_DOCUMENTS_PER_DRAFT) {
      notes.push(`${a.filename} wasn't added — a claim can have at most ${MAX_DOCUMENTS_PER_DRAFT} documents.`);
    } else {
      state.documents.push(await emailIntakeDeps.storeDocument(a));
      fresh.push(a);
    }
  }

  // 3. AI pass — free text outside the form, plus new attachments (Decision 5).
  let aiAnswers = 0;
  const freeText = stripFormBlock(newText);
  if (freeText.split(/\s+/).filter(Boolean).length >= 3 || fresh.length > 0) {
    const known = Object.fromEntries(Object.entries(state.collected).map(([k, v]) => [k, formatValue(v)]));
    let extraction: AiExtraction | null = null;
    try {
      extraction = await emailIntakeDeps.extract(freeText, fresh, known);
    } catch (err) {
      console.error(`Email intake AI extraction failed for ${sender}:`, err);
      await logEvent(sender, "ai-extraction-failed", { error: String(err) }, { draftId: draft?.id, messageId: email.messageId });
    }
    if (extraction) {
      const applied: Record<string, { confidence: string; source: string; outcome: string }> = {};
      for (const [key, item] of Object.entries(extraction.fields)) {
        const field = fieldByKey(key);
        if (!field?.aiExtractable || key in changed || !item?.value?.toString().trim()) continue;
        const value = String(item.value).trim();
        const result = field.parse(value, ctx);
        let outcome = "ignored";
        if (item.source === "attachment") {
          // Documents only fill blanks, and always need checking.
          if (!(key in state.collected) && !state.invalid[key] && result.ok) {
            acceptValue(state, key, result.value);
            state.lowConfidence.push(key);
            outcome = "accepted-to-check";
          }
        } else if (!(key in state.collected) || item.correction) {
          if (result.ok) {
            acceptValue(state, key, result.value);
            if (item.confidence === "low") state.lowConfidence.push(key);
            outcome = item.confidence === "low" ? "accepted-to-check" : "accepted";
          } else {
            rejectValue(state, key, value, result.error);
            outcome = "invalid";
          }
        }
        if (outcome !== "ignored") aiAnswers++;
        applied[key] = { confidence: item.confidence, source: item.source, outcome };
      }
      await logEvent(sender, "ai-extraction", { model: extraction.model, fields: applied }, { draftId: draft?.id, messageId: email.messageId, actorType: "ai" });
    }
  }

  return { notes, formAnswers: Object.keys(changed).length, aiAnswers };
}

// ---------- AI extraction ----------

const EXTRACTION_PROMPT = `You read an email (and any attached bills, receipts or medical reports) from an insurance claimant and pull out claim details.
Return ONLY a JSON object: {"fields": {"<key>": {"value": "<string>", "confidence": "high"|"low", "source": "text"|"attachment", "correction": true|false}}}
Keys you may return (omit any you can't find — never guess):
- policyNumber: insurance policy number
- claimType: one of outpatient, inpatient, pharmacy, dental, maternity, other
- incidentDate: date the incident happened, as YYYY-MM-DD
- incidentDescription: one or two sentences on what happened, in the claimant's words
- claimAmount: amount the claimant is claiming, number only
- diagnosisCode: ICD-10 diagnosis code
- procedureCode: CPT or HCPCS procedure code
- serviceDateFrom / serviceDateTo: first / last date of treatment, YYYY-MM-DD
- totalBilledAmount: provider's total bill, number only
- providerNpi: provider's 10-digit NPI
- providerTaxId: provider's tax ID
- facilityName / facilityAddress: where treatment happened
- coordinationOfBenefits: "yes" or "no" — ONLY if the claimant explicitly says whether they have other insurance
Rules:
- Codes (ICD-10, CPT/HCPCS, NPI, tax ID) only if they literally appear in the email or an attachment. Never infer a code from a description.
- source = "attachment" if the value came from an attached document, else "text".
- confidence = "low" if you are unsure you read or understood it correctly.
- correction = true only if the claimant clearly says a previously given value was wrong and gives a new one.
Values already on file (for context; return one only as a correction): `;

async function extractFieldsWithAi(text: string, attachments: InboundAttachment[], known: Record<string, string>): Promise<AiExtraction | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const prompt = `${EXTRACTION_PROMPT}${JSON.stringify(known)}\n\nEmail text:\n"""\n${text.slice(0, 8000)}\n"""`;
  const parts = attachments.map((a) => ({ inlineData: { mimeType: a.contentType, data: a.content.toString("base64") } }));
  const { text: response, model } = await generateContent(prompt, parts);
  const parsed = parseJsonResponse<{ fields?: AiExtraction["fields"] }>(response);
  return { fields: parsed.fields ?? {}, model };
}

// ---------- Drafts ----------

async function formContext(sender: string): Promise<FormContext> {
  return { policies: (await getPolicyStatusList({ kind: "email", email: sender })).map((p) => p.policyNumber) };
}

async function findDraftForThread(sender: string, ids: string[]): Promise<DraftRow | null> {
  if (ids.length === 0) return null;
  const { rows } = await pool.query(
    `SELECT * FROM email_claim_drafts
     WHERE sender_email = $1 AND thread_message_ids && $2::text[] AND status IN ('collecting', 'awaiting_confirmation')
     ORDER BY updated_at DESC LIMIT 1`,
    [sender, ids]
  );
  return rows[0] ?? null;
}

async function otherOpenDrafts(sender: string, exceptId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM email_claim_drafts WHERE sender_email = $1 AND id <> $2 AND status IN ('collecting', 'awaiting_confirmation')`,
    [sender, exceptId]
  );
  return rows[0].n;
}

async function createDraft(sender: string, email: InboundEmail, ctx: FormContext): Promise<{ draft: DraftRow; state: DraftState }> {
  const collected: Record<string, unknown> = {};
  const name = await nameForEmail(sender);
  if (name) collected.claimantName = name;
  if (ctx.policies.length === 1) collected.policyNumber = ctx.policies[0];
  const { rows } = await pool.query(
    `INSERT INTO email_claim_drafts (sender_email, subject, thread_message_ids, collected_fields) VALUES ($1, $2, $3, $4) RETURNING *`,
    [sender, stripSubjectPrefixes(email.subject).slice(0, 200), email.messageId ? [email.messageId] : [], JSON.stringify(collected)]
  );
  const draft: DraftRow = rows[0];
  await logEvent(sender, "draft-created", undefined, { draftId: draft.id, messageId: email.messageId });
  return { draft, state: stateOf(draft) };
}

/** Saves the state and replies: the confirmation summary when complete, otherwise the flagged form. */
async function respondWithState(draft: DraftRow, state: DraftState, ctx: FormContext, email: InboundEmail, intro: string, notes: string[]): Promise<void> {
  const status = isComplete(state) ? "awaiting_confirmation" : "collecting";
  draft.status = status;
  await saveDraft(draft.id, { state, status });
  const text = status === "awaiting_confirmation" ? confirmationText(state, ctx, notes) : formReplyText(state, ctx, intro, notes);
  await replyInThread(draft, state, email.messageId, text);
}

async function otherDraftsNote(sender: string, draftId: string): Promise<string[]> {
  const n = await otherOpenDrafts(sender, draftId);
  return n
    ? [`You also have ${n} other claim${n === 1 ? "" : "s"} in progress from an earlier email — reply in that email's thread to carry on with it.`]
    : [];
}

async function startBlankDraft(email: InboundEmail, sender: string): Promise<void> {
  const ctx = await formContext(sender);
  const { draft, state } = await createDraft(sender, email, ctx);
  const intro =
    "To raise a claim, reply to this email with the form below filled in, and attach at least one supporting document " +
    "(bill, receipt or report — PDF or photo). Leave a line blank if you don't know it; we'll ask about it.";
  const notes = await otherDraftsNote(sender, draft.id);
  await replyInThread(draft, state, email.messageId, [intro, ...notes.map((n) => `• ${n}`), "", renderForm(state, ctx, false)].join("\n") + SIGN_OFF);
}

async function startDraftFromEmail(email: InboundEmail, sender: string, newText: string): Promise<boolean> {
  const ctx = await formContext(sender);
  const { draft, state } = await createDraft(sender, email, ctx);
  const { notes, formAnswers, aiAnswers } = await applyEmail(draft, state, ctx, email, newText, sender);
  // Nothing claim-like found and nothing attached: not a claim after all.
  if (formAnswers + aiAnswers < 2 && state.documents.length === 0) {
    await saveDraft(draft.id, { status: "abandoned" });
    await logEvent(sender, "draft-discarded-not-a-claim", undefined, { draftId: draft.id });
    return false;
  }
  notes.push(...(await otherDraftsNote(sender, draft.id)));
  await respondWithState(draft, state, ctx, email, "Thanks — we've started your claim from your email. Here's what we have so far:", notes);
  return true;
}

async function submitDraft(draft: DraftRow, state: DraftState, ctx: FormContext, email: InboundEmail): Promise<void> {
  const f = state.collected as Record<string, any>;
  try {
    const result = await raiseClaimByEmail(
      draft.sender_email,
      {
        policyNumber: f.policyNumber,
        claimType: f.claimType,
        claimantName: f.claimantName,
        incidentDate: f.incidentDate,
        incidentDescription: f.incidentDescription,
        claimAmount: f.claimAmount,
        diagnosisCode: f.diagnosisCode,
        procedureCode: f.procedureCode,
        providerNpi: f.providerNpi,
        providerTaxId: f.providerTaxId,
        facilityName: f.facilityName,
        facilityAddress: f.facilityAddress,
        serviceDateFrom: f.serviceDateFrom,
        serviceDateTo: f.serviceDateTo ?? null,
        totalBilledAmount: f.totalBilledAmount,
        coordinationOfBenefits: f.coordinationOfBenefits,
        attested: f.attested,
      },
      state.documents.map((d) => ({ originalname: d.name, mimetype: d.contentType, url: d.url, size: d.size }))
    );
    draft.status = "submitted";
    await saveDraft(draft.id, { status: "submitted", claim_id: result.claimId });
    // SPEC.md §13 — the claimant's confirmation is a human step on the claim;
    // draftId joins it to the pre-claim history in email_intake_events.
    await pool.query(
      `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail) VALUES ($1, 'human', $2, 'email-intake-confirmed', $3)`,
      [result.claimId, draft.sender_email, JSON.stringify({ draftId: draft.id, messageId: email.messageId })]
    );
    await logEvent(draft.sender_email, "submitted", { claimId: result.claimId }, { draftId: draft.id, messageId: email.messageId, actorType: "human" });
    await replyInThread(
      draft,
      state,
      email.messageId,
      `Your claim has been submitted — reference ${result.shortRef}.\n\n` +
        "We'll email you as it progresses. You can also reply CLAIM STATUS to this address at any time." +
        SIGN_OFF
    );
  } catch (err) {
    if (err instanceof ClaimValidationError) {
      // Same recovery as WhatsApp batch 1: clear only the field at fault.
      const field = err.field && fieldByKey(err.field);
      if (field) {
        rejectValue(state, field.key, formatValue(state.collected[field.key]), err.message);
        await respondWithState(draft, state, ctx, email, "We couldn't submit your claim yet — please fix the marked line and reply with the form.", []);
      } else {
        await replyInThread(
          draft,
          state,
          email.messageId,
          `We couldn't submit your claim: ${err.message}\n\nReply RESTART to start over, or CANCEL to discard it.${SIGN_OFF}`
        );
      }
      await logEvent(draft.sender_email, "submit-rejected", { field: err.field ?? null, error: err.message }, { draftId: draft.id, messageId: email.messageId });
      return;
    }
    console.error(`Email intake submit failed for draft ${draft.id}:`, err);
    await logEvent(draft.sender_email, "submit-failed", { error: String(err) }, { draftId: draft.id, messageId: email.messageId });
    await replyInThread(draft, state, email.messageId, `Something went wrong submitting your claim. Please reply CONFIRM again in a little while.${SIGN_OFF}`);
  }
}

async function continueDraft(draft: DraftRow, email: InboundEmail, newText: string): Promise<void> {
  const sender = draft.sender_email;
  if (email.messageId) draft.thread_message_ids = [...draft.thread_message_ids, email.messageId];
  await saveDraft(draft.id, { thread_message_ids: draft.thread_message_ids, touchInbound: true });
  const ctx = await formContext(sender);
  const state = stateOf(draft);

  const keyword = controlKeyword(newText);
  if (keyword === "cancel") {
    draft.status = "abandoned";
    await saveDraft(draft.id, { status: "abandoned" });
    await logEvent(sender, "cancelled", undefined, { draftId: draft.id, messageId: email.messageId, actorType: "human" });
    await replyInThread(draft, state, email.messageId, `Your claim draft has been discarded. Email us again any time to start a new one.${SIGN_OFF}`);
    return;
  }
  if (keyword === "restart") {
    const fresh: DraftState = { collected: {}, invalid: {}, lowConfidence: [], documents: [] };
    const name = await nameForEmail(sender);
    if (name) fresh.collected.claimantName = name;
    if (ctx.policies.length === 1) fresh.collected.policyNumber = ctx.policies[0];
    draft.status = "collecting";
    await saveDraft(draft.id, { state: fresh, status: "collecting" });
    await logEvent(sender, "restarted", undefined, { draftId: draft.id, messageId: email.messageId, actorType: "human" });
    await replyInThread(draft, fresh, email.messageId, formReplyText(fresh, ctx, "Starting over. Please fill in the form below and attach your documents.", []));
    return;
  }
  if (keyword === "confirm") {
    if (draft.status === "awaiting_confirmation" && isComplete(state)) {
      await submitDraft(draft, state, ctx, email);
    } else {
      await respondWithState(draft, state, ctx, email, "Your claim isn't ready to submit yet — a few details are still needed:", []);
    }
    return;
  }

  const { notes } = await applyEmail(draft, state, ctx, email, newText, sender);
  const remaining = missingRequired(state).length + Object.keys(state.invalid).length;
  await respondWithState(
    draft,
    state,
    ctx,
    email,
    remaining ? "Thanks — we've updated your claim. A few details are still needed:" : "Thanks — we've updated your claim.",
    notes
  );
}

// ---------- Entry point ----------

// Anywhere in the local part, e.g. googlecommunityteam-noreply@google.com.
const AUTOMATED_LOCAL_PART = /^(mailer-daemon|postmaster|bounces?)\b|(^|[-_.+])(no-?reply|do-?not-?reply)([-_.+]|$)/i;

export async function processInboundEmail(email: InboundEmail): Promise<void> {
  const sender = email.from.trim().toLowerCase();
  if (!email.messageId || !sender) return;
  if (!(await markProcessed(email.messageId))) return;
  const ref = { messageId: email.messageId };

  // Our own mail, bounces, auto-replies and lists never get a reply (no loops).
  if (sender === intakeAddress() || email.automated || AUTOMATED_LOCAL_PART.test(sender.split("@")[0])) {
    await logEvent(sender, "dropped-automated", undefined, ref);
    return;
  }

  // Decision 2: a forged From gets no reply — replying would email the real person.
  const auth = checkSenderAuth(email.authResults, sender, authservId());
  if (!auth.pass) {
    await logEvent(sender, "dropped-unauthenticated", { reason: auth.reason }, ref);
    return;
  }

  if (!(await isKnownEmail(sender))) {
    const { rows } = await pool.query(
      `SELECT 1 FROM email_intake_events WHERE sender_email = $1 AND action = 'unknown-sender-replied' AND created_at > now() - interval '24 hours' LIMIT 1`,
      [sender]
    );
    if (rows.length) {
      await logEvent(sender, "dropped-unknown-sender", undefined, ref);
    } else {
      await replyTo(email, UNKNOWN_SENDER_REPLY);
      await logEvent(sender, "unknown-sender-replied", undefined, ref);
    }
    return;
  }

  await logEvent(sender, "received", { subject: email.subject, attachments: email.attachments.length, auth: auth.reason }, ref);
  const newText = stripQuoted(email.text);

  const draft = await findDraftForThread(sender, [email.inReplyTo, ...email.references].filter((id): id is string => !!id));
  if (draft) {
    await continueDraft(draft, email, newText);
    return;
  }

  const intent = detectIntent(email.subject, newText);
  if (intent === "raise") return startBlankDraft(email, sender);
  if (intent === "claim_status") return replyClaimStatus(email, sender, newText);
  if (intent === "policy_status") return replyPolicyStatus(email, sender);

  // An email that already describes a claim skips the blank form.
  if (email.attachments.length > 0 || stripFormBlock(newText).split(/\s+/).filter(Boolean).length >= 15 || newText.includes(FORM_START)) {
    if (await startDraftFromEmail(email, sender, newText)) return;
  }
  await replyTo(email, menuText(await nameForEmail(sender)));
}

// ---------- Reminder / expiry sweep (Decision 3) ----------

export async function sweepDrafts(): Promise<void> {
  const expired = await pool.query(
    `UPDATE email_claim_drafts SET status = 'expired', updated_at = now()
     WHERE status IN ('collecting', 'awaiting_confirmation') AND last_inbound_at < now() - make_interval(days => $1)
     RETURNING *`,
    [expiryDays()]
  );
  for (const draft of expired.rows as DraftRow[]) {
    await logEvent(draft.sender_email, "expired", undefined, { draftId: draft.id });
    await replyInThread(
      draft,
      stateOf(draft),
      null,
      `We haven't heard back about this claim for ${expiryDays()} days, so this draft has closed. Nothing was submitted — just email us again whenever you're ready.${SIGN_OFF}`
    );
  }

  const due = await pool.query(
    `UPDATE email_claim_drafts SET reminder_sent_at = now()
     WHERE status IN ('collecting', 'awaiting_confirmation') AND reminder_sent_at IS NULL
       AND last_inbound_at < now() - make_interval(days => $1)
     RETURNING *`,
    [reminderDays()]
  );
  for (const draft of due.rows as DraftRow[]) {
    const ctx = await formContext(draft.sender_email);
    const state = stateOf(draft);
    const text =
      draft.status === "awaiting_confirmation"
        ? confirmationText(state, ctx, ["Reminder: your claim is ready — it just needs your CONFIRM to be submitted."])
        : formReplyText(state, ctx, `Reminder: your claim isn't submitted yet. It will close in ${expiryDays() - reminderDays()} days if we don't hear back.`, []);
    await logEvent(draft.sender_email, "reminder-sent", undefined, { draftId: draft.id });
    await replyInThread(draft, state, null, text);
  }
}
