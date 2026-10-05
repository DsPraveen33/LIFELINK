import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { doublePrecision, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const ambulancesTable = pgTable("lifelink_ambulances", {
  id: serial("id").primaryKey(),
  callSign: text("call_sign").notNull().unique(),
  vehicleNumber: text("vehicle_number").notNull(),
  driverName: text("driver_name").notNull(),
  driverUserId: integer("driver_user_id"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  speedKph: doublePrecision("speed_kph").notNull().default(0),
  heading: doublePrecision("heading").notNull().default(0),
  status: text("status").notNull().default("AVAILABLE"),
  equipment: text("equipment").array().notNull().default(sql`ARRAY[]::text[]`),
  currentEmergencyId: integer("current_emergency_id"),
  destinationHospitalId: integer("destination_hospital_id"),
  etaMinutes: integer("eta_minutes"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAmbulanceSchema = createInsertSchema(ambulancesTable).omit({ id: true, lastUpdated: true });
export type InsertAmbulance = z.infer<typeof insertAmbulanceSchema>;
export type AmbulanceRecord = typeof ambulancesTable.$inferSelect;
