import type { ClaimStatus } from "@/lib/types";

// Per the locked spec: color-coding must not be the only signal, so every
// status also gets a distinct label and a leading glyph. `stage` (1-3) also
// drives the progress indicator in ClaimCard: Submitted -> In review -> Decision.
export const STATUS_META: Record<
  ClaimStatus,
  { label: string; glyph: string; bg: string; fg: string; stage: 1 | 2 | 3 }
> = {
  submitted: { label: "Submitted", glyph: "○", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)", stage: 1 },
  validating: { label: "Validating", glyph: "○", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)", stage: 1 },
  triage: { label: "In triage", glyph: "◐", bg: "var(--status-progress-bg)", fg: "var(--status-progress-fg)", stage: 2 },
  in_review: { label: "Under review", glyph: "◐", bg: "var(--status-progress-bg)", fg: "var(--status-progress-fg)", stage: 2 },
  awaiting_info: { label: "Action needed", glyph: "!", bg: "var(--status-attention-bg)", fg: "var(--status-attention-fg)", stage: 2 },
  approved: { label: "Approved", glyph: "✓", bg: "var(--status-good-bg)", fg: "var(--status-good-fg)", stage: 3 },
  denied: { label: "Denied", glyph: "✕", bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)", stage: 3 },
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const meta = STATUS_META[status];
  const inProgress = meta.stage === 2;
  return (
    <span
      className="animate-pop"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35em",
        padding: "0.25em 0.7em",
        borderRadius: "999px",
        fontSize: "0.78rem",
        fontWeight: 600,
        background: meta.bg,
        color: meta.fg,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" className={inProgress ? "pulse-dot" : undefined}>
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  );
}
