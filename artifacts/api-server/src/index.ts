import app, { startSimulation } from "./app";
import { logger } from "./lib/logger";
import { ensureSchema } from "@workspace/db";
import { restoreDemoData } from "./lib/seed";

const rawPort = process.env["PORT"] ?? "8080";
// 0.0.0.0 is reachable on the local LAN (and loopback). It is not a public
// internet tunnel. Set HOST=127.0.0.1 to keep the API loopback-only.
const host = process.env["HOST"]?.trim() || "0.0.0.0";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  try {
    await ensureSchema();
    await restoreDemoData();
    startSimulation();
    app.listen(port, host, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port, host }, "Schema and demo data ready; server listening");
    });
  } catch (err) {
    logger.fatal({ err }, "API initialization failed; refusing to serve incomplete data");
    process.exit(1);
  }
}

void start();
