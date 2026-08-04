"""Command-line entry point.

Examples:
    python -m flight_tracker.cli init-db

    # Manually tracked long-term route (no event, rolling today+N days date)
    python -m flight_tracker.cli add-route --origin HAN --destination SGN --offset-days 30

    # Event input: calls DeepSeek once, auto-inserts the resulting slots as routes
    python -m flight_tracker.cli add-event --name "Dam cuoi ban A" \
        --datetime "2026-09-14 09:00" --location "Da Nang" --origin "Ha Noi" --flexibility-days 3

    python -m flight_tracker.cli list-routes
    python -m flight_tracker.cli list-events
    python -m flight_tracker.cli check-routes
    python -m flight_tracker.cli mark-booked --route-id 3
    python -m flight_tracker.cli expire-routes
"""
import argparse
from datetime import datetime, timezone

from . import db, event_suggestion, route_tracking


def cmd_init_db(_args) -> None:
    db.init_db()
    print("Database initialized.")


def cmd_add_route(args) -> None:
    route_id = db.add_route(
        origin=args.origin.upper(),
        destination=args.destination.upper(),
        target_date_offset_days=args.offset_days,
        event_id=args.event_id,
    )
    print(f"Added route #{route_id}: {args.origin.upper()} -> {args.destination.upper()}")


def cmd_list_routes(_args) -> None:
    for r in db.list_routes():
        date_info = r["flight_date"] or f"today+{r['target_date_offset_days']}d"
        print(f"#{r['id']}: {r['origin']} -> {r['destination']} on {date_info} "
              f"[{r['status']}] event_id={r['event_id']}")


def cmd_check_routes(_args) -> None:
    route_tracking.run()


def cmd_mark_booked(args) -> None:
    db.set_route_status(args.route_id, "booked")
    print(f"Route #{args.route_id} marked as booked.")


def cmd_expire_routes(_args) -> None:
    count = db.expire_due_event_routes(datetime.now(timezone.utc).isoformat())
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
    else:
        print("No new routes created (AI returned nothing usable, or all slots were duplicates).")


def cmd_list_events(_args) -> None:
    for e in db.list_events():
        print(f"#{e['id']}: {e['event_name']} @ {e['event_datetime']} "
              f"({e['origin']} -> {e['location']}, flex={e['flexibility_days']}d)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="flight_tracker")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db").set_defaults(func=cmd_init_db)

    p = sub.add_parser("add-route", help="Manually add a long-term route (no event)")
    p.add_argument("--origin", required=True, help="IATA code, e.g. HAN")
    p.add_argument("--destination", required=True, help="IATA code, e.g. SGN")
    p.add_argument("--offset-days", type=int, default=30,
                    help="Track the price for today+N days (default: 30)")
    p.add_argument("--event-id", type=int, default=None)
    p.set_defaults(func=cmd_add_route)

    sub.add_parser("list-routes").set_defaults(func=cmd_list_routes)
    sub.add_parser("check-routes", help="Run the cron price-check flow now").set_defaults(func=cmd_check_routes)

    p = sub.add_parser("mark-booked", help="Stop tracking a route once you've bought the ticket")
    p.add_argument("--route-id", type=int, required=True)
    p.set_defaults(func=cmd_mark_booked)

    sub.add_parser("expire-routes", help="Manually expire routes whose linked event has passed") \
        .set_defaults(func=cmd_expire_routes)

    p = sub.add_parser("add-event", help="Create an event; DeepSeek picks slots, which become tracked routes")
    p.add_argument("--name", required=True)
    p.add_argument("--datetime", required=True, help='"YYYY-MM-DD HH:MM"')
    p.add_argument("--location", required=True)
    p.add_argument("--origin", required=True, help="City name or IATA code")
    p.add_argument("--flexibility-days", type=int, required=True)
    p.add_argument("--destination", default=None, help="Override destination IATA code")
    p.set_defaults(func=cmd_add_event)

    sub.add_parser("list-events").set_defaults(func=cmd_list_events)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
