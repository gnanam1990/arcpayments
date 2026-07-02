/** Options for {@link pollWithBackoff}. */
export interface PollOptions {
  /** Max attempts before giving up (default 10). */
  maxAttempts?: number;
  /** Initial delay between attempts, ms (default 1000). */
  baseDelayMs?: number;
  /** Backoff multiplier (default 2). */
  factor?: number;
  /** Delay cap, ms (default 30000). */
  maxDelayMs?: number;
  /** Injectable sleep (tests pass a no-op that records delays). */
  sleep?: (ms: number) => Promise<void>;
}

export interface PollOutcome<T> {
  value: T;
  attempts: number;
  timedOut: boolean;
}

/**
 * Call `fn` repeatedly until `done(value)` is true or `maxAttempts` is reached,
 * sleeping with **exponential backoff** between attempts (never a busy loop). On
 * timeout it returns cleanly with `timedOut: true` and the last value — callers
 * surface that rather than hanging.
 */
export async function pollWithBackoff<T>(
  fn: () => Promise<T>,
  done: (value: T) => boolean,
  options: PollOptions = {},
): Promise<PollOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? 10;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const factor = options.factor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let value = await fn();
  let attempts = 1;
  while (!done(value) && attempts < maxAttempts) {
    const delay = Math.min(baseDelayMs * factor ** (attempts - 1), maxDelayMs);
    await sleep(delay);
    value = await fn();
    attempts += 1;
  }
  return { value, attempts, timedOut: !done(value) };
}
