-- ClaimFlow AI: ditch the auto-assigned-claim-amount feature (management
-- decision) — drops deductible_amount, copay_amount, and coinsurance_rate
-- from policies, added in 0004_add_policy_adjudication_fields.sql. Forward
-- migration rather than editing/deleting 0004, per SPEC.md's "Migration
-- tooling" note (forward-only, no rollback tooling). coverage_amount and
-- premium_amount (0003) stay — coverage_amount is still the ceiling on
-- claims.claim_amount, just via a plain <= check instead of adjudication.

ALTER TABLE policies
  DROP COLUMN deductible_amount,
  DROP COLUMN copay_amount,
  DROP COLUMN coinsurance_rate;
