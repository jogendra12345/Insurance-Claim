> Inferred type: **generic** (no type given; this is a frontend/UI feature — the claimant portal's home page and claim submission flow — which doesn't map to db/bpmn/dmn/worker/insurance-type/api)

# generic/claimant-portal-ui

**Status:** Locked

> Locked 2026-08-20. Three of the five original Open Questions were decided at lock time (form-as-page, manual refresh, ad hoc policy-number entry) and are now folded into Design below. The remaining two — the claim-list API endpoint shape, and the claimant-facing timeline-copy mapping — are legitimate dependencies on other specs, not undecided UI design, and are carried forward as Follow-up dependencies rather than blocking this lock.

## Purpose

Give a claimant a single place to land in `frontend/portal/` (`SPEC.md` §6–§7): see their active claims at a glance, and start a new claim submission without hunting for it. This is `BUILD-PLAN.md` feature #1 ("Claim submission form") plus the claimant-facing half of feature #18 ("Status tracking & monitoring"), combined into one home experience rather than two disconnected pages — a claimant checking status and a claimant submitting a claim are the same person in the same session.

## Scope

**In scope:**
- A home page listing the claimant's active claims, scoped to the policy/policies they're associated with.
- A prominent action to start a new claim, opening the claim submission form (per `SPEC.md` §9's `claims` fields).
- The claim submission form itself: all required fields, a document upload widget, client-side validation, and a submit action wired to `POST /api/claims` once that endpoint exists (`BUILD-PLAN.md` feature #3).
- Baseline UI states every real screen needs: loading, empty ("no active claims yet"), and error (submit failed, list failed to load).

**Out of scope (for this spec):**
- The backend endpoints this page calls — `POST /api/claims` (feature #3) and whatever list/status endpoint the home page needs (see Open Questions) are specced and built separately, per `api`-type specs.
- Authentication — `SPEC.md` §2 explicitly excludes claimant portal auth from v1. Claimant scope is resolved by ad hoc policy-number entry instead (see Design) — no session state, no login flow.
- The Adjuster/Investigator/Legal review UI — that's stock Camunda Tasklist per §2, not this portal.
- Real-time updates (websockets/polling intervals) — decided against for v1; see Design.

## Design

### Page 1 — Home (`/`)

**Claimant scope.** No auth in v1 (§2), so scope is resolved by ad hoc policy-number entry: the home page opens on a small lookup ("Enter your policy number") rather than a claim list; submitting it loads that policy's active claims. This is intentionally lightweight — not a login, just the query key the list endpoint needs.

**Active claims list.** "Active" means `status NOT IN ('approved', 'denied')` (§9) — i.e. `submitted`, `validating`, `triage`, `in_review`, `awaiting_info` all show; resolved claims don't clutter the default view.

Each row/card shows:
- `policy_number` and `claim_type` (so a claimant with multiple policies can tell claims apart at a glance)
- `status`, rendered as a colored badge (not raw enum text — e.g. `submitted`/`validating` neutral, `triage`/`in_review` in-progress, `awaiting_info` attention-drawing since it implies the claimant may owe a response)
- `claim_amount` and `incident_date`
- `created_at`, relative ("3 days ago") with the absolute date on hover

Clicking a row expands or navigates to a detail view showing `case_summary` (once AI extraction has run) and a simple timeline derived from the claim's `audit_log` history — this is the claimant-facing, simplified cousin of what the `/case-trace` skill produces internally; it should show plain-language milestones ("Submitted", "Under review", "Assigned to an investigator"), not raw `actor_type`/`action` values, since those are written for internal audit purposes, not claimant consumption.

**Empty state.** If the claimant has zero active claims (new claimant, or everything resolved), replace the list with a friendly empty state and the same "Submit a claim" action, rather than an empty table.

**Refresh.** Manual only for v1 — a visible refresh action re-runs the list query for the entered policy number. No background polling.

**Primary action.** A persistent, unmissable "Submit a Claim" button (top of page, not buried) navigates to the claim submission page (`/claims/new`).

### Page 2 — Claim submission (`/claims/new`)

Fields, per `SPEC.md` §9's `claims` columns that a claimant actually supplies (excluding system-set fields like `id`, `status`, `risk_score`, `assigned_role`, `process_instance_key`):

| Field | Input type | Notes |
|---|---|---|
| `carrierId` | hidden/derived | Not claimant-entered — resolved from their session/policy context |
| `insuranceType` | hidden/derived | v1: always `health` (§3) |
| `policyNumber` | text, prefilled | Prefilled from the policy number entered on the home page; editable in case the claimant is filing against a different policy |
| `claimType` | select | `outpatient` \| `inpatient` \| `pharmacy` \| `dental` \| `maternity` \| `other` (§9's health enum) |
| `claimantName` | text | |
| `claimantEmail` | email | |
| `incidentDate` | date picker | Must not be in the future |
| `incidentDescription` | textarea | |
| `claimAmount` | currency number | Positive, reasonable max (client-side sanity bound only — not a business rule) |
| Documents | multi-file upload | Accepted types informed by the type config's expected document list (§3) — for health: medical bills, discharge summaries, prescriptions; show accepted formats/size limit in the UI, don't just reject silently on submit |

**Validation.** Required-field checks client-side before enabling submit, mirroring (not replacing) the server-side `validate-claim` worker's checks (`BUILD-PLAN.md` feature #5) — this is a UX nicety so a claimant doesn't submit and wait to find out a field was missing; the server remains the source of truth.

**Submit behavior.** On submit: disable the button, show a submitting state, call `POST /api/claims`. On success, show a clear confirmation (claim reference id) and navigate back to `/` with the entered policy number carried over, so the new claim appears in the active list without the claimant re-entering it. On failure, show what went wrong in plain language and leave the form filled in — never clear a claimant's typed data on error.

### Visual/interaction baseline

- Loading state for the claims list (skeleton rows, not a blank page) while the list endpoint resolves.
- Responsive layout — this is a claimant-facing portal; assume phone-sized viewports are common, not an afterthought.
- Status badges and any color-coding must remain legible/distinguishable without relying on color alone (a shape or label alongside color), since status is the single most scannable piece of information on the page.

## Follow-up dependencies

Not open UI-design questions — decided design depends on these being specced/built elsewhere before this page is fully wired up:

1. **Claim list endpoint.** `SPEC.md` currently only specs `GET /api/claims/:id` (single claim). This page needs a list-by-policy-number endpoint (e.g. `GET /api/claims?policyNumber=...`) that doesn't exist in the spec yet — needs its own `api`-type spec.
2. **Claimant-facing timeline copy.** The plain-language milestone labels (Submitted / Under review / Assigned to an investigator, etc.) described in Design aren't defined anywhere in `SPEC.md` yet, since `audit_log.action` values are written for internal/audit purposes. This spec assumes a translation layer exists between raw `audit_log` rows and claimant-facing copy, but doesn't define that mapping — needs its own follow-up spec (either folded into the list endpoint's `api` spec, or a small dedicated one).
