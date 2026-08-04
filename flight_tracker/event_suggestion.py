"""Event input flow — on-demand, no cron.

Per architecture v2: the AI runs exactly once here, to pick candidate
flight-date slots for the event. Those slots are inserted straight into
preferred_routes (deduped against any existing route on the same
origin/destination/date) and from then on are tracked like any other route
by the regular cron flow in route_tracking.py — no email is sent here, and
no further AI calls happen for these routes.
"""
from datetime import datetime

from . import ai_reasoning, airports, db


def create_event_and_routes(event_name: str, event_datetime: datetime, location: str,
                             origin: str, flexibility_days: int,
                             destination: str | None = None) -> tuple[int, list[int]]:
    """Creates the event, asks the AI once for candidate slots, and inserts
    them as tracked routes (skipping any that duplicate an existing route).
    Returns (event_id, [created_route_ids]).
    """
    origin_code = airports.resolve_airport_code(origin)
    dest_code = airports.resolve_airport_code(destination) if destination else \
        airports.resolve_airport_code(location)

    event_id = db.add_event(
        event_name=event_name,
        event_datetime=event_datetime.isoformat(sep=" "),
        location=location,
        origin=origin_code,
        flexibility_days=flexibility_days,
    )
    event = db.get_event(event_id)

    slots = ai_reasoning.generate_event_slots(dict(event))
    if not slots:
        print(f"[event {event_id}] AI returned no usable slots")
        return event_id, []

    created_route_ids: list[int] = []
    for slot in slots:
        flight_date_iso = slot["flight_date"].isoformat()
        existing = db.find_matching_route(origin_code, dest_code, flight_date_iso)
        if existing is not None:
            print(f"[event {event_id}] slot {flight_date_iso} already tracked as "
                  f"route #{existing['id']}, skipping duplicate")
            continue
        route_id = db.add_route(
            origin=origin_code,
            destination=dest_code,
            flight_date=flight_date_iso,
            preferred_time_window=slot["preferred_time_window"],
            event_id=event_id,
            ai_reasoning=slot["reasoning"],
        )
        created_route_ids.append(route_id)

    return event_id, created_route_ids
