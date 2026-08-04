import Link from "next/link";
import { formatDmy } from "@/lib/dateFormat";
import { getLatestPricesForRoute, listEvents, listRoutes } from "@/lib/firestore";
import type { EventDoc, RouteDoc } from "@/lib/types";
import MarkBookedButton from "./components/MarkBookedButton";

export const dynamic = "force-dynamic";

function formatPrice(price: number): string {
  return `${price.toLocaleString("vi-VN")}đ`;
}

// For legacy offset-based routes (no fixed flight_date), approximate the
// date they currently track as today+N — just for ordering rows, not
// displayed anywhere, so no need for VN-timezone precision here.
function effectiveSortDate(route: RouteDoc): string {
  if (route.flight_date) return route.flight_date;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + route.target_date_offset_days);
  return d.toISOString().slice(0, 10);
}

// Routes with no event first (sorted by date), then routes with an event
// grouped by event name (sorted by date within each event's group).
function compareRoutesForDisplay(a: RouteDoc, b: RouteDoc, eventsById: Map<string, EventDoc>): number {
  const eventA = a.event_id ? eventsById.get(a.event_id) : undefined;
  const eventB = b.event_id ? eventsById.get(b.event_id) : undefined;

  if (!eventA && eventB) return -1;
  if (eventA && !eventB) return 1;
  if (eventA && eventB) {
    const nameCompare = eventA.event_name.localeCompare(eventB.event_name, "vi");
    if (nameCompare !== 0) return nameCompare;
  }

  return effectiveSortDate(a).localeCompare(effectiveSortDate(b));
}

export default async function DashboardPage() {
  const [routes, events] = await Promise.all([listRoutes(), listEvents()]);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const priceEntries = await Promise.all(
    routes.map(async (r) => [r.id, await getLatestPricesForRoute(r.id)] as const)
  );
  const pricesByRouteId = new Map(priceEntries);
  const sortedRoutes = [...routes].sort((a, b) => compareRoutesForDisplay(a, b, eventsById));

  return (
    <main>
      <div className="page-header">
        <h1>Flight Price Tracker</h1>
        <div className="actions">
          <Link className="button" href="/add-event">
            + Event
          </Link>
          <Link className="button button-secondary" href="/add-route">
            + Route thủ công
          </Link>
          <form action="/api/logout" method="post">
            <button className="button-secondary" type="submit">
              Đăng xuất
            </button>
          </form>
        </div>
      </div>

      {routes.length === 0 ? (
        <p className="empty">Chưa có route nào được theo dõi.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Chặng</th>
              <th>Ngày bay</th>
              <th>Khung giờ</th>
              <th>Giá rẻ nhất (2 hãng)</th>
              <th>Sự kiện</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedRoutes.map((r) => {
              const event = r.event_id ? eventsById.get(r.event_id) : undefined;
              const prices = pricesByRouteId.get(r.id) ?? [];
              return (
                <tr key={r.id}>
                  <td>
                    {r.origin} → {r.destination}
                  </td>
                  <td>{r.flight_date ? formatDmy(r.flight_date) : `hôm nay+${r.target_date_offset_days}d`}</td>
                  <td>{r.preferred_time_window ?? "-"}</td>
                  <td>
                    {prices.length === 0
                      ? "-"
                      : prices.map((p) => (
                          <div key={p.id}>
                            {formatPrice(p.price)}
                            {p.airline ? ` — ${p.airline}` : ""}
                          </div>
                        ))}
                  </td>
                  <td>{event ? event.event_name : "-"}</td>
                  <td>
                    <span className={`status status-${r.status}`}>{r.status}</span>
                  </td>
                  <td>{r.status === "tracking" && <MarkBookedButton routeId={r.id} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
