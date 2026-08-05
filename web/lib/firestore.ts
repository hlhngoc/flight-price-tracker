// Firestore CRUD for the Next.js side. Mirrors flight_tracker/db.py on the
// Python side — same collections, same field names — since both read/write
// the same documents. Route-tracking-time operations (add_price_record,
// get_last_price, ...) live only on the Python side; this file only has
// what the dashboard and the two on-demand flows (add event / add route)
// need.
import { firestoreDb } from "./firebaseAdmin";
import type { EventAiStatus, EventDoc, PriceRecord, RouteDoc, RouteStatus } from "./types";

const EVENTS = "events";
const ROUTES = "preferred_routes";
const PRICE_HISTORY = "price_history";

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------- events --

export async function addEvent(input: {
  event_name: string;
  event_datetime: string;
  location: string;
  origin: string;
  destination?: string | null;
  flexibility_days: number;
  preferred_time_window?: string | null;
}): Promise<string> {
  const ref = await firestoreDb()
    .collection(EVENTS)
    .add({
      ...input,
      destination: input.destination ?? null,
      preferred_time_window: input.preferred_time_window ?? null,
      // Left "pending" until generateEventSlots succeeds or fails for a
      // non-quota reason — see setEventAiStatus and the retry-pending-events
      // cron (flight_tracker/event_suggestion.py).
      ai_status: "pending" satisfies EventAiStatus,
      created_at: nowIso(),
    });
  return ref.id;
}

export async function getEvent(eventId: string): Promise<EventDoc | null> {
  const doc = await firestoreDb().collection(EVENTS).doc(eventId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<EventDoc, "id">) };
}

export async function listEvents(): Promise<EventDoc[]> {
  const snap = await firestoreDb().collection(EVENTS).orderBy("created_at").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventDoc, "id">) }));
}

// Only meaningful for events stuck at ai_status "pending"/"error" — those
// never got routes created, so there's nothing else to cascade-delete (a
// "done" event's routes, if any, are deleted independently via deleteRoute).
export async function deleteEvent(eventId: string): Promise<void> {
  await firestoreDb().collection(EVENTS).doc(eventId).delete();
}

export async function setEventAiStatus(eventId: string, status: EventAiStatus): Promise<void> {
  await firestoreDb().collection(EVENTS).doc(eventId).update({ ai_status: status });
}

// ---------------------------------------------------------------- routes --

export async function addRoute(input: {
  origin: string;
  destination: string;
  flight_date?: string | null;
  target_date_offset_days?: number;
  preferred_time_window?: string | null;
  event_id?: string | null;
  ai_reasoning?: string | null;
}): Promise<string> {
  const ref = await firestoreDb()
    .collection(ROUTES)
    .add({
      origin: input.origin,
      destination: input.destination,
      flight_date: input.flight_date ?? null,
      target_date_offset_days: input.target_date_offset_days ?? 30,
      preferred_time_window: input.preferred_time_window ?? null,
      event_id: input.event_id ?? null,
      ai_reasoning: input.ai_reasoning ?? null,
      status: "tracking" satisfies RouteStatus,
      created_at: nowIso(),
    });
  return ref.id;
}

export async function findMatchingRoute(
  origin: string,
  destination: string,
  flightDate: string
): Promise<RouteDoc | null> {
  const snap = await firestoreDb()
    .collection(ROUTES)
    .where("origin", "==", origin)
    .where("destination", "==", destination)
    .where("flight_date", "==", flightDate)
    .get();
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...(doc.data() as Omit<RouteDoc, "id">) };
    if (data.status !== "expired") return data;
  }
  return null;
}

export async function addRouteIfNew(input: {
  origin: string;
  destination: string;
  flight_date: string;
  preferred_time_window?: string | null;
  event_id?: string | null;
  ai_reasoning?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await findMatchingRoute(input.origin, input.destination, input.flight_date);
  if (existing) return { id: existing.id, created: false };
  const id = await addRoute(input);
  return { id, created: true };
}

export async function listRoutes(): Promise<RouteDoc[]> {
  const snap = await firestoreDb().collection(ROUTES).orderBy("created_at").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RouteDoc, "id">) }));
}

export async function getRoute(routeId: string): Promise<RouteDoc | null> {
  const doc = await firestoreDb().collection(ROUTES).doc(routeId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<RouteDoc, "id">) };
}

export async function setRouteStatus(routeId: string, status: RouteStatus): Promise<void> {
  await firestoreDb().collection(ROUTES).doc(routeId).update({ status });
}

// Cascades to price_history since those rows are only ever looked up by
// route_id and become dead weight once the route itself is gone.
export async function deleteRoute(routeId: string): Promise<void> {
  const db = firestoreDb();
  const priceSnap = await db.collection(PRICE_HISTORY).where("route_id", "==", routeId).get();
  const batch = db.batch();
  for (const doc of priceSnap.docs) batch.delete(doc.ref);
  batch.delete(db.collection(ROUTES).doc(routeId));
  await batch.commit();
}

// --------------------------------------------------------- price_history --

// Each check writes up to 2 price_history rows (one per distinct cheapest
// airline) sharing the same checked_at. Fetch the 2 most recent by
// checked_at desc, then keep only those matching the latest checked_at
// value (older single-airline checks will just return 1), cheapest first.
export async function getLatestPricesForRoute(routeId: string): Promise<PriceRecord[]> {
  const snap = await firestoreDb()
    .collection(PRICE_HISTORY)
    .where("route_id", "==", routeId)
    .orderBy("checked_at", "desc")
    .limit(2)
    .get();
  if (snap.empty) return [];
  const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceRecord, "id">) }));
  const latestCheckedAt = docs[0].checked_at;
  return docs.filter((d) => d.checked_at === latestCheckedAt).sort((a, b) => a.price - b.price);
}
