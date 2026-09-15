> Inferred type: **generic** (no db/bpmn/dmn/worker/api section covers this alone — it's a display-layer consistency fix touching many `frontend/portal` files, and `backend/api` needs no change)

# generic/time-zone-standardization

**Status:** Draft

## Purpose

`SPEC.md` §14 already flags "Time zone standardization" as an out-of-scope-for-v1 backlog item: *"Confirm and establish the standard system time zone for consistent logging and timestamp tracking."*

Every timestamp column in Postgres is already `timestamptz`, and `backend/api` already serializes them as UTC ISO-8601 strings (`...Z`) over JSON — confirmed live (e.g. `"createdAt":"2026-09-11T13:33:49.835Z"`). There is no backend inconsistency to fix.

The actual gap is entirely in `frontend/portal`: every timestamp render calls `new Date(iso).toLocaleString(undefined, ...)` / `.toLocaleDateString()` / `.toLocaleTimeString()` with an **undefined locale**, which renders in whatever timezone the *viewer's own browser* happens to be set to. Two staff members in different timezones looking at the same `audit_log` row today (`.claude/specs/generic/staff-audit-trail-view.md`) see two different wall-clock times for the same event, with no indication of which zone either one is in. This is more load-bearing now that the audit trail view exists — its entire value is a comparable, orderable timeline across staff.

## Scope

**In scope:**
- Standardize every timestamp **displayed** across `frontend/portal` on **UTC** — decided in chat over the alternative of a specific business timezone, since (a) everything is already stored/transmitted as UTC so this is a pure display change, and (b) this is a demo/internal app (`[[project_demo_app_no_real_payments]]`) with no single real-world "HQ" to anchor a business timezone to.
- Two new shared helpers in `frontend/portal/lib/time.ts`, both pinned to `timeZone: "UTC"`:
  - `formatDate(iso: string): string` — e.g. `"Sep 15, 2026"`. Replaces every ad hoc `new Date(iso).toLocaleDateString()` call.
  - `formatDateTime(iso: string): string` — e.g. `"Sep 15, 2026, 2:30 PM UTC"` (explicit `"UTC"` suffix so it's unambiguous at a glance, not just correct). Replaces every ad hoc `new Date(iso).toLocaleString(...)` / `.toLocaleTimeString(...)` call that renders a timestamp (not a currency or other non-time value).
- Swap every call site currently doing ad hoc locale-default timestamp formatting over to these two helpers:
  - `app/claims/[id]/page.tsx` — incident date, service date range, attestation timestamp, last-reviewer-action timestamp.
  - `app/audit/page.tsx` — claim card creation date, audit timeline entry timestamps.
  - `app/policies/page.tsx` / `app/policies/[id]/page.tsx` — effective/expiry dates.
  - `app/tasks/[key]/page.tsx` — any timestamp rendering added there (none currently beyond what routes through `Claim`/`Task` fields already covered above).
  - `components/ClaimForm.tsx` — the review-step date summaries (incident date, service date range) shown before submission.
- `lib/time.ts`'s existing `relativeTime()` ("3 hours ago" / clock-time-if-under-a-day helper used by e.g. task lists) is **left untouched** — relative phrasing is timezone-agnostic by construction, and its one absolute branch (`toLocaleTimeString` for same-day items) also gets pinned to UTC as part of this change for consistency, but its behavior/shape doesn't otherwise change.
- Currency formatting (`toLocaleString(undefined, { style: "currency", ... })`) is explicitly **not** touched — this spec is about timestamps only; currency locale is a separate, unrelated concern.

**Out of scope:**
- Any backend change — `backend/api`'s serialization is already correct (UTC ISO strings); nothing to fix there.
- A user-facing timezone preference/toggle (e.g. "view in my local time") — v1 of this fix is one fixed system-wide timezone for everyone, full stop. A per-user preference is a materially bigger feature (needs a stored preference, a settings UI) and isn't what was asked for.
- `app/audit/page.tsx`'s `from`/`to` date-range filter inputs (plain `<input type="date">`, interpreted as the browser's local date) — flagged as an open question below rather than folded into this pass by default, since narrowing filter-boundary semantics to UTC days is a slightly different (query-boundary) concern from display formatting, even though it's related.
- Any change to how dates are **entered** in forms (e.g. `ClaimForm.tsx`'s `<input type="date">` fields for incident date, service dates) — native date inputs have no timezone concept on the input side; this spec only touches how already-stored timestamps are *displayed* back.

## Design

### `lib/time.ts` additions

```ts
const DISPLAY_TIME_ZONE = "UTC";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    dateStyle: "medium",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }) + " UTC";
}
```

(`toLocaleDateString`/`toLocaleString` still take `undefined` as the *locale* argument — only the `timeZone` option is pinned. This keeps date/number formatting conventions — e.g. `Sep 15` vs `15 Sep` — following the viewer's own locale, while the *zone* the clock reads in stays fixed. Locale-vs-timezone are independent `Intl` concerns; only the latter is this spec's problem.)

A single `DISPLAY_TIME_ZONE` constant, not a hardcoded string repeated in each function, so a future switch to a real business timezone (if this app ever gets a real single-office deployment) is a one-line change.

`absoluteDate()` (existing, currently unused per a repo-wide check — confirm at implementation time) is superseded by `formatDateTime` and can be removed if genuinely dead, or merged if some call site does use it.

### Call-site migration

Every file listed in Scope above imports `formatDate`/`formatDateTime` from `@/lib/time` and replaces its local `new Date(iso).toLocaleDateString()` / `.toLocaleString()` calls. No behavior changes beyond the timezone pin and the explicit "UTC" suffix on datetime (not date-only) renders — e.g. a policy's effective date still reads as a bare date (`formatDate`, no "UTC" suffix, since a calendar date has no meaningful timezone ambiguity at day granularity), while an audit log entry's timestamp reads with the explicit suffix (`formatDateTime`) since same-day ordering/comparison across viewers is exactly what this spec is fixing.

## Open Questions

1. **The audit page's `from`/`to` date-range filter** (`app/audit/page.tsx`, plain `<input type="date">`) — should the filter's date boundaries also be interpreted as UTC calendar days (matching the display standardization), or is that a separate follow-up? Left out of this spec's scope by default; flagging for an explicit decision at Lock.
2. **`ClaimForm.tsx`'s pre-submission review summary** — confirmed in scope above, but worth double-checking at implementation time whether its date-only fields (incident date, service dates) should use `formatDate` (no time-of-day, so a UTC pin has no visible effect there) — likely yes, for consistency, but noting since the effect is invisible for those specific fields.

## Follow-up dependencies

- None — this is a pure frontend display-layer fix with no dependency on unbuilt work.
