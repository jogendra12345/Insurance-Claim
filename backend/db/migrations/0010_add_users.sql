-- ClaimFlow AI: auth + role-based access, per the locked
-- .claude/specs/generic/auth-role-based-access.md (Option B, SPEC.md §14).
-- Claimants self-register (gated by a policy-number + email match, checked
-- in application code the same way validate-claim already does — see the
-- spec's "Claimant signup verification" section); every staff role is
-- seeded directly into this table, never self-registered or provisioned
-- via an admin UI (locked decision, not built in this pass).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (
    role IN ('claimant', 'admin', 'triage-team', 'adjuster', 'investigator', 'legal-reviewer', 'supervisor')
  ),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_email ON users (lower(email));
