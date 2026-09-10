import "dotenv/config";
import { zeebeClient } from "../shared/zeebe-client";
import { pool } from "../shared/db";
import { writeAuditLog } from "../shared/audit-log";
import { notifyRole } from "../shared/reviewer-notifications";
import { computeBusinessDeadline } from "../shared/business-days";

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
  triageNote?: string;
}

const VALID_ROLES = ["adjuster", "investigator", "legal"];

// confirmedRole values ("legal") aren't the same strings as users.role
// ("legal-reviewer") — .claude/specs/generic/reviewer-task-notification-emails.md.
const CONFIRMED_ROLE_TO_USER_ROLE: Record<string, string> = {
  adjuster: "adjuster",
  investigator: "investigator",
  legal: "legal-reviewer",
};
const CONFIRMED_ROLE_TO_TASK_LABEL: Record<string, string> = {
  adjuster: "Adjuster Review",
  investigator: "Investigator Review",
  legal: "Legal Review",
};

const JOB_TYPE = "capture-triage-review";

interface CaptureTriageReviewOutput {
  decision?: "deny";
  slaDeadline?: string;
}

zeebeClient.createWorker<CaptureTriageReviewVariables, Record<string, unknown>, CaptureTriageReviewOutput>({
  taskType: JOB_TYPE,
  taskHandler: async (job) => {
    const { claimId, triageAction, confirmedRole, assignedRole, denialReason, triageNote } = job.variables;

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

      // draft-denial-letter (§10 step 16, reached directly from this
      // branch — see Gateway_TriageDecision) and notify-claimant/close-case
      // downstream of it all take `decision` as a process-variable input,
      // matching capture-review-decision's deny path. Without setting it
      // here explicitly, `decision` is simply never defined on this branch
      // of the process instance, since the Triage Review form only produces
      // triageAction/confirmedRole/denialReason, not decision.
      return job.complete({ decision: "deny" });
    }

    if (!confirmedRole || !VALID_ROLES.includes(confirmedRole)) {
      throw new Error(
        `capture-triage-review: confirmedRole must be one of ${VALID_ROLES.join(", ")} when routing for review, got ${JSON.stringify(confirmedRole)}`
      );
    }

    await pool.query(
      `UPDATE claims SET confirmed_role = $1, triage_note = $2, status = 'in_review', updated_at = now() WHERE id = $3`,
      [confirmedRole, triageNote || null, claimId]
    );

    const { notifiedCount: reviewersNotified } = await notifyRole(
      CONFIRMED_ROLE_TO_USER_ROLE[confirmedRole],
      claimId,
      CONFIRMED_ROLE_TO_TASK_LABEL[confirmedRole]
    );

    // .claude/specs/generic/sla-review-escalation.md — the role-specific
    // review this opens (Adjuster/Investigator/Legal Review) has its own
    // interrupting timer boundary event reading this via a `timeDate` FEEL
    // expression; auto-escalate-review fires if nobody completes it in time.
    const slaDeadline = computeBusinessDeadline(new Date()).toISOString();

    await writeAuditLog({
      claimId,
      actorType: "human",
      actorId: "tasklist",
      action: "triage_confirmed",
      detail: {
        confirmedRole,
        assignedRole,
        overridden: confirmedRole !== assignedRole,
        reviewersNotified,
        slaDeadline,
        ...(triageNote ? { triageNote } : {}),
      },
    });

    return job.complete({ slaDeadline });
  },
});

console.log(`${JOB_TYPE} worker started, polling for jobs`);
