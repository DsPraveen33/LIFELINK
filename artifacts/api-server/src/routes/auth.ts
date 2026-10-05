import { Router, type IRouter } from "express";
import { eq, isNull } from "drizzle-orm";
import { db, ambulancesTable, usersTable } from "@workspace/db";
import {
  DemoLoginResponse,
  GetCurrentUserResponse,
  LoginUserBody,
  LoginUserResponse,
  RegisterUserBody,
  RegisterUserResponse,
} from "@workspace/api-zod";
import {
  clearUserSession,
  createUserSession,
  hashPassword,
  requestUser,
  requireRole,
  verifyPassword,
} from "../lib/sessions";

const router: IRouter = Router();
const loginAttempts = new Map<string, { attempts: number; resetsAt: number }>();
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginAttemptKey(ip: string | undefined): string {
  return ip || "unknown";
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the account details and try again." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account already uses that email address." });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      name: parsed.data.name.trim(),
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      phone: parsed.data.phone ?? null,
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "Your account could not be created." });
    return;
  }

  if (user.role === "DRIVER") {
    const [unassigned] = await db
      .select()
      .from(ambulancesTable)
      .where(isNull(ambulancesTable.driverUserId))
      .limit(1);
    if (unassigned) {
      await db
        .update(ambulancesTable)
        .set({ driverUserId: user.id, driverName: user.name, lastUpdated: new Date() })
        .where(eq(ambulancesTable.id, unassigned.id));
    }
  }

  await createUserSession(user.id, res);
  res.status(201).json(
    RegisterUserResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }),
  );
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const key = loginAttemptKey(req.ip);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && current.resetsAt > now && current.attempts >= MAX_LOGIN_ATTEMPTS) {
    res.status(429).json({ error: "Too many sign-in attempts. Wait a few minutes and try again." });
    return;
  }
  if (current && current.resetsAt <= now) loginAttempts.delete(key);

  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    const previous = loginAttempts.get(key);
    loginAttempts.set(key, {
      attempts: previous && previous.resetsAt > now ? previous.attempts + 1 : 1,
      resetsAt: previous && previous.resetsAt > now ? previous.resetsAt : now + LOGIN_WINDOW_MS,
    });
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }

  loginAttempts.delete(key);
  await createUserSession(user.id, res);
  res.json(
    LoginUserResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }),
  );
});

router.post("/auth/demo-login", async (_req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Demo operator access is disabled." });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, "operator@lifelink.demo"))
    .limit(1);
  if (!user || user.role !== "OPERATOR") {
    res.status(404).json({ error: "The local demo operator account is not available." });
    return;
  }
  await createUserSession(user.id, res);
  res.json(
    DemoLoginResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }),
  );
});

router.get("/auth/me", requireRole(), async (req, res): Promise<void> => {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(user));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await clearUserSession(req, res);
  res.sendStatus(204);
});

export default router;
