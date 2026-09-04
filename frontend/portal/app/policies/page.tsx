"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createPolicy, deletePolicy, fetchPolicies } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DependentRelationship, NewDependentInput, NewPolicyInput, Policy, PolicyStatus } from "@/lib/types";
import { STATUS_TONE } from "@/lib/policy-status";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ShieldCheckIllustration, IdCardIllustration } from "@/components/HeroIllustrations";
import { Pagination } from "@/components/Pagination";

const PAGE_SIZE = 10;

type LoadState = "loading" | "loaded" | "error";

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm: NewPolicyInput = {
  policyNumber: "",
  policyholderName: "",
  policyholderEmail: "",
  status: "active",
  effectiveDate: todayIso(),
  expiryDate: "",
  premiumAmount: "",
  coverageAmount: "",
  dependents: [],
};

const emptyDependent: NewDependentInput = { fullName: "", email: "", relationship: "spouse" };

const currency = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** Suggests the next policy number by incrementing the highest existing "POL-<digits>" found. */
function nextPolicyNumber(policies: Policy[]): string {
  const numbers = policies
    .map((p) => p.policyNumber.match(/^POL-(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ digits: m[1], value: parseInt(m[1], 10) }));
  if (numbers.length === 0) return "POL-100001";
  const max = numbers.reduce((a, b) => (b.value > a.value ? b : a));
  return `POL-${String(max.value + 1).padStart(max.digits.length, "0")}`;
}

export default function PoliciesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
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
  const [page, setPage] = useState(0);

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

  // Claimants don't get the manage-list view (Add/Delete controls make no
  // sense for them) — just the one policy's summary page, per
  // .claude/specs/generic/auth-role-based-access.md's scoping. A claimant
  // is expected to have exactly one policy visible; if they somehow have
  // more (e.g. also a dependent elsewhere), send them to the first — full
  // multi-policy claimant UI is a later pass, not this stopgap.
  useEffect(() => {
    if (!authLoading && user?.role === "claimant" && state === "loaded" && policies.length > 0) {
      router.replace(`/policies/${policies[0].id}`);
    }
  }, [authLoading, user, state, policies, router]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(policies.length / PAGE_SIZE) - 1);
    setPage((p) => Math.min(p, maxPage));
  }, [policies.length]);

  const pagedPolicies = policies.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function handleAddPolicy(e: React.FormEvent) {
    e.preventDefault();
    if (
      !form.policyNumber.trim() ||
      !form.policyholderName.trim() ||
      !form.policyholderEmail.trim() ||
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
    if (form.dependents.some((d) => !d.fullName.trim() || !d.email.trim())) {
      setFormError("Fill in every dependent's name and email, or remove the empty row.");
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

  function addDependentRow() {
    setForm((f) => ({ ...f, dependents: [...f.dependents, { ...emptyDependent }] }));
  }

  function updateDependentRow(index: number, patch: Partial<NewDependentInput>) {
    setForm((f) => ({
      ...f,
      dependents: f.dependents.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));
  }

  function removeDependentRow(index: number) {
    setForm((f) => ({ ...f, dependents: f.dependents.filter((_, i) => i !== index) }));
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

  // While a claimant's redirect to their policy summary is pending (auth
  // still loading, policies still loading, or the redirect effect above
  // hasn't fired yet), render nothing rather than flash the manage-list UI.
  if (authLoading || (user?.role === "claimant" && (state !== "loaded" || policies.length > 0))) {
    return (
      <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
        <div className="skeleton" style={{ height: "280px" }} aria-busy="true" />
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "1040px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <section
        className="hero animate-fade-in-up"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1.5rem", flexWrap: "wrap", padding: "2rem 2.25rem" }}
      >
        <span className="hero-orb hero-orb--a" aria-hidden="true" />
        <span className="hero-orb hero-orb--b" aria-hidden="true" />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "560px" }}>
          <h1 style={{ margin: 0, fontSize: "1.9rem" }}>Policies</h1>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            {policies.length} on file — coverage, dependents, and everything a claim can be filed against.
          </p>
          {user?.role !== "claimant" && (
          <button
            onClick={() => {
              if (showAddForm) {
                setShowAddForm(false);
              } else {
                setForm({ ...emptyForm, policyNumber: nextPolicyNumber(policies) });
                setShowAddForm(true);
              }
            }}
            className="transition btn-press"
            style={{
              alignSelf: "flex-start",
              marginTop: "0.5rem",
              padding: "0.6rem 1.2rem",
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
          )}
        </div>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: "0.9rem", flexShrink: 0 }}>
          <IdCardIllustration className="float-icon" />
          <ShieldCheckIllustration className="float-icon-delay" />
        </div>
      </section>

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
          <FormField label="Policy number" hint="Auto-assigned, next in sequence">
            <input value={form.policyNumber} readOnly disabled style={disabledInputStyle} />
          </FormField>
          <FormField label="Policyholder name">
            <input
              value={form.policyholderName}
              onChange={(e) => setForm((f) => ({ ...f, policyholderName: e.target.value }))}
              placeholder="Jane Doe"
              style={inputStyle}
            />
          </FormField>
          <FormField label="Policyholder email">
            <input
              type="email"
              value={form.policyholderEmail}
              onChange={(e) => setForm((f) => ({ ...f, policyholderEmail: e.target.value }))}
              placeholder="jane.doe@example.com"
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
          <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                Dependents <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional — who else can file against this policy)</span>
              </span>
              <button
                type="button"
                onClick={addDependentRow}
                className="transition btn-press"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.35rem 0.7rem",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + Add dependent
              </button>
            </div>
            {form.dependents.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                Only the policyholder can file claims against this policy until a dependent is added.
              </p>
            ) : (
              form.dependents.map((dependent, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 140px auto",
                    gap: "0.6rem",
                    alignItems: "center",
                  }}
                >
                  <input
                    value={dependent.fullName}
                    onChange={(e) => updateDependentRow(index, { fullName: e.target.value })}
                    placeholder="Dependent's full name"
                    style={inputStyle}
                  />
                  <input
                    type="email"
                    value={dependent.email}
                    onChange={(e) => updateDependentRow(index, { email: e.target.value })}
                    placeholder="dependent@example.com"
                    style={inputStyle}
                  />
                  <select
                    value={dependent.relationship}
                    onChange={(e) => updateDependentRow(index, { relationship: e.target.value as DependentRelationship })}
                    style={inputStyle}
                  >
                    <option value="spouse">Spouse</option>
                    <option value="child">Child</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeDependentRow(index)}
                    aria-label="Remove dependent"
                    className="transition btn-press"
                    style={{
                      border: "none",
                      background: "var(--surface-2)",
                      color: "var(--text-muted)",
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
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
              {pagedPolicies.map((policy) => {
                const tone = STATUS_TONE[policy.status];
                const goTo = () => router.push(`/policies/${policy.id}`);
                return (
                  <tr
                    key={policy.id}
                    onClick={goTo}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") goTo();
                    }}
                    role="link"
                    tabIndex={0}
                    className="row-hover transition"
                    style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  >
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
                      {user?.role !== "claimant" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(policy);
                          }}
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
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={policies.length} onPageChange={setPage} />
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

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{hint}</span>}
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

const disabledInputStyle: React.CSSProperties = {
  ...inputStyle,
  background: "var(--surface-2)",
  color: "var(--text-muted)",
  cursor: "not-allowed",
};
