import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { getInsuranceTypeConfig } from "../shared/insurance-types/health";
import { generateContent, parseJsonResponse, GEMINI_MODEL } from "../shared/gemini-client";

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
const PROMPT_VERSION = "v2-structured-data";

// Below this, an indicator is stored for the record but not counted toward
// fraudIndicatorCount / DMN routing — a single low-confidence guess
// shouldn't be enough to route a claim to investigator, mirroring real SIU
// practice of escalating on multiple concrete red flags, not one guess.
const FRAUD_COUNT_CONFIDENCE_THRESHOLD = 0.5;

zeebeClient.createWorker<DetectFraudIndicatorsVariables, Record<string, unknown>, DetectFraudIndicatorsOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, insuranceType, caseSummary } = job.variables;
    const config = getInsuranceTypeConfig(insuranceType);

    // Ground the model in the actual structured data extract-evidence pulled
    // per document, not just its narrative summary — a summary-of-a-summary
    // compounds whatever the first pass missed or compressed away.
    const { rows: documents } = await pool.query<{ extracted_data: unknown }>(
      `SELECT extracted_data FROM claim_documents WHERE claim_id = $1 AND extracted_data IS NOT NULL ORDER BY created_at`,
      [claimId]
    );
    const extractedDataBlock =
      documents.length > 0
        ? `\n\nExtracted document data:\n${JSON.stringify(documents.map((d) => d.extracted_data))}`
        : "";

    const responseText = await generateContent(`${config.fraudPromptTemplate}${caseSummary}${extractedDataBlock}`);
    const result = parseJsonResponse<FraudDetectionResult>(responseText);

    await pool.query(`DELETE FROM claim_fraud_indicators WHERE claim_id = $1`, [claimId]);

    for (const indicator of result.indicators) {
      await pool.query(
        `INSERT INTO claim_fraud_indicators (claim_id, type, description, confidence)
         VALUES ($1, $2, $3, $4)`,
        [claimId, indicator.type, indicator.description, indicator.confidence]
      );
    }

    const countedIndicators = result.indicators.filter((i) => i.confidence >= FRAUD_COUNT_CONFIDENCE_THRESHOLD);

    await pool.query(
      `UPDATE claims SET fraud_indicator_count = $1, updated_at = now() WHERE id = $2`,
      [countedIndicators.length, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "ai",
      actorId: JOB_TYPE,
      action: "detected_fraud_indicators",
      detail: {
        indicators: result.indicators,
        countedIndicators: countedIndicators.length,
        confidenceThreshold: FRAUD_COUNT_CONFIDENCE_THRESHOLD,
        model: GEMINI_MODEL,
        promptVersion: PROMPT_VERSION,
      },
    });

    return job.complete({ fraudIndicatorCount: countedIndicators.length });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
