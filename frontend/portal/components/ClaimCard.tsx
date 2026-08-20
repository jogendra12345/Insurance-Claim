"use client";

import { useState } from "react";
import type { Claim } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { absoluteDate, relativeTime } from "@/lib/time";

const CLAIM_TYPE_LABEL: Record<Claim["claimType"], string> = {
  outpatient: "Outpatient",
  inpatient: "Inpatient",
  pharmacy: "Pharmacy",
  dental: "Dental",
  maternity: "Maternity",
  other: "Other",
};

export function ClaimCard({ claim }: { claim: Claim }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "12px",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "1rem 1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            <span style={{ fontWeight: 600 }}>
              {CLAIM_TYPE_LABEL[claim.claimType]} claim · {claim.policyNumber}
            </span>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Filed {relativeTime(claim.createdAt)}
              <span title={absoluteDate(claim.createdAt)}> · {absoluteDate(claim.createdAt)}</span>
            </span>
          </div>
          <StatusBadge status={claim.status} />
        </div>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
          <span>
            Amount: <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {claim.claimAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}
            </strong>
          </span>
          <span>Incident: {new Date(claim.incidentDate).toLocaleDateString()}</span>
        </div>
      </button>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "1rem 1.25rem",
            background: "var(--surface-muted)",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            fontSize: "0.9rem",
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>Summary: </strong>
            {claim.caseSummary ?? "Not yet available — an automated review is still in progress."}
          </p>
          {claim.confirmedRole && (
            <p style={{ margin: 0, color: "var(--text-muted)" }}>Being handled by: {claim.confirmedRole}</p>
          )}
          {claim.status === "denied" && claim.denialReason && (
            <p style={{ margin: 0, color: "var(--status-bad-fg)" }}>Reason: {claim.denialReason}</p>
          )}
          <p style={{ margin: 0, color: "var(--text-muted)", fontStyle: "italic" }}>
            A full step-by-step history isn&apos;t available yet — that&apos;s tracked as a follow-up in the
            portal&apos;s spec.
          </p>
        </div>
      )}
    </div>
  );
}
