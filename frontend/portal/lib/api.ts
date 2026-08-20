import type { Claim, NewClaimInput } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {}

// backend/api's claims-list-by-policy-number endpoint (spec follow-up dependency,
// .claude/specs/generic/claimant-portal-ui.md#follow-up-dependencies — not built yet).
export async function fetchActiveClaimsByPolicy(policyNumber: string): Promise<Claim[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/claims?policyNumber=${encodeURIComponent(policyNumber)}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    throw new ApiError(`Couldn't load claims for that policy number (${res.status}).`);
  }
  return res.json();
}

// GET /api/claims/:id — documented in SPEC.md §7/§18.
export async function fetchClaim(claimId: string): Promise<Claim> {
  const res = await fetch(`${API_BASE_URL}/api/claims/${claimId}`, { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(`Couldn't load that claim (${res.status}).`);
  }
  return res.json();
}

// POST /api/claims — SPEC.md §5/§7 (BUILD-PLAN.md feature #3).
// carrierId/insuranceType are intentionally omitted here: per the locked UI spec
// they're hidden/derived fields, resolved server-side from policyNumber, not
// claimant-entered.
export async function submitClaim(input: NewClaimInput): Promise<Claim> {
  const body = new FormData();
  body.set("policyNumber", input.policyNumber);
  body.set("claimType", input.claimType);
  body.set("claimantName", input.claimantName);
  body.set("claimantEmail", input.claimantEmail);
  body.set("incidentDate", input.incidentDate);
  body.set("incidentDescription", input.incidentDescription);
  body.set("claimAmount", String(input.claimAmount));
  for (const file of input.documents) {
    body.append("documents", file);
  }

  const res = await fetch(`${API_BASE_URL}/api/claims`, { method: "POST", body });
  if (!res.ok) {
    let detail = "";
    try {
      const payload = await res.json();
      detail = payload?.message ?? "";
    } catch {
      // response wasn't JSON — fall through with no extra detail
    }
    throw new ApiError(detail || `Submitting the claim failed (${res.status}).`);
  }
  return res.json();
}
