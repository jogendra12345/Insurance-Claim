# Prerequisites

Everything needed to run and continue building this project.

## System requirements

- **OS**: Windows 10/11 (64-bit)
- **RAM**: 8GB+ recommended (Camunda's containers alone use ~1-2GB)
- **Docker Desktop** with the containers/engine running before starting Camunda

## Tools already installed for this project

| Tool | Version | Purpose |
|---|---|---|
| Docker Desktop | 29.6.2 | Runs the Camunda containers |
| Docker Compose | v5.3.1 | Starts/stops the Camunda stack |
| Camunda 8 Self-Managed | 8.9.16 (orchestration), 8.9.7 (connectors) | The workflow engine — Zeebe + Operate + Tasklist, running locally via Docker Compose (lightweight config, H2 storage) |
| Camunda Desktop Modeler | 5.50.1 | Draws and deploys BPMN process diagrams and DMN decision tables |
| PostgreSQL | 16 (Docker, `postgres:16-alpine`) | Claim records database (`claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log`) — separate from Camunda's own storage, run via the root `docker-compose.yaml` |
| MinIO | `minio/minio` (Docker) | S3-compatible object storage for uploaded claim documents (`SPEC.md` §6), run via the same root `docker-compose.yaml` — see `.claude/specs/generic/object-storage-provisioning.md` |
| Git | — | Version control, pushed to [github.com/jogendra12345/Insurance-Claim](https://github.com/jogendra12345/Insurance-Claim) |
| Node.js / TypeScript | — | Backend API + job worker language (decided, `SPEC.md` §6); `backend/package.json` already scaffolded |

## Where to get them (if reinstalling)

- Docker Desktop: https://www.docker.com/products/docker-desktop/
- Camunda 8 Docker Compose distribution: https://github.com/camunda/camunda-distributions/releases (look for `docker-compose-<version>.zip`)
- Camunda Desktop Modeler: https://github.com/camunda/camunda-modeler/releases (Windows build is a portable `.zip`, no installer)

## Running the local Camunda stack

```bash
cd camunda-docker
docker compose up -d      # start
docker compose ps         # check status
docker compose down       # stop (keeps data)
docker compose down -v    # stop and wipe data
```

- Operate: http://localhost:8080/operate
- Tasklist: http://localhost:8080/tasklist
- REST API: http://localhost:8080/v2
- Zeebe gRPC gateway: `localhost:26500`
- Login: `demo` / `demo`

## Running the local app Postgres

```bash
cp .env.example .env    # first time only — fill in real values if you change the defaults
docker compose up -d      # start (repo root, not camunda-docker/)
docker compose ps         # check status
docker compose down       # stop (keeps data)
```

Migrations live under `backend/db/migrations/`; apply them with `cd backend && npm run migrate` (see `.claude/specs/db/database-setup.md` and `SPEC.md` §8 for schema and tooling details).

## Running local object storage

MinIO runs from the same root `docker-compose.yaml` as Postgres — `docker compose up -d` starts both. No manual bucket setup needed: `backend/api` creates the `claim-documents` bucket (public-read) itself on startup if it doesn't already exist.

- Console: http://localhost:9001
- S3 API endpoint: http://localhost:9000
- Login: whatever `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` are set to in `.env` (defaults in `.env.example`)

## Still needed (not yet decided/installed)

- ~~Gemini API key~~ — provided 2026-08-25, stored in `backend/workers/.env` (`GEMINI_API_KEY`, gitignored) — for the AI-assisted steps (document extraction, risk scoring, denial letter drafting)
- **Notification service** credentials — e.g. SendGrid or Twilio, for the customer notification step
- **Payment gateway** credentials — e.g. Stripe or ACH, for the payout step
