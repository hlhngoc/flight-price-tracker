"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const DEFAULT_RANGE_DAYS = 4;

export default function AddRoutePage() {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [rangeBefore, setRangeBefore] = useState(DEFAULT_RANGE_DAYS);
  const [rangeAfter, setRangeAfter] = useState(DEFAULT_RANGE_DAYS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, targetDate, rangeBefore, rangeAfter }),
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
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Đang thêm..." : "Thêm route"}
        </button>
      </form>
    </main>
  );
}
