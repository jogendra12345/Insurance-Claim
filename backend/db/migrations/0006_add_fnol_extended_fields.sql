-- ClaimFlow AI: FNOL (claim intake) extended fields — diagnosis code,
-- procedure code, provider identity, service date(s), total billed amount,
-- coordination-of-benefits, claimant attestation timestamp. See
-- .claude/specs/db/fnol_extended_fields.md (Locked 2026-08-24) for the full
-- design, including why provider identity is its own table instead of being
-- flattened onto claims.

CREATE TABLE providers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  npi              text NOT NULL UNIQUE
                     CHECK (npi ~ '^[0-9]{10}$'),
  tax_id           text NOT NULL,
  facility_name    text NOT NULL,
  facility_address text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE claims
  ADD COLUMN provider_id             uuid REFERENCES providers (id) ON DELETE RESTRICT,
  ADD COLUMN diagnosis_code          text,
  ADD COLUMN procedure_code          text,
  ADD COLUMN service_date_from       date,
  ADD COLUMN service_date_to         date,
  ADD COLUMN total_billed_amount     numeric,
  ADD COLUMN coordination_of_benefits boolean NOT NULL DEFAULT false,
  ADD COLUMN attestation_signed_at   timestamptz;

-- Backfill the existing (pre-FNOL-extension) claims rows. One placeholder
-- provider stands in for "we don't know who actually treated these
-- claimants" — reuses each row's own incident_date/claim_amount/created_at
-- rather than one constant, so backfilled data stays internally plausible.
INSERT INTO providers (npi, tax_id, facility_name, facility_address)
VALUES ('0000000000', '00-0000000', 'Legacy Claim (pre-FNOL-extension)', 'Not recorded');

UPDATE claims
SET provider_id = (SELECT id FROM providers WHERE npi = '0000000000'),
    diagnosis_code = 'Z00.00',
    procedure_code = '99213',
    service_date_from = incident_date,
    service_date_to = incident_date,
    total_billed_amount = claim_amount,
    attestation_signed_at = created_at
WHERE provider_id IS NULL;

ALTER TABLE claims
  ALTER COLUMN provider_id SET NOT NULL,
  ALTER COLUMN diagnosis_code SET NOT NULL,
  ALTER COLUMN procedure_code SET NOT NULL,
  ALTER COLUMN service_date_from SET NOT NULL,
  ALTER COLUMN total_billed_amount SET NOT NULL,
  ALTER COLUMN attestation_signed_at SET NOT NULL;

ALTER TABLE claims
  ADD CONSTRAINT chk_claims_total_billed_amount_positive CHECK (total_billed_amount > 0),
  ADD CONSTRAINT chk_claims_service_date_to_after_from CHECK (service_date_to IS NULL OR service_date_to >= service_date_from);

CREATE INDEX idx_claims_provider_id ON claims (provider_id);
