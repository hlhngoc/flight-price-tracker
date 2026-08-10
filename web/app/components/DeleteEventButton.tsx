"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteEventButton({
  eventId,
  variant = "link",
}: {
  eventId: string;
  // See DeleteRouteButton's variant prop for the "icon" vs "link" contexts.
  variant?: "link" | "icon";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function deleteEvent() {
    if (!confirm("Xoá event này? Sẽ không còn tự động thử lại AI cho event này nữa.")) return;
    setPending(true);
    try {
      const resp = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      if (resp.ok) {
        router.refresh();
      } else {
        alert("Không xoá được event.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className={variant === "icon" ? "icon-button" : "button-link button-link-danger"}
      type="button"
      disabled={pending}
      onClick={deleteEvent}
      title={variant === "icon" ? "Xoá" : undefined}
      aria-label={variant === "icon" ? "Xoá" : undefined}
    >
      {pending ? "..." : variant === "icon" ? "🗑️" : "Xoá"}
    </button>
  );
}
