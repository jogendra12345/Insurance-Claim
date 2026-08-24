-- ClaimFlow AI: add premium_amount and coverage_amount to policies, and
-- backfill dummy values onto the 10 seeded policies added in
-- 0002_add_policies.sql. coverage_amount is the ceiling a claim on this
-- policy must stay under -- enforced client-side (ClaimForm) and
-- server-side (POST /api/claims) once this migration lands.

ALTER TABLE policies
  ADD COLUMN premium_amount  numeric NOT NULL DEFAULT 0,
  ADD COLUMN coverage_amount numeric NOT NULL DEFAULT 0;

UPDATE policies SET premium_amount = 2400, coverage_amount = 50000  WHERE policy_number = 'POL-100001';
UPDATE policies SET premium_amount = 3200, coverage_amount = 75000  WHERE policy_number = 'POL-100002';
UPDATE policies SET premium_amount = 1800, coverage_amount = 40000  WHERE policy_number = 'POL-100003';
UPDATE policies SET premium_amount = 4200, coverage_amount = 100000 WHERE policy_number = 'POL-100004';
UPDATE policies SET premium_amount = 2600, coverage_amount = 60000  WHERE policy_number = 'POL-100005';
UPDATE policies SET premium_amount = 1500, coverage_amount = 30000  WHERE policy_number = 'POL-100006';
UPDATE policies SET premium_amount = 3600, coverage_amount = 85000  WHERE policy_number = 'POL-100007';
UPDATE policies SET premium_amount = 2100, coverage_amount = 45000  WHERE policy_number = 'POL-100008';
UPDATE policies SET premium_amount = 1200, coverage_amount = 25000  WHERE policy_number = 'POL-100009';
UPDATE policies SET premium_amount = 5000, coverage_amount = 120000 WHERE policy_number = 'POL-100010';

-- Once every existing row is backfilled, new inserts must supply both
-- explicitly (matches claim_amount's NOT NULL-with-no-default pattern).
ALTER TABLE policies ALTER COLUMN premium_amount  DROP DEFAULT;
ALTER TABLE policies ALTER COLUMN coverage_amount DROP DEFAULT;

ALTER TABLE policies
  ADD CONSTRAINT chk_policies_premium_amount_nonneg CHECK (premium_amount >= 0),
  ADD CONSTRAINT chk_policies_coverage_amount_positive CHECK (coverage_amount > 0);
