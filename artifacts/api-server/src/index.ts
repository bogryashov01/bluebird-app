import app, { startSimulation } from "./app";
import { logger } from "./lib/logger";
import { ensureSchema } from "@workspace/db";
import { restoreDemoData } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  try {
    await ensureSchema();
    await restoreDemoData();
    startSimulation();
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Schema and demo data ready; server listening");
    });
  } catch (err) {
    logger.fatal({ err }, "API initialization failed; refusing to serve incomplete data");
    process.exit(1);
  }
}

void start();
