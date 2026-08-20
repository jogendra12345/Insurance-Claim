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
  fraudIndicatorCount: number;
  assignedRole: AssignedRole | null;
  confirmedRole: AssignedRole | null;
  decision: Decision | null;
  denialReason: string | null;
  processInstanceKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ACTIVE_STATUSES: ClaimStatus[] = [
  "submitted",
  "validating",
  "triage",
  "in_review",
  "awaiting_info",
];

export interface Policy {
  id: string;
  policyNumber: string;
  policyholderName: string;
  status: "active" | "lapsed" | "cancelled";
}

export interface NewClaimInput {
  policyNumber: string;
  claimType: ClaimType;
  claimantName: string;
  claimantEmail: string;
  incidentDate: string;
  incidentDescription: string;
  claimAmount: number;
  documents: File[];
}
