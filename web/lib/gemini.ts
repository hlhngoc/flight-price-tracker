// Port of flight_tracker/ai_reasoning.py's generate_event_slots. The AI is
// called exactly once, when an event is created via /api/events — the
// resulting slots get inserted as tracked routes and are never re-scored
// by the AI again (see route_tracking.py on the Python side).
import type { EventDoc, EventSlot } from "./types";

const MAX_TOKENS = 4096;
export const MAX_SLOTS_PER_EVENT = 5;

function systemPrompt(maxSlots: number): string {
  return `Bạn là trợ lý chọn lịch bay cho một sự kiện. Dựa trên thông tin
sự kiện, hãy chọn ra tối đa ${maxSlots} slot bay ứng viên hợp lý (ngày bay + khung
giờ), có tính đến buffer thời gian an toàn trước sự kiện (tránh bay sát giờ, rủi ro
delay) và trade-off ở thêm đêm nếu bay sớm hơn để có giá tốt hơn. Ngày bay phải nằm
trong khoảng từ (ngày sự kiện - độ linh hoạt) đến ngày sự kiện.

Chỉ trả về JSON theo đúng schema sau, không thêm text nào khác:
{"slots": [{"flight_date": "YYYY-MM-DD", "preferred_time_window": "mô tả ngắn khung giờ",
"reasoning": "lý do ngắn gọn chọn slot này"}]}`;
}

export class AIReasoningError extends Error {}

function vnDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
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

export async function generateEventSlots(event: EventDoc): Promise<EventSlot[]> {
  const eventDatetime = new Date(event.event_datetime);
  const eventDateStr = vnDateString(eventDatetime);
  const eventDateOnlyUtcMs = new Date(`${eventDateStr}T00:00:00Z`).getTime();
  const earliestDateStr = new Date(eventDateOnlyUtcMs - event.flexibility_days * 86400000)
    .toISOString()
    .slice(0, 10);

  const userPrompt = `Tên sự kiện: ${event.event_name}
Thời gian sự kiện: ${vnDateTimeString(eventDatetime)}
Địa điểm: ${event.location}
Điểm đi: ${event.origin}
Độ linh hoạt: ${event.flexibility_days} ngày trước sự kiện`;

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
    const flightDate = record.flight_date;
    if (typeof flightDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate)) continue;
    if (!(flightDate >= earliestDateStr && flightDate <= eventDateStr)) continue;

    slots.push({
      flight_date: flightDate,
      preferred_time_window: typeof record.preferred_time_window === "string" ? record.preferred_time_window : "",
      reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
    });
    if (slots.length >= MAX_SLOTS_PER_EVENT) break;
  }

  return slots;
}
