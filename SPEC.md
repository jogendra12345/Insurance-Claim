# ClaimFlow AI — Spec

**Claims Orchestration with AI Triage.** Status: **v1 MVP**. This is the source of truth for implementation. Build against this spec; update it first when scope changes, then implement.

## 1. Product overview

ClaimFlow AI is a Camunda-orchestrated claims application for insurers that combines a deterministic workflow (intake → validation → AI triage → routing → settlement) with an AI layer that reads submitted documents, flags likely fraud indicators, and summarizes case context for human reviewers. Claims are dynamically routed to an adjuster, investigator, or legal reviewer based on complexity and risk — with a human confirming every AI-driven routing and settlement decision, and a complete audit trail from intake to resolution.

**Problem it solves.** GCC insurers' claims platforms are largely legacy, batch-oriented, and siloed — a policy endorsement or claim update entered mid-day often doesn't reflect until an overnight batch run. This produces slow claim cycle times and inconsistent, labor-intensive manual fraud review. ClaimFlow AI cuts cycle time and standardizes fraud detection without removing human judgment from the final decision.

**Target customers.** Composite and P&C insurers across the UAE, Saudi Arabia, and wider GCC still running legacy policy admin/claims platforms; Takaful operators handling general (non-life) claims; MGAs and third-party administrators (TPAs) processing claims on behalf of multiple insurers, who need throughput at scale rather than a per-carrier custom system — hence `carrier_id` is a first-class field in the data model from v1, even though full multi-tenant isolation is future work (§13).

## 2. Goals / Non-goals

**Goals (v1)**
- End-to-end flow: submit → validate → AI evidence extraction + case summary → AI fraud-indicator detection → AI risk scoring → DMN-suggested routing → human triage confirmation → role-based review (adjuster / investigator / legal) → settle or deny → notify.
- A human confirms or overrides the AI's suggested routing before a claim reaches a reviewer, and a human reviewer's decision is required before any claim resolves — AI never resolves a claim unassisted.
- A complete, queryable audit trail of every automated and human decision on a claim.
- Real Camunda 8 process running locally, deployable as-is to Camunda 8 SaaS later.
- Real Claude API calls for all AI-assisted steps.
- Role-based review via stock Camunda Tasklist (adjusters / investigators / legal reviewers as candidate groups — no custom review UI in v1).

**Non-goals (v1 — see §13 for future work)**
- No real payment/settlement or notification integration — both mocked behind swappable interfaces.
- No cross-role escalation (investigator → legal mid-review) — each claim is routed once by the DMN table.
- No "request more info" resubmission loop — that path ends the process.
- No per-carrier tenant isolation, branding, or auth — `carrier_id` is recorded but not yet enforced as a security boundary.
- No authentication on the customer portal.
- No custom adjuster/investigator/legal UI — default Tasklist is used as-is.

## 3. A note on "case management" and Camunda 8

Camunda 7 had a dedicated case-management model (CMMN) for exactly this kind of work. **Camunda 8 does not support CMMN** — there is no separate case engine. ClaimFlow AI gets the case-management experience instead through a single BPMN process instance per claim (the "case"), which models the full intake-to-resolution lifecycle including all three possible reviewer roles, with Operate and Tasklist as the case work views and the `audit_log` table (§8) as the durable case history. This is a deliberate architecture choice, not a limitation to work around.

## 4. Architecture

```
Claimant (browser)
   │  submit claim + documents
   ▼
Frontend — Next.js portal            Backend — Node.js/TypeScript API
   │  POST /api/claims          →       - writes claim to Postgres (with carrier_id)
   │  GET  /api/claims/:id      ←       - uploads documents to object storage
   │                                    - starts a process instance in Zeebe
   │                                          │
   │                                          ▼
   │                                 Camunda 8 (Zeebe + Operate + Tasklist)
   │                                    orchestrates claim-case-process
   │                                          │
   │                    ┌─────────────────────┼───────────────────────┐
   │                    ▼                     ▼                       ▼
   │             AI job workers        DMN routing table      Human review tasks
   │             (Node/TS + Claude)    (claim-routing-        (Triage → Adjuster /
   │                    │               decision)              Investigator / Legal)
   │                    │                                             │
   │                    └──────────────── every step writes to ───────┘
   │                                       audit_log (Postgres)
   ▼
Reviewers (browser) — Camunda Tasklist at localhost:8080/tasklist
```

## 5. Tech stack

| Layer | Choice |
|---|---|
| Orchestration | Camunda 8.9 Self-Managed, Docker Compose, lightweight config (already running — see `PREREQUISITES.md`) |
| Backend API + workers | Node.js, TypeScript |
| Zeebe client | `@camunda8/sdk` (official Camunda 8 Node SDK) |
| Frontend | Next.js (React, TypeScript) |
| Claim database | PostgreSQL |
| Document storage | S3-compatible object storage (local MinIO for dev) |
| AI | Claude API (Anthropic) — evidence extraction, fraud-indicator detection, risk scoring, denial letter drafting |
| Settlement | Mocked behind a `SettlementProvider` interface |
| Notification | Mocked behind a `NotificationProvider` interface |

## 6. Repo structure

```
/
├── camunda-docker/              # local Camunda 8 runtime (existing)
├── process/
│   ├── claim-case-process.bpmn  # the process definition (see §9)
│   └── claim-routing.dmn        # the DMN routing table (see §10)
├── backend/
│   ├── api/                     # REST API — claim submission, status
│   ├── workers/                 # one file per job worker (see §11)
│   ├── db/                      # Postgres schema + migrations
│   └── shared/                  # Zeebe client, Claude client, audit-log writer, shared types
├── frontend/
│   └── portal/                  # claimant-facing submit + status UI
├── SPEC.md
├── PREREQUISITES.md
└── claim-lifecycle.html
```

## 7. Roles / candidate groups

| Candidate group | Who | Handles |
|---|---|---|
| `triage-team` | Intake/triage staff | Confirms or overrides the AI's suggested routing |
| `adjusters` | Claims adjusters | Standard-complexity claims |
| `investigators` | SIU / fraud investigators | Claims with fraud indicators |
| `legal-reviewers` | Legal/compliance | High-value or liability claims |
| `supervisors` | Team leads | Second sign-off on large settlements (maker-checker) |

## 8. Data model (Postgres)

```
claims
  id                    uuid PK
  carrier_id            uuid NOT NULL        -- the insurer this claim belongs to (MGA/TPA multi-carrier support)
  policy_number         text NOT NULL
  claim_type            text NOT NULL        -- property | injury | liability | total_loss | other
  claimant_name         text NOT NULL
  claimant_email        text NOT NULL
  incident_date         date NOT NULL
  incident_description  text NOT NULL
  claim_amount          numeric NOT NULL
  status                text NOT NULL        -- submitted | validating | triage | in_review | approved | denied | awaiting_info
  case_summary          text NULL            -- AI-generated summary for reviewers
  risk_score            numeric NULL         -- 0-100
  fraud_indicator_count integer NOT NULL DEFAULT 0
  assigned_role         text NULL            -- adjuster | investigator | legal | auto (DMN suggestion)
  confirmed_role        text NULL            -- role a human actually routed it to, after triage review
  decision              text NULL            -- approve | deny | moreInfo
  denial_reason         text NULL
  process_instance_key  text NULL            -- Zeebe process instance key
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()

claim_documents
  id             uuid PK
  claim_id       uuid FK → claims.id
  file_url       text NOT NULL
  document_type  text NULL   -- photo | police_report | receipt | other
  extracted_data jsonb NULL  -- output of the extract-evidence worker
  created_at     timestamptz NOT NULL DEFAULT now()

claim_fraud_indicators
  id          uuid PK
  claim_id    uuid FK → claims.id
  type        text NOT NULL     -- e.g. inconsistent_dates, prior_claim_pattern, staged_loss_language
  description text NOT NULL
  confidence  numeric NOT NULL  -- 0-1
  created_at  timestamptz NOT NULL DEFAULT now()

audit_log
  id          uuid PK
  claim_id    uuid FK → claims.id
  actor_type  text NOT NULL   -- system | ai | human
  actor_id    text NULL       -- worker name, or user id from Tasklist
  action      text NOT NULL   -- e.g. "validated", "routed", "fraud_flagged", "reviewed", "settled"
  detail      jsonb NULL      -- free-form context (e.g. AI reasoning, override reason)
  created_at  timestamptz NOT NULL DEFAULT now()
```

Every job worker and every user-task completion handler writes at least one `audit_log` row — see §12.

### Migration tooling

Raw SQL migration files, no ORM. Applied via `backend/db/run-migrations.sh` (psql-based, forward-only, sequentially numbered). Decided 2026-08-19: schema is small (4 tables) and stable; raw SQL is more reliably correct here than an ORM migration DSL; no rollback tooling needed yet since dev resets via drop/recreate. Revisit if `backend/api` needs a typed query layer, or a second insurance type needs dedicated tables beyond an `insurance_type` column pattern.

## 9. BPMN process — `claim-case-process`

Started by the backend API when a claim is submitted, with initial variables `claimId`, `carrierId`, `policyNumber`, `claimType`, `claimAmount`.

1. **Start Event** — Claim Submitted
2. **Service Task** `validate-claim` — required fields + policy status (policy lookup mocked in v1)
3. **Exclusive Gateway** `Validation Passed?`
   - No → **User Task** `Validation Exception Review` (candidate group `triage-team`) — resolves data issues or rejects the claim
   - Yes (default) → step 4
4. **Service Task** `extract-evidence` — Claude reads uploaded documents, writes `case_summary` and per-document `extracted_data`
5. **Service Task** `detect-fraud-indicators` — Claude flags specific fraud indicators against the evidence + claimant history, writes rows to `claim_fraud_indicators`
6. **Service Task** `score-risk` — combines fraud signal + claim complexity into a single `riskScore` (0–100)
7. **Business Rule Task** — evaluates DMN `claim-routing-decision` → sets `assignedRole` (`adjuster` | `investigator` | `legal` | `auto`)
8. **Exclusive Gateway** `Needs Triage Review?`
   - `assignedRole = "auto"` (default) → skip straight to step 10 (auto-approved)
   - Otherwise → step 9
9. **User Task** `Triage Review` (candidate group `triage-team`) — reviewer sees the AI's case summary, fraud indicators, risk score, and suggested role; sets `confirmedRole` (may differ from `assignedRole`)
10. **Exclusive Gateway** `Route by Confirmed Role` → one of three parallel-possible branches, only one taken per instance:
    - `confirmedRole = "adjuster"` → **User Task** `Adjuster Review` (candidate group `adjusters`)
    - `confirmedRole = "investigator"` → **User Task** `Investigator Review` (candidate group `investigators`)
    - `confirmedRole = "legal"` → **User Task** `Legal Review` (candidate group `legal-reviewers`)
    - each sets `decision` (`approve` | `deny` | `moreInfo`) and `denialReason` if denying
11. **Exclusive Gateway** `Decision`
    - `approve` (default) → step 12
    - `decision = "deny"` → step 13
    - `decision = "moreInfo"` → **End Event** "Awaiting More Information" (terminal in v1 — see §13)
12. Approved path: **Exclusive Gateway** `Needs Second Sign-off?` (`claimAmount` over threshold, e.g. 50,000) →
    - Yes → **User Task** `Supervisor Sign-off` (candidate group `supervisors`) → then settlement
    - No (default) → straight to settlement
    - Settlement: **Service Task** `trigger-settlement` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Approved"
13. Denied path: **Service Task** `draft-denial-letter` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Denied"

Replaces the earlier draft at `process/insurance-claim.bpmn` — rebuild it in Camunda Modeler as `process/claim-case-process.bpmn` to match this flow before first deploy.

## 10. DMN — `claim-routing-decision`

Table `process/claim-routing.dmn`, hit policy FIRST. Inputs: `fraudIndicatorCount`, `riskScore`, `claimAmount`, `claimType`. Output: `assignedRole`.

| Fraud Indicators | Risk Score | Claim Amount | Claim Type | → Assigned Role |
|---|---|---|---|---|
| ≥ 1 | – | – | – | investigator |
| – | – | – | "liability" | legal |
| – | – | > 50000 | – | legal |
| – | ≥ 40 | – | – | adjuster |
| – | – | > 5000 | – | adjuster |
| – | – | – | – | auto |

Thresholds are placeholder defaults — tune per carrier once real claim data exists (multi-carrier-configurable DMN values are future work, §13).

## 11. Job workers

Node/TypeScript, one job type each, via `@camunda8/sdk`. Default behavior: unhandled exceptions use Zeebe's built-in retry (3 attempts), then fail into an Operate incident — no custom BPMN error boundaries in v1 (§13).

| Job type | Input variables | Does | Output variables |
|---|---|---|---|
| `validate-claim` | `policyNumber`, `claimAmount`, `incidentDate` | Required-field + policy-status check (policy lookup **mocked**, always active) | `validationPassed` (bool) |
| `extract-evidence` | `claimId` | Loads `claim_documents`, calls Claude to extract structured data per document and produce a reviewer-facing case summary; writes `case_summary` and `extracted_data` | `caseSummary` (string) |
| `detect-fraud-indicators` | `claimId`, `caseSummary` | Calls Claude to flag specific fraud indicators against evidence + claimant history; writes `claim_fraud_indicators` rows | `fraudIndicatorCount` (number) |
| `score-risk` | `claimId`, `claimAmount`, `fraudIndicatorCount`, `caseSummary` | Calls Claude to produce a single 0–100 risk score with reasoning | `riskScore` (number) |
| `trigger-settlement` | `claimId`, `claimAmount` | Calls `SettlementProvider.pay()` — **mocked**, always succeeds | `settlementId` (string) |
| `draft-denial-letter` | `claimId`, `denialReason`, `claimantName` | Calls Claude to draft denial letter text grounded in the stated reason | `denialLetterText` (string) |
| `notify-claimant` | `claimId`, `decision` | Calls `NotificationProvider.send()` — **mocked**, logs instead of sending | `notificationSent` (bool) |
| `close-case` | `claimId`, `decision` | Writes final `status` to `claims` | — |

`SettlementProvider` and `NotificationProvider` are TypeScript interfaces with one mock implementation each in v1.

## 12. Audit trail

Every worker in §11, and every user-task completion, writes one `audit_log` row: `actor_type` (`system` for deterministic steps, `ai` for Claude-backed steps, `human` for Tasklist completions), `actor_id` (worker name or Tasklist user id), `action`, and `detail` (the AI's reasoning, or a human's override reason when `confirmedRole ≠ assignedRole`). This is the durable, queryable case history that Camunda's own process history (visible in Operate) doesn't give you at the business level — see `claim-lifecycle.html` §"Limited reporting" for why that's a platform-level gap, not an oversight here.

## 13. Future work (explicitly out of scope for v1)

- Per-carrier tenant isolation: auth scoping by `carrier_id`, per-carrier DMN thresholds, per-carrier branding.
- Cross-role escalation (e.g., investigator escalates to legal mid-review) instead of single DMN-time routing.
- Loop `moreInfo` back to intake instead of ending the process (needs a message event + resubmission API).
- Error boundary events on service tasks for graceful business-error handling.
- Real settlement and notification providers.
- PDF generation for denial letters.
- Custom review UI per role (replacing default Tasklist).
- Customer-facing status page pulling live process state.
- Auth for the claimant portal.
- Deploying to Camunda 8 SaaS instead of local Docker Compose.

## 14. Definition of done (v1)

A claim can be submitted through the frontend, flows through the full BPMN process with real Claude API calls at every AI step, a low-risk/low-value claim auto-approves with no human input, a claim with fraud indicators routes to an investigator, a high-value/liability claim routes to legal, a triage reviewer can override the AI's suggested role, a large approved settlement requires supervisor sign-off, and every step — automated or human — leaves a row in `audit_log` that reconstructs the full case history from intake to resolution.
