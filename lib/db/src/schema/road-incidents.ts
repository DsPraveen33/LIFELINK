import { createInsertSchema } from "drizzle-zod";
import { doublePrecision, pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const roadIncidentsTable = pgTable("lifelink_road_incidents", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  roadName: text("road_name").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const insertRoadIncidentSchema = createInsertSchema(roadIncidentsTable).omit({ id: true, createdAt: true });
export type InsertRoadIncident = z.infer<typeof insertRoadIncidentSchema>;
export type RoadIncidentRecord = typeof roadIncidentsTable.$inferSelect;
