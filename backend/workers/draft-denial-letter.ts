import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { generateContent, GEMINI_MODEL } from "../shared/gemini-client";

// SPEC.md §12 / .claude/specs/worker/draft-denial-letter.md — draft-denial-letter.
// Not insurance-type aware (not in §12's insurance-type-aware list) — the
// prompt is a fixed template here rather than pulled from
// backend/shared/insurance-types/<type>.ts. No PDF generation/delivery in
// v1 (§14 future work) — text output only.
interface DraftDenialLetterVariables {
  claimId: string;
  denialReason: string;
  claimantName: string;
}

interface DraftDenialLetterOutput {
  denialLetterText: string;
}

const JOB_TYPE = "draft-denial-letter";
const PROMPT_VERSION = "v1";

const PROMPT_TEMPLATE = `You are drafting a claim denial letter for an insurance company to send to
a claimant. Write in a clear, professional, and respectful tone. Ground the
letter strictly in the reason given below — do not invent additional
reasons, dates, amounts, or claim details not present here.

The letter must:
- Address the claimant by name.
- State plainly that the claim has been denied.
- Explain the denial reason given below in plain language.
- Close with a brief, neutral note that the claimant may contact the
  insurer with questions.

Respond with ONLY the letter text, no preamble, no JSON, no markdown
formatting.

Claimant name: `;

zeebeClient.createWorker<DraftDenialLetterVariables, Record<string, unknown>, DraftDenialLetterOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, denialReason, claimantName } = job.variables;

    const prompt = `${PROMPT_TEMPLATE}${claimantName}\nDenial reason: ${denialReason}`;

    const denialLetterText = (await generateContent(prompt)).trim();

    await pool.query(
      `UPDATE claims SET denial_letter_text = $1, updated_at = now() WHERE id = $2`,
      [denialLetterText, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "ai",
      actorId: JOB_TYPE,
      action: "denial_letter_drafted",
      detail: { denialLetterText, denialReason, model: GEMINI_MODEL, promptVersion: PROMPT_VERSION },
    });

    return job.complete({ denialLetterText });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
