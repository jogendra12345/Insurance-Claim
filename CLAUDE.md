# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

ClaimFlow AI is built and runs end to end locally: backend API, 17 job workers, Next.js portal, BPMN/DMN process, and Postgres migrations. Remaining work is tracked in `resources/ROADMAP.md` (step 6 human-review walkthroughs and step 7 e2e items still open) and `resources/BUILD-PLAN.md`.

`SPEC.md` is the source of truth for the data model, BPMN flow, DMN routing table, and job worker contracts. Each feature also has a design note under `.claude/specs/` (`generic/`, `worker/`, `db/`). **Update `SPEC.md` (and the relevant `.claude/specs/` note) first when scope changes, then implement.** For a file-by-file map of the codebase, read `resources/PLATFORM-OVERVIEW.md`.

## What this project is

A Camunda 8-orchestrated health-insurance claims application. A deterministic BPMN process (intake → validation → AI triage → routing → review → settlement) is combined with **Google Gemini** calls that extract evidence from documents, flag fraud indicators, score risk, and draft denial letters. A human always confirms the AI's suggested routing, and a human always makes the final approve/deny decision. Every automated and human step writes a row to `audit_log` (Postgres), the durable business-level case history.

Camunda 8 has no CMMN case engine; the "case" is a single BPMN process instance per claim, with `audit_log` as case history. This is deliberate — see `SPEC.md` §4.

Claims arrive through three channels, all funnelling into `backend/api/src/create-claim.ts`:
- **Portal** — `POST /api/claims` from the Next.js form.
- **WhatsApp** — Meta webhook in `routes/whatsapp.ts` (exposed locally via an ngrok tunnel).
- **Email** — inbox poller in `email-intake*.ts` (off unless `EMAIL_INTAKE_ENABLED=true`).

## Architecture

```
Portal (Next.js :3000) / WhatsApp / Email
          │
          ▼
backend/api (Express :4000) ──► Postgres (claims, policies, users, audit_log)
          │                  └─► MinIO (claim documents)
          ▼ creates one process instance per claim
Camunda 8 (Zeebe) — process/claim-case-process.bpmn
          │
          ├─► backend/workers  (17 job workers; Gemini for AI steps)
          ├─► DMN health-claim-routing-decision suggests a reviewer role
          └─► User tasks (triage → adjuster / investigator / legal → supervisor),
              worked through the portal's /tasks pages via the /api/tasks proxy
```

Repo layout:
- `process/` — `claim-case-process.bpmn`, `health-claim-routing.dmn`, `forms/*.form`. Deployed with `backend/deploy-resources.mjs` (no auto-deploy — rerun after any change).
- `backend/api/src/` — the API server. `routes/` holds thin Express routers; top-level files hold logic shared by several routes/channels (`create-claim.ts`, `claims-assistant.ts`, `auth.ts`, email/WhatsApp intake).
- `backend/workers/` — one file per Zeebe job type; `index.ts` registers them all by import.
- `backend/shared/` — code used by workers and/or the API: `audit-log.ts`, `gemini-client.ts`, `notification-provider.ts`, `settlement-provider.ts`, `email-sender.ts`, `reviewer-notifications.ts`, `business-days.ts`, `insurance-types/health.ts`.
- `backend/db/migrations/` — numbered SQL migrations, applied by `run-migrations.sh`.
- `frontend/portal/` — Next.js App Router: `app/` = pages (folder path = URL), `components/` = reusable UI, `lib/` = API client, auth session, types, helpers.

## Key rules to preserve

- **Audit everything.** Every job worker and every user-task completion writes at least one `audit_log` row via `writeAuditLog()` (`actor_type`: `system`/`ai`/`human`). AI workers record the model that *actually* answered (returned by `generateContent()`), not the configured one. The `/audit-log-check` skill verifies this.
- **AI goes through `backend/shared/gemini-client.ts`** — temperature 0, falls back through `GEMINI_FALLBACK_MODELS` on 429/5xx. Don't call Gemini directly from a worker.
- **Insurance-type extensibility.** `validate-claim`, `extract-evidence`, and `detect-fraud-indicators` load `backend/shared/insurance-types/<insuranceType>.ts`; the DMN is selected as `<insuranceType>-claim-routing-decision`. Only `health` exists. Add a type with `/add-insurance-type`, never by branching inside the BPMN.
- **`carrier_id`** is a first-class field on every claim (multi-carrier/TPA), though not yet enforced as a tenant boundary.
- **Settlement is mock-only** (`SettlementProvider`) — do not wire a real payment integration. **Notification is real:** `notify-claimant` sends via Gmail SMTP (`GMAIL_USER`/`GMAIL_APP_PASSWORD`), else Resend (`RESEND_API_KEY`), else a logging mock. While this is a test/demo app, both real providers redirect every email to the fixed `TEST_RECIPIENT` in `notification-provider.ts` (claimant address goes in the subject) — swap it back to the claimant before any real use.
- **Errors:** unhandled worker exceptions use Zeebe's built-in retry (3 attempts) then become an Operate incident — no custom BPMN error boundaries.
- **Auth and review UI.** App-level auth (`users` table, JWT bearer token, bcrypt; `backend/api/src/auth.ts`) is the access-control boundary. Roles: `claimant`, `admin`, `triage-team`, `adjuster`, `investigator`, `legal-reviewer`, `supervisor`, mapped to BPMN candidate groups by `ROLE_TO_CANDIDATE_GROUP` (names differ, e.g. `adjuster` → `adjusters`). Reviewers use the portal's `/tasks` pages; `routes/tasks.ts` proxies Camunda with the single server-side `demo` credential, so end users never touch Tasklist.
- **Two sets of infra clients.** The API has its own `api/src/db.ts` and `api/src/zeebe.ts` (Camunda retries deliberately capped because a retried `createProcessInstance` can start a duplicate instance); workers use `shared/db.ts` and `shared/zeebe-client.ts`. Check both when changing connection settings.
- **Git:** work is committed directly to `main` — no feature branches (use `/commit-and-push`).

## Running locally

Full step-by-step (including env vars, Windows/Docker gotchas, sample data) is in `resources/RUNNING-LOCALLY.md`; the `/manage-app start|stop` skill follows it. On this machine use the standalone `docker-compose` binary — the `docker compose` plugin form may not be wired up.

```bash
docker-compose up -d                         # repo root: Postgres + MinIO
cd backend && npm run migrate                # apply DB migrations
cd backend/api && npm run seed:demo-users    # optional: demo login accounts
cd camunda-docker && docker-compose up -d    # Camunda (needs camunda-docker/.env)
cd backend && node deploy-resources.mjs      # deploy BPMN/DMN/forms (after every process change)
cd backend/api && npm run dev                # API on :4000  (needs backend/api/.env, incl. SESSION_SECRET)
cd backend/workers && npm run dev            # job workers   (needs backend/workers/.env, incl. GEMINI_API_KEY)
cd frontend/portal && npm run dev            # portal on :3000
cd backend/api && npm run tunnel             # optional: ngrok tunnel for the WhatsApp webhook
```

Camunda (lightweight config: H2 storage, no Identity/Keycloak, single `demo`/`demo` user):
- Operate: http://localhost:8080/operate · Tasklist: http://localhost:8080/tasklist
- REST API: http://localhost:8080/v2 · Zeebe gRPC: `localhost:26500`
- Storage/multi-tenancy options: `resources/CAMUNDA-DOCKER.md`.

## Tests

```bash
cd backend/api && npm test          # vitest; auth + email-intake tests run against the local Postgres
cd frontend/portal && npm test      # vitest (tests/)
npx vitest run test/auth.test.ts    # single file, from backend/api
```

The workers have no unit tests; verify worker changes against the running stack (the `bug-hunter` agent and `/case-trace` skill help here).

Two Playwright suites validate the Camunda stack itself, not app code: `camunda-docker/tests` (full config) and `camunda-docker/tests-lightweight`. Run with `npm install && npm test` inside either; single file: `npx playwright test <file>.spec.ts`.

## Documents to keep in sync

- `SPEC.md` — source of truth for scope, data model, BPMN/DMN design, worker contracts. Update before implementing a scope change. (`/spec-sync` drafts the needed edit.)
- `.claude/specs/**` — per-feature design notes; update the relevant one alongside `SPEC.md`.
- `resources/ROADMAP.md` — build checklist; check items off as completed.
- `resources/PREREQUISITES.md` — tooling, credentials, open decisions. Update when a "still needed" item is decided.
- `resources/RUNNING-LOCALLY.md` — update when setup steps or env vars change.
- `resources/PLATFORM-OVERVIEW.md` — high-level codebase map; update when files or folders are added, moved, or change role.
- `claim-lifecycle.html` — claims-industry reference material (large static file; read selectively).
