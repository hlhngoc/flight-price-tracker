import { NextRequest, NextResponse } from "next/server";
import { resolveAirportCode } from "@/lib/airports";
import {
  deleteEventAndRoutes,
  deleteRoute,
  findMatchingRoute,
  getRoute,
  setRouteStatus,
  updateRoute,
} from "@/lib/firestore";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";
import type { RouteStatus } from "@/lib/types";

export const runtime = "nodejs";

const VALID_STATUSES: RouteStatus[] = ["tracking", "booked", "expired"];

interface RoutePatchBody {
  status?: string;
  origin?: string;
  destination?: string;
  flight_date?: string | null;
  target_date_offset_days?: number;
  preferred_time_window?: string | null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) {
    return NextResponse.json({ error: "Route not found" }, { status: 404 });
  }

  let body: RoutePatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as RouteStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    await setRouteStatus(id, body.status as RouteStatus);
  }

  const hasFieldEdit =
    body.origin !== undefined ||
    body.destination !== undefined ||
    body.flight_date !== undefined ||
    body.target_date_offset_days !== undefined ||
    body.preferred_time_window !== undefined;

  if (!hasFieldEdit) {
    if (body.status === undefined) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  // Event-linked routes are one of the AI's candidate slots for that event —
  // editing them directly (bypassing the AI) would desync them from the
  // event; those must go through PATCH /api/events/[eventId] instead, which
  // regenerates the whole slot set.
  if (route.event_id) {
    return NextResponse.json(
      { error: "Route này thuộc 1 event — sửa qua trang sửa sự kiện." },
      { status: 400 }
    );
  }

  if (body.preferred_time_window && !TIME_WINDOW_PRESETS.includes(body.preferred_time_window)) {
    return NextResponse.json({ error: "Khung giờ mong muốn không hợp lệ." }, { status: 400 });
  }

  let origin = route.origin;
  let destination = route.destination;
  try {
    if (body.origin) origin = resolveAirportCode(body.origin);
    if (body.destination) destination = resolveAirportCode(body.destination);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const flightDate = body.flight_date !== undefined ? body.flight_date : route.flight_date;
  const targetDateOffsetDays =
    body.target_date_offset_days !== undefined ? body.target_date_offset_days : route.target_date_offset_days;
  const preferredTimeWindow =
    body.preferred_time_window !== undefined ? body.preferred_time_window || null : route.preferred_time_window;

  // Duplicate guard only applies when the edited route ends up with a
  // concrete flight_date — findMatchingRoute queries an exact flight_date
  // string, so it can never match (and thus never dedupe against) a legacy
  // offset-based route (flight_date: null); editing target_date_offset_days
  // alone has no duplicate check, same as the create flow for those routes.
  if (flightDate) {
    const existing = await findMatchingRoute(origin, destination, flightDate, id);
    if (existing) {
      return NextResponse.json(
        { error: "Đã có route khác đang theo dõi đúng chặng và ngày bay này." },
        { status: 409 }
      );
    }
  }

  await updateRoute(id, {
    origin,
    destination,
    flight_date: flightDate,
    target_date_offset_days: targetDateOffsetDays,
    preferred_time_window: preferredTimeWindow,
  });

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
