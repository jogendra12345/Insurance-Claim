"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, fetchActiveClaimsByPolicy } from "@/lib/api";
import { ACTIVE_STATUSES, type Claim } from "@/lib/types";
import { ClaimCard } from "@/components/ClaimCard";
import { EmptyState } from "@/components/EmptyState";

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

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent)" }}>
          ClaimFlow AI
        </span>
        <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Your claims</h1>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Enter your policy number to see your active claims, or submit a new one.
        </p>
      </header>

      <form
        onSubmit={handleLookup}
        style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
      >
        <input
          type="text"
          value={policyInput}
          onChange={(e) => setPolicyInput(e.target.value)}
          placeholder="Policy number (e.g. POL-100234)"
          aria-label="Policy number"
          style={{
            flex: "1 1 240px",
            padding: "0.6rem 0.85rem",
            borderRadius: "8px",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "0.6rem 1.1rem",
            borderRadius: "8px",
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-contrast)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          View claims
        </button>
      </form>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
          {activePolicy ? `Active claims for ${activePolicy}` : "Active claims"}
        </h2>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {activePolicy && (
            <button
              onClick={() => void load(activePolicy)}
              disabled={state === "loading"}
              style={{
                padding: "0.4rem 0.8rem",
                borderRadius: "8px",
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
            style={{
              padding: "0.4rem 0.9rem",
              borderRadius: "8px",
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-contrast)",
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
          body="Enter your policy number above to see your active claims, or submit a new one straight away."
        />
      )}

      {state === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: "84px",
                borderRadius: "12px",
                background: "var(--surface-muted)",
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
            borderRadius: "10px",
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
