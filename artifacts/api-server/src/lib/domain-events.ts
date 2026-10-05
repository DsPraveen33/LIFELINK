import { db, eventsTable } from "@workspace/db";
import { publishRealtimeChange } from "./realtime";

export async function recordEvent(
  type: string,
  message: string,
  emergencyId: number | null = null,
  metadata: Record<string, unknown> = {},
) {
  const [event] = await db.insert(eventsTable).values({ type, message, emergencyId, metadata }).returning();
  if (event) {
    publishRealtimeChange({
      type,
      emergencyId,
      occurredAt: event.createdAt.toISOString(),
    });
  }
  return event;
}
