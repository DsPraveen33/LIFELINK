import { db, auditLogsTable, type InsertAuditLog } from "@workspace/db";
import { logger } from "./logger";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "FAILED_LOGIN"
  | "EMERGENCY_CREATED"
  | "EMERGENCY_VIEWED"
  | "AMBULANCE_ASSIGNED"
  | "ROUTE_CHANGED"
  | "HOSPITAL_CHANGED"
  | "HOSPITAL_STATUS_CHANGED"
  | "ADMIN_ACTION"
  | "PERMISSION_DENIED"
  | "LOCATION_PERMISSION_GRANTED"
  | "LOCATION_PERMISSION_REVOKED";

export interface LogAuditParams {
  actorUserId?: number | null;
  actorRole?: string;
  action: AuditAction | string;
  resourceType: string;
  resourceId?: string | number | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(params: LogAuditParams): Promise<void> {
  try {
    const payload: InsertAuditLog = {
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? "ANONYMOUS",
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId != null ? String(params.resourceId) : null,
      ipAddress: params.ipAddress ?? null,
      metadata: params.metadata ?? {},
    };
    await db.insert(auditLogsTable).values(payload);
  } catch (error) {
    logger.warn({ error, params }, "Failed to write audit log entry");
  }
}
