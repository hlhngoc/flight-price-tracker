"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteRouteButton({
  routeId,
  eventName,
  variant = "link",
}: {
  routeId: string;
  eventName?: string | null;
  // "icon": ghost trash-icon button, for the Detail Panel action bar
  // (paired with the ✏️ Edit icon button). "link": text link, for the
  // Master List kebab dropdown (paired with the "Sửa" text menu item).
  variant?: "link" | "icon";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [scope, setScope] = useState<"single" | "event">("single");

  async function runDelete(deleteScope?: "single" | "event") {
    setPending(true);
    try {
      const resp = await fetch(`/api/routes/${routeId}`, {
        method: "DELETE",
        headers: deleteScope ? { "Content-Type": "application/json" } : undefined,
        body: deleteScope ? JSON.stringify({ scope: deleteScope }) : undefined,
      });
      if (resp.ok) {
        router.refresh();
      } else {
        alert("Không xoá được route.");
      }
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  async function handleClick() {
    if (eventName) {
      setScope("single");
      setConfirming(true);
      return;
    }
    if (!confirm("Xoá route này? Lịch sử giá liên quan cũng sẽ bị xoá.")) return;
    await runDelete();
  }

  return (
    <>
      <button
        className={variant === "icon" ? "icon-button" : "button-link button-link-danger"}
        type="button"
        disabled={pending}
        onClick={handleClick}
        title={variant === "icon" ? "Xoá" : undefined}
        aria-label={variant === "icon" ? "Xoá" : undefined}
      >
        {pending ? "..." : variant === "icon" ? "🗑️" : "Xoá"}
      </button>
      {confirming && (
        <div className="modal-overlay" onClick={() => !pending && setConfirming(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p>Route này thuộc event &quot;{eventName}&quot;. Xoá gì?</p>
            <div className="modal-options">
              <label>
                <input
                  type="radio"
                  name="delete-scope"
                  checked={scope === "single"}
                  onChange={() => setScope("single")}
                />
                Chỉ xoá route này
              </label>
              <label>
                <input
                  type="radio"
                  name="delete-scope"
                  checked={scope === "event"}
                  onChange={() => setScope("event")}
                />
                Xoá route này và tất cả route khác cùng event &quot;{eventName}&quot;
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="button-secondary"
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Huỷ
              </button>
              <button className="button-danger" type="button" disabled={pending} onClick={() => runDelete(scope)}>
                {pending ? "..." : "Xoá"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
