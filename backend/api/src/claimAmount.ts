// Simulates health-claim adjudication (SPEC.md §9's claims.claim_type values)
// to compute the ceiling amount a claimant may submit for. Mirrors the
// industry-standard sequence — allowed amount, then deductible, then copay,
// then coinsurance split — capped at the policy's coverage_amount.
//
// TYPICAL_COST_PCT_OF_COVERAGE stands in for a real fee schedule / extracted
// bill total (neither exists yet — extract-evidence isn't built, SPEC.md
// §12). It's expressed as a share of THIS policy's coverage_amount, not a
// flat dollar figure, so the assigned amount scales with the policy instead
// of being dwarfed by (or dwarfing) it — see .claude/specs/generic
// clarification 2026-08-24. Kept in sync by hand with
// frontend/portal/lib/claimAmount.ts; both copies must change together.
export type ClaimType = "outpatient" | "inpatient" | "pharmacy" | "dental" | "maternity" | "other";

export const TYPICAL_COST_PCT_OF_COVERAGE: Record<ClaimType, number> = {
  outpatient: 0.04,
  inpatient: 0.3,
  pharmacy: 0.03,
  dental: 0.03,
  maternity: 0.2,
  other: 0.03,
};

export interface AdjudicationPolicy {
  deductibleAmount: number;
  copayAmount: number;
  coinsuranceRate: number; // 0-1, the patient's share after deductible/copay
  coverageAmount: number;
}

/** The most a claimant may submit for this claim type against this policy. */
export function calculateAssignedClaimAmount(claimType: ClaimType, policy: AdjudicationPolicy): number {
  const allowed = policy.coverageAmount * TYPICAL_COST_PCT_OF_COVERAGE[claimType];
  const afterDeductible = Math.max(0, allowed - policy.deductibleAmount);
  const afterCopay = Math.max(0, afterDeductible - policy.copayAmount);
  const planPays = afterCopay * (1 - policy.coinsuranceRate);
  return Math.round(Math.min(planPays, policy.coverageAmount) * 100) / 100;
}
