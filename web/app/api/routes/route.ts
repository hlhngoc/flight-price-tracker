import { NextRequest, NextResponse } from "next/server";
import { resolveAirportCode } from "@/lib/airports";
import { createRoutesAroundDate, DEFAULT_RANGE_DAYS } from "@/lib/dateRange";
import { addRoute, listRoutes } from "@/lib/firestore";
import { TIME_WINDOW_PRESETS } from "@/lib/timeWindows";

export const runtime = "nodejs";

export async function GET() {
  const routes = await listRoutes();
  return NextResponse.json({ routes });
}

interface RouteRequestBody {
  origin?: string;
  destination?: string;
  targetDate?: string; // "YYYY-MM-DD" from <input type="date"> — recommended
  rangeBefore?: number;
  rangeAfter?: number;
  offsetDays?: number; // legacy: single rolling today+N days route
  timeWindow?: string; // optional, must be one of TIME_WINDOW_PRESETS
  returnDate?: string; // "YYYY-MM-DD", round-trip — only valid alongside targetDate
}

export async function POST(req: NextRequest) {
  let body: RouteRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.origin || !body.destination) {
    return NextResponse.json({ error: "Thiếu điểm đi/điểm đến." }, { status: 400 });
  }

  let originCode: string;
  let destCode: string;
  try {
    originCode = resolveAirportCode(body.origin);
    destCode = resolveAirportCode(body.destination);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  if (body.timeWindow && !TIME_WINDOW_PRESETS.includes(body.timeWindow)) {
    return NextResponse.json({ error: "Khung giờ mong muốn không hợp lệ." }, { status: 400 });
  }
  const timeWindow = body.timeWindow || null;

  if (body.targetDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) {
      return NextResponse.json({ error: "Ngày dự kiến bay không hợp lệ." }, { status: 400 });
    }
    const rangeBefore = body.rangeBefore ?? DEFAULT_RANGE_DAYS;
    const rangeAfter = body.rangeAfter ?? DEFAULT_RANGE_DAYS;
    if (rangeBefore < 0 || rangeAfter < 0) {
      return NextResponse.json({ error: "Số ngày track trước/sau phải >= 0." }, { status: 400 });
    }

    let returnDate: string | null = null;
    if (body.returnDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.returnDate)) {
        return NextResponse.json({ error: "Ngày về không hợp lệ." }, { status: 400 });
      }
      // Compare against the LATEST outbound date the batch will generate
      // (targetDate + rangeAfter), not targetDate itself — routes near the
      // right edge of the ±range window would otherwise accept a return
      // date that's before-or-equal to their own flight_date.
      const targetDateObj = new Date(`${body.targetDate}T00:00:00Z`);
      const maxFlightDateIso = new Date(targetDateObj.getTime() + rangeAfter * 86400000)
        .toISOString()
        .slice(0, 10);
      if (body.returnDate <= maxFlightDateIso) {
        return NextResponse.json(
          { error: "Ngày về phải sau ngày bay muộn nhất trong khoảng theo dõi." },
          { status: 400 }
        );
      }
      returnDate = body.returnDate;
    }

    const routeIds = await createRoutesAroundDate(
      originCode, destCode, body.targetDate, rangeBefore, rangeAfter, timeWindow, returnDate,
    );
    return NextResponse.json({ routeIds }, { status: 201 });
  }

  // legacy: single rolling today+N days route
  const routeId = await addRoute({
    origin: originCode,
    destination: destCode,
    target_date_offset_days: body.offsetDays ?? 30,
    preferred_time_window: timeWindow,
  });

  return NextResponse.json({ id: routeId }, { status: 201 });
}
