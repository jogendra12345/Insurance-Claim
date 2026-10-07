> Inferred type: **generic** (spans an inbound-mail adapter in `backend/api`, new draft/dedup tables, a `claims.channel` value that changes `validate-claim`'s authorization rule, and an AI extraction step — no single db/bpmn/dmn/worker/api section in SPEC.md covers it as one unit)

# generic/email-claim-intake

**Status:** Draft (2026-10-07)

## Purpose

`SPEC.md` §14's backlog bullet *"Email & WhatsApp claim intake"* is half built: WhatsApp shipped as [`generic/claims-assistant`](claims-assistant.md), whose Out of scope says *"Email intake — the other half of `SPEC.md` §14's combined backlog bullet; a separate spec."* This is that spec.

A claimant emails a dedicated claims address with a description of what happened and their bills/receipts attached. The app pulls out the claim fields with AI, checks them with the same validation the portal and WhatsApp use, replies in the same thread asking **only** for whatever is missing or invalid, and raises the claim once everything is there. The same address also answers "where is my claim?" / "what's my policy status?" emails, reusing the shared assistant layer.

**Why not just copy the WhatsApp bot:** WhatsApp asks one question per message with tappable menus. Email has no buttons and a slow round trip — a 17-question email exchange would take days. So email intake is **extract-then-ask-for-gaps**: one email can carry most of a claim, and follow-ups are batched into a single reply listing every gap at once.

## Scope

**In scope**
- Receiving inbound email on a dedicated claims mailbox (mechanism: Open Question 1).
- Sender verification and an up-front "known sender" check (Open Question 2).
- AI extraction of `CreateClaimInput` fields from the email body (and attachment text where useful), followed by deterministic validation — the AI never decides validity.
- A per-thread **draft** that accumulates fields and documents across replies, keyed on email threading headers.
- Gap replies: one reply per inbound email listing every missing/invalid field, with the same error messages the portal shows.
- Attachments → MinIO, same bucket/path as WhatsApp's already-uploaded document variant of `createClaim()`.
- Raising the claim through `createClaim()` with `channel = 'email'`, and replying with its `#shortref`.
- Status intents: claim status and policy status replies via `claims-assistant.ts` with `{ kind: "email", email }` identity (already supported).
- Duplicate-delivery protection on `Message-ID`.
- `audit_log` rows for every inbound email processed and every draft → claim conversion.
- `validate-claim` gains an authorized-claimant rule for `channel = 'email'`.

**Out of scope**
- Any change to `createClaim()`'s validation rules, `GET /api/claims`/`GET /api/policies` scoping, or the BPMN/DMN.
- Business-initiated email beyond replies and the draft reminder (status-change emails stay with `notify-claimant`).
- Staff-facing email (reviewers acting on tasks by email).
- HTML-rich reply templates — plain-text replies (with a minimal HTML twin if the sender helper needs one) are enough for v1.
- Multi-language extraction/replies.
- OCR of scanned attachments beyond what the AI model does natively on an inline PDF/image.

## Design

### Inbound mail (Open Question 1)

Two options; the rest of the design is the same either way — the receiver hands a normalized `InboundEmail` (`messageId`, `inReplyTo`, `references[]`, `from`, `subject`, `textBody`, `attachments[]`, `authResults`) to one channel-adapter function.

- **(a) Gmail IMAP polling (recommended for v1).** Poll the existing `GMAIL_USER` mailbox (or a dedicated Gmail account) every ~60 s with an IMAP client (e.g. `imapflow`) using an App Password, fetch unseen messages, process, mark seen. Runs as a small loop inside `backend/api` (or a separate process — decide at build). Works locally today with no domain, no tunnel, no new paid service. Gmail stamps an `Authentication-Results` header with SPF/DKIM/DMARC verdicts, which Open Question 2 can use.
- **(b) Inbound-parse webhook** (Resend inbound, SendGrid Inbound Parse, Mailgun Routes) → `POST /api/email/inbound`, signature-verified like the WhatsApp webhook. Real-time, scales better, but needs a domain we control with MX records pointed at the provider plus a public URL — neither exists yet (`PREREQUISITES.md`: Resend domain unverified).

Swap later by replacing the receiver only; keep the adapter and everything below it unchanged.

### Sender identity and verification (Open Question 2)

Email `From:` is trivially spoofable, so the sender address alone is weaker than WhatsApp's phone number (which Meta verifies). Every inbound email goes through, in order:

1. **Known-sender gate** — same idea as WhatsApp batch 1's `isKnownPhone()`: `from` (lowercased) must match `policies.policyholder_email`, `policy_dependents.email`, or an existing `claims.claimant_email`. Otherwise one fixed reply ("this address isn't linked to a policy — contact your insurer, or file in the portal") and no draft row is created. Unknown senders get that reply at most once per 24 h per address, to avoid becoming a reply-bot for spam.
2. **Authentication check** — proposed: require `dmarc=pass`, or `spf=pass` **and** `dkim=pass` aligned to the `From` domain, in `Authentication-Results`. Failing mail is dropped with an `audit_log` row and no reply (replying to a forged sender emails the real person).
3. **Confirm-before-submit** (proposed, see Open Question 2) — when a draft becomes complete, the final reply doesn't raise the claim yet; it sends a summary of every field to the matched address on file and asks the claimant to reply `CONFIRM`. Only a reply in that thread from that address raises the claim. Because the summary goes to the real address on file, a spoofer never sees it.

Status replies (claim/policy status) only need steps 1–2: they go back to the address on file, which is the person allowed to see them.

### Intent detection

Per inbound email, in order:
1. Reply to an open draft thread (`In-Reply-To`/`References` matches a draft's message ids) → **continue that draft**.
2. Subject/body is a status ask (keywords `status`, `where is my claim`, a `#<shortref>` with no attachments, etc. — final list at build; AI may assist with classification) → **claim status** (list of the sender's claims, or one claim's detail if a `#shortref` in scope is mentioned) or **policy status**.
3. Otherwise → **new claim draft**.

Status reply wording reuses `claimStatusCopy()`/`claimProgressLine()` from `claims-assistant.ts`, so email matches WhatsApp and the portal.

### Field extraction

For a new draft or a reply to one:
- **AI step** — send the new text (quoted history stripped, see below) to the app's existing AI client (`backend/shared/gemini-client.ts`, which every AI worker uses today) with a JSON-schema prompt over the `CreateClaimInput` keys minus `channel`/`claimantPhone`/`claimantEmail`. Output per field: `value` and `confidence` (`high`/`low`). Missing fields are omitted, not guessed. Instruct the model to quote codes (ICD-10, CPT/HCPCS, NPI) **only** if they literally appear in the email or an attachment — never infer a code from a description.
- **Deterministic step** — every extracted value goes through the same parsers/patterns WhatsApp uses (`ICD10_PATTERN`, `CPT_OR_HCPCS_PATTERN`, `NPI_PATTERN`, positive amounts, the multi-format date parser, the sender's-own-policy check, claim-type list). To avoid a third copy, move WhatsApp's field parsers (`parseDate`, `toIsoDate`, `parsePositiveNumber`, `parseClaimType`, policy-number check) out of `routes/whatsapp.ts` into a shared module (e.g. `backend/api/src/claim-field-parsers.ts`) used by both adapters — WhatsApp's behavior must stay identical.
- **Merge** — a value already accepted in the draft is only overwritten if the claimant's new email clearly supplies a different one (AI flags it as a correction); otherwise earlier answers stand.
- **Fixed fields** — `claimantEmail` = the verified sender address (never extracted). `claimantName` defaults to the policyholder/dependent name on file for that address; the claimant can override it.
- **Low-confidence values** are kept but listed under "please confirm" in the next reply rather than silently accepted. Yes/no fields (`coordinationOfBenefits`, `attested`) are never inferred — they must be answered explicitly (attestation always appears in the final summary).
- **Quoted history** — strip quoted reply text (lines starting `>`, `On … wrote:` blocks, Gmail/Outlook quote markers) before extraction so the bot's own previous questions aren't re-read as answers.

### What happens when details are missing

No claim exists until every required field passes validation — a draft just waits. After each inbound email, the reply lists in one message:
- **What we have** — the accepted fields, in plain words (so the claimant can spot a wrong extraction).
- **Still needed** — each missing required field, with a short hint on where to find it (e.g. "Diagnosis code (ICD-10, e.g. J18.9) — usually on your bill or discharge papers").
- **Needs fixing** — each invalid value, quoting what was sent and the same error message the portal/WhatsApp show.
- **Please confirm** — low-confidence values.
- **Documents** — if none received yet: "Please attach at least one supporting document (bill, receipt, report — PDF or photo)."

| Situation | Behavior |
|---|---|
| Field missing | Listed under *Still needed* with a hint |
| Field present but invalid | Listed under *Needs fixing* with the portal's error message |
| No attachment | Asked for; required, as on WhatsApp |
| Policy number not one of the sender's | Rejected immediately; reply lists the sender's own policies (same scope as policy status) |
| AI unsure of a value | Listed under *Please confirm* |
| Reply contains nothing usable | Nothing lost; reply restates what's still needed |
| New email (not a reply) while a draft is open | Open Question 4 |
| Claimant goes silent | Open Question 3 |
| Complete draft | Confirmation summary (if Open Question 2 adopts confirm-before-submit), then `createClaim()` |
| `createClaim()` rejects at submit (e.g. amount over coverage) | Same as WhatsApp batch 1: use `ClaimValidationError.field` to clear just that field, keep everything else and the documents, and reply asking for that one field. No `field` → reply explaining the problem and offering to start over (reply `RESTART`) |
| Reply `CANCEL` | Draft abandoned, confirmation reply sent |

After the claim exists, the normal process applies unchanged: `validate-claim` problems go to Validation Exception Review; reviewer more-info requests go out via `notify-claimant`.

### Data model

Next migration numbers on disk: `0019`, `0020`.

**`email_claim_drafts`** (migration `0019_add_email_claim_drafts.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sender_email` | text | lowercased, verified sender |
| `thread_message_ids` | text[] | every `Message-ID` in the thread (inbound and our replies) — matched against `In-Reply-To`/`References` |
| `collected_fields` | jsonb | accepted values, same keys as `whatsapp_sessions.collected_fields` |
| `low_confidence_fields` | text[] | keys awaiting confirmation |
| `documents` | jsonb | `{name,url,contentType,size}[]` — same shape as `whatsapp_sessions.documents` |
| `status` | text | `collecting` \| `awaiting_confirmation` \| `submitted` \| `abandoned` \| `expired` |
| `claim_id` | uuid NULL → `claims.id` | set on submit |
| `last_inbound_at` / `reminder_sent_at` | timestamptz | for Open Question 3 |
| `created_at` / `updated_at` | timestamptz | |

Unlike `whatsapp_sessions` (one row per phone), a sender can have several drafts — one per thread — subject to Open Question 4.

**`email_processed_messages`** (migration `0020`) — `message_id text PK`, `processed_at timestamptz`. Same purpose as `whatsapp_processed_messages` (`0017`): IMAP re-fetch or webhook redelivery must not double-process. No cleanup for v1, same reasoning.

**`claims.channel`** gains the value `'email'` (text column, no enum change needed). `CreateClaimInput.channel` widens to `"portal" | "whatsapp" | "email"`, and `claims-assistant.ts` gains a `raiseClaimByEmail()` (or `raiseClaim()` takes a channel-tagged identity — decide at build).

### `validate-claim` authorization for `channel = 'email'`

SPEC.md §9's channel-scoped signal gets a third case: an email-channel claim is authorized when `claimant_email` (the verified sender) matches `policies.policyholder_email` or a `policy_dependents.email` on **the claim's policy** — email only, no name fallback, mirroring WhatsApp's phone-only rule. Rationale: the sender address is the one identity signal this channel verifies (via the authentication check and, if adopted, the confirm round trip). Spec `worker/validate-claim.md` needs a matching addendum.

### Replies

- Sent through `backend/shared/email-sender.ts` (Gmail SMTP preferred, Resend fallback, console mock when neither is set) from the claims mailbox address, with `In-Reply-To`/`References` set and `Re: <original subject>`, so they thread in the claimant's client. Each sent `Message-ID` is appended to the draft's `thread_message_ids`.
- Claimant-facing copy follows the repo's existing tone (plain language, no raw field keys/status codes).
- **Test-mode redirect:** `notification-provider.ts` currently redirects all claimant email to `TEST_RECIPIENT`. Email intake replies must go to the real sender (otherwise the conversation can't work), but seeded `@example.com` addresses can't send mail anyway — a tester emails from their own address, which must be on a seeded policy. Note this in `RUNNING-LOCALLY.md` at build.

### Audit log

- `actor_type = 'system'`: inbound email received (message id, sender, auth result, intent), dropped (unknown sender / failed auth / duplicate), reply sent, draft abandoned/expired.
- `actor_type = 'ai'`: each extraction, with the model `generateContent()` reports and per-field confidences (same NAIC-style traceability the AI workers log).
- `actor_type = 'human'`: claimant confirmation (`CONFIRM`) and claim submission — attributed to the claimant's email.
Pre-claim rows have no `claim_id`; on submit, the draft id is logged in the claim's first row so the history can be joined. (If `audit_log.claim_id` is `NOT NULL`, pre-claim events go to the draft row's own history instead — check at build.)

### Configuration

New env vars in `backend/api/.env` (exact set depends on Open Question 1): `EMAIL_INTAKE_ENABLED`, `EMAIL_INTAKE_ADDRESS`, and for (a) `EMAIL_INTAKE_IMAP_USER`/`EMAIL_INTAKE_IMAP_PASSWORD` (default to `GMAIL_USER`/`GMAIL_APP_PASSWORD`), `EMAIL_INTAKE_POLL_SECONDS`. Unset → intake off, logged at startup. Add a "still needed"/decided line to `PREREQUISITES.md`.

## Open Questions

1. **Inbound mechanism** — (a) Gmail IMAP polling (recommended: works today, free, no domain) or (b) an inbound-parse webhook (needs a domain + public URL)? If (a): reuse the existing `GMAIL_USER` mailbox or create a dedicated claims Gmail account? A dedicated account is recommended — the existing one also sends OTP and notification mail, and the poller would otherwise read unrelated inbox traffic.
2. **Sender verification** — adopt both the SPF/DKIM/DMARC check **and** confirm-before-submit (recommended), only one, or neither (demo-grade)? Confirm-before-submit adds one round trip per claim but is the only defense when a sender's domain has no DMARC.
3. **Silent claimants** — proposed: one reminder after 3 days without a reply, draft `expired` after 14 days with a final "this draft has closed — just email us again" message. Alternatively no expiry for v1, matching WhatsApp's Decision 3. Needs a scheduler either way (the IMAP poll loop can sweep drafts; webhook mode would need a timer).
4. **New email while a draft is open** — (a) always start a separate draft (simplest; a claimant might genuinely file two claims), (b) merge into the most recent open draft, or (c) ask in the reply ("Is this about your claim in progress or a new one?"). Recommended: (a), with the reply mentioning the other open draft.
5. **Attachments as a field source** — should extraction also read attached bills/EOBs (where most ICD-10/CPT/NPI codes actually live) via `fetchAsInlinePart()`, or body text only? Recommended: read attachments too, since it's the main way email intake can beat the portal form — at the cost of a larger AI call per email. Codes taken from attachments would still be listed under *Please confirm* the first time.
6. **Size/type limits** — max attachments per email and per draft, max size, allowed types (proposed: PDF/JPEG/PNG/HEIC, 10 MB each, 10 per draft — align with the portal's multer limits).

## Build notes

_(empty until built)_
