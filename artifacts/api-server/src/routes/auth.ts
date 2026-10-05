import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
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
import { logAuditEvent } from "../lib/audit";

const router: IRouter = Router();
const loginAttempts = new Map<string, { attempts: number; resetsAt: number }>();
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginAttemptKey(ip: string | undefined): string {
  return ip || "unknown";
}

router.post("/auth/register", async (req, res): Promise<void> => {
  // Security Section 8: Public registration should only allow USER. Never allow public registration for ADMIN or OPERATOR.
  // We sanitize the role attribute to always be USER regardless of what was submitted.
  const raw = typeof req.body === "object" && req.body !== null ? req.body : {};
  const payload = { ...raw, role: "USER" };
  const parsed = RegisterUserBody.safeParse(payload);
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

  const assignedRole = "USER";

  const [user] = await db
    .insert(usersTable)
    .values({
      name: parsed.data.name.trim(),
      email,
      passwordHash: hashPassword(parsed.data.password),
      role: assignedRole,
      phone: parsed.data.phone ?? null,
    })
    .returning();
  if (!user) {
    res.status(500).json({ error: "Your account could not be created." });
    return;
  }

  const token = await createUserSession(user.id, res);

  void logAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "LOGIN",
    resourceType: "AUTH_SESSION",
    resourceId: user.id,
    ipAddress: req.ip,
    metadata: { method: "REGISTRATION" },
  });

  res.status(201).json({
    ...RegisterUserResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }),
    token,
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const key = loginAttemptKey(req.ip);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && current.resetsAt > now && current.attempts >= MAX_LOGIN_ATTEMPTS) {
    void logAuditEvent({
      action: "FAILED_LOGIN",
      resourceType: "RATE_LIMIT",
      ipAddress: req.ip,
      metadata: { reason: "RATE_LIMITED" },
    });
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

  // Security Section 9: Do not reveal whether email exists. Use timing-safe generic message.
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    const previous = loginAttempts.get(key);
    loginAttempts.set(key, {
      attempts: previous && previous.resetsAt > now ? previous.attempts + 1 : 1,
      resetsAt: previous && previous.resetsAt > now ? previous.resetsAt : now + LOGIN_WINDOW_MS,
    });
    void logAuditEvent({
      action: "FAILED_LOGIN",
      resourceType: "AUTH_CREDENTIALS",
      ipAddress: req.ip,
      metadata: { attemptedEmail: email },
    });
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  loginAttempts.delete(key);
  const token = await createUserSession(user.id, res);

  void logAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "LOGIN",
    resourceType: "AUTH_SESSION",
    resourceId: user.id,
    ipAddress: req.ip,
    metadata: { role: user.role },
  });

  res.json({
    ...LoginUserResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }),
    token,
  });
});

// Quick switch / demo login for authorized demo roles in development
router.post("/auth/demo-login", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Demo access is disabled in production." });
    return;
  }
  const targetEmail = (req.body?.email as string) || "operator@lifelink.demo";
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, targetEmail))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "Demo account not found." });
    return;
  }

  const token = await createUserSession(user.id, res);

  void logAuditEvent({
    actorUserId: user.id,
    actorRole: user.role,
    action: "LOGIN",
    resourceType: "DEMO_SESSION",
    resourceId: user.id,
    ipAddress: req.ip,
    metadata: { role: user.role },
  });

  res.json({
    ...DemoLoginResponse.parse({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    }),
    token,
  });
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
  const user = requestUser(req);
  if (user) {
    void logAuditEvent({
      actorUserId: user.id,
      actorRole: user.role,
      action: "LOGOUT",
      resourceType: "AUTH_SESSION",
      resourceId: user.id,
      ipAddress: req.ip,
    });
  }
  await clearUserSession(req, res);
  res.sendStatus(204);
});

export default router;
