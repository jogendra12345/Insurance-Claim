"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, fetchTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { STAFF_ROLES } from "@/lib/types";
import type { Task } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";

type LoadState = "loading" | "loaded" | "error";

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** First sentence (or ~140 chars) of the AI case summary, for the grid row. Full text is on the summary page. */
function shortDescription(task: Task): string {
  const text = task.claim?.caseSummary ?? task.claim?.incidentDescription ?? "";
  if (!text) return "—";
  const firstSentence = text.split(/(?<=[.!?])\s/)[0];
  const base = firstSentence.length <= 140 ? firstSentence : text;
  return base.length > 140 ? `${base.slice(0, 140).trimEnd()}…` : base;
}

export default function TasksPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

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

  if (authLoading || !user) {
    return null;
  }

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
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

      {state === "loading" && <div className="skeleton" style={{ height: "260px" }} aria-busy="true" />}

      {state === "error" && (
        <div role="alert" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && tasks.length === 0 && (
        <EmptyState title="No open tasks" body="Nothing waiting in your candidate group right now." />
      )}

      {state === "loaded" && tasks.length > 0 && (
        <div
          className="animate-fade-in-up"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-card)",
            overflowX: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th>Policy no.</Th>
                <Th>Name</Th>
                <Th align="right">Amount</Th>
                <Th>Description</Th>
              </tr>
            </thead>
            <tbody className="stagger-list">
              {tasks.map((task) => {
                const goTo = () => router.push(`/tasks/${task.taskKey}`);
                return (
                  <tr
                    key={task.taskKey}
                    onClick={goTo}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") goTo();
                    }}
                    role="link"
                    tabIndex={0}
                    className="transition row-hover"
                    style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  >
                    <Td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {task.claim?.policyNumber ?? "—"}
                        </span>
                        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{task.name}</span>
                      </div>
                    </Td>
                    <Td>
                      {task.claim?.claimantName ?? "—"}
                      {task.assignee && (
                        <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          Claimed by {task.assignee === user.email ? "you" : task.assignee}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {task.claim ? currency(task.claim.claimAmount) : "—"}
                      </span>
                    </Td>
                    <Td muted>{shortDescription(task)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "0.75rem 1rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align, muted }: { children: React.ReactNode; align?: "right"; muted?: boolean }) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "0.75rem 1rem",
        color: muted ? "var(--text-muted)" : "var(--text)",
        maxWidth: "320px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
