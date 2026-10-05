> Inferred type: **generic** (no type given; a chat UI in `frontend/portal` plus a `backend/api` route plus a refactor of the shared assistant layer — no single db/bpmn/dmn/worker/api section covers it)

# generic/portal-claims-assistant

**Status:** Locked (2026-10-05)

## Purpose

Phase 2 of [`generic/claims-assistant`](claims-assistant.md): a chat assistant **inside the Next.js portal** for a logged-in claimant, offering the same three intents the WhatsApp bot offers today — *Check claim status*, *Check policy status*, *Raise a claim*.

Where this came from: `SPEC.md` §14 gained a "Chatbot integration" backlog item on 2026-09-15 ("an automated conversational assistant for claim filing … likely feeding into the same submission path as the portal form"). The next day, `claims-assistant.md` split the idea into two phases and built Phase 1 (WhatsApp) with a channel-agnostic intent layer "so Phase 2 only needs a new *adapter*, not new intent logic", while explicitly leaving Phase 2 unscheduled (its Decision 5: "no commitment on when the portal chatbot gets built, or whether it reuses WhatsApp's exact 3-intent menu or grows its own"). It is not in `ROADMAP.md` or `BUILD-PLAN.md`.

Why build it at all when the portal already has claim and policy pages and a claim form: the form asks for ICD-10, CPT/HCPCS and NPI codes up front and is the hardest part of the portal for a claimant to get through; a guided conversation can break that into smaller steps and explain each one. For status, a chat is a faster "where is my claim?" than navigating to the right page. Whether that justifies a second intake path is itself part of Open Question 1.

## Scope

**In scope**
- A chat UI in `frontend/portal`, available to logged-in users with `role = 'claimant'`.
- The three intents, backed by the existing shared layer in `backend/api/src/claims-assistant.ts` (status copy, progress line, list/detail queries, `raiseClaim()` → `createClaim()`), so WhatsApp and the portal chat give the same answers.
- A `backend/api` route (or routes) the chat UI calls, authenticated by the existing session cookie.
- Refactoring the shared layer's identity parameter so it accepts an email-resolved claimant as well as a phone number (see Design).
- Document upload during *Raise a claim*, through the same MinIO path `POST /api/claims` uses.

**Out of scope**
- Staff roles using the chat (triage/adjuster/etc. keep `/tasks`). See Open Question 6.
- Open-ended Q&A ("am I covered for X?") unless Open Question 2 decides otherwise.
- Proactive messages (the chat only answers; status changes still reach claimants by email via `notify-claimant`).
- Any change to the WhatsApp channel's behavior, beyond the shared-layer identity refactor, which must leave WhatsApp's replies unchanged.
- Voice input, multi-language copy.

## Design

### Identity and access

The portal already has a stronger identity than WhatsApp: the session (`useAuth()` on the frontend, `req.user` on the API), with no phone matching needed. Scoping must be exactly what the portal already enforces, not a new access path:

| Intent | Scope (same as today's portal) |
|---|---|
| Claim status | `lower(claims.claimant_email) = lower(req.user.email)`, same as `GET /api/claims` for `role = 'claimant'` |
| Policy status | `policies.policyholder_email` or a `policy_dependents.email` matches, same as `GET /api/policies` |
| Raise a claim | same authorized-claimant check `validate-claim` already runs for `channel = 'portal'` (email or name match against the policy) |

**Shared-layer refactor this requires.** Today `getClaimStatusList(phone)`, `getClaimStatusDetail(phone, id)`, `getPolicyStatusList(phone)` and `raiseClaim(phone, …)` take a bare phone number and query `claimant_phone` / `policyholder_phone`. `claims-assistant.md` intended the identity parameter to "accept either shape from day one", but the build took a plain string. This spec changes it to a tagged identity, e.g. `{ kind: "phone", phone } | { kind: "email", email }`, with each function choosing the matching `WHERE` clause. WhatsApp call sites pass `{ kind: "phone", … }` and must behave exactly as before. *Done 2026-10-05 for the three lookups* (`claims-assistant.md` "batch 2" addendum — which also widened a phone's claim scope to include claims filed under that person's email); `raiseClaim()` is still phone-only pending Open Question 5.

### Where the chat lives

Placement is Open Question 3. Whichever is chosen, the UI:
- Uses the portal's existing theme tokens, light/dark handling and components (`StatusBadge`'s labels already match the shared status copy).
- Renders claim/policy results as tappable cards linking to the existing `/claims/[id]` and `/policies/[id]` pages, rather than duplicating those pages in chat.
- Works at phone width, and is keyboard and screen-reader accessible (a chat log is an ARIA live region).

### Backend route

Open Question 4 decides between two shapes:
- **(a) Assistant endpoint.** e.g. `POST /api/assistant/messages` takes the user's message or button choice and returns the assistant's reply messages, built by the shared layer. Mirrors the WhatsApp webhook's structure, keeps all wording server-side, and one change updates both channels.
- **(b) Thin client.** The chat UI calls the existing `GET /api/claims`, `GET /api/claims/:id`, `GET /api/policies` and `POST /api/claims` directly and formats replies in the browser. No new backend, but the status wording and "what happens next" copy would be duplicated in the frontend and could drift from WhatsApp.

### Raise a claim

The biggest open decision (Open Question 1). Every option ends in the same `createClaim()` validation path, so claims are validated, stored and started in Camunda exactly like portal-form claims; there is never a second validation path.

| Option | How it works | Trade-off |
|---|---|---|
| **(a) Guided steps with widgets** | One field per turn, in `ClaimForm`'s order, but each turn embeds the portal's existing pickers (`PolicySelect`, `IcdCodeSelect`, `ProviderSelect`, date inputs, file upload), so the claimant chooses rather than types codes | Closest to WhatsApp; fixes WhatsApp's biggest weakness (typing codes from memory); longest conversation |
| **(b) Chat as launcher** | The chat collects a few basics in plain language (which policy, what happened, when), then opens the existing claim form pre-filled | Least new code; the chat is only a front door, and the hard part (codes) is still the form |
| **(c) AI-assisted from a bill** | The claimant uploads their bill or discharge summary first; Gemini (with the model fallback, `SPEC.md` §12) extracts suggested field values; the claimant reviews and corrects every field before submitting | Biggest usability gain; adds a new pre-submission AI step, which needs its own audit rows (which values the AI suggested vs. which the claimant confirmed or changed) and must never submit without the claimant's explicit confirmation |

Options can combine (e.g. (c) with (a) as the fallback when no document is uploaded).

**Channel value.** `claims.channel` decides which authorized-claimant check `validate-claim` runs (`portal` → email/name, `whatsapp` → phone). A chat-raised claim has an email identity, so the proposal is `channel = 'portal'` with the chat origin recorded in the `submitted` audit row's `detail`, which needs no type or schema change. A distinct value such as `portal_chat` is also cheap: there is no DB constraint on `claims.channel`, and `validate-claim` only special-cases `'whatsapp'` (anything else gets the email/name check). It would still need `create-claim.ts`'s `channel: "portal" | "whatsapp"` type widened and `SPEC.md` §9's `portal | whatsapp` column note updated, and it makes chat-raised claims queryable directly. See Open Question 5.

### Conversation state

Status intents are single-shot and need no stored state. *Raise a claim* under options (a)/(c) needs a draft across turns. Options (Open Question 7):
- **Client-side draft** (component state, optionally `sessionStorage`): nothing new server-side; a refresh or second device loses it.
- **Server-side table**: generalize `whatsapp_sessions` into a channel-agnostic `assistant_sessions` keyed by (channel, identity), or add a sibling table. Survives refresh; needs a migration and a cleanup policy (`claims-assistant.md` Decision 3 chose "no cap" for WhatsApp).

### Audit

A claim raised through the chat writes the same `submitted` / `process-started` rows as today via `createClaim()`, with the chat origin in `detail`. Read-only status lookups are not audited on WhatsApp today; Open Question 8 asks whether that stays true here. Option (c)'s AI suggestions must be auditable as described above.

### What it inherits from Phase 1

The portal-matching status labels and 3-stage progress, the "what happens next" copy, the AI case summary in claim detail (risk score and fraud indicators are not shown), and the Gemini model fallback (only relevant to option (c)). All added to the shared layer on 2026-09-29.

## Decisions at Lock (2026-10-05)

1. ~~**Raise-a-claim style**~~ — **Decided: (a) guided steps with the portal's own widgets.** One question per turn in `ClaimForm`'s order, each answered with the widget the form already uses: policy and claim type as tappable chips, `IcdCodeSelect` for diagnosis, `ProviderSelect` for the provider (picking a known provider fills tax ID / facility name / address and skips those questions, as the form does), native date inputs, and the form's file picker (PDF/JPG/PNG, ≤ 10MB each). Validation per step reuses `ClaimForm`'s rules (ICD-10 / CPT-HCPCS / NPI patterns, dates not in the future, service end ≥ start, amounts > 0, claim amount ≤ the policy's coverage). Matching `ClaimForm` for claimants: the email is the account's own and is not asked; the name is offered pre-filled from the policyholder name with the option to type another. The flow ends in a **review card** with *Edit* links per answer and the attestation checkbox, then submits. Option (c) (AI fill from an uploaded bill) is future work.
2. ~~**Scope beyond the three intents**~~ — **Decided: no free-form Q&A.** Only *Check claim status*, *Check policy status*, *Raise a claim*; anything typed outside a question is answered with the menu.
3. ~~**Placement**~~ — **Decided: a floating chat button** (bottom-right) on every page for a logged-in `claimant`, opening a panel; full-screen at phone width.
4. ~~**Backend shape**~~ — **Decided: hybrid.** Claim status comes from new claimant-only read endpoints over the shared layer — `GET /api/assistant/claims` and `GET /api/assistant/claims/:id` (`backend/api/src/routes/assistant.ts`, identity `{ kind: "email", email: req.user.email }`) — returning the same status label, progress line and "what happens next" copy WhatsApp uses. Policy status reuses the existing `GET /api/policies` (already claimant-scoped; no wording to share). Raising a claim submits through the existing `POST /api/claims` multipart path — no second submission path.
5. ~~**Channel value**~~ — **Decided: `channel = 'portal'`.** `POST /api/claims` accepts an optional `source=chat`; the `submitted` audit row's `detail.source` becomes `"claimant-portal-chat"` instead of `"claimant-portal"`. No schema or type change. `POST /api/claims` 400 responses also gain `field` (from `ClaimValidationError.field`, added in `claims-assistant.md`'s batch-1 addendum) so the chat jumps back to just that question and then returns to the review card.
6. ~~**Who can use it**~~ — **Decided: claimants only.** The button isn't rendered for staff, and the assistant endpoints are `requireRole("claimant")`.
7. ~~**Draft storage**~~ — **Decided: client-side, `sessionStorage`.** Answers survive a refresh within the tab; a different tab or device starts fresh. Attached files can't be stored there, so after a refresh the chat keeps the answers and asks for the documents again. Nothing server-side until submit.
8. ~~**Audit for read-only lookups**~~ — **Decided: not audited**, same as WhatsApp. A submitted claim is audited as today (`submitted`, with the chat source).

## Build notes

- **Built 2026-10-05.** Backend: `backend/api/src/routes/assistant.ts` (mounted at `/api/assistant`), `source` + `auditSource()` in `create-claim.ts`, `source` passthrough and `field` on 400s in `routes/claims.ts`. Frontend: `components/assistant/AssistantChat.tsx` (panel, intents, step engine, review card) and `components/assistant/claim-steps.ts` (step definitions + validation mirrored from `ClaimForm`), mounted in `app/layout.tsx`; styles under "Portal chat assistant" in `app/globals.css`; `fetchAssistantClaims`/`fetchAssistantClaim`, `ApiError.field` and `submitClaim(…, { source })` in `lib/api.ts`.
- **Picker dropdowns open upward inside the chat.** `IcdCodeSelect`/`ProviderSelect` position their `role="listbox"` below the input; at the bottom of the panel that was clipped, so the chat's CSS flips them above the input instead of changing the shared components.
- **Verified live 2026-10-05** as `ayanchou2015@gmail.com`: claim list + detail (same wording as WhatsApp), policy status, a full chat claim (future-date and over-coverage rejections, Back, provider pick skipping facility questions, unsupported file type rejected, Edit from review returning to review) submitted as claim `c0d11dc8` — stored with `channel = 'portal'`, audit `source: "claimant-portal-chat"`, process started and picked up by `validate-claim`. Draft and conversation survived full-page navigation. API: staff → 403, logged out → 401, another person's claim id → 404, over-coverage `POST /api/claims` → `field: "claimAmount"`. Phone-width layout checked in a 380px frame. Not covered: a server-side rejection driving the chat back to a question end-to-end (every server rule the chat can hit is already checked client-side first).

## Follow-up dependencies

- ~~**Resolves `claims-assistant.md` Decision 5**~~ — done at Lock: that line now points here.
- **Shared-layer identity refactor** touches WhatsApp code paths; the WhatsApp intents need a regression check (menu, claim status, policy status, raise a claim) after it.
- **`generic/dynamic-form-builder` (Draft)**: if admin-defined claim forms land, the chat's claim intake should read the same field definitions rather than hardcoding `ClaimForm`'s order.
- ~~**`SPEC.md` §14 "Chatbot integration"**~~ — linked here, and `BUILD-PLAN.md` Phase 2 row #36 added, at Lock.
