import { randomUUID } from "node:crypto";

// SPEC.md §12 / CLAUDE.md: swappable interface, mock-only in v1 — no real
// payment integration gets wired in until a future SettlementProvider
// implementation replaces mockSettlementProvider.
export interface SettlementProvider {
  pay(claimId: string, claimAmount: number): Promise<{ settlementId: string }>;
}

export const mockSettlementProvider: SettlementProvider = {
  async pay(_claimId, _claimAmount) {
    return { settlementId: `mock-settlement-${randomUUID()}` };
  },
};
