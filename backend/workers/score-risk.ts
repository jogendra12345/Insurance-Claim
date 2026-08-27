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
  riskReasoning: string;
}

interface RiskScoreResult {
  riskScore: number;
  reasoning: string;
}

const JOB_TYPE = "score-risk";
const PROMPT_VERSION = "v2-rubric";

const PROMPT_TEMPLATE = `You are scoring the risk of an insurance claim for an adjuster's review.
You will be given the claim amount, the number of fraud indicators already
flagged against it, and a reviewer-facing case summary of its evidence.

Score using this rubric — pick the band that best matches the evidence,
then place the score within that band based on severity:
- 0-19 (Low): No fraud indicators; the case summary describes complete,
  internally consistent documentation with nothing unusual.
- 20-39 (Low-moderate): No fraud indicators, but the case summary notes
  minor gaps or ambiguities (e.g. a missing non-critical field).
- 40-59 (Moderate): Exactly 1 fraud indicator, OR the case summary itself
  describes a real inconsistency (e.g. mismatched dates, incomplete
  records) even though no indicator was formally flagged.
- 60-79 (High): 2+ fraud indicators, OR the case summary describes a
  claimant/patient identity mismatch or a cross-document mismatch, OR a
  high claim amount combined with any of the above.
- 80-100 (Severe): 3+ fraud indicators, OR clear evidence of fabricated,
  placeholder, or entirely unrelated documentation, OR the documents
  plainly belong to someone other than the claimant.

Treat a mismatch or inconsistency described in the case summary as
significant even when fraudIndicatorCount is 0 — fraud detection can miss
things the narrative summary still captures. Ground the score in the
specifics given; do not invent details not present here.

Respond with ONLY a JSON object of this exact shape, no other text:
{
  "riskScore": 0,
  "reasoning": "string, 1-3 sentences explaining the score, naming which rubric band and why"
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

    return job.complete({ riskScore: result.riskScore, riskReasoning: result.reasoning });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
