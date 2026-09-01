# Roadmap

Build order for ClaimFlow AI v1. Check items off as they're implemented.

- [x] **1. Database** — `claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log` tables + migrations (SPEC §8)
- [x] **2. Camunda process** — rebuild `claim-routing.dmn` and `claim-case-process.bpmn` to match SPEC §9–10, deploy to local Zeebe
- [x] **3. Backend API** — submit claim (`POST /api/claims`) and check status (`GET /api/claims/:id`)
- [x] **4. Job workers** — all eight: validate, extract evidence, detect fraud, score risk, settle (mocked), draft denial letter, notify (real, via Resend), close case
- [x] **5. Frontend** — claim submission form + claimant status page (React/Next.js)
- [ ] **6. Human review** — Tasklist candidate groups configured, triage → role review → sign-off walked through manually. Blocked on the open decision below (each candidate group can only be verified as `demo` today, not as a real distinct user).
- [ ] **7. End-to-end test** — see checklist below.
- [ ] **8. Future work (post-v1)** — see `BUILD-PLAN.md` "Phase 2: Future work from SPEC.md §14" (items #21–33, target 11-Sep). Starts only once steps 1–7 above are complete. Auth + role-based access + in-app task page (#21) is first in that phase; audit view (#33) depends on it for access control.

## Step 7 checklist (per SPEC.md §15's definition of done)

Verified live, 2026-08-31/09-01 (see `audit_log` trails and Operate for these process instances):
- [x] Auto/low-risk claim, adjuster-routed, confirmed by triage reviewer, approved
- [x] Fraud-indicator claim routes to investigator, approved (settlement + real Resend email confirmed)
- [x] High-value (>$50,000) claim routes to legal, denied by the legal reviewer
- [x] Triage reviewer overrides the AI's suggested role (`assignedRole != confirmedRole`, override logged), then the overridden-to reviewer denies
- [x] Triage reviewer rejects a claim outright (`triageAction=reject`) without a full role-specific review
- [x] Validation Exception Review: reject outright
- [x] Validation Exception Review: approve/resolve with **no** policy matched at all (deliberate override, `policy_id` stays `NULL` through the full pipeline)
- [x] Supervisor sign-off on a large (>$50,000) approved settlement
- [x] Every path above leaves a complete, correctly-ordered `audit_log` trail from intake to resolution

Still open:
- [ ] `moreInfo` outcome (Decision gateway's third branch, terminal end event per §14) — never exercised
- [ ] Investigator role specifically denying via role-specific review (adjuster and legal denial paths are confirmed on the same `capture-review-decision` code path; investigator-deny wasn't literally run, low risk but unconfirmed)
- [ ] A full walkthrough with real distinct Tasklist users per candidate group, not just `demo` claiming everything (depends on Step 6's open decision)

## Open decision before Step 6

The lightweight Docker Compose config has no Identity/Keycloak — just a single `demo` basic-auth user, so there's no real multi-user group membership to test role routing against. Decide before Step 6: switch to `docker-compose-full.yaml` for real users/groups, or accept `demo` claiming any task for now and defer this.
