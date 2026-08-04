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
