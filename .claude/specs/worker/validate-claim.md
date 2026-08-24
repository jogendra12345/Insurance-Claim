# Worker: `validate-claim`

**Status:** Draft

BUILD-PLAN.md feature #5. SPEC.md §12 job-worker contract (row 1). SPEC.md §10 step 2/3. ROADMAP.md step 4 (Job workers).

## Job type name

`validate-claim`

## Input variables

| Variable | Type | Source |
|---|---|---|
| `insuranceType` | string | process instance variable, set at kickoff from `claims.insurance_type` |
| `carrierId` | string (uuid) | process instance variable, set at kickoff from `claims.carrier_id` |
| `policyNumber` | string | process instance variable, set at kickoff from `claims.policy_number` |
| `claimAmount` | number | process instance variable, set at kickoff from `claims.claim_amount` |
| `incidentDate` | date | not carried as a top-level process variable today — worker reads it from `claims.incident_date` via `claimId` (see Open Questions) |

`claimId` itself is also required as an input to look up the claim row, even though SPEC.md §12's table doesn't list it explicitly for this worker — every other worker in that table takes `claimId`, and this one needs it to write `claims.policy_id` and the audit_log row.

## What it does

1. Loads the insurance-type config for `insuranceType` from `backend/shared/insurance-types/<insuranceType>.ts` (v1: `health.ts` only, per SPEC.md §3).
2. **Required-field check** — confirms every field the type config marks required is present and non-empty on the claim (health: at minimum `claimantName`, `claimantEmail`, `incidentDate`, `incidentDescription`, `claimAmount`, `policyNumber` — exact list owned by the config module, not hardcoded in the worker).
3. **Policy check** — queries `SELECT * FROM policies WHERE policy_number = $1 AND carrier_id = $2`. On no match, or a match that fails either sub-check below, validation fails:
   - `status = 'active'`
   - `incidentDate` falls within `[effective_date, expiry_date]` inclusive
4. On a passing policy match, sets `claims.policy_id` to the matched policy's `id`.
5. Writes one `audit_log` row (`actor_type = 'system'`, `actor_id = 'validate-claim'`, `action = 'validated'`, `detail` = which checks passed/failed) regardless of outcome — SPEC.md §13.

## Output variables

| Variable | Type | Meaning |
|---|---|---|
| `validationPassed` | boolean | `true` only if both the required-field check and the policy check pass |
| `policyId` | string (uuid), nullable | the matched `policies.id`, or `null` if no match/validation failed |

## Insurance-type aware?

Yes — the required-field list comes from `backend/shared/insurance-types/<insuranceType>.ts` (SPEC.md §3). The policy check itself is type-agnostic (same `policies` table shape for every type).

## AI-backed?

No — deterministic checks only, no Claude call.

## BPMN wiring (SPEC.md §10)

Called from step 2 (**Service Task** `validate-claim`), immediately after the Start Event. Its `validationPassed` output feeds the step 3 **Exclusive Gateway** `Validation Passed?`:
- `false` → **User Task** `Validation Exception Review` (candidate group `triage-team`)
- `true` (default) → step 4 (`extract-evidence`)

## Failure handling

No custom error boundary — an unhandled exception in the worker falls back to Zeebe's default 3-attempt retry, then an Operate incident (SPEC.md §12, top note). A *validation failure* (required field missing, no policy match) is not an exception — it's the normal `validationPassed = false` path, handled by the gateway above, not a retry/incident.

## Open Questions

- Does `incidentDate` need to be added as an explicit process-instance variable at kickoff (alongside `claimId`, `carrierId`, `insuranceType`, `policyNumber`, `claimType`, `claimAmount` per SPEC.md §10), or is it acceptable for this worker to be the first to read it straight from `claims` via `claimId`? Every other worker in §12 takes `claimId` as an input and reads what it needs from Postgres, so reading `incident_date` the same way is likely consistent — but SPEC.md §10's kickoff variable list doesn't mention `claimId` explicitly either, only the six listed. Worth confirming the kickoff variable list is complete before implementing.
- Exact required-field list for `health.ts` isn't specified anywhere yet (SPEC.md §3 gestures at "required fields, expected document types" but doesn't enumerate them) — needs to be defined when `backend/shared/insurance-types/health.ts` is built, likely as part of this same feature since it doesn't exist yet.
