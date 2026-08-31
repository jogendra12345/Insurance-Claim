# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo is pre-implementation. Only the spec, roadmap, prerequisites, and a local Camunda 8 runtime exist so far — `backend/`, `frontend/`, and `process/` (referenced throughout `SPEC.md`) have not been created yet. Before writing app code, read `SPEC.md` in full — it is the source of truth for the data model, BPMN process flow, DMN routing table, and job worker contracts. Update `SPEC.md` first when scope changes, then implement. Check off completed steps in `ROADMAP.md` as you build (it defines the build order: DB → Camunda process → backend API → job workers → frontend → human review config → e2e test).

## What this project is

ClaimFlow AI: a Camunda 8-orchestrated insurance claims application. A deterministic BPMN process (intake → validation → AI triage → routing → settlement) is combined with Claude API calls that extract evidence from documents, flag fraud indicators, and score risk — but a human always confirms the AI's suggested routing and a human always makes the final approve/deny decision. Every automated and human step writes a row to `audit_log` (Postgres), which is the durable, queryable case history — Camunda's own Operate history doesn't give you that at the business level.

Camunda 8 has no CMMN case engine (unlike Camunda 7); the "case" here is a single BPMN process instance per claim, with `audit_log` standing in as case history. This is deliberate — see `SPEC.md` §3.

## Architecture (once built, per SPEC.md §4-§6)

```
Frontend (Next.js portal) → Backend API (Node/TS) → Postgres (claims) + object storage (documents)
                                    │
                                    └→ starts a Zeebe process instance
                                              │
                             Camunda 8 (Zeebe + Operate + Tasklist)
                                    │
                    ┌───────────────┼────────────────────┐
              AI job workers   DMN routing table    Human review tasks (Tasklist)
              (Node/TS+Claude) (claim-routing-      (Triage → Adjuster/
                                 decision)            Investigator/Legal)
                    └──────── every step writes to audit_log ────────┘
```

Planned repo layout (SPEC.md §6):
- `process/` — `claim-case-process.bpmn` and `claim-routing.dmn`
- `backend/api/` — claim submission + status REST endpoints
- `backend/workers/` — one file per Zeebe job worker (8 total, see SPEC.md §11)
- `backend/db/` — Postgres schema + migrations
- `backend/shared/` — Zeebe client, Claude client, audit-log writer, shared types
- `frontend/portal/` — claimant-facing submit + status UI

Key architectural rules to preserve when implementing:
- `carrier_id` is a first-class field on every claim from v1 (multi-carrier/TPA support), even though tenant isolation/enforcement is future work.
- `SettlementProvider` is a swappable interface with a mock implementation only — do not wire a real payment integration in v1. `NotificationProvider` is the exception: it has a real implementation (Resend, `backend/shared/notification-provider.ts`) per explicit product direction (2026-08-31) — `notify-claimant` uses it whenever `RESEND_API_KEY` is set, falling back to the mock otherwise. See PREREQUISITES.md and SPEC.md §12.
- Unhandled worker exceptions rely on Zeebe's built-in retry (3 attempts) then fail into an Operate incident — no custom BPMN error boundaries in v1.
- Every job worker and every user-task completion must write at least one `audit_log` row (`actor_type`: `system`/`ai`/`human`).
- Role-based review uses stock Camunda Tasklist with candidate groups (`triage-team`, `adjusters`, `investigators`, `legal-reviewers`, `supervisors`) — no custom review UI in v1.

## Local Camunda 8 runtime (`camunda-docker/`)

This is the only runnable piece of the system today — a Camunda 8.9 Self-Managed stack via Docker Compose, using the lightweight config (H2 storage, basic auth).

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

The lightweight config has **no Identity/Keycloak** — just the single `demo` basic-auth user, so there is no real multi-user group membership yet. This blocks meaningfully testing Tasklist candidate-group routing (adjusters vs. investigators vs. legal). See the "Open decision before Step 6" note in `ROADMAP.md`: either switch to `docker-compose-full.yaml` for real users/groups before building human review, or accept `demo` claiming any task and defer.

Switching secondary storage or enabling multi-tenancy: see `camunda-docker/README.md` (sets `ORCHESTRATION_CONFIG_FILE` in `.env`, or adds a `docker-compose.override.yaml` for multi-tenancy).

### Compose e2e tests

Two independent Playwright suites validate the Camunda stack itself (not app code):

```bash
cd camunda-docker/tests              # full-stack compose smoke/login/flow tests
npm install
npm test                             # npx playwright test
npm run test:headed
npm run report

cd camunda-docker/tests-lightweight  # lightweight-config equivalent
npm install
npm test
```

Run a single test file: `npx playwright test <file>.spec.ts` (from inside the relevant `tests`/`tests-lightweight` directory).

## Documents to keep in sync

- `SPEC.md` — source of truth for scope, data model, BPMN/DMN design, worker contracts. Update before implementing a scope change.
- `ROADMAP.md` — build order checklist; check items off as completed.
- `PREREQUISITES.md` — installed tooling and versions, and what's still undecided (backend language, Claude API key, notification/payment provider credentials, Postgres). Update when a "still needed" item gets decided.
- `claim-lifecycle.html` — reference material on claims-industry lifecycle/process context (large static file; read selectively).
