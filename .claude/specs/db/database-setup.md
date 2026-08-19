# db/database-setup

**Status:** Draft

> Note: this spec covers the initial database setup as a whole (Roadmap step 1: `claims`, `claim_documents`, `claim_fraud_indicators`, `audit_log`) rather than a single table, since that's what "database setup" refers to in `ROADMAP.md`. Each table is broken out below in the same Purpose / Columns / Constraints / Relationships / Indexes shape used for a single-table db spec, per `SPEC.md` §8.

## Purpose

Stand up the four core Postgres tables that back the claims process end to end — the claim record itself, its uploaded documents, AI-flagged fraud indicators, and the durable audit trail — exactly as defined in `SPEC.md` §8. This is the first roadmap item; the BPMN process, job workers, and API all depend on this schema existing before they can be built.

---

## Table: `claims`

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | NOT NULL (PK) | — |
| `carrier_id` | uuid | NOT NULL | — |
| `policy_number` | text | NOT NULL | — |
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

- `claim_type` restricted to: `property`, `injury`, `liability`, `total_loss`, `other`.
- `status` restricted to: `submitted`, `validating`, `triage`, `in_review`, `approved`, `denied`, `awaiting_info`.
- `decision`, when set, restricted to: `approve`, `deny`, `moreInfo`.
- `assigned_role` / `confirmed_role`, when set, restricted to: `adjuster`, `investigator`, `legal`, `auto`.

### Relationships

- Referenced by `claim_documents.claim_id`, `claim_fraud_indicators.claim_id`, `audit_log.claim_id` — all `ON DELETE CASCADE` (a claim's child rows have no meaning without the claim).

### Indexes

- `idx_claims_carrier_id` on `carrier_id` — carrier-scoped queries will be the primary access pattern once tenant isolation lands (§13), and MGA/TPA dashboards filter by carrier today even without enforcement.
- `idx_claims_status` on `status` — Tasklist-adjacent dashboards and the claimant status endpoint filter/poll by status.
- `idx_claims_process_instance_key` on `process_instance_key` — worker callbacks and audit correlation look up a claim by its Zeebe process instance key.

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

- `document_type`, when set, restricted to: `photo`, `police_report`, `receipt`, `other`.

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

- `idx_audit_log_claim_id` on `claim_id` — reconstructing a claim's full case history (SPEC.md §12) is the primary read pattern, and every worker/user-task handler writes here.
- `idx_audit_log_created_at` on `created_at` — supports chronological/paginated audit views without a full scan as the table grows.

---

## Migration

No migrations exist yet under `backend/db/migrations/` (directory not yet created). This spec maps to the first migration in that directory:

```
backend/db/migrations/0001_initial_schema.sql
```

Numbering convention assumed as `NNNN_description.sql`, zero-padded to 4 digits, starting at `0001` — no existing migrations to confirm this against, so treat as a proposal to confirm during Review & Lock, not a fixed convention yet.
