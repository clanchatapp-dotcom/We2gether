// Timezone-correct helpers. All times are stored as UTC ISO in the backend;
// we render and input in the user's local timezone using the browser Intl API.

export const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Convert a UTC ISO string -> value for <input type="datetime-local"> in local time.
export function isoToLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert a local datetime-local input value -> UTC ISO for the backend.
export function localInputToUtcIso(value) {
  // `new Date("YYYY-MM-DDTHH:mm")` is parsed as local time by the browser.
  return new Date(value).toISOString();
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function isExpired(endIso) {
  return new Date(endIso).getTime() < Date.now();
}
