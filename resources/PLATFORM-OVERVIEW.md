# ClaimFlow AI — Platform Overview

A high-level map of the platform for whoever owns it next: what each important file does and how the pieces fit together. For the authoritative detail (data model, BPMN steps, DMN rules, worker contracts) see [`SPEC.md`](../SPEC.md).

> **Heads-up — some docs lag the code.** `CLAUDE.md` still describes the repo as "pre-implementation" and says the AI steps call Claude. In reality the backend, workers, and frontend are built, and every AI step calls **Google Gemini** ([`backend/shared/gemini-client.ts`](../backend/shared/gemini-client.ts)). Treat `SPEC.md` as the most current description.

## What the platform does

ClaimFlow AI is a health-insurance claims platform. A claim arrives through the **web portal, WhatsApp, or email**. Camunda 8 then runs it through a fixed workflow: validation, AI analysis, routing to a reviewer, human review, and finally settlement or denial. AI suggests; humans decide — a person confirms the suggested reviewer and a person makes the final approve/deny call. Every automated and human step writes a row to the Postgres `audit_log` table, which is the case history.

## How the pieces connect

```
Portal (Next.js) / WhatsApp / Email
          │
          ▼
backend/api (Express, :4000) ──► Postgres (claims, policies, users, audit_log)
          │                  └─► MinIO (uploaded documents)
          ▼ starts one process instance per claim
Camunda 8 (Zeebe) runs process/claim-case-process.bpmn
          │
          ├─► backend/workers (17 job workers: Gemini AI, DB writes, email)
          ├─► DMN table suggests a reviewer role
          └─► Human tasks (triage → adjuster / investigator / legal → supervisor)
```

## How the code is organised

### Backend: `api/src` vs `workers` vs `shared`

The backend is **two separately running programs** plus a folder of code they share:

| Folder | Runs as | Rule of thumb |
|---|---|---|
| `backend/api/src/` | The **API server** (`npm run dev` in `backend/api`, port 4000). Its own `package.json`. | Code only the API needs: HTTP routes, login/auth, claim creation, WhatsApp and email intake. It answers *requests from people* (portal, WhatsApp, email). |
| `backend/workers/` | The **worker process** (`npm run dev` in `backend/workers`). Its own `package.json`. | One file per Camunda job type. It does work *when Camunda asks for it* — it never serves HTTP. |
| `backend/shared/` | Nothing on its own — it's a library. | Code that **both** programs, or several workers, need: the audit-log writer, Gemini client, email sender, notification/settlement providers, insurance-type configs, business-day maths. Put code here when a second consumer needs it, not before. |
| `backend/db/` | Run once via `npm run migrate` in `backend/`. | SQL migrations — the schema both programs read and write. |

Inside `api/src/`:
- `routes/` holds one Express router per URL prefix (`/api/claims`, `/api/tasks`, …). A route file should stay thin: check auth, parse the request, call a helper, shape the response.
- The top-level files in `api/src/` (`create-claim.ts`, `claims-assistant.ts`, `email-intake*.ts`, `auth.ts`, …) are the **business logic** the routes and intake channels call. For example, `create-claim.ts` is used by the portal route, the WhatsApp bot, *and* email intake — which is why it isn't inside `routes/`.

Who uses `shared/` today:
- **Workers** use it for almost everything: `audit-log`, `db`, and `zeebe-client` (~17 imports each), plus `reviewer-notifications`, `gemini-client`, `business-days`, `insurance-types/health`, and the providers.
- **The API** uses only three modules from it: `email-sender`, `gemini-client`, `short-claim-id`.

> **Watch out:** the API keeps **its own** Postgres and Camunda clients (`api/src/db.ts`, `api/src/zeebe.ts`) instead of using `shared/db.ts` and `shared/zeebe-client.ts`. They're configured slightly differently (e.g. the API caps Camunda retries, because a retried "start process" call can create a duplicate process for the same claim). When you change connection settings, check both places.

### Frontend: `app` vs `components` vs `lib`

The portal uses the Next.js **App Router**, where folder names are URLs:

| Folder | What goes here | Example |
|---|---|---|
| `frontend/portal/app/` | **Pages (routes).** Each `page.tsx` is a screen and its folder path is its URL. `[id]` / `[key]` folders are dynamic URL segments. `layout.tsx` wraps every page (top bar, theme, auth provider). | `app/claims/[id]/page.tsx` → `/claims/123`; `app/tasks/page.tsx` → `/tasks` |
| `frontend/portal/components/` | **Reusable UI pieces** with no URL of their own, imported by pages. Subfolders group pieces for one feature (`landing/` for the public home page, `assistant/` for the chat). | `ClaimForm.tsx`, `StatusBadge.tsx`, `Pagination.tsx`, `TopBar.tsx` |
| `frontend/portal/lib/` | **Non-visual helpers:** the API client, login session, TypeScript types, formatting. No JSX layout. | `api.ts` (every backend call), `auth-context.tsx` (who's logged in), `types.ts`, `time.ts` |

Rule of thumb: a new *screen* is a folder under `app/`; something drawn on more than one screen goes in `components/`; logic with no UI goes in `lib/`. Pages import the other two with the `@/` alias, e.g. `import { fetchPolicies } from "@/lib/api"`.

## 1. Process definitions — `process/`

| File | Purpose |
|---|---|
| `claim-case-process.bpmn` | **The core of the platform.** Defines the whole claim lifecycle: validate → extract evidence → detect fraud → score risk → DMN routing → triage review → role review → approve / deny / request more info → settle → notify → close. Missed review deadlines escalate automatically (adjuster → investigator → legal → supervisor). |
| `health-claim-routing.dmn` | Rules that suggest who reviews a claim; the first matching rule wins. Amount over 50k → legal; any fraud flag, a policy under 14 days old, or 3+ claims in a year → investigator; everything else → adjuster. |
| `forms/*.form` | Forms for the human tasks (triage, review decision, validation exception). |

## 2. Backend API — `backend/api/src/`

| File | What it does |
|---|---|
| `index.ts` / `app.ts` | Startup: prepares the MinIO bucket, starts the email poller, mounts all routes. |
| `create-claim.ts` | **Single entry point for every new claim**, whatever the channel. Validates input (ICD-10 / CPT / NPI codes, coverage limit), writes the claim and its documents, then starts the Camunda process — with a guard against starting the same claim twice. |
| `auth.ts` + `routes/auth.ts` | JWT bearer-token login, bcrypt passwords, signup, staff registration, password reset by OTP. Maps app roles to Camunda reviewer groups (`ROLE_TO_CANDIDATE_GROUP`). |
| `routes/claims.ts` | List and view claims, read a claim's audit log, see its pending task, resubmit after a "more info" request. |
| `routes/tasks.ts` | **Backend for the review screens.** Reviewers never log into Camunda: this file uses one server-side Camunda account to list, claim, unclaim, and complete tasks, filtered by the reviewer's role. |
| `routes/policies.ts`, `routes/providers.ts` | Policy create/read/delete and provider lookup. |
| `routes/whatsapp.ts` + `whatsapp-client.ts` | WhatsApp intake: a Meta webhook (signature-checked) that walks the claimant through filing or checking a claim in chat. |
| `email-intake*.ts` | Email intake: polls an inbox, replies with a fill-in claim form, reads replies, and supports keyword commands. The largest and most complex part of the API. |
| `claims-assistant.ts` | Shared "check my claim / check my policy / raise a claim" logic used by WhatsApp, email, and the portal assistant. |
| `zeebe.ts`, `storage.ts`, `db.ts` | Clients for Camunda, MinIO, and Postgres. |

## 3. Job workers — `backend/workers/`

`index.ts` loads all 17 workers. They fall into four groups:

- **AI workers (Gemini)**
  - `extract-evidence` — reads the uploaded documents and writes a case summary.
  - `detect-fraud-indicators` — flags fraud against a fixed list of categories.
  - `score-risk` — gives a 0–100 risk score using a rubric.
  - `draft-denial-letter` — writes the denial letter text.
- **Deterministic rules** — `validate-claim` checks the policy is active, the claimant is authorized, and there's no duplicate claim. It also works out the inputs the DMN table needs.
- **`capture-*` workers** — copy a human's or the DMN table's decision onto the `claims` row and write to the audit log (routing, triage, review, sign-off, validation exception, resubmission).
- **Automation and outcomes**
  - `auto-confirm-triage`, `auto-escalate-review`, `auto-reject-validation-exception` — handle missed deadlines.
  - `trigger-settlement` — pays out through a mock provider.
  - `notify-claimant` — sends real email.
  - `close-case` — marks the claim finished.

## 4. Shared code — `backend/shared/`

| File | Why it matters |
|---|---|
| `audit-log.ts` | `writeAuditLog()`. Every worker and every task completion must call it — a core rule of the platform. |
| `gemini-client.ts` | All AI calls go through here. Temperature 0; falls back to other models on 429/5xx errors; returns the model that actually answered so the audit log records the right one. |
| `insurance-types/health.ts` | Health-specific settings: required fields, document types, AI prompts. Adding a new insurance line means adding a file like this. |
| `notification-provider.ts` | Sends email via Gmail SMTP, then Resend, then a mock, depending on which keys are set. **Note:** every email currently goes to a hard-coded `TEST_RECIPIENT`, not the real claimant. |
| `settlement-provider.ts` | Mock payment provider only — deliberately no real payment integration. |
| `reviewer-notifications.ts`, `business-days.ts` | Email alerts to reviewers and business-day deadline maths. |

## 5. Database — `backend/db/migrations/`

20 numbered SQL migrations, run by `run-migrations.sh`. Main tables: `policies`, `policy_dependents`, `claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log`, `users`, plus WhatsApp and email intake state. Schema is documented in `SPEC.md` §9.

## 6. Frontend — `frontend/portal/` (Next.js)

| Path | What it is |
|---|---|
| `app/claims/new` + `components/ClaimForm.tsx` | Claim submission form. |
| `app/claims/[id]` | Claim status and timeline. |
| `app/tasks`, `app/tasks/[key]` | **Staff review screens**, built on `/api/tasks`. (The spec still says reviewers use the stock Camunda Tasklist.) |
| `app/policies`, `app/audit`, `app/admin/register` | Policy admin, audit trail, staff registration. |
| `lib/api.ts`, `lib/auth-context.tsx` | API client and login session handling. |
| `components/assistant/AssistantChat.tsx` | The claims assistant chat in the portal. |

## 7. Infrastructure and docs

- `docker-compose.yaml` — Postgres 16 and MinIO.
- `camunda-docker/` — the Camunda 8.9 stack (Operate and Tasklist at `localhost:8080`, login `demo`/`demo`). See [`CAMUNDA-DOCKER.md`](CAMUNDA-DOCKER.md).
- `backend/deploy-resources.mjs` — deploys the BPMN, DMN, and forms to Camunda.
- `.claude/specs/` — one design note per feature.
- This `resources/` folder:

| Doc | Contents |
|---|---|
| [`RUNNING-LOCALLY.md`](RUNNING-LOCALLY.md) | How to start the full local stack. |
| [`ROADMAP.md`](ROADMAP.md) | Build-order checklist. |
| [`BUILD-PLAN.md`](BUILD-PLAN.md) | Feature-by-feature build plan. |
| [`PREREQUISITES.md`](PREREQUISITES.md) | Installed tooling, credentials, open decisions. |
| [`HOSTING.md`](HOSTING.md) | Where and how to deploy online for free or near-free. |
| [`GUIDE.md`](GUIDE.md) | Plain-language walkthrough of each `ROADMAP.md` step. |
| [`ClaimFlow-AI-Technical-Specification.md`](ClaimFlow-AI-Technical-Specification.md) | Architecture, workflow and data-processing mechanics. |
| [`CAMUNDA-DOCKER.md`](CAMUNDA-DOCKER.md) | Camunda Docker Compose setup and configuration options. |

## Suggested way in

1. Read `SPEC.md` §1–§5 and §10–§13.
2. Start the stack with [`RUNNING-LOCALLY.md`](RUNNING-LOCALLY.md) (or the `/manage-app` skill).
3. Submit one claim in the portal and follow it in Operate.
4. Read `create-claim.ts` → `validate-claim.ts` → the three AI workers → `routes/tasks.ts`. That covers most of the platform's behaviour.
5. Use the `/case-trace` skill to see one claim's audit log and Camunda history as a single timeline.
