// SPEC.md §3 — one config module per insurance type, keyed by claims.insurance_type.
// Only "health" exists in v1. `requiredFields` names claims table columns
// (snake_case, matching the raw DB row validate-claim queries) that must be
// present for a health claim to pass validation. `promptTemplate` is the
// extract-evidence instruction sent to Gemini alongside the claim's documents.
export interface InsuranceTypeConfig {
  requiredFields: string[];
  documentTypes: string[];
  promptTemplate: string;
  fraudPromptTemplate: string;
}

export const health: InsuranceTypeConfig = {
  requiredFields: [
    "claimant_name",
    "claimant_email",
    "incident_date",
    "incident_description",
    "claim_amount",
    "diagnosis_code",
    "procedure_code",
    "service_date_from",
    "provider_id",
  ],
  documentTypes: ["medical_bill", "discharge_summary", "prescription", "other"],
  promptTemplate: `You are reviewing documents attached to a health insurance claim.
For each document provided, extract the structured data relevant to adjudicating
the claim (e.g. billed amounts, line items, diagnosis/procedure codes, dates of
service, provider details, prescription details) as you find it — do not guess
at fields that aren't present in that specific document.

Then write a short, reviewer-facing case summary (2-4 sentences) covering what
the documents show and anything a human adjuster should note before deciding
on the claim.

Respond with ONLY a JSON object of this exact shape, no other text:
{
  "caseSummary": "string",
  "documents": [
    { "documentIndex": 0, "extractedData": { ...any fields you found... } }
  ]
}
"documentIndex" must match the 0-based order the documents were provided in.`,
  fraudPromptTemplate: `You are reviewing a health insurance claim for potential fraud indicators.
You will be given: the name of the claimant who filed this claim, a
reviewer-facing case summary of the claim's evidence, and the structured
data extracted from each attached document (billed amounts, codes, dates,
provider details, patient/insured names, etc.) — ground your indicators in
the structured data where possible rather than only the narrative summary,
since the summary can omit or compress details the raw extraction still has.

Specifically check for these categories, and flag whichever apply:
- Claimant identity mismatch: the patient/insured name on the documents
  does not match the claimant's name given below. This is a strong
  indicator (confidence 0.85-1.0) unless the names are a plausible variant
  of the same person (e.g. a nickname, maiden name, or minor spelling
  difference).
- Cross-document mismatch: attached documents describe different
  patients, providers, or encounters from each other.
- Coding/billing mismatch: diagnosis, procedure, or billed-amount fields
  in the structured data contradict the narrative description.
- Missing or placeholder documentation: documents are illegible, blank,
  or contain no genuine clinical/financial data.
- Any other concrete inconsistency directly grounded in the evidence
  given.

Do not invent details that aren't present, and do not flag a claim just
for being unremarkable.

Confidence scale — use this to set "confidence", don't just guess a number:
- 0.9-1.0: the evidence directly and unambiguously shows the issue (e.g. a
  named patient who is clearly a different person than the claimant).
- 0.6-0.8: a real inconsistency that could plausibly have an innocent
  explanation.
- 0.3-0.5: a weak or circumstantial signal not worth escalating on its own.

Respond with ONLY a JSON object of this exact shape, no other text:
{
  "indicators": [
    { "type": "string (short category, e.g. \\"claimant_identity_mismatch\\")", "description": "string", "confidence": 0.0 }
  ]
}
Return an empty "indicators" array if nothing concrete stands out.

Claimant on this claim: `,
};

const REGISTRY: Record<string, InsuranceTypeConfig> = { health };

export function getInsuranceTypeConfig(insuranceType: string): InsuranceTypeConfig {
  const config = REGISTRY[insuranceType];
  if (!config) {
    throw new Error(`No insurance-type config registered for "${insuranceType}"`);
  }
  return config;
}
