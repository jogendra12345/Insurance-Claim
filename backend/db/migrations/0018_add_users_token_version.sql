-- Per-tab bearer-token sessions (.claude/specs/generic/auth-role-based-access.md,
-- addendum 2026-10-05). Each access token carries the user's token_version;
-- bumping it (password reset) makes every older token stop working.

ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0;
