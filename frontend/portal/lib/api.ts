import type { Claim, NewClaimInput, NewPolicyInput, Policy, Provider } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {}

// GET /api/policies — backs the policy-number dropdown.
export async function fetchPolicies(): Promise<Policy[]> {
  const res = await fetch(`${API_BASE_URL}/api/policies`, { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(`Couldn't load policies (${res.status}).`);
  }
  return res.json();
}

// GET /api/policies/:id — a single policy plus its dependents, for the policy detail page.
export async function fetchPolicy(policyId: string): Promise<Policy> {
  const res = await fetch(`${API_BASE_URL}/api/policies/${policyId}`, { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(`Couldn't load that policy (${res.status}).`);
  }
  return res.json();
}

// GET /api/providers — backs the claim form's provider picker (autofills
// facility name/address/tax ID on NPI selection).
export async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE_URL}/api/providers`, { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(`Couldn't load providers (${res.status}).`);
  }
  return res.json();
}

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

// GET /api/claims — all claims, for the Claims tab's grid + KPIs.
export async function fetchAllClaims(): Promise<Claim[]> {
  const res = await fetch(`${API_BASE_URL}/api/claims`, { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(`Couldn't load claims (${res.status}).`);
  }
  return res.json();
}

// POST /api/policies — the Policies tab's "add policy" panel.
export async function createPolicy(input: NewPolicyInput): Promise<Policy> {
  const res = await fetch(`${API_BASE_URL}/api/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.message ?? "";
    } catch {
      // not JSON — fall through
    }
    throw new ApiError(detail || `Adding the policy failed (${res.status}).`);
  }
  return res.json();
}

// DELETE /api/policies/:id
export async function deletePolicy(policyId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/policies/${policyId}`, { method: "DELETE" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.message ?? "";
    } catch {
      // not JSON — fall through
    }
    throw new ApiError(detail || `Deleting the policy failed (${res.status}).`);
  }
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
  body.set("diagnosisCode", input.diagnosisCode);
  body.set("procedureCode", input.procedureCode);
  body.set("providerNpi", input.providerNpi);
  body.set("providerTaxId", input.providerTaxId);
  body.set("facilityName", input.facilityName);
  body.set("facilityAddress", input.facilityAddress);
  body.set("serviceDateFrom", input.serviceDateFrom);
  body.set("serviceDateTo", input.serviceDateTo);
  body.set("totalBilledAmount", String(input.totalBilledAmount));
  body.set("coordinationOfBenefits", String(input.coordinationOfBenefits));
  body.set("attested", String(input.attested));
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
