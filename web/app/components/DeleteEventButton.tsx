"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteEventButton({ eventId }: { eventId: string }) {
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
    <button className="button-link button-link-danger" type="button" disabled={pending} onClick={deleteEvent}>
      {pending ? "..." : "Xoá"}
    </button>
  );
}
