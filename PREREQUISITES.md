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
| Camunda 8 Self-Managed | 8.9.16 (orchestration) | The workflow engine — Zeebe + Operate + Tasklist, running locally via Docker Compose (lightweight config, H2 storage). Connectors was dropped from `camunda-docker/docker-compose.yaml` (2026-09-07) — not used by this project's BPMN process, and its own JVM was ~450MB of pure overhead on this memory-tight machine. |
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
docker compose up -d      # start (repo root, not camunda-docker/)
docker compose ps         # check status
docker compose down       # stop (keeps data)
```

No `.env` file is required here — `docker-compose.yaml` falls back to dev
defaults (`POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` all `claimflow`,
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` `claimflow`/`claimflow123`, etc. — see
the `${VAR:-default}` entries in that file). Add a root `.env` only if you
want to override one of those defaults.

Migrations live under `backend/db/migrations/`; apply them with `cd backend && npm run migrate` (see `.claude/specs/db/database-setup.md` and `SPEC.md` §8 for schema and tooling details).

## Running local object storage

MinIO runs from the same root `docker-compose.yaml` as Postgres — `docker compose up -d` starts both. No manual bucket setup needed: `backend/api` creates the `claim-documents` bucket (public-read) itself on startup if it doesn't already exist.

- Console: http://localhost:9001
- S3 API endpoint: http://localhost:9000
- Login: whatever `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` are set to in `.env` (defaults to `claimflow`/`claimflow123`, set in `docker-compose.yaml`)

## Still needed (not yet decided/installed)

- ~~Gemini API key~~ — provided 2026-08-25, stored in `backend/workers/.env` (`GEMINI_API_KEY`, gitignored) — for the AI-assisted steps (document extraction, risk scoring, denial letter drafting)
- ~~Notification service~~ — decided 2026-08-31: Resend, key stored in `backend/workers/.env` (`RESEND_API_KEY`, gitignored). Free-tier sandbox sender (`onboarding@resend.dev`, no domain verification) only delivers to the address the Resend account was signed up with — real delivery to arbitrary claimant addresses needs a verified domain, still open. Added 2026-09-02: Gmail SMTP via Nodemailer as a second implementation (`GMAIL_USER`/`GMAIL_APP_PASSWORD` in `backend/workers/.env`, gitignored) — `notify-claimant` prefers it over Resend when set, since it delivers to any claimant address today (relays through a real Gmail mailbox via an App Password, no domain verification needed). Lower sending limits (~500/day) and mail arrives from a personal Gmail address, so Resend + a verified domain remains the better choice long-term. Added 2026-09-07: the same `GMAIL_USER`/`GMAIL_APP_PASSWORD`/`RESEND_API_KEY` values are now also read from **`backend/api/.env`** (separate `.env` file, same values) by the forgot-password OTP flow (`.claude/specs/generic/forgot-password-otp-reset.md`) via a shared `backend/shared/email-sender.ts` — falls back to a console-log mock the same way `notify-claimant` does if neither is set there.
- **Payment gateway** credentials — e.g. Stripe or ACH, for the payout step
- ~~**WhatsApp Business Platform** credentials~~ — provided 2026-09-29 (test setup, verified end to end from a real phone): Meta app "ClaimFlow AI" (`1566291655540625`), WhatsApp Business Account "Test WhatsApp Business Account" (`2084153485520470`), Meta's free test number +1 555-176-2215. `WHATSAPP_ACCESS_TOKEN` is a non-expiring **system-user** token (system user "Claims-Admin", scopes `whatsapp_business_messaging` + `whatsapp_business_management`); `WHATSAPP_APP_SECRET` (added 2026-09-29) verifies Meta's webhook signatures. All in `backend/api/.env` (gitignored). Still test-sandbox only: up to 5 pre-approved recipient numbers; real claimants need Meta business verification and an own business number. Setup steps and gotchas: `RUNNING-LOCALLY.md` §8. Original note: credentials (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `backend/api/.env`) — for the claims assistant's WhatsApp channel (`.claude/specs/generic/claims-assistant.md`, Locked 2026-09-16, built 2026-09-16). Needs a Meta Business Account + WhatsApp Business Platform connection and a registered phone number; Meta's free test sandbox only messages a handful of pre-approved recipient numbers, and going beyond it requires Meta business verification (a real approval-time cost, can take days). Until these are set, `backend/api/src/whatsapp-client.ts` logs outbound messages instead of sending them (same mock-fallback pattern as `notify-claimant`), so the webhook (`POST /api/whatsapp/webhook`) is still testable with direct HTTP requests shaped like Meta's payload.
- **Email claim intake mailbox** — decided 2026-10-07 (`.claude/specs/generic/email-claim-intake.md` Decision 1): a **dedicated** Gmail account for claims, polled over IMAP and replying over its SMTP, both with one App Password. Still needed: the account itself. Set `EMAIL_INTAKE_ENABLED=true`, `EMAIL_INTAKE_IMAP_USER`, `EMAIL_INTAKE_IMAP_PASSWORD` in `backend/api/.env` (gitignored), plus `GEMINI_API_KEY` there (same key as `backend/workers/.env`) so free text and attached bills can pre-fill the claim form — without it intake works from the form alone. Until those are set, intake stays off. Upgrade path once a verified domain exists: an inbound-parse webhook (only the receiver changes).
