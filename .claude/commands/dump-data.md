---
description: Dump the first N rows of a table from the connected app Postgres (claimflow-postgres), read-only
argument-hint: [table-name] [row-count]
---

## What this does

Runs a read-only `SELECT * FROM <table> LIMIT <row-count>` against the running `claimflow-postgres` container (the same database `backend/db/run-migrations.sh` and the VS Code Database Client connection point at) and prints the result. Never modifies data, never runs anything other than a single bounded `SELECT`.

## Inputs

Parse `$ARGUMENTS` as `[table-name] [row-count]`.

- `table-name` — required. If missing, stop and ask for it.
- `row-count` — required, must be a positive integer. If missing, default to `10`. If given but not a positive integer, stop and ask for a valid number.

## Steps

1. Confirm the container is up: `docker compose ps` (from the repo root). If `claimflow-postgres` isn't running or isn't healthy, say so and stop — don't try to start it silently, since that's a separate concern from dumping data.
2. Validate `table-name` against the actual schema rather than trusting the argument blindly — query `information_schema.tables` for the `public` schema:
   ```
   docker compose exec -T postgres psql -U claimflow -d claimflow -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
   ```
   If `table-name` isn't in that list, stop and show the actual list of tables instead of guessing or attempting the query anyway.
3. Run the dump:
   ```
   docker compose exec -T postgres psql -U claimflow -d claimflow -c "SELECT * FROM <table-name> LIMIT <row-count>;"
   ```
   `<table-name>` must come only from the validated list in step 2 (never interpolate the raw argument straight into SQL) — this is a read-only internal dev tool, but validating against the real schema first avoids typo'd/garbage input reaching `psql` at all.

## Output

Show the query result as returned by `psql`. If the table is empty, say so plainly rather than showing a blank table. If `row-count` exceeds the table's actual row count, that's fine — `psql`/`LIMIT` handles it naturally, just show whatever came back.

Never write, update, or delete anything — this command only ever runs a single `SELECT`.
