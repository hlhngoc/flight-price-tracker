import { NextRequest, NextResponse } from "next/server";
import { resolveAirportCode } from "@/lib/airports";
import { createRoutesAroundDate, DEFAULT_RANGE_DAYS } from "@/lib/dateRange";
import { addRoute, listRoutes } from "@/lib/firestore";

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

  if (body.targetDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) {
      return NextResponse.json({ error: "Ngày dự kiến bay không hợp lệ." }, { status: 400 });
    }
    const rangeBefore = body.rangeBefore ?? DEFAULT_RANGE_DAYS;
    const rangeAfter = body.rangeAfter ?? DEFAULT_RANGE_DAYS;
    if (rangeBefore < 0 || rangeAfter < 0) {
      return NextResponse.json({ error: "Số ngày track trước/sau phải >= 0." }, { status: 400 });
    }

    const routeIds = await createRoutesAroundDate(originCode, destCode, body.targetDate, rangeBefore, rangeAfter);
    return NextResponse.json({ routeIds }, { status: 201 });
  }

  // legacy: single rolling today+N days route
  const routeId = await addRoute({
    origin: originCode,
    destination: destCode,
    target_date_offset_days: body.offsetDays ?? 30,
  });

  return NextResponse.json({ id: routeId }, { status: 201 });
}
