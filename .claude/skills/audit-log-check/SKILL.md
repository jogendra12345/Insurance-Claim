---
name: audit-log-check
description: Review a file or diff to confirm every job worker and user-task completion handler writes a compliant audit_log row per SPEC.md §13 — reports findings only, never auto-fixes
argument-hint: "[file-or-diff]"
---

## What this does

Checks a given file or diff for compliance with `SPEC.md` §13 (Audit trail): every job worker and every user-task completion handler must write at least one `audit_log` row. This skill only reports findings — it never edits code to fix them.

## Steps

1. Parse `$ARGUMENTS` as a file path, a glob, or a diff reference (e.g. a commit range, or "the current diff" / "staged changes"). If nothing is given, default to the current uncommitted diff (`git diff` + `git diff --staged`).
2. Read `SPEC.md` §13 in full, plus the relevant row(s) of §12 (Job workers) for any worker file in scope, so expectations are pulled from the spec, not assumed.
3. For each job worker or user-task completion handler in scope, check for a call that writes an `audit_log` row (typically via a shared audit-log writer such as `backend/shared/audit-log.ts`, if that's the pattern already established in the codebase — read it if it exists rather than assuming its shape).
4. For each one found, verify against §13's rules:
   - **A row is written at all** before the function/handler completes (not just on the happy path — if it only writes on success but the step can also fail into a documented action, note that gap).
   - **`actor_type`** is one of `system` | `ai` | `human`, and matches the step: `ai` for steps that call Claude (per §12's "Does" column), `system` for other deterministic worker steps, `human` for Tasklist/user-task completions.
   - **`actor_id`** is a real, non-empty identifier (the worker/job-type name, or an actual Tasklist user id) — not a placeholder, `null`, or a hardcoded literal that doesn't reflect the real actor.
   - **`action`** is a short, past-tense description, consistent in style with the examples in §9's `audit_log` schema comment (`"validated"`, `"routed"`, `"fraud_flagged"`, `"reviewed"`, `"settled"`) — flag present-tense, vague (`"processed"`), or inconsistent verbs.
   - **`detail`** carries meaningful context, not an empty object — for AI-backed steps this should include the AI's reasoning; for human overrides (`confirmedRole ≠ assignedRole`), the override reason.
5. For each job worker/handler with **no** audit_log write at all, flag it as a compliance gap, not just a style issue — that's a direct violation of "every job worker and every user-task completion handler writes at least one audit_log row."

## Output

Report findings with file:line references, one per issue, ranked most-severe first (missing row > wrong actor_type > weak actor_id/action/detail). Do not modify any files. If the `ReportFindings` tool is available in this session, use it to structure the output; otherwise present the same information as a plain list. End with a one-line summary: how many workers/handlers were checked, how many are clean, how many have findings.
