import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { emergenciesTable } from "./emergencies";

export const decisionsTable = pgTable("lifelink_decisions", {
  id: serial("id").primaryKey(),
  emergencyId: integer("emergency_id").notNull().references(() => emergenciesTable.id, { onDelete: "cascade" }),
  selectedRouteId: integer("selected_route_id"),
  selectedHospitalId: integer("selected_hospital_id"),
  confidence: integer("confidence").notNull().default(0),
  reasons: text("reasons").array().notNull().default(sql`ARRAY[]::text[]`),
  warnings: text("warnings").array().notNull().default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDecisionSchema = createInsertSchema(decisionsTable).omit({ id: true, updatedAt: true });
export type InsertDecision = z.infer<typeof insertDecisionSchema>;
export type DecisionRecord = typeof decisionsTable.$inferSelect;
