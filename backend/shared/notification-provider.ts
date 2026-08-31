// SPEC.md §12 / CLAUDE.md: swappable interface, mock-only in v1 — no real
// email/SMS integration gets wired in until a future NotificationProvider
// implementation replaces mockNotificationProvider.
export interface NotificationProvider {
  send(claimId: string, decision: string): Promise<{ notificationSent: boolean }>;
}

export const mockNotificationProvider: NotificationProvider = {
  async send(claimId, decision) {
    console.log(`[mockNotificationProvider] claim ${claimId}: notifying claimant of decision "${decision}"`);
    return { notificationSent: true };
  },
};
