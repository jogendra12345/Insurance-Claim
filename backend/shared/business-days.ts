// .claude/specs/generic/sla-review-escalation.md — deadline math for the
// business-day-aware SLA timers. Zeebe boundary timer events only support a
// literal ISO-8601 duration or a FEEL date-time expression, not "skip
// weekends/holidays" natively — so the actual deadline timestamp is computed
// here, once, by whichever worker precedes a timer-boundary task, and passed
// through as the `slaDeadline` process variable the boundary event reads.
//
// This is a business-day-aware deadline, not a business-hours accumulator:
// the countdown itself stays a flat N-hour span (default 24h), only the
// landing day gets rolled forward past weekends/holidays. Time-of-day is
// never adjusted — a task opened at 11pm still gets an 11pm deadline, just
// possibly on a different day.

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  // month: 0-11, weekday: 0=Sun..6=Sat, n: 1-based occurrence within the month
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month, lastDayOfMonth));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, lastDayOfMonth - offset));
}

// Computed per year (fixed-date + nth-weekday rules) rather than a literal
// list of strings, so this stays correct indefinitely instead of needing a
// yearly manual update. Known gap, per the spec's Follow-up dependencies:
// this doesn't apply the Fri/Mon observance shift when a fixed-date holiday
// falls on a weekend — acceptable for a demo app.
function federalHolidaysForYear(year: number): string[] {
  return [
    toDateKey(new Date(Date.UTC(year, 0, 1))), // New Year's Day
    toDateKey(nthWeekdayOfMonth(year, 0, 1, 3)), // MLK Day — 3rd Mon of Jan
    toDateKey(nthWeekdayOfMonth(year, 1, 1, 3)), // Presidents Day — 3rd Mon of Feb
    toDateKey(lastWeekdayOfMonth(year, 4, 1)), // Memorial Day — last Mon of May
    toDateKey(new Date(Date.UTC(year, 5, 19))), // Juneteenth
    toDateKey(new Date(Date.UTC(year, 6, 4))), // Independence Day
    toDateKey(nthWeekdayOfMonth(year, 8, 1, 1)), // Labor Day — 1st Mon of Sep
    toDateKey(nthWeekdayOfMonth(year, 9, 1, 2)), // Columbus Day — 2nd Mon of Oct
    toDateKey(new Date(Date.UTC(year, 10, 11))), // Veterans Day
    toDateKey(nthWeekdayOfMonth(year, 10, 4, 4)), // Thanksgiving — 4th Thu of Nov
    toDateKey(new Date(Date.UTC(year, 11, 25))), // Christmas
  ];
}

const currentYear = new Date().getUTCFullYear();
export const US_FEDERAL_HOLIDAYS: Set<string> = new Set([
  ...federalHolidaysForYear(currentYear),
  ...federalHolidaysForYear(currentYear + 1),
]);

function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  return !isWeekend && !US_FEDERAL_HOLIDAYS.has(toDateKey(date));
}

function rollToBusinessDay(date: Date): Date {
  let result = date;
  while (!isBusinessDay(result)) {
    result = new Date(result.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

// Example matching the spec exactly: a task opened Friday 3:00pm with the
// default 24h window lands on Saturday 3:00pm (weekend) → rolls to Sunday
// 3:00pm (still weekend) → rolls to Monday 3:00pm (business day, stop).
export function computeBusinessDeadline(fromDate: Date, businessHours = 24): Date {
  const naiveDeadline = new Date(fromDate.getTime() + businessHours * 60 * 60 * 1000);
  return rollToBusinessDay(naiveDeadline);
}
