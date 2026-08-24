# DB: fnol_extended_fields

**Status:** Locked

> Locked 2026-08-24. Open Questions resolved:
> 1. **`claim_amount` vs. `total_billed_amount`:** `claim_amount` stays authoritative for everything already wired to it (BPMN kickoff, `validate-claim`'s coverage check, `score-risk`, `trigger-settlement`, the DMN legal threshold). `total_billed_amount` is stored as informational context only in this pass — **not** added to any worker's input variables. Wiring it into `score-risk`/`detect-fraud-indicators` as a fraud/anomaly signal is explicitly deferred to a future `worker`-type spec, not done here.
> 2. **Find-or-create-by-NPI collision:** on a match, **reuse the existing `providers` row as-is** — a newly submitted `facility_name`/`facility_address`/`tax_id` for an NPI already on file is discarded, not written. Chosen over overwrite-on-conflict because letting one claimant's typed data silently rewrite another claimant's already-established provider record is the riskier default; reject-on-mismatch was also considered but adds a failure mode with no clear recovery path for the claimant. `providers.updated_at` therefore never changes after insert in this pass — revisit if a real provider-data-correction workflow is needed later.
> 3. **`service_date_to`:** resolved by the companion UI spec — shown/required only for `inpatient`/`maternity` claim types; the app sets it equal to `service_date_from` otherwise, so it's effectively never NULL in practice.

Extends FNOL (First Notice of Loss / claim intake) capture with the standard health-claim fields currently missing from `claims`: diagnosis code (ICD-10), procedure code (CPT/HCPCS), provider NPI, provider tax ID, facility name/address, date(s) of service, total billed amount, coordination-of-benefits flag, and claimant attestation timestamp. Companion spec `.claude/specs/generic/fnol_form_ui_update.md` covers the matching `ClaimForm` changes — field names must match exactly between the two.

## Purpose

Today's `claims` table (SPEC.md §9) captures only what's needed to route and pay a claim (`claim_type`, `claim_amount`, `incident_date`/`incident_description`), not the line-item detail a real health claim (CMS-1500-style) carries: what was diagnosed, what procedure was billed for it, who the treating provider was, and when service was rendered. This spec adds that detail as intake-time fields, captured directly on the `ClaimForm` (not derived by `extract-evidence`, which isn't built yet and reads *uploaded documents* — this is claimant-entered structured data at submission time, same tier as `incident_description` today).

### Design decision: new `providers` table, not flattened onto `claims`

Recommendation: **split provider/facility identity (NPI, tax ID, facility name, facility address) into a new `providers` table**, referenced from `claims` via `provider_id`. Diagnosis code, procedure code, service dates, total billed amount, COB flag, and attestation timestamp **stay flat on `claims`**. Reasoning:

- **Provider identity is an entity that recurs across claims; the rest of the FNOL fields don't.** The same doctor/facility (same NPI) submits many claims over time across many claimants. Diagnosis code, procedure code, service dates, billed amount, COB, and attestation are all specific to *this one claim* and are never shared with another row — there's no dedup argument for splitting them out, so they stay flat, consistent with how `incident_description`/`incident_date` already live directly on `claims`.
- **Flattening provider fields onto `claims` invites data drift.** If `facility_name`/`facility_address`/`tax_id` are typed in on every claim independently, the same NPI can end up spelled two different ways across two claims submitted by the same office — nothing enforces "NPI X always means this facility." A `providers` table keyed by a unique `npi` makes that an invariant instead of a hope, and gives a natural place to hang future provider-level work (e.g., a provider fraud-pattern view across claims, or validating an NPI against the real NPPES registry) without another migration.
- **This is a real 1:N relationship, not just "the claims table is getting wide."** A `claim_provider_info` table keyed 1:1 by `claim_id` (the name suggested in the request) wouldn't actually normalize anything — it'd be the same one-row-per-claim duplication risk described above, just moved to a second table joined every time. That's organizational tidiness, not normalization, so it's not what's recommended here.
- **Trade-off, named plainly:** this adds a find-or-create-by-NPI step to `POST /api/claims` (look up `providers` by the submitted NPI; insert a new row if none exists, otherwise reuse it) — one more thing intake does synchronously, versus just inserting flat columns. The companion UI spec should account for this: a mismatched name/address for an NPI that already exists in `providers` is a real edge case to decide (overwrite, reject, or flag for review) — flagged again in Open Questions below since it affects the intake API contract, not just the form.

## Columns

### `providers` (new table)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `npi` | text | NOT NULL | — | National Provider Identifier; exactly 10 digits (§ Constraints) |
| `tax_id` | text | NOT NULL | — | Provider/facility Tax ID (EIN); format not DB-enforced, see Constraints |
| `facility_name` | text | NOT NULL | — | |
| `facility_address` | text | NOT NULL | — | Single free-text field, matching `incident_description`'s style — not decomposed into street/city/state/zip; revisit if the UI spec needs structured address input |
| `created_at` | timestamptz | NOT NULL | `now()` | |
| `updated_at` | timestamptz | NOT NULL | `now()` | Bumped on find-or-create reuse if facility details are allowed to change — see Open Questions |

### `claims` (new columns on the existing table)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `provider_id` | uuid | NOT NULL | — | FK → `providers.id`; resolved synchronously at intake (`POST /api/claims`), not deferred like `policy_id` — see Relationships |
| `diagnosis_code` | text | NOT NULL | — | ICD-10 code, e.g. `E11.9`; format validated client-side + at `validate-claim`, not by a DB CHECK — see Constraints |
| `procedure_code` | text | NOT NULL | — | CPT or HCPCS Level II code, e.g. `99213` or `J1745`; same validation approach as `diagnosis_code` |
| `service_date_from` | date | NOT NULL | — | First date of service |
| `service_date_to` | date | NULL | — | Last date of service; NULL/omitted for a single-day visit. App sets it equal to `service_date_from` when the UI only collects one date (see UI spec) rather than relying on a DB default, since "same as from" isn't a fixed default value |
| `total_billed_amount` | numeric | NOT NULL | — | Gross amount the provider billed, **separate from `claim_amount`** — see Open Questions for the ambiguity this creates downstream |
| `coordination_of_benefits` | boolean | NOT NULL | `false` | Does the claimant have other coverage that might also pay this claim |
| `attestation_signed_at` | timestamptz | NOT NULL | — | Set by the backend at submission time (`POST /api/claims`), not client-supplied — the claimant attests by submitting the form; this timestamp is the record of that, not a field they type into |

## Constraints

- `providers.npi` — `UNIQUE`, plus `CHECK (npi ~ '^[0-9]{10}$')`. This is the one field in this spec with an unambiguous, fixed-length format, so it gets a real DB-level CHECK, same tier as `policies.coinsurance_rate`'s range CHECK used to be.
- `claims.total_billed_amount` — `CHECK (total_billed_amount > 0)`, mirroring `policies.coverage_amount`'s existing `> 0` pattern.
- `claims.service_date_to` — `CHECK (service_date_to IS NULL OR service_date_to >= service_date_from)`.
- `claims.diagnosis_code`, `claims.procedure_code`, `providers.tax_id` — `NOT NULL` only, **no regex CHECK**. ICD-10 (`[A-TV-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?`) and CPT/HCPCS (5-char, but CPT is all-digit and HCPCS Level II is letter+4-digit — two different shapes in one column) are real formats but not simple fixed-length rules like NPI; encoding them as Postgres CHECK regexes is brittle (a legitimate code gets hard-rejected at the DB layer with no good error message) and duplicates validation logic that already needs to live in `ClaimForm` for a decent error message anyway. Recommendation: validate format at the application layer only (client-side in the UI spec; optionally re-checked in the `validate-claim` worker per its existing required-field-check role, SPEC.md §12) — same tier as `incident_description`, which also gets no DB-level format constraint despite having real expectations about its content.
- `claims.attestation_signed_at` — **cannot** be constrained to "not in the future" at the DB level: Postgres CHECK constraints require an immutable expression, and `now()`/`CURRENT_TIMESTAMP` aren't immutable, so a `CHECK (attestation_signed_at <= now())` is rejected outright by Postgres. Not a gap to fix later — this is a hard DB limitation, not an oversight. The application sets this timestamp itself at submission time (see Columns), so there's no untrusted client input to bound anyway.

## Relationships

- `claims.provider_id → providers.id`, `ON DELETE RESTRICT` (same cascade choice as `claims.policy_id → policies.id` — a provider referenced by any claim can't be deleted).
- Unlike `policy_id` (nullable, set later by the `validate-claim` worker once a policy match is confirmed — SPEC.md §12), `provider_id` is set **synchronously during `POST /api/claims`**, before the row is even inserted: the claimant supplies NPI/tax ID/facility name/address as part of the same submission, so there's no "might not resolve yet" window the way there is for policy matching. Hence `NOT NULL` here versus `policy_id`'s `NULL`.
- No relationship to `policies` or `carrier_id` — a provider isn't scoped to one carrier or policy; the same doctor can be billed against claims from different policies/carriers.

## Indexes

- `providers.npi` — already indexed via its `UNIQUE` constraint (Postgres creates the backing btree automatically); no separate index needed.
- `idx_claims_provider_id ON claims (provider_id)` — mirrors `idx_claims_policy_id`; needed for the `provider_id` FK join and for any future "all claims from this provider" lookup (e.g. a fraud-pattern-by-provider view, SPEC.md §14-style future work).
- No index proposed on `diagnosis_code` or `procedure_code` — no current query filters by either; add one later if `detect-fraud-indicators` or a reporting view starts querying by code pattern (speculative for now, not added).

## Migration

Next sequential filename: **`backend/db/migrations/0006_add_fnol_extended_fields.sql`**. Highest existing migration on disk is `0005_drop_policy_adjudication_fields.sql` (`0004` was deleted after being reverted — see git history — but `0005` is real and applied, so `0006` is next regardless of the gap). Convention inferred from `backend/db/migrations/*`: raw SQL, zero-padded 4-digit sequence prefix, `snake_case` descriptive suffix, one migration per logical change.

The migration itself is **not** written as part of this Draft spec (per the command that generated it) — it would need to, in order:
1. `CREATE TABLE providers (...)` with the columns/constraints above.
2. `ALTER TABLE claims ADD COLUMN ...` for each new column.
3. Since `claims` already has rows (the 10+ seeded/test claims), every `NOT NULL` new column (`provider_id`, `diagnosis_code`, `procedure_code`, `service_date_from`, `total_billed_amount`, `attestation_signed_at`) needs a backfill strategy before the `NOT NULL` can be applied — same `ADD COLUMN ... DEFAULT`, backfill, `DROP DEFAULT` sequence used in `0003_add_policy_amounts.sql`/`0004_add_policy_adjudication_fields.sql`. Whoever implements this spec should seed a `providers` row (or a few) and backfill existing `claims` rows with plausible dummy values, the same way those two migrations backfilled the 10 seeded policies.

## Open Questions

1. **`claim_amount` vs. `total_billed_amount` — which is authoritative downstream?** Flagged explicitly per the request. `claim_amount` is already deeply wired: it's a BPMN kickoff variable (§10), an input to `validate-claim` (policy-coverage check) and `score-risk` (§12), the amount `trigger-settlement` actually pays out (§12), and the `> 50000` legal-routing threshold in the DMN table (§11). `total_billed_amount` is new and, as of this spec, wired nowhere.

   **Recommendation:** `claim_amount` stays authoritative for everything it already drives — routing, settlement, the coverage-ceiling check — since changing that would ripple into §10/§11/§12 well beyond this intake-fields change. `total_billed_amount` should be treated as *additional context*, not a replacement: its main near-term value is as a **fraud/anomaly signal** — a large gap between what was billed and what's being claimed is itself worth flagging — which would mean adding it as a new input to `detect-fraud-indicators` and/or `score-risk` in a future worker-spec change, not this one.

   **Needs your resolution before locking:** should this spec also propose adding `total_billed_amount` to `score-risk`'s (and/or `detect-fraud-indicators`'s) input variables now, or leave that as explicitly out of scope here and handle it as a separate `worker` spec later once there's an actual policy for how the billed/claimed gap should affect the risk score? Left unresolved in this draft.

2. **Find-or-create-by-NPI collision:** if `POST /api/claims` receives an NPI that already exists in `providers` but with a different `facility_name`/`facility_address`/`tax_id` than what's stored, what should happen — reuse the existing row and discard the newly submitted details, overwrite the stored row, or reject the submission and surface a conflict to the claimant? Affects both this spec's `providers.updated_at` column and the companion UI spec's error-handling story. Not resolved here.

3. **`service_date_to` UI representation:** should the intake form always show two date pickers (from/to), or one date picker for outpatient/pharmacy/dental/other claim types and a from/to pair only for inpatient/maternity (where a multi-day stay is the norm)? Left to the companion `fnol_form_ui_update.md` spec to decide, noted here only because it affects whether `service_date_to` is ever actually NULL in practice or always gets set to a same-day value.
