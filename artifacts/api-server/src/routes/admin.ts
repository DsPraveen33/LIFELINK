import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { hashPassword, requestUser, requireRole } from "../lib/sessions";
import { logAuditEvent } from "../lib/audit";

const router: IRouter = Router();

// Section 5 & 27: Admin Audit Logs
router.get("/admin/audit-logs", requireRole("ADMIN"), async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const rows = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.timestamp))
    .limit(limit);

  res.json(
    rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorRole: row.actorRole,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      ipAddress: row.ipAddress,
      metadata: row.metadata,
      timestamp: row.timestamp.toISOString(),
    })),
  );
});

// Section 5 & 8: Admin Manage Users
router.get("/admin/users", requireRole("ADMIN"), async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      phone: usersTable.phone,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.id);

  res.json(rows);
});

// Section 8: Controlled creation of Driver and Operator accounts by Admin
router.post("/admin/users", requireRole("ADMIN"), async (req, res): Promise<void> => {
  const admin = requestUser(req);
  const { name, email, password, role, phone } = req.body;

  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "Name, email, password, and valid role are required." });
    return;
  }

  const validRoles = ["USER", "DRIVER", "OPERATOR", "ADMIN"];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role specified." });
    return;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, cleanEmail))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "An account already exists with that email address." });
    return;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash: hashPassword(String(password)),
      role: String(role),
      phone: phone ? String(phone).trim() : null,
    })
    .returning();

  void logAuditEvent({
    actorUserId: admin?.id,
    actorRole: admin?.role,
    action: "ADMIN_ACTION",
    resourceType: "USER",
    resourceId: created.id,
    ipAddress: req.ip,
    metadata: { createdRole: created.role, createdEmail: created.email },
  });

  res.status(201).json({
    id: created.id,
    name: created.name,
    email: created.email,
    role: created.role,
    phone: created.phone,
  });
});

// Admin delete account
router.delete("/admin/users/:id", requireRole("ADMIN"), async (req, res): Promise<void> => {
  const admin = requestUser(req);
  const targetId = Number(req.params.id);

  if (!targetId || targetId === admin?.id) {
    res.status(400).json({ error: "Cannot delete current administrator account." });
    return;
  }

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, targetId))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  void logAuditEvent({
    actorUserId: admin?.id,
    actorRole: admin?.role,
    action: "ADMIN_ACTION",
    resourceType: "USER",
    resourceId: targetId,
    ipAddress: req.ip,
    metadata: { deletedEmail: deleted.email },
  });

  res.json({ success: true, message: `Account ${deleted.email} deleted.` });
});

export default router;
