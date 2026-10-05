import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  ResetSimulationResponse,
  RunFullDemoResponse,
  RunSimulationActionBody,
  RunSimulationActionResponse,
} from "@workspace/api-zod";
import { performSimulationAction, resetSimulation, runFullDemo } from "../lib/simulation";
import { requestUser, requireRole } from "../lib/sessions";
import { logAuditEvent } from "../lib/audit";

const router: IRouter = Router();

router.post("/simulation/action", requireRole("OPERATOR", "ADMIN"), async (req, res): Promise<void> => {
  const parsed = RunSimulationActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid simulation action." });
    return;
  }
  const user = requestUser(req);
  const result = await performSimulationAction(parsed.data, user?.id ?? null);

  void logAuditEvent({
    actorUserId: user?.id,
    actorRole: user?.role,
    action: "SIMULATION_ACTION",
    resourceType: "SIMULATION",
    ipAddress: req.ip,
    metadata: { action: parsed.data.action, emergencyId: parsed.data.emergencyId },
  });

  res.json(RunSimulationActionResponse.parse(result));
});

router.post("/simulation/run-demo", requireRole("OPERATOR", "ADMIN"), async (req, res): Promise<void> => {
  const user = requestUser(req);
  const [patient] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "USER")).limit(1);
  const result = await runFullDemo(patient?.id ?? null);

  void logAuditEvent({
    actorUserId: user?.id,
    actorRole: user?.role,
    action: "SIMULATION_DEMO_RUN",
    resourceType: "SIMULATION",
    ipAddress: req.ip,
  });

  res.json(RunFullDemoResponse.parse(result));
});

router.post("/simulation/reset", requireRole("OPERATOR", "ADMIN"), async (req, res): Promise<void> => {
  const user = requestUser(req);
  const result = await resetSimulation();

  void logAuditEvent({
    actorUserId: user?.id,
    actorRole: user?.role,
    action: "SIMULATION_RESET",
    resourceType: "SIMULATION",
    ipAddress: req.ip,
  });

  res.json(ResetSimulationResponse.parse(result));
});

export default router;
