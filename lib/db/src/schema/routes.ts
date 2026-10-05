import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, pgTable, serial, text, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { emergenciesTable } from "./emergencies";

export type RoutePoint = [number, number];

export const routesTable = pgTable("lifelink_routes", {
  id: serial("id").primaryKey(),
  emergencyId: integer("emergency_id").notNull().references(() => emergenciesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  distanceKm: doublePrecision("distance_km").notNull(),
  etaMinutes: integer("eta_minutes").notNull(),
  predictedEtaMinutes: integer("predicted_eta_minutes").notNull(),
  trafficLevel: text("traffic_level").notNull(),
  riskLevel: text("risk_level").notNull(),
  status: text("status").notNull(),
  points: jsonb("points").$type<RoutePoint[]>().notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRouteSchema = createInsertSchema(routesTable).omit({ id: true, createdAt: true });
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type RouteRecord = typeof routesTable.$inferSelect;
