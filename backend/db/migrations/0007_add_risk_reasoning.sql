-- score-risk's reasoning text was previously only captured in audit_log,
-- unavailable to the claim detail view without parsing audit_log JSON.
-- A plain column keeps it queryable the same way case_summary already is.
ALTER TABLE claims ADD COLUMN risk_reasoning text;
