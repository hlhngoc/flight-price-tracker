"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";
import type { EventDoc } from "@/lib/types";

interface PatchResult {
  eventId: string;
  replanned: boolean;
  pending?: boolean;
  message?: string;
  duplicateSlots?: number;
  totalSlots?: number;
}

export default function EditEventForm({
  event,
  datetimeLocalValue,
}: {
  event: EventDoc;
  datetimeLocalValue: string;
}) {
  const [name, setName] = useState(event.event_name);
  const [datetime, setDatetime] = useState(datetimeLocalValue);
  const [location, setLocation] = useState(event.location);
  const [origin, setOrigin] = useState(event.origin);
  const [flexibilityDays, setFlexibilityDays] = useState(event.flexibility_days);
  const [destination, setDestination] = useState(event.destination ?? "");
  const [timeWindow, setTimeWindow] = useState(event.preferred_time_window ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PatchResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          datetime,
          location,
          origin,
          flexibilityDays,
          destination: destination || undefined,
          timeWindow: timeWindow || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Có lỗi xảy ra.");
        return;
      }
      setResult(data);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="result-card">
        {!result.replanned && <p>Đã cập nhật thông tin sự kiện. Danh sách chuyến bay giữ nguyên.</p>}
        {result.replanned && result.pending && <p>{result.message}</p>}
        {result.replanned && !result.pending && result.totalSlots === 0 && (
          <p>AI không tìm được slot bay phù hợp cho sự kiện này.</p>
        )}
        {result.replanned && !result.pending && !!result.duplicateSlots && (
          <p>
            {result.duplicateSlots} slot bay trùng với route đang theo dõi (đã bỏ qua, không tạo thêm).
          </p>
        )}
        {result.replanned && !result.pending && !!result.totalSlots && (
          <p>Đã chọn lại lịch bay ứng viên cho sự kiện.</p>
        )}
        <Link className="button" href="/">
          Về Dashboard
        </Link>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label>
        Tên sự kiện
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Ngày giờ sự kiện (giờ Việt Nam)
        <input
          type="datetime-local"
          value={datetime}
          onChange={(e) => setDatetime(e.target.value)}
          required
        />
      </label>
      <label>
        Địa điểm
        <input value={location} onChange={(e) => setLocation(e.target.value)} required />
      </label>
      <label>
        Điểm đi (thành phố hoặc mã IATA)
        <input value={origin} onChange={(e) => setOrigin(e.target.value)} required />
      </label>
      <label>
        Độ linh hoạt (số ngày trước sự kiện)
        <input
          type="number"
          min={0}
          max={30}
          value={flexibilityDays}
          onChange={(e) => setFlexibilityDays(Number(e.target.value))}
          required
        />
      </label>
      <label>
        Khung giờ bay ưa thích (tùy chọn — AI ưu tiên chọn trong khung này nếu vẫn đủ buffer)
        <select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>
          <option value="">Không có</option>
          {TIME_WINDOW_PRESETS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mã sân bay đến
        <input value={destination} onChange={(e) => setDestination(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Đang lưu..." : "Lưu thay đổi"}
      </button>
    </form>
  );
}
