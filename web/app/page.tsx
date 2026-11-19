import Link from "next/link";
import { getPriceSummaryForRoute, listEvents, listRoutes } from "@/lib/firestore";
import { buildEventRow, buildManualRow, effectiveSortDate, type RouteInfo, type SelectedDetail } from "@/lib/dashboardView";
import type { RouteDoc } from "@/lib/types";
import type { MasterListSection } from "./components/MasterList";
import Dashboard from "./components/Dashboard";

export const dynamic = "force-dynamic";

// Selection (?sel=) is resolved client-side in <Dashboard> — every row's
// detail is precomputed here, so tapping a row is a local state change via
// history.pushState instead of a full server re-render + Firestore fan-out.
export default async function DashboardPage() {
  const [routes, events] = await Promise.all([listRoutes(), listEvents()]);

  const routeInfoEntries = await Promise.all(
    routes.map(async (r) => {
      const { prices, trend } = await getPriceSummaryForRoute(r.id);
      return [r.id, { route: r, prices, trend }] as const;
    })
  );
  const routeInfoById = new Map<string, RouteInfo>(routeInfoEntries);

  const manualRoutes = routes
    .filter((r) => !r.event_id)
    .sort((a, b) => effectiveSortDate(a).localeCompare(effectiveSortDate(b)));

  const routesByEvent = new Map<string, RouteDoc[]>();
  for (const r of routes) {
    if (!r.event_id) continue;
    if (!routesByEvent.has(r.event_id)) routesByEvent.set(r.event_id, []);
    routesByEvent.get(r.event_id)!.push(r);
  }
  for (const rs of routesByEvent.values()) {
    rs.sort((a, b) => effectiveSortDate(a).localeCompare(effectiveSortDate(b)));
  }

  const manualSection: MasterListSection = {
    key: "manual",
    label: "Theo dõi thủ công",
    rows: manualRoutes.map((r) => buildManualRow(routeInfoById.get(r.id)!)),
  };

  const sortedEvents = [...events].sort((a, b) => a.event_name.localeCompare(b.event_name, "vi"));
  const eventSection: MasterListSection = {
    key: "events",
    label: "Sự kiện",
    rows: sortedEvents.map((e) => buildEventRow(e, (routesByEvent.get(e.id) ?? []).map((r) => routeInfoById.get(r.id)!))),
  };

  const sections = [manualSection, eventSection];

  const details: Record<string, SelectedDetail> = {};
  for (const r of manualRoutes) details[r.id] = { kind: "manual", routeInfo: routeInfoById.get(r.id)! };
  for (const e of events) {
    details[e.id] = {
      kind: "event",
      event: e,
      routeInfos: (routesByEvent.get(e.id) ?? []).map((r) => routeInfoById.get(r.id)!),
    };
  }

  return (
    <main className="dashboard-main">
      <div className="page-header">
        <h1>Flight Price Tracker</h1>
        <div className="actions">
          <Link className="button" href="/add-event">
            + Sự kiện
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
      <Dashboard sections={sections} details={details} />
    </main>
  );
}
