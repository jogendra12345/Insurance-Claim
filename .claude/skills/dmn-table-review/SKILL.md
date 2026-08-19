---
name: dmn-table-review
description: Compare a DMN file's actual rules against the routing table documented in SPEC.md §11 — hit policy, inputs/outputs, and each rule's thresholds in priority order
argument-hint: "[dmn-file-path]"
---

## What this does

Verifies a `.dmn` file matches what `SPEC.md` §11 documents for its routing decision table, row by row, so the deployed DMN and the spec can't silently drift apart.

## Steps

1. Parse `$ARGUMENTS` as a DMN file path (e.g. `process/health-claim-routing.dmn`). If missing, stop and ask for it.
2. Read `SPEC.md` §11 in full — the documented table (as of this writing, `health-claim-routing-decision`): hit policy **FIRST**; inputs `fraudIndicatorCount`, `riskScore`, `claimAmount`, `claimType`; output `assignedRole`; and the 5 rules in priority order:
   1. `fraudIndicatorCount ≥ 1` → `investigator`
   2. `claimAmount > 50000` → `legal`
   3. `riskScore ≥ 40` → `adjuster`
   4. `claimAmount > 5000` → `adjuster`
   5. (catch-all) → `auto`
   - If reviewing a DMN for a different insurance type (e.g. `vehicle-claim-routing-decision`, added via the `add-insurance-type` skill), the comparison baseline is still §11's *structure* (hit policy, inputs, outputs, rule shape) per §3/§11's stated convention that new tables mirror the health one — but don't expect that table's specific thresholds to match health's, since those are meant to be tuned per type.
3. Parse the actual DMN file's decision table: its `hitPolicy` attribute, its `<input>`/`<output>` column definitions (variable names and order), and each `<rule>` row's `<inputEntry>`/`<outputEntry>` values, in document order (order matters under hit policy FIRST — first matching rule wins).
4. Compare field by field.

## What to report

For each mismatch, cite the specific row (by position, 1-indexed, matching the numbering above) and the concrete difference:
- **Hit policy mismatch** — DMN's hit policy differs from FIRST (or from the documented policy, if reviewing a non-health table).
- **Input/output mismatch** — a column present in one but not the other, wrong variable name, or wrong order.
- **Missing rule** — a rule documented in `SPEC.md` §11 with no corresponding row in the DMN file.
- **Extra rule** — a row in the DMN file with no corresponding entry in §11.
- **Wrong threshold** — a rule exists in both but the numeric/comparison value differs (e.g. DMN says `> 40000` where §11 says `> 50000`).
- **Wrong output** — a rule's condition matches but its `assignedRole` output differs.
- **Wrong priority order** — same set of rules present but in a different sequence, which matters under FIRST hit policy since it changes which rule actually wins for overlapping inputs.

Report as a table or list, one row per finding, with enough detail to fix without re-deriving it (exact expected vs. actual value). If everything matches, say so explicitly rather than staying silent. Do not modify the DMN file or `SPEC.md`.
