-- ClaimFlow AI: authorized-claimant check. Previously claims.claimant_name/
-- claimant_email were free-text with no check against the policy at all --
-- anyone who knew a policy number could file against it. See SPEC.md §9
-- "Authorized claimants (policy_dependents)" for the full design, including
-- why this models health-plan dependents (spouse/child), not life-insurance
-- nominees/beneficiaries.

ALTER TABLE policies
  ADD COLUMN policyholder_email text;

-- Backfill the existing (pre-authorized-claimant) policies rows with a
-- synthetic email derived from policyholder_name, since real contact data
-- was never collected for this dev seed data.
UPDATE policies
SET policyholder_email = lower(regexp_replace(policyholder_name, '\s+', '.', 'g')) || '@example.com'
WHERE policyholder_email IS NULL;

ALTER TABLE policies
  ALTER COLUMN policyholder_email SET NOT NULL;

CREATE TABLE policy_dependents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id    uuid NOT NULL REFERENCES policies (id) ON DELETE CASCADE,
  full_name    text NOT NULL,
  email        text NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('spouse', 'child', 'other')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, email)
);

CREATE INDEX idx_policy_dependents_policy_id ON policy_dependents (policy_id);
