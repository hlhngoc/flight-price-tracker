"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteRouteButton({ routeId, hasEvent }: { routeId: string; hasEvent?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function deleteRoute() {
    const confirmMessage = hasEvent
      ? "Route này thuộc 1 event. Xoá sẽ xoá luôn event và toàn bộ route khác cùng event đó. Tiếp tục?"
      : "Xoá route này? Lịch sử giá liên quan cũng sẽ bị xoá.";
    if (!confirm(confirmMessage)) return;
    setPending(true);
    try {
      const resp = await fetch(`/api/routes/${routeId}`, { method: "DELETE" });
      if (resp.ok) {
        router.refresh();
      } else {
        alert("Không xoá được route.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="button-link button-link-danger" type="button" disabled={pending} onClick={deleteRoute}>
      {pending ? "..." : "Xoá"}
    </button>
  );
}
