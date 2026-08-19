---
description: Generate a new Draft spec (db, bpmn, dmn, worker, insurance-type, api, or generic) following this repo's Draft → Review & Lock → Build lifecycle, then branch and commit it per the project's branch-per-spec convention
argument-hint: [type] [name]
---

## Git behavior (not silent)

After the spec file is written, this command also creates/switches to a branch named `spec/<type>-<name>`, commits the new spec file there with the message `Draft spec: <type>/<name>`, and asks before pushing. It never touches unrelated changes, never pushes without explicit yes/no confirmation, and never opens a pull request — a PR only makes sense once the spec moves from Draft to Locked, which is a separate manual step. See "Git operations" below for the exact sequence.

## Inputs

Parse `$ARGUMENTS` as `[type] [name]`.

- Valid `type` values: `db`, `bpmn`, `dmn`, `worker`, `insurance-type`, `api`, `generic`.
- `name` is the table, process, DMN table, job type, insurance type, or feature being spec'd — required. If missing, stop and ask for it.
- If `type` is omitted, infer the most likely type from `name` and any surrounding context in the request. State the inferred type explicitly, in bold, at the very top of the generated file, above the H1 — e.g. `> Inferred type: **db** (no type given; "claim_notes" reads as a new table)`. Do not guess silently.
- If `type` is given but isn't one of the valid values, stop and ask for clarification rather than falling back to `generic`.

## Before writing anything

1. Read `SPEC.md` in full. It is the source of truth for naming, section structure, and style — this command must match its conventions, not invent new ones. Section numbers below (§8 data model, §9 BPMN, §10 DMN, §11 job workers, §3 case-management/extension pattern) are current as of this writing; if `SPEC.md` has been renumbered, locate the equivalent section by its heading text rather than trusting the stale number.
2. Look for existing specs of the same `type` under `.claude/specs/<type>/*.md` and skim them for established naming/section patterns to stay consistent with. It's fine if none exist yet.
3. For `db`, `bpmn`, `dmn`, and `worker` types, check whether `name` refers to something that already exists and is locked/applied rather than new:
   - `db`: does a migration for this table already exist under `backend/db/migrations/`, or is it already in `SPEC.md` §8's data model as shipped?
   - `bpmn`: does `process/claim-case-process.bpmn` (or another deployed process file) already define this process?
   - `dmn`: does a deployed `.dmn` file under `process/` already define this table?
   - `worker`: is this job type already implemented under `backend/workers/`?

   If the request is to **modify** something that already exists and is applied/deployed, **stop and do not generate a spec.** Flag it plainly: name the existing file(s), explain that altering a locked/applied artifact needs manual review (a migration can't be edited after it's applied; a deployed BPMN/DMN change needs a deploy plan), and suggest the user handle it directly or explicitly confirm they want a *new* spec describing the change as a follow-on migration/process-version instead of editing history in place. Do not write a file in this case.

   If `name` is new (no existing locked artifact), proceed normally.

## Output location and status

- Write to `.claude/specs/<type>/<name>.md`. Create the `.claude/specs/<type>/` folder if it doesn't exist.
- If `.claude/specs/<type>/<name>.md` already exists, stop and ask whether to overwrite, version it (`<name>-v2.md`), or abort — don't silently clobber an existing draft.
- The file must open with a status line: `**Status:** Draft` directly under the H1 title. This command only ever produces Draft specs — it never writes Review, Locked, or Built status, and it never edits the lifecycle status of an existing spec.
- This command writes documentation only. Never create or edit `.sql`, `.bpmn`, `.dmn`, or any application code file, even as a "preview" — describe the intended structure in prose/markdown tables only.

## Spec structure by type

Match `SPEC.md`'s actual current section for each type — use the structure below as the shape, but pull real field names/style from `SPEC.md` and sibling specs rather than copying this verbatim.

**db** (mirrors SPEC.md's data-model section, e.g. §8):
- Purpose
- Columns — table with name / type / nullable / default
- Constraints
- Relationships — foreign keys and cascade behavior
- Indexes — one line each stating the reason for the index
- Migration — the next sequential filename this would map to in `backend/db/migrations/` (check existing filenames there to pick the next number; state the convention you inferred)

**bpmn** (mirrors SPEC.md's process section, e.g. §9):
- Trigger / start event
- Numbered steps, each with task type (service / user / gateway) and, for user tasks, candidate group
- Which job types (workers) and DMN tables each step calls

**dmn** (mirrors SPEC.md's DMN section, e.g. §10):
- Table name
- Hit policy
- Inputs / outputs
- Rule set as a markdown table

**worker** (mirrors SPEC.md's job workers section, e.g. §11):
- Job type name
- Input variables
- What it does
- Output variables
- Whether it's AI-backed, and whether it's insurance-type-aware

**insurance-type** (mirrors SPEC.md's extension pattern, e.g. §3):
- Required fields specific to this insurance type
- Expected document types
- Where the DMN table and config module for this type will live

**api**:
- Purpose
- Endpoint + method
- Request shape
- Response shape
- Which process instance(s) or table(s) it touches

**generic** (anything that doesn't fit the above):
- Purpose
- Scope
- Design
- Open Questions

## Git operations

Run these only after the spec file has been successfully written to disk. Use the exact branch name `spec/<type>-<name>` (hyphen between type and name, e.g. `spec/db-add_carrier_config_table`) and the exact commit message `Draft spec: <type>/<name>` (slash between type and name).

1. **Check status first.** Run `git status`. If there are uncommitted changes to files *other than* the spec file just written, stop here, warn the user which files are dirty, and do not proceed to branch/commit — let them stash or commit those separately first.
2. **Branch.** Check whether `spec/<type>-<name>` already exists (locally or on the remote). If it exists, switch to it (`git checkout spec/<type>-<name>`). If it doesn't, create it off the current branch (`git checkout -b spec/<type>-<name>`).
3. **Stage only the new spec.** `git add .claude/specs/<type>/<name>.md` — never `git add -A` or `git add .` here, even if other dirty files were already ruled out in step 1.
4. **Commit.** `git commit -m "Draft spec: <type>/<name>"`.
5. **Ask before pushing.** Explicitly ask the user yes/no whether to push now. Only on "yes", run `git push -u origin spec/<type>-<name>`. Never push automatically or infer consent.
6. **No PR.** Do not run `gh pr create` or open a pull request at this stage under any circumstance — that happens only after a separate, manual Draft → Locked transition.

## After writing

Report back: the file path written, the inferred type if one was inferred, the branch it was committed to, and a one-line reminder that this is a Draft — it needs Review & Lock before anything builds against it (and before a PR is opened).
