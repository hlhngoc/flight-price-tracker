import { formatPrice } from "@/lib/dashboardView";
import ActionBar, { type ActionBarProps } from "./ActionBar";

export interface DetailHeaderProps {
  title: string;
  // "route-codes": title is the route's origin→destination codes (manual
  // route selection) — styled per spec's "Flight leg block" (28px/700).
  // "event": title is the event's human-chosen name — spec's "Event title
  // header" (20px/600), the default.
  titleVariant?: "event" | "route-codes";
  ticketType: "one-way" | "round-trip";
  flightDateLabel: string | null;
  tripLengthDays: number | null;
  aiStatusLabel: string | null;
  combo: { price: number; outboundAirline: string | null; returnAirline: string | null } | null;
  actionBarProps: ActionBarProps;
}

export default function DetailHeader({
  title,
  titleVariant = "event",
  ticketType,
  flightDateLabel,
  tripLengthDays,
  aiStatusLabel,
  combo,
  actionBarProps,
}: DetailHeaderProps) {
  return (
    <div className="detail-header">
      <div className="detail-header-top">
        <h1 className={titleVariant === "route-codes" ? "detail-title detail-title-codes" : "detail-title"}>
          {title}
        </h1>
        <ActionBar {...actionBarProps} />
      </div>

      <div className="detail-meta">
        {flightDateLabel && <span>Ngày bay dự kiến: {flightDateLabel}</span>}
        {ticketType === "round-trip" && tripLengthDays !== null && <span>{tripLengthDays} ngày</span>}
        {aiStatusLabel && <span className="status status-pending">{aiStatusLabel}</span>}
      </div>

      {combo && (
        <div className="combo-highlight">
          Combo rẻ nhất: <strong>{formatPrice(combo.price)}</strong>
          {combo.outboundAirline && (
            <span className="subtext">
              {" "}
              ({combo.outboundAirline}
              {combo.returnAirline && combo.returnAirline !== combo.outboundAirline ? ` đi + ${combo.returnAirline} về` : ""})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
