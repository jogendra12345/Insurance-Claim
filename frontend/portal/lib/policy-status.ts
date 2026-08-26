import type { PolicyStatus } from "./types";

export const STATUS_TONE: Record<PolicyStatus, { bg: string; fg: string }> = {
  active: { bg: "var(--status-good-bg)", fg: "var(--status-good-fg)" },
  lapsed: { bg: "var(--status-attention-bg)", fg: "var(--status-attention-fg)" },
  cancelled: { bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)" },
};
