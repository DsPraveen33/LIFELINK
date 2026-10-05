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
import { simulationConfig } from "../simulation/config";

const INITIAL_AMBULANCE_LOCATIONS = simulationConfig.demoAmbulances.map((amb) => ({
  callSign: amb.callSign,
  latitude: amb.latitude,
  longitude: amb.longitude,
}));

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

  for (const hospital of simulationConfig.demoHospitals) {
    await db
      .update(hospitalsTable)
      .set({
        readinessStatus: hospital.readinessStatus,
        emergencyStatus: hospital.emergencyStatus,
        traumaBeds: hospital.traumaBeds,
        icuBeds: hospital.icuBeds,
        ventilators: hospital.ventilators,
        waitMinutes: hospital.waitMinutes,
        updatedAt: new Date(),
      })
      .where(eq(hospitalsTable.name, hospital.name));
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
    message: "Tirupati demo simulation reset. Sample emergencies, traffic corridors, and hospital readiness restored.",
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
    type: "ACCIDENT",
    latitude: 13.635,
    longitude: 79.406,
    roadName: "Alipiri Bypass Road",
    severity: "CRITICAL",
    description: "New accident blocks the selected response corridor.",
    active: true,
  });
  await recordEvent("ACCIDENT_DETECTED", "Accident detected on Route A corridor in Tirupati. Recalculating route.", emergencyId ?? null);
  if (emergencyId) {
    await recalculateDecision(emergencyId, { emitEvent: true });
    await recordEvent("REROUTE_TRIGGERED", "Route A blocked; rerouting to best open alternative.", emergencyId);
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
  const emergency = await activeEmergency(input.emergencyId ?? undefined);
  switch (input.action) {
    case "CREATE_EMERGENCY": {
      const demo = simulationConfig.demoEmergencies[0];
      const created = await createEmergencyAndDispatch(
        {
          patientName: demo.patientName,
          emergencyType: demo.emergencyType,
          severity: demo.severity,
          latitude: demo.latitude,
          longitude: demo.longitude,
          locationLabel: demo.locationLabel,
          requiredCapabilities: demo.requiredCapabilities,
        },
        patientUserId ?? null,
      );
      const events = await latestEvents();
      return {
        message: "New SOS emergency created for Tirupati transit corridor.",
        emergencyId: created.id,
        events,
      };
    }
    case "DISPATCH_AMBULANCE": {
      if (!emergency) break;
      const [available] = await db
        .select()
        .from(ambulancesTable)
        .where(eq(ambulancesTable.status, "AVAILABLE"))
        .limit(1);
      if (available) {
        await db
          .update(ambulancesTable)
          .set({ status: "EN_ROUTE", currentEmergencyId: emergency.id, lastUpdated: new Date() })
          .where(eq(ambulancesTable.id, available.id));
        await db
          .update(emergenciesTable)
          .set({ assignedAmbulanceId: available.id, status: "DISPATCHED", updatedAt: new Date() })
          .where(eq(emergenciesTable.id, emergency.id));
        await recordEvent("AMBULANCE_DISPATCHED", `${available.callSign} assigned to emergency.`, emergency.id);
        await recalculateDecision(emergency.id, { emitEvent: true });
      }
      break;
    }
    case "START_JOURNEY": {
      if (!emergency?.assignedAmbulanceId) break;
      await db
        .update(ambulancesTable)
        .set({ status: "EN_ROUTE", lastUpdated: new Date() })
        .where(eq(ambulancesTable.id, emergency.assignedAmbulanceId));
      await db
        .update(emergenciesTable)
        .set({ status: "EN_ROUTE", updatedAt: new Date() })
        .where(eq(emergenciesTable.id, emergency.id));
      await recordEvent("JOURNEY_STARTED", "Ambulance en route to emergency scene.", emergency.id);
      break;
    }
    case "INJECT_TRAFFIC": {
      await db.insert(trafficConditionsTable).values({
        roadSegment: "Alipiri Bypass Road",
        speedKph: 15,
        expectedSpeedKph: 45,
        congestionLevel: "HEAVY",
        trend: "WORSENING",
      });
      await recordEvent("TRAFFIC_UPDATED", "Heavy pilgrim traffic reported on Alipiri corridor.", emergency?.id ?? null);
      if (emergency) await recalculateDecision(emergency.id, { emitEvent: true });
      break;
    }
    case "ACCIDENT_ON_ROUTE_A":
    case "BLOCK_ROAD": {
      await addRouteAAccident(emergency?.id);
      break;
    }
    case "HOSPITAL_B_FULL": {
      await setHospitalFull("SVRR Government General Hospital (Ruia)", emergency?.id);
      break;
    }
    case "HOSPITAL_C_READY": {
      await db
        .update(hospitalsTable)
        .set({
          readinessStatus: "READY",
          emergencyStatus: "ACCEPTING",
          traumaBeds: 5,
          icuBeds: 4,
          ventilators: 3,
          updatedAt: new Date(),
        })
        .where(eq(hospitalsTable.name, "Apollo Hospital Tirupati"));
      await recordEvent("HOSPITAL_STATUS_CHANGED", "Apollo Hospital Tirupati ready with cardiac specialty team.", emergency?.id ?? null);
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
      await recordEvent("EMERGENCY_COMPLETED", "Hospital triage handoff completed in Tirupati. Emergency closed.", emergency.id);
      break;
    }
  }
  const events = await latestEvents();
  return {
    message: `${input.action.replaceAll("_", " ")} executed successfully via LIFELINK simulation engine.`,
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
    .where(eq(ambulancesTable.callSign, "AMB-01"))
    .limit(1);
  const [svims] = await db
    .select()
    .from(hospitalsTable)
    .where(eq(hospitalsTable.name, "SVIMS Super Specialty Hospital"))
    .limit(1);
  const [ruia] = await db
    .select()
    .from(hospitalsTable)
    .where(eq(hospitalsTable.name, "SVRR Government General Hospital (Ruia)"))
    .limit(1);

  if (!ambulance || !svims || !ruia) {
    throw new Error("Demo prerequisites were not seeded.");
  }

  const [demoEmergency] = await db
    .insert(emergenciesTable)
    .values({
      patientUserId,
      patientName: "Asha Verma",
      emergencyType: "CARDIAC_ARREST",
      severity: "CRITICAL",
      status: "TRANSPORTING",
      latitude: 13.639,
      longitude: 79.4035,
      locationLabel: "DEMO • Alipiri Pilgrim Transit Center, Tirupati",
      requiredCapabilities: ["CARDIAC", "ICU", "VENTILATOR"],
      assignedAmbulanceId: ambulance.id,
      selectedHospitalId: svims.id,
      etaMinutes: 6,
    })
    .returning();

  if (!demoEmergency) throw new Error("Could not create the demo emergency.");

  await db
    .update(ambulancesTable)
    .set({
      status: "TRANSPORTING",
      currentEmergencyId: demoEmergency.id,
      destinationHospitalId: svims.id,
      etaMinutes: 6,
      lastUpdated: new Date(),
    })
    .where(eq(ambulancesTable.id, ambulance.id));

  await recordEvent("SOS_RECEIVED", "Cardiac arrest SOS received from Alipiri transit center.", demoEmergency.id);
  await recordEvent("AMBULANCE_ASSIGNED", "AMB-01 (ALS) assigned to patient Asha Verma.", demoEmergency.id);
  await recordEvent("ROUTE_SELECTED", "Route A (SVIMS Express) selected: 6 min ETA.", demoEmergency.id);
  await recordEvent("HOSPITAL_SELECTED", "SVIMS Super Specialty Hospital selected (ICU and Cardiac ready).", demoEmergency.id);
  await recordEvent("TRANSPORT_STARTED", "Patient onboard AMB-01. Transport to SVIMS in progress.", demoEmergency.id);

  await recalculateDecision(demoEmergency.id, { preferredHospitalId: svims.id, emitEvent: false });
  await addRouteAAccident(demoEmergency.id);
  await setHospitalFull("SVIMS Super Specialty Hospital", demoEmergency.id);

  await recordEvent("DEMO_READY", "Tirupati demo ready: Rerouted to SVRR Hospital (Ruia) with open corridor.", demoEmergency.id);
  return {
    message: "Tirupati demo complete: SVIMS became full & Route A blocked; LIFELINK dynamic AI rerouted to Ruia Government General Hospital via Route B.",
    emergencyId: demoEmergency.id,
    events: await latestEvents(),
  };
}
