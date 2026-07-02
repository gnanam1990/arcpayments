import { describe, expect, it } from "vitest";
import { pollWithBackoff } from "../src/poll";

describe("pollWithBackoff", () => {
  it("stops as soon as the predicate is satisfied", async () => {
    let n = 0;
    const out = await pollWithBackoff(
      async () => ++n,
      (v) => v >= 3,
      { maxAttempts: 10, sleep: async () => {} },
    );
    expect(out.value).toBe(3);
    expect(out.attempts).toBe(3);
    expect(out.timedOut).toBe(false);
  });

  it("uses exponential backoff between attempts (not a busy loop)", async () => {
    const delays: number[] = [];
    await pollWithBackoff(
      async () => "pending",
      (v) => v === "done",
      { maxAttempts: 4, baseDelayMs: 100, factor: 2, sleep: async (ms) => void delays.push(ms) },
    );
    // one sleep between each of the 4 attempts' retries: 100, 200, 400 (no sleep after the last)
    expect(delays).toEqual([100, 200, 400]);
  });

  it("caps the delay at maxDelayMs", async () => {
    const delays: number[] = [];
    await pollWithBackoff(
      async () => "pending",
      () => false,
      {
        maxAttempts: 5,
        baseDelayMs: 100,
        factor: 10,
        maxDelayMs: 500,
        sleep: async (ms) => void delays.push(ms),
      },
    );
    expect(delays.every((d) => d <= 500)).toBe(true);
    expect(delays).toContain(500);
  });

  it("times out cleanly after maxAttempts without throwing", async () => {
    const out = await pollWithBackoff(
      async () => "pending",
      (v) => v === "done",
      {
        maxAttempts: 3,
        sleep: async () => {},
      },
    );
    expect(out.timedOut).toBe(true);
    expect(out.attempts).toBe(3);
    expect(out.value).toBe("pending");
  });
});
