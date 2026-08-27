"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, fetchActiveClaimsByPolicy, fetchPolicy } from "@/lib/api";
import type { Claim, DependentRelationship, Policy } from "@/lib/types";
import { STATUS_TONE } from "@/lib/policy-status";
import { relativeTime, absoluteDate } from "@/lib/time";

const CLAIM_TYPE_LABEL: Record<Claim["claimType"], string> = {
  outpatient: "Outpatient",
  inpatient: "Inpatient",
  pharmacy: "Pharmacy",
  dental: "Dental",
  maternity: "Maternity",
  other: "Other",
};

const DEPENDENT_RELATIONSHIP_LABEL: Record<DependentRelationship, string> = {
  spouse: "Spouse",
  child: "Child",
  other: "Other",
};

type LoadState = "loading" | "loaded" | "error";

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function shortClaimId(id: string) {
  return `#${id.slice(0, 8)}`;
}

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    fetchPolicy(params.id)
      .then(async (match) => {
        if (!cancelled) setPolicy(match);
        const claimsForPolicy = await fetchActiveClaimsByPolicy(match.policyNumber);
        if (!cancelled) {
          setClaims(claimsForPolicy);
          setState("loaded");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't load this policy.");
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
      <a href="/policies" className="transition" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>
        ← Back to policies
      </a>

      {state === "loading" && <div className="skeleton" style={{ marginTop: "1.5rem", height: "280px" }} aria-busy="true" />}

      {state === "error" && (
        <div role="alert" className="animate-fade-in-up" style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && policy && (
        <div className="animate-fade-in-up stagger-list" style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: "1.6rem" }}>{policy.policyNumber}</h1>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.25em 0.7em",
                    borderRadius: "999px",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    background: STATUS_TONE[policy.status].bg,
                    color: STATUS_TONE[policy.status].fg,
                  }}
                >
                  {policy.status}
                </span>
              </div>
              <span style={{ fontFamily: MONO_FONT, fontSize: "0.8rem", color: "var(--text-muted)" }}>{policy.id}</span>
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.75rem",
            }}
          >
            <StatCard label="Coverage amount" value={currency(policy.coverageAmount)} sub="Maximum payout" />
            <StatCard label="Premium amount" value={currency(policy.premiumAmount)} sub="Per policy term" />
            <StatCard label="Claims filed" value={String(claims.length)} sub="Against this policy" />
            <StatCard label="Expires" value={new Date(policy.expiryDate).toLocaleDateString()} sub="Policy expiry date" />
          </div>

          <Section title="Policyholder & coverage" icon={<FileTextIcon />}>
            <div className="detail-rows">
              <DetailRow label="Policyholder" value={policy.policyholderName} />
              <DetailRow label="Policyholder email" value={policy.policyholderEmail} />
              <DetailRow label="Insurance type" value={policy.insuranceType} />
              <DetailRow label="Effective date" value={new Date(policy.effectiveDate).toLocaleDateString()} />
              <DetailRow label="Expiry date" value={new Date(policy.expiryDate).toLocaleDateString()} />
            </div>
          </Section>

          <Section title={`Dependents (${policy.dependents?.length ?? 0})`} icon={<UsersIcon />}>
            {!policy.dependents || policy.dependents.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted)" }}>
                No dependents on file — only the policyholder can file claims against this policy.
              </p>
            ) : (
              <div className="detail-rows">
                {policy.dependents.map((dependent) => (
                  <div key={dependent.id} style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", fontSize: "0.9rem" }}>
                    <span style={{ fontWeight: 500 }}>{dependent.fullName}</span>
                    <span style={{ textAlign: "right", color: "var(--text-muted)" }}>
                      {DEPENDENT_RELATIONSHIP_LABEL[dependent.relationship]} · {dependent.email}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

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
                gap: "0.5rem",
                padding: "0.75rem 1.25rem",
                background: "var(--surface-2)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ color: "var(--primary)", display: "inline-flex" }}>
                <GavelIcon />
              </span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Claims ({claims.length})</span>
            </div>

            {claims.length === 0 ? (
              <p style={{ margin: 0, padding: "1.1rem 1.25rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                No claims have been filed against this policy.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "25%" }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <Th>Claim ID</Th>
                    <Th>Type</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Date</Th>
                  </tr>
                </thead>
                <tbody className="stagger-list">
                  {claims.map((claim) => {
                    const goTo = () => router.push(`/claims/${claim.id}`);
                    return (
                      <tr
                        key={claim.id}
                        onClick={goTo}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") goTo();
                        }}
                        role="link"
                        tabIndex={0}
                        className="transition row-hover"
                        style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                      >
                        <Td muted>
                          <span title={claim.id} style={{ fontFamily: MONO_FONT, fontSize: "0.82rem" }}>
                            {shortClaimId(claim.id)}
                          </span>
                        </Td>
                        <Td>{CLAIM_TYPE_LABEL[claim.claimType]}</Td>
                        <Td align="right">
                          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{currency(claim.claimAmount)}</span>
                        </Td>
                        <Td align="right" muted>
                          <span title={absoluteDate(claim.createdAt)}>{relativeTime(claim.createdAt)}</span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
      <span style={{ fontSize: "1.3rem", fontFamily: "var(--font-display)", letterSpacing: "-0.01em", color: "var(--text)" }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{sub}</span>}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
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
          gap: "0.5rem",
          padding: "0.75rem 1.25rem",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {icon && <span style={{ color: "var(--primary)", display: "inline-flex" }}>{icon}</span>}
        <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{ padding: "1.1rem 1.25rem" }}>{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", fontSize: "0.9rem" }}>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "0.75rem 1rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align, muted }: { children: React.ReactNode; align?: "right"; muted?: boolean }) {
  return (
    <td style={{ textAlign: align ?? "left", padding: "0.75rem 1rem", color: muted ? "var(--text-muted)" : "var(--text)" }}>
      {children}
    </td>
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

function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        stroke="currentColor"
        strokeWidth="1.8"
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
