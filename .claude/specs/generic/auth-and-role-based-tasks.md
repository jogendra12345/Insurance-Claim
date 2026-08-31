# generic/auth-and-role-based-tasks

**Status:** Draft

Expands SPEC.md §14's future-work bullets on portal auth and an in-app task page (added 2026-08-31) into an actual design. Not built — this documents Option B, chosen in conversation over switching to `docker-compose-full.yaml`'s real Camunda-native Identity/Keycloak (ROADMAP.md "Open decision before Step 6").

## Purpose

Today there is no authentication anywhere in this app: `GET /api/claims`/`/api/policies` return every row to anyone, and Camunda's lightweight stack has exactly one identity (`demo`), so every Tasklist action — regardless of which BPMN candidate group a task is actually restricted to — is performed as `demo`. This spec adds:

1. Login + role-based access to the frontend portal (claimant vs. staff roles).
2. A custom in-app task page, so reviewers work inside this app's own UI instead of Camunda's stock Tasklist.

Both without requiring real multi-user Camunda auth — Camunda stays behind our own app's auth boundary as a trusted backend service, still authenticated as the single `demo` user.

## Scope

**In scope:**
- A `users` table: email, password hash, `role`.
- Login/session (or JWT) for the frontend.
- Claimant self-registration, defaulting to `role = 'claimant'` — no role picker exposed to them.
- Admin-only account/role provisioning for every staff role (`admin`, `triage-team`, `adjuster`, `investigator`, `legal-reviewer`, `supervisor`) — never self-selectable.
- Scoping `GET /api/claims`/`/api/policies` by `claimant_email = current user` for `role = 'claimant'`; unscoped for `role = 'admin'`.
- A role → BPMN candidate-group mapping table (see Design).
- New backend endpoints that proxy Camunda's Tasklist v2 REST API (`/v2/user-tasks/search`, `/completion`, `/assignment`), using `backend/api`'s own stored `demo` credential — end users never receive or use Camunda credentials directly.
- A frontend task page: lists the logged-in staff user's role-filtered tasks, lets them open one (joined against `claims`/`audit_log` for real context, reusing patterns from the existing `TriageReviewForm`/`ReviewDecisionForm` field set) and complete it.

**Out of scope (for this spec):**
- Switching to `docker-compose-full.yaml` / real Camunda Identity — explicitly rejected in favor of Option B (see Purpose).
- Password reset flows, MFA, OAuth/SSO — plain email+password is enough for this scope.
- Per-carrier tenant isolation of accounts (SPEC.md §14 already lists this separately).
- Any change to `process/claim-case-process.bpmn`'s candidate groups themselves — this spec consumes the groups that already exist (`triage-team`, `adjusters`, `investigators`, `legal-reviewers`, `supervisors`), it doesn't add or rename any.
- Retiring Camunda's own Tasklist UI — it keeps working standalone at `localhost:8080/tasklist` (still logged in as `demo`) for direct debugging; this spec adds an alternative, not a replacement deployment change.

## Design

### `users` table (new)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `email` | text | NOT NULL | — | `UNIQUE` |
| `password_hash` | text | NOT NULL | — | bcrypt or equivalent — never store plaintext |
| `role` | text | NOT NULL | `'claimant'` | `CHECK (role IN ('claimant','admin','triage-team','adjuster','investigator','legal-reviewer','supervisor'))` |
| `created_at` | timestamptz | NOT NULL | `now()` | |

No FK to `claims`/`policies` — a claimant's own rows are found at query time by matching `users.email` against `claims.claimant_email`, the same email-matching approach `validate-claim`'s authorized-claimant check already uses (SPEC.md §9 "Authorized claimants"), not a stored relationship.

### Role → candidate-group mapping

Role names and BPMN candidate-group strings are similar but not identical (`adjuster` the role vs. `adjusters` the group) — an explicit map, not a string transform, avoids a silent mismatch:

| `users.role` | BPMN candidate group |
|---|---|
| `triage-team` | `triage-team` |
| `adjuster` | `adjusters` |
| `investigator` | `investigators` |
| `legal-reviewer` | `legal-reviewers` |
| `supervisor` | `supervisors` |
| `admin` | *(all groups — admin sees every open task)* |
| `claimant` | *(none — claimants never see the task page)* |

### New backend endpoints (`backend/api`)

- `GET /api/tasks` — looks up the logged-in user's role, maps to a candidate group (or all groups, for admin), calls Tasklist's `POST /v2/user-tasks/search` with that `candidateGroups` filter and `state: "CREATED"`, using `backend/api`'s stored `demo` credential (mirrors how `backend/api/src/zeebe.ts` already holds the Zeebe gRPC client server-side — same pattern, REST instead of gRPC). Response joined against `claims` (by `processInstanceKey`) so the frontend gets claim context, not bare Camunda task metadata.
- `POST /api/tasks/:userTaskKey/claim` — proxies `/v2/user-tasks/:key/assignment`. Records which app-level user actually claimed it in a new column or in `audit_log` detail, since Camunda's own `assignee` field will still just say `demo` (see Open Questions).
- `POST /api/tasks/:userTaskKey/complete` — proxies `/v2/user-tasks/:key/completion`, forwarding the same `variables` shape each task's form already expects (`triageAction`/`confirmedRole`, `decision`/`denialReason`, `resolutionAction`, etc.) — this endpoint does not change what variables each task needs, only who's allowed to submit them.

### Frontend task page

New route (e.g. `/tasks`), staff-only (`role != 'claimant'`):
- Lists `GET /api/tasks` results, grouped/filtered by task name.
- Opening a task renders the relevant fields (reusing the same field set as the existing Camunda forms — `TriageReviewForm`, `ReviewDecisionForm`, `ValidationExceptionReviewForm` — so behavior stays identical to today's Tasklist-based flow, just in this app's own UI) and posts to `/api/tasks/:key/complete` on submit.

## Open Questions

- **Does Camunda's lightweight (no-Identity) mode accept an arbitrary `assignee` string on `/v2/user-tasks/:key/assignment`,** or does it reject anything but the authenticated `demo` user? If it accepts arbitrary strings, `backend/api` could pass the real app-user's email through as `assignee` even without real Camunda auth, making Camunda's own audit trail accurate. If not, "who really acted" only lives in this app's own audit trail, and Camunda's `assignee`/Operate history will always show `demo` — a cosmetic gap, not a security one, since access control already happened before the proxy call. Needs confirming against the actual running Camunda 8.9 REST API before implementing.
- **Session mechanism** — plain server-side session (cookie + a `sessions` table) vs. JWT. Not decided; either is fine for this scope, whichever is less new infrastructure to run locally.
- **Does an admin get a Camunda-credential-free way to resolve incidents / view Operate-level detail**, or is Operate (`localhost:8080/operate`, still `demo`/`demo`) kept as a separate ops-only surface outside this app entirely? Leaning toward the latter (Operate stays a separate ops tool, per CLAUDE.md's existing "point people at Operate" note for step 18/status tracking) but not settled here.
- **Multiple candidate groups per user** — v1 of this spec assumes one role per user. If a real reviewer needs to sit in two groups (e.g. both `adjuster` and `triage-team`), the `users.role` column (single value, `CHECK`-constrained) doesn't support that; would need `role` to become a `user_roles` join table instead. Deferred until there's a concrete need.
