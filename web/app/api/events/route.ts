import { NextRequest, NextResponse } from "next/server";
import { resolveAirportCode } from "@/lib/airports";
import { addEvent, claimEventForPlanning, getEvent } from "@/lib/firestore";
import { planEventRoutes } from "@/lib/eventPlanning";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";

export const runtime = "nodejs";

interface EventRequestBody {
  name?: string;
  datetime?: string; // "YYYY-MM-DDTHH:MM" from <input type="datetime-local">, VN local time
  location?: string;
  origin?: string;
  flexibilityDays?: number;
  destination?: string;
  timeWindow?: string;
}

export async function POST(req: NextRequest) {
  let body: EventRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, datetime, location, origin, flexibilityDays } = body;
  if (!name || !datetime || !location || !origin || flexibilityDays == null) {
    return NextResponse.json({ error: "Thiếu trường bắt buộc." }, { status: 400 });
  }
  if (body.timeWindow && !TIME_WINDOW_PRESETS.includes(body.timeWindow)) {
    return NextResponse.json({ error: "Khung giờ mong muốn không hợp lệ." }, { status: 400 });
  }

  let originCode: string;
  let destCode: string;
  try {
    originCode = resolveAirportCode(origin);
    destCode = body.destination ? resolveAirportCode(body.destination) : resolveAirportCode(location);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // datetime-local carries no timezone; interpret it as Asia/Ho_Chi_Minh
  // wall-clock time (matches the Python CLI's vn_local_to_utc_iso).
  const eventDatetimeUtcIso = new Date(`${datetime}:00+07:00`).toISOString();
  if (Number.isNaN(new Date(eventDatetimeUtcIso).getTime())) {
    return NextResponse.json({ error: "Ngày giờ sự kiện không hợp lệ." }, { status: 400 });
  }

  const eventId = await addEvent({
    event_name: name,
    event_datetime: eventDatetimeUtcIso,
    location,
    origin: originCode,
    destination: destCode,
    flexibility_days: flexibilityDays,
    preferred_time_window: body.timeWindow || null,
  });
  const event = await getEvent(eventId);
  if (!event) {
    return NextResponse.json({ error: "Failed to load event after creation" }, { status: 500 });
  }

  // A brand-new event's ai_status is "pending" (the default from addEvent)
  // with nothing else able to reference it yet, so this claim essentially
  // always succeeds — it exists mainly for consistency with the other
  // callers of planEventRoutes (edit-triggered replan, the retry cron),
  // all of which must claim first so at most one is ever mid-AI-call for a
  // given event (see claimEventForPlanning's docstring).
  if (!(await claimEventForPlanning(eventId))) {
    return NextResponse.json({ eventId, createdRoutes: [], error: "Failed to claim event for planning" }, { status: 500 });
  }

  const result = await planEventRoutes(event);
  if (result.kind === "pending") {
    // Left ai_status "pending" — the daily retry-pending-events cron picks
    // this event up automatically once Gemini's free-tier quota resets.
    return NextResponse.json(
      { eventId, createdRoutes: [], pending: true, message: result.message },
      { status: 202 }
    );
  }
  if (result.kind === "error") {
    return NextResponse.json({ eventId, createdRoutes: [], error: result.message }, { status: 502 });
  }

  return NextResponse.json(
    { eventId, createdRoutes: result.createdRoutes, duplicateSlots: result.duplicateSlots, totalSlots: result.totalSlots },
    { status: 201 }
  );
}
