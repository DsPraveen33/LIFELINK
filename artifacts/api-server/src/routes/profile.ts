import { Router, type IRouter } from "express";
import { count, desc, eq, and } from "drizzle-orm";
import { db, ambulancesTable, emergenciesTable, usersTable } from "@workspace/db";
import { requestUser, requireAuth, requireRole } from "../lib/sessions";
import { logAuditEvent } from "../lib/audit";

const router: IRouter = Router();

// User Profile Screen - Section 33
router.get("/users/me/profile", requireRole("USER", "ADMIN"), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view profile." });
    return;
  }

  const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  if (!dbUser) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  const [emergencyCount] = await db
    .select({ value: count() })
    .from(emergenciesTable)
    .where(eq(emergenciesTable.patientUserId, user.id));

  const [activeEmergency] = await db
    .select()
    .from(emergenciesTable)
    .where(eq(emergenciesTable.patientUserId, user.id))
    .orderBy(desc(emergenciesTable.createdAt))
    .limit(1);

  res.json({
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    phone: dbUser.phone,
    createdAt: dbUser.createdAt,
    totalEmergencies: Number(emergencyCount?.value ?? 0),
    activeEmergency: activeEmergency || null,
  });
});

// Update own profile fields - Section 2 & 33
router.patch("/users/me/profile", requireAuth(), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const { name, phone } = req.body;
  const updates: Partial<{ name: string; phone: string | null }> = {};
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (phone !== undefined) updates.phone = typeof phone === "string" ? phone.trim() : null;

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, user.id))
    .returning();

  void logAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "PROFILE_UPDATED",
    resourceType: "USER",
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    phone: updated.phone,
  });
});

// Location permission grant/revoke - Sections 15, 18, 27
router.post("/users/me/location-permission", requireAuth(), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const granted = Boolean(req.body?.granted);
  const mode = req.body?.mode || (granted ? "LIVE GPS" : "MANUAL");

  void logAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: granted ? "LOCATION_PERMISSION_GRANTED" : "LOCATION_PERMISSION_REVOKED",
    resourceType: "LOCATION_PERMISSION",
    resourceId: user.id,
    ipAddress: req.ip,
    metadata: { mode, granted },
  });

  res.json({
    success: true,
    locationPermission: granted ? "ALLOWED" : "DENIED",
    currentMode: mode,
  });
});

// Driver Profile Screen - Section 34
router.get("/driver/me/profile", requireRole("DRIVER", "ADMIN"), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const [ambulance] = await db
    .select()
    .from(ambulancesTable)
    .where(eq(ambulancesTable.driverUserId, user.id))
    .limit(1);

  let activeEmergency = null;
  if (ambulance?.currentEmergencyId) {
    const [em] = await db
      .select()
      .from(emergenciesTable)
      .where(eq(emergenciesTable.id, ambulance.currentEmergencyId))
      .limit(1);
    activeEmergency = em || null;
  }

  res.json({
    driverName: user.name,
    driverId: user.id,
    email: user.email,
    phone: user.phone,
    assignedAmbulance: ambulance
      ? {
          id: ambulance.id,
          callSign: ambulance.callSign,
          vehicleNumber: ambulance.vehicleNumber,
          status: ambulance.status,
          isOnline: ambulance.status !== "OFFLINE",
          latitude: ambulance.latitude,
          longitude: ambulance.longitude,
          equipment: ambulance.equipment,
        }
      : null,
    activeEmergency,
  });
});

// Driver Availability Toggle (ONLINE / OFFLINE) - Section 3, 19
router.post("/driver/me/availability", requireRole("DRIVER", "ADMIN"), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const isOnline = Boolean(req.body?.isOnline);
  const newStatus = isOnline ? "AVAILABLE" : "OFFLINE";

  const [ambulance] = await db
    .select()
    .from(ambulancesTable)
    .where(eq(ambulancesTable.driverUserId, user.id))
    .limit(1);

  if (!ambulance) {
    res.status(404).json({ error: "No ambulance assigned to your account." });
    return;
  }

  const [updated] = await db
    .update(ambulancesTable)
    .set({ status: newStatus, lastUpdated: new Date() })
    .where(eq(ambulancesTable.id, ambulance.id))
    .returning();

  void logAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: isOnline ? "DRIVER_ONLINE" : "DRIVER_OFFLINE",
    resourceType: "AMBULANCE",
    resourceId: ambulance.id,
    ipAddress: req.ip,
    metadata: { status: newStatus },
  });

  res.json({
    success: true,
    isOnline,
    ambulanceStatus: updated.status,
  });
});

// Operator Profile - Section 35
router.get("/operator/me/profile", requireRole("OPERATOR", "ADMIN"), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  res.json({
    operatorName: user.name,
    operatorId: user.id,
    role: user.role,
    shiftStatus: "ACTIVE",
    facility: "Tirupati Emergency Command Center (108 Control)",
  });
});

export default router;
