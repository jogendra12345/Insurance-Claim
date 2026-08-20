"use client";

import { useRouter } from "next/navigation";
import type { Claim } from "@/lib/types";
import { STATUS_META, StatusBadge } from "./StatusBadge";
import { relativeTime, absoluteDate } from "@/lib/time";

const CLAIM_TYPE_LABEL: Record<Claim["claimType"], string> = {
  outpatient: "Outpatient",
  inpatient: "Inpatient",
  pharmacy: "Pharmacy",
  dental: "Dental",
  maternity: "Maternity",
  other: "Other",
};

function ProgressStepper({ stage, status }: { stage: 1 | 2 | 3; status: Claim["status"] }) {
  const isBad = status === "denied";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", width: "72px" }} aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => {
        const idx = i + 1;
        const filled = idx <= stage;
        const color = filled ? (isBad && idx === 3 ? "var(--status-bad-fg)" : "var(--primary)") : "var(--border)";
        return <span key={i} style={{ height: "4px", flex: 1, borderRadius: "999px", background: color }} />;
      })}
    </div>
  );
}

export function ClaimTable({ claims }: { claims: Claim[] }) {
  const router = useRouter();

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        overflowX: "auto",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <Th>Claim</Th>
            <Th>Status</Th>
            <Th>Progress</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Filed</Th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => {
            const meta = STATUS_META[claim.status];
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
                className="transition"
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
              >
                <Td>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                    <span style={{ fontWeight: 600 }}>{CLAIM_TYPE_LABEL[claim.claimType]}</span>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      {claim.policyNumber} · {claim.claimantName}
                    </span>
                  </div>
                </Td>
                <Td>
                  <StatusBadge status={claim.status} />
                </Td>
                <Td>
                  <ProgressStepper stage={meta.stage} status={claim.status} />
                </Td>
                <Td align="right">
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {claim.claimAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                  </span>
                </Td>
                <Td align="right" muted>
                  <span title={absoluteDate(claim.createdAt)}>{relativeTime(claim.createdAt)}</span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
