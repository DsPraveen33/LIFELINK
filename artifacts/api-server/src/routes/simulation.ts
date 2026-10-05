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

const router: IRouter = Router();

router.post("/simulation/action", requireRole("OPERATOR"), async (req, res): Promise<void> => {
  const parsed = RunSimulationActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid simulation action." });
    return;
  }
  const user = requestUser(req);
  const result = await performSimulationAction(parsed.data, user?.id ?? null);
  res.json(RunSimulationActionResponse.parse(result));
});

router.post("/simulation/run-demo", requireRole("OPERATOR"), async (_req, res): Promise<void> => {
  const [patient] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "USER")).limit(1);
  const result = await runFullDemo(patient?.id ?? null);
  res.json(RunFullDemoResponse.parse(result));
});

router.post("/simulation/reset", requireRole("OPERATOR"), async (_req, res): Promise<void> => {
  const result = await resetSimulation();
  res.json(ResetSimulationResponse.parse(result));
});

export default router;
