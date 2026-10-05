> Inferred type: **generic** (no type given; this feature spans a new `users` table, several API endpoints, and a new frontend route — no single db/bpmn/dmn/worker/insurance-type/api section in SPEC.md covers it as one unit)

# generic/auth-role-based-access

**Status:** Locked

> Locked 2026-09-04. Open Questions 1–4 are resolved below (folded into Design); Open Question 5 (Camunda `assignee` passthrough) stays open as a non-blocking follow-up since it doesn't affect access control either way.
>
> - **Session storage (was Q1):** signed cookie, not a Postgres `sessions` table — simplest option for an internal test app (`[[project_demo_app_no_real_payments]]`); no revocation requirement was raised to justify the extra table. If logout-everywhere/forced-revocation becomes a real need later, revisit with a `token_version` column on `users`.
> - **Staff account provisioning (was Q2):** admin user-management UI is **cut from this spec's build scope**. The handful of staff test accounts needed to unblock `ROADMAP.md` Step 6 are seeded directly (SQL or the `[[seed-data]]` skill) — faster than building a UI for a one-time need. "In scope" below is amended accordingly; a self-service admin page is deferred to a future spec if staff turnover ever makes seeding impractical.
> - **Password hashing (was Q3):** bcrypt (via `bcryptjs` or equivalent), matching `backend/api`'s existing Node/TS stack with no new native-binary dependency.
> - **Staff read-scope (was Q4):** confirmed as designed — no role restriction on `GET /api/claims` beyond claimant-scoping; every staff role sees all claims, same as `admin`. Revisit only if a concrete need for role-scoped visibility (not just task-action scoping) comes up.

## Purpose

Give ClaimFlow AI real authentication and role-based access control, replacing today's fully open API (`GET /api/claims`/`/api/policies` return every row to anyone) and the fact that every Camunda Tasklist action is performed as the single `demo` basic-auth user regardless of which BPMN candidate group a task is actually restricted to. This is `BUILD-PLAN.md` Phase 2 item #21, already scoped at a high level in `SPEC.md` §14 ("Auth + role-based access for the frontend portal, plus a custom in-app task page") as **Option B** — this spec fleshes that paragraph out into a buildable design. It directly unblocks `ROADMAP.md` Step 6 (human review with real distinct users per candidate group) by sidestepping rather than resolving the "Open decision before Step 6" — no Identity/Keycloak, no Camunda SaaS migration. It's also a hard dependency for the `moreInfo` resubmit endpoint (§14) and the audit view (§14, `BUILD-PLAN.md` #33), both of which need to know who's asking before trusting a request scoped to one claim.

## Scope

**In scope:**
- A `users` table and self-registration for claimants, gated by a lightweight policy-match check (policy number + email). Staff role accounts are provisioned by seeding rows directly (SQL / `[[seed-data]]`), not via an admin UI — see lock note.
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
| `password_hash` | text | no | — | bcrypt, never plaintext |
| `role` | text | no | — | `claimant \| admin \| triage-team \| adjuster \| investigator \| legal-reviewer \| supervisor` (check constraint or enum) |
| `created_at` | timestamptz | no | `now()` | |

Claimants self-register via a signup form; the request body accepts no `role` field — the API hardcodes `role = 'claimant'` for the public signup endpoint. Signup additionally requires a `policyNumber` field (see "Claimant signup verification" below) — the account isn't created unless it passes that check. Every staff role (`admin`, `triage-team`, `adjuster`, `investigator`, `legal-reviewer`, `supervisor`) is seeded directly into `users` (SQL or `[[seed-data]]`) rather than self-registered or admin-UI-provisioned — see lock note. No endpoint accepts a client-supplied `role`. This mirrors the exact wording already locked in `SPEC.md` §14: "letting someone pick 'I'm a supervisor' at signup would let anyone grant themselves settlement-approval authority."

No `carrier_id` on `users` in this pass — see Out of scope above.

### Claimant signup verification (lightweight)

Real insurers don't create a policyholder account off an email address alone — the common pattern (confirmed by looking at how live insurer portals handle this) is: policy number + one or two more identifiers not derivable from just knowing an email (DOB, zip, name), checked before account creation, followed by a separate email-ownership verification (confirmation code) before the account is usable. Full production form is more than this test app needs, but the "prove you actually hold the policy" half of it is cheap and closes the most obvious gap — today's design otherwise lets anyone who merely knows a policyholder's email address register and immediately see that policyholder's claims.

**What this spec adopts:** `POST /api/auth/signup` requires `email`, `password`, and `policyNumber`. The endpoint looks up `policies` by `policy_number` and checks the submitted `email` (case-insensitive) against that policy's `policyholder_email` **or** any of its `policy_dependents.email` rows — the exact same match `validate-claim` already performs for authorized claimants (`SPEC.md` §9). If no policy row matches both fields, signup is rejected (`400`, generic "policy number and email don't match our records" message — deliberately not revealing *which* field failed, to avoid leaking whether a given policy number or email exists). On success, the account is created immediately — **no email-verification code and no DOB/zip step**; those stay explicitly out of scope (see Out of scope) as the part of the real-world pattern this spec deliberately doesn't adopt for an internal test app (`[[project_demo_app_no_real_payments]]`).

This check only runs at signup, once. It doesn't change `GET /api/claims`/`/api/policies` scoping (still plain `claimant_email` match, per "Scoping existing endpoints" below), and it doesn't retroactively touch claims submitted before the claimant's account existed — those still surface once their `claimant_email` matches the logged-in user's email.

A claimant tied to more than one policy (e.g. a dependent on one policy who is also a policyholder on another) only needs `policyNumber` to match *one* policy at signup — this proves policy-holder status once, not per-policy; every claim under any policy sharing that same email is visible to them either way, since scoping is by email, not by the policy used at signup.

### Session mechanism

*Superseded 2026-10-05 by the per-tab bearer-token addendum below.* Server-side-verified session, not a bare JWT: `backend/api` sets an httpOnly, `SameSite=Lax` cookie on login, signed server-side and carrying `{userId, role}` — no separate `sessions` table (decided at lock; see lock note). Logout clears the cookie client-side; there is no server-side revocation list in v1.

`POST /api/auth/signup` (claimant only, policy-matched per above), `POST /api/auth/login`, `POST /api/auth/logout`. No email-ownership verification, no password reset in v1 (Open Questions).

**Addendum (2026-10-05) — per-tab sessions with a bearer token, replacing the cookie.** The session cookie is shared by every tab, so signing in as a second user in another tab replaced the first tab's login; demos need different users side by side. Changes (same roles, same `req.user = {userId, email, role}` shape, same `requireAuth`/`requireRole`):
- **Token.** `POST /api/auth/login` and `POST /api/auth/signup` return `{ access_token, token_type: "bearer", user }` and set no cookie. The token is an HS256 JWT signed with `SESSION_SECRET`: `sub` = user id, `email`, `role`, `ver` (token version), `iat`, `exp` — `SESSION_TTL_HOURS` (default 8).
- **Reading it.** `attachUser` reads `Authorization: Bearer <token>`, verifies signature and expiry, and checks `ver` against `users.token_version` (migration `0018`); anything invalid leaves `req.user` unset, so protected routes answer 401 with `WWW-Authenticate: Bearer`.
- **Revocation.** `POST /api/auth/verify-otp` (password reset) increments `token_version`, so tokens issued before a reset stop working. Reset still doesn't log the user in. Logout is client-side only.
- **Removed.** `cookie-parser`, the cookie helpers, and `credentials: true` in CORS; CORS now allows the `Authorization` header. There was no CSRF code (bearer headers aren't sent automatically, so CSRF doesn't apply).
- **Frontend.** The token and user JSON live in `sessionStorage` (per tab; every access in try/catch); old auth keys are removed from `localStorage` once on load. Every API call sends the header; a 401 (except from login) clears the tab and goes to `/login`. The auth context registers the user id the tab shows and signs the tab out — without sending the request — if the stored user changes ("You were signed out because this tab's sign-in changed. Sign in again."), also on the window `storage` event. The user is read from `sessionStorage` on load: `app/layout.tsx` no longer resolves it server-side, so pages show a brief checking state. Logout clears this tab only, including the chat assistant's tab state. Document links are public MinIO URLs and never used the cookie, so no blob-download change was needed.
- **Closed open routes (user decision).** `POST /api/claims` now requires a logged-in user and `POST /api/policies` requires `admin`; both were unauthenticated though the UI only offered them to those users.
- **New-tab link (user decision).** The task page's "View full submission" opens in the same tab, since a new tab starts logged out.
- **Accepted trade-offs.** A new tab or pasted link starts logged out; closing the tab ends the login; "Duplicate tab" copies the login (detecting duplicates was considered and dropped).
- **Tests.** First automated suites in the app: `backend/api` (Vitest + Supertest, against the local Postgres with a throwaway user) and `frontend/portal` (Vitest + jsdom).
- **Built and verified 2026-10-05.** Backend: `auth.ts` (`issueAccessToken`/`verifyAccessToken`/`tokenResponse`, async `attachUser` with the `token_version` check, `WWW-Authenticate: Bearer` on 401), `routes/auth.ts` (login/signup return the token; `/me` behind `requireAuth`; reset bumps `token_version`), `app.ts` split from `index.ts` for tests, migration `0018_add_users_token_version.sql`, `jsonwebtoken` added and `cookie-parser` removed. Frontend: `lib/auth-session.ts` (storage, owner check, sign-out), `lib/api.ts` (`apiFetch` for every call), `lib/auth-context.tsx`, `app/layout.tsx` (no server-side user), `app/login/page.tsx` (sign-out notice), task-page link. Tests: API 12/12 (`backend/api/test/auth.test.ts`; first run caught `/me` returning 401 without `WWW-Authenticate`, fixed), portal 9/9 (`frontend/portal/tests/auth-session.test.ts`). Manual, in Chrome: two tabs signed in as `adjuster1` and `ayanchou2015`, both still correct after reload (also confirmed by `/api/auth/me` per tab); logging out of one left the other signed in; login response has no `Set-Cookie` and no `Access-Control-Allow-Credentials`; password reset on a throwaway account worked, the pre-reset token and old password were rejected, the new password logged in; deleting that account made its tab's next call 401 → `/login?reason=expired` with the notice, other tab unaffected. The reset was run against the API with the code written to the DB, not via the email form, because Gmail is configured and would have sent a real email.

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

1. **Camunda `assignee` passthrough** (real app-user email vs. always `demo` in Camunda's own audit trail) — carried over verbatim from `SPEC.md` §14 as still open; doesn't block this spec's core access-control goal either way, and can be picked up independently whenever it's convenient.

## Follow-up dependencies

- `moreInfo` resubmit endpoint (`SPEC.md` §14) — explicitly depends on this spec landing first.
- Audit view (`SPEC.md` §14, `BUILD-PLAN.md` #33) — explicitly depends on this spec landing first.
- `ROADMAP.md` Step 6 (human review with real distinct users) — this spec is the chosen mechanism (Option B) to unblock it without touching Camunda's own identity setup.
