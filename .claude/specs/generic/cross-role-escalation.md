> Inferred type: not inferred — given explicitly as **generic** (spans a BPMN process change, the two review forms/UIs, and a job worker — no single db/bpmn/dmn/worker/insurance-type/api section in SPEC.md covers it as one unit, the same reasoning `[[claimant-portal-ui]]` and `[[auth-role-based-access]]` used for themselves)

# generic/cross-role-escalation

**Status:** Draft

## Purpose

Today a claim is routed to exactly one reviewing role — `adjuster`, `investigator`, or `legal` — by the DMN table (§11) at triage time, confirmed by `Triage Review` (§10 step 9), and that role's own `Adjuster Review`/`Investigator Review`/`Legal Review` task is the only chance a human gets to weigh in before `Decision` (§10 step 14) resolves to `approve`/`deny`/`moreInfo`. `SPEC.md` §2 and §14 both flag this explicitly as a known gap: *"No cross-role escalation (investigator → legal mid-review) — each claim is routed once by the DMN table"* (§2, non-goals) and *"Cross-role escalation (e.g., investigator escalates to legal mid-review) instead of single DMN-time routing"* (§14, future work) — this is `BUILD-PLAN.md` item #23.

In practice this means: an investigator who, mid-review, uncovers something that genuinely needs legal judgment (e.g. a coverage dispute, a suspected pattern that could lead to litigation, a claim amount that turns out higher than what was known at DMN time) has no path forward except `approve`, `deny`, or `moreInfo` — none of which fit "this isn't my call, it's legal's." Today the only workaround is denying or approving something the investigator isn't actually confident about, or asking the claimant for more info as a stall tactic. This spec adds a real escalation path: an investigator can hand an in-progress review to Legal without resolving it themselves.

## Scope

**In scope:**
- A new `escalate` outcome on `Investigator Review` only, alongside the existing `approve`/`deny`/`moreInfo`. Scoped narrowly to investigator → legal, matching the exact case named in `SPEC.md` §2/§14 and `BUILD-PLAN.md` #23's title — not a general N-role escalation graph.
- A required `escalationReason` field, captured the same way `denialReason` is today (free text, required only when `decision = "escalate"`).
- A BPMN change: `Investigator Review`'s decision routes to `Legal Review` directly (re-entering the existing role-specific-review shape) instead of falling through to `Decision`/`capture-review-decision`.
- A new `capture-escalation` job worker (or an escalate branch inside `capture-review-decision` — see Design) that updates `claims.confirmed_role` and writes an `audit_log` row.
- Parity in both review surfaces: the Camunda-native `ReviewDecisionForm` (`process/forms/review-decision.form`, used by stock Tasklist) *and* the in-app `/tasks/[key]` page (`frontend/portal/app/tasks/[key]/page.tsx`, `[[auth-role-based-access]]`'s proxy UI) — both are live review surfaces today and must offer the same option, not just one.
- Legal reviewing an escalated claim sees the same `Legal Review` form/task a DMN-routed legal claim would, plus a visible marker that this claim was escalated (and why) rather than DMN-routed originally.
- `capture-escalation` calls `[[reviewer_task_notification_test_mode]]`'s existing `notifyRole()` helper directly (`notifyRole("legal-reviewer", claimId, "Legal Review")`) — this is a **new** call site, not covered by that spec's original four hook points (`validate-claim`, `capture-routing-decision`, `capture-triage-review`, `capture-review-decision`), since escalation reaches `Legal Review` through a path none of those four workers run on.

**Out of scope:**
- Escalating *from* `Adjuster Review` (to investigator or legal) or *from* `Legal Review` (there's nowhere further to escalate — legal is already the DMN's top tier per §11's `claimAmount > 50000` rule being checked first). Both are natural follow-ons but not what §2/§14/#23 asked for; flagged under Open Questions.
- Escalating back down (legal → investigator) or sideways (adjuster → investigator without going through triage) — not requested, and muddies "who's accountable for this claim right now."
- Any change to the DMN table (`process/health-claim-routing.dmn`) itself — the DMN's job is still the *initial* routing guess; escalation is a human override of an in-progress review, not a change to how `assignedRole` gets computed.
- Multiple escalations in one claim's lifecycle (investigator → legal → back to investigator, etc.) — v1 of this spec is a single one-way hop. If legal decides an escalated claim actually needs adjuster-level handling, that's `deny`/`moreInfo` today, same as any other claim reaching Legal Review.
- A different email *content/template* for an escalated claim vs. a normal DMN-routed one reaching `Legal Review` — same "task is waiting" email either way, just triggered from a different call site (see Design).

## Design

### BPMN process change (`process/claim-case-process.bpmn`)

Today, per §10 step 12-13: `Route by Confirmed Role` → one of the three role-specific User Tasks → `capture-review-decision` → `Decision` gateway (`approve`/`deny`/`moreInfo`).

New shape, scoped to the investigator branch only:
- `Investigator Review`'s `decision` field gains a fourth value, `escalate` (see form change below).
- A new **Exclusive Gateway** `Investigator Decision?` sits right after `Investigator Review`, before the existing flow into `capture-review-decision`:
  - `decision = "escalate"` → **Service Task** `capture-escalation` (writes `audit_log`, updates `claims.confirmed_role = "legal"`) → loops back into the existing `Legal Review` User Task (a second incoming sequence flow onto that same task node — the same "multiple incoming flows into one shared node" pattern §10 step 11 already uses for `Task_DraftDenialLetter`).
  - Otherwise (default) → existing flow into `capture-review-decision` (unchanged: `approve`/`deny`/`moreInfo` behave exactly as today).
- `Adjuster Review` and `Legal Review` are untouched — no `Investigator Decision?`-equivalent gateway on either, since escalation is one-directional and investigator-only per Scope.
- `Legal Review`, once reached via escalation, behaves exactly as it does when DMN-routed there directly — same form, same `capture-review-decision` step afterward, same `Decision` gateway. No new terminal state; escalation is a detour into the existing legal path, not a new path.

### Form change (`process/forms/review-decision.form`)

- The `decision` field's option set is role-conditional: `Adjuster Review` and `Legal Review` keep today's three options (`approve`/`deny`/`moreInfo`); `Investigator Review` gets a fourth, `escalate`. Camunda 8 forms can condition a field's options on another field/context via FEEL, or (simpler, matching the existing pattern) this can just be two variants of the form bound to their respective task — check which `review-decision.form` already does for role-specific differences, if any, before choosing.
- New field `escalationReason` (text, multi-line), shown/required only when `decision = "escalate"` — same static-required limitation `SPEC.md` §10's "Tasklist form template" section already calls out for `denialReason` (*"required only when decision=deny" can't be expressed by form-js's static validation — enforced by `capture-review-decision`, not the form*). `capture-escalation` enforces it the same way.

### In-app review UI (`frontend/portal/app/tasks/[key]/page.tsx`)

- The decision `<select>` around line 317-336 (`const [decision, setDecision] = useState<"approve" | "deny" | "moreInfo">(...)`) gains `"escalate"` to its union type, conditionally rendered as a fourth `<option>` only when the task being completed is an `Investigator Review` task (the component already has `task.claim`/task-type context available — reuse whatever field already distinguishes review-task type, e.g. however `REVIEW_ROLES`/role-specific rendering around line 285-289 currently identifies the task's role).
- When `decision === "escalate"`, render a required textarea for `escalationReason` (same conditional-field pattern already used for `denialReason` when `decision === "deny"`, line 329-336) and post it as the completion payload's `escalationReason` alongside `decision`.

### `capture-escalation` job worker

New file `backend/workers/capture-escalation.ts` (scaffold via `/new-job-worker capture-escalation`), matching the `capture-*` family's existing shape (§12):

| Job type | Input variables | Does | Output variables |
|---|---|---|---|
| `capture-escalation` | `claimId`, `escalationReason` | Writes `claims.confirmed_role = "legal"` (overwriting `"investigator"`); does **not** touch `claims.status` (stays `in_review` — a claim mid-escalation is still mid-review, just now under a different role) or `claims.decision`/`denial_reason`; writes `audit_log` (`actor_type = "human"`, `action = "escalated_to_legal"`, `detail = { escalationReason, previousRole: "investigator" }`); best-effort calls `notifyRole("legal-reviewer", claimId, "Legal Review")` (same failure-isolation contract as the four existing hook points — a notification failure never fails this worker) | — |

This mirrors `capture-triage-review`'s existing pattern of writing `confirmed_role` and flagging the change in `audit_log.detail` (§12) rather than adding a new `claims` column — no DB migration needed. `escalationReason` lives only in `audit_log.detail` (jsonb), the same way an override reason at triage does today, not as a new `claims.escalation_reason` column — this claim was never denied or stalled, so it doesn't fit the `denial_reason`/`info_requested_reason` pattern of "why did this claim stop moving forward."

### Audit trail

Per §13 / `CLAUDE.md`, `capture-escalation` writing one `audit_log` row satisfies "every job worker... writes at least one `audit_log` row." `/audit-log-check backend/workers/capture-escalation.ts` before calling this done. `/case-trace` on a test escalated claim should show: `...` → `assigned_role: investigator` (DMN) → `triage_confirmed` (confirms investigator) → `Investigator Review` opens → `escalated_to_legal` (this spec) → `Legal Review` opens → `capture-review-decision` → resolution — a legible, single extra hop in the existing timeline, not a break in it.

## Open Questions

1. **Does `review-decision.form` already parameterize by role, or is it one shared form bound to all three User Tasks?** If it's the latter (one form, reused three times), making `escalate` investigator-only requires either splitting into a role-specific variant just for `Investigator Review`, or a FEEL condition on the option list keyed off which task instance is active. Needs a look at the actual `.form` JSON before implementation — this spec assumes it's achievable but doesn't commit to which mechanism.
2. **Should `Adjuster Review` also get an escalate-to-investigator (or escalate-to-legal) option in a later pass?** Out of scope here per the literal §2/§14/#23 wording (investigator → legal only), but worth a product decision once this ships, since an adjuster hitting something clearly fraudulent has the same "not my call" problem investigators do today.
3. **Does an escalated claim need any visible flag on the claimant-facing status page** (`frontend/portal/app/claims/[id]/page.tsx`), or does it stay entirely internal (claimant just sees "in review" throughout, same as any other in-progress claim)? This spec assumes the latter (no claimant-visible change) since escalation is a routing detail, not a decision — flagging here in case that assumption is wrong.
4. ~~Interaction with `[[reviewer_task_notification_test_mode]]`~~ — resolved: checked that spec's actual wiring, confirmed it's exactly four fixed hook points (not "whenever the task opens" generically), so `capture-escalation` needs its own explicit `notifyRole()` call rather than inheriting one — see Design and the updated Scope above. Remember this is still running in **test mode** per that spec's lock note — an escalation "notification" email lands at the fixed test address, not real legal-reviewer inboxes, until that spec's test-mode override is removed.
