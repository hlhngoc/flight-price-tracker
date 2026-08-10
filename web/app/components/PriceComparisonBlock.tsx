import { formatPrice } from "@/lib/dashboardView";
import type { PriceRecord } from "@/lib/types";

// Round-trip PriceRecord.price is always the combined total (see
// flight_tracker/route_tracking.py) — there's no separate outbound/return
// price to show, so this renders once per route, not once per leg.
const PRICE_SOURCE_LABEL: Record<string, string> = {
  bundle: "Giá khứ hồi 1 vé (đã xác minh qua SerpApi)",
  combined: "Tổng 2 chặng mua riêng (chưa chắc rẻ hơn vé khứ hồi 1 vé)",
};

export default function PriceComparisonBlock({
  prices,
  trend,
  isRoundTrip,
}: {
  prices: PriceRecord[];
  trend: "up" | "down" | null;
  isRoundTrip: boolean;
}) {
  if (prices.length === 0) {
    return <p className="subtext">Chưa có dữ liệu giá.</p>;
  }
  const [first, second] = prices;
  const warnSecond = !!second && second.price > first.price * 1.3;
  const sourceLabel = isRoundTrip ? PRICE_SOURCE_LABEL[first.price_source ?? ""] : undefined;

  return (
    <div className="price-comparison-block">
      {isRoundTrip && <div className="subtext price-source-label">{sourceLabel ?? "Tổng giá khứ hồi"}</div>}
      <div className="price-row primary">
        <span className="price-row-left">
          <span className="price-row-label">1st</span>
          <span className="price-row-airline">{first.airline ?? "?"}</span>
        </span>
        <span className="price-row-price">
          {formatPrice(first.price)}
          {trend && (
            <span className={`trend-icon trend-${trend}`} aria-label={trend === "down" ? "giá giảm" : "giá tăng"}>
              {trend === "down" ? "↓" : "↑"}
            </span>
          )}
        </span>
      </div>
      {second && (
        <>
          <div className="price-row-sep" />
          <div className="price-row">
            <span className="price-row-left">
              <span className="price-row-label">2nd</span>
              <span className="price-row-airline">{second.airline ?? "?"}</span>
            </span>
            <span className="price-row-price">
              {formatPrice(second.price)}
              {warnSecond && (
                <span className="price-warning-icon" title="Cao hơn hơn 30% so với lựa chọn rẻ nhất">
                  ⚠
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
