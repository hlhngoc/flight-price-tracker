import { cityNameForCode } from "@/lib/airports";
import { formatTime } from "@/lib/dateFormat";

export default function FlightLegCard({
  tag,
  originCode,
  destinationCode,
  departureTime,
}: {
  tag: "OUTBOUND" | "RETURN";
  originCode: string;
  destinationCode: string;
  departureTime: string | null;
}) {
  const originCity = cityNameForCode(originCode);
  const destCity = cityNameForCode(destinationCode);
  return (
    <div className="leg-card">
      <span className="leg-tag">{tag === "OUTBOUND" ? "Chiều đi" : "Chiều về"}</span>
      <div className="leg-codes">
        {originCode} → {destinationCode}
      </div>
      {(originCity || destCity) && (
        <div className="leg-city">
          {originCity ?? originCode} → {destCity ?? destinationCode}
        </div>
      )}
      {departureTime && <div className="leg-time">Giờ bay {formatTime(departureTime)}</div>}
    </div>
  );
}
