"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, fetchClaim, fetchPolicies } from "@/lib/api";
import type { Claim } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

const CLAIM_TYPE_LABEL: Record<Claim["claimType"], string> = {
  outpatient: "Outpatient",
  inpatient: "Inpatient",
  pharmacy: "Pharmacy",
  dental: "Dental",
  maternity: "Maternity",
  other: "Other",
};

const DECISION_LABEL: Record<NonNullable<Claim["decision"]>, string> = {
  approve: "Approved",
  deny: "Denied",
  moreInfo: "More info requested",
};

const ROLE_LABEL: Record<string, string> = {
  adjuster: "Adjuster",
  investigator: "Investigator",
  legal: "Legal",
  auto: "Auto-approved",
};

type LoadState = "loading" | "loaded" | "error";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function fileNameFromUrl(url: string): string {
  const decoded = decodeURIComponent(url.split("/").pop() ?? url);
  // Uploaded object keys are prefixed "<timestamp>-<originalname>" — strip that for display.
  return decoded.replace(/^\d+-/, "");
}

function isImage(url: string): boolean {
  const lower = url.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isPdf(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf");
}

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function riskTone(score: number): { bg: string; fg: string; label: string } {
  if (score < 30) return { bg: "var(--status-good-bg)", fg: "var(--status-good-fg)", label: "Low" };
  if (score < 60) return { bg: "var(--status-attention-bg)", fg: "var(--status-attention-fg)", label: "Medium" };
  return { bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)", label: "High" };
}

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [documentsVisible, setDocumentsVisible] = useState(false);
  const [incidentExpanded, setIncidentExpanded] = useState(false);
  const [policyholderName, setPolicyholderName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIncidentExpanded(false);
    setPolicyholderName(null);
    fetchClaim(params.id)
      .then((c) => {
        if (!cancelled) {
          setClaim(c);
          setState("loaded");
        }
        // No GET /api/policies/:id endpoint exists yet — the list is small
        // enough in this demo to fetch and match by policyNumber client-side.
        fetchPolicies()
          .then((policies) => {
            if (cancelled) return;
            const policy = policies.find((p) => p.policyNumber === c.policyNumber);
            if (policy) setPolicyholderName(policy.policyholderName);
          })
          .catch(() => {
            // Non-critical — the header falls back to the claimant's name.
          });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load this claim.");
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
      <a href="/" className="transition" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>
        ← Back to claims
      </a>

      {state === "loading" && <div className="skeleton" style={{ marginTop: "1.5rem", height: "280px" }} aria-busy="true" />}

      {state === "error" && (
        <div role="alert" className="animate-fade-in-up" style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && claim && (
        <div className="animate-fade-in-up stagger-list" style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: "1.6rem" }}>
                  {policyholderName ?? claim.claimantName} <span style={{ color: "var(--text-muted)" }}>({claim.policyNumber})</span>
                </h1>
                <StatusBadge status={claim.status} />
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {CLAIM_TYPE_LABEL[claim.claimType]} claim ·{" "}
                <span style={{ fontFamily: MONO_FONT }}>{claim.id}</span>
              </span>
            </div>
            <button
              onClick={() => window.print()}
              className="transition btn-press no-print"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                borderRadius: "var(--radius-sm)",
                padding: "0.5rem 0.9rem",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <PrinterIcon />
              Print
            </button>
          </div>

          <StatRow claim={claim} />

          {claim.decision === "deny" && claim.denialReason && (
            <div
              role="alert"
              style={{
                border: "1px solid var(--danger-border)",
                borderRadius: "var(--radius-md)",
                background: "var(--danger-bg)",
                color: "var(--danger-fg)",
                padding: "1rem 1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.3rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Denial reason
              </span>
              <span style={{ fontSize: "0.9rem" }}>{claim.denialReason}</span>
            </div>
          )}

          <div className="claim-grid">
            {/* Left column */}
            <div className="claim-col" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <Section title="AI case summary" icon={<SparkleIcon />} aiAssessed>
                <p style={{ margin: 0, fontSize: "0.9rem", color: claim.caseSummary ? "var(--text)" : "var(--text-muted)" }}>
                  {claim.caseSummary ?? "Not yet available — an automated review is still in progress."}
                </p>
                {claim.fraudIndicators && claim.fraudIndicators.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.9rem" }}>
                    {claim.fraudIndicators.map((indicator) => (
                      <div
                        key={indicator.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.6rem",
                          padding: "0.75rem 0.9rem",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--status-attention-bg)",
                          color: "var(--status-attention-fg)",
                        }}
                      >
                        <span style={{ flexShrink: 0, marginTop: "0.1rem" }}>
                          <AlertTriangleIcon />
                        </span>
                        <span style={{ fontSize: "0.85rem" }}>
                          <strong style={{ textTransform: "capitalize" }}>{indicator.type.replace(/_/g, " ")}</strong>
                          {" "}
                          <span style={{ opacity: 0.75 }}>({Math.round(indicator.confidence * 100)}% confidence)</span>
                          {" — "}
                          {indicator.description}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title="Service & billing" icon={<StethoscopeIcon />}>
                <div className="detail-rows">
                  <DetailRow label="Diagnosis code" value={claim.diagnosisCode} hint="ICD-10" />
                  <DetailRow label="Procedure code" value={claim.procedureCode} hint="CPT" />
                  <DetailRow
                    label="Date(s) of service"
                    value={
                      claim.serviceDateTo && claim.serviceDateTo !== claim.serviceDateFrom
                        ? `${new Date(claim.serviceDateFrom).toLocaleDateString()} – ${new Date(claim.serviceDateTo).toLocaleDateString()}`
                        : new Date(claim.serviceDateFrom).toLocaleDateString()
                    }
                  />
                  <DetailRow label="Requested claim amount" value={currency(claim.claimAmount)} />
                  <DetailRow label="Total billed amount" value={currency(claim.totalBilledAmount)} />
                  <DetailRow label="Other coverage (COB)" value={claim.coordinationOfBenefits ? "Yes" : "No"} />
                </div>
              </Section>

              {claim.provider && (
                <Section title="Provider" icon={<BuildingIcon />}>
                  <div className="detail-rows">
                    <DetailRow label="Facility" value={claim.provider.facilityName} />
                    <DetailRow label="NPI" value={claim.provider.npi} />
                    <DetailRow label="Tax ID" value={claim.provider.taxId} />
                  </div>
                </Section>
              )}
            </div>

            {/* Right column */}
            <div className="claim-col" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <Section title="Claimant & policy" icon={<FileTextIcon />}>
                <div className="detail-rows">
                  <DetailRow label="Policy number" value={claim.policyNumber} />
                  <DetailRow label="Claimant" value={claim.claimantName} />
                  <DetailRow label="Email" value={claim.claimantEmail} />
                </div>
              </Section>

              <Section title="Incident" icon={<CalendarIcon />}>
                <div className="detail-rows">
                  <DetailRow label="Incident date" value={new Date(claim.incidentDate).toLocaleDateString()} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.9rem" }}>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                    What happened
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.88rem",
                      ...(incidentExpanded || claim.incidentDescription.length <= 320
                        ? {}
                        : {
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical" as const,
                            WebkitLineClamp: 5,
                            overflow: "hidden",
                          }),
                    }}
                  >
                    {claim.incidentDescription}
                  </p>
                  {claim.incidentDescription.length > 320 && (
                    <button
                      onClick={() => setIncidentExpanded((v) => !v)}
                      className="transition no-print"
                      style={{
                        alignSelf: "flex-start",
                        border: "none",
                        background: "none",
                        color: "var(--primary)",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {incidentExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              </Section>

              <Section title="Review & decision" icon={<GavelIcon />} aiAssessed={claim.riskScore !== null || claim.fraudIndicatorCount > 0}>
                <div className="detail-rows">
                  {claim.confirmedRole && <DetailRow label="Handled by" value={ROLE_LABEL[claim.confirmedRole] ?? claim.confirmedRole} />}
                  <DetailRow
                    label="Fraud indicators"
                    value={claim.fraudIndicatorCount > 0 ? `${claim.fraudIndicatorCount} flagged` : "None found"}
                  />
                  {claim.decision && <DetailRow label="Decision" value={DECISION_LABEL[claim.decision]} />}
                  <DetailRow label="Attested" value={new Date(claim.attestationSignedAt).toLocaleString()} />
                  {claim.lastReviewerActionAt && (
                    <DetailRow label="Last reviewer action" value={new Date(claim.lastReviewerActionAt).toLocaleString()} />
                  )}
                </div>
                {claim.riskReasoning && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.9rem" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                      AI risk reasoning
                    </span>
                    <p style={{ margin: 0, fontSize: "0.88rem" }}>{claim.riskReasoning}</p>
                  </div>
                )}
              </Section>
            </div>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface)",
              boxShadow: "var(--shadow-card)",
              padding: "1.25rem 1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Documents ({claim.documents?.length ?? 0})
              </span>
              {claim.documents && claim.documents.length > 0 && (
                <button
                  onClick={() => setDocumentsVisible((v) => !v)}
                  aria-label={documentsVisible ? "Hide documents" : "Show documents"}
                  aria-pressed={documentsVisible}
                  className="transition btn-press"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    border: "1px solid var(--border)",
                    background: documentsVisible ? "var(--primary-soft)" : "var(--surface)",
                    color: documentsVisible ? "var(--primary)" : "var(--text-muted)",
                    borderRadius: "999px",
                    padding: "0.3rem 0.75rem",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <EyeIcon open={documentsVisible} />
                  {documentsVisible ? "Hide" : "View"}
                </button>
              )}
            </div>

            {(!claim.documents || claim.documents.length === 0) && (
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted)" }}>No documents attached.</p>
            )}

            {!documentsVisible && claim.documents && claim.documents.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {claim.documents.map((doc) => (
                  <span
                    key={doc.id}
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: "999px",
                      padding: "0.2rem 0.65rem",
                      maxWidth: "220px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fileNameFromUrl(doc.fileUrl)}
                  </span>
                ))}
              </div>
            )}

            {documentsVisible && claim.documents && claim.documents.length > 0 && (
              <div className="stagger-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {claim.documents.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "0.75rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "0.85rem", fontWeight: 600, wordBreak: "break-all" }}
                    >
                      {fileNameFromUrl(doc.fileUrl)}
                    </a>
                    {isImage(doc.fileUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={doc.fileUrl}
                        alt={fileNameFromUrl(doc.fileUrl)}
                        style={{ maxWidth: "100%", maxHeight: "320px", borderRadius: "var(--radius-sm)", objectFit: "contain" }}
                      />
                    ) : isPdf(doc.fileUrl) ? (
                      <iframe
                        src={doc.fileUrl}
                        title={fileNameFromUrl(doc.fileUrl)}
                        style={{
                          width: "100%",
                          height: "420px",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--surface-2)",
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        Preview not available for this file type — open the link above.
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function StatRow({ claim }: { claim: Claim }) {
  const tone = claim.riskScore !== null ? riskTone(claim.riskScore) : null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "0.75rem",
      }}
    >
      <StatCard label="Claim amount" value={currency(claim.claimAmount)} sub="Requested by claimant" />
      <StatCard label="Total billed" value={currency(claim.totalBilledAmount)} sub="Provider statement" />
      <StatCard
        label="Risk score"
        value={claim.riskScore !== null ? `${claim.riskScore}` : "Pending"}
        sub={claim.riskScore !== null ? undefined : "Awaiting model run"}
        valueTone={claim.riskScore === null ? "warning" : "default"}
        badge={tone ? { text: tone.label, bg: tone.bg, fg: tone.fg } : undefined}
      />
      <StatCard
        label="Fraud indicators"
        value={String(claim.fraudIndicatorCount)}
        valueTone={claim.fraudIndicatorCount > 0 ? "bad" : "success"}
        badge={
          claim.fraudIndicatorCount > 0
            ? { text: "Flagged", bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)" }
            : { text: "Clean", bg: "var(--status-good-bg)", fg: "var(--status-good-fg)", icon: <CircleCheckIcon /> }
        }
      />
    </div>
  );
}

const VALUE_TONE_COLOR: Record<"default" | "warning" | "success" | "bad", string> = {
  default: "var(--text)",
  warning: "var(--status-attention-fg)",
  success: "var(--status-good-fg)",
  bad: "var(--status-bad-fg)",
};

function StatCard({
  label,
  value,
  sub,
  badge,
  valueTone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  badge?: { text: string; bg: string; fg: string; icon?: React.ReactNode };
  valueTone?: "default" | "warning" | "success" | "bad";
}) {
  return (
    <div
      className="card-lift"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "0.9rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
      }}
    >
      <span style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: "1.35rem",
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.01em",
            color: VALUE_TONE_COLOR[valueTone],
          }}
        >
          {value}
        </span>
        {badge && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.7rem",
              fontWeight: 700,
              padding: "0.15rem 0.5rem",
              borderRadius: "999px",
              background: badge.bg,
              color: badge.fg,
            }}
          >
            {badge.icon}
            {badge.text}
          </span>
        )}
      </div>
      {sub && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{sub}</span>}
    </div>
  );
}

function Section({
  title,
  icon,
  aiAssessed,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  aiAssessed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.75rem 1.25rem",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {icon && <span style={{ color: "var(--primary)", display: "inline-flex" }}>{icon}</span>}
          <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{title}</span>
        </div>
        {aiAssessed && (
          <span
            title="Assessed by AI, confirmed by a human reviewer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.68rem",
              fontWeight: 700,
              color: "var(--primary)",
              background: "var(--primary-soft)",
              borderRadius: "999px",
              padding: "0.1rem 0.5rem",
              letterSpacing: "0.02em",
            }}
          >
            <SparkleIcon size={10} />
            AI-assessed
          </span>
        )}
      </div>
      <div style={{ padding: "1.1rem 1.25rem" }}>{children}</div>
    </div>
  );
}

function SparkleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
    </svg>
  );
}

function PrinterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6v-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 2.5 20h19L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}

function CircleCheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" />
      <path d="m8 12.5 2.6 2.6L16 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StethoscopeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 3v6a4 4 0 0 0 8 0V3M9 20a5 5 0 0 0 5-5v-2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18.5" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M16 21v-9a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v9M4 21h16M7.5 7.5h1M11.5 7.5h1M7.5 11h1M11.5 11h1M7.5 14.5h1M11.5 14.5h1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GavelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m14.5 3.5 6 6M9.5 8.5l6 6M2 22l6.5-6.5M4.5 12.5l7-7 3 3-7 7-3-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {open ? (
        <>
          <path
            d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        </>
      ) : (
        <>
          <path
            d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.6 6.7C4 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2M9.5 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-2.2 3.1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", fontSize: "0.9rem" }}>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", display: "flex", alignItems: "baseline", gap: "0.4rem", justifyContent: "flex-end" }}>
        <span style={{ fontWeight: 500 }}>{value}</span>
        {hint && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{hint}</span>}
      </span>
    </div>
  );
}
