"""Event input flow — on-demand, no cron.

Per architecture v2: the AI runs exactly once here, to pick candidate
flight-date slots for the event. Those slots are inserted straight into
preferred_routes (deduped against any existing route on the same
origin/destination/date) and from then on are tracked like any other route
by the regular cron flow in route_tracking.py — no email is sent here, and
no further AI calls happen for these routes.
"""
from datetime import datetime

from . import ai_reasoning, airports, db, timeutils


def create_event_and_routes(event_name: str, event_datetime: datetime, location: str,
                             origin: str, flexibility_days: int,
                             destination: str | None = None) -> tuple[str, list[str]]:
    """Creates the event, asks the AI once for candidate slots, and inserts
    them as tracked routes (skipping any that duplicate an existing route).
    Returns (event_id, [created_route_ids]).

    event_datetime is a naive datetime interpreted as Asia/Ho_Chi_Minh local
    wall-clock time (matches what the CLI and the web form both collect).
    """
    origin_code = airports.resolve_airport_code(origin)
    dest_code = airports.resolve_airport_code(destination) if destination else \
        airports.resolve_airport_code(location)

    event_id = db.add_event(
        event_name=event_name,
        event_datetime=timeutils.vn_local_to_utc_iso(event_datetime),
        location=location,
        origin=origin_code,
        flexibility_days=flexibility_days,
    )
    event = db.get_event(event_id)

    slots = ai_reasoning.generate_event_slots(event)
    if not slots:
        print(f"[event {event_id}] AI returned no usable slots")
        return event_id, []

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

    return event_id, created_route_ids
