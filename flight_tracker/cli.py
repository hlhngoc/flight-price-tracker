"""Command-line entry point.

Examples:
    # Manually tracked routes around a fixed date you expect to fly (recommended) —
    # creates one route per day from 16-09-2026 to 24-09-2026 (target +/- 4 days)
    python -m flight_tracker.cli add-route --origin HAN --destination SGN --target-date 20-09-2026

    python -m flight_tracker.cli add-route --origin HAN --destination SGN \
        --target-date 20-09-2026 --range-before 2 --range-after 6 \
        --time-window "Chiều (12:00-18:00)"

    # Legacy: a single rolling "today + N days" route instead of a fixed date
    python -m flight_tracker.cli add-route --origin HAN --destination SGN --offset-days 30

    # Event input: calls Gemini once, auto-inserts the resulting slots as routes
    python -m flight_tracker.cli add-event --name "Dam cuoi ban A" \
        --datetime "2026-09-14 09:00" --location "Da Nang" --origin "Ha Noi" --flexibility-days 3

    python -m flight_tracker.cli list-routes
    python -m flight_tracker.cli list-events
    python -m flight_tracker.cli check-routes
    python -m flight_tracker.cli mark-booked --route-id 3
    python -m flight_tracker.cli expire-routes
"""
import argparse
from datetime import datetime, timedelta

from . import db, event_suggestion, route_range, route_tracking, time_windows, timeutils


def cmd_add_route(args) -> None:
    origin = args.origin.upper()
    destination = args.destination.upper()

    if args.target_date:
        target_date = timeutils.parse_dmy(args.target_date)
        route_ids = route_range.create_routes_around_date(
            origin, destination, target_date,
            range_before=args.range_before, range_after=args.range_after,
            preferred_time_window=args.time_window,
        )
        window_desc = (f"{timeutils.format_dmy(target_date - timedelta(days=args.range_before))}"
                        f" .. {timeutils.format_dmy(target_date + timedelta(days=args.range_after))}")
        if route_ids:
            print(f"Added {len(route_ids)} route(s) for {origin} -> {destination}, "
                  f"window {window_desc} (target {timeutils.format_dmy(target_date)}):")
            for route_id in route_ids:
                route = db.get_route(route_id)
                print(f"  #{route_id}: {timeutils.format_dmy(route['flight_date'])}")
        else:
            print(f"No new routes created for {origin} -> {destination} in window {window_desc} "
                  "(every date was already tracked).")
        return

    route_id = db.add_route(
        origin=origin,
        destination=destination,
        target_date_offset_days=args.offset_days,
        event_id=args.event_id,
        preferred_time_window=args.time_window,
    )
    print(f"Added route #{route_id}: {origin} -> {destination} "
          f"(legacy mode: today+{args.offset_days}d, rolling)")


def cmd_list_routes(_args) -> None:
    for r in db.list_routes():
        date_info = timeutils.format_dmy(r["flight_date"]) if r["flight_date"] \
            else f"today+{r['target_date_offset_days']}d"
        window_info = f" time_window={r['preferred_time_window']}" if r["preferred_time_window"] else ""
        print(f"#{r['id']}: {r['origin']} -> {r['destination']} on {date_info} "
              f"[{r['status']}] event_id={r['event_id']}{window_info}")


def cmd_check_routes(args) -> None:
    route_ids = args.route_ids.split(",") if args.route_ids else None
    route_tracking.run(route_ids=route_ids)


def cmd_mark_booked(args) -> None:
    db.set_route_status(args.route_id, "booked")
    print(f"Route #{args.route_id} marked as booked.")


def cmd_expire_routes(_args) -> None:
    count = db.expire_due_event_routes(timeutils.now_utc_iso())
    print(f"Expired {count} route(s).")


def cmd_add_event(args) -> None:
    event_dt = datetime.strptime(args.datetime, "%Y-%m-%d %H:%M")
    event_id, route_ids = event_suggestion.create_event_and_routes(
        event_name=args.name,
        event_datetime=event_dt,
        location=args.location,
        origin=args.origin,
        flexibility_days=args.flexibility_days,
        destination=args.destination,
    )
    print(f"Added event #{event_id}: {args.name} @ {event_dt}")
    if route_ids:
        print(f"AI created {len(route_ids)} tracked route(s): {route_ids}")
        print("Checking prices for these routes now...")
        try:
            route_tracking.run(route_ids=route_ids)
        except Exception as exc:  # routes are already created either way
            print(f"Immediate price check failed (routes were still created): {exc}")
    else:
        print("No new routes created (AI returned nothing usable, or all slots were duplicates).")


def cmd_retry_pending_events(_args) -> None:
    total, succeeded, still_pending = event_suggestion.retry_pending_event_slots()
    print(f"Retried {total} pending event(s): {succeeded} succeeded, "
          f"{still_pending} still pending (quota).")


def cmd_list_events(_args) -> None:
    for e in db.list_events():
        print(f"#{e['id']}: {e['event_name']} @ {e['event_datetime']} "
              f"({e['origin']} -> {e['location']}, flex={e['flexibility_days']}d)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="flight_tracker")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("add-route", help="Manually add route(s) for long-term tracking (no event)")
    p.add_argument("--origin", required=True, help="IATA code, e.g. HAN")
    p.add_argument("--destination", required=True, help="IATA code, e.g. SGN")
    p.add_argument("--target-date", default=None, metavar="DD-MM-YYYY",
                    help="Fixed date you expect to fly, e.g. 20-09-2026 — creates one route per "
                         "day across [target-date - range-before, target-date + range-after] "
                         "(recommended; takes priority over --offset-days if both are given)")
    p.add_argument("--range-before", type=int, default=route_range.DEFAULT_RANGE_DAYS,
                    help=f"Days before --target-date to also track (default: {route_range.DEFAULT_RANGE_DAYS})")
    p.add_argument("--range-after", type=int, default=route_range.DEFAULT_RANGE_DAYS,
                    help=f"Days after --target-date to also track (default: {route_range.DEFAULT_RANGE_DAYS})")
    p.add_argument("--offset-days", type=int, default=30,
                    help="Legacy: a single rolling today+N days route, used only if "
                         "--target-date is not given (default: 30)")
    p.add_argument("--time-window", default=None, choices=time_windows.TIME_WINDOW_PRESETS,
                    help="Optional preferred departure time-of-day — when set, price checks "
                         "prefer flights inside this window and fall back to cheapest-overall "
                         "only if none are available")
    p.add_argument("--event-id", type=str, default=None)
    p.set_defaults(func=cmd_add_route)

    sub.add_parser("list-routes").set_defaults(func=cmd_list_routes)

    p = sub.add_parser("check-routes", help="Run the cron price-check flow now")
    p.add_argument("--route-ids", default=None,
                    help="Comma-separated route ids to check (default: every 'tracking' route)")
    p.set_defaults(func=cmd_check_routes)

    p = sub.add_parser("mark-booked", help="Stop tracking a route once you've bought the ticket")
    p.add_argument("--route-id", type=str, required=True)
    p.set_defaults(func=cmd_mark_booked)

    sub.add_parser("expire-routes", help="Manually expire routes whose linked event has passed") \
        .set_defaults(func=cmd_expire_routes)

    p = sub.add_parser("add-event", help="Create an event; Gemini picks slots, which become tracked routes")
    p.add_argument("--name", required=True)
    p.add_argument("--datetime", required=True, help='"YYYY-MM-DD HH:MM"')
    p.add_argument("--location", required=True)
    p.add_argument("--origin", required=True, help="City name or IATA code")
    p.add_argument("--flexibility-days", type=int, required=True)
    p.add_argument("--destination", default=None, help="Override destination IATA code")
    p.set_defaults(func=cmd_add_event)

    sub.add_parser("list-events").set_defaults(func=cmd_list_events)

    sub.add_parser("retry-pending-events",
                    help="Retry AI slot generation for events stuck pending (e.g. Gemini quota)") \
        .set_defaults(func=cmd_retry_pending_events)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
