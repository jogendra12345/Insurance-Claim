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
  updatedAt: string;
}

export interface ClaimStatusDetail extends ClaimStatusSummary {
  claimAmount: string;
  denialReason: string | null;
  infoRequestedReason: string | null;
}

export interface PolicyStatusSummary {
  id: string;
  policyNumber: string;
  status: string;
  expiryDate: string;
}

// Claim status is scoped by claimant_phone directly — mirrors how
// GET /api/claims scopes a portal claimant by claimant_email, no
// policyholder/dependent join (a claim only carries the phone of whoever
// actually filed it, same as it only carries their email today).
export async function getClaimStatusList(phone: string): Promise<ClaimStatusSummary[]> {
  const { rows } = await pool.query(
    `SELECT id, status, updated_at FROM claims WHERE claimant_phone = $1 ORDER BY updated_at DESC LIMIT 10`,
    [phone]
  );
  return rows.map((row) => ({
    id: row.id,
    shortRef: shortClaimId(row.id),
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function getClaimStatusDetail(phone: string, claimId: string): Promise<ClaimStatusDetail | null> {
  const { rows } = await pool.query(
    `SELECT id, status, updated_at, claim_amount, denial_reason, info_requested_reason
     FROM claims WHERE id = $1 AND claimant_phone = $2`,
    [claimId, phone]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    shortRef: shortClaimId(row.id),
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    claimAmount: row.claim_amount,
    denialReason: row.denial_reason,
    infoRequestedReason: row.info_requested_reason,
  };
}

// Policy status is scoped by policyholder_phone OR a policy_dependents.phone
// row — mirrors GET /api/policies's claimant scoping (SPEC.md §9 "Authorized
// claimants"), phone-resolved here instead of session-resolved.
export async function getPolicyStatusList(phone: string): Promise<PolicyStatusSummary[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT policies.id, policies.policy_number, policies.status, policies.expiry_date
     FROM policies
     LEFT JOIN policy_dependents ON policy_dependents.policy_id = policies.id
     WHERE policies.policyholder_phone = $1 OR policy_dependents.phone = $1
     ORDER BY policies.policy_number`,
    [phone]
  );
  return rows.map((row) => ({
    id: row.id,
    policyNumber: row.policy_number,
    status: row.status,
    expiryDate: row.expiry_date.toISOString().slice(0, 10),
  }));
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
