import { pool } from "./db";
import { createClaim, type CreateClaimDocument, type CreateClaimInput } from "./create-claim";
import { shortClaimId } from "../../shared/short-claim-id";

// Channel-agnostic intent layer per the locked
// .claude/specs/generic/claims-assistant.md ("Shared assistant layer") —
// WhatsApp (routes/whatsapp.ts) is the only caller today; a Phase 2 portal
// chatbot would call these same functions with a different identity shape.
// Kept in backend/api/src rather than backend/shared/ for the same reason
// as create-claim.ts: every dependency here is api-local, and the only
// callers live inside this package.

export interface ClaimStatusSummary {
  id: string;
  shortRef: string;
  status: string;
  claimType: string;
  claimAmount: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimStatusDetail extends ClaimStatusSummary {
  denialReason: string | null;
  infoRequestedReason: string | null;
  caseSummary: string | null;
}

// Claimant-facing status copy — labels and 3-stage progress duplicated from
// frontend/portal/components/StatusBadge.tsx STATUS_META so every channel says
// the same thing (claims-assistant.md addendum 2026-09-29).
export const CLAIM_STATUS_COPY: Record<string, { label: string; glyph: string; stage: 1 | 2 | 3; next: string }> = {
  submitted: { label: "Submitted", glyph: "○", stage: 1, next: "We've received your claim and are about to check it against your policy." },
  validating: { label: "Validating", glyph: "○", stage: 1, next: "We're checking your claim details and documents against your policy." },
  triage: { label: "In triage", glyph: "◐", stage: 2, next: "A reviewer is checking your claim and will pass it to the right team." },
  in_review: { label: "Under review", glyph: "◐", stage: 2, next: "A specialist is reviewing your claim and will make a decision." },
  awaiting_info: { label: "Action needed", glyph: "!", stage: 2, next: "We need more information from you before we can continue. Please add it from this claim's page in the ClaimFlow portal." },
  approved: { label: "Approved", glyph: "✓", stage: 3, next: "Your claim has been approved." },
  denied: { label: "Denied", glyph: "✕", stage: 3, next: "Your claim was not approved. The reason is shown above." },
};

export function claimStatusCopy(status: string) {
  return CLAIM_STATUS_COPY[status] ?? { label: status, glyph: "○", stage: 1 as const, next: "" };
}

const STAGE_LABELS = ["Submitted", "In review", "Decision"] as const;

// e.g. "Submitted ✓ → In review ◐ → Decision"
export function claimProgressLine(status: string): string {
  const { stage, glyph } = claimStatusCopy(status);
  return STAGE_LABELS.map((label, i) => {
    const n = i + 1;
    if (n < stage) return `${label} ✓`;
    if (n === stage) return `${label} ${glyph}`;
    return label;
  }).join(" → ");
}

export interface PolicyStatusSummary {
  id: string;
  policyNumber: string;
  status: string;
  expiryDate: string;
}

// Who a lookup is for: WhatsApp knows the sender's phone, a portal session
// knows the user's email (claims-assistant.md "batch 2" addendum, item 3).
export type AssistantIdentity = { kind: "phone"; phone: string } | { kind: "email"; email: string };

// The person's own email(s) for a phone: the policyholder or dependent record
// carrying that phone — not everyone on their policy.
const EMAILS_FOR_PHONE = `SELECT lower(policyholder_email) FROM policies WHERE policyholder_phone = $1
                          UNION SELECT lower(email) FROM policy_dependents WHERE phone = $1`;

// Claim scope, with the identity value as $1. Email mirrors GET /api/claims
// (claimant_email). Phone covers WhatsApp-raised claims (claimant_phone) plus
// everything filed under that person's email, so portal claims show up too
// (addendum "batch 2", items 1-2).
function claimScope(identity: AssistantIdentity): { where: string; value: string } {
  return identity.kind === "email"
    ? { where: "lower(claims.claimant_email) = lower($1)", value: identity.email }
    : { where: `(claims.claimant_phone = $1 OR lower(claims.claimant_email) IN (${EMAILS_FOR_PHONE}))`, value: identity.phone };
}

export async function getClaimStatusList(identity: AssistantIdentity): Promise<ClaimStatusSummary[]> {
  const scope = claimScope(identity);
  const { rows } = await pool.query(
    `SELECT id, status, claim_type, claim_amount, created_at, updated_at
     FROM claims WHERE ${scope.where} ORDER BY updated_at DESC LIMIT 10`,
    [scope.value]
  );
  return rows.map((row) => ({
    id: row.id,
    shortRef: shortClaimId(row.id),
    status: row.status,
    claimType: row.claim_type,
    claimAmount: row.claim_amount,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function getClaimStatusDetail(identity: AssistantIdentity, claimId: string): Promise<ClaimStatusDetail | null> {
  const scope = claimScope(identity);
  const { rows } = await pool.query(
    `SELECT id, status, claim_type, claim_amount, created_at, updated_at, denial_reason, info_requested_reason, case_summary
     FROM claims WHERE ${scope.where} AND claims.id = $2`,
    [scope.value, claimId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    shortRef: shortClaimId(row.id),
    status: row.status,
    claimType: row.claim_type,
    claimAmount: row.claim_amount,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    denialReason: row.denial_reason,
    infoRequestedReason: row.info_requested_reason,
    caseSummary: row.case_summary,
  };
}

// Policy status: policies where the person is the policyholder or a
// dependent — mirrors GET /api/policies's claimant scoping (SPEC.md §9
// "Authorized claimants"), matched on phone or email per identity.
export async function getPolicyStatusList(identity: AssistantIdentity): Promise<PolicyStatusSummary[]> {
  const where =
    identity.kind === "email"
      ? "lower(policies.policyholder_email) = lower($1) OR lower(policy_dependents.email) = lower($1)"
      : "policies.policyholder_phone = $1 OR policy_dependents.phone = $1";
  const { rows } = await pool.query(
    `SELECT DISTINCT policies.id, policies.policy_number, policies.status, policies.expiry_date
     FROM policies
     LEFT JOIN policy_dependents ON policy_dependents.policy_id = policies.id
     WHERE ${where}
     ORDER BY policies.policy_number`,
    [identity.kind === "email" ? identity.email : identity.phone]
  );
  return rows.map((row) => ({
    id: row.id,
    policyNumber: row.policy_number,
    status: row.status,
    expiryDate: row.expiry_date.toISOString().slice(0, 10),
  }));
}

// A phone is "known" if it's on a policy (as policyholder or dependent) or
// has filed a claim before — the same signals the intents above scope by
// (claims-assistant.md addendum 2026-10-05, item 2).
export async function isKnownPhone(phone: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM policies WHERE policyholder_phone = $1)
         OR EXISTS (SELECT 1 FROM policy_dependents WHERE phone = $1)
         OR EXISTS (SELECT 1 FROM claims WHERE claimant_phone = $1) AS known`,
    [phone]
  );
  return rows[0].known;
}

export interface RaiseClaimResult {
  claimId: string;
  shortRef: string;
}

// fields carries every POST /api/claims field except channel/claimantPhone,
// which this function fixes to 'whatsapp' and the resolved phone.
export async function raiseClaim(
  phone: string,
  fields: Omit<CreateClaimInput, "channel" | "claimantPhone">,
  documents: CreateClaimDocument[]
): Promise<RaiseClaimResult> {
  const claim = await createClaim({ ...fields, channel: "whatsapp", claimantPhone: phone }, documents);
  return { claimId: claim.id, shortRef: shortClaimId(claim.id) };
}
