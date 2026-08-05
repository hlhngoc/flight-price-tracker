"""Gemini-based reasoning layer.

Per architecture v2, the AI is called exactly ONCE per event, at creation
time: it picks candidate flight-date slots (with a short reason each), those
slots get inserted as tracked routes, and from then on price-check emails
are formatted straight from stored data + the reasoning saved here — no
further AI calls, even when price changes.
"""
import json
from datetime import date

import requests

from . import config, time_windows, timeutils

MAX_TOKENS = 4096
MAX_SLOTS_PER_EVENT = 5

# Minimum safe buffer between landing and the event start (travel time from
# airport + delay risk). If the event starts earlier in the day than this,
# flying the same calendar day is not feasible at all — the earliest allowed
# date needs to be pushed back a day so a late-night flight the day before
# is even in range.
BUFFER_HOURS = 4

SYSTEM_PROMPT = """Bạn là trợ lý chọn lịch bay cho một sự kiện. Dựa trên thông tin
sự kiện, hãy chọn ra tối đa {max_slots} slot bay ứng viên hợp lý (ngày bay + khung
giờ), có tính đến buffer thời gian an toàn trước sự kiện (tránh bay sát giờ, rủi ro
delay) và trade-off ở thêm đêm nếu bay sớm hơn để có giá tốt hơn. Ngày bay phải nằm
trong khoảng từ (ngày sự kiện - độ linh hoạt) đến ngày sự kiện.

"preferred_time_window" của mỗi slot PHẢI là đúng một trong các giá trị sau
(không tự bịa giá trị khác) — chọn khung giờ phù hợp nhất để có đủ buffer an
toàn trước sự kiện:
{window_presets}

Chỉ trả về JSON theo đúng schema sau, không thêm text nào khác:
{{"slots": [{{"flight_date": "YYYY-MM-DD", "preferred_time_window": "<một trong các giá trị ở trên>",
"reasoning": "lý do ngắn gọn chọn slot này"}}]}}"""


class AIReasoningError(RuntimeError):
    pass


def _call_gemini(system: str, user_prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.gemini_model()}:generateContent"
    resp = requests.post(
        url,
        params={"key": config.gemini_api_key()},
        json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": MAX_TOKENS,
                "responseMimeType": "application/json",
            },
        },
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload["candidates"][0]["content"]["parts"][0]["text"]


def generate_event_slots(event: dict) -> list[dict]:
    """Returns up to MAX_SLOTS_PER_EVENT dicts: flight_date (date),
    preferred_time_window (str), reasoning (str). Invalid/out-of-range
    entries returned by the model are dropped; slots that land on the
    event's own date but whose window doesn't leave BUFFER_HOURS before
    the event are pushed back to the previous night instead of dropped.
    """
    # event_datetime is stored as a UTC-aware ISO string; slot dates and the
    # "days before the event" reasoning are inherently about VN local time.
    event_datetime_vn = timeutils.utc_iso_to_vn_datetime(event["event_datetime"])
    event_date = event_datetime_vn.date()
    flexibility_days = event["flexibility_days"]

    # If the event starts before BUFFER_HOURS o'clock, no same-day flight
    # can land with a safe buffer — extend the earliest allowed date back
    # one extra day so a prior-night flight is reachable even when
    # flexibility_days is 0.
    needs_prior_night = event_datetime_vn.hour < BUFFER_HOURS
    earliest = event_date.toordinal() - flexibility_days - (1 if needs_prior_night else 0)

    user_prompt = f"""Tên sự kiện: {event['event_name']}
Thời gian sự kiện: {event_datetime_vn.isoformat(sep=' ')}
Địa điểm: {event['location']}
Điểm đi: {event['origin']}
Độ linh hoạt: {flexibility_days} ngày trước sự kiện

LƯU Ý QUAN TRỌNG: Chuyến bay PHẢI đến nơi trước giờ sự kiện ít nhất
{BUFFER_HOURS} tiếng (buffer di chuyển + rủi ro delay). Nếu sự kiện diễn ra
vào giờ quá sớm trong ngày (trước {BUFFER_HOURS}h sáng), bạn PHẢI chọn bay
vào đêm/khuya ngày hôm trước, không được chọn slot cùng ngày với giờ bay
sau hoặc quá sát giờ sự kiện."""

    window_presets = "\n".join(f"- {w}" for w in time_windows.TIME_WINDOW_PRESETS)
    system = SYSTEM_PROMPT.format(max_slots=MAX_SLOTS_PER_EVENT, window_presets=window_presets)

    try:
        raw = _call_gemini(system, user_prompt)
        parsed = json.loads(raw)
        raw_slots = parsed["slots"]
    except (requests.RequestException, KeyError, IndexError, json.JSONDecodeError) as exc:
        raise AIReasoningError(f"Gemini call/parse failed: {exc}") from exc

    slots: list[dict] = []
    for item in raw_slots:
        try:
            flight_date = date.fromisoformat(item["flight_date"])
        except (KeyError, ValueError):
            continue
        if not (earliest <= flight_date.toordinal() <= event_date.toordinal()):
            continue

        window = item.get("preferred_time_window", "")

        # The model sometimes still picks a same-day window that doesn't
        # actually leave BUFFER_HOURS before the event (e.g. event at 01:00
        # with window "Sáng sớm (00:00-06:00)"). Rather than dropping the
        # slot or failing the event outright, push it back to the previous
        # night — that's the obviously-intended fallback (e.g. a 01:00
        # event should resolve to a late flight the evening before).
        if flight_date == event_date:
            latest_allowed_hour = event_datetime_vn.hour - BUFFER_HOURS
            parsed_window = time_windows.parse_time_window(window)
            # Unparseable window -> treat as worst case so it still gets
            # pushed back rather than silently passing through unchecked.
            window_end_hour = parsed_window[1] if parsed_window else 24
            if latest_allowed_hour < 0 or window_end_hour > latest_allowed_hour:
                flight_date = date.fromordinal(flight_date.toordinal() - 1)
                window = time_windows.TIME_WINDOW_PRESETS[-1]  # "Tối (18:00-24:00)"

        slots.append({
            "flight_date": flight_date,
            "preferred_time_window": window,
            "reasoning": item.get("reasoning", ""),
        })
        if len(slots) >= MAX_SLOTS_PER_EVENT:
            break

    return slots