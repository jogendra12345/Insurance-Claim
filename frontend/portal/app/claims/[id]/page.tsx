"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, fetchClaim } from "@/lib/api";
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

  useEffect(() => {
    let cancelled = false;
    fetchClaim(params.id)
      .then((c) => {
        if (!cancelled) {
          setClaim(c);
          setState("loaded");
        }
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
    <main style={{ maxWidth: "760px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.6rem" }}>{CLAIM_TYPE_LABEL[claim.claimType]} claim</h1>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {claim.id}
              </span>
            </div>
            <StatusBadge status={claim.status} />
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

          <Section title="AI case summary" aiAssessed>
            <p style={{ margin: 0, fontSize: "0.9rem", color: claim.caseSummary ? "var(--text)" : "var(--text-muted)" }}>
              {claim.caseSummary ?? "Not yet available — an automated review is still in progress."}
            </p>
          </Section>

          <Section title="Claimant & policy">
            <DetailRow label="Policy number" value={claim.policyNumber} />
            <DetailRow label="Claimant" value={`${claim.claimantName} (${claim.claimantEmail})`} />
          </Section>

          <Section title="Incident">
            <DetailRow label="Incident date" value={new Date(claim.incidentDate).toLocaleDateString()} />
            <DetailRow label="What happened" value={claim.incidentDescription} />
          </Section>

          <Section title="Service & billing">
            <DetailRow label="Diagnosis code" value={claim.diagnosisCode} />
            <DetailRow label="Procedure code" value={claim.procedureCode} />
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
          </Section>

          {claim.provider && (
            <Section title="Provider">
              <DetailRow label="Facility" value={claim.provider.facilityName} />
              <DetailRow label="NPI" value={claim.provider.npi} />
              <DetailRow label="Tax ID" value={claim.provider.taxId} />
            </Section>
          )}

          <Section title="Review & decision" aiAssessed={claim.riskScore !== null || claim.fraudIndicatorCount > 0}>
            {claim.confirmedRole && <DetailRow label="Handled by" value={ROLE_LABEL[claim.confirmedRole] ?? claim.confirmedRole} />}
            <DetailRow
              label="Fraud indicators"
              value={claim.fraudIndicatorCount > 0 ? `${claim.fraudIndicatorCount} flagged` : "None found"}
            />
            {claim.decision && <DetailRow label="Decision" value={DECISION_LABEL[claim.decision]} />}
            <DetailRow label="Attested" value={new Date(claim.attestationSignedAt).toLocaleString()} />
            <DetailRow label="Submitted" value={new Date(claim.createdAt).toLocaleString()} />
          </Section>

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
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
      }}
    >
      <StatCard label="Claim amount" value={currency(claim.claimAmount)} />
      <StatCard label="Total billed" value={currency(claim.totalBilledAmount)} />
      <StatCard
        label="Risk score"
        value={claim.riskScore !== null ? `${claim.riskScore}` : "Pending"}
        badge={tone ? { text: tone.label, bg: tone.bg, fg: tone.fg } : undefined}
        muted={claim.riskScore === null}
      />
      <StatCard
        label="Fraud indicators"
        value={String(claim.fraudIndicatorCount)}
        badge={
          claim.fraudIndicatorCount > 0
            ? { text: "Flagged", bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)" }
            : { text: "Clean", bg: "var(--status-good-bg)", fg: "var(--status-good-fg)" }
        }
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  badge,
  muted,
}: {
  label: string;
  value: string;
  badge?: { text: string; bg: string; fg: string };
  muted?: boolean;
}) {
  return (
    <div
      className="card-lift"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "0.85rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
      }}
    >
      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.3rem", fontFamily: "var(--font-display)", color: muted ? "var(--text-muted)" : "var(--text)" }}>
          {value}
        </span>
        {badge && (
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              padding: "0.15rem 0.5rem",
              borderRadius: "999px",
              background: badge.bg,
              color: badge.fg,
            }}
          >
            {badge.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  aiAssessed,
  children,
}: {
  title: string;
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
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{title}</span>
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
            <SparkleIcon />
            AI-assessed
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", fontSize: "0.9rem" }}>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
