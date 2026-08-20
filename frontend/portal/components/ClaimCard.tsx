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

const STAGE_COUNT = 3;

function ProgressStepper({ stage, status }: { stage: 1 | 2 | 3; status: Claim["status"] }) {
  const isBad = status === "denied";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }} aria-hidden="true">
      {Array.from({ length: STAGE_COUNT }, (_, i) => {
        const idx = i + 1;
        const filled = idx <= stage;
        const color = filled ? (isBad && idx === 3 ? "var(--status-bad-fg)" : "var(--primary)") : "var(--border)";
        return <span key={i} style={{ height: "4px", flex: 1, borderRadius: "999px", background: color }} />;
      })}
    </div>
  );
}

export function ClaimCard({ claim }: { claim: Claim }) {
  const meta = STATUS_META[claim.status];

  return (
    <a
      href={`/claims/${claim.id}`}
      className="transition"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.7rem",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "1.1rem 1.25rem",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: "1rem" }}>{CLAIM_TYPE_LABEL[claim.claimType]} claim</span>
          <span
            style={{ fontSize: "0.78rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={absoluteDate(claim.createdAt)}
          >
            {claim.policyNumber} · {claim.claimantName}
          </span>
        </div>
        <StatusBadge status={claim.status} />
      </div>

      <ProgressStepper stage={meta.stage} status={claim.status} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.85rem", color: "var(--text-muted)" }}>
        <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums", fontSize: "1rem" }}>
          {claim.claimAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}
        </strong>
        <span>{relativeTime(claim.createdAt)}</span>
      </div>
    </a>
  );
}
