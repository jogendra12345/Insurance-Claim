> Inferred type: **generic** (no type given; this feature spans a `users` table migration, two new API endpoints, a new frontend route, and a reusable email-sending primitive — no single db/bpmn/dmn/worker/insurance-type/api section in SPEC.md covers it as one unit, the same reasoning `[[auth-role-based-access]]` used for itself)

# generic/forgot-password-otp-reset

**Status:** Draft

## Purpose

`[[auth-role-based-access]]` (Locked 2026-09-04) explicitly deferred this: its Out of scope section lists "Password reset / email-ownership verification (confirmation code) ... see Open Questions," and its Session mechanism section states plainly "no password reset in v1." Today, a user (claimant or staff) who forgets their password has no recovery path at all — the only fix is an admin re-seeding their row directly in Postgres. This spec closes that gap: a `/forgot-password` flow that emails a one-time code to prove inbox ownership, then emails a freshly generated password once that code is verified. It builds directly on `[[auth-role-based-access]]`'s `users` table and bcrypt password hashing, and reuses the email-sending machinery `notify-claimant` (`SPEC.md` §12) already has for Gmail SMTP / Resend, rather than inventing a second one. Tracked as `BUILD-PLAN.md` Phase 2 item #34, depending on #21 (the auth spec above) since it extends the same `users` table and login/signup UI.

## Scope

**In scope:**
- Two new `backend/api` endpoints: `POST /api/auth/forgot-password` (request a code) and `POST /api/auth/verify-otp` (verify the code, triggering a new password).
- A `users` table migration adding OTP state columns (hash, expiry, attempt count, last-sent timestamp).
- A reusable, non-claim-specific email-sending primitive extracted from `backend/shared/notification-provider.ts`'s existing Gmail-SMTP/Resend/mock selection logic, so this flow doesn't duplicate transport setup.
- A new `/forgot-password` page in `frontend/portal`, plus a "Forgot password?" link from `/login`.
- Per-account abuse guards: a resend cooldown and a capped number of verify attempts before a code is invalidated.
- Generic, non-enumerating responses (the API never reveals whether a given email has an account).

**Out of scope (flagged as Open Questions below, or explicitly future work):**
- Letting the user type their own new password after verifying the code — this spec generates the password server-side and emails it, matching the literal request ("send an email ... for otp verification and new password generation"). See Open Question 1 for the tradeoff.
- Forcing a password change on next login after a generated password is used — no `must_change_password` flag exists on `users` today; see Open Question 2.
- SMS/phone-based OTP — email only, same channel `notify-claimant` already uses.
- General IP-based rate limiting or account lockout — only the per-account resend cooldown and verify-attempt cap described below; a real abuse-prevention layer is more than an internal test app (`[[project_demo_app_no_real_payments]]`) needs today.
- A "change my password while logged in" settings feature — a different feature from *forgotten*-password recovery; not requested here.
- An admin resetting another user's password on their behalf — `[[auth-role-based-access]]`'s admin-only `register-staff` endpoint creates *new* staff accounts; resetting an *existing* account's password by an admin is a separate feature, not this one.

## Design

### Data model — `users` table additions

Migration `0011_add_password_reset_otp.sql` (next sequential after `0010_add_users.sql`), an `ALTER TABLE` following the same pattern as `0006_add_fnol_extended_fields.sql`/`0008_add_policy_dependents.sql` rather than a new table — this is per-user transient state, not an independent entity with its own relationships.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `reset_otp_hash` | text | yes | `NULL` | bcrypt hash of the current OTP, same `hashPassword`/`verifyPassword` helpers `auth.ts` already exports — never store the plaintext code |
| `reset_otp_expires_at` | timestamptz | yes | `NULL` | issued-at + 10 minutes |
| `reset_otp_attempts` | integer | no | `0` | failed `verify-otp` calls since the code was issued; capped at 5 (see below) |
| `reset_otp_sent_at` | timestamptz | yes | `NULL` | drives the resend cooldown |

All four are cleared back to `NULL`/`0` once a code is successfully verified (single-use) or once it expires and a fresh one is requested.

### `POST /api/auth/forgot-password`

Request: `{ email }`. Always responds `200` with an identical generic message ("If that email has an account, we've sent a verification code.") whether or not the email matches a user — the same enumeration-avoidance approach `[[auth-role-based-access]]`'s signup endpoint already uses for its policy-match failure message.

Behavior when the email *does* match a `users` row:
1. **Resend cooldown** — if `reset_otp_sent_at` is within the last 60 seconds, do nothing (still return the generic `200`); prevents a refresh-spam mail flood without needing IP tracking.
2. Otherwise, generate a 6-digit numeric code (`crypto.randomInt(100000, 999999)`), bcrypt-hash it into `reset_otp_hash`, set `reset_otp_expires_at = now() + 10 minutes`, reset `reset_otp_attempts = 0`, set `reset_otp_sent_at = now()`.
3. Send the code by email via the shared email-sending primitive (below) — subject "Your ClaimFlow AI verification code," plain 6-digit code prominent in the body, matching the inline-styled HTML-email approach `buildEmail()` already establishes in `notification-provider.ts`.

When the email doesn't match any user: no DB write, no email sent, same `200` response.

### `POST /api/auth/verify-otp`

Request: `{ email, otp }`. Looks up the user by email.

- No matching user, no `reset_otp_hash` set, or `reset_otp_expires_at` in the past → `400` with a generic "Invalid or expired code" message (deliberately identical wording across all three causes — doesn't reveal which).
- `reset_otp_attempts >= 5` → same generic `400`, telling the caller to request a new code (don't just keep incrementing past the cap).
- OTP doesn't `bcrypt.compare` against `reset_otp_hash` → increment `reset_otp_attempts`, same generic `400`.
- Match, within the cap, not expired → **success path**:
  1. Generate a new random password: 12 characters, `crypto.randomInt`-driven, guaranteed at least one uppercase, one lowercase, one digit, one symbol, drawn from a charset that excludes visually ambiguous characters (`0`/`O`, `1`/`l`/`I`) since this password gets typed back in, not just pasted.
  2. `bcrypt`-hash it into `users.password_hash` (via the existing `hashPassword` helper — same function `login`/`signup` already use).
  3. Clear `reset_otp_hash`/`reset_otp_expires_at`/`reset_otp_attempts`/`reset_otp_sent_at` back to their empty defaults — the code is single-use even on success.
  4. Email the plaintext new password to the user via the same shared email primitive — subject "Your new ClaimFlow AI password," the password itself, and a reminder to log in and note it somewhere safe (there's no "change password" settings page yet to immediately rotate it — Open Question 2).
  5. Respond `200` with a generic confirmation ("A new password has been emailed to you.") — the response body itself never contains the password; it only ever travels over email.

No session cookie is issued by either endpoint — the user still has to go log in with the new password via the existing `POST /api/auth/login`, same as `signup` requires afterward today.

### Shared email-sending primitive

`backend/shared/notification-provider.ts` already picks Gmail SMTP (preferred, `GMAIL_USER`/`GMAIL_APP_PASSWORD`) over Resend (`RESEND_API_KEY`) over a console-log mock, but every export in that file is shaped around `NotificationContext` (claim-specific fields: `claimId`, `decision`, `denialLetterText`, etc.) — not reusable as-is for an OTP code or a generated password, neither of which is claim-related. This spec extracts the transport-selection logic (which provider, which `nodemailer`/Resend client, the Gmail-preferred-over-Resend-preferred-over-mock ordering) into a lower-level `sendEmail({ to, subject, html, text }): Promise<{ sent: boolean }>` function in `backend/shared/`, with `notify-claimant`'s existing `buildEmail()` output passed through it unchanged, and this spec's two new email bodies (OTP code, generated password) built the same inline-styled-HTML way and passed through the same function. One transport-selection implementation, two callers.

**New env-var surface:** this logic currently only runs in `backend/workers` (`notify-claimant`'s process). `backend/api` needs its own read of `GMAIL_USER`/`GMAIL_APP_PASSWORD`/`RESEND_API_KEY` (its own `.env`, alongside the existing `DATABASE_URL`/`CORS_ORIGIN`/etc.) to send from these two new endpoints — `RUNNING-LOCALLY.md` and `PREREQUISITES.md` need updating once this is built, same values, second `.env` file. When none of those are set, `sendEmail` falls back to a console-log mock (prints the OTP/generated password to the `backend/api` dev server's terminal) — same fallback shape as `mockNotificationProvider`, so local dev without email credentials still exercises the whole flow end-to-end, just by reading the terminal instead of an inbox.

### Frontend — `/forgot-password` page

New route in `frontend/portal`, two-step form on one page (no separate `/verify-otp` route):
1. **Step 1 — email.** A single email field, "Send code" button, calls `POST /api/auth/forgot-password`. On response (always success-shaped per the API's design above), advances to step 2 regardless — the UI itself never learns whether the email matched anything, same as the API never reveals it.
2. **Step 2 — code.** A 6-digit code field, "Verify" button, calls `POST /api/auth/verify-otp` with the email captured in step 1. On success, shows a confirmation that a new password was emailed, with a link to `/login`. On failure (generic "Invalid or expired code"), stays on step 2 and allows retry up to the server-enforced attempt cap; a "Resend code" link goes back to step 1's call (subject to the 60-second cooldown — the UI should surface the generic message either way, since the API doesn't distinguish "cooldown" from "sent").

`/login` gets a new "Forgot password?" link near the password field, pointing to `/forgot-password` — mirrors the existing "Not a claimant yet? Sign up" link already there per `[[auth-role-based-access]]`'s "Login/signup UI" section.

No role gating on this page or its endpoints — a claimant and a staff user recover a forgotten password the same way, since both rows live in the same `users` table with the same `password_hash` column.

## Open Questions

1. **Auto-generated password vs. user-chosen password.** This spec emails a server-generated password (matches the literal request wording — "otp verification and new password generation" as two things the email does). The more common modern pattern instead has step 2 collect a `newPassword` field directly (after OTP verification) and never puts a credential in an email body at all — email is not guaranteed-confidential transport, and a generated password sitting in an inbox indefinitely is a real, if modest, exposure window for an already-compromised-account scenario. Recommend confirming which UX product actually wants before Lock; either is a small change to the "verify-otp" section above (add a `newPassword` field to the request, validate it the same way `signup` validates length, skip step 4's random generation).
2. **Force password change after a generated password is used.** Not built here — no `must_change_password` column/mechanic exists on `users`. If Open Question 1 resolves toward auto-generation, this becomes more worth doing (a password that arrived in plaintext email arguably shouldn't persist indefinitely); worth a follow-up spec rather than scope-creeping this one.
3. **Resend semantics under the cooldown.** The design above returns the same generic `200` whether a code was actually (re)sent or suppressed by the 60-second cooldown, to avoid a timing side-channel. Confirm that's an acceptable UX tradeoff (a user double-clicking "Send code" gets no explicit "please wait" feedback) versus a small enumeration/timing risk from a more informative cooldown message.

## Follow-up dependencies

- None known — this spec doesn't unblock anything else the way `[[auth-role-based-access]]` unblocked `moreInfo`/the audit view; it's a standalone account-recovery feature.
