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

**Addendum (2026-09-29) — webhook signature verification.** Once the webhook is on a public URL (a tunnel locally, a host later), anyone who finds it could POST fake Meta-shaped events and drive the bot — including raising claims against a phone number they don't own. Meta signs every event it delivers: header `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the **raw** request body keyed with the app's App Secret ([Meta webhooks docs](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)). So:
- New env var `WHATSAPP_APP_SECRET` in `backend/api/.env` (App Dashboard → App settings → Basic → App secret).
- `backend/api/src/index.ts`'s `express.json()` keeps the raw body bytes (its `verify` hook) so the signature is computed over exactly what Meta signed, not a re-serialized JSON.
- `POST /api/whatsapp/webhook`, when `WHATSAPP_APP_SECRET` is set, rejects a missing/invalid signature with `401` before any processing (constant-time compare). When it's unset, events are accepted unverified and a warning is logged at startup — the same mock-fallback pattern as `WHATSAPP_ACCESS_TOKEN`, so local testing with hand-built payloads still works without a Meta app. Any deployment reachable from the internet must set it.
- Graph API version pinned in `whatsapp-client.ts` moves `v20.0` → `v26.0` (v20.0 expired 2026-09-24 per Meta's versions table; v26.0 is current).

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

**Addendum (2026-09-29) — richer claim status replies.** The first build showed raw status codes (`in_review`, `validating`) and only amount/denial reason. Claim status replies now:
- **Status wording** uses the portal's own labels (`frontend/portal/components/StatusBadge.tsx` `STATUS_META`: Submitted, Validating, In triage, Under review, Action needed, Approved, Denied) plus its 3-stage progress (Submitted → In review → Decision), duplicated in `claims-assistant.ts` — same duplicate-not-move reasoning as `shortClaimId()` (Decision 2).
- **List rows** keep `#<ref> · <label>` as the title (WhatsApp list-row title limit 24 chars) and add a description line: amount · claim type · filed date.
- **Detail** adds claim type, filed and last-updated dates (date only, UTC — timezone standardization is still §14 future work), the progress line, a plain "what happens next" sentence per status, and the **AI case summary** (truncated for chat) — the portal's claim page already shows claimants this summary, so WhatsApp matches it. Risk score and fraud indicators are **not** shown on WhatsApp.
- **Follow-up**: detail ends with reply buttons (*Other claims*, *Main menu*) instead of "type 'menu'".

**Addendum (2026-10-05) — usability and robustness fixes ("batch 1").** A review of the live bot found rough edges that read as bugs to a claimant. Changes:
1. **No false promise of WhatsApp status updates.** The raise-a-claim confirmation said "We'll message you here as its status changes", but status changes only go out by email (`notify-claimant`). It now says updates come by email and points at *Check claim status*. Real WhatsApp status pushes stay future work — outside Meta's 24-hour customer-service window they need a Meta-approved message template.
2. **Unrecognized numbers are stopped up front.** Before any menu or intent, the sender's phone must match `policies.policyholder_phone`, `policy_dependents.phone`, or an existing `claims.claimant_phone`. Otherwise every message gets one fixed reply ("this number isn't linked to a policy — contact your insurer to add it") and no `whatsapp_sessions` row is created. Previously such a sender could answer all raise-a-claim questions only for `validate-claim` to reject the claim later.
3. **A rejected submission can be corrected in place.** `ClaimValidationError` gains an optional `field` (the `CreateClaimInput` key at fault: `policyNumber`, `claimAmount`, `diagnosisCode`, `procedureCode`, `providerNpi`, `totalBilledAmount`, `attested`). When `createClaim()` rejects at `done`, the bot clears just that answer, keeps every other answer and the uploaded documents, re-asks that one question, then asks for `done` again. An error with no `field` offers *Start over* / *Main menu* buttons instead of leaving the claimant stuck re-sending `done`. *Main menu* (`main_menu`) and *Start over* (`restart_claim`) work from any mode.
4. **Duplicate deliveries are ignored.** Meta can redeliver the same event; each inbound message's `id` is recorded in a new `whatsapp_processed_messages` table (migration `0017`) and a repeat is acknowledged but not processed. No cleanup policy for v1 (one short row per inbound message), same reasoning as Decision 3.
5. **Easier raise-a-claim answers** (still the same fields, order, and server-side validation — Decision 1 stands):
   - **Policy**: a tappable list of the sender's own policies (same scoping as *Check policy status*); typing a policy number still works, but it must match one of those policies (case-insensitive) and is rejected immediately otherwise — previously any non-empty text was accepted and only failed at `done`.
   - **Way back home from every question**: each raise-a-claim question — and the documents step — carries a *Main menu* option (a reply button on typed and yes/no questions, an extra row on list questions). Tapping it abandons the claim in progress and shows the top-level menu, same as typing `menu`.
   - **Claim type**: a tappable list instead of "reply with a number" (numbers and names still accepted).
   - **Yes/no questions** (other insurance, attestation): *Yes* / *No* reply buttons; typed yes/no still accepted.
   - **Last date of service**: a *Same day* button alongside typing a date.
   - **Dates** accept `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY` (day first), `3 Oct 2026` / `3 October 2026`, `today`, and `yesterday` (server's local date); all stored as `YYYY-MM-DD`, and impossible dates (e.g. 31/02) are rejected.

   *Built 2026-10-05* in `routes/whatsapp.ts`, `claims-assistant.ts` (`isKnownPhone()`), `create-claim.ts` (`ClaimValidationError.field`), migration `0017`. Verified against a mock-mode API instance (Meta-shaped POSTs, outbound logged): unknown-number reply, duplicate `id` ignored, every raise-a-claim step incl. list/button taps and date formats, an over-coverage amount rejected at `done` then corrected in place without re-asking anything else, *Main menu* mid-flow, and both status intents unchanged. Not yet re-verified from a real phone.

**Addendum (2026-10-05) — portal-filed claims visible on WhatsApp, and a tagged identity ("batch 2").** *Check claim status* matched only `claims.claimant_phone`, which the portal form never sets — so a claimant who filed in the portal saw "I couldn't find any claims for this number" on WhatsApp unless someone back-filled the phone by hand (`RUNNING-LOCALLY.md` §8 step 4). Changes:
1. **Phone → the person's own email(s).** A phone resolves to `policies.policyholder_email` where `policyholder_phone` matches, plus `policy_dependents.email` where `phone` matches — i.e. the email of the person that phone belongs to, not everyone on their policy.
2. **Claim scope for a phone** is now `claimant_phone = phone` **or** `lower(claimant_email)` in those emails — the same claims the portal shows that person (`GET /api/claims` scopes a claimant by `claimant_email`), plus any WhatsApp-raised claim. A policyholder still doesn't see a dependent's claims, matching the portal. Claim detail uses the same scope, so a tapped id outside it is still "couldn't find that claim".
3. **Tagged identity** — the shared layer's lookups (`getClaimStatusList`, `getClaimStatusDetail`, `getPolicyStatusList`) take `{ kind: "phone", phone } | { kind: "email", email }` instead of a bare phone, which is what "Identity resolution per channel" above always intended. The email form scopes exactly like the portal's own endpoints (`claimant_email` for claims; `policyholder_email` or `policy_dependents.email` for policies), for the Phase 2 portal chat ([`portal-claims-assistant`](portal-claims-assistant.md), still Draft). `raiseClaim()` and `isKnownPhone()` stay phone-only — how a chat-raised portal claim is created is that spec's Open Question 5.

## Decisions at Lock (2026-09-16)

1. ~~**Which intake style for "raise a claim"?**~~ — **Decided: (b) plain sequential text Q&A.** Chosen over (a) WhatsApp Flows because there is no Meta Business Account/Flow Builder approval available yet (`PREREQUISITES.md` still lists WhatsApp credentials as "still needed" — Flows can't even be built, let alone approved, without that lead time), and over (c) reduced-field-set because it's a materially different, weaker product ("raise a claim" should produce a triage-ready claim like the portal does, not one immediately kicked to Validation Exception Review for missing codes). Text Q&A's known roughness (claimants not knowing ICD-10/CPT/NPI codes offhand) is accepted for v1, consistent with this being an internal test app (`[[project_demo_app_no_real_payments]]`) rather than a production claimant experience — revisit toward (a) once real WhatsApp Flow approval is in place. The bot asks one field at a time in the same order `ClaimForm` presents them, re-prompting on a regex validation failure (ICD10/CPT-HCPCS/NPI/amount patterns — the exact same `backend/api`-side patterns, not a re-implementation) with the same error message the portal shows, then asks for at least one document upload before calling `createClaim()`.
2. ~~**`shortClaimId()` duplication**~~ — **Decided: duplicate, not move.** `backend/shared/short-claim-id.ts` gets its own copy of the one-line formatter. Moving the frontend's `frontend/portal/lib/claim-id.ts` into a shared package would need real workspace/monorepo plumbing between two separately-deployed apps (`frontend/portal` and `backend/`) that don't share a build today — not worth it for one duplicated one-liner. Revisit if a third consumer appears.
3. ~~**Abandoned sessions**~~ — **Decided: no cap for v1**, matching `[[claimant-more-info-resubmission]]`/`[[sla-review-escalation]]`'s precedent for the same question. A `whatsapp_sessions` row can sit `active` indefinitely; add a cleanup policy later if it becomes a real problem.
4. ~~**Claimant identity / authorized-claimant check**~~ — **Resolved 2026-09-16, implemented ahead of the rest of this spec.** See "Identity resolution per channel" above and `.claude/specs/worker/validate-claim.md`'s addendum — `channel = 'whatsapp'` claims (and now, this spec's status-check intents) resolve identity by phone against `policyholder_phone`/`policy_dependents.phone`/`claimant_phone` (migration `0015_add_phone_fields.sql`).
5. ~~**Phase 2 timing/scope**~~ — **Resolved 2026-10-05:** specified and locked as [`generic/portal-claims-assistant`](portal-claims-assistant.md) (guided steps with portal widgets, same three intents). Original note: no commitment on when the portal chatbot gets built, or whether it reuses WhatsApp's exact 3-intent menu or grows its own. This spec only commits to not painting Phase 2 into a corner architecturally.

## Build notes

- **No live Meta credentials exist yet** (`PREREQUISITES.md` "still needed"). The webhook is built and testable by POSTing Meta-shaped payloads directly to `POST /api/whatsapp/webhook` (mirroring how `notify-claimant`/OTP email already ship against a console-log mock when `RESEND_API_KEY`/`GMAIL_*` are unset) — `backend/api/src/whatsapp-client.ts` logs the outbound message instead of calling the Graph API when `WHATSAPP_ACCESS_TOKEN` is unset. Real end-to-end delivery isn't verifiable until a Meta Business Account exists; that gap is expected and tracked in `PREREQUISITES.md`, not a blocker to building the rest.
- **Actual module locations (built 2026-09-16), deviating from the Design section's `backend/shared/` sketch:** `backend/api/src/create-claim.ts`, `backend/api/src/claims-assistant.ts`, and `backend/api/src/whatsapp-client.ts` — kept in `backend/api/src` rather than `backend/shared/` because every dependency they use (`pool`, `minioClient`, `zeebeClient`, `camundaRestClient`) is itself an api-local wrapper, and both callers (`routes/claims.ts`, `routes/whatsapp.ts`) live inside `backend/api` already — moving to `backend/shared/` would mean duplicating those wrappers there for no benefit. `backend/shared/short-claim-id.ts` did land in `backend/shared/` as planned (dependency-free, and `backend/shared` is already on `backend/api`'s TS include path). This only affects file location, not the "one shared implementation, thin adapters" design itself.
- **`whatsapp_sessions.documents`** (migration `0016_add_whatsapp_sessions.sql`) shipped as `jsonb` (`{name,url,contentType,size}[]`), not the Design section's `text[]`/`document_urls` sketch — documents are uploaded to MinIO as each one arrives in chat (before the claim exists), and the richer shape is what `create-claim.ts`'s already-uploaded document variant needs at finalize time.
- Built: migration `0016`, `backend/shared/short-claim-id.ts`, `createClaim()` extracted into `backend/api/src/create-claim.ts` (now shared by `routes/claims.ts` and `routes/whatsapp.ts`), `backend/api/src/claims-assistant.ts` (the three intents), `backend/api/src/whatsapp-client.ts`, `backend/api/src/routes/whatsapp.ts`, wired into `backend/api/src/index.ts` at `/api/whatsapp`. Not yet done: `PREREQUISITES.md`'s "still needed" line, and no live Meta credentials to verify actual message delivery end-to-end.
- **Verified live 2026-09-29** against Meta's test number from a real phone (menu, check policy status, check claim status), with signature verification on. Setup gotchas found on the way are in `RUNNING-LOCALLY.md` §8.
