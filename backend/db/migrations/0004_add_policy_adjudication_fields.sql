-- ClaimFlow AI: add deductible_amount, copay_amount, and coinsurance_rate to
-- policies, backing the auto-assigned claim amount (see
-- backend/api/src/claimAmount.ts and frontend/portal/lib/claimAmount.ts).
-- Backfills the 10 policies seeded in 0002_add_policies.sql with plausible
-- dummy values, same approach as 0003_add_policy_amounts.sql.

ALTER TABLE policies
  ADD COLUMN deductible_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN copay_amount      numeric NOT NULL DEFAULT 0,
  ADD COLUMN coinsurance_rate  numeric NOT NULL DEFAULT 0;

UPDATE policies SET deductible_amount = 500,  copay_amount = 25, coinsurance_rate = 0.20 WHERE policy_number = 'POL-100001';
UPDATE policies SET deductible_amount = 1000, copay_amount = 30, coinsurance_rate = 0.20 WHERE policy_number = 'POL-100002';
UPDATE policies SET deductible_amount = 250,  copay_amount = 20, coinsurance_rate = 0.10 WHERE policy_number = 'POL-100003';
UPDATE policies SET deductible_amount = 1500, copay_amount = 40, coinsurance_rate = 0.25 WHERE policy_number = 'POL-100004';
UPDATE policies SET deductible_amount = 500,  copay_amount = 25, coinsurance_rate = 0.15 WHERE policy_number = 'POL-100005';
UPDATE policies SET deductible_amount = 750,  copay_amount = 30, coinsurance_rate = 0.20 WHERE policy_number = 'POL-100006';
UPDATE policies SET deductible_amount = 1000, copay_amount = 35, coinsurance_rate = 0.20 WHERE policy_number = 'POL-100007';
UPDATE policies SET deductible_amount = 500,  copay_amount = 20, coinsurance_rate = 0.15 WHERE policy_number = 'POL-100008';
UPDATE policies SET deductible_amount = 250,  copay_amount = 15, coinsurance_rate = 0.10 WHERE policy_number = 'POL-100009';
UPDATE policies SET deductible_amount = 2000, copay_amount = 50, coinsurance_rate = 0.30 WHERE policy_number = 'POL-100010';

ALTER TABLE policies ALTER COLUMN deductible_amount DROP DEFAULT;
ALTER TABLE policies ALTER COLUMN copay_amount      DROP DEFAULT;
ALTER TABLE policies ALTER COLUMN coinsurance_rate  DROP DEFAULT;

ALTER TABLE policies
  ADD CONSTRAINT chk_policies_deductible_amount_nonneg CHECK (deductible_amount >= 0),
  ADD CONSTRAINT chk_policies_copay_amount_nonneg CHECK (copay_amount >= 0),
  ADD CONSTRAINT chk_policies_coinsurance_rate_range CHECK (coinsurance_rate >= 0 AND coinsurance_rate <= 1);
