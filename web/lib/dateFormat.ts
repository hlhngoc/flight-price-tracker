// Firestore always stores flight_date as "YYYY-MM-DD" (ISO). This is only
// for display — string-split rather than `new Date(iso)` so there's no
// timezone-shift risk turning e.g. "2026-09-20" into the 19th or 21st.
export function formatDmy(isoDate: string | null | undefined): string {
  if (!isoDate) return "-";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}
