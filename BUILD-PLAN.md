# Build Plan — Feature Sequence (v1)

This expands the feature table you provided into a build-ready sequence, cross-checked against `SPEC.md`, `ROADMAP.md`, `GUIDE.md`, and what's actually in the repo today. It doesn't replace `ROADMAP.md` (the 7-step build order stays the authority) — it's the finer-grained plan underneath step 2 onward, with your phases/dates preserved except where analysis below required a change.

**Current state (as of this plan):** Step 1 (Database) is done — `claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log`, and `policies` all exist with migrations applied and verified. Nothing else in `ROADMAP.md` has been built yet: no `process/`, no `backend/api`, no `backend/workers`, no `backend/shared`, no `frontend/`.

---

## Analysis: changes made to your list, and why

1. **Reordered "Rule-based routing" after the two AI scoring features.** Your table lists it before "AI document extraction" and "AI risk & fraud scoring," but `SPEC.md` §11's DMN table takes `fraudIndicatorCount` and `riskScore` as inputs — those don't exist until the AI extraction and scoring workers have already run (§10 steps 4–7). Building routing before its own inputs exist means it can't be tested until the later features land anyway. Fixed order below.

2. **Added a missing feature: "Triage review & role confirmation."** Your table's "Risk-based review routing" is the *gateway* (`Needs Triage Review?`), but `SPEC.md` §10 step 9 has a distinct **User Task** where a human actually confirms or overrides the AI's suggested role (`assignedRole` → `confirmedRole`) — that's a separate reviewable feature (candidate group `triage-team`), not the same thing as the gateway that routes to it. Added as its own row.

3. **Added a missing feature: "Supervisor sign-off."** `SPEC.md` §10 step 12 has a maker-checker gate — large approved settlements (over a threshold) require a `supervisors`-group sign-off before payout. This isn't in your table at all. Added under Resolution, before Settlement payout.

4. **Moved "Full audit trail" from a final deliverable to an enforced constraint from day one.** Per `SPEC.md` §13 and `CLAUDE.md`, *every* worker and *every* human-task completion writes an `audit_log` row — if this is built as a separate Sep 11 feature, every worker built between now and then will need retrofitting. Recommendation: treat it as a compliance gate on each feature as it's built (the `/audit-log-check` skill already does this — run it against each new worker file before calling that feature done), and keep a Sep 11 slot only as a final full-system compliance sweep, not first implementation.

5. **Flagged "Multi-insurance-type extensibility" as out of v1 scope.** `SPEC.md` §2 states explicitly: *"No additional insurance types... implemented in v1 — only the extension points exist."* Scheduling it as a shipped Sep 11 feature contradicts that. The extension points themselves (insurance-type config module, `decisionIdExpression` DMN selection) get built *as part of* the job-worker and DMN features earlier in this plan — there's no separate feature to build later. Recommend either dropping this row, or reinterpreting it as a one-time validation exercise (scaffold a second type with the `/add-insurance-type` skill, confirm the pattern holds, then discard or leave unshipped) rather than a real deliverable.

6. **Pinned "Built with" to the stack `SPEC.md` §6 already decided**, instead of the either/or options in your table (`Node/Express or Spring Boot` → Node.js/TypeScript + Express; `Worker (Python/Node)` → Node/TypeScript; `Node/Java` → Node/TypeScript). `backend/package.json` and every skill built so far (`/new-job-worker`, etc.) already assume Node/TypeScript — mixing languages isn't actually on the table.

7. **Flagged a real blocker for "Claim storage" (Aug 21):** `SPEC.md` §6 specifies S3-compatible object storage via **local MinIO for dev**, but no MinIO service exists yet — not in `docker-compose.yaml`, not in `PREREQUISITES.md`. This needs to be provisioned *before* the claim-storage feature can actually save uploaded files, so it's added as a prerequisite sub-step.

8. **Updated "Claim validation"'s dependency.** Your table lists a vague "policy service." That's now concretely the `policies` Postgres table + `claims.policy_id` FK (built and verified this session — see `.claude/specs/db/database-setup.md`). `validate-claim` can query it directly; no separate service needed.

9. **Flagged the Claude API key as the single biggest external blocker.** `PREREQUISITES.md` still lists it as "not yet decided/installed." Three features in this plan — AI document extraction, AI risk & fraud scoring, denial letter drafting — cannot be built (only stubbed) without it. Get this before Aug 26.

10. **Fixed a doc-drift while I was in there:** `PREREQUISITES.md` still listed "Backend language" as undecided even though `SPEC.md` §6 already committed to Node.js/TypeScript, and `backend/package.json` already exists as a Node package. Updated `PREREQUISITES.md` to match (this is exactly the kind of sync `CLAUDE.md` asks for when a "still needed" item gets decided).

---

## Revised sequence

| # | Phase | Feature | Built with | Depends on | Estimate |
|---|---|---|---|---|---|
| 1 | Intake | Claim submission form | Next.js, React, file upload widget | — | 21-Aug |
| 2 | Intake | Object storage provisioning *(new prerequisite)* | MinIO (local, S3-compatible), added to `docker-compose.yaml` | — | 21-Aug |
| 3 | Intake | Claim storage | Node.js/TypeScript + Express, PostgreSQL, MinIO | #2, DB (done) | 21-Aug |
| 4 | Intake | Process orchestration kickoff | `@camunda8/sdk` (Zeebe client) | #3, `claim-case-process.bpmn` deployed | 21-Aug |
| 5 | Automated Processing | Claim validation | Node.js/TypeScript job worker, `policies` table | DB (done) | 26-Aug |
| 6 | Automated Processing | AI document extraction | Node.js/TypeScript job worker, Claude API | Claude API key, #4 | 26-Aug |
| 7 | Automated Processing | AI risk & fraud scoring | Node.js/TypeScript job worker, Claude API, `claim_fraud_indicators` | #6 | 26-Aug |
| 8 | Automated Processing | Rule-based routing *(reordered)* | DMN decision table | #7 (needs `riskScore`, `fraudIndicatorCount`) | 26-Aug |
| 9 | Human Review | Risk-based review routing | Exclusive gateway | #8 | 28-Aug |
| 10 | Human Review | Triage review & role confirmation *(new)* | Camunda Tasklist, candidate group `triage-team` | #9 | 28-Aug |
| 11 | Human Review | Adjuster / investigator / legal review | Camunda Tasklist, candidate groups `adjusters`/`investigators`/`legal-reviewers` | #10 | 28-Aug |
| 12 | Resolution | Decision routing | Exclusive gateway | #11 | 2-Sep |
| 13 | Resolution | Supervisor sign-off *(new)* | Camunda Tasklist, candidate group `supervisors` | #12, approve path only | 2-Sep |
| 14 | Resolution | Settlement payout | Node.js/TypeScript job worker, `SettlementProvider` (mocked) | #13 | 2-Sep |
| 15 | Resolution | Denial letter drafting | Node.js/TypeScript job worker, Claude API | Claude API key, #12 (deny path) | 2-Sep |
| 16 | Resolution | Claimant notification | Node.js/TypeScript job worker, `NotificationProvider` (mocked) | #14 or #15 | 2-Sep |
| 17 | Close | Case closure | Node.js/TypeScript job worker, PostgreSQL | #16 | 9-Sep |
| 18 | Close | Status tracking & monitoring | Next.js frontend polling, Camunda Operate | #17 | 9-Sep |
| 19 | Cross-Cutting | Audit trail compliance sweep *(reframed — enforced throughout #5–18, not a standalone build)* | `audit_log` table, `/audit-log-check` skill | all of the above | 11-Sep |
| 20 | Cross-Cutting | Insurance-type extensibility validation *(descoped from a shipped feature)* | `/add-insurance-type` skill, scaffold only | #5–8 built | 11-Sep |

---

## Detailed instructions per feature

### 1. Claim submission form
- Scaffold `frontend/portal/` (Next.js, TypeScript). One page: a form for claimant info (name, email, incident date/description, claim amount, `carrierId`, `insuranceType`, `policyNumber`) plus a file input for evidence documents.
- No submit logic yet — this feature is just the UI and client-side validation. Wiring to the backend happens once feature 3 (Claim storage) exists.

### 2. Object storage provisioning (prerequisite)
- Add a `minio` service to root `docker-compose.yaml`: image `minio/minio`, a named volume, default dev credentials via `.env`, console + API ports exposed.
- Update `.env.example` and `PREREQUISITES.md`'s tools table once running.
- Create the claims-documents bucket (via MinIO console or a startup script) before feature 3 needs it.

### 3. Claim storage
- Scaffold `backend/api/`. `POST /api/claims`: validate the request body, upload each file to MinIO, insert a `claims` row (per `SPEC.md` §9 — remember `policy_id` stays `NULL` until `validate-claim` resolves it), insert one `claim_documents` row per uploaded file with its MinIO `file_url`.
- Use `/dump-data claims 5` and `/seed-data claim_documents 1` while building this to sanity-check inserts land correctly before wiring the real form.

### 4. Process orchestration kickoff
- First, build `process/claim-case-process.bpmn` and `process/health-claim-routing.dmn` in Camunda Modeler per `SPEC.md` §10–§11 (this is `ROADMAP.md` step 2 — do it before this feature, even though your table places it under Intake).
- Deploy both to local Zeebe.
- In `POST /api/claims`, after the DB writes succeed, start a process instance (`@camunda8/sdk`) with the initial variables listed in §10 (`claimId`, `carrierId`, `insuranceType`, `policyNumber`, `claimType`, `claimAmount`); write the returned `processInstanceKey` back onto the `claims` row.

### 5. Claim validation
- `/new-job-worker validate-claim` to scaffold `backend/workers/validate-claim.ts` against §12's contract.
- Implement the required-field check via the claim's `insuranceType` config (`backend/shared/insurance-types/health.ts` — build this file as part of this feature; it doesn't exist yet).
- Implement the policy check as a real query: `SELECT * FROM policies WHERE policy_number = $1 AND carrier_id = $2`, confirm `status = 'active'` and `incidentDate` between `effective_date`/`expiry_date`; set `claims.policy_id` on match.
- `/audit-log-check backend/workers/validate-claim.ts` before calling it done.

### 6. AI document extraction
- `/new-job-worker extract-evidence`.
- Loads `claim_documents` for the claim, calls Claude (prompt template from the type config) per document, writes `extracted_data` back per row and `case_summary` onto `claims`.
- Requires the Claude API key — get this decided/added to `.env` before starting.

### 7. AI risk & fraud scoring
- `/new-job-worker detect-fraud-indicators` and `/new-job-worker score-risk` (two separate workers per §12).
- `detect-fraud-indicators` writes rows to `claim_fraud_indicators` and sets `claims.fraud_indicator_count`.
- `score-risk` writes `claims.risk_score`.
- `/audit-log-check` both.

### 8. Rule-based routing
- Build/finalize `process/health-claim-routing.dmn` per §11's 5-rule table (hit policy FIRST). Wire the Business Rule Task's `decisionIdExpression` to `=insuranceType + "-claim-routing-decision"`.
- `/dmn-table-review process/health-claim-routing.dmn` to confirm it matches spec before deploying.

### 9. Risk-based review routing
- This is the `Needs Triage Review?` exclusive gateway in the BPMN — condition on `assignedRole = "auto"` (default/skip) vs. anything else (go to triage). Configure directly in Modeler; no worker involved.

### 10. Triage review & role confirmation
- Configure the `Triage Review` User Task in Modeler: candidate group `triage-team`, form fields showing `caseSummary`, `riskScore`, fraud indicators, and `assignedRole`; output variable `confirmedRole`.
- No code — this is Tasklist configuration + a manual walkthrough to confirm a triage user can see and act on it.

### 11. Adjuster / investigator / legal review
- Configure the three role-specific User Tasks (`Adjuster Review`, `Investigator Review`, `Legal Review`) behind the `Route by Confirmed Role` gateway, each with its candidate group and a form producing `decision` (+ `denialReason` if denying).
- Resolve `ROADMAP.md`'s "Open decision before Step 6" first — decide whether to switch to `docker-compose-full.yaml` for real Identity/Keycloak users, since the lightweight config's single `demo` user can't test group-scoped routing meaningfully.

### 12. Decision routing
- The `Decision` exclusive gateway — `approve` (default), `deny`, `moreInfo` (ends the process per §10 step 11). Modeler configuration only.

### 13. Supervisor sign-off
- The `Needs Second Sign-off?` gateway (claim amount over threshold, e.g. 50,000) plus the `Supervisor Sign-off` User Task, candidate group `supervisors`. Modeler configuration.

### 14. Settlement payout
- `/new-job-worker trigger-settlement`. Define the `SettlementProvider` TypeScript interface in `backend/shared/`, with one mock implementation (`mockSettlementProvider.pay()` always succeeds). Worker calls it, writes `settlementId`.

### 15. Denial letter drafting
- `/new-job-worker draft-denial-letter`. Calls Claude to draft letter text grounded in `denialReason`. No real PDF generation in v1 (§14 future work) — text output only.

### 16. Claimant notification
- `/new-job-worker notify-claimant`. Define `NotificationProvider` interface + mock (`console.log`/no-op instead of sending). Worker calls it regardless of decision outcome.

### 17. Case closure
- `/new-job-worker close-case`. Writes final `status` onto `claims`.

### 18. Status tracking & monitoring
- `GET /api/claims/:id` in `backend/api/` (simple read from `claims`).
- Frontend status page in `frontend/portal/` polling that endpoint.
- Operations-side monitoring is just pointing people at Operate (`localhost:8080/operate`) — no custom build needed per v1 scope.

### 19. Audit trail compliance sweep
- Not a build step — a verification pass. Run `/audit-log-check` against every worker file and every user-task form built above. Run `/case-trace <claim-id>` on a handful of test claims (once feature 18 exists) to confirm every Camunda step has a matching `audit_log` row end to end.

### 20. Insurance-type extensibility validation
- Run `/add-insurance-type vehicle` (or another type) to scaffold a config module + DMN skeleton, confirm the pattern holds without touching the BPMN process (the skill enforces this). Review the result; per §2's non-goals, don't wire it into the live process or ship it in v1 — this is a design validation, not a v1 deliverable.
