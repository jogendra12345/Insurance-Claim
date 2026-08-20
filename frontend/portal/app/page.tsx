"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, fetchActiveClaimsByPolicy } from "@/lib/api";
import { ACTIVE_STATUSES, type Claim } from "@/lib/types";
import { ClaimCard } from "@/components/ClaimCard";
import { EmptyState } from "@/components/EmptyState";
import { PolicySelect } from "@/components/PolicySelect";

type LoadState = "idle" | "loading" | "loaded" | "error";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPolicy = searchParams.get("policyNumber") ?? "";

  const [policyInput, setPolicyInput] = useState(initialPolicy);
  const [activePolicy, setActivePolicy] = useState(initialPolicy);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (policyNumber: string) => {
    if (!policyNumber.trim()) return;
    setState("loading");
    setError(null);
    try {
      const all = await fetchActiveClaimsByPolicy(policyNumber.trim());
      setClaims(all.filter((c) => ACTIVE_STATUSES.includes(c.status)));
      setState("loaded");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong loading your claims.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (initialPolicy) {
      void load(initialPolicy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = policyInput.trim();
    if (!trimmed) return;
    setActivePolicy(trimmed);
    router.replace(`/?policyNumber=${encodeURIComponent(trimmed)}`);
    void load(trimmed);
  }

  const totalPending = claims.reduce((sum, c) => sum + c.claimAmount, 0);
  const needsAttention = claims.filter((c) => c.status === "awaiting_info").length;

  return (
    <main style={{ maxWidth: "840px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Your claims</h1>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Choose your policy to see your active claims, or submit a new one.
        </p>
      </header>

      <form onSubmit={handleLookup} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <PolicySelect
          value={policyInput}
          onChange={setPolicyInput}
          id="policy-lookup"
          style={{
            flex: "1 1 240px",
            padding: "0.65rem 0.9rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
        <button
          type="submit"
          className="transition"
          style={{
            padding: "0.65rem 1.25rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--primary)",
            color: "var(--primary-contrast)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          View claims
        </button>
      </form>

      {state === "loaded" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem" }}>
          <StatCard label="Active claims" value={String(claims.length)} />
          <StatCard
            label="Total pending"
            value={totalPending.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          />
          <StatCard
            label="Needs your attention"
            value={String(needsAttention)}
            tone={needsAttention > 0 ? "attention" : undefined}
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.15rem" }}>
          {activePolicy ? `Active claims for ${activePolicy}` : "Active claims"}
        </h2>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {activePolicy && (
            <button
              onClick={() => void load(activePolicy)}
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
          )}
          <a
            href={`/claims/new${activePolicy ? `?policyNumber=${encodeURIComponent(activePolicy)}` : ""}`}
            className="transition"
            style={{
              padding: "0.45rem 1rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "var(--primary)",
              color: "var(--primary-contrast)",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Submit a Claim
          </a>
        </div>
      </div>

      {state === "idle" && (
        <EmptyState
          title="Look up your claims"
          body="Choose your policy above to see your active claims, or submit a new one straight away."
        />
      )}

      {state === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: "96px",
                borderRadius: "var(--radius-md)",
                background: "var(--surface-2)",
                animation: "pulse 1.4s ease-in-out infinite",
              }}
            />
          ))}
          <style>{`@media (prefers-reduced-motion: no-preference) { @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } } }`}</style>
        </div>
      )}

      {state === "error" && (
        <div
          role="alert"
          style={{
            padding: "1rem 1.25rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--danger-border)",
            background: "var(--danger-bg)",
            color: "var(--danger-fg)",
          }}
        >
          {error}
        </div>
      )}

      {state === "loaded" && claims.length === 0 && (
        <EmptyState
          title="No active claims"
          body={`No active claims found for ${activePolicy}. Anything already resolved won't show here.`}
        />
      )}

      {state === "loaded" && claims.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
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
