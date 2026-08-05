"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";
import type { RouteDoc } from "@/lib/types";

export default function EditRouteForm({ route }: { route: RouteDoc }) {
  const router = useRouter();
  const [origin, setOrigin] = useState(route.origin);
  const [destination, setDestination] = useState(route.destination);
  const [flightDate, setFlightDate] = useState(route.flight_date ?? "");
  const [offsetDays, setOffsetDays] = useState(route.target_date_offset_days);
  const [timeWindow, setTimeWindow] = useState(route.preferred_time_window ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Legacy rolling-window routes (no fixed flight_date) get an offset-days
  // input instead of a date picker — same distinction the dashboard already
  // draws when rendering these rows (see effectiveSortDate in page.tsx).
  const isLegacyOffset = route.flight_date == null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        origin,
        destination,
        preferred_time_window: timeWindow || null,
      };
      if (isLegacyOffset) {
        body.target_date_offset_days = offsetDays;
      } else {
        body.flight_date = flightDate;
      }
      const resp = await fetch(`/api/routes/${route.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Có lỗi xảy ra.");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <label>
        Điểm đi (mã IATA, VD: HAN)
        <input value={origin} onChange={(e) => setOrigin(e.target.value)} required />
      </label>
      <label>
        Điểm đến (mã IATA, VD: SGN)
        <input value={destination} onChange={(e) => setDestination(e.target.value)} required />
      </label>
      {isLegacyOffset ? (
        <label>
          Theo dõi ngày hôm nay + N ngày (route dài hạn, không có ngày cố định)
          <input
            type="number"
            min={0}
            max={365}
            value={offsetDays}
            onChange={(e) => setOffsetDays(Number(e.target.value))}
            required
          />
        </label>
      ) : (
        <label>
          Ngày bay
          <input type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)} required />
        </label>
      )}
      <label>
        Khung giờ mong muốn (tùy chọn)
        <select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>
          <option value="">Không ưu tiên — giá rẻ nhất bất kể giờ nào</option>
          {TIME_WINDOW_PRESETS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Đang lưu..." : "Lưu thay đổi"}
      </button>
    </form>
  );
}
