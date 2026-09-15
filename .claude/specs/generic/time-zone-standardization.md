> Inferred type: **generic** (no db/bpmn/dmn/worker/api section covers this alone — it's a display-layer consistency fix touching many `frontend/portal` files, plus a small `backend/api` query-boundary change)

# generic/time-zone-standardization

**Status:** Locked (2026-09-15)

**Lock note (2026-09-15):** Open Questions resolved — (1) yes, fold the audit page's `from`/`to` date-range filter into this pass now rather than deferring; (2) confirmed, `ClaimForm.tsx`'s date-only review-summary fields use `formatDate` for consistency (no visible effect on a date-only value, since that helper carries no explicit zone). Built the same day.

**Revision note (2026-09-15, same day):** The first build of this spec pinned every displayed timestamp to a single fixed UTC clock for all viewers. That was a misreading of the backlog note — corrected in chat: the actual requirement is that each viewer sees a timestamp converted into **their own local timezone** (something logged in India shows India-local time to a viewer there, and that same instant shows US-local time to a US-based viewer) — not one frozen zone everyone has to mentally convert. Design below reflects the corrected direction; the "Design" section was rewritten in place rather than left as a stale first draft.

## Purpose

`SPEC.md` §14 already flags "Time zone standardization" as an out-of-scope-for-v1 backlog item: *"Confirm and establish the standard system time zone for consistent logging and timestamp tracking."*

Every timestamp column in Postgres is already `timestamptz`, and `backend/api` already serializes them as UTC ISO-8601 strings (`...Z`) over JSON — confirmed live (e.g. `"createdAt":"2026-09-11T13:33:49.835Z"`). There is no backend storage/transmission inconsistency to fix — the instant itself is already unambiguous on the wire.

What needed fixing was **how that instant gets displayed**, and specifically that it wasn't labeled: every timestamp render called `new Date(iso).toLocaleString(undefined, ...)` / `.toLocaleDateString()` / `.toLocaleTimeString()`, which already converts into the *viewer's own browser timezone* by default (that part was always correct and desired) — but with no indication of which zone that was, so a viewer had no way to tell "is this my local time, or someone else's?" when comparing notes with a colleague in a different timezone. This is more load-bearing now that the audit trail view exists — its value depends on staff being able to reason about ordering/timing across a shared trail even though each of them may see a different-looking clock time for the same row.

## Scope

**In scope:**
- **Each viewer sees every timestamp converted into their own local timezone** (their browser/OS setting) — this was already `Intl`'s default behavior and is *kept*, not changed. What's added is explicit zone labeling wherever cross-viewer comparison matters, so nobody has to guess whose clock a given render reflects.
- Two shared helpers in `frontend/portal/lib/time.ts`:
  - `formatDate(iso: string): string` — a bare calendar date in the viewer's local zone, e.g. `"Sep 15, 2026"`. No zone label — a calendar date has no meaningful zone ambiguity at day granularity. Replaces every ad hoc `new Date(iso).toLocaleDateString()` call.
  - `absoluteDate(iso: string): string` — already existed (used in two tooltip call sites, `ClaimTable.tsx`/`app/policies/[id]/page.tsx`); kept as the viewer's local date + time, but now with the **resolved IANA zone name** appended, e.g. `"Sep 15, 2026, 2:30 PM (Asia/Kolkata)"`. The full zone name is used deliberately instead of an abbreviation like "IST" — abbreviations collide (India/Ireland/Israel Standard Time all claim "IST"), so an abbreviation would reintroduce the exact ambiguity this spec is fixing. Replaces every ad hoc `new Date(iso).toLocaleString(...)` call that renders a timestamp.
  - `relativeTime()`'s one absolute-time branch (same-day "2:30 PM" clock time) is left as a bare local time with no zone label — every existing call site already pairs it with an `absoluteDate()` tooltip (`title={absoluteDate(...)}`) for the full, zone-labeled version on hover, so the disambiguation already exists one interaction away.
- Swap every call site currently doing ad hoc timestamp formatting over to these two helpers:
  - `app/claims/[id]/page.tsx` — incident date, service date range, attestation timestamp, last-reviewer-action timestamp.
  - `app/audit/page.tsx` — claim card creation date, audit timeline entry timestamps.
  - `app/policies/page.tsx` / `app/policies/[id]/page.tsx` — effective/expiry dates.
  - `components/ClaimForm.tsx` — the review-step date summaries (incident date, service date range) shown before submission.
- `app/audit/page.tsx`'s `from`/`to` date-range filter (plain `<input type="date">`, which carries no timezone of its own) is resolved into precise instant boundaries **client-side**, using the browser's own actual timezone (it's the one place that genuinely knows it) — `from` becomes that date's local midnight, `to` becomes the start of the *next* local calendar day (exclusive upper bound) — before being sent to the API as full ISO instants. This makes "From"/"To" mean the viewer's own local calendar days, consistent with how everything is now displayed.
- `GET /api/claims/:id/audit-log` (`backend/api/src/routes/claims.ts`) simplifies to a direct instant comparison (`created_at >= $n::timestamptz` / `created_at < $n::timestamptz`) against whatever precise instants the frontend sends — the backend holds no timezone opinion of its own; it's just given the correct boundaries already resolved by the one party (the browser) that actually knows the viewer's zone.
- Currency formatting (`toLocaleString(undefined, { style: "currency", ... })`) is explicitly **not** touched — this spec is about timestamps only.

**Out of scope:**
- A single fixed system-wide display timezone — this was the first (incorrect) build of this spec and is explicitly reverted; see Revision note above.
- A user-facing timezone *override* (e.g. "view this in a specific timezone regardless of my browser") — out of scope; the browser's own detected zone is the only source used.
- Any change to how dates are **entered** in forms (e.g. `ClaimForm.tsx`'s `<input type="date">` fields for incident date, service dates) — native date inputs have no timezone concept on the input side; this spec only touches how already-stored timestamps are *displayed* and how the audit filter's picked dates are *resolved into query boundaries*.

## Design

### `lib/time.ts`

```ts
function localTimeZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function absoluteDate(iso: string): string {
  const formatted = new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${formatted} (${localTimeZoneName()})`;
}
```

No `timeZone` option is passed to either `Intl` call — omitting it is exactly what makes these convert into the viewer's own local zone (the `Intl` default). `localTimeZoneName()` reads that same resolved zone back out (via `Intl.DateTimeFormat().resolvedOptions().timeZone`, e.g. `"Asia/Kolkata"`, `"America/New_York"`) purely for the label — it doesn't change what zone the time itself is rendered in.

### Call-site migration

Every file listed in Scope imports `formatDate`/`absoluteDate` from `@/lib/time` and replaces its local `toLocaleDateString()` / `toLocaleString()` calls. Behavior for the underlying conversion is unchanged from before this spec (still local-zone); what changes is that `absoluteDate` now names the zone explicitly instead of leaving it implicit.

### Audit-log date-range filter

`app/audit/page.tsx`:

```ts
function startOfNextLocalDay(dateStr: string): Date {
  const nextDay = new Date(`${dateStr}T00:00:00`); // parsed as local time (no Z/offset)
  nextDay.setDate(nextDay.getDate() + 1);           // date-component arithmetic, not +24h in ms — correct across DST transitions
  return nextDay;
}

// when building the request:
from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
to: to ? startOfNextLocalDay(to).toISOString() : undefined,
```

`backend/api/src/routes/claims.ts`'s `GET /:id/audit-log` then just does:

```sql
created_at >= $n::timestamptz   -- from
created_at <  $n::timestamptz   -- to (exclusive of the next day's start)
```

No `AT TIME ZONE` juggling on the backend — the frontend already resolved the correct instants using the one piece of information only it has (the viewer's actual local timezone).

## Follow-up dependencies

- None — pure frontend display-layer fix plus a small, self-contained backend query simplification, no dependency on unbuilt work.
