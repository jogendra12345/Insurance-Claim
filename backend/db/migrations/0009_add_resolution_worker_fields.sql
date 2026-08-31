-- ClaimFlow AI: adds the two claims columns trigger-settlement and
-- draft-denial-letter need to persist their output. See
-- .claude/specs/db/resolution_worker_fields.md for the full design.
--
-- Both nullable, no default, no backfill needed: existing rows correctly
-- stay NULL (they never reached settlement or denial-letter drafting).

ALTER TABLE claims
  ADD COLUMN settlement_id text,
  ADD COLUMN denial_letter_text text;
