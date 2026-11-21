"""Shared vocabulary for flight time-of-day preferences.

preferred_time_window is constrained — both in the manual-route UI/CLI and
in the Gemini prompt schema (ai_reasoning.py) — to one of TIME_WINDOW_
PRESETS, each of which embeds an "(HH:MM-HH:MM)" range. That's what lets
route_tracking.py reliably parse a route's stored preference back into an
hour range to filter SerpApi results by departure_time. A legacy or
otherwise malformed string that doesn't contain that pattern just fails to
parse — treated as "no preference", which is a safe default (no filtering).
"""
import re
from datetime import datetime

TIME_WINDOW_PRESETS: list[str] = [
    "Sáng sớm (00:00-06:00)",
    "Sáng (06:00-12:00)",
    "Chiều (12:00-18:00)",
    "Tối (18:00-24:00)",
]

_RANGE_PATTERN = re.compile(r"(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})")


def parse_time_window(label: str | None) -> tuple[int, int] | None:
    """Extracts (start_hour, end_hour) from a "... (HH:MM-HH:MM)" label."""
    if not label:
        return None
    m = _RANGE_PATTERN.search(label)
    if not m:
        return None
    start_h, end_h = int(m.group(1)), int(m.group(3))
    if not (0 <= start_h <= 24 and 0 <= end_h <= 24):
        return None
    return start_h, end_h


def departure_hour(departure_time: str | None) -> int | None:
    """departure_time is "YYYY-MM-DD HH:MM", as returned by SerpApi."""
    if not departure_time:
        return None
    try:
        return datetime.strptime(departure_time, "%Y-%m-%d %H:%M").hour
    except ValueError:
        return None


def is_within_window(departure_time: str | None, window: tuple[int, int]) -> bool:
    hour = departure_hour(departure_time)
    if hour is None:
        return False
    start_h, end_h = window
    if start_h <= end_h:
        return start_h <= hour < end_h
    return hour >= start_h or hour < end_h  # wraps past midnight; unused by the presets above, but safe


def minutes_outside_window(departure_time: str | None, window: tuple[int, int]) -> int | None:
    """How far (in minutes) a departure is from the nearest edge of window;
    0 if inside. None if departure_time is unparseable. Same-day only —
    matches the UI, which only creates non-wrapping ranges.
    """
    try:
        dt = datetime.strptime(departure_time or "", "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    minute_of_day = dt.hour * 60 + dt.minute
    start, end = window[0] * 60, window[1] * 60
    if start <= minute_of_day < end:
        return 0
    if minute_of_day < start:
        return start - minute_of_day
    return minute_of_day - end + 1
