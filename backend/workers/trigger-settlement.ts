import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { mockSettlementProvider } from "../shared/settlement-provider";

// SPEC.md §12 / .claude/specs/worker/trigger-settlement.md — trigger-settlement.
// Not insurance-type aware. claims.status is already 'approved' from
// capture-review-decision (and unchanged by the optional capture-signoff
// step) by the time this runs.
interface TriggerSettlementVariables {
  claimId: string;
  claimAmount: number;
}

interface TriggerSettlementOutput {
  settlementId: string;
}

const JOB_TYPE = "trigger-settlement";

zeebeClient.createWorker<TriggerSettlementVariables, Record<string, unknown>, TriggerSettlementOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, claimAmount } = job.variables;

    const { settlementId } = await mockSettlementProvider.pay(claimId, claimAmount);

    await pool.query(
      `UPDATE claims SET settlement_id = $1, updated_at = now() WHERE id = $2`,
      [settlementId, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "system",
      actorId: JOB_TYPE,
      action: "settlement_triggered",
      detail: { settlementId, claimAmount },
    });

    return job.complete({ settlementId });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
