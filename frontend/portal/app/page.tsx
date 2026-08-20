"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchActiveClaimsByPolicy, fetchAllClaims } from "@/lib/api";
import { ACTIVE_STATUSES, type Claim } from "@/lib/types";
import { ClaimCard } from "@/components/ClaimCard";
import { EmptyState } from "@/components/EmptyState";
import { PolicySelect } from "@/components/PolicySelect";

type LoadState = "loading" | "loaded" | "error";

export default function HomePage() {
  const [policyFilter, setPolicyFilter] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (policyNumber: string) => {
    setState("loading");
    setError(null);
    try {
      const result = policyNumber.trim() ? await fetchActiveClaimsByPolicy(policyNumber.trim()) : await fetchAllClaims();
      setClaims(result);
      setState("loaded");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong loading claims.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalClaims = claims.length;
  const activeClaims = claims.filter((c) => ACTIVE_STATUSES.includes(c.status)).length;
  const totalValue = claims.reduce((sum, c) => sum + c.claimAmount, 0);
  const needsAttention = claims.filter((c) => c.status === "awaiting_info").length;

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Claims</h1>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>Every claim submitted through the portal.</p>
        </div>
        <a
          href="/claims/new"
          className="transition"
          style={{
            padding: "0.55rem 1.1rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--primary)",
            color: "var(--primary-contrast)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Submit a Claim
        </a>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem" }}>
        <StatCard label="Total claims" value={String(totalClaims)} />
        <StatCard label="Active claims" value={String(activeClaims)} />
        <StatCard
          label="Total claimed value"
          value={totalValue.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
        />
        <StatCard label="Needs attention" value={String(needsAttention)} tone={needsAttention > 0 ? "attention" : undefined} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flex: "1 1 260px" }}>
          <PolicySelect
            value={policyFilter}
            onChange={(v) => {
              setPolicyFilter(v);
              void load(v);
            }}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: "0.85rem",
            }}
          />
          {policyFilter && (
            <button
              onClick={() => {
                setPolicyFilter("");
                void load("");
              }}
              className="transition"
              style={{ border: "none", background: "none", color: "var(--primary)", fontSize: "0.85rem", cursor: "pointer", fontWeight: 600 }}
            >
              Show all
            </button>
          )}
        </div>
        <button
          onClick={() => void load(policyFilter)}
          disabled={state === "loading"}
          className="transition"
          style={{
            padding: "0.45rem 0.85rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            cursor: state === "loading" ? "default" : "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {state === "loading" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.85rem" }} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: "128px", borderRadius: "var(--radius-md)", background: "var(--surface-2)", animation: "pulse 1.4s ease-in-out infinite" }} />
          ))}
          <style>{`@media (prefers-reduced-motion: no-preference) { @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } } }`}</style>
        </div>
      )}

      {state === "error" && (
        <div role="alert" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && claims.length === 0 && (
        <EmptyState title="No claims yet" body="Nothing's been submitted yet — submit a claim to see it here." />
      )}

      {state === "loaded" && claims.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.85rem" }}>
          {claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "attention" }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "0.9rem 1.1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.6rem",
          fontWeight: 600,
          color: tone === "attention" && value !== "0" ? "var(--status-attention-fg)" : "var(--text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
