---
name: spec-sync
description: Check a code change or diff against SPEC.md for undocumented additions and draft (never apply) the exact SPEC.md edit needed
argument-hint: "[file-or-diff]"
---

## What this does

Cross-references a code change against `SPEC.md` to catch drift — anything the code now does that the spec doesn't document — and drafts the fix as an edit proposal. Per `CLAUDE.md`'s "update SPEC.md first when scope changes, then implement" rule, and this repo's Draft → Review & Lock → Build lifecycle, this skill never edits `SPEC.md` itself; it only prepares what a human would apply after review.

## Steps

1. Parse `$ARGUMENTS` as a file path, glob, or diff reference. If nothing is given, default to the current uncommitted diff (`git diff` + `git diff --staged`).
2. Read `SPEC.md` in full — not just the section that seems relevant, since a single code change can touch several (e.g. a new BPMN gateway branch also implies a new candidate group and possibly a new job type).
3. Scan the change for anything that looks new relative to what's documented, specifically:
   - **A new variable** — a Zeebe process/job variable read or set that isn't listed in §10 (BPMN process steps) or the relevant §12 job-worker row.
   - **A new gateway branch** — an `Exclusive Gateway` condition/outcome in code or a `.bpmn` file not enumerated in §10's numbered steps.
   - **A new candidate group** — a Tasklist candidate group string not in §8's table.
   - **A new schema column or table** — a Postgres column/table used in code that isn't in §9's data model.
   - **A new job type** — a Zeebe job worker registered for a job type not in §12's table.
4. For each discrepancy found, note: what the code does, which `SPEC.md` section it should live in, and why it's missing (genuinely new behavior vs. likely a typo/rename that drifted from the spec's naming).

## Output

For each discrepancy:
- File:line reference to the code in question.
- The `SPEC.md` section and location it affects.
- A drafted exact edit (the new/changed lines, in the same style as the surrounding spec text) — precise enough to paste in, not a vague description.

Present all drafted edits together as a proposal. **Do not edit `SPEC.md`.** End by reminding the user this needs Review & Lock before anything else builds against the updated spec — consistent with how `.claude/specs/*/*.md` specs in this repo work, except this is a direct `SPEC.md` edit rather than a new spec file.
