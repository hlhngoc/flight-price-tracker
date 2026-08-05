"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { cityNameForCode, resolveAirportCode } from "@/lib/airports";
import { formatDmy } from "@/lib/dateFormat";

interface ResolvedLocations {
  originCode: string;
  originName: string;
  destCode: string;
  destName: string;
}

interface CreatedRoute {
  id: string;
  flight_date: string | null;
  preferred_time_window: string | null;
  ai_reasoning: string | null;
}

interface EventResult {
  eventId: string;
  createdRoutes: CreatedRoute[];
}

export default function AddEventPage() {
  const [name, setName] = useState("");
  const [datetime, setDatetime] = useState("");
  const [location, setLocation] = useState("");
  const [origin, setOrigin] = useState("");
  const [flexibilityDays, setFlexibilityDays] = useState(3);
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EventResult | null>(null);
  const [resolved, setResolved] = useState<ResolvedLocations | null>(null);

  // Resolving locally (client-side, no network round trip needed since
  // resolveAirportCode has no server-only deps) lets the user catch a
  // mistyped/misresolved city before it gets baked into the AI prompt and
  // the routes that get created from it.
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const originCode = resolveAirportCode(origin);
      const destCode = resolveAirportCode(destination || location);
      setResolved({
        originCode,
        originName: cityNameForCode(originCode) ?? originCode,
        destCode,
        destName: cityNameForCode(destCode) ?? destCode,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmAndCreate() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          datetime,
          location,
          origin,
          flexibilityDays,
          destination: destination || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Có lỗi xảy ra.");
        return;
      }
      setResult(data);
      setResolved(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <Link className="back-link" href="/">
        ← Dashboard
      </Link>
      <h1>Thêm sự kiện</h1>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Gemini sẽ chọn tối đa 5 slot bay hợp lý (ngày + khung giờ), tự động trở thành route được
        theo dõi bởi cron — không cần gọi AI lại sau này.
      </p>

      {!resolved && (
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
            Mã sân bay đến (tùy chọn — mặc định suy ra từ địa điểm)
            <input value={destination} onChange={(e) => setDestination(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Kiểm tra & tiếp tục</button>
        </form>
      )}

      {resolved && (
        <div className="result-card">
          <p>Xác nhận lại thông tin trước khi AI chọn lịch bay:</p>
          <ul>
            <li>
              Điểm đi: <strong>{resolved.originName}</strong> ({resolved.originCode})
            </li>
            <li>
              Điểm đến: <strong>{resolved.destName}</strong> ({resolved.destCode})
            </li>
          </ul>
          {error && <p className="error">{error}</p>}
          <div className="row-actions">
            <button type="button" className="button-secondary" onClick={() => setResolved(null)} disabled={submitting}>
              Sửa lại
            </button>
            <button type="button" onClick={confirmAndCreate} disabled={submitting}>
              {submitting ? "Đang xử lý..." : "Xác nhận, tạo sự kiện"}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="result-card">
          <p>Đã tạo event #{result.eventId}.</p>
          {result.createdRoutes.length === 0 ? (
            <p>Không có route mới nào được tạo (AI không trả về slot hợp lệ, hoặc trùng route đã có).</p>
          ) : (
            <>
              <p>{result.createdRoutes.length} route được tạo:</p>
              <ul>
                {result.createdRoutes.map((r) => (
                  <li key={r.id}>
                    {formatDmy(r.flight_date)} — {r.preferred_time_window || "(chưa rõ khung giờ)"}
                    {r.ai_reasoning && <div style={{ color: "var(--muted)" }}>{r.ai_reasoning}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Link className="button" href="/">
            Về Dashboard
          </Link>
        </div>
      )}
    </main>
  );
}
