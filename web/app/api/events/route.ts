import { NextRequest, NextResponse } from "next/server";
import { resolveAirportCode } from "@/lib/airports";
import { AIReasoningError, generateEventSlots } from "@/lib/gemini";
import { addEvent, addRoute, findMatchingRoute, getEvent } from "@/lib/firestore";
import { triggerPriceCheckWorkflow } from "@/lib/githubActions";

export const runtime = "nodejs";

interface EventRequestBody {
  name?: string;
  datetime?: string; // "YYYY-MM-DDTHH:MM" from <input type="datetime-local">, VN local time
  location?: string;
  origin?: string;
  flexibilityDays?: number;
  destination?: string;
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
    flexibility_days: flexibilityDays,
  });
  const event = await getEvent(eventId);
  if (!event) {
    return NextResponse.json({ error: "Failed to load event after creation" }, { status: 500 });
  }

  let slots;
  try {
    slots = await generateEventSlots(event);
  } catch (err) {
    const message = err instanceof AIReasoningError ? err.message : "AI reasoning failed";
    return NextResponse.json({ eventId, createdRoutes: [], error: message }, { status: 502 });
  }

  const createdRoutes: Array<{
    id: string;
    flight_date: string;
    preferred_time_window: string;
    ai_reasoning: string;
  }> = [];

  for (const slot of slots) {
    const existing = await findMatchingRoute(originCode, destCode, slot.flight_date);
    if (existing) continue;
    const routeId = await addRoute({
      origin: originCode,
      destination: destCode,
      flight_date: slot.flight_date,
      preferred_time_window: slot.preferred_time_window,
      event_id: eventId,
      ai_reasoning: slot.reasoning,
    });
    createdRoutes.push({
      id: routeId,
      flight_date: slot.flight_date,
      preferred_time_window: slot.preferred_time_window,
      ai_reasoning: slot.reasoning,
    });
  }

  // Fire-and-forget: kick off an immediate, scoped price check for the
  // routes just created instead of waiting for the next scheduled cron run.
  await triggerPriceCheckWorkflow(createdRoutes.map((r) => r.id));

  return NextResponse.json({ eventId, createdRoutes }, { status: 201 });
}
