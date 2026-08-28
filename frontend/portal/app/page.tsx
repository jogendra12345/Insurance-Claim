"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchActiveClaimsByPolicy, fetchAllClaims } from "@/lib/api";
import { ACTIVE_STATUSES, type Claim, type ClaimStatus } from "@/lib/types";
import { ClaimTable } from "@/components/ClaimTable";
import { EmptyState } from "@/components/EmptyState";
import { PolicySelect } from "@/components/PolicySelect";
import { STATUS_META } from "@/components/StatusBadge";
import { ShieldCheckIllustration, DocumentIllustration } from "@/components/HeroIllustrations";

const ALL_STATUSES: ClaimStatus[] = ["submitted", "validating", "triage", "in_review", "awaiting_info", "approved", "denied"];

const PAGE_SIZE = 10;

type LoadState = "loading" | "loaded" | "error";

type StatFilter = "active" | "attention" | null;

const STAT_FILTER_LABEL: Record<Exclude<StatFilter, null>, string> = {
  active: "Active claims",
  attention: "Needs attention",
};

export default function HomePage() {
  const [policyFilter, setPolicyFilter] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [statFilter, setStatFilter] = useState<StatFilter>(null);
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | "all">("all");
  const [page, setPage] = useState(0);

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

  const statFiltered =
    statFilter === "active"
      ? claims.filter((c) => ACTIVE_STATUSES.includes(c.status))
      : statFilter === "attention"
        ? claims.filter((c) => c.status === "awaiting_info")
        : claims;

  const visibleClaims = statusFilter === "all" ? statFiltered : statFiltered.filter((c) => c.status === statusFilter);

  useEffect(() => {
    setPage(0);
  }, [statFilter, statusFilter, claims]);

  const pagedClaims = visibleClaims.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <section
        className="hero animate-fade-in-up"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1.5rem", flexWrap: "wrap", padding: "2rem 2.25rem" }}
      >
        <span className="hero-orb hero-orb--a" aria-hidden="true" />
        <span className="hero-orb hero-orb--b" aria-hidden="true" />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "560px" }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Claims</h1>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Every claim submitted through the portal — tracked from intake to decision, with AI-assisted triage and a human always in the loop.
          </p>
          <a
            href="/claims/new"
            className="transition btn-press"
            style={{
              alignSelf: "flex-start",
              marginTop: "0.5rem",
              padding: "0.6rem 1.2rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
              color: "var(--primary-contrast)",
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 2px 10px var(--primary-glow)",
            }}
          >
            Submit a Claim
          </a>
        </div>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: "0.9rem", flexShrink: 0 }}>
          <ShieldCheckIllustration className="float-icon" />
          <DocumentIllustration className="float-icon-delay" />
        </div>
      </section>

      <div
        className="stagger-list"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem" }}
      >
        <StatCard label="Total claims" value={totalClaims} icon="📄" active={statFilter === null} onClick={() => setStatFilter(null)} />
        <StatCard
          label="Active claims"
          value={activeClaims}
          icon="⏳"
          active={statFilter === "active"}
          onClick={() => setStatFilter((f) => (f === "active" ? null : "active"))}
        />
        <StatCard
          label="Total claimed value"
          value={totalValue}
          format={(n) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          icon="💰"
        />
        <StatCard
          label="Needs attention"
          value={needsAttention}
          icon="⚠"
          tone={needsAttention > 0 ? "attention" : undefined}
          active={statFilter === "attention"}
          onClick={() => setStatFilter((f) => (f === "attention" ? null : "attention"))}
        />
      </div>

      {statFilter && (
        <div className="animate-fade-in-up" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Showing: <strong style={{ color: "var(--text)" }}>{STAT_FILTER_LABEL[statFilter]}</strong>
          </span>
          <button
            onClick={() => setStatFilter(null)}
            className="transition"
            style={{ border: "none", background: "none", color: "var(--primary)", fontSize: "0.82rem", cursor: "pointer", fontWeight: 600 }}
          >
            Clear
          </button>
        </div>
      )}

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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ClaimStatus | "all")}
            aria-label="Filter by status"
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: "0.85rem",
            }}
          >
            <option value="all">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          {statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              className="transition"
              style={{ border: "none", background: "none", color: "var(--primary)", fontSize: "0.85rem", cursor: "pointer", fontWeight: 600 }}
            >
              Clear status
            </button>
          )}
        </div>
        <button
          onClick={() => void load(policyFilter)}
          disabled={state === "loading"}
          className="transition btn-press"
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

      {state === "loading" && <div className="skeleton" style={{ height: "260px" }} aria-busy="true" />}

      {state === "error" && (
        <div
          role="alert"
          className="animate-fade-in-up"
          style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}
        >
          {error}
        </div>
      )}

      {state === "loaded" && claims.length === 0 && (
        <EmptyState title="No claims yet" body="Nothing's been submitted yet — submit a claim to see it here." />
      )}

      {state === "loaded" && claims.length > 0 && visibleClaims.length === 0 && (
        <EmptyState
          title="Nothing matches this filter"
          body={
            statusFilter !== "all" && statFilter
              ? `No claims are both "${STAT_FILTER_LABEL[statFilter]}" and "${STATUS_META[statusFilter].label}".`
              : statusFilter !== "all"
                ? `No claims are currently "${STATUS_META[statusFilter].label}".`
                : `No claims are currently "${statFilter ? STAT_FILTER_LABEL[statFilter] : ""}".`
          }
        />
      )}

      {state === "loaded" && visibleClaims.length > 0 && (
        <ClaimTable claims={pagedClaims} page={page} pageSize={PAGE_SIZE} total={visibleClaims.length} onPageChange={setPage} />
      )}
    </main>
  );
}

/** Animates from 0 to `target` over ~600ms whenever `target` changes. Respects reduced-motion. */
function useCountUp(target: number, durationMs = 600) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let frame: number;
    function tick(now: number) {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}

function StatCard({
  label,
  value,
  icon,
  format = (n: number) => String(Math.round(n)),
  tone,
  onClick,
  active,
}: {
  label: string;
  value: number;
  icon: string;
  format?: (n: number) => string;
  tone?: "attention";
  onClick?: () => void;
  active?: boolean;
}) {
  const animated = useCountUp(value);
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      title={onClick ? `Filter claims: ${label}` : undefined}
      className="card-lift transition"
      style={{
        border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        background: active ? "var(--primary-soft)" : "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "0.9rem 1.1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        width: "100%",
        textAlign: "left",
        font: "inherit",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: "0.95rem" }}>{icon}</span>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.6rem",
          fontWeight: 600,
          color: tone === "attention" && value !== 0 ? "var(--status-attention-fg)" : "var(--text)",
        }}
      >
        {format(animated)}
      </span>
    </Wrapper>
  );
}
