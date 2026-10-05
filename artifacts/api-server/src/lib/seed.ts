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
import { simulationConfig } from "../simulation/config";

const DEMO_PASSWORD = "LifelinkDemo2026!";

async function tableIsEmpty(table: AnyPgTable): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(table);
  return Number(row?.value ?? 0) === 0;
}

export async function seedLifelinkData(): Promise<void> {
  try {
    if ((await tableIsEmpty(usersTable)) && process.env.NODE_ENV !== "production") {
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
          name: "Ramesh Naidu",
          email: "driver2@lifelink.demo",
          passwordHash: hashPassword(DEMO_PASSWORD),
          role: "DRIVER",
          phone: "+91 90000 00004",
        },
        {
          name: "Kavita Iyer",
          email: "operator@lifelink.demo",
          passwordHash: hashPassword(DEMO_PASSWORD),
          role: "OPERATOR",
          phone: "+91 90000 00003",
        },
        {
          name: "System Administrator",
          email: "admin@lifelink.demo",
          passwordHash: hashPassword(DEMO_PASSWORD),
          role: "ADMIN",
          phone: "+91 90000 00000",
        },
      ]);
    }

    if (await tableIsEmpty(hospitalsTable)) {
      await db.insert(hospitalsTable).values(simulationConfig.demoHospitals);
    }

    const users = await db.select().from(usersTable);
    const driverUser = users.find((user) => user.email === "driver@lifelink.demo");
    const driver2User = users.find((user) => user.email === "driver2@lifelink.demo");

    if (await tableIsEmpty(ambulancesTable)) {
      await db.insert(ambulancesTable).values([
        {
          callSign: "AMB-01",
          vehicleNumber: "AP-03-TE-1081",
          driverName: "Aarav Mehta",
          driverUserId: driverUser?.id ?? null,
          latitude: 13.6288,
          longitude: 79.4192,
          status: "AVAILABLE",
          equipment: ["ADVANCED_LIFE_SUPPORT", "VENTILATOR", "DEFIBRILLATOR", "OXYGEN"],
        },
        {
          callSign: "AMB-02",
          vehicleNumber: "AP-03-TE-1082",
          driverName: "Ramesh Naidu",
          driverUserId: driver2User?.id ?? null,
          latitude: 13.6395,
          longitude: 79.401,
          status: "AVAILABLE",
          equipment: ["ADVANCED_LIFE_SUPPORT", "VENTILATOR", "DEFIBRILLATOR", "ECG"],
        },
        {
          callSign: "AMB-03",
          vehicleNumber: "AP-03-TE-1083",
          driverName: "Suresh Babu",
          driverUserId: null,
          latitude: 13.632,
          longitude: 79.411,
          status: "AVAILABLE",
          equipment: ["BASIC_LIFE_SUPPORT", "OXYGEN", "FIRST_AID"],
        },
        {
          callSign: "AMB-04",
          vehicleNumber: "AP-03-TE-1084",
          driverName: "Kalyan Kumar",
          driverUserId: null,
          latitude: 13.645,
          longitude: 79.438,
          status: "AVAILABLE",
          equipment: ["ADVANCED_LIFE_SUPPORT", "VENTILATOR", "OXYGEN"],
        },
        {
          callSign: "AMB-05",
          vehicleNumber: "AP-03-TE-1085",
          driverName: "Venkatesh Rao",
          driverUserId: null,
          latitude: 13.618,
          longitude: 79.415,
          status: "AVAILABLE",
          equipment: ["BASIC_LIFE_SUPPORT", "OXYGEN", "FIRST_AID"],
        },
      ]);
    }

    if (await tableIsEmpty(roadIncidentsTable)) {
      await db.insert(roadIncidentsTable).values([
        {
          type: "ROAD_WORK",
          latitude: 13.635,
          longitude: 79.406,
          roadName: "Alipiri Bypass Road",
          severity: "MODERATE",
          description: "Drainage works on Alipiri bypass road. Expect 5-8 min delay.",
          active: true,
        },
        {
          type: "PILGRIM_CONGESTION",
          latitude: 13.642,
          longitude: 79.418,
          roadName: "Kapilatheertham Road",
          severity: "CRITICAL",
          description: "Heavy vehicular and pedestrian movement towards hills.",
          active: true,
        },
      ]);
    }

    if (await tableIsEmpty(trafficConditionsTable)) {
      await db.insert(trafficConditionsTable).values([
        {
          roadSegment: "Alipiri Bypass Road",
          speedKph: 20,
          expectedSpeedKph: 45,
          congestionLevel: "MODERATE",
          trend: "WORSENING",
        },
        {
          roadSegment: "Renigunta Road",
          speedKph: 35,
          expectedSpeedKph: 50,
          congestionLevel: "LIGHT",
          trend: "STABLE",
        },
        {
          roadSegment: "Kapilatheertham Road",
          speedKph: 12,
          expectedSpeedKph: 35,
          congestionLevel: "HEAVY",
          trend: "WORSENING",
        },
      ]);
    }

    if (await tableIsEmpty(emergenciesTable)) {
      const patient = users.find((user) => user.email === "patient@lifelink.demo");
      const ambulances = await db.select().from(ambulancesTable);
      const hospitals = await db.select().from(hospitalsTable);
      const ambulance1 = ambulances.find((row) => row.callSign === "AMB-01");
      const svimsHospital = hospitals.find((row) => row.name.includes("SVIMS"));

      const [first] = await db.insert(emergenciesTable).values({
        patientUserId: patient?.id ?? null,
        patientName: patient?.name ?? "Asha Verma",
        emergencyType: "CARDIAC_ARREST",
        severity: "CRITICAL",
        status: "DISPATCHED",
        latitude: 13.639,
        longitude: 79.4035,
        locationLabel: "Alipiri Pilgrim Transit Center, Tirupati",
        requiredCapabilities: ["CARDIAC", "ICU", "VENTILATOR"],
        assignedAmbulanceId: ambulance1?.id ?? null,
        selectedHospitalId: svimsHospital?.id ?? null,
        etaMinutes: 6,
      }).returning();

      if (first && ambulance1 && svimsHospital) {
        await db
          .update(ambulancesTable)
          .set({
            status: "EN_ROUTE",
            currentEmergencyId: first.id,
            destinationHospitalId: svimsHospital.id,
            etaMinutes: 6,
          })
          .where(eq(ambulancesTable.id, ambulance1.id));

        const waypoints: RoutePoint[] = [
          [ambulance1.latitude, ambulance1.longitude],
          [13.6335, 79.412],
          [first.latitude, first.longitude],
          [svimsHospital.latitude, svimsHospital.longitude],
        ];

        const [recommendedRoute] = await db.insert(routesTable).values([
          {
            emergencyId: first.id,
            name: "Route A - SVIMS Express Corridor",
            distanceKm: 3.4,
            etaMinutes: 6,
            predictedEtaMinutes: 7,
            trafficLevel: "LOW",
            riskLevel: "LOW",
            status: "RECOMMENDED",
            points: waypoints,
            reason: "Fastest approach to Alipiri with open emergency corridor.",
          },
          {
            emergencyId: first.id,
            name: "Route B - Ruia Link Alternate",
            distanceKm: 4.2,
            etaMinutes: 10,
            predictedEtaMinutes: 12,
            trafficLevel: "MODERATE",
            riskLevel: "MEDIUM",
            status: "ALTERNATIVE",
            points: waypoints,
            reason: "Alternative via Ruia hospital bypass.",
          },
        ]).returning();

        await db.insert(decisionsTable).values({
          emergencyId: first.id,
          selectedRouteId: recommendedRoute?.id ?? null,
          selectedHospitalId: svimsHospital.id,
          confidence: 94,
          reasons: [
            "SVIMS Super Specialty Hospital is closest with 8 trauma and 6 ICU beds ready.",
            "AMB-01 is ALS-equipped.",
          ],
          warnings: [],
        });

        await db.insert(eventsTable).values([
          {
            emergencyId: first.id,
            type: "SOS_RECEIVED",
            message: `Emergency reported for ${first.patientName} at ${first.locationLabel}.`,
            metadata: { severity: first.severity, type: first.emergencyType },
          },
          {
            emergencyId: first.id,
            type: "AMBULANCE_DISPATCHED",
            message: `${ambulance1.callSign} dispatched to Alipiri (ETA 6m).`,
            metadata: { ambulanceId: ambulance1.id },
          },
        ]);
      }
    }

    logger.info("LIFELINK Tirupati demo environment seeded successfully.");
  } catch (error) {
    logger.warn({ error }, "Error while seeding LIFELINK demo data");
  }
}
