> Inferred type: **generic** (no type given; a chat UI in `frontend/portal` plus a `backend/api` route plus a refactor of the shared assistant layer — no single db/bpmn/dmn/worker/api section covers it)

# generic/portal-claims-assistant

**Status:** Draft

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

**Shared-layer refactor this requires.** Today `getClaimStatusList(phone)`, `getClaimStatusDetail(phone, id)`, `getPolicyStatusList(phone)` and `raiseClaim(phone, …)` take a bare phone number and query `claimant_phone` / `policyholder_phone`. `claims-assistant.md` intended the identity parameter to "accept either shape from day one", but the build took a plain string. This spec changes it to a tagged identity, e.g. `{ kind: "phone", phone } | { kind: "email", email }`, with each function choosing the matching `WHERE` clause. WhatsApp call sites pass `{ kind: "phone", … }` and must behave exactly as before.

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

## Open Questions

1. **Raise-a-claim style**: (a) guided steps with widgets, (b) chat as launcher into the existing form, (c) AI-assisted from an uploaded bill, or a combination. This decides most of the build size.
2. **Scope beyond the three intents**: should the chat answer free-form questions (e.g. coverage)? If yes, answers must be grounded in the claimant's own policy data and clearly labeled as not a coverage decision. A Gemini answer about coverage that turns out wrong is a real risk for an insurer.
3. **Placement**: a floating chat button on every claimant page, a dedicated `/assistant` page, or a panel on the claimant home/claims page.
4. **Backend shape**: assistant endpoint (one source of wording for both channels) vs. thin client over existing endpoints.
5. **Channel value** for chat-raised claims: `portal` plus audit detail (no code change) vs. a new `portal_chat` value (type + SPEC update, no worker change; chat claims become directly queryable).
6. **Who can use it**: claimants only (proposed), or also staff, e.g. "show me my open tasks"?
7. **Draft storage** for multi-turn claim raising: client-side vs. a server-side sessions table.
8. **Audit for read-only lookups**: keep WhatsApp's behavior (not audited) or start logging "viewed claim status" events?

## Follow-up dependencies

- **Resolves `claims-assistant.md` Decision 5** (Phase 2 timing/scope) once this spec is Locked; update that line to point here.
- **Shared-layer identity refactor** touches WhatsApp code paths; the WhatsApp intents need a regression check (menu, claim status, policy status, raise a claim) after it.
- **`generic/dynamic-form-builder` (Draft)**: if admin-defined claim forms land, the chat's claim intake should read the same field definitions rather than hardcoding `ClaimForm`'s order.
- **`SPEC.md` §14 "Chatbot integration"** bullet should link here; add a row to `BUILD-PLAN.md` Phase 2 when scheduled.
