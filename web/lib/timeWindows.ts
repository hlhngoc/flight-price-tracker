// Mirrors flight_tracker/time_windows.py's preset list. Actual SerpApi
// filtering by time window happens only on the Python cron side (route_
// tracking.py) — this file just needs the shared vocabulary so the manual-
// route form and the Gemini prompt (lib/gemini.ts) offer/produce the same
// values the Python side knows how to parse.
export const TIME_WINDOW_PRESETS: string[] = [
  "Sáng sớm (00:00-06:00)",
  "Sáng (06:00-12:00)",
  "Chiều (12:00-18:00)",
  "Tối (18:00-24:00)",
];

const RANGE_PATTERN = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/;

// Mirrors time_windows.py's parse_time_window: extracts (startHour, endHour)
// from a "... (HH:MM-HH:MM)" label. Returns null if unparseable.
export function parseTimeWindow(label: string | null | undefined): [number, number] | null {
  if (!label) return null;
  const m = RANGE_PATTERN.exec(label);
  if (!m) return null;
  const startH = Number(m[1]);
  const endH = Number(m[3]);
  if (!(startH >= 0 && startH <= 24 && endH >= 0 && endH <= 24)) return null;
  return [startH, endH];
}

export const CUSTOM_WINDOW_PREFIX = "Tuỳ chỉnh";

// Narrower ranges often contain no flight at all on domestic routes, so the
// UI and API enforce at least this span. (If a range still comes back empty,
// the cron falls back to the flights departing nearest to it.)
export const MIN_WINDOW_HOURS = 3;

// Custom ranges are stored in the same "<label> (HH:MM-HH:MM)" shape as the
// presets, so the Python cron's parse_time_window/is_within_window filter
// them with no changes. Hour granularity only (the cron compares by hour).
export function formatCustomWindow(startHour: number, endHour: number): string {
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${CUSTOM_WINDOW_PREFIX} (${hh(startHour)}-${hh(endHour)})`;
}

// Accepts any preset or any parseable label spanning >= MIN_WINDOW_HOURS
// (no past-midnight wrap, to keep "same day" semantics simple for the UI).
export function isValidTimeWindow(label: string | null | undefined): boolean {
  if (!label) return false;
  if (TIME_WINDOW_PRESETS.includes(label)) return true;
  const parsed = parseTimeWindow(label);
  return parsed !== null && parsed[1] - parsed[0] >= MIN_WINDOW_HOURS;
}
