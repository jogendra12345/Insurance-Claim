> Inferred type: **generic** (no type given; this feature spans a new `users` table, several API endpoints, and a new frontend route — no single db/bpmn/dmn/worker/insurance-type/api section in SPEC.md covers it as one unit)

# generic/auth-role-based-access

**Status:** Draft

## Purpose

Give ClaimFlow AI real authentication and role-based access control, replacing today's fully open API (`GET /api/claims`/`/api/policies` return every row to anyone) and the fact that every Camunda Tasklist action is performed as the single `demo` basic-auth user regardless of which BPMN candidate group a task is actually restricted to. This is `BUILD-PLAN.md` Phase 2 item #21, already scoped at a high level in `SPEC.md` §14 ("Auth + role-based access for the frontend portal, plus a custom in-app task page") as **Option B** — this spec fleshes that paragraph out into a buildable design. It directly unblocks `ROADMAP.md` Step 6 (human review with real distinct users per candidate group) by sidestepping rather than resolving the "Open decision before Step 6" — no Identity/Keycloak, no Camunda SaaS migration. It's also a hard dependency for the `moreInfo` resubmit endpoint (§14) and the audit view (§14, `BUILD-PLAN.md` #33), both of which need to know who's asking before trusting a request scoped to one claim.

## Scope

**In scope:**
- A `users` table and self-registration for claimants, gated by a lightweight policy-match check (policy number + email), and admin-only provisioning for every staff role.
- Session-based login/logout for the frontend portal.
- Scoping `GET /api/claims`/`/api/policies` (and any claim-detail endpoint) by the authenticated caller's role.
- An explicit role → BPMN candidate-group map.
- `backend/api` holding the single Camunda `demo` credential server-side and proxying task actions (`GET /api/tasks`, `POST /api/tasks/:key/claim`, `POST /api/tasks/:key/complete`) so end users never see Camunda credentials.
- A new staff-only `/tasks` route in `frontend/portal` that lists and completes tasks via the endpoints above, reusing the existing Camunda form field sets (`TriageReviewForm`, `ReviewDecisionForm`, `ValidationExceptionReviewForm`).
- Password storage/hashing approach and session mechanism (decided below).

**Out of scope (for this spec — remains future work per `SPEC.md` §14 unless called out):**
- Per-carrier tenant isolation (auth scoping by `carrier_id`) — a separate §14 item; this spec's role scoping is orthogonal to carrier scoping and doesn't block it, but doesn't implement it either.
- The `moreInfo` resubmit endpoint itself (`POST /api/claims/:id/resubmit`) — this spec only unblocks it by existing; the endpoint is specced separately in `SPEC.md` §14's `moreInfo` item.
- The audit view page/endpoint — same relationship: unblocked, not built here.
- Switching to Camunda-native Identity/Keycloak (`docker-compose-full.yaml`) or Camunda SaaS — explicitly the alternative this spec avoids (Option B over Options 1/2 in `ROADMAP.md`).
- Password reset / email-ownership verification (confirmation code) / DOB-or-zip identity checks — v1 signup only proves policy-holder status via policy number + email match (see "Claimant signup verification" in Design), not inbox ownership; see Open Questions.
- OAuth/SSO providers (Google, Microsoft, etc.) — internal test app, not a product requiring third-party login.
- Per-request Camunda `assignee` passthrough of the real app-user's identity — flagged as an open question in `SPEC.md` §14 (whether the lightweight Camunda stack accepts an arbitrary `assignee` string); noted here as a nice-to-have, not required for access control since the app's own auth is the enforcement boundary, not Camunda's.

## Design

### Data model — `users` table

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | primary key |
| `email` | text | no | — | unique, case-insensitive (citext or `lower(email)` unique index) |
| `password_hash` | text | no | — | bcrypt/argon2, never plaintext |
| `role` | text | no | — | `claimant \| admin \| triage-team \| adjuster \| investigator \| legal-reviewer \| supervisor` (check constraint or enum) |
| `created_at` | timestamptz | no | `now()` | |

Claimants self-register via a signup form; the request body accepts no `role` field — the API hardcodes `role = 'claimant'` for the public signup endpoint. Signup additionally requires a `policyNumber` field (see "Claimant signup verification" below) — the account isn't created unless it passes that check. Every staff role (`admin`, `triage-team`, `adjuster`, `investigator`, `legal-reviewer`, `supervisor`) is created only by an existing `admin`, via an admin-only user-management endpoint/page (in scope for this spec, minimal — create + list + deactivate, no self-service staff signup ever). This mirrors the exact wording already locked in `SPEC.md` §14: "letting someone pick 'I'm a supervisor' at signup would let anyone grant themselves settlement-approval authority."

No `carrier_id` on `users` in this pass — see Out of scope above.

### Claimant signup verification (lightweight)

Real insurers don't create a policyholder account off an email address alone — the common pattern (confirmed by looking at how live insurer portals handle this) is: policy number + one or two more identifiers not derivable from just knowing an email (DOB, zip, name), checked before account creation, followed by a separate email-ownership verification (confirmation code) before the account is usable. Full production form is more than this test app needs, but the "prove you actually hold the policy" half of it is cheap and closes the most obvious gap — today's design otherwise lets anyone who merely knows a policyholder's email address register and immediately see that policyholder's claims.

**What this spec adopts:** `POST /api/auth/signup` requires `email`, `password`, and `policyNumber`. The endpoint looks up `policies` by `policy_number` and checks the submitted `email` (case-insensitive) against that policy's `policyholder_email` **or** any of its `policy_dependents.email` rows — the exact same match `validate-claim` already performs for authorized claimants (`SPEC.md` §9). If no policy row matches both fields, signup is rejected (`400`, generic "policy number and email don't match our records" message — deliberately not revealing *which* field failed, to avoid leaking whether a given policy number or email exists). On success, the account is created immediately — **no email-verification code and no DOB/zip step**; those stay explicitly out of scope (see Out of scope) as the part of the real-world pattern this spec deliberately doesn't adopt for an internal test app (`[[project_demo_app_no_real_payments]]`).

This check only runs at signup, once. It doesn't change `GET /api/claims`/`/api/policies` scoping (still plain `claimant_email` match, per "Scoping existing endpoints" below), and it doesn't retroactively touch claims submitted before the claimant's account existed — those still surface once their `claimant_email` matches the logged-in user's email.

A claimant tied to more than one policy (e.g. a dependent on one policy who is also a policyholder on another) only needs `policyNumber` to match *one* policy at signup — this proves policy-holder status once, not per-policy; every claim under any policy sharing that same email is visible to them either way, since scoping is by email, not by the policy used at signup.

### Session mechanism

Server-side session, not JWT: `backend/api` sets an httpOnly, `SameSite=Lax` session cookie on login; session state (user id, role) lives server-side (in Postgres, a `sessions` table keyed by opaque token — matches the rest of the stack's Postgres-first pattern rather than adding Redis for v1) or, alternatively, a signed cookie carrying `{userId, role}` if session-table overhead isn't wanted for a test app. **Open question — see below**; this spec assumes the Postgres `sessions` table unless the review flags it as overkill for an internal test app (`[[project_demo_app_no_real_payments]]`).

`POST /api/auth/signup` (claimant only, policy-matched per above), `POST /api/auth/login`, `POST /api/auth/logout`. No email-ownership verification, no password reset in v1 (Open Questions).

### Scoping existing endpoints

- `GET /api/claims`, `GET /api/claims/:id`, `GET /api/policies`, `GET /api/policies/:id`: for `role = 'claimant'`, scoped to rows where `claimant_email = current user's email` — reusing the exact case-insensitive email-matching approach `validate-claim` already uses for authorized-claimant checks (`SPEC.md` §9 "Authorized claimants"). For `role = 'admin'`, unscoped (sees everything). For every other staff role (`triage-team`/`adjuster`/`investigator`/`legal-reviewer`/`supervisor`), same unscoped read access as `admin` for now — v1 doesn't restrict claim *visibility* by review role, only task *action* (below). Restricting staff read-scope by role is a possible follow-up, not required for the Tasklist-proxy problem this spec exists to solve.
- Unauthenticated requests to any of the above: `401`.

### Role → candidate-group map

Explicit map, not a string transform (names aren't identical):

| App role | BPMN candidate group |
|---|---|
| `triage-team` | `triage-team` |
| `adjuster` | `adjusters` |
| `investigator` | `investigators` |
| `legal-reviewer` | `legal-reviewers` |
| `supervisor` | `supervisors` |
| `admin` | all groups |
| `claimant` | none — never sees `/tasks` |

### Task proxy endpoints (`backend/api`)

The app's own auth is the trust boundary; Camunda stays behind it as a trusted backend service, per `SPEC.md` §14. `backend/api` holds the single `demo` credential server-side (already true today, just not yet enforced as a boundary) and adds:

- `GET /api/tasks` — maps the caller's role to a candidate group via the table above, calls Tasklist's `POST /v2/user-tasks/search` filtered to that group, joins results against `claims` for display context (claimant name, amount, status). `admin` gets tasks across all groups.
- `POST /api/tasks/:key/claim` — proxies `/v2/user-tasks/:key/assignment`. Rejects (`403`) if the task's candidate group doesn't match the caller's mapped group (double-checks server-side even though `GET /api/tasks` already filtered what's shown).
- `POST /api/tasks/:key/complete` — proxies `/v2/user-tasks/:key/completion`, forwarding the same form-field payloads today's Camunda `TriageReviewForm`/`ReviewDecisionForm`/`ValidationExceptionReviewForm` already produce, so BPMN-side behavior is unchanged.

End users never receive or use Camunda credentials at any point.

### Frontend — `/tasks` route

New staff-only route in `frontend/portal`. Redirects `role = 'claimant'` (and unauthenticated visitors) away. Lists open tasks for the caller's group via `GET /api/tasks`, opens the matching review form (same field sets as the existing Camunda-rendered forms) per task, and posts completions via `POST /api/tasks/:key/complete`. Stock Tasklist at `localhost:8080/tasklist` keeps working standalone for direct debugging — this route doesn't replace it, it gives end users an alternative that doesn't require Camunda credentials.

### Login/signup UI

Minimal: a `/login` page and a `/signup` page (claimant self-registration only) in `frontend/portal`, plus a logged-in-state indicator and logout control in the existing top nav (`[[claimant-portal-ui]]` already owns that nav bar — this spec adds to it, doesn't redesign it).

## Open Questions

1. **Session storage: Postgres `sessions` table vs. signed cookie?** A `sessions` table is consistent with this stack's Postgres-first pattern and makes server-side revocation (logout-everywhere, admin-deactivates-user) trivial; a signed cookie needs no new table but makes revocation harder (would need a token-versioning column on `users` instead). Given this is an internal test app (`[[project_demo_app_no_real_payments]]`) — recommend the simpler signed-cookie approach unless revocation is a real requirement.
2. **Does the admin user-management UI/endpoint belong in this spec's build, or is a raw SQL insert acceptable for provisioning the handful of staff test accounts needed to unblock `ROADMAP.md` Step 6?** A minimal admin page is in scope above, but for an internal test app with a handful of known reviewers, seeding `users` rows directly (or via the existing `[[seed-data]]` skill) may be faster than building a UI for it. Recommend deciding this at lock time based on how many staff accounts are actually needed.
3. **Password policy / hashing library choice** — bcrypt (simple, widely used) vs. argon2 (stronger, more setup) — no strong requirement either way for a test app; recommend bcrypt via `bcryptjs` or similar to match `backend/api`'s existing Node/TS stack with no new native-binary dependency.
4. **Does staff read-scope on `GET /api/claims` need role restriction beyond claimant-scoping** (e.g. should an `adjuster` only see claims routed to adjusters)? Left unscoped in Design above; flag if this needs tightening before lock.
5. **Camunda `assignee` passthrough** (real app-user email vs. always `demo` in Camunda's own audit trail) — carried over verbatim from `SPEC.md` §14 as still open; doesn't block this spec's core access-control goal either way.

## Follow-up dependencies

- `moreInfo` resubmit endpoint (`SPEC.md` §14) — explicitly depends on this spec landing first.
- Audit view (`SPEC.md` §14, `BUILD-PLAN.md` #33) — explicitly depends on this spec landing first.
- `ROADMAP.md` Step 6 (human review with real distinct users) — this spec is the chosen mechanism (Option B) to unblock it without touching Camunda's own identity setup.
