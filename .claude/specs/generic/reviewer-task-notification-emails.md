> Inferred type: **generic** (touches four existing job workers plus one new `backend/shared` module — no single db/bpmn/dmn/worker/insurance-type/api section in SPEC.md covers it as one unit, the same reasoning `[[forgot-password-otp-reset]]` used for itself)

# generic/reviewer-task-notification-emails

**Status:** Draft

## Purpose

Today, a reviewer only learns a task is waiting for them by opening `/tasks` (or stock Tasklist) and checking — there's no push notification of any kind when a `Triage Review`, `Validation Exception Review`, `Adjuster/Investigator/Legal Review`, or `Supervisor Sign-off` task becomes available for their role. This spec adds that: when one of those tasks opens, every `users` row with the matching role gets an email pointing them at `/tasks`, reusing the same `sendEmail()` primitive `[[forgot-password-otp-reset]]` already extracted for the OTP flow (itself reused from `notify-claimant`'s Gmail/Resend transport) — no new email infrastructure, just a new caller.

## Scope

**In scope:**
- A new `backend/shared` helper that, given a role, looks up every `users` row with that role and emails each of them a short "a task is waiting" notice linking to `/tasks`.
- Wiring that helper into the four job-worker points that each immediately precede a user task being created (see Design).
- Best-effort delivery: a notification failure never blocks or fails the claim's own processing.

**Out of scope:**
- Per-person assignment emails (i.e. only emailing whoever eventually clicks "claim" on a task) — candidate groups aren't per-person in this app (`[[auth-role-based-access]]`'s role→candidate-group map), so "the reviewer" for a freshly-opened task is every member of that role until someone claims it; that's who gets notified.
- Emailing `admin` on every task type — `admin` already has unscoped visibility into every queue via the existing UI; looping admin into all five notification triggers means an inbox that gets an admin's own copy of a triage email, an adjuster email, an investigator email, a legal email, and a sign-off email for every single claim, which isn't what "notify the reviewer" is asking for. Confirmed with the user before writing this spec.
- A digest/batching mode (e.g. one email per hour instead of one per task) — v1 is one email per task-opening event, matching `notify-claimant`'s existing one-email-per-decision pattern.
- Any change to Camunda's own task model, task listeners, or BPMN — this stays entirely in the four job workers' existing Node/TypeScript handlers, not a BPMN process change.
- SMS or in-app (browser) notifications — email only, per the request this spec answers.

## Design

### New shared helper — `backend/shared/reviewer-notifications.ts`

```
notifyRole(role: Role, claimId: string, taskLabel: string): Promise<{ notifiedCount: number }>
```

- `SELECT email FROM users WHERE role = $1` — every account with that exact role, no candidate-group indirection needed here (unlike `[[auth-role-based-access]]`'s Tasklist-proxy mapping, this is a direct app-role lookup, not a BPMN candidate-group one).
- Builds a short inline-styled-HTML email (same pattern as `notify-claimant`'s `buildEmail()` and the OTP email in `[[forgot-password-otp-reset]]`): "`<taskLabel>` task waiting" subject, one line naming the claim, a link to `${FRONTEND_URL}/tasks`.
- Sends one email per matched user via the existing `sendEmail()` (`backend/shared/email-sender.ts`), `Promise.all`'d.
- **Best-effort, not build-or-fail:** wraps the whole lookup+send in a `try/catch` that only `console.error`s on failure — never throws. A misconfigured email provider (or zero users with that role) must never turn into a failed job / Operate incident on an otherwise-successful claim-processing step. This mirrors `notify-claimant`'s own mock-fallback philosophy (SPEC.md §12: "a dev machine with neither still runs... instead of failing every denied/approved claim into an Operate incident") applied to a second, non-critical email path.
- Zero new `users`-table columns, zero new migration — pure read of the existing `role` column.

### The four hook points

Each is the last piece of code that runs *before* the process instance actually creates the next user task — i.e. the natural place to know "this task is about to exist" without needing a Camunda task-listener mechanism.

| Worker | Condition | Notifies role | Task the reviewer is being pointed at |
|---|---|---|---|
| `validate-claim` | `validationPassed === false` | `triage-team` | `Validation Exception Review` |
| `capture-routing-decision` | always (this worker only runs on the path that leads to Triage Review) | `triage-team` | `Triage Review` |
| `capture-triage-review` | `triageAction === "review"` (not `"reject"` — that branch denies the claim outright and no review task opens) | mapped from `confirmedRole` (see below) | `Adjuster Review` / `Investigator Review` / `Legal Review` |
| `capture-review-decision` | `decision === "approve"` **and** `claim_amount > 50000` | `supervisor` | `Supervisor Sign-off` |

**`confirmedRole` → app `role` mapping** (they're not the same strings — `capture-triage-review`'s `confirmedRole` values are `adjuster \| investigator \| legal`, but the `users.role` value for the third one is `legal-reviewer`, per `[[auth-role-based-access]]`'s locked role list):

| `confirmedRole` | `users.role` |
|---|---|
| `adjuster` | `adjuster` |
| `investigator` | `investigator` |
| `legal` | `legal-reviewer` |

**`capture-review-decision`'s threshold check is a real duplication risk, flagged rather than hidden:** this worker doesn't receive `claimAmount` as a process variable today (only `claimId`, `decision`, `denialReason`, `confirmedRole`), so this spec has it do one extra `SELECT claim_amount FROM claims WHERE id = $1` on the approve branch, then compare against `50000` — the same threshold value `SPEC.md` §10 step 15's `Needs Second Sign-off?` gateway is configured with today. These two `50000`s live in two different places (this worker's TypeScript, and the BPMN gateway's condition expression) with nothing keeping them in sync. `SPEC.md` §11 already accepts this exact kind of drift risk for DMN thresholds ("placeholder defaults — tune per carrier once real claim data exists"); this spec accepts the same tradeoff rather than solving threshold-centralization here, and flags it in Open Questions below.

### Failure isolation

None of the four workers' existing behavior changes — the notification call is purely additive, placed after the worker's existing `pool.query`/`writeAuditLog` calls and before `job.complete(...)`, and (per the best-effort wrapping above) can never turn a working claim-processing step into a failed one just because an email didn't send.

### Audit trail

No new `audit_log` rows. Each of the four workers already writes one row for its primary action (`validated`, `routed`, `triage_confirmed`, `decision_recorded`) per `SPEC.md` §13 — this spec adds a `reviewersNotified` count (or `null` if the notification branch didn't apply) to that *existing* row's `detail` JSON rather than writing a second row, since the notification isn't a separate case-history event, just a side-effect of the one that's already logged.

### Env vars

None new. `backend/workers/.env` already has `GMAIL_USER`/`GMAIL_APP_PASSWORD`/`RESEND_API_KEY` for `notify-claimant`; `sendEmail()` reads the same three, and this spec's four workers run in the same `backend/workers` process, so no second `.env` file is needed (unlike `[[forgot-password-otp-reset]]`, which needed to add these to `backend/api/.env` since that's a different process).

## Open Questions

1. **Threshold duplication** (flagged above, not resolved here): `capture-review-decision`'s hardcoded `50000` needs to be kept in sync with the BPMN gateway's condition by hand. Worth a follow-up if the threshold ever needs to be carrier-configurable (`SPEC.md` §14's per-carrier tenant isolation item would need to solve this properly anyway) — not blocking for this spec's initial version.
2. **Resend/cooldown noise.** Unlike the OTP flow, there's no cooldown here — if multiple claims route to `triage-team` in quick succession, every triage-team member gets one email per claim. Confirm that's acceptable before Lock, or whether a per-role batching window is worth adding later.

## Follow-up dependencies

- None known.
