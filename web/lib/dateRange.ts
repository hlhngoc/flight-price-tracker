// Mirrors flight_tracker/route_range.py: given a target date and a +/- day
// window, create one tracked route per date in that window. No AI involved
// — for manual long-term tracking around a date you already have in mind.
import { addRouteIfNew } from "./firestore";

export const DEFAULT_RANGE_DAYS = 4;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function createRoutesAroundDate(
  origin: string,
  destination: string,
  targetDateIso: string, // "YYYY-MM-DD"
  rangeBefore: number = DEFAULT_RANGE_DAYS,
  rangeAfter: number = DEFAULT_RANGE_DAYS
): Promise<string[]> {
  if (rangeBefore < 0 || rangeAfter < 0) {
    throw new Error("rangeBefore/rangeAfter must be >= 0");
  }

  const target = new Date(`${targetDateIso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) {
    throw new Error(`Invalid target date: ${targetDateIso}`);
  }

  const createdRouteIds: string[] = [];
  for (let offsetDays = -rangeBefore; offsetDays <= rangeAfter; offsetDays++) {
    const flightDate = toIsoDate(new Date(target.getTime() + offsetDays * 86400000));
    const { id, created } = await addRouteIfNew({ origin, destination, flight_date: flightDate });
    if (created) createdRouteIds.push(id);
  }

  return createdRouteIds;
}
