const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// .claude/specs/generic/time-zone-standardization.md — every timestamp is
// stored/transmitted as UTC, but always *displayed* converted into each
// viewer's own local timezone (read from their browser/OS) — not a single
// fixed zone for everyone. Something logged in India shows in India's local
// time to a viewer there, and in the US viewer's own local time to them.
// `absoluteDate` additionally names the resolved IANA zone (e.g.
// "Asia/Kolkata") so it's unambiguous which zone a given render is in,
// since two different viewers' renders of the same instant are expected to
// legitimately differ.
function localTimeZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Under a day old: show the clock time it was submitted at. A day or older:
// switch to "N days/weeks/months/years ago" instead of a growing clock time.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;

  if (diffMs < ONE_DAY_MS) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

/** A bare calendar date in the viewer's own local timezone — e.g. "Sep 15, 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** A date + time in the viewer's own local timezone, with the zone named explicitly — e.g. "Sep 15, 2026, 2:30 PM (Asia/Kolkata)". Use for anything where cross-viewer clarity matters (audit trails, "last acted" timestamps) — the named zone, not an ambiguous abbreviation like "IST" (India/Ireland/Israel all use it), is what makes it unambiguous. */
export function absoluteDate(iso: string): string {
  const formatted = new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${formatted} (${localTimeZoneName()})`;
}
