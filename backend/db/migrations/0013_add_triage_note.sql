-- Triage Review's "review" outcome had no way to leave a note for the
-- role-specific reviewer (adjuster/investigator/legal) it routes to,
-- unlike the "reject" outcome's denial_reason. A plain column keeps it
-- queryable/displayable the same way case_summary and risk_reasoning are.
ALTER TABLE claims ADD COLUMN triage_note text;
