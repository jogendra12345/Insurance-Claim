# generic/sla-review-escalation

**Status:** Locked

> Locked 2026-09-08. All six Open Questions resolved and folded into Design/Scope below: (1) interrupting timer confirmed as final design; (2) uniform 24-business-hour SLA accepted at every stage, worst-case hop count acknowledged and accepted rather than tiering durations per role; (3) hardcoded holiday list accepted as a known, non-blocking v1 limitation; (4) US-federal-only holiday calendar confirmed, per-carrier calendars stay explicitly out of scope; (5) confirmed `Supervisor Review` and `Supervisor Sign-off` cannot collide (different preconditions, different points in the process); (6) `auto-reject-validation-exception`'s canned `denialReason` needs no special-casing — `draft-denial-letter` already turns any `denialReason` into claimant-appropriate prose via Gemini rather than sending it verbatim, the same as every human-entered denial reason today.

## Purpose

Every review task in the process today (§10 steps 3, 9, 12) can sit open indefinitely — nothing prevents a claim stalling for days waiting on `Validation Exception Review`, `Triage Review`, or a role-specific review if the assigned team just doesn't get to it. This spec adds an SLA to each of those tasks: **24 business hours** after any of them opens, if it's still not completed by a human, a system-triggered action fires automatically so the claim keeps moving instead of silently stalling.

"24 business hours" is a **business-day-aware deadline, not a business-hours accumulator**: the clock is still a flat 24-hour countdown, but weekends and holidays don't count as days the deadline can land on — a task opened Friday at 3pm gets a deadline of Monday 3pm, not Saturday 3pm, since Saturday/Sunday are skipped entirely. Time-of-day within a business day is not restricted (a task opened at 11pm Tuesday still gets a deadline of 11pm Wednesday, not adjusted to some business-hours window) — see Design for the exact algorithm and Scope for what's deliberately simpler than a full business-hours engine.

Escalation here is **automatic only** — there is no human "escalate" button on any review task. An earlier draft (`generic/cross-role-escalation`) explored a manual, human-initiated investigator→legal escalate option; it was dropped in favor of this timer-only mechanism, so all cross-role movement in this app happens exclusively through the timeout paths below, on three different task types, with three different automatic outcomes depending on which task timed out.

## Scope

**In scope:**
- A business-day-aware, 24-hour, **interrupting** timer boundary event on each of: `Validation Exception Review`, `Triage Review`, `Adjuster Review`, `Investigator Review`, `Legal Review`. Each deadline is computed per-instance (not a literal duration — see Design) so it skips Saturdays, Sundays, and configured holidays.
- A fixed list of US federal holidays (`backend/shared/business-days.ts`) the deadline calculation treats as non-business days alongside weekends — see Design for the algorithm and Follow-up dependencies for its maintenance cost.
- Per-task automatic outcome on timeout:
  - `Validation Exception Review` → **auto-reject** (same shape as the existing manual `reject` branch), with a fixed, canned `denialReason`.
  - `Triage Review` → **auto-confirm** the AI's `assignedRole` as `confirmedRole` (equivalent to a human choosing `triageAction = "review"` and accepting the suggestion as-is), then continues to the appropriate role-specific review exactly as today.
  - `Adjuster Review` → auto-escalates to `Investigator Review`.
  - `Investigator Review` → auto-escalates to `Legal Review`.
  - `Legal Review` → auto-escalates to a **new** `Supervisor Review` task (candidate group `supervisors`) — legal is the DMN's top tier (§11), so there's no further role to hand off to; supervisor is the last-resort fallback for this one case only.
- `Supervisor Review`: a new User Task, distinct from the existing `Supervisor Sign-off` (§10 step 15). Reuses `ReviewDecisionForm` (`approve`/`deny`/`moreInfo`, same as the three role reviews) so a supervisor picking up an SLA-orphaned claim has the same real decision authority a role reviewer would have had — not the rubber-stamp `Supervisor Sign-off` does today.
- All five auto-actions write `audit_log` with `actor_type = "system"` (not `human`) and a distinct `action` value per outcome, so `/case-trace` and any future audit view (`BUILD-PLAN.md` #33) can tell an SLA timeout apart from a human decision at a glance.
- Whichever role newly inherits a claim (`Investigator Review`, `Legal Review`, or the new `Supervisor Review`) gets an email via `[[reviewer_task_notification_test_mode]]`'s `notifyRole()` helper, same as any other freshly-opened task — see Design. `Validation Exception Review`'s auto-reject doesn't need one (it closes the claim, it doesn't hand it to anyone).
- Every automatic action is a **one-way, single hop** — an escalated-to task (e.g. `Legal Review` reached via investigator's timeout) gets its own fresh business-day deadline, same as any other instance of that task type. There's no cap today on how many times a single claim can hop (adjuster→investigator→legal→supervisor is the worst case, 4 timeouts — up to roughly a full business week elapsed depending where each 24-business-hour window lands relative to a weekend). **Decided at Lock:** this worst case is accepted rather than tiering durations by role (e.g. a shorter SLA on later hops) — every hop only happens when a human genuinely never acted at all, so the 24-business-hour window stays uniform everywhere for consistency and simplicity; tiered SLAs are the same kind of per-role tuning already deferred below.

**Out of scope:**
- A true business-*hours* engine (e.g. only 9am-5pm counts, so 24 business hours could take 3+ calendar days to accumulate) — v1 only excludes non-business *days*, not restricts *time-of-day* within a business day. See Purpose for the exact distinction.
- Any SLA on `Supervisor Sign-off` (the existing maker-checker gate) or the new `Supervisor Review` task itself — once a claim reaches a supervisor, this spec doesn't define what happens if *that* also goes unaddressed. Supervisor is already the last resort; a further timeout has nowhere left to go automatically.
- Configurable/per-carrier/per-role SLA durations, and a configurable/regional holiday calendar — v1 is a single hardcoded 24-business-hour window and a single hardcoded US-federal holiday list for every task type/carrier. **Decided at Lock:** accepted as a known v1 limitation, same tradeoff class as the DMN's placeholder per-carrier thresholds (§11, §14) — a non-US carrier or a carrier needing a different holiday calendar isn't correctly served until per-carrier config (§14) becomes real. The hardcoded `US_FEDERAL_HOLIDAYS` list also goes stale year over year with no maintenance mechanism today; acceptable for a demo app, worth a follow-up (e.g. a small `holidays` table) only if this needs to keep working unattended past a year or two.
- Any reminder/warning notification before the 24h mark (e.g. "2 hours left") — out of scope; `[[reviewer_task_notification_test_mode]]`'s existing "task is waiting" email already fires when each task opens, and this spec doesn't add a second nudge before timeout.
- Changing `Validation Exception Review`'s or `Triage Review`'s *manual* behavior — both still work exactly as documented in §10 today if a human acts within the window. This spec only adds what happens when nobody does.
- Non-interrupting timers / "escalate but let the original reviewer still complete it late" — v1 uses an **interrupting** boundary event, so once the timer fires, the original task instance is canceled and can no longer be completed by whoever had it open. **Decided at Lock:** interrupting stays the final design — a non-interrupting timer would need a race-condition rule ("human completes *and* the timer already escalated") that adds real complexity for a demo app that isn't running at a volume where this edge case matters in practice.

## Design

### `backend/shared/business-days.ts` (new shared module)

Zeebe boundary timer events don't have a native "skip weekends/holidays" mode — they only support a literal ISO-8601 **duration** (`PT24H`, fixed elapsed time) or a FEEL expression evaluating to an actual **date-time** (`timeDate`). Getting business-day behavior means computing the real target timestamp ourselves, once, right before each task opens, and pointing that task's boundary event at the computed value instead of a literal duration.

```
computeBusinessDeadline(fromDate: Date, businessHours = 24): Date
```

- `US_FEDERAL_HOLIDAYS`: a hardcoded `Set<string>` of `YYYY-MM-DD` dates (New Year's Day, MLK Day, Presidents Day, Memorial Day, Juneteenth, Independence Day, Labor Day, Columbus Day, Veterans Day, Thanksgiving, Christmas), populated for the current and next calendar year. See Follow-up dependencies for why this doesn't scale past a couple of years without maintenance.
- Algorithm: start from `fromDate + businessHours` (i.e. `+24h`, same flat duration as before). If that landing timestamp falls on a Saturday, Sunday, or a date in `US_FEDERAL_HOLIDAYS`, advance it one calendar day at a time (same time-of-day) until it lands on a non-weekend, non-holiday date. Example matching the requested behavior exactly: a task opened Friday 3:00pm → naive `+24h` lands Saturday 3:00pm (weekend) → roll to Sunday 3:00pm (still weekend) → roll to Monday 3:00pm (business day, stop). Final deadline: Monday 3:00pm.
- Returns a `Date`; callers serialize it to an ISO-8601 string for the process variable (see below).
- Pure, synchronous, no DB/network call — safe to call from any worker without adding I/O or failure surface.

### Deadline computed and set right before each task opens

Since the boundary event needs an actual timestamp (not a formula Zeebe can evaluate itself), **whichever step immediately precedes a timer-boundary task must call `computeBusinessDeadline()` and set the result as an output variable**, the same way `capture-routing-decision` already sets `assignedRole` right before `Triage Review` opens. One shared variable name, `slaDeadline` (ISO-8601 string), is reused across all five hand-off points — only the boundary event actually "live" at any point in the process reads it, so there's no collision risk between task types:

| Preceding step | Sets `slaDeadline` for |
|---|---|
| `validate-claim` (validation-failure branch) | `Validation Exception Review` |
| `capture-routing-decision` | `Triage Review` |
| `capture-triage-review` (`"review"` branch) | Whichever of `Adjuster Review`/`Investigator Review`/`Legal Review` `confirmedRole` routes to |
| `auto-escalate-review` | Whichever task `toRole` routes to (`Investigator Review`/`Legal Review`/`Supervisor Review`) |

Each of these four existing (three) / new (one, `auto-escalate-review`) workers gets one extra line — `slaDeadline: computeBusinessDeadline(new Date()).toISOString()` — added to its existing output variables. This is a small, additive change to `validate-claim`, `capture-routing-decision`, and `capture-triage-review`, none of which are otherwise touched by this spec.

### BPMN process change (`process/claim-case-process.bpmn`)

Five new **interrupting Timer Boundary Events**, each attached to one existing User Task, each configured with `timeDate = =date and time(slaDeadline)` (a FEEL expression reading the process variable set above) instead of a literal duration:

| Attached to | On fire → Service Task | Then flows into |
|---|---|---|
| `Validation Exception Review` | `auto-reject-validation-exception` | Denial path (step 16) — same shared node `Task_DraftDenialLetter` the manual `reject` branch already merges into (§10 step 11's pattern) |
| `Triage Review` | `auto-confirm-triage` | `Route by Confirmed Role` gateway (§10 step 12), same as the manual `"review"` branch |
| `Adjuster Review` | `auto-escalate-review` (`fromRole="adjuster"`, `toRole="investigator"`) | `Investigator Review` (new incoming flow onto that existing task node) |
| `Investigator Review` | `auto-escalate-review` (`fromRole="investigator"`, `toRole="legal"`) | `Legal Review` (new incoming flow onto that existing task node, alongside the DMN-routed one) |
| `Legal Review` | `auto-escalate-review` (`fromRole="legal"`, `toRole="supervisor"`) | New **User Task** `Supervisor Review` (candidate group `supervisors`, form `ReviewDecisionForm`) → same `capture-review-decision`/`Decision` gateway flow every other role review already feeds (§10 step 13-14) |

No changes to any non-timer sequence flow — every task's normal (human-completed) path is untouched.

### New job workers (§12 shape)

| Job type | Input variables | Does | Output variables |
|---|---|---|---|
| `auto-reject-validation-exception` | `claimId` | Writes `claims.decision = 'deny'`, `claims.denial_reason = "Auto-rejected: validation exception unresolved after 24 business hours"` (fixed string), sets `claims.status = 'denied'`; writes `audit_log` (`actor_type: "system"`, `action: "validation_exception_auto_rejected"`, `detail: { slaBusinessHours: 24 }`). No `notifyRole()` call — this denies the claim rather than opening a new review task, matching why `notify-claimant` (not a reviewer notification) already handles the denial path. **Decided at Lock:** this fixed string needs no claimant-friendlier variant — `draft-denial-letter` (§12) already drafts letter prose *grounded in* `denialReason` via Gemini rather than sending the raw string to the claimant verbatim, exactly like every human-entered `denialReason` today. | — |
| `auto-confirm-triage` | `claimId`, `assignedRole` | Writes `claims.confirmed_role = assignedRole`, sets `claims.status = 'in_review'`; writes `audit_log` (`actor_type: "system"`, `action: "triage_auto_confirmed"`, `detail: { slaBusinessHours: 24, confirmedRole: assignedRole }`); best-effort calls `notifyRole()` for whichever role-specific review task this opens (same `confirmedRole` → `users.role` mapping `[[reviewer_task_notification_test_mode]]` already defines — `adjuster`→`adjuster`, `investigator`→`investigator`, `legal`→`legal-reviewer`). This duplicates `capture-triage-review`'s own hook point rather than reusing it, since `auto-confirm-triage` is a separate worker that never calls `capture-triage-review`. Also sets `slaDeadline` (see Design) for whichever role-specific review this opens. | `confirmedRole` (= `assignedRole`), `slaDeadline` |
| `auto-escalate-review` | `claimId`, `fromRole`, `toRole` | Writes `claims.confirmed_role = toRole`; writes `audit_log` (`actor_type: "system"`, `action: "review_sla_escalated"`, `detail: { slaBusinessHours: 24, fromRole, toRole }`); best-effort calls `notifyRole()` for `toRole` (mapped to the `users.role` string per the table above — `investigator`→`investigator`, `legal`→`legal-reviewer`, `supervisor`→`supervisor`), pointing the newly-responsible reviewer(s) at the task they've just inherited. Also computes and sets `slaDeadline` (see Design) for the task `toRole` is about to open. | `slaDeadline` |

All three follow the same best-effort contract `[[reviewer_task_notification_test_mode]]` already established (§ that spec's "Failure isolation"): a `try/catch` around lookup+send that only `console.error`s on failure, never throws — a notification outage can't turn a working SLA timeout into a failed job/Operate incident. Same test-mode caveat applies too: while `[[reviewer_task_notification_test_mode]]` stays in test mode, every one of these escalation emails also lands at the fixed test address, not the real reviewer's inbox.

All three are plain `capture-*`-style workers (no AI call, no external I/O) — same complexity class as `capture-triage-review`/`capture-validation-exception`, scaffoldable via `/new-job-worker`.

### `Supervisor Review` (new User Task)

- Candidate group `supervisors` (already exists as a role/group per §8's roles table — reused, not new).
- Form: `ReviewDecisionForm`, same as `Adjuster Review`/`Investigator Review`/`Legal Review` — `decision` (`approve`/`deny`/`moreInfo`) only, same three outcomes every role review already has. No escalate option here either — supervisor is the last tier, nowhere further to hand off to.
- Feeds the same `capture-review-decision` → `Decision` gateway → approve/deny/moreInfo paths every other role review already uses (§10 steps 13-14) — no new downstream branching needed.
- In-app `/tasks` UI (`frontend/portal/app/tasks/[key]/page.tsx`) and `GET /api/tasks`'s role→candidate-group map (§14 auth design) both need `supervisor` added as a task type they can list/complete, alongside the existing `adjuster`/`investigator`/`legal-reviewer` role reviews — today supervisors only ever see `Supervisor Sign-off` tasks there.
- **Confirmed distinct from `Supervisor Sign-off`, cannot collide:** `Supervisor Sign-off` only ever appears on the *approved*, high-value path (§10 step 15), after a decision already exists. `Supervisor Review` only ever appears when `Legal Review` timed out, *before* any decision exists — different points in the process, mutually exclusive preconditions, no shared-task shortcut intended or needed.

### Audit trail

Per §13, every one of the three new workers writes its own `audit_log` row with `actor_type: "system"` — satisfying the "every job worker writes at least one row" rule the same way every existing `capture-*` worker does, just with a different actor type than the human-triggered ones. `/audit-log-check` each new worker file. A claim that times out at every stage would show a fully legible, if unusual, `/case-trace` timeline: `triage_auto_confirmed` → `Adjuster Review` opens → `review_sla_escalated (adjuster→investigator)` → `Investigator Review` opens → `review_sla_escalated (investigator→legal)` → `Legal Review` opens → `review_sla_escalated (legal→supervisor)` → `Supervisor Review` opens → human decision.

## Follow-up dependencies

- Per-carrier SLA/holiday-calendar configuration (`SPEC.md` §14) — explicitly deferred, same as the DMN's per-carrier thresholds; this spec's hardcoded 24-business-hour window and US-federal holiday list stay uniform across every carrier until that lands.
- A `holidays` table (or similar maintenance mechanism) to replace the hardcoded `US_FEDERAL_HOLIDAYS` set once it can no longer go unmaintained year over year — not needed for v1.
