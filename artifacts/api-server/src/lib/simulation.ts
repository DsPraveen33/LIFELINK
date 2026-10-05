import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  ambulancesTable,
  decisionsTable,
  emergenciesTable,
  eventsTable,
  hospitalPreAlertsTable,
  hospitalsTable,
  locationHistoryTable,
  roadIncidentsTable,
  routesTable,
  trafficConditionsTable,
} from "@workspace/db";
import type { LifelinkEvent, SimulationActionInput, SimulationResult } from "./api-types";
import { createEmergencyAndDispatch } from "./dispatch";
import { recalculateDecision } from "./decision-engine";
import { recordEvent } from "./domain-events";
import { seedLifelinkData } from "./seed";

const INITIAL_AMBULANCE_LOCATIONS = [
  { callSign: "AMB-01", latitude: 12.9717, longitude: 77.601 },
  { callSign: "AMB-02", latitude: 12.9698, longitude: 77.6041 },
  { callSign: "AMB-03", latitude: 12.9827, longitude: 77.611 },
  { callSign: "AMB-04", latitude: 12.9554, longitude: 77.615 },
  { callSign: "AMB-05", latitude: 12.988, longitude: 77.594 },
];

function eventToApi(event: typeof eventsTable.$inferSelect): LifelinkEvent {
  return {
    id: event.id,
    emergencyId: event.emergencyId,
    type: event.type,
    message: event.message,
    createdAt: event.createdAt.toISOString(),
  };
}

async function latestEvents(): Promise<LifelinkEvent[]> {
  const rows = await db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt)).limit(30);
  return rows.map(eventToApi);
}

async function clearOperationalData(): Promise<void> {
  await db.delete(routesTable);
  await db.delete(decisionsTable);
  await db.delete(eventsTable);
  await db.delete(hospitalPreAlertsTable);
  await db.delete(locationHistoryTable);
  await db.delete(emergenciesTable);
  await db.delete(roadIncidentsTable);
  await db.delete(trafficConditionsTable);

  for (const [name, readinessStatus, emergencyStatus, traumaBeds, icuBeds, ventilators, waitMinutes] of [
    ["City Trauma Center A", "FULL", "DIVERTING", 0, 0, 0, 42],
    ["City Trauma Center B", "READY", "ACCEPTING", 4, 3, 2, 8],
    ["Metro Care Hospital C", "READY", "ACCEPTING", 3, 2, 2, 12],
    ["St. Martha's Medical Center D", "BUSY", "LIMITED", 1, 1, 1, 24],
    ["Eastside General Hospital E", "READY", "ACCEPTING", 2, 2, 1, 16],
  ] as const) {
    await db
      .update(hospitalsTable)
      .set({
        readinessStatus,
        emergencyStatus,
        traumaBeds,
        icuBeds,
        ventilators,
        waitMinutes,
        updatedAt: new Date(),
      })
      .where(eq(hospitalsTable.name, name));
  }

  for (const location of INITIAL_AMBULANCE_LOCATIONS) {
    await db
      .update(ambulancesTable)
      .set({
        latitude: location.latitude,
        longitude: location.longitude,
        speedKph: 0,
        heading: 0,
        status: "AVAILABLE",
        currentEmergencyId: null,
        destinationHospitalId: null,
        etaMinutes: null,
        lastUpdated: new Date(),
      })
      .where(eq(ambulancesTable.callSign, location.callSign));
  }
}

export async function resetSimulation(): Promise<SimulationResult> {
  await clearOperationalData();
  await seedLifelinkData();
  const [firstEmergency] = await db
    .select({ id: emergenciesTable.id })
    .from(emergenciesTable)
    .where(inArray(emergenciesTable.status, ["EN_ROUTE", "DISPATCHED", "ACCEPTED", "TRANSPORTING"]))
    .limit(1);
  const events = await latestEvents();
  return {
    message: "Demo data reset. Sample emergencies, traffic and hospital readiness are restored.",
    emergencyId: firstEmergency?.id ?? null,
    events,
  };
}

async function setHospitalFull(hospitalName: string, emergencyId?: number): Promise<void> {
  await db
    .update(hospitalsTable)
    .set({
      readinessStatus: "FULL",
      emergencyStatus: "DIVERTING",
      traumaBeds: 0,
      icuBeds: 0,
      ventilators: 0,
      updatedAt: new Date(),
    })
    .where(eq(hospitalsTable.name, hospitalName));
  await recordEvent("HOSPITAL_STATUS_CHANGED", `${hospitalName} is full and diverting new arrivals.`, emergencyId ?? null);
  if (emergencyId) {
    await recalculateDecision(emergencyId, { emitEvent: true });
    await recordEvent("HOSPITAL_SWITCHED", "Receiving hospital updated after readiness changed.", emergencyId);
  }
}

async function addRouteAAccident(emergencyId?: number): Promise<void> {
  await db.insert(roadIncidentsTable).values({
    type: "ROUTE_A_ACCIDENT",
    latitude: 12.9782,
    longitude: 77.6104,
    roadName: "Route A access road",
    severity: "CRITICAL",
    description: "New accident blocks the selected response corridor.",
    active: true,
  });
  await recordEvent("ACCIDENT_DETECTED", "Accident detected on Route A. Recalculating the route.", emergencyId ?? null);
  if (emergencyId) {
    await recalculateDecision(emergencyId, { emitEvent: true });
    await recordEvent("REROUTE_TRIGGERED", "Route A is blocked; the best open alternative has been selected.", emergencyId);
  }
}

async function activeEmergency(emergencyId?: number) {
  const rows = emergencyId
    ? await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, emergencyId)).limit(1)
    : await db
        .select()
        .from(emergenciesTable)
        .where(inArray(emergenciesTable.status, ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"]))
        .orderBy(desc(emergenciesTable.createdAt))
        .limit(1);
  return rows[0];
}

export async function performSimulationAction(
  input: SimulationActionInput,
  patientUserId: number | null,
): Promise<SimulationResult> {
  let emergency = await activeEmergency(input.emergencyId ?? undefined);
  switch (input.action) {
    case "CREATE_EMERGENCY": {
      const created = await createEmergencyAndDispatch(
        {
          patientName: "Demo Patient",
          emergencyType: "Critical Road Accident",
          severity: "CRITICAL",
          latitude: 12.9756,
          longitude: 77.6066,
          locationLabel: "DEMO • M.G. Road, Central Bengaluru",
          requiredCapabilities: ["TRAUMA", "ICU"],
        },
        patientUserId,
      );
      emergency = created;
      break;
    }
    case "DISPATCH_AMBULANCE":
    case "START_JOURNEY": {
      if (!emergency) break;
      await db
        .update(emergenciesTable)
        .set({ status: "EN_ROUTE", updatedAt: new Date() })
        .where(eq(emergenciesTable.id, emergency.id));
      if (emergency.assignedAmbulanceId) {
        await db
          .update(ambulancesTable)
          .set({ status: "EN_ROUTE", lastUpdated: new Date() })
          .where(eq(ambulancesTable.id, emergency.assignedAmbulanceId));
      }
      await recordEvent("JOURNEY_STARTED", "Driver accepted dispatch and is en route to the patient.", emergency.id);
      break;
    }
    case "INJECT_TRAFFIC": {
      await db.insert(trafficConditionsTable).values({
        roadSegment: "Route A",
        speedKph: 8,
        expectedSpeedKph: 40,
        congestionLevel: "HEAVY",
        trend: "WORSENING",
      });
      await recordEvent("TRAFFIC_UPDATED", "Heavy traffic injected on Route A.", emergency?.id ?? null);
      if (emergency) await recalculateDecision(emergency.id, { emitEvent: true });
      break;
    }
    case "ACCIDENT_ON_ROUTE_A":
    case "BLOCK_ROAD": {
      await addRouteAAccident(emergency?.id);
      break;
    }
    case "HOSPITAL_B_FULL": {
      await setHospitalFull("City Trauma Center B", emergency?.id);
      break;
    }
    case "HOSPITAL_C_READY": {
      await db
        .update(hospitalsTable)
        .set({
          readinessStatus: "READY",
          emergencyStatus: "ACCEPTING",
          traumaBeds: 3,
          icuBeds: 2,
          ventilators: 2,
          updatedAt: new Date(),
        })
        .where(eq(hospitalsTable.name, "Metro Care Hospital C"));
      await recordEvent("HOSPITAL_STATUS_CHANGED", "Metro Care Hospital C is ready to receive patients.", emergency?.id ?? null);
      if (emergency) await recalculateDecision(emergency.id, { emitEvent: true });
      break;
    }
    case "ARRIVE_AT_HOSPITAL": {
      if (!emergency?.assignedAmbulanceId) break;
      await db
        .update(emergenciesTable)
        .set({ status: "COMPLETED", etaMinutes: 0, updatedAt: new Date() })
        .where(eq(emergenciesTable.id, emergency.id));
      await db
        .update(ambulancesTable)
        .set({
          status: "AVAILABLE",
          currentEmergencyId: null,
          destinationHospitalId: null,
          etaMinutes: null,
          lastUpdated: new Date(),
        })
        .where(eq(ambulancesTable.id, emergency.assignedAmbulanceId));
      await recordEvent("EMERGENCY_COMPLETED", "Hospital handoff complete. Emergency closed.", emergency.id);
      break;
    }
  }
  const events = await latestEvents();
  return {
    message: `${input.action.replaceAll("_", " ")} completed using the LIFELINK simulation engine.`,
    emergencyId: emergency?.id ?? null,
    events,
  };
}

export async function runFullDemo(patientUserId: number | null): Promise<SimulationResult> {
  await clearOperationalData();
  await seedLifelinkData();

  await db.delete(routesTable);
  await db.delete(decisionsTable);
  await db.delete(eventsTable);
  await db.delete(hospitalPreAlertsTable);
  await db.delete(emergenciesTable);
  for (const location of INITIAL_AMBULANCE_LOCATIONS) {
    await db
      .update(ambulancesTable)
      .set({
        latitude: location.latitude,
        longitude: location.longitude,
        status: "AVAILABLE",
        currentEmergencyId: null,
        destinationHospitalId: null,
        etaMinutes: null,
        lastUpdated: new Date(),
      })
      .where(eq(ambulancesTable.callSign, location.callSign));
  }

  const [ambulance] = await db
    .select()
    .from(ambulancesTable)
    .where(eq(ambulancesTable.callSign, "AMB-02"))
    .limit(1);
  const [hospitalA] = await db
    .select()
    .from(hospitalsTable)
    .where(eq(hospitalsTable.name, "City Trauma Center A"))
    .limit(1);
  const [hospitalB] = await db
    .select()
    .from(hospitalsTable)
    .where(eq(hospitalsTable.name, "City Trauma Center B"))
    .limit(1);

  if (!ambulance || !hospitalA || !hospitalB) {
    throw new Error("Demo prerequisites were not seeded.");
  }

  await db
    .update(hospitalsTable)
    .set({
      readinessStatus: "FULL",
      emergencyStatus: "DIVERTING",
      traumaBeds: 0,
      icuBeds: 0,
      ventilators: 0,
      updatedAt: new Date(),
    })
    .where(eq(hospitalsTable.id, hospitalA.id));
  await db
    .update(hospitalsTable)
    .set({
      readinessStatus: "READY",
      emergencyStatus: "ACCEPTING",
      traumaBeds: 4,
      icuBeds: 3,
      ventilators: 2,
      updatedAt: new Date(),
    })
    .where(eq(hospitalsTable.id, hospitalB.id));

  const [demoEmergency] = await db
    .insert(emergenciesTable)
    .values({
      patientUserId,
      patientName: "Demo Patient",
      emergencyType: "Critical Road Accident",
      severity: "CRITICAL",
      status: "TRANSPORTING",
      latitude: 12.9756,
      longitude: 77.6066,
      locationLabel: "DEMO • M.G. Road, Central Bengaluru",
      requiredCapabilities: ["TRAUMA", "ICU"],
      assignedAmbulanceId: ambulance.id,
      selectedHospitalId: hospitalB.id,
      etaMinutes: 12,
    })
    .returning();
  if (!demoEmergency) throw new Error("Could not create the demo emergency.");
  await db
    .update(ambulancesTable)
    .set({
      status: "TRANSPORTING",
      currentEmergencyId: demoEmergency.id,
      destinationHospitalId: hospitalB.id,
      etaMinutes: 12,
      lastUpdated: new Date(),
    })
    .where(eq(ambulancesTable.id, ambulance.id));

  await recordEvent("SOS_RECEIVED", "Critical road accident SOS received.", demoEmergency.id);
  await recordEvent("AMBULANCE_ASSIGNED", "AMB-02 assigned to the demo emergency.", demoEmergency.id);
  await recordEvent("ROUTE_SELECTED", "Route A selected: 12 min, 2.4 km.", demoEmergency.id);
  await recordEvent("HOSPITAL_SELECTED", "City Trauma Center B selected; Center A is full.", demoEmergency.id);
  await recordEvent("TRANSPORT_STARTED", "Patient onboard. Transport to City Trauma Center B started.", demoEmergency.id);
  await recalculateDecision(demoEmergency.id, { preferredHospitalId: hospitalB.id, emitEvent: false });
  await addRouteAAccident(demoEmergency.id);
  await setHospitalFull("City Trauma Center B", demoEmergency.id);

  await recordEvent("DEMO_READY", "Demo scenario complete: Route B and Metro Care Hospital C are recommended.", demoEmergency.id);
  return {
    message: "Demo complete. Route A was blocked, routing switched to B, and the receiving hospital changed to Metro Care Hospital C.",
    emergencyId: demoEmergency.id,
    events: await latestEvents(),
  };
}
