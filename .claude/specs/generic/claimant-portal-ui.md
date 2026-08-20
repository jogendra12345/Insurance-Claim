> Inferred type: **generic** (no type given; this is a frontend/UI feature — the claimant portal's home page and claim submission flow — which doesn't map to db/bpmn/dmn/worker/insurance-type/api)

# generic/claimant-portal-ui

**Status:** Locked

> Locked 2026-08-20. Three of the five original Open Questions were decided at lock time (form-as-page, manual refresh, ad hoc policy-number entry) and are now folded into Design below. The remaining two — the claim-list API endpoint shape, and the claimant-facing timeline-copy mapping — are legitimate dependencies on other specs, not undecided UI design, and are carried forward as Follow-up dependencies rather than blocking this lock.
>
> Updated 2026-08-20 (same day, after initial build): reworked in place following direct feedback once the portal was actually built and used. Two decisions this lock made are reversed:
> - **Claimant scope is no longer ad hoc-policy-number-gated by default.** The Claims tab now shows *all* claims immediately, with policy-number filtering as an optional narrowing control rather than a required first step. The "no auth in v1, so scope via policy number" rationale (§2) still holds for the *filter*; it's no longer the mandatory entry point.
> - **Claim detail is a dedicated page (`/claims/[id]`), not an inline expand/navigate ambiguity** — the original Design left this open ("expands or navigates"); it's now decided as a separate route, addressable by claim id.
>
> Also added to scope: a **Policies tab** (`/policies`) — list, add, delete — which didn't exist in the original design at all. Amended in place rather than as a new spec, consistent with how `db/database-setup.md` handles post-lock amendments in this repo, since nothing about the amendment breaks an already-shipped contract (the claim submission flow and its fields are unchanged).

## Purpose

Give a claimant (and, in practice today, whoever's operating the portal — see the Policies tab below) a working home for the whole claims/policies lifecycle in `frontend/portal/` (`SPEC.md` §6–§7): see all claims at a glance with headline numbers, drill into any one of them, submit a new one, and manage the policies claims are filed against. This spans `BUILD-PLAN.md` feature #1 ("Claim submission form"), the claimant-facing half of feature #18 ("Status tracking & monitoring"), and policy management — which wasn't a named `BUILD-PLAN.md` feature but is a direct prerequisite for `validate-claim` (feature #5) having real policies to check against.

## Scope

**In scope:**
- A **Claims tab** (`/`, the app's default route) showing four headline KPIs (total claims, active claims, total claimed value, needs-attention count) and a grid of every claim, each linking to its own detail page. An optional policy-number filter narrows the grid; it is not required to see anything.
- A **claim detail page** (`/claims/[id]`) showing the full record for one claim: policy, claimant, incident details, amount, status, and (once populated) risk score, fraud indicator count, decision, and case summary.
- A prominent action to start a new claim, opening the claim submission form (per `SPEC.md` §9's `claims` fields).
- The claim submission form itself: all required fields, a document upload widget, client-side validation, and a submit action wired to `POST /api/claims`.
- A **Policies tab** (`/policies`): a grid of all policies with status shown, an inline "add policy" panel (no separate page/modal — a form that expands in place), and a delete action per policy with a confirmation step and a clear error if the policy still has claims referencing it (the DB enforces `ON DELETE RESTRICT` — see `.claude/specs/db/database-setup.md`).
- Tab navigation (Claims / Policies) in a persistent top bar, so both areas are one click apart.
- Baseline UI states every real screen needs: loading, empty, and error, on every list/grid above.

**Out of scope (for this spec):**
- The backend endpoints these pages call — specced/built separately (see Follow-up dependencies for what's still undocumented in `SPEC.md` proper).
- Authentication — `SPEC.md` §2 explicitly excludes claimant portal auth from v1. There is currently no distinction between "a claimant" and "an operator" using this portal — the Policies tab's add/delete controls are visible to anyone who opens the app. That's an accepted v1 gap, not a design decision made here.
- The Adjuster/Investigator/Legal review UI — that's stock Camunda Tasklist per §2, not this portal.
- Real-time updates (websockets/polling intervals) — decided against for v1; see Design.
- A claimant-facing translated audit-log timeline on the claim detail page — still a Follow-up dependency (#2 below); the detail page shows `case_summary` only for now.

## Design

### Page 1 — Claims (`/`)

**Claimant scope.** No auth in v1 (§2). Unlike the original design, entering a policy number is no longer required to see anything — the tab loads every claim immediately. A `PolicySelect` dropdown above the grid optionally filters down to one policy's claims; a "Show all" control clears it. This is a filter, not a gate.

**KPI row.** Four stat tiles above the grid, computed over whatever set of claims is currently loaded (all, or the filtered subset):
1. **Total claims** — count.
2. **Active claims** — count where `status NOT IN ('approved', 'denied')` (§9).
3. **Total claimed value** — sum of `claim_amount` across the loaded set.
4. **Needs attention** — count where `status = 'awaiting_info'`, visually flagged (not just numeric) since it implies the claimant may owe a response.

**Claim grid.** Every loaded claim as a card in a responsive grid (not a vertical list — this reverses the original single-column design). Each card shows:
- `claim_type` and `policy_number` + `claimant_name`
- `status`, rendered as a colored badge with a distinct label and glyph — never color alone (unchanged from the original design)
- A 3-stage progress indicator (Submitted → In review → Decision) alongside the badge, giving an at-a-glance read on how far along a claim is without reading the badge text
- `claim_amount` and `created_at` (relative, e.g. "3 days ago", with the absolute date available on hover)

Clicking a card navigates to `/claims/[id]` (see Page 3) — no more inline expand.

**Empty state.** If the loaded set (all, or the filtered policy) has zero claims, replace the grid with a friendly empty state and the same "Submit a Claim" action.

**Refresh.** Manual only for v1 — a visible refresh action re-runs the current query (all, or the active filter). No background polling.

**Primary action.** A persistent "Submit a Claim" button in the page header navigates to the claim submission page (`/claims/new`).

### Page 2 — Claim submission (`/claims/new`)

Fields, per `SPEC.md` §9's `claims` columns that a claimant actually supplies (excluding system-set fields like `id`, `status`, `risk_score`, `assigned_role`, `process_instance_key`):

| Field | Input type | Notes |
|---|---|---|
| `carrierId` | hidden/derived | Not claimant-entered — resolved from their session/policy context |
| `insuranceType` | hidden/derived | v1: always `health` (§3) |
| `policyNumber` | dropdown (`PolicySelect`), prefilled | A real dropdown sourced from `GET /api/policies` (not free text, per direct feedback during build) — prefilled from the Claims tab's active filter if one was set, otherwise blank. Selecting a policy also auto-fills `claimantName` from that policy's `policyholder_name`, still editable. |
| `claimType` | select | `outpatient` \| `inpatient` \| `pharmacy` \| `dental` \| `maternity` \| `other` (§9's health enum) |
| `claimantName` | text | |
| `claimantEmail` | email | |
| `incidentDate` | date picker | Must not be in the future |
| `incidentDescription` | textarea | |
| `claimAmount` | currency number | Positive, reasonable max (client-side sanity bound only — not a business rule) |
| Documents | multi-file upload | Accepted types informed by the type config's expected document list (§3) — for health: medical bills, discharge summaries, prescriptions; show accepted formats/size limit in the UI, don't just reject silently on submit |

**Structure.** A 4-step wizard with a stepper header (Policy → About the incident → Documents → Review), not one long scroll of fields — each step validates before advancing, and the final step shows a read-only summary of every entered value before submit. This replaces the original single-screen field-list design; the field set and validation rules themselves are unchanged, only how they're paced.

**Validation.** Required-field checks client-side per step before advancing, mirroring (not replacing) the server-side `validate-claim` worker's checks (`BUILD-PLAN.md` feature #5) — this is a UX nicety so a claimant doesn't get to the end and find out a field was missing; the server remains the source of truth.

**Submit behavior.** On the Review step's submit: disable the button, show a submitting state, call `POST /api/claims`. On success, show a clear confirmation (claim reference id) and a button back to `/`, which now shows every claim by default — no query-param handoff needed. On failure, show what went wrong in plain language and leave the form filled in — never clear a claimant's typed data on error.

### Page 3 — Claim detail (`/claims/[id]`)

Fetches one claim via `GET /api/claims/:id` and shows, in full: `id`, `status` (badge), `policy_number`, `claimant_name` + `claimant_email`, `incident_date`, `incident_description`, `claim_amount`, and — once populated by later process steps — `confirmed_role`, `risk_score`, `fraud_indicator_count`, `decision`, `denial_reason`. A `case_summary` block always renders, with a plain "not yet available" placeholder before AI extraction has run rather than an empty section.

Loading and error states match the rest of the app (skeleton block, then a `role="alert"` error banner on failure). A back link returns to the Claims tab.

**Not included yet:** the plain-language audit-log timeline described in the original Design (Follow-up dependency #2, still open) — this page shows `case_summary` only, not a step-by-step history.

### Page 4 — Policies (`/policies`)

**Grid.** Every policy as a card: `policy_number`, `policyholder_name`, a status pill (`active`/`lapsed`/`cancelled`, colored per the same semantic-status convention as claim status badges), and the effective/expiry date range.

**Add policy.** A "+ Add policy" button toggles an inline form (not a separate page or modal) with fields for `policy_number`, `policyholder_name`, `status` (select, defaults to `active`), `effective_date`, and `expiry_date`. `carrier_id` is not a form field — no real multi-carrier concept is exposed in this portal yet (§14), so a fresh id is generated server-side per new policy. On success, the form closes and the grid refreshes; on failure (e.g. duplicate `policy_number`), the error shows inline without losing entered values.

**Delete policy.** Each card has a "Delete" action. Confirms before proceeding (destructive, irreversible). If the policy still has claims referencing it, the database's `ON DELETE RESTRICT` (`.claude/specs/db/database-setup.md`) rejects the delete — the portal must surface this as a clear message ("Can't delete this policy — one or more claims still reference it"), not a raw error.

### Visual/interaction baseline

- Loading state for the claims list (skeleton rows, not a blank page) while the list endpoint resolves.
- Responsive layout — this is a claimant-facing portal; assume phone-sized viewports are common, not an afterthought.
- Status badges and any color-coding must remain legible/distinguishable without relying on color alone (a shape or label alongside color), since status is the single most scannable piece of information on the page.

## Follow-up dependencies

Not open UI-design questions — decided design depends on these being specced/built elsewhere:

1. ~~**Claim list endpoint.**~~ **Resolved 2026-08-20** — `GET /api/claims` (optionally filtered by `?policyNumber=`) and `GET /api/claims/:id` are both built in `backend/api/src/routes/claims.ts`. Neither is documented as a numbered endpoint in `SPEC.md` §7 yet alongside `POST /api/claims` — still worth folding into a proper `api`-type spec, but no longer blocks anything.
2. **Claimant-facing timeline copy.** The plain-language milestone labels (Submitted / Under review / Assigned to an investigator, etc.) described in the original Design aren't defined anywhere in `SPEC.md` yet, since `audit_log.action` values are written for internal/audit purposes. The claim detail page (Page 3) ships without this — `case_summary` only. Still needs its own follow-up spec defining the raw-row-to-copy mapping.
3. **Policy CRUD endpoints undocumented in `SPEC.md`.** `POST /api/policies` and `DELETE /api/policies/:id` (`backend/api/src/routes/policies.ts`) exist and work but, like `GET /api/policies` before them, aren't part of `SPEC.md`'s documented API surface. Same treatment as #1 — works today, needs a proper `api`-type spec to stop drifting silently.
