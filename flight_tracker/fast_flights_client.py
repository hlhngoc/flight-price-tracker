"""Thin wrapper around the fast-flights library, which scrapes Google
Flights directly (no paid API in front of it). This is the primary provider
per config.flight_provider(); flight_provider.py holds the selection/
fallback logic that decides when to use this module vs serpapi_client.

Docs: https://github.com/AWeirdDev/flights

KNOWN LIMITATIONS (flag if hit in production, do not silently work around):
- No official rate limit or SLA. Google may throttle or block requests from
  a given IP, and GitHub Actions runners share a small IP pool, so this is
  more likely to get blocked than a residential/paid-proxy IP would be.
- Scrapes Google Flights' page markup directly; if Google changes it,
  parsing can start failing with no advance warning. Any failure here
  raises FastFlightsError, which flight_provider.py catches and falls back
  to SerpApi for that run.
- Round-trip: a single query already returns a combined round-trip price,
  but unlike SerpApi's two-step departure_token flow, the library exposes
  no second step to resolve which specific return-leg flight (airline,
  departure time) that price corresponds to. Since round-trip isn't live in
  production yet, search_flights here only supports one-way; passing a
  return_date raises FastFlightsRoundTripUnsupported so
  flight_provider.py can route those searches to SerpApi instead, keeping
  return_airline/return_departure_time fully populated whenever round-trip
  does ship.
"""
from datetime import date
from typing import Optional

from fast_flights import FlightQuery, FlightsNotFound, create_filter, get_flights

from .serpapi_client import FlightOption  # same shape callers already rely on


class FastFlightsError(RuntimeError):
    pass


class FastFlightsRoundTripUnsupported(RuntimeError):
    pass


def _format_datetime(simple_datetime) -> str:
    """simple_datetime is a fast_flights.model.SimpleDatetime: date=(Y, M, D),
    time=(H,) or (H, M). Both the minute (a trailing element simply omitted
    on the hour, e.g. time=(5,) for 05:00) and, observed in practice, an
    on-the-hour component of exactly midnight (time=(None, 25) for 00:25)
    can come back missing or None rather than 0 — Google's underlying
    payload appears to represent a literal 0 that way in some slots.
    Formats to "YYYY-MM-DD HH:MM" to match SerpApi's convention, which
    time_windows.py and downstream comparisons rely on.
    """
    year, month, day = simple_datetime.date
    hour = simple_datetime.time[0] if simple_datetime.time and simple_datetime.time[0] is not None else 0
    minute = simple_datetime.time[1] if len(simple_datetime.time) > 1 and simple_datetime.time[1] is not None else 0
    return f"{year:04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}"


def _parse_flights(results) -> list[FlightOption]:
    options: list[FlightOption] = []
    for entry in results:
        legs = entry.flights
        if not legs:
            continue
        first_leg, last_leg = legs[0], legs[-1]
        durations = [leg.duration for leg in legs if leg.duration is not None]
        options.append(
            FlightOption(
                price=int(entry.price),
                airline=entry.airlines[0] if entry.airlines else "?",
                departure_time=_format_datetime(first_leg.departure),
                arrival_time=_format_datetime(last_leg.arrival),
                # Sum of leg durations only — excludes layover time between
                # connections, unlike SerpApi's total_duration which covers
                # the whole itinerary. Not currently read by any caller
                # (see FlightOption), so the approximation is harmless.
                duration_minutes=sum(durations) if durations else None,
            )
        )
    return options


def search_flights(origin: str, destination: str, flight_date: date,
                    return_date: Optional[date] = None) -> list[FlightOption]:
    """One-way search only — see module docstring for why round-trip isn't
    implemented here. Raises FastFlightsRoundTripUnsupported if return_date
    is given.

    Raises FastFlightsError on any scrape failure (site structure changed,
    blocked, network error, etc.) rather than returning a misleadingly
    empty/wrong result — callers should catch this and fall back to
    SerpApi. Returns an empty list (not an error) when the query is valid
    but Google genuinely has nothing for that date, same convention as
    serpapi_client.search_flights.
    """
    if return_date is not None:
        raise FastFlightsRoundTripUnsupported(
            f"fast-flights has no return-leg resolution for {origin}->{destination} "
            f"(round-trip {flight_date} / {return_date}); route to SerpApi instead"
        )

    try:
        query = create_filter(
            flights=[FlightQuery(date=flight_date.isoformat(), from_airport=origin, to_airport=destination)],
            trip="one-way",
            seat="economy",
            currency="VND",
            language="vi",
        )
        results = get_flights(query)
    except FlightsNotFound:
        return []
    except FastFlightsRoundTripUnsupported:
        raise
    except Exception as exc:
        raise FastFlightsError(
            f"fast-flights search failed for {origin}->{destination} on {flight_date}: {exc}"
        ) from exc

    return _parse_flights(results)
