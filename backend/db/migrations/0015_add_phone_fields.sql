-- Adds phone-number fields used as an authorized-claimant match signal for
-- claims submitted over WhatsApp (channel = 'whatsapp'), alongside the
-- existing email/name match used for portal-submitted claims.
-- .claude/specs/generic/whatsapp-claim-intake.md Open Question 4.

ALTER TABLE policies ADD COLUMN policyholder_phone text NULL;
ALTER TABLE policy_dependents ADD COLUMN phone text NULL;

ALTER TABLE claims ADD COLUMN claimant_phone text NULL;
ALTER TABLE claims ADD COLUMN channel text NOT NULL DEFAULT 'portal';
