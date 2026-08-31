# Worker: `trigger-settlement`

**Status:** Draft

BUILD-PLAN.md feature #14. SPEC.md §12 job-worker contract (row 10). SPEC.md §10 step 15. ROADMAP.md step 4 (Job workers).

## Job type name

`trigger-settlement`

## Input variables

| Variable | Type | Source |
|---|---|---|
| `claimId` | string (uuid) | process instance variable |
| `claimAmount` | number | process instance variable, set at kickoff from `claims.claim_amount` |

## What it does

1. Calls `SettlementProvider.pay(claimId, claimAmount)` — a TypeScript interface defined in `backend/shared/` with one mock implementation in v1 (per SPEC.md §12's closing note; also CLAUDE.md's "swappable interfaces, mock only in v1" rule). The mock always succeeds and returns a fabricated settlement identifier.
2. Writes one `audit_log` row (`actor_type = 'system'`, `actor_id = 'trigger-settlement'`, `action = 'settlement_triggered'`, `detail` includes the returned `settlementId`) — SPEC.md §13.

Does not write anything to `claims` itself — `claims.status` is already `'approved'` from `capture-review-decision` (§10 step 13) or unchanged by the optional `capture-signoff` step; this worker's only durable side effect on the claim row, if any, is left to the interface implementation to decide (v1 mock: none — `settlementId` only flows onward as a process variable, not persisted to a `claims` column, since SPEC.md's data model has no such column today — flagged under Open Questions).

## Output variables

| Variable | Type | Meaning |
|---|---|---|
| `settlementId` | string | identifier returned by `SettlementProvider.pay()` (mock: a generated placeholder id) |

## Insurance-type aware?

No — settlement payout is type-agnostic (SPEC.md §12 closing note: only `validate-claim`, `extract-evidence`, `detect-fraud-indicators` are insurance-type aware).

## AI-backed?

No — calls the mocked `SettlementProvider`, no Gemini call.

## BPMN wiring (SPEC.md §10)

Reached from step 15's approved path, after the optional `Supervisor Sign-off` → `capture-signoff` branch (or directly, when no sign-off is required): **Service Task** `trigger-settlement` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Approved".

## Failure handling

No custom error boundary — an unhandled exception (including a failed `SettlementProvider.pay()` call, which the v1 mock never produces) falls back to Zeebe's default 3-attempt retry, then an Operate incident (SPEC.md §12, top note).

## Open Questions

- SPEC.md's data model (§9) has no column to persist `settlementId` onto the `claims` row — confirm whether one is needed (e.g. `claims.settlement_id`) before this is built, or whether the process-variable-only output is intentional for v1 (mirrors how `capture-signoff` writes no `claims` columns either, existing solely to satisfy the audit-trail rule).
- `SettlementProvider`'s exact interface shape (method signature, return type) isn't defined anywhere yet — needs to be authored in `backend/shared/` as part of this feature, alongside `NotificationProvider` (see `.claude/specs/worker/notify-claimant.md`), since neither exists today.
