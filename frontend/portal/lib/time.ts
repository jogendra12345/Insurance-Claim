const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// .claude/specs/generic/time-zone-standardization.md — every timestamp is
// already stored/transmitted as UTC; this is the one place that pins how
// it's *displayed*, so every viewer sees the same wall-clock time regardless
// of their own browser's timezone. Only the `timeZone` option is pinned —
// the `undefined` locale argument still lets date/number conventions (e.g.
// "Sep 15" vs "15 Sep") follow the viewer's own locale.
const DISPLAY_TIME_ZONE = "UTC";

// Under a day old: show the clock time it was submitted at. A day or older:
// switch to "N days/weeks/months/years ago" instead of a growing clock time.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;

  if (diffMs < ONE_DAY_MS) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: DISPLAY_TIME_ZONE });
  }

  const diffSeconds = Math.round(diffMs / 1000);
  const divisions: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

  for (const [unit, secondsInUnit] of divisions) {
    if (diffSeconds >= secondsInUnit) {
      return rtf.format(-Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return rtf.format(-1, "day");
}

/** A bare calendar date — e.g. "Sep 15, 2026". No time-of-day, so no "UTC" suffix (a date has no zone ambiguity at day granularity). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: DISPLAY_TIME_ZONE });
}

/** A date + time, explicitly labeled — e.g. "Sep 15, 2026, 2:30 PM UTC". Use for anything where same-day ordering/comparison across viewers matters (audit trails, "last acted" timestamps). */
export function absoluteDate(iso: string): string {
  return `${new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE })} UTC`;
}
