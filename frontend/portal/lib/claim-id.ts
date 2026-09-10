/** Short, stable reference shown to users — the full uuid stays the real id/lookup key (title/href target). */
export function shortClaimId(id: string) {
  return `#${id.slice(0, 8)}`;
}
