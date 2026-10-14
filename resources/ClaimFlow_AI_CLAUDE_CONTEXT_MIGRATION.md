# ClaimFlow AI — Claude Project Context Migration / Knowledge Transfer

> **Generated:** 2026-10-14, from the repository at `C:\Users\C2\Desktop\Insurance-Claim` (branch `main`, HEAD `12050df`).
> **Remote:** https://github.com/jogendra12345/Insurance-Claim

## How this document was built (read before trusting it)

The Claude instance that wrote this **did not have access to the previous Claude chat conversations** for this project. Chat history doesn't carry between Claude sessions, and there was no saved Claude memory for this project. Everything here comes from what persisted on disk:

| Source | What it gave |
|---|---|
| `SPEC.md` (396 lines) | Source of truth: data model, BPMN, DMN, worker contracts, future work |
| `CLAUDE.md` | Working rules for Claude in this repo |
| `.claude/specs/**` (26 design notes) | Per-feature requirements, decisions, rejected alternatives, lock notes |
| `resources/*.md` | Roadmap, build plan, prerequisites, run guide, hosting notes, platform overview |
| Git history (223 commits, 2026-08-17 → 2026-10-14) | Chronology, reversals, bug root causes, product-direction decisions recorded in commit bodies |
| Source code, migrations, BPMN/DMN files | Verification of the current state |
| `.claude/agents`, `.claude/commands`, `.claude/skills` | Claude tooling built for this project |

Decisions, corrections and preferences that were discussed in chat and **never written into a commit, spec, or doc are not captured here** and are marked UNKNOWN wherever their absence is noticeable. Commit bodies often say "per explicit product direction" or "per user decision". Those are treated as **CONFIRMED** user decisions.

**Confidence labels used:** **CONFIRMED** (stated in spec/doc/commit as decided) · **IMPLEMENTED** (exists in code) · **INFERRED** · **TENTATIVE** · **UNKNOWN**.

**Secrets:** none are included. Only environment-variable names appear. Values must be provided separately. Personal email addresses, phone numbers, Meta account IDs, demo passwords, and the ngrok domain are deliberately omitted; they live in the repo docs/`.env` files.

---

# CURRENT STATE — READ THIS FIRST

**What it is.** ClaimFlow AI is a **Camunda 8–orchestrated health-insurance claims application** with a **Google Gemini** AI layer. A claim flows through one deterministic BPMN process: intake → validation → AI evidence extraction → AI fraud indicators → AI risk score → DMN-suggested routing → **human triage confirmation** → role review (adjuster / investigator / legal) → supervisor sign-off for large approvals → settlement (mock) or denial letter (AI-drafted) → real email notification → close. **AI suggests; humans always decide.** Every step writes to the Postgres `audit_log`.

**Nature of the project.** It is a **demo / test app built to try Claude Code + Camunda together** (BUILD-PLAN note on #26, CONFIRMED), positioned as a product for GCC insurers / TPAs. It is not production. Consequences: settlement stays mocked forever; all outgoing email goes to one fixed test inbox (`TEST_RECIPIENT`).

**Stage.** v1 MVP is **built and runs end to end locally**. These are built and working:
- backend API (Express :4000)
- 17 job workers
- Next.js portal (:3000), with auth and an in-app reviewer task UI
- BPMN/DMN/forms deployed to local Camunda 8.9
- 20 Postgres migrations
- three intake channels: portal form + portal chat assistant, WhatsApp bot, email intake

**Latest work (2026-09-29 → 2026-10-14):**
- multi-channel intake hardening: WhatsApp signature check, Graph API v26, ngrok static tunnel, cross-channel lookup
- portal chat assistant
- email claim intake (built and partially live-verified)
- resilience: Gemini model fallback; the API now survives a Camunda outage
- per-tab JWT auth and the first automated tests
- handover docs: `resources/PLATFORM-OVERVIEW.md`, the as-built tech spec, the user guide PDF, a CLAUDE.md refresh, and a WhatsApp/Meta setup guide (the last commit)

**Still open (from `resources/ROADMAP.md`):**
- **Step 6:** live walkthrough of Adjuster / Investigator / Legal Review and Supervisor Sign-off as distinct real users. Triage was already verified this way.
- **Step 7:** live walkthrough of the `moreInfo` → claimant resubmission → same-reviewer loop.
- **Step 7:** investigator-deny path, which was never literally run.
- **Step 7:** full multi-user walkthrough.
- Email intake: CONFIRM → claim creation, reminder and expiry not yet verified live.

**What should happen next (INFERRED from the open items):**
1. Finish ROADMAP steps 6–7 by live walkthroughs.
2. Verify the remaining email-intake paths.
3. Fix doc drift. SPEC §2 "Non-goals" and §5/§6 still say "no auth", "stock Tasklist", "no moreInfo loop", "Resend". All of that has been superseded.
4. Then pick from SPEC §14 future work. The user decides the priority.

---

# 1. Project identity & overview

| Item | Value |
|---|---|
| Name | **ClaimFlow AI** ("Claims Orchestration with AI Triage") |
| Type | Full-stack web app + workflow orchestration + AI workers |
| Category | Insurance claims management / InsurTech |
| Domain | Health insurance claims (v1); designed to extend to vehicle, property, travel |
| Status | v1 MVP, running locally; demo/test app |
| Repo authors | `aayaan1999` (≈215 commits, implementation) and `jogendra12345` (8 commits: initial Camunda setup, spec, roadmap, guide; owns the GitHub remote). Most commits are co-authored by Claude. |

**Problem (CONFIRMED, SPEC §1).** GCC insurers run legacy, batch-oriented, siloed claims platforms. Updates entered mid-day often don't show until an overnight batch. That causes slow cycle times and inconsistent, labour-intensive manual fraud review. ClaimFlow cuts cycle time and standardises fraud detection **without removing human judgment**.

**Target customers (CONFIRMED).**
- Composite and P&C insurers in UAE / KSA / GCC.
- Takaful operators (general claims).
- MGAs and TPAs processing for multiple carriers. This is why `carrier_id` is first-class.

**Personas / users.**
- **Claimants:** policyholders and their dependents.
- **Triage team:** confirms or overrides the AI's routing.
- **Adjusters:** handle standard claims.
- **Investigators (SIU):** handle claims with fraud signals.
- **Legal reviewers:** handle high-value or liability claims.
- **Supervisors:** maker-checker sign-off; SLA escalation endpoint.
- **Admins:** policies, staff registration.

**Core principles (CONFIRMED):**
- A human confirms every AI routing and makes every final decision.
- Full audit trail.
- The process is insurance-type-agnostic.
- Real Camunda 8.
- Real Gemini calls.

**Terminology:** see §25 glossary.

---

# 2. Project history

### Phase 0: concept and scaffolding (2026-08-17 → 08-19)
- Camunda 8.9 lightweight Docker Compose stack plus `claim-lifecycle.html` (industry reference).
- SPEC rewritten from a "generic single-adjuster MVP" into ClaimFlow AI. That rewrite added role-based routing, AI fraud indicators, the human triage gate, supervisor sign-off, and the audit trail.
- 7-step ROADMAP.
- Decision: **health-only v1 with extension points** for other types.
- CLAUDE.md, the `/create-spec` command, skills.
- Migration 0001: claims, claim_documents, claim_fraud_indicators, audit_log. Raw SQL, no ORM.

### Phase 1: portal, API, storage (08-20 → 08-21)
- Next.js portal; Express + pg API; `POST/GET /api/claims`.
- Visual redesign: Fraunces + IBM Plex fonts, a 4-step wizard.
- Policies table (0002) and policy CRUD.
- At least one document required.
- Document storage: local disk `/uploads` → **MinIO** (public-read bucket).

### Phase 2: Camunda + AI workers (08-21 → 08-31)
- BPMN + DMN + Zeebe kickoff.
- Premium/coverage (0003).
- FNOL extended fields (0006).
- **AI provider switched from Claude to Gemini** (08-25), because the API key provided was a Gemini key.
- Workers built: validate-claim and extract-evidence, then fraud and risk.
- Bug-hunt hardening; **Triage Review made mandatory**.
- capture-* workers; Camunda Forms; reject-at-triage; validation-exception resolve/reject.
- Duplicate-claim check; authorized claimants + `policy_dependents` (0008).
- Rich Tasklist form template.
- Last four workers (settlement, denial letter, notify, close; 0009). **Real email via Resend.**
- ICD-10 autocomplete via the NLM free API.

### Phase 3: auth, in-app tasks, backlog (09-01 → 09-16)
- Decision 09-04: **Option B app-level auth**. `users` table (0010), `/api/tasks` proxy to Tasklist, staff `/tasks` page.
- Admin staff registration.
- Forgot-password OTP (0011).
- Reviewer notification emails.
- **SLA escalation** with business-day timers and a Supervisor Review task (0012).
- Narrative-vs-document fraud check.
- Public landing page.
- Triage note (0013).
- **moreInfo resubmission loop** (0014).
- Staff audit-trail view.
- Time-zone standardisation.
- Phone-based authorisation + `claims.channel` (0015).
- **WhatsApp claims assistant** (0016).
- `/manage-app` skill.

### Phase 4: multi-channel, hardening, handover (09-29 → 10-14)
- WhatsApp: signature verification, Graph API v26, readable status replies, ngrok static domain, UX fixes, dedup (0017), cross-channel lookup.
- Gemini model fallback.
- Portal chat assistant.
- Per-tab JWT (0018) and the first test suites.
- Email intake (0019, 0020).
- API survives a Camunda outage.
- Docs moved to `resources/`; PLATFORM-OVERVIEW; CLAUDE.md refresh; WhatsApp setup guide.

### Key evolutions (old → problem → current)

| Topic | Evolution | Current (FINAL) |
|---|---|---|
| AI provider | Claude API in the original spec → user provided a Gemini key (08-25) | **Gemini** via `backend/shared/gemini-client.ts` |
| Gemini model | `gemini-flash-latest` gave 503s → the env example was pinned to a specific flash model → on 09-29 all Flash models returned 503 for 20+ min | Primary `GEMINI_MODEL` (code default `gemini-flash-latest`), plus ordered `GEMINI_FALLBACK_MODELS` on 429/500/502/503/504. Audit records the model that actually answered. Temperature 0. |
| Claim amount | Strictly below coverage → auto-computed by a simulated adjudication (deductible/copay/coinsurance, migration 0004) → it wiped many amounts to $0 → **management decision to drop it** (reverted; 0004 deleted; 0005 drops the columns with `IF EXISTS`) | "Requested claim amount", which must be **≤ coverage_amount** |
| Triage | BPMN "auto" bypass let low-risk claims skip human review → contradicted "human confirms every routing" → bypass removed → the DMN "auto" output was also removed | **Every claim goes to Triage Review.** The catch-all suggests `adjuster`. |
| Validation exception | Reject-only → resolve with policy-number correction → correction removed (it let `policy_id` stay NULL) → Resolve hidden when no policy matched → **product direction: Approve always allowed**, even with no policy match | Approve/Reject. Approve may continue with `policy_id = NULL`, flagged `overrodeNoPolicyMatch`, and the reviewer is the sole check |
| Review UI | Stock Camunda Tasklist + Camunda Forms → no multi-user identity in the lightweight stack | **App-level auth + custom `/tasks` UI** proxying Tasklist v2 with one server-side `demo` credential |
| Sessions | Signed cookie, 7 days → browser-session cookie → a shared cookie prevented side-by-side demo users in different tabs | **Per-tab JWT in `sessionStorage`**, `users.token_version` revocation, `SESSION_TTL_HOURS` default 8 |
| Notifications | Mock only → Resend (sandbox delivers only to the account owner) → Gmail SMTP added and preferred | Gmail SMTP → Resend → console mock. **All mail redirected to `TEST_RECIPIENT`** (test mode). |
| Escalation | Manual investigator→legal escalation drafted alongside SLA escalation → manual dropped (product direction: automatic only) → PT24H literal → business-day-aware | Interrupting timer boundary events, 24 business hours (US federal holidays hard-coded) |
| Time zones | All display pinned to UTC → reversed | Each viewer's local zone, with the IANA zone name shown |
| Audit UI | Two side-by-side grids → reverted | Policy → claims → timeline drill-down, newest first |
| Claim form layout | Wizard → single-scroll → wizard → two-column live summary → brand panel → **reverted** | Single-column stepper with a 70/30 illustration column |
| WhatsApp tunnel | Cloudflare quick tunnel (new URL on every restart) | ngrok free static domain, `npm run tunnel` |
| Email intake inbox | Dedicated inbox | Plus-address (`you+claims@…`) on a shared Gmail, with an optional `EMAIL_INTAKE_UNTIL` end date. No longer relies on the unread flag. |
| Docs | Root-level docs; spec PDF | `resources/` folder; role-by-role user guide PDF in `docs/`; client demo decks gitignored |

---

# 3. Complete requirements

## Functional (all IMPLEMENTED unless noted)
1. Claimants submit health claims through the portal form, the portal chat, WhatsApp, or email. Every channel ends in the same `createClaim()` in `backend/api/src/create-claim.ts`.
2. A submission contains:
   - policy, claim type, claimant info, incident date and description, requested amount
   - ICD-10 diagnosis, CPT/HCPCS procedure, provider (NPI, tax ID, facility name and address)
   - service dates, total billed amount, coordination of benefits, attestation
   - **at least one document** (≤10 MB each)
3. One Camunda process instance per claim. There is a guard against duplicate instances.
4. Automated validation:
   - required fields
   - policy exists, matching on number + carrier
   - policy active, with the incident date inside its coverage window
   - no other in-flight claim on the policy
   - authorized claimant, checked per channel
5. AI steps:
   - evidence extraction + case summary
   - fraud indicators against fixed categories
   - risk score 0–100 with reasoning
   - denial letter drafting
6. DMN suggests a reviewer role. A human triage reviewer confirms it, overrides it, or rejects the claim outright.
7. A role reviewer decides approve / deny / moreInfo.
8. Approvals over 50,000 need supervisor sign-off.
9. moreInfo loop:
   - the claimant is emailed
   - the claimant uploads documents and a note in the portal
   - the claim returns to the same reviewer
   - no cap, no timeout
10. SLA: 24 business hours per review task, then automatic escalation (§12).
11. Settlement is mocked. A denial letter is drafted. The claimant gets a real email in all three outcomes.
12. Audit log row for every automated and human step. Staff audit-trail page.
13. Auth:
    - claimant self-signup, gated on policy number + email match
    - staff accounts created by an admin
    - forgot-password OTP
14. Policy management (admin): create (with dependents and phones), view, delete.
15. Reviewer notification emails when a task lands for their role.
16. Claimant views: their own claims, status, timeline, pending moreInfo task.
17. Claims assistant (WhatsApp, email, portal chat): check claim status, check policy status, raise a claim.

## Non-functional
- **Reliability:**
  - Zeebe retries 3 times, then an Operate incident.
  - The API caps Camunda retries to avoid duplicate instances.
  - The API survives Camunda outages.
  - Gemini falls back across models.
  - Idempotent `close-case`.
  - Dedup tables for WhatsApp and email messages.
- **Determinism:** Gemini temperature 0; rubric-based scoring.
- **Security:** see §23.
- **Maintainability:**
  - Insurance-type extensibility without touching the BPMN.
  - Thin routes.
  - Shared code only once a second consumer needs it.
- **Resources:** must run on an **8 GB Windows dev machine**. The Camunda orchestration container is limited to 2560m and Connectors were removed. `/manage-app stop` frees vmmem with `wsl --shutdown`.
- **Usability / accessibility:**
  - Status never shown by colour alone.
  - Plain claimant-facing language.
  - Never clear a user's typed data on error.
  - Responsive layout, full-screen chat at phone width.
- Scalability and availability targets: **UNKNOWN / NOT SPECIFIED** (local demo).

## Business requirements
See §12 Business logic.

## Technical requirements
See §5, §6, §24.

## UI/UX requirements
See §11.

---

# 4. Feature inventory

| Feature | Status | Key files / notes |
|---|---|---|
| Portal claim submission (stepper form) | COMPLETED | `components/ClaimForm.tsx`, `app/claims/new`. ICD-10 autocomplete (NLM API); CPT autocomplete **rejected** (AMA-licensed). |
| Claim storage + MinIO docs | COMPLETED | `create-claim.ts`, `storage.ts`. Bucket `claim-documents` is public-read (dev only). |
| Process kickoff | COMPLETED | `api/src/zeebe.ts`. Bounded retries, then cancels duplicate instances with the same claimId. |
| validate-claim | COMPLETED | Policy, window, duplicate, authorized-claimant (channel-scoped); computes DMN red flags. |
| extract-evidence / detect-fraud-indicators / score-risk | COMPLETED | Gemini, rubric-based, type-aware via `insurance-types/health.ts`. |
| DMN routing | COMPLETED | `process/health-claim-routing.dmn`, 7 rules, FIRST. |
| Triage Review (confirm / override / reject, triage note) | COMPLETED; live-verified as a real triage user | |
| Role reviews (adjuster / investigator / legal) | COMPLETED; **multi-user live walkthrough PARTIAL** | ROADMAP step 6. |
| Supervisor Sign-off (>50k) | COMPLETED; verified with `demo` | Real-user walkthrough pending. |
| Validation Exception Review | COMPLETED | Approve may proceed with no policy. |
| moreInfo resubmission loop | COMPLETED (built 09-11); **live walkthrough pending** | `pending-task` / `resubmit` endpoints. |
| SLA escalation + Supervisor Review | COMPLETED | Interrupting timers; `auto-*` workers. |
| Settlement | COMPLETED (mock); real provider **REMOVED from plan** | `settlement-provider.ts`. |
| Denial letter | COMPLETED (text only); PDF PLANNED | |
| Claimant notification email | COMPLETED (test-mode redirect) | |
| Close case | COMPLETED | Idempotent. |
| Auth / roles / JWT / signup / staff registration | COMPLETED | `auth.ts`, `/admin/register`. |
| Forgot password OTP | COMPLETED | |
| In-app task UI (`/tasks`, `/tasks/[key]`) | COMPLETED | Proxies Tasklist. Local state is updated from action results because the Tasklist index lags. |
| Task page claim-details card | COMPLETED | A duplicate "as submitted" section was removed at user request. |
| Reviewer notification emails | COMPLETED (test-mode redirect) | |
| Staff audit-trail view (`/audit`) | COMPLETED | |
| Time-zone standardisation | COMPLETED | `lib/time.ts`. |
| Public landing page | COMPLETED | `components/landing/*`. |
| WhatsApp claims assistant | COMPLETED; live-verified on Meta test number | Test sandbox only (≤5 recipients). |
| Portal chat assistant | COMPLETED | `components/assistant/*`, claimant-only. |
| Email claim intake | COMPLETED / PARTIALLY verified | Off unless `EMAIL_INTAKE_ENABLED=true`. |
| Dynamic form builder | PLANNED (Draft spec, placeholder) | `.claude/specs/generic/dynamic-form-builder.md`. |
| Additional insurance types | NOT STARTED (extension points exist) | Use `/add-insurance-type`. |
| Per-carrier tenant isolation | NOT STARTED | |
| Cross-role manual escalation | REMOVED (replaced by SLA auto-escalation) | |
| Error boundary events | NOT STARTED | |
| Editing dependents on an existing policy | NOT STARTED | |
| Camunda SaaS / cloud hosting | NOT STARTED | `resources/HOSTING.md`. |
| Selectable document viewer; "audit log latest action" read fix; policy creation enhancements | PLANNED (SPEC §14) | |

---

# 5. Current technical architecture

```
Portal (Next.js :3000) / WhatsApp (Meta webhook via ngrok) / Email (IMAP poller)
          │
          ▼
backend/api (Express :4000) ──► Postgres 16 (claims, policies, users, audit_log, intake state)
          │                  └─► MinIO (claim-documents bucket)
          ▼ createProcessInstance (one per claim)
Camunda 8.9 self-managed, lightweight (Zeebe + Operate + Tasklist, H2, single demo user)
          │
          ├─► backend/workers (17 job workers; Gemini for AI steps; Gmail/Resend email)
          ├─► DMN health-claim-routing-decision (selected by decisionIdExpression)
          └─► User tasks → worked in portal /tasks via /api/tasks proxy (server-side demo credential)
```

- **Auth boundary:** the app's own `users` table and JWT. Camunda is a trusted backend and never exposed to end users. Tasklist at `:8080/tasklist` still works for debugging.
- **Two sets of infra clients:**
  - API: `api/src/db.ts`, `api/src/zeebe.ts`. Retries are capped, because a retried `createProcessInstance` can start a duplicate.
  - Workers: `shared/db.ts`, `shared/zeebe-client.ts`.
  - **Change both** when changing connection settings.
- **Process variables** carry full case context so the review forms can render it: policyholder, coverage, codes, provider, and `documents` as `{name,url,contentType,dataUri}`. Images ≤2 MB go inline as data URIs because the Tasklist CSP blocks external images.
- **Logging/monitoring:** `audit_log` (business history), Camunda Operate (technical history), console logs. No external monitoring.
- **CI/CD:** none. Deployment: local only.

---

# 6. Technology stack

| Tech | Version | Use |
|---|---|---|
| Node.js / TypeScript | TS ^5.5; Node version NOT SPECIFIED | API and workers |
| Express | ^4.19.2 | API |
| `@camunda8/sdk` | ^8.8.13 | Zeebe gRPC/REST client |
| Camunda 8 Self-Managed | 8.9.16 (orchestration), lightweight compose, H2 | Engine, Operate, Tasklist |
| Camunda Desktop Modeler | 5.50.1 | BPMN/DMN editing |
| PostgreSQL | 16 (`postgres:16-alpine`, Docker) | App DB |
| `pg` | ^8.12.0 | DB driver (raw SQL, **no ORM**) |
| MinIO | `quay.io/minio/minio` image; `minio` npm ^8.0.0 | Document storage |
| multer | ^2.0.0 | Uploads |
| bcryptjs / jsonwebtoken | ^2.4.3 / ^9.0.3 | Passwords / JWT (HS256) |
| nodemailer | ^6.10.1 | Gmail SMTP |
| Resend | API (no SDK pinned) | Secondary email |
| imapflow / mailparser | ^2.2.7 / ^3.9.36 | Email intake |
| Google Gemini API | Model set by env | All AI |
| Meta WhatsApp Cloud API | Graph API v26.0 | WhatsApp bot |
| ngrok | free static domain | WhatsApp webhook tunnel |
| Next.js / React | ^14.2 / ^18.3 (App Router) | Portal |
| lottie-react | ^2.4.1 | Illustrations |
| Vitest (+ Supertest, jsdom) | ^3.2.7 | Tests |
| Playwright | NOT SPECIFIED | Camunda stack tests (`camunda-docker/tests*`) |
| tsx | ^4.16 | Dev runner |
| Docker Desktop / Compose | 29.6.2 / v5.3.1 | Infra. **Use the standalone `docker-compose` binary** on this machine. |
| OS | Windows 11, 8 GB RAM | Dev machine |

Styling: inline styles + CSS variables, **no Tailwind** (bug-fixer agent rule). Fonts: Fraunces + IBM Plex.

---

# 7. Codebase structure

```
/
├── SPEC.md, CLAUDE.md, claim-lifecycle.html (large industry reference), docker-compose.yaml (Postgres + MinIO)
├── claimflow_data.sql (sample data dump), setup.png
├── process/        claim-case-process.bpmn, health-claim-routing.dmn, forms/{triage-review,review-decision,validation-exception-review}.form
├── camunda-docker/ docker-compose.yaml (lightweight), -full.yaml, -web-modeler.yaml, tests/, tests-lightweight/ (Playwright)
├── backend/
│   ├── package.json (npm run migrate), deploy-resources.mjs (deploy BPMN/DMN/forms; rerun after every process change)
│   ├── db/ run-migrations.sh, migrations/0001…0020 (0004 intentionally absent)
│   ├── api/src/ index.ts, app.ts, auth.ts, create-claim.ts, claims-assistant.ts, claim-field-parsers.ts,
│   │            email-intake{,-form,-mailer,-poller}.ts, whatsapp-client.ts, serializers.ts, storage.ts, db.ts, zeebe.ts,
│   │            routes/{auth,claims,policies,providers,tasks,whatsapp,assistant}.ts
│   │   scripts/ seed-demo-users.ts, tunnel.ts ; test/ auth, email-intake, email-intake-form
│   ├── workers/ index.ts + 17 job files
│   └── shared/ audit-log, gemini-client, db, zeebe-client, email-sender, notification-provider, settlement-provider,
│               reviewer-notifications, business-days, short-claim-id, insurance-types/health.ts
├── frontend/portal/ app/ (/, login, signup, forgot-password, claims/new, claims/[id], policies, policies/[id], tasks, tasks/[key], audit, admin/register)
│                    components/ (ClaimForm, ClaimTable, PolicySelect, ProviderSelect, IcdCodeSelect, StatusBadge, TopBar, ThemeToggle, Pagination, ConfirmDialog, EmptyState, HeroIllustrations, landing/*, assistant/*)
│                    lib/ (api.ts, auth-context.tsx, auth-session.ts, types.ts, time.ts, icd10.ts, claim-id.ts, policy-status.ts, animations/)
│                    tests/ auth-session.test.ts
├── resources/ ROADMAP, BUILD-PLAN, PREREQUISITES, RUNNING-LOCALLY, PLATFORM-OVERVIEW, HOSTING, GUIDE, CAMUNDA-DOCKER,
│              ClaimFlow-AI-Technical-Specification.md (as-built), INTEGRATE-WHATSAPP.md, this file
├── docs/ User guide PDF + client demo decks (decks gitignored)
└── .claude/ agents/, commands/, skills/, specs/{generic,worker,db}/
```

**Workers (17):**
- validate-claim
- extract-evidence, detect-fraud-indicators, score-risk, draft-denial-letter (Gemini)
- capture-routing-decision, capture-triage-review, capture-review-decision, capture-signoff, capture-validation-exception, capture-claimant-resubmission
- auto-confirm-triage, auto-escalate-review, auto-reject-validation-exception
- trigger-settlement, notify-claimant, close-case

**Conventions:**
- Routes stay thin.
- Business logic used by multiple channels sits at the top level of `api/src`.
- `shared/` only when a second consumer exists.
- New screen = a folder under `app/`; reused UI goes in `components/`; non-visual helpers go in `lib/`. Imports use the `@/` alias.

**Do not change casually:**
- `create-claim.ts`: the single entry for all channels.
- `gemini-client.ts`
- `audit-log.ts`
- `routes/tasks.ts`
- `api/src/zeebe.ts`: duplicate-instance guard.
- The BPMN.

---

# 8. Database & data model

PostgreSQL 16, raw SQL migrations, forward-only, tracked in `schema_migrations`, applied by `backend/db/run-migrations.sh` through `docker-compose exec postgres psql`. **Full column-level schema: `SPEC.md` §9.** Summary:

| Table | Purpose / notable fields |
|---|---|
| `policies` | `policy_number` UNIQUE, `carrier_id`, `insurance_type`, policyholder name/email/phone, `status` (active/lapsed/cancelled), effective/expiry dates, `premium_amount` ≥0, `coverage_amount` >0 |
| `policy_dependents` | `policy_id` FK, `full_name`, `email`, `phone`, `relationship` (spouse/child/other); UNIQUE(policy_id,email). Set only at policy creation. |
| `claims` | carrier_id, insurance_type, policy_number (as typed), policy_id (nullable FK, RESTRICT), claim_type (outpatient/inpatient/pharmacy/dental/maternity/other), claimant name/email/phone, `channel` (portal/whatsapp/email), incident date/description, `claim_amount`, `status`, AI fields (`case_summary`, `risk_score`, `risk_reasoning`, `fraud_indicator_count`), routing fields (`assigned_role`, `confirmed_role` — CHECK still includes legacy `auto` plus `supervisor`), `triage_note`, `decision`, `denial_reason`, `info_requested_reason`, `process_instance_key`, FNOL fields (`provider_id` NOT NULL FK, `diagnosis_code`, `procedure_code`, service dates, `total_billed_amount`, `coordination_of_benefits`, `attestation_signed_at` set server-side), `settlement_id`, `denial_letter_text` |
| `providers` | `npi` UNIQUE (10 digits, CHECK), tax_id, facility name/address. Find-or-create by NPI: **existing row wins, new details discarded** |
| `claim_documents` | `file_url` (MinIO, baked with `localhost:9000`), `document_type`, `extracted_data` jsonb |
| `claim_fraud_indicators` | type, description, confidence 0–1 (all confidences stored; only ≥0.5 counted) |
| `audit_log` | claim_id (NOT NULL FK), `actor_type` system/ai/human, `actor_id`, `action`, `detail` jsonb |
| `users` | email (unique lower), bcrypt `password_hash`, `role` CHECK (7 roles), reset OTP fields (0011), `token_version` (0018) |
| `whatsapp_sessions` | per phone: mode, collected_fields, documents, status |
| `whatsapp_processed_messages` | dedup by Meta message id |
| `email_claim_drafts` | per-thread draft: collected/invalid/low-confidence fields, documents, sent_forms, status (collecting/awaiting_confirmation/submitted/abandoned/expired), claim_id |
| `email_intake_events` | audit for email intake. A separate table because `audit_log.claim_id` is NOT NULL and drafts don't have a claim yet |
| `email_processed_messages` | dedup |

**Claim status values:** `submitted`, `validating`, `triage`, `in_review`, `approved`, `denied`, `awaiting_info`.

**Design decisions:**
- `insurance_type` has no CHECK, so a new type needs no migration.
- Child tables `ON DELETE CASCADE`; `policy_id` / `provider_id` `RESTRICT`.
- Code formats (ICD, CPT, tax ID) are validated in the app, not by DB CHECKs.

**Migration gotchas:**
- **0004 is intentionally missing.** It was reverted, and 0005 uses `DROP COLUMN IF EXISTS`.
- 0001 was edited in place early, before it had been applied anywhere.
- Sample data: `claimflow_data.sql`; demo users: `npm run seed:demo-users`.

---

# 9. API documentation

All routes are under `/api` and mounted in `backend/api/src/app.ts`. `attachUser` parses the Bearer JWT on every request. Full request/response shapes are in the route files and `serializers.ts`.

| Method & path | Auth | Purpose |
|---|---|---|
| POST `/auth/signup` | public | Claimant signup: email + password + policyNumber. Email must match policyholder or dependent. Generic 400 on failure. Role is always `claimant`. |
| POST `/auth/register-staff` | admin | Create a staff account |
| POST `/auth/forgot-password` | public | Always 200. 6-digit OTP, 10 min expiry, 60 s resend cooldown |
| POST `/auth/verify-otp` | public | {email, otp, newPassword ≥8}. Generic 400. Max 5 attempts. Bumps `token_version`. Does not log the user in |
| POST `/auth/login`, `/auth/logout`, GET `/auth/me` | — / — / auth | Session |
| GET `/claims` | auth | Claimants: only their own (matched on email). Staff: all |
| GET `/claims/:id` | auth | Detail (nested provider, documents, etc.) |
| GET `/claims/:id/audit-log` | staff (claimant 403) | Filters `actorType`, `from`, `to`. Newest first |
| GET `/claims/:id/pending-task` | auth, owner | The claimant's moreInfo task |
| POST `/claims/:id/resubmit` | owner | Files + note. Completes the claimant task |
| POST `/claims` | auth | Create a claim (multipart). `source=chat` from the portal assistant. 400s include `field` |
| GET `/policies`, `/policies/:id` | auth (claimant-scoped) | List / detail with dependents |
| POST `/policies` | admin | Create, with optional dependents and phones |
| DELETE `/policies/:id` | admin | Friendly message if claims block it (RESTRICT) |
| GET `/providers` | public | Provider lookup |
| GET `/tasks`, GET `/tasks/:key`, POST `/tasks/:key/{claim,unclaim,complete}` | staff | Tasklist v2 proxy. Role → candidate group enforced server-side (403 on mismatch). Admin sees all groups |
| GET/POST `/whatsapp/webhook` | Meta verify token / HMAC `X-Hub-Signature-256` | WhatsApp bot |
| GET `/assistant/claims`, `/assistant/claims/:id` | claimant | Portal chat lookups |

---

# 10. Third-party services & integrations

| Service | Purpose | Config (names only; values must be provided separately) | Limits / notes |
|---|---|---|---|
| Google Gemini | Extraction, fraud, risk, denial letters, email-intake parsing | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` (in `backend/workers/.env` **and** `backend/api/.env`) | 503 "high demand" outages seen; fallback handles them |
| Camunda 8 | Orchestration | API: `ZEEBE_*` / Camunda SDK env; Operate/Tasklist login `demo` | Lightweight: no Identity; single user |
| Gmail SMTP | Preferred email sender | `GMAIL_USER`, `GMAIL_APP_PASSWORD` | ~500/day; sends from a personal address |
| Resend | Secondary email | `RESEND_API_KEY` | Sandbox delivers only to the account owner until a domain is verified |
| Meta WhatsApp Cloud API | Bot | `WHATSAPP_ACCESS_TOKEN` (non-expiring system-user token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Test number; ≤5 pre-approved recipients; only replies to user-initiated messages (free 24 h window); no Flow Builder access, so the bot uses plain-text Q&A |
| ngrok | Public HTTPS for the webhook | ngrok authtoken (in the ngrok config) | Static free domain; run with `npm run tunnel` |
| Gmail IMAP | Email intake | `EMAIL_INTAKE_ENABLED`, `EMAIL_INTAKE_ADDRESS`, `EMAIL_INTAKE_IMAP_USER`, `EMAIL_INTAKE_IMAP_PASSWORD`, `EMAIL_INTAKE_IMAP_HOST`, `EMAIL_INTAKE_POLL_SECONDS`, `EMAIL_INTAKE_UNTIL`, `EMAIL_INTAKE_REMINDER_DAYS`, `EMAIL_INTAKE_EXPIRY_DAYS`, `EMAIL_INTAKE_AUTHSERV_ID` | Upgrade path: inbound-parse webhook once a domain exists |
| NLM Clinical Tables API | ICD-10 autocomplete (free) | — | CPT lookup rejected because it is AMA-licensed |
| MinIO | Documents | `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` | Public-read bucket (dev only) |
| Settlement | Mock only | — | **Never wire a real payment provider** |

The WhatsApp setup walkthrough is in `resources/INTEGRATE-WHATSAPP.md` and `RUNNING-LOCALLY.md` §8.

---

# 11. UI/UX & design system

**Pages:**
- `/`: landing page when logged out (no API calls, so no 401 banners); claims list when logged in.
- `/login`, `/signup`, `/forgot-password` (2-step).
- `/claims/new`: stepper form.
- `/claims/[id]`: detail, timeline, moreInfo card, "Filed via" channel.
- `/policies`, `/policies/[id]`: admin add panel with dependents.
- `/tasks`, `/tasks/[key]`: staff review, with a claim-details card and a show/hide toggle per document.
- `/audit`: staff drill-down.
- `/admin/register`: staff account creation.
- Floating chat assistant for claimants: bottom-right, full-screen on phones.

**Visual system:**
- Fraunces + IBM Plex fonts.
- Light/dark theme toggle.
- Inline styles + CSS variables (no Tailwind).
- Lottie illustrations.
- Claim form: single-column stepper with a 70/30 illustration column.

**Explicitly approved / required:**
- Status shown with label + glyph, never colour alone.
- Loading, empty and error states everywhere.
- Typed data is never cleared on error.
- Cascading buttons rather than dropdowns for task decisions.
- Times shown in the viewer's local zone with the IANA name.
- Plain claimant-facing copy, never raw status codes.
- **No em dashes in user-facing copy.**
- Claimants never see risk or fraud data.
- The claim form's email field is locked to the account email (fixes "claims missing from My Claims").
- "Submit a Claim" is visible to claimants.

**Rejected:** see §17.

---

# 12. Business logic

1. **Coverage:** `claim_amount ≤ policies.coverage_amount`. Enforced client-side (ClaimForm) and at intake. `total_billed_amount` is informational only: it is not used in validation, risk, DMN, or settlement.
2. **validate-claim:**
   - Required fields come from `insurance-types/<type>.ts`.
   - Policy matched by `policy_number + carrier_id`.
   - Policy `status='active'` and `incident_date ∈ [effective, expiry]`.
   - **One in-flight claim per policy:** any other claim with `status NOT IN ('approved','denied')` fails validation.
   - **Authorized claimant, by channel:**
     - `portal`: claimant **email OR name** (case-insensitive) matches the policyholder or any dependent.
     - `whatsapp`: **phone only**, exact match.
     - `email`: **verified sender email only**, case-insensitive, no name fallback.
   - Any failure goes to **Validation Exception Review** (human), never to an automatic denial.
   - Outputs `daysSincePolicyEffective` and `claimantClaimCountLast12Months` (case-insensitive email match).
3. **Fraud:**
   - Fixed categories: claimant identity mismatch, cross-document mismatch, coding/billing mismatch, missing/placeholder docs.
   - All indicators are stored, but only `confidence ≥ 0.5` counts toward `fraud_indicator_count`.
   - Narrative-vs-document mismatches are also checked.
4. **Risk:**
   - 0–100 rubric: 0–19 low, 20–39 low-moderate, 40–59 moderate, 60–79 high, 80–100 severe.
   - Mismatches described in the summary must be weighed even when the fraud count is 0.
5. **DMN `health-claim-routing-decision`** (FIRST hit policy; rules in order):

   | # | Rule | Role |
   |---|---|---|
   | 1 | amount > 50000 | legal |
   | 2 | fraud ≥ 1 | investigator |
   | 3 | daysSincePolicyEffective ≤ 14 | investigator |
   | 4 | claimant claims in 12 months ≥ 3 | investigator |
   | 5 | risk ≥ 40 | adjuster |
   | 6 | amount > 5000 | adjuster |
   | 7 | otherwise | adjuster |

   Legal comes first so that a large claim always reaches legal. Thresholds are placeholders. The table is selected at runtime by `=insuranceType + "-claim-routing-decision"`.
6. **Triage** (`triageAction`):
   - `review`: requires `confirmedRole`, optional `triageNote`. An override is logged when confirmed ≠ assigned.
   - `reject`: requires `denialReason` and goes to the denial path.
   - Gateways default to continue / adjuster, so an unset value can't deadlock the process.
7. **Role review:**
   - Decision `approve` / `deny` / `moreInfo`.
   - Status mapping: approve → `approved`, deny → `denied`, moreInfo → `awaiting_info`.
   - Deny requires a reason; moreInfo requires a reason.
8. **Supervisor sign-off:** required for approved claims over 50000. The threshold is duplicated in the BPMN gateway and in the reviewer-notification code (a known open question).
9. **moreInfo:**
   - The claimant is emailed and completes `Claimant Provide More Info` in the portal. This task has no candidate group and is located by processInstanceKey + element id.
   - `capture-claimant-resubmission` returns the claim to the **same** role.
   - The AI steps are **not** re-run. No loop cap and no timeout.
   - Original claim fields can't be edited.
10. **SLA:**
    - Deadline = 24 business hours from the moment the task starts, skipping weekends and hard-coded US federal holidays (`business-days.ts`).
    - Timers are interrupting. On timeout:
      - Validation Exception → auto-reject.
      - Triage → auto-confirm the AI role.
      - Adjuster → Investigator → Legal → **Supervisor Review**, which has real decision authority.
    - No SLA on supervisor tasks or on the claimant's task.
11. **Close-case** idempotently re-writes the final status.
12. **Roles → candidate groups:**

    | App role | Candidate group |
    |---|---|
    | triage-team | triage-team |
    | adjuster | adjusters |
    | investigator | investigators |
    | legal-reviewer | legal-reviewers |
    | supervisor | supervisors |
    | admin | all groups |
    | claimant | none |

    Staff roles are never self-selectable, and the server never accepts a role from the client.
13. **Signup** requires the email to match the policyholder or a dependent of the given policy.
14. **Email intake:**
    - Known-sender gate; unknown senders are answered at most once per 24 h.
    - SPF/DKIM/DMARC checked via the topmost `Authentication-Results` header.
    - Code-first parsing, then Gemini. AI may only fill blank lines, and those are marked "?".
    - Codes are never inferred.
    - Explicit `CONFIRM` before submit.
    - Reminder after 3 days, expiry after 14.
    - Attachments: PDF/JPEG/PNG/HEIC, 10 MB each, 10 per draft.
15. **WhatsApp:**
    - Unknown numbers are rejected up front.
    - Status updates go by email only.
    - Status replies use portal labels and the AI summary, never risk or fraud data.

---

# 13. Important project decisions

| Decision | Context / reason | Alternatives rejected | Status |
|---|---|---|---|
| One BPMN instance per claim + `audit_log` as case history | Camunda 8 has no CMMN | Separate case engine | FINAL |
| Health only in v1; process is type-agnostic | Scope; future lines added via config + DMN | Branching inside the BPMN | FINAL |
| Raw SQL migrations, no ORM (2026-08-19) | Small, stable schema | ORM DSL | FINAL (revisit if a typed query layer is needed) |
| Node/TypeScript everywhere | Consistency | Spring Boot, Python workers | FINAL |
| Gemini as the AI provider (2026-08-25) | The key that was provided | Claude API (original spec) | FINAL |
| Mandatory human triage; no "auto" role | Human confirms every routing | Auto-bypass | FINAL |
| Validation exception Approve allowed with no policy match | Product direction: humans may override | Blocking / incident | FINAL (risk accepted) |
| App-level auth "Option B" (2026-09-04) | Lightweight Camunda has a single user; the machine is RAM-constrained | Keycloak via compose-full (RAM); Camunda SaaS; OAuth | FINAL |
| Per-tab JWT (2026-10-05) | Side-by-side demo users in different tabs | Shared cookie | FINAL |
| Login required for `POST /api/claims`; admin for `POST /api/policies` | User decision | Open endpoints | FINAL |
| Settlement mock forever | Demo app | Stripe/ACH | FINAL |
| Real email; Gmail preferred; test redirect | Resend sandbox limits; seeded `@example.com` addresses | Mock only | FINAL. The redirect is temporary and must be removed before real use. |
| SLA auto-escalation; no manual escalate button | Product direction | Manual cross-role escalation | FINAL |
| Viewer-local time zones | Usability | Fixed UTC | FINAL |
| Plain-text WhatsApp Q&A | No Meta Flow Builder access | WhatsApp Flows, reduced field set | FINAL for now |
| Email: polling + confirm-before-submit + both auth checks | No domain for inbound webhooks | Webhook (future) | FINAL for now |
| ngrok static domain | The quick tunnel URL changed on every restart | Cloudflare quick tunnel; named Cloudflare tunnel | FINAL |
| Commit directly to `main` | Owner workflow | Feature branches, branch per spec | FINAL |
| Docs under `resources/`; root keeps SPEC.md + CLAUDE.md | Handover | — | FINAL |

---

# 14. Owner preferences & how Claude should work

The following are supported by CLAUDE.md, specs, and commit history.

- **Spec-first:**
  - Update `SPEC.md` and the relevant `.claude/specs/` note **before** implementing a scope change.
  - Specs go Draft → Lock → Build; addenda are appended to the existing spec.
  - Use `/create-spec`, `/spec-sync`.
- **Keep docs in sync:** ROADMAP checkboxes, PREREQUISITES, RUNNING-LOCALLY (record every gotcha hit), PLATFORM-OVERVIEW (when files move).
- **Git:**
  - Commit directly to `main` (`/commit-and-push`).
  - Imperative subject; the body explains the *why*, with "Verified live…" evidence.
  - Recent commits use short, plain-language bodies.
  - Ask before pushing when running `/create-spec`.
- **Verify against the running app**, not just by reading code. Use the bug-hunter / bug-fixer agents, `/case-trace`, and claude-in-chrome. Workers have no unit tests.
- **Minimal, convention-matching fixes.** Fix only what was reported. No destructive git or docker commands without asking.
- **Mock fallback when credentials are missing** (email, WhatsApp, settlement).
- **Human-in-the-loop is non-negotiable.** Route to a review task, never automatically deny.
- **Client validation mirrors server validation.**
- **Plain-language, claimant-friendly copy. No em dashes in UI copy.**
- **Resource-conscious.** The 8 GB machine matters: trim containers; `/manage-app stop` frees vmmem.
- Use `docker-compose` (standalone), not `docker compose`.
- Decisions the user makes are recorded as "per explicit product direction" in specs and commits. Keep doing that.
- How the owner likes explanations to be phrased: **UNKNOWN** (not recorded beyond the commit style above).

---

# 15. CRITICAL — DO NOT CHANGE / DO NOT BREAK

1. **Audit everything:**
   - Every worker and every user-task completion writes ≥1 `audit_log` row via `writeAuditLog()` with the correct `actor_type`.
   - AI workers record the **actually-answering model**.
   - Check with `/audit-log-check`.
2. **All AI goes through `backend/shared/gemini-client.ts`** (temperature 0, fallback chain). Never call Gemini directly from a worker.
3. **Human confirms routing and makes the final decision.** Never re-introduce an "auto" bypass or automatic denial. Timer-driven auto-actions exist only as SLA escalation, by design.
4. **Insurance-type extensibility:** add types via `/add-insurance-type` (config module + `<type>-claim-routing-decision` DMN). **Never branch inside the BPMN.**
5. **`carrier_id`** stays first-class on claims and policies.
6. **Settlement stays mock-only.** Do not wire real payments.
7. **Single claim entry point:** `createClaim()` for every channel. Don't fork the validation paths.
8. **Duplicate-instance guard** in `api/src/zeebe.ts` (capped retries + cancel duplicates). Don't raise retries.
9. **Two infra-client sets** (API vs workers): change both.
10. **Error policy:** Zeebe retry ×3, then incident. No custom BPMN error boundaries (until a spec says otherwise).
11. **Auth:**
    - Never accept a client-supplied role.
    - Keep generic error messages (no enumeration leaks).
    - Claimants see only their own claims and never risk or fraud data.
    - The `demo` Camunda credential stays server-side.
12. **Forms:** use `readonly` (FEEL-reactive), **not** `disabled` (static only), in Camunda forms. Keep the required fields that enforce "human confirms".
13. **Gateway defaults** (continue / adjuster) prevent deadlocks. Keep them.
14. **Dates to Zeebe as ISO strings; `claimAmount` as a number.** A string silently broke every DMN comparison once.
15. **Rerun `node backend/deploy-resources.mjs`** after any BPMN/DMN/form change. There is no auto-deploy.
16. **Migrations are forward-only.** Never edit an applied migration; never "restore" 0004.
17. **Before any real use**, swap `TEST_RECIPIENT` back to the claimant's address in `notification-provider.ts` and `reviewer-notifications.ts`. Until then, leave it.
18. Don't repeat known-bad approaches (see §16–17).

---

# 16. Bugs & debugging history

Format: symptom → root cause → fix. Commit hashes are given for reference.

| Symptom | Root cause | Fix |
|---|---|---|
| UI showed risk/fraud as "Pending"/0 | Workers set only Zeebe variables, never DB columns | Write to the DB; clear old indicators so retries don't duplicate (f854a9e) |
| All claimAmount DMN/BPMN comparisons silently failed | `pg` returns numeric as a string, so a string was passed to Zeebe | Convert to number (8eefbed) |
| Review decisions "not captured"; NULL confirmedRole | User tasks had no forms; Tasklist "Complete" sent no variables | Camunda Forms with required fields; explicit worker errors (90f2950) |
| Deny without a reason → incident | Form didn't require it | Conditional required field (db7be04) |
| Zeebe rejected variables | JS `Date` objects | `toISOString()` (1faa756) |
| `disabled` FEEL expression ignored | Camunda forms evaluate `disabled` statically | Use `readonly` (1faa756) |
| Tasklist didn't show MinIO images | Tasklist CSP blocks external images silently | Base64 data URIs ≤2 MB (10a8e3b) |
| CONDITION_ERROR deadlocks | Gateway without a default flow | Default flows (f854a9e) |
| 12-month claim count evaded by email casing | Case-sensitive match | `lower()` (4fc4e9e) |
| Fully mismatched documents scored 5/100 | No claimant name in the prompt; no rubric | Fixed fraud categories + risk bands (b025d5a) |
| close-case "unexpected decision undefined" | `decision` not set on the triage and validation reject paths | Set it (50278a3) |
| Duplicate process instances | `DEADLINE_EXCEEDED` followed by an SDK auto-retry | Bounded retries; cancel duplicates (a3f3c7e) |
| Task claim/complete not reflected in the UI | Tasklist search index lag | Update local state from the action result; `?justCompleted=` (4a8d091, a09d683) |
| Oversized upload → bare 500 | multer's error bypassed the try/catch | Wrap and return 400; 10 MB client check (ac63e0b) |
| Claims missing from "My Claims" | Typed email ≠ account email | Lock the field to the account; trim at signup (2f41f95) |
| `confirmed_role` CHECK lacked supervisor | Schema | Migration 0012 |
| Duplicate "Dear {name}," in denial emails | Template + letter both added it | f3de7fd |
| Logged-out "/" showed 401 banners | Page always fetched | Landing page (828b230) |
| Nav label flicker | SSR paints before a localStorage cache can load (that attempt failed) | Server-side user resolution; later reworked with JWT (7ad69a2, f6ef61d) |
| Next "Jest worker" crashes | Memory pressure | `experimental.cpus: 1` (ec5084d) |
| API process died when Camunda was down | Uncaught SDK HTTP retry error | Survive that error specifically (cfd5b16) |
| Tasklist hangs / gateway timeouts | Orchestration container RAM / GC | mem_limit 1g → 2g → 2560m; Connectors removed |
| WhatsApp: duplicate deliveries, trapped users, unknown numbers | Meta re-delivers; UX gaps | Dedup table 0017; menu everywhere; reject unknown numbers (13a8180) |
| Graph API v20 stopped working | Expired 2026-09-24 | v26.0 (3824461) |
| Portal claims not visible on WhatsApp | No phone on portal claims | Phone resolves to the owner's email (d364353) |
| Email intake auto-replied to no-reply | Check only matched the start of the local part | a281269 |
| Gmail mobile replies mis-parsed | Answers typed above the quote, wrapped labels, inline photos | 2d4cff3 |
| Fresh install failed on 0005 | Depended on the deleted 0004 | `DROP COLUMN IF EXISTS` |

---

# 17. Rejected approaches (do not re-propose without a new reason)

| Approach | Why rejected | Replacement | Reconsider? |
|---|---|---|---|
| Simulated adjudication auto-amount (deductible/copay/coinsurance) | Zeroed amounts; management dropped it | User-entered requested amount ≤ coverage | Only by explicit request |
| "auto" triage bypass / "auto" DMN role | Violates human confirmation | Mandatory triage; adjuster catch-all | No |
| Policy-number correction in Validation Exception | Led to NULL policy_id inconsistencies | Approve/Reject only | Unlikely |
| Manual cross-role escalation button | Product direction: automatic only | SLA escalation | SPEC §14 still lists "cross-role escalation" as future |
| Keycloak / docker-compose-full | RAM on an 8 GB machine | App-level auth | If hosting changes |
| Camunda SaaS for auth | Internet/account dependency | App-level auth | For hosting, yes (HOSTING.md) |
| Real settlement provider | Demo app | Mock | No |
| CPT autocomplete | AMA licensing | Free-text with format validation | No |
| Single-scroll claim form; two-column live-summary form; brand-panel layout | User preference (reverted) | Single-column stepper + illustration column | — |
| Fixed-UTC display | Usability | Local zone + IANA name | — |
| Two-grid audit UI | Reverted | Drill-down | — |
| Duplicate "as submitted" section on the task page | User request | Single claim-details card | — |
| localStorage nav cache | Doesn't fix SSR flicker | Server-side resolution | — |
| Branch per spec / feature branches | Owner workflow | Commit to main | — |
| Tracked `.env.example` files | Removed (251c949) | Env vars documented in RUNNING-LOCALLY / PREREQUISITES | — |
| Cloudflare quick tunnel | URL changes on restart | ngrok static | — |
| WhatsApp Flows | No Flow Builder access | Plain-text Q&A | If access is granted |
| `mc` init container; AWS S3 SDK | Simpler to create the bucket at API startup with the `minio` client | Startup bucket creation | — |
| 1:1 `claim_provider_info` table | Doesn't normalise | `providers` keyed by NPI | — |
| DB regex CHECKs for codes | Brittle, poor errors | App validation | — |
| Self-managed Camunda on free-tier VMs | RAM | SaaS or Oracle Always Free (HOSTING.md) | — |

---

# 18. Implementation status

**Completed:** everything in §4 marked COMPLETED.

**In progress / partially verified:**
- ROADMAP step 6: multi-user role walkthroughs.
- ROADMAP step 7: moreInfo loop live test, investigator-deny, full multi-user run.
- Email intake: CONFIRM → claim, reminders, expiry not yet verified live.

**Planned (SPEC §14, owner sets priority):**
- PDF denial letters
- Editing dependents on existing policies
- Cross-role escalation
- Error boundary events
- Per-carrier tenant isolation and DMN thresholds
- Additional insurance types
- Customer-facing live status page
- Selectable document viewer
- "Audit log latest action" read consistency
- Policy creation enhancements
- Dynamic claim form (Draft spec)
- AI-fill from an uploaded bill in the portal chat
- Camunda SaaS; cloud hosting
- Email inbound webhook
- `holidays` table

**Known issues / limitations:**
- All email goes to `TEST_RECIPIENT`.
- Public-read MinIO bucket.
- `file_url`s are hard-coded to `localhost:9000`.
- Images are embedded in Zeebe variables.
- Camunda `assignee` always shows `demo`; who really acted lives only in `audit_log`.
- US-only holidays.
- 50000 threshold duplicated.
- Abandoned WhatsApp sessions are never cleaned up.
- No moreInfo cap or timeout.
- `confirmed_role` CHECK still allows legacy `auto`.
- WhatsApp is limited to the Meta test sandbox.
- Gmail sending limits.

**Doc drift (technical debt):**
- SPEC §2 non-goals, §5 diagram, §6 notification row and §7 repo tree are stale: they still say no auth, stock Tasklist, no moreInfo loop, Resend only.
- ROADMAP's "Decided 2026-09-04" paragraph still mentions signed-cookie sessions (now JWT).
- `process-orchestration-kickoff.md` shows the older DMN; SPEC §11 is current.
- `validate-claim.md` doesn't document the duplicate check.
- The as-built doc is `resources/ClaimFlow-AI-Technical-Specification.md`.

**Blocked:**
- Real WhatsApp claimants need Meta business verification and a business number.
- Resend for arbitrary recipients needs a verified domain.
- Inbound email webhook needs a domain.

---

# 19. Current state
See **CURRENT STATE — READ THIS FIRST** at the top.

---

# 20. Next steps & roadmap

**Immediate:**
1. ROADMAP step 6: walk Adjuster / Investigator / Legal Review and Supervisor Sign-off as distinct seeded users.
2. Step 7: moreInfo loop, investigator-deny, full multi-user run. Check items off in ROADMAP.
3. Verify email intake CONFIRM, reminder and expiry live.

**Short-term:**
- Fix SPEC.md doc drift (use `/spec-sync`).
- Decide on the next SPEC §14 item. Candidates the specs flag as low-risk: PDF denial letters, editing dependents.

**Long-term:**
- Cloud hosting per `resources/HOSTING.md`: Vercel, Camunda SaaS, Supabase/Neon, Render/Railway (must be always-on for job polling).
- Before that: presigned document URLs, a secrets manager, real domains (`NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGIN`), and removing `TEST_RECIPIENT`.
- Multi-carrier isolation; additional insurance types.

---

# 21. Open questions & unresolved items

| Question | Status / info needed from owner |
|---|---|
| Does lightweight Camunda accept an arbitrary `assignee` (to pass the real user through)? | Open; cosmetic |
| Supervisor threshold duplicated (BPMN + worker): single source? | Open |
| Reviewer notification cooldown | Open |
| `validate-claim` exact required-field list; incidentDate as a kickoff variable | Open (spec open questions) |
| Should `total_billed_amount` factor into risk? | Deferred to a future spec |
| Dynamic form builder scope (field types, conditions, intake-only?, versioning, relation to insurance-type configs) | Draft; needs owner decisions |
| moreInfo loop cap / claimant timeout | Deliberately none for now |
| Next priority among SPEC §14 items | Owner to decide |
| Hosting platform choice and timing | Owner to decide |
| Policy creation enhancements (exact shape) | TBD |
| Anything discussed only in previous chats | **UNKNOWN**. The owner should add it here. |

---

# 22. Testing & QA

- `backend/api`: `npm test` (Vitest + Supertest). Covers `test/auth.test.ts`, `email-intake.test.ts` and `email-intake-form.test.ts`, run against the local Postgres. Initially 12/12 auth tests; email intake 17 + 13.
- `frontend/portal`: `npm test` (Vitest + jsdom, `tests/auth-session.test.ts`).
- **Workers have no unit tests.** Verify them live with `/case-trace <claimId>`, the bug-hunter agent, and Operate.
- `camunda-docker/tests` and `tests-lightweight`: Playwright tests of the Camunda stack itself.
- Live-verified scenarios (ROADMAP step 7, 2026-08-31/09-01):
  - low-risk → adjuster → approved
  - fraud → investigator
  - >50k → legal deny
  - triage override
  - triage reject
  - validation exception reject / resolve with no policy
  - supervisor sign-off
  - complete audit trails
- Known failing tests: **UNKNOWN / none recorded.**

---

# 23. Security

- **Authentication:**
  - bcrypt passwords.
  - HS256 JWT (`SESSION_SECRET`, `SESSION_TTL_HOURS`) in per-tab `sessionStorage`.
  - `token_version` revokes tokens on password reset.
  - A 401 redirects to `/login`.
- **Authorization:**
  - `requireAuth` / `requireRole`.
  - Claimant scoping by email.
  - Staff roles provisioned by an admin only.
  - Tasks filtered by role → group on the server.
  - The Camunda `demo` credential is server-side only.
- **Anti-enumeration:** generic errors on signup, forgot-password and OTP. OTP: hashed, 10 min, 5 attempts, 60 s cooldown, single-use.
- **Channels:**
  - WhatsApp: HMAC `X-Hub-Signature-256` over the raw body (401 on a bad signature).
  - Email: SPF/DKIM/DMARC + confirm-before-submit + known-sender gate.
- **Data protection gaps (dev-only, must fix before production):**
  - public-read MinIO bucket of health documents (PII/PHI)
  - plaintext `.env` files
  - `carrier_id` not enforced as a tenant boundary
  - test-mode email redirect
- **Secrets:** all in gitignored `.env` files (`backend/api/.env`, `backend/workers/.env`, `camunda-docker/.env`, optional root `.env`). **Never commit them.** Values must be provided separately.

---

# 24. Development environment & setup

Full guide: `resources/RUNNING-LOCALLY.md` (the `/manage-app start|stop` skill follows it). Requires Windows 10/11, 8 GB+ RAM, and Docker Desktop running.

```bash
docker-compose up -d                         # repo root: Postgres + MinIO
cd backend && npm run migrate                # apply DB migrations
cd backend/api && npm run seed:demo-users    # optional demo logins (see RUNNING-LOCALLY.md)
cd camunda-docker && docker-compose up -d    # Camunda (needs camunda-docker/.env)
cd backend && node deploy-resources.mjs      # deploy BPMN/DMN/forms after every process change
cd backend/api && npm run dev                # API :4000
cd backend/workers && npm run dev            # workers
cd frontend/portal && npm run dev            # portal :3000
cd backend/api && npm run tunnel             # optional ngrok tunnel for WhatsApp
```

**URLs:**
- Operate: `localhost:8080/operate`; Tasklist: `/tasklist`; REST: `/v2`; gRPC: `26500`.
- MinIO console: `:9001`; S3 API: `:9000`.

**Environment variables.** All values must be provided separately.
- `backend/api/.env`:
  - `SESSION_SECRET` (required), `SESSION_TTL_HOURS`, `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `FRONTEND_URL`
  - `MINIO_*`, Camunda/Zeebe connection vars
  - `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY`
  - `WHATSAPP_*`, `EMAIL_INTAKE_*`
  - `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`
- `backend/workers/.env`:
  - `GEMINI_API_KEY` (required), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`
  - `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY`
  - `DATABASE_URL`, `FRONTEND_URL`, Camunda vars
- `frontend/portal`: `NEXT_PUBLIC_API_BASE_URL`.
- Root `.env` (optional): `POSTGRES_*`, `MINIO_ROOT_*` overrides.

**Gotchas:**
- Use the standalone `docker-compose` binary.
- MinIO image pull problems are documented.
- The orchestration container needs `mem_limit` 2560m.
- `/manage-app stop` runs `wsl --shutdown` to free vmmem.

---

# 25. Glossary

| Term | Meaning in this project |
|---|---|
| Claim / case | One claim = one BPMN process instance; `audit_log` is its case history |
| FNOL | First Notice of Loss: the initial claim submission fields (CMS-1500-style) |
| Triage | Human step confirming or overriding the AI-suggested reviewer role |
| `assignedRole` / `confirmedRole` | DMN suggestion vs. human-confirmed role |
| Validation Exception Review | Human review when automated validation fails |
| moreInfo / `awaiting_info` | Reviewer asks the claimant for more documents; claim loops back |
| Supervisor Sign-off vs. Supervisor Review | Maker-checker for approvals >50k vs. SLA-escalation endpoint with decision authority |
| SLA | 24-business-hour review deadline (`slaDeadline`) |
| Candidate group | Camunda group a user task is offered to |
| Option B | App-level auth + Tasklist proxy (chosen 2026-09-04) |
| Channel | `portal` / `whatsapp` / `email`: decides the authorized-claimant signal |
| Dependents | Policyholder's covered people allowed to file (not "nominees") |
| `carrier_id` | Insurer identifier (MGA/TPA multi-carrier support) |
| MGA / TPA | Managing General Agent / Third-Party Administrator |
| Takaful | Islamic cooperative insurance |
| SIU | Special Investigations Unit (investigators) |
| NPI | 10-digit US National Provider Identifier |
| ICD-10 / CPT / HCPCS | Diagnosis / procedure / supply codes |
| COB | Coordination of benefits (other coverage) |
| DMN | Decision table; `health-claim-routing-decision` |
| Operate / Tasklist | Camunda's monitoring UI / stock task UI |
| `TEST_RECIPIENT` | Fixed inbox that all outgoing mail is redirected to (test mode) |
| Lock (spec) | A design note's state once decisions are final and building may start |

---

# 26. Context that could otherwise be lost

- Migration 0004 is intentionally missing.
- `confirmed_role` still allows `auto` (legacy).
- Seeded claimant accounts use undeliverable `@example.com` addresses, which is one reason for the email redirect.
- Gemini "-latest" aliases can point to an overloaded model. Keep fallback models configured, in **both** `.env` files (the API uses Gemini for email intake).
- Tasklist search is eventually consistent. The UI updates from action results instead of re-querying.
- Camunda form `disabled` vs `readonly` (see §15).
- Images in process variables are acceptable at demo scale only.
- The WhatsApp bot only replies inside the 24 h user-initiated window (free tier). It never sends business-initiated messages.
- Email intake can share a personal inbox via a plus-address and an end date (`EMAIL_INTAKE_UNTIL`).
- The portal chat audits with source `claimant-portal-chat`, but `channel` stays `portal`.
- `claim-lifecycle.html` is large: read it selectively.
- Docs in `docs/` (client demo decks) are gitignored; the user guide PDF is tracked.
- The owner's machine regularly ran out of memory (CPU spike to 694% on orchestration on 2026-09-02). Avoid adding containers.
- Claude Code tooling:
  - **agents:** `bug-hunter` (read-only, live testing), `bug-fixer` (minimal verified fixes)
  - **commands:** `/create-spec`, `/dump-data`, `/seed-data`
  - **skills:** `/new-job-worker`, `/add-insurance-type`, `/audit-log-check`, `/spec-sync`, `/dmn-table-review`, `/case-trace`, `/commit-and-push`, `/manage-app`

---

# 27. INSTRUCTIONS FOR THE NEW CLAUDE

1. Read this document, then `CLAUDE.md` and `SPEC.md` (§1–5, §9–13), before making major changes. For a file map use `resources/PLATFORM-OVERVIEW.md`.
2. Treat CONFIRMED and IMPLEMENTED items as established context. Where docs disagree, trust **code > recent spec addenda / commits > SPEC.md body > older docs**, and flag the drift.
3. Preserve existing functionality and follow the established architecture (§5, §15).
4. Respect final decisions (§13). Don't re-propose rejected approaches (§17) without a new reason.
5. Avoid unnecessary rewrites and refactors. Make minimal, convention-matching changes.
6. Check the existing implementation (and `create-claim.ts`, `shared/`) before writing new code.
7. Don't assume missing information. Ask when an unresolved decision (§21) materially affects implementation.
8. Separate existing requirements from your own recommendations.
9. Follow the spec-first workflow: update `SPEC.md` + `.claude/specs/` first, then implement, then sync ROADMAP / RUNNING-LOCALLY / PLATFORM-OVERVIEW.
10. Verify changes against the running stack (`/manage-app start`, `/case-trace`, bug-hunter). Workers have no unit tests.
11. Run `/audit-log-check` on any new or changed worker or task-completion path.
12. Redeploy BPMN/DMN/forms with `node backend/deploy-resources.mjs` after process changes.
13. Commit directly to `main` with a "why" message (`/commit-and-push`). Never commit `.env` files or secrets.
14. Consult §16 before debugging something that looks familiar.
15. Keep this document updated when major decisions or the architecture change.

---

# 28. Information confidence summary

- **CONFIRMED / IMPLEMENTED:** architecture, stack, data model, BPMN/DMN, workers, endpoints, decisions in §13, bugs in §16. All are cross-checked against code, specs, or commits.
- **INFERRED:** "what should happen next" ordering; owner preferences derived from commit patterns (§14).
- **UNKNOWN:** anything discussed only in previous Claude chats and never written down; Node version; scalability targets; the owner's preferred explanation style.

---

# 29. Final handover summary

- **What:** ClaimFlow AI, a Camunda 8 + Gemini health-insurance claims platform for GCC insurers / TPAs. It is a demo/test app.
- **Solves:** slow, batch-bound claims cycles and inconsistent manual fraud review, while keeping humans in charge.
- **Built:**
  - portal (claimant + staff + admin), chat assistant, WhatsApp bot, email intake
  - Express API with JWT auth
  - 17 Zeebe workers (4 using Gemini)
  - BPMN with triage, role reviews, supervisor sign-off, moreInfo loop and SLA escalation
  - DMN routing
  - Postgres audit trail
  - mock settlement; real (test-redirected) email
- **Stack:** Node/TS, Express, Next.js 14, Postgres 16 (raw SQL), MinIO, Camunda 8.9 lightweight, Gemini, Meta WhatsApp, Gmail/Resend. Windows 8 GB local machine.
- **Status:** v1 runs end to end locally. Remaining work is the multi-user and moreInfo live walkthroughs (ROADMAP 6–7), email-intake verification, and SPEC doc drift.
- **Most important rules:**
  - audit every step
  - AI only via `gemini-client.ts`
  - humans confirm routing and decide
  - no BPMN branching per insurance type
  - settlement stays mock
  - single `createClaim()`
  - spec-first
  - commit to `main`
- **Long-term:** more insurance types, carrier isolation, cloud hosting (Camunda SaaS + managed services), removing the test-mode email redirect and the public bucket before any real use.
