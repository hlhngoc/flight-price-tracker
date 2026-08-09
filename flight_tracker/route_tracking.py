"""Route tracking flow — run twice a day via cron. Covers both event-derived
routes (fixed flight_date, chosen by the AI once at event-creation time) and
manually-added long-term routes (rolling "today + N days" date). Per
architecture v2: decrease -> always email, increase -> always email, no AI
call at this stage — event context comes from the ai_reasoning saved on the
route when it was created.
"""
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from . import db, email_sender, flight_provider, pricing, serpapi_client, time_windows, timeutils

# Google Flights (via whichever provider is active — see flight_provider.py)
# sometimes returns a thinner result set — e.g.
# only 1 airline instead of several — on the very first query for a given
# origin/destination/date, then a fuller one on an identical query moments
# later. This is most visible right after a route is created and checked
# immediately (the auto-trigger on add-event), since that's the one case
# where we're guaranteed to be the *first ever* query for that route+date.
# A short retry-with-delay smooths this over.
RETRY_MIN_DISTINCT_AIRLINES = 2
RETRY_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 5

# Round-trip cost-reduction flow (see _check_round_trip): airlines generally
# don't offer bundled round-trip discounts across two *different* carriers
# (no interline fare agreement) — this is an industry-standard assumption,
# not verified empirically against VNA/VietJet/Bamboo specifically. If a
# mixed-carrier round trip is ever observed priced meaningfully below the
# sum of its two one-way legs, that contradicts this assumption — flag it,
# don't silently adjust the logic here.
#
# For a *same*-carrier round trip, a real bundle discount is plausible, so
# its true price is periodically re-verified against SerpApi's actual
# round-trip fare (2-step departure_token flow) rather than trusted as
# "sum of two one-way fast-flights legs" indefinitely. Between
# verifications, a cheaper combined price is still allowed to surface (a
# real price drop shouldn't wait out the interval), but a combined price
# that's *not* cheaper than the last known bundle price is discarded —
# it's likely just missing the bundle discount, not a genuine change.
BUNDLE_VERIFY_INTERVAL_DAYS = 5


def _target_date(route) -> date:
    if route["flight_date"]:
        return date.fromisoformat(route["flight_date"])
    return date.today() + timedelta(days=route["target_date_offset_days"])


def _return_date(route) -> Optional[date]:
    """None for one-way routes. return_date is only ever set alongside a
    concrete flight_date (see the round-trip feature's scope notes — legacy
    offset-based routes never get one), so no offset-based fallback here."""
    return_date_str = route.get("return_date")
    return date.fromisoformat(return_date_str) if return_date_str else None


@dataclass
class ResolvedPriceOption:
    """The uniform shape _write_and_notify operates on, for both one-way
    and round-trip routes. For one-way, return_airline/return_departure_time
    stay None and `price` is exactly FlightOption.price. For round-trip,
    `price` is always the FINAL combined round-trip price — either the two
    independent fast-flights legs summed (_check_round_trip's "combined"
    path) or the true bundle fare from serpapi_client.fetch_return_leg (its
    "bundle" path, via _fetch_serpapi_bundle) — never an outbound-only
    price. Everything downstream (price-comparison, price_history, email)
    must only ever read `price` off this dataclass.
    """
    price: int
    airline: str
    departure_time: str
    return_airline: Optional[str] = None
    return_departure_time: Optional[str] = None


def _days_since(iso_timestamp: str) -> float:
    """iso_timestamp must be one of our own timeutils.now_utc_iso() strings
    (UTC-aware, explicit offset) — see route_tracking's only writer of
    last_bundle_verified_at, db.set_route_last_bundle_verified_at.
    """
    then = datetime.fromisoformat(iso_timestamp)
    return (datetime.now(timezone.utc) - then).total_seconds() / 86400


def _days_to_event(event) -> int:
    event_date_vn = timeutils.utc_iso_to_vn_date(event["event_datetime"])
    return (event_date_vn - timeutils.vn_today()).days


def _cheapest_per_check(history_rows: list[dict]) -> list[int]:
    """Each check now writes up to 2 rows (one per distinct cheapest
    airline) sharing the same checked_at. Baseline/new-low stats should
    reflect one price per check — the cheapest of the pair — not both, or
    the mean/stdev would skew from double-counting correlated pairs.
    """
    cheapest_by_checked_at: dict[str, int] = {}
    for row in history_rows:
        checked_at = row["checked_at"]
        price = row["price"]
        if checked_at not in cheapest_by_checked_at or price < cheapest_by_checked_at[checked_at]:
            cheapest_by_checked_at[checked_at] = price
    return list(cheapest_by_checked_at.values())


def _search_and_select(route, target_date: date, return_date: Optional[date], preferred_window):
    """Searches + picks cheapest-distinct-airline options, retrying a
    couple of times (see RETRY_* above) if the first attempt comes back
    thin. Keeps the fullest result seen across attempts, not just the last.

    For round-trip routes (return_date given), this only resolves the
    OUTBOUND leg — options here still carry outbound-only prices and a
    departure_token; _resolve_return_legs does the second SerpApi call to
    get the final combined price + return leg. The retry logic here only
    ever re-runs this outbound call, never the return-leg resolution.
    """
    options = flight_provider.search_flights(route["origin"], route["destination"], target_date, return_date)
    best_options, matched = flight_provider.cheapest_distinct_airlines(options, preferred_window=preferred_window)

    for attempt in range(1, RETRY_ATTEMPTS + 1):
        if len(best_options) >= RETRY_MIN_DISTINCT_AIRLINES:
            break
        time.sleep(RETRY_DELAY_SECONDS)
        retry_raw = flight_provider.search_flights(route["origin"], route["destination"], target_date, return_date)
        retry_options, retry_matched = flight_provider.cheapest_distinct_airlines(
            retry_raw, preferred_window=preferred_window,
        )
        if len(retry_options) > len(best_options):
            print(f"[route {route['id']}] retry {attempt} found more options "
                  f"({len(retry_options)} vs {len(best_options)}), using it")
            best_options, matched = retry_options, retry_matched

    return best_options, matched


def _resolve_return_legs(route, target_date: date, return_date: date,
                          outbound_options: list) -> list[ResolvedPriceOption]:
    """Second-call resolution for round-trip routes: for each outbound
    candidate (up to the existing max_results=2 distinct OUTBOUND-leg
    airlines from _search_and_select — this "2 different airlines"
    selection is unchanged from one-way and is never re-applied to the
    return leg), fetches the matching return-leg options via
    fetch_return_leg and keeps the cheapest one. Because departure_token is
    per-outbound-option, the two resolved candidates can (and often will)
    come back with different return-leg airlines from each other, and
    either may coincidentally share an airline with its own outbound leg
    or with the other candidate's return leg — expected, not deduped
    further. Skips a candidate (doesn't fail the whole check) if its token
    is missing or its return-leg call comes back empty; no retry here.
    """
    resolved: list[ResolvedPriceOption] = []
    for outbound in outbound_options:
        if not outbound.departure_token:
            print(f"[route {route['id']}] outbound option from {outbound.airline} has no "
                  "departure_token, skipping return-leg resolution for it")
            continue
        return_options = serpapi_client.fetch_return_leg(
            route["origin"], route["destination"], target_date, return_date, outbound.departure_token,
        )
        if not return_options:
            print(f"[route {route['id']}] no return-leg options for outbound {outbound.airline} "
                  f"({outbound.departure_time}), skipping this candidate")
            continue
        cheapest_return = min(return_options, key=lambda o: o.price)
        resolved.append(
            ResolvedPriceOption(
                price=cheapest_return.price,
                airline=outbound.airline,
                departure_time=outbound.departure_time,
                return_airline=cheapest_return.airline,
                return_departure_time=cheapest_return.departure_time,
            )
        )
    return resolved


def _write_and_notify(route, checked_at: str, options: list[ResolvedPriceOption], matched_preferred_window: bool,
                       target_date: date, return_date: Optional[date],
                       price_source: Optional[str] = None) -> None:
    """Shared tail for both one-way and round-trip checks: writes one
    price_history row per option, compares the cheapest against the last
    check, and emails on a price change. options holds up to 2 candidates
    for one-way (cheapest-distinct-airline pairs) or exactly 1 for
    round-trip (see _check_round_trip) — price_source is round-trip-only,
    left None for one-way writes.
    """
    last_price_row = db.get_last_price(route["id"], before_checked_at=checked_at)

    for opt in options:
        db.add_price_record(
            route_id=route["id"],
            flight_date=target_date.isoformat(),
            departure_time=opt.departure_time,
            price=opt.price,
            airline=opt.airline,
            checked_at=checked_at,
            matched_preferred_window=matched_preferred_window,
            return_departure_time=opt.return_departure_time,
            return_airline=opt.return_airline,
            price_source=price_source,
        )
    current_price = min(opt.price for opt in options)

    if last_price_row is None:
        print(f"[route {route['id']}] first check for this route, nothing to compare yet")
        return

    change = pricing.classify(current_price, last_price_row["price"])
    if change == "unchanged":
        return

    since = (datetime.now(timezone.utc) - timedelta(days=pricing.BASELINE_DAYS)).isoformat()
    history_rows = db.get_price_history_since(route["id"], since, before_checked_at=checked_at)
    history_prices = _cheapest_per_check(history_rows)
    baseline = pricing.compute_baseline(history_prices)

    event = db.get_event(route["event_id"]) if route["event_id"] else None
    event_name = event["event_name"] if event else None
    days_to_event = _days_to_event(event) if event else None

    current_options = [
        {
            "price": opt.price,
            "airline": opt.airline,
            "departure_time": opt.departure_time,
            "matched_preferred_window": matched_preferred_window,
            "return_airline": opt.return_airline,
            "return_departure_time": opt.return_departure_time,
        }
        for opt in options
    ]

    if change == "decrease":
        new_low = pricing.is_new_low(current_price, history_prices)
        subject, body = email_sender.format_price_decrease(
            route["origin"], route["destination"], current_options, last_price_row["price"],
            target_date, route["preferred_time_window"], baseline, new_low,
            event_name=event_name, days_to_event=days_to_event, ai_reasoning=route["ai_reasoning"],
            return_date=return_date,
        )
        notif_type = "price_drop"
    else:  # increase
        subject, body = email_sender.format_price_increase(
            route["origin"], route["destination"], current_options, last_price_row["price"],
            target_date, event_name=event_name, days_to_event=days_to_event,
            return_date=return_date,
        )
        notif_type = "price_increase"

    email_sender.send_email(subject, body)
    db.log_notification(route["id"], notif_type, timeutils.now_utc_iso(), body)


def _cheapest_leg_option(origin: str, destination: str, leg_date: date,
                          preferred_window: Optional[tuple[int, int]]) -> tuple[Optional["serpapi_client.FlightOption"], bool]:
    """Single cheapest option for one leg, searched as a plain one-way query
    (via flight_provider — respects FLIGHT_PROVIDER and its fast-flights/
    SerpApi fallback same as everything else). Returns (None, False) if the
    leg has no options at all.
    """
    options = flight_provider.search_flights(origin, destination, leg_date)
    picked, matched = flight_provider.cheapest_distinct_airlines(options, preferred_window=preferred_window, max_results=1)
    return (picked[0], matched) if picked else (None, matched)


def _resolve_round_trip_legs(route, target_date: date, return_date: date, preferred_window):
    """Fetches the outbound and return legs independently — the core of the
    round-trip cost-reduction flow (see BUNDLE_VERIFY_INTERVAL_DAYS): two
    free fast-flights calls instead of SerpApi's paid 2-step flow. Mirrors
    one-way's convention of only ever filtering by preferred_window on the
    OUTBOUND leg — the return leg has never been time-filtered here, same
    as the pre-existing SerpApi _resolve_return_legs, which also just takes
    the globally cheapest return-leg option.
    """
    outbound_option, matched = _cheapest_leg_option(route["origin"], route["destination"], target_date, preferred_window)
    return_option, _ = _cheapest_leg_option(route["destination"], route["origin"], return_date, None)
    return outbound_option, return_option, matched


def _fetch_serpapi_bundle(route, target_date: date, return_date: date, preferred_window) -> Optional[ResolvedPriceOption]:
    """Periodic re-verification of a same-carrier round trip's actual
    bundle-discounted price, via SerpApi's existing 2-step departure_token
    flow (_search_and_select + _resolve_return_legs — unchanged, still
    SerpApi-only regardless of FLIGHT_PROVIDER). Only called when due per
    BUNDLE_VERIFY_INTERVAL_DAYS, so this is the one place round-trip
    checking still spends SerpApi quota. Returns None if either step comes
    back empty.
    """
    outbound_options, _ = _search_and_select(route, target_date, return_date, preferred_window)
    if not outbound_options:
        return None
    resolved = _resolve_return_legs(route, target_date, return_date, outbound_options)
    if not resolved:
        return None
    return min(resolved, key=lambda o: o.price)


def _check_round_trip(route, target_date: date, return_date: date, preferred_window) -> None:
    """Round-trip pricing via fast-flights, with SerpApi used only to
    verify same-carrier bundle discounts (see BUNDLE_VERIFY_INTERVAL_DAYS
    for the reasoning). Replaces the old always-SerpApi round-trip flow.
    """
    outbound_option, return_option, matched_preferred_window = _resolve_round_trip_legs(
        route, target_date, return_date, preferred_window,
    )
    if outbound_option is None or return_option is None:
        print(f"[route {route['id']}] no flights found for one or both legs of round trip "
              f"{route['origin']}->{route['destination']} ({timeutils.format_dmy(target_date)} outbound / "
              f"{timeutils.format_dmy(return_date)} return)")
        return

    if preferred_window is not None and not matched_preferred_window:
        print(f"[route {route['id']}] no outbound flights within preferred window "
              f"'{route['preferred_time_window']}' — falling back to cheapest overall")

    combined_price = outbound_option.price + return_option.price
    combined_option = ResolvedPriceOption(
        price=combined_price,
        airline=outbound_option.airline,
        departure_time=outbound_option.departure_time,
        return_airline=return_option.airline,
        return_departure_time=return_option.departure_time,
    )
    checked_at = timeutils.now_utc_iso()

    if outbound_option.airline != return_option.airline:
        # Different carriers: no interline bundle discount to check for —
        # see BUNDLE_VERIFY_INTERVAL_DAYS' docstring. Combined price is
        # final, no SerpApi call needed.
        _write_and_notify(route, checked_at, [combined_option], matched_preferred_window,
                           target_date, return_date, price_source="combined")
        return

    last_verified_at = route.get("last_bundle_verified_at")
    needs_verification = last_verified_at is None or _days_since(last_verified_at) > BUNDLE_VERIFY_INTERVAL_DAYS

    if needs_verification:
        bundle_option = _fetch_serpapi_bundle(route, target_date, return_date, preferred_window)
        if bundle_option is None:
            print(f"[route {route['id']}] same-carrier round trip but SerpApi bundle verification came back "
                  "empty — using combined fast-flights price for this check instead")
            _write_and_notify(route, checked_at, [combined_option], matched_preferred_window,
                               target_date, return_date, price_source="combined")
            return
        db.set_route_last_bundle_verified_at(route["id"], checked_at)
        _write_and_notify(route, checked_at, [bundle_option], matched_preferred_window,
                           target_date, return_date, price_source="bundle")
        return

    last_price_row = db.get_latest_price(route["id"])
    last_bundle_price = last_price_row["price"] if last_price_row else None
    if last_bundle_price is not None and combined_price < last_bundle_price:
        # A cheaper price surfaced between verifications — worth trusting
        # and worth re-verifying against SerpApi again soon, so treat this
        # as a fresh signal (reset the interval) rather than waiting out
        # the full BUNDLE_VERIFY_INTERVAL_DAYS from the original check.
        db.set_route_last_bundle_verified_at(route["id"], checked_at)
        _write_and_notify(route, checked_at, [combined_option], matched_preferred_window,
                           target_date, return_date, price_source="combined")
        return

    print(f"[route {route['id']}] same-carrier round trip, verified within the last "
          f"{BUNDLE_VERIFY_INTERVAL_DAYS}d — combined fast-flights price {combined_price:,} isn't cheaper than "
          f"the last known bundle price {last_bundle_price:,}, keeping it as authoritative; no new record written")


def check_route(route) -> None:
    target_date = _target_date(route)
    return_date = _return_date(route)
    preferred_window = time_windows.parse_time_window(route["preferred_time_window"])

    if return_date is not None:
        _check_round_trip(route, target_date, return_date, preferred_window)
        return

    outbound_options, matched_preferred_window = _search_and_select(route, target_date, None, preferred_window)
    if not outbound_options:
        print(f"[route {route['id']}] no flights found for "
              f"{route['origin']}->{route['destination']} on {timeutils.format_dmy(target_date)}")
        return

    if preferred_window is not None and not matched_preferred_window:
        print(f"[route {route['id']}] no flights within preferred window "
              f"'{route['preferred_time_window']}' — falling back to cheapest overall")

    best_options = [
        ResolvedPriceOption(price=opt.price, airline=opt.airline, departure_time=opt.departure_time)
        for opt in outbound_options
    ]
    checked_at = timeutils.now_utc_iso()
    _write_and_notify(route, checked_at, best_options, matched_preferred_window, target_date, None)


def run(route_ids: list[str] | None = None) -> None:
    """With route_ids given, only checks those specific routes (skipping any
    that aren't 'tracking') — used for an immediate check right after
    add-event creates new routes, so it doesn't burn SerpApi quota
    re-checking every other active route too. Without it, checks everything
    'tracking' — the normal cron behavior.
    """
    expired_count = db.expire_due_event_routes(timeutils.now_utc_iso())
    if expired_count:
        print(f"Expired {expired_count} route(s) whose linked event has passed.")

    if route_ids is not None:
        routes = [r for r in (db.get_route(rid) for rid in route_ids) if r is not None and r["status"] == "tracking"]
    else:
        routes = db.list_active_routes()

    if not routes:
        print("No active ('tracking') routes to check.")
        return
    for route in routes:
        try:
            check_route(route)
        except Exception as exc:  # one route failing shouldn't block the rest
            print(f"[route {route['id']}] ERROR: {exc}")
