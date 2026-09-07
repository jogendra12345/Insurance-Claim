-- ClaimFlow AI: forgot-password OTP state on `users`. See
-- .claude/specs/generic/forgot-password-otp-reset.md (Locked) for the full
-- design. Per-user transient reset state, not an independent entity, so
-- ALTER TABLE rather than a new table (same pattern as 0006/0008).
--
-- All four nullable/zero-default: existing rows correctly start with no
-- reset in flight.

ALTER TABLE users
  ADD COLUMN reset_otp_hash text,
  ADD COLUMN reset_otp_expires_at timestamptz,
  ADD COLUMN reset_otp_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN reset_otp_sent_at timestamptz;
