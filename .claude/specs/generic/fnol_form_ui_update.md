# generic/fnol_form_ui_update

**Status:** Draft

Companion to `.claude/specs/db/fnol_extended_fields.md` — that spec adds the new `providers` table and new `claims` columns this one collects from the claimant. Field names below are chosen to match that spec's column names exactly (camelCased, same convention `NewClaimInput` already uses for `claimAmount` → `claim_amount`, etc.) so the request body `ClaimForm` sends lines up one-to-one with what `POST /api/claims` will insert. If the db spec's column names change before lock, this spec's field names must change with them.

## Purpose

Extends the existing claim submission wizard (`frontend/portal/components/ClaimForm.tsx`, designed in `.claude/specs/generic/claimant-portal-ui.md` Page 2) to capture the FNOL fields a real health claim needs and doesn't today: diagnosis code, procedure code, provider identity, service date(s), total billed amount, coordination-of-benefits, and claimant attestation. Today's form captures only `claimType`, `incidentDate`, `incidentDescription`, and `claimAmount` — enough to route and pay a claim, but not enough to actually adjudicate one against a real CMS-1500-style bill.

## Scope

**In scope:**
- New fields on the claim submission wizard (`/claims/new`) for every column added in `db/fnol_extended_fields.md`, except `providers.id`/`createdAt`/`updatedAt` and `claims.provider_id`/`attestationSignedAt` (all system-set, not claimant-typed — see Design).
- Client-side format/required validation for the new fields, mirroring (not replacing) whatever the `validate-claim` worker or `POST /api/claims` ends up checking server-side — same relationship the existing fields already have (`claimant-portal-ui.md`'s Page 2 Validation note).
- A restructured step order to fit the new fields in without turning any one step into an unscannable wall of inputs.
- The claimant attestation checkbox's UI/copy (the *statement* the claimant agrees to — the resulting `attestationSignedAt` timestamp itself is server-set, per the db spec, not a field this UI collects).
- Updates to the Review step's summary and to the claim detail page (`/claims/[id]`) so the new fields are visible after submission, not just at intake.

**Out of scope (for this spec):**
- The `providers` find-or-create logic and its collision handling (same NPI, different facility details) — that's `POST /api/claims`'s behavior, not a UI concern; flagged as an open question in the db spec (#2), not resolved here.
- ICD-10/CPT/HCPCS code *lookup* (an autocomplete against a real code dictionary) — no such dictionary exists in this project. This spec only validates *format*, not that the code is a real, currently-valid ICD-10/CPT code.
- Any change to `claimType`, `incidentDate`, `incidentDescription`, `claimAmount`, or the Policy/Documents steps — unchanged from `claimant-portal-ui.md`.
- Whether/how `totalBilledAmount` feeds AI risk scoring — that's the db spec's Open Question #1, a backend/worker concern, not a form-design one.

## Design

### New fields

| Field | Maps to (db spec) | Input type | Required | Validation |
|---|---|---|---|---|
| `diagnosisCode` | `claims.diagnosis_code` | Text input | Yes | ICD-10 shape: `[A-TV-Z][0-9][0-9AB](\.[0-9A-TV-Z]{1,4})?`, case-insensitive entry auto-uppercased on blur. Client-side regex check only — see Scope. |
| `procedureCode` | `claims.procedure_code` | Text input | Yes | CPT (5 digits) **or** HCPCS Level II (1 letter + 4 digits) — accept either shape: `^\d{5}$` or `^[A-Z]\d{4}$`, auto-uppercased on blur. |
| `providerNpi` | `providers.npi` | Text input, `inputMode="numeric"`, `maxLength=10` | Yes | Exactly 10 digits, non-digit characters stripped as typed (same defensive pattern as `ClaimForm`'s existing amount inputs). Matches the `providers.npi` DB CHECK exactly, so a client-valid NPI can never fail that constraint server-side. |
| `providerTaxId` | `providers.tax_id` | Text input | Yes | Non-empty; format hint shown (`##-#######`) but not hard-enforced client-side, matching the db spec's decision not to DB-constrain this field's shape either. |
| `facilityName` | `providers.facility_name` | Text input | Yes | Non-empty. |
| `facilityAddress` | `providers.facility_address` | Text input (single line, not textarea) | Yes | Non-empty. Matches the db spec's single free-text column — no street/city/state/zip decomposition. |
| `serviceDateFrom` | `claims.service_date_from` | Date picker | Yes | Not in the future (same rule already applied to `incidentDate`). |
| `serviceDateTo` | `claims.service_date_to` | Date picker, **conditionally shown** | Conditional — see below | When shown: must be on or after `serviceDateFrom` (mirrors the DB CHECK). |
| `totalBilledAmount` | `claims.total_billed_amount` | Currency number input | Yes | > 0. No relationship enforced client-side against `claimAmount` (they're allowed to differ — see Design note below). |
| `coordinationOfBenefits` | `claims.coordination_of_benefits` | Yes/No toggle (not a plain checkbox — see below) | Yes, must be explicitly answered | Boolean; no default pre-selected in the UI even though the DB column defaults `false` — see Design note. |

**`serviceDateTo` visibility — resolves the db spec's Open Question #3.** Shown (and required) only when `claimType` is `inpatient` or `maternity` — the two types where a multi-day stay is the norm. For `outpatient`, `pharmacy`, `dental`, and `other`, only `serviceDateFrom` is shown; the form sets `serviceDateTo` equal to `serviceDateFrom` before submit, matching the db spec's "app sets it equal... rather than relying on a DB default" note. This means `serviceDateTo` is effectively never actually NULL by the time a claim reaches `POST /api/claims`, even though the column allows it.

**`coordinationOfBenefits` as an explicit toggle, not a pre-checked/unchecked checkbox.** A checkbox defaulting to unchecked silently answers "no" for a claimant who never engages with it — real FNOL forms ask this as a question that must be affirmatively answered either way, since "does the claimant have other coverage" materially affects claim processing. Render as two options (Yes / No) with neither pre-selected, and block advancing past this step until one is chosen. This is stricter than the underlying column (`NOT NULL DEFAULT false`), which is a DB-level fallback for data integrity, not license to skip asking in the UI.

**`totalBilledAmount` vs. the existing `claimAmount` ("Requested claim amount") field — shown together, explicitly distinguished.** Both are dollar amounts on the same step; without a clear distinction a claimant will reasonably assume they're the same number entered twice. Each gets its own hint text: `totalBilledAmount` — "The full amount the provider billed for this visit"; `claimAmount` — "What you're requesting from this claim (must be ≤ your policy's coverage amount)" (existing hint, unchanged). No client-side rule requires one to be ≥ the other — the db spec's Open Question #1 leaves whether that relationship should even be enforced unresolved, so this UI doesn't invent an enforcement it wasn't asked for.

### Provider fields aren't a policy-style lookup

Unlike `policyNumber` (a `PolicySelect` dropdown/typeahead sourced from `GET /api/policies` — an existing, pre-seeded list), `providerNpi`/`providerTaxId`/`facilityName`/`facilityAddress` are **plain text inputs**, not a dropdown against `GET /api/providers` or similar. There's no provider-lookup endpoint in scope here (out of scope, above) — the claimant simply types in their provider's details, and `POST /api/claims` resolves them into `providers` server-side (find-or-create by NPI, per the db spec). A future spec could add a provider-typeahead once enough real providers exist in the table to make one useful, the same way `PolicySelect` only makes sense because `policies` is pre-seeded — not proposed here.

### Step restructuring

Today: **Policy → About the incident → Documents → Review** (4 steps, `claimant-portal-ui.md` Page 2). The 8 new fields don't fit cleanly into any existing step without making one of them significantly denser than the others (`About the incident` already holds 5 fields). Proposed:

**Policy → About the incident → Diagnosis, Procedure & Provider (new) → Documents → Review** (5 steps)

The new step holds all 8 new fields as one screen: `diagnosisCode`, `procedureCode`, `serviceDateFrom` (+ conditional `serviceDateTo`), `totalBilledAmount`, `coordinationOfBenefits`, then `providerNpi`/`providerTaxId`/`facilityName`/`facilityAddress` grouped visually (e.g. a labeled sub-section "Provider / facility") since those four are conceptually one unit distinct from the claim-detail fields above them. One new step was chosen over two (e.g. splitting "claim details" from "provider details") to avoid growing the wizard from 4 steps to 6 — flagged as an Open Question below since it's a legitimate UX call either way.

Client-side validation on this step before advancing mirrors the existing pattern: all required fields must be non-empty and pass their format check, exactly like `claimant-portal-ui.md`'s existing "Required-field checks client-side per step before advancing" rule.

### Attestation

The Review step (last step, unchanged position) gains a required checkbox above the Submit button: **"I attest that the information provided in this claim is true and accurate to the best of my knowledge."** Submit stays disabled until checked — same enable/disable pattern the wizard already uses for `disabled={submitting}` on that button. This checkbox does **not** map to a form field sent to the API; per the db spec, `attestationSignedAt` is set by the backend at the moment `POST /api/claims` successfully inserts the row, not typed or timestamped client-side. The checkbox's only job is to gate the Submit action and give the claimant something concrete to agree to.

### Review step and claim detail page

The Review step's read-only summary (`ReviewSummary` in `ClaimForm.tsx`) gains a row for every new field, grouped under the existing rows in the same order they're collected. The claim detail page (`/claims/[id]`, `claimant-portal-ui.md` Page 3) gains matching `DetailRow`s for all nine persisted fields (`diagnosisCode`, `procedureCode`, `serviceDateFrom`, `serviceDateTo`, `totalBilledAmount`, `coordinationOfBenefits`, and the provider's `facilityName`/`npi`/`taxId` once `GET /api/claims/:id` includes the joined provider — an API-response-shape detail for whoever implements this, not decided here) — placed after the existing `incidentDescription` row and before `claimAmount`, matching the intake step order.

## Open Questions

1. **One new step vs. two.** Design above proposes a single "Diagnosis, Procedure & Provider" step (8 fields) rather than splitting claim-detail fields from provider fields into two separate steps (5 steps → 6). Bundling keeps the wizard shorter; splitting keeps each step lighter. Not resolved here — pick one before lock.
2. **NPI/tax ID formatting mask.** Should `providerNpi` auto-insert visual grouping while typing (e.g. `1234-567-890`-style chunking) the way some real intake forms do for scannability, or stay a plain 10-digit string with no separators? Cosmetic, but affects the input component's implementation. Not resolved here.
3. **`GET /api/claims/:id` response shape for provider fields.** The claim detail page needs the joined `providers` row (facility name, NPI, tax ID) alongside the claim — whether that's a nested `provider: {...}` object, flattened `provider*` keys, or a separate fetch is an API-shape decision that belongs with whoever implements the db spec's `provider_id` FK and the corresponding backend route change, not this UI spec. Flagged here only so it isn't dropped.
