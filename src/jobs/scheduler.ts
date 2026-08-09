import cron, { type ScheduledTask } from "node-cron";
import type { Logger } from "pino";
import { prisma } from "../db/client.js";
import type { SearchRunner } from "./search-runner.js";
import type { JobLock } from "./lock.js";

export class SearchScheduler {
  #task: ScheduledTask | null = null;

  public constructor(private readonly runner: SearchRunner, private readonly lock: JobLock, private readonly logger: Logger) {}

  start(): void {
    if (this.#task) return;
    this.#task = cron.schedule("* * * * *", () => { void this.tick(); });
    this.logger.info({ event: "scheduler_started" }, "Search scheduler started");
    void this.tick();
  }

  stop(): void {
    this.#task?.stop();
    this.#task = null;
  }

  async tick(now = new Date()): Promise<void> {
    const searches = await prisma.search.findMany({ where: { active: true } });
    for (const search of searches) {
      const dueAt = search.lastRunAt ? search.lastRunAt.getTime() + search.intervalMinutes * 60_000 : 0;
      if (dueAt > now.getTime()) continue;
      const result = await this.lock.withLock(`search:${search.id}`, async () => {
        try { await this.runner.run(search); }
        catch (error) { this.logger.error({ event: "job_failed", searchId: search.id, err: error }, "Search job failed"); }
      });
      if (result === null) this.logger.debug({ event: "job_skipped_locked", searchId: search.id }, "Search already running");
    }
  }
}
