"""DeepSeek-based reasoning layer.

Per architecture v2, the AI is called exactly ONCE per event, at creation
time: it picks candidate flight-date slots (with a short reason each), those
slots get inserted as tracked routes, and from then on price-check emails
are formatted straight from stored data + the reasoning saved here — no
further AI calls, even when price changes.
"""
import json
from datetime import date, datetime

import requests

from . import config

MAX_TOKENS = 1024
MAX_SLOTS_PER_EVENT = 5

SYSTEM_PROMPT = """Bạn là trợ lý chọn lịch bay cho một sự kiện. Dựa trên thông tin
sự kiện, hãy chọn ra tối đa {max_slots} slot bay ứng viên hợp lý (ngày bay + khung
giờ), có tính đến buffer thời gian an toàn trước sự kiện (tránh bay sát giờ, rủi ro
delay) và trade-off ở thêm đêm nếu bay sớm hơn để có giá tốt hơn. Ngày bay phải nằm
trong khoảng từ (ngày sự kiện - độ linh hoạt) đến ngày sự kiện.

Chỉ trả về JSON theo đúng schema sau, không thêm text nào khác:
{{"slots": [{{"flight_date": "YYYY-MM-DD", "preferred_time_window": "mô tả ngắn khung giờ",
"reasoning": "lý do ngắn gọn chọn slot này"}}]}}"""


class AIReasoningError(RuntimeError):
    pass


def _call_deepseek(system: str, user_prompt: str) -> str:
    resp = requests.post(
        f"{config.deepseek_base_url()}/chat/completions",
        headers={"Authorization": f"Bearer {config.deepseek_key()}"},
        json={
            "model": config.deepseek_model(),
            "max_tokens": MAX_TOKENS,
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
        },
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload["choices"][0]["message"]["content"]


def generate_event_slots(event: dict) -> list[dict]:
    """Returns up to MAX_SLOTS_PER_EVENT dicts: flight_date (date),
    preferred_time_window (str), reasoning (str). Invalid/out-of-range
    entries returned by the model are dropped.
    """
    event_datetime = event["event_datetime"]
    if isinstance(event_datetime, str):
        event_datetime = datetime.fromisoformat(event_datetime.replace(" ", "T"))
    event_date = event_datetime.date()
    flexibility_days = event["flexibility_days"]
    earliest = event_date.toordinal() - flexibility_days

    user_prompt = f"""Tên sự kiện: {event['event_name']}
Thời gian sự kiện: {event_datetime.isoformat(sep=' ')}
Địa điểm: {event['location']}
Điểm đi: {event['origin']}
Độ linh hoạt: {flexibility_days} ngày trước sự kiện"""

    system = SYSTEM_PROMPT.format(max_slots=MAX_SLOTS_PER_EVENT)

    try:
        raw = _call_deepseek(system, user_prompt)
        parsed = json.loads(raw)
        raw_slots = parsed["slots"]
    except (requests.RequestException, KeyError, json.JSONDecodeError) as exc:
        raise AIReasoningError(f"DeepSeek call/parse failed: {exc}") from exc

    slots: list[dict] = []
    for item in raw_slots:
        try:
            flight_date = date.fromisoformat(item["flight_date"])
        except (KeyError, ValueError):
            continue
        if not (earliest <= flight_date.toordinal() <= event_date.toordinal()):
            continue
        slots.append({
            "flight_date": flight_date,
            "preferred_time_window": item.get("preferred_time_window", ""),
            "reasoning": item.get("reasoning", ""),
        })
        if len(slots) >= MAX_SLOTS_PER_EVENT:
            break

    return slots
