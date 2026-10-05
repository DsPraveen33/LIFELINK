import { count, eq } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import {
  db,
  ambulancesTable,
  decisionsTable,
  emergenciesTable,
  eventsTable,
  hospitalsTable,
  roadIncidentsTable,
  routesTable,
  trafficConditionsTable,
  usersTable,
} from "@workspace/db";
import type { RoutePoint } from "@workspace/db";
import { hashPassword } from "./sessions";
import { logger } from "./logger";

const DEMO_PASSWORD = "LifelinkDemo2026!";
const BASE = { latitude: 12.9756, longitude: 77.6066 };

async function tableIsEmpty(table: AnyPgTable): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(table);
  return Number(row?.value ?? 0) === 0;
}

export async function seedLifelinkData(): Promise<void> {
  try {
    if (await tableIsEmpty(usersTable) && process.env.NODE_ENV !== "production") {
      await db.insert(usersTable).values([
        {
          name: "Asha Verma",
          email: "patient@lifelink.demo",
          passwordHash: hashPassword(DEMO_PASSWORD),
          role: "USER",
          phone: "+91 90000 00001",
        },
        {
          name: "Aarav Mehta",
          email: "driver@lifelink.demo",
          passwordHash: hashPassword(DEMO_PASSWORD),
          role: "DRIVER",
          phone: "+91 90000 00002",
        },
        {
          name: "Kavita Iyer",
          email: "operator@lifelink.demo",
          passwordHash: hashPassword(DEMO_PASSWORD),
          role: "OPERATOR",
          phone: "+91 90000 00003",
        },
      ]);
    }

    if (await tableIsEmpty(hospitalsTable)) {
      await db.insert(hospitalsTable).values([
        {
          name: "City Trauma Center A",
          address: "Victoria Road, Bengaluru",
          latitude: 12.9664,
          longitude: 77.6074,
          readinessStatus: "FULL",
          emergencyStatus: "DIVERTING",
          traumaBeds: 0,
          icuBeds: 0,
          ventilators: 0,
          capabilities: ["TRAUMA", "ICU", "CARDIAC"],
          waitMinutes: 42,
        },
        {
          name: "City Trauma Center B",
          address: "M.G. Road, Bengaluru",
          latitude: 12.9751,
          longitude: 77.6137,
          readinessStatus: "READY",
          emergencyStatus: "ACCEPTING",
          traumaBeds: 4,
          icuBeds: 3,
          ventilators: 2,
          capabilities: ["TRAUMA", "ICU", "CARDIAC", "STROKE"],
          waitMinutes: 8,
        },
        {
          name: "Metro Care Hospital C",
          address: "Ulsoor, Bengaluru",
          latitude: 12.981,
          longitude: 77.624,
          readinessStatus: "READY",
          emergencyStatus: "ACCEPTING",
          traumaBeds: 3,
          icuBeds: 2,
          ventilators: 2,
          capabilities: ["TRAUMA", "ICU", "CARDIAC", "BURN"],
          waitMinutes: 12,
        },
        {
          name: "St. Martha's Medical Center D",
          address: "Nrupathunga Road, Bengaluru",
          latitude: 12.9635,
          longitude: 77.5784,
          readinessStatus: "BUSY",
          emergencyStatus: "LIMITED",
          traumaBeds: 1,
          icuBeds: 1,
          ventilators: 1,
          capabilities: ["TRAUMA", "ICU", "STROKE"],
          waitMinutes: 24,
        },
        {
          name: "Eastside General Hospital E",
          address: "Indiranagar, Bengaluru",
          latitude: 12.9787,
          longitude: 77.6408,
          readinessStatus: "READY",
          emergencyStatus: "ACCEPTING",
          traumaBeds: 2,
          icuBeds: 2,
          ventilators: 1,
          capabilities: ["TRAUMA", "CARDIAC", "PEDIATRIC"],
          waitMinutes: 16,
        },
      ]);
    }

    const users = await db.select().from(usersTable);
    const driverUser = users.find((user) => user.role === "DRIVER");
    if (await tableIsEmpty(ambulancesTable)) {
      await db.insert(ambulancesTable).values([
        {
          callSign: "AMB-01",
          vehicleNumber: "KA-03-MG-1142",
          driverName: "Sanjay Rao",
          latitude: 12.9717,
          longitude: 77.601,
          status: "AVAILABLE",
          equipment: ["BASIC_LIFE_SUPPORT", "OXYGEN"],
        },
        {
          callSign: "AMB-02",
          vehicleNumber: "KA-03-MG-2086",
          driverName: driverUser?.name ?? "Aarav Mehta",
          driverUserId: driverUser?.id ?? null,
          latitude: 12.9698,
          longitude: 77.6041,
          status: "AVAILABLE",
          equipment: ["ADVANCED_LIFE_SUPPORT", "TRAUMA", "OXYGEN", "DEFIBRILLATOR"],
        },
        {
          callSign: "AMB-03",
          vehicleNumber: "KA-05-EM-3910",
          driverName: "Farah Khan",
          latitude: 12.9827,
          longitude: 77.611,
          status: "AVAILABLE",
          equipment: ["BASIC_LIFE_SUPPORT", "OXYGEN", "PEDIATRIC"],
        },
        {
          callSign: "AMB-04",
          vehicleNumber: "KA-03-MG-4421",
          driverName: "Deepak Nair",
          latitude: 12.9554,
          longitude: 77.615,
          status: "AVAILABLE",
          equipment: ["ADVANCED_LIFE_SUPPORT", "CARDIAC", "OXYGEN"],
        },
        {
          callSign: "AMB-05",
          vehicleNumber: "KA-01-EM-7703",
          driverName: "Meera Joshi",
          latitude: 12.988,
          longitude: 77.594,
          status: "AVAILABLE",
          equipment: ["BASIC_LIFE_SUPPORT", "STROKE", "OXYGEN"],
        },
      ]);
    }

    if (await tableIsEmpty(roadIncidentsTable)) {
      await db.insert(roadIncidentsTable).values([
        {
          type: "WATER_LOGGING",
          latitude: 12.9771,
          longitude: 77.609,
          roadName: "Brigade Road",
          severity: "MODERATE",
          description: "Water logging slowing two lanes",
          active: true,
        },
        {
          type: "TRAFFIC_CONGESTION",
          latitude: 12.9727,
          longitude: 77.6002,
          roadName: "Residency Road",
          severity: "LOW",
          description: "Slow moving traffic near the junction",
          active: true,
        },
        {
          type: "ROAD_WORK",
          latitude: 12.982,
          longitude: 77.617,
          roadName: "Old Airport Road",
          severity: "MODERATE",
          description: "Temporary lane restriction for road work",
          active: true,
        },
      ]);
    }

    if (await tableIsEmpty(trafficConditionsTable)) {
      await db.insert(trafficConditionsTable).values([
        {
          roadSegment: "M.G. Road",
          speedKph: 18,
          expectedSpeedKph: 38,
          congestionLevel: "HEAVY",
          trend: "WORSENING",
        },
        {
          roadSegment: "Brigade Road",
          speedKph: 27,
          expectedSpeedKph: 40,
          congestionLevel: "MODERATE",
          trend: "STABLE",
        },
        {
          roadSegment: "Ulsoor Road",
          speedKph: 34,
          expectedSpeedKph: 42,
          congestionLevel: "LIGHT",
          trend: "IMPROVING",
        },
      ]);
    }

    if (await tableIsEmpty(emergenciesTable)) {
      const patient = users.find((user) => user.role === "USER");
      const ambulances = await db.select().from(ambulancesTable);
      const hospitals = await db.select().from(hospitalsTable);
      const ambulance2 = ambulances.find((row) => row.callSign === "AMB-02");
      const ambulance4 = ambulances.find((row) => row.callSign === "AMB-04");
      const hospitalB = hospitals.find((row) => row.name.includes("Center B"));
      const hospitalC = hospitals.find((row) => row.name.includes("Hospital C"));

      const [first] = await db.insert(emergenciesTable).values({
        patientUserId: patient?.id ?? null,
        patientName: patient?.name ?? "Asha Verma",
        emergencyType: "Critical Road Accident",
        severity: "CRITICAL",
        status: "EN_ROUTE",
        latitude: BASE.latitude,
        longitude: BASE.longitude,
        locationLabel: "M.G. Road, Central Bengaluru",
        requiredCapabilities: ["TRAUMA", "ICU"],
        assignedAmbulanceId: ambulance2?.id ?? null,
        selectedHospitalId: hospitalB?.id ?? null,
        etaMinutes: 7,
      }).returning();
      const [second] = await db.insert(emergenciesTable).values({
        patientName: "Rohan Shah",
        emergencyType: "Cardiac Emergency",
        severity: "HIGH",
        status: "DISPATCHED",
        latitude: 12.9702,
        longitude: 77.6192,
        locationLabel: "Ulsoor Lake, Bengaluru",
        requiredCapabilities: ["CARDIAC", "ICU"],
        assignedAmbulanceId: ambulance4?.id ?? null,
        selectedHospitalId: hospitalC?.id ?? null,
        etaMinutes: 11,
      }).returning();
      await db.insert(emergenciesTable).values({
        patientName: "Maya Shah",
        emergencyType: "Breathing Difficulty",
        severity: "MEDIUM",
        status: "COMPLETED",
        latitude: 12.9682,
        longitude: 77.5971,
        locationLabel: "Richmond Town, Bengaluru",
        requiredCapabilities: ["OXYGEN"],
        selectedHospitalId: hospitalB?.id ?? null,
        etaMinutes: 0,
      });
      if (ambulance2 && first) {
        await db.update(ambulancesTable).set({
          status: "EN_ROUTE",
          currentEmergencyId: first.id,
          destinationHospitalId: hospitalB?.id ?? null,
          etaMinutes: 7,
          lastUpdated: new Date(),
        }).where(eq(ambulancesTable.id, ambulance2.id));
      }
      if (ambulance4 && second) {
        await db.update(ambulancesTable).set({
          status: "EN_ROUTE",
          currentEmergencyId: second.id,
          destinationHospitalId: hospitalC?.id ?? null,
          etaMinutes: 11,
          lastUpdated: new Date(),
        }).where(eq(ambulancesTable.id, ambulance4.id));
      }

      if (first && hospitalB) {
        const p1: RoutePoint[] = [
          [12.9698, 77.6041],
          [12.9726, 77.607],
          [12.9756, 77.6066],
        ];
        const p2: RoutePoint[] = [
          [12.9698, 77.6041],
          [12.9724, 77.6101],
          [12.9756, 77.6066],
        ];
        const p3: RoutePoint[] = [
          [12.9698, 77.6041],
          [12.9765, 77.6024],
          [12.9756, 77.6066],
        ];
        const storedRoutes = await db.insert(routesTable).values([
          {
            emergencyId: first.id,
            name: "Route A",
            distanceKm: 2.4,
            etaMinutes: 12,
            predictedEtaMinutes: 14,
            trafficLevel: "HEAVY",
            riskLevel: "MEDIUM",
            status: "RECOMMENDED",
            points: p1,
            reason: "Fastest time-to-care with a clear corridor to the scene.",
          },
          {
            emergencyId: first.id,
            name: "Route B",
            distanceKm: 3.1,
            etaMinutes: 16,
            predictedEtaMinutes: 16,
            trafficLevel: "MODERATE",
            riskLevel: "LOW",
            status: "ALTERNATIVE",
            points: p2,
            reason: "Lower congestion, slightly longer approach.",
          },
          {
            emergencyId: first.id,
            name: "Route C",
            distanceKm: 4.2,
            etaMinutes: 19,
            predictedEtaMinutes: 19,
            trafficLevel: "LIGHT",
            riskLevel: "LOW",
            status: "ALTERNATIVE",
            points: p3,
            reason: "Low-risk outer route with additional distance.",
          },
        ]).returning();
        const routeA = storedRoutes[0];
        if (routeA) {
          await db.insert(decisionsTable).values({
            emergencyId: first.id,
            selectedRouteId: routeA.id,
            selectedHospitalId: hospitalB.id,
            confidence: 91,
            reasons: ["Route A is the fastest feasible response.", "Hospital B has trauma and ICU capacity."],
            warnings: ["Traffic is heavy on M.G. Road."],
          });
        }
      }

      await db.insert(eventsTable).values([
        { emergencyId: first?.id ?? null, type: "SOS_RECEIVED", message: "Critical road accident SOS received." },
        { emergencyId: first?.id ?? null, type: "AMBULANCE_ASSIGNED", message: "AMB-02 assigned to the emergency." },
        { emergencyId: first?.id ?? null, type: "HOSPITAL_SELECTED", message: "City Trauma Center B is ready to receive." },
        { emergencyId: second?.id ?? null, type: "EMERGENCY_DISPATCHED", message: "Cardiac emergency dispatched to AMB-04." },
      ]);
    }

    logger.info("LIFELINK sample data is ready");
  } catch (error) {
    logger.error({ error }, "Could not prepare LIFELINK sample data");
    throw error;
  }
}

