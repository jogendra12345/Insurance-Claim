-- Per-phone-number conversation state for the WhatsApp claims assistant
-- (.claude/specs/generic/claims-assistant.md) — an HTTP webhook has no
-- session of its own between messages.

CREATE TABLE whatsapp_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     text NOT NULL UNIQUE,
  mode             text NOT NULL DEFAULT 'menu',   -- menu | claim_status | policy_status | raising_claim
  collected_fields jsonb NOT NULL DEFAULT '{}',     -- partial POST /api/claims payload, raising_claim mode only
  documents        jsonb NOT NULL DEFAULT '[]',     -- uploaded-so-far document refs ({name,url,contentType,size}[]), raising_claim mode only
  status           text NOT NULL DEFAULT 'active',  -- active | completed | abandoned
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
