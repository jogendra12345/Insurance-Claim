import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";

// SPEC.md §12 — capture-triage-review. Bridges Triage Review's output onto
// `claims` — a human (Tasklist) completion has no way to write to Postgres
// on its own, so this service task runs right after it. Triage Review has
// two outcomes (TriageReviewForm's `triageAction`):
//   - "review": the normal path — sets `confirmedRole`, continues to
//     role-specific review.
//   - "reject": the triage reviewer rejects the claim outright (an
//     obviously invalid/fraudulent claim doesn't need a full role-specific
//     review to deny) — sets `decision`/`denial_reason`/`status` the same
//     way capture-review-decision does for a "deny" outcome, and the BPMN's
//     Gateway_TriageDecision routes straight to the existing denial path
//     (draft-denial-letter) instead of Gateway_RouteByConfirmedRole.
interface CaptureTriageReviewVariables {
  claimId: string;
  triageAction: "review" | "reject";
  confirmedRole?: string;
  assignedRole: string;
  denialReason?: string;
}

const VALID_ROLES = ["adjuster", "investigator", "legal"];

const JOB_TYPE = "capture-triage-review";

zeebeClient.createWorker<CaptureTriageReviewVariables, Record<string, unknown>, Record<string, never>>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, triageAction, confirmedRole, assignedRole, denialReason } = job.variables;

    if (triageAction === "reject") {
      // The form requires denialReason when rejecting, but form-js can't
      // express "required only when triageAction=reject" as a static rule
      // any more precisely than a conditional hide — fail loudly here too
      // rather than writing an incomplete row (same pattern as
      // capture-review-decision's deny branch).
      if (!denialReason) {
        throw new Error("capture-triage-review: denialReason is required when triageAction is 'reject'");
      }

      await pool.query(
        `UPDATE claims SET decision = 'deny', denial_reason = $1, status = 'denied', updated_at = now() WHERE id = $2`,
        [denialReason, claimId]
      );

      await writeAuditLog({
        claimId,
        actorType: "human",
        actorId: "tasklist",
        action: "rejected_at_triage",
        detail: { denialReason, assignedRole },
      });

      return job.complete({});
    }

    if (!confirmedRole || !VALID_ROLES.includes(confirmedRole)) {
      throw new Error(
        `capture-triage-review: confirmedRole must be one of ${VALID_ROLES.join(", ")} when routing for review, got ${JSON.stringify(confirmedRole)}`
      );
    }

    await pool.query(
      `UPDATE claims SET confirmed_role = $1, status = 'in_review', updated_at = now() WHERE id = $2`,
      [confirmedRole, claimId]
    );

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "triage_confirmed",
      detail: { confirmedRole, assignedRole, overridden: confirmedRole !== assignedRole },
    });

    return job.complete({});
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
