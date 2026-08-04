"""Email formatting + sending (plain SMTP, e.g. Gmail app password).

Per architecture v2, no AI call happens at send time — decrease/increase
emails are formatted straight from price numbers plus (for event-linked
routes) the ai_reasoning text saved once when the route was created.
"""
import smtplib
from datetime import date
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

def format_price_decrease(origin: str, destination: str, current_price: int, last_price: int,
                           flight_date: date, preferred_time_window: str | None,
                           baseline: BaselineStats | None, new_low: bool,
                           event_name: str | None = None, days_to_event: int | None = None,
                           ai_reasoning: str | None = None) -> tuple[str, str]:
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
        f"Giá: {last_price:,}đ → {current_price:,}đ (giảm {delta:,}đ, {pct:.0f}%)",
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


def format_price_increase(origin: str, destination: str, current_price: int, last_price: int,
                           flight_date: date, event_name: str | None = None,
                           days_to_event: int | None = None) -> tuple[str, str]:
    pct = percent_change(last_price, current_price)
    subject = f"[Giá tăng] {origin} → {destination} ngày {flight_date.strftime('%d/%m')}, tăng {pct:.0f}%"

    lines = [
        f"Chặng: {origin} → {destination}",
        f"Ngày bay: {_format_vn_date(flight_date)}",
        f"Giá: {last_price:,}đ → {current_price:,}đ (+{pct:.0f}%)",
    ]
    if event_name and days_to_event is not None:
        lines.append(f"Sự kiện liên quan: {event_name}, còn {days_to_event} ngày nữa — cân nhắc mua sớm.")

    return subject, "\n".join(lines)
