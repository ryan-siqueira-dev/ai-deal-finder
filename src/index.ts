import { createApplication } from "./app.js";
import { loadConfig } from "./config/env.js";
import { disconnectDatabase } from "./db/client.js";

const config = loadConfig();
const app = createApplication(config);
if (config.SCHEDULER_ENABLED) app.scheduler.start();
else app.logger.info({ event: "scheduler_disabled" }, "Scheduler disabled by configuration");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info({ event: "shutdown_started", signal }, "Shutting down");
  await app.shutdown();
  await disconnectDatabase();
}

process.once("SIGINT", () => { void shutdown("SIGINT").then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown("SIGTERM").then(() => process.exit(0)); });
