// Firestore CRUD for the Next.js side. Mirrors flight_tracker/db.py on the
// Python side — same collections, same field names — since both read/write
// the same documents. Route-tracking-time operations (add_price_record,
// get_last_price, ...) live only on the Python side; this file only has
// what the dashboard and the two on-demand flows (add event / add route)
// need.
import type { Firestore, WriteBatch } from "firebase-admin/firestore";
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
// never got routes created, so there's nothing else to cascade-delete. A
// "done" event that already has routes must go through
// deleteEventAndRoutes instead, so those routes don't end up orphaned.
export async function deleteEvent(eventId: string): Promise<void> {
  await firestoreDb().collection(EVENTS).doc(eventId).delete();
}

// Adds deletes for every route tied to eventId (and their price_history) to
// a caller-supplied batch, without committing — shared by deleteEventAndRoutes
// (which also deletes the event doc in the same commit) and
// deleteRoutesForEvent (which commits just the routes, keeping the event).
async function addRouteDeletesToBatch(db: Firestore, batch: WriteBatch, eventId: string): Promise<void> {
  const routesSnap = await db.collection(ROUTES).where("event_id", "==", eventId).get();
  const priceSnaps = await Promise.all(
    routesSnap.docs.map((d) => db.collection(PRICE_HISTORY).where("route_id", "==", d.id).get())
  );
  for (const priceSnap of priceSnaps) {
    for (const doc of priceSnap.docs) batch.delete(doc.ref);
  }
  for (const doc of routesSnap.docs) batch.delete(doc.ref);
}

// Deleting a route that was created from an event means the user wants to
// abandon that whole event, not just this one slot — so this removes the
// event, every route tied to it (not just the one the user clicked "Xoá"
// on), and their price_history, in one batch.
export async function deleteEventAndRoutes(eventId: string): Promise<void> {
  const db = firestoreDb();
  const batch = db.batch();
  await addRouteDeletesToBatch(db, batch, eventId);
  batch.delete(db.collection(EVENTS).doc(eventId));
  await batch.commit();
}

// Removes every route tied to eventId (and their price_history) but leaves
// the event doc itself alone — used when re-planning an edited event, where
// the old AI-picked slots need to go but the event survives to get new ones.
export async function deleteRoutesForEvent(eventId: string): Promise<void> {
  const db = firestoreDb();
  const batch = db.batch();
  await addRouteDeletesToBatch(db, batch, eventId);
  await batch.commit();
}

export async function updateEvent(
  eventId: string,
  fields: Partial<
    Pick<
      EventDoc,
      "event_name" | "event_datetime" | "location" | "origin" | "destination" | "flexibility_days" | "preferred_time_window"
    >
  >
): Promise<void> {
  await firestoreDb().collection(EVENTS).doc(eventId).update(fields);
}

export async function setEventAiStatus(eventId: string, status: EventAiStatus): Promise<void> {
  await firestoreDb().collection(EVENTS).doc(eventId).update({ ai_status: status });
}

// Atomically claims the right to run generateEventSlots for this event —
// used by event creation, edit-triggered replanning, and the daily
// retry-pending-events cron alike, so at most one of them is ever mid-AI-call
// for the same event at once. Returns false (no write) if someone else
// already holds the claim (ai_status is "processing"); callers should treat
// that as "back off", not retry in a loop.
export async function claimEventForPlanning(eventId: string): Promise<boolean> {
  const db = firestoreDb();
  const ref = db.collection(EVENTS).doc(eventId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    if ((snap.data() as EventDoc).ai_status === "processing") return false;
    tx.update(ref, { ai_status: "processing" satisfies EventAiStatus });
    return true;
  });
}

// ---------------------------------------------------------------- routes --

export async function addRoute(input: {
  origin: string;
  destination: string;
  flight_date?: string | null;
  target_date_offset_days?: number;
  preferred_time_window?: string | null;
  return_date?: string | null;
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
      return_date: input.return_date ?? null,
      event_id: input.event_id ?? null,
      ai_reasoning: input.ai_reasoning ?? null,
      status: "tracking" satisfies RouteStatus,
      created_at: nowIso(),
    });
  return ref.id;
}

// return_date is part of the identity match, not just an extra filter — a
// one-way and a round-trip route for the same origin/destination/flight_date
// are two distinct tracked routes, not duplicates of each other.
export async function findMatchingRoute(
  origin: string,
  destination: string,
  flightDate: string,
  returnDate: string | null,
  excludeRouteId?: string
): Promise<RouteDoc | null> {
  const snap = await firestoreDb()
    .collection(ROUTES)
    .where("origin", "==", origin)
    .where("destination", "==", destination)
    .where("flight_date", "==", flightDate)
    .where("return_date", "==", returnDate)
    .get();
  for (const doc of snap.docs) {
    if (doc.id === excludeRouteId) continue;
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
  return_date?: string | null;
  event_id?: string | null;
  ai_reasoning?: string | null;
}): Promise<{ id: string; created: boolean }> {
  const existing = await findMatchingRoute(input.origin, input.destination, input.flight_date, input.return_date ?? null);
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

export async function updateRoute(
  routeId: string,
  fields: Partial<
    Pick<
      RouteDoc,
      "origin" | "destination" | "flight_date" | "target_date_offset_days" | "preferred_time_window" | "return_date"
    >
  >
): Promise<void> {
  await firestoreDb().collection(ROUTES).doc(routeId).update(fields);
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
