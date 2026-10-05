import type { Server, Socket } from "socket.io";
import type { Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, ambulancesTable, emergenciesTable } from "@workspace/db";
import { authenticateSessionToken, type PublicUser } from "./sessions";
import { logAuditEvent } from "./audit";
import { logger } from "./logger";

let io: Server | null = null;

export type RealtimeChange = {
  type: string;
  emergencyId: number | null;
  occurredAt: string;
  ambulanceId?: number | null;
  hospitalId?: number | null;
  metadata?: Record<string, unknown>;
};

export function attachRealtime(server: Server): void {
  io = server;

  // Socket Authentication Middleware - Security Section 26
  io.use(async (socket: Socket, next) => {
    try {
      // 1. Check cookies
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const match = /(?:^|;\s*)ll_session=([^;]+)/.exec(cookieHeader);
      let token = match?.[1] ? decodeURIComponent(match[1]) : null;

      // 2. Check auth payload or authorization header
      if (!token && socket.handshake.auth?.token) {
        token = socket.handshake.auth.token;
      }
      if (!token && socket.handshake.headers.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        if (authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        }
      }

      const user = await authenticateSessionToken(token);
      if (!user) {
        void logAuditEvent({
          action: "PERMISSION_DENIED",
          resourceType: "WEBSOCKET",
          metadata: { reason: "INVALID_OR_MISSING_TOKEN" },
        });
        next(new Error("Authentication required"));
        return;
      }

      socket.data.user = user;
      next();
    } catch (error) {
      logger.warn({ error }, "Socket authentication failed");
      next(new Error("Authentication required"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as PublicUser;

    // Join secure role-aware rooms
    socket.join(`user:${user.id}`);

    if (user.role === "DRIVER") {
      socket.join(`driver:${user.id}`);
    } else if (user.role === "OPERATOR") {
      socket.join("operator:command-center");
    } else if (user.role === "ADMIN") {
      socket.join("operator:command-center");
      socket.join("admin:console");
    }

    // Verify permission before joining an emergency room - Security Section 26
    socket.on("emergency:join", async (data: { emergencyId: number }) => {
      const emergencyId = Number(data?.emergencyId);
      if (!emergencyId) return;

      const [emergency] = await db
        .select()
        .from(emergenciesTable)
        .where(eq(emergenciesTable.id, emergencyId))
        .limit(1);

      if (!emergency) {
        socket.emit("error", { message: "Emergency not found" });
        return;
      }

      let authorized = false;
      if (user.role === "OPERATOR" || user.role === "ADMIN") {
        authorized = true;
      } else if (user.role === "USER" && emergency.patientUserId === user.id) {
        authorized = true;
      } else if (user.role === "DRIVER" && emergency.assignedAmbulanceId) {
        const [amb] = await db
          .select({ driverUserId: ambulancesTable.driverUserId })
          .from(ambulancesTable)
          .where(eq(ambulancesTable.id, emergency.assignedAmbulanceId))
          .limit(1);
        if (amb?.driverUserId === user.id) authorized = true;
      }

      if (authorized) {
        socket.join(`emergency:${emergencyId}`);
        socket.emit("emergency:joined", { emergencyId });
      } else {
        void logAuditEvent({
          actorUserId: user.id,
          actorRole: user.role,
          action: "PERMISSION_DENIED",
          resourceType: "WEBSOCKET_ROOM",
          resourceId: `emergency:${emergencyId}`,
          metadata: { reason: "UNAUTHORIZED_ROOM_JOIN" },
        });
        socket.emit("error", { message: "You don't have permission to access this information." });
      }
    });

    socket.emit("lifelink:connected", { role: user.role, userId: user.id });
  });
}

// Security Section 25: Targeted room dispatch - do NOT broadcast everything to all users
export async function publishRealtimeChange(change: RealtimeChange): Promise<void> {
  if (!io) return;

  const targetRooms = new Set<string>();

  // Command center and admins always receive operational updates
  targetRooms.add("operator:command-center");
  targetRooms.add("admin:console");

  if (change.emergencyId) {
    targetRooms.add(`emergency:${change.emergencyId}`);

    // Look up assigned patient and driver to add their targeted rooms
    const [emergency] = await db
      .select({
        patientUserId: emergenciesTable.patientUserId,
        assignedAmbulanceId: emergenciesTable.assignedAmbulanceId,
      })
      .from(emergenciesTable)
      .where(eq(emergenciesTable.id, change.emergencyId))
      .limit(1);

    if (emergency?.patientUserId) {
      targetRooms.add(`user:${emergency.patientUserId}`);
    }

    if (emergency?.assignedAmbulanceId) {
      const [amb] = await db
        .select({ driverUserId: ambulancesTable.driverUserId })
        .from(ambulancesTable)
        .where(eq(ambulancesTable.id, emergency.assignedAmbulanceId))
        .limit(1);
      if (amb?.driverUserId) {
        targetRooms.add(`driver:${amb.driverUserId}`);
      }
    }
  } else if (change.ambulanceId) {
    const [amb] = await db
      .select({
        driverUserId: ambulancesTable.driverUserId,
        currentEmergencyId: ambulancesTable.currentEmergencyId,
      })
      .from(ambulancesTable)
      .where(eq(ambulancesTable.id, change.ambulanceId))
      .limit(1);

    if (amb?.driverUserId) {
      targetRooms.add(`driver:${amb.driverUserId}`);
    }

    if (amb?.currentEmergencyId) {
      targetRooms.add(`emergency:${amb.currentEmergencyId}`);
      const [em] = await db
        .select({ patientUserId: emergenciesTable.patientUserId })
        .from(emergenciesTable)
        .where(eq(emergenciesTable.id, amb.currentEmergencyId))
        .limit(1);
      if (em?.patientUserId) {
        targetRooms.add(`user:${em.patientUserId}`);
      }
    }
  }

  // Dispatch only to authorized rooms
  for (const room of targetRooms) {
    io.to(room).emit("lifelink:changed", change);
    io.to(room).emit("lifelink:event", change);
    io.to(room).emit("emergency:updated", change);
    io.to(room).emit("ambulance:updated", change);
    io.to(room).emit("hospital:updated", change);
    io.to(room).emit("dashboard:updated", change);
    io.to(room).emit("simulation:updated", change);
    if (change.type === "SOS_RECEIVED") {
      io.to(room).emit("emergency:created", change);
    }
  }
}

export function getSocketSessionUser(req: Request): Promise<PublicUser | null> {
  const request = req as Request & { cookies?: Record<string, string> };
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const token = request.cookies?.ll_session || bearerToken;
  return authenticateSessionToken(token);
}

export const requireRealtimeSession: RequestHandler = async (req, res, next) => {
  const user = await getSocketSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to connect to live updates." });
    return;
  }
  next();
};
