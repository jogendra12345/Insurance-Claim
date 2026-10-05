-- Inbound WhatsApp message ids already handled, so a redelivered webhook
-- event (Meta retries) isn't processed twice — e.g. recording the same
-- raise-a-claim answer twice. .claude/specs/generic/claims-assistant.md
-- addendum 2026-10-05, item 4. No cleanup policy for v1.

CREATE TABLE whatsapp_processed_messages (
  message_id  text PRIMARY KEY,               -- Meta's messages[].id (wamid.…)
  received_at timestamptz NOT NULL DEFAULT now()
);
