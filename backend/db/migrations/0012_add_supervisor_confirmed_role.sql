-- ClaimFlow AI: allow 'supervisor' as a claims.confirmed_role value. See
-- .claude/specs/generic/sla-review-escalation.md (Locked) -- when Legal
-- Review's SLA timer fires, auto-escalate-review writes
-- claims.confirmed_role = 'supervisor' so the claim routes to the new
-- Supervisor Review task. The existing check constraint only allowed
-- 'adjuster' | 'investigator' | 'legal' | 'auto', which would reject that
-- write outright.
--
-- assigned_role is left untouched -- the DMN table never outputs
-- 'supervisor' (SPEC.md §11), only confirmed_role can become 'supervisor',
-- and only via this one escalation path.

ALTER TABLE claims DROP CONSTRAINT claims_confirmed_role_check;

ALTER TABLE claims
  ADD CONSTRAINT claims_confirmed_role_check
  CHECK (confirmed_role = ANY (ARRAY['adjuster'::text, 'investigator'::text, 'legal'::text, 'auto'::text, 'supervisor'::text]));
