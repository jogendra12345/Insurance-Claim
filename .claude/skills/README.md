# ClaimFlow AI — Claude Code skills

Six skills for working against `SPEC.md`, this repo's source of truth. All of them read `SPEC.md` fresh each time rather than trusting memory of it — if `SPEC.md` changes, these skills' behavior changes with it. Invoke with `/<skill-name> [args]`.

## Skills at a glance

| Skill | Use it when... | Writes files? |
|---|---|---|
| [`new-job-worker`](new-job-worker/SKILL.md) | You're about to build a job worker for a job type already documented in `SPEC.md` §12 | Yes — `backend/workers/<job-type>.ts` |
| [`add-insurance-type`](add-insurance-type/SKILL.md) | You're extending the platform to a new insurance line beyond health, per §3 | Yes — a config module + DMN skeleton |
| [`audit-log-check`](audit-log-check/SKILL.md) | You want to confirm a file/diff's workers and handlers write compliant `audit_log` rows (§13) | No — report only |
| [`spec-sync`](spec-sync/SKILL.md) | You changed code and want to know if `SPEC.md` needs updating to match | No — drafts an edit, doesn't apply it |
| [`dmn-table-review`](dmn-table-review/SKILL.md) | You want to check a `.dmn` file against the routing table documented in §11 | No — report only |
| [`case-trace`](case-trace/SKILL.md) | You need the full history of one claim, spanning `audit_log` and Camunda | No — report only |

## Suggested order of use

**Building something new** (a worker, or a new insurance type):
1. Check `SPEC.md` first — if what you want isn't documented yet (a new job type, a new type's process behavior), the scaffolding skills will stop and ask rather than invent it. Update `SPEC.md` yourself, or via `/create-spec`, before running them.
2. `/new-job-worker <job-type>` or `/add-insurance-type <type>` to scaffold.
3. `/audit-log-check backend/workers/<job-type>.ts` to confirm the new worker's `audit_log` write is compliant before you consider it done.

**After making a code change:**
1. `/spec-sync` (defaults to your current diff) to catch anything you built that `SPEC.md` doesn't document yet — a new variable, gateway branch, candidate group, schema column, or job type.
2. Review the drafted `SPEC.md` edit it proposes; apply it yourself (or via `/create-spec` → Review & Lock) if it's right.

**Auditing / debugging a specific claim or process area:**
- `/case-trace <claim-id>` to see everything that happened to one claim, merged from Postgres and Camunda, with any missing-audit-row gaps flagged.
- `/dmn-table-review process/<type>-claim-routing.dmn` after touching a DMN table, to confirm it still matches what §11 documents (or, for a non-health table, still matches §11's *structure* even with different tuned thresholds).

## What these skills will never do

- **Never invent behavior `SPEC.md` doesn't already describe.** `new-job-worker` and `add-insurance-type` stop and ask if the thing you're asking for isn't documented, rather than guessing.
- **Never touch `process/claim-case-process.bpmn`.** `add-insurance-type` flags any request that seems to need a BPMN change as a spec-level conflict instead.
- **Never silently apply a `SPEC.md` edit.** `spec-sync` and `add-insurance-type`'s spec-update step only draft proposed edits — you (or a follow-up `/create-spec` pass) apply them, consistent with this repo's Draft → Review & Lock → Build lifecycle.
- **Never auto-fix what they find.** `audit-log-check`, `dmn-table-review`, and `case-trace` are report-only — they flag issues with enough detail to fix, but leave the fix to you.

## Full docs

Each skill's `SKILL.md` is the actual source of truth for what it does — this file is just a map. Read the skill file directly if you need the exact rules it follows.
