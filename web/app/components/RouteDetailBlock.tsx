import { formatDmy } from "@/lib/dateFormat";
import type { RouteInfo } from "@/lib/dashboardView";
import FlightLegCard from "./FlightLegCard";
import PriceComparisonBlock from "./PriceComparisonBlock";

const STATUS_LABEL_VI: Record<string, string> = {
  tracking: "Đang theo dõi",
  booked: "Đã đặt",
  expired: "Hết hạn",
};

// One route's full stepper: leg card(s) + one combined price comparison
// block. showDateHeader is on for event groups with multiple candidate
// routes, so the user can tell which candidate each block belongs to.
export default function RouteDetailBlock({ routeInfo, showDateHeader }: { routeInfo: RouteInfo; showDateHeader: boolean }) {
  const { route, prices, trend } = routeInfo;
  const isRoundTrip = !!route.return_date;
  const outboundPrice = prices[0];

  return (
    <div className="route-detail-block">
      {showDateHeader && (
        <div className="route-detail-header">
          <span className="route-detail-date">
            Bay {formatDmy(route.flight_date)}
            {isRoundTrip && ` — về ${formatDmy(route.return_date)}`}
          </span>
          <span className={`status status-${route.status}`}>{STATUS_LABEL_VI[route.status] ?? route.status}</span>
        </div>
      )}
      {route.ai_reasoning && <p className="subtext route-detail-reasoning">{route.ai_reasoning}</p>}

      <FlightLegCard
        tag="OUTBOUND"
        originCode={route.origin}
        destinationCode={route.destination}
        departureTime={outboundPrice?.departure_time ?? null}
      />
      {isRoundTrip && (
        <>
          <div className="stepper-connector" />
          <FlightLegCard
            tag="RETURN"
            originCode={route.destination}
            destinationCode={route.origin}
            departureTime={outboundPrice?.return_departure_time ?? null}
          />
        </>
      )}

      <div className="price-comparison-spacer" />
      <PriceComparisonBlock prices={prices} trend={trend.trend} isRoundTrip={isRoundTrip} />
    </div>
  );
}
