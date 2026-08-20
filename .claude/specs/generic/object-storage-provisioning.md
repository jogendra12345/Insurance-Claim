> Inferred type: **generic** (no type given; this is infrastructure provisioning — a MinIO service plus a change to how `backend/api` stores uploaded files — which doesn't map to db/bpmn/dmn/worker/insurance-type/api)

# generic/object-storage-provisioning

**Status:** Draft

## Purpose

Stand up local MinIO (S3-compatible object storage) as specified in `SPEC.md` §6 ("Document storage: S3-compatible object storage (local MinIO for dev)"), and switch `backend/api`'s claim-document upload path onto it. This is `BUILD-PLAN.md` feature #2, a prerequisite finding raised against feature #3 ("Claim storage"): feature #3 was already built, but against local disk as a stand-in since MinIO wasn't provisioned yet — that gap is flagged explicitly in `backend/api/src/routes/claims.ts`'s upload comment and in `BUILD-PLAN.md`'s analysis point #7. This spec is what closes it.

## Scope

**In scope:**
- A `minio` service added to the root `docker-compose.yaml`, alongside the existing `postgres` service — separate containers, one compose file, matching how `claimflow-postgres` is already configured (`.env`-driven credentials, named volume, healthcheck).
- Bucket creation for claim documents (name TBD — see Design), created automatically rather than requiring a manual console step.
- Changing `backend/api/src/routes/claims.ts`'s document upload from `multer.diskStorage` (local `backend/api/uploads/`) to uploading into the new MinIO bucket, and changing `claim_documents.file_url` to point at MinIO instead of `/uploads/<filename>`.
- `.env.example` (root) and `PREREQUISITES.md` updates for the new service, matching the pattern already used for Postgres.

**Out of scope (for this spec):**
- Migrating already-uploaded local-disk test files (`backend/api/uploads/*`) into MinIO — that's throwaway dev data, not worth a migration path.
- Any change to the claimant portal UI — the upload widget, accepted file types, and mandatory-at-least-one-document rule are unaffected; only where the bytes end up changes.
- Production S3 (AWS or otherwise) — `SPEC.md` §6 specifies MinIO for dev only; a real cloud provider is future work, not this spec.
- Deploying to Camunda 8 SaaS or any non-local environment.

## Design

### `docker-compose.yaml` — new `minio` service

Mirrors the existing `postgres` service's shape:
- Image: `minio/minio`, running `server /data --console-address ":9001"` (the standard way to run MinIO with both its S3 API and web console from one container).
- Ports: `9000:9000` (S3 API), `9001:9001` (web console) — both configurable via `.env`, same pattern as `POSTGRES_PORT`.
- Env: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`, sourced from `.env` with dev-only defaults in `.env.example` (matching `POSTGRES_USER`/`POSTGRES_PASSWORD`'s existing pattern).
- Volume: a named volume (`miniodata`) for persistence across `docker compose down`/`up`, matching `pgdata`.
- Healthcheck: MinIO's `/minio/health/live` endpoint via `curl`, mirroring the `pg_isready` healthcheck already on `postgres`.

### Bucket creation

MinIO doesn't auto-create buckets. Two ways to handle this, either is fine — pick one at build time:
- A short-lived `mc` (MinIO Client) init container in the compose file that runs `mc mb` for the bucket once and exits, using `depends_on` so it only runs after `minio` is healthy.
- Or, `backend/api` checks-and-creates the bucket on startup (`bucketExists` / `makeBucket` calls) before it starts accepting requests — simpler (no extra compose service), but couples bucket lifecycle to the API process starting at least once.

Bucket name: `claim-documents` (matches what it holds; no need to namespace by environment since this is dev-only).

### `backend/api` changes

- Add a MinIO client (the official `minio` npm package — MinIO's own SDK, lighter than pulling in the full AWS SDK for one bucket).
- Replace `multer.diskStorage` with `multer.memoryStorage()` in `claims.ts`, so file buffers are available in-process rather than written to local disk first.
- In the `POST /api/claims` handler, for each uploaded file: `putObject` into the `claim-documents` bucket with a generated key (same `${Date.now()}-${file.originalname}` pattern already used for local-disk filenames, to avoid collisions), then set `claim_documents.file_url` to the resulting object's accessible URL (see Open Questions — access policy affects what this URL actually is).
- Remove the `/uploads` static file route in `backend/api/src/index.ts` once nothing writes there anymore.

### Docs to update

- `.env.example` (root): add `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`.
- `PREREQUISITES.md`: add MinIO to the tools table (mirroring the Postgres row and its "Running the local app Postgres" usage section — this needs an equivalent "Running local object storage" section with `docker compose up -d` / console URL / login).
- `backend/api/.env.example`: add whatever `backend/api` itself needs to reach MinIO (endpoint, bucket name, credentials) — same duplication pattern already used for `DATABASE_URL` there.

## Open Questions

1. **Bucket access policy: public-read vs. presigned URLs.** Public-read is the simplest to implement and matches this app's existing "no auth anywhere yet" posture (§2) — `claim_documents.file_url` would be a stable, directly-fetchable URL, same as today's local-disk `/uploads/...` links. Presigned URLs (time-limited, generated per request) are more realistic for how a production S3 setup would actually work, but add real complexity (URLs expire, so `file_url` can't just be stored once — it'd need regenerating on read) for a dev-only bucket holding throwaway data. Recommend public-read for now unless there's a reason to practice the presigned pattern early.
2. **Bucket creation mechanism** — init container vs. API-startup check (see Design above). Either works; pick whichever fits how deliberate you want the compose file to be about ordering vs. how much you want in `backend/api` code.
3. **MinIO client library** — the `minio` npm package (native, minimal) vs. `@aws-sdk/client-s3` (heavier, but "the same code would talk to real S3 with different endpoint config" if this app ever grows beyond MinIO). Recommend `minio` for now, since `SPEC.md` §14 doesn't currently list "move off MinIO to real S3" as planned future work — no reason to pay the AWS SDK's weight for that yet.
