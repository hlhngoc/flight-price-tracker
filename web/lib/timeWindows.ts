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
