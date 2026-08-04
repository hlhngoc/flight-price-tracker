"""Manual multi-date route creation: given a target date and a +/- day
window, create one tracked route per date in that window. No AI involved —
this is for long-term/manual tracking around a date you already have in
mind (e.g. "I'm flying around Sep 20, +/- a few days"), unlike
event_suggestion.py which asks Gemini to pick specific slots from an
event's context.
"""
from datetime import date, timedelta

from . import db

DEFAULT_RANGE_DAYS = 4


def create_routes_around_date(origin: str, destination: str, target_date: date,
                               range_before: int = DEFAULT_RANGE_DAYS,
                               range_after: int = DEFAULT_RANGE_DAYS) -> list[str]:
    """Creates one route per day from target_date - range_before to
    target_date + range_after (inclusive). Dates that already have a
    matching non-expired route (e.g. from a previous add-route call, or an
    event) are reused rather than duplicated. Returns the ids of routes
    newly created — not the full window, since existing ones are skipped.
    """
    if range_before < 0 or range_after < 0:
        raise ValueError("range_before/range_after must be >= 0")

    created_route_ids: list[str] = []
    current = target_date - timedelta(days=range_before)
    end = target_date + timedelta(days=range_after)

    while current <= end:
        route_id, created = db.add_route_if_new(origin, destination, current.isoformat())
        if created:
            created_route_ids.append(route_id)
        current += timedelta(days=1)

    return created_route_ids
