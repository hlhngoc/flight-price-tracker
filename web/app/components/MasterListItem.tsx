"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/dateFormat";
import { formatPrice, type MasterListRow } from "@/lib/dashboardView";
import AddEditModal from "./AddEditModal";
import DeleteEventButton from "./DeleteEventButton";
import DeleteRouteButton from "./DeleteRouteButton";
import { useDashboard } from "./Dashboard";

const AI_STATUS_LABEL: Record<string, string> = {
  pending: "Đang lựa chọn tuyến",
  processing: "Đang lựa chọn tuyến",
  error: "Lỗi AI",
};

function TrendIcon({ trend }: { trend: "up" | "down" | null }) {
  if (!trend) return null;
  return (
    <span className={`trend-icon trend-${trend}`} aria-label={trend === "down" ? "giá giảm" : "giá tăng"}>
      {trend === "down" ? "↓" : "↑"}
    </span>
  );
}

export default function MasterListItem({ row, isSelected }: { row: MasterListRow; isSelected: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dashboard = useDashboard();

  // pointerdown, not click: iOS Safari doesn't dispatch click to document
  // for taps on non-interactive elements, so the menu never closed on iPad.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerOutside(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerOutside);
    return () => document.removeEventListener("pointerdown", onPointerOutside);
  }, [menuOpen]);

  const statusLabel = row.kind === "event" && row.aiStatus !== "done" ? AI_STATUS_LABEL[row.aiStatus] : null;

  return (
    <div className="master-item-row" ref={wrapRef}>
      {/* Plain <a> + history.pushState (via Dashboard): selection is instant
          and client-only — no server round-trip. Modifier-clicks fall
          through to the real href (open in new tab). */}
      <a
        href={`/?sel=${row.id}`}
        className="master-item"
        data-active={isSelected}
        onClick={(e) => {
          if (!dashboard || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          setMenuOpen(false);
          dashboard.select(row.id);
        }}
      >
        <span className="ticket-badge">{row.ticketType === "round-trip" ? "Khứ hồi" : "Một chiều"}</span>
        <span className="master-item-codes">
          {row.originCode} → {row.destinationCode}
          {row.departureTime && <span className="master-item-time"> · {formatTime(row.departureTime)}</span>}
        </span>
        <span className="master-item-title">{row.title}</span>
        {row.bestPrice !== null ? (
          <span className="best-price">{formatPrice(row.bestPrice)}</span>
        ) : statusLabel ? (
          <span className="status status-pending master-item-status">{statusLabel}</span>
        ) : (
          <span className="best-price muted">-</span>
        )}
        <TrendIcon trend={row.trend} />
      </a>

      <button
        type="button"
        className="kebab-trigger"
        aria-label="Tuỳ chọn"
        data-open={menuOpen}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        ⋮
      </button>

      {menuOpen && (
        <div className="kebab-dropdown">
          <button
            type="button"
            className="kebab-dropdown-item"
            onClick={() => {
              setMenuOpen(false);
              setEditing(true);
            }}
          >
            Sửa
          </button>
          <div className="kebab-dropdown-item">
            {row.kind === "event" ? (
              <DeleteEventButton eventId={row.event.id} />
            ) : (
              <DeleteRouteButton routeId={row.route.id} eventName={null} />
            )}
          </div>
        </div>
      )}

      {row.kind === "event" ? (
        <AddEditModal open={editing} onClose={() => setEditing(false)} mode="edit-event" event={row.event} />
      ) : (
        <AddEditModal open={editing} onClose={() => setEditing(false)} mode="edit-route" route={row.route} />
      )}
    </div>
  );
}
