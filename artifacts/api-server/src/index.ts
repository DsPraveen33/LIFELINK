import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { attachRealtime } from "./lib/realtime";
import { seedLifelinkData } from "./lib/seed";
import { initDb } from "@workspace/db";

const rawPort = process.env["PORT"] || "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
const socketServer = new SocketServer(httpServer, {
  path: "/api/socket.io",
  serveClient: false,
  cors: {
    origin: "*",
    credentials: true,
  },
});
attachRealtime(socketServer);

async function startServer(): Promise<void> {
  try {
    await initDb();
    await seedLifelinkData();
    httpServer.listen(port, () => {
      logger.info({ port }, "LIFELINK API and Socket.IO server listening");
    });
  } catch (error) {
    logger.error({ error }, "LIFELINK startup failed");
    process.exit(1);
  }
}

void startServer();
