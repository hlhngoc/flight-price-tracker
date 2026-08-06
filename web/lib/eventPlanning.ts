// Shared by POST /api/events (create) and the replan branch of
// PATCH /api/events/[id] (edit) — the part of the flow that runs the AI and
// turns its output into tracked routes. Callers must already hold the
// planning claim (see claimEventForPlanning in lib/firestore.ts) before
// calling this — it does not claim on its own, so it never leaves an event
// stuck "processing" from a branch that forgot to resolve the status: every
// return path here writes a final ai_status first.
import { AIQuotaExceededError, AIReasoningError, generateEventSlots } from "./gemini";
import { addRoute, findMatchingRoute, setEventAiStatus } from "./firestore";
import { triggerPriceCheckWorkflow } from "./githubActions";
import type { EventDoc } from "./types";

interface CreatedRoute {
  id: string;
  flight_date: string;
  preferred_time_window: string;
  ai_reasoning: string;
}

export type PlanEventRoutesResult =
  | { kind: "success"; createdRoutes: CreatedRoute[]; duplicateSlots: number; totalSlots: number }
  | { kind: "pending"; message: string }
  | { kind: "error"; message: string };

export async function planEventRoutes(event: EventDoc): Promise<PlanEventRoutesResult> {
  try {
    if (!event.destination) {
      // Shouldn't happen — both the create and edit flows resolve a
      // destination code before ever getting here — but the stored field is
      // nullable, so guard rather than silently querying with "".
      await setEventAiStatus(event.id, "error");
      return { kind: "error", message: "Event thiếu điểm đến." };
    }
    const destination = event.destination;

    let slots;
    try {
      slots = await generateEventSlots(event);
    } catch (err) {
      if (err instanceof AIQuotaExceededError) {
        await setEventAiStatus(event.id, "pending");
        return {
          kind: "pending",
          message:
            "Hệ thống đang bận (Gemini đã hết quota miễn phí hôm nay). Thông tin chuyến bay sẽ tự động " +
            "được điền khi quota được khôi phục, không cần làm gì thêm.",
        };
      }
      await setEventAiStatus(event.id, "error");
      const message = err instanceof AIReasoningError ? err.message : "AI reasoning failed";
      return { kind: "error", message };
    }

    const createdRoutes: CreatedRoute[] = [];
    let duplicateSlots = 0;
    for (const slot of slots) {
      // AI-picked event slots are always one-way at creation time (see plan
      // scope) — return_date can only be added afterward via edit-route.
      const existing = await findMatchingRoute(event.origin, destination, slot.flight_date, null);
      if (existing) {
        duplicateSlots++;
        continue;
      }
      const routeId = await addRoute({
        origin: event.origin,
        destination,
        flight_date: slot.flight_date,
        preferred_time_window: slot.preferred_time_window,
        event_id: event.id,
        ai_reasoning: slot.reasoning,
      });
      createdRoutes.push({
        id: routeId,
        flight_date: slot.flight_date,
        preferred_time_window: slot.preferred_time_window,
        ai_reasoning: slot.reasoning,
      });
    }

    await setEventAiStatus(event.id, "done");

    // Fire-and-forget: kick off an immediate, scoped price check for the
    // routes just created instead of waiting for the next scheduled cron run.
    await triggerPriceCheckWorkflow(createdRoutes.map((r) => r.id));

    return { kind: "success", createdRoutes, duplicateSlots, totalSlots: slots.length };
  } catch (err) {
    // Anything unexpected past this point (e.g. a Firestore write failure)
    // — revert to "pending" so the daily retry cron can pick this event
    // back up instead of leaving it stuck "processing" forever.
    await setEventAiStatus(event.id, "pending").catch(() => {});
    throw err;
  }
}
