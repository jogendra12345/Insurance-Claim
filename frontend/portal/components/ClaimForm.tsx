"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, submitClaim } from "@/lib/api";
import type { ClaimType, NewClaimInput } from "@/lib/types";
import { PolicySelect } from "./PolicySelect";

const CLAIM_TYPES: { value: ClaimType; label: string }[] = [
  { value: "outpatient", label: "Outpatient" },
  { value: "inpatient", label: "Inpatient" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "dental", label: "Dental" },
  { value: "maternity", label: "Maternity" },
  { value: "other", label: "Other" },
];

const ACCEPTED_DOCUMENT_HINT =
  "Accepted: medical bills, discharge summaries, prescriptions (PDF, JPG, PNG — up to 10MB each)";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

// FNOL extended-field formats — .claude/specs/db/fnol_extended_fields.md,
// .claude/specs/generic/fnol_form_ui_update.md. Mirrored server-side in
// backend/api/src/routes/claims.ts.
const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/i;
const CPT_OR_HCPCS_PATTERN = /^(\d{5}|[A-Z]\d{4})$/i;
const MULTI_DAY_CLAIM_TYPES: ClaimType[] = ["inpatient", "maternity"];

function fileKey(f: File) {
  return `${f.name}-${f.size}-${f.lastModified}`;
}

function fileIcon(f: File) {
  return f.name.toLowerCase().endsWith(".pdf") ? "📄" : "🖼️";
}

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FieldErrors = Partial<Record<keyof Omit<NewClaimInput, "documents">, string>>;

const todayIso = () => new Date().toISOString().slice(0, 10);

// Single-scroll sectioned form — replaces the earlier step-gated wizard.
// Same field groupings as before, but all visible at once; a sticky nav
// jumps between sections instead of gating progress behind Continue/Back.
const SECTIONS = [
  { id: "policy", label: "Policy" },
  { id: "incident", label: "About the incident" },
  { id: "diagnosis", label: "Diagnosis, Procedure & Provider" },
  { id: "documents", label: "Documents" },
  { id: "review", label: "Review & submit" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const SECTION_FIELD_KEYS: Partial<Record<SectionId, (keyof FieldErrors)[]>> = {
  policy: ["policyNumber"],
  incident: ["claimantName", "claimantEmail", "incidentDate", "incidentDescription", "claimAmount"],
  diagnosis: [
    "diagnosisCode",
    "procedureCode",
    "serviceDateFrom",
    "serviceDateTo",
    "totalBilledAmount",
    "coordinationOfBenefits",
    "providerNpi",
    "providerTaxId",
    "facilityName",
    "facilityAddress",
  ],
};

export function ClaimForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sectionRefs = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({});

  const [policyNumber, setPolicyNumber] = useState(searchParams.get("policyNumber") ?? "");
  const [claimType, setClaimType] = useState<ClaimType>("outpatient");
  const [claimantName, setClaimantName] = useState("");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);
  const [coverageAmount, setCoverageAmount] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [procedureCode, setProcedureCode] = useState("");
  const [providerNpi, setProviderNpi] = useState("");
  const [providerTaxId, setProviderTaxId] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [facilityAddress, setFacilityAddress] = useState("");
  const [serviceDateFrom, setServiceDateFrom] = useState("");
  const [serviceDateTo, setServiceDateTo] = useState("");
  const [totalBilledAmount, setTotalBilledAmount] = useState("");
  const [coordinationOfBenefits, setCoordinationOfBenefits] = useState<boolean | null>(null);
  const [attested, setAttested] = useState(false);

  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  const showServiceDateTo = MULTI_DAY_CLAIM_TYPES.includes(claimType);

  function markTouched(name: string) {
    setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }

  function syncFileInput(next: File[]) {
    if (fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      next.forEach((file) => dataTransfer.items.add(file));
      fileInputRef.current.files = dataTransfer.files;
    }
  }

  function removeDocument(index: number) {
    const next = documents.filter((_, i) => i !== index);
    setDocuments(next);
    syncFileInput(next);
  }

  /** Adds newly picked/dropped files to the existing selection (dedupes, size-checks, and filters to accepted types). */
  function addFiles(incoming: File[]) {
    const existingKeys = new Set(documents.map(fileKey));
    const accepted: File[] = [];
    let rejection: string | null = null;

    for (const f of incoming) {
      if (existingKeys.has(fileKey(f))) continue;
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        rejection = `"${f.name}" isn't a supported file type — only PDF, JPG, and PNG are accepted.`;
        continue;
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        rejection = `"${f.name}" is over the 10MB limit — choose a smaller file.`;
        continue;
      }
      existingKeys.add(fileKey(f));
      accepted.push(f);
    }

    const next = [...documents, ...accepted];
    setDocuments(next);
    syncFileInput(next);
    setDocumentError(rejection);
  }

  /** Every field's validation in one pass — used for both live inline errors and the final submit-time check. */
  function validateAll(): FieldErrors {
    const errors: FieldErrors = {};

    if (!policyNumber.trim()) errors.policyNumber = "Choose a policy to continue.";

    if (!claimantName.trim()) errors.claimantName = "Name is required.";
    if (!claimantEmail.trim()) errors.claimantEmail = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claimantEmail)) errors.claimantEmail = "Enter a valid email.";
    if (!incidentDate) errors.incidentDate = "Incident date is required.";
    else if (incidentDate > todayIso()) errors.incidentDate = "Incident date can't be in the future.";
    if (!incidentDescription.trim()) errors.incidentDescription = "Please describe what happened.";
    const amount = Number(claimAmount);
    if (!claimAmount || Number.isNaN(amount) || amount <= 0) {
      errors.claimAmount = "Enter a requested claim amount greater than 0.";
    } else if (coverageAmount !== null && amount > coverageAmount) {
      errors.claimAmount = `Requested claim amount must be less than or equal to the policy's coverage amount (${coverageAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}).`;
    }

    if (!diagnosisCode.trim()) errors.diagnosisCode = "Diagnosis code is required.";
    else if (!ICD10_PATTERN.test(diagnosisCode.trim())) errors.diagnosisCode = "Enter a valid ICD-10 code (e.g. E11.9).";

    if (!procedureCode.trim()) errors.procedureCode = "Procedure code is required.";
    else if (!CPT_OR_HCPCS_PATTERN.test(procedureCode.trim()))
      errors.procedureCode = "Enter a valid CPT (5 digits) or HCPCS (letter + 4 digits) code.";

    if (!serviceDateFrom) errors.serviceDateFrom = "Service date is required.";
    else if (serviceDateFrom > todayIso()) errors.serviceDateFrom = "Service date can't be in the future.";

    if (showServiceDateTo) {
      if (!serviceDateTo) errors.serviceDateTo = "End date of service is required for this claim type.";
      else if (serviceDateFrom && serviceDateTo < serviceDateFrom) errors.serviceDateTo = "End date can't be before the start date.";
    }

    const billed = Number(totalBilledAmount);
    if (!totalBilledAmount || Number.isNaN(billed) || billed <= 0) {
      errors.totalBilledAmount = "Enter a total billed amount greater than 0.";
    }

    if (coordinationOfBenefits === null) {
      errors.coordinationOfBenefits = "Please answer whether you have other coverage.";
    }

    if (!providerNpi.trim()) errors.providerNpi = "Provider NPI is required.";
    else if (!/^[0-9]{10}$/.test(providerNpi.trim())) errors.providerNpi = "NPI must be exactly 10 digits.";

    if (!providerTaxId.trim()) errors.providerTaxId = "Provider tax ID is required.";
    if (!facilityName.trim()) errors.facilityName = "Facility name is required.";
    if (!facilityAddress.trim()) errors.facilityAddress = "Facility address is required.";

    return errors;
  }

  const errors = validateAll();
  const docError = documents.length === 0 ? "Attach at least one supporting document to continue." : null;

  /** Only show a field's error once the claimant has left that field (or after a submit attempt). */
  function errorFor(name: keyof FieldErrors): string | undefined {
    return touched.has(name) || attemptedSubmit ? errors[name] : undefined;
  }

  function sectionStatus(id: SectionId): "complete" | "error" | "incomplete" {
    if (id === "documents") {
      if (documents.length > 0) return "complete";
      return attemptedSubmit ? "error" : "incomplete";
    }
    if (id === "review") {
      if (attested) return "complete";
      return attemptedSubmit ? "error" : "incomplete";
    }
    const keys = SECTION_FIELD_KEYS[id] ?? [];
    const hasError = keys.some((k) => errors[k]);
    if (!hasError) return "complete";
    return attemptedSubmit || keys.some((k) => touched.has(k)) ? "error" : "incomplete";
  }

  function scrollToSection(id: SectionId) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hasFieldErrors = Object.keys(errors).length > 0;

    if (hasFieldErrors || docError || !attested) {
      setAttemptedSubmit(true);
      setTouched((prev) => {
        const next = new Set(prev);
        Object.keys(errors).forEach((k) => next.add(k));
        return next;
      });
      const firstBadSection = SECTIONS.find((s) => sectionStatus(s.id) === "error") ?? SECTIONS.find((s) => sectionStatus(s.id) !== "complete");
      if (firstBadSection) scrollToSection(firstBadSection.id);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const claim = await submitClaim({
        policyNumber: policyNumber.trim(),
        claimType,
        claimantName: claimantName.trim(),
        claimantEmail: claimantEmail.trim(),
        incidentDate,
        incidentDescription: incidentDescription.trim(),
        claimAmount: Number(claimAmount),
        diagnosisCode: diagnosisCode.trim().toUpperCase(),
        procedureCode: procedureCode.trim().toUpperCase(),
        providerNpi: providerNpi.trim(),
        providerTaxId: providerTaxId.trim(),
        facilityName: facilityName.trim(),
        facilityAddress: facilityAddress.trim(),
        serviceDateFrom,
        serviceDateTo: showServiceDateTo ? serviceDateTo : serviceDateFrom,
        totalBilledAmount: Number(totalBilledAmount),
        coordinationOfBenefits: coordinationOfBenefits === true,
        attested,
        documents,
      });
      setConfirmedId(claim.id);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Submitting the claim failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedId) {
    return (
      <div
        className="animate-scale-in"
        style={{
          padding: "1.75rem",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          background: "var(--status-good-bg)",
          color: "var(--status-good-fg)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <span aria-hidden="true" className="animate-pop" style={{ fontSize: "1.8rem", lineHeight: 1 }}>
          ✓
        </span>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontFamily: "var(--font-display)" }}>Claim submitted</h2>
        <p style={{ margin: 0, color: "var(--text)" }}>
          Reference: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{confirmedId}</strong>
        </p>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          We&apos;ll review this and update its status — check back on your claims list any time.
        </p>
        <button
          onClick={() => router.push("/")}
          className="transition btn-press"
          style={{
            alignSelf: "flex-start",
            padding: "0.55rem 1.1rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--primary)",
            color: "var(--primary-contrast)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          View your claims
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <SectionNav onJump={scrollToSection} status={sectionStatus} />

      <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <SectionCard
          id="policy"
          index={1}
          title="Policy"
          status={sectionStatus("policy")}
          innerRef={(el) => (sectionRefs.current.policy = el)}
        >
          <Field label="Policy number" error={errorFor("policyNumber")}>
            <PolicySelect
              value={policyNumber}
              onChange={(v) => {
                setPolicyNumber(v);
                markTouched("policyNumber");
              }}
              onPolicySelect={(policy) => {
                setClaimantName(policy?.policyholderName ?? "");
                setCoverageAmount(policy?.coverageAmount ?? null);
              }}
              style={inputStyle}
            />
          </Field>

          <Field label="Claim type">
            <select value={claimType} onChange={(e) => setClaimType(e.target.value as ClaimType)} style={inputStyle}>
              {CLAIM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </SectionCard>

        <SectionCard
          id="incident"
          index={2}
          title="About the incident"
          status={sectionStatus("incident")}
          innerRef={(el) => (sectionRefs.current.incident = el)}
        >
          <Field label="Your name" error={errorFor("claimantName")}>
            <input
              value={claimantName}
              onChange={(e) => setClaimantName(e.target.value)}
              onBlur={() => markTouched("claimantName")}
              placeholder="Jane Doe"
              style={inputStyle}
            />
          </Field>

          <Field label="Email" error={errorFor("claimantEmail")}>
            <input
              type="email"
              value={claimantEmail}
              onChange={(e) => setClaimantEmail(e.target.value)}
              onBlur={() => markTouched("claimantEmail")}
              placeholder="jane.doe@example.com"
              style={inputStyle}
            />
          </Field>

          <Field label="Incident date" error={errorFor("incidentDate")}>
            <input
              type="date"
              value={incidentDate}
              max={todayIso()}
              onChange={(e) => setIncidentDate(e.target.value)}
              onBlur={() => markTouched("incidentDate")}
              style={inputStyle}
            />
          </Field>

          <Field label="What happened" error={errorFor("incidentDescription")}>
            <textarea
              value={incidentDescription}
              onChange={(e) => setIncidentDescription(e.target.value)}
              onBlur={() => markTouched("incidentDescription")}
              rows={4}
              placeholder="Briefly describe what happened, when, and where."
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>

          <Field
            label="Requested claim amount (USD)"
            error={errorFor("claimAmount")}
            hint={
              coverageAmount !== null
                ? `Must be less than or equal to this policy's coverage amount: ${coverageAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}`
                : undefined
            }
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={claimAmount}
              onChange={(e) => setClaimAmount(e.target.value)}
              onBlur={() => markTouched("claimAmount")}
              placeholder="0.00"
              style={inputStyle}
            />
          </Field>
        </SectionCard>

        <SectionCard
          id="diagnosis"
          index={3}
          title="Diagnosis, Procedure & Provider"
          status={sectionStatus("diagnosis")}
          innerRef={(el) => (sectionRefs.current.diagnosis = el)}
        >
          <Field label="Diagnosis code (ICD-10)" error={errorFor("diagnosisCode")}>
            <input
              value={diagnosisCode}
              onChange={(e) => setDiagnosisCode(e.target.value)}
              onBlur={() => {
                setDiagnosisCode((v) => v.trim().toUpperCase());
                markTouched("diagnosisCode");
              }}
              placeholder="E11.9"
              style={inputStyle}
            />
          </Field>

          <Field label="Procedure code (CPT/HCPCS)" error={errorFor("procedureCode")}>
            <input
              value={procedureCode}
              onChange={(e) => setProcedureCode(e.target.value)}
              onBlur={() => {
                setProcedureCode((v) => v.trim().toUpperCase());
                markTouched("procedureCode");
              }}
              placeholder="99213"
              style={inputStyle}
            />
          </Field>

          <Field label="Date of service" error={errorFor("serviceDateFrom")}>
            <input
              type="date"
              value={serviceDateFrom}
              max={todayIso()}
              onChange={(e) => setServiceDateFrom(e.target.value)}
              onBlur={() => markTouched("serviceDateFrom")}
              style={inputStyle}
            />
          </Field>

          {showServiceDateTo && (
            <Field label="Date of service (through)" error={errorFor("serviceDateTo")}>
              <input
                type="date"
                value={serviceDateTo}
                min={serviceDateFrom || undefined}
                max={todayIso()}
                onChange={(e) => setServiceDateTo(e.target.value)}
                onBlur={() => markTouched("serviceDateTo")}
                style={inputStyle}
              />
            </Field>
          )}

          <Field
            label="Total billed amount (USD)"
            error={errorFor("totalBilledAmount")}
            hint="The full amount the provider billed for this visit — separate from what you're requesting above."
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={totalBilledAmount}
              onChange={(e) => setTotalBilledAmount(e.target.value)}
              onBlur={() => markTouched("totalBilledAmount")}
              placeholder="0.00"
              style={inputStyle}
            />
          </Field>

          <Field
            label="Do you have other health insurance coverage that might also pay for this claim?"
            error={errorFor("coordinationOfBenefits")}
          >
            <div style={{ display: "flex", gap: "0.6rem" }}>
              {(["Yes", "No"] as const).map((label) => {
                const value = label === "Yes";
                const active = coordinationOfBenefits === value;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setCoordinationOfBenefits(value);
                      markTouched("coordinationOfBenefits");
                    }}
                    className="transition btn-press"
                    style={{
                      flex: 1,
                      padding: "0.6rem",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                      background: active ? "var(--primary-soft)" : "var(--surface)",
                      color: active ? "var(--primary)" : "var(--text)",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginTop: "0.25rem" }}>Provider / facility</div>

          <Field label="Provider NPI" error={errorFor("providerNpi")}>
            <input
              value={providerNpi}
              inputMode="numeric"
              maxLength={10}
              onChange={(e) => setProviderNpi(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onBlur={() => markTouched("providerNpi")}
              placeholder="1234567890"
              style={inputStyle}
            />
          </Field>

          <Field label="Provider tax ID" error={errorFor("providerTaxId")}>
            <input
              value={providerTaxId}
              onChange={(e) => setProviderTaxId(e.target.value)}
              onBlur={() => markTouched("providerTaxId")}
              placeholder="12-3456789"
              style={inputStyle}
            />
          </Field>

          <Field label="Facility name" error={errorFor("facilityName")}>
            <input
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
              onBlur={() => markTouched("facilityName")}
              placeholder="Riverside Medical Center"
              style={inputStyle}
            />
          </Field>

          <Field label="Facility address" error={errorFor("facilityAddress")}>
            <input
              value={facilityAddress}
              onChange={(e) => setFacilityAddress(e.target.value)}
              onBlur={() => markTouched("facilityAddress")}
              placeholder="123 Main St, Springfield"
              style={inputStyle}
            />
          </Field>
        </SectionCard>

        <SectionCard
          id="documents"
          index={4}
          title="Documents"
          status={sectionStatus("documents")}
          innerRef={(el) => (sectionRefs.current.documents = el)}
        >
          <Field
            label="Documents (at least one required)"
            hint={ACCEPTED_DOCUMENT_HINT}
            error={documentError ?? (attemptedSubmit ? docError ?? undefined : undefined)}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                addFiles(Array.from(e.dataTransfer.files ?? []));
              }}
              className="transition"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.4rem",
                padding: "2rem 1rem",
                textAlign: "center",
                borderRadius: "var(--radius-md)",
                border: `2px dashed ${isDragging ? "var(--primary)" : "var(--border)"}`,
                background: isDragging ? "var(--primary-soft)" : "var(--surface-2)",
                cursor: "pointer",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "1.6rem" }}>
                📎
              </span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                {isDragging ? "Drop to add" : "Drag files here, or click to browse"}
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>PDF, JPG, or PNG — up to 10MB each</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </div>

            <span style={{ fontSize: "0.76rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.3em" }}>
              🔒 Stored securely and only used to process this claim.
            </span>

            {documents.length > 0 && (
              <ul className="stagger-list" style={{ margin: "0.25rem 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {documents.map((f, i) => (
                  <li
                    key={fileKey(f)}
                    className="animate-fade-in-up"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--surface-2)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", overflow: "hidden" }}>
                      <span aria-hidden="true">{fileIcon(f)}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <span style={{ flexShrink: 0, color: "var(--text-muted)", fontSize: "0.78rem" }}>
                        {formatFileSize(f.size)}
                      </span>
                      <span aria-hidden="true" className="animate-pop" style={{ flexShrink: 0, color: "var(--status-good-fg)" }}>
                        ✓
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDocument(i)}
                      aria-label={`Remove ${f.name}`}
                      className="btn-press"
                      style={{
                        flexShrink: 0,
                        border: "none",
                        background: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: "1rem",
                        lineHeight: 1,
                        padding: "0.1rem 0.3rem",
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </SectionCard>

        <SectionCard
          id="review"
          index={5}
          title="Review & submit"
          status={sectionStatus("review")}
          innerRef={(el) => (sectionRefs.current.review = el)}
        >
          <ReviewSummary
            policyNumber={policyNumber}
            claimType={CLAIM_TYPES.find((t) => t.value === claimType)?.label ?? claimType}
            claimantName={claimantName}
            claimantEmail={claimantEmail}
            incidentDate={incidentDate}
            incidentDescription={incidentDescription}
            claimAmount={claimAmount}
            diagnosisCode={diagnosisCode}
            procedureCode={procedureCode}
            serviceDateFrom={serviceDateFrom}
            serviceDateTo={showServiceDateTo ? serviceDateTo : null}
            totalBilledAmount={totalBilledAmount}
            coordinationOfBenefits={coordinationOfBenefits}
            facilityName={facilityName}
            providerNpi={providerNpi}
            documentCount={documents.length}
          />

          <label
            className="transition"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.6rem",
              padding: "0.85rem 1rem",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${attemptedSubmit && !attested ? "var(--danger-border)" : "var(--border)"}`,
              background: "var(--surface-2)",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              style={{ marginTop: "0.15rem" }}
            />
            <span>I attest that the information provided in this claim is true and accurate to the best of my knowledge.</span>
          </label>
          {attemptedSubmit && !attested && (
            <span style={{ fontSize: "0.78rem", color: "var(--danger-fg)" }} role="alert">
              Check the box above to submit.
            </span>
          )}
        </SectionCard>

        {submitError && (
          <div
            role="alert"
            className="animate-fade-in-up"
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--danger-border)",
              background: "var(--danger-bg)",
              color: "var(--danger-fg)",
            }}
          >
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="transition btn-press"
          style={{
            alignSelf: "flex-end",
            padding: "0.75rem 1.6rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
            color: "var(--primary-contrast)",
            fontWeight: 600,
            fontSize: "1rem",
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.7 : 1,
            boxShadow: "0 2px 10px var(--primary-glow)",
          }}
        >
          {submitting ? "Submitting…" : "Submit claim"}
        </button>
      </form>
    </div>
  );
}

function SectionNav({
  onJump,
  status,
}: {
  onJump: (id: SectionId) => void;
  status: (id: SectionId) => "complete" | "error" | "incomplete";
}) {
  return (
    <nav
      aria-label="Form sections"
      style={{
        position: "sticky",
        top: "64px",
        zIndex: 20,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        padding: "0.6rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--surface) 92%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {SECTIONS.map((s, i) => {
        const st = status(s.id);
        const tone =
          st === "complete"
            ? { bg: "var(--status-good-bg)", fg: "var(--status-good-fg)", glyph: "✓" }
            : st === "error"
              ? { bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)", glyph: "!" }
              : { bg: "var(--surface-2)", fg: "var(--text-muted)", glyph: String(i + 1) };
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onJump(s.id)}
            className="transition btn-press"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              cursor: "pointer",
              fontSize: "0.82rem",
              fontWeight: 600,
              color: "var(--text)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                fontSize: "0.7rem",
                background: tone.bg,
                color: tone.fg,
                flexShrink: 0,
              }}
            >
              {tone.glyph}
            </span>
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}

function SectionCard({
  id,
  index,
  title,
  status,
  innerRef,
  children,
}: {
  id: SectionId;
  index: number;
  title: string;
  status: "complete" | "error" | "incomplete";
  innerRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const tone =
    status === "complete"
      ? { bg: "var(--status-good-bg)", fg: "var(--status-good-fg)", glyph: "✓" }
      : status === "error"
        ? { bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)", glyph: "!" }
        : { bg: "var(--surface-2)", fg: "var(--text-muted)", glyph: String(index) };

  return (
    <div
      id={id}
      ref={innerRef}
      style={{
        scrollMarginTop: "120px",
        border: `1px solid ${status === "error" ? "var(--danger-border)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "26px",
            height: "26px",
            borderRadius: "50%",
            fontSize: "0.8rem",
            fontWeight: 700,
            flexShrink: 0,
            background: tone.bg,
            color: tone.fg,
          }}
        >
          {tone.glyph}
        </span>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontFamily: "var(--font-display)" }}>{title}</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>{children}</div>
    </div>
  );
}

function ReviewSummary({
  policyNumber,
  claimType,
  claimantName,
  claimantEmail,
  incidentDate,
  incidentDescription,
  claimAmount,
  diagnosisCode,
  procedureCode,
  serviceDateFrom,
  serviceDateTo,
  totalBilledAmount,
  coordinationOfBenefits,
  facilityName,
  providerNpi,
  documentCount,
}: {
  policyNumber: string;
  claimType: string;
  claimantName: string;
  claimantEmail: string;
  incidentDate: string;
  incidentDescription: string;
  claimAmount: string;
  diagnosisCode: string;
  procedureCode: string;
  serviceDateFrom: string;
  serviceDateTo: string | null;
  totalBilledAmount: string;
  coordinationOfBenefits: boolean | null;
  facilityName: string;
  providerNpi: string;
  documentCount: number;
}) {
  const serviceDates =
    serviceDateFrom && serviceDateTo && serviceDateTo !== serviceDateFrom
      ? `${new Date(serviceDateFrom).toLocaleDateString()} – ${new Date(serviceDateTo).toLocaleDateString()}`
      : serviceDateFrom
        ? new Date(serviceDateFrom).toLocaleDateString()
        : "—";

  const rows: [string, string][] = [
    ["Policy number", policyNumber || "—"],
    ["Claim type", claimType],
    ["Your name", claimantName || "—"],
    ["Email", claimantEmail || "—"],
    ["Incident date", incidentDate ? new Date(incidentDate).toLocaleDateString() : "—"],
    ["What happened", incidentDescription || "—"],
    [
      "Requested claim amount",
      claimAmount
        ? Number(claimAmount).toLocaleString(undefined, { style: "currency", currency: "USD" })
        : "—",
    ],
    ["Diagnosis code", diagnosisCode || "—"],
    ["Procedure code", procedureCode || "—"],
    ["Date(s) of service", serviceDates],
    [
      "Total billed amount",
      totalBilledAmount
        ? Number(totalBilledAmount).toLocaleString(undefined, { style: "currency", currency: "USD" })
        : "—",
    ],
    ["Other coverage (COB)", coordinationOfBenefits === null ? "—" : coordinationOfBenefits ? "Yes" : "No"],
    ["Provider", facilityName ? `${facilityName} (NPI ${providerNpi})` : "—"],
    ["Documents", documentCount > 0 ? `${documentCount} attached` : "None attached"],
  ];

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface-2)",
        padding: "1rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", fontSize: "0.9rem" }}>
          <span style={{ color: "var(--text-muted)" }}>{label}</span>
          <span style={{ textAlign: "right", maxWidth: "60%" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{label}</span>
      {children}
      {hint && !error && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{hint}</span>}
      {error && (
        <span style={{ fontSize: "0.78rem", color: "var(--danger-fg)" }} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.65rem 0.8rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  width: "100%",
};
