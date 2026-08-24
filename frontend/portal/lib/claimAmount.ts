// Simulates health-claim adjudication so the claimant sees an auto-assigned
// ceiling before typing an amount. Mirrors the industry-standard sequence —
// allowed amount, then deductible, then copay, then coinsurance split —
// capped at the policy's coverage amount.
//
// TYPICAL_BILLED_BY_CLAIM_TYPE stands in for a real fee schedule / extracted
// bill total (neither exists yet — extract-evidence isn't built, SPEC.md
// §12). Kept in sync by hand with backend/api/src/claimAmount.ts; both
// copies must change together if either does.
import type { ClaimType, Policy } from "./types";

export const TYPICAL_BILLED_BY_CLAIM_TYPE: Record<ClaimType, number> = {
  outpatient: 1200,
  inpatient: 15000,
  pharmacy: 300,
  dental: 800,
  maternity: 8000,
  other: 1000,
};

/** The most a claimant may submit for this claim type against this policy. */
export function calculateAssignedClaimAmount(claimType: ClaimType, policy: Policy): number {
  const allowed = TYPICAL_BILLED_BY_CLAIM_TYPE[claimType];
  const afterDeductible = Math.max(0, allowed - policy.deductibleAmount);
  const afterCopay = Math.max(0, afterDeductible - policy.copayAmount);
  const planPays = afterCopay * (1 - policy.coinsuranceRate);
  return Math.round(Math.min(planPays, policy.coverageAmount) * 100) / 100;
}
