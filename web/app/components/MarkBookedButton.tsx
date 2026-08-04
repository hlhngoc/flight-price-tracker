"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MarkBookedButton({ routeId }: { routeId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function markBooked() {
    setPending(true);
    try {
      const resp = await fetch(`/api/routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "booked" }),
      });
      if (resp.ok) {
        router.refresh();
      } else {
        alert("Không cập nhật được trạng thái route.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="button-link" type="button" disabled={pending} onClick={markBooked}>
      {pending ? "..." : "Đã đặt vé"}
    </button>
  );
}
