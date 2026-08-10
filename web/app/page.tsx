import Link from "next/link";
import { getLatestPricesForRoute, getPriceTrendForRoute, listEvents, listRoutes } from "@/lib/firestore";
import { buildEventRow, buildManualRow, effectiveSortDate, type RouteInfo, type SelectedDetail } from "@/lib/dashboardView";
import type { RouteDoc } from "@/lib/types";
import AppShell from "./components/AppShell";
import MasterList, { type MasterListSection } from "./components/MasterList";
import DetailPanel from "./components/DetailPanel";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sel?: string }>;
}) {
  const { sel } = await searchParams;
  const [routes, events] = await Promise.all([listRoutes(), listEvents()]);
  const eventsById = new Map(events.map((e) => [e.id, e]));

  const routeInfoEntries = await Promise.all(
    routes.map(async (r) => {
      const [prices, trend] = await Promise.all([getLatestPricesForRoute(r.id), getPriceTrendForRoute(r.id)]);
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
  const allRows = [...manualSection.rows, ...eventSection.rows];
  const selectedId = sel ?? allRows[0]?.id ?? null;

  let detail: SelectedDetail = null;
  if (selectedId) {
    const selectedEvent = eventsById.get(selectedId);
    if (selectedEvent) {
      const routeInfos = (routesByEvent.get(selectedId) ?? []).map((r) => routeInfoById.get(r.id)!);
      detail = { kind: "event", event: selectedEvent, routeInfos };
    } else {
      const routeInfo = routeInfoById.get(selectedId);
      if (routeInfo && !routeInfo.route.event_id) {
        detail = { kind: "manual", routeInfo };
      }
    }
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
      <AppShell
        hasSelection={selectedId !== null}
        masterPanel={<MasterList sections={sections} selectedId={selectedId} />}
        detailPanel={<DetailPanel detail={detail} />}
      />
    </main>
  );
}
