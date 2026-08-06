// Field names here are snake_case on purpose, matching the Python side
// (flight_tracker/db.py) exactly — both the Next.js app and the GitHub
// Actions cron job read/write the same Firestore documents, so the shape
// has to agree across languages, not follow either language's convention.

export type RouteStatus = "tracking" | "booked" | "expired";

// "pending" until the AI call succeeds or fails for a non-quota reason —
// lets the daily retry cron (flight_tracker retry-pending-events) find
// events stuck behind a Gemini quota error without re-scanning everything.
// "processing" is a short-lived claim held by whichever caller (create,
// edit-replan, or the retry cron) is currently mid-generateEventSlots for
// this event — see claimEventForPlanning in lib/firestore.ts — so two
// callers never run the AI for the same event at once.
export type EventAiStatus = "pending" | "processing" | "done" | "error";

export interface EventDoc {
  id: string;
  event_name: string;
  event_datetime: string; // UTC-aware ISO string
  location: string;
  origin: string;
  destination: string | null;
  flexibility_days: number;
  preferred_time_window: string | null;
  ai_status: EventAiStatus;
  created_at: string;
}

export interface RouteDoc {
  id: string;
  origin: string;
  destination: string;
  flight_date: string | null; // YYYY-MM-DD, set for event-derived routes
  target_date_offset_days: number; // used when flight_date is null
  preferred_time_window: string | null;
  // YYYY-MM-DD, null = one-way. Only meaningful when flight_date is set —
  // legacy offset-based routes never get a round-trip return date. Absent
  // (not even null) on docs written before this field existed — dedup
  // queries treat that the same as one-way after a one-time backfill (see
  // flight_tracker/db.py backfill_route_return_date_field).
  return_date: string | null;
  event_id: string | null;
  ai_reasoning: string | null;
  status: RouteStatus;
  created_at: string;
}

export interface PriceRecord {
  id: string;
  route_id: string;
  flight_date: string;
  departure_time: string | null;
  price: number;
  airline: string | null;
  checked_at: string;
  // Undefined on records written before this field existed — treat as "no
  // preference to violate" the same way the dashboard/email do (no warning).
  matched_preferred_window?: boolean;
  // Only set for round-trip routes (see RouteDoc.return_date) — the
  // resolved return leg's departure time/airline from the SerpApi
  // departure_token second call. Undefined for one-way routes and for
  // records written before round-trip support existed.
  return_departure_time?: string | null;
  return_airline?: string | null;
}

export interface EventSlot {
  flight_date: string; // YYYY-MM-DD
  preferred_time_window: string;
  reasoning: string;
}
