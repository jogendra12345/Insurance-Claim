-- ClaimFlow AI: add policies table, backing the previously-mocked policy lookup
-- in the validate-claim worker (SPEC.md §12). See .claude/specs/db/database-setup.md
-- and SPEC.md §9 for the source spec.
-- claims.policy_number is kept as-is (what the claimant/API submitted); the new
-- claims.policy_id links to the authoritative policies row. Nullable so existing
-- claims (submitted before a policy match existed) remain valid.

CREATE TABLE policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_number     text NOT NULL,
  carrier_id        uuid NOT NULL,
  insurance_type    text NOT NULL DEFAULT 'health',
  policyholder_name text NOT NULL,
  status            text NOT NULL
                      CHECK (status IN ('active', 'lapsed', 'cancelled')),
  effective_date    date NOT NULL,
  expiry_date       date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_policies_policy_number UNIQUE (policy_number)
);

CREATE INDEX idx_policies_carrier_id ON policies (carrier_id);

ALTER TABLE claims
  ADD COLUMN policy_id uuid REFERENCES policies (id) ON DELETE RESTRICT;

CREATE INDEX idx_claims_policy_id ON claims (policy_id);
