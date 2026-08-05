// Port of flight_tracker/ai_reasoning.py's generate_event_slots. The AI is
// called exactly once, when an event is created via /api/events — the
// resulting slots get inserted as tracked routes and are never re-scored
// by the AI again (see route_tracking.py on the Python side).
import { TIME_WINDOW_PRESETS, parseTimeWindow } from "./timeWindows";
import type { EventDoc, EventSlot } from "./types";

const MAX_TOKENS = 4096;
export const MAX_SLOTS_PER_EVENT = 5;

// Minimum safe buffer between landing and the event start (travel time from
// airport + delay risk). If the event starts earlier in the day than this,
// flying the same calendar day is not feasible at all — the earliest allowed
// date needs to be pushed back a day so a late-night flight the day before
// is even in range. Mirrors flight_tracker/ai_reasoning.py's BUFFER_HOURS.
const BUFFER_HOURS = 4;

function systemPrompt(maxSlots: number): string {
  const windowPresets = TIME_WINDOW_PRESETS.map((w) => `- ${w}`).join("\n");
  return `Bạn là trợ lý chọn lịch bay cho một sự kiện. Dựa trên thông tin
sự kiện, hãy chọn ra tối đa ${maxSlots} slot bay ứng viên hợp lý (ngày bay + khung
giờ), có tính đến buffer thời gian an toàn trước sự kiện (tránh bay sát giờ, rủi ro
delay) và trade-off ở thêm đêm nếu bay sớm hơn để có giá tốt hơn. Ngày bay phải nằm
trong khoảng từ (ngày sự kiện - độ linh hoạt) đến ngày sự kiện.

"preferred_time_window" của mỗi slot PHẢI là đúng một trong các giá trị sau
(không tự bịa giá trị khác) — chọn khung giờ phù hợp nhất để có đủ buffer an
toàn trước sự kiện:
${windowPresets}

Chỉ trả về JSON theo đúng schema sau, không thêm text nào khác:
{"slots": [{"flight_date": "YYYY-MM-DD", "preferred_time_window": "<một trong các giá trị ở trên>",
"reasoning": "lý do ngắn gọn chọn slot này"}]}`;
}

export class AIReasoningError extends Error {}

// Gemini returned 429 (daily free-tier quota exhausted). Distinct from
// AIReasoningError so callers can leave the event "pending" for an
// automatic retry instead of treating it as a hard failure.
export class AIQuotaExceededError extends AIReasoningError {}

function vnDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
}

function vnHour(d: Date): number {
  const hourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  // Intl can render midnight as "24" with hour12: false.
  return Number(hourPart) % 24;
}

function vnDateTimeString(d: Date): string {
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${vnDateString(d)} ${timePart}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const ms = new Date(`${dateStr}T00:00:00Z`).getTime() + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function generateEventSlots(event: EventDoc): Promise<EventSlot[]> {
  const eventDatetime = new Date(event.event_datetime);
  const eventDateStr = vnDateString(eventDatetime);
  const eventHourVN = vnHour(eventDatetime);
  const eventDateOnlyUtcMs = new Date(`${eventDateStr}T00:00:00Z`).getTime();

  // If the event starts before BUFFER_HOURS o'clock, no same-day flight can
  // land with a safe buffer — extend the earliest allowed date back one
  // extra day so a prior-night flight is reachable even when
  // flexibility_days is 0.
  const needsPriorNight = eventHourVN < BUFFER_HOURS;
  const earliestDateStr = new Date(
    eventDateOnlyUtcMs - (event.flexibility_days + (needsPriorNight ? 1 : 0)) * 86400000
  )
    .toISOString()
    .slice(0, 10);

  const timeWindowLine = event.preferred_time_window
    ? `\nKhung giờ bay ưa thích: ${event.preferred_time_window} (ưu tiên chọn slot trong khung giờ này nếu vẫn đảm bảo đủ buffer an toàn)`
    : "";

  const userPrompt = `Tên sự kiện: ${event.event_name}
Thời gian sự kiện: ${vnDateTimeString(eventDatetime)}
Địa điểm: ${event.location}
Điểm đi: ${event.origin}
Độ linh hoạt: ${event.flexibility_days} ngày trước sự kiện${timeWindowLine}

LƯU Ý QUAN TRỌNG: Chuyến bay PHẢI đến nơi trước giờ sự kiện ít nhất
${BUFFER_HOURS} tiếng (buffer di chuyển + rủi ro delay). Nếu sự kiện diễn ra
vào giờ quá sớm trong ngày (trước ${BUFFER_HOURS}h sáng), bạn PHẢI chọn bay
vào đêm/khuya ngày hôm trước, không được chọn slot cùng ngày với giờ bay
sau hoặc quá sát giờ sự kiện.`;

  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(MAX_SLOTS_PER_EVENT) }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: MAX_TOKENS,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new AIQuotaExceededError(
        `Gemini API đã hết quota miễn phí trong ngày cho model "${model}" (giới hạn request/ngày). ` +
          "Hãy thử lại vào ngày mai, đổi sang model khác qua biến môi trường GEMINI_MODEL, hoặc bật billing cho project trên Google AI Studio."
      );
    }
    throw new AIReasoningError(`Gemini request failed: ${resp.status} ${await resp.text()}`);
  }

  let rawSlots: unknown[];
  try {
    const payload = await resp.json();
    const content: string = payload.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(content);
    rawSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
  } catch (err) {
    throw new AIReasoningError(`Gemini response parse failed: ${err}`);
  }

  const slots: EventSlot[] = [];
  for (const item of rawSlots) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const rawFlightDate = record.flight_date;
    if (typeof rawFlightDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawFlightDate)) continue;
    if (!(rawFlightDate >= earliestDateStr && rawFlightDate <= eventDateStr)) continue;
    let flightDate: string = rawFlightDate;

    let window = typeof record.preferred_time_window === "string" ? record.preferred_time_window : "";

    // The model sometimes still picks a same-day window that doesn't
    // actually leave BUFFER_HOURS before the event (e.g. event at 01:00
    // with window "Sáng sớm (00:00-06:00)"). Rather than dropping the slot
    // or failing the event outright, push it back to the previous night —
    // that's the obviously-intended fallback (e.g. a 01:00 event should
    // resolve to a late flight the evening before).
    if (flightDate === eventDateStr) {
      const latestAllowedHour = eventHourVN - BUFFER_HOURS;
      const parsedWindow = parseTimeWindow(window);
      // Unparseable window -> treat as worst case so it still gets pushed
      // back rather than silently passing through unchecked.
      const windowEndHour = parsedWindow ? parsedWindow[1] : 24;
      if (latestAllowedHour < 0 || windowEndHour > latestAllowedHour) {
        flightDate = addDaysToDateStr(flightDate, -1);
        window = TIME_WINDOW_PRESETS[TIME_WINDOW_PRESETS.length - 1]; // "Tối (18:00-24:00)"
      }
    }

    slots.push({
      flight_date: flightDate,
      preferred_time_window: window,
      reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
    });
    if (slots.length >= MAX_SLOTS_PER_EVENT) break;
  }

  return slots;
}
