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
    const policy = policyRows[0] as { id: string } | undefined;

    const validationPassed = missingFields.length === 0 && !!policy;

    if (policy) {
      await pool.query(`UPDATE claims SET policy_id = $1, updated_at = now() WHERE id = $2`, [
        policy.id,
        claimId,
      ]);
    }

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "validated",
      detail: { validationPassed, missingFields, policyMatched: !!policy },
    });

    return job.complete({
      validationPassed,
      policyId: policy?.id ?? null,
    });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
