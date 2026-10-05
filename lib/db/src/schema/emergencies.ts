import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { integer, doublePrecision, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const emergenciesTable = pgTable("lifelink_emergencies", {
  id: serial("id").primaryKey(),
  patientUserId: integer("patient_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  emergencyType: text("emergency_type").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("NEW"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  locationLabel: text("location_label").notNull(),
  requiredCapabilities: text("required_capabilities").array().notNull().default(sql`ARRAY[]::text[]`),
  assignedAmbulanceId: integer("assigned_ambulance_id"),
  selectedHospitalId: integer("selected_hospital_id"),
  etaMinutes: integer("eta_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmergencySchema = createInsertSchema(emergenciesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmergency = z.infer<typeof insertEmergencySchema>;
export type EmergencyRecord = typeof emergenciesTable.$inferSelect;
