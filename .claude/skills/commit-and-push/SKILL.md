---
name: commit-and-push
description: Stage the relevant changes, commit with a message describing the why, and push to origin/main — this repo commits directly to main, no per-feature branches
argument-hint: "[optional note on what to commit / commit message hint]"
---

## What this does

Commits the current changes and pushes them to `origin/main` in one step. This repo does not use per-feature branches — work lands on `main` directly (see project memory `feedback_no_per_feature_branches`), so this skill never creates or switches branches; it only ever commits and pushes to whatever branch is currently checked out (expected to be `main`).

## Steps

1. Run `git status` and `git diff` / `git diff --staged` to see everything changed, and `git log -5 --oneline` to match this repo's commit message style.
2. Confirm the current branch is `main` (or ask the user if it isn't — this skill assumes the no-feature-branch convention holds).
3. Stage files explicitly by name, never `git add -A` / `git add .` — if `$ARGUMENTS` names specific files/paths, stage only those; otherwise stage everything currently modified/untracked that isn't obviously scratch/local-only (e.g. `.env`, `node_modules`, editor state). Before staging, glance at any file whose name suggests it could hold secrets or credentials and confirm it's safe to include.
4. Re-check `git status` after staging to confirm exactly the intended files are staged — nothing more.
5. Draft a commit message: 1-2 sentences focused on *why*, not a restatement of the diff. Use `$ARGUMENTS` as a hint for intent if provided. Pass it via a heredoc (`git commit -m "$(cat <<'EOF' ... EOF)"`), and end it with the attribution line this session's system reminder specifies (currently `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`) — use whatever that reminder says at run time, since it can change.
6. Commit. If a pre-commit hook fails, fix the underlying issue, re-stage, and make a **new** commit — never `--amend`, never `--no-verify`.
7. Push: `git push` (or `git push -u origin main` if there's no upstream yet). Never force-push as part of this skill — if a push is rejected (e.g. non-fast-forward), stop and tell the user rather than force-pushing over remote history.
8. Report the resulting commit hash and confirm the push succeeded (or explain why it didn't).

## What this skill will never do

- Never create, switch, or delete branches.
- Never use `git add -A`/`git add .` — always explicit paths.
- Never `--amend` a commit that's already been pushed, or use `--no-verify`/`--no-gpg-sign`.
- Never force-push.
- Never commit a file that looks like it holds a secret without flagging it to the user first.
