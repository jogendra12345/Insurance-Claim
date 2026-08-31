# Worker: `notify-claimant`

**Status:** Draft

BUILD-PLAN.md feature #16. SPEC.md §12 job-worker contract (row 12). SPEC.md §10 steps 15–16. ROADMAP.md step 4 (Job workers).

## Job type name

`notify-claimant`

## Input variables

| Variable | Type | Source |
|---|---|---|
| `claimId` | string (uuid) | process instance variable |
| `decision` | string (`approve` \| `deny`) | process instance variable, set by `capture-review-decision` or, for the triage-reject/validation-exception-reject paths, the equivalent `deny` value written by `capture-triage-review`/`capture-validation-exception` |

## What it does

1. Calls `NotificationProvider.send(claimId, decision, ...)` — a TypeScript interface defined in `backend/shared/` with one mock implementation in v1 (SPEC.md §12 closing note; CLAUDE.md's "swappable interfaces, mock only in v1" rule). The mock logs instead of actually sending (e.g. no real email/SMS integration).
2. Runs on both the approved path (after `trigger-settlement`) and the denied path (after `draft-denial-letter`) — same worker, same job type, different upstream context feeding `decision`.
3. Writes one `audit_log` row (`actor_type = 'system'`, `actor_id = 'notify-claimant'`, `action = 'claimant_notified'`, `detail` includes the decision and notification outcome) — SPEC.md §13.

## Output variables

| Variable | Type | Meaning |
|---|---|---|
| `notificationSent` | boolean | `true` if `NotificationProvider.send()` completed without error (mock: always `true`) |

## Insurance-type aware?

No — not listed among the insurance-type-aware workers in SPEC.md §12's closing note.

## AI-backed?

No — calls the mocked `NotificationProvider`, no Gemini call.

## BPMN wiring (SPEC.md §10)

Two incoming paths converge on this same **Service Task**:
- Approved path (step 15): `trigger-settlement` → `notify-claimant` → `close-case` → **End Event** "Claim Approved"
- Denied path (step 16): `draft-denial-letter` → `notify-claimant` → `close-case` → **End Event** "Claim Denied"

## Failure handling

No custom error boundary — an unhandled exception (including a failed `NotificationProvider.send()` call, which the v1 mock never produces) falls back to Zeebe's default 3-attempt retry, then an Operate incident (SPEC.md §12, top note).

## Open Questions

- `NotificationProvider`'s exact interface shape (method signature — what it needs beyond `claimId`/`decision`, e.g. claimant contact info, letter text for the deny path) isn't defined anywhere yet — needs to be authored in `backend/shared/` as part of this feature, alongside `SettlementProvider` (see `.claude/specs/worker/trigger-settlement.md`), since neither exists today.
- On the deny path, does `notify-claimant` need `denialLetterText` as an additional input (to actually include letter content in the mock "send"), or is a bare decision notification sufficient for v1? SPEC.md §12's input-variable column for this worker lists only `claimId`, `decision` — worth confirming that's complete before implementing.
