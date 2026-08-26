import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { getInsuranceTypeConfig } from "../shared/insurance-types/health";
import { generateContent, parseJsonResponse } from "../shared/gemini-client";

// SPEC.md §12 — detect-fraud-indicators.
interface DetectFraudIndicatorsVariables {
  claimId: string;
  insuranceType: string;
  caseSummary: string;
}

interface DetectFraudIndicatorsOutput {
  fraudIndicatorCount: number;
}

interface FraudDetectionResult {
  indicators: Array<{ type: string; description: string; confidence: number }>;
}

const JOB_TYPE = "detect-fraud-indicators";

zeebeClient.createWorker<DetectFraudIndicatorsVariables, Record<string, unknown>, DetectFraudIndicatorsOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, insuranceType, caseSummary } = job.variables;
    const config = getInsuranceTypeConfig(insuranceType);

    const responseText = await generateContent(`${config.fraudPromptTemplate}${caseSummary}`);
    const result = parseJsonResponse<FraudDetectionResult>(responseText);

    await pool.query(`DELETE FROM claim_fraud_indicators WHERE claim_id = $1`, [claimId]);

    for (const indicator of result.indicators) {
      await pool.query(
        `INSERT INTO claim_fraud_indicators (claim_id, type, description, confidence)
         VALUES ($1, $2, $3, $4)`,
        [claimId, indicator.type, indicator.description, indicator.confidence]
      );
    }

    await pool.query(
      `UPDATE claims SET fraud_indicator_count = $1, updated_at = now() WHERE id = $2`,
      [result.indicators.length, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "ai",
      actorId: JOB_TYPE,
      action: "detected_fraud_indicators",
      detail: { indicators: result.indicators },
    });

    return job.complete({ fraudIndicatorCount: result.indicators.length });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
