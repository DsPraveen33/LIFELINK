import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { emergenciesTable } from "./emergencies";

export const eventsTable = pgTable("lifelink_events", {
  id: serial("id").primaryKey(),
  emergencyId: integer("emergency_id").references(() => emergenciesTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type EventRecord = typeof eventsTable.$inferSelect;
