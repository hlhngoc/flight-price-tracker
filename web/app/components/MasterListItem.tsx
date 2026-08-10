"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatTime } from "@/lib/dateFormat";
import { formatPrice, type MasterListRow } from "@/lib/dashboardView";
import AddEditModal from "./AddEditModal";
import DeleteEventButton from "./DeleteEventButton";
import DeleteRouteButton from "./DeleteRouteButton";

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

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, [menuOpen]);

  const statusLabel = row.kind === "event" && row.aiStatus !== "done" ? AI_STATUS_LABEL[row.aiStatus] : null;

  return (
    <div className="master-item-row" ref={wrapRef}>
      <Link href={`/?sel=${row.id}`} scroll={false} className="master-item" data-active={isSelected}>
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
      </Link>

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
