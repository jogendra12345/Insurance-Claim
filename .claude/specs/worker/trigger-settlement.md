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

1. Calls `SettlementProvider.pay(claimId, claimAmount)`:
   ```ts
   interface SettlementProvider {
     pay(claimId: string, claimAmount: number): Promise<{ settlementId: string }>;
   }
   ```
   Defined in `backend/shared/` with one mock implementation in v1 (per SPEC.md §12's closing note; also CLAUDE.md's "swappable interfaces, mock only in v1" rule). The mock always succeeds and returns a fabricated settlement identifier.
2. Writes `claims.settlement_id = settlementId` (new nullable text column — see Data model note below).
3. Writes one `audit_log` row (`actor_type = 'system'`, `actor_id = 'trigger-settlement'`, `action = 'settlement_triggered'`, `detail` includes the returned `settlementId`) — SPEC.md §13.

`claims.status` is already `'approved'` from `capture-review-decision` (§10 step 13) and is unchanged by this worker or the optional `capture-signoff` step.

### Data model note

SPEC.md §9 has no `settlement_id` column today. This spec locks in adding one: `claims.settlement_id text NULL`, set only on the approved path once `trigger-settlement` runs. Formalized in `.claude/specs/db/resolution_worker_fields.md` (migration `0009_add_resolution_worker_fields.sql`); needs a SPEC.md §9 update before/alongside implementation.

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

Resolved:
- ~~Persist `settlementId` onto `claims`?~~ Yes — `claims.settlement_id`, see Data model note above.
- ~~`SettlementProvider` interface shape?~~ Locked in as `pay(claimId, claimAmount) -> Promise<{ settlementId: string }>`, see above.
