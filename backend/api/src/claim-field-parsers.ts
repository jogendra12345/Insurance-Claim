// Text parsers for claim fields typed by a claimant into a conversational
// channel — shared by the WhatsApp assistant (routes/whatsapp.ts) and email
// intake (email-intake.ts) so both accept exactly the same answers
// (.claude/specs/generic/email-claim-intake.md "Field extraction"). These
// only check one answer's format; createClaim() still re-validates the whole
// claim at submit.

export const CLAIM_TYPES = ["outpatient", "inpatient", "pharmacy", "dental", "maternity", "other"];

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function parseNonEmpty(text: string, error: string): ParseResult {
  return text.trim() ? { ok: true, value: text.trim() } : { ok: false, error };
}

// Accepts a 1-based number from a numbered list or the type's name.
export function parseClaimTypeText(text: string): ParseResult {
  const t = text.trim().toLowerCase();
  const index = Number(t) - 1;
  if (Number.isInteger(index) && CLAIM_TYPES[index]) return { ok: true, value: CLAIM_TYPES[index] };
  if (CLAIM_TYPES.includes(t)) return { ok: true, value: t };
  return { ok: false, error: "Please pick a claim type from the list." };
}

export function parseEmailText(text: string): ParseResult {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
    ? { ok: true, value: text.trim() }
    : { ok: false, error: "That doesn't look like a valid email address." };
}

// ---------- Dates (claims-assistant.md addendum 2026-10-05, item 5) ----------

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
export function toIsoDate(text: string): string | null {
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

export const DATE_HINT = "e.g. 2026-10-03, 03/10/2026, 3 Oct 2026, or 'today'";

export function parseDateText(text: string, label: string): ParseResult {
  const value = toIsoDate(text);
  return value ? { ok: true, value } : { ok: false, error: `${label} isn't a date I recognise (${DATE_HINT}).` };
}

export function parsePositiveNumberText(text: string, label: string): ParseResult {
  const n = Number(text.trim().replace(/[$,]/g, ""));
  return !Number.isNaN(n) && n > 0 ? { ok: true, value: n } : { ok: false, error: `${label} must be a number greater than 0.` };
}

export function yesNoText(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  if (t === "yes" || t === "y") return true;
  if (t === "no" || t === "n") return false;
  return null;
}

export function parsePatternText(text: string, pattern: RegExp, error: string): ParseResult {
  return pattern.test(text.trim()) ? { ok: true, value: text.trim() } : { ok: false, error };
}
