"""Event input flow — on-demand, no cron.

Per architecture v2: the AI runs exactly once here, to pick candidate
flight-date slots for the event. Those slots are inserted straight into
preferred_routes (deduped against any existing route on the same
origin/destination/date) and from then on are tracked like any other route
by the regular cron flow in route_tracking.py — no email is sent here, and
no further AI calls happen for these routes.
"""
from datetime import datetime

from . import ai_reasoning, airports, db, route_tracking, timeutils


def _insert_routes_for_slots(event_id: str, origin_code: str, dest_code: str,
                              slots: list[dict]) -> list[str]:
    created_route_ids: list[str] = []
    for slot in slots:
        flight_date_iso = slot["flight_date"].isoformat()
        route_id, created = db.add_route_if_new(
            origin_code, dest_code, flight_date_iso,
            preferred_time_window=slot["preferred_time_window"],
            event_id=event_id,
            ai_reasoning=slot["reasoning"],
        )
        if created:
            created_route_ids.append(route_id)
        else:
            print(f"[event {event_id}] slot {flight_date_iso} already tracked as "
                  f"route #{route_id}, skipping duplicate")
    return created_route_ids


def create_event_and_routes(event_name: str, event_datetime: datetime, location: str,
                             origin: str, flexibility_days: int,
                             destination: str | None = None) -> tuple[str, list[str]]:
    """Creates the event, asks the AI once for candidate slots, and inserts
    them as tracked routes (skipping any that duplicate an existing route).
    Returns (event_id, [created_route_ids]).

    event_datetime is a naive datetime interpreted as Asia/Ho_Chi_Minh local
    wall-clock time (matches what the CLI and the web form both collect).

    If Gemini is out of daily quota, the event is left with ai_status
    "pending" instead of failing — retry_pending_event_slots() (run daily
    via cron, shortly after Gemini's free-tier quota resets) picks it up
    automatically.
    """
    origin_code = airports.resolve_airport_code(origin)
    dest_code = airports.resolve_airport_code(destination) if destination else \
        airports.resolve_airport_code(location)

    event_id = db.add_event(
        event_name=event_name,
        event_datetime=timeutils.vn_local_to_utc_iso(event_datetime),
        location=location,
        origin=origin_code,
        destination=dest_code,
        flexibility_days=flexibility_days,
    )
    event = db.get_event(event_id)

    # A brand-new event's ai_status is "pending" (set by db.add_event) with
    # nothing else able to reference it yet, so this claim essentially always
    # succeeds — it's here mainly for consistency with the other three
    # generate_event_slots callers, all of which must claim first (see
    # db.claim_event_for_planning's docstring).
    if not db.claim_event_for_planning(event_id):
        print(f"[event {event_id}] could not claim for planning (unexpected for a just-created event)")
        return event_id, []

    _, created_route_ids = _generate_and_insert_slots(event_id, event, origin_code, dest_code)
    return event_id, created_route_ids


def _generate_and_insert_slots(event_id: str, event: dict, origin_code: str,
                                dest_code: str) -> tuple[str, list[str]]:
    """Shared by create_event_and_routes and retry_pending_event_slots for
    the part that runs *after* the event has already been claimed
    (ai_status == "processing"): call the AI, insert routes on success, and
    always resolve ai_status away from "processing" no matter what happens —
    including on an unexpected (non-AI) exception, so the event self-heals
    via the next retry-cron run instead of getting stuck claimed forever.
    Returns (final_ai_status, created_route_ids).
    """
    try:
        try:
            slots = ai_reasoning.generate_event_slots(event)
        except ai_reasoning.AIQuotaExceededError as exc:
            print(f"[event {event_id}] {exc} — back to pending, will retry automatically")
            db.set_event_ai_status(event_id, "pending")
            return "pending", []
        except ai_reasoning.AIReasoningError as exc:
            print(f"[event {event_id}] AI reasoning failed (not a quota issue, won't auto-retry): {exc}")
            db.set_event_ai_status(event_id, "error")
            return "error", []

        if not slots:
            print(f"[event {event_id}] AI returned no usable slots")
            db.set_event_ai_status(event_id, "done")
            return "done", []

        created_route_ids = _insert_routes_for_slots(event_id, origin_code, dest_code, slots)
        db.set_event_ai_status(event_id, "done")
        return "done", created_route_ids
    except Exception:
        db.set_event_ai_status(event_id, "pending")
        raise


def retry_pending_event_slots() -> tuple[int, int, int, int]:
    """Retries AI slot generation for every event stuck at ai_status
    'pending' (almost always because Gemini's daily quota was exhausted
    when the event was first created; occasionally because an edit-triggered
    replan left it there after an unexpected error). Meant to run once a
    day, shortly after Gemini's quota resets. Returns
    (total_pending, succeeded, still_pending_quota, claim_conflicts).

    claim_conflicts counts events skipped because something else (typically
    a concurrent edit-triggered replan via PATCH /api/events/[id]) already
    held the planning claim — kept separate from still_pending_quota since
    it's a different reason to still be pending, not a quota issue.
    """
    pending_events = db.list_pending_events()
    succeeded = 0
    still_pending_quota = 0
    claim_conflicts = 0
    for event in pending_events:
        event_id = event["id"]
        if not db.claim_event_for_planning(event_id):
            print(f"[event {event_id}] already claimed elsewhere (likely a concurrent edit), skipping this run")
            claim_conflicts += 1
            continue

        status, created_route_ids = _generate_and_insert_slots(
            event_id, event, event["origin"], event["destination"]
        )
        if status == "pending":
            print(f"[event {event_id}] still quota-exceeded, will retry next run")
            still_pending_quota += 1
            continue
        if status == "error":
            continue

        succeeded += 1
        if created_route_ids:
            print(f"[event {event_id}] quota recovered, created {len(created_route_ids)} "
                  "route(s), checking prices now")
            try:
                route_tracking.run(route_ids=created_route_ids)
            except Exception as exc:  # routes are already created either way
                print(f"[event {event_id}] immediate price check failed: {exc}")
        else:
            print(f"[event {event_id}] quota recovered but AI returned no usable slots")

    return len(pending_events), succeeded, still_pending_quota, claim_conflicts
