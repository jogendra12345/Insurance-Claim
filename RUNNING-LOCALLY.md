# Running Locally

Steps to host ClaimFlow AI on your machine for local development.

## 1. Start Docker Desktop

Must be running before anything else.

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait until `docker info` succeeds (usually 30-60s after launch).

## 2. Start Postgres + MinIO

```bash
cd "C:\Users\Ayan\OneDrive\Desktop\Claim Flow AI Files\Insurance-Claim"
docker compose up -d
```

Starts `claimflow-postgres` (port 5432) and `claimflow-minio` (ports 9000/9001).
Data persists in Docker volumes, so nothing needs re-seeding on restart.

## 3. Run DB migrations

```bash
cd backend
npm run migrate
```

Safe to run every time — already-applied migrations are skipped automatically.

## 4. Start the backend API

```bash
cd backend/api
npm run dev
```

Runs on http://localhost:4000. Requires `backend/api/.env` to exist (copy from
`backend/api/.env.example` if it's missing).

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

## 6. (Optional) Camunda process engine

Not currently wired into claim submission (the BPMN process and job workers
aren't built yet — see `ROADMAP.md`), but if/when needed:

```bash
cd camunda-docker
docker compose up -d
```

Operate/Tasklist at http://localhost:8080, login `demo` / `demo`.

## Verifying it's up

| Service | URL | Check |
|---|---|---|
| Frontend | http://localhost:3000 | loads the portal homepage |
| Backend API | http://localhost:4000/api/claims | returns 200 |
| Postgres | localhost:5432 | `docker exec claimflow-postgres pg_isready -U claimflow -d claimflow` |
| MinIO | http://localhost:9001 | console login `claimflow` / `claimflow123` |

## Shutting down

- Stop the two `npm run dev` processes (Ctrl+C in their terminals).
- From the repo root: `docker compose down` (keeps data) or
  `docker compose down -v` (wipes data).
- If you started Camunda too: same from `camunda-docker/`.
