import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { getInsuranceTypeConfig } from "../shared/insurance-types/health";

// SPEC.md §12 — validate-claim.
interface ValidateClaimVariables {
  claimId: string;
  insuranceType: string;
  carrierId: string;
  policyNumber: string;
  claimAmount: number;
}

interface ValidateClaimOutput {
  validationPassed: boolean;
  policyId: string | null;
  duplicatePendingClaim: boolean;
  duplicateClaimId: string | null;
  authorizedClaimant: boolean;
  // Deterministic fraud-risk signals for the DMN routing table (see
  // process/health-claim-routing.dmn) — cheap SQL-computed red flags rather
  // than leaving everything to the LLM-based fraud/risk workers to infer
  // from prose. null when there's no matched policy to compare against.
  daysSincePolicyEffective: number | null;
  claimantClaimCountLast12Months: number;
}

const JOB_TYPE = "validate-claim";

zeebeClient.createWorker<ValidateClaimVariables, Record<string, unknown>, ValidateClaimOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, insuranceType, carrierId, policyNumber } = job.variables;

    // SPEC.md §10's initial process variables don't include incidentDate,
    // even though §12 lists it as a validate-claim input — read here from
    // the claim's current row (by claimId, which *is* an initial process
    // variable) instead of assuming it's in job.variables.
    const { rows: claimRows } = await pool.query(`SELECT * FROM claims WHERE id = $1`, [claimId]);
    const claim = claimRows[0];
    if (!claim) {
      throw new Error(`validate-claim: no claims row for claimId ${claimId}`);
    }

    const config = getInsuranceTypeConfig(insuranceType);
    const missingFields = config.requiredFields.filter((field) => {
      const value = claim[field];
      return value === null || value === undefined || value === "";
    });

    const { rows: policyRows } = await pool.query(
      `SELECT * FROM policies
       WHERE policy_number = $1 AND carrier_id = $2
         AND status = 'active'
         AND $3::date BETWEEN effective_date AND expiry_date`,
      [policyNumber, carrierId, claim.incident_date]
    );
    const policy = policyRows[0] as
      | { id: string; effective_date: string; policyholder_name: string; policyholder_email: string }
      | undefined;

    // Duplicate-claim check: a policy shouldn't have two claims in flight at
    // once — if an earlier claim against the same policy hasn't reached a
    // final decision yet, this one fails validation and goes to a human via
    // Validation Exception Review rather than auto-denying (CLAUDE.md: a
    // human always makes the final approve/deny decision).
    const { rows: duplicateRows } = policy
      ? await pool.query(
          `SELECT id FROM claims
           WHERE policy_id = $1 AND id != $2 AND status NOT IN ('approved', 'denied')
           LIMIT 1`,
          [policy.id, claimId]
        )
      : { rows: [] as { id: string }[] };
    const duplicatePendingClaim = duplicateRows[0] as { id: string } | undefined;

    // Authorized-claimant check (SPEC.md §9 "Authorized claimants") — a
    // claim is only valid if the claimant is the policyholder or a listed
    // dependent, checked by email OR name (case-insensitive, either is
    // enough — requiring both would fail ordinary submissions over a
    // formatting mismatch, not an actual authorization problem). No policy
    // match means this check doesn't apply — that failure is already
    // captured by `!!policy` below, not this flag.
    let authorizedClaimant = true;
    if (policy) {
      const claimantEmail = claim.claimant_email.toLowerCase();
      const claimantName = claim.claimant_name.toLowerCase();
      const isPolicyholder =
        policy.policyholder_email.toLowerCase() === claimantEmail ||
        policy.policyholder_name.toLowerCase() === claimantName;
      const { rowCount: dependentMatchCount } = await pool.query(
        `SELECT id FROM policy_dependents
         WHERE policy_id = $1 AND (lower(email) = $2 OR lower(full_name) = $3)
         LIMIT 1`,
        [policy.id, claimantEmail, claimantName]
      );
      authorizedClaimant = isPolicyholder || (dependentMatchCount ?? 0) > 0;
    }

    const validationPassed =
      missingFields.length === 0 && !!policy && !duplicatePendingClaim && authorizedClaimant;

    // Always write policy_id (including null on no match) — POST
    // /api/claims sets it at intake from a lookup that only checks
    // policy_number exists (no status/date-range check), so a stale
    // intake-time value must not survive this worker's own stricter match
    // failing. capture-validation-exception.ts trusts policy_id as the
    // authoritative "did a policy genuinely match" signal.
    await pool.query(`UPDATE claims SET policy_id = $1, updated_at = now() WHERE id = $2`, [
      policy?.id ?? null,
      claimId,
    ]);

    // Entering the automated AI-triage phase (extract-evidence through the
    // DMN routing decision) — capture-routing-decision advances this to
    // 'triage' once routing is decided (SPEC.md §10).
    if (validationPassed) {
      await pool.query(`UPDATE claims SET status = 'validating', updated_at = now() WHERE id = $1`, [claimId]);
    }

    // Red flag: loss reported suspiciously close to the policy's effective date.
    const daysSincePolicyEffective = policy
      ? Math.round(
          (new Date(claim.incident_date).getTime() - new Date(policy.effective_date).getTime()) / (1000 * 60 * 60 * 24)
        )
      : null;

    // Red flag: claimant has filed several claims in the trailing 12 months.
    // Case-insensitive, matching the authorized-claimant check above — a
    // claimant varying email casing between submissions shouldn't dodge this.
    const { rows: claimCountRows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM claims
       WHERE lower(claimant_email) = $1 AND id != $2 AND created_at >= now() - interval '12 months'`,
      [claim.claimant_email.toLowerCase(), claimId]
    );
    const claimantClaimCountLast12Months = Number(claimCountRows[0].count);

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "validated",
      detail: {
        validationPassed,
        missingFields,
        policyMatched: !!policy,
        duplicatePendingClaim: !!duplicatePendingClaim,
        duplicateClaimId: duplicatePendingClaim?.id ?? null,
        authorizedClaimant,
        daysSincePolicyEffective,
        claimantClaimCountLast12Months,
      },
    });

    return job.complete({
      validationPassed,
      policyId: policy?.id ?? null,
      duplicatePendingClaim: !!duplicatePendingClaim,
      duplicateClaimId: duplicatePendingClaim?.id ?? null,
      authorizedClaimant,
      daysSincePolicyEffective,
      claimantClaimCountLast12Months,
    });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
