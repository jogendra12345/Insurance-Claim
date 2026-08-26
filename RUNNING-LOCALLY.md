# Running Locally

Steps to host ClaimFlow AI on your machine for local development.

## 1. Start Docker Desktop

Must be running before anything else.

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait until `docker info` succeeds (usually 30-60s after launch).

**Note:** on this machine the `docker compose` plugin subcommand isn't wired
up (`docker: unknown command: docker compose`). Use the standalone
`docker-compose` binary instead for every command on this page:

```powershell
$env:PATH += ";C:\Program Files\Docker\Docker\resources\bin"
```

(add that to PATH once per shell session, then use `docker-compose` in place
of `docker compose` below).

## 2. Start Postgres + MinIO

```bash
cd "C:\Users\Ayan\OneDrive\Desktop\Claim Flow AI Files\Insurance-Claim"
docker-compose up -d
```

Starts `claimflow-postgres` (port 5432) and `claimflow-minio` (ports 9000/9001).
Data persists in Docker volumes, so nothing needs re-seeding on restart.

## 3. Run DB migrations

```bash
cd backend
npm run migrate
```

Safe to run every time — already-applied migrations are skipped automatically.

`backend/db/run-migrations.sh` calls `docker-compose` (standalone binary), matching
the PATH workaround above — if the plugin ever gets wired up on this machine, this
script won't need to change back.

## 4. Start the backend API

```bash
cd backend/api
npm run dev
```

Runs on http://localhost:4000. Requires `backend/api/.env` to exist (copy from
`backend/api/.env.example` if it's missing).

**Watch out:** if a previous `npm run dev` for this package is still holding
port 4000 (background dev servers can outlive a `Ctrl+C` or a killed
terminal), a fresh `npm run dev` throws `EADDRINUSE` and the API never comes
up — the frontend then fails to load policies/claims with a network error.
Check for and clear a stale process first:

```powershell
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object OwningProcess
Stop-Process -Id <OwningProcess> -Force
```

## 5. Start the frontend

```bash
cd frontend/portal
npm run dev
```

Runs on http://localhost:3000. Requires `frontend/portal/.env.local` to exist
(copy from `frontend/portal/.env.local.example` if it's missing).

**Watch out:** if port 3000 is already taken by a stale leftover `next dev`
process, Next.js silently falls back to 3001, which breaks CORS since the
backend only allows `http://localhost:3000` as its origin. Check for a stale
process first:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
```

and kill it before starting the frontend if one is found.

## 6. Camunda process engine

```bash
cd camunda-docker
docker-compose up -d
```

Operate/Tasklist at http://localhost:8080, login `demo` / `demo`.

**Watch out:** the `orchestration` container's `mem_limit` (in
`camunda-docker/docker-compose.yaml`) has needed bumping once already (1g →
2g) — under load it pins near 100% memory and starts silently hanging on
gRPC calls (deploys, Tasklist "Assign"/"Complete" actions) without raising
an error, which looks like the UI is just stuck. Check with
`docker stats --no-stream orchestration`; if it's pinned near the limit,
bump `mem_limit` in `camunda-docker/docker-compose.yaml` and
`docker-compose up -d orchestration` to recreate it (data persists in the
named volumes, so this is safe — full JVM boot takes ~2-3 minutes after
recreation, watch `docker logs orchestration` or poll
`curl -u demo:demo http://localhost:8080/v2/topology` for
`"health":"healthy"`).

Deploy the process, DMN, and forms after any change to
`process/claim-case-process.bpmn`, `process/health-claim-routing.dmn`, or
`process/forms/*.form` — there's no watch/auto-deploy; a one-off
`zeebeClient.deployResources([...])` script (see git history for the exact
shape) is the current approach.

## 7. Start the job workers

```bash
cd backend/workers
npm run dev
```

Starts all 9 workers (`validate-claim`, `extract-evidence`,
`detect-fraud-indicators`, `score-risk`, and the 5 `capture-*` workers) —
they hot-reload on file changes via `tsx watch`. Requires
`backend/workers/.env` (copy from `.env.example`) with a valid
`GEMINI_API_KEY`, and Camunda (step 6) already up. `POST /api/claims`
(backend API, step 4) starts the process instance; nothing progresses past
`validate-claim` without this running.

## Verifying it's up

| Service | URL | Check |
|---|---|---|
| Frontend | http://localhost:3000 | loads the portal homepage |
| Backend API | http://localhost:4000/api/claims | returns 200 |
| Postgres | localhost:5432 | `docker exec claimflow-postgres pg_isready -U claimflow -d claimflow` |
| MinIO | http://localhost:9001 | console login `claimflow` / `claimflow123` |
| Camunda | http://localhost:8080/v2/topology | `"health":"healthy"` on the partition |
| Workers | terminal output | `<job-type> worker started, polling for jobs` for all 9 |

## Shutting down

- Stop the `npm run dev` processes (Ctrl+C in their terminals) — backend
  API, frontend, and workers. If a terminal was closed without stopping it
  first, kill it by port instead (see the `EADDRINUSE`/stale-process notes
  above).
- From the repo root: `docker-compose down` (keeps data) or
  `docker-compose down -v` (wipes data).
- If you started Camunda too: same from `camunda-docker/`.
