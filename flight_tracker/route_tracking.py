"""Route tracking flow — run twice a day via cron. Covers both event-derived
routes (fixed flight_date, chosen by the AI once at event-creation time) and
manually-added long-term routes (rolling "today + N days" date). Per
architecture v2: decrease -> always email, increase -> always email, no AI
call at this stage — event context comes from the ai_reasoning saved on the
route when it was created.
"""
from datetime import date, datetime, timedelta, timezone

from . import db, email_sender, pricing, serpapi_client, time_windows, timeutils


def _target_date(route) -> date:
    if route["flight_date"]:
        return date.fromisoformat(route["flight_date"])
    return date.today() + timedelta(days=route["target_date_offset_days"])


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


def check_route(route) -> None:
    target_date = _target_date(route)
    options = serpapi_client.search_flights(route["origin"], route["destination"], target_date)
    preferred_window = time_windows.parse_time_window(route["preferred_time_window"])
    best_options, matched_preferred_window = serpapi_client.cheapest_distinct_airlines(
        options, preferred_window=preferred_window,
    )
    if not best_options:
        print(f"[route {route['id']}] no flights found for "
              f"{route['origin']}->{route['destination']} on {timeutils.format_dmy(target_date)}")
        return

    if preferred_window is not None and not matched_preferred_window:
        print(f"[route {route['id']}] no flights within preferred window "
              f"'{route['preferred_time_window']}' — falling back to cheapest overall")

    checked_at = timeutils.now_utc_iso()
    last_price_row = db.get_last_price(route["id"], before_checked_at=checked_at)

    for opt in best_options:
        db.add_price_record(
            route_id=route["id"],
            flight_date=target_date.isoformat(),
            departure_time=opt.departure_time,
            price=opt.price,
            airline=opt.airline,
            checked_at=checked_at,
            matched_preferred_window=matched_preferred_window,
        )
    current_price = min(opt.price for opt in best_options)

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
        }
        for opt in best_options
    ]

    if change == "decrease":
        new_low = pricing.is_new_low(current_price, history_prices)
        subject, body = email_sender.format_price_decrease(
            route["origin"], route["destination"], current_options, last_price_row["price"],
            target_date, route["preferred_time_window"], baseline, new_low,
            event_name=event_name, days_to_event=days_to_event, ai_reasoning=route["ai_reasoning"],
        )
        notif_type = "price_drop"
    else:  # increase
        subject, body = email_sender.format_price_increase(
            route["origin"], route["destination"], current_options, last_price_row["price"],
            target_date, event_name=event_name, days_to_event=days_to_event,
        )
        notif_type = "price_increase"

    email_sender.send_email(subject, body)
    db.log_notification(route["id"], notif_type, timeutils.now_utc_iso(), body)


def run() -> None:
    expired_count = db.expire_due_event_routes(timeutils.now_utc_iso())
    if expired_count:
        print(f"Expired {expired_count} route(s) whose linked event has passed.")

    routes = db.list_active_routes()
    if not routes:
        print("No active ('tracking') routes to check.")
        return
    for route in routes:
        try:
            check_route(route)
        except Exception as exc:  # one route failing shouldn't block the rest
            print(f"[route {route['id']}] ERROR: {exc}")
