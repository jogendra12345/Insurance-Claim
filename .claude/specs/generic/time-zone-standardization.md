> Inferred type: **generic** (no db/bpmn/dmn/worker/api section covers this alone — it's a display-layer consistency fix touching many `frontend/portal` files, and `backend/api` needs no change)

# generic/time-zone-standardization

**Status:** Locked (2026-09-15)

**Lock note (2026-09-15):** Open Questions resolved — (1) yes, fold the audit page's `from`/`to` date-range filter into this pass now rather than deferring: `GET /api/claims/:id/audit-log` (`backend/api/src/routes/claims.ts`) anchors the `from`/`to` boundaries explicitly to UTC via `AT TIME ZONE 'UTC'` rather than relying on the Postgres session's `TimeZone` GUC (confirmed today it defaults to UTC on this container, but that's an environment default, not a guarantee — making it explicit means correctness doesn't depend on it); (2) confirmed, `ClaimForm.tsx`'s date-only review-summary fields use `formatDate` for consistency even though the UTC pin has no visible effect on a date-only value. Built the same day: `formatDate`/`formatDateTime` helpers in `frontend/portal/lib/time.ts`; every call site in Scope migrated; explicit UTC anchoring added to the audit-log endpoint's date-range filter.

## Purpose

`SPEC.md` §14 already flags "Time zone standardization" as an out-of-scope-for-v1 backlog item: *"Confirm and establish the standard system time zone for consistent logging and timestamp tracking."*

Every timestamp column in Postgres is already `timestamptz`, and `backend/api` already serializes them as UTC ISO-8601 strings (`...Z`) over JSON — confirmed live (e.g. `"createdAt":"2026-09-11T13:33:49.835Z"`). There is no backend inconsistency to fix.

The actual gap is entirely in `frontend/portal`: every timestamp render calls `new Date(iso).toLocaleString(undefined, ...)` / `.toLocaleDateString()` / `.toLocaleTimeString()` with an **undefined locale**, which renders in whatever timezone the *viewer's own browser* happens to be set to. Two staff members in different timezones looking at the same `audit_log` row today (`.claude/specs/generic/staff-audit-trail-view.md`) see two different wall-clock times for the same event, with no indication of which zone either one is in. This is more load-bearing now that the audit trail view exists — its entire value is a comparable, orderable timeline across staff.

## Scope

**In scope:**
- Standardize every timestamp **displayed** across `frontend/portal` on **UTC** — decided in chat over the alternative of a specific business timezone, since (a) everything is already stored/transmitted as UTC so this is a pure display change, and (b) this is a demo/internal app (`[[project_demo_app_no_real_payments]]`) with no single real-world "HQ" to anchor a business timezone to.
- Two shared helpers in `frontend/portal/lib/time.ts`, both pinned to `timeZone: "UTC"` via one `DISPLAY_TIME_ZONE` constant:
  - `formatDate(iso: string): string` — new, e.g. `"Sep 15, 2026"`. Replaces every ad hoc `new Date(iso).toLocaleDateString()` call.
  - `absoluteDate(iso: string): string` — already existed (used today in two tooltip call sites, `ClaimTable.tsx`/`app/policies/[id]/page.tsx`) but wasn't UTC-pinned; fixed in place rather than duplicated as a new `formatDateTime`. Now e.g. `"Sep 15, 2026, 2:30 PM UTC"` (explicit `"UTC"` suffix so it's unambiguous at a glance, not just correct). Replaces every ad hoc `new Date(iso).toLocaleString(...)` call that renders a timestamp (not a currency or other non-time value).
  - `relativeTime()`'s one absolute branch (`toLocaleTimeString` for same-day items) also gets the `timeZone` pin for consistency, though its output shape is otherwise unchanged.
- Swap every call site currently doing ad hoc locale-default timestamp formatting over to these two helpers:
  - `app/claims/[id]/page.tsx` — incident date, service date range, attestation timestamp, last-reviewer-action timestamp.
  - `app/audit/page.tsx` — claim card creation date, audit timeline entry timestamps.
  - `app/policies/page.tsx` / `app/policies/[id]/page.tsx` — effective/expiry dates.
  - `app/tasks/[key]/page.tsx` — any timestamp rendering added there (none currently beyond what routes through `Claim`/`Task` fields already covered above).
  - `components/ClaimForm.tsx` — the review-step date summaries (incident date, service date range) shown before submission.
- `lib/time.ts`'s existing `relativeTime()` ("3 hours ago" / clock-time-if-under-a-day helper used by e.g. task lists) keeps its relative-phrasing behavior unchanged — only its one absolute-time branch gets the same `timeZone` pin as everything else, for consistency.
- Currency formatting (`toLocaleString(undefined, { style: "currency", ... })`) is explicitly **not** touched — this spec is about timestamps only; currency locale is a separate, unrelated concern.

**Out of scope:**
- Any backend change — `backend/api`'s serialization is already correct (UTC ISO strings); nothing to fix there.
- A user-facing timezone preference/toggle (e.g. "view in my local time") — v1 of this fix is one fixed system-wide timezone for everyone, full stop. A per-user preference is a materially bigger feature (needs a stored preference, a settings UI) and isn't what was asked for.
- `app/audit/page.tsx`'s `from`/`to` date-range filter inputs (plain `<input type="date">`, interpreted as the browser's local date) — flagged as an open question below rather than folded into this pass by default, since narrowing filter-boundary semantics to UTC days is a slightly different (query-boundary) concern from display formatting, even though it's related.
- Any change to how dates are **entered** in forms (e.g. `ClaimForm.tsx`'s `<input type="date">` fields for incident date, service dates) — native date inputs have no timezone concept on the input side; this spec only touches how already-stored timestamps are *displayed* back.

## Design

### `lib/time.ts` changes

```ts
const DISPLAY_TIME_ZONE = "UTC";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: DISPLAY_TIME_ZONE });
}

export function absoluteDate(iso: string): string {
  return `${new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE })} UTC`;
}
```

(`toLocaleDateString`/`toLocaleString` still take `undefined` as the *locale* argument — only the `timeZone` option is pinned. This keeps date/number formatting conventions — e.g. `Sep 15` vs `15 Sep` — following the viewer's own locale, while the *zone* the clock reads in stays fixed. Locale-vs-timezone are independent `Intl` concerns; only the latter is this spec's problem.)

A single `DISPLAY_TIME_ZONE` constant, not a hardcoded string repeated in each function, so a future switch to a real business timezone (if this app ever gets a real single-office deployment) is a one-line change.

### Call-site migration

Every file listed in Scope above imports `formatDate`/`absoluteDate` from `@/lib/time` and replaces its local `new Date(iso).toLocaleDateString()` / `.toLocaleString()` calls. No behavior changes beyond the timezone pin and the explicit "UTC" suffix on datetime (not date-only) renders — e.g. a policy's effective date still reads as a bare date (`formatDate`, no "UTC" suffix, since a calendar date has no meaningful timezone ambiguity at day granularity), while an audit log entry's timestamp reads with the explicit suffix (`absoluteDate`) since same-day ordering/comparison across viewers is exactly what this spec is fixing.

### Audit-log date-range filter (`backend/api/src/routes/claims.ts`)

`GET /api/claims/:id/audit-log`'s `from`/`to` query params are compared against `created_at` by casting the incoming `"YYYY-MM-DD"` string to `date`. Today that implicitly resolves against whatever the Postgres session's `TimeZone` GUC is (this container defaults to UTC, confirmed live) — this spec makes that explicit rather than environment-dependent:

```sql
-- from:
created_at >= ($n::date AT TIME ZONE 'UTC')
-- to (inclusive of the whole day):
created_at < (($n::date + interval '1 day') AT TIME ZONE 'UTC')
```

`date AT TIME ZONE 'UTC'` interprets the calendar date's midnight as UTC midnight and converts to the correct `timestamptz` instant, independent of the session's `TimeZone` setting — so this stays correct even if the app is ever pointed at a differently-configured Postgres instance.

## Open Questions

1. **The audit page's `from`/`to` date-range filter** (`app/audit/page.tsx`, plain `<input type="date">`) — should the filter's date boundaries also be interpreted as UTC calendar days (matching the display standardization), or is that a separate follow-up? Left out of this spec's scope by default; flagging for an explicit decision at Lock.
2. **`ClaimForm.tsx`'s pre-submission review summary** — confirmed in scope above, but worth double-checking at implementation time whether its date-only fields (incident date, service dates) should use `formatDate` (no time-of-day, so a UTC pin has no visible effect there) — likely yes, for consistency, but noting since the effect is invisible for those specific fields.

## Follow-up dependencies

- None — this is a pure frontend display-layer fix with no dependency on unbuilt work.
