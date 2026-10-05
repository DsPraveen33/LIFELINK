import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, authSessionsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { logAuditEvent } from "./audit";

export type AccountRole = "USER" | "DRIVER" | "OPERATOR" | "ADMIN";

export type PublicUser = {
  id: number;
  name: string;
  email: string;
  role: AccountRole;
  phone: string | null;
};

const SESSION_COOKIE = "ll_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function sessionDigest(token: string): string {
  const secret = process.env.SESSION_SECRET || "lifelink_secure_session_secret_default_2026";
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, salt, expectedHex] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user: typeof usersTable.$inferSelect): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as AccountRole,
    phone: user.phone,
  };
}

export async function createUserSession(
  userId: number,
  res?: Parameters<RequestHandler>[1],
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(authSessionsTable).values({
    tokenHash: sessionDigest(token),
    userId,
    expiresAt,
  });
  if (res) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS,
    });
  }
  return token;
}

export async function clearUserSession(
  req: Request,
  res: Parameters<RequestHandler>[1],
): Promise<void> {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const token = cookies?.[SESSION_COOKIE] || bearerToken;
  if (token) {
    await db.delete(authSessionsTable).where(eq(authSessionsTable.tokenHash, sessionDigest(token)));
  }
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function authenticateSessionToken(token: string | null | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  try {
    const now = new Date();
    const [session] = await db
      .select({ userId: authSessionsTable.userId })
      .from(authSessionsTable)
      .where(and(eq(authSessionsTable.tokenHash, sessionDigest(token)), gt(authSessionsTable.expiresAt, now)))
      .limit(1);
    if (!session) return null;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
    return user ? publicUser(user) : null;
  } catch (error) {
    logger.warn({ error }, "Could not resolve LIFELINK session");
    return null;
  }
}

export async function currentUserFromRequest(req: Request): Promise<PublicUser | null> {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  const token = cookies?.[SESSION_COOKIE] || bearerToken;
  return authenticateSessionToken(token);
}

export function requireRole(...roles: AccountRole[]): RequestHandler {
  return async (req, res, next) => {
    const user = await currentUserFromRequest(req);
    if (!user) {
      void logAuditEvent({
        action: "PERMISSION_DENIED",
        resourceType: "API_ENDPOINT",
        resourceId: req.originalUrl,
        ipAddress: req.ip,
        metadata: { reason: "UNAUTHENTICATED", method: req.method },
      });
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    if (roles.length > 0 && !roles.includes(user.role)) {
      void logAuditEvent({
        actorUserId: user.id,
        actorRole: user.role,
        action: "PERMISSION_DENIED",
        resourceType: "API_ENDPOINT",
        resourceId: req.originalUrl,
        ipAddress: req.ip,
        metadata: { requiredRoles: roles, actualRole: user.role, method: req.method },
      });
      res.status(403).json({ error: "You don't have permission to access this information." });
      return;
    }
    (req as Request & { lifelinkUser: PublicUser }).lifelinkUser = user;
    next();
  };
}

export const requireAuth = (): RequestHandler => requireRole();

export function requestUser(req: Request): PublicUser | null {
  return (req as Request & { lifelinkUser?: PublicUser }).lifelinkUser ?? null;
}
