"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatDmy } from "@/lib/dateFormat";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";
import type { RouteDoc } from "@/lib/types";

export default function EditRouteForm({ route }: { route: RouteDoc }) {
  const router = useRouter();
  // Event-linked routes are AI-picked candidate slots — origin/destination/
  // date/time-window are only editable via the event edit flow, so this
  // form renders them read-only and only lets return_date (round-trip) be
  // changed here, sending just that one field in the PATCH body.
  const isEventLinked = route.event_id != null;
  // Legacy rolling "today+N days" routes have no fixed date to pair a
  // return date against, so round-trip isn't offered for them at all.
  const isLegacyOffset = route.flight_date == null;

  const [origin, setOrigin] = useState(route.origin);
  const [destination, setDestination] = useState(route.destination);
  const [flightDate, setFlightDate] = useState(route.flight_date ?? "");
  const [offsetDays, setOffsetDays] = useState(route.target_date_offset_days);
  const [timeWindow, setTimeWindow] = useState(route.preferred_time_window ?? "");
  const [isRoundTrip, setIsRoundTrip] = useState(route.return_date != null);
  const [returnDate, setReturnDate] = useState(route.return_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRoundTrip) {
      if (!returnDate) {
        setError("Vui lòng chọn ngày về.");
        return;
      }
      const effectiveFlightDate = isEventLinked ? route.flight_date : flightDate;
      if (effectiveFlightDate && returnDate <= effectiveFlightDate) {
        setError("Ngày về phải sau ngày bay.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = isEventLinked
        ? { return_date: isRoundTrip ? returnDate : null }
        : {
            origin,
            destination,
            preferred_time_window: timeWindow || null,
            return_date: isRoundTrip ? returnDate : null,
            ...(isLegacyOffset ? { target_date_offset_days: offsetDays } : { flight_date: flightDate }),
          };

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
      {isEventLinked ? (
        <>
          <p className="subtext">
            Route này thuộc 1 sự kiện — điểm đi/đến, ngày bay và khung giờ do AI chọn, chỉ sửa được
            qua <Link href={`/edit-event/${route.event_id}`}>trang sửa sự kiện</Link>. Ở đây chỉ sửa
            được vé khứ hồi.
          </p>
          <div className="stack" style={{ gap: 4 }}>
            <div>
              Điểm đi: <strong>{route.origin}</strong>
            </div>
            <div>
              Điểm đến: <strong>{route.destination}</strong>
            </div>
            <div>
              Ngày bay:{" "}
              <strong>
                {route.flight_date ? formatDmy(route.flight_date) : `hôm nay+${route.target_date_offset_days}d`}
              </strong>
            </div>
            <div>
              Khung giờ mong muốn: <strong>{route.preferred_time_window ?? "Không ưu tiên"}</strong>
            </div>
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
      {!isLegacyOffset && (
        <>
          <label>
            Loại vé
            <select
              value={isRoundTrip ? "round_trip" : "one_way"}
              onChange={(e) => setIsRoundTrip(e.target.value === "round_trip")}
            >
              <option value="one_way">Một chiều</option>
              <option value="round_trip">Khứ hồi</option>
            </select>
          </label>
          {isRoundTrip && (
            <label>
              Ngày về
              <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
            </label>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Đang lưu..." : "Lưu thay đổi"}
      </button>
    </form>
  );
}
