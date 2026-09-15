> Inferred type: **generic** (spans a new admin UI, a new data-model concept, and a role-based rendering question — no single db/bpmn/dmn/worker/api section covers it, and nothing here is decided enough yet to write a concrete db/api spec)

# generic/dynamic-form-builder

**Status:** Draft

## Purpose

`SPEC.md` §14's backlog already has a "Dynamic form for claim creation" one-liner — but that item, as originally scoped, assumed *engineers* pick which fields vary by `claimType`/`insuranceType` ahead of time (a config-driven form, still hardcoded at build time). What the user actually described in chat is materially bigger: an **admin**, from the UI only, at *runtime*, defines which fields exist, sets conditions on them (show/hide logic), and configures which generated form a given viewer sees — with different roles (and the claimant) each potentially seeing a different form built from the same admin configuration. That's a form-builder plus a small rules engine, not a config file. This spec tracks that larger feature separately from the original backlog line, which it supersedes in ambition if not yet in detail.

This is genuinely early-stage — the user asked for a placeholder to return to, not a finished design. Field types, condition semantics, and exactly which forms this covers are all still open (see Open Questions); this draft exists to capture the shape of the problem and the constraints already surfaced in chat, not to lock in a solution.

## Scope

**Likely in scope** (subject to the Open Questions below):
- An admin-facing UI for defining a form: adding fields, choosing field types, and setting conditions that control which fields show for a given answer.
- Associating a defined form (or a per-field visibility rule within one) with a role — so the claimant, and each staff role, can see a differently-shaped form built from one underlying configuration rather than one fixed field set for everyone.
- A submission path that stores answers against whatever the admin configured, not a fixed set of named columns — see Design.

**Likely out of scope** (leaning this way, not yet confirmed):
- Changing `POST /api/claims`'s existing required-field validation (ICD-10/CPT-HCPCS/NPI patterns, the current required-field list) — those stay as the baseline contract for however a claim ultimately gets created, at least until this feature is further along.
- Applying this to the BPMN-driven reviewer decision forms (`TriageReviewForm`, `ReviewDecisionForm`, `ValidationExceptionForm` in `frontend/portal/app/tasks/[key]/page.tsx`) in a first pass — those forms produce named process variables (`decision`, `confirmedRole`, `denialReason`, `resolutionAction`) that `process/claim-case-process.bpmn` and the `capture-*` job workers (`backend/workers/`) expect by fixed name. Making *those* dynamic means the BPMN process itself would need to consume arbitrary field names, which is a much deeper change than a form-builder UI touching claim intake alone. Whether this feature ever reaches that far is Open Question 2 below.

## Design (sketch only — expect this to change once Open Questions resolve)

### Where submitted answers would live

Claim fields today are fixed named columns on `claims` (`diagnosis_code`, `procedure_code`, `claim_amount`, etc.), validated by hardcoded logic in `backend/api/src/routes/claims.ts`. An admin-defined, runtime-variable field set can't map onto fixed columns — this almost certainly needs a **template/response split**:
- A new table (e.g. `form_templates`) holding the admin's field definitions and conditions — field name, type, whether required, and whatever condition logic controls its visibility.
- Submitted answers stored as a `jsonb` blob per submission rather than one column per field — there's already a precedent for this shape in the schema (`claim_documents.extracted_data` is jsonb), so this isn't a new pattern for the app, just a new table using it.

### Role-scoped resolution

"Configured to be used by different roles" implies a form template (or per-field rule within one) is associated with one or more roles, and the correct rendering is resolved per viewer — hooking into the existing `Role` type and `STAFF_ROLES` (`backend/api/src/auth.ts`, `.claude/specs/generic/auth-role-based-access.md`) rather than inventing a separate role concept.

### What's genuinely undecided

Everything else — see Open Questions. No field-type set, condition model, or validator system is proposed here; this section only captures the one data-model consequence (template/response split) that seems unavoidable regardless of how the rest is decided.

## Open Questions

1. **Field types and condition model** — what field types can an admin choose from (text, number, date, dropdown, file, others?), and how do conditions work: a simple per-field "show field B only if field A = X" rule, or something more expressive (multi-condition, cross-field logic, computed defaults)? The user will provide details later — this is the biggest undecided piece and shapes almost everything else in Design.
2. **Scope boundary — intake only, or reviewer forms too?** Making the claimant-facing intake form (`ClaimForm.tsx` / `POST /api/claims`) dynamic is a UI/data-model problem. Making the staff reviewer decision forms dynamic is a BPMN-process problem too, since those forms currently produce fixed-name process variables the Zeebe workflow depends on. Confirm which this feature is meant to cover before design goes further — the two are not the same size of change.
3. **Validation for admin-defined fields** — freeform (admin trusts their own config, no built-in validation beyond required/optional), or a constrained set of validator types an admin can attach to a field (e.g. "must match this regex," "must be one of these options")? Affects how much of `POST /api/claims`'s current hardcoded-validation approach can coexist with admin-defined fields versus needing its own validation layer.
4. **Relationship to the existing insurance-type extension pattern** (`SPEC.md` §3, `backend/shared/insurance-types/`) — is this feature meant to eventually replace/subsume that config-module pattern for driving per-type fields, or are they meant to coexist (engineer-defined base fields per insurance type, admin-defined additional fields on top)? Not discussed yet.
5. **Versioning and in-flight claims** — if an admin changes a form template after claims have already been submitted against the old version, what happens to those older claims' data shape? Not discussed; likely needs some notion of a template version stored alongside each submission once this is designed further.

## Follow-up dependencies

- None yet — this is a placeholder draft. Revisit once the user provides the field-type/condition details mentioned in chat; expect a substantial rewrite of Design at that point, not just filling in these Open Questions.
