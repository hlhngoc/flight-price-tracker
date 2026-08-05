"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteRouteButton({ routeId }: { routeId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function deleteRoute() {
    if (!confirm("Xoá route này? Lịch sử giá liên quan cũng sẽ bị xoá.")) return;
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
