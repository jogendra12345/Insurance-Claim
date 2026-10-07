> Inferred type: **generic** (spans an inbound-mail adapter in `backend/api`, new draft/dedup tables, a `claims.channel` value that changes `validate-claim`'s authorization rule, and an AI extraction step — no single db/bpmn/dmn/worker/api section in SPEC.md covers it as one unit)

# generic/email-claim-intake

**Status:** Locked (2026-10-07)

## Purpose

`SPEC.md` §14's backlog bullet *"Email & WhatsApp claim intake"* is half built: WhatsApp shipped as [`generic/claims-assistant`](claims-assistant.md), whose Out of scope says *"Email intake — the other half of `SPEC.md` §14's combined backlog bullet; a separate spec."* This is that spec.

A claimant emails a dedicated claims address with a description of what happened and their bills/receipts attached. The app pulls out the claim fields with AI, checks them with the same validation the portal and WhatsApp use, replies in the same thread asking **only** for whatever is missing or invalid, and raises the claim once everything is there. The same address also answers "where is my claim?" / "what's my policy status?" emails, reusing the shared assistant layer.

**Why not just copy the WhatsApp bot:** WhatsApp asks one question per message with tappable menus. Email has no buttons and a slow round trip — a 17-question email exchange would take days. So email intake is **form-or-extract, then ask for gaps**:
- A claimant who emails **"raise a claim"** (or sends a new email with no claim details) gets a **plain-text claim form** back — every field as a `Label: value` line, pre-filled where we already know the answer — to fill in and send back with their documents. This is email's equivalent of WhatsApp's menu: an explicit, predictable starting point.
- A claimant who just describes their claim in their own words skips the form; AI extracts what it can.
- Either way, follow-ups are batched into a single reply that re-sends the form with accepted answers filled in and only the missing/invalid lines flagged.

**Added 2026-10-07 (same day, product direction):** the claim-form template, the reply-keyword menu, and code-first form parsing were added after the first draft — the first draft relied on AI extraction alone and replied with a bare "still needed" list.

## Scope

**In scope**
- Receiving inbound email on a dedicated claims mailbox (mechanism: Decision 1).
- Sender verification and an up-front "known sender" check (Decision 2).
- A reply-keyword **menu** (`RAISE A CLAIM` / `CLAIM STATUS` / `POLICY STATUS`) for greetings and unclear emails.
- A plain-text **claim form template** sent in reply to "raise a claim", parsed deterministically when it comes back.
- AI extraction of `CreateClaimInput` fields from free text outside the form (and attachment text where useful), followed by deterministic validation — the AI never decides validity.
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

### Inbound mail (Decision 1)

Two options; the rest of the design is the same either way — the receiver hands a normalized `InboundEmail` (`messageId`, `inReplyTo`, `references[]`, `from`, `subject`, `textBody`, `attachments[]`, `authResults`) to one channel-adapter function.

- **(a) Gmail IMAP polling (recommended for v1).** Poll a dedicated claims Gmail account every ~60 s with an IMAP client (e.g. `imapflow`) using an App Password, fetch unseen messages, process, mark seen. Runs as a small loop inside `backend/api` (or a separate process — decide at build). Works locally today with no domain, no tunnel, no new paid service. Gmail stamps an `Authentication-Results` header with SPF/DKIM/DMARC verdicts, which Decision 2 uses.
- **(b) Inbound-parse webhook** (Resend inbound, SendGrid Inbound Parse, Mailgun Routes) → `POST /api/email/inbound`, signature-verified like the WhatsApp webhook. Real-time, scales better, but needs a domain we control with MX records pointed at the provider plus a public URL — neither exists yet (`PREREQUISITES.md`: Resend domain unverified).

Swap later by replacing the receiver only; keep the adapter and everything below it unchanged.

### Sender identity and verification (Decision 2)

Email `From:` is trivially spoofable, so the sender address alone is weaker than WhatsApp's phone number (which Meta verifies). Every inbound email goes through, in order:

1. **Known-sender gate** — same idea as WhatsApp batch 1's `isKnownPhone()`: `from` (lowercased) must match `policies.policyholder_email`, `policy_dependents.email`, or an existing `claims.claimant_email`. Otherwise one fixed reply ("this address isn't linked to a policy — contact your insurer, or file in the portal") and no draft row is created. Unknown senders get that reply at most once per 24 h per address, to avoid becoming a reply-bot for spam.
2. **Authentication check** — proposed: require `dmarc=pass`, or `spf=pass` **and** `dkim=pass` aligned to the `From` domain, in `Authentication-Results`. Failing mail is dropped with an `audit_log` row and no reply (replying to a forged sender emails the real person).
3. **Confirm-before-submit** (Decision 2) — when a draft becomes complete, the final reply doesn't raise the claim yet; it sends a summary of every field to the matched address on file and asks the claimant to reply `CONFIRM`. Only a reply in that thread from that address raises the claim. Because the summary goes to the real address on file, a spoofer never sees it.

Status replies (claim/policy status) only need steps 1–2: they go back to the address on file, which is the person allowed to see them.

### Intent detection

Per inbound email, in order (keywords matched case-insensitively against the subject and the first non-quoted lines of the body):
1. Reply to an open draft thread (`In-Reply-To`/`References` matches a draft's message ids) → **continue that draft**. Control keywords `CONFIRM`, `CANCEL`, `RESTART` apply here.
2. **`RAISE A CLAIM`** (also `raise claim`, `new claim`, `file a claim`, `make a claim`) → create an empty draft and reply with the **claim form** (below).
3. **`CLAIM STATUS`** (also `status`, `where is my claim`, or a `#<shortref>` with no attachments) → **claim status**: list of the sender's claims, or one claim's detail if a `#shortref` in the sender's scope is mentioned.
4. **`POLICY STATUS`** → **policy status**.
5. Email that already describes a claim (AI classifies: mentions an incident/treatment/bill, or has attachments) → **new claim draft** via extraction, skipping the blank form — the first reply is the pre-filled form with gaps flagged.
6. Anything else (`hi`, `help`, empty, unclear) → **menu reply**:

   > Hi Sara — I'm the ClaimFlow claims assistant. Reply to this email with one of:
   > - **RAISE A CLAIM** — I'll send you a short form to fill in
   > - **CLAIM STATUS** — see where your claims are
   > - **POLICY STATUS** — see your policies
   >
   > You can also just describe your claim and attach your bill — I'll work out the details.

Status reply wording reuses `claimStatusCopy()`/`claimProgressLine()` from `claims-assistant.ts`, so email matches WhatsApp and the portal.

### Claim form template

Sent in reply to `RAISE A CLAIM`, and re-sent (pre-filled) in every follow-up while a draft is collecting. Plain text so it survives every mail client and can be filled in by typing after each colon:

```
Hi Sara, to raise a claim, reply to this email with the form below filled
in, and attach at least one supporting document (bill, receipt or report —
PDF or photo). Leave a line blank if you don't know it; we'll ask about it.

----- CLAIM FORM -----
Policy number (yours: POL-1234, POL-5678): POL-1234
Claim type (outpatient / inpatient / pharmacy / dental / maternity / other):
Your full name: Sara Khan
Incident date (e.g. 03/10/2026, 3 Oct 2026, today):
What happened:
Claim amount (USD):
Diagnosis code (ICD-10, e.g. J18.9, on your bill):
Procedure code (CPT or HCPCS, e.g. 99284, on your bill):
Service date from (first day of treatment):
Service date to (leave blank if same day):
Total billed (USD, the provider's full bill):
Provider NPI (10 digits):
Provider tax ID:
Facility name:
Facility address:
Other insurance? (yes/no):
I confirm this is accurate (yes/no):
----- END OF FORM -----
```

- **One line per `CreateClaimInput` field** except `channel`, `claimantPhone` and `claimantEmail` (the verified sender). `claimantName` is a *Your full name* line pre-filled from the policy/dependent record on file (see Build notes). Order matches the portal `ClaimForm` / WhatsApp step order. Claim-type options come from the same list WhatsApp uses (`CLAIM_TYPES`, moved to the shared parsers module).
- **Pre-filling**: policy number when the sender has exactly one policy (listed in the hint when they have several); on follow-ups, every accepted value.
- **Hints** in `(…)` sit in the label, before the colon, and are ignored by the parser (see Build notes).
- **Follow-up form**: lines needing attention are prefixed `⚠` with the reason on the line below, e.g.
  ```
  ⚠ Provider NPI (10 digits): 123456789
    → Provider NPI must be exactly 10 digits.
  ⚠ Procedure code (CPT or HCPCS, e.g. 99284, on your bill):
    → Still needed.
  ```
  and low-confidence AI values are prefixed `?` ("please check"). A short "What we have" summary above the form is unnecessary — the filled-in form *is* the summary.

### Form parsing (code first, AI second)

When a reply to a draft arrives:
1. Strip quoted history (see "Quoted history" below), then look for the `----- CLAIM FORM -----` … `----- END OF FORM -----` block. If the claimant replied *above* our quoted form without copying it, the block is searched in the quoted text too — but only lines whose value differs from what we sent count as answers.
2. **Deterministic pass**: each line is matched to a field by its label (case-insensitive, tolerant of a missing `⚠`/`?` prefix, extra spaces, and a removed hint), and its value is everything after the first `:` up to an optional trailing `(…)` hint. Blank values are ignored (field stays as it was). This pass needs no AI and is exact.
3. **AI pass** only for: free text outside the form block (e.g. "NPI is 1234567890, sorry forgot"), form lines the label matcher couldn't place, and new attachments (Decision 5). Same extraction call as "Field extraction" below.
4. Every value from either pass goes through the shared deterministic validators; deterministic form values win over AI values for the same field in the same email.

### Field extraction

For a free-text new claim email, or the AI pass of "Form parsing" above:
- **AI step** — send the new text (quoted history stripped, see below) to the app's existing AI client (`backend/shared/gemini-client.ts`, which every AI worker uses today) with a JSON-schema prompt over the `CreateClaimInput` keys minus `channel`/`claimantPhone`/`claimantEmail`. Output per field: `value` and `confidence` (`high`/`low`). Missing fields are omitted, not guessed. Instruct the model to quote codes (ICD-10, CPT/HCPCS, NPI) **only** if they literally appear in the email or an attachment — never infer a code from a description.
- **Deterministic step** — every extracted value goes through the same parsers/patterns WhatsApp uses (`ICD10_PATTERN`, `CPT_OR_HCPCS_PATTERN`, `NPI_PATTERN`, positive amounts, the multi-format date parser, the sender's-own-policy check, claim-type list). To avoid a third copy, move WhatsApp's field parsers (`parseDate`, `toIsoDate`, `parsePositiveNumber`, `parseClaimType`, policy-number check) out of `routes/whatsapp.ts` into a shared module (e.g. `backend/api/src/claim-field-parsers.ts`) used by both adapters — WhatsApp's behavior must stay identical.
- **Merge** — a value already accepted in the draft is only overwritten if the claimant's new email clearly supplies a different one (AI flags it as a correction); otherwise earlier answers stand.
- **Fixed fields** — `claimantEmail` = the verified sender address (never extracted). `claimantName` defaults to the policyholder/dependent name on file for that address; the claimant can override it.
- **Low-confidence values** are kept but marked `?` (please check) on the next returned form rather than silently accepted. Yes/no fields (`coordinationOfBenefits`, `attested`) are never inferred — they must be answered explicitly (attestation always appears in the final summary).
- **Quoted history** — strip quoted reply text (lines starting `>`, `On … wrote:` blocks, Gmail/Outlook quote markers) before extraction so the bot's own previous questions aren't re-read as answers.

### What happens when details are missing

No claim exists until every required field passes validation — a draft just waits. After each inbound email, the reply is the **claim form again**, pre-filled with every accepted value (so the claimant can spot a wrong extraction), with:
- **Missing** required fields left blank and marked `⚠ … → Still needed.`
- **Invalid** values kept as sent and marked `⚠ … → <the same error message the portal/WhatsApp show>`.
- **Low-confidence** AI values marked `?` with "please check — change it if it's wrong".
- **Documents** — a line above the form: "Documents received: bill.pdf" or, if none yet, "⚠ Please attach at least one supporting document (bill, receipt, report — PDF or photo)."

| Situation | Behavior |
|---|---|
| Claimant emails "raise a claim" | Blank form (policy pre-filled if they have one) |
| Claimant describes a claim without the form | Extraction, then the pre-filled form with gaps flagged |
| Field missing | Blank line marked `⚠ Still needed` |
| Field present but invalid | Line kept, marked `⚠` with the portal's error message |
| No attachment | Asked for above the form; required, as on WhatsApp |
| Policy number not one of the sender's | Marked `⚠`; hint lists the sender's own policies (same scope as policy status) |
| AI unsure of a value | Line marked `?` to check |
| Form lines deleted or mangled | Label matcher is tolerant; anything it can't place goes to the AI pass; still-missing fields are re-flagged |
| Reply contains nothing usable | Nothing lost; the same pre-filled form is re-sent |
| New email (not a reply) while a draft is open | A separate draft; the reply mentions the other open draft (Decision 4) |
| Claimant goes silent | Reminder after 3 days, expired after 14 (Decision 3) |
| Complete draft | Confirmation summary; `CONFIRM` reply → `createClaim()` |
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
| `last_inbound_at` / `reminder_sent_at` | timestamptz | for Decision 3 |
| `created_at` / `updated_at` | timestamptz | |

Unlike `whatsapp_sessions` (one row per phone), a sender can have several drafts — one per thread — per Decision 4.

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

New env vars in `backend/api/.env` (Decision 1): `EMAIL_INTAKE_ENABLED`, `EMAIL_INTAKE_ADDRESS`, and for (a) `EMAIL_INTAKE_IMAP_USER`/`EMAIL_INTAKE_IMAP_PASSWORD` (the dedicated claims account's Gmail address and App Password — used for both IMAP and SMTP), `EMAIL_INTAKE_POLL_SECONDS`. Unset → intake off, logged at startup. Add a "still needed"/decided line to `PREREQUISITES.md`.

## Decisions at Lock (2026-10-07)

All six took the recommended option.

1. ~~**Inbound mechanism**~~ — **(a) Gmail IMAP polling** of a **dedicated claims Gmail account** (not the existing `GMAIL_USER` mailbox, which also sends OTP/notification mail), every ~60 s. Replies go out over that same account's SMTP so they come from the claims address and thread correctly. The webhook option (b) stays the upgrade path once a domain exists — only the receiver changes.
2. ~~**Sender verification**~~ — **both**: the SPF/DKIM/DMARC check on the receiving server's `Authentication-Results` header, **and** confirm-before-submit (a reply of `CONFIRM` to a full summary sent to the verified address on file).
3. ~~**Silent claimants**~~ — **reminder after 3 days** without a reply (the pre-filled form re-sent once), **draft expired after 14 days** with a final "this draft has closed — just email us again" message. The IMAP poll loop sweeps drafts each tick.
4. ~~**New email while a draft is open**~~ — **(a) always a separate draft**; the reply mentions the other open draft(s) so the claimant can carry on there instead.
5. ~~**Attachments as a field source**~~ — **yes**: new attachments are sent to the AI along with the text, and values read from them fill only blank form lines, always marked `?` (please check), never silently accepted.
6. ~~**Size/type limits**~~ — PDF, JPEG, PNG, HEIC; **10 MB per file** (the portal's own multer limit, `MAX_FILE_SIZE_BYTES` in `routes/claims.ts`); **10 documents per draft**. Rejected attachments are named in the reply with the reason.

## Build notes

**Built 2026-10-07.** Files:
- `backend/api/src/email-intake.ts` — `processInboundEmail()` (sender checks, intents, drafts, form + AI merge, confirm, `createClaim()`), `sweepDrafts()` (Decision 3), and `emailIntakeDeps` (outbound mail / AI / document storage, swappable in tests).
- `backend/api/src/email-intake-form.ts` — pure pieces: `FORM_FIELDS`, `renderForm()`, `parseFormLines()`/`changedFormValues()`, `stripQuoted()`, `detectIntent()`, `controlKeyword()`, `checkSenderAuth()`.
- `backend/api/src/email-intake-poller.ts` — Gmail IMAP receiver (see the shared-inbox addendum below for `EMAIL_INTAKE_ADDRESS`/`EMAIL_INTAKE_UNTIL`) (`imapflow` + `mailparser`), started from `index.ts` when `EMAIL_INTAKE_ENABLED=true`.
- `backend/api/src/email-intake-mailer.ts` — replies over the claims account's Gmail SMTP with `Message-ID`/`In-Reply-To`/`References` and `Auto-Submitted: auto-replied`; logs instead when the account isn't configured.
- `backend/api/src/claim-field-parsers.ts` — the date/amount/claim-type/yes-no/pattern parsers moved out of `routes/whatsapp.ts`, now used by both channels. WhatsApp behavior re-checked unchanged against a mock-mode API (claim-type number, bad email, impossible date, `$1,200`).
- `claims-assistant.ts`: `isKnownEmail()`, `nameForEmail()`, `raiseClaimByEmail()`. `create-claim.ts`: `channel` gains `'email'`, audit source `email-intake`. `backend/workers/validate-claim.ts`: the email-only authorized-claimant branch. Portal "Filed via" shows *Email*.
- Migrations `0019_add_email_claim_drafts.sql` (`email_claim_drafts`, `email_intake_events`) and `0020_add_email_processed_messages.sql`.
- Tests: `backend/api/test/email-intake-form.test.ts` (17, pure) and `backend/api/test/email-intake.test.ts` (13, against local Postgres with mail/AI/MinIO faked and Zeebe stubbed) — unknown sender, forged sender, duplicate Message-ID, blank form → filled form with a bad NPI → AI correction → untouched quoted form changes nothing → `CONFIRM` → claim on `channel = 'email'` with audit rows → claim status; a described claim from free text + attachment rejected at submit for over-coverage and re-asked for that one field; `CANCEL`; reminder and expiry; raw RFC 822 → `InboundEmail`.

Deviations from the Design above, decided at build:
- **Hints sit inside the label, before the colon** — `Diagnosis code (ICD-10, e.g. J18.9, on your bill): J18.9` — rather than after the value as the template sketch shows, so a typed value never runs into hint text. The parser takes the first colon *outside* parentheses (the policy hint itself contains one: `(yours: POL-1234)`).
- **A "Your full name" line** is on the form, pre-filled from the policy/dependent record, so the claimant can correct it ("Field extraction" said they could override it).
- **Extra draft columns**: `invalid_fields` (`{key: {value, error}}`, so a bad value is shown back as sent) and `sent_forms` (`{ourMessageId: {key: shown value}}`). A form line counts as an answer only if it differs from the form *being replied to* — so replying to an older email in the thread, with its stale quoted form, can't revert later answers.
- **Pre-claim history** goes to a new `email_intake_events` table (`audit_log.claim_id` is `NOT NULL`); on submit, a `human` `email-intake-confirmed` `audit_log` row on the claim carries `draftId`, joining the two.
- **"Describes a claim" (intent step 5)** is a heuristic, not a separate AI classification call: an attachment, a pasted form, or ≥ 15 words of new text starts a draft through the normal extraction; if that yields fewer than 2 answers and no documents, the draft is discarded and the menu is sent instead.
- **`?` (low-confidence) lines don't block** the confirmation summary — the summary shows them marked and the claimant's `CONFIRM` covers them; returning the form with a `?` line left as-is also clears the mark.
- **Authentication-Results trust**: only the topmost header whose authserv-id is `EMAIL_INTAKE_AUTHSERV_ID` (default `mx.google.com`) is read. Lower ones could have been written by the sender.
- **At-most-once processing**: the `Message-ID` is recorded before processing, and an IMAP message is marked seen even if processing throws (the error is logged), so a poison message can't loop.

**Addendum (2026-10-07) — shared inbox and end date.** The first live run used an existing personal Gmail account as the claims inbox, and the poller treated its ~340-email unread backlog as claimant mail: newsletters were dropped, but 12 Amazon/Facebook/Google notification senders got the unknown-sender reply and everything was marked read. Two options were added so a demo can share a personal account:
- `EMAIL_INTAKE_ADDRESS` set to a plus-address of the account (e.g. `you+claims@gmail.com`) — the poller only handles mail sent to it (Gmail `X-GM-RAW deliveredto:` search, then a To/Cc/Delivered-To/X-Original-To header check that decides for any server). Other mail is fetched with `BODY.PEEK` and skipped, so it stays unread and unanswered. Replies are sent `From`/`Reply-To` the plus-address so the claimant's answers come back to it. Mail from the account's own main address is also treated as our own (no reply).
- `EMAIL_INTAKE_UNTIL=YYYY-MM-DD` — polling doesn't start after that day (inclusive, server-local), and a running poller stops at the first tick past it.
- The automated-sender check now matches `noreply`/`do-not-reply` anywhere in the local part (`googlecommunityteam-noreply@…` got a reply on the first run).

**Addendum (2026-10-07) — fixes from the first live round trip** (claimant on Gmail mobile replying to the form):
- **Read flag ignored in shared-inbox mode.** The account owner opened the reply in Gmail before the poll, so an unread-only search skipped it — and Gmail returns nothing when `deliveredto:` is combined with `is:unread`/`UNSEEN` anyway. The poller now searches `deliveredto:<address> newer_than:15d` and skips anything already in `email_processed_messages` (cheap envelope fetch first); 15 days covers a draft's 14-day life.
- **Answers typed above the quoted form are read.** The parser used to read only the first `CLAIM FORM` block (here, the empty quoted one). Known-label lines in the new text are now read too and win over the block.
- **Wrapped labels are rejoined.** Mail clients hard-wrap at ~76 characters, splitting `Claim type (… / maternity /` + `other): dental`; a line with an unclosed `(` is joined to the next. The claim-type hint lost its spaces so the line no longer wraps, and every rendered line is kept ≤ 76 characters (tested). Value continuation onto following lines is limited to prose fields (description, facility name/address) inside a form block — a wrapped label had been glued onto the policy number.
- **Inline photos count as documents.** Gmail mobile embeds a photo inline (`multipart/related`); inline images ≥ 10 KB are kept (signature logos are a few KB — the photo was 29.8 KB).
- **Gemini fallback** — `GEMINI_MODEL`/`GEMINI_FALLBACK_MODELS` added to `backend/api/.env` (same as the workers); the first extraction hit a 503 with no fallback.
- `nameForEmail()` trims the stored name (a seeded policyholder name had a leading space, which also blanked the menu greeting).

Verified live 2026-10-07 up to the filled-in form (all 16 answers and the inline photo read, AI extraction via the Gemini fallback model). Not yet verified live: `CONFIRM` → claim creation, reminders/expiry.
