> Inferred type: **generic** (no type given; this feature spans a new API endpoint reading `audit_log`, a new staff-facing grid page, and a claim-detail history panel — no single db/bpmn/dmn/worker/api section in SPEC.md covers it as one unit)

# generic/staff-audit-trail-view

**Status:** Locked (2026-09-15)

**Lock note (2026-09-15):** Open Questions resolved — (1) a standalone `/audit` staff page, entered from its own top-nav tab, not folded into `/policies`; (2) all `STAFF_ROLES` (`admin`, `triage-team`, `adjuster`, `investigator`, `legal-reviewer`, `supervisor`) per `[[auth-role-based-access]]`'s existing "every staff role is unscoped" precedent — `backend/api/src/auth.ts` already exports this exact list, so the check is a direct reuse, not a new decision; (3) a generic key/value dump of `detail` for v1, no per-action formatting templates; (4) unpaginated list for v1, matching this app's demo-scale claim volumes (`[[project_demo_app_no_real_payments]]`). Built the same day: `GET /api/claims/:id/audit-log` (staff-only, optional `actorType`/`from`/`to` query params) in `backend/api/src/routes/claims.ts`; `serializeAuditLogEntry` in `backend/api/src/serializers.ts`; `frontend/portal/app/audit/page.tsx` (policy grid → claims list → audit timeline, each level with its filter per Scope) plus a `fetchClaimAuditLog` API helper and an `AuditLogEntry`/`ActorType` type; a staff-only "Audit" tab added to `TopBar`.

## Purpose

Every automated and human step already writes a row to `audit_log` (`SPEC.md` §9, §13) — this is the durable, queryable case history Camunda's own Operate history doesn't give you at the business level (`CLAUDE.md`). Today that history is only reachable by querying Postgres directly or running `[[case-trace]]` by hand for one claim at a time; there is no in-app way for staff (admin/triage/adjuster/investigator/legal/supervisor) to browse it.

This spec adds a staff-only audit view: a grid of policies, and — on selecting one — that policy's claims, and — on selecting a claim — its full `audit_log` history in chronological order (who did what, and when: task assignments, submissions, reviews, decisions, settlements, etc.), presented the way `[[case-trace]]` reconstructs a timeline today, but as a page instead of a one-off report. Claimants never see this view; it is not an extension of their own claim-detail page.

## Scope

**In scope:**
- A new staff-only route, `app/audit/page.tsx` (exact path an Open Question below), rendering a grid of policies — reusing `GET /api/policies` (already unscoped for every staff role per `[[auth-role-based-access]]`) rather than a new endpoint, same list the existing `/policies` tab already fetches.
- Selecting a policy shows its claims, reusing the existing `GET /api/claims?policyNumber=...` endpoint (`backend/api/src/routes/claims.ts`) rather than adding a new one — it is already unscoped for staff and already supports this exact filter.
- A new endpoint, `GET /api/claims/:id/audit-log`, returning that claim's full `audit_log` history ordered by `created_at` — staff-only (`403` for `role = "claimant"`, matching the ownership/role checks `[[claimant-more-info-resubmission]]`'s claimant-scoped endpoints use in the opposite direction). No existing endpoint currently exposes `audit_log` rows to the frontend at all.
- Selecting a claim (from the policy's claim list) opens a history panel/page rendering that endpoint's rows as a chronological timeline: timestamp, actor (`actor_type` + `actor_id`), action, and `detail` (rendered as readable text, not raw JSON, where practical).
- **Filters**, scoped to what's already on screen at each step (not a global cross-claim search — see Out of scope):
  - Policy grid: filter by `status` (`policies.status`) and by `insuranceType` — both already columns on the list `GET /api/policies` returns, so these are client-side filters over the existing payload, no API change.
  - Claims list (within a selected policy): filter by claim `status` (e.g. `in_review`, `awaiting_info`, `approved`, `denied`, `settled`) — same values `app/tasks/page.tsx`/claim-detail pages already use for status display, applied client-side over the existing `GET /api/claims?policyNumber=...` response.
  - Claim audit timeline: filter by `actorType` (`system` / `ai` / `human`) and by a `from`/`to` date range on `created_at` — these two are the ones worth pushing server-side (see API below) since a long-lived claim's timeline is the one list in this feature likely to actually grow long enough to matter (`[[claimant-more-info-resubmission]]` loops each add several rows).
- Read-only throughout — this view never writes to `audit_log` or any other table.

**Out of scope:**
- Any change to what writes `audit_log` rows, or to the `audit_log` schema itself — this spec only reads what already exists.
- Merging in Camunda/Operate process-instance history the way `[[case-trace]]` does — that skill already covers cross-checking `audit_log` against Camunda for compliance gaps; this spec is the `audit_log`-only, staff-browsable UI half. Folding in live Camunda history is a possible future extension, not required here.
- A global, cross-claim audit search (e.g. "show every `fraud_flagged` action across all policies this month") — filters here only narrow the list already loaded at each step (one policy's claims, one claim's timeline), not a standalone search page.
- Any change to claimant-facing pages (`app/claims/[id]/page.tsx`) — claimants still never see `audit_log` content.
- Exporting the timeline (PDF/CSV) — out of scope until a concrete need for it comes up.

## Design

### API — `GET /api/claims/:id/audit-log`

- `401` if unauthenticated. `403` if `req.user!.role === "claimant"` — this endpoint is staff-only in both directions (unlike `[[auth-role-based-access]]`'s claim-scoping, which restricts claimants to their own claims; here claimants are excluded entirely, not just scoped).
- `404` if the claim doesn't exist.
- Optional query params: `actorType` (`system` | `ai` | `human`), `from`/`to` (ISO date, inclusive, filtering on `created_at`). All optional and combinable; omitting all three returns the full history, same as before filters existed.
- Query: `SELECT * FROM audit_log WHERE claim_id = $1 [AND actor_type = $n] [AND created_at >= $n] [AND created_at <= $n] ORDER BY created_at ASC` — conditions appended the same parameterized-query pattern `GET /api/claims` already uses for its optional `policyNumber` filter.
- Response: an array of `{ id, actorType, actorId, action, detail, createdAt }` (camelCase per this codebase's existing `serialize*` convention in `backend/api/src/serializers.ts` — add a `serializeAuditLogEntry` there alongside `serializeClaim`/`serializeClaimDocument`/`serializeFraudIndicator`).

No change to `GET /api/policies` or `GET /api/claims` — both already serve this feature's grid/list steps as-is.

### Frontend

- New staff-only page, `app/audit/page.tsx` (or nested under an existing staff area — see Open Questions), gated the same way other staff-only pages already check `req.user!.role !== "claimant"` client-side (mirroring whatever pattern `app/tasks/page.tsx` uses today to hide itself from claimants).
- Grid view: reuse the existing `/policies` list fetch and card/grid presentation already used by `app/policies/page.tsx`, rather than inventing a new policy-card component.
- Clicking a policy card navigates to (or expands, per Open Questions) that policy's claims, fetched via `GET /api/claims?policyNumber=<policy.policyNumber>`.
- Clicking a claim opens its audit timeline, fetched from the new `GET /api/claims/:id/audit-log` endpoint, rendered as a vertical chronological list (timestamp, actor, action, human-readable detail) — visually in this app's existing card/section language, not a raw table dump of `detail` JSON.
- Filter controls: a status dropdown above the claims list (client-side), a status/insurance-type toggle above the policy grid (client-side), and an actor-type dropdown plus a from/to date range above the audit timeline (these two re-fetch `GET /api/claims/:id/audit-log` with query params rather than filtering client-side, per the API design above).

### Audit trail

This feature is read-only and writes no `audit_log` rows of its own — §13's "every job worker / user-task completion writes audit_log" rule doesn't apply here since nothing here is a job worker or task completion.

## Open Questions

1. **Exact route/entry point** — a standalone `/audit` staff page, or folded into the existing `/policies` page as a staff-only expanded view (so claimants and staff share `/policies` but staff additionally see a claims-and-history drill-down)? The Purpose above assumes a policy-grid-first flow per the chat request, but where it lives in the nav wasn't specified.
2. **Which staff roles can see this** — all staff roles (`admin`, `triage-team`, `adjuster`, `investigator`, `legal-reviewer`, `supervisor`) per `[[auth-role-based-access]]`'s existing "every staff role is unscoped" precedent for `GET /api/claims`/`GET /api/policies`, or `admin`-only since audit history is more sensitive than claim data itself? Leaning toward the former for consistency with existing read-scope decisions, but not confirmed.
3. **Rendering `detail` (jsonb)** — some `detail` payloads carry structured context (e.g. AI reasoning, override flags, `documentsAdded` counts). Does this view need per-`action` formatting templates (e.g. "Reviewer overrode AI-suggested role: adjuster → investigator"), or is a generic key/value dump of `detail` acceptable for v1?
4. **Pagination/volume** — no expected limit on how many `audit_log` rows a long-lived claim (e.g. one that loops through `[[claimant-more-info-resubmission]]` several times) could accumulate. Is a simple unpaginated list acceptable for v1, given claim volumes are still small in this demo-scale app (`[[project_demo_app_no_real_payments]]`)?

## Follow-up dependencies

- None — this spec's only dependencies (`[[auth-role-based-access]]` for staff role checks, `audit_log`'s existing schema per `SPEC.md` §9) are already Locked/shipped.
