// UK-time date helpers. The shared calendar (and read-receipt times) must
// read the same "today" for both partners regardless of the phone's timezone
// (one of us is in the UK, the other in Moscow). We anchor everything to
// Europe/London using Intl, then do calendar math on the YYYY-MM-DD string.

const UK_TZ = "Europe/London";

// Today in the UK as a YYYY-MM-DD string (en-CA formats as YYYY-MM-DD).
export function ukTodayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: UK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// A Date pinned to UTC midnight of the given YYYY-MM-DD, so day/month/weekday
// formatting in UTC always reflects exactly that calendar day.
function dateFromStr(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDaysStr(s: string, n: number): string {
  const d = dateFromStr(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function labelParts(s: string): { dow: string; day: string; mon: string } {
  const d = dateFromStr(s);
  const f = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(d);
  return {
    dow: f({ weekday: "short" }),
    day: f({ day: "numeric" }),
    mon: f({ month: "short" }),
  };
}

export function dayLabelUK(s: string): string {
  const today = ukTodayStr();
  const tomorrow = addDaysStr(today, 1);
  const d = dateFromStr(s);
  const full = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(d);
  if (s === today) return `Today · ${full}`;
  if (s === tomorrow) return `Tomorrow · ${full}`;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// A friendly display of a YYYY-MM-DD date, e.g. "21 September 2026".
export function prettyDate(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// A wall-clock time (HH:mm) rendered in UK time from an ISO timestamp.
export function ukTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: UK_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}
