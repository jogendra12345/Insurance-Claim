---
name: case-trace
description: Merge a claim's Postgres audit_log with its Camunda process instance history into one chronological timeline, flagging any Camunda step missing a §13 audit_log row
argument-hint: "[claim-id]"
---

## What this does

Reconstructs the full case history for one claim by merging two sources: the durable `audit_log` table (`SPEC.md` §9, §13) and Camunda's own process instance history for that claim's `process_instance_key`. Per `SPEC.md` §13, "this is the durable, queryable case history that Camunda's own process history (visible in Operate) doesn't give you at the business level" — so this skill exists specifically to check that the two stay in sync, and to flag where they don't.

## Steps

1. Parse `$ARGUMENTS` as `[claim-id]` (a `claims.id` uuid). If missing, stop and ask for it.
2. Look up the claim: `SELECT * FROM claims WHERE id = '<claim-id>'` against the app Postgres (`docker compose exec -T postgres psql -U claimflow -d claimflow`, per `backend/db/run-migrations.sh`'s connection pattern) to get `process_instance_key` and basic claim context (carrier, insurance_type, status). If the claim doesn't exist, say so and stop.
3. Fetch its full `audit_log` history: `SELECT * FROM audit_log WHERE claim_id = '<claim-id>' ORDER BY created_at` — this is the SPEC.md-mandated business-level trail (§13).
4. Fetch Camunda's process instance history for that `process_instance_key`:
   - First, check for a connected MCP tool that exposes Camunda/Zeebe/Operate process instance data (search for one via tool search if unsure what's available this session) and use it if present.
   - If no such MCP tool is connected, fall back to Camunda's REST API v2 directly, per `PREREQUISITES.md`/`CLAUDE.md`: `http://localhost:8080/v2`, basic auth `demo`/`demo` (the lightweight config's only user). Query the process instance by `process_instance_key` and its flow node / job / user-task history.
   - If neither is reachable (Camunda stack not running), say so explicitly and stop rather than presenting a partial or fabricated timeline.
5. Merge both event lists into one chronological timeline by timestamp.

## Output

A single ordered, human-readable timeline. Each entry shows: timestamp, source (`audit_log` or `camunda`), actor (`actor_type`/`actor_id` for audit_log rows; the job type or user-task name for Camunda events), and what happened (`action` + `detail` for audit_log; the flow node/job outcome for Camunda).

Then, a **compliance check** against §13: for every Camunda-side step that completed (a service task's job completed, or a user task was completed), confirm there's a corresponding `audit_log` row at roughly the same point in the timeline. Flag any Camunda step with **no** matching `audit_log` row as a §13 compliance gap — name the specific step, its timestamp, and that no audit trail entry exists for it. This is a report only; it doesn't write missing audit_log rows or modify anything.
