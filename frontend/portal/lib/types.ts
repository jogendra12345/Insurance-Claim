// Mirrors claims columns per SPEC.md §9, using the camelCase variable names
// SPEC.md already uses for these fields in BPMN/worker contracts.

export type ClaimType = "outpatient" | "inpatient" | "pharmacy" | "dental" | "maternity" | "other";

export type ClaimStatus =
  | "submitted"
  | "validating"
  | "triage"
  | "in_review"
  | "approved"
  | "denied"
  | "awaiting_info";

export type AssignedRole = "adjuster" | "investigator" | "legal" | "auto";

export type Decision = "approve" | "deny" | "moreInfo";

export interface Claim {
  id: string;
  carrierId: string;
  insuranceType: string;
  policyNumber: string;
  policyId: string | null;
  claimType: ClaimType;
  claimantName: string;
  claimantEmail: string;
  incidentDate: string;
  incidentDescription: string;
  claimAmount: number;
  status: ClaimStatus;
  caseSummary: string | null;
  riskScore: number | null;
  riskReasoning: string | null;
  fraudIndicatorCount: number;
  assignedRole: AssignedRole | null;
  confirmedRole: AssignedRole | null;
  decision: Decision | null;
  denialReason: string | null;
  processInstanceKey: string | null;
  diagnosisCode: string;
  procedureCode: string;
  serviceDateFrom: string;
  serviceDateTo: string | null;
  totalBilledAmount: number;
  coordinationOfBenefits: boolean;
  attestationSignedAt: string;
  provider: ClaimProvider | null;
  createdAt: string;
  updatedAt: string;
  /** Only present on the GET /api/claims/:id (detail) response. */
  documents?: ClaimDocument[];
  /** Only present on the GET /api/claims/:id (detail) response. */
  fraudIndicators?: ClaimFraudIndicator[];
}

export interface ClaimProvider {
  npi: string;
  taxId: string;
  facilityName: string;
  facilityAddress: string;
}

export interface ClaimDocument {
  id: string;
  claimId: string;
  fileUrl: string;
  documentType: string | null;
  createdAt: string;
}

export interface ClaimFraudIndicator {
  id: string;
  claimId: string;
  type: string;
  description: string;
  confidence: number;
  createdAt: string;
}

export const ACTIVE_STATUSES: ClaimStatus[] = [
  "submitted",
  "validating",
  "triage",
  "in_review",
  "awaiting_info",
];

export type PolicyStatus = "active" | "lapsed" | "cancelled";

export interface Policy {
  id: string;
  policyNumber: string;
  policyholderName: string;
  insuranceType: string;
  status: PolicyStatus;
  effectiveDate: string;
  expiryDate: string;
  premiumAmount: number;
  coverageAmount: number;
  createdAt: string;
}

export interface NewPolicyInput {
  policyNumber: string;
  policyholderName: string;
  status: PolicyStatus;
  effectiveDate: string;
  expiryDate: string;
  premiumAmount: string;
  coverageAmount: string;
}

export interface NewClaimInput {
  policyNumber: string;
  claimType: ClaimType;
  claimantName: string;
  claimantEmail: string;
  incidentDate: string;
  incidentDescription: string;
  claimAmount: number;
  diagnosisCode: string;
  procedureCode: string;
  providerNpi: string;
  providerTaxId: string;
  facilityName: string;
  facilityAddress: string;
  serviceDateFrom: string;
  serviceDateTo: string;
  totalBilledAmount: number;
  coordinationOfBenefits: boolean;
  attested: boolean;
  documents: File[];
}
