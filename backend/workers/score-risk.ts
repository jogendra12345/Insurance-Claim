import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { generateContent, parseJsonResponse, GEMINI_MODEL } from "../shared/gemini-client";

// SPEC.md §12 — score-risk. Not insurance-type aware (only validate-claim,
// extract-evidence, and detect-fraud-indicators are, per §12/§3).
interface ScoreRiskVariables {
  claimId: string;
  claimAmount: number;
  fraudIndicatorCount: number;
  caseSummary: string;
}

interface ScoreRiskOutput {
  riskScore: number;
}

interface RiskScoreResult {
  riskScore: number;
  reasoning: string;
}

const JOB_TYPE = "score-risk";
const PROMPT_VERSION = "v1";

const PROMPT_TEMPLATE = `You are scoring the risk of an insurance claim for an adjuster's review.
You will be given the claim amount, the number of fraud indicators already
flagged against it, and a reviewer-facing case summary of its evidence.

Produce a single risk score from 0 (lowest risk) to 100 (highest risk),
grounded in the specifics given — do not invent details not present here.

Respond with ONLY a JSON object of this exact shape, no other text:
{
  "riskScore": 0,
  "reasoning": "string, 1-3 sentences explaining the score"
}

Claim amount: `;

zeebeClient.createWorker<ScoreRiskVariables, Record<string, unknown>, ScoreRiskOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, claimAmount, fraudIndicatorCount, caseSummary } = job.variables;

    const prompt =
      `${PROMPT_TEMPLATE}${claimAmount}\n` +
      `Fraud indicators flagged: ${fraudIndicatorCount}\n` +
      `Case summary: ${caseSummary}`;

    const responseText = await generateContent(prompt);
    const result = parseJsonResponse<RiskScoreResult>(responseText);

    await pool.query(
      `UPDATE claims SET risk_score = $1, risk_reasoning = $2, updated_at = now() WHERE id = $3`,
      [result.riskScore, result.reasoning, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "ai",
      actorId: JOB_TYPE,
      action: "scored_risk",
      detail: { riskScore: result.riskScore, reasoning: result.reasoning, model: GEMINI_MODEL, promptVersion: PROMPT_VERSION },
    });

    return job.complete({ riskScore: result.riskScore });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
