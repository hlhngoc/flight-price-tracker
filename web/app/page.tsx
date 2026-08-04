import Link from "next/link";
import { formatDmy } from "@/lib/dateFormat";
import { getLatestPriceForRoute, listEvents, listRoutes } from "@/lib/firestore";
import MarkBookedButton from "./components/MarkBookedButton";

export const dynamic = "force-dynamic";

function formatPrice(price: number): string {
  return `${price.toLocaleString("vi-VN")}đ`;
}

export default async function DashboardPage() {
  const [routes, events] = await Promise.all([listRoutes(), listEvents()]);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const prices = await Promise.all(routes.map((r) => getLatestPriceForRoute(r.id)));

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
              <th>Giá gần nhất</th>
              <th>Sự kiện</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => {
              const event = r.event_id ? eventsById.get(r.event_id) : undefined;
              const price = prices[i];
              return (
                <tr key={r.id}>
                  <td>
                    {r.origin} → {r.destination}
                  </td>
                  <td>{r.flight_date ? formatDmy(r.flight_date) : `hôm nay+${r.target_date_offset_days}d`}</td>
                  <td>{r.preferred_time_window ?? "-"}</td>
                  <td>{price ? formatPrice(price.price) : "-"}</td>
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
