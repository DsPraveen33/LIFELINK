import { createInsertSchema } from "drizzle-zod";
import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { emergenciesTable } from "./emergencies";
import { hospitalsTable } from "./hospitals";

export const hospitalPreAlertsTable = pgTable("lifelink_hospital_prealerts", {
  id: serial("id").primaryKey(),
  emergencyId: integer("emergency_id").notNull().references(() => emergenciesTable.id, { onDelete: "cascade" }),
  ambulanceId: integer("ambulance_id").notNull(),
  hospitalId: integer("hospital_id").notNull().references(() => hospitalsTable.id, { onDelete: "cascade" }),
  severity: text("severity").notNull(),
  requirements: text("requirements").array().notNull(),
  etaMinutes: integer("eta_minutes").notNull(),
  status: text("status").notNull().default("SENT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHospitalPreAlertSchema = createInsertSchema(hospitalPreAlertsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHospitalPreAlert = z.infer<typeof insertHospitalPreAlertSchema>;
export type HospitalPreAlertRecord = typeof hospitalPreAlertsTable.$inferSelect;
