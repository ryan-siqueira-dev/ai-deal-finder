import { createApplication } from "./app.js";
import { loadConfig } from "./config/env.js";
import { disconnectDatabase } from "./db/client.js";

const config = loadConfig();
const app = createApplication(config);
if (config.SCHEDULER_ENABLED) app.scheduler.start();
else app.logger.info({ event: "scheduler_disabled" }, "Scheduler disabled by configuration");

let shutdownPromise: Promise<void> | null = null;
function shutdown(signal: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    app.logger.info({ event: "shutdown_started", signal }, "Shutting down");
    let failure: unknown;
    try { await app.shutdown(); }
    catch (error) { failure = error; }
    try { await disconnectDatabase(); }
    catch (error) { failure ??= error; }
    if (failure) throw failure;
  })();
  return shutdownPromise;
}

function handleSignal(signal: string): void {
  void shutdown(signal).then(
    () => process.exit(0),
    (error: unknown) => {
      app.logger.fatal({ event: "shutdown_failed", signal, err: error }, "Shutdown failed");
      process.exit(1);
    },
  );
}

process.once("SIGINT", () => { handleSignal("SIGINT"); });
process.once("SIGTERM", () => { handleSignal("SIGTERM"); });
