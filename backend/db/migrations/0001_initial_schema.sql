-- ClaimFlow AI: initial schema (claims, claim_documents, claim_fraud_indicators, audit_log)
-- See .claude/specs/db/database-setup.md and SPEC.md §8 for the source spec.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id            uuid NOT NULL,
  policy_number         text NOT NULL,
  claim_type            text NOT NULL
                          CHECK (claim_type IN ('property', 'injury', 'liability', 'total_loss', 'other')),
  claimant_name         text NOT NULL,
  claimant_email        text NOT NULL,
  incident_date         date NOT NULL,
  incident_description  text NOT NULL,
  claim_amount          numeric NOT NULL,
  status                text NOT NULL
                          CHECK (status IN ('submitted', 'validating', 'triage', 'in_review', 'approved', 'denied', 'awaiting_info')),
  case_summary          text,
  risk_score            numeric,
  fraud_indicator_count integer NOT NULL DEFAULT 0,
  assigned_role         text
                          CHECK (assigned_role IN ('adjuster', 'investigator', 'legal', 'auto')),
  confirmed_role        text
                          CHECK (confirmed_role IN ('adjuster', 'investigator', 'legal', 'auto')),
  decision              text
                          CHECK (decision IN ('approve', 'deny', 'moreInfo')),
  denial_reason         text,
  process_instance_key  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claims_carrier_id ON claims (carrier_id);
CREATE INDEX idx_claims_status ON claims (status);
CREATE INDEX idx_claims_process_instance_key ON claims (process_instance_key);

CREATE TABLE claim_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       uuid NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  file_url       text NOT NULL,
  document_type  text
                   CHECK (document_type IN ('photo', 'police_report', 'receipt', 'other')),
  extracted_data jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_documents_claim_id ON claim_documents (claim_id);

CREATE TABLE claim_fraud_indicators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    uuid NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  type        text NOT NULL,
  description text NOT NULL,
  confidence  numeric NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_fraud_indicators_claim_id ON claim_fraud_indicators (claim_id);

CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id   uuid NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  actor_type text NOT NULL
               CHECK (actor_type IN ('system', 'ai', 'human')),
  actor_id   text,
  action     text NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_claim_id ON audit_log (claim_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);
