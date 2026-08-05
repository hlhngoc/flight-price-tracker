// Firestore always stores flight_date as "YYYY-MM-DD" (ISO). This is only
// for display — string-split rather than `new Date(iso)` so there's no
// timezone-shift risk turning e.g. "2026-09-20" into the 19th or 21st.
export function formatDmy(isoDate: string | null | undefined): string {
  if (!isoDate) return "-";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

// departureTime is "YYYY-MM-DD HH:MM" (as returned by SerpApi) — extract
// just the trailing "HH:MM" for display.
export function formatTime(departureTime: string | null | undefined): string {
  if (!departureTime) return "-";
  const match = departureTime.match(/(\d{2}):(\d{2})$/);
  return match ? `${match[1]}:${match[2]}` : "-";
}

// event_datetime is stored as a UTC-aware ISO string; display it converted
// to Asia/Ho_Chi_Minh wall-clock time, matching how it was originally
// entered (datetime-local input, interpreted as VN local time).
export function formatVnDateTime(utcIso: string | null | undefined): string {
  if (!utcIso) return "-";
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return "-";
  const datePart = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${datePart} ${timePart}`;
}

// Inverse of the "${datetime}:00+07:00" conversion in POST/PATCH
// /api/events — produces a "YYYY-MM-DDTHH:MM" string suitable for
// prefilling a <input type="datetime-local">, from a UTC-aware ISO string
// interpreted as Asia/Ho_Chi_Minh wall-clock time.
export function toVnDatetimeLocalInput(utcIso: string): string {
  const d = new Date(utcIso);
  const datePart = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${datePart}T${timePart}`;
}
