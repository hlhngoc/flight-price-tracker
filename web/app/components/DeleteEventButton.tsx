"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { useDashboard } from "./Dashboard";
import { useToast } from "./ToastProvider";

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
  const dashboard = useDashboard();
  const { showToast } = useToast();

  // Optimistic — see DeleteRouteButton.runDelete.
  async function deleteEvent() {
    if (!confirm("Xoá event này? Sẽ không còn tự động thử lại AI cho event này nữa.")) return;
    dashboard?.hide([eventId]);
    if (!dashboard) setPending(true);
    try {
      const resp = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(String(resp.status));
      showToast("Đã xoá sự kiện");
      startTransition(() => router.refresh());
    } catch {
      dashboard?.unhide([eventId]);
      showToast("Không xoá được event.", "error");
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
