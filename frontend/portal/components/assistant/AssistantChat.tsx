"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchAssistantClaim, fetchAssistantClaims, fetchPolicies, submitClaim } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AssistantClaim, AssistantClaimDetail, Policy, Provider } from "@/lib/types";
import { shortClaimId } from "@/lib/claim-id";
import { formatDate } from "@/lib/time";
import { IcdCodeSelect } from "../IcdCodeSelect";
import { ProviderSelect } from "../ProviderSelect";
import { StatusBadge } from "../StatusBadge";
import {
  CLAIM_TYPES,
  EMPTY_DRAFT,
  STEPS,
  nextStep,
  previousStep,
  stepByKey,
  stepForServerField,
  todayIso,
  type ClaimDraft,
  type StepDef,
  type StepKey,
} from "./claim-steps";

// Portal chat assistant — .claude/specs/generic/portal-claims-assistant.md.
// A floating button on every claimant page (Decision 3) opening a panel with
// the WhatsApp bot's three intents. Claim status reads GET /api/assistant/*
// (same wording as WhatsApp); policy status reads GET /api/policies; raising
// a claim walks claim-steps.ts with the claim form's own widgets and submits
// through POST /api/claims with source=chat (Decisions 1, 4, 5). State lives
// in sessionStorage per account (Decision 7) so it survives the full-page
// navigations this portal uses; attached files can't, and are re-requested.

type LogEntry =
  | { id: string; from: "bot" | "user"; text: string; tone?: "error" }
  | { id: string; from: "bot"; kind: "claims"; claims: AssistantClaim[] }
  | { id: string; from: "bot"; kind: "claimDetail"; claim: AssistantClaimDetail }
  | { id: string; from: "bot"; kind: "policies"; policies: PolicySummary[] }
  | { id: string; from: "bot"; kind: "submitted"; claimId: string; shortRef: string };

// Omit applied per union member, so each entry kind keeps its own fields.
type NewLogEntry = LogEntry extends infer T ? (T extends LogEntry ? Omit<T, "id"> : never) : never;

interface PolicySummary {
  id: string;
  policyNumber: string;
  status: string;
  expiryDate: string;
  coverageAmount: number;
}

interface ChatState {
  open: boolean;
  log: LogEntry[];
  mode: "idle" | "raising";
  draft: ClaimDraft;
  step: StepKey;
  /** Editing from the review card: after answering, go back to review (or the next unanswered question). */
  returnToReview: boolean;
}

const INITIAL_STATE: ChatState = { open: false, log: [], mode: "idle", draft: EMPTY_DRAFT, step: "policy", returnToReview: false };
const STORAGE_KEY = "claimflow-assistant";
const MAX_LOG = 60;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const CASE_SUMMARY_MAX = 500;

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const money = (amount: string | number) =>
  Number(amount).toLocaleString(undefined, { style: "currency", currency: "USD" });
const fileKey = (f: File) => `${f.name}-${f.size}-${f.lastModified}`;

/** The first question (in order, not skipped) whose answer is missing or invalid — used after an edit from review. */
function firstIncompleteStep(draft: ClaimDraft): StepKey | null {
  const step = STEPS.find((s) => s.widget !== "documents" && s.widget !== "review" && !s.skip?.(draft) && s.validate(draft));
  return step?.key ?? null;
}

export function AssistantChat() {
  const { user } = useAuth();
  const isClaimant = user?.role === "claimant";

  const [state, setState] = useState<ChatState>(INITIAL_STATE);
  const [loaded, setLoaded] = useState(false);
  const [documents, setDocuments] = useState<File[]>([]);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [busy, setBusy] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // ---------- Persistence (Decision 7) ----------

  useEffect(() => {
    if (!isClaimant || !user) return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved?.email === user.email && saved.state) {
        const restored: ChatState = { ...INITIAL_STATE, ...saved.state };
        // Files never survive a reload — send the claimant back to attach them.
        if (restored.mode === "raising" && (restored.step === "documents" || restored.step === "review")) {
          restored.step = "documents";
          restored.log = [
            ...restored.log,
            { id: newId(), from: "bot", text: "Attached files aren't kept when the page reloads — please attach your documents again." },
          ];
        }
        setState(restored);
      }
    } catch {
      // Storage unavailable or corrupt — start fresh.
    }
    setLoaded(true);
  }, [isClaimant, user]);

  useEffect(() => {
    if (!loaded || !user) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ email: user.email, state: { ...state, log: state.log.slice(-MAX_LOG) } }));
    } catch {
      // Best-effort only.
    }
  }, [state, loaded, user]);

  // Keep the latest message in view — after layout, so a restored or
  // just-opened conversation lands at the bottom too.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [state.log, state.step, state.open, busy]);

  // Policies back the policy step's chips (claimant-scoped server-side).
  useEffect(() => {
    if (state.mode !== "raising" || policies) return;
    fetchPolicies()
      .then(setPolicies)
      .catch(() => setPolicies([]));
  }, [state.mode, policies]);

  const append = useCallback((...entries: NewLogEntry[]) => {
    setState((s) => ({ ...s, log: [...s.log, ...entries.map((e) => ({ ...e, id: newId() }) as LogEntry)] }));
  }, []);

  // ---------- Open / close ----------

  function openPanel() {
    setState((s) => {
      if (s.log.length > 0) return { ...s, open: true };
      return {
        ...s,
        open: true,
        log: [
          {
            id: newId(),
            from: "bot",
            text: "Hi! I can check on your claims and policies, or help you raise a new claim step by step.",
          },
        ],
      };
    });
  }

  function closePanel() {
    setState((s) => ({ ...s, open: false }));
    launcherRef.current?.focus();
  }

  // ---------- Status intents ----------

  async function showClaims() {
    append({ from: "user", text: "Check claim status" });
    setBusy(true);
    try {
      const claims = await fetchAssistantClaims();
      if (claims.length === 0) {
        append({ from: "bot", text: "You don't have any claims yet. Choose Raise a claim to file one." });
      } else {
        append(
          {
            from: "bot",
            text: claims.length === 1 ? "Here's your claim. Tap it for details:" : `Here are your ${claims.length} most recent claims. Tap one for details:`,
          },
          { from: "bot", kind: "claims", claims }
        );
      }
    } catch (err) {
      append({ from: "bot", tone: "error", text: err instanceof ApiError ? err.message : "Couldn't load your claims. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function showClaimDetail(claim: AssistantClaim) {
    append({ from: "user", text: `Claim ${claim.shortRef}` });
    setBusy(true);
    try {
      const detail = await fetchAssistantClaim(claim.id);
      append({ from: "bot", kind: "claimDetail", claim: detail });
    } catch (err) {
      append({ from: "bot", tone: "error", text: err instanceof ApiError ? err.message : "Couldn't load that claim." });
    } finally {
      setBusy(false);
    }
  }

  async function showPolicies() {
    append({ from: "user", text: "Check policy status" });
    setBusy(true);
    try {
      const list = await fetchPolicies();
      if (list.length === 0) {
        append({ from: "bot", text: "I couldn't find any policies on your account." });
      } else {
        append({
          from: "bot",
          kind: "policies",
          policies: list.map((p) => ({
            id: p.id,
            policyNumber: p.policyNumber,
            status: p.status,
            expiryDate: p.expiryDate,
            coverageAmount: p.coverageAmount,
          })),
        });
      }
    } catch (err) {
      append({ from: "bot", tone: "error", text: err instanceof ApiError ? err.message : "Couldn't load your policies." });
    } finally {
      setBusy(false);
    }
  }

  // ---------- Raise a claim ----------

  function startClaim() {
    setDocuments([]);
    setPolicies(null);
    setState((s) => ({
      ...s,
      mode: "raising",
      draft: EMPTY_DRAFT,
      step: "policy",
      returnToReview: false,
      log: [
        ...s.log,
        { id: newId(), from: "user", text: "Raise a claim" },
        { id: newId(), from: "bot", text: `Let's raise a claim. ${stepByKey("policy").question(EMPTY_DRAFT)}` },
      ],
    }));
  }

  function goToStep(target: StepKey, draft: ClaimDraft, leadIn?: string, returnToReview = false) {
    const question = target === "review" ? stepByKey("review").question(draft) : stepByKey(target).question(draft);
    setState((s) => ({
      ...s,
      draft,
      step: target,
      returnToReview,
      log: [...s.log, { id: newId(), from: "bot", text: leadIn ? `${leadIn} ${question}` : question }],
    }));
  }

  /** Records a valid answer to the current step and moves on. Returns an error to show inline instead, if invalid. */
  function answer(step: StepDef, patch: Partial<ClaimDraft>, bubble?: string): string | null {
    const draft = { ...state.draft, ...patch };
    const error = step.validate(draft);
    if (error) return error;
    append({ from: "user", text: bubble ?? step.display(draft) });

    let target: StepKey;
    if (state.returnToReview) {
      target = firstIncompleteStep(draft) ?? (documents.length > 0 ? "review" : "documents");
    } else {
      target = nextStep(step.key, draft);
    }
    // After an edit, keep coming back to review until everything's complete again.
    goToStep(target, draft, undefined, state.returnToReview && target !== "review");
    return null;
  }

  function editFromReview(key: StepKey) {
    goToStep(key, state.draft, "Sure.", true);
  }

  function goBack() {
    const previous = previousStep(state.step, state.draft);
    if (previous) goToStep(previous, state.draft, "Going back.");
  }

  function backToMenu() {
    setDocuments([]);
    setState((s) => ({
      ...s,
      mode: "idle",
      draft: EMPTY_DRAFT,
      step: "policy",
      returnToReview: false,
      log: [
        ...s.log,
        { id: newId(), from: "user", text: "Main menu" },
        ...(s.mode === "raising" ? [{ id: newId(), from: "bot" as const, text: "Claim cancelled — nothing was submitted." }] : []),
      ],
    }));
  }

  async function submit(): Promise<string | null> {
    if (!user) return "Please log in again.";
    const d = state.draft;
    setBusy(true);
    try {
      const claim = await submitClaim(
        {
          policyNumber: d.policyNumber,
          claimType: d.claimType || "other",
          claimantName: d.claimantName.trim(),
          claimantEmail: user.email,
          incidentDate: d.incidentDate,
          incidentDescription: d.incidentDescription.trim(),
          claimAmount: Number(d.claimAmount),
          diagnosisCode: d.diagnosisCode.trim().toUpperCase(),
          procedureCode: d.procedureCode.trim().toUpperCase(),
          providerNpi: d.providerNpi.trim(),
          providerTaxId: d.providerTaxId.trim(),
          facilityName: d.facilityName.trim(),
          facilityAddress: d.facilityAddress.trim(),
          serviceDateFrom: d.serviceDateFrom,
          serviceDateTo: d.serviceDateTo,
          totalBilledAmount: Number(d.totalBilledAmount),
          coordinationOfBenefits: d.coordinationOfBenefits === true,
          attested: true,
          documents,
        },
        { source: "chat" }
      );
      setDocuments([]);
      setState((s) => ({
        ...s,
        mode: "idle",
        draft: EMPTY_DRAFT,
        step: "policy",
        returnToReview: false,
        log: [
          ...s.log,
          { id: newId(), from: "user", text: "Submit claim" },
          { id: newId(), from: "bot", kind: "submitted", claimId: claim.id, shortRef: shortClaimId(claim.id) },
        ],
      }));
      return null;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Submitting the claim failed. Please try again.";
      const faulty = err instanceof ApiError ? stepForServerField(err.field) : null;
      if (faulty) {
        // Re-ask just that question, then come back to review (Decision 5).
        goToStep(faulty, state.draft, `Couldn't submit: ${message} Let's fix that.`, true);
        return null;
      }
      return message;
    } finally {
      setBusy(false);
    }
  }

  if (!isClaimant) return null;

  const currentStep = stepByKey(state.step);

  return (
    <>
      {!state.open && (
        <button
          ref={launcherRef}
          type="button"
          className="assistant-launcher btn-press transition"
          onClick={openPanel}
          aria-label="Open the ClaimFlow assistant"
          aria-expanded={false}
        >
          <ChatIcon />
          <span className="assistant-launcher-label">Ask ClaimFlow</span>
        </button>
      )}

      {state.open && (
        <section
          className="assistant-panel animate-fade-in-up"
          role="dialog"
          aria-label="ClaimFlow assistant"
          onKeyDown={(e) => {
            if (e.key === "Escape") closePanel();
          }}
        >
          <header className="assistant-header">
            <div>
              <div className="assistant-title">ClaimFlow assistant</div>
              <div className="assistant-subtitle">Claims, policies, and new claims</div>
            </div>
            <button type="button" className="assistant-icon-button" onClick={closePanel} aria-label="Close the assistant">
              ✕
            </button>
          </header>

          <div ref={logRef} className="assistant-log" role="log" aria-live="polite" aria-busy={busy}>
            {state.log.map((entry) => (
              <LogItem key={entry.id} entry={entry} onClaimTap={showClaimDetail} disabled={busy} />
            ))}
            {busy && (
              <div className="assistant-bubble assistant-bubble-bot assistant-typing" aria-label="Working">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <div className="assistant-composer">
            {state.mode === "idle" ? (
              <div className="assistant-chips" role="group" aria-label="What would you like to do?">
                <Chip onClick={showClaims} disabled={busy}>
                  Check claim status
                </Chip>
                <Chip onClick={showPolicies} disabled={busy}>
                  Check policy status
                </Chip>
                <Chip onClick={startClaim} disabled={busy}>
                  Raise a claim
                </Chip>
              </div>
            ) : (
              <>
                <StepComposer
                  key={`${state.step}-${state.log.length}`}
                  step={currentStep}
                  draft={state.draft}
                  policies={policies}
                  documents={documents}
                  onDocumentsChange={setDocuments}
                  onAnswer={answer}
                  onEdit={editFromReview}
                  onSubmit={submit}
                  onContinueFromDocuments={() => {
                    const target = state.returnToReview ? firstIncompleteStep(state.draft) ?? "review" : "review";
                    append({ from: "user", text: `${documents.length} document${documents.length === 1 ? "" : "s"} attached` });
                    goToStep(target, state.draft, undefined, state.returnToReview && target !== "review");
                  }}
                  busy={busy}
                />
                <div className="assistant-nav">
                  {previousStep(state.step, state.draft) && state.step !== "review" ? (
                    <button type="button" className="assistant-link" onClick={goBack} disabled={busy}>
                      ← Back
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="button" className="assistant-link" onClick={backToMenu} disabled={busy}>
                    Main menu
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}

// ---------- Log rendering ----------

function LogItem({ entry, onClaimTap, disabled }: { entry: LogEntry; onClaimTap: (c: AssistantClaim) => void; disabled: boolean }) {
  if (!("kind" in entry)) {
    return (
      <div
        className={`assistant-bubble ${entry.from === "user" ? "assistant-bubble-user" : "assistant-bubble-bot"}${
          entry.tone === "error" ? " assistant-bubble-error" : ""
        }`}
        role={entry.tone === "error" ? "alert" : undefined}
      >
        {entry.text}
      </div>
    );
  }

  if (entry.kind === "claims") {
    return (
      <ul className="assistant-cards">
        {entry.claims.map((c) => (
          <li key={c.id}>
            <button type="button" className="assistant-card assistant-card-button" onClick={() => onClaimTap(c)} disabled={disabled}>
              <span className="assistant-card-row">
                <strong>{c.shortRef}</strong>
                <StatusBadge status={c.status} />
              </span>
              <span className="assistant-card-meta">
                {money(c.claimAmount)} · {titleCase(c.claimType)} · filed {formatDate(c.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (entry.kind === "claimDetail") {
    const c = entry.claim;
    const summary =
      c.caseSummary && c.caseSummary.length > CASE_SUMMARY_MAX ? `${c.caseSummary.slice(0, CASE_SUMMARY_MAX - 1).trimEnd()}…` : c.caseSummary;
    return (
      <div className="assistant-card">
        <span className="assistant-card-row">
          <strong>Claim {c.shortRef}</strong>
          <StatusBadge status={c.status} />
        </span>
        <span className="assistant-card-meta">{c.progress}</span>
        <dl className="assistant-facts">
          <dt>Type</dt>
          <dd>{titleCase(c.claimType)}</dd>
          <dt>Amount</dt>
          <dd>{money(c.claimAmount)}</dd>
          <dt>Filed</dt>
          <dd>{formatDate(c.createdAt)}</dd>
          <dt>Last update</dt>
          <dd>{formatDate(c.updatedAt)}</dd>
        </dl>
        {c.denialReason && (
          <p className="assistant-card-text">
            <strong>Reason:</strong> {c.denialReason}
          </p>
        )}
        {c.infoRequestedReason && (
          <p className="assistant-card-text">
            <strong>Information needed:</strong> {c.infoRequestedReason}
          </p>
        )}
        {summary && (
          <p className="assistant-card-text">
            <strong>AI case summary:</strong> {summary}
          </p>
        )}
        {c.next && (
          <p className="assistant-card-text">
            <strong>What happens next:</strong> {c.next}
          </p>
        )}
        <a className="assistant-card-link" href={`/claims/${c.id}`}>
          Open claim page →
        </a>
      </div>
    );
  }

  if (entry.kind === "policies") {
    return (
      <ul className="assistant-cards">
        {entry.policies.map((p) => (
          <li key={p.id}>
            <a className="assistant-card assistant-card-button" href={`/policies/${p.id}`}>
              <span className="assistant-card-row">
                <strong>{p.policyNumber}</strong>
                <span className="assistant-pill">{titleCase(p.status)}</span>
              </span>
              <span className="assistant-card-meta">
                Coverage {money(p.coverageAmount)} · expires {formatDate(p.expiryDate)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="assistant-card assistant-card-success" role="status">
      <strong>Claim submitted — reference {entry.shortRef}</strong>
      <span className="assistant-card-text">
        We&apos;ll review it and email you as it progresses. You can check it here any time with Check claim status.
      </span>
      <a className="assistant-card-link" href={`/claims/${entry.claimId}`}>
        View your claim →
      </a>
    </div>
  );
}

// ---------- Step composer: the widget for the current question ----------

interface StepComposerProps {
  step: StepDef;
  draft: ClaimDraft;
  policies: Policy[] | null;
  documents: File[];
  onDocumentsChange: (files: File[]) => void;
  onAnswer: (step: StepDef, patch: Partial<ClaimDraft>, bubble?: string) => string | null;
  onEdit: (key: StepKey) => void;
  onSubmit: () => Promise<string | null>;
  onContinueFromDocuments: () => void;
  busy: boolean;
}

function StepComposer(props: StepComposerProps) {
  const { step, draft, onAnswer, busy } = props;
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(() => (step.field ? String(draft[step.field] ?? "") : ""));
  const [provider, setProvider] = useState<Provider | undefined>(undefined);
  const firstFieldRef = useRef<HTMLDivElement>(null);

  // Move focus into the new question's widget. A text field wins over
  // buttons; ProviderSelect keeps its input disabled until the provider list
  // loads, so wait for it to be enabled rather than focusing nothing.
  useEffect(() => {
    const root = firstFieldRef.current;
    if (!root) return;
    const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]), textarea");
    if (!field) {
      root.querySelector<HTMLElement>("button:not([disabled])")?.focus();
      return;
    }
    if (!field.disabled) {
      field.focus();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!field.disabled) {
        field.focus();
        observer.disconnect();
      }
    });
    observer.observe(field, { attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, []);

  const send = (patch: Partial<ClaimDraft>, bubble?: string) => setError(onAnswer(step, patch, bubble));

  const hint = step.hint?.(draft);

  let body: React.ReactNode;
  switch (step.widget) {
    case "policy": {
      const list = props.policies;
      body =
        list === null ? (
          <p className="assistant-muted">Loading your policies…</p>
        ) : list.length === 0 ? (
          <p className="assistant-muted">I couldn&apos;t find a policy on your account, so a claim can&apos;t be raised here.</p>
        ) : (
          <div className="assistant-chips">
            {list.map((p) => (
              <Chip
                key={p.id}
                disabled={busy}
                onClick={() =>
                  send(
                    { policyNumber: p.policyNumber, policyholderName: p.policyholderName, coverageAmount: p.coverageAmount },
                    p.policyNumber
                  )
                }
              >
                {p.policyNumber}
                <span className="assistant-chip-meta"> · {titleCase(p.status)}</span>
              </Chip>
            ))}
          </div>
        );
      break;
    }
    case "claimType":
      body = (
        <div className="assistant-chips">
          {CLAIM_TYPES.map((t) => (
            <Chip key={t.value} disabled={busy} onClick={() => send({ claimType: t.value }, t.label)}>
              {t.label}
            </Chip>
          ))}
        </div>
      );
      break;
    case "yesNo":
      body = (
        <div className="assistant-chips">
          <Chip disabled={busy} onClick={() => send({ coordinationOfBenefits: true })}>
            Yes
          </Chip>
          <Chip disabled={busy} onClick={() => send({ coordinationOfBenefits: false })}>
            No
          </Chip>
        </div>
      );
      break;
    case "provider":
      body = (
        <TextRow onSend={() => sendProvider()} busy={busy}>
          <ProviderSelect
            value={value}
            onChange={setValue}
            onProviderSelect={setProvider}
            style={inputStyle}
          />
        </TextRow>
      );
      break;
    case "icd":
      body = (
        <TextRow onSend={() => send({ diagnosisCode: value.trim().toUpperCase() })} busy={busy}>
          <IcdCodeSelect value={value} onChange={setValue} style={inputStyle} />
        </TextRow>
      );
      break;
    case "documents":
      body = (
        <DocumentsPicker
          documents={props.documents}
          onChange={props.onDocumentsChange}
          busy={busy}
          onContinue={() => {
            if (props.documents.length === 0) {
              setError("Attach at least one supporting document to continue.");
              return;
            }
            props.onContinueFromDocuments();
          }}
          onError={setError}
        />
      );
      break;
    case "review":
      body = <ReviewCard draft={draft} documents={props.documents} onEdit={props.onEdit} onSubmit={props.onSubmit} busy={busy} />;
      break;
    default: {
      const field = step.field!;
      const isDate = step.widget === "date" || step.widget === "serviceDateTo";
      const commit = () => {
        const v = step.widget === "code" ? value.trim().toUpperCase() : value;
        send({ [field]: v } as Partial<ClaimDraft>);
      };
      body = (
        <>
          {step.widget === "name" && draft.policyholderName && (
            <div className="assistant-chips">
              <Chip disabled={busy} onClick={() => send({ claimantName: draft.policyholderName })}>
                Use {draft.policyholderName}
              </Chip>
            </div>
          )}
          {step.widget === "serviceDateTo" && draft.serviceDateFrom && (
            <div className="assistant-chips">
              <Chip disabled={busy} onClick={() => send({ serviceDateTo: draft.serviceDateFrom }, "Same day")}>
                Same day
              </Chip>
            </div>
          )}
          <TextRow onSend={commit} busy={busy}>
            {step.widget === "textarea" ? (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commit();
                  }
                }}
                rows={3}
                placeholder={step.placeholder}
                aria-label={step.question(draft)}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            ) : (
              <input
                type={isDate ? "date" : step.widget === "money" ? "number" : "text"}
                inputMode={step.widget === "money" ? "decimal" : undefined}
                min={step.widget === "money" ? "0" : step.widget === "serviceDateTo" ? draft.serviceDateFrom || undefined : undefined}
                step={step.widget === "money" ? "0.01" : undefined}
                max={isDate ? todayIso() : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                placeholder={step.placeholder}
                aria-label={step.question(draft)}
                style={inputStyle}
              />
            )}
          </TextRow>
        </>
      );
    }
  }

  function sendProvider() {
    if (provider) {
      send({
        providerNpi: provider.npi,
        providerFromList: true,
        providerTaxId: provider.taxId,
        facilityName: provider.facilityName,
        facilityAddress: provider.facilityAddress,
      });
    } else {
      // A new NPI: clear any details left over from a previously picked provider.
      send({
        providerNpi: value.trim(),
        providerFromList: false,
        ...(draft.providerFromList ? { providerTaxId: "", facilityName: "", facilityAddress: "" } : {}),
      });
    }
  }

  return (
    <div ref={firstFieldRef} className="assistant-step">
      {body}
      {hint && !error && <p className="assistant-muted">{hint}</p>}
      {error && (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function TextRow({ children, onSend, busy }: { children: React.ReactNode; onSend: () => void; busy: boolean }) {
  return (
    <div className="assistant-text-row">
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <button type="button" className="assistant-send btn-press" onClick={onSend} disabled={busy} aria-label="Send">
        <SendIcon />
      </button>
    </div>
  );
}

function DocumentsPicker({
  documents,
  onChange,
  onContinue,
  onError,
  busy,
}: {
  documents: File[];
  onChange: (files: File[]) => void;
  onContinue: () => void;
  onError: (message: string | null) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Same rules as ClaimForm: dedupe, PDF/JPG/PNG only, 10MB each.
  function addFiles(incoming: File[]) {
    const keys = new Set(documents.map(fileKey));
    const accepted: File[] = [];
    let rejection: string | null = null;
    for (const f of incoming) {
      if (keys.has(fileKey(f))) continue;
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        rejection = `"${f.name}" isn't a supported file type — only PDF, JPG, and PNG are accepted.`;
        continue;
      }
      if (f.size > MAX_FILE_SIZE_BYTES) {
        rejection = `"${f.name}" is over the 10MB limit.`;
        continue;
      }
      keys.add(fileKey(f));
      accepted.push(f);
    }
    onChange([...documents, ...accepted]);
    onError(rejection);
  }

  return (
    <>
      {documents.length > 0 && (
        <ul className="assistant-files">
          {documents.map((f, i) => (
            <li key={fileKey(f)}>
              <span className="assistant-file-name">
                {f.name.toLowerCase().endsWith(".pdf") ? "📄" : "🖼️"} {f.name}
              </span>
              <button
                type="button"
                className="assistant-icon-button"
                onClick={() => onChange(documents.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="assistant-chips">
        <Chip onClick={() => inputRef.current?.click()} disabled={busy}>
          📎 {documents.length > 0 ? "Attach more" : "Attach files"}
        </Chip>
        {documents.length > 0 && (
          <Chip onClick={onContinue} disabled={busy} primary>
            Continue
          </Chip>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />
      <p className="assistant-muted">PDF, JPG, or PNG — up to 10MB each.</p>
    </>
  );
}

function ReviewCard({
  draft,
  documents,
  onEdit,
  onSubmit,
  busy,
}: {
  draft: ClaimDraft;
  documents: File[];
  onEdit: (key: StepKey) => void;
  onSubmit: () => Promise<string | null>;
  busy: boolean;
}) {
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = STEPS.filter((s) => s.reviewLabel && !s.skip?.(draft));

  return (
    <div className="assistant-review">
      <dl className="assistant-review-list">
        {rows.map((s) => (
          <div key={s.key} className="assistant-review-row">
            <dt>{s.reviewLabel}</dt>
            <dd>{s.display(draft) || "—"}</dd>
            <button type="button" className="assistant-link" onClick={() => onEdit(s.key)} disabled={busy} aria-label={`Edit ${s.reviewLabel}`}>
              Edit
            </button>
          </div>
        ))}
        <div className="assistant-review-row">
          <dt>Documents</dt>
          <dd>{documents.length} attached</dd>
          <button type="button" className="assistant-link" onClick={() => onEdit("documents")} disabled={busy} aria-label="Edit documents">
            Edit
          </button>
        </div>
      </dl>
      <label className="assistant-attest">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
        <span>I attest that the information in this claim is true and accurate to the best of my knowledge.</span>
      </label>
      {error && (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="assistant-submit btn-press transition"
        disabled={!attested || busy}
        onClick={async () => setError(await onSubmit())}
      >
        {busy ? "Submitting…" : "Submit claim"}
      </button>
    </div>
  );
}

function Chip({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button type="button" className={`assistant-chip btn-press transition${primary ? " assistant-chip-primary" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  width: "100%",
  fontSize: "0.9rem",
};
