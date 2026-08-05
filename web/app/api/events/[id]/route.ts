import { NextRequest, NextResponse } from "next/server";
import { resolveAirportCode } from "@/lib/airports";
import { claimEventForPlanning, deleteEvent, deleteRoutesForEvent, getEvent, updateEvent } from "@/lib/firestore";
import { planEventRoutes } from "@/lib/eventPlanning";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";

export const runtime = "nodejs";

interface EventPatchBody {
  name?: string;
  datetime?: string; // "YYYY-MM-DDTHH:MM" from <input type="datetime-local">, VN local time
  location?: string;
  origin?: string;
  flexibilityDays?: number;
  destination?: string;
  timeWindow?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  let body: EventPatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.timeWindow && !TIME_WINDOW_PRESETS.includes(body.timeWindow)) {
    return NextResponse.json({ error: "Khung giờ mong muốn không hợp lệ." }, { status: 400 });
  }

  let originCode = event.origin;
  // Destination is only re-resolved when the request explicitly includes
  // one — unlike creation, editing never re-infers it from `location`, so a
  // location-text tweak alone can't silently move the destination airport.
  let destCode = event.destination;
  try {
    if (body.origin) originCode = resolveAirportCode(body.origin);
    if (body.destination) destCode = resolveAirportCode(body.destination);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  let eventDatetimeUtcIso = event.event_datetime;
  if (body.datetime) {
    // datetime-local carries no timezone; interpret it as Asia/Ho_Chi_Minh
    // wall-clock time, same as POST /api/events.
    eventDatetimeUtcIso = new Date(`${body.datetime}:00+07:00`).toISOString();
    if (Number.isNaN(new Date(eventDatetimeUtcIso).getTime())) {
      return NextResponse.json({ error: "Ngày giờ sự kiện không hợp lệ." }, { status: 400 });
    }
  }

  const eventName = body.name ?? event.event_name;
  const location = body.location ?? event.location;
  const flexibilityDays = body.flexibilityDays ?? event.flexibility_days;
  const preferredTimeWindow = body.timeWindow !== undefined ? body.timeWindow || null : event.preferred_time_window;

  const mergedFields = {
    event_name: eventName,
    event_datetime: eventDatetimeUtcIso,
    location,
    origin: originCode,
    destination: destCode,
    flexibility_days: flexibilityDays,
    preferred_time_window: preferredTimeWindow,
  };

  const aiRelevantFieldsChanged =
    originCode !== event.origin ||
    destCode !== event.destination ||
    flexibilityDays !== event.flexibility_days ||
    preferredTimeWindow !== event.preferred_time_window ||
    eventDatetimeUtcIso !== event.event_datetime;
  // An event stuck at "error" (or "pending") has no settled route set to
  // leave untouched — this is also the dashboard's manual-retry path for
  // those (see the "Sửa" link on the unresolved-events table), so an
  // unchanged resubmit on a non-"done" event must still attempt a replan.
  const replanNeeded = aiRelevantFieldsChanged || event.ai_status !== "done";

  if (!replanNeeded) {
    await updateEvent(id, mergedFields);
    return NextResponse.json({ eventId: id, replanned: false });
  }

  if (!(await claimEventForPlanning(id))) {
    return NextResponse.json(
      { eventId: id, status: "claim_conflict", error: "Event đang được xử lý, thử lại sau." },
      { status: 409 }
    );
  }

  await updateEvent(id, mergedFields);
  await deleteRoutesForEvent(id);

  const updatedEvent = await getEvent(id);
  if (!updatedEvent) {
    return NextResponse.json({ eventId: id, error: "Failed to load event after update" }, { status: 500 });
  }

  const result = await planEventRoutes(updatedEvent);
  if (result.kind === "pending") {
    return NextResponse.json(
      { eventId: id, replanned: true, pending: true, message: result.message },
      { status: 202 }
    );
  }
  if (result.kind === "error") {
    return NextResponse.json({ eventId: id, replanned: true, error: result.message }, { status: 502 });
  }
  return NextResponse.json({
    eventId: id,
    replanned: true,
    createdRoutes: result.createdRoutes,
    duplicateSlots: result.duplicateSlots,
    totalSlots: result.totalSlots,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteEvent(id);
  return NextResponse.json({ ok: true });
}
