---
description: Insert N dummy rows into a table in the connected app Postgres, auto-satisfying any foreign-key dependencies first
argument-hint: [table-name] [row-count]
---

## What this does

Inserts synthetic test rows into `<table-name>` in the running `claimflow-postgres` container. If that table has a foreign key to another table (e.g. `claims.policy_id` → `policies.id`, or `claim_documents.claim_id` → `claims.id`), it makes sure a valid parent row exists first — reusing one if the parent table already has data, or seeding one (recursively, following the same rule) if it doesn't — before inserting into the target table. This is a **write** command; unlike `/dump-data` (read-only), it inserts rows.

## Inputs

Parse `$ARGUMENTS` as `[table-name] [row-count]`.

- `table-name` — required. If missing, stop and ask for it.
- `row-count` — required, positive integer. If missing, default to `1`. If given but not a positive integer, stop and ask for a valid number.

## Steps

1. Confirm the container is up: `docker compose ps` (repo root). If `claimflow-postgres` isn't running/healthy, say so and stop.
2. Validate `table-name` against the real schema (`information_schema.tables`, schema `public`), same as `/dump-data`. If it's not a real table, stop and show the actual list. Refuse `schema_migrations` specifically — that table is migration-tooling bookkeeping, not app data.
3. Read `backend/db/migrations/*.sql` (all files, in order) to get the authoritative column list, types, `NOT NULL`/nullable, defaults, `CHECK` constraint enum values, and `REFERENCES` for every table — this is more reliable than parsing `pg_constraint` output and stays in sync with the spec by construction. Cross-check against `.claude/specs/db/database-setup.md` if anything is ambiguous.
4. Build the foreign-key dependency graph for `table-name` from the `REFERENCES` clauses found in step 3 (e.g. `claims.policy_id → policies.id`, `claim_documents.claim_id → claims.id`). Do this for **every** FK column on the table, nullable or not — the goal is realistic, fully-linked dummy data, not just constraint satisfaction.
5. For each FK column, resolve a parent id **before** inserting into `table-name`:
   - Query the parent table for an existing row: `SELECT id FROM <parent> ORDER BY created_at DESC LIMIT 1`.
   - If one exists, reuse its `id`. Do not insert a fresh parent row just because you can — reuse first.
   - If the parent table is empty, seed exactly one dummy row into it first, applying this same procedure recursively (that parent might itself have FKs to satisfy). Report every table you had to seed along the way, not just the target table.
6. Generate dummy values for every other `NOT NULL` column on `table-name`, respecting each column's type and any `CHECK` enum found in step 3:
   - `uuid` (non-FK, e.g. `carrier_id`) → `gen_random_uuid()`.
   - `text` with a `CHECK ... IN (...)` → pick the first listed value, unless a more specific one makes the row realistic (e.g. `status = 'submitted'` for a freshly seeded claim, `status = 'active'` for a freshly seeded policy).
   - Plain `text` → a short, obviously-synthetic value that says what it is, e.g. `'Seed Claimant 3'`, `'seed+3@example.com'` — never fabricate a real-looking name/email.
   - `date` → `CURRENT_DATE`, or a small offset from it if the row needs two dates in order (e.g. `policies.effective_date` before `expiry_date`).
   - `numeric` / `integer` → a plausible small positive value for the column's meaning (e.g. `claim_amount` in the low thousands, `confidence` in `[0,1]`), not a random huge number.
   - `jsonb` nullable columns → leave `NULL` unless the table is meaningless without it.
   - Columns with a `DEFAULT` (e.g. `created_at`, `fraud_indicator_count`) → omit them from the `INSERT` and let the default apply, unless the column is also `NOT NULL` with no sensible default and needs an explicit value.
7. Insert `row-count` rows into `table-name` with a single `INSERT ... VALUES (...), (...), ... RETURNING *;` (one statement, multiple value tuples) via:
   ```
   docker compose exec -T postgres psql -U claimflow -d claimflow -c "<insert statement>"
   ```
8. If `table-name` itself is a **parent** other tables commonly depend on (e.g. `policies`, `claims`), that's fine — only walk *up* the FK graph (parents), never seed unrelated child tables the user didn't ask for.

## Output

Report, in order:
- Any parent-table rows it had to seed first (table name, how many, why — "policies had no rows, seeded 1").
- The rows actually inserted into `table-name` (from `RETURNING *`).

If `table-name` had no FK dependencies to resolve, just do step 6 onward and say so plainly rather than mentioning dependency resolution that didn't happen.

Never delete or update existing rows — this command only ever inserts.
