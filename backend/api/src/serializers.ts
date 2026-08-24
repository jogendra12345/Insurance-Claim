// Maps a `claims` row (snake_case, per SPEC.md §9) to the camelCase shape
// frontend/portal/lib/types.ts's Claim interface expects.
export function serializeClaim(row: any) {
  return {
    id: row.id,
    carrierId: row.carrier_id,
    insuranceType: row.insurance_type,
    policyNumber: row.policy_number,
    policyId: row.policy_id,
    claimType: row.claim_type,
    claimantName: row.claimant_name,
    claimantEmail: row.claimant_email,
    incidentDate: row.incident_date,
    incidentDescription: row.incident_description,
    claimAmount: row.claim_amount === null ? null : Number(row.claim_amount),
    status: row.status,
    caseSummary: row.case_summary,
    riskScore: row.risk_score === null ? null : Number(row.risk_score),
    fraudIndicatorCount: row.fraud_indicator_count,
    assignedRole: row.assigned_role,
    confirmedRole: row.confirmed_role,
    decision: row.decision,
    denialReason: row.denial_reason,
    processInstanceKey: row.process_instance_key,
    diagnosisCode: row.diagnosis_code,
    procedureCode: row.procedure_code,
    serviceDateFrom: row.service_date_from,
    serviceDateTo: row.service_date_to,
    totalBilledAmount: row.total_billed_amount === null ? null : Number(row.total_billed_amount),
    coordinationOfBenefits: row.coordination_of_benefits,
    attestationSignedAt: row.attestation_signed_at,
    provider: row.provider_npi
      ? {
          npi: row.provider_npi,
          taxId: row.provider_tax_id,
          facilityName: row.provider_facility_name,
          facilityAddress: row.provider_facility_address,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Maps a `claim_documents` row (SPEC.md §9) to camelCase.
export function serializeClaimDocument(row: any) {
  return {
    id: row.id,
    claimId: row.claim_id,
    fileUrl: row.file_url,
    documentType: row.document_type,
    createdAt: row.created_at,
  };
}
