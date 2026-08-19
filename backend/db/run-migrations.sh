#!/usr/bin/env bash
# Applies pending SQL migrations under backend/db/migrations/ to the app Postgres
# container (docker-compose.yaml at repo root), forward-only, tracked in
# schema_migrations. No ORM — see SPEC.md §8 "Migration tooling" for rationale.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

PG_USER="${POSTGRES_USER:-claimflow}"
PG_DB="${POSTGRES_DB:-claimflow}"

cd "$REPO_ROOT"

psql_exec() {
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"
}

psql_exec -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
"

for file in "$MIGRATIONS_DIR"/*.sql; do
  version="$(basename "$file" .sql)"

  applied="$(psql_exec -t -A -c "SELECT 1 FROM schema_migrations WHERE version = '$version';")"
  if [ "$applied" = "1" ]; then
    echo "skip  $version (already applied)"
    continue
  fi

  echo "apply $version"
  psql_exec --single-transaction < "$file"
  psql_exec -c "INSERT INTO schema_migrations (version) VALUES ('$version');"
done

echo "done"
