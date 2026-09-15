> Inferred type: **generic** (spans a new webhook route, a new small conversation-state table, and a business-flow design decision — no single db/bpmn/dmn/worker/api section in SPEC.md covers it as one unit)

# generic/whatsapp-claim-intake

**Status:** Draft

## Purpose

`SPEC.md` §14's future-work backlog has a combined one-liner: *"Email & WhatsApp claim intake — implement multi-channel ingestion allowing users to initiate claims via Email or WhatsApp."* This spec splits out and details the **WhatsApp half only** — email intake is a separate, later spec (see Out of scope).

Today a claim can only be raised through the portal's `ClaimForm` → `POST /api/claims`. This spec lets a claimant instead message the carrier's WhatsApp Business number directly, be guided through providing the same information the portal form collects, upload supporting documents in-chat, and have that produce a real claim — the same `claims`/`claim_documents` rows, the same Zeebe process kickoff, the same downstream AI triage and human review everything else in this app already goes through. Nothing about validation, routing, or review changes; only how the claim's initial data gets in.

**Why this can be free to run**: Meta's WhatsApp Cloud API doesn't charge for *user-initiated* conversations — a claimant messaging the business first, and the business replying within the following 24-hour window, incurs no per-message fee. Meta only charges for business-initiated messages sent outside that window (marketing/utility/authentication templates). As long as this feature only ever *replies* to a claimant who messaged first, and never proactively messages someone out of the blue, the messaging itself costs nothing — separate from Meta's own account/business-verification requirements (see Prerequisites below), which are an approval-time cost, not a per-message one.

## Scope

**In scope:**
- A webhook-driven conversational intake flow that collects every field `POST /api/claims` (`backend/api/src/routes/claims.ts`) currently requires — `policyNumber`, `claimType`, `claimantName`, `claimantEmail`, `incidentDate`, `incidentDescription`, `claimAmount`, `diagnosisCode` (ICD-10), `procedureCode` (CPT/HCPCS), `providerNpi`, `providerTaxId`, `facilityName`, `facilityAddress`, `serviceDateFrom`, `totalBilledAmount`, `coordinationOfBenefits`, `attested` — plus at least one uploaded document, then raises the claim through the same internal logic that route already uses (see Design — no parallel validation path).
- Per-phone-number conversation state, persisted in Postgres (this app's only existing state store — an HTTP webhook has no session of its own between messages).
- Downloading documents/photos a claimant sends in-chat via WhatsApp's Media API and storing them in MinIO, the same bucket/flow `uploadDocuments` already uses.
- A confirmation reply once the claim is raised, including the claim's short reference (the same `#<first-8-chars>` scheme `frontend/portal/lib/claim-id.ts`'s `shortClaimId()` uses today — that helper is frontend-only, so this spec's webhook needs its own copy or a shared version moved into `backend/shared/`, since nothing in `backend/` currently formats this).
- New environment variables in `backend/api/.env` (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`), following the same pattern `PREREQUISITES.md` already documents for Resend/Gmail — a "decided" line naming the env vars once real credentials exist, gitignored `.env`, and this spec should note the account/credential itself is a **new "still needed" item** in `PREREQUISITES.md` (see Prerequisites).

**Out of scope:**
- **Which intake style to use (WhatsApp Flows vs. plain text Q&A vs. a reduced field set)** — this is the central open design question below, deliberately not resolved by this draft.
- Email intake — the other half of `SPEC.md` §14's combined backlog bullet; a separate spec.
- Any outbound/business-initiated use of WhatsApp (e.g. as a `NotificationProvider` channel for `notify-claimant`, or a "task reopened" ping to a reviewer) — this spec is intake-only. Sending business-initiated messages also reintroduces the per-message costs this spec's free-tier framing depends on avoiding, so it's a materially different feature with its own cost tradeoffs.
- Designing/approving the actual WhatsApp Flow in Meta's tooling (if that path is chosen) — that happens in Meta's Flow Builder, outside this codebase; this spec only covers the backend integration that receives a completed Flow's response.
- Any change to `POST /api/claims`'s validation rules themselves (ICD-10/CPT-HCPCS/NPI patterns, required-field list) — this spec's job is to satisfy that existing contract, not loosen it.

## Design

### Prerequisites (account/credentials — not yet decided)

Per `PREREQUISITES.md`'s existing pattern for external providers: this needs a **Meta Business Account** with a **WhatsApp Business Platform** connection and a registered phone number. Meta's free test number sandbox only allows messaging a handful of pre-approved recipient numbers — fine for development, not for real claimants. Going beyond the sandbox requires Meta business verification, which is a real approval-time cost (can take days) independent of anything in this codebase. This is a new **"still needed"** line for `PREREQUISITES.md`, alongside the existing "still needed"/"decided" entries for other providers.

### Webhook endpoints (`backend/api`)

Two new routes, likely `backend/api/src/routes/whatsapp.ts`:
- `GET /api/whatsapp/webhook` — Meta's required webhook verification handshake (echoes a challenge token back, checked against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) — a one-time/idempotent check Meta calls when the webhook URL is registered.
- `POST /api/whatsapp/webhook` — receives inbound message events (text replies, document/image uploads, or a completed Flow response, depending on which intake style is chosen). Looks up or creates a conversation-state row for the sending phone number, advances the intake based on what's still missing, and replies via the WhatsApp Cloud API's send-message endpoint using `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`.

### Conversation state (new table, e.g. `whatsapp_intake_sessions`)

Needed because HTTP webhooks are stateless and a claim's ~17 fields can't realistically arrive in one message. Rough shape (finalize at Lock, depends on the intake-style decision):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `phone_number` | text, unique | WhatsApp sender identifier (E.164) |
| `collected_fields` | jsonb | partial `POST /api/claims` payload, filled in as the conversation progresses |
| `document_urls` | text[] or a join to a new intake-documents table | uploaded-so-far document references (MinIO URLs) before the claim row exists |
| `status` | text | e.g. `in_progress \| completed \| abandoned` |
| `created_at` / `updated_at` | timestamptz | |

Migration would be `0015_add_whatsapp_intake_sessions.sql` (next sequential number per `backend/db/migrations/`, current latest is `0014_add_info_requested_reason.sql`).

### Media handling

WhatsApp document/image messages arrive as a `media_id`, not a direct URL. Downloading requires two calls: (1) `GET` the media's temporary URL from Meta's Graph API using the `media_id`, (2) `GET` that URL (bearer-authenticated with `WHATSAPP_ACCESS_TOKEN`) to fetch the actual bytes. Those bytes then upload to MinIO the same way `backend/api/src/routes/claims.ts`'s `uploadDocuments` (multer, memory storage) → `minioClient.putObject` flow already does — reusing that storage call, not a parallel implementation.

### Claim creation — shared internal logic, not a second validation path

`POST /api/claims`'s handler currently does field validation (`ICD10_PATTERN`, `CPT_OR_HCPCS_PATTERN`, `NPI_PATTERN`, required-field checks), document handling, the `claims`/`claim_documents` inserts, and Zeebe process kickoff all inline in one route handler. This spec requires extracting that into a shared function (e.g. `createClaim(input, documents)` in `backend/api/src` or `backend/shared/`) that both the existing HTTP route and the new WhatsApp webhook call — **not** a second copy of the validation logic, which would drift from the real one over time. Refactoring that extraction is in scope for this spec's implementation, even though it touches already-shipped code, because it's the only way to avoid a duplicate/divergent validation path.

### Confirmation reply

Once `createClaim()` succeeds, the webhook sends a WhatsApp text reply confirming the claim was raised, including its short reference (see `shortClaimId()` note in Scope) and — if the portal is reachable to this claimant — a link to check status there.

## Open Questions

1. **Which intake style?** — the central decision this draft deliberately leaves open:
   - **(a) WhatsApp Flows** — Meta's native in-chat structured form UI (real fields/dropdowns, not freeform text). Best claimant experience and far less parsing/retry logic to build, but the Flow itself must be designed and approved in Meta's tooling before it's usable outside a test environment — a real lead-time cost.
   - **(b) Plain sequential text Q&A** — the bot asks one field at a time in freeform text. Simplest to build and works immediately in Meta's sandbox, but every structured field (ICD-10 code, CPT/HCPCS code, 10-digit NPI) becomes a parse-and-retry loop against `POST /api/claims`'s existing regexes, and a claimant realistically doesn't know their own diagnosis/procedure code off the top of their head — likely the roughest experience of the three options.
   - **(c) Reduced field set via chat, structured codes filled in later by staff** — WhatsApp only collects claimant identity, incident description, and documents; the claim is created with the medical/billing code fields deliberately blank and routed into something like a Validation-Exception-Review-style human step to complete them. Simpler to build than (a) or (b) for the hard fields, but changes what "raise a claim over WhatsApp" actually delivers — the claim starts incomplete, not ready for AI triage the way a portal submission is. Needs an explicit decision on whether that's acceptable before this becomes the answer.
2. **`shortClaimId()` duplication** — should the short-reference formatter move into `backend/shared/` so both the frontend and this new webhook use one implementation, or is copying the one-line function acceptable? Leaning toward moving it, but noting since it's a small pre-existing frontend-only utility, not something this spec would otherwise touch.
3. **Abandoned sessions** — no cap or timeout is proposed above on how long a `whatsapp_intake_sessions` row can sit `in_progress` before being considered abandoned. Worth an explicit "no cap, that's fine for v1" confirmation at Lock (matching how `[[claimant-more-info-resubmission]]` and `[[sla-review-escalation]]` handled similar unbounded-wait questions), or a real cleanup policy if not.
4. **Claimant identity / authorized-claimant check** — `validate-claim`'s existing authorized-claimant check (`policy_dependents`, §9) matches on `claimant_email`/`claimant_name` against the policy. A WhatsApp conversation authenticates by phone number, not email — does the claimant still type/confirm their email in-chat (straightforward, reuses the existing check as-is), or does this need a new phone-number-based authorization path? Leaning toward "claimant still provides email in-chat, no new auth mechanism," but flagging since it wasn't explicitly discussed.

## Follow-up dependencies

- None block drafting, but Open Question 1's answer significantly changes the Design section's shape (a Flow-based build looks quite different from a text-Q&A state machine) — expect this spec to be revised, not just Locked as-is, once that decision is made.
