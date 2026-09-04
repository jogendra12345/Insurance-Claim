"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, claimTask, completeTask, fetchTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ROLES } from "@/lib/types";
import type { Task } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

type LoadState = "loading" | "loaded" | "error";

// Same field sets as process/forms/{triage-review,review-decision,
// validation-exception-review}.form — completed here through the
// backend/api proxy instead of stock Camunda Tasklist. Supervisor Sign-off
// has no form (a plain confirm), so it isn't listed here.
const REVIEW_ROLES = ["adjuster", "investigator", "legal"] as const;

export default function TasksPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState("loading");
    setError(null);
    fetchTasks()
      .then((data) => {
        setTasks(data);
        setState("loaded");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load tasks.");
        setState("error");
      });
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !STAFF_ROLES.includes(user.role)) {
      router.replace("/login");
      return;
    }
    load();
  }, [authLoading, user, router, load]);

  async function handleClaim(task: Task) {
    setBusyKey(task.taskKey);
    setActionError(null);
    try {
      await claimTask(task.taskKey);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't claim this task.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleComplete(task: Task, variables: Record<string, unknown>) {
    setBusyKey(task.taskKey);
    setActionError(null);
    try {
      await completeTask(task.taskKey, variables);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't complete this task.");
    } finally {
      setBusyKey(null);
    }
  }

  if (authLoading || !user) {
    return null;
  }

  return (
    <main style={{ maxWidth: "820px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Tasks</h1>
        <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>
          Open review tasks for your role ({user.role}). Stock Tasklist at{" "}
          <a href="http://localhost:8080/tasklist" target="_blank" rel="noreferrer">
            localhost:8080/tasklist
          </a>{" "}
          still works too.
        </p>
      </div>

      {actionError && (
        <div role="alert" style={{ padding: "0.85rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {actionError}
        </div>
      )}

      {state === "loading" && <div className="skeleton" style={{ height: "200px" }} aria-busy="true" />}

      {state === "error" && (
        <div role="alert" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && tasks.length === 0 && (
        <EmptyState title="No open tasks" body="Nothing waiting in your candidate group right now." />
      )}

      {state === "loaded" &&
        tasks.map((task) => (
          <TaskCard
            key={task.taskKey}
            task={task}
            busy={busyKey === task.taskKey}
            onClaim={() => handleClaim(task)}
            onComplete={(vars) => handleComplete(task, vars)}
          />
        ))}
    </main>
  );
}

function TaskCard({
  task,
  busy,
  onClaim,
  onComplete,
}: {
  task: Task;
  busy: boolean;
  onClaim: () => void;
  onComplete: (variables: Record<string, unknown>) => void;
}) {
  return (
    <div
      className="animate-fade-in-up"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-card)",
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.85rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{task.name}</h2>
          {task.claim && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {task.claim.claimantName} — {task.claim.policyNumber} —{" "}
              {task.claim.claimAmount.toLocaleString(undefined, { style: "currency", currency: "USD" })}
            </p>
          )}
        </div>
        {task.claim && <StatusBadge status={task.claim.status} />}
      </div>

      {task.claim?.caseSummary && (
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text)" }}>{task.claim.caseSummary}</p>
      )}

      {!task.assignee ? (
        <button onClick={onClaim} disabled={busy} className="transition btn-press" style={primaryButtonStyle(busy)}>
          {busy ? "Claiming…" : "Claim task"}
        </button>
      ) : (
        <TaskForm elementId={task.elementId} busy={busy} onComplete={onComplete} />
      )}
    </div>
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
  // Adjuster / Investigator / Legal Review all share ReviewDecisionForm.
  return <ReviewDecisionForm busy={busy} onComplete={onComplete} />;
}

function TriageReviewForm({ busy, onComplete }: { busy: boolean; onComplete: (variables: Record<string, unknown>) => void }) {
  const [triageAction, setTriageAction] = useState<"review" | "reject">("review");
  const [confirmedRole, setConfirmedRole] = useState<"adjuster" | "investigator" | "legal">("adjuster");
  const [denialReason, setDenialReason] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <FormRow label="Action">
        <select value={triageAction} onChange={(e) => setTriageAction(e.target.value as typeof triageAction)} style={inputStyle}>
          <option value="review">Route for specialist review</option>
          <option value="reject">Reject claim</option>
        </select>
      </FormRow>
      {triageAction === "review" && (
        <FormRow label="Confirmed role">
          <select value={confirmedRole} onChange={(e) => setConfirmedRole(e.target.value as typeof confirmedRole)} style={inputStyle}>
            {REVIEW_ROLES.map((role) => (
              <option key={role} value={role}>
                {role[0].toUpperCase() + role.slice(1)}
              </option>
            ))}
          </select>
        </FormRow>
      )}
      {triageAction === "reject" && (
        <FormRow label="Denial reason">
          <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} style={{ ...inputStyle, minHeight: "70px" }} />
        </FormRow>
      )}
      <button
        onClick={() =>
          onComplete(
            triageAction === "review" ? { triageAction, confirmedRole } : { triageAction, denialReason }
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
      <button
        onClick={() => onComplete(decision === "deny" ? { decision, denialReason } : { decision })}
        disabled={busy || (decision === "deny" && !denialReason.trim())}
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
