"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";

const DEFAULT_RANGE_DAYS = 4;

export default function AddRoutePage() {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [rangeBefore, setRangeBefore] = useState(DEFAULT_RANGE_DAYS);
  const [rangeAfter, setRangeAfter] = useState(DEFAULT_RANGE_DAYS);
  const [isRoundTrip, setIsRoundTrip] = useState(false);
  const [returnDate, setReturnDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mirrors the server-side bound in POST /api/routes: the return date must
  // be after the LATEST outbound date the batch will generate
  // (targetDate + rangeAfter), not targetDate itself — otherwise routes
  // near the right edge of the ±range window could get a return date
  // before-or-equal to their own flight_date. This is just for immediate
  // feedback; the server check is the one that actually matters.
  function maxFlightDateIso(): string {
    const d = new Date(`${targetDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + rangeAfter);
    return d.toISOString().slice(0, 10);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRoundTrip) {
      if (!returnDate) {
        setError("Vui lòng chọn ngày về.");
        return;
      }
      if (returnDate <= maxFlightDateIso()) {
        setError("Ngày về phải sau ngày bay muộn nhất trong khoảng theo dõi.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          targetDate,
          rangeBefore,
          rangeAfter,
          timeWindow: timeWindow || undefined,
          returnDate: isRoundTrip ? returnDate : undefined,
        }),
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
    <main>
      <Link className="back-link" href="/">
        ← Dashboard
      </Link>
      <h1>Thêm route thủ công</h1>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Route dài hạn, không gắn sự kiện — chọn ngày dự kiến bay, hệ thống sẽ tự tạo route theo dõi
        giá cho từng ngày trong khoảng trước/sau ngày đó (mặc định 4 ngày mỗi bên).
      </p>

      <form className="stack" onSubmit={onSubmit}>
        <label>
          Điểm đi (mã IATA, VD: HAN)
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} required />
        </label>
        <label>
          Điểm đến (mã IATA, VD: SGN)
          <input value={destination} onChange={(e) => setDestination(e.target.value)} required />
        </label>
        <label>
          Ngày dự kiến bay
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} required />
        </label>
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
            Ngày về (áp dụng chung cho cả loạt route trong khoảng track)
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
          </label>
        )}
        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ flex: 1 }}>
            Track trước (ngày)
            <input
              type="number"
              min={0}
              max={30}
              value={rangeBefore}
              onChange={(e) => setRangeBefore(Number(e.target.value))}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            Track sau (ngày)
            <input
              type="number"
              min={0}
              max={30}
              value={rangeAfter}
              onChange={(e) => setRangeAfter(Number(e.target.value))}
              required
            />
          </label>
        </div>
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
          {submitting ? "Đang thêm..." : "Thêm route"}
        </button>
      </form>
    </main>
  );
}
