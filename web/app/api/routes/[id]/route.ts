import { NextRequest, NextResponse } from "next/server";
import { deleteEventAndRoutes, deleteRoute, getRoute, setRouteStatus } from "@/lib/firestore";
import type { RouteStatus } from "@/lib/types";

export const runtime = "nodejs";

const VALID_STATUSES: RouteStatus[] = ["tracking", "booked", "expired"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.status || !VALID_STATUSES.includes(body.status as RouteStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await setRouteStatus(id, body.status as RouteStatus);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = await getRoute(id);
  // A route created from an event represents one of the AI's candidate
  // slots for that event — deleting it means the user wants to drop the
  // whole event, not just this slot, so cascade to the event and its other
  // routes too instead of leaving them orphaned.
  if (route?.event_id) {
    await deleteEventAndRoutes(route.event_id);
  } else {
    await deleteRoute(id);
  }
  return NextResponse.json({ ok: true });
}
