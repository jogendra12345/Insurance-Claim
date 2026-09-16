> Inferred type: **generic** (spans a new webhook route, a new conversation-state table, a shared backend logic layer, and a business-flow design decision — no single db/bpmn/dmn/worker/api section in SPEC.md covers it as one unit)

# generic/claims-assistant

**Status:** Locked (2026-09-16)

**Supersedes** `.claude/specs/generic/whatsapp-claim-intake.md` (now Superseded — its content lives here, broadened). That spec covered *only* raising a claim over WhatsApp; this one adds two more conversational intents (claim status, policy status) and reframes the underlying logic as a **channel-agnostic assistant**, so a second channel (an in-portal chatbot) can be added later without rebuilding the intent logic — only a new thin adapter.

## Purpose

`SPEC.md` §14's future-work backlog has a combined one-liner: *"Email & WhatsApp claim intake — implement multi-channel ingestion allowing users to initiate claims via Email or WhatsApp."* This spec goes beyond that line's original scope (raise-a-claim only) per direct product direction: a WhatsApp number the carrier's users can message like a chatbot, which on "hi" (or any unrecognized message) replies with a menu of what it can do, and handles each selection with real data from this app — **check an existing claim's status**, **check a policy's status**, or **raise a new claim** (the original scope, unchanged).

**Two phases, one shared design:**
- **Phase 1 (this spec's build target): WhatsApp.** A webhook-driven bot behind the carrier's WhatsApp Business number.
- **Phase 2 (future work, not built here): an in-portal chatbot** — a chat widget inside the Next.js portal offering the same three intents to a logged-in claimant. Deliberately not detailed in this draft (see Out of scope), but the Design section below is written so Phase 2 only needs a new *adapter*, not new intent logic — see "Shared assistant layer" below. A dedicated spec would still be needed to actually build Phase 2 when its turn comes.

**Why WhatsApp can be free to run**: Meta's WhatsApp Cloud API doesn't charge for *user-initiated* conversations — a claimant messaging the business first, and the business replying within the following 24-hour window, incurs no per-message fee, including reply menus/buttons. Meta only charges for business-initiated messages sent outside that window (marketing/utility/authentication templates). As long as this feature only ever *replies* to whoever messaged first, and never proactively messages someone out of the blue, the messaging itself costs nothing — separate from Meta's own account/business-verification requirements (see Prerequisites below), which are an approval-time cost, not a per-message one.

## Scope

**In scope (Phase 1 — WhatsApp):**
- **Menu entry point**: any inbound message with no active conversation state (a fresh "hi," or anything unrecognized) gets a WhatsApp **interactive list/reply-button message** — Meta's native tappable menu, not freeform text parsing — offering: *Check claim status*, *Check policy status*, *Raise a claim*.
- **Check claim status**: given a phone number already resolvable to a claimant (via `claimant_phone`/`policyholder_phone`/`policy_dependents.phone` — the same columns added in migration `0015_add_phone_fields.sql` for §9's "Authorized claimants" check), lists that claimant's claims (short reference, status, last-updated) and lets them pick one for a fuller reply (current status, and — where public-facing detail makes sense — `denial_reason`/`info_requested_reason` mirroring what the portal's claim detail page already shows a claimant). Read-only; reuses the same query/authorization pattern `GET /api/claims` already applies for `role = 'claimant'` (scoped by identity match), not a new access-control path.
- **Check policy status**: same shape for policies — reuses `GET /api/policies`'s claimant-scoping logic (§9's dependent/policyholder match, phone-resolved here instead of session-resolved).
- **Raise a claim**: unchanged from the superseded spec — a webhook-driven conversational intake flow that collects every field `POST /api/claims` currently requires, plus at least one uploaded document, then raises the claim through the same shared internal logic the portal route uses (see Design). Still gated on Open Question 1 below (intake style).
- A **shared, channel-agnostic assistant logic layer** (see Design) that Phase 2 can reuse later.
- Per-phone-number conversation state in Postgres, generalized beyond "claim intake" to also track which menu/intent a conversation is currently in.
- Downloading documents/photos sent in-chat via WhatsApp's Media API into MinIO, same bucket/flow `uploadDocuments` already uses.
- New environment variables in `backend/api/.env` (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`), per `PREREQUISITES.md`'s existing external-provider pattern — a new "still needed" line until real credentials exist (see Prerequisites).

**Out of scope:**
- **Building Phase 2 (the in-portal chatbot UI) itself** — flagged and designed for, not built, in this draft. Needs its own spec when it's actually scheduled.
- **Which WhatsApp intake style to use for "raise a claim"** (Flows vs. plain text Q&A vs. a reduced field set) — unresolved, see Open Question 1.
- Email intake — the other half of `SPEC.md` §14's combined backlog bullet; a separate spec.
- Any outbound/business-initiated use of WhatsApp (e.g. as a `NotificationProvider` channel for `notify-claimant`, or unsolicited status pings) — every message here is a reply to something the user sent first. Business-initiated messages reintroduce per-message costs this spec's free-tier framing depends on avoiding, so that's a materially different feature.
- Designing/approving an actual WhatsApp Flow in Meta's tooling, if that path is chosen for the raise-a-claim intent — happens in Meta's Flow Builder, outside this codebase.
- Any change to `POST /api/claims`'s validation rules themselves (ICD-10/CPT-HCPCS/NPI patterns, required-field list), or to `GET /api/claims`/`GET /api/policies`'s existing authorization rules — this spec's job is to satisfy/reuse those existing contracts from a new channel, not loosen them.

## Design

### Shared assistant layer (what makes Phase 2 cheap later)

A new module, e.g. `backend/shared/claims-assistant.ts`, holds the three intents as channel-agnostic functions — no WhatsApp-specific types or rendering inside them:

```
getClaimStatusList(identity): Promise<ClaimSummary[]>
getClaimStatusDetail(identity, claimId): Promise<ClaimDetail>
getPolicyStatusList(identity): Promise<PolicySummary[]>
raiseClaim(identity, fields, documents): Promise<{ claimId, shortRef }>
```

`identity` is resolved differently per channel (see below) but is passed in as a plain value (an email, or a phone number, or eventually a user id) — the intent functions themselves just run the same scoped queries `GET /api/claims`/`GET /api/policies` already use, and call the same shared `createClaim()` (see "Claim creation" below) the portal route uses. Each channel adapter (the WhatsApp webhook today; a portal chat API route in Phase 2) is responsible only for: resolving identity, rendering the menu/replies in its own UI idiom, and holding its own conversation/session state shape. This is the same "one shared implementation, thin channel adapters" pattern this app already uses for `SettlementProvider`/`NotificationProvider`.

### Identity resolution per channel

- **WhatsApp (Phase 1)**: the sending phone number, matched against `policies.policyholder_phone`/`policy_dependents.phone` (for policy/claim lookups) and `claims.claimant_phone` (for claims raised via `channel = 'whatsapp'`, per `.claude/specs/worker/validate-claim.md`'s 2026-09-16 addendum). A phone number matching nothing in the schema gets a "we couldn't find any policies for this number" reply rather than an error — same spirit as `validate-claim`'s human-review-not-hard-fail philosophy, just at the query layer here since there's no claim/review step to hand this to.
- **Portal chatbot (Phase 2, not built)**: the logged-in session (`useAuth()`), no phone matching needed — a stronger, already-authenticated identity. Noted here only so the shared layer's `identity` parameter is designed to accept either shape from day one.

### Webhook endpoints (`backend/api`)

Two new routes, likely `backend/api/src/routes/whatsapp.ts`:
- `GET /api/whatsapp/webhook` — Meta's required webhook verification handshake (echoes a challenge token back, checked against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
- `POST /api/whatsapp/webhook` — receives inbound events: plain text messages, document/image uploads, and `interactive` payloads (a menu selection). Looks up or creates a conversation-state row for the sending phone number, routes based on current menu/mode, calls the relevant `claims-assistant` function, and replies via the WhatsApp Cloud API's send-message endpoint using `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`. A fresh conversation (or an unrecognized message with no active mode) always gets the top-level menu.

### Conversation state (new table, e.g. `whatsapp_sessions` — generalized from the superseded spec's `whatsapp_intake_sessions`)

Needed because HTTP webhooks are stateless. Rough shape (finalize at Lock, depends on the intake-style decision for the raise-a-claim branch):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `phone_number` | text, unique | WhatsApp sender identifier (E.164) |
| `mode` | text | `menu` \| `claim_status` \| `policy_status` \| `raising_claim` — which intent this conversation is currently in |
| `collected_fields` | jsonb | partial `POST /api/claims` payload, only populated in `raising_claim` mode |
| `document_urls` | text[] or a join to a new session-documents table | uploaded-so-far document references (MinIO URLs), `raising_claim` mode only |
| `status` | text | e.g. `active \| completed \| abandoned` |
| `created_at` / `updated_at` | timestamptz | |

Migration would be `0016_add_whatsapp_sessions.sql` (next sequential number; current latest on disk is `0015_add_phone_fields.sql`).

### Media handling

Unchanged from the superseded spec: WhatsApp document/image messages arrive as a `media_id`. Downloading requires two calls — (1) `GET` the media's temporary URL from Meta's Graph API, (2) `GET` that URL (bearer-authenticated) for the bytes — which then upload to MinIO the same way `uploadDocuments` (multer, memory storage) → `minioClient.putObject` already does.

### Claim creation — shared internal logic, not a second validation path

Unchanged: `POST /api/claims`'s handler currently does field validation, document handling, the `claims`/`claim_documents` inserts, and Zeebe process kickoff inline in one route handler. This spec requires extracting that into a shared `createClaim(input, documents)` function (`backend/shared/` — called from `claims-assistant.ts`'s `raiseClaim()`) that both the portal route and the WhatsApp webhook call, so there's exactly one validation path, not two that can drift.

### Confirmation / reply formatting

- **Raise a claim**: once `createClaim()` succeeds, reply confirming the claim was raised, including its short reference (the same `#<first-8-chars>` scheme `frontend/portal/lib/claim-id.ts`'s `shortClaimId()` uses — see Open Question 2 on where this lives) and a portal link if reachable.
- **Check claim/policy status**: a short list reply (short ref + status, or policy number + status) for the list step; a fuller text reply for the detail step, in plain claimant-facing language matching this repo's existing copy-tone convention (see project memory on claimant-visible copy) — not raw field dumps.

## Decisions at Lock (2026-09-16)

1. ~~**Which intake style for "raise a claim"?**~~ — **Decided: (b) plain sequential text Q&A.** Chosen over (a) WhatsApp Flows because there is no Meta Business Account/Flow Builder approval available yet (`PREREQUISITES.md` still lists WhatsApp credentials as "still needed" — Flows can't even be built, let alone approved, without that lead time), and over (c) reduced-field-set because it's a materially different, weaker product ("raise a claim" should produce a triage-ready claim like the portal does, not one immediately kicked to Validation Exception Review for missing codes). Text Q&A's known roughness (claimants not knowing ICD-10/CPT/NPI codes offhand) is accepted for v1, consistent with this being an internal test app (`[[project_demo_app_no_real_payments]]`) rather than a production claimant experience — revisit toward (a) once real WhatsApp Flow approval is in place. The bot asks one field at a time in the same order `ClaimForm` presents them, re-prompting on a regex validation failure (ICD10/CPT-HCPCS/NPI/amount patterns — the exact same `backend/api`-side patterns, not a re-implementation) with the same error message the portal shows, then asks for at least one document upload before calling `createClaim()`.
2. ~~**`shortClaimId()` duplication**~~ — **Decided: duplicate, not move.** `backend/shared/short-claim-id.ts` gets its own copy of the one-line formatter. Moving the frontend's `frontend/portal/lib/claim-id.ts` into a shared package would need real workspace/monorepo plumbing between two separately-deployed apps (`frontend/portal` and `backend/`) that don't share a build today — not worth it for one duplicated one-liner. Revisit if a third consumer appears.
3. ~~**Abandoned sessions**~~ — **Decided: no cap for v1**, matching `[[claimant-more-info-resubmission]]`/`[[sla-review-escalation]]`'s precedent for the same question. A `whatsapp_sessions` row can sit `active` indefinitely; add a cleanup policy later if it becomes a real problem.
4. ~~**Claimant identity / authorized-claimant check**~~ — **Resolved 2026-09-16, implemented ahead of the rest of this spec.** See "Identity resolution per channel" above and `.claude/specs/worker/validate-claim.md`'s addendum — `channel = 'whatsapp'` claims (and now, this spec's status-check intents) resolve identity by phone against `policyholder_phone`/`policy_dependents.phone`/`claimant_phone` (migration `0015_add_phone_fields.sql`).
5. **Phase 2 timing/scope** — still genuinely open, not blocking Lock: no commitment on when the portal chatbot gets built, or whether it reuses WhatsApp's exact 3-intent menu or grows its own. This spec only commits to not painting Phase 2 into a corner architecturally.

## Build notes

- **No live Meta credentials exist yet** (`PREREQUISITES.md` "still needed"). The webhook is built and testable by POSTing Meta-shaped payloads directly to `POST /api/whatsapp/webhook` (mirroring how `notify-claimant`/OTP email already ship against a console-log mock when `RESEND_API_KEY`/`GMAIL_*` are unset) — `backend/api/src/whatsapp-client.ts` logs the outbound message instead of calling the Graph API when `WHATSAPP_ACCESS_TOKEN` is unset. Real end-to-end delivery isn't verifiable until a Meta Business Account exists; that gap is expected and tracked in `PREREQUISITES.md`, not a blocker to building the rest.
- **Actual module locations (built 2026-09-16), deviating from the Design section's `backend/shared/` sketch:** `backend/api/src/create-claim.ts`, `backend/api/src/claims-assistant.ts`, and `backend/api/src/whatsapp-client.ts` — kept in `backend/api/src` rather than `backend/shared/` because every dependency they use (`pool`, `minioClient`, `zeebeClient`, `camundaRestClient`) is itself an api-local wrapper, and both callers (`routes/claims.ts`, `routes/whatsapp.ts`) live inside `backend/api` already — moving to `backend/shared/` would mean duplicating those wrappers there for no benefit. `backend/shared/short-claim-id.ts` did land in `backend/shared/` as planned (dependency-free, and `backend/shared` is already on `backend/api`'s TS include path). This only affects file location, not the "one shared implementation, thin adapters" design itself.
- **`whatsapp_sessions.documents`** (migration `0016_add_whatsapp_sessions.sql`) shipped as `jsonb` (`{name,url,contentType,size}[]`), not the Design section's `text[]`/`document_urls` sketch — documents are uploaded to MinIO as each one arrives in chat (before the claim exists), and the richer shape is what `create-claim.ts`'s already-uploaded document variant needs at finalize time.
- Built: migration `0016`, `backend/shared/short-claim-id.ts`, `createClaim()` extracted into `backend/api/src/create-claim.ts` (now shared by `routes/claims.ts` and `routes/whatsapp.ts`), `backend/api/src/claims-assistant.ts` (the three intents), `backend/api/src/whatsapp-client.ts`, `backend/api/src/routes/whatsapp.ts`, wired into `backend/api/src/index.ts` at `/api/whatsapp`. Not yet done: `PREREQUISITES.md`'s "still needed" line, and no live Meta credentials to verify actual message delivery end-to-end.
