"""SQLite access layer. One connection per call — this is a low-frequency
cron/CLI tool, not a server, so pooling would be pure overhead.
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from . import config

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"


@contextmanager
def get_connection():
    conn = sqlite3.connect(config.db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(SCHEMA_PATH.read_text())


# ---------------------------------------------------------------- routes --

def add_route(origin: str, destination: str, target_date_offset_days: int = 30,
              flight_date: Optional[str] = None, preferred_time_window: Optional[str] = None,
              event_id: Optional[int] = None, ai_reasoning: Optional[str] = None) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO preferred_routes
               (origin, destination, flight_date, target_date_offset_days,
                preferred_time_window, event_id, ai_reasoning)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (origin, destination, flight_date, target_date_offset_days,
             preferred_time_window, event_id, ai_reasoning),
        )
        return cur.lastrowid


def find_matching_route(origin: str, destination: str, flight_date: str) -> Optional[sqlite3.Row]:
    """Existing non-expired route already tracking this exact origin/destination/
    date, regardless of which event (if any) created it — used to avoid
    inserting duplicate routes (and duplicate SerpApi queries) when two
    events land on the same slot.
    """
    with get_connection() as conn:
        return conn.execute(
            """SELECT * FROM preferred_routes
               WHERE origin = ? AND destination = ? AND flight_date = ? AND status != 'expired'""",
            (origin, destination, flight_date),
        ).fetchone()


def list_routes() -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute("SELECT * FROM preferred_routes ORDER BY id").fetchall()


def list_active_routes() -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM preferred_routes WHERE status = 'tracking' ORDER BY id"
        ).fetchall()


def get_route(route_id: int) -> Optional[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM preferred_routes WHERE id = ?", (route_id,)
        ).fetchone()


def set_route_status(route_id: int, status: str) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE preferred_routes SET status = ? WHERE id = ?", (status, route_id))


def expire_due_event_routes(now_iso: str) -> int:
    """Marks 'tracking' routes as 'expired' once their linked event's
    datetime has passed, so cron stops burning SerpApi quota on flights
    that can no longer be booked in time. Returns the number of rows updated.
    """
    with get_connection() as conn:
        cur = conn.execute(
            """UPDATE preferred_routes SET status = 'expired'
               WHERE status = 'tracking' AND event_id IN (
                   SELECT id FROM events WHERE event_datetime < ?
               )""",
            (now_iso,),
        )
        return cur.rowcount


# ---------------------------------------------------------------- events --

def add_event(event_name: str, event_datetime: str, location: str, origin: str,
              flexibility_days: int) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO events (event_name, event_datetime, location, origin, flexibility_days)
               VALUES (?, ?, ?, ?, ?)""",
            (event_name, event_datetime, location, origin, flexibility_days),
        )
        return cur.lastrowid


def get_event(event_id: int) -> Optional[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()


def list_events() -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute("SELECT * FROM events ORDER BY id").fetchall()


# --------------------------------------------------------- price_history --

def add_price_record(route_id: int, flight_date: str, departure_time: Optional[str],
                      price: int, airline: Optional[str], checked_at: str) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO price_history (route_id, flight_date, departure_time, price, airline, checked_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (route_id, flight_date, departure_time, price, airline, checked_at),
        )
        return cur.lastrowid


def get_last_price(route_id: int, before_checked_at: str) -> Optional[sqlite3.Row]:
    """Most recent price_history row for this route strictly before the given
    checked_at timestamp (i.e. excluding the record just inserted for the
    current check).
    """
    with get_connection() as conn:
        return conn.execute(
            """SELECT * FROM price_history
               WHERE route_id = ? AND checked_at < ?
               ORDER BY checked_at DESC LIMIT 1""",
            (route_id, before_checked_at),
        ).fetchone()


def get_price_history_since(route_id: int, since_iso: str,
                             before_checked_at: Optional[str] = None) -> list[sqlite3.Row]:
    with get_connection() as conn:
        if before_checked_at is not None:
            return conn.execute(
                """SELECT * FROM price_history
                   WHERE route_id = ? AND checked_at >= ? AND checked_at < ?
                   ORDER BY checked_at""",
                (route_id, since_iso, before_checked_at),
            ).fetchall()
        return conn.execute(
            """SELECT * FROM price_history
               WHERE route_id = ? AND checked_at >= ?
               ORDER BY checked_at""",
            (route_id, since_iso),
        ).fetchall()


# ---------------------------------------------------------- notifications --

def log_notification(route_id: Optional[int], notif_type: str, sent_at: str,
                      email_content: str) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO notifications_log (route_id, type, sent_at, email_content)
               VALUES (?, ?, ?, ?)""",
            (route_id, notif_type, sent_at, email_content),
        )
        return cur.lastrowid
