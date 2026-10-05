import { createInsertSchema } from "drizzle-zod";
import { doublePrecision, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { ambulancesTable } from "./ambulances";

export const locationHistoryTable = pgTable("lifelink_ambulance_locations", {
  id: serial("id").primaryKey(),
  ambulanceId: integer("ambulance_id").notNull().references(() => ambulancesTable.id, { onDelete: "cascade" }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  speedKph: doublePrecision("speed_kph").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLocationHistorySchema = createInsertSchema(locationHistoryTable).omit({ id: true, timestamp: true });
export type InsertLocationHistory = z.infer<typeof insertLocationHistorySchema>;
export type LocationHistoryRecord = typeof locationHistoryTable.$inferSelect;
