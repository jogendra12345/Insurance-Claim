-- Email claim intake (.claude/specs/generic/email-claim-intake.md): one draft
-- per email thread, accumulating claim fields and documents across replies
-- until the claimant confirms and createClaim() runs. Not one row per sender
-- (unlike whatsapp_sessions) — a new email starts a separate draft
-- (Decision 4).

CREATE TABLE email_claim_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_email          text NOT NULL,                  -- lowercased, verified sender
  subject               text NOT NULL DEFAULT '',       -- first email's subject, for threaded replies/reminders
  thread_message_ids    text[] NOT NULL DEFAULT '{}',   -- every Message-ID in the thread (inbound and ours)
  collected_fields      jsonb NOT NULL DEFAULT '{}',    -- accepted values, CreateClaimInput keys
  invalid_fields        jsonb NOT NULL DEFAULT '{}',    -- {key: {value, error}} — sent but failed validation
  low_confidence_fields text[] NOT NULL DEFAULT '{}',   -- keys filled by AI that the claimant should check
  documents             jsonb NOT NULL DEFAULT '[]',    -- {name,url,contentType,size}[] already in MinIO
  sent_forms            jsonb NOT NULL DEFAULT '{}',    -- {ourMessageId: {key: shown value}} — baseline for spotting edited lines
  status                text NOT NULL DEFAULT 'collecting'
                          CHECK (status IN ('collecting', 'awaiting_confirmation', 'submitted', 'abandoned', 'expired')),
  claim_id              uuid REFERENCES claims (id),    -- set on submit
  last_inbound_at       timestamptz NOT NULL DEFAULT now(),
  reminder_sent_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_claim_drafts_sender ON email_claim_drafts (sender_email);
CREATE INDEX idx_email_claim_drafts_thread ON email_claim_drafts USING gin (thread_message_ids);

-- audit_log.claim_id is NOT NULL, so everything that happens before a claim
-- exists (emails received/dropped, AI extractions, replies sent) is recorded
-- here instead. On submit the draft id is written into the claim's audit_log,
-- so the two histories join on draft_id.
CREATE TABLE email_intake_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id     uuid REFERENCES email_claim_drafts (id) ON DELETE CASCADE,
  message_id   text,
  sender_email text NOT NULL,
  actor_type   text NOT NULL CHECK (actor_type IN ('system', 'ai', 'human')),
  action       text NOT NULL,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_intake_events_draft ON email_intake_events (draft_id);
CREATE INDEX idx_email_intake_events_sender ON email_intake_events (sender_email, created_at);
