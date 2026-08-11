import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { seedFlights, seedDemoMember } from "./lib/seed";
import { ensureSimUsers, startQueueSimulation } from "./lib/simulation";
import { ensureSchema } from "@workspace/db";

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

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Ensure DB schema exists, then seed on startup
ensureSchema()
  .then(() => seedFlights())
  .then(() => seedDemoMember())
  .then(() => ensureSimUsers())
  .then(() => {
    startQueueSimulation();
    logger.info("Schema ready, flights seeded, queue simulation running");
  })
  .catch((err) => logger.error({ err }, "Startup DB error"));

export default app;
