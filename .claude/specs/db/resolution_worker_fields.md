# DB: resolution_worker_fields

**Status:** Draft

Adds the two `claims` columns implied by locking in the `trigger-settlement` and `draft-denial-letter` worker specs (`.claude/specs/worker/trigger-settlement.md`, `.claude/specs/worker/draft-denial-letter.md`) — neither exists in SPEC.md §9's data model today.

## Purpose

`trigger-settlement` and `draft-denial-letter` are two of the four remaining unimplemented job workers (SPEC.md §12, §10 steps 15–16). Their specs each had an Open Question — "should this worker's output be persisted onto `claims`, or stay process-variable-only?" — resolved in favor of persisting, for the same reason the rest of the app treats `claims`/`audit_log` as the durable, queryable record rather than Camunda process variables (CLAUDE.md's "Camunda's own Operate history doesn't give you that at the business level"). This spec adds the two resulting columns.

## Columns

### `claims` (new columns on the existing table)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `settlement_id` | text | NULL | — | Identifier returned by `SettlementProvider.pay()` (mocked in v1). Set only on the approved path, by `trigger-settlement`, after `capture-review-decision`/optional `capture-signoff` has already set `status = 'approved'`. NULL for every claim that never reaches settlement (denied, awaiting-info, or not yet processed). |
| `denial_letter_text` | text | NULL | — | Gemini-drafted denial letter text. Set only on the denied path, by `draft-denial-letter`, grounded in `denial_reason`. NULL for every claim that isn't denied. Read back by `notify-claimant` (via `claimId`) rather than threaded through as a process variable, per the resolved Open Question in `notify-claimant.md`. |

Both columns are nullable with no default — unlike the FNOL-extension fields in `fnol_extended_fields.md` (which are `NOT NULL` and needed a backfill strategy for existing rows), these two are populated only for claims that reach a specific terminal branch, so most rows will legitimately have `NULL` forever. No backfill is needed: existing rows simply get `NULL` on `ADD COLUMN`, which is correct, permanent state for claims that were never approved-with-settlement or denied.

## Constraints

None proposed. Both columns hold free-form text with no fixed format (a settlement provider's ID format is provider-specific even under the mock; letter text is prose) — same tier as `claims.incident_description`, `claims.denial_reason`, and `providers.facility_address`, none of which carry DB-level format constraints in this schema.

## Relationships

None — both are plain columns on `claims`, not foreign keys.

## Indexes

None proposed. Neither column is filtered or joined on by any query in SPEC.md §9–§12 today (settlement lookups go through `claimId`; there's no "find claim by settlement_id" use case specified). Add one later if a reporting or reconciliation view needs to search by `settlement_id`.

## Migration

Next sequential filename: **`backend/db/migrations/0009_add_resolution_worker_fields.sql`**. Highest existing migration on disk is `0008_add_policy_dependents.sql`. Convention inferred from `backend/db/migrations/*` (and confirmed by `fnol_extended_fields.md`'s db spec): raw SQL, zero-padded 4-digit sequence prefix, `snake_case` descriptive suffix, one migration per logical change.

The migration itself is **not** written as part of this Draft spec (consistent with `fnol_extended_fields.md`'s convention — specs describe structure, not SQL). It would need to:

```sql
ALTER TABLE claims ADD COLUMN settlement_id text;
ALTER TABLE claims ADD COLUMN denial_letter_text text;
```

No backfill step required (both nullable, no default, no existing-row constraint to satisfy) — this is a simpler migration than `0003`/`0006`'s `ADD COLUMN ... DEFAULT` / backfill / `DROP DEFAULT` sequence, since neither new column is `NOT NULL`.

## Open Questions

None outstanding — both columns' existence, nullability, and lack of constraints/indexes were settled directly by resolving the source worker specs' Open Questions (see Purpose above). This spec exists to formalize that decision as an actual schema change, not to raise new ones.
