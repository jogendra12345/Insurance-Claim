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

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

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
        </div>
      )}
    </main>
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
