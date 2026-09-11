"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiError, claimTask, completeTask, fetchClaim, fetchTask, unclaimTask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ROLES } from "@/lib/types";
import type { Claim, Task } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

type LoadState = "loading" | "loaded" | "error";

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

function fileNameFromUrl(url: string): string {
  const decoded = decodeURIComponent(url.split("/").pop() ?? url);
  // Uploaded object keys are prefixed "<timestamp>-<originalname>" — strip that for display.
  return decoded.replace(/^\d+-/, "");
}

function isImage(url: string): boolean {
  const lower = url.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isPdf(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf");
}

// Same field sets as process/forms/{triage-review,review-decision,
// validation-exception-review}.form — completed here through the
// backend/api proxy instead of stock Camunda Tasklist. Supervisor Sign-off
// has no form (a plain confirm). Supervisor Review (the SLA-escalation
// fallback when Legal Review times out — generic/sla-review-escalation.md)
// shares ReviewDecisionForm with Adjuster/Investigator/Legal Review, same as
// every other role review, so it falls through TaskForm's default case below
// rather than needing its own branch.
const REVIEW_ROLES = ["adjuster", "investigator", "legal"] as const;

export default function TaskDetailPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [documents, setDocuments] = useState<Claim["documents"]>(undefined);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState("loading");
    setError(null);
    fetchTask(params.key)
      .then((data) => {
        setTask(data);
        setState("loaded");
        // The task list/detail endpoints join `claims` for display context
        // but don't carry documents — fetch those separately from the full
        // claim detail (GET /api/claims/:id), same source the claimant-
        // facing claim page uses.
        if (data.claim) {
          fetchClaim(data.claim.id)
            .then((full) => setDocuments(full.documents))
            .catch(() => setDocuments(undefined));
        }
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load this task.");
        setState("error");
      });
  }, [params.key]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !STAFF_ROLES.includes(user.role)) {
      router.replace("/login");
      return;
    }
    load();
  }, [authLoading, user, router, load]);

  // Update task state directly from the action's own success, rather than
  // re-fetching GET /api/tasks/:key right after — Camunda's Tasklist search/
  // read model can lag a beat behind a just-completed assign/unassign
  // command, so an immediate re-fetch can show the pre-action state even
  // though the write already succeeded (confirmed against Camunda directly
  // during testing: the command returns 204, but the very next search can
  // still show the old assignee for a moment).
  async function handleClaim() {
    setBusy(true);
    setActionError(null);
    try {
      await claimTask(params.key);
      setTask((t) => (t ? { ...t, assignee: user!.email } : t));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't claim this task.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnclaim() {
    setBusy(true);
    setActionError(null);
    try {
      await unclaimTask(params.key);
      setTask((t) => (t ? { ...t, assignee: null } : t));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't unclaim this task.");
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete(variables: Record<string, unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await completeTask(params.key, variables);
      router.push("/tasks");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't complete this task.");
      setBusy(false);
    }
  }

  if (authLoading || !user) {
    return null;
  }

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <a href="/tasks" className="transition" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>
        ← Back to tasks
      </a>

      {state === "loading" && <div className="skeleton" style={{ height: "280px" }} aria-busy="true" />}

      {state === "error" && (
        <div role="alert" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && task && (
        <div className="animate-fade-in-up" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: "1.6rem" }}>{task.name}</h1>
              {task.claim && (
                <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>
                  {task.claim.policyNumber} · {task.claim.claimantName} · {currency(task.claim.claimAmount)}
                </p>
              )}
            </div>
            {task.claim && <StatusBadge status={task.claim.status} />}
          </div>

          {task.claim && (
            <Section title="Case summary">
              {task.claim.caseSummary && <p style={{ margin: "0 0 0.75rem" }}>{task.claim.caseSummary}</p>}
              <DetailRow label="Incident" value={task.claim.incidentDescription} />
              <DetailRow label="Risk score" value={task.claim.riskScore !== null ? `${task.claim.riskScore} / 100` : "—"} />
              <DetailRow label="Fraud indicators" value={String(task.claim.fraudIndicatorCount)} />
              <DetailRow label="AI-suggested role" value={task.claim.assignedRole ?? "—"} />
              {task.claim.triageNote && (
                <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.25rem" }}>
                    Note from triage
                  </div>
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>{task.claim.triageNote}</p>
                </div>
              )}
            </Section>
          )}

          {task.claim && (
            <Section title={`Documents (${documents?.length ?? 0})`}>
              {!documents || documents.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-muted)" }}>No documents attached.</p>
              ) : (
                <div className="stagger-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        padding: "0.75rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "0.85rem", fontWeight: 600, wordBreak: "break-all" }}
                      >
                        {fileNameFromUrl(doc.fileUrl)}
                      </a>
                      {isImage(doc.fileUrl) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={doc.fileUrl}
                          alt={fileNameFromUrl(doc.fileUrl)}
                          style={{ maxWidth: "100%", maxHeight: "320px", borderRadius: "var(--radius-sm)", objectFit: "contain" }}
                        />
                      ) : isPdf(doc.fileUrl) ? (
                        <iframe
                          src={doc.fileUrl}
                          title={fileNameFromUrl(doc.fileUrl)}
                          style={{ width: "100%", height: "320px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {actionError && (
            <div role="alert" style={{ padding: "0.85rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
              {actionError}
            </div>
          )}

          <Section title="Review">
            {!task.assignee ? (
              <button onClick={handleClaim} disabled={busy} className="transition btn-press" style={primaryButtonStyle(busy)}>
                {busy ? "Claiming…" : "Claim task"}
              </button>
            ) : task.assignee !== user.email && user.role !== "admin" ? (
              <p style={{ margin: 0, color: "var(--text-muted)" }}>Claimed by {task.assignee} — only they can act on it.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    Claimed by {task.assignee === user.email ? "you" : task.assignee}
                  </span>
                  <button onClick={handleUnclaim} disabled={busy} className="transition btn-press" style={secondaryButtonStyle(busy)}>
                    {busy ? "…" : "Unclaim"}
                  </button>
                </div>
                <TaskForm elementId={task.elementId} busy={busy} onComplete={handleComplete} />
              </div>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}

function TaskForm({
  elementId,
  busy,
  onComplete,
}: {
  elementId: string;
  busy: boolean;
  onComplete: (variables: Record<string, unknown>) => void;
}) {
  if (elementId === "Task_TriageReview") return <TriageReviewForm busy={busy} onComplete={onComplete} />;
  if (elementId === "Task_ValidationExceptionReview")
    return <ValidationExceptionForm busy={busy} onComplete={onComplete} />;
  if (elementId === "Task_SupervisorSignoff") {
    return (
      <button onClick={() => onComplete({})} disabled={busy} className="transition btn-press" style={primaryButtonStyle(busy)}>
        {busy ? "Signing off…" : "Sign off"}
      </button>
    );
  }
  // Adjuster / Investigator / Legal / Supervisor Review all share ReviewDecisionForm.
  return <ReviewDecisionForm busy={busy} onComplete={onComplete} />;
}

function TriageReviewForm({ busy, onComplete }: { busy: boolean; onComplete: (variables: Record<string, unknown>) => void }) {
  const [triageAction, setTriageAction] = useState<"review" | "reject">("review");
  const [confirmedRole, setConfirmedRole] = useState<"adjuster" | "investigator" | "legal">("adjuster");
  const [denialReason, setDenialReason] = useState("");
  const [triageNote, setTriageNote] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <FormRow label="Action">
        <select value={triageAction} onChange={(e) => setTriageAction(e.target.value as typeof triageAction)} style={inputStyle}>
          <option value="review">Route for specialist review</option>
          <option value="reject">Reject claim</option>
        </select>
      </FormRow>
      {triageAction === "review" && (
        <>
          <FormRow label="Confirmed role">
            <select value={confirmedRole} onChange={(e) => setConfirmedRole(e.target.value as typeof confirmedRole)} style={inputStyle}>
              {REVIEW_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role[0].toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Note for reviewer (optional)">
            <textarea
              value={triageNote}
              onChange={(e) => setTriageNote(e.target.value)}
              placeholder="Anything the adjuster/investigator/legal reviewer should know before they pick this up."
              style={{ ...inputStyle, minHeight: "70px" }}
            />
          </FormRow>
        </>
      )}
      {triageAction === "reject" && (
        <FormRow label="Denial reason">
          <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} style={{ ...inputStyle, minHeight: "70px" }} />
        </FormRow>
      )}
      <button
        onClick={() =>
          onComplete(
            triageAction === "review"
              ? { triageAction, confirmedRole, ...(triageNote.trim() ? { triageNote: triageNote.trim() } : {}) }
              : { triageAction, denialReason }
          )
        }
        disabled={busy || (triageAction === "reject" && !denialReason.trim())}
        className="transition btn-press"
        style={primaryButtonStyle(busy)}
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

function ReviewDecisionForm({ busy, onComplete }: { busy: boolean; onComplete: (variables: Record<string, unknown>) => void }) {
  const [decision, setDecision] = useState<"approve" | "deny" | "moreInfo">("approve");
  const [denialReason, setDenialReason] = useState("");
  const [infoRequestedReason, setInfoRequestedReason] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <FormRow label="Decision">
        <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} style={inputStyle}>
          <option value="approve">Approve</option>
          <option value="deny">Deny</option>
          <option value="moreInfo">More info needed</option>
        </select>
      </FormRow>
      {decision === "deny" && (
        <FormRow label="Denial reason">
          <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} style={{ ...inputStyle, minHeight: "70px" }} />
        </FormRow>
      )}
      {decision === "moreInfo" && (
        <FormRow label="Reason more info is needed">
          <textarea
            value={infoRequestedReason}
            onChange={(e) => setInfoRequestedReason(e.target.value)}
            placeholder="What does the claimant need to provide before this can move forward?"
            style={{ ...inputStyle, minHeight: "70px" }}
          />
        </FormRow>
      )}
      <button
        onClick={() =>
          onComplete(
            decision === "deny"
              ? { decision, denialReason }
              : decision === "moreInfo"
                ? { decision, infoRequestedReason }
                : { decision }
          )
        }
        disabled={
          busy ||
          (decision === "deny" && !denialReason.trim()) ||
          (decision === "moreInfo" && !infoRequestedReason.trim())
        }
        className="transition btn-press"
        style={primaryButtonStyle(busy)}
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

function ValidationExceptionForm({ busy, onComplete }: { busy: boolean; onComplete: (variables: Record<string, unknown>) => void }) {
  const [resolutionAction, setResolutionAction] = useState<"resolve" | "reject">("resolve");
  const [denialReason, setDenialReason] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <FormRow label="Resolution">
        <select value={resolutionAction} onChange={(e) => setResolutionAction(e.target.value as typeof resolutionAction)} style={inputStyle}>
          <option value="resolve">Approve — continue with this claim as submitted</option>
          <option value="reject">Reject claim</option>
        </select>
      </FormRow>
      {resolutionAction === "reject" && (
        <FormRow label="Denial reason">
          <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} style={{ ...inputStyle, minHeight: "70px" }} />
        </FormRow>
      )}
      <button
        onClick={() => onComplete(resolutionAction === "reject" ? { resolutionAction, denialReason } : { resolutionAction })}
        disabled={busy || (resolutionAction === "reject" && !denialReason.trim())}
        className="transition btn-press"
        style={primaryButtonStyle(busy)}
      >
        {busy ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "0.75rem 1.25rem", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{ padding: "1.1rem 1.25rem" }}>{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", fontSize: "0.9rem", padding: "0.35rem 0" }}>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.55rem 0.7rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  width: "100%",
};

const primaryButtonStyle = (busy: boolean): React.CSSProperties => ({
  alignSelf: "flex-start",
  padding: "0.6rem 1.1rem",
  borderRadius: "var(--radius-sm)",
  border: "none",
  background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
  color: "var(--primary-contrast)",
  fontWeight: 600,
  cursor: busy ? "default" : "pointer",
  opacity: busy ? 0.7 : 1,
});

const secondaryButtonStyle = (busy: boolean): React.CSSProperties => ({
  padding: "0.4rem 0.85rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: busy ? "default" : "pointer",
  opacity: busy ? 0.7 : 1,
});
