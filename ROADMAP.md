# Roadmap

Build order for ClaimFlow AI v1. Check items off as they're implemented.

- [x] **1. Database** — `claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log` tables + migrations (SPEC §8)
- [ ] **2. Camunda process** — rebuild `claim-routing.dmn` and `claim-case-process.bpmn` to match SPEC §9–10, deploy to local Zeebe
- [ ] **3. Backend API** — submit claim (`POST /api/claims`) and check status (`GET /api/claims/:id`)
- [x] **4. Job workers** — all eight: validate, extract evidence, detect fraud, score risk, settle (mocked), draft denial letter, notify (mocked), close case
- [ ] **5. Frontend** — claim submission form + claimant status page (React/Next.js)
- [ ] **6. Human review** — Tasklist candidate groups configured, triage → role review → sign-off walked through manually
- [ ] **7. End-to-end test** — auto-approved, investigator-routed, legal-routed, and denied claims all run clean with a full `audit_log` trail

## Open decision before Step 6

The lightweight Docker Compose config has no Identity/Keycloak — just a single `demo` basic-auth user, so there's no real multi-user group membership to test role routing against. Decide before Step 6: switch to `docker-compose-full.yaml` for real users/groups, or accept `demo` claiming any task for now and defer this.
