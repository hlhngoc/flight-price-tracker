"""Thin wrapper around SerpApi's Google Flights engine.

Docs: https://serpapi.com/google-flights-api
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

from . import config, time_windows

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
    # Only present on round-trip (type=1) outbound-leg entries — pass it to
    # fetch_return_leg to get the matching return-leg options + the final
    # combined round-trip price for that specific outbound option. Always
    # None for one-way (type=2) results.
    departure_token: Optional[str] = None


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
                    departure_token=entry.get("departure_token"),
                )
            )
    return options


def search_flights(origin: str, destination: str, flight_date: date,
                    return_date: Optional[date] = None) -> list[FlightOption]:
    """Search for the cheapest options on a given outbound date — one-way
    by default, or round-trip (outbound leg only) when return_date is
    given. For round trip, each returned option's `price` is not yet the
    final combined price and its `departure_token` must be passed to
    fetch_return_leg to resolve the actual return leg + final price (see
    that function's docstring).

    Returns an empty list if SerpApi has nothing for that date (rather than
    raising) so callers can decide whether to skip vs. hard-fail.
    """
    params = {
        "engine": "google_flights",
        "api_key": config.serpapi_key(),
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": flight_date.isoformat(),
        "type": "1" if return_date else "2",  # 1 = round trip, 2 = one-way
        "currency": "VND",
        "hl": "vi",
        "gl": "vn",
    }
    if return_date:
        params["return_date"] = return_date.isoformat()
    resp = requests.get(SERPAPI_URL, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    error = payload.get("error")
    if error:
        raise SerpApiError(f"SerpApi error for {origin}->{destination} on {flight_date}: {error}")

    return _parse_flights(payload)


def fetch_return_leg(origin: str, destination: str, outbound_date: date, return_date: date,
                      departure_token: str) -> list[FlightOption]:
    """Second call in the round-trip flow: given a departure_token from one
    of search_flights' round-trip outbound options, fetches the matching
    return-leg options for that specific outbound choice. Each returned
    option's `departure_time`/`airline` describe the RETURN leg, and
    `price` is now the final combined round-trip price for outbound+this
    return option — not the outbound-only price search_flights returned.

    Returns an empty list if SerpApi has nothing for this token (rather
    than raising), same convention as search_flights.
    """
    params = {
        "engine": "google_flights",
        "api_key": config.serpapi_key(),
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": outbound_date.isoformat(),
        "return_date": return_date.isoformat(),
        "type": "1",
        "departure_token": departure_token,
        "currency": "VND",
        "hl": "vi",
        "gl": "vn",
    }
    resp = requests.get(SERPAPI_URL, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    error = payload.get("error")
    if error:
        raise SerpApiError(
            f"SerpApi error resolving return leg for {origin}->{destination} "
            f"({outbound_date} / {return_date}): {error}"
        )

    return _parse_flights(payload)


def _pick_distinct_airlines(options: list[FlightOption], max_results: int) -> list[FlightOption]:
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


def cheapest_distinct_airlines(
    options: list[FlightOption],
    preferred_window: Optional[tuple[int, int]] = None,
    max_results: int = 2,
) -> tuple[list[FlightOption], bool]:
    """Returns (picked_options, matched_preferred_window).

    picked_options holds up to `max_results` options, price-ascending, each
    from a different airline. Which airlines come out cheapest isn't fixed
    — it's whatever SerpApi returns lowest on a given check, so this can
    vary from one check to the next. A single-airline response yields a
    single-element list rather than erroring.

    If `preferred_window` (start_hour, end_hour) is given, options are
    first filtered to those departing inside it, and the selection above
    runs on that filtered set instead — matched_preferred_window is True.
    If nothing departs inside the window at this check, falls back to the
    full unfiltered list and matched_preferred_window is False, so callers
    can flag that this result doesn't reflect the route's actual
    preference. With no preferred_window, behaves exactly as before and
    matched_preferred_window is always True.
    """
    if preferred_window is None:
        return _pick_distinct_airlines(options, max_results), True

    in_window = [o for o in options if time_windows.is_within_window(o.departure_time, preferred_window)]
    if in_window:
        return _pick_distinct_airlines(in_window, max_results), True

    return _pick_distinct_airlines(options, max_results), False
