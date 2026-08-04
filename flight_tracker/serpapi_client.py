"""Thin wrapper around SerpApi's Google Flights engine.

Docs: https://serpapi.com/google-flights-api
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

from . import config

SERPAPI_URL = "https://serpapi.com/search"


class SerpApiError(RuntimeError):
    pass


@dataclass
class FlightOption:
    price: int
    airline: str
    departure_time: str   # "YYYY-MM-DD HH:MM"
    arrival_time: str     # "YYYY-MM-DD HH:MM"
    duration_minutes: Optional[int]


def _parse_flights(payload: dict) -> list[FlightOption]:
    options: list[FlightOption] = []
    for bucket in ("best_flights", "other_flights"):
        for entry in payload.get(bucket, []):
            legs = entry.get("flights") or []
            if not legs or "price" not in entry:
                continue
            first_leg, last_leg = legs[0], legs[-1]
            options.append(
                FlightOption(
                    price=int(entry["price"]),
                    airline=first_leg.get("airline", "?"),
                    departure_time=first_leg.get("departure_airport", {}).get("time", ""),
                    arrival_time=last_leg.get("arrival_airport", {}).get("time", ""),
                    duration_minutes=entry.get("total_duration"),
                )
            )
    return options


def search_flights(origin: str, destination: str, flight_date: date) -> list[FlightOption]:
    """One-way search for the cheapest options on a given date.

    Returns an empty list if SerpApi has nothing for that date (rather than
    raising) so callers can decide whether to skip vs. hard-fail.
    """
    params = {
        "engine": "google_flights",
        "api_key": config.serpapi_key(),
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": flight_date.isoformat(),
        "type": "2",  # one-way
        "currency": "VND",
        "hl": "vi",
        "gl": "vn",
    }
    resp = requests.get(SERPAPI_URL, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    error = payload.get("error")
    if error:
        raise SerpApiError(f"SerpApi error for {origin}->{destination} on {flight_date}: {error}")

    return _parse_flights(payload)


def cheapest_distinct_airlines(options: list[FlightOption], max_results: int = 2) -> list[FlightOption]:
    """Returns up to `max_results` options, price-ascending, each from a
    different airline: the overall cheapest first, then the cheapest option
    from a distinct airline, and so on. Which airlines come out "cheapest"
    is not fixed — it's whatever SerpApi returns lowest on a given check, so
    this can vary from one check to the next. If the response only has one
    distinct airline, returns a single-element list rather than erroring.
    """
    picked: list[FlightOption] = []
    seen_airlines: set[str] = set()
    for opt in sorted(options, key=lambda o: o.price):
        if opt.airline in seen_airlines:
            continue
        picked.append(opt)
        seen_airlines.add(opt.airline)
        if len(picked) >= max_results:
            break
    return picked
