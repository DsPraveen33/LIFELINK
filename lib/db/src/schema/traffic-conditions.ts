import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const trafficConditionsTable = pgTable("lifelink_traffic_conditions", {
  id: serial("id").primaryKey(),
  roadSegment: text("road_segment").notNull(),
  speedKph: integer("speed_kph").notNull(),
  expectedSpeedKph: integer("expected_speed_kph").notNull(),
  congestionLevel: text("congestion_level").notNull(),
  trend: text("trend").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrafficConditionSchema = createInsertSchema(trafficConditionsTable).omit({ id: true, updatedAt: true });
export type InsertTrafficCondition = z.infer<typeof insertTrafficConditionSchema>;
export type TrafficConditionRecord = typeof trafficConditionsTable.$inferSelect;
