// SPEC.md §3 — one config module per insurance type, keyed by claims.insurance_type.
// Only "health" exists in v1. `requiredFields` names claims table columns
// (snake_case, matching the raw DB row validate-claim queries) that must be
// present for a health claim to pass validation. `promptTemplate` is the
// extract-evidence instruction sent to Gemini alongside the claim's documents.
export interface InsuranceTypeConfig {
  requiredFields: string[];
  documentTypes: string[];
  promptTemplate: string;
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
};

const REGISTRY: Record<string, InsuranceTypeConfig> = { health };

export function getInsuranceTypeConfig(insuranceType: string): InsuranceTypeConfig {
  const config = REGISTRY[insuranceType];
  if (!config) {
    throw new Error(`No insurance-type config registered for "${insuranceType}"`);
  }
  return config;
}
