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

type FieldErrors = Partial<Record<keyof Omit<NewClaimInput, "documents">, string>>;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ClaimForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [policyNumber, setPolicyNumber] = useState(searchParams.get("policyNumber") ?? "");
  const [claimType, setClaimType] = useState<ClaimType>("outpatient");
  const [claimantName, setClaimantName] = useState("");
  const [claimantEmail, setClaimantEmail] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);

  function removeDocument(index: number) {
    const next = documents.filter((_, i) => i !== index);
    setDocuments(next);
    // Keep the native input's FileList in sync so a later selection doesn't
    // resurrect a file the user just removed.
    if (fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      next.forEach((file) => dataTransfer.items.add(file));
      fileInputRef.current.files = dataTransfer.files;
    }
  }

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!policyNumber.trim()) errors.policyNumber = "Policy number is required.";
    if (!claimantName.trim()) errors.claimantName = "Name is required.";
    if (!claimantEmail.trim()) errors.claimantEmail = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claimantEmail)) errors.claimantEmail = "Enter a valid email.";
    if (!incidentDate) errors.incidentDate = "Incident date is required.";
    else if (incidentDate > todayIso()) errors.incidentDate = "Incident date can't be in the future.";
    if (!incidentDescription.trim()) errors.incidentDescription = "Please describe what happened.";
    const amount = Number(claimAmount);
    if (!claimAmount || Number.isNaN(amount) || amount <= 0) {
      errors.claimAmount = "Enter a claim amount greater than 0.";
    }
    return errors;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

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
        style={{
          padding: "1.5rem",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          background: "var(--status-good-bg)",
          color: "var(--status-good-fg)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Claim submitted</h2>
        <p style={{ margin: 0 }}>
          Reference: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{confirmedId}</strong>
        </p>
        <button
          onClick={() => router.push(`/?policyNumber=${encodeURIComponent(policyNumber.trim())}`)}
          style={{
            alignSelf: "flex-start",
            padding: "0.5rem 1rem",
            borderRadius: "8px",
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-contrast)",
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
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }} noValidate>
      <Field label="Policy number" error={fieldErrors.policyNumber}>
        <PolicySelect
          value={policyNumber}
          onChange={setPolicyNumber}
          onPolicySelect={(policy) => setClaimantName(policy?.policyholderName ?? "")}
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

      <Field label="Your name" error={fieldErrors.claimantName}>
        <input
          value={claimantName}
          onChange={(e) => setClaimantName(e.target.value)}
          placeholder="Jane Doe"
          style={inputStyle}
        />
      </Field>

      <Field label="Email" error={fieldErrors.claimantEmail}>
        <input
          type="email"
          value={claimantEmail}
          onChange={(e) => setClaimantEmail(e.target.value)}
          placeholder="jane.doe@example.com"
          style={inputStyle}
        />
      </Field>

      <Field label="Incident date" error={fieldErrors.incidentDate}>
        <input
          type="date"
          value={incidentDate}
          max={todayIso()}
          onChange={(e) => setIncidentDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="What happened" error={fieldErrors.incidentDescription}>
        <textarea
          value={incidentDescription}
          onChange={(e) => setIncidentDescription(e.target.value)}
          rows={4}
          placeholder="Briefly describe what happened, when, and where."
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <Field label="Claim amount (USD)" error={fieldErrors.claimAmount}>
        <input
          type="number"
          min="0"
          step="0.01"
          value={claimAmount}
          onChange={(e) => setClaimAmount(e.target.value)}
          placeholder="0.00"
          style={inputStyle}
        />
      </Field>

      <Field label="Documents" hint={ACCEPTED_DOCUMENT_HINT}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => setDocuments(Array.from(e.target.files ?? []))}
          style={{ ...inputStyle, padding: "0.5rem" }}
        />
        {documents.length > 0 && (
          <ul style={{ margin: "0.5rem 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {documents.map((f, i) => (
              <li
                key={`${f.name}-${f.lastModified}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  padding: "0.35rem 0.6rem",
                  borderRadius: "6px",
                  background: "var(--surface-muted)",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeDocument(i)}
                  aria-label={`Remove ${f.name}`}
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

      {submitError && (
        <div
          role="alert"
          style={{
            padding: "0.85rem 1rem",
            borderRadius: "10px",
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
        style={{
          padding: "0.75rem 1.25rem",
          borderRadius: "8px",
          border: "none",
          background: "var(--accent)",
          color: "var(--accent-contrast)",
          fontWeight: 600,
          fontSize: "1rem",
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? "Submitting…" : "Submit claim"}
      </button>
    </form>
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
  padding: "0.6rem 0.75rem",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  width: "100%",
};
