import { describe, expect, it } from "vitest";
import { InMemoryJobLock } from "../src/jobs/lock.js";

describe("InMemoryJobLock", () => {
  it("prevents the same search from running concurrently and releases afterward", async () => {
    const lock = new InMemoryJobLock();
    let release: (() => void) | undefined;
    const pending = lock.withLock("search:1", () => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    expect(await lock.withLock("search:1", async () => "unexpected")).toBeNull();
    expect(await lock.withLock("search:2", async () => "other")).toBe("other");
    release?.();
    await pending;
    expect(await lock.withLock("search:1", async () => "released")).toBe("released");
  });
});
