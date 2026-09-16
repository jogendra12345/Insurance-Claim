// Duplicated from frontend/portal/lib/claim-id.ts — backend and frontend
// are separately-deployed apps with no shared build today, so this one-line
// formatter is copied rather than moved (decided at Lock,
// .claude/specs/generic/claims-assistant.md Open Question 2).

/** Short, stable reference shown to users — the full uuid stays the real id/lookup key. */
export function shortClaimId(id: string) {
  return `#${id.slice(0, 8)}`;
}
