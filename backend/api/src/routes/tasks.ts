import { Router } from "express";
import { ROLE_TO_CANDIDATE_GROUP, requireRole, STAFF_ROLES } from "../auth";
import { pool } from "../db";
import { serializeClaim } from "../serializers";
import { camundaRestClient } from "../zeebe";

export const tasksRouter = Router();

// .claude/specs/generic/auth-role-based-access.md "Task proxy endpoints" —
// backend/api holds the single Camunda `demo` credential server-side (via
// camundaRestClient, already configured for the unprotected lightweight
// stack) and proxies Tasklist actions so end users never see Camunda
// credentials at all. The app's own auth is the trust boundary; every route
// here requires a staff role.
tasksRouter.use(requireRole(...STAFF_ROLES));

// GET /api/tasks — lists open (CREATED) user tasks for the caller's
// candidate group; admin sees every group. Joined against `claims` (by
// processInstanceKey) for display context.
tasksRouter.get("/", async (req, res) => {
  const role = req.user!.role;
  const group = role === "admin" ? undefined : ROLE_TO_CANDIDATE_GROUP[role];
  if (role !== "admin" && !group) {
    return res.status(403).json({ message: "Your role has no task queue." });
  }

  try {
    const { items } = await camundaRestClient.searchUserTasks({
      filter: { state: "CREATED", ...(group ? { candidateGroup: group } : {}) },
    });

    const processInstanceKeys = items.map((t) => t.processInstanceKey);
    const claimsByInstanceKey = new Map<string, any>();
    if (processInstanceKeys.length > 0) {
      const { rows } = await pool.query(
        `SELECT * FROM claims WHERE process_instance_key = ANY($1::text[])`,
        [processInstanceKeys]
      );
      for (const row of rows) {
        claimsByInstanceKey.set(row.process_instance_key, serializeClaim(row));
      }
    }

    res.json(
      items.map((task) => ({
        taskKey: task.userTaskKey,
        name: task.name,
        elementId: task.elementId,
        candidateGroups: task.candidateGroups ?? [],
        assignee: task.assignee ?? null,
        creationDate: task.creationDate,
        claim: claimsByInstanceKey.get(task.processInstanceKey) ?? null,
      }))
    );
  } catch (err) {
    console.error("GET /api/tasks failed:", err);
    res.status(500).json({ message: "Couldn't load tasks." });
  }
});

// POST /api/tasks/:key/claim — assigns the task to the caller. Rejects if
// the task's candidate group doesn't match the caller's mapped group, even
// though GET /api/tasks already filtered what's shown (defense in depth,
// not just UI filtering).
tasksRouter.post("/:key/claim", async (req, res) => {
  const role = req.user!.role;
  const group = role === "admin" ? undefined : ROLE_TO_CANDIDATE_GROUP[role];
  if (role !== "admin" && !group) {
    return res.status(403).json({ message: "Your role has no task queue." });
  }

  try {
    const task = await camundaRestClient.getUserTask(req.params.key);
    if (group && !(task.candidateGroups ?? []).includes(group)) {
      return res.status(403).json({ message: "This task isn't in your candidate group." });
    }
    await camundaRestClient.assignUserTask({
      userTaskKey: req.params.key,
      assignee: req.user!.email,
    });
    res.status(204).send();
  } catch (err) {
    console.error("POST /api/tasks/:key/claim failed:", err);
    res.status(500).json({ message: "Couldn't claim this task." });
  }
});

// POST /api/tasks/:key/complete — forwards the same form-field payloads
// today's Camunda-rendered forms (TriageReviewForm, ReviewDecisionForm,
// ValidationExceptionReviewForm) already produce, so BPMN-side behavior is
// unchanged; the job workers downstream of each user task still write their
// own audit_log rows exactly as they do when completed via stock Tasklist.
tasksRouter.post("/:key/complete", async (req, res) => {
  const role = req.user!.role;
  const group = role === "admin" ? undefined : ROLE_TO_CANDIDATE_GROUP[role];
  if (role !== "admin" && !group) {
    return res.status(403).json({ message: "Your role has no task queue." });
  }

  try {
    const task = await camundaRestClient.getUserTask(req.params.key);
    if (group && !(task.candidateGroups ?? []).includes(group)) {
      return res.status(403).json({ message: "This task isn't in your candidate group." });
    }
    await camundaRestClient.completeUserTask({
      userTaskKey: req.params.key,
      variables: req.body?.variables ?? {},
    });
    res.status(204).send();
  } catch (err) {
    console.error("POST /api/tasks/:key/complete failed:", err);
    res.status(500).json({ message: "Couldn't complete this task." });
  }
});
