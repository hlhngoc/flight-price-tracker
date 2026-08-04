"""Route tracking flow — run twice a day via cron. Covers both event-derived
routes (fixed flight_date, chosen by the AI once at event-creation time) and
manually-added long-term routes (rolling "today + N days" date). Per
architecture v2: decrease -> always email, increase -> always email, no AI
call at this stage — event context comes from the ai_reasoning saved on the
route when it was created.
"""
from datetime import date, datetime, timedelta, timezone

from . import db, email_sender, pricing, serpapi_client, timeutils


def _target_date(route) -> date:
    if route["flight_date"]:
        return date.fromisoformat(route["flight_date"])
    return date.today() + timedelta(days=route["target_date_offset_days"])


def _days_to_event(event) -> int:
    event_date_vn = timeutils.utc_iso_to_vn_date(event["event_datetime"])
    return (event_date_vn - timeutils.vn_today()).days


def check_route(route) -> None:
    target_date = _target_date(route)
    options = serpapi_client.search_flights(route["origin"], route["destination"], target_date)
    best = serpapi_client.cheapest(options)
    if best is None:
        print(f"[route {route['id']}] no flights found for "
              f"{route['origin']}->{route['destination']} on {timeutils.format_dmy(target_date)}")
        return

    checked_at = timeutils.now_utc_iso()
    last_price_row = db.get_last_price(route["id"], before_checked_at=checked_at)

    db.add_price_record(
        route_id=route["id"],
        flight_date=target_date.isoformat(),
        departure_time=best.departure_time,
        price=best.price,
        airline=best.airline,
        checked_at=checked_at,
    )

    if last_price_row is None:
        print(f"[route {route['id']}] first check for this route, nothing to compare yet")
        return

    change = pricing.classify(best.price, last_price_row["price"])
    if change == "unchanged":
        return

    since = (datetime.now(timezone.utc) - timedelta(days=pricing.BASELINE_DAYS)).isoformat()
    history_rows = db.get_price_history_since(route["id"], since, before_checked_at=checked_at)
    history_prices = [r["price"] for r in history_rows]
    baseline = pricing.compute_baseline(history_prices)

    event = db.get_event(route["event_id"]) if route["event_id"] else None
    event_name = event["event_name"] if event else None
    days_to_event = _days_to_event(event) if event else None

    if change == "decrease":
        new_low = pricing.is_new_low(best.price, history_prices)
        subject, body = email_sender.format_price_decrease(
            route["origin"], route["destination"], best.price, last_price_row["price"],
            target_date, route["preferred_time_window"], baseline, new_low,
            event_name=event_name, days_to_event=days_to_event, ai_reasoning=route["ai_reasoning"],
        )
        notif_type = "price_drop"
    else:  # increase
        subject, body = email_sender.format_price_increase(
            route["origin"], route["destination"], best.price, last_price_row["price"],
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
