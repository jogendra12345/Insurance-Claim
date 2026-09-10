> Inferred type: **generic** (no type given; this feature spans a BPMN change, a new `claims` column, a new job worker, two new API endpoints, and a claim-detail-page UI change — no single db/bpmn/dmn/worker/api section in SPEC.md covers it as one unit)

# generic/claimant-more-info-resubmission

**Status:** Draft

## Purpose

Today, when a reviewer (Adjuster/Investigator/Legal/Supervisor Review) picks `moreInfo` as their decision, `capture-review-decision` sets `claims.status = 'awaiting_info'` and the process hits a terminal end event (`EndEvent_AwaitingMoreInfo`) — the claim goes nowhere and no one is ever told why more info was needed. `SPEC.md` §14 already flags this as a known gap ("Loop `moreInfo` back into the process instead of ending it") and sketches a message-event-based resume mechanism. This spec replaces that sketch with a different, more idiomatic mechanism for this codebase: model the claimant's "provide more info" step as a real Camunda **User Task**, assigned to that claim's claimant, so it goes through the same `capture-*`-job-worker-completes-and-writes-`audit_log` pattern every other human step in this process already uses — rather than introducing a one-off message-correlation code path with no natural audit hook.

The claimant never sees anything resembling Tasklist or the staff `/tasks` route. On their own claim's detail page (`app/claims/[id]/page.tsx`), when there's an open task waiting on them, a small task-grid card appears (visually consistent with the staff `/tasks` list's card pattern) showing the reviewer's stated reason; clicking it expands a resubmission form **inline on the same page** (no navigation) where they can add documents and an optional note. Submitting it completes the underlying task and the process resumes — routed back to the *same reviewing role* that asked (adjuster/investigator/legal/supervisor), not back to intake, so AI extraction/scoring doesn't rerun needlessly.

Two email touchpoints are required, not optional: the claimant must receive an email the moment more info is requested (with the reviewer's reason and a link to the claim), and a second confirming their resubmission was received and the claim is back under review. Without both, a claimant who doesn't happen to check the portal has no way to know their claim is stalled on them, and after resubmitting has no confirmation it actually went through.

## Scope

**In scope:**
- New `claims.info_requested_reason` column (text, nullable), written by `capture-review-decision`'s `moreInfo` branch — mirrors how `denial_reason` already works for the `deny` branch, but was missing entirely for `moreInfo` until now.
- `ReviewDecisionForm` (both the form-js file and the in-app React version on `/tasks/[key]`) gains a reason textarea shown when `decision = "moreInfo"`, required — same UX as the existing conditional `denialReason` textarea for `deny`.
- BPMN: replace `EndEvent_AwaitingMoreInfo` with a new **User Task** `Task_ClaimantProvideMoreInfo`, followed by a new service task `capture-claimant-resubmission`, followed by a gateway routing back to the same reviewing role's User Task (`Adjuster Review` / `Investigator Review` / `Legal Review` / `Supervisor Review`) based on `confirmedRole` — reusing the existing four role-review task nodes rather than duplicating them, same way `auto-escalate-review`'s targets do today.
- `Task_ClaimantProvideMoreInfo` has **no candidate group** — unlike every staff task, it isn't claimed off a shared queue. It's located directly by `processInstanceKey` (already stored on `claims`) plus its BPMN element ID, not through the candidate-group task-search flow `GET /api/tasks` uses. This keeps it entirely outside the staff task-proxy design (`[[auth-role-based-access]]`'s role → candidate-group map still has no entry for `claimant`, and none is added — claimants still never see `/tasks`).
- New job worker `capture-claimant-resubmission`: writes `audit_log` (`actor_type: "human"`, `actor_id`: the claimant's user id), sets `claims.status = 'in_review'`, clears nothing (the original `info_requested_reason` stays as history, same way `denial_reason` isn't cleared on other paths) — see Design for full contract.
- Two new claimant-scoped API endpoints (ownership-checked — see Design), **not** additions to the existing `/api/tasks/*` staff proxy:
  - `GET /api/claims/:id/pending-task` — returns the open `Task_ClaimantProvideMoreInfo` task (if any) for that claim, or `null`.
  - `POST /api/claims/:id/resubmit` — accepts new documents and an optional note, inserts `claim_documents` rows, writes `audit_log`, then completes the Zeebe user task located above.
- Frontend: `app/claims/[id]/page.tsx` fetches the pending-task endpoint when `status === 'awaiting_info'`; if a task is open, renders a task-grid card (extracted/reused from the staff `/tasks` list's card component) showing `info_requested_reason`; clicking it expands the resubmission form (file upload + optional note) inline in place, calling the resubmit endpoint on submit, then reverts to the normal read-only claim view.
- **Two claimant emails via the existing `NotificationProvider`, both mandatory, not best-effort-only:**
  1. When `moreInfo` is decided (fired from `capture-review-decision` or a new call alongside it), `notify-claimant` gets a new `decision = "moreInfo"` case: email includes `info_requested_reason` and a link to the claim detail page. `NotificationContext.decision` widens from `"approve" | "deny"` to `"approve" | "deny" | "moreInfo"`.
  2. When `capture-claimant-resubmission` completes successfully, a second `notify-claimant`-style email confirms the resubmission was received and the claim is back under review — otherwise the claimant has no confirmation their upload actually resumed anything.
  - Both reuse the same Gmail-preferred / Resend-fallback / mock provider selection `notify-claimant` already does — no new provider, no new env vars.
  - Both are subject to the existing test-mode caveat (`[[project_reviewer_notification_test_mode]]`): while notifications are hardcoded to one test address, that applies here too — this spec doesn't change that, just uses the same provider.

**Out of scope:**
- Allowing the claimant to edit original claim fields (amount, incident description, etc.) during resubmission — only new documents and an optional note, same shape as the original submission's upload widget. Editing claim data mid-review is a materially different (and riskier) feature.
- A cap on how many times a single claim can loop through `moreInfo` — same "no cap, worst case is what it is" stance `[[sla-review-escalation]]` already took for its own escalation hops. Each loop re-attaches a fresh instance of the same reviewing role's task.
- Any SLA/timeout on `Task_ClaimantProvideMoreInfo` itself — `[[sla-review-escalation]]` only covers reviewer-side tasks; a claimant who never responds just leaves their claim sitting in `awaiting_info` indefinitely, same as today's dead-end behavior minus the "dead end" part. A future spec could add a claimant-facing reminder/timeout if this becomes a real problem.
- Re-running `extract-evidence` / `detect-fraud-indicators` / `score-risk` against the newly uploaded documents — resubmission only adds documents and routes straight back to the human reviewer; the AI re-assessment is intentionally skipped, same rationale `SPEC.md` §14's original sketch already gave (avoid re-running AI extraction/scoring unnecessarily).
- Changing anything about the `deny` or `approve` paths — this spec only replaces the `moreInfo` branch's terminal end event.

## Design

### Data model

New column on `claims` (migration `0014_add_info_requested_reason.sql`, next sequential number per `backend/db/migrations/`):

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `info_requested_reason` | text | yes | — | written by `capture-review-decision`'s `moreInfo` branch, mirrors `denial_reason`'s shape for `deny` |

No new table for the "claimant task" itself — its existence is derived live from Camunda (via `processInstanceKey` + element ID), not persisted separately. This avoids a second source of truth that could drift from the actual process-instance state.

### `capture-review-decision` change

Add `moreInfo` to the required-field validation the same way `deny`/`denialReason` is already validated: `decision === "moreInfo"` requires `infoRequestedReason` (new form field), and the worker writes `claims.info_requested_reason = infoRequestedReason` alongside the existing `status = 'awaiting_info'` write. No other change to this worker — it still ends after this write; the BPMN change below is what makes `moreInfo` no longer terminal.

### `ReviewDecisionForm` change

Both `process/forms/review-decision.form` and the in-app `frontend/portal/app/tasks/[key]/page.tsx` React version add a conditional "Reason" textarea, shown/required only when `decision === "moreInfo"` — same pattern as the existing `denialReason` field for `deny`. Enforced by `capture-review-decision` (not the form's static validation), same reasoning already documented in `SPEC.md` §10 step 12 for why `denialReason`'s requirement can't be expressed in form-js's static rules either.

### BPMN process change (`process/claim-case-process.bpmn`)

Replace:
```
Gateway_Decision --[decision = "moreInfo"]--> EndEvent_AwaitingMoreInfo
```
with:
```
Gateway_Decision --[decision = "moreInfo"]--> Task_ClaimantProvideMoreInfo (User Task, no candidate group)
                                                    │
                                                    ▼
                                          Task_CaptureClaimantResubmission (Service Task)
                                                    │
                                                    ▼
                                    Gateway_RouteBackByConfirmedRole (Exclusive Gateway)
                                          confirmedRole = "adjuster"     → Task_AdjusterReview
                                          confirmedRole = "investigator" → Task_InvestigatorReview
                                          confirmedRole = "legal"        → Task_LegalReview
                                          confirmedRole = "supervisor"   → Task_SupervisorReview
```

`Task_ClaimantProvideMoreInfo`:
- `zeebe:userTask`, **no** `zeebe:assignmentDefinition candidateGroups` — deliberately outside the candidate-group model every staff task uses. This task is discovered and completed only through the two new claimant-scoped endpoints below, never through `GET /api/tasks` or Tasklist's group-based task list.
- No form-js `formDefinition` needed for this task specifically — the claimant-facing UI lives entirely in `app/claims/[id]/page.tsx` (see Frontend below), same way the staff `/tasks` route already renders its own React forms rather than Camunda's stock rendering, even though the BPMN element itself carries no visible form requirement here.

Each of the four role-review task nodes (`Task_AdjusterReview`, `Task_InvestigatorReview`, `Task_LegalReview`, `Task_SupervisorReview`) gains one more incoming sequence flow, from the new gateway — same pattern `[[sla-review-escalation]]` already used when it added incoming flows from `auto-escalate-review`'s targets onto these same nodes. No changes to any task's own definition.

### New job worker: `capture-claimant-resubmission`

| | |
|---|---|
| Input variables | `claimId` |
| Does | Sets `claims.status = 'in_review'`, `updated_at = now()`; writes `audit_log` (`actor_type: "human"`, `actor_id`: the claimant's `users.id` — passed through from the resubmit endpoint as a variable, `action: "claimant_resubmitted"`, `detail: { infoRequestedReason, documentsAdded: <count> }`); does **not** call `notifyRole()` — the notification here goes to the claimant (see below), not a reviewer, since the reviewer already has the task reopened in their own queue by virtue of the BPMN flow itself. |
| Output variables | — |

Plain `capture-*`-style worker, no AI call, no external I/O — same complexity class as `capture-triage-review`, scaffoldable via `/new-job-worker`.

### API endpoints (`backend/api`)

Both new, claimant-scoped, **separate from** the `/api/tasks/*` staff proxy (`[[auth-role-based-access]]`) — that proxy's role → candidate-group map has no `claimant` entry and none is added here.

**`GET /api/claims/:id/pending-task`**
- `401` if unauthenticated. `403` if the caller's role is `claimant` and `claims.claimant_email` doesn't match their session email (same ownership check `[[auth-role-based-access]]`'s claim-scoping already applies elsewhere) — or if the caller isn't the claimant at all (staff don't use this endpoint; they see reopened review tasks through the normal `/api/tasks` flow instead).
- If `claims.status !== 'awaiting_info'`, returns `{ task: null }`.
- Otherwise looks up the open Zeebe user task for `claims.process_instance_key` with element ID `Task_ClaimantProvideMoreInfo` (Tasklist `POST /v2/user-tasks/search` filtered by `processInstanceKey`, state `CREATED`) and returns `{ task: { taskKey, reason: claims.info_requested_reason, openedAt } }`.

**`POST /api/claims/:id/resubmit`**
- Same auth/ownership check as above.
- `400` if `claims.status !== 'awaiting_info'` or no open `Task_ClaimantProvideMoreInfo` task is found for the process instance (stale-state guard — e.g. double-submit from two open tabs).
- Body: new document files (same upload widget/shape as the original claim submission form) plus an optional note.
- Inserts new `claim_documents` rows for the uploaded files, writes an `audit_log` row for the resubmission event itself (`actor_type: "human"`, `action: "claimant_resubmission_submitted"`, `detail: { note, documentCount }` — distinct from `capture-claimant-resubmission`'s own audit row, since one is the API-layer act of submitting and the other is the process-layer act of the BPMN task completing), then completes the located Zeebe user task (`POST /v2/user-tasks/:key/completion`) with `claimId` as the only output variable the downstream service task needs.
- On success, triggers the resubmission-confirmation email (see Notifications below) and returns the updated claim.

### Frontend — `app/claims/[id]/page.tsx`

When `claim.status === 'awaiting_info'`, the page calls `GET /api/claims/:id/pending-task` (mirroring how it already calls `fetchPolicies()` non-critically alongside `fetchClaim`). If a task is returned:
- Renders a task-grid card in the claim summary — visually the same card component the staff `/tasks` list already uses for its `Task` rows (extract a shared `TaskCard` component from `app/tasks/page.tsx` if one doesn't already exist as a standalone piece, rather than duplicating the markup), showing the reviewer's `reason` and a short "more info needed" label.
- Clicking the card expands an inline resubmission section on the same page (no navigation, no new route) — a file upload control (reusing the same component `claims/new/page.tsx`'s document upload already uses) plus an optional note field, and a submit button that calls `POST /api/claims/:id/resubmit`.
- On success, collapses the card, re-fetches the claim (status will now be `in_review`), and the page reverts to its normal read-only view — same UX the page already has for every other status.

### Notifications

`notify-claimant`'s `NotificationContext.decision` widens to `"approve" | "deny" | "moreInfo"`. Two call sites:

1. **More-info-requested email** — fired alongside `capture-review-decision`'s `moreInfo` branch (either a direct call from that worker, or a new BPMN service task `notify-claimant` invocation right after it, matching how `notify-claimant` is already wired after `trigger-settlement`/`draft-denial-letter` on the other two branches). Context includes `infoRequestedReason` and a link to `app/claims/[id]`. `NotificationProvider.send()`'s `buildEmail()` gains a `moreInfo` branch alongside its existing `approve`/`deny` HTML bodies.
2. **Resubmission-received confirmation email** — fired from the `POST /api/claims/:id/resubmit` endpoint (API-layer, not a BPMN service task, since it needs to fire synchronously with the HTTP response so the claimant sees confirmation immediately rather than waiting on the next job-worker poll cycle) using the same provider selection logic `notify-claimant` uses (Gmail → Resend → mock).

Both emails are **required parts of this spec's scope**, not optional/best-effort — unlike `[[sla-review-escalation]]`'s `notifyRole()` calls (which are deliberately best-effort so a notification outage can't fail an SLA timeout job), a failed more-info-requested or resubmission-confirmation email here should still be visible: log the failure into the relevant `audit_log` row's `detail` (`notificationSent: false`) same as `notify-claimant` already does today, rather than silently swallowing it — but don't let a notification failure block the underlying state change (status update / task completion) either, matching how `notify-claimant` itself already treats provider failures as non-fatal to the job's own completion.

### Audit trail

Per §13, both new writes (`capture-claimant-resubmission`'s `claimant_resubmitted`, and the resubmit endpoint's `claimant_resubmission_submitted`) satisfy the "every job worker / user-task completion writes `audit_log`" rule. A claim that loops through `moreInfo` once would show a legible `/case-trace` timeline: `decision_recorded (moreInfo)` → `claimant_notified (moreInfo)` → `claimant_resubmission_submitted` → `claimant_resubmitted` → reviewing role's task reopens → next human decision.

## Open Questions

1. **Multiple open documents per resubmission vs. a single combined note** — should the resubmit form let the claimant attach several files in one submission (matching the original claim form's multi-file upload), or is one file plus one note sufficient for v1? Leaning toward reusing the exact same multi-file widget as the original form for consistency, but flagging since it wasn't explicitly discussed.
2. **Does the reviewing role need a "claimant responded" notification of their own**, distinct from the claim simply reappearing in their `/tasks` list? Today reviewers only find out about newly-opened tasks by checking `/tasks` or (per `[[reviewer_task_notification_test_mode]]`) an email when a task first opens — worth confirming whether a reopened task after `moreInfo` should trigger that same `notifyRole()` email, or whether that's implied as a natural extension of the existing "task opened" notification without needing separate design here.
3. **What happens if the claimant never resubmits** — explicitly out of scope per above (no SLA/timeout on this task), but worth a conscious "yes, indefinitely" confirmation at Lock rather than leaving it implicit.

## Follow-up dependencies

- None — this spec's only dependency (`[[auth-role-based-access]]`, for knowing which claimant is asking) is already Locked and built.
