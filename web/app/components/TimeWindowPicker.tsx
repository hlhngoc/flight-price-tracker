"use client";

import { useState } from "react";
import { MIN_WINDOW_HOURS, TIME_WINDOW_PRESETS, formatCustomWindow, parseTimeWindow } from "@/lib/timeWindows";

const CUSTOM = "__custom__";
const HOURS = Array.from({ length: 25 }, (_, h) => h); // 0..24

function hh(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

// Preset dropdown + a "Tuỳ chỉnh" option that reveals Từ/Đến hour pickers.
// value/onChange speak the same stored string as before ("" = no
// preference, a preset label, or "Tuỳ chỉnh (HH:00-HH:00)").
export default function TimeWindowPicker({
  value,
  onChange,
  emptyLabel = "Không ưu tiên — giá rẻ nhất bất kể giờ nào",
}: {
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
}) {
  const initialParsed = parseTimeWindow(value);
  const startsCustom = !!value && !TIME_WINDOW_PRESETS.includes(value) && initialParsed !== null;
  const [mode, setMode] = useState<string>(startsCustom ? CUSTOM : value);
  const [start, setStart] = useState<number>(initialParsed?.[0] ?? 6);
  const [end, setEnd] = useState<number>(initialParsed?.[1] ?? 12);

  function emitCustom(s: number, e: number) {
    onChange(formatCustomWindow(s, e));
  }

  return (
    <div className="time-window-picker">
      <select
        value={mode}
        onChange={(e) => {
          const next = e.target.value;
          setMode(next);
          if (next === CUSTOM) emitCustom(start, end);
          else onChange(next);
        }}
      >
        <option value="">{emptyLabel}</option>
        {TIME_WINDOW_PRESETS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
        <option value={CUSTOM}>Tuỳ chỉnh khoảng giờ…</option>
      </select>

      {mode === CUSTOM && (
        <div className="time-window-custom">
          <span className="time-window-field">
            Từ
            <select
              value={start}
              onChange={(e) => {
                const s = Number(e.target.value);
                const eh = end - s < MIN_WINDOW_HOURS ? s + MIN_WINDOW_HOURS : end;
                setStart(s);
                setEnd(eh);
                emitCustom(s, eh);
              }}
            >
              {HOURS.filter((h) => h <= 24 - MIN_WINDOW_HOURS).map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </span>
          <span className="time-window-field">
            Đến
            <select
              value={end}
              onChange={(e) => {
                const eh = Number(e.target.value);
                setEnd(eh);
                emitCustom(start, eh);
              }}
            >
              {HOURS.filter((h) => h >= start + MIN_WINDOW_HOURS).map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
      {mode === CUSTOM && (
        <p className="subtext time-window-hint">
          Tối thiểu {MIN_WINDOW_HOURS} tiếng. Nếu khung này không có chuyến, hệ thống tự lấy chuyến gần khung nhất.
        </p>
      )}
    </div>
  );
}
