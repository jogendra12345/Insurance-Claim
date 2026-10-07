# Running Locally

Steps to host ClaimFlow AI on your machine for local development.

## 1. Start Docker Desktop

Must be running before anything else.

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait until `docker info` succeeds (usually 30-60s after launch).

**Note:** a per-user Docker Desktop install lives under
`%LOCALAPPDATA%\Programs\DockerDesktop` instead of `C:\Program Files\Docker` —
launch it from there if the path above doesn't exist:

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
```

On such installs `docker-compose` is usually already on PATH (check with
`docker-compose --version`), so the PATH workaround below isn't needed.

**Note:** on some machines the `docker compose` plugin subcommand isn't wired
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

**Watch out (fresh machine):** MinIO no longer publishes public images —
pulling `quay.io/minio/minio` fails with `401 Unauthorized`, and
`minio/minio` on Docker Hub fails with `pull access denied`. Machines that
pulled it before still have it cached; on a new machine, pull the maintained
community fork and tag it locally under the name `docker-compose.yaml` expects:

```bash
docker pull pgsty/minio:latest
docker tag pgsty/minio:latest quay.io/minio/minio:latest
docker-compose up -d
```

## 3. Run DB migrations

```bash
cd backend
npm run migrate
```

Safe to run every time — already-applied migrations are skipped automatically.

### Loading the sample data (fresh machine)

`claimflow_data.sql` at the repo root is a data-only `pg_dump` (policies,
claims, providers, audit_log, etc. — including its own `schema_migrations`
rows). It can't be loaded straight on top of a freshly migrated DB: a
migration already seeds a `providers` row the dump also contains
(`duplicate key ... providers_npi_key`), and the dump's `schema_migrations`
rows collide too. On a **brand-new, empty** database only (this wipes every
table), after running the migrations above:

```bash
docker exec claimflow-postgres psql -U claimflow -d claimflow -c "DO \$\$ DECLARE t text; BEGIN SELECT string_agg(quote_ident(tablename), ',') INTO t FROM pg_tables WHERE schemaname='public'; EXECUTE 'TRUNCATE ' || t || ' CASCADE'; END \$\$;"
docker exec -i claimflow-postgres psql -U claimflow -d claimflow -v ON_ERROR_STOP=1 --single-transaction < claimflow_data.sql
```

The dump's `schema_migrations` only lists migrations up to the point it was
taken, so the next `npm run migrate` will try to re-apply later ones whose
changes are already in the schema (e.g. `column "policyholder_phone" ...
already exists`). Mark those as applied — as of this writing that's 0015 and
0016:

```bash
docker exec claimflow-postgres psql -U claimflow -d claimflow -c "INSERT INTO schema_migrations(version) VALUES ('0015_add_phone_fields'),('0016_add_whatsapp_sessions') ON CONFLICT DO NOTHING;"
cd backend && npm run migrate   # should now skip everything
```

Two gaps the dump can't fill on a new machine: uploaded documents live in
the old machine's MinIO volume (not in the dump), so `claim_documents` rows
for sample claims point at files that don't exist here; and Camunda starts
empty, so any sample claim that was mid-process (`in_review`) has no process
instance behind it and can't be progressed in Tasklist. Closed
(`approved`/`denied`) claims are unaffected; submit new claims to exercise
the full flow.

### Demo login accounts

```bash
cd backend/api
npm run seed:demo-users
```

Creates (or resets) one portal account per staff role plus the sample
claimants, all with password `claimflow123` — safe to re-run:

| Role | Email |
|---|---|
| admin | admin1@claimflow.test |
| triage-team | triage1@claimflow.test |
| adjuster | adjuster1@claimflow.test |
| investigator | investigator1@claimflow.test |
| legal-reviewer | legal1@claimflow.test |
| supervisor | supervisor1@claimflow.test |
| claimant | ayanchou2015@gmail.com (POL-100013), amina.al-farsi@example.com (POL-100001), youssef.nasser@example.com (POL-100004) |

Requires `backend/api/.env` (for `DATABASE_URL`) and Postgres up. These are
portal logins; Camunda Operate/Tasklist still use `demo` / `demo`.

`backend/db/run-migrations.sh` calls `docker-compose` (standalone binary), matching
the PATH workaround above — if the plugin ever gets wired up on this machine, this
script won't need to change back.

## 4. Start the backend API

```bash
cd backend/api
npm run dev
```

Runs on http://localhost:4000. Requires `backend/api/.env` to exist — create
it with:

```
DATABASE_URL=postgresql://claimflow:claimflow@localhost:5432/claimflow
PORT=4000
CORS_ORIGIN=http://localhost:3000
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ROOT_USER=claimflow
MINIO_ROOT_PASSWORD=claimflow123
MINIO_BUCKET=claim-documents
ZEEBE_GRPC_ADDRESS=grpc://localhost:26500
CAMUNDA_AUTH_STRATEGY=NONE

# Required — signs login session tokens; without it every login throws
# "SESSION_SECRET is not set." Any long random string works locally, e.g.
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=
# Optional — how long a login lasts, in hours (default 8). Logins are per
# browser tab (a bearer token in that tab's sessionStorage), so each tab can
# be signed in as a different user; closing the tab also ends its login.
SESSION_TTL_HOURS=8

# Optional — the forgot-password flow's OTP email falls back to a
# console-log mock (prints the code here) if neither is set. Same values as
# backend/workers/.env below; Gmail is preferred over Resend when both are set.
GMAIL_USER=
GMAIL_APP_PASSWORD=
RESEND_API_KEY=

# Optional — WhatsApp claims assistant (§8 below). Unset = outbound messages
# are logged instead of sent, and webhook signatures aren't checked.
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# Optional — email claim intake (§9 below). Off unless EMAIL_INTAKE_ENABLED=true.
EMAIL_INTAKE_ENABLED=
EMAIL_INTAKE_IMAP_USER=
EMAIL_INTAKE_IMAP_PASSWORD=
# Optional — share a personal inbox: only mail to this plus-address is handled
# (e.g. you+claims@gmail.com); everything else is left untouched and unread.
EMAIL_INTAKE_ADDRESS=
# Optional — last day intake runs (YYYY-MM-DD, inclusive); polling stops after it.
EMAIL_INTAKE_UNTIL=
# Optional — reads claim details from free text and attached bills; without
# it email intake still works from the claim form alone. Same key as
# backend/workers/.env. Copy GEMINI_MODEL / GEMINI_FALLBACK_MODELS from there
# too, so a busy model (503) falls back instead of skipping extraction.
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_FALLBACK_MODELS=
```

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

Runs on http://localhost:3000. Requires `frontend/portal/.env.local` to
exist — create it with:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

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

Requires `camunda-docker/.env` to exist (gitignored; `docker-compose.yaml`
marks it `required: true` and reads the image tag from it) — create it with:

```
CAMUNDA_VERSION=8.9.16
```

**Watch out:** the `orchestration` container's `mem_limit` (in
`camunda-docker/docker-compose.yaml`) has needed bumping twice already (1g →
2g → 2.5g) — under memory pressure it either silently hangs on gRPC calls
(deploys, Tasklist "Assign"/"Complete" actions — looks like the UI is just
stuck, no error raised) or a GC pause blocks the engine's single-threaded
stream processor long enough to blow past an internal timeout, which
surfaces as a spurious incident on a process instance (Operate shows an
error like `Expected to evaluate expression but timed out after 5000 ms:
'<some gateway condition>'` even though the variables involved are
perfectly valid — it's an engine hiccup, not a data/BPMN bug). Resolving
the incident via `POST /v2/incidents/{incidentKey}/resolution` (basic auth
`demo`/`demo`) is safe once you've confirmed it's this kind of timeout
rather than a real logic error.


Check current usage with `docker stats --no-stream orchestration`; if it's
pinned near the limit, bump `mem_limit` in `camunda-docker/docker-compose.yaml`
and `docker-compose up -d orchestration` to recreate it (data persists in the
named volumes, so this is safe — full JVM boot takes ~2-3 minutes after
recreation, watch `docker logs orchestration` or poll
`curl -u demo:demo http://localhost:8080/v2/topology` for
`"health":"healthy"`). Note Docker Desktop's own memory allocation on this
machine is only ~3.8GB (of ~7.9GB host RAM) — if `orchestration` needs
bumping again, check whether there's still headroom under Docker's overall
VM limit before raising the container's `mem_limit` further; if not, the
real fix is increasing Docker Desktop's memory allocation (Settings →
Resources) rather than over-provisioning a single container within an
already-tight VM.

**Watch out (2026-10-07):** if `orchestration` gets killed (exit code 137 —
Docker Desktop's whole VM was 4 GB with Camunda allowed 2.5 GB of it), Docker
restarts it itself, and a manual `docker-compose up -d` at the same time can
fail with `Bind for 0.0.0.0:9600 failed: port is already allocated` — leaving
the container "healthy" but with **no published ports** (`docker port
orchestration` prints nothing; `localhost:8080` doesn't answer). Fix:
`cd camunda-docker && docker-compose down && docker-compose up -d` (no `-v` —
data is kept). While Camunda was unreachable, the portal's Tasks page used to
crash the whole API (policies/claims stopped loading too); `backend/api/src/
index.ts` now survives that specific Camunda-client error.

Deploy the process, DMN, and forms after any change to
`process/claim-case-process.bpmn`, `process/health-claim-routing.dmn`, or
`process/forms/*.form` — there's no watch/auto-deploy. A fresh Camunda has
nothing deployed, so run this once on a new machine too:

```bash
cd backend
node deploy-resources.mjs
```

## 7. Start the job workers

```bash
cd backend/workers
npm run dev
```

Starts all 17 workers (`validate-claim`, `extract-evidence`,
`detect-fraud-indicators`, `score-risk`, `trigger-settlement`,
`draft-denial-letter`, `notify-claimant`, `close-case`, the 3 `auto-*`
SLA workers, and the 6 `capture-*` workers) — they hot-reload on file
changes via `tsx watch`.
Requires `backend/workers/.env` to exist — create it with:

```
DATABASE_URL=postgresql://claimflow:claimflow@localhost:5432/claimflow
ZEEBE_GRPC_ADDRESS=grpc://localhost:26500
CAMUNDA_AUTH_STRATEGY=NONE
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-3.6-flash
# Optional — tried in order when the model above is overloaded/over quota
# (HTTP 429/5xx). See SPEC.md §12 "Gemini model fallback".
GEMINI_FALLBACK_MODELS=gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite
FRONTEND_URL=http://localhost:3000

# Optional — notify-claimant falls back to a console-log mock if neither is
# set. Gmail is preferred over Resend when both are set (see PREREQUISITES.md).
GMAIL_USER=
GMAIL_APP_PASSWORD=
RESEND_API_KEY=
```

and Camunda (step 6) already up. `POST /api/claims` (backend API, step 4)
starts the process instance; nothing progresses past `validate-claim`
without this running.

## 8. WhatsApp claims assistant (optional)

Meta must reach the webhook over public HTTPS, so the local API needs a
tunnel. Setup (Meta app `1566291655540625`, WhatsApp Business Account
`2084153485520470`, test number +1 555-176-2215 — see `PREREQUISITES.md`):

1. Fill the four `WHATSAPP_*` values in `backend/api/.env` (§4 template):
   - `WHATSAPP_PHONE_NUMBER_ID` — WhatsApp → API Setup, under the **From** number.
   - `WHATSAPP_ACCESS_TOKEN` — a system-user token (Business Settings → Users →
     System users → Generate token, expiry **Never**, scopes
     `whatsapp_business_messaging` + `whatsapp_business_management`). The
     "Generate access token" button on API Setup only makes a ~24h token
     for that page's **Send message** button — don't put it here.
   - `WHATSAPP_APP_SECRET` — App settings → Basic → App secret.
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — any random string you choose.
2. Tunnel to the API — an **ngrok free static domain**, so the public URL
   never changes (set up 2026-10-05; replaces the old Cloudflare quick
   tunnel, whose random `trycloudflare.com` URL changed on every restart and
   silently broke the bot until Meta was updated by hand):
   - Domain: `https://kleenex-kabob-predefine.ngrok-free.dev` (the ngrok
     account's free dev domain — dashboard → Universal Gateway → Domains).
   - Config: `%LOCALAPPDATA%\ngrok\ngrok.yml` holds the authtoken and an
     endpoint named `claimflow-whatsapp` → upstream `4000`.
   - Started **with the app**, not on boot — the tunnel is useless without
     the API behind it. Right after `npm run dev` in `backend/api` (§4), in
     another terminal:
     ```bash
     cd backend/api
     npm run tunnel        # runs ngrok start claimflow-whatsapp (scripts/tunnel.ts)
     ```
     `/manage-app start` does this automatically and `/manage-app stop`
     stops it. If the tunnel isn't running, Meta's messages go nowhere and
     the bot is silent (Meta retries for a while, then drops them).
   - Fresh machine: `winget install Ngrok.Ngrok`, `ngrok update`,
     `ngrok config add-authtoken <token>`, then add the `endpoints:` block
     to `ngrok.yml` (`ngrok config check` validates it). The free plan allows
     **one** running agent — stop any manual `ngrok` before starting the
     service.
   - Free-plan ngrok shows a browser warning page to browsers only; Meta's
     webhook POSTs pass straight through.
3. Meta Callback URL — **set once**, already done for the domain above:
   `https://kleenex-kabob-predefine.ngrok-free.dev/api/whatsapp/webhook`,
   subscribed to `messages`. Only redo this if the domain changes (Meta →
   WhatsApp → Configuration → Edit → **Verify and save**; the API must be
   running so Meta's verify handshake succeeds).
4. Add your phone under API Setup → **To** (max 5 test recipients), and to
   let the bot recognize you, store it on a policy **digits only with
   country code, no `+`** — exactly how WhatsApp sends it (e.g.
   `919876543210`):
   ```bash
   docker exec claimflow-postgres psql -U claimflow -d claimflow -c "UPDATE policies SET policyholder_phone = '<digits>' WHERE policy_number = '<POL-...>';"
   ```
   Check-claim-status then shows that person's claims from either channel:
   WhatsApp-raised ones (`claims.claimant_phone`) and portal-filed ones
   (matched on the email of the policyholder/dependent with this phone) — no
   need to back-fill `claimant_phone` on portal claims.
5. Send `hi` to the test number — the bot replies with its menu.

**Watch out — messages never arrive, but "Verify and save" succeeded:** the
app must also be subscribed to the WhatsApp Business Account, which the
dashboard doesn't always do. Check with
`GET https://graph.facebook.com/v26.0/<WABA_ID>/subscribed_apps` (bearer =
the access token); if "ClaimFlow AI" isn't listed, `POST` to the same URL to
subscribe it. Also check the Callback URL Meta has saved isn't a stale
tunnel: `GET https://graph.facebook.com/v26.0/<APP_ID>/subscriptions` with
`Authorization: Bearer <APP_ID>|<APP_SECRET>`.

`API log` shows `rejected: missing or invalid X-Hub-Signature-256` for any
webhook POST not signed by Meta with `WHATSAPP_APP_SECRET` — expected for
hand-crafted test requests.

## 9. Email claim intake (optional)

Claimants email a dedicated claims Gmail address to raise a claim (a fill-in
claim form comes back), check claim status, or check policy status —
`.claude/specs/generic/email-claim-intake.md`. The API polls that inbox over
IMAP and replies over its SMTP.

1. Create (or pick) a **dedicated** Gmail account for claims — not the
   `GMAIL_USER` account, which sends OTP/notification mail. Turn on 2-Step
   Verification and create an App Password (myaccount.google.com/apppasswords).
2. In `backend/api/.env` set `EMAIL_INTAKE_ENABLED=true`,
   `EMAIL_INTAKE_IMAP_USER=<that address>`,
   `EMAIL_INTAKE_IMAP_PASSWORD=<the App Password>`, and ideally
   `GEMINI_API_KEY` (§4 template). Optional: `EMAIL_INTAKE_POLL_SECONDS`
   (default 60), `EMAIL_INTAKE_REMINDER_DAYS` (3), `EMAIL_INTAKE_EXPIRY_DAYS`
   (14).
3. Restart the API — its log shows `Email claim intake polling <address> every 60s.`
4. To test, email that address **from an address that's on a policy**
   (`policyholder_email` or a dependent's email). Seeded policies use
   undeliverable `@example.com` addresses, so update one first, e.g.
   `UPDATE policies SET policyholder_email = 'you@gmail.com' WHERE policy_number = '<one>';`
   Then send `raise a claim`, fill in the form that comes back, attach a
   PDF/photo, reply, and reply `CONFIRM` to the summary.

**Sharing a personal inbox:** set `EMAIL_INTAKE_ADDRESS` to a plus-address of
the account (e.g. `you+claims@gmail.com` — Gmail delivers it to the same
inbox) and have claimants email that. Only mail sent to it is processed, marked
read, or replied to; ordinary mail to the account is left exactly as it was.
Without `EMAIL_INTAKE_ADDRESS`, **every unread email in the inbox is treated as
claimant mail** — newsletters are ignored, but anything else gets a reply, and
all of it is marked read — so only do that with an empty, dedicated inbox.
`EMAIL_INTAKE_UNTIL` switches intake off after a given day, for demos. Unknown senders get one
"not linked to a policy" reply per 24h; mail failing SPF/DKIM/DMARC is dropped
without a reply. Every step is logged in `email_intake_events`
(`SELECT action, detail FROM email_intake_events ORDER BY created_at DESC`).

## Automated tests

```bash
cd backend/api && npm test        # auth/session + email intake API tests — needs Postgres up and migrations run
cd frontend/portal && npm test    # per-tab login tests (jsdom, no servers needed)
```

The API suite creates and deletes its own throwaway users and policies; it
never sends email (the password-reset test writes the one-time code straight
to the DB; the email intake tests swap outbound mail, the AI and MinIO for
in-memory fakes and stub Zeebe).

## Verifying it's up

| Service | URL | Check |
|---|---|---|
| Frontend | http://localhost:3000 | loads the portal homepage |
| Backend API | http://localhost:4000/api/claims | returns 401 `Login required.` when logged out (the API is up) |
| Postgres | localhost:5432 | `docker exec claimflow-postgres pg_isready -U claimflow -d claimflow` |
| MinIO | http://localhost:9001 | console login `claimflow` / `claimflow123` |
| Camunda | http://localhost:8080/v2/topology | `"health":"healthy"` on the partition |
| Workers | terminal output | `<job-type> worker started, polling for jobs` for all 17 |

## Shutting down

- Stop the `npm run dev` processes (Ctrl+C in their terminals) — backend
  API, frontend, and workers. If a terminal was closed without stopping it
  first, kill it by port instead (see the `EADDRINUSE`/stale-process notes
  above).
- From the repo root: `docker-compose down` (keeps data) or
  `docker-compose down -v` (wipes data).
- If you started Camunda too: same from `camunda-docker/`.
