"use client";

import { useEffect, type ReactNode } from "react";

// Generic overlay wrapper, formalizing the .modal-overlay/.modal-card
// pattern already used ad hoc inside DeleteRouteButton.tsx (same classes,
// same click-outside/backdrop behavior) so other callers don't hand-roll it
// again.
export default function Modal({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-card${wide ? " modal-card-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
