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
  id                 uuid PK
  policy_number      text NOT NULL UNIQUE
  carrier_id         uuid NOT NULL        -- the insurer that issued this policy
  insurance_type     text NOT NULL DEFAULT 'health'
  policyholder_name  text NOT NULL
  policyholder_email text NOT NULL        -- authorized-claimant check (below) matches against this or policy_dependents.email
  status             text NOT NULL        -- active | lapsed | cancelled
  effective_date     date NOT NULL
  expiry_date        date NOT NULL
  premium_amount     numeric NOT NULL     -- >= 0
  coverage_amount    numeric NOT NULL     -- > 0; a claim against this policy must be <= it
  created_at         timestamptz NOT NULL DEFAULT now()
  updated_at         timestamptz NOT NULL DEFAULT now()

policy_dependents
  id           uuid PK
  policy_id    uuid NOT NULL FK → policies.id
  full_name    text NOT NULL
  email        text NOT NULL
  relationship text NOT NULL  -- spouse | child | other (the policyholder themself is never a row here — matched via policies.policyholder_email instead)
  created_at   timestamptz NOT NULL DEFAULT now()
  -- UNIQUE (policy_id, email)

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
  decision              text NULL            -- approve | deny | moreInfo; written by capture-review-decision, or 'deny' by capture-triage-review on a triage rejection (§10)
  denial_reason         text NULL            -- written by capture-review-decision or capture-triage-review (see decision above)
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

### Authorized claimants (`policy_dependents`)

Today, `claims.claimant_name`/`claimant_email` are free-text at submission with no check against the policy at all — anyone who knows a policy number can file against it. `policy_dependents` closes that gap: a claim is only valid if `claimant_email` **or** `claimant_name` (case-insensitive) matches `policies.policyholder_email`/`policyholder_name`, or the `email`/`full_name` on a `policy_dependents` row for that `policy_id` — either field matching is enough, not both (a claimant may type their name slightly differently than the record, or use a different but still-listed email; requiring both would make ordinary submissions fail validation and pile into Validation Exception Review for no fraud-relevant reason).

Named "dependents," not "nominees": nominees are a life-insurance/beneficiary concept (who gets paid out on death), not who's allowed to *file* a claim. For health (the only `insurance_type` in v1), the people who actually incur medical expenses and would file are the policyholder and their covered dependents (spouse, children) — so that's the relationship this models. A future `insurance_type` with a real nominee/beneficiary concept (e.g. life) would need its own table under the §3 extension pattern, not a reuse of this one.

Enforcement point: `validate-claim` (§10 step 2, §12) gains a third check alongside the existing policy-match and duplicate-claim checks — `authorizedClaimant` (bool). An unmatched `claimant_email` fails validation the same way an unmatched policy or a duplicate in-flight claim does: routes to **Validation Exception Review** rather than a hard rejection, since a legitimate mismatch (typo'd email, an unlisted dependent who should be added) needs a human to resolve it, not an automatic denial (CLAUDE.md's "human always makes the final decision"). `ValidationExceptionReviewForm` gets a third conditional warning banner (alongside the existing duplicate-claim one) for this case.

Dependents are added at policy-creation time only: `POST /api/policies` accepts an optional `dependents` array alongside the policy fields, inserted in the same transaction. `GET /api/policies/:id` returns the policy plus its `dependents`, shown on the policy detail page's own section. There's no way to add/edit/remove dependents on an *already-existing* policy in v1 — no `PATCH`/`POST /api/policies/:id/dependents` endpoint — see §14.

### Migration tooling

Raw SQL migration files, no ORM. Applied via `backend/db/run-migrations.sh` (psql-based, forward-only, sequentially numbered). Decided 2026-08-19: schema is small (4 tables) and stable; raw SQL is more reliably correct here than an ORM migration DSL; no rollback tooling needed yet since dev resets via drop/recreate. Revisit if `backend/api` needs a typed query layer, or a second insurance type needs dedicated tables beyond the `insurance_type` column pattern.

## 10. BPMN process — `claim-case-process`

Started by the backend API when a claim is submitted, with initial variables `claimId`, `carrierId`, `insuranceType`, `policyNumber`, `claimType`, `claimAmount`. The process itself is insurance-type-agnostic (§3) — only the workers and the DMN table it calls vary by `insuranceType`.

1. **Start Event** — Claim Submitted
2. **Service Task** `validate-claim` — required fields + policy status, using the config for this claim's `insuranceType`; looks up `policies` by `policyNumber` and `carrierId`; if matched, checks for a duplicate — another claim already on that `policy_id` with `status NOT IN ('approved', 'denied')` — and fails validation if one exists (one in-flight claim per policy at a time); also checks `claimant_email` **or** `claimant_name` (case-insensitive, either is enough) against `policyholder_email`/`policyholder_name` and `policy_dependents.email`/`full_name` for the matched policy, failing validation if neither field matches on any row (see "Authorized claimants" under §9) — sets `claims.policy_id` on match, sets `claims.status = 'validating'` only when all three checks pass, and computes two deterministic red-flag signals for the DMN table below: `daysSincePolicyEffective` and `claimantClaimCountLast12Months`
3. **Exclusive Gateway** `Validation Passed?`
   - No → **User Task** `Validation Exception Review` (candidate group `triage-team`) — a `resolutionAction` field lets the reviewer either resolve or reject outright → **Service Task** `capture-validation-exception` → **Exclusive Gateway** `Validation Exception Decision?`: `resolve` → step 4 (`extract-evidence`); `reject` (default) → the denial path (step 16, same as `Gateway_TriageDecision`'s reject branch). **`resolve` only continues the claim as originally submitted** — there is deliberately no way to edit the policy number from this form. It's only a legal action when `claims.policy_id` is already set (the exception was a duplicate-in-flight-claim or unauthorized-claimant failure, both of which still have a genuinely matched policy); `capture-validation-exception` throws (→ Zeebe retry → Operate incident, no custom BPMN error boundary) if a reviewer resolves a claim with no matched policy, since there's nothing to resolve onto and no "awaiting more information"/resubmission loop-back exists yet (§14) to send it to instead. An earlier version let the reviewer type a corrected policy number that was re-matched against `policies`, but under the real submission flow (`PolicySelect` only ever sets `policyNumber` from a genuine active-policy selection, never free text) a wrong policy number essentially never occurs — the realistic "no policy matched" cause is the incident date falling outside the policy's coverage window, which retyping the (already-correct) policy number can't fix anyway. That field let a reviewer "resolve" a still-unmatched policy with the claim silently continuing on `policy_id = NULL` — removed rather than patched around.
   - Yes (default) → step 4
4. **Service Task** `extract-evidence` — Gemini reads uploaded documents (per the type's expected document list), writes `case_summary` and per-document `extracted_data`
5. **Service Task** `detect-fraud-indicators` — Gemini flags specific fraud indicators grounded in the case summary *and* each document's `extracted_data`; writes every indicator to `claim_fraud_indicators`, but only tallies indicators with `confidence >= 0.5` toward `fraudIndicatorCount` (a single low-confidence guess shouldn't be enough to route to investigator)
6. **Service Task** `score-risk` — combines fraud signal + claim complexity into a single `riskScore` (0–100) with `reasoning`, both written to `claims`
7. **Business Rule Task** — evaluates the DMN decision selected via `decisionIdExpression` for this claim's `insuranceType` (v1: `health-claim-routing-decision`) → sets `assignedRole` (`adjuster` | `investigator` | `legal` | `auto`)
8. **Service Task** `capture-routing-decision` — writes `claims.assigned_role = assignedRole`, sets `claims.status = 'triage'`, writes `audit_log`
9. **User Task** `Triage Review` (candidate group `triage-team`, form `TriageReviewForm` — `process/forms/triage-review.form`) — reviewer sees the AI's case summary, fraud indicators, risk score, and suggested role; the form's `triageAction` field (required) is either:
   - `"review"` (default outcome) — sets `confirmedRole` (may differ from `assignedRole`; field required by the form when this action is chosen)
   - `"reject"` — the triage reviewer rejects the claim outright without a full role-specific review (e.g. an obviously invalid or fraudulent claim); sets `denialReason` (required by the form when this action is chosen; `confirmedRole` is hidden and not collected)

   **Every claim passes through this task — `assignedRole = "auto"` is a suggestion the reviewer accepts or overrides, never a skip** (see §1, §15; this replaced an earlier "auto-bypass" gateway that let low-risk claims skip human review entirely, which contradicted §1's "human confirming every AI-driven routing decision"). `triageAction`/`confirmedRole`/`denialReason` are required directly by the form — Tasklist's default (no-form) "Complete" button previously let a reviewer complete this task with zero variables, silently losing the confirmed role; the form is what actually enforces the "human confirms" guarantee, not just the BPMN shape.
10. **Service Task** `capture-triage-review` — branches on `triageAction`:
    - `"review"` → writes `claims.confirmed_role = confirmedRole`, sets `claims.status = 'in_review'`, writes `audit_log` (action `triage_confirmed`, flags an override when `confirmedRole != assignedRole`)
    - `"reject"` → writes `claims.decision = 'deny'`, `claims.denial_reason = denialReason`, sets `claims.status = 'denied'`, writes `audit_log` (action `rejected_at_triage`) — same shape as `capture-review-decision`'s deny branch, since this bypasses role-specific review entirely
11. **Exclusive Gateway** `Triage Decision?` (default: continue to role-specific review, so an unset/unrecognized `triageAction` can't deadlock the instance) →
    - `triageAction = "reject"` → step 15 (merges into the existing denial path — `Task_DraftDenialLetter` has two incoming flows: this one and the role-specific-review decision path's `deny` branch)
    - Otherwise (default) → step 12
12. **Exclusive Gateway** `Route by Confirmed Role` (default: `adjuster`, so an unset/unrecognized `confirmedRole` can't deadlock the instance) → one of three branches, only one taken per instance, each using form `ReviewDecisionForm` (`process/forms/review-decision.form`):
    - `confirmedRole = "adjuster"` → **User Task** `Adjuster Review` (candidate group `adjusters`)
    - `confirmedRole = "investigator"` → **User Task** `Investigator Review` (candidate group `investigators`)
    - `confirmedRole = "legal"` → **User Task** `Legal Review` (candidate group `legal-reviewers`)
    - each sets `decision` (`approve` | `deny` | `moreInfo`, required by the form) and `denialReason` if denying (enforced by `capture-review-decision`, not the form — form-js's static required validation can't express "required only when decision=deny")
13. **Service Task** `capture-review-decision` — writes `claims.decision`, `claims.denial_reason`, and maps `claims.status` from the decision (`approve` → `approved`, `deny` → `denied`, `moreInfo` → `awaiting_info`); writes `audit_log`
14. **Exclusive Gateway** `Decision`
    - `approve` (default) → step 15
    - `decision = "deny"` → step 16
    - `decision = "moreInfo"` → **End Event** "Awaiting More Information" (terminal in v1 — see §14)
15. Approved path: **Exclusive Gateway** `Needs Second Sign-off?` (`claimAmount` over threshold, e.g. 50,000) →
    - Yes → **User Task** `Supervisor Sign-off` (candidate group `supervisors`) → **Service Task** `capture-signoff` (writes `audit_log`; `claims.status` is already `approved` from step 13) → settlement
    - No (default) → straight to settlement
    - Settlement: **Service Task** `trigger-settlement` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Approved"
16. Denied path (reached from step 3's validation-exception rejection, step 11's triage rejection, or step 14's deny decision): **Service Task** `draft-denial-letter` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Denied"

`close-case`'s documented job (§12) of writing "final `status`" is now a confirming/idempotent write against a status the relevant `capture-*` step already set at decision time, not the sole writer — see §12.

### Tasklist form template (`TriageReviewForm`, `ReviewDecisionForm`)

Both forms share a four-section template, each a form-js `group` component: **Policy & claim details** → **AI generated summary** → **Documents** → **Decision**. This means the process carries far more than this section's opening paragraph's five variables — `POST /api/claims` also sets `policyholderName`, `coverageAmount`, `claimantName`, `claimantEmail`, `incidentDate`, `incidentDescription`, `diagnosisCode`, `procedureCode`, `serviceDateFrom`, `serviceDateTo`, `totalBilledAmount`, `coordinationOfBenefits`, `providerFacilityName`, `providerNpi`, and `documents` (array of `{name, url, contentType, dataUri}` per uploaded file), purely so these forms can render full case context without a custom review UI (§2). None of these extra variables are read by any BPMN/DMN condition — `score-risk` (§12) also now outputs `riskReasoning` downstream for the same reason (previously DB-only).

Two gotchas worth remembering before touching these forms again:
- **Camunda 8 forms' `"disabled"` property is static-only** — it silently accepts a FEEL expression string without a schema error, but never re-evaluates it (a non-empty string is just always truthy). Use **`"readonly"`** instead for anything that needs to react to another field's value (e.g. `ConfirmedRoleField` staying non-interactive until `triageAction = "review"`).
- **Tasklist's CSP (`img-src: data: 'self' blob:`) blocks `<img>` from loading a plain external URL** (e.g. the MinIO document URL) — it fails silently, no console error, no network request even attempted. Inline document preview therefore only works for images small enough to embed as a `data:` URI (`INLINE_PREVIEW_MAX_BYTES` = 2MB, `backend/api/src/routes/claims.ts`); PDFs and oversized images fall back to a plain clickable link in the Documents section. This embeds image bytes directly in Zeebe process variables, which Zeebe isn't designed to carry — acceptable at v1/demo scale, but reconsider (migrate to Camunda's own document service, or relax the CSP via `camunda-docker` config) before scaling to routinely large photos or high claim volume.

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
| `validate-claim` | `insuranceType`, `carrierId`, `policyNumber`, `claimAmount`, `incidentDate` | Required-field check using the insurance-type config (§3) for which fields are required; looks up `policies` by `policyNumber` + `carrierId` and checks `status = 'active'` and `incidentDate` within `[effective_date, expiry_date]`; on a match, also checks for a duplicate in-flight claim on the same `policy_id` (`status NOT IN ('approved', 'denied')`) and fails validation if one exists; also checks `claims.claimant_email` **or** `claimant_name` (case-insensitive, either is enough) against `policyholder_email`/`policyholder_name` and `policy_dependents.email`/`full_name` for the matched policy, failing validation if neither field matches on any row (§9 "Authorized claimants"); sets `claims.policy_id` and (on pass of all checks) `claims.status = 'validating'`; computes `daysSincePolicyEffective` and the claimant's trailing-12-month claim count for the DMN table (§11) | `validationPassed` (bool), `policyId` (uuid, nullable), `duplicatePendingClaim` (bool), `duplicateClaimId` (uuid, nullable), `authorizedClaimant` (bool), `daysSincePolicyEffective` (number, nullable), `claimantClaimCountLast12Months` (number) |
| `extract-evidence` | `claimId`, `insuranceType` | Loads `claim_documents`, calls Gemini (using the type's prompt template) to extract structured data per document and produce a reviewer-facing case summary; writes `case_summary` and `extracted_data` | `caseSummary` (string) |
| `detect-fraud-indicators` | `claimId`, `insuranceType`, `caseSummary`, `claimantName` | Calls Gemini, grounded in the case summary *and* each document's `extracted_data`, to flag specific fraud indicators against a fixed category list (claimant identity mismatch, cross-document mismatch, coding/billing mismatch, missing/placeholder documentation) with a defined confidence scale, not an open-ended "anything unusual" prompt; `claimantName` lets it check documents against who actually filed the claim, not just against each other. Writes every indicator to `claim_fraud_indicators` (all confidences) but only counts `confidence >= 0.5` toward `claims.fraud_indicator_count` / the output below | `fraudIndicatorCount` (number, counted only) |
| `score-risk` | `claimId`, `claimAmount`, `fraudIndicatorCount`, `caseSummary` | Calls Gemini (temperature 0) against a scoring rubric (0-19 low / 20-39 low-moderate / 40-59 moderate / 60-79 high / 80-100 severe, each band tied to concrete criteria — fraud indicator count, identity/cross-document mismatches, fabricated documentation) rather than an unguided "produce a score" prompt; explicitly told to weigh a mismatch described in the case summary as significant even when `fraudIndicatorCount` is 0, since fraud detection can miss what the narrative still captures. Writes `claims.risk_score` and `claims.risk_reasoning` | `riskScore` (number), `riskReasoning` (string) |
| `capture-routing-decision` | `claimId`, `assignedRole` | Writes `claims.assigned_role`, sets `claims.status = 'triage'` | — |
| `capture-triage-review` | `claimId`, `triageAction`, `confirmedRole` (when reviewing), `assignedRole`, `denialReason` (when rejecting) | Branches on `triageAction`: `"review"` writes `claims.confirmed_role`, sets `status = 'in_review'` (`audit_log.detail` flags an override); `"reject"` writes `claims.decision = 'deny'` + `denial_reason`, sets `status = 'denied'` (same shape as `capture-review-decision`'s deny branch) | — |
| `capture-review-decision` | `claimId`, `decision`, `denialReason`, `confirmedRole` | Writes `claims.decision`, `claims.denial_reason`; sets `claims.status` from `decision` (`approve→approved`, `deny→denied`, `moreInfo→awaiting_info`) | — |
| `capture-signoff` | `claimId` | No `claims` columns to set (`status` is already `approved` from `capture-review-decision`) — exists solely to satisfy §13's "every user-task completion writes `audit_log`" rule for Supervisor Sign-off | — |
| `capture-validation-exception` | `claimId`, `resolutionAction`, `denialReason` (when rejecting) | Branches on `resolutionAction` (§10 step 3): `"resolve"` sets `status = 'validating'` — only legal when `claims.policy_id` is already set, else throws (see §10); `"reject"` writes `claims.decision = 'deny'` + `denial_reason`, sets `status = 'denied'` (same shape as `capture-triage-review`'s reject branch) | — |
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
- Loop `moreInfo` back to intake instead of ending the process (needs a message event + resubmission API).
- Error boundary events on service tasks for graceful business-error handling.
- Real settlement and notification providers.
- PDF generation for denial letters.
- Custom review UI per role (replacing default Tasklist).
- Customer-facing status page pulling live process state.
- Auth for the claimant portal.
- Adding/editing/removing `policy_dependents` (§9) on an *already-existing* policy — v1 only supports setting them at policy-creation time.
- Deploying to Camunda 8 SaaS instead of local Docker Compose.
- **Cloud hosting for the rest of the stack** (beyond Camunda, above). What needs to change before this app runs anywhere but a local machine:
  - Bucket access: the `claim-documents` MinIO bucket is public-read (`.claude/specs/generic/object-storage-provisioning.md`) — fine for throwaway dev data, not acceptable for real claim documents (often PII/health info) in production. Needs presigned URLs or an auth-gated proxy instead.
  - Object storage endpoint: swapping `MINIO_ENDPOINT`/credentials for a real S3-compatible provider (AWS S3, or self-hosted MinIO on a cloud VM/cluster) is mostly config-only, since `backend/api` already talks to it via the standard S3 API — but every `file_url` already stored in Postgres is baked with `localhost:9000`, so existing rows would need a migration, not just a config change.
  - Base URLs: `NEXT_PUBLIC_API_BASE_URL` (frontend) and `CORS_ORIGIN` (backend/api) both currently assume `localhost` — need real domains.
  - `docker-compose.yaml` (root) is a local-dev convenience, not a deployment target — Postgres, MinIO/S3, `backend/api`, and `frontend/portal` each become their own actually-hosted service (managed DB, managed object storage or a real MinIO deployment, container hosting for the two Node apps).
  - Secrets: `.env` files with plaintext credentials are fine locally; production needs a real secrets manager.

## 15. Definition of done (v1)

A health insurance claim can be submitted through the frontend, flows through the full BPMN process with real Gemini API calls at every AI step, a low-risk/low-value claim is confirmed by a triage reviewer even when the AI suggests no further specialist review is needed (`assignedRole = "auto"` is a suggestion the triage reviewer can accept or override, never a skip — see §10), a claim with fraud indicators routes to an investigator, a high-value claim routes to legal, a triage reviewer can override the AI's suggested role or reject an obviously invalid/fraudulent claim outright without a full role-specific review, a large approved settlement requires supervisor sign-off, and every step — automated or human — leaves a row in `audit_log` that reconstructs the full case history from intake to resolution. The process, workers, and DMN selection are all insurance-type-parameterized even though only `health` ships in v1.
