# Worker: `close-case`

**Status:** Draft

BUILD-PLAN.md feature #17. SPEC.md §12 job-worker contract (row 13). SPEC.md §10 steps 15–16, and the note directly below step 16. ROADMAP.md step 4 (Job workers).

## Job type name

`close-case`

## Input variables

| Variable | Type | Source |
|---|---|---|
| `claimId` | string (uuid) | process instance variable |
| `decision` | string (`approve` \| `deny`) | process instance variable — same value `notify-claimant` just consumed |

## What it does

1. Writes `claims.status` to the value implied by `decision` (`approve → 'approved'`, `deny → 'denied'`). Per SPEC.md's note directly under §10 step 16: by the time this worker runs, `capture-review-decision` (or `capture-triage-review`'s/`capture-validation-exception`'s reject branch) has **already** set the same status — this write is a confirming/idempotent write, not the sole writer. It exists so the process's terminal state is explicitly re-asserted at close, independent of trusting the earlier write held.
2. Writes one `audit_log` row (`actor_type = 'system'`, `actor_id = 'close-case'`, `action = 'case_closed'`, `detail` = final decision/status) — SPEC.md §13. This is the last audit_log row in the claim's lifecycle under `/case-trace`.

## Output variables

None — SPEC.md §12's row for this worker lists no output variables.

## Insurance-type aware?

No — not listed among the insurance-type-aware workers in SPEC.md §12's closing note.

## AI-backed?

No — deterministic status write, no Gemini call.

## BPMN wiring (SPEC.md §10)

Terminal service task on both branches:
- Approved path (step 15): `trigger-settlement` → `notify-claimant` → `close-case` → **End Event** "Claim Approved"
- Denied path (step 16): `draft-denial-letter` → `notify-claimant` → `close-case` → **End Event** "Claim Denied"

## Failure handling

No custom error boundary — an unhandled exception falls back to Zeebe's default 3-attempt retry, then an Operate incident (SPEC.md §12, top note). Because the status write is idempotent against what `capture-review-decision`/`capture-triage-review`/`capture-validation-exception` already set, a retry after a partial failure (e.g. audit_log write succeeded but the process crashed before completing the job) is safe to re-run in full.

## Open Questions

- None of the `moreInfo` path's variables reach this worker — step 14's `Exclusive Gateway Decision` routes `decision = "moreInfo"` straight to the terminal **End Event** "Awaiting More Information" (§10 step 14, §14 future work), bypassing `draft-denial-letter`/`notify-claimant`/`close-case` entirely. Confirm that's intentional (i.e. `close-case` is never expected to see `decision = "moreInfo"` as an input) before implementing, since the worker's status-mapping logic above only needs to handle `approve`/`deny`.
