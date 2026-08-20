"use client";

import { useState } from "react";
import type { Claim } from "@/lib/types";
import { STATUS_META, StatusBadge } from "./StatusBadge";
import { absoluteDate, relativeTime } from "@/lib/time";

const CLAIM_TYPE_LABEL: Record<Claim["claimType"], string> = {
  outpatient: "Outpatient",
  inpatient: "Inpatient",
  pharmacy: "Pharmacy",
  dental: "Dental",
  maternity: "Maternity",
  other: "Other",
};

const STAGE_LABELS = ["Submitted", "In review", "Decision"];

function ProgressStepper({ stage, status }: { stage: 1 | 2 | 3; status: Claim["status"] }) {
  const isBad = status === "denied";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }} aria-hidden="true">
      {STAGE_LABELS.map((_, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const filled = idx <= stage;
        const color = filled ? (isBad && idx === 3 ? "var(--status-bad-fg)" : "var(--primary)") : "var(--border)";
        return (
          <span
            key={i}
            style={{
              height: "4px",
              width: "22px",
              borderRadius: "999px",
              background: color,
            }}
          />
        );
      })}
    </div>
  );
}

export function ClaimCard({ claim }: { claim: Claim }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[claim.status];

  return (
    <div
      className="transition"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
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
          padding: "1.1rem 1.35rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.65rem",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <span style={{ fontWeight: 600, fontSize: "1.02rem" }}>
              {CLAIM_TYPE_LABEL[claim.claimType]} claim
            </span>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }} title={absoluteDate(claim.createdAt)}>
              {claim.policyNumber} · Filed {relativeTime(claim.createdAt)}
            </span>
          </div>
          <StatusBadge status={claim.status} />
        </div>

        <ProgressStepper stage={meta.stage} status={claim.status} />

        <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
          <span>
            <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
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
            padding: "1rem 1.35rem",
            background: "var(--surface-2)",
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
