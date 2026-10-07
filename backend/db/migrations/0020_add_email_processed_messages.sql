-- Inbound email Message-IDs already handled, so an IMAP re-fetch (or a
-- webhook redelivery, if intake moves to one) isn't processed twice — same
-- purpose as whatsapp_processed_messages (0017).
-- .claude/specs/generic/email-claim-intake.md. No cleanup policy for v1.

CREATE TABLE email_processed_messages (
  message_id   text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
