> Inferred type: **generic** (small additions to two `frontend/portal` pages plus a two-field serializer change in `backend/api` — no db/bpmn/dmn/worker work)

# generic/task-page-claim-details

**Status:** Locked (2026-10-05)

## Purpose

`SPEC.md` §14 backlog: *"Direct link to user-submitted form. Reviewer task details (`/tasks/:key`) and claim views (`/claims/:id`) gain an accessible reference link back to the claimant's originally submitted form/data, not just the extracted summary."*

Investigated 2026-10-05:
- The link already exists — the task page has "View full submission ↗" to `/claims/:id` (new tab).
- The claim page already shows almost everything filed. Three filed fields appear nowhere: the provider's **facility address**, the claimant's **phone**, and the **channel** it came through (`claimant_phone` and `channel` weren't even serialized).
- The real friction is on the **task page**: a reviewer sees the case summary, incident description, risk score and documents, but not the diagnosis/procedure codes, service dates, amounts, other coverage or provider — they have to open the claim page in another tab to decide.
- No later step overwrites claimant-entered `claims` columns (every `UPDATE claims` touches only status/routing/AI/decision/settlement columns), so the claims row is the submission as filed; nothing new needs storing.

## Scope

**In scope**
- `serializeClaim` returns `claimantPhone` and `channel`; the `Claim` type gains them.
- Claim page (`/claims/:id`): *Provider* card adds **Facility address**; *Claimant & policy* card adds **Phone** (when present) and **Filed via** (Portal / WhatsApp).
- Task page (`/tasks/:key`): a **Claim details** card after *Case summary* — claim type, incident date, diagnosis code, procedure code, service date(s), requested amount, total billed, other coverage, provider (facility + NPI), filed via. The existing "View full submission ↗" link is unchanged.

**Out of scope**
- A separate "as submitted" section or page on the claim view — built briefly, then dropped at the user's direction because it repeated what the page already shows (see Decisions).
- Distinguishing portal-chat submissions from the portal form (that's only in the staff audit log's `submitted` row).

## Design

- `GET /api/tasks/:key` serializes the claim without the provider join, so the task page takes `provider` from the `GET /api/claims/:id` fetch it already makes for documents. Until that returns, Provider shows "—".
- No new endpoints or access changes: the task page is staff-only and candidate-group checked; the claim page's API already limits claimants to their own claims.

## Decisions at Lock (2026-10-05)

1. **No duplicate "as submitted" section.** First built as an anchored section on `/claims/:id`; the user pointed out the details are already on the page, so it was replaced by adding only the three missing fields to the existing cards.
2. **Claim details on the task page** — the user agreed that's where reviewers actually lack the filed data.

## Build notes

- **Built 2026-10-05.** `serializers.ts` (`claimantPhone`, `channel`), `lib/types.ts`, `app/claims/[id]/page.tsx` (three rows), `app/tasks/[key]/page.tsx` (`ClaimDetails` card, `provider` state from the existing full-claim fetch).
- **Verified 2026-10-05** in the browser as `admin1@claimflow.test`: claim `fb240b16`'s page shows Facility address and "Filed via Portal" and no duplicate section; task `2251799813722981` (Validation Exception Review, claim `c0d11dc8`) shows the Claim details card with codes, service date, amounts, COB, provider "City General Hospital (NPI 1928374650)" from the full-claim fetch, and "Filed via Portal". API: a WhatsApp claim serializes `channel: "whatsapp"` with its phone.
