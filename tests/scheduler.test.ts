import type { Search } from "@prisma/client";
import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryJobLock } from "../src/jobs/lock.js";
import { SearchScheduler } from "../src/jobs/scheduler.js";
import type { SearchRunner } from "../src/jobs/search-runner.js";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../src/db/client.js", () => ({ prisma: { search: { findMany: mocks.findMany } } }));

function loggerFixture(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe("SearchScheduler lifecycle", () => {
  beforeEach(() => { mocks.findMany.mockReset(); });

  it("contains top-level tick failures instead of creating an unhandled rejection", async () => {
    mocks.findMany.mockRejectedValueOnce(new Error("database_down"));
    const logger = loggerFixture();
    const scheduler = new SearchScheduler({ run: vi.fn() } as unknown as SearchRunner, new InMemoryJobLock(), logger);
    scheduler.start();
    await scheduler.stop();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: "scheduler_tick_failed" }), "Scheduler tick failed");
  });

  it("asks the runner to stop accepting work before draining ticks", async () => {
    mocks.findMany.mockResolvedValueOnce([]);
    const requestStop = vi.fn();
    const scheduler = new SearchScheduler({ run: vi.fn(), requestStop } as unknown as SearchRunner, new InMemoryJobLock(), loggerFixture());
    scheduler.start();
    await scheduler.stop();
    expect(requestStop).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight run during shutdown", async () => {
    let release: (() => void) | undefined;
    const running = new Promise<void>((resolve) => { release = resolve; });
    const search = {
      id: "search-1",
      lastRunAt: null,
      intervalMinutes: 60,
    } as Search;
    mocks.findMany.mockResolvedValueOnce([search]);
    const run = vi.fn().mockReturnValue(running);
    const scheduler = new SearchScheduler({ run } as unknown as SearchRunner, new InMemoryJobLock(), loggerFixture());
    scheduler.start();
    await vi.waitFor(() => { expect(run).toHaveBeenCalledOnce(); });
    let stopped = false;
    const stopping = scheduler.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release?.();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("lets an overlapping tick advance other searches while a prior search is still running", async () => {
    let release: (() => void) | undefined;
    const running = new Promise<void>((resolve) => { release = resolve; });
    const firstSearch = { id: "search-1", lastRunAt: null, intervalMinutes: 60 } as Search;
    const secondSearch = { id: "search-2", lastRunAt: null, intervalMinutes: 60 } as Search;
    mocks.findMany
      .mockResolvedValueOnce([firstSearch])
      .mockResolvedValueOnce([firstSearch, secondSearch]);
    const run = vi.fn((search: Search) => search.id === firstSearch.id ? running : Promise.resolve());
    const logger = loggerFixture();
    const scheduler = new SearchScheduler({ run } as unknown as SearchRunner, new InMemoryJobLock(), logger);

    const first = scheduler.tick();
    await vi.waitFor(() => { expect(run).toHaveBeenCalledOnce(); });
    const second = scheduler.tick();
    await vi.waitFor(() => { expect(run).toHaveBeenCalledTimes(2); });
    expect(run.mock.calls.map(([search]) => search.id)).toEqual([firstSearch.id, secondSearch.id]);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ event: "job_skipped_locked", searchId: firstSearch.id }), expect.any(String));
    release?.();
    await Promise.all([first, second]);
  });

  it("dispatches due searches concurrently and isolates individual job failures", async () => {
    let release: (() => void) | undefined;
    const running = new Promise<void>((resolve) => { release = resolve; });
    const searches = [
      { id: "search-slow", lastRunAt: null, intervalMinutes: 60 },
      { id: "search-failing", lastRunAt: null, intervalMinutes: 60 },
      { id: "search-fast", lastRunAt: null, intervalMinutes: 60 },
    ] as Search[];
    mocks.findMany.mockResolvedValueOnce(searches);
    const run = vi.fn((search: Search) => {
      if (search.id === "search-slow") return running;
      if (search.id === "search-failing") return Promise.reject(new Error("provider_down"));
      return Promise.resolve();
    });
    const logger = loggerFixture();
    const scheduler = new SearchScheduler({ run } as unknown as SearchRunner, new InMemoryJobLock(), logger);

    const tick = scheduler.tick();
    await vi.waitFor(() => { expect(run).toHaveBeenCalledTimes(3); });
    expect(run.mock.calls.map(([search]) => search.id)).toEqual(searches.map(({ id }) => id));
    release?.();
    await expect(tick).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "job_failed", searchId: "search-failing", err: expect.any(Error) }),
      "Search job failed",
    );
  });
});
