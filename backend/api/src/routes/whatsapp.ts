import { Router } from "express";
import { pool } from "../db";
import { BUCKET, minioClient, publicUrl } from "../storage";
import { downloadMedia, sendMenu, sendText } from "../whatsapp-client";
import { getClaimStatusDetail, getClaimStatusList, getPolicyStatusList, raiseClaim } from "../claims-assistant";
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
  from: string;
  text: string | null;
  interactiveId: string | null;
  media: { id: string; mimeType: string; filename: string } | null;
}

function extractInboundMessage(body: any): InboundMessage | null {
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;
  const from = message.from;
  if (message.type === "text") {
    return { from, text: message.text?.body ?? "", interactiveId: null, media: null };
  }
  if (message.type === "interactive") {
    const id = message.interactive?.list_reply?.id ?? message.interactive?.button_reply?.id ?? null;
    return { from, text: null, interactiveId: id, media: null };
  }
  if (message.type === "image" || message.type === "document") {
    const m = message[message.type];
    return { from, text: null, interactiveId: null, media: { id: m.id, mimeType: m.mime_type, filename: m.filename ?? `${message.type}-${Date.now()}` } };
  }
  return { from, text: null, interactiveId: null, media: null };
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
    const detail = await getClaimStatusDetail(phone, claimId);
    if (!detail) {
      await sendText(phone, "I couldn't find that claim. Type 'menu' to start over.");
      return;
    }
    const lines = [`Claim ${detail.shortRef}`, `Status: ${detail.status}`, `Requested amount: $${detail.claimAmount}`];
    if (detail.denialReason) lines.push(`Denial reason: ${detail.denialReason}`);
    if (detail.infoRequestedReason) lines.push(`More info needed: ${detail.infoRequestedReason}`);
    lines.push("", "Type 'menu' for the main menu.");
    await sendText(phone, lines.join("\n"));
    await resetToMenu(phone);
    return;
  }
  const claims = await getClaimStatusList(phone);
  if (claims.length === 0) {
    await sendText(phone, "I couldn't find any claims for this number. Type 'menu' for the main menu.");
    await resetToMenu(phone);
    return;
  }
  await sendMenu(
    phone,
    "Here are your claims — pick one for details:",
    claims.map((c) => ({ id: `claim:${c.id}`, title: `${c.shortRef} — ${c.status}` }))
  );
}

async function handlePolicyStatusMenu(phone: string): Promise<void> {
  const policies = await getPolicyStatusList(phone);
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

// ---------- Raise-a-claim: plain sequential text Q&A ----------
// Decided at Lock (.claude/specs/generic/claims-assistant.md Open Question
// 1(b)) — no Meta Flow Builder access yet, so this asks one field at a time
// in the same order ClaimForm presents them, re-prompting on the same
// validation regexes POST /api/claims already enforces.

const CLAIM_TYPES = ["outpatient", "inpatient", "pharmacy", "dental", "maternity", "other"];

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

function nonEmpty(error: string) {
  return (text: string): ParseResult => (text.trim() ? { ok: true, value: text.trim() } : { ok: false, error });
}
function parseClaimType(text: string): ParseResult {
  const index = Number(text.trim()) - 1;
  if (Number.isInteger(index) && CLAIM_TYPES[index]) return { ok: true, value: CLAIM_TYPES[index] };
  if (CLAIM_TYPES.includes(text.trim().toLowerCase())) return { ok: true, value: text.trim().toLowerCase() };
  return { ok: false, error: `Please reply with a number 1-${CLAIM_TYPES.length}, or the type name.` };
}
function parseEmail(text: string): ParseResult {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
    ? { ok: true, value: text.trim() }
    : { ok: false, error: "That doesn't look like a valid email address." };
}
function parseDate(label: string) {
  return (text: string): ParseResult =>
    /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !Number.isNaN(Date.parse(text.trim()))
      ? { ok: true, value: text.trim() }
      : { ok: false, error: `${label} must be in YYYY-MM-DD format.` };
}
function parseOptionalDate(text: string): ParseResult {
  if (text.trim().toLowerCase() === "same") return { ok: true, value: null };
  return parseDate("Service date")(text);
}
function parsePositiveNumber(label: string) {
  return (text: string): ParseResult => {
    const n = Number(text.trim());
    return !Number.isNaN(n) && n > 0 ? { ok: true, value: n } : { ok: false, error: `${label} must be a number greater than 0.` };
  };
}
function parseYesNo(text: string): ParseResult {
  const t = text.trim().toLowerCase();
  if (["yes", "y"].includes(t)) return { ok: true, value: true };
  if (["no", "n"].includes(t)) return { ok: true, value: false };
  return { ok: false, error: "Please reply 'yes' or 'no'." };
}
function parsePattern(pattern: RegExp, error: string) {
  return (text: string): ParseResult => (pattern.test(text.trim()) ? { ok: true, value: text.trim() } : { ok: false, error });
}

interface StepDef {
  key: string;
  prompt: string;
  parse: (text: string) => ParseResult;
}

const RAISE_CLAIM_STEPS: StepDef[] = [
  { key: "policyNumber", prompt: "What's your policy number?", parse: nonEmpty("Policy number can't be blank.") },
  {
    key: "claimType",
    prompt: `What type of claim is this? Reply with a number:\n${CLAIM_TYPES.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    parse: parseClaimType,
  },
  { key: "claimantName", prompt: "What's your full name?", parse: nonEmpty("Name can't be blank.") },
  { key: "claimantEmail", prompt: "What's your email address?", parse: parseEmail },
  { key: "incidentDate", prompt: "What date did the incident happen? (YYYY-MM-DD)", parse: parseDate("Incident date") },
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
  { key: "serviceDateFrom", prompt: "What date was the service provided? (YYYY-MM-DD)", parse: parseDate("Service date") },
  { key: "serviceDateTo", prompt: "Last date of service, if different (YYYY-MM-DD) — or reply 'same'.", parse: parseOptionalDate },
  { key: "totalBilledAmount", prompt: "What's the total amount billed by the provider (USD)?", parse: parsePositiveNumber("Total billed amount") },
  {
    key: "coordinationOfBenefits",
    prompt: "Do you have other health insurance that might also cover this claim? (yes/no)",
    parse: parseYesNo,
  },
  { key: "providerNpi", prompt: "What's the provider's NPI (10 digits)?", parse: parsePattern(NPI_PATTERN, "Provider NPI must be exactly 10 digits.") },
  { key: "providerTaxId", prompt: "What's the provider's tax ID?", parse: nonEmpty("Provider tax ID can't be blank.") },
  { key: "facilityName", prompt: "What's the facility name?", parse: nonEmpty("Facility name can't be blank.") },
  { key: "facilityAddress", prompt: "What's the facility address?", parse: nonEmpty("Facility address can't be blank.") },
  {
    key: "attested",
    prompt: "Do you confirm the information you've provided is accurate to the best of your knowledge? (yes/no)",
    parse: parseYesNo,
  },
];

function nextUnansweredStep(collected: Record<string, unknown>): StepDef | null {
  return RAISE_CLAIM_STEPS.find((s) => !(s.key in collected)) ?? null;
}

async function startRaisingClaim(phone: string): Promise<void> {
  await updateSession(phone, { mode: "raising_claim", collected_fields: {}, documents: [] });
  await sendText(phone, `Let's raise a claim. ${RAISE_CLAIM_STEPS[0].prompt}`);
}

async function handleRaisingClaim(phone: string, session: Session, text: string | null, media: InboundMessage["media"]): Promise<void> {
  const step = nextUnansweredStep(session.collected_fields);

  if (step) {
    if (!text) {
      await sendText(phone, `Please answer in text for now. ${step.prompt}`);
      return;
    }
    const result = step.parse(text);
    if (!result.ok) {
      await sendText(phone, `${result.error}\n${step.prompt}`);
      return;
    }
    const collected = { ...session.collected_fields, [step.key]: result.value };
    await updateSession(phone, { collected_fields: collected });
    const next = nextUnansweredStep(collected);
    if (next) {
      await sendText(phone, next.prompt);
    } else {
      await sendText(phone, "Last step — please send at least one supporting document (photo or PDF). Type 'done' when you've sent everything.");
    }
    return;
  }

  // All text fields collected — now accepting documents until "done".
  if (media) {
    try {
      const { buffer, mimeType } = await downloadMedia(media.id);
      const objectKey = `${Date.now()}-${media.filename}`;
      await minioClient.putObject(BUCKET, objectKey, buffer, buffer.length, { "Content-Type": mimeType });
      const documents = [...session.documents, { name: media.filename, url: publicUrl(objectKey), contentType: mimeType, size: buffer.length }];
      await updateSession(phone, { documents });
      await sendText(phone, `Document added (${documents.length} so far). Send another, or type 'done' when finished.`);
    } catch (err) {
      console.error(`WhatsApp media download failed for ${phone}:`, err);
      await sendText(phone, "Sorry, I couldn't process that file. Please try sending it again.");
    }
    return;
  }

  if (text?.trim().toLowerCase() !== "done") {
    await sendText(phone, "Please send a document, or type 'done' when you've sent everything.");
    return;
  }

  if (session.documents.length === 0) {
    await sendText(phone, "At least one document is required. Please send one, or type 'cancel' to stop.");
    return;
  }

  try {
    const fields = session.collected_fields as Record<string, any>;
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
    await sendText(phone, `Your claim has been raised — reference ${result.shortRef}. We'll message you here as its status changes. Type 'menu' for the main menu.`);
  } catch (err) {
    if (err instanceof ClaimValidationError) {
      await sendText(phone, `Couldn't raise the claim: ${err.message}\nType 'cancel' to start over, or 'menu' for the main menu.`);
      return;
    }
    console.error(`WhatsApp raiseClaim failed for ${phone}:`, err);
    await sendText(phone, "Something went wrong raising your claim. Please try again later.");
  }
  await resetToMenu(phone);
}

// ---------- Webhook entry point ----------

whatsappRouter.post("/webhook", async (req, res) => {
  // Always 200 — Meta retries/backs off a webhook that doesn't ack quickly,
  // and a malformed/non-message event (delivery receipts, etc.) is common
  // and not an error on our side.
  res.sendStatus(200);

  try {
    const inbound = extractInboundMessage(req.body);
    if (!inbound) return;
    const { from: phone, text, interactiveId, media } = inbound;

    const session = await getOrCreateSession(phone);
    const trimmed = text?.trim().toLowerCase();

    if (trimmed === "menu" || trimmed === "hi" || trimmed === "hello") {
      await resetToMenu(phone);
      await sendTopLevelMenu(phone);
      return;
    }
    if (trimmed === "cancel" && session.mode !== "menu") {
      await resetToMenu(phone);
      await sendText(phone, "Cancelled. Type 'menu' any time to start over.");
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
      await handleRaisingClaim(phone, session, text, media);
      return;
    }
  } catch (err) {
    console.error("POST /api/whatsapp/webhook failed:", err);
  }
});
