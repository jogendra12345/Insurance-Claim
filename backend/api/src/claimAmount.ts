// Simulates health-claim adjudication (SPEC.md §9's claims.claim_type values)
// to compute the ceiling amount a claimant may submit for. Mirrors the
// industry-standard sequence — allowed amount, then deductible, then copay,
// then coinsurance split — capped at the policy's coverage_amount.
//
// TYPICAL_BILLED_BY_CLAIM_TYPE stands in for a real fee schedule / extracted
// bill total (neither exists yet — extract-evidence isn't built, SPEC.md
// §12). Kept in sync by hand with frontend/portal/lib/claimAmount.ts; both
// copies must change together if either does.
export type ClaimType = "outpatient" | "inpatient" | "pharmacy" | "dental" | "maternity" | "other";

export const TYPICAL_BILLED_BY_CLAIM_TYPE: Record<ClaimType, number> = {
  outpatient: 1200,
  inpatient: 15000,
  pharmacy: 300,
  dental: 800,
  maternity: 8000,
  other: 1000,
};

export interface AdjudicationPolicy {
  deductibleAmount: number;
  copayAmount: number;
  coinsuranceRate: number; // 0-1, the patient's share after deductible/copay
  coverageAmount: number;
}

/** The most a claimant may submit for this claim type against this policy. */
export function calculateAssignedClaimAmount(claimType: ClaimType, policy: AdjudicationPolicy): number {
  const allowed = TYPICAL_BILLED_BY_CLAIM_TYPE[claimType];
  const afterDeductible = Math.max(0, allowed - policy.deductibleAmount);
  const afterCopay = Math.max(0, afterDeductible - policy.copayAmount);
  const planPays = afterCopay * (1 - policy.coinsuranceRate);
  return Math.round(Math.min(planPays, policy.coverageAmount) * 100) / 100;
}
