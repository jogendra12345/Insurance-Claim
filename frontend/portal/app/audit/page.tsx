"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetchAllClaims, fetchClaimAuditLog, fetchPolicies } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ROLES } from "@/lib/types";
import type { ActorType, AuditLogEntry, Claim, ClaimStatus, Policy, PolicyStatus } from "@/lib/types";
import { STATUS_TONE } from "@/lib/policy-status";
import { STATUS_META } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";

type LoadState = "loading" | "loaded" | "error";

const ACTOR_TYPES: ActorType[] = ["system", "ai", "human"];

const ACTOR_LABEL: Record<ActorType, string> = {
  system: "System",
  ai: "AI",
  human: "Human",
};

function formatAction(action: string): string {
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function AuditPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policiesState, setPoliciesState] = useState<LoadState>("loading");
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [policyStatusFilter, setPolicyStatusFilter] = useState<PolicyStatus | "all">("all");

  // Loaded once up front (staff see every claim, unscoped) so the policy grid
  // can be filtered to "has at least one claim" and the claims grid can react
  // to a policy selection instantly, with no per-policy round trip.
  const [allClaims, setAllClaims] = useState<Claim[]>([]);
  const [claimsState, setClaimsState] = useState<LoadState>("loading");
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [claimStatusFilter, setClaimStatusFilter] = useState<ClaimStatus | "all">("all");

  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);

  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entriesState, setEntriesState] = useState<LoadState>("loading");
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [actorTypeFilter, setActorTypeFilter] = useState<ActorType | "all">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user || !STAFF_ROLES.includes(user.role)) {
      router.replace("/login");
      return;
    }
    setPoliciesState("loading");
    setPoliciesError(null);
    fetchPolicies()
      .then((data) => {
        setPolicies(data);
        setPoliciesState("loaded");
      })
      .catch((err) => {
        setPoliciesError(err instanceof ApiError ? err.message : "Couldn't load policies.");
        setPoliciesState("error");
      });

    setClaimsState("loading");
    setClaimsError(null);
    fetchAllClaims()
      .then((data) => {
        setAllClaims(data);
        setClaimsState("loaded");
      })
      .catch((err) => {
        setClaimsError(err instanceof ApiError ? err.message : "Couldn't load claims.");
        setClaimsState("error");
      });
  }, [authLoading, user, router]);

  useEffect(() => {
    setClaimStatusFilter("all");
  }, [selectedPolicy]);

  function loadAuditLog(claim: Claim, actorType: ActorType | "all", from: string, to: string) {
    setEntriesState("loading");
    setEntriesError(null);
    fetchClaimAuditLog(claim.id, {
      actorType: actorType === "all" ? undefined : actorType,
      from: from || undefined,
      to: to || undefined,
    })
      .then((data) => {
        setEntries(data);
        setEntriesState("loaded");
      })
      .catch((err) => {
        setEntriesError(err instanceof ApiError ? err.message : "Couldn't load that claim's audit history.");
        setEntriesState("error");
      });
  }

  function selectClaim(claim: Claim) {
    setSelectedClaim(claim);
    setActorTypeFilter("all");
    setFromDate("");
    setToDate("");
    loadAuditLog(claim, "all", "", "");
  }

  // Only policies with at least one claim raised against them show up in the
  // grid — a policy nobody has ever filed against has no audit trail to see.
  const policyIdsWithClaims = useMemo(() => new Set(allClaims.map((c) => c.policyId)), [allClaims]);

  const visiblePolicies = useMemo(() => {
    const withClaims = policies.filter((p) => policyIdsWithClaims.has(p.id));
    return policyStatusFilter === "all" ? withClaims : withClaims.filter((p) => p.status === policyStatusFilter);
  }, [policies, policyIdsWithClaims, policyStatusFilter]);

  const policyClaims = useMemo(
    () => (selectedPolicy ? allClaims.filter((c) => c.policyId === selectedPolicy.id) : []),
    [allClaims, selectedPolicy]
  );

  const visibleClaims = useMemo(
    () => (claimStatusFilter === "all" ? policyClaims : policyClaims.filter((c) => c.status === claimStatusFilter)),
    [policyClaims, claimStatusFilter]
  );

  if (authLoading || !user) {
    return null;
  }

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Audit trail</h1>
        <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>
          Pick a policy, then a claim, to see every step recorded against it — who acted, and when.
        </p>
      </div>

      {!selectedPolicy && (
        <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <FilterBar>
            <FilterSelect
              label="Status"
              value={policyStatusFilter}
              onChange={(v) => setPolicyStatusFilter(v as PolicyStatus | "all")}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "lapsed", label: "Lapsed" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />
          </FilterBar>

          {(policiesState === "loading" || claimsState === "loading") && (
            <div className="skeleton" style={{ height: "260px" }} aria-busy="true" />
          )}
          {policiesState === "error" && <ErrorBanner message={policiesError ?? "Something went wrong."} />}
          {claimsState === "error" && <ErrorBanner message={claimsError ?? "Something went wrong."} />}
          {policiesState === "loaded" && claimsState === "loaded" && visiblePolicies.length === 0 && (
            <EmptyState title="No policies with claims" body="Try a different status filter, or no claims have been raised yet." />
          )}
          {policiesState === "loaded" && claimsState === "loaded" && visiblePolicies.length > 0 && (
            <Grid>
              {visiblePolicies.map((policy) => {
                const tone = STATUS_TONE[policy.status];
                return (
                  <Card key={policy.id} onClick={() => setSelectedPolicy(policy)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{policy.policyNumber}</span>
                      <Pill bg={tone.bg} fg={tone.fg}>
                        {policy.status}
                      </Pill>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{policy.policyholderName}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", textTransform: "capitalize" }}>
                      {policy.insuranceType}
                    </div>
                  </Card>
                );
              })}
            </Grid>
          )}
        </section>
      )}

      {selectedPolicy && !selectedClaim && (
        <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <BackLink label="All policies" onClick={() => setSelectedPolicy(null)} />
          <h2 style={{ margin: 0, fontSize: "1.3rem" }}>
            {selectedPolicy.policyNumber} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>— {selectedPolicy.policyholderName}</span>
          </h2>

          <FilterBar>
            <FilterSelect
              label="Status"
              value={claimStatusFilter}
              onChange={(v) => setClaimStatusFilter(v as ClaimStatus | "all")}
              options={[
                { value: "all", label: "All statuses" },
                ...Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label })),
              ]}
            />
          </FilterBar>

          {visibleClaims.length === 0 && (
            <EmptyState title="No claims match" body="Try a different status filter, or this policy has no claims yet." />
          )}
          {visibleClaims.length > 0 && (
            <Grid>
              {visibleClaims.map((claim) => {
                const meta = STATUS_META[claim.status];
                return (
                  <Card key={claim.id} onClick={() => selectClaim(claim)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
                      <span style={{ fontWeight: 600 }}>{claim.claimantName}</span>
                      <Pill bg={meta.bg} fg={meta.fg}>
                        {meta.label}
                      </Pill>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                      {new Date(claim.createdAt).toLocaleDateString()} · {claim.claimType}
                    </div>
                  </Card>
                );
              })}
            </Grid>
          )}
        </section>
      )}

      {selectedClaim && (
        <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <BackLink label={`Claims for ${selectedPolicy?.policyNumber}`} onClick={() => setSelectedClaim(null)} />
          <h2 style={{ margin: 0, fontSize: "1.3rem" }}>{selectedClaim.claimantName}'s claim history</h2>

          <FilterBar>
            <FilterSelect
              label="Actor"
              value={actorTypeFilter}
              onChange={(v) => {
                const next = v as ActorType | "all";
                setActorTypeFilter(next);
                loadAuditLog(selectedClaim, next, fromDate, toDate);
              }}
              options={[{ value: "all", label: "All actors" }, ...ACTOR_TYPES.map((a) => ({ value: a, label: ACTOR_LABEL[a] }))]}
            />
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  loadAuditLog(selectedClaim, actorTypeFilter, e.target.value, toDate);
                }}
                style={dateInputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>To</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  loadAuditLog(selectedClaim, actorTypeFilter, fromDate, e.target.value);
                }}
                style={dateInputStyle}
              />
            </label>
            {(actorTypeFilter !== "all" || fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setActorTypeFilter("all");
                  setFromDate("");
                  setToDate("");
                  loadAuditLog(selectedClaim, "all", "", "");
                }}
                className="transition"
                style={{ alignSelf: "flex-end", background: "none", border: "none", color: "var(--primary)", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", padding: "0.4rem 0" }}
              >
                Clear filters
              </button>
            )}
          </FilterBar>

          {entriesState === "loading" && <div className="skeleton" style={{ height: "260px" }} aria-busy="true" />}
          {entriesState === "error" && <ErrorBanner message={entriesError ?? "Something went wrong."} />}
          {entriesState === "loaded" && entries.length === 0 && (
            <EmptyState title="No matching history" body="No audit entries match these filters." />
          )}
          {entriesState === "loaded" && entries.length > 0 && (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="animate-fade-in-up"
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--surface)",
                    boxShadow: "var(--shadow-card)",
                    padding: "0.9rem 1.1rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.3rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{formatAction(entry.action)}</span>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    {ACTOR_LABEL[entry.actorType]}
                    {entry.actorId ? ` · ${entry.actorId}` : ""}
                  </div>
                  {entry.detail && Object.keys(entry.detail).length > 0 && (
                    <dl style={{ margin: "0.35rem 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.15rem 0.6rem", fontSize: "0.8rem" }}>
                      {Object.entries(entry.detail).map(([key, value]) => (
                        <div key={key} style={{ display: "contents" }}>
                          <dt style={{ color: "var(--text-muted)" }}>{key}</dt>
                          <dd style={{ margin: 0, color: "var(--text)", wordBreak: "break-word" }}>
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </main>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="stagger-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0.9rem" }}>
      {children}
    </div>
  );
}

function Card({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      role="link"
      tabIndex={0}
      className="row-hover transition"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "1rem 1.1rem",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
      }}
    >
      {children}
    </div>
  );
}

function Pill({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <span
      style={{
        fontSize: "0.72rem",
        fontWeight: 600,
        padding: "0.15em 0.6em",
        borderRadius: "999px",
        background: bg,
        color: fg,
        textTransform: "capitalize",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition"
      style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--primary)", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", padding: 0 }}
    >
      ← {label}
    </button>
  );
}

function FilterBar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>{children}</div>;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {label && <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={dateInputStyle}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
      {message}
    </div>
  );
}

const dateInputStyle: React.CSSProperties = {
  padding: "0.5rem 0.65rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};
