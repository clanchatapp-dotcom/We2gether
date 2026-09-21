/*
 * The backend always reasons about dates in UK local time (see uk_today()
 * in backend/server.py) — it doesn't know or care which timezone either
 * partner's phone is set to. If the app computes "today"/"now" from the
 * device's own clock instead, two partners in different timezones (or
 * either partner during a DST change) can end up disagreeing with the
 * backend — and with each other — about what day it is. These helpers
 * make every screen anchor to Europe/London the same way the backend
 * does, so "today" always means the same calendar day everywhere.
 */

const UK_TIME_ZONE = "Europe/London";

/** Today's date in the UK, as YYYY-MM-DD — matches backend uk_today(). */
export function ukTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: UK_TIME_ZONE }).format(new Date());
}

/**
 * Parse a YYYY-MM-DD date string into a local Date at midnight, so
 * date-fns helpers (addDays, format, etc.) can operate on it without
 * any timezone conversion happening underneath.
 */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole UK calendar days between a YYYY-MM-DD date and UK-today. */
export function ukDaysSince(dateStr?: string): number {
  if (!dateStr) return 0;
  const start = isoToLocalDate(dateStr);
  const today = isoToLocalDate(ukTodayISO());
  const diff = today.getTime() - start.getTime();
  return Math.max(0, Math.round(diff / 86400000));
}

/** Format an ISO timestamp (e.g. a message's created_at/read_at, which the
 * backend stores in UTC) as HH:mm in UK local time, so both partners see
 * the same clock time regardless of their device's timezone. */
export function formatUkTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
