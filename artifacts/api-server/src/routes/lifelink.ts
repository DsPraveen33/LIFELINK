import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  ambulancesTable,
  emergenciesTable,
  eventsTable,
  hospitalsTable,
  locationHistoryTable,
  roadIncidentsTable,
  routesTable,
} from "@workspace/db";
import {
  AcceptEmergencyBody,
  AcceptEmergencyParams,
  AcceptEmergencyResponse,
  CalculateRoutesBody,
  CalculateRoutesResponse,
  CompleteEmergencyBody,
  CompleteEmergencyParams,
  CompleteEmergencyResponse,
  CreateEmergencyBody,
  CreateEmergencyResponse,
  DeclineEmergencyBody,
  DeclineEmergencyParams,
  DeclineEmergencyResponse,
  GetEmergencyDecisionParams,
  GetEmergencyDecisionResponse,
  GetEmergencyParams,
  GetEmergencyResponse,
  GetDashboardSummaryResponse,
  ListAmbulancesResponse,
  ListDashboardEventsResponse,
  ListEmergenciesResponse,
  ListHospitalsResponse,
  MarkArrivedAtSceneBody,
  MarkArrivedAtSceneParams,
  MarkArrivedAtSceneResponse,
  MarkPatientOnboardBody,
  MarkPatientOnboardParams,
  MarkPatientOnboardResponse,
  UpdateAmbulanceLocationBody,
  UpdateAmbulanceLocationParams,
  UpdateAmbulanceLocationResponse,
  UpdateAmbulanceStatusBody,
  UpdateAmbulanceStatusParams,
  UpdateAmbulanceStatusResponse,
  UpdateHospitalStatusBody,
  UpdateHospitalStatusParams,
  UpdateHospitalStatusResponse,
} from "@workspace/api-zod";
import type { LifelinkEvent, RouteOption } from "../lib/api-types";
import { ambulanceToApi, emergencyToApi, hospitalToApi, readDecision, recalculateDecision } from "../lib/decision-engine";
import { createEmergencyAndDispatch } from "../lib/dispatch";
import { recordEvent } from "../lib/domain-events";
import { requestUser, requireRole } from "../lib/sessions";

const router: IRouter = Router();
const signedIn = requireRole("USER", "DRIVER", "OPERATOR");

function eventToApi(event: typeof eventsTable.$inferSelect): LifelinkEvent {
  return {
    id: event.id,
    emergencyId: event.emergencyId,
    type: event.type,
    message: event.message,
    createdAt: event.createdAt.toISOString(),
  };
}

async function canAccessEmergency(
  user: NonNullable<ReturnType<typeof requestUser>>,
  emergency: typeof emergenciesTable.$inferSelect,
): Promise<boolean> {
  if (user.role === "OPERATOR") return true;
  if (user.role === "USER") return emergency.patientUserId === user.id;
  return emergency.assignedAmbulanceId !== null &&
    driverOwnsAmbulance(emergency.assignedAmbulanceId, user);
}

async function driverOwnsAmbulance(
  ambulanceId: number,
  user: NonNullable<ReturnType<typeof requestUser>>,
): Promise<boolean> {
  if (user.role === "OPERATOR") return true;
  if (user.role !== "DRIVER") return false;
  const [ambulance] = await db
    .select({ driverUserId: ambulancesTable.driverUserId })
    .from(ambulancesTable)
    .where(eq(ambulancesTable.id, ambulanceId))
    .limit(1);
  return ambulance?.driverUserId === user.id;
}

async function getActiveDriverAmbulanceIds(userId: number): Promise<number[]> {
  const owned = await db
    .select({ id: ambulancesTable.id })
    .from(ambulancesTable)
    .where(eq(ambulancesTable.driverUserId, userId));
  return owned.map((ambulance) => ambulance.id);
}

router.get("/dashboard/summary", requireRole("OPERATOR"), async (_req, res): Promise<void> => {
  const [activeEmergencyCount] = await db
    .select({ value: count() })
    .from(emergenciesTable)
    .where(inArray(emergenciesTable.status, ["NEW", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"]));
  const ambulanceRows = await db.select().from(ambulancesTable);
  const hospitalRows = await db.select().from(hospitalsTable);
  const [incidentCount] = await db
    .select({ value: count() })
    .from(roadIncidentsTable)
    .where(eq(roadIncidentsTable.active, true));
  res.json(
    GetDashboardSummaryResponse.parse({
      activeEmergencies: Number(activeEmergencyCount?.value ?? 0),
      availableAmbulances: ambulanceRows.filter(
        (ambulance) => ambulance.status === "AVAILABLE" && ambulance.currentEmergencyId === null,
      ).length,
      totalAmbulances: ambulanceRows.length,
      readyHospitals: hospitalRows.filter(
        (hospital) => hospital.readinessStatus === "READY" && hospital.emergencyStatus === "ACCEPTING",
      ).length,
      totalHospitals: hospitalRows.length,
      averageResponseMinutes: 7,
      activeIncidents: Number(incidentCount?.value ?? 0),
      updatedAt: new Date(),
    }),
  );
});

router.get("/dashboard/events", requireRole("OPERATOR"), async (_req, res): Promise<void> => {
  const rows = await db.select().from(eventsTable).orderBy(desc(eventsTable.createdAt)).limit(60);
  res.json(ListDashboardEventsResponse.parse(rows.map(eventToApi)));
});

router.get("/emergencies", signedIn, async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view emergencies." });
    return;
  }
  const driverAmbulanceIds =
    user.role === "DRIVER" ? await getActiveDriverAmbulanceIds(user.id) : [];
  const rows =
    user.role === "USER"
      ? await db
          .select()
          .from(emergenciesTable)
          .where(eq(emergenciesTable.patientUserId, user.id))
          .orderBy(desc(emergenciesTable.createdAt))
      : user.role === "DRIVER"
        ? await db
            .select()
            .from(emergenciesTable)
            .where(inArray(emergenciesTable.assignedAmbulanceId, driverAmbulanceIds.length ? driverAmbulanceIds : [-1]))
            .orderBy(desc(emergenciesTable.createdAt))
        : await db.select().from(emergenciesTable).orderBy(desc(emergenciesTable.createdAt));
  res.json(ListEmergenciesResponse.parse(rows.map(emergencyToApi)));
});

router.post("/emergencies", requireRole("USER"), async (req, res): Promise<void> => {
  const parsed = CreateEmergencyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the emergency details and location." });
    return;
  }
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to send an SOS." });
    return;
  }
  const emergency = await createEmergencyAndDispatch(parsed.data, user.id);
  res.status(201).json(CreateEmergencyResponse.parse(emergencyToApi(emergency)));
});

router.get("/emergencies/:id", signedIn, async (req, res): Promise<void> => {
  const params = GetEmergencyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid emergency ID." });
    return;
  }
  const [emergency] = await db
    .select()
    .from(emergenciesTable)
    .where(eq(emergenciesTable.id, params.data.id))
    .limit(1);
  if (!emergency) {
    res.status(404).json({ error: "Emergency not found." });
    return;
  }
  const user = requestUser(req);
  if (!user || !(await canAccessEmergency(user, emergency))) {
    res.status(403).json({ error: "This emergency is not assigned to your account." });
    return;
  }
  res.json(GetEmergencyResponse.parse(emergencyToApi(emergency)));
});

router.get("/emergencies/:id/decision", signedIn, async (req, res): Promise<void> => {
  const params = GetEmergencyDecisionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid emergency ID." });
    return;
  }
  const [emergency] = await db
    .select()
    .from(emergenciesTable)
    .where(eq(emergenciesTable.id, params.data.id))
    .limit(1);
  const user = requestUser(req);
  if (!emergency || !user || !(await canAccessEmergency(user, emergency))) {
    res.status(emergency ? 403 : 404).json({ error: emergency ? "This emergency is not available." : "Emergency not found." });
    return;
  }
  const decision = await readDecision(params.data.id);
  if (!decision) {
    res.status(404).json({ error: "No route decision exists yet." });
    return;
  }
  res.json(GetEmergencyDecisionResponse.parse(decision));
});

router.get("/ambulances", signedIn, async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view ambulance status." });
    return;
  }
  let rows = await db.select().from(ambulancesTable).orderBy(ambulancesTable.callSign);
  if (user.role === "DRIVER") {
    rows = rows.filter((ambulance) => ambulance.driverUserId === user.id);
  } else if (user.role === "USER") {
    const emergencies = await db
      .select({ assignedAmbulanceId: emergenciesTable.assignedAmbulanceId })
      .from(emergenciesTable)
      .where(eq(emergenciesTable.patientUserId, user.id));
    const ids = emergencies
      .map((emergency) => emergency.assignedAmbulanceId)
      .filter((id): id is number => id !== null);
    rows = rows.filter((ambulance) => ids.includes(ambulance.id));
  }
  res.json(ListAmbulancesResponse.parse(rows.map(ambulanceToApi)));
});

router.post("/ambulances/:id/accept", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = AcceptEmergencyParams.safeParse(req.params);
  const body = AcceptEmergencyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid dispatch request." });
    return;
  }
  const user = requestUser(req);
  const owns = user ? await driverOwnsAmbulance(params.data.id, user) : false;
  if (!owns) {
    res.status(403).json({ error: "Only the assigned driver can accept this dispatch." });
    return;
  }
  const [ambulance] = await db.select().from(ambulancesTable).where(eq(ambulancesTable.id, params.data.id)).limit(1);
  const [emergency] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, body.data.emergencyId)).limit(1);
  if (!ambulance || !emergency || emergency.assignedAmbulanceId !== ambulance.id) {
    res.status(404).json({ error: "This dispatch is no longer assigned to this ambulance." });
    return;
  }
  await db
    .update(ambulancesTable)
    .set({ status: "EN_ROUTE", currentEmergencyId: emergency.id, lastUpdated: new Date() })
    .where(eq(ambulancesTable.id, ambulance.id));
  await db
    .update(emergenciesTable)
    .set({ status: "ACCEPTED", updatedAt: new Date() })
    .where(eq(emergenciesTable.id, emergency.id));
  await recordEvent("DISPATCH_ACCEPTED", `${ambulance.callSign} accepted the dispatch.`, emergency.id);
  const [updatedAmbulance] = await db.select().from(ambulancesTable).where(eq(ambulancesTable.id, ambulance.id)).limit(1);
  res.json(AcceptEmergencyResponse.parse(ambulanceToApi(updatedAmbulance!)));
});

router.post("/ambulances/:id/decline", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = DeclineEmergencyParams.safeParse(req.params);
  const body = DeclineEmergencyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid dispatch request." });
    return;
  }
  const user = requestUser(req);
  const owns = user ? await driverOwnsAmbulance(params.data.id, user) : false;
  if (!owns) {
    res.status(403).json({ error: "Only the assigned driver can decline this dispatch." });
    return;
  }
  const [ambulance] = await db.select().from(ambulancesTable).where(eq(ambulancesTable.id, params.data.id)).limit(1);
  const [emergency] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, body.data.emergencyId)).limit(1);
  if (!ambulance || !emergency || emergency.assignedAmbulanceId !== ambulance.id) {
    res.status(404).json({ error: "This dispatch is no longer assigned to this ambulance." });
    return;
  }
  await db
    .update(ambulancesTable)
    .set({ status: "AVAILABLE", currentEmergencyId: null, destinationHospitalId: null, etaMinutes: null, lastUpdated: new Date() })
    .where(eq(ambulancesTable.id, ambulance.id));
  const [nextAmbulance] = await db
    .select()
    .from(ambulancesTable)
    .where(and(eq(ambulancesTable.status, "AVAILABLE"), isNull(ambulancesTable.currentEmergencyId)))
    .limit(1);
  await db
    .update(emergenciesTable)
    .set({
      status: nextAmbulance ? "DISPATCHED" : "NEW",
      assignedAmbulanceId: nextAmbulance?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(emergenciesTable.id, emergency.id));
  if (nextAmbulance) {
    await db
      .update(ambulancesTable)
      .set({ currentEmergencyId: emergency.id, destinationHospitalId: emergency.selectedHospitalId, lastUpdated: new Date() })
      .where(eq(ambulancesTable.id, nextAmbulance.id));
    await recalculateDecision(emergency.id, { emitEvent: true });
  }
  await recordEvent("DISPATCH_DECLINED", `${ambulance.callSign} declined; ${nextAmbulance?.callSign ?? "command center"} will take over.`, emergency.id);
  const [updated] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, emergency.id)).limit(1);
  res.json(DeclineEmergencyResponse.parse(emergencyToApi(updated!)));
});

router.post("/ambulances/:id/status", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = UpdateAmbulanceStatusParams.safeParse(req.params);
  const body = UpdateAmbulanceStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid ambulance status." });
    return;
  }
  const user = requestUser(req);
  if (!user || !(await driverOwnsAmbulance(params.data.id, user))) {
    res.status(403).json({ error: "Only the assigned driver can change this ambulance." });
    return;
  }
  const [ambulance] = await db
    .update(ambulancesTable)
    .set({ status: body.data.status, lastUpdated: new Date() })
    .where(eq(ambulancesTable.id, params.data.id))
    .returning();
  if (!ambulance) {
    res.status(404).json({ error: "Ambulance not found." });
    return;
  }
  await recordEvent("AMBULANCE_STATUS_CHANGED", `${ambulance.callSign} status changed to ${ambulance.status}.`, ambulance.currentEmergencyId);
  res.json(UpdateAmbulanceStatusResponse.parse(ambulanceToApi(ambulance)));
});

router.post("/ambulances/:id/location", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = UpdateAmbulanceLocationParams.safeParse(req.params);
  const body = UpdateAmbulanceLocationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid GPS update." });
    return;
  }
  const user = requestUser(req);
  if (!user || !(await driverOwnsAmbulance(params.data.id, user))) {
    res.status(403).json({ error: "Only the assigned driver can send this location." });
    return;
  }
  const [ambulance] = await db
    .update(ambulancesTable)
    .set({
      latitude: body.data.latitude,
      longitude: body.data.longitude,
      speedKph: body.data.speedKph,
      heading: body.data.heading,
      lastUpdated: new Date(),
    })
    .where(eq(ambulancesTable.id, params.data.id))
    .returning();
  if (!ambulance) {
    res.status(404).json({ error: "Ambulance not found." });
    return;
  }
  await db.insert(locationHistoryTable).values({
    ambulanceId: ambulance.id,
    latitude: body.data.latitude,
    longitude: body.data.longitude,
    speedKph: body.data.speedKph,
  });
  await recordEvent("AMBULANCE_LOCATION_UPDATED", `${ambulance.callSign} position updated.`, ambulance.currentEmergencyId);
  res.json(UpdateAmbulanceLocationResponse.parse(ambulanceToApi(ambulance)));
});

router.post("/ambulances/:id/arrived", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = MarkArrivedAtSceneParams.safeParse(req.params);
  const body = MarkArrivedAtSceneBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid scene arrival update." });
    return;
  }
  const user = requestUser(req);
  if (!user || !(await driverOwnsAmbulance(params.data.id, user))) {
    res.status(403).json({ error: "Only the assigned driver can update this dispatch." });
    return;
  }
  const [emergency] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, body.data.emergencyId)).limit(1);
  if (!emergency || emergency.assignedAmbulanceId !== params.data.id) {
    res.status(404).json({ error: "Emergency not found for this ambulance." });
    return;
  }
  await db
    .update(ambulancesTable)
    .set({ status: "ON_SCENE", lastUpdated: new Date() })
    .where(eq(ambulancesTable.id, params.data.id));
  const [updated] = await db
    .update(emergenciesTable)
    .set({ status: "ON_SCENE", updatedAt: new Date() })
    .where(eq(emergenciesTable.id, emergency.id))
    .returning();
  await recordEvent("AMBULANCE_ARRIVED", "Ambulance arrived at the emergency scene.", emergency.id);
  res.json(MarkArrivedAtSceneResponse.parse(emergencyToApi(updated!)));
});

router.post("/ambulances/:id/patient-onboard", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = MarkPatientOnboardParams.safeParse(req.params);
  const body = MarkPatientOnboardBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid patient transport update." });
    return;
  }
  const user = requestUser(req);
  if (!user || !(await driverOwnsAmbulance(params.data.id, user))) {
    res.status(403).json({ error: "Only the assigned driver can update this dispatch." });
    return;
  }
  const [emergency] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, body.data.emergencyId)).limit(1);
  if (!emergency || emergency.assignedAmbulanceId !== params.data.id) {
    res.status(404).json({ error: "Emergency not found for this ambulance." });
    return;
  }
  await db
    .update(ambulancesTable)
    .set({ status: "TRANSPORTING", lastUpdated: new Date() })
    .where(eq(ambulancesTable.id, params.data.id));
  await db
    .update(emergenciesTable)
    .set({ status: "TRANSPORTING", updatedAt: new Date() })
    .where(eq(emergenciesTable.id, emergency.id));
  const decision = await recalculateDecision(emergency.id, { emitEvent: true });
  const [updated] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, emergency.id)).limit(1);
  await recordEvent(
    "PATIENT_ONBOARD",
    `Patient onboard. Transporting to ${decision?.selectedHospitalName ?? "the nearest available hospital"}.`,
    emergency.id,
  );
  res.json(MarkPatientOnboardResponse.parse(emergencyToApi(updated!)));
});

router.post("/ambulances/:id/complete", requireRole("DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const params = CompleteEmergencyParams.safeParse(req.params);
  const body = CompleteEmergencyBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid completion update." });
    return;
  }
  const user = requestUser(req);
  if (!user || !(await driverOwnsAmbulance(params.data.id, user))) {
    res.status(403).json({ error: "Only the assigned driver can complete this transport." });
    return;
  }
  const [emergency] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, body.data.emergencyId)).limit(1);
  if (!emergency || emergency.assignedAmbulanceId !== params.data.id) {
    res.status(404).json({ error: "Emergency not found for this ambulance." });
    return;
  }
  await db
    .update(ambulancesTable)
    .set({
      status: "AVAILABLE",
      currentEmergencyId: null,
      destinationHospitalId: null,
      etaMinutes: null,
      lastUpdated: new Date(),
    })
    .where(eq(ambulancesTable.id, params.data.id));
  const [updated] = await db
    .update(emergenciesTable)
    .set({ status: "COMPLETED", etaMinutes: 0, updatedAt: new Date() })
    .where(eq(emergenciesTable.id, emergency.id))
    .returning();
  await recordEvent("EMERGENCY_COMPLETED", "Hospital handoff complete. Emergency closed.", emergency.id);
  res.json(CompleteEmergencyResponse.parse(emergencyToApi(updated!)));
});

router.get("/hospitals", signedIn, async (_req, res): Promise<void> => {
  const rows = await db.select().from(hospitalsTable).orderBy(hospitalsTable.name);
  res.json(ListHospitalsResponse.parse(rows.map(hospitalToApi)));
});

router.post("/hospitals/:id/status", requireRole("OPERATOR"), async (req, res): Promise<void> => {
  const params = UpdateHospitalStatusParams.safeParse(req.params);
  const body = UpdateHospitalStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid hospital readiness update." });
    return;
  }
  const [hospital] = await db
    .update(hospitalsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(hospitalsTable.id, params.data.id))
    .returning();
  if (!hospital) {
    res.status(404).json({ error: "Hospital not found." });
    return;
  }
  const activeEmergencies = await db
    .select()
    .from(emergenciesTable)
    .where(
      and(
        eq(emergenciesTable.selectedHospitalId, hospital.id),
        inArray(emergenciesTable.status, ["DISPATCHED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "TRANSPORTING"]),
      ),
    );
  await recordEvent("HOSPITAL_STATUS_CHANGED", `${hospital.name} is now ${hospital.readinessStatus.toLowerCase()}.`);
  for (const emergency of activeEmergencies) {
    await recalculateDecision(emergency.id, { emitEvent: true });
  }
  res.json(UpdateHospitalStatusResponse.parse(hospitalToApi(hospital)));
});

router.post("/routes/calculate", requireRole("USER", "DRIVER", "OPERATOR"), async (req, res): Promise<void> => {
  const body = CalculateRoutesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Select a valid emergency to calculate routes." });
    return;
  }
  const [emergency] = await db.select().from(emergenciesTable).where(eq(emergenciesTable.id, body.data.emergencyId)).limit(1);
  const user = requestUser(req);
  if (!emergency || !user || !(await canAccessEmergency(user, emergency))) {
    res.status(emergency ? 403 : 404).json({ error: emergency ? "Emergency is not available to this account." : "Emergency not found." });
    return;
  }
  const decision = await recalculateDecision(emergency.id, { emitEvent: true });
  if (!decision) {
    res.status(409).json({ error: "No safe route is available right now." });
    return;
  }
  const rows = await db.select().from(routesTable).where(eq(routesTable.emergencyId, emergency.id));
  const routes: RouteOption[] = rows.map((route) => ({
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
  }));
  res.json(CalculateRoutesResponse.parse(routes));
});

export default router;
