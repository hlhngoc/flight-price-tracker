"""Firestore access layer (replaces the old SQLite layer, per architecture
v3). One Firestore client, lazily initialized and shared across calls.
Every read returns a plain dict with an 'id' key merged in, so callers
don't have to deal with DocumentSnapshot objects — route_tracking.py,
event_suggestion.py and cli.py mostly kept working unchanged (except that
IDs are now strings, not ints).

IMPORTANT: collection/field names here must stay in sync with
web/lib/firestore.ts — the GitHub Actions cron job (this file) and the
Next.js app both read/write the same Firestore collections.
"""
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from . import config, timeutils

EVENTS = "events"
ROUTES = "preferred_routes"
PRICE_HISTORY = "price_history"
NOTIFICATIONS_LOG = "notifications_log"

_client: Optional[firestore.Client] = None


def db() -> firestore.Client:
    global _client
    if _client is None:
        if not firebase_admin._apps:
            cred = credentials.Certificate(config.firebase_service_account())
            firebase_admin.initialize_app(cred)
        _client = firestore.client()
    return _client


def _doc_to_dict(doc) -> Optional[dict]:
    if doc is None or not doc.exists:
        return None
    data = doc.to_dict()
    data["id"] = doc.id
    return data


# ---------------------------------------------------------------- routes --

def add_route(origin: str, destination: str, target_date_offset_days: int = 30,
              flight_date: Optional[str] = None, preferred_time_window: Optional[str] = None,
              event_id: Optional[str] = None, ai_reasoning: Optional[str] = None) -> str:
    doc_ref = db().collection(ROUTES).document()
    doc_ref.set({
        "origin": origin,
        "destination": destination,
        "flight_date": flight_date,
        "target_date_offset_days": target_date_offset_days,
        "preferred_time_window": preferred_time_window,
        "event_id": event_id,
        "ai_reasoning": ai_reasoning,
        "status": "tracking",
        "created_at": timeutils.now_utc_iso(),
    })
    return doc_ref.id


def find_matching_route(origin: str, destination: str, flight_date: str) -> Optional[dict]:
    """Existing non-expired route already tracking this exact origin/
    destination/date, regardless of which event (if any) created it —
    avoids inserting duplicate routes when two events land on the same slot.
    """
    query = (
        db().collection(ROUTES)
        .where(filter=FieldFilter("origin", "==", origin))
        .where(filter=FieldFilter("destination", "==", destination))
        .where(filter=FieldFilter("flight_date", "==", flight_date))
    )
    for doc in query.stream():
        data = _doc_to_dict(doc)
        if data["status"] != "expired":
            return data
    return None


def add_route_if_new(origin: str, destination: str, flight_date: str, **kwargs) -> tuple[str, bool]:
    """Insert a route for this origin/destination/flight_date unless a
    matching non-expired one already exists. Returns (route_id, created) —
    created is False when an existing route was reused instead of a new
    insert, so callers can skip duplicate SerpApi queries for that date.
    """
    existing = find_matching_route(origin, destination, flight_date)
    if existing is not None:
        return existing["id"], False
    route_id = add_route(origin=origin, destination=destination, flight_date=flight_date, **kwargs)
    return route_id, True


def list_routes() -> list[dict]:
    return [_doc_to_dict(d) for d in db().collection(ROUTES).order_by("created_at").stream()]


def list_active_routes() -> list[dict]:
    query = db().collection(ROUTES).where(filter=FieldFilter("status", "==", "tracking"))
    return [_doc_to_dict(d) for d in query.stream()]


def get_route(route_id: str) -> Optional[dict]:
    return _doc_to_dict(db().collection(ROUTES).document(route_id).get())


def set_route_status(route_id: str, status: str) -> None:
    db().collection(ROUTES).document(route_id).update({"status": status})


def expire_due_event_routes(now_iso: str) -> int:
    """Marks 'tracking' routes as 'expired' once their linked event's
    datetime has passed, so cron stops burning SerpApi quota on flights
    that can no longer be booked in time. Returns the number of rows updated.
    """
    expired_event_ids = [
        d.id for d in db().collection(EVENTS).where(filter=FieldFilter("event_datetime", "<", now_iso)).stream()
    ]
    if not expired_event_ids:
        return 0

    count = 0
    for i in range(0, len(expired_event_ids), 10):  # Firestore 'in' caps the list length; chunk to be safe
        chunk = expired_event_ids[i:i + 10]
        query = (
            db().collection(ROUTES)
            .where(filter=FieldFilter("status", "==", "tracking"))
            .where(filter=FieldFilter("event_id", "in", chunk))
        )
        for doc in query.stream():
            doc.reference.update({"status": "expired"})
            count += 1
    return count


# ---------------------------------------------------------------- events --

def add_event(event_name: str, event_datetime: str, location: str, origin: str,
              flexibility_days: int, destination: Optional[str] = None) -> str:
    doc_ref = db().collection(EVENTS).document()
    doc_ref.set({
        "event_name": event_name,
        "event_datetime": event_datetime,
        "location": location,
        "origin": origin,
        "destination": destination,
        "flexibility_days": flexibility_days,
        # "pending" until the AI call succeeds or fails for a non-quota
        # reason (see event_suggestion.py) — lets the retry cron find events
        # stuck behind a Gemini quota error without re-scanning everything.
        "ai_status": "pending",
        "created_at": timeutils.now_utc_iso(),
    })
    return doc_ref.id


def get_event(event_id: str) -> Optional[dict]:
    return _doc_to_dict(db().collection(EVENTS).document(event_id).get())


def list_events() -> list[dict]:
    return [_doc_to_dict(d) for d in db().collection(EVENTS).order_by("created_at").stream()]


def list_pending_events() -> list[dict]:
    query = db().collection(EVENTS).where(filter=FieldFilter("ai_status", "==", "pending"))
    return [_doc_to_dict(d) for d in query.stream()]


def set_event_ai_status(event_id: str, status: str) -> None:
    db().collection(EVENTS).document(event_id).update({"ai_status": status})


@firestore.transactional
def _try_claim_event(transaction, ref) -> bool:
    snapshot = ref.get(transaction=transaction)
    if not snapshot.exists:
        return False
    if snapshot.to_dict().get("ai_status") == "processing":
        return False
    transaction.update(ref, {"ai_status": "processing"})
    return True


def claim_event_for_planning(event_id: str) -> bool:
    """Atomically claims the right to run generate_event_slots for this
    event — mirrors web/lib/firestore.ts's claimEventForPlanning. Used here
    by retry_pending_event_slots (event_suggestion.py) so the daily cron
    never races an in-flight edit-triggered replan (or vice versa) on the
    same event. Returns False without writing anything if someone else
    already holds the claim (ai_status == "processing").
    """
    ref = db().collection(EVENTS).document(event_id)
    return _try_claim_event(db().transaction(), ref)


# --------------------------------------------------------- price_history --

def add_price_record(route_id: str, flight_date: str, departure_time: Optional[str],
                      price: int, airline: Optional[str], checked_at: str,
                      matched_preferred_window: bool) -> str:
    """matched_preferred_window: True if this result's departure_time falls
    inside the route's preferred_time_window (or the route has none set —
    trivially satisfied); False if it's a fallback shown despite not
    matching the route's stated preference (see route_tracking.py).
    """
    doc_ref = db().collection(PRICE_HISTORY).document()
    doc_ref.set({
        "route_id": route_id,
        "flight_date": flight_date,
        "departure_time": departure_time,
        "price": price,
        "airline": airline,
        "checked_at": checked_at,
        "matched_preferred_window": matched_preferred_window,
    })
    return doc_ref.id


def get_last_price(route_id: str, before_checked_at: str) -> Optional[dict]:
    """Cheapest price_history row from the most recent check for this route,
    strictly before the given checked_at timestamp (i.e. excluding the
    records just inserted for the current check). A single check now writes
    up to 2 rows (one per distinct cheapest airline) sharing the exact same
    checked_at — ordering by checked_at desc, then price asc, picks the
    cheaper of that pair (or the only row, for older single-airline checks).
    """
    query = (
        db().collection(PRICE_HISTORY)
        .where(filter=FieldFilter("route_id", "==", route_id))
        .where(filter=FieldFilter("checked_at", "<", before_checked_at))
        .order_by("checked_at", direction=firestore.Query.DESCENDING)
        .order_by("price", direction=firestore.Query.ASCENDING)
        .limit(1)
    )
    docs = list(query.stream())
    return _doc_to_dict(docs[0]) if docs else None


def get_price_history_since(route_id: str, since_iso: str,
                             before_checked_at: Optional[str] = None) -> list[dict]:
    query = (
        db().collection(PRICE_HISTORY)
        .where(filter=FieldFilter("route_id", "==", route_id))
        .where(filter=FieldFilter("checked_at", ">=", since_iso))
    )
    if before_checked_at is not None:
        query = query.where(filter=FieldFilter("checked_at", "<", before_checked_at))
    query = query.order_by("checked_at")
    return [_doc_to_dict(d) for d in query.stream()]


def get_latest_price(route_id: str) -> Optional[dict]:
    query = (
        db().collection(PRICE_HISTORY)
        .where(filter=FieldFilter("route_id", "==", route_id))
        .order_by("checked_at", direction=firestore.Query.DESCENDING)
        .limit(1)
    )
    docs = list(query.stream())
    return _doc_to_dict(docs[0]) if docs else None


# ---------------------------------------------------------- notifications --

def log_notification(route_id: Optional[str], notif_type: str, sent_at: str,
                      email_content: str) -> str:
    doc_ref = db().collection(NOTIFICATIONS_LOG).document()
    doc_ref.set({
        "route_id": route_id,
        "type": notif_type,
        "sent_at": sent_at,
        "email_content": email_content,
    })
    return doc_ref.id
