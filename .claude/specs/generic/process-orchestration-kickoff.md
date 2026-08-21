> Inferred type: **generic** (no type given; this feature spans a new BPMN process, a new DMN table, and a change to `POST /api/claims`, which doesn't map to a single db/bpmn/dmn/worker/insurance-type/api spec on its own)

# generic/process-orchestration-kickoff

**Status:** Draft

## Purpose

Make claim submission actually start a Camunda process instance. This is
`BUILD-PLAN.md` feature #4 ("Process orchestration kickoff", 21-Aug) and
`ROADMAP.md` step 2 combined — the roadmap step (authoring/deploying the
process) has to happen first since the API-side kickoff has nothing to start
without it.

Today `POST /api/claims` (`backend/api/src/routes/claims.ts`) writes
`claims`, `claim_documents`, and an `audit_log` row, then stops — the
handler's own comment flags this gap explicitly ("Zeebe process kickoff
... isn't wired up yet"). This spec closes that gap: a submitted claim
becomes a live, running Zeebe process instance, not just a static Postgres
row.

## Scope

**In scope:**
- `process/health-claim-routing.dmn` — a minimal DMN table matching
  `SPEC.md` §11, enough for the BPMN's Business Rule Task to reference a
  real `decisionIdExpression`.
- `process/claim-case-process.bpmn` — the full 13-step process from
  `SPEC.md` §10 (start event through both terminal end events).
- Deploying both to the local Zeebe instance (`camunda-docker`, unprotected
  REST API at `localhost:8080/v2`).
- Adding `@camunda8/sdk` to `backend/api` and wiring a Zeebe client.
- In `POST /api/claims`, after the existing DB/MinIO writes commit: start a
  `claim-case-process` instance with the initial variables from `SPEC.md`
  §10, store the returned `processInstanceKey` on the `claims` row, and
  write one more `audit_log` row for the process-start event.

**Out of scope (for this spec):**
- Any job worker (`validate-claim`, `extract-evidence`, etc.) —
  `backend/workers/` stays empty. A started instance is expected to sit
  waiting at the first service task with no worker to pick it up; that's
  the correct, verified state for this feature, not a bug to fix here.
- Tasklist candidate-group configuration (`ROADMAP.md` step 6, still
  blocked on the Identity/Keycloak decision noted there).
- Real business logic in the DMN table beyond matching `SPEC.md` §11's
  documented rule set — no per-carrier tuning.
- Any change to the claimant-facing submission form or status page.

## Design

### `process/health-claim-routing.dmn`

Per `SPEC.md` §11:
- Table id/name: `health-claim-routing-decision`.
- Hit policy: `FIRST`.
- Inputs: `fraudIndicatorCount`, `riskScore`, `claimAmount`, `claimType`.
- Output: `assignedRole`.
- Rules, in priority order:

| Fraud Indicators | Risk Score | Claim Amount | Claim Type | → Assigned Role |
|---|---|---|---|---|
| ≥ 1 | – | – | – | investigator |
| – | – | > 50000 | – | legal |
| – | ≥ 40 | – | – | adjuster |
| – | – | > 5000 | – | adjuster |
| – | – | – | – | auto |

`claimType` is carried as an input but unused by any rule in v1, reserved
for future type-specific triggers — matches §11 exactly, no deviation.

### `process/claim-case-process.bpmn`

Per `SPEC.md` §10, insurance-type-agnostic. Started with initial variables
`claimId`, `carrierId`, `insuranceType`, `policyNumber`, `claimType`,
`claimAmount`.

| # | Element | Type | Candidate group | Calls |
|---|---|---|---|---|
| 1 | Claim Submitted | Start Event | — | — |
| 2 | `validate-claim` | Service Task | — | job type `validate-claim` |
| 3 | Validation Passed? | Exclusive Gateway | — | — |
| 3a | Validation Exception Review | User Task (no-path branch) | `triage-team` | — |
| 4 | `extract-evidence` | Service Task | — | job type `extract-evidence` |
| 5 | `detect-fraud-indicators` | Service Task | — | job type `detect-fraud-indicators` |
| 6 | `score-risk` | Service Task | — | job type `score-risk` |
| 7 | Routing decision | Business Rule Task | — | DMN, `decisionIdExpression` = `=insuranceType + "-claim-routing-decision"` |
| 8 | Needs Triage Review? | Exclusive Gateway | — | — |
| 9 | Triage Review | User Task (non-auto branch) | `triage-team` | — |
| 10 | Route by Confirmed Role | Exclusive Gateway | — | — |
| 10a | Adjuster Review | User Task | `adjusters` | — |
| 10b | Investigator Review | User Task | `investigators` | — |
| 10c | Legal Review | User Task | `legal-reviewers` | — |
| 11 | Decision | Exclusive Gateway | — | — |
| 11a | Awaiting More Information | End Event (`moreInfo` branch) | — | — |
| 12 | Needs Second Sign-off? | Exclusive Gateway (approve branch) | — | — |
| 12a | Supervisor Sign-off | User Task | `supervisors` | — |
| 12b | `trigger-settlement` → `notify-claimant` → `close-case` | Service Tasks | — | job types `trigger-settlement`, `notify-claimant`, `close-case` |
| 12c | Claim Approved | End Event | — | — |
| 13 | `draft-denial-letter` → `notify-claimant` → `close-case` | Service Tasks (deny branch) | — | job types `draft-denial-letter`, `notify-claimant`, `close-case` |
| 13a | Claim Denied | End Event | — | — |

Deployed under the process id `claim-case-process` so the backend's
`ZBClient.createProcessInstance({ bpmnProcessId: "claim-case-process", ... })`
call has a fixed target. Written and deployed by hand (Camunda Modeler
isn't scriptable from here) — the diagram gets opened in Modeler afterward
only to visually confirm it rendered correctly, not to author it there.

### Deployment

`curl -F "process/claim-case-process.bpmn=@process/claim-case-process.bpmn" -F "process/health-claim-routing.dmn=@process/health-claim-routing.dmn" localhost:8080/v2/deployments`
(or equivalent, against whatever the running Camunda 8.9 REST API's
deployment endpoint shape actually is — confirmed at build time, not
guessed here). Verified afterward in Operate (`localhost:8080/operate`) by
confirming both resources show up as deployed.

### `backend/api` changes

- Add the `@camunda8/sdk` npm package.
- New `backend/api/src/zeebe.ts` (mirroring the existing `storage.ts`
  pattern): constructs one shared `ZBClient` (or whatever the current SDK's
  client class is named) pointed at `ZEEBE_ADDRESS`, no-auth per the
  lightweight stack's unprotected API (confirmed: `camunda-docker/README.md`
  line 48 — the lightweight `docker-compose.yaml` runs with no
  Identity/Keycloak, so the Zeebe client needs no credentials).
- `backend/api/.env.example` and `.env`: add `ZEEBE_ADDRESS=localhost:26500`.
- In `POST /api/claims` (`claims.ts`), after the existing transaction
  commits: call `createProcessInstance` with `bpmnProcessId:
  "claim-case-process"`, variables `{ claimId: claim.id, carrierId:
  claim.carrier_id, insuranceType: claim.insurance_type, policyNumber,
  claimType, claimAmount }`. On success, `UPDATE claims SET
  process_instance_key = $1 WHERE id = $2` with the returned
  `processInstanceKey`, and insert one more `audit_log` row (`action:
  'process-started'`, `actor_type: 'system'`, detail including the
  `processInstanceKey`) — per `SPEC.md` §13 / `CLAUDE.md`'s "every step
  writes to `audit_log`" rule.
- No new migration needed: `process_instance_key text` and its index
  already exist on `claims` from `backend/db/migrations/0001_initial_schema.sql`
  (lines 34/41) — this spec only starts writing to a column that was
  already provisioned.
- Failure handling: if `createProcessInstance` throws, the claim/document
  rows have already committed (they happen in an earlier, already-committed
  transaction) — this spec does not roll those back on a Zeebe failure. The
  claim exists in Postgres without a `process_instance_key`; that's a
  recoverable, visible gap (queryable via `WHERE process_instance_key IS
  NULL`), not a silent one. A retry/backfill path is future work, not part
  of this spec.

### Verification

Submit a test claim through the running app (or `curl` against
`POST /api/claims`), then confirm in Operate that a process instance
exists for `claim-case-process` and is currently waiting at the
`validate-claim` service task — expected, since no worker exists yet to
claim that job.

## Open Questions

- Exact `@camunda8/sdk` client class name/constructor shape and exact REST
  deployment endpoint path may differ slightly by the installed SDK/Camunda
  8.9 version — resolve at implementation time against the installed
  package's own types/docs rather than guessing further here.
- Whether the `moreInfo` end event should really be terminal in v1 (§14
  flags this as a known future-work gap) is out of scope for this spec —
  inherited as-is from `SPEC.md` §10.
