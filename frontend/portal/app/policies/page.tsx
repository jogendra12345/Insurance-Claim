"use client";

import { useEffect, useState } from "react";
import { ApiError, createPolicy, deletePolicy, fetchPolicies } from "@/lib/api";
import type { NewPolicyInput, Policy, PolicyStatus } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";

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
};

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
    if (!form.policyNumber.trim() || !form.policyholderName.trim() || !form.effectiveDate || !form.expiryDate) {
      setFormError("Fill in every field.");
      return;
    }
    if (form.expiryDate < form.effectiveDate) {
      setFormError("Expiry date must be after the effective date.");
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

  async function handleDelete(policy: Policy) {
    if (!confirm(`Delete policy ${policy.policyNumber}? This can't be undone.`)) return;
    setDeletingId(policy.id);
    setDeleteError(null);
    try {
      await deletePolicy(policy.id);
      setPolicies((prev) => prev.filter((p) => p.id !== policy.id));
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Deleting the policy failed.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Policies</h1>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>{policies.length} on file.</p>
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="transition"
          style={{
            padding: "0.55rem 1.1rem",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--primary)",
            color: "var(--primary-contrast)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showAddForm ? "Close" : "+ Add policy"}
        </button>
      </header>

      {showAddForm && (
        <form
          onSubmit={handleAddPolicy}
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
          <button
            type="submit"
            disabled={saving}
            className="transition"
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
        <div role="alert" style={{ padding: "0.85rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {deleteError}
        </div>
      )}

      {state === "loading" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.85rem" }} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: "108px", borderRadius: "var(--radius-md)", background: "var(--surface-2)", animation: "pulse 1.4s ease-in-out infinite" }} />
          ))}
          <style>{`@media (prefers-reduced-motion: no-preference) { @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } } }`}</style>
        </div>
      )}

      {state === "error" && (
        <div role="alert" style={{ padding: "1rem 1.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
          {error}
        </div>
      )}

      {state === "loaded" && policies.length === 0 && (
        <EmptyState title="No policies yet" body="Add a policy to get started." />
      )}

      {state === "loaded" && policies.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.85rem" }}>
          {policies.map((policy) => {
            const tone = STATUS_TONE[policy.status];
            return (
              <div
                key={policy.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-card)",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{policy.policyNumber}</span>
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
                </div>
                <span style={{ fontSize: "0.88rem", color: "var(--text-muted)" }}>{policy.policyholderName}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  {new Date(policy.effectiveDate).toLocaleDateString()} – {new Date(policy.expiryDate).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleDelete(policy)}
                  disabled={deletingId === policy.id}
                  className="transition"
                  style={{
                    alignSelf: "flex-start",
                    marginTop: "0.25rem",
                    border: "none",
                    background: "none",
                    color: "var(--danger-fg)",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: deletingId === policy.id ? "default" : "pointer",
                    padding: 0,
                  }}
                >
                  {deletingId === policy.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </main>
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
