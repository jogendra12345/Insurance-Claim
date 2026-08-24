"use client";

import { useEffect, useState } from "react";
import { ApiError, createPolicy, deletePolicy, fetchPolicies } from "@/lib/api";
import type { NewPolicyInput, Policy, PolicyStatus } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type LoadState = "loading" | "loaded" | "error";

const STATUS_TONE: Record<PolicyStatus, { bg: string; fg: string }> = {
  active: { bg: "var(--status-good-bg)", fg: "var(--status-good-fg)" },
  lapsed: { bg: "var(--status-attention-bg)", fg: "var(--status-attention-fg)" },
  cancelled: { bg: "var(--status-bad-bg)", fg: "var(--status-bad-fg)" },
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm: NewPolicyInput = {
  policyNumber: "",
  policyholderName: "",
  status: "active",
  effectiveDate: todayIso(),
  expiryDate: "",
  premiumAmount: "",
  coverageAmount: "",
};

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<NewPolicyInput>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Policy | null>(null);

  function load() {
    setState("loading");
    setError(null);
    fetchPolicies()
      .then((data) => {
        setPolicies(data);
        setState("loaded");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Couldn't load policies.");
        setState("error");
      });
  }

  useEffect(load, []);

  async function handleAddPolicy(e: React.FormEvent) {
    e.preventDefault();
    if (
      !form.policyNumber.trim() ||
      !form.policyholderName.trim() ||
      !form.effectiveDate ||
      !form.expiryDate ||
      !form.premiumAmount ||
      !form.coverageAmount
    ) {
      setFormError("Fill in every field.");
      return;
    }
    if (form.expiryDate < form.effectiveDate) {
      setFormError("Expiry date must be after the effective date.");
      return;
    }
    const premium = Number(form.premiumAmount);
    const coverage = Number(form.coverageAmount);
    if (Number.isNaN(premium) || premium < 0) {
      setFormError("Premium amount must be 0 or greater.");
      return;
    }
    if (Number.isNaN(coverage) || coverage <= 0) {
      setFormError("Coverage amount must be greater than 0.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPolicy(form);
      setForm(emptyForm);
      setShowAddForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Adding the policy failed.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const policy = pendingDelete;
    setDeletingId(policy.id);
    setDeleteError(null);
    try {
      await deletePolicy(policy.id);
      setPolicies((prev) => prev.filter((p) => p.id !== policy.id));
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Deleting the policy failed.");
      setPendingDelete(null);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <header
        className="animate-fade-in-up"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Policies</h1>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>{policies.length} on file.</p>
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="transition btn-press"
          style={{
            padding: "0.55rem 1.1rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "linear-gradient(135deg, var(--primary), var(--primary-hover))",
            color: "var(--primary-contrast)",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 10px var(--primary-glow)",
          }}
        >
          {showAddForm ? "Close" : "+ Add policy"}
        </button>
      </header>

      {showAddForm && (
        <form
          onSubmit={handleAddPolicy}
          className="animate-scale-in"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-card)",
            padding: "1.25rem 1.5rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1rem",
            alignItems: "end",
          }}
        >
          <FormField label="Policy number">
            <input
              value={form.policyNumber}
              onChange={(e) => setForm((f) => ({ ...f, policyNumber: e.target.value }))}
              placeholder="POL-100011"
              style={inputStyle}
            />
          </FormField>
          <FormField label="Policyholder name">
            <input
              value={form.policyholderName}
              onChange={(e) => setForm((f) => ({ ...f, policyholderName: e.target.value }))}
              placeholder="Jane Doe"
              style={inputStyle}
            />
          </FormField>
          <FormField label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PolicyStatus }))}
              style={inputStyle}
            >
              <option value="active">Active</option>
              <option value="lapsed">Lapsed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </FormField>
          <FormField label="Effective date">
            <input
              type="date"
              value={form.effectiveDate}
              onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
              style={inputStyle}
            />
          </FormField>
          <FormField label="Expiry date">
            <input
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
              style={inputStyle}
            />
          </FormField>
          <FormField label="Premium amount (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.premiumAmount}
              onChange={(e) => setForm((f) => ({ ...f, premiumAmount: e.target.value }))}
              placeholder="0.00"
              style={inputStyle}
            />
          </FormField>
          <FormField label="Coverage amount (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.coverageAmount}
              onChange={(e) => setForm((f) => ({ ...f, coverageAmount: e.target.value }))}
              placeholder="0.00"
              style={inputStyle}
            />
          </FormField>
          <button
            type="submit"
            disabled={saving}
            className="transition btn-press"
            style={{
              padding: "0.65rem 1.1rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: "var(--primary)",
              color: "var(--primary-contrast)",
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.7 : 1,
              height: "fit-content",
            }}
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
          {formError && (
            <div role="alert" style={{ gridColumn: "1 / -1", fontSize: "0.85rem", color: "var(--danger-fg)" }}>
              {formError}
            </div>
          )}
        </form>
      )}

      {deleteError && (
        <div role="alert" className="animate-fade-in-up" style={{ padding: "0.85rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {deleteError}
        </div>
      )}

      {state === "loading" && <div className="skeleton" style={{ height: "260px" }} aria-busy="true" />}

      {state === "error" && (
        <div role="alert" className="animate-fade-in-up" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && policies.length === 0 && (
        <EmptyState title="No policies yet" body="Add a policy to get started." />
      )}

      {state === "loaded" && policies.length > 0 && (
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
                <Th>Policy number</Th>
                <Th>Policyholder</Th>
                <Th>Status</Th>
                <Th>Effective</Th>
                <Th>Expiry</Th>
                <Th align="right">Premium</Th>
                <Th align="right">Coverage</Th>
                <Th align="right">
                  <span style={{ visibility: "hidden" }}>Delete</span>
                </Th>
              </tr>
            </thead>
            <tbody className="stagger-list">
              {policies.map((policy) => {
                const tone = STATUS_TONE[policy.status];
                return (
                  <tr key={policy.id} className="row-hover transition" style={{ borderBottom: "1px solid var(--border)" }}>
                    <Td>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{policy.policyNumber}</span>
                    </Td>
                    <Td>{policy.policyholderName}</Td>
                    <Td>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          padding: "0.15em 0.6em",
                          borderRadius: "999px",
                          background: tone.bg,
                          color: tone.fg,
                          textTransform: "capitalize",
                        }}
                      >
                        {policy.status}
                      </span>
                    </Td>
                    <Td muted>{new Date(policy.effectiveDate).toLocaleDateString()}</Td>
                    <Td muted>{new Date(policy.expiryDate).toLocaleDateString()}</Td>
                    <Td align="right">{currency(policy.premiumAmount)}</Td>
                    <Td align="right">{currency(policy.coverageAmount)}</Td>
                    <Td align="right">
                      <button
                        onClick={() => setPendingDelete(policy)}
                        disabled={deletingId === policy.id}
                        aria-label={`Delete policy ${policy.policyNumber}`}
                        className="transition btn-press"
                        style={{
                          border: "none",
                          background: "var(--surface-2)",
                          color: "var(--text-muted)",
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          cursor: deletingId === policy.id ? "default" : "pointer",
                          fontSize: "0.9rem",
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this policy?"
        body={
          pendingDelete
            ? `${pendingDelete.policyNumber} (${pendingDelete.policyholderName}) will be permanently deleted. This can't be undone. If any claim still references it, the delete will be blocked.`
            : ""
        }
        confirmLabel="Delete policy"
        busy={deletingId === pendingDelete?.id}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
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
      }}
    >
      {children}
    </td>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
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
