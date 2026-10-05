import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const hospitalsTable = pgTable("lifelink_hospitals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  readinessStatus: text("readiness_status").notNull().default("READY"),
  emergencyStatus: text("emergency_status").notNull().default("ACCEPTING"),
  traumaBeds: integer("trauma_beds").notNull().default(0),
  icuBeds: integer("icu_beds").notNull().default(0),
  ventilators: integer("ventilators").notNull().default(0),
  capabilities: text("capabilities").array().notNull().default(sql`ARRAY[]::text[]`),
  waitMinutes: integer("wait_minutes").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHospitalSchema = createInsertSchema(hospitalsTable).omit({ id: true, updatedAt: true });
export type InsertHospital = z.infer<typeof insertHospitalSchema>;
export type HospitalRecord = typeof hospitalsTable.$inferSelect;
