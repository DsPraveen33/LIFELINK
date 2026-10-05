import { desc, eq } from "drizzle-orm";
import {
  db,
  ambulancesTable,
  decisionsTable,
  emergenciesTable,
  hospitalPreAlertsTable,
  hospitalsTable,
  roadIncidentsTable,
  routesTable,
  trafficConditionsTable,
  type RoutePoint,
} from "@workspace/db";
import type { Decision, Emergency, Hospital, RouteOption } from "./api-types";
import { recordEvent } from "./domain-events";
import { logger } from "./logger";

const ROUTE_NAMES = ["Route A", "Route B", "Route C"];
const ETA_OFFSETS = [0, 4, 7];
const POINT_OFFSETS = [0, 0.002, -0.002];

type Location = { latitude: number; longitude: number };

export function distanceKm(from: Location, to: Location): number {
  const earthRadiusKm = 6371;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) *
      Math.cos((to.latitude * Math.PI) / 180) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routePoints(from: Location, to: Location, offset: number): RoutePoint[] {
  const latitudeDelta = to.latitude - from.latitude;
  const longitudeDelta = to.longitude - from.longitude;
  return [
    [from.latitude, from.longitude],
    [
      from.latitude + latitudeDelta * 0.36 + offset * 0.55,
      from.longitude + longitudeDelta * 0.38 - offset,
    ],
    [
      from.latitude + latitudeDelta * 0.69 - offset * 0.65,
      from.longitude + longitudeDelta * 0.72 + offset * 0.6,
    ],
    [to.latitude, to.longitude],
  ];
}

async function osrmAlternatives(from: Location, to: Location) {
  const endpoint = process.env.ROUTING_API_URL?.trim();
  if (!endpoint) return [];
  const base = endpoint.replace(/\/+$/, "");
  const url = new URL(
    `${base}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`,
  );
  url.searchParams.set("alternatives", "true");
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
    const data = (await response.json()) as {
      routes?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates?: number[][] };
      }>;
    };
    return (data.routes ?? []).slice(0, 3).map((route) => ({
      distanceKm: route.distance / 1000,
      etaMinutes: Math.max(1, Math.ceil(route.duration / 60)),
      points: (route.geometry?.coordinates ?? []).map(([longitude, latitude]) => [
        latitude,
        longitude,
      ]) as RoutePoint[],
    }));
  } catch (error) {
    logger.warn({ error }, "Routing provider failed; using labeled simulation routes");
    return [];
  }
}

async function selectHospital(emergency: typeof emergenciesTable.$inferSelect) {
  const hospitals = await db.select().from(hospitalsTable);
  const eligible = hospitals
    .filter((hospital) => hospital.readinessStatus !== "FULL" && hospital.emergencyStatus !== "DIVERTING")
    .map((hospital) => {
      const missing = emergency.requiredCapabilities.filter(
        (capability) => !hospital.capabilities.includes(capability),
      );
      const distance = distanceKm(emergency, hospital);
      const score = distance * 4 + hospital.waitMinutes * 0.18 + missing.length * 30;
      return { hospital, missing, distance, score };
    })
    .sort((left, right) => left.score - right.score);

  return { selected: eligible[0] ?? null, alternatives: eligible.slice(1) };
}

async function buildRouteCandidates(
  emergency: typeof emergenciesTable.$inferSelect,
  ambulance: typeof ambulancesTable.$inferSelect | undefined,
  hospital: typeof hospitalsTable.$inferSelect | undefined,
): Promise<RouteOption[]> {
  const currentOrigin: Location = ambulance
    ? { latitude: ambulance.latitude, longitude: ambulance.longitude }
    : { latitude: emergency.latitude, longitude: emergency.longitude };
  const isTransporting =
    emergency.status === "TRANSPORTING" && hospital !== undefined;
  const target: Location =
    isTransporting && hospital
      ? { latitude: hospital.latitude, longitude: hospital.longitude }
      : { latitude: emergency.latitude, longitude: emergency.longitude };
  const roadIncidents = await db
    .select()
    .from(roadIncidentsTable)
    .where(eq(roadIncidentsTable.active, true));
  const traffic = await db.select().from(trafficConditionsTable);
  const routeABlocked = roadIncidents.some(
    (incident) =>
      incident.roadName.toLowerCase().includes("route a") ||
      incident.type === "ROUTE_A_ACCIDENT",
  );
  const nearestTraffic = traffic.find((condition) => condition.roadSegment.toLowerCase().includes("m.g."));
  const trafficFactor =
    nearestTraffic?.congestionLevel === "HEAVY"
      ? 1.35
      : nearestTraffic?.congestionLevel === "MODERATE"
        ? 1.15
        : 1;
  const baselineDistance = Math.max(1.2, distanceKm(currentOrigin, target));
  const demoScenario = emergency.locationLabel.startsWith("DEMO •");
  const externalRoutes = demoScenario ? [] : await osrmAlternatives(currentOrigin, target);

  return ROUTE_NAMES.map((name, index) => {
    const offset = POINT_OFFSETS[index] ?? 0;
    const fromProvider = externalRoutes[index];
    const distance = fromProvider?.distanceKm ?? baselineDistance * (1 + index * 0.09);
    const blocked = index === 0 && routeABlocked;
    const demoEta = demoScenario ? [12, 16, 19][index] ?? 19 : undefined;
    const baseEta =
      fromProvider?.etaMinutes ??
      demoEta ??
      Math.max(3, Math.ceil((5 + baselineDistance * 2.5 + (ETA_OFFSETS[index] ?? 0)) * trafficFactor));
    const etaMinutes = blocked
      ? demoScenario
        ? 25
        : Math.max(25, baseEta + 13)
      : demoScenario && routeABlocked && index === 1
        ? 15
        : baseEta;
    const points = fromProvider?.points.length
      ? fromProvider.points
      : routePoints(currentOrigin, target, offset);
    const trafficLevel =
      blocked || trafficFactor >= 1.3 ? "HEAVY" : trafficFactor > 1 ? "MODERATE" : "LIGHT";
    const reason = blocked
      ? "An active incident blocks this corridor. Avoid until the road reopens."
      : index === 0
        ? "Best predicted time-to-care on currently open roads."
        : index === 1
          ? "A dependable alternate corridor with moderate traffic exposure."
          : "A longer outer route with lower incident exposure.";

    return {
      id: index + 1,
      name,
      distanceKm: Number(distance.toFixed(1)),
      etaMinutes,
      predictedEtaMinutes: blocked ? etaMinutes : etaMinutes + (trafficLevel === "HEAVY" ? 2 : 0),
      trafficLevel,
      riskLevel: blocked ? "HIGH" : index === 0 ? "MEDIUM" : "LOW",
      status: blocked ? "BLOCKED" : index === 0 ? "RECOMMENDED" : "ALTERNATIVE",
      points,
      reason,
    };
  });
}

export async function recalculateDecision(
  emergencyId: number,
  options: { preferredHospitalId?: number; emitEvent?: boolean } = {},
): Promise<Decision | null> {
  const [emergency] = await db
    .select()
    .from(emergenciesTable)
    .where(eq(emergenciesTable.id, emergencyId))
    .limit(1);
  if (!emergency) return null;

  const [ambulance] = emergency.assignedAmbulanceId
    ? await db
        .select()
        .from(ambulancesTable)
        .where(eq(ambulancesTable.id, emergency.assignedAmbulanceId))
        .limit(1)
    : [];
  const { selected: hospitalChoice, alternatives } = await selectHospital(emergency);
  const forcedHospital =
    options.preferredHospitalId !== undefined
      ? await db
          .select()
          .from(hospitalsTable)
          .where(eq(hospitalsTable.id, options.preferredHospitalId))
          .then((rows) => rows[0])
      : undefined;
  const hospital = forcedHospital ?? hospitalChoice?.hospital;
  const candidates = await buildRouteCandidates(emergency, ambulance, hospital);
  const availableRoutes = candidates.filter((route) => route.status !== "BLOCKED");
  const chosenRoute = [...availableRoutes].sort(
    (left, right) => left.predictedEtaMinutes - right.predictedEtaMinutes,
  )[0];
  if (!chosenRoute) return null;

  await db.delete(routesTable).where(eq(routesTable.emergencyId, emergency.id));
  const storedRoutes = await db
    .insert(routesTable)
    .values(
      candidates.map((route) => ({
        emergencyId: emergency.id,
        name: route.name,
        distanceKm: route.distanceKm,
        etaMinutes: route.etaMinutes,
        predictedEtaMinutes: route.predictedEtaMinutes,
        trafficLevel: route.trafficLevel,
        riskLevel: route.riskLevel,
        status: route.status,
        points: route.points as RoutePoint[],
        reason: route.reason,
      })),
    )
    .returning();
  const selectedRouteRecord = storedRoutes.find((route) => route.name === chosenRoute.name);
  const reasons = [
    `${chosenRoute.name} has the lowest predicted arrival time among open routes.`,
    hospital
      ? `${hospital.name} is ${hospital.readinessStatus.toLowerCase()} and matches the available receiving capacity.`
      : "No currently receiving hospital matches this emergency.",
  ];
  const missingCapabilities = hospital
    ? emergency.requiredCapabilities.filter(
        (capability) => !hospital.capabilities.includes(capability),
      )
    : [];
  const warnings: string[] = [];
  if (chosenRoute.trafficLevel === "HEAVY") warnings.push("Heavy traffic may increase predicted arrival time.");
  if (!hospital) warnings.push("No hospital is currently marked as receiving emergencies.");
  if (hospital && emergency.requiredCapabilities.some((item) => !hospital.capabilities.includes(item))) {
    warnings.push(`Capacity capability gap: ${missingCapabilities.join(", ")}.`);
  }

  const [existingDecision] = await db
    .select()
    .from(decisionsTable)
    .where(eq(decisionsTable.emergencyId, emergency.id))
    .orderBy(desc(decisionsTable.updatedAt))
    .limit(1);
  const decisionValues = {
    selectedRouteId: selectedRouteRecord?.id ?? null,
    selectedHospitalId: hospital?.id ?? null,
    confidence: Math.max(55, Math.min(98, 94 - warnings.length * 9 - alternatives.length * 2)),
    reasons,
    warnings,
    updatedAt: new Date(),
  };
  if (existingDecision) {
    await db
      .update(decisionsTable)
      .set(decisionValues)
      .where(eq(decisionsTable.id, existingDecision.id));
  } else {
    await db.insert(decisionsTable).values({ emergencyId: emergency.id, ...decisionValues });
  }
  await db
    .update(emergenciesTable)
    .set({
      selectedHospitalId: hospital?.id ?? null,
      etaMinutes: chosenRoute.etaMinutes,
      updatedAt: new Date(),
    })
    .where(eq(emergenciesTable.id, emergency.id));
  if (ambulance) {
    await db
      .update(ambulancesTable)
      .set({
        destinationHospitalId: hospital?.id ?? null,
        etaMinutes: chosenRoute.etaMinutes,
        lastUpdated: new Date(),
      })
      .where(eq(ambulancesTable.id, ambulance.id));
  }
  if (hospital && ambulance) {
    await db.insert(hospitalPreAlertsTable).values({
      emergencyId: emergency.id,
      ambulanceId: ambulance.id,
      hospitalId: hospital.id,
      severity: emergency.severity,
      requirements: emergency.requiredCapabilities,
      etaMinutes: chosenRoute.etaMinutes,
      status: "SENT",
    });
  }
  if (options.emitEvent) {
    await recordEvent(
      "DECISION_UPDATED",
      `${chosenRoute.name} selected; ${hospital?.name ?? "hospital review required"} is the current recommendation.`,
      emergency.id,
    );
  }

  return {
    emergencyId: emergency.id,
    selectedRoute: { ...chosenRoute, id: selectedRouteRecord?.id ?? chosenRoute.id },
    selectedHospitalId: hospital?.id ?? null,
    selectedHospitalName: hospital?.name ?? null,
    confidence: decisionValues.confidence,
    reasons,
    warnings,
    updatedAt: decisionValues.updatedAt.toISOString(),
  };
}

export async function readDecision(emergencyId: number): Promise<Decision | null> {
  const [decision] = await db
    .select()
    .from(decisionsTable)
    .where(eq(decisionsTable.emergencyId, emergencyId))
    .orderBy(desc(decisionsTable.updatedAt))
    .limit(1);
  if (!decision?.selectedRouteId) return null;
  const [route] = await db
    .select()
    .from(routesTable)
    .where(eq(routesTable.id, decision.selectedRouteId))
    .limit(1);
  if (!route) return null;
  const [hospital] = decision.selectedHospitalId
    ? await db
        .select()
        .from(hospitalsTable)
        .where(eq(hospitalsTable.id, decision.selectedHospitalId))
        .limit(1)
    : [];
  const selectedRoute: RouteOption = {
    id: route.id,
    name: route.name,
    distanceKm: route.distanceKm,
    etaMinutes: route.etaMinutes,
    predictedEtaMinutes: route.predictedEtaMinutes,
    trafficLevel: route.trafficLevel as RouteOption["trafficLevel"],
    riskLevel: route.riskLevel as RouteOption["riskLevel"],
    status: route.status as RouteOption["status"],
    points: route.points,
    reason: route.reason,
  };
  return {
    emergencyId,
    selectedRoute,
    selectedHospitalId: hospital?.id ?? null,
    selectedHospitalName: hospital?.name ?? null,
    confidence: decision.confidence,
    reasons: decision.reasons,
    warnings: decision.warnings,
    updatedAt: decision.updatedAt.toISOString(),
  };
}

export function emergencyToApi(row: typeof emergenciesTable.$inferSelect): Emergency {
  return {
    id: row.id,
    patientName: row.patientName,
    emergencyType: row.emergencyType,
    severity: row.severity as Emergency["severity"],
    status: row.status as Emergency["status"],
    latitude: row.latitude,
    longitude: row.longitude,
    locationLabel: row.locationLabel,
    requiredCapabilities: row.requiredCapabilities,
    assignedAmbulanceId: row.assignedAmbulanceId,
    selectedHospitalId: row.selectedHospitalId,
    etaMinutes: row.etaMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function hospitalToApi(row: typeof hospitalsTable.$inferSelect): Hospital {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    readinessStatus: row.readinessStatus as Hospital["readinessStatus"],
    emergencyStatus: row.emergencyStatus as Hospital["emergencyStatus"],
    traumaBeds: row.traumaBeds,
    icuBeds: row.icuBeds,
    ventilators: row.ventilators,
    capabilities: row.capabilities,
    waitMinutes: row.waitMinutes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function ambulanceToApi(row: typeof ambulancesTable.$inferSelect) {
  return {
    id: row.id,
    callSign: row.callSign,
    vehicleNumber: row.vehicleNumber,
    driverName: row.driverName,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status as "AVAILABLE" | "EN_ROUTE" | "ON_SCENE" | "TRANSPORTING" | "OFFLINE",
    equipment: row.equipment,
    currentEmergencyId: row.currentEmergencyId,
    destinationHospitalId: row.destinationHospitalId,
    etaMinutes: row.etaMinutes,
    lastUpdated: row.lastUpdated.toISOString(),
  };
}
