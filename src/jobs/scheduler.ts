import cron, { type ScheduledTask } from "node-cron";
import type { Logger } from "pino";
import { prisma } from "../db/client.js";
import type { SearchRunner } from "./search-runner.js";
import type { JobLock } from "./lock.js";

export class SearchScheduler {
  #task: ScheduledTask | null = null;
  readonly #activeTicks = new Set<Promise<void>>();

  public constructor(private readonly runner: SearchRunner, private readonly lock: JobLock, private readonly logger: Logger) {}

  start(): void {
    if (this.#task) return;
    this.#task = cron.schedule("* * * * *", () => { this.scheduleTick(); });
    this.logger.info({ event: "scheduler_started" }, "Search scheduler started");
    this.scheduleTick();
  }

  async stop(): Promise<void> {
    this.#task?.stop();
    this.#task = null;
    this.runner.requestStop?.();
    await Promise.allSettled([...this.#activeTicks]);
  }

  async tick(now = new Date()): Promise<void> {
    const searches = await prisma.search.findMany({ where: { active: true } });
    const dueSearches = searches.filter((search) => {
      const dueAt = search.lastRunAt ? search.lastRunAt.getTime() + search.intervalMinutes * 60_000 : 0;
      return dueAt <= now.getTime();
    });
    await Promise.all(dueSearches.map(async (search) => {
      try {
        const result = await this.lock.withLock(`search:${search.id}`, async () => {
          await this.runner.run(search);
        });
        if (result === null) this.logger.debug({ event: "job_skipped_locked", searchId: search.id }, "Search already running");
      } catch (error) {
        this.logger.error({ event: "job_failed", searchId: search.id, err: error }, "Search job failed");
      }
    }));
  }

  private scheduleTick(): void {
    let pending: Promise<void>;
    pending = this.tick()
      .catch((error: unknown) => {
        this.logger.error({ event: "scheduler_tick_failed", err: error }, "Scheduler tick failed");
      })
      .finally(() => { this.#activeTicks.delete(pending); });
    this.#activeTicks.add(pending);
  }
}
