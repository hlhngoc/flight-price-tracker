// Shapes/helpers for the master-detail dashboard (app/page.tsx +
// app/components/MasterList*, DetailPanel*) — separated from page.tsx since
// both the list-row projection and the selection-resolution logic are
// reused across those files.
import { formatDmy } from "./dateFormat";
import type { EventAiStatus, EventDoc, PriceRecord, RouteDoc } from "./types";

export interface PriceTrend {
  current: number | null;
  previous: number | null;
  trend: "up" | "down" | null;
}

export interface RouteInfo {
  route: RouteDoc;
  prices: PriceRecord[]; // up to 2, cheapest first — see getLatestPricesForRoute
  trend: PriceTrend;
}

interface MasterListRowBase {
  id: string; // route id (manual) or event id (event) — the ?sel= value
  ticketType: "one-way" | "round-trip";
  title: string;
  originCode: string;
  destinationCode: string;
  bestPrice: number | null;
  trend: "up" | "down" | null;
  // "YYYY-MM-DD HH:MM" from the same price record bestPrice came from — the
  // old table-based dashboard showed this per row; carried into the Master
  // List row so it isn't only visible after clicking into the Detail Panel.
  departureTime: string | null;
}

// Carries the full underlying doc (not just the projected display fields)
// so MasterListItem's kebab menu can open the edit modal / delete button
// without a second lookup — page.tsx already has these in hand server-side.
export type MasterListRow =
  | (MasterListRowBase & { kind: "manual"; route: RouteDoc })
  | (MasterListRowBase & { kind: "event"; event: EventDoc; aiStatus: EventAiStatus });

export type SelectedDetail =
  | { kind: "manual"; routeInfo: RouteInfo }
  | { kind: "event"; event: EventDoc; routeInfos: RouteInfo[] }
  | null;

// For legacy offset-based routes (no fixed flight_date), approximate the
// date they currently track as today+N — just for ordering rows, not
// displayed anywhere, so no need for VN-timezone precision here. Ported
// from the old app/page.tsx table's row-ordering logic.
export function effectiveSortDate(route: RouteDoc): string {
  if (route.flight_date) return route.flight_date;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + route.target_date_offset_days);
  return d.toISOString().slice(0, 10);
}

export function flightDateLabel(route: { flight_date: string | null; target_date_offset_days: number }): string {
  return route.flight_date ? formatDmy(route.flight_date) : `hôm nay+${route.target_date_offset_days}d`;
}

export function cheapestRouteInfo(routeInfos: RouteInfo[]): RouteInfo | null {
  let best: RouteInfo | null = null;
  for (const ri of routeInfos) {
    const price = ri.prices[0]?.price;
    if (price === undefined) continue;
    if (best === null || price < (best.prices[0]?.price ?? Infinity)) best = ri;
  }
  return best;
}

export function buildManualRow(routeInfo: RouteInfo): MasterListRow {
  const { route, prices, trend } = routeInfo;
  return {
    id: route.id,
    kind: "manual",
    ticketType: route.return_date ? "round-trip" : "one-way",
    // Manual routes have no separate "name" field — using origin→destination
    // here would just duplicate the .master-item-codes line below it, so
    // show the flight date instead (new, non-redundant info).
    title: `Bay ${flightDateLabel(route)}`,
    originCode: route.origin,
    destinationCode: route.destination,
    bestPrice: prices[0]?.price ?? null,
    trend: trend.trend,
    departureTime: prices[0]?.departure_time ?? null,
    route,
  };
}

export function tripLengthDays(route: RouteDoc): number | null {
  if (!route.flight_date || !route.return_date) return null;
  const ms = Date.parse(route.return_date) - Date.parse(route.flight_date);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86_400_000);
}

export function formatPrice(price: number): string {
  return `${price.toLocaleString("vi-VN")}đ`;
}

export function buildEventRow(event: EventDoc, routeInfos: RouteInfo[]): MasterListRow {
  const best = cheapestRouteInfo(routeInfos);
  const anyRoundTrip = routeInfos.some((ri) => ri.route.return_date);
  return {
    id: event.id,
    kind: "event",
    ticketType: anyRoundTrip ? "round-trip" : "one-way",
    title: event.event_name,
    originCode: event.origin,
    destinationCode: event.destination ?? routeInfos[0]?.route.destination ?? "?",
    bestPrice: best?.prices[0]?.price ?? null,
    trend: best?.trend.trend ?? null,
    departureTime: best?.prices[0]?.departure_time ?? null,
    aiStatus: event.ai_status,
    event,
  };
}
