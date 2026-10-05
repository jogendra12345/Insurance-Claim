// Raise-a-claim steps for the portal chat assistant —
// .claude/specs/generic/portal-claims-assistant.md Decision 1. Same fields,
// order and validation rules as ClaimForm (claimant view); each step names
// the widget it's answered with, and AssistantChat renders that widget.

import type { ClaimType } from "@/lib/types";
import { formatDate } from "@/lib/time";

export const CLAIM_TYPES: { value: ClaimType; label: string }[] = [
  { value: "outpatient", label: "Outpatient" },
  { value: "inpatient", label: "Inpatient" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "dental", label: "Dental" },
  { value: "maternity", label: "Maternity" },
  { value: "other", label: "Other" },
];

// Mirrored from ClaimForm / backend/api/src/create-claim.ts.
const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/i;
const CPT_OR_HCPCS_PATTERN = /^(\d{5}|[A-Z]\d{4})$/i;
const NPI_PATTERN = /^[0-9]{10}$/;

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Everything the chat collects except the files (which can't go in sessionStorage — Decision 7). */
export interface ClaimDraft {
  policyNumber: string;
  policyholderName: string;
  coverageAmount: number | null;
  claimType: ClaimType | "";
  claimantName: string;
  incidentDate: string;
  incidentDescription: string;
  claimAmount: string;
  diagnosisCode: string;
  procedureCode: string;
  serviceDateFrom: string;
  serviceDateTo: string;
  totalBilledAmount: string;
  coordinationOfBenefits: boolean | null;
  providerNpi: string;
  /** A provider picked from the list fills these three and skips their questions, as ClaimForm does. */
  providerFromList: boolean;
  providerTaxId: string;
  facilityName: string;
  facilityAddress: string;
}

export const EMPTY_DRAFT: ClaimDraft = {
  policyNumber: "",
  policyholderName: "",
  coverageAmount: null,
  claimType: "",
  claimantName: "",
  incidentDate: "",
  incidentDescription: "",
  claimAmount: "",
  diagnosisCode: "",
  procedureCode: "",
  serviceDateFrom: "",
  serviceDateTo: "",
  totalBilledAmount: "",
  coordinationOfBenefits: null,
  providerNpi: "",
  providerFromList: false,
  providerTaxId: "",
  facilityName: "",
  facilityAddress: "",
};

export type StepKey =
  | "policy"
  | "claimType"
  | "claimantName"
  | "incidentDate"
  | "incidentDescription"
  | "claimAmount"
  | "diagnosisCode"
  | "procedureCode"
  | "serviceDateFrom"
  | "serviceDateTo"
  | "totalBilledAmount"
  | "coordinationOfBenefits"
  | "provider"
  | "providerTaxId"
  | "facilityName"
  | "facilityAddress"
  | "documents"
  | "review";

export type StepWidget =
  | "policy"
  | "claimType"
  | "name"
  | "text"
  | "textarea"
  | "money"
  | "date"
  | "serviceDateTo"
  | "icd"
  | "code"
  | "yesNo"
  | "provider"
  | "documents"
  | "review";

export interface StepDef {
  key: StepKey;
  question: (draft: ClaimDraft) => string;
  widget: StepWidget;
  /** Draft field a text-like widget edits. */
  field?: keyof ClaimDraft;
  placeholder?: string;
  hint?: (draft: ClaimDraft) => string | undefined;
  /** Error message, or null when the draft's answer for this step is acceptable. */
  validate: (draft: ClaimDraft) => string | null;
  /** Human-readable answer, for the user's chat bubble and the review card. */
  display: (draft: ClaimDraft) => string;
  /** Hidden for this draft (e.g. facility questions after picking a listed provider). */
  skip?: (draft: ClaimDraft) => boolean;
  reviewLabel?: string;
}

const required = (value: string, message: string) => (value.trim() ? null : message);

const money = (value: string) =>
  value ? Number(value).toLocaleString(undefined, { style: "currency", currency: "USD" }) : "—";

function validatePositive(value: string, message: string): string | null {
  const n = Number(value);
  return !value || Number.isNaN(n) || n <= 0 ? message : null;
}

function validatePastDate(value: string, label: string): string | null {
  if (!value) return `${label} is required.`;
  return value > todayIso() ? `${label} can't be in the future.` : null;
}

export const STEPS: StepDef[] = [
  {
    key: "policy",
    widget: "policy",
    question: () => "Which policy is this claim for?",
    validate: (d) => required(d.policyNumber, "Choose a policy to continue."),
    display: (d) => d.policyNumber,
    reviewLabel: "Policy",
  },
  {
    key: "claimType",
    widget: "claimType",
    question: () => "What type of claim is this?",
    validate: (d) => (d.claimType ? null : "Choose a claim type."),
    display: (d) => CLAIM_TYPES.find((t) => t.value === d.claimType)?.label ?? "—",
    reviewLabel: "Claim type",
  },
  {
    key: "claimantName",
    widget: "name",
    field: "claimantName",
    question: () => "Who is this claim for? Use the policyholder's name, or type the patient's full name.",
    placeholder: "Full name",
    validate: (d) => required(d.claimantName, "Name is required."),
    display: (d) => d.claimantName,
    reviewLabel: "Name",
  },
  {
    key: "incidentDate",
    widget: "date",
    field: "incidentDate",
    question: () => "When did the incident happen?",
    validate: (d) => validatePastDate(d.incidentDate, "Incident date"),
    display: (d) => (d.incidentDate ? formatDate(d.incidentDate) : "—"),
    reviewLabel: "Incident date",
  },
  {
    key: "incidentDescription",
    widget: "textarea",
    field: "incidentDescription",
    question: () => "Briefly describe what happened — when, where, and what treatment you received.",
    placeholder: "What happened",
    validate: (d) => required(d.incidentDescription, "Please describe what happened."),
    display: (d) => d.incidentDescription,
    reviewLabel: "What happened",
  },
  {
    key: "claimAmount",
    widget: "money",
    field: "claimAmount",
    question: () => "How much are you claiming (USD)?",
    hint: (d) =>
      d.coverageAmount !== null ? `Up to this policy's coverage of ${money(String(d.coverageAmount))}.` : undefined,
    validate: (d) => {
      const error = validatePositive(d.claimAmount, "Enter a claim amount greater than 0.");
      if (error) return error;
      if (d.coverageAmount !== null && Number(d.claimAmount) > d.coverageAmount) {
        return `That's more than this policy's coverage of ${money(String(d.coverageAmount))}.`;
      }
      return null;
    },
    display: (d) => money(d.claimAmount),
    reviewLabel: "Claim amount",
  },
  {
    key: "diagnosisCode",
    widget: "icd",
    field: "diagnosisCode",
    question: () => "What's the diagnosis? Search by condition or code — it's on your bill or discharge summary.",
    validate: (d) =>
      !d.diagnosisCode.trim()
        ? "Diagnosis code is required."
        : ICD10_PATTERN.test(d.diagnosisCode.trim())
          ? null
          : "Enter a valid ICD-10 code (e.g. E11.9).",
    display: (d) => d.diagnosisCode.toUpperCase(),
    reviewLabel: "Diagnosis code",
  },
  {
    key: "procedureCode",
    widget: "code",
    field: "procedureCode",
    question: () => "What's the procedure code? It's on your provider's bill — e.g. 99213 for an office visit.",
    placeholder: "99213",
    validate: (d) =>
      !d.procedureCode.trim()
        ? "Procedure code is required."
        : CPT_OR_HCPCS_PATTERN.test(d.procedureCode.trim())
          ? null
          : "Enter a valid CPT (5 digits) or HCPCS (letter + 4 digits) code.",
    display: (d) => d.procedureCode.toUpperCase(),
    reviewLabel: "Procedure code",
  },
  {
    key: "serviceDateFrom",
    widget: "date",
    field: "serviceDateFrom",
    question: () => "What date was the service provided?",
    validate: (d) => validatePastDate(d.serviceDateFrom, "Service date"),
    display: (d) => (d.serviceDateFrom ? formatDate(d.serviceDateFrom) : "—"),
    reviewLabel: "Date of service",
  },
  {
    key: "serviceDateTo",
    widget: "serviceDateTo",
    field: "serviceDateTo",
    question: () => "Did the service run over more than one day? Pick the last day, or choose Same day.",
    validate: (d) => {
      const error = validatePastDate(d.serviceDateTo, "Last date of service");
      if (error) return error;
      return d.serviceDateTo < d.serviceDateFrom ? "The last date can't be before the first." : null;
    },
    display: (d) => (d.serviceDateTo === d.serviceDateFrom ? "Same day" : d.serviceDateTo ? formatDate(d.serviceDateTo) : "—"),
    reviewLabel: "Service through",
  },
  {
    key: "totalBilledAmount",
    widget: "money",
    field: "totalBilledAmount",
    question: () => "What's the total amount the provider billed (USD)? This can differ from what you're claiming.",
    validate: (d) => validatePositive(d.totalBilledAmount, "Enter a total billed amount greater than 0."),
    display: (d) => money(d.totalBilledAmount),
    reviewLabel: "Total billed",
  },
  {
    key: "coordinationOfBenefits",
    widget: "yesNo",
    question: () => "Do you have other health insurance that might also pay for this claim?",
    validate: (d) => (d.coordinationOfBenefits === null ? "Please answer Yes or No." : null),
    display: (d) => (d.coordinationOfBenefits === null ? "—" : d.coordinationOfBenefits ? "Yes" : "No"),
    reviewLabel: "Other coverage",
  },
  {
    key: "provider",
    widget: "provider",
    question: () => "Which provider treated you? Search by facility name or NPI, or type a new 10-digit NPI.",
    validate: (d) =>
      !d.providerNpi.trim()
        ? "Provider NPI is required."
        : NPI_PATTERN.test(d.providerNpi.trim())
          ? null
          : "NPI must be exactly 10 digits.",
    display: (d) => (d.facilityName ? `${d.facilityName} (NPI ${d.providerNpi})` : `NPI ${d.providerNpi}`),
    reviewLabel: "Provider",
  },
  {
    key: "providerTaxId",
    widget: "text",
    field: "providerTaxId",
    question: () => "That provider isn't on file yet. What's their tax ID (EIN)?",
    placeholder: "12-3456789",
    validate: (d) => required(d.providerTaxId, "Provider tax ID is required."),
    display: (d) => d.providerTaxId,
    skip: (d) => d.providerFromList,
    reviewLabel: "Provider tax ID",
  },
  {
    key: "facilityName",
    widget: "text",
    field: "facilityName",
    question: () => "What's the facility's name?",
    placeholder: "Riverside Medical Center",
    validate: (d) => required(d.facilityName, "Facility name is required."),
    display: (d) => d.facilityName,
    skip: (d) => d.providerFromList,
  },
  {
    key: "facilityAddress",
    widget: "text",
    field: "facilityAddress",
    question: () => "And the facility's address?",
    placeholder: "123 Main St, Springfield",
    validate: (d) => required(d.facilityAddress, "Facility address is required."),
    display: (d) => d.facilityAddress,
    skip: (d) => d.providerFromList,
    reviewLabel: "Facility address",
  },
  {
    key: "documents",
    widget: "documents",
    question: () => "Last step — attach at least one supporting document: a medical bill, discharge summary, or prescription.",
    validate: () => null, // checked against the File list, which lives outside the draft
    display: () => "",
  },
  {
    key: "review",
    widget: "review",
    question: () => "Here's your claim. Check everything, edit anything that's wrong, then confirm and submit.",
    validate: () => null,
    display: () => "",
  },
];

export function stepByKey(key: StepKey): StepDef {
  return STEPS.find((s) => s.key === key)!;
}

/** The next step after `key` that isn't skipped for this draft. */
export function nextStep(key: StepKey, draft: ClaimDraft): StepKey {
  const index = STEPS.findIndex((s) => s.key === key);
  const next = STEPS.slice(index + 1).find((s) => !s.skip?.(draft));
  return next?.key ?? "review";
}

/** The previous step before `key` that isn't skipped for this draft, or null at the first question. */
export function previousStep(key: StepKey, draft: ClaimDraft): StepKey | null {
  const index = STEPS.findIndex((s) => s.key === key);
  const previous = STEPS.slice(0, index).reverse().find((s) => !s.skip?.(draft));
  return previous?.key ?? null;
}

/** Maps a POST /api/claims 400 `field` (a CreateClaimInput key) to the step that asks it. */
export function stepForServerField(field: string | undefined): StepKey | null {
  switch (field) {
    case "policyNumber":
      return "policy";
    case "claimAmount":
      return "claimAmount";
    case "diagnosisCode":
      return "diagnosisCode";
    case "procedureCode":
      return "procedureCode";
    case "providerNpi":
      return "provider";
    case "totalBilledAmount":
      return "totalBilledAmount";
    default:
      return null;
  }
}
