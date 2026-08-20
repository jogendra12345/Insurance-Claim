import type { ClaimStatus } from "@/lib/types";

// Per the locked spec: color-coding must not be the only signal, so every
// status also gets a distinct label and a leading glyph.
const STATUS_META: Record<ClaimStatus, { label: string; glyph: string; bg: string; fg: string }> = {
  submitted: { label: "Submitted", glyph: "○", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)" },
  validating: { label: "Validating", glyph: "○", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)" },
  triage: { label: "In triage", glyph: "◐", bg: "var(--status-progress-bg)", fg: "var(--status-progress-fg)" },
  in_review: { label: "Under review", glyph: "◐", bg: "var(--status-progress-bg)", fg: "var(--status-progress-fg)" },
  awaiting_info: { label: "Action needed", glyph: "!", bg: "var(--status-attention-bg)", fg: "var(--status-attention-fg)" },
  approved: { label: "Approved", glyph: "✓", bg: "var(--status-good-bg)", fg: "var(--status-good-fg)" },
  denied: { label: "Denied", glyph: "✕", bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)" },
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35em",
        padding: "0.2em 0.65em",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        background: meta.bg,
        color: meta.fg,
      }}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  );
}
