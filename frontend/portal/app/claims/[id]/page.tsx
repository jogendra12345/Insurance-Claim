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
    <main style={{ maxWidth: "680px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
      <a href="/" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>
        ← Back to claims
      </a>

      {state === "loading" && (
        <div style={{ marginTop: "1.5rem", height: "280px", borderRadius: "var(--radius-md)", background: "var(--surface-2)", animation: "pulse 1.4s ease-in-out infinite" }} aria-busy="true">
          <style>{`@media (prefers-reduced-motion: no-preference) { @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } } }`}</style>
        </div>
      )}

      {state === "error" && (
        <div role="alert" style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && claim && (
        <div style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.6rem" }}>{CLAIM_TYPE_LABEL[claim.claimType]} claim</h1>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                {claim.id}
              </span>
            </div>
            <StatusBadge status={claim.status} />
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
            <DetailRow label="Policy number" value={claim.policyNumber} />
            <DetailRow label="Claimant" value={`${claim.claimantName} (${claim.claimantEmail})`} />
            <DetailRow label="Incident date" value={new Date(claim.incidentDate).toLocaleDateString()} />
            <DetailRow label="What happened" value={claim.incidentDescription} />
            <DetailRow
              label="Claim amount"
              value={claim.claimAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}
            />
            {claim.confirmedRole && <DetailRow label="Handled by" value={claim.confirmedRole} />}
            {claim.riskScore !== null && <DetailRow label="Risk score" value={String(claim.riskScore)} />}
            {claim.fraudIndicatorCount > 0 && (
              <DetailRow label="Fraud indicators" value={String(claim.fraudIndicatorCount)} />
            )}
            {claim.decision && <DetailRow label="Decision" value={claim.decision} />}
            {claim.denialReason && <DetailRow label="Denial reason" value={claim.denialReason} />}
            <DetailRow label="Submitted" value={new Date(claim.createdAt).toLocaleString()} />
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-2)",
              padding: "1rem 1.25rem",
            }}
          >
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Summary</span>
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.9rem", color: claim.caseSummary ? "var(--text)" : "var(--text-muted)" }}>
              {claim.caseSummary ?? "Not yet available — an automated review is still in progress."}
            </p>
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
                  className="transition"
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

            {documentsVisible && claim.documents && claim.documents.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
