const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

export function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
