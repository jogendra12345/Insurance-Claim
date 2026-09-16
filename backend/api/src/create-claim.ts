import { pool } from "./db";
import { BUCKET, minioClient, publicUrl } from "./storage";
import { CLAIM_CASE_PROCESS_ID, camundaRestClient, zeebeClient } from "./zeebe";

// Extracted from routes/claims.ts's POST / handler per the locked
// .claude/specs/generic/claims-assistant.md ("Claim creation — shared
// internal logic, not a second validation path") — both the portal route
// and the WhatsApp webhook (routes/whatsapp.ts) call this, so there is
// exactly one validation/insert/Zeebe-kickoff path, not two that can drift.
// Kept in backend/api/src rather than backend/shared/ (the spec's original
// sketch) because every dependency here — pool, minioClient, zeebeClient,
// camundaRestClient — is itself an api-local wrapper, and both callers live
// inside this same package; moving it to backend/shared/ would mean
// duplicating those wrappers there too for no real benefit.

// FNOL extended-field formats — .claude/specs/db/fnol_extended_fields.md.
export const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/i;
export const CPT_OR_HCPCS_PATTERN = /^(\d{5}|[A-Z]\d{4})$/i;
export const NPI_PATTERN = /^[0-9]{10}$/;

export class ClaimValidationError extends Error {}

export interface CreateClaimInput {
  policyNumber: string;
  claimType: string;
  claimantName: string;
  claimantEmail: string;
  claimantPhone?: string | null;
  channel: "portal" | "whatsapp";
  incidentDate: string;
  incidentDescription: string;
  claimAmount: string | number;
  diagnosisCode: string;
  procedureCode: string;
  providerNpi: string;
  providerTaxId: string;
  facilityName: string;
  facilityAddress: string;
  serviceDateFrom: string;
  serviceDateTo?: string | null;
  totalBilledAmount: string | number;
  coordinationOfBenefits: boolean;
  attested: boolean;
}

// Portal uploads (multer) arrive as raw buffers to upload to MinIO here;
// WhatsApp documents (routes/whatsapp.ts) are uploaded to MinIO as each one
// arrives in chat, well before the claim exists, so they show up here
// already-uploaded — this function just records them, no second upload.
export type CreateClaimDocument =
  | { originalname: string; mimetype: string; buffer: Buffer; size: number }
  | { originalname: string; mimetype: string; url: string; size: number };

// Tasklist's CSP (img-src: data: 'self' blob:) blocks <img> from loading a
// plain MinIO URL, so an inline preview needs a data: URI embedded directly
// in the process variable instead — capped well under the upload size limit.
const INLINE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export function validateCreateClaimInput(input: CreateClaimInput, files: CreateClaimDocument[]): void {
  if (
    !input.policyNumber ||
    !input.claimType ||
    !input.claimantName ||
    !input.claimantEmail ||
    !input.incidentDate ||
    !input.incidentDescription ||
    !input.claimAmount ||
    !input.diagnosisCode ||
    !input.procedureCode ||
    !input.providerNpi ||
    !input.providerTaxId ||
    !input.facilityName ||
    !input.facilityAddress ||
    !input.serviceDateFrom ||
    !input.totalBilledAmount ||
    input.coordinationOfBenefits === undefined
  ) {
    throw new ClaimValidationError("Missing required claim fields.");
  }
  if (!input.attested) {
    throw new ClaimValidationError("You must attest that the information provided is accurate to submit a claim.");
  }
  if (!ICD10_PATTERN.test(input.diagnosisCode)) {
    throw new ClaimValidationError("Diagnosis code must be a valid ICD-10 code (e.g. E11.9).");
  }
  if (!CPT_OR_HCPCS_PATTERN.test(input.procedureCode)) {
    throw new ClaimValidationError("Procedure code must be a valid CPT (5 digits) or HCPCS (letter + 4 digits) code.");
  }
  if (!NPI_PATTERN.test(input.providerNpi)) {
    throw new ClaimValidationError("Provider NPI must be exactly 10 digits.");
  }
  if (Number.isNaN(Number(input.totalBilledAmount)) || Number(input.totalBilledAmount) <= 0) {
    throw new ClaimValidationError("Total billed amount must be greater than 0.");
  }
  if (files.length === 0) {
    throw new ClaimValidationError("At least one supporting document is required.");
  }
}

/** Inserts the claim/provider/documents, starts the Zeebe process, and returns the raw claim row (not serialized — callers format for their own channel). */
export async function createClaim(input: CreateClaimInput, files: CreateClaimDocument[]) {
  validateCreateClaimInput(input, files);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const policyResult = await client.query(
      `SELECT id, carrier_id, insurance_type, coverage_amount, policyholder_name FROM policies WHERE policy_number = $1`,
      [input.policyNumber]
    );
    if (policyResult.rowCount === 0) {
      throw new ClaimValidationError(`No policy found for ${input.policyNumber}.`);
    }
    const policy = policyResult.rows[0];

    if (Number(input.claimAmount) > Number(policy.coverage_amount)) {
      throw new ClaimValidationError(
        `Requested claim amount must be less than or equal to the policy's coverage amount (${Number(policy.coverage_amount).toLocaleString()}).`
      );
    }

    // Find-or-create the provider by NPI. On a match, reuse the existing row
    // as-is — a newly submitted facility/tax-id for an NPI already on file
    // is discarded, not written (locked db spec).
    const existingProvider = await client.query(`SELECT * FROM providers WHERE npi = $1`, [input.providerNpi]);
    const providerRow =
      existingProvider.rowCount && existingProvider.rowCount > 0
        ? existingProvider.rows[0]
        : (
            await client.query(
              `INSERT INTO providers (npi, tax_id, facility_name, facility_address) VALUES ($1, $2, $3, $4) RETURNING *`,
              [input.providerNpi, input.providerTaxId, input.facilityName, input.facilityAddress]
            )
          ).rows[0];
    const providerId = providerRow.id;

    const claimResult = await client.query(
      `INSERT INTO claims (
         carrier_id, insurance_type, policy_number, policy_id, claim_type,
         claimant_name, claimant_email, claimant_phone, channel, incident_date, incident_description,
         claim_amount, status, provider_id, diagnosis_code, procedure_code,
         service_date_from, service_date_to, total_billed_amount,
         coordination_of_benefits, attestation_signed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'submitted', $13, $14, $15, $16, $17, $18, $19, now())
       RETURNING *`,
      [
        policy.carrier_id,
        policy.insurance_type,
        input.policyNumber,
        policy.id,
        input.claimType,
        input.claimantName,
        input.claimantEmail,
        input.claimantPhone || null,
        input.channel,
        input.incidentDate,
        input.incidentDescription,
        input.claimAmount,
        providerId,
        input.diagnosisCode,
        input.procedureCode,
        input.serviceDateFrom,
        input.serviceDateTo || input.serviceDateFrom,
        input.totalBilledAmount,
        input.coordinationOfBenefits,
      ]
    );
    const claim = claimResult.rows[0];
    claim.provider_npi = providerRow.npi;
    claim.provider_tax_id = providerRow.tax_id;
    claim.provider_facility_name = providerRow.facility_name;
    claim.provider_facility_address = providerRow.facility_address;

    const documentVariables: Array<{ name: string; url: string; contentType: string; dataUri: string | null }> = [];
    for (const file of files) {
      let fileUrl: string;
      let dataUri: string | null = null;
      if ("buffer" in file) {
        const objectKey = `${Date.now()}-${file.originalname}`;
        await minioClient.putObject(BUCKET, objectKey, file.buffer, file.size, {
          "Content-Type": file.mimetype,
        });
        fileUrl = publicUrl(objectKey);
        const canInlinePreview = file.mimetype.startsWith("image/") && file.size <= INLINE_PREVIEW_MAX_BYTES;
        dataUri = canInlinePreview ? `data:${file.mimetype};base64,${file.buffer.toString("base64")}` : null;
      } else {
        fileUrl = file.url;
      }
      await client.query(`INSERT INTO claim_documents (claim_id, file_url) VALUES ($1, $2)`, [claim.id, fileUrl]);
      documentVariables.push({ name: file.originalname, url: fileUrl, contentType: file.mimetype, dataUri });
    }

    // SPEC.md §13 — every write path leaves an audit_log row.
    await client.query(
      `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
       VALUES ($1, 'system', 'backend/api', 'submitted', $2)`,
      [claim.id, JSON.stringify({ source: input.channel === "whatsapp" ? "whatsapp-assistant" : "claimant-portal", documentCount: files.length })]
    );

    await client.query("COMMIT");

    // Process kickoff happens after commit, outside the DB transaction: the
    // claim/document rows are the durable record of submission regardless of
    // whether Zeebe is reachable — see "Failure handling" in
    // .claude/specs/generic/process-orchestration-kickoff.md.
    try {
      const { processInstanceKey } = await zeebeClient.createProcessInstance({
        bpmnProcessId: CLAIM_CASE_PROCESS_ID,
        variables: {
          claimId: claim.id,
          carrierId: claim.carrier_id,
          insuranceType: claim.insurance_type,
          policyNumber: claim.policy_number,
          claimType: claim.claim_type,
          claimAmount: Number(claim.claim_amount),
          policyholderName: policy.policyholder_name,
          coverageAmount: Number(policy.coverage_amount),
          claimantName: claim.claimant_name,
          claimantEmail: claim.claimant_email,
          incidentDate: claim.incident_date.toISOString(),
          incidentDescription: claim.incident_description,
          diagnosisCode: claim.diagnosis_code,
          procedureCode: claim.procedure_code,
          serviceDateFrom: claim.service_date_from.toISOString(),
          serviceDateTo: claim.service_date_to ? claim.service_date_to.toISOString() : null,
          totalBilledAmount: Number(claim.total_billed_amount),
          coordinationOfBenefits: claim.coordination_of_benefits,
          providerFacilityName: providerRow.facility_name,
          providerNpi: providerRow.npi,
          documents: documentVariables,
        },
      });

      await pool.query(`UPDATE claims SET process_instance_key = $1 WHERE id = $2`, [processInstanceKey, claim.id]);
      claim.process_instance_key = processInstanceKey;

      await pool.query(
        `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
         VALUES ($1, 'system', 'backend/api', 'process-started', $2)`,
        [claim.id, JSON.stringify({ processInstanceKey })]
      );

      // Idempotency guard: createProcessInstance is not idempotent, and the
      // Zeebe gRPC client auto-retries it on transient broker errors — see
      // routes/claims.ts's original comment for the full rationale.
      const claimIdVariables = await camundaRestClient.searchVariables({
        filter: { name: "claimId", value: JSON.stringify(claim.id) },
      });
      const duplicateProcessInstanceKeys = [
        ...new Set(
          claimIdVariables.items
            .map((variable: { processInstanceKey: string }) => variable.processInstanceKey)
            .filter((key: string) => key !== processInstanceKey)
        ),
      ];
      for (const duplicateKey of duplicateProcessInstanceKeys) {
        try {
          await camundaRestClient.cancelProcessInstance({ processInstanceKey: duplicateKey });
          await pool.query(
            `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
             VALUES ($1, 'system', 'backend/api', 'duplicate-process-cancelled', $2)`,
            [claim.id, JSON.stringify({ cancelledProcessInstanceKey: duplicateKey, keptProcessInstanceKey: processInstanceKey })]
          );
        } catch (cancelErr) {
          console.error(`Failed to cancel duplicate process instance ${duplicateKey} for claim ${claim.id}:`, cancelErr);
        }
      }
    } catch (zeebeErr) {
      console.error(`Starting the process instance for claim ${claim.id} failed:`, zeebeErr);
    }

    return claim;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
