import { cheapestRouteInfo, flightDateLabel, tripLengthDays, type SelectedDetail } from "@/lib/dashboardView";
import DetailHeader from "./DetailHeader";
import RouteDetailBlock from "./RouteDetailBlock";

const AI_STATUS_LABEL: Record<string, string> = {
  pending: "Đang quét vé (AI)",
  processing: "Đang quét vé (AI)",
  error: "Lỗi AI — cần thêm route thủ công",
};

export default function DetailPanel({ detail }: { detail: SelectedDetail }) {
  if (detail === null) {
    return <p className="empty">Chọn một mục ở danh sách bên trái để xem chi tiết.</p>;
  }

  if (detail.kind === "manual") {
    const { route, prices } = detail.routeInfo;
    const isRoundTrip = !!route.return_date;
    return (
      <div className="detail-fade" key={route.id}>
        <DetailHeader
          title={`${route.origin} → ${route.destination}`}
          titleVariant="route-codes"
          ticketType={isRoundTrip ? "round-trip" : "one-way"}
          flightDateLabel={flightDateLabel(route)}
          tripLengthDays={tripLengthDays(route)}
          aiStatusLabel={null}
          combo={
            isRoundTrip && prices[0]
              ? { price: prices[0].price, outboundAirline: prices[0].airline, returnAirline: prices[0].return_airline ?? null }
              : null
          }
          actionBarProps={{ kind: "route", route, eventName: null }}
        />
        <RouteDetailBlock routeInfo={detail.routeInfo} showDateHeader={false} />
      </div>
    );
  }

  const { event, routeInfos } = detail;
  const isRoundTrip = routeInfos.some((ri) => ri.route.return_date);
  const cheapest = cheapestRouteInfo(routeInfos);
  const statusLabel = event.ai_status !== "done" ? AI_STATUS_LABEL[event.ai_status] : null;

  return (
    <div className="detail-fade" key={event.id}>
      <DetailHeader
        title={event.event_name}
        ticketType={isRoundTrip ? "round-trip" : "one-way"}
        flightDateLabel={cheapest ? flightDateLabel(cheapest.route) : null}
        tripLengthDays={cheapest ? tripLengthDays(cheapest.route) : null}
        aiStatusLabel={statusLabel}
        combo={
          isRoundTrip && cheapest?.prices[0]
            ? {
                price: cheapest.prices[0].price,
                outboundAirline: cheapest.prices[0].airline,
                returnAirline: cheapest.prices[0].return_airline ?? null,
              }
            : null
        }
        actionBarProps={{ kind: "event", event }}
      />
      {routeInfos.length === 0 ? (
        <p className="subtext">
          {event.ai_status === "error"
            ? "AI chưa chọn được tuyến nào — hãy thêm route thủ công cho sự kiện này."
            : "AI đang lựa chọn tuyến phù hợp, quay lại sau."}
        </p>
      ) : (
        routeInfos.map((routeInfo) => <RouteDetailBlock key={routeInfo.route.id} routeInfo={routeInfo} showDateHeader />)
      )}
    </div>
  );
}
