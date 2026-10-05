import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

import path from "node:path";
import fs from "node:fs";
import { initDb } from "@workspace/db";
import { seedLifelinkData } from "./lib/seed";

let initDbPromise: Promise<void> | null = null;
async function ensureDatabaseInitialized() {
  if (!initDbPromise) {
    initDbPromise = (async () => {
      await initDb();
      await seedLifelinkData();
    })();
  }
  return initDbPromise;
}

app.use(async (req, res, next) => {
  if (req.path.startsWith("/api")) {
    try {
      await ensureDatabaseInitialized();
    } catch (err) {
      logger.error({ err }, "Database initialization error");
    }
  }
  next();
});

app.use("/api", router);

// Serve frontend assets if built
const frontendDist = path.resolve(__dirname, "../../lifelink/dist/public");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
