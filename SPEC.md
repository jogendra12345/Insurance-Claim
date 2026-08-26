# ClaimFlow AI — Spec

**Claims Orchestration with AI Triage.** Status: **v1 MVP**. This is the source of truth for implementation. Build against this spec; update it first when scope changes, then implement.

## 1. Product overview

ClaimFlow AI is a Camunda-orchestrated claims application for insurers that combines a deterministic workflow (intake → validation → AI triage → routing → settlement) with an AI layer that reads submitted documents, flags likely fraud indicators, and summarizes case context for human reviewers. Claims are dynamically routed to an adjuster, investigator, or legal reviewer based on complexity and risk — with a human confirming every AI-driven routing and settlement decision, and a complete audit trail from intake to resolution.

**v1 implements health insurance claims specifically.** The platform is designed as a generic claims workflow — later insurance lines (vehicle, property, travel, etc.) plug into the same process without redesigning it. See §3.

**Problem it solves.** GCC insurers' claims platforms are largely legacy, batch-oriented, and siloed — a policy endorsement or claim update entered mid-day often doesn't reflect until an overnight batch run. This produces slow claim cycle times and inconsistent, labor-intensive manual fraud review. ClaimFlow AI cuts cycle time and standardizes fraud detection without removing human judgment from the final decision.

**Target customers.** Composite and P&C insurers across the UAE, Saudi Arabia, and wider GCC still running legacy policy admin/claims platforms; Takaful operators handling general (non-life) claims; MGAs and third-party administrators (TPAs) processing claims on behalf of multiple insurers, who need throughput at scale rather than a per-carrier custom system — hence `carrier_id` is a first-class field in the data model from v1, even though full multi-tenant isolation is future work (§14).

## 2. Goals / Non-goals

**Goals (v1)**
- End-to-end flow: submit → validate → AI evidence extraction + case summary → AI fraud-indicator detection → AI risk scoring → DMN-suggested routing → human triage confirmation → role-based review (adjuster / investigator / legal) → settle or deny → notify.
- A human confirms or overrides the AI's suggested routing before a claim reaches a reviewer, and a human reviewer's decision is required before any claim resolves — AI never resolves a claim unassisted.
- A complete, queryable audit trail of every automated and human decision on a claim.
- Process design is insurance-type-agnostic; health is the only implemented type in v1 (§3).
- Real Camunda 8 process running locally, deployable as-is to Camunda 8 SaaS later.
- Real Gemini API calls for all AI-assisted steps.
- Role-based review via stock Camunda Tasklist (adjusters / investigators / legal reviewers as candidate groups — no custom review UI in v1).

**Non-goals (v1 — see §14 for future work)**
- No additional insurance types (vehicle, property, travel, etc.) implemented in v1 — only the extension points exist (§3).
- No real payment/settlement or notification integration — both mocked behind swappable interfaces.
- No cross-role escalation (investigator → legal mid-review) — each claim is routed once by the DMN table.
- No "request more info" resubmission loop — that path ends the process.
- No per-carrier tenant isolation, branding, or auth — `carrier_id` is recorded but not yet enforced as a security boundary.
- No authentication on the customer portal.
- No custom adjuster/investigator/legal UI — default Tasklist is used as-is.

## 3. Insurance-type extensibility

v1 builds and ships **health insurance claims only**. The architecture is deliberately designed so a new insurance line can be added later without redesigning the process:

- **The BPMN process is insurance-type-agnostic.** `claim-case-process`'s steps — validate → extract evidence → detect fraud → score risk → route → review → settle — apply to any insurance line. Nothing about the process shape is health-specific.
- **What varies per type is worker content, not process shape.** `validate-claim`, `extract-evidence`, `detect-fraud-indicators`, and `score-risk` each load a small config keyed by the claim's `insuranceType` (e.g. `backend/shared/insurance-types/health.ts`) — defining required fields, expected document types (for health: medical bills, discharge summaries, prescriptions), and the Gemini prompt template for that type. Adding vehicle later means writing one new config module, not touching the BPMN process or any other type's workers.
- **DMN routing can vary by type.** The business rule task (§10) selects its decision table dynamically via Zeebe's `decisionIdExpression` — `=insuranceType + "-claim-routing-decision"` — instead of a hardcoded `decisionId`. So `health-claim-routing-decision` and a future `vehicle-claim-routing-decision` can coexist as separate tables with different thresholds, selected at runtime by the claim's type.
- **`insurance_type` is a first-class column** on `claims` (§9) from v1, even though `health` is the only value in use today.

## 4. A note on "case management" and Camunda 8

Camunda 7 had a dedicated case-management model (CMMN) for exactly this kind of work. **Camunda 8 does not support CMMN** — there is no separate case engine. ClaimFlow AI gets the case-management experience instead through a single BPMN process instance per claim (the "case"), which models the full intake-to-resolution lifecycle including all three possible reviewer roles, with Operate and Tasklist as the case work views and the `audit_log` table (§9) as the durable case history. This is a deliberate architecture choice, not a limitation to work around.

## 5. Architecture

```
Claimant (browser)
   │  submit claim + documents
   ▼
Frontend — Next.js portal            Backend — Node.js/TypeScript API
   │  POST /api/claims          →       - writes claim to Postgres (carrier_id, insurance_type)
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
   │             (Node/TS + Gemini,    (selected per          (Triage → Adjuster /
   │              insurance-type-       insuranceType,         Investigator / Legal)
   │              aware via config)     v1: health only)              │
   │                    │                                             │
   │                    └──────────────── every step writes to ───────┘
   │                                       audit_log (Postgres)
   ▼
Reviewers (browser) — Camunda Tasklist at localhost:8080/tasklist
```

## 6. Tech stack

| Layer | Choice |
|---|---|
| Orchestration | Camunda 8.9 Self-Managed, Docker Compose, lightweight config (already running — see `PREREQUISITES.md`) |
| Backend API + workers | Node.js, TypeScript |
| Zeebe client | `@camunda8/sdk` (official Camunda 8 Node SDK) |
| Frontend | Next.js (React, TypeScript) |
| Claim database | PostgreSQL |
| Document storage | S3-compatible object storage (local MinIO for dev) |
| AI | Gemini API (Google Generative Language) — evidence extraction, fraud-indicator detection, risk scoring, denial letter drafting |
| Settlement | Mocked behind a `SettlementProvider` interface |
| Notification | Mocked behind a `NotificationProvider` interface |

## 7. Repo structure

```
/
├── camunda-docker/                    # local Camunda 8 runtime (existing)
├── process/
│   ├── claim-case-process.bpmn        # the process definition (see §10)
│   └── health-claim-routing.dmn       # the health DMN routing table (see §11)
├── backend/
│   ├── api/                           # REST API — claim submission, status
│   ├── workers/                       # one file per job worker (see §12)
│   ├── db/                            # Postgres schema + migrations
│   └── shared/
│       ├── insurance-types/
│       │   └── health.ts              # required fields, doc types, AI prompts for health claims
│       ├── zeebe-client.ts
│       ├── gemini-client.ts
│       └── audit-log.ts
├── frontend/
│   └── portal/                        # claimant-facing submit + status UI
├── SPEC.md
├── ROADMAP.md
├── GUIDE.md
├── PREREQUISITES.md
└── claim-lifecycle.html
```

## 8. Roles / candidate groups

| Candidate group | Who | Handles |
|---|---|---|
| `triage-team` | Intake/triage staff | Confirms or overrides the AI's suggested routing |
| `adjusters` | Claims adjusters | Standard-complexity claims |
| `investigators` | SIU / fraud investigators | Claims with fraud indicators |
| `legal-reviewers` | Legal/compliance | High-value or liability claims |
| `supervisors` | Team leads | Second sign-off on large settlements (maker-checker) |

## 9. Data model (Postgres)

```
policies
  id                uuid PK
  policy_number     text NOT NULL UNIQUE
  carrier_id        uuid NOT NULL        -- the insurer that issued this policy
  insurance_type    text NOT NULL DEFAULT 'health'
  policyholder_name text NOT NULL
  status            text NOT NULL        -- active | lapsed | cancelled
  effective_date    date NOT NULL
  expiry_date       date NOT NULL
  premium_amount    numeric NOT NULL     -- >= 0
  coverage_amount   numeric NOT NULL     -- > 0; a claim against this policy must be <= it
  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()

claims
  id                    uuid PK
  carrier_id            uuid NOT NULL        -- the insurer this claim belongs to (MGA/TPA multi-carrier support)
  insurance_type        text NOT NULL DEFAULT 'health'  -- health today; vehicle/property/travel later (§3)
  policy_number         text NOT NULL        -- as submitted by the claimant/API; not guaranteed to match a policies row
  policy_id             uuid NULL FK → policies.id  -- set once validate-claim resolves a real policy match
  claim_type            text NOT NULL        -- sub-category within insurance_type
                                              --   health: outpatient | inpatient | pharmacy | dental | maternity | other
  claimant_name         text NOT NULL
  claimant_email        text NOT NULL
  incident_date         date NOT NULL
  incident_description  text NOT NULL
  claim_amount          numeric NOT NULL     -- requested claim amount; must be <= the matched policy's coverage_amount, enforced at intake (POST /api/claims) and client-side (ClaimForm), ahead of the validate-claim worker's own checks
  status                text NOT NULL        -- submitted | validating | triage | in_review | approved | denied | awaiting_info
  case_summary          text NULL            -- AI-generated summary for reviewers
  risk_score            numeric NULL         -- 0-100; written by score-risk
  risk_reasoning        text NULL            -- score-risk's 1-3 sentence explanation, surfaced on the claim detail page
  fraud_indicator_count integer NOT NULL DEFAULT 0  -- written by detect-fraud-indicators; only counts confidence >= 0.5 (§11/§12)
  assigned_role         text NULL            -- adjuster | investigator | legal | auto (DMN suggestion); written by capture-routing-decision
  confirmed_role        text NULL            -- role a human actually routed it to, after triage review; written by capture-triage-review
  decision              text NULL            -- approve | deny | moreInfo; written by capture-review-decision
  denial_reason         text NULL            -- written by capture-review-decision
  process_instance_key  text NULL            -- Zeebe process instance key
  provider_id            uuid NOT NULL FK → providers.id  -- resolved synchronously at intake, find-or-create by NPI (§ "FNOL extended fields" below)
  diagnosis_code         text NOT NULL        -- ICD-10, e.g. E11.9
  procedure_code         text NOT NULL        -- CPT (5 digits) or HCPCS Level II (letter + 4 digits)
  service_date_from      date NOT NULL
  service_date_to        date NULL            -- NULL/omitted for a single-day visit; UI sets it equal to service_date_from for claim types other than inpatient/maternity
  total_billed_amount    numeric NOT NULL     -- gross provider-billed amount; separate from claim_amount, not wired into any worker (see below)
  coordination_of_benefits boolean NOT NULL DEFAULT false  -- does the claimant have other coverage
  attestation_signed_at  timestamptz NOT NULL -- set server-side at submission time, not client-typed
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()

providers
  id                uuid PK
  npi               text NOT NULL UNIQUE  -- exactly 10 digits
  tax_id            text NOT NULL
  facility_name     text NOT NULL
  facility_address  text NOT NULL
  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()

claim_documents
  id             uuid PK
  claim_id       uuid FK → claims.id
  file_url       text NOT NULL
  document_type  text NULL   -- health: medical_bill | discharge_summary | prescription | other
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

Every job worker and every user-task completion handler writes at least one `audit_log` row — see §13.

### FNOL extended fields

`claims`' diagnosis/procedure code, provider (`providers`, via `provider_id`), service date(s), `total_billed_amount`, `coordination_of_benefits`, and `attestation_signed_at` were added per `.claude/specs/db/fnol_extended_fields.md` and `.claude/specs/generic/fnol_form_ui_update.md` (both Locked 2026-08-24) — captured directly on `ClaimForm` at intake, not derived from documents (`extract-evidence` isn't built yet). `providers` is a separate table, not flattened onto `claims`: the same NPI recurs across many claims, so it's keyed by `npi` (unique) and reused via find-or-create in `POST /api/claims` — on a collision, the existing row wins and newly submitted facility/tax-id details are discarded, never overwritten. `total_billed_amount` is stored but intentionally **not** wired into `validate-claim`, `score-risk`, the DMN routing table, or `trigger-settlement` — `claim_amount` stays the sole authoritative figure for routing/coverage/payout; `total_billed_amount` is informational context only until a future spec decides how a billed-vs-claimed gap should factor into risk scoring.

### Migration tooling

Raw SQL migration files, no ORM. Applied via `backend/db/run-migrations.sh` (psql-based, forward-only, sequentially numbered). Decided 2026-08-19: schema is small (4 tables) and stable; raw SQL is more reliably correct here than an ORM migration DSL; no rollback tooling needed yet since dev resets via drop/recreate. Revisit if `backend/api` needs a typed query layer, or a second insurance type needs dedicated tables beyond the `insurance_type` column pattern.

## 10. BPMN process — `claim-case-process`

Started by the backend API when a claim is submitted, with initial variables `claimId`, `carrierId`, `insuranceType`, `policyNumber`, `claimType`, `claimAmount`. The process itself is insurance-type-agnostic (§3) — only the workers and the DMN table it calls vary by `insuranceType`.

1. **Start Event** — Claim Submitted
2. **Service Task** `validate-claim` — required fields + policy status, using the config for this claim's `insuranceType`; looks up `policies` by `policyNumber` and `carrierId`, sets `claims.policy_id` on match, sets `claims.status = 'validating'` on pass, and computes two deterministic red-flag signals for the DMN table below: `daysSincePolicyEffective` and `claimantClaimCountLast12Months`
3. **Exclusive Gateway** `Validation Passed?`
   - No → **User Task** `Validation Exception Review` (candidate group `triage-team`) — v1 is reject-only (no resolve-and-continue path yet — see §14) → **Service Task** `capture-validation-exception` (sets `claims.status = 'denied'`, writes `audit_log`) → **End Event** "Validation Failed"
   - Yes (default) → step 4
4. **Service Task** `extract-evidence` — Gemini reads uploaded documents (per the type's expected document list), writes `case_summary` and per-document `extracted_data`
5. **Service Task** `detect-fraud-indicators` — Gemini flags specific fraud indicators grounded in the case summary *and* each document's `extracted_data`; writes every indicator to `claim_fraud_indicators`, but only tallies indicators with `confidence >= 0.5` toward `fraudIndicatorCount` (a single low-confidence guess shouldn't be enough to route to investigator)
6. **Service Task** `score-risk` — combines fraud signal + claim complexity into a single `riskScore` (0–100) with `reasoning`, both written to `claims`
7. **Business Rule Task** — evaluates the DMN decision selected via `decisionIdExpression` for this claim's `insuranceType` (v1: `health-claim-routing-decision`) → sets `assignedRole` (`adjuster` | `investigator` | `legal` | `auto`)
8. **Service Task** `capture-routing-decision` — writes `claims.assigned_role = assignedRole`, sets `claims.status = 'triage'`, writes `audit_log`
9. **User Task** `Triage Review` (candidate group `triage-team`) — reviewer sees the AI's case summary, fraud indicators, risk score, and suggested role; sets `confirmedRole` (may differ from `assignedRole`). **Every claim passes through this task — `assignedRole = "auto"` is a suggestion the reviewer accepts or overrides, never a skip** (see §1, §15; this replaced an earlier "auto-bypass" gateway that let low-risk claims skip human review entirely, which contradicted §1's "human confirming every AI-driven routing decision")
10. **Service Task** `capture-triage-review` — writes `claims.confirmed_role = confirmedRole`, sets `claims.status = 'in_review'`, writes `audit_log` (flags an override when `confirmedRole != assignedRole`)
11. **Exclusive Gateway** `Route by Confirmed Role` (default: `adjuster`, so an unset/unrecognized `confirmedRole` can't deadlock the instance) → one of three branches, only one taken per instance:
    - `confirmedRole = "adjuster"` → **User Task** `Adjuster Review` (candidate group `adjusters`)
    - `confirmedRole = "investigator"` → **User Task** `Investigator Review` (candidate group `investigators`)
    - `confirmedRole = "legal"` → **User Task** `Legal Review` (candidate group `legal-reviewers`)
    - each sets `decision` (`approve` | `deny` | `moreInfo`) and `denialReason` if denying
12. **Service Task** `capture-review-decision` — writes `claims.decision`, `claims.denial_reason`, and maps `claims.status` from the decision (`approve` → `approved`, `deny` → `denied`, `moreInfo` → `awaiting_info`); writes `audit_log`
13. **Exclusive Gateway** `Decision`
    - `approve` (default) → step 14
    - `decision = "deny"` → step 15
    - `decision = "moreInfo"` → **End Event** "Awaiting More Information" (terminal in v1 — see §14)
14. Approved path: **Exclusive Gateway** `Needs Second Sign-off?` (`claimAmount` over threshold, e.g. 50,000) →
    - Yes → **User Task** `Supervisor Sign-off` (candidate group `supervisors`) → **Service Task** `capture-signoff` (writes `audit_log`; `claims.status` is already `approved` from step 12) → settlement
    - No (default) → straight to settlement
    - Settlement: **Service Task** `trigger-settlement` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Approved"
15. Denied path: **Service Task** `draft-denial-letter` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Denied"

`close-case`'s documented job (§12) of writing "final `status`" is now a confirming/idempotent write against a status the relevant `capture-*` step already set at decision time, not the sole writer — see §12.

Replaces the earlier draft at `process/insurance-claim.bpmn` — rebuild it in Camunda Modeler as `process/claim-case-process.bpmn` to match this flow before first deploy.

## 11. DMN — `health-claim-routing-decision`

Table `process/health-claim-routing.dmn`, hit policy FIRST. Inputs: `fraudIndicatorCount`, `riskScore`, `claimAmount`, `daysSincePolicyEffective`, `claimantClaimCountLast12Months` (the last two computed by `validate-claim`, §10 step 2 — cheap SQL-derived red flags rather than leaving everything to the LLM-based fraud/risk workers to infer from prose). Output: `assignedRole`.

| Fraud Indicators | Risk Score | Claim Amount | Days Since Policy Effective | Claimant Claim Count (12mo) | → Assigned Role |
|---|---|---|---|---|---|
| – | – | > 50000 | – | – | legal |
| ≥ 1 | – | – | – | – | investigator |
| – | – | – | ≤ 14 | – | investigator |
| – | – | – | – | ≥ 3 | investigator |
| – | ≥ 40 | – | – | – | adjuster |
| – | – | > 5000 | – | – | adjuster |
| – | – | – | – | – | auto |

High-dollar exposure (`claimAmount > 50000`) is checked first: `FIRST` hit policy can only pick one row, and a large claim needs legal's eyes regardless of whether fraud/risk also flagged it — under the old fraud-first ordering, a $200k claim with any fraud indicator would only ever reach "investigator," never "legal." `claimType` was carried as an input in an earlier draft but never used by any rule — removed as dead configuration; reintroduce it (e.g. for type-specific legal triggers) if a concrete rule needs it. Naming convention for future tables: `<insuranceType>-claim-routing-decision`, selected at runtime per §3. Thresholds are placeholder defaults — tune per carrier once real claim data exists (per-carrier configuration is future work, §14).

## 12. Job workers

Node/TypeScript, one job type each, via `@camunda8/sdk`. Default behavior: unhandled exceptions use Zeebe's built-in retry (3 attempts), then fail into an Operate incident — no custom BPMN error boundaries in v1 (§14).

| Job type | Input variables | Does | Output variables |
|---|---|---|---|
| `validate-claim` | `insuranceType`, `carrierId`, `policyNumber`, `claimAmount`, `incidentDate` | Required-field check using the insurance-type config (§3) for which fields are required; looks up `policies` by `policyNumber` + `carrierId` and checks `status = 'active'` and `incidentDate` within `[effective_date, expiry_date]`; sets `claims.policy_id` and (on pass) `claims.status = 'validating'`; computes `daysSincePolicyEffective` and the claimant's trailing-12-month claim count for the DMN table (§11) | `validationPassed` (bool), `policyId` (uuid, nullable), `daysSincePolicyEffective` (number, nullable), `claimantClaimCountLast12Months` (number) |
| `extract-evidence` | `claimId`, `insuranceType` | Loads `claim_documents`, calls Gemini (using the type's prompt template) to extract structured data per document and produce a reviewer-facing case summary; writes `case_summary` and `extracted_data` | `caseSummary` (string) |
| `detect-fraud-indicators` | `claimId`, `insuranceType`, `caseSummary` | Calls Gemini, grounded in the case summary *and* each document's `extracted_data`, to flag specific fraud indicators; writes every indicator to `claim_fraud_indicators` (all confidences) but only counts `confidence >= 0.5` toward `claims.fraud_indicator_count` / the output below | `fraudIndicatorCount` (number, counted only) |
| `score-risk` | `claimId`, `claimAmount`, `fraudIndicatorCount`, `caseSummary` | Calls Gemini (temperature 0) to produce a single 0–100 risk score with reasoning; writes `claims.risk_score` and `claims.risk_reasoning` | `riskScore` (number) |
| `capture-routing-decision` | `claimId`, `assignedRole` | Writes `claims.assigned_role`, sets `claims.status = 'triage'` | — |
| `capture-triage-review` | `claimId`, `confirmedRole`, `assignedRole` | Writes `claims.confirmed_role`, sets `claims.status = 'in_review'`; `audit_log.detail` flags whether the reviewer overrode the AI's suggestion | — |
| `capture-review-decision` | `claimId`, `decision`, `denialReason`, `confirmedRole` | Writes `claims.decision`, `claims.denial_reason`; sets `claims.status` from `decision` (`approve→approved`, `deny→denied`, `moreInfo→awaiting_info`) | — |
| `capture-signoff` | `claimId` | No `claims` columns to set (`status` is already `approved` from `capture-review-decision`) — exists solely to satisfy §13's "every user-task completion writes `audit_log`" rule for Supervisor Sign-off | — |
| `capture-validation-exception` | `claimId` | Sets `claims.status = 'denied'` (v1's Validation Exception Review is reject-only, §10 step 3); writes `audit_log` | — |
| `trigger-settlement` | `claimId`, `claimAmount` | Calls `SettlementProvider.pay()` — **mocked**, always succeeds | `settlementId` (string) |
| `draft-denial-letter` | `claimId`, `denialReason`, `claimantName` | Calls Gemini to draft denial letter text grounded in the stated reason | `denialLetterText` (string) |
| `notify-claimant` | `claimId`, `decision` | Calls `NotificationProvider.send()` — **mocked**, logs instead of sending | `notificationSent` (bool) |
| `close-case` | `claimId`, `decision` | Writes final `status` to `claims` — by the time this runs, `capture-review-decision` already set the same value; this is a confirming/idempotent write, not the sole one (see §10) | — |

`SettlementProvider` and `NotificationProvider` are TypeScript interfaces with one mock implementation each in v1. `validate-claim`, `extract-evidence`, and `detect-fraud-indicators` are insurance-type aware — each loads `backend/shared/insurance-types/<insuranceType>.ts` (v1: `health.ts` only) rather than hardcoding health-specific logic inline, so a new type is additive. The `capture-*` workers are not insurance-type aware — they only move already-computed process variables onto the `claims` row and are the same regardless of `insuranceType`.

## 13. Audit trail

Every worker in §12, and every user-task completion, writes one `audit_log` row: `actor_type` (`system` for deterministic steps, `ai` for Gemini-backed steps, `human` for Tasklist completions), `actor_id` (worker name or Tasklist user id), `action`, and `detail` (the AI's reasoning, or a human's override reason when `confirmedRole ≠ assignedRole`). This is the durable, queryable case history that Camunda's own process history (visible in Operate) doesn't give you at the business level — see `claim-lifecycle.html` §"Limited reporting" for why that's a platform-level gap, not an oversight here.

## 14. Future work (explicitly out of scope for v1)

- Additional insurance types (vehicle, property, travel) using the extension points in §3 — a new `insurance-types/<type>.ts` config and a new `<type>-claim-routing-decision` DMN table.
- Per-carrier tenant isolation: auth scoping by `carrier_id`, per-carrier DMN thresholds, per-carrier branding.
- Cross-role escalation (e.g., investigator escalates to legal mid-review) instead of single DMN-time routing.
- Resolve-and-continue path for Validation Exception Review — v1's `Task_ValidationExceptionReview` only rejects; a reviewer can't fix a data issue and let the claim continue into `extract-evidence`.
- Loop `moreInfo` back to intake instead of ending the process (needs a message event + resubmission API).
- Error boundary events on service tasks for graceful business-error handling.
- Real settlement and notification providers.
- PDF generation for denial letters.
- Custom review UI per role (replacing default Tasklist).
- Customer-facing status page pulling live process state.
- Auth for the claimant portal.
- Deploying to Camunda 8 SaaS instead of local Docker Compose.
- **Cloud hosting for the rest of the stack** (beyond Camunda, above). What needs to change before this app runs anywhere but a local machine:
  - Bucket access: the `claim-documents` MinIO bucket is public-read (`.claude/specs/generic/object-storage-provisioning.md`) — fine for throwaway dev data, not acceptable for real claim documents (often PII/health info) in production. Needs presigned URLs or an auth-gated proxy instead.
  - Object storage endpoint: swapping `MINIO_ENDPOINT`/credentials for a real S3-compatible provider (AWS S3, or self-hosted MinIO on a cloud VM/cluster) is mostly config-only, since `backend/api` already talks to it via the standard S3 API — but every `file_url` already stored in Postgres is baked with `localhost:9000`, so existing rows would need a migration, not just a config change.
  - Base URLs: `NEXT_PUBLIC_API_BASE_URL` (frontend) and `CORS_ORIGIN` (backend/api) both currently assume `localhost` — need real domains.
  - `docker-compose.yaml` (root) is a local-dev convenience, not a deployment target — Postgres, MinIO/S3, `backend/api`, and `frontend/portal` each become their own actually-hosted service (managed DB, managed object storage or a real MinIO deployment, container hosting for the two Node apps).
  - Secrets: `.env` files with plaintext credentials are fine locally; production needs a real secrets manager.

## 15. Definition of done (v1)

A health insurance claim can be submitted through the frontend, flows through the full BPMN process with real Gemini API calls at every AI step, a low-risk/low-value claim is confirmed by a triage reviewer even when the AI suggests no further specialist review is needed (`assignedRole = "auto"` is a suggestion the triage reviewer can accept or override, never a skip — see §10), a claim with fraud indicators routes to an investigator, a high-value claim routes to legal, a triage reviewer can override the AI's suggested role, a large approved settlement requires supervisor sign-off, and every step — automated or human — leaves a row in `audit_log` that reconstructs the full case history from intake to resolution. The process, workers, and DMN selection are all insurance-type-parameterized even though only `health` ships in v1.
