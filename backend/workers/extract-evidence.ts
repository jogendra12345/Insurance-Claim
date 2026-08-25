import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { getInsuranceTypeConfig } from "../shared/insurance-types/health";
import { generateContent, fetchAsInlinePart, parseJsonResponse } from "../shared/gemini-client";

// SPEC.md §12 — extract-evidence.
interface ExtractEvidenceVariables {
  claimId: string;
  insuranceType: string;
}

interface ExtractEvidenceOutput {
  caseSummary: string;
}

interface ExtractionResult {
  caseSummary: string;
  documents: Array<{ documentIndex: number; extractedData: unknown }>;
}

const JOB_TYPE = "extract-evidence";

zeebeClient.createWorker<ExtractEvidenceVariables, Record<string, unknown>, ExtractEvidenceOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, insuranceType } = job.variables;
    const config = getInsuranceTypeConfig(insuranceType);

    const { rows: documents } = await pool.query<{ id: string; file_url: string }>(
      `SELECT id, file_url FROM claim_documents WHERE claim_id = $1 ORDER BY created_at`,
      [claimId]
    );

    if (documents.length === 0) {
      const caseSummary = "No documents were attached to this claim.";
      await pool.query(`UPDATE claims SET case_summary = $1, updated_at = now() WHERE id = $2`, [
        caseSummary,
        claimId,
      ]);
      await writeAuditLog({
        claimId,
        actorType: "ai",
        actorId: JOB_TYPE,
        action: "extracted_evidence",
        detail: { caseSummary, documentCount: 0 },
      });
      return job.complete({ caseSummary });
    }

    const parts = await Promise.all(documents.map((doc) => fetchAsInlinePart(doc.file_url)));
    const responseText = await generateContent(config.promptTemplate, parts);
    const result = parseJsonResponse<ExtractionResult>(responseText);

    await pool.query(`UPDATE claims SET case_summary = $1, updated_at = now() WHERE id = $2`, [
      result.caseSummary,
      claimId,
    ]);

    for (const entry of result.documents) {
      const doc = documents[entry.documentIndex];
      if (!doc) continue;
      await pool.query(`UPDATE claim_documents SET extracted_data = $1 WHERE id = $2`, [
        JSON.stringify(entry.extractedData),
        doc.id,
      ]);
    }

    await writeAuditLog({
      claimId,
      actorType: "ai",
      actorId: JOB_TYPE,
      action: "extracted_evidence",
      detail: { caseSummary: result.caseSummary, documentCount: documents.length },
    });

    return job.complete({ caseSummary: result.caseSummary });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
