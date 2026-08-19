---
name: add-insurance-type
description: Scaffold a new insurance-type extension per SPEC.md §3 — a backend/shared/insurance-types/<type>.ts config module and a matching process/<type>-claim-routing.dmn skeleton
argument-hint: "[type]"
---

## What this does

Adds the extension points `SPEC.md` §3 describes for a new insurance line (e.g. `vehicle`, `property`, `travel`) — never touches the BPMN process, since §3 is explicit that the process is insurance-type-agnostic and only worker content and the DMN table selection vary by type.

## Steps

1. Parse `$ARGUMENTS` as `[type]` (e.g. `vehicle`). If missing, stop and ask for it.
2. Read `SPEC.md` §3 (Insurance-type extensibility) and §11 (DMN — `health-claim-routing-decision`) in full — these define exactly what's supposed to vary per type and what must stay identical.
3. Read the existing `backend/shared/insurance-types/health.ts` and `process/health-claim-routing.dmn` if they exist, and mirror their structure/naming for the new type. If they don't exist yet, build against the minimal shape §3 describes (required fields, expected document types, Claude prompt template) and clearly comment that this is a first-of-its-kind scaffold, not copied from a working example.
4. Check whether `backend/shared/insurance-types/<type>.ts` or `process/<type>-claim-routing.dmn` already exist. If either does, stop and ask before overwriting.

## `backend/shared/insurance-types/<type>.ts`

Per §3's second bullet, this config module must define, at minimum:
- Required fields for a claim of this type (placeholder list — do not invent domain-specific field names beyond what's generically implied; mark them `// TODO: define required fields for <type> claims`).
- Expected document types for this type (placeholder list, same caveat).
- A Claude prompt template placeholder for this type's evidence-extraction/fraud-detection steps.

Keep the exported shape consistent with `health.ts` if it exists (same field names, same export style) so `backend/workers/*.ts` can load either module interchangeably via `insuranceType`.

## `process/<type>-claim-routing.dmn`

Per §11, mirror the health table exactly in structure, changing only the table/decision id and leaving thresholds as placeholders to tune later:
- Same hit policy: **FIRST**.
- Same inputs: `fraudIndicatorCount`, `riskScore`, `claimAmount`, `claimType`. Same output: `assignedRole`.
- Same rule shape as the health table (fraud-indicator catch, high-claim-amount → legal, risk-score → adjuster, mid-claim-amount → adjuster, catch-all → auto) — but numeric thresholds must be clearly marked as placeholders (e.g. an XML comment `<!-- TODO: tune thresholds for <type> before use -->` near each `<inputEntry>`), not silently reused from health's tuned values as if they were correct for this type.
- Decision id follows the naming convention from §3/§11: `<type>-claim-routing-decision`.
- Valid DMN 1.3 XML that Camunda Modeler can open — don't hand-wave the XML structure.

## Hard constraint

**Never modify `process/claim-case-process.bpmn`.** If the request (or anything discovered while scaffolding) seems to require a BPMN change — e.g. a type-specific process step, a new gateway branch, a different candidate group — stop and flag it explicitly as a spec-level conflict with §3's "the BPMN process is insurance-type-agnostic" design decision, rather than making the edit. That needs a human decision about whether §3's premise still holds, not a silent workaround.

## After scaffolding

Draft the `SPEC.md` §3 update this addition implies (e.g. adding the new type to the "later insurance lines" list, or to §14's "Additional insurance types" future-work bullet if it's meant to stay unshipped for now) — but do not apply it. Show the user the exact diff and let them review before it's edited into `SPEC.md`.
