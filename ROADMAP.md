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

The lightweight Docker Compose config has no Identity/Keycloak — just a single `demo` basic-auth user, so there's no real multi-user group membership to test role routing against. Every Tasklist action is performed as `demo` regardless of which candidate group a task is actually restricted to; Camunda enforces nothing here, since there's no identity provider to check against.

Three options, discussed 2026-09-02:

1. **`docker-compose-full.yaml` locally** — adds real Identity/Keycloak, giving native multi-user login/logout to test candidate-group routing as distinct real users. Note the memory cost is the Identity/Keycloak containers running at all (roughly fixed), not the number of users created — a handful of user accounts costs kilobytes in Keycloak's own DB, it's not "per-user" overhead. Still, on this machine — which already hit ~1.2GB free host RAM and a 694% CPU spike on the `orchestration` container from ordinary load tonight (see chat history 2026-09-02) — adding more containers locally means more of that same pressure, not less.
2. **Camunda SaaS** — sign up for a hosted cluster (free trial tier available) and point `ZEEBE_GRPC_ADDRESS`/`ZEEBE_REST_ADDRESS`/OAuth credentials in `backend/api/.env` and `backend/workers/.env` at it instead of `localhost` (config-only change, `@camunda8/sdk` already supports both). Gets real multi-user Identity out of the box, and — unlike option 1 — moves the engine's CPU/memory load off this machine entirely, directly solving tonight's resource problems rather than adding to them. Trade-offs: needs an internet connection and a Camunda account; also moves off `PREREQUISITES.md`/`RUNNING-LOCALLY.md`'s current "local Docker Compose only" assumption, which would need updating.
3. **Option B / app-level auth (SPEC.md §14)** — skip Camunda-native identity entirely. Keep the lightweight stack (`demo` credential stays server-side only, never exposed to end users), and build this app's own `users` table + login as the real access-control boundary, with `backend/api` proxying Tasklist actions (`GET /api/tasks`, `POST /api/tasks/:key/claim`/`:key/complete`) after mapping the caller's app role to a candidate group. This is the same "Auth + role-based access + in-app task page" item already scoped in SPEC.md §14 / BUILD-PLAN.md #21 — so picking this effectively pulls that Phase 2 item forward instead of treating it as separate work.

Still undecided as of 2026-09-02 — pick one before Step 6.
