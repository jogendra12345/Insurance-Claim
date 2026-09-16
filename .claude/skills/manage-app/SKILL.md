---
name: manage-app
description: Start or stop the full local ClaimFlow AI stack (Docker/Postgres/MinIO, Camunda, backend API, workers, frontend) per RUNNING-LOCALLY.md, freeing vmmem on stop
argument-hint: "start | stop"
---

## What this does

Brings the whole local stack up or down by following `RUNNING-LOCALLY.md` step by step — that file is the source of truth here; if it and this skill ever disagree, treat `RUNNING-LOCALLY.md` as correct and flag the mismatch rather than silently following whichever is more convenient. Long-running processes (`npm run dev` for backend/api, backend/workers, frontend/portal) are started with `run_in_background` so this skill doesn't block waiting on them.

Parse `$ARGUMENTS` as `start` or `stop`. If neither is given, ask which.

## Start

Follow `RUNNING-LOCALLY.md` in order:

1. **Docker Desktop** — check `docker info` succeeds; if not, launch it (`RUNNING-LOCALLY.md` §1) and poll until it does (usually 30-60s). Apply the `docker-compose` standalone-binary PATH workaround noted there if `docker compose` (the plugin form) isn't wired up.
2. **Postgres + MinIO** — `docker-compose up -d` from the repo root.
3. **DB migrations** — `cd backend && npm run migrate` (safe to re-run; already-applied migrations are skipped).
4. **Camunda** — `cd camunda-docker && docker-compose up -d`. Check memory headroom per the "Watch out" note (`docker stats --no-stream orchestration`); if the container's near its `mem_limit` and has hung/thrown spurious timeout incidents before, that note explains why — don't reflexively bump the limit without checking Docker Desktop's own overall VM allocation first.
5. **Backend API** — `cd backend/api && npm run dev`, `run_in_background: true`. Before starting, check port 4000 isn't already held by a stale process (`Get-NetTCPConnection -LocalPort 4000`) — kill it first if so, per the `EADDRINUSE` note. Confirm `backend/api/.env` exists (per RUNNING-LOCALLY.md §4's template); do not create/overwrite it silently if it's missing — tell the user and show the template.
6. **Job workers** — `cd backend/workers && npm run dev`, `run_in_background: true`. Confirm `backend/workers/.env` exists (needs a real `GEMINI_API_KEY`) the same way — don't fabricate one.
7. **Frontend** — `cd frontend/portal && npm run dev`, `run_in_background: true`. Check port 3000 first (a stale process here causes Next.js to silently fall back to 3001, which breaks CORS) and confirm `frontend/portal/.env.local` exists.
8. **Verify** — hit the checks in RUNNING-LOCALLY.md's "Verifying it's up" table (frontend loads, `GET /api/claims` returns 200, Postgres `pg_isready`, Camunda topology `"health":"healthy"`, worker terminal output). Report which are up and which aren't, rather than assuming success.

## Stop

1. Stop the three `npm run dev` background processes started above (or, if they weren't started by this session, find and kill by port per RUNNING-LOCALLY.md's stale-process notes — `Get-NetTCPConnection -LocalPort 4000/3000` etc.).
2. `docker-compose down` from the repo root (keeps data — never pass `-v` unless the user explicitly asks to wipe data).
3. If Camunda was started: `cd camunda-docker && docker-compose down` (same no-`-v`-by-default rule).
4. **Free `vmmem`**: run `wsl --shutdown` (PowerShell) — vmmem stays alive holding RAM even after Docker's containers/UI stop, until WSL2 itself shuts down. Confirm it's gone: `Get-Process | Where-Object { $_.ProcessName -like "*vmmem*" }` should return nothing. Mention that the next `docker compose up` will cold-start WSL2 again (slower first launch) — expected, not a problem.

## Notes

- Never pass `-v` to any `docker-compose down` unless the user explicitly asks to wipe data — default is to keep it.
- If a `.env` file RUNNING-LOCALLY.md calls for is missing, stop and tell the user rather than inventing credentials (especially `GEMINI_API_KEY` and the email-provider keys, which need real values from `PREREQUISITES.md`/the user).
- If `RUNNING-LOCALLY.md` picks up a new gotcha during use, update it there (per the project's own convention), not just in this skill.
