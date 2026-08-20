# db/database-setup

**Status:** Locked

> Note: this spec covers the initial database setup as a whole (Roadmap step 1: `claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log`) rather than a single table, since that's what "database setup" refers to in `ROADMAP.md`. Each table is broken out below in the same Purpose / Columns / Constraints / Relationships / Indexes shape used for a single-table db spec, per `SPEC.md` §9.
>
> Updated 2026-08-19 to match `SPEC.md`'s insurance-type extensibility rewrite (§3): `claims` gained `insurance_type`, and the `claim_type`/`document_type` enumerations below are health-specific. Amended in place rather than as a follow-on migration, since nothing had been applied to a live database yet.
>
> Updated 2026-08-20: added `policies` (this spec's fifth table) and `claims.policy_id`, backing what `SPEC.md` §12's `validate-claim` worker had previously described as a mocked policy lookup — that description is now updated to a real lookup. Shipped as a follow-on migration (`0002_add_policies.sql`), since `0001` was already applied to the running dev database.

## Purpose

Stand up the core Postgres tables that back the claims process end to end — the claim record itself, its uploaded documents, AI-flagged fraud indicators, the durable audit trail, and the policy each claim is checked against — exactly as defined in `SPEC.md` §9. This is the first roadmap item; the BPMN process, job workers, and API all depend on this schema existing before they can be built.

---

## Table: `claims`

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL (PK) | — |
| `carrier_id` | uuid | NOT NULL | — |
| `insurance_type` | text | NOT NULL | `'health'` |
| `policy_number` | text | NOT NULL | — |
| `policy_id` | uuid | NULL (FK → `policies.id`) | — |
| `claim_type` | text | NOT NULL | — |
| `claimant_name` | text | NOT NULL | — |
| `claimant_email` | text | NOT NULL | — |
| `incident_date` | date | NOT NULL | — |
| `incident_description` | text | NOT NULL | — |
| `claim_amount` | numeric | NOT NULL | — |
| `status` | text | NOT NULL | — |
| `case_summary` | text | NULL | — |
| `risk_score` | numeric | NULL | — |
| `fraud_indicator_count` | integer | NOT NULL | `0` |
| `assigned_role` | text | NULL | — |
| `confirmed_role` | text | NULL | — |
| `decision` | text | NULL | — |
| `denial_reason` | text | NULL | — |
| `process_instance_key` | text | NULL | — |
| `created_at` | timestamptz | NOT NULL | `now()` |
| `updated_at` | timestamptz | NOT NULL | `now()` |

### Constraints

- `insurance_type` unconstrained (no CHECK) — v1 only sets `'health'`, but this column is deliberately open so a new type (e.g. `vehicle`) is additive and doesn't require a migration to unlock (`SPEC.md` §3).
- `claim_type` restricted to: `outpatient`, `inpatient`, `pharmacy`, `dental`, `maternity`, `other` (health sub-categories; a new insurance type would need its own values added here).
- `status` restricted to: `submitted`, `validating`, `triage`, `in_review`, `approved`, `denied`, `awaiting_info`.
- `decision`, when set, restricted to: `approve`, `deny`, `moreInfo`.
- `assigned_role` / `confirmed_role`, when set, restricted to: `adjuster`, `investigator`, `legal`, `auto`.

### Relationships

- Referenced by `claim_documents.claim_id`, `claim_fraud_indicators.claim_id`, `audit_log.claim_id` — all `ON DELETE CASCADE` (a claim's child rows have no meaning without the claim).
- `policy_id` → `policies.id`, `ON DELETE RESTRICT` (a policy can't be deleted while a claim still references it). Nullable — `validate-claim` sets it once a matching policy is found; `policy_number` alone (as submitted) doesn't guarantee a match.

### Indexes

- `idx_claims_carrier_id` on `carrier_id` — carrier-scoped queries will be the primary access pattern once tenant isolation lands (§14), and MGA/TPA dashboards filter by carrier today even without enforcement.
- `idx_claims_status` on `status` — Tasklist-adjacent dashboards and the claimant status endpoint filter/poll by status.
- `idx_claims_process_instance_key` on `process_instance_key` — worker callbacks and audit correlation look up a claim by its Zeebe process instance key.
- `idx_claims_policy_id` on `policy_id` — `validate-claim` sets it and later reads may join back to `policies`.

---

## Table: `policies`

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL (PK) | — |
| `policy_number` | text | NOT NULL (UNIQUE) | — |
| `carrier_id` | uuid | NOT NULL | — |
| `insurance_type` | text | NOT NULL | `'health'` |
| `policyholder_name` | text | NOT NULL | — |
| `status` | text | NOT NULL | — |
| `effective_date` | date | NOT NULL | — |
| `expiry_date` | date | NOT NULL | — |
| `created_at` | timestamptz | NOT NULL | `now()` |
| `updated_at` | timestamptz | NOT NULL | `now()` |

### Constraints

- `policy_number` is unique — one policy row per policy number (`uq_policies_policy_number`).
- `status` restricted to: `active`, `lapsed`, `cancelled`.
- `insurance_type` unconstrained, same rationale as `claims.insurance_type` (`SPEC.md` §3).

### Relationships

- Referenced by `claims.policy_id`, `ON DELETE RESTRICT`.

### Indexes

- `idx_policies_carrier_id` on `carrier_id` — carrier-scoped policy lookups, same access pattern as `claims`.
- Unique constraint on `policy_number` doubles as its lookup index (`validate-claim` looks up by `policy_number` + `carrier_id`).

---

## Table: `claim_documents`

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL (PK) | — |
| `claim_id` | uuid | NOT NULL (FK → `claims.id`) | — |
| `file_url` | text | NOT NULL | — |
| `document_type` | text | NULL | — |
| `extracted_data` | jsonb | NULL | — |
| `created_at` | timestamptz | NOT NULL | `now()` |

### Constraints

- `document_type`, when set, restricted to: `medical_bill`, `discharge_summary`, `prescription`, `other` (health-specific).

### Relationships

- `claim_id` → `claims.id`, `ON DELETE CASCADE`.

### Indexes

- `idx_claim_documents_claim_id` on `claim_id` — every read of a claim's documents (evidence-extraction worker, reviewer view) is scoped by claim.

---

## Table: `claim_fraud_indicators`

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL (PK) | — |
| `claim_id` | uuid | NOT NULL (FK → `claims.id`) | — |
| `type` | text | NOT NULL | — |
| `description` | text | NOT NULL | — |
| `confidence` | numeric | NOT NULL | — |
| `created_at` | timestamptz | NOT NULL | `now()` |

### Constraints

- `confidence` expected in `[0, 1]` (app-level check; not enforced as a DB CHECK in v1 unless the reviewing engineer wants one).

### Relationships

- `claim_id` → `claims.id`, `ON DELETE CASCADE`.

### Indexes

- `idx_claim_fraud_indicators_claim_id` on `claim_id` — the `detect-fraud-indicators` worker and DMN routing both read all indicators for one claim; also drives `claims.fraud_indicator_count`.

---

## Table: `audit_log`

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL (PK) | — |
| `claim_id` | uuid | NOT NULL (FK → `claims.id`) | — |
| `actor_type` | text | NOT NULL | — |
| `actor_id` | text | NULL | — |
| `action` | text | NOT NULL | — |
| `detail` | jsonb | NULL | — |
| `created_at` | timestamptz | NOT NULL | `now()` |

### Constraints

- `actor_type` restricted to: `system`, `ai`, `human`.

### Relationships

- `claim_id` → `claims.id`, `ON DELETE CASCADE`.

### Indexes

- `idx_audit_log_claim_id` on `claim_id` — reconstructing a claim's full case history (SPEC.md §13) is the primary read pattern, and every worker/user-task handler writes here.
- `idx_audit_log_created_at` on `created_at` — supports chronological/paginated audit views without a full scan as the table grows.

---

## Migration

Implemented as `backend/db/migrations/0001_initial_schema.sql` (the original four tables) and `0002_add_policies.sql` (`policies` + `claims.policy_id`), applied via `backend/db/run-migrations.sh` (raw SQL, no ORM, forward-only, tracked in a `schema_migrations` table). Rationale recorded as an ADR in `SPEC.md` §9 "Migration tooling" — schema is small and stable, raw SQL is more reliably correct here than an ORM migration DSL, and no rollback tooling is needed yet since dev resets via drop/recreate.

Numbering convention: `NNNN_description.sql`, zero-padded to 4 digits, starting at `0001`.
