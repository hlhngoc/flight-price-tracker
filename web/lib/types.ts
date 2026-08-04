// Field names here are snake_case on purpose, matching the Python side
// (flight_tracker/db.py) exactly — both the Next.js app and the GitHub
// Actions cron job read/write the same Firestore documents, so the shape
// has to agree across languages, not follow either language's convention.

export type RouteStatus = "tracking" | "booked" | "expired";

export interface EventDoc {
  id: string;
  event_name: string;
  event_datetime: string; // UTC-aware ISO string
  location: string;
  origin: string;
  flexibility_days: number;
  created_at: string;
}

export interface RouteDoc {
  id: string;
  origin: string;
  destination: string;
  flight_date: string | null; // YYYY-MM-DD, set for event-derived routes
  target_date_offset_days: number; // used when flight_date is null
  preferred_time_window: string | null;
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
}

export interface EventSlot {
  flight_date: string; // YYYY-MM-DD
  preferred_time_window: string;
  reasoning: string;
}
