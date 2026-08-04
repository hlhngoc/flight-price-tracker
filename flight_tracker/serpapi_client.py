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


def cheapest(options: list[FlightOption]) -> Optional[FlightOption]:
    if not options:
        return None
    return min(options, key=lambda o: o.price)
