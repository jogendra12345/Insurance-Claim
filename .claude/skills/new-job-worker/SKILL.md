---
name: new-job-worker
description: Scaffold a new Camunda job worker at backend/workers/<job-type>.ts following SPEC.md §12's job-worker contract table
argument-hint: "[job-type]"
---

## What this does

Scaffolds `backend/workers/<job-type>.ts` for one of the eight job types documented in `SPEC.md` §12. It never invents a job type — the worker's input variables, behavior, and output variables must already be documented there.

## Steps

1. Parse `$ARGUMENTS` as `[job-type]` (e.g. `validate-claim`). If missing, stop and ask for it.
2. Read `SPEC.md` §12 (Job workers) in full — it is the single source of truth here, not this skill's own memory of it. The documented job types, as of this writing, are: `validate-claim`, `extract-evidence`, `detect-fraud-indicators`, `score-risk`, `trigger-settlement`, `draft-denial-letter`, `notify-claimant`, `close-case`.
3. **If `job-type` is not one of the rows in §12's table, stop.** Do not invent input variables, behavior, or output variables for it. Ask explicitly: "This job type isn't in SPEC.md §12 — should I add it there first (update the spec), or did you mean one of [list the documented job types]?" Do not write a file in this case.
4. If `job-type` matches a row, also check §13 (Audit trail) and §3 (Insurance-type extensibility) — both apply to every worker.
5. Check whether `backend/workers/<job-type>.ts` already exists. If it does, stop and ask whether to overwrite — don't silently clobber existing worker code.
6. Check whether the shared modules this worker needs already exist: `backend/shared/zeebe-client.ts`, `backend/shared/claude-client.ts` (only if this job type calls Claude), `backend/shared/audit-log.ts`, and `backend/shared/insurance-types/<type>.ts` (only if this job type is insurance-type-aware). If any exist, read them and use their actual exported functions/signatures — don't guess an API that conflicts with what's already there. If a shared module doesn't exist yet, scaffold the worker against a minimal, clearly-commented assumed interface (e.g. `// TODO: backend/shared/audit-log.ts doesn't exist yet — assumes writeAuditLog(entry): Promise<void>`) rather than silently building out the shared module too — that's a separate, broader piece of work this skill isn't scoped to invent.

## What the generated worker must do (per §12 and §13)

- Register a Zeebe job worker for exactly the job type name given, via `@camunda8/sdk` (per `SPEC.md` §6 tech stack).
- Read **only** the input variables listed in that job type's §12 row — no extra variables not documented there.
- If the job type's §12 "Does" description says it calls Claude (`extract-evidence`, `detect-fraud-indicators`, `score-risk`, `draft-denial-letter`), call the shared Claude client for that step. Do not call Claude for job types whose §12 description doesn't mention it (`validate-claim`, `trigger-settlement`, `notify-claimant`, `close-case`).
- If the job type is one of the three §12 calls out as insurance-type aware (`validate-claim`, `extract-evidence`, `detect-fraud-indicators`), load the config module for the claim's `insuranceType` from `backend/shared/insurance-types/<insuranceType>.ts` (§3) rather than hardcoding health-specific logic inline.
- Set **only** the output variables listed in that job type's §12 row.
- Before completing the job, write exactly one `audit_log` row via the shared audit-log writer (§13): `actor_type: 'ai'` if this step calls Claude, otherwise `'system'`; `actor_id` set to the job type name; `action` a short past-tense description of what happened; `detail` carrying meaningful context (e.g. the AI's reasoning for AI-backed steps).
- Follow Zeebe's default retry behavior — unhandled exceptions should propagate (not be swallowed), so Zeebe's built-in 3-attempt retry and Operate incident on failure (§12, §14) still applies. Do not add custom try/catch error-boundary logic — that's explicitly out of scope for v1.

## After writing

Report the file path written, which shared modules it assumes vs. reuses, and remind the user this worker isn't registered/started anywhere yet if there's no worker bootstrap file — that's a separate piece of work.
