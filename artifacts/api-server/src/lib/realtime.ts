import type { Server } from "socket.io";
import type { Request, RequestHandler } from "express";
import { authenticateSessionToken } from "./sessions";
import { logger } from "./logger";

let io: Server | null = null;

export type RealtimeChange = {
  type: string;
  emergencyId: number | null;
  occurredAt: string;
};

export function attachRealtime(server: Server): void {
  io = server;
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const match = /(?:^|;\s*)ll_session=([^;]+)/.exec(cookieHeader);
      const token = match?.[1] ? decodeURIComponent(match[1]) : null;
      const user = await authenticateSessionToken(token);
      if (!user) {
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

  io.on("connection", (socket) => {
    const user = socket.data.user as { id: number; role: string };
    socket.join(`role:${user.role}`);
    if (user.role === "USER") socket.join(`patient:${user.id}`);
    socket.emit("lifelink:connected", { role: user.role });
  });
}

export function publishRealtimeChange(change: RealtimeChange): void {
  io?.emit("lifelink:changed", change);
  io?.emit("lifelink:event", change);
  io?.emit("emergency:updated", change);
  io?.emit("ambulance:updated", change);
  io?.emit("hospital:updated", change);
  io?.emit("dashboard:updated", change);
  io?.emit("simulation:updated", change);
  if (change.type === "SOS_RECEIVED") {
    io?.emit("emergency:created", change);
  }
}

export function getSocketSessionUser(req: Request): Promise<unknown> {
  const request = req as Request & { cookies?: Record<string, string> };
  return authenticateSessionToken(request.cookies?.ll_session ?? null);
}

export const requireRealtimeSession: RequestHandler = async (req, res, next) => {
  const user = await getSocketSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to connect to live updates." });
    return;
  }
  next();
};
