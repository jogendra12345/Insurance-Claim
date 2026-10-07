// Pure (no I/O) pieces of email claim intake —
// .claude/specs/generic/email-claim-intake.md: the plain-text claim form
// (render + code-first parse), quoted-reply stripping, keyword intents, and
// the SPF/DKIM/DMARC check. email-intake.ts wires these to the database,
// MinIO, the AI and outbound mail.

import { CPT_OR_HCPCS_PATTERN, ICD10_PATTERN, NPI_PATTERN } from "./create-claim";
import {
  CLAIM_TYPES,
  parseClaimTypeText,
  parseDateText,
  parseNonEmpty,
  parsePatternText,
  parsePositiveNumberText,
  yesNoText,
  type ParseResult,
} from "./claim-field-parsers";

// ---------- Draft state ----------

export interface DraftDocument {
  name: string;
  url: string;
  contentType: string;
  size: number;
}

export interface DraftState {
  collected: Record<string, unknown>;
  invalid: Record<string, { value: string; error: string }>;
  lowConfidence: string[];
  documents: DraftDocument[];
}

export interface FormContext {
  // The sender's own policy numbers (same scope as policy status).
  policies: string[];
}

// ---------- Form fields ----------

export interface FormField {
  key: string;
  label: string;
  hint?: (ctx: FormContext) => string;
  required: boolean;
  // Extra label spellings a claimant might type.
  aliases?: string[];
  // false: the AI never fills this — it must be answered explicitly.
  aiExtractable: boolean;
  parse: (text: string, ctx: FormContext) => ParseResult;
}

function parsePolicy(text: string, ctx: FormContext): ParseResult {
  const match = ctx.policies.find((p) => p.toLowerCase() === text.trim().toLowerCase());
  if (match) return { ok: true, value: match };
  return {
    ok: false,
    error: ctx.policies.length
      ? `"${text.trim()}" isn't one of your policies (${ctx.policies.join(", ")}).`
      : "We couldn't find a policy for this email address — please contact your insurer.",
  };
}

function parseYesNoField(text: string): ParseResult {
  const value = yesNoText(text);
  return value === null ? { ok: false, error: "Please answer yes or no." } : { ok: true, value };
}

function parseAttestationField(text: string): ParseResult {
  const value = yesNoText(text);
  if (value === true) return { ok: true, value };
  if (value === false) return { ok: false, error: "You need to confirm the information is accurate to submit a claim. Reply CANCEL to stop." };
  return { ok: false, error: "Please answer yes or no." };
}

// One line per CreateClaimInput field except channel/claimantPhone and
// claimantEmail (the verified sender). Order: the portal ClaimForm /
// WhatsApp step order, regrouped so provider details sit together.
export const FORM_FIELDS: FormField[] = [
  {
    key: "policyNumber",
    label: "Policy number",
    hint: (ctx) => (ctx.policies.length ? `yours: ${ctx.policies.join(", ")}` : "none on file for this address"),
    required: true,
    aliases: ["policy", "policy no"],
    aiExtractable: true,
    parse: parsePolicy,
  },
  {
    key: "claimType",
    label: "Claim type",
    // No spaces, so the line stays under the ~76 characters mail clients wrap at.
    hint: () => CLAIM_TYPES.join("/"),
    required: true,
    aiExtractable: true,
    parse: (t) => parseClaimTypeText(t),
  },
  {
    key: "claimantName",
    label: "Your full name",
    required: true,
    aliases: ["name", "full name", "claimant name"],
    aiExtractable: false,
    parse: (t) => parseNonEmpty(t, "Name can't be blank."),
  },
  {
    key: "incidentDate",
    label: "Incident date",
    hint: () => "e.g. 03/10/2026, 3 Oct 2026, today",
    required: true,
    aliases: ["date of incident"],
    aiExtractable: true,
    parse: (t) => parseDateText(t, "Incident date"),
  },
  {
    key: "incidentDescription",
    label: "What happened",
    required: true,
    aliases: ["description", "incident description"],
    aiExtractable: true,
    parse: (t) => parseNonEmpty(t, "Please describe what happened."),
  },
  {
    key: "claimAmount",
    label: "Claim amount",
    hint: () => "USD",
    required: true,
    aliases: ["amount", "amount claimed"],
    aiExtractable: true,
    parse: (t) => parsePositiveNumberText(t, "Claim amount"),
  },
  {
    key: "diagnosisCode",
    label: "Diagnosis code",
    hint: () => "ICD-10, e.g. J18.9, on your bill",
    required: true,
    aliases: ["icd-10", "icd10", "diagnosis"],
    aiExtractable: true,
    parse: (t) => parsePatternText(t, ICD10_PATTERN, "Diagnosis code must be a valid ICD-10 code (e.g. E11.9)."),
  },
  {
    key: "procedureCode",
    label: "Procedure code",
    hint: () => "CPT or HCPCS, e.g. 99284, on your bill",
    required: true,
    aliases: ["cpt", "procedure"],
    aiExtractable: true,
    parse: (t) => parsePatternText(t, CPT_OR_HCPCS_PATTERN, "Procedure code must be a valid CPT (5 digits) or HCPCS (letter + 4 digits) code."),
  },
  {
    key: "serviceDateFrom",
    label: "Service date from",
    hint: () => "first day of treatment",
    required: true,
    aliases: ["service date", "date of service"],
    aiExtractable: true,
    parse: (t) => parseDateText(t, "Service date"),
  },
  {
    key: "serviceDateTo",
    label: "Service date to",
    hint: () => "leave blank if same day",
    required: false,
    aliases: ["last date of service"],
    aiExtractable: true,
    parse: (t) => parseDateText(t, "Last date of service"),
  },
  {
    key: "totalBilledAmount",
    label: "Total billed",
    hint: () => "USD, the provider's full bill",
    required: true,
    aliases: ["total billed amount", "billed amount"],
    aiExtractable: true,
    parse: (t) => parsePositiveNumberText(t, "Total billed amount"),
  },
  {
    key: "providerNpi",
    label: "Provider NPI",
    hint: () => "10 digits",
    required: true,
    aliases: ["npi"],
    aiExtractable: true,
    parse: (t) => parsePatternText(t, NPI_PATTERN, "Provider NPI must be exactly 10 digits."),
  },
  {
    key: "providerTaxId",
    label: "Provider tax ID",
    required: true,
    aliases: ["tax id"],
    aiExtractable: true,
    parse: (t) => parseNonEmpty(t, "Provider tax ID can't be blank."),
  },
  {
    key: "facilityName",
    label: "Facility name",
    required: true,
    aliases: ["facility", "hospital"],
    aiExtractable: true,
    parse: (t) => parseNonEmpty(t, "Facility name can't be blank."),
  },
  {
    key: "facilityAddress",
    label: "Facility address",
    required: true,
    aiExtractable: true,
    parse: (t) => parseNonEmpty(t, "Facility address can't be blank."),
  },
  {
    key: "coordinationOfBenefits",
    label: "Other insurance?",
    hint: () => "yes/no",
    required: true,
    aliases: ["other insurance", "other health insurance"],
    aiExtractable: true,
    parse: parseYesNoField,
  },
  {
    key: "attested",
    label: "I confirm this is accurate",
    hint: () => "yes/no",
    required: true,
    aliases: ["confirm accurate", "attest", "attestation"],
    aiExtractable: false,
    parse: parseAttestationField,
  },
];

const FIELD_BY_KEY = new Map(FORM_FIELDS.map((f) => [f.key, f]));

export function fieldByKey(key: string): FormField | undefined {
  return FIELD_BY_KEY.get(key);
}

// Label as typed → comparable key: lowercase, no (hints), no markers or
// punctuation, single spaces.
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELD_BY_LABEL = new Map<string, FormField>();
for (const f of FORM_FIELDS) {
  for (const label of [f.label, ...(f.aliases ?? [])]) FIELD_BY_LABEL.set(normalizeLabel(label), f);
}

// ---------- Rendering ----------

export const FORM_START = "----- CLAIM FORM -----";
export const FORM_END = "----- END OF FORM -----";

/** A stored value as it appears on the form (dates ISO, booleans yes/no). */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** Every field's displayed value — what a returned, unedited form line will contain. */
export function formValues(state: DraftState): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of FORM_FIELDS) {
    values[f.key] = state.invalid[f.key]?.value ?? formatValue(state.collected[f.key]);
  }
  return values;
}

export function missingRequired(state: DraftState): string[] {
  return FORM_FIELDS.filter((f) => f.required && !(f.key in state.collected) && !state.invalid[f.key]).map((f) => f.key);
}

export function isComplete(state: DraftState): boolean {
  return missingRequired(state).length === 0 && Object.keys(state.invalid).length === 0 && state.documents.length > 0;
}

/**
 * The form block. With flagIssues, missing/invalid lines get "⚠" and the
 * reason underneath, low-confidence lines get "?" (spec "Claim form template").
 */
export function renderForm(state: DraftState, ctx: FormContext, flagIssues: boolean): string {
  const values = formValues(state);
  const missing = new Set(missingRequired(state));
  const lines = [FORM_START];
  for (const f of FORM_FIELDS) {
    const invalid = state.invalid[f.key];
    const flag = !flagIssues
      ? ""
      : invalid || missing.has(f.key)
        ? "⚠ "
        : state.lowConfidence.includes(f.key)
          ? "? "
          : "";
    const hint = f.hint ? ` (${f.hint(ctx)})` : "";
    lines.push(`${flag}${f.label}${hint}: ${values[f.key]}`.trimEnd());
    if (flagIssues && invalid) lines.push(`   → ${invalid.error}`);
    else if (flagIssues && missing.has(f.key)) lines.push("   → Still needed.");
    else if (flagIssues && state.lowConfidence.includes(f.key)) lines.push("   → Please check, and change it if it's wrong.");
  }
  lines.push(FORM_END);
  return lines.join("\n");
}

// ---------- Parsing a returned form (code first) ----------

export interface ParsedForm {
  // Raw text per field key, as found on the form (blank values omitted).
  values: Record<string, string>;
  // Whether a "----- CLAIM FORM -----" block was found.
  foundBlock: boolean;
}

// The colon ending a "Label (hint):" — the first one outside parentheses,
// since a hint can contain one ("yours: POL-1234"). -1 if none.
function labelColon(line: string): number {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

function unquoteLine(line: string): string {
  return line.replace(/^(\s*>)+\s?/, "");
}

const CONTINUATION_SKIP = /^\s*(→|->|\(.*\)\s*$)/;

// Prose fields whose value may wrap onto following lines; a stray line after
// any other field (a code, a date) is never glued onto it.
const MULTILINE_FIELDS = new Set(["incidentDescription", "facilityName", "facilityAddress"]);

const BLOCK_PATTERN = /-+\s*claim form\s*-+[\s\S]*?(-+\s*end of form\s*-+|$)/i;

// Mail clients hard-wrap long lines (~76 chars), which can split a label
// mid-hint: "Claim type (outpatient / … /" + "other): dental". A line that
// leaves a "(" open is joined to the next one.
function unwrapHints(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (prev.match(/\(/g)?.length ?? 0) > (prev.match(/\)/g)?.length ?? 0)) {
      out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Reads "Label: value" lines from the first CLAIM FORM block (quote markers
 * stripped, so a form left in the quoted part still counts), then from any
 * known-label lines in the new, unquoted text — which win, since claimants
 * often type their answers above the quoted form without copying its markers.
 */
export function parseFormLines(fullText: string, newText: string): ParsedForm {
  const allLines = unwrapHints(fullText.split(/\r?\n/).map(unquoteLine));
  const start = allLines.findIndex((l) => /^-+\s*claim form\s*-+$/i.test(l.trim()));
  const values: Record<string, string> = {};
  let foundBlock = false;
  if (start !== -1) {
    const endOffset = allLines.slice(start + 1).findIndex((l) => /^-+\s*end of form\s*-+$/i.test(l.trim()));
    Object.assign(values, readLabelLines(allLines.slice(start + 1, endOffset === -1 ? undefined : start + 1 + endOffset), true));
    foundBlock = true;
  }
  const typed = unwrapHints(newText.replace(BLOCK_PATTERN, "").split(/\r?\n/));
  Object.assign(values, readLabelLines(typed, false));
  return { values, foundBlock };
}

// Wrapped-value joining only inside a form block — in free text, the next
// line is just more prose ("Thanks", a signature).
function readLabelLines(lines: string[], inBlock: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  let current: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const colon = labelColon(line);
    const field = colon > 0 ? FIELD_BY_LABEL.get(normalizeLabel(line.slice(0, colon))) : undefined;
    if (field) {
      current = field.key;
      const value = line.slice(colon + 1).trim();
      if (value) values[field.key] = value;
      else delete values[field.key];
      continue;
    }
    if (!line || CONTINUATION_SKIP.test(line)) continue; // blank/hint/arrow lines add nothing
    if (inBlock && current && MULTILINE_FIELDS.has(current)) {
      values[current] = values[current] ? `${values[current]} ${line}` : line;
    } else {
      current = null;
    }
  }
  return values;
}

function sameValue(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Form values that are real answers: changed from what that form showed when
 * we sent it (baseline), so an untouched pre-filled or quoted line is never
 * re-read as a new answer.
 */
export function changedFormValues(parsed: ParsedForm, baseline: Record<string, string>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.values)) {
    if (!sameValue(value, baseline[key] ?? "")) changed[key] = value;
  }
  return changed;
}

// ---------- Quoted-reply stripping ----------

/** The new part of a reply: drops quoted history, the signature, and "> " lines. */
export function stripQuoted(text: string): string {
  let body = text.replace(/\r\n/g, "\n");
  const cutPatterns = [
    /\n[^\n]*On [^\n]*(\n[^\n]*)?wrote:\s*\n/, // Gmail / Apple Mail (may wrap onto 2 lines)
    /\n-{2,}\s*Original Message\s*-{2,}/i, // Outlook
    /\n_{10,}\s*\n/, // Outlook (web)
    /\nFrom: [^\n]+\n(Sent|Date): /, // Outlook header block
    /\n-- \n/, // signature delimiter
  ];
  for (const pattern of cutPatterns) {
    const m = ("\n" + body).match(pattern);
    if (m && m.index !== undefined) body = ("\n" + body).slice(0, m.index).slice(1);
  }
  return body
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .trim();
}

/** Text outside any CLAIM FORM block — what's left for the AI pass. */
export function stripFormBlock(text: string): string {
  return text
    .replace(/-+\s*claim form\s*-+[\s\S]*?(-+\s*end of form\s*-+|$)/i, "")
    .split("\n")
    .filter((l) => {
      const colon = labelColon(l);
      return !(colon > 0 && FIELD_BY_LABEL.has(normalizeLabel(l.slice(0, colon))));
    })
    .join("\n")
    .trim();
}

// ---------- Intents and control keywords ----------

export type EmailIntent = "raise" | "claim_status" | "policy_status";

const INTENT_PATTERNS: Array<[EmailIntent, RegExp]> = [
  ["raise", /\b(raise|new|file|make|submit|start|open)\s+(a\s+|new\s+)?claim\b/i],
  ["policy_status", /\bpolicy status\b|\bpolic(y|ies)\b.*\bstatus\b|\bstatus\b.*\bpolic(y|ies)\b|\bmy polic(y|ies)\b/i],
  ["claim_status", /\bclaim status\b|\bstatus\b|\bwhere('s| is) my claim\b|#[0-9a-f]{8}\b/i],
];

export function stripSubjectPrefixes(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "").trim();
}

/** Keyword intent from the first lines of the new text, then the subject. */
export function detectIntent(subject: string, newText: string): EmailIntent | null {
  const head = newText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
  for (const source of [head, stripSubjectPrefixes(subject)]) {
    for (const [intent, pattern] of INTENT_PATTERNS) if (pattern.test(source)) return intent;
  }
  return null;
}

export function findShortRef(text: string): string | null {
  return text.match(/#([0-9a-f]{8})\b/i)?.[1].toLowerCase() ?? null;
}

export type ControlKeyword = "confirm" | "cancel" | "restart";

/** CONFIRM / CANCEL / RESTART as the first line of a reply. */
export function controlKeyword(newText: string): ControlKeyword | null {
  const first = newText.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (first.length > 40) return null;
  const m = first.match(/^(confirm(ed)?|cancel|restart|start over)\b/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (word.startsWith("confirm")) return "confirm";
  return word === "cancel" ? "cancel" : "restart";
}

// ---------- Sender authentication (Decision 2) ----------

function domainOf(addressOrDomain: string): string {
  const s = addressOrDomain.trim().toLowerCase().replace(/^@/, "");
  return s.includes("@") ? s.slice(s.lastIndexOf("@") + 1) : s;
}

// Relaxed alignment: same domain, or one is a subdomain of the other.
function aligned(a: string, b: string): boolean {
  const x = domainOf(a);
  const y = domainOf(b);
  return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
}

export interface AuthCheck {
  pass: boolean;
  reason: string;
}

/**
 * Trusts only the topmost Authentication-Results header stamped by our own
 * receiving server (authservId, mx.google.com for Gmail) — anything further
 * down could have been written by the sender. Pass = DMARC pass, or SPF and
 * DKIM both pass and aligned with the From domain.
 */
export function checkSenderAuth(headers: string[], fromAddress: string, authservId: string): AuthCheck {
  const ours = headers.find((h) => h.split(";")[0].trim().split(/\s+/)[0].toLowerCase() === authservId.toLowerCase());
  if (!ours) return { pass: false, reason: `no Authentication-Results from ${authservId}` };
  const results = ours.split(";").slice(1).map((r) => r.replace(/\s+/g, " ").trim());
  const fromDomain = domainOf(fromAddress);

  for (const r of results) {
    const m = r.match(/^dmarc=(\w+)/i);
    if (!m) continue;
    const headerFrom = r.match(/header\.from=([^\s;]+)/i)?.[1];
    if (m[1].toLowerCase() === "pass" && (!headerFrom || aligned(headerFrom, fromDomain))) return { pass: true, reason: "dmarc=pass" };
  }
  const spfPass = results.some((r) => {
    const m = r.match(/^spf=(\w+)/i);
    const mailFrom = r.match(/smtp\.mailfrom=([^\s;]+)/i)?.[1];
    return m?.[1].toLowerCase() === "pass" && !!mailFrom && aligned(mailFrom, fromDomain);
  });
  const dkimPass = results.some((r) => {
    const m = r.match(/^dkim=(\w+)/i);
    const signer = r.match(/header\.[id]=([^\s;]+)/i)?.[1];
    return m?.[1].toLowerCase() === "pass" && !!signer && aligned(signer, fromDomain);
  });
  if (spfPass && dkimPass) return { pass: true, reason: "spf=pass dkim=pass (aligned)" };
  return { pass: false, reason: `not authenticated: ${results.join("; ").slice(0, 300)}` };
}
