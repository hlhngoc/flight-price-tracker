"""Email formatting + sending (plain SMTP, e.g. Gmail app password).

Per architecture v2, no AI call happens at send time — decrease/increase
emails are formatted straight from price numbers plus (for event-linked
routes) the ai_reasoning text saved once when the route was created.
"""
import smtplib
from datetime import date, datetime
from email.message import EmailMessage

from . import config
from .pricing import BaselineStats, percent_change

WEEKDAYS_VI = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"]


def _format_vn_date(d: date) -> str:
    return f"{WEEKDAYS_VI[d.weekday()]}, {d.strftime('%d/%m/%Y')}"


def send_email(subject: str, body: str) -> None:
    smtp = config.smtp_config()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp["from_addr"]
    msg["To"] = smtp["to_addr"]
    msg.set_content(body)

    with smtplib.SMTP(smtp["host"], smtp["port"]) as server:
        server.starttls()
        server.login(smtp["user"], smtp["password"])
        server.send_message(msg)


# ------------------------------------------------------------- templates --

def _format_departure_time(departure_time: str | None) -> str | None:
    """departure_time is "YYYY-MM-DD HH:MM", as returned by SerpApi."""
    if not departure_time:
        return None
    try:
        return datetime.strptime(departure_time, "%Y-%m-%d %H:%M").strftime("%H:%M")
    except ValueError:
        return None


def _format_options_lines(options: list[dict]) -> list[str]:
    header = "Giá rẻ nhất hiện tại (2 hãng khác nhau):" if len(options) > 1 else "Giá rẻ nhất hiện tại:"
    lines = [header]
    for o in sorted(options, key=lambda o: o["price"]):
        dep = _format_departure_time(o.get("departure_time"))
        dep_part = f", giờ bay {dep}" if dep else ""
        note = "" if o.get("matched_preferred_window", True) else " — ngoài khung giờ mong muốn"
        lines.append(f"  - {o['airline']}: {o['price']:,}đ{dep_part}{note}")
        return_dep = _format_departure_time(o.get("return_departure_time"))
        if return_dep:
            # Own sub-line rather than appended inline — the outbound line
            # above is already fairly long (airline, price, time, window
            # warning), so cramming return-leg info onto it would be hard
            # to read on mobile.
            lines.append(f"      ↩ Về: {return_dep} ({o.get('return_airline') or '?'})")
    return lines


def format_price_decrease(origin: str, destination: str, current_options: list[dict], last_price: int,
                           flight_date: date, preferred_time_window: str | None,
                           baseline: BaselineStats | None, new_low: bool,
                           event_name: str | None = None, days_to_event: int | None = None,
                           ai_reasoning: str | None = None,
                           return_date: date | None = None) -> tuple[str, str]:
    current_price = min(o["price"] for o in current_options)
    pct = percent_change(last_price, current_price)
    delta = last_price - current_price
    date_str = _format_vn_date(flight_date)

    subject = f"[Giá giảm] {origin} → {destination} ngày {flight_date.strftime('%d/%m')}, giảm {abs(pct):.0f}%"

    date_line = f"Ngày bay: {date_str}"
    if preferred_time_window:
        date_line += f" — khung giờ {preferred_time_window}"

    lines = [
        f"Chặng: {origin} → {destination}",
        date_line,
    ]
    if return_date:
        lines.append(f"Ngày về: {_format_vn_date(return_date)}")
    lines += [
        *_format_options_lines(current_options),
        f"Giá rẻ nhất lần trước: {last_price:,}đ",
        f"Giảm: {delta:,}đ ({pct:.0f}%)",
    ]
    if baseline:
        vs_baseline = percent_change(baseline.mean, current_price)
        lines.append(f"So với trung bình 14 ngày qua: thấp hơn {abs(vs_baseline):.0f}%")
    else:
        lines.append("(Chưa đủ 14 ngày dữ liệu để tính baseline.)")
    if new_low:
        lines.append("→ Đây là giá thấp nhất ghi nhận trong 14 ngày qua (new low)")

    if event_name:
        lines.append("")
        countdown = f"còn {days_to_event} ngày nữa" if days_to_event is not None and days_to_event >= 0 \
            else "sự kiện đã qua"
        lines.append(f"Sự kiện liên quan: {event_name}, {countdown}")
        if ai_reasoning:
            lines.append(f"Lý do chọn slot này: {ai_reasoning}")

    return subject, "\n".join(lines)


def format_price_increase(origin: str, destination: str, current_options: list[dict], last_price: int,
                           flight_date: date, event_name: str | None = None,
                           days_to_event: int | None = None,
                           return_date: date | None = None) -> tuple[str, str]:
    current_price = min(o["price"] for o in current_options)
    pct = percent_change(last_price, current_price)
    subject = f"[Giá tăng] {origin} → {destination} ngày {flight_date.strftime('%d/%m')}, tăng {pct:.0f}%"

    lines = [
        f"Chặng: {origin} → {destination}",
        f"Ngày bay: {_format_vn_date(flight_date)}",
    ]
    if return_date:
        lines.append(f"Ngày về: {_format_vn_date(return_date)}")
    lines += [
        *_format_options_lines(current_options),
        f"Giá lần trước: {last_price:,}đ (+{pct:.0f}%)",
    ]
    if event_name and days_to_event is not None:
        lines.append(f"Sự kiện liên quan: {event_name}, còn {days_to_event} ngày nữa — cân nhắc mua sớm.")

    return subject, "\n".join(lines)
