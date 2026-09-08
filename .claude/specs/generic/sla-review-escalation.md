# generic/sla-review-escalation

**Status:** Draft

## Purpose

Every review task in the process today (§10 steps 3, 9, 12) can sit open indefinitely — nothing prevents a claim stalling for days waiting on `Validation Exception Review`, `Triage Review`, or a role-specific review if the assigned team just doesn't get to it. This spec adds a wall-clock SLA to each of those tasks: **24 hours** after any of them opens, if it's still not completed by a human, a system-triggered action fires automatically so the claim keeps moving instead of silently stalling.

This is a distinct, complementary mechanism to `[[cross-role-escalation]]` (already drafted): that spec is a **human choosing** to hand an investigator's in-progress review to legal. This spec is a **timer firing** because nobody acted at all, on three different task types, with three different automatic outcomes depending on which task timed out. Both can coexist — an investigator can still manually escalate at any point inside the 24-hour window; if neither a manual escalate nor a normal decision happens before the window closes, the timer takes over.

## Scope

**In scope:**
- A 24-hour (`PT24H`), wall-clock, **interrupting** timer boundary event on each of: `Validation Exception Review`, `Triage Review`, `Adjuster Review`, `Investigator Review`, `Legal Review`. Wall-clock means real elapsed time from task creation — weekends/nights count, no business-hours calendar.
- Per-task automatic outcome on timeout:
  - `Validation Exception Review` → **auto-reject** (same shape as the existing manual `reject` branch), with a fixed, canned `denialReason`.
  - `Triage Review` → **auto-confirm** the AI's `assignedRole` as `confirmedRole` (equivalent to a human choosing `triageAction = "review"` and accepting the suggestion as-is), then continues to the appropriate role-specific review exactly as today.
  - `Adjuster Review` → auto-escalates to `Investigator Review`.
  - `Investigator Review` → auto-escalates to `Legal Review` (same destination task as `[[cross-role-escalation]]`'s manual path, but a distinct `audit_log.action` — see Design).
  - `Legal Review` → auto-escalates to a **new** `Supervisor Review` task (candidate group `supervisors`) — legal is the DMN's top tier (§11), so there's no further role to hand off to; supervisor is the last-resort fallback for this one case only.
- `Supervisor Review`: a new User Task, distinct from the existing `Supervisor Sign-off` (§10 step 15). Reuses `ReviewDecisionForm` (`approve`/`deny`/`moreInfo`, same as the three role reviews) so a supervisor picking up an SLA-orphaned claim has the same real decision authority a role reviewer would have had — not the rubber-stamp `Supervisor Sign-off` does today.
- All five auto-actions write `audit_log` with `actor_type = "system"` (not `human`) and a distinct `action` value per outcome, so `/case-trace` and any future audit view (`BUILD-PLAN.md` #33) can tell an SLA timeout apart from a human decision at a glance.
- Whichever role newly inherits a claim (`Investigator Review`, `Legal Review`, or the new `Supervisor Review`) gets an email via `[[reviewer_task_notification_test_mode]]`'s `notifyRole()` helper, same as any other freshly-opened task — see Design. `Validation Exception Review`'s auto-reject doesn't need one (it closes the claim, it doesn't hand it to anyone).
- Every automatic action is a **one-way, single hop** — an escalated-to task (e.g. `Legal Review` reached via investigator's timeout) gets its own fresh 24-hour timer, same as any other instance of that task type. There's no cap today on how many times a single claim can hop (adjuster→investigator→legal→supervisor is the worst case, 4 timeouts = 4 days) — flagged under Open Questions.

**Out of scope:**
- Any SLA on `Supervisor Sign-off` (the existing maker-checker gate) or the new `Supervisor Review` task itself — once a claim reaches a supervisor, this spec doesn't define what happens if *that* also goes unaddressed. Supervisor is already the last resort; a further timeout has nowhere left to go automatically.
- Configurable/per-carrier/per-role SLA durations — v1 is a single hardcoded `PT24H` for every task type. Per-carrier tuning is the same kind of future work as the DMN's per-carrier thresholds (§11, §14).
- Any reminder/warning notification before the 24h mark (e.g. "2 hours left") — out of scope; `[[reviewer_task_notification_test_mode]]`'s existing "task is waiting" email already fires when each task opens, and this spec doesn't add a second nudge before timeout.
- Changing `Validation Exception Review`'s or `Triage Review`'s *manual* behavior — both still work exactly as documented in §10 today if a human acts within the window. This spec only adds what happens when nobody does.
- Non-interrupting timers / "escalate but let the original reviewer still complete it late" — v1 uses an **interrupting** boundary event, so once the timer fires, the original task instance is canceled and can no longer be completed by whoever had it open. Flagged as an Open Question below since it's a real behavior tradeoff, not an obviously-right default.

## Design

### BPMN process change (`process/claim-case-process.bpmn`)

Five new **interrupting Timer Boundary Events**, each attached to one existing User Task, each with duration `PT24H`:

| Attached to | On fire → Service Task | Then flows into |
|---|---|---|
| `Validation Exception Review` | `auto-reject-validation-exception` | Denial path (step 16) — same shared node `Task_DraftDenialLetter` the manual `reject` branch and `[[cross-role-escalation]]`-adjacent paths already merge into (§10 step 11's pattern) |
| `Triage Review` | `auto-confirm-triage` | `Route by Confirmed Role` gateway (§10 step 12), same as the manual `"review"` branch |
| `Adjuster Review` | `auto-escalate-review` (`fromRole="adjuster"`, `toRole="investigator"`) | `Investigator Review` (new incoming flow onto that existing task node) |
| `Investigator Review` | `auto-escalate-review` (`fromRole="investigator"`, `toRole="legal"`) | `Legal Review` (same task node `[[cross-role-escalation]]`'s manual escalate already loops into — now three incoming flows: DMN-routed, manually escalated, SLA-escalated) |
| `Legal Review` | `auto-escalate-review` (`fromRole="legal"`, `toRole="supervisor"`) | New **User Task** `Supervisor Review` (candidate group `supervisors`, form `ReviewDecisionForm`) → same `capture-review-decision`/`Decision` gateway flow every other role review already feeds (§10 step 13-14) |

No changes to any non-timer sequence flow — every task's normal (human-completed) path is untouched.

### New job workers (§12 shape)

| Job type | Input variables | Does | Output variables |
|---|---|---|---|
| `auto-reject-validation-exception` | `claimId` | Writes `claims.decision = 'deny'`, `claims.denial_reason = "Auto-rejected: validation exception unresolved after 24 hours"` (fixed string), sets `claims.status = 'denied'`; writes `audit_log` (`actor_type: "system"`, `action: "validation_exception_auto_rejected"`, `detail: { slaHours: 24 }`). No `notifyRole()` call — this denies the claim rather than opening a new review task, matching why `notify-claimant` (not a reviewer notification) already handles the denial path. | — |
| `auto-confirm-triage` | `claimId`, `assignedRole` | Writes `claims.confirmed_role = assignedRole`, sets `claims.status = 'in_review'`; writes `audit_log` (`actor_type: "system"`, `action: "triage_auto_confirmed"`, `detail: { slaHours: 24, confirmedRole: assignedRole }`); best-effort calls `notifyRole()` for whichever role-specific review task this opens (same `confirmedRole` → `users.role` mapping `[[reviewer_task_notification_test_mode]]` already defines — `adjuster`→`adjuster`, `investigator`→`investigator`, `legal`→`legal-reviewer`). This duplicates `capture-triage-review`'s own hook point rather than reusing it, since `auto-confirm-triage` is a separate worker that never calls `capture-triage-review`. | `confirmedRole` (= `assignedRole`, so the downstream `Route by Confirmed Role` gateway reads it the same way it reads a human-set value) |
| `auto-escalate-review` | `claimId`, `fromRole`, `toRole` | Writes `claims.confirmed_role = toRole`; writes `audit_log` (`actor_type: "system"`, `action: "review_sla_escalated"`, `detail: { slaHours: 24, fromRole, toRole }`) — deliberately a different `action` string from `[[cross-role-escalation]]`'s manual `capture-escalation` (`"escalated_to_legal"`), so the two are distinguishable in `audit_log`/`/case-trace` even though `investigator→legal` can be reached either way; best-effort calls `notifyRole()` for `toRole` (mapped to the `users.role` string per the table above — `investigator`→`investigator`, `legal`→`legal-reviewer`, `supervisor`→`supervisor`), pointing the newly-responsible reviewer(s) at the task they've just inherited | — |

All three follow the same best-effort contract `[[reviewer_task_notification_test_mode]]` already established (§ that spec's "Failure isolation"): a `try/catch` around lookup+send that only `console.error`s on failure, never throws — a notification outage can't turn a working SLA timeout into a failed job/Operate incident. Same test-mode caveat applies too: while `[[reviewer_task_notification_test_mode]]` stays in test mode, every one of these escalation emails also lands at the fixed test address, not the real reviewer's inbox.

All three are plain `capture-*`-style workers (no AI call, no external I/O) — same complexity class as `capture-triage-review`/`capture-validation-exception`, scaffoldable via `/new-job-worker`.

### `Supervisor Review` (new User Task)

- Candidate group `supervisors` (already exists as a role/group per §8's roles table — reused, not new).
- Form: `ReviewDecisionForm`, same as `Adjuster Review`/`Investigator Review`/`Legal Review` — `decision` (`approve`/`deny`/`moreInfo`) + `denialReason` when denying. No `escalate` option (§`[[cross-role-escalation]]`'s scope is investigator-only, and there's no role above supervisor to hand off to regardless).
- Feeds the same `capture-review-decision` → `Decision` gateway → approve/deny/moreInfo paths every other role review already uses (§10 steps 13-14) — no new downstream branching needed.
- In-app `/tasks` UI (`frontend/portal/app/tasks/[key]/page.tsx`) and `GET /api/tasks`'s role→candidate-group map (§14 auth design) both need `supervisor` added as a task type they can list/complete, alongside the existing `adjuster`/`investigator`/`legal-reviewer` role reviews — today supervisors only ever see `Supervisor Sign-off` tasks there.

### Timer duration as a process variable vs. hardcoded

Zeebe boundary timer events take either a literal ISO-8601 duration or a FEEL expression referencing a process variable. This spec uses the **literal `PT24H`** on all five, not a variable — simpler to deploy/reason about, and per-carrier/per-role tuning is explicitly out of scope (see Scope). If that changes later, each boundary event's duration would become `= slaDuration` (a variable set earlier in the process, e.g. from a per-carrier config lookup), without changing anything else in this design.

### Audit trail

Per §13, every one of the three new workers writes its own `audit_log` row with `actor_type: "system"` — satisfying the "every job worker writes at least one row" rule the same way every existing `capture-*` worker does, just with a different actor type than the human-triggered ones. `/audit-log-check` each new worker file. A claim that times out at every stage would show a fully legible, if unusual, `/case-trace` timeline: `triage_auto_confirmed` → `Adjuster Review` opens → `review_sla_escalated (adjuster→investigator)` → `Investigator Review` opens → `review_sla_escalated (investigator→legal)` → `Legal Review` opens → `review_sla_escalated (legal→supervisor)` → `Supervisor Review` opens → human decision.

## Open Questions

1. **Interrupting vs. non-interrupting timer:** this spec assumes interrupting (the original task is canceled the moment the timer fires, so if e.g. an investigator was mid-way through completing their review at hour 23:59, that in-progress work is lost and the claim has already moved to Legal by the time they submit). A non-interrupting timer would let the human still complete the original task even after the SLA action fires, but then needs a rule for "what if both happen" (human completes *and* the timer already escalated). Flagging this as the single biggest behavioral tradeoff in the whole spec — worth confirming before Lock.
2. **Worst-case hop count:** a claim that times out at every single stage takes 4 full days (adjuster→investigator→legal→supervisor, 24h each) before a human even sees it, on top of whatever time triage/validation review also ate. Is a 4-day worst case acceptable, or should later hops have a shorter SLA (e.g. legal/supervisor at 12h) to bound total time-to-resolution? V1 here is uniform 24h everywhere per your instruction — flagging in case that changes on reflection.
3. **`Supervisor Review` vs. `Supervisor Sign-off` — same task instance ever, or always distinct?** Today `Supervisor Sign-off` only appears on the *approved*, high-value path (§10 step 15), after a decision is already made. `Supervisor Review` (this spec) only appears when `Legal Review` timed out, *before* any decision exists. They can't collide in practice (different points in the process, different preconditions) — noting this only so Lock review explicitly confirms that's still true and no shared-task shortcut was intended.
4. **Should `auto-reject-validation-exception`'s denial trigger the existing denial-letter/notification pipeline exactly as a human rejection would** (`draft-denial-letter` grounds letter text in `denialReason`, per §12) — i.e. is a claimant-facing letter that says "Auto-rejected: validation exception unresolved after 24 hours" acceptable to send, or does this canned reason need friendlier claimant-facing wording than the internal audit string? This spec assumes the same `denial_reason` value serves both internal audit and the letter-drafting worker's input, matching how every other `denialReason` already works today.
