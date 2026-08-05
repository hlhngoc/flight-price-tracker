import Link from "next/link";
import { formatDmy, formatTime, formatVnDateTime } from "@/lib/dateFormat";
import { getLatestPricesForRoute, listEvents, listRoutes } from "@/lib/firestore";
import type { EventDoc, PriceRecord, RouteDoc } from "@/lib/types";
import DeleteEventButton from "./components/DeleteEventButton";
import DeleteRouteButton from "./components/DeleteRouteButton";
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

function ChangCell({ route }: { route: RouteDoc }) {
  return (
    <>
      {route.origin} → {route.destination}
      {route.preferred_time_window && (
        <div className="subtext">Mong muốn: {route.preferred_time_window}</div>
      )}
    </>
  );
}

function PriceRow({ price }: { price: PriceRecord }) {
  const isFallback = price.matched_preferred_window === false;
  return (
    <td>
      {formatTime(price.departure_time)}
      {isFallback && (
        <div className="window-warning" title="Không có chuyến trong khung giờ mong muốn">
          ⚠ ngoài khung giờ mong muốn
        </div>
      )}
    </td>
  );
}

export default async function DashboardPage() {
  const [routes, events] = await Promise.all([listRoutes(), listEvents()]);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const priceEntries = await Promise.all(
    routes.map(async (r) => [r.id, await getLatestPricesForRoute(r.id)] as const)
  );
  const pricesByRouteId = new Map(priceEntries);
  const sortedRoutes = [...routes].sort((a, b) => compareRoutesForDisplay(a, b, eventsById));
  // Events whose AI slot generation hasn't completed yet — most commonly
  // "pending" because Gemini's daily quota was exhausted when the event was
  // created (auto-retried once a day, see .github/workflows/
  // retry-pending-events.yml) or "error" for a non-quota AI failure that
  // won't auto-retry.
  const unresolvedEvents = events.filter((e) => e.ai_status === "pending" || e.ai_status === "error");

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

      {unresolvedEvents.length > 0 && (
        <table className="pending-events-table">
          <thead>
            <tr>
              <th>Sự kiện</th>
              <th>Chặng</th>
              <th>Giờ sự kiện</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {unresolvedEvents.map((e) => (
              <tr key={e.id}>
                <td>{e.event_name}</td>
                <td>
                  {e.origin} → {e.destination ?? "-"}
                </td>
                <td>{formatVnDateTime(e.event_datetime)}</td>
                <td>
                  {e.ai_status === "pending" ? (
                    <span className="status status-pending" title="Gemini hết quota — tự động thử lại hàng ngày">
                      Đang lựa chọn tuyến phù hợp
                    </span>
                  ) : (
                    <span className="status status-error" title="AI lỗi (không phải do hết quota) — cần tạo route thủ công">
                      Lỗi AI
                    </span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <DeleteEventButton eventId={e.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {routes.length === 0 ? (
        <p className="empty">Chưa có route nào được theo dõi.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Chặng</th>
              <th>Ngày bay</th>
              <th>Khung giờ (giờ bay)</th>
              <th>Giá / Hãng</th>
              <th>Sự kiện</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedRoutes.map((r) => {
              const event = r.event_id ? eventsById.get(r.event_id) : undefined;
              const prices = pricesByRouteId.get(r.id) ?? [];
              const rowCount = Math.max(prices.length, 1);
              const dateCell = r.flight_date ? formatDmy(r.flight_date) : `hôm nay+${r.target_date_offset_days}d`;
              const statusCell = <span className={`status status-${r.status}`}>{r.status}</span>;
              const actionCell = (
                <div className="row-actions">
                  {r.status === "tracking" && <MarkBookedButton routeId={r.id} />}
                  <DeleteRouteButton routeId={r.id} />
                </div>
              );

              if (prices.length === 0) {
                return (
                  <tr key={r.id}>
                    <td>
                      <ChangCell route={r} />
                    </td>
                    <td>{dateCell}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>{event ? event.event_name : "-"}</td>
                    <td>{statusCell}</td>
                    <td>{actionCell}</td>
                  </tr>
                );
              }

              return prices.map((p, i) => (
                <tr key={p.id}>
                  {i === 0 && (
                    <>
                      <td rowSpan={rowCount}>
                        <ChangCell route={r} />
                      </td>
                      <td rowSpan={rowCount}>{dateCell}</td>
                    </>
                  )}
                  <PriceRow price={p} />
                  <td>
                    {formatPrice(p.price)}
                    {p.airline ? ` — ${p.airline}` : ""}
                  </td>
                  {i === 0 && (
                    <>
                      <td rowSpan={rowCount}>{event ? event.event_name : "-"}</td>
                      <td rowSpan={rowCount}>{statusCell}</td>
                      <td rowSpan={rowCount}>{actionCell}</td>
                    </>
                  )}
                </tr>
              ));
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
