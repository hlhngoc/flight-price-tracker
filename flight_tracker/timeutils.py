"""Shared datetime helpers.

Every timestamp stored in Firestore (event_datetime, checked_at, created_at,
sent_at) must be a UTC-aware ISO-8601 string with a 'T' separator and
explicit offset, e.g. "2026-09-14T02:00:00+00:00". Firestore range/inequality
queries (checked_at < X, event_datetime < now) compare these as plain
strings, so any inconsistency in format — a space instead of 'T', a naive
datetime with no offset suffix — breaks chronological ordering for events
that happen to share the same date. Route everything through here instead
of calling .isoformat() ad hoc.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def vn_today() -> date:
    return datetime.now(VN_TZ).date()


def vn_local_to_utc_iso(naive_local_dt: datetime) -> str:
    """Interpret a naive datetime (e.g. from a "YYYY-MM-DD HH:MM" CLI arg) as
    Asia/Ho_Chi_Minh wall-clock time and return a UTC-aware ISO string.
    """
    return naive_local_dt.replace(tzinfo=VN_TZ).astimezone(timezone.utc).isoformat()


def utc_iso_to_vn_datetime(utc_iso: str) -> datetime:
    return datetime.fromisoformat(utc_iso).astimezone(VN_TZ)


def utc_iso_to_vn_date(utc_iso: str) -> date:
    return utc_iso_to_vn_datetime(utc_iso).date()


def parse_dmy(text: str) -> date:
    """Parse a "DD-MM-YYYY" string — the CLI's date input format."""
    return datetime.strptime(text, "%d-%m-%Y").date()


def format_dmy(value, sep: str = "-") -> str:
    """Format a date (or an ISO "YYYY-MM-DD" string, as stored in Firestore)
    as "DD-MM-YYYY" for display. Internal storage always stays ISO; this is
    only for what a human reads (CLI output, logs).
    """
    if not value:
        return "?"
    if isinstance(value, str):
        value = date.fromisoformat(value)
    return value.strftime(f"%d{sep}%m{sep}%Y")
