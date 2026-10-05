import { createHmac, timingSafeEqual } from "node:crypto";
import { Request, Router } from "express";
import { pool } from "../db";
import { BUCKET, minioClient, publicUrl } from "../storage";
import { downloadMedia, sendButtons, sendMenu, sendText, type MenuOption } from "../whatsapp-client";
import {
  claimProgressLine,
  claimStatusCopy,
  getClaimStatusDetail,
  getClaimStatusList,
  getPolicyStatusList,
  isKnownPhone,
  raiseClaim,
  type ClaimStatusDetail,
} from "../claims-assistant";
import { CPT_OR_HCPCS_PATTERN, ClaimValidationError, ICD10_PATTERN, NPI_PATTERN } from "../create-claim";

// WhatsApp claims assistant webhook — .claude/specs/generic/claims-assistant.md
// (Phase 1). Menu-driven: any message with no active mode gets the top-level
// menu; a menu selection puts the phone's session into claim_status |
// policy_status | raising_claim mode, and every following message from that
// phone is routed by mode until the intent completes or the user cancels.

export const whatsappRouter = Router();

whatsappRouter.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ---------- Signature verification (claims-assistant.md addendum 2026-09-29) ----------

if (!process.env.WHATSAPP_APP_SECRET) {
  console.warn(
    "WHATSAPP_APP_SECRET is not set — POST /api/whatsapp/webhook accepts unsigned events. Set it before exposing the webhook publicly."
  );
}

// Meta signs each event as X-Hub-Signature-256: sha256=<HMAC-SHA256 of the
// raw body, keyed with the App Secret>. Unset secret = local mock mode.
function hasValidSignature(req: Request & { rawBody?: Buffer }): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  const header = req.get("x-hub-signature-256");
  if (!header?.startsWith("sha256=") || !req.rawBody) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(req.rawBody).digest("hex"));
  const received = Buffer.from(header.slice("sha256=".length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// ---------- Session persistence (whatsapp_sessions, migration 0016) ----------

interface Session {
  id: string;
  phone_number: string;
  mode: "menu" | "claim_status" | "policy_status" | "raising_claim";
  collected_fields: Record<string, unknown>;
  documents: Array<{ name: string; url: string; contentType: string; size: number }>;
  status: "active" | "completed" | "abandoned";
}

async function getOrCreateSession(phone: string): Promise<Session> {
  const { rows } = await pool.query(
    `INSERT INTO whatsapp_sessions (phone_number) VALUES ($1)
     ON CONFLICT (phone_number) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [phone]
  );
  return rows[0];
}

async function resetToMenu(phone: string): Promise<void> {
  await pool.query(
    `UPDATE whatsapp_sessions SET mode = 'menu', collected_fields = '{}', documents = '[]', status = 'active', updated_at = now()
     WHERE phone_number = $1`,
    [phone]
  );
}

async function updateSession(phone: string, patch: Partial<Pick<Session, "mode" | "collected_fields" | "documents" | "status">>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    params.push(key === "collected_fields" || key === "documents" ? JSON.stringify(value) : value);
    sets.push(`${key} = $${params.length}`);
  }
  params.push(phone);
  await pool.query(`UPDATE whatsapp_sessions SET ${sets.join(", ")}, updated_at = now() WHERE phone_number = $${params.length}`, params);
}

// ---------- Inbound message parsing (Meta Cloud API webhook shape) ----------

interface InboundMessage {
  messageId: string | null;
  from: string;
  text: string | null;
  interactiveId: string | null;
  media: { id: string; mimeType: string; filename: string } | null;
}

function extractInboundMessage(body: any): InboundMessage | null {
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;
  const from = message.from;
  const messageId: string | null = message.id ?? null;
  if (message.type === "text") {
    return { messageId, from, text: message.text?.body ?? "", interactiveId: null, media: null };
  }
  if (message.type === "interactive") {
    const id = message.interactive?.list_reply?.id ?? message.interactive?.button_reply?.id ?? null;
    return { messageId, from, text: null, interactiveId: id, media: null };
  }
  if (message.type === "image" || message.type === "document") {
    const m = message[message.type];
    return { messageId, from, text: null, interactiveId: null, media: { id: m.id, mimeType: m.mime_type, filename: m.filename ?? `${message.type}-${Date.now()}` } };
  }
  return { messageId, from, text: null, interactiveId: null, media: null };
}

// ---------- Menu ----------

const MENU_OPTIONS = [
  { id: "check_claim_status", title: "Check claim status" },
  { id: "check_policy_status", title: "Check policy status" },
  { id: "raise_claim", title: "Raise a claim" },
];

async function sendTopLevelMenu(phone: string): Promise<void> {
  await sendMenu(phone, "Hi! I'm the ClaimFlow assistant. What would you like to do?", MENU_OPTIONS);
}

// ---------- Claim / policy status intents ----------

async function handleClaimStatusMenu(phone: string, session: Session, text: string | null, interactiveId: string | null): Promise<void> {
  if (interactiveId?.startsWith("claim:")) {
    const claimId = interactiveId.slice("claim:".length);
    const detail = await getClaimStatusDetail({ kind: "phone", phone }, claimId);
    if (!detail) {
      await sendText(phone, "I couldn't find that claim. Type 'menu' to start over.");
      return;
    }
    await sendText(phone, formatClaimDetail(detail));
    await resetToMenu(phone);
    await sendButtons(phone, "Anything else?", [
      { id: "check_claim_status", title: "Other claims" },
      { id: "main_menu", title: "Main menu" },
    ]);
    return;
  }
  const claims = await getClaimStatusList({ kind: "phone", phone });
  if (claims.length === 0) {
    await sendText(phone, "I couldn't find any claims for this number. Type 'menu' for the main menu.");
    await resetToMenu(phone);
    return;
  }
  await sendMenu(
    phone,
    claims.length === 1 ? "Here's your claim. Tap it for details:" : `Here are your ${claims.length} most recent claims. Tap one for details:`,
    claims.map((c) => ({
      id: `claim:${c.id}`,
      title: `${c.shortRef} ${claimStatusCopy(c.status).label}`,
      description: `${formatAmount(c.claimAmount)} · ${titleCase(c.claimType)} · filed ${formatDate(c.createdAt)}`,
    }))
  );
}

// ---------- Claim status formatting (claims-assistant.md addendum 2026-09-29) ----------

// WhatsApp text messages allow 4096 chars; keep the AI summary readable in chat.
const CASE_SUMMARY_MAX = 700;

function formatAmount(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${amount}`;
}

// Date only, UTC — timezone standardization is still SPEC.md §14 future work.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatClaimDetail(d: ClaimStatusDetail): string {
  const copy = claimStatusCopy(d.status);
  const lines = [
    `*Claim ${d.shortRef}*`,
    `Status: ${copy.glyph} ${copy.label}`,
    `Progress: ${claimProgressLine(d.status)}`,
    "",
    `Type: ${titleCase(d.claimType)}`,
    `Amount: ${formatAmount(d.claimAmount)}`,
    `Filed: ${formatDate(d.createdAt)}`,
    `Last update: ${formatDate(d.updatedAt)}`,
  ];
  if (d.denialReason) lines.push("", `*Reason:* ${d.denialReason}`);
  if (d.infoRequestedReason) lines.push("", `*Information needed:* ${d.infoRequestedReason}`);
  if (d.caseSummary) {
    const summary = d.caseSummary.length > CASE_SUMMARY_MAX ? `${d.caseSummary.slice(0, CASE_SUMMARY_MAX - 1).trimEnd()}…` : d.caseSummary;
    lines.push("", "*AI case summary*", summary);
  }
  if (copy.next) lines.push("", `*What happens next:* ${copy.next}`);
  return lines.join("\n");
}

async function handlePolicyStatusMenu(phone: string): Promise<void> {
  const policies = await getPolicyStatusList({ kind: "phone", phone });
  if (policies.length === 0) {
    await sendText(phone, "I couldn't find any policies for this number. Type 'menu' for the main menu.");
    await resetToMenu(phone);
    return;
  }
  const lines = policies.map((p) => `${p.policyNumber} — ${p.status} (expires ${p.expiryDate})`);
  lines.push("", "Type 'menu' for the main menu.");
  await sendText(phone, lines.join("\n"));
  await resetToMenu(phone);
}

// ---------- Raise-a-claim: sequential Q&A ----------
// Decided at Lock (.claude/specs/generic/claims-assistant.md Open Question
// 1(b)) — no Meta Flow Builder access yet, so this asks one field at a time
// in the same order ClaimForm presents them, re-prompting on the same
// validation regexes POST /api/claims already enforces. Where an answer has a
// fixed set of values (policy, claim type, yes/no) it's offered as a list or
// reply buttons, with typed answers still accepted (addendum 2026-10-05).

const CLAIM_TYPES = ["outpatient", "inpatient", "pharmacy", "dental", "maternity", "other"];

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };
type Parser = (text: string | null, interactiveId: string | null, phone: string) => ParseResult | Promise<ParseResult>;

// Wraps a text-only parser: a stale button/list tap on a typed question gets
// asked to type instead.
function typed(parse: (text: string) => ParseResult): (text: string | null, interactiveId?: string | null) => ParseResult {
  return (text) => (text === null ? { ok: false, error: "Please type your answer." } : parse(text));
}

function nonEmpty(error: string) {
  return typed((text) => (text.trim() ? { ok: true, value: text.trim() } : { ok: false, error }));
}

// Tapped or typed, the policy must be one of the sender's own (addendum
// 2026-10-05) — typed input is matched case-insensitively and stored in the
// policy's own casing.
async function parsePolicyNumber(text: string | null, interactiveId: string | null, phone: string): Promise<ParseResult> {
  const answer = interactiveId?.startsWith("policy:") ? interactiveId.slice("policy:".length) : text?.trim();
  if (!answer) return { ok: false, error: "Please pick your policy from the list, or type its number." };
  const match = (await getPolicyStatusList({ kind: "phone", phone })).find((p) => p.policyNumber.toLowerCase() === answer.toLowerCase());
  return match
    ? { ok: true, value: match.policyNumber }
    : { ok: false, error: `"${answer}" isn't one of your policies. Please pick one from the list.` };
}

function parseClaimType(text: string | null, interactiveId: string | null): ParseResult {
  if (interactiveId?.startsWith("claim_type:")) return { ok: true, value: interactiveId.slice("claim_type:".length) };
  const t = text?.trim().toLowerCase() ?? "";
  const index = Number(t) - 1;
  if (Number.isInteger(index) && CLAIM_TYPES[index]) return { ok: true, value: CLAIM_TYPES[index] };
  if (CLAIM_TYPES.includes(t)) return { ok: true, value: t };
  return { ok: false, error: "Please pick a claim type from the list." };
}

const parseEmail = typed((text) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
    ? { ok: true, value: text.trim() }
    : { ok: false, error: "That doesn't look like a valid email address." }
);

// ---------- Date parsing (addendum 2026-10-05, item 5) ----------

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Returns YYYY-MM-DD, or null for an impossible date like 31/02/2026.
function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

// "today"/"yesterday" use the server's local date.
function localIsoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())!;
}

// Accepts YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (day first), "3 Oct 2026" /
// "3 October 2026", "today", "yesterday".
function toIsoDate(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (t === "today") return localIsoDate(0);
  if (t === "yesterday") return localIsoDate(1);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?,?\s+(\d{4})$/);
  if (m) {
    const month = MONTH_NAMES.findIndex((name) => name.startsWith(m![2]));
    return month === -1 ? null : isoDate(Number(m[3]), month + 1, Number(m[1]));
  }
  return null;
}

const DATE_HINT = "e.g. 2026-10-03, 03/10/2026, 3 Oct 2026, or 'today'";

function parseDate(label: string) {
  return typed((text) => {
    const value = toIsoDate(text);
    return value ? { ok: true, value } : { ok: false, error: `${label} isn't a date I recognise (${DATE_HINT}).` };
  });
}

function parseLastServiceDate(text: string | null, interactiveId: string | null): ParseResult {
  if (interactiveId === "same_day" || text?.trim().toLowerCase() === "same") return { ok: true, value: null };
  return parseDate("Last date of service")(text, interactiveId);
}

function parsePositiveNumber(label: string) {
  return typed((text) => {
    const n = Number(text.trim().replace(/[$,]/g, ""));
    return !Number.isNaN(n) && n > 0 ? { ok: true, value: n } : { ok: false, error: `${label} must be a number greater than 0.` };
  });
}

function yesNo(text: string | null, interactiveId: string | null): boolean | null {
  const t = interactiveId ?? text?.trim().toLowerCase();
  if (t === "yes" || t === "y") return true;
  if (t === "no" || t === "n") return false;
  return null;
}

function parseYesNo(text: string | null, interactiveId: string | null): ParseResult {
  const value = yesNo(text, interactiveId);
  return value === null ? { ok: false, error: "Please answer Yes or No." } : { ok: true, value };
}

// The attestation must be "yes" — createClaim() would reject "no" anyway, so
// say so now rather than after the documents step.
function parseAttestation(text: string | null, interactiveId: string | null): ParseResult {
  const value = yesNo(text, interactiveId);
  if (value === true) return { ok: true, value };
  if (value === false) return { ok: false, error: "You need to confirm the information is accurate to submit a claim. Type 'cancel' to stop." };
  return { ok: false, error: "Please answer Yes or No." };
}

function parsePattern(pattern: RegExp, error: string) {
  return typed((text) => (pattern.test(text.trim()) ? { ok: true, value: text.trim() } : { ok: false, error }));
}

const MAIN_MENU_OPTION: MenuOption = { id: "main_menu", title: "Main menu" };

const YES_NO_BUTTONS: MenuOption[] = [
  { id: "yes", title: "Yes" },
  { id: "no", title: "No" },
];

// Every raise-a-claim message carries a way back to the top-level menu
// (addendum 2026-10-05); typed answers still work alongside the button.
async function sendWithMainMenu(phone: string, body: string): Promise<void> {
  await sendButtons(phone, body, [MAIN_MENU_OPTION]);
}

interface StepDef {
  key: string;
  prompt: string;
  parse: Parser;
  // Offered as a tappable list (options) or reply buttons (buttons); typed
  // answers are still parsed either way.
  options?: (phone: string) => Promise<MenuOption[]>;
  buttons?: MenuOption[];
}

const RAISE_CLAIM_STEPS: StepDef[] = [
  {
    key: "policyNumber",
    prompt: "Which policy is this claim for? Tap one below, or type the policy number.",
    parse: parsePolicyNumber,
    options: async (phone) =>
      (await getPolicyStatusList({ kind: "phone", phone })).map((p) => ({
        id: `policy:${p.policyNumber}`,
        title: p.policyNumber,
        description: `${titleCase(p.status)} · expires ${formatDate(p.expiryDate)}`,
      })),
  },
  {
    key: "claimType",
    prompt: "What type of claim is this?",
    parse: parseClaimType,
    options: async () => CLAIM_TYPES.map((t) => ({ id: `claim_type:${t}`, title: titleCase(t) })),
  },
  { key: "claimantName", prompt: "What's your full name?", parse: nonEmpty("Name can't be blank.") },
  { key: "claimantEmail", prompt: "What's your email address?", parse: parseEmail },
  { key: "incidentDate", prompt: `What date did the incident happen? (${DATE_HINT})`, parse: parseDate("Incident date") },
  { key: "incidentDescription", prompt: "Briefly describe what happened.", parse: nonEmpty("Please describe what happened.") },
  { key: "claimAmount", prompt: "What's the claim amount you're requesting (USD)?", parse: parsePositiveNumber("Claim amount") },
  {
    key: "diagnosisCode",
    prompt: "What's the diagnosis code (ICD-10, e.g. E11.9)?",
    parse: parsePattern(ICD10_PATTERN, "Diagnosis code must be a valid ICD-10 code (e.g. E11.9)."),
  },
  {
    key: "procedureCode",
    prompt: "What's the procedure code (CPT — 5 digits, or HCPCS — letter + 4 digits)?",
    parse: parsePattern(CPT_OR_HCPCS_PATTERN, "Procedure code must be a valid CPT (5 digits) or HCPCS (letter + 4 digits) code."),
  },
  { key: "serviceDateFrom", prompt: `What date was the service provided? (${DATE_HINT})`, parse: parseDate("Service date") },
  {
    key: "serviceDateTo",
    prompt: "Last date of service, if different? Tap Same day, or type the date.",
    parse: parseLastServiceDate,
    buttons: [{ id: "same_day", title: "Same day" }],
  },
  { key: "totalBilledAmount", prompt: "What's the total amount billed by the provider (USD)?", parse: parsePositiveNumber("Total billed amount") },
  {
    key: "coordinationOfBenefits",
    prompt: "Do you have other health insurance that might also cover this claim?",
    parse: parseYesNo,
    buttons: YES_NO_BUTTONS,
  },
  { key: "providerNpi", prompt: "What's the provider's NPI (10 digits)?", parse: parsePattern(NPI_PATTERN, "Provider NPI must be exactly 10 digits.") },
  { key: "providerTaxId", prompt: "What's the provider's tax ID?", parse: nonEmpty("Provider tax ID can't be blank.") },
  { key: "facilityName", prompt: "What's the facility name?", parse: nonEmpty("Facility name can't be blank.") },
  { key: "facilityAddress", prompt: "What's the facility address?", parse: nonEmpty("Facility address can't be blank.") },
  {
    key: "attested",
    prompt: "Do you confirm the information you've provided is accurate to the best of your knowledge?",
    parse: parseAttestation,
    buttons: YES_NO_BUTTONS,
  },
];

const DOCUMENTS_PROMPT = "Last step — please send at least one supporting document (photo or PDF). Type 'done' when you've sent everything.";

function nextUnansweredStep(collected: Record<string, unknown>): StepDef | null {
  return RAISE_CLAIM_STEPS.find((s) => !(s.key in collected)) ?? null;
}

// Sends a step's question — as a list, reply buttons, or a text question with
// a Main menu button — with an optional lead-in (an error, or "Let's raise a
// claim."). Lists hold ≤ 10 rows and messages ≤ 3 buttons, one of which is
// always Main menu.
async function askStep(phone: string, step: StepDef, leadIn = ""): Promise<void> {
  const body = leadIn ? `${leadIn}\n${step.prompt}` : step.prompt;
  if (step.buttons) {
    await sendButtons(phone, body, [...step.buttons.slice(0, 2), MAIN_MENU_OPTION]);
    return;
  }
  const options = step.options ? await step.options(phone) : [];
  if (options.length > 0) {
    await sendMenu(phone, body, [...options.slice(0, 9), MAIN_MENU_OPTION]);
  } else {
    await sendWithMainMenu(phone, body);
  }
}

async function startRaisingClaim(phone: string): Promise<void> {
  await updateSession(phone, { mode: "raising_claim", collected_fields: {}, documents: [] });
  await askStep(phone, RAISE_CLAIM_STEPS[0], "Let's raise a claim.");
}

async function handleRaisingClaim(
  phone: string,
  session: Session,
  text: string | null,
  interactiveId: string | null,
  media: InboundMessage["media"]
): Promise<void> {
  const step = nextUnansweredStep(session.collected_fields);

  if (step) {
    if (!text && !interactiveId) {
      await askStep(phone, step, "I can't use a file here — documents come at the end.");
      return;
    }
    const result = await step.parse(text, interactiveId, phone);
    if (!result.ok) {
      await askStep(phone, step, result.error);
      return;
    }
    const collected = { ...session.collected_fields, [step.key]: result.value };
    await updateSession(phone, { collected_fields: collected });
    const next = nextUnansweredStep(collected);
    if (next) {
      await askStep(phone, next);
    } else if (session.documents.length > 0) {
      // Re-answering a field after a rejected submission — documents are already in.
      await sendWithMainMenu(phone, "Thanks, updated. Type 'done' to submit your claim, or send another document.");
    } else {
      await sendWithMainMenu(phone, DOCUMENTS_PROMPT);
    }
    return;
  }

  // All fields collected — now accepting documents until "done".
  if (media) {
    try {
      const { buffer, mimeType } = await downloadMedia(media.id);
      const objectKey = `${Date.now()}-${media.filename}`;
      await minioClient.putObject(BUCKET, objectKey, buffer, buffer.length, { "Content-Type": mimeType });
      const documents = [...session.documents, { name: media.filename, url: publicUrl(objectKey), contentType: mimeType, size: buffer.length }];
      await updateSession(phone, { documents });
      await sendWithMainMenu(phone, `Document added (${documents.length} so far). Send another, or type 'done' when finished.`);
    } catch (err) {
      console.error(`WhatsApp media download failed for ${phone}:`, err);
      await sendText(phone, "Sorry, I couldn't process that file. Please try sending it again.");
    }
    return;
  }

  if (text?.trim().toLowerCase() !== "done") {
    await sendWithMainMenu(phone, "Please send a document, or type 'done' when you've sent everything.");
    return;
  }

  if (session.documents.length === 0) {
    await sendWithMainMenu(phone, "At least one document is required. Please send one, or type 'cancel' to stop.");
    return;
  }

  const fields = session.collected_fields as Record<string, any>;
  try {
    const result = await raiseClaim(
      phone,
      {
        policyNumber: fields.policyNumber,
        claimType: fields.claimType,
        claimantName: fields.claimantName,
        claimantEmail: fields.claimantEmail,
        incidentDate: fields.incidentDate,
        incidentDescription: fields.incidentDescription,
        claimAmount: fields.claimAmount,
        diagnosisCode: fields.diagnosisCode,
        procedureCode: fields.procedureCode,
        providerNpi: fields.providerNpi,
        providerTaxId: fields.providerTaxId,
        facilityName: fields.facilityName,
        facilityAddress: fields.facilityAddress,
        serviceDateFrom: fields.serviceDateFrom,
        serviceDateTo: fields.serviceDateTo,
        totalBilledAmount: fields.totalBilledAmount,
        coordinationOfBenefits: fields.coordinationOfBenefits,
        attested: fields.attested,
      },
      session.documents.map((d) => ({ originalname: d.name, mimetype: d.contentType, url: d.url, size: d.size }))
    );
    // Status changes go out by email only (notify-claimant) — WhatsApp pushes
    // are future work (addendum 2026-10-05, item 1).
    await sendText(
      phone,
      `Your claim has been raised — reference ${result.shortRef}. We'll email you at ${fields.claimantEmail} as it progresses, and you can check it here any time with "Check claim status". Type 'menu' for the main menu.`
    );
  } catch (err) {
    if (err instanceof ClaimValidationError) {
      // Re-ask just the field at fault, keeping every other answer and the
      // documents (addendum 2026-10-05, item 3).
      const faulty = err.field && RAISE_CLAIM_STEPS.find((s) => s.key === err.field);
      if (faulty) {
        const { [faulty.key]: _dropped, ...rest } = session.collected_fields;
        await updateSession(phone, { collected_fields: rest });
        await askStep(phone, faulty, `Couldn't raise the claim: ${err.message}\nLet's fix that.`);
      } else {
        await sendButtons(phone, `Couldn't raise the claim: ${err.message}`, [
          { id: "restart_claim", title: "Start over" },
          { id: "main_menu", title: "Main menu" },
        ]);
      }
      return;
    }
    console.error(`WhatsApp raiseClaim failed for ${phone}:`, err);
    await sendText(phone, "Something went wrong raising your claim. Please try again later.");
  }
  await resetToMenu(phone);
}

// ---------- Webhook entry point ----------

const UNKNOWN_NUMBER_REPLY =
  "Sorry, this WhatsApp number isn't linked to any ClaimFlow policy, so I can't help with claims from it. Please contact your insurer to add this number to your policy, then message me again.";

// Records the message id; false if it was already handled (a Meta
// redelivery — addendum 2026-10-05, item 4).
async function markProcessed(messageId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO whatsapp_processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING`,
    [messageId]
  );
  return rowCount === 1;
}

whatsappRouter.post("/webhook", async (req, res) => {
  if (!hasValidSignature(req)) {
    console.warn("POST /api/whatsapp/webhook rejected: missing or invalid X-Hub-Signature-256");
    return res.sendStatus(401);
  }

  // Otherwise always 200 — Meta retries/backs off a webhook that doesn't ack quickly,
  // and a malformed/non-message event (delivery receipts, etc.) is common
  // and not an error on our side.
  res.sendStatus(200);

  try {
    const inbound = extractInboundMessage(req.body);
    if (!inbound) return;
    const { messageId, from: phone, text, interactiveId, media } = inbound;

    if (messageId && !(await markProcessed(messageId))) return;

    // Unrecognized numbers get one fixed reply and no session
    // (addendum 2026-10-05, item 2).
    if (!(await isKnownPhone(phone))) {
      await sendText(phone, UNKNOWN_NUMBER_REPLY);
      return;
    }

    const session = await getOrCreateSession(phone);
    const trimmed = text?.trim().toLowerCase();

    if (trimmed === "menu" || trimmed === "hi" || trimmed === "hello" || interactiveId === "main_menu") {
      await resetToMenu(phone);
      await sendTopLevelMenu(phone);
      return;
    }
    if (trimmed === "cancel" && session.mode !== "menu") {
      await resetToMenu(phone);
      await sendText(phone, "Cancelled. Type 'menu' any time to start over.");
      return;
    }
    if (interactiveId === "restart_claim") {
      await startRaisingClaim(phone);
      return;
    }

    if (session.mode === "menu") {
      if (interactiveId === "check_claim_status") {
        await updateSession(phone, { mode: "claim_status" });
        await handleClaimStatusMenu(phone, session, text, null);
      } else if (interactiveId === "check_policy_status") {
        await updateSession(phone, { mode: "policy_status" });
        await handlePolicyStatusMenu(phone);
      } else if (interactiveId === "raise_claim") {
        await startRaisingClaim(phone);
      } else {
        await sendTopLevelMenu(phone);
      }
      return;
    }

    if (session.mode === "claim_status") {
      await handleClaimStatusMenu(phone, session, text, interactiveId);
      return;
    }

    if (session.mode === "policy_status") {
      // Read-only, single-shot — a fresh message here just re-shows the menu.
      await sendTopLevelMenu(phone);
      await resetToMenu(phone);
      return;
    }

    if (session.mode === "raising_claim") {
      await handleRaisingClaim(phone, session, text, interactiveId, media);
      return;
    }
  } catch (err) {
    console.error("POST /api/whatsapp/webhook failed:", err);
  }
});
