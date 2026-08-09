"""Provider-selection layer for flight price fetching. route_tracking.py
calls search_flights here instead of talking to fast_flights_client or
serpapi_client directly, so the active-provider choice (config.
flight_provider) and its fallback behavior live in exactly one place.

SerpApi runs underneath even when fast_flights is the configured provider,
in two cases:
  - round-trip searches: fast_flights_client has no return-leg resolution
    (see its module docstring), so these always go to SerpApi.
  - any search where fast-flights raises (site structure changed, blocked,
    network error, etc.) — logged clearly, then retried once against
    SerpApi for that call, per the migration brief's fallback requirement.

fetch_return_leg is SerpApi-only regardless of provider: it's only ever
called after a round-trip search, which per the above is already always a
SerpApi search.
"""
from datetime import date
from typing import Optional

from . import config, fast_flights_client, serpapi_client
# Re-exported for route_tracking.py — these are provider-agnostic /
# SerpApi-only and don't need a dispatch layer of their own.
from .serpapi_client import FlightOption, cheapest_distinct_airlines, fetch_return_leg  # noqa: F401


def search_flights(origin: str, destination: str, flight_date: date,
                    return_date: Optional[date] = None) -> list[FlightOption]:
    provider = config.flight_provider()

    if provider != "fast_flights":
        return serpapi_client.search_flights(origin, destination, flight_date, return_date)

    if return_date is not None:
        print(f"[flight_provider] round-trip {origin}->{destination} on {flight_date}: "
              "fast-flights has no return-leg resolution yet, using SerpApi for this search.")
        return serpapi_client.search_flights(origin, destination, flight_date, return_date)

    try:
        return fast_flights_client.search_flights(origin, destination, flight_date)
    except fast_flights_client.FastFlightsError as exc:
        print(f"[flight_provider] fast-flights failed for {origin}->{destination} on {flight_date}: "
              f"{exc}. Falling back to SerpApi for this run.")
        return serpapi_client.search_flights(origin, destination, flight_date, return_date)
