# Worker: `draft-denial-letter`

**Status:** Draft

BUILD-PLAN.md feature #15. SPEC.md §12 job-worker contract (row 11). SPEC.md §10 step 16. ROADMAP.md step 4 (Job workers).

## Job type name

`draft-denial-letter`

## Input variables

| Variable | Type | Source |
|---|---|---|
| `claimId` | string (uuid) | process instance variable |
| `denialReason` | string | process instance variable, set by whichever upstream step denied the claim — `capture-validation-exception` (§10 step 3), `capture-triage-review` (§10 step 10, `"reject"` branch), or `capture-review-decision` (§10 step 13, `"deny"` decision) |
| `claimantName` | string | process instance variable, set at claim submission (`POST /api/claims`, §10's "Tasklist form template" note) |

## What it does

1. Calls Gemini (via `backend/shared/gemini-client.ts`, the same client used by `extract-evidence`, `detect-fraud-indicators`, and `score-risk`) to draft denial letter text addressed to `claimantName`, grounded in the stated `denialReason` — no invented reasons or claim details beyond what `denialReason` and basic claim identifiers provide. The prompt is a fixed template defined directly in `backend/workers/draft-denial-letter.ts` (not pulled from an insurance-type config — see "Insurance-type aware?" below).
2. No PDF generation or delivery in v1 (SPEC.md §14 future work) — text output only.
3. Writes `claims.denial_letter_text = denialLetterText` (new nullable text column — see Data model note below).
4. Writes one `audit_log` row (`actor_type = 'ai'`, `actor_id = 'draft-denial-letter'`, `action = 'denial_letter_drafted'`, `detail` = the letter text or a summary of it) — SPEC.md §13.

### Data model note

SPEC.md §9 has no `denial_letter_text` column today. This spec locks in adding one: `claims.denial_letter_text text NULL`, set only on the denied path once `draft-denial-letter` runs. Needs a corresponding `backend/db/migrations/` entry and a SPEC.md §9 update before/alongside implementation.

## Output variables

| Variable | Type | Meaning |
|---|---|---|
| `denialLetterText` | string | Gemini-drafted denial letter text |

## Insurance-type aware?

No — not listed among the insurance-type-aware workers in SPEC.md §12's closing note (`validate-claim`, `extract-evidence`, `detect-fraud-indicators` only). Denial letter drafting uses `denialReason` and `claimantName` directly, with no type-specific prompt template.

## AI-backed?

Yes — Gemini call, per SPEC.md §12's row for this worker.

## BPMN wiring (SPEC.md §10)

Reached from step 16, the denied path — merges three incoming flows (validation-exception rejection, triage rejection, role-specific-review deny decision) into a single **Service Task** `draft-denial-letter` → **Service Task** `notify-claimant` → **Service Task** `close-case` → **End Event** "Claim Denied".

## Failure handling

No custom error boundary — an unhandled exception (a Gemini call failure, malformed response, etc.) falls back to Zeebe's default 3-attempt retry, then an Operate incident (SPEC.md §12, top note).

## Open Questions

Resolved:
- ~~Persist `denialLetterText` onto `claims`?~~ Yes — `claims.denial_letter_text`, see Data model note above.
- ~~Prompt template location?~~ Fixed template inline in `backend/workers/draft-denial-letter.ts`, see above.
