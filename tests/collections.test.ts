import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/utils/collections.js";

describe("mapWithConcurrency", () => {
  it("rejects invalid concurrency instead of returning an incomplete result", async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow("concurrency_must_be_a_positive_integer");
  });

  it("drains every worker before reporting mapper failures", async () => {
    const completed: number[] = [];
    await expect(mapWithConcurrency([0, 1, 2], 2, async (value) => {
      if (value === 0) throw new Error("expected_failure");
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed.push(value);
      return value;
    })).rejects.toBeInstanceOf(AggregateError);
    expect(completed.sort()).toEqual([1, 2]);
  });
});
