import type { Hex } from "viem";
import {
  type ExactPaymentPayload,
  type PaymentRequirements,
  type PaywallGuard,
  type ResourceInfo,
  type SettlementQueue,
  type SettlementRecord,
  signExactPayment,
} from "./paywall";
import { GuardDeniedError, type PaymentIntent, type SpendGuard } from "./spend-guard";
import type { Wallet } from "./wallet";

/** Build the concrete payment intent the guards inspect, from a 402 challenge. */
function intentFromRequirements(requirements: PaymentRequirements): PaymentIntent {
  return { amount: BigInt(requirements.amount), recipient: requirements.payTo };
}

/**
 * Buyer agent primitives (Stage 4): drive the x402 challenge → sign → retry flow,
 * loop it with hard safety caps, and flush verified payments to Circle Gateway for
 * batch settlement. Transport-agnostic — the seam below is satisfied by an MCP
 * client, an HTTP client, or an in-process guard.
 */

/** What a paid-tool call returns: a challenge, the result, or a rejection. */
export type PaidResponse =
  | { kind: "challenge"; requirements: PaymentRequirements; resource?: ResourceInfo }
  | { kind: "result"; content: unknown }
  | {
      kind: "rejected";
      reason: string;
      requirements: PaymentRequirements;
      resource?: ResourceInfo;
    };

/** Seam for the paid-tool endpoint. `request()` with no proof yields the challenge. */
export interface PaidToolTransport {
  request(payment?: ExactPaymentPayload): Promise<PaidResponse>;
}

/** Build an in-process transport from a seller {@link PaywallGuard} (tests / local use). */
export function guardTransport<T>(guard: PaywallGuard, run: () => Promise<T>): PaidToolTransport {
  return {
    async request(payment) {
      const outcome = await guard.guard(payment, run);
      if (outcome.status === "payment-required") {
        return {
          kind: "challenge",
          requirements: outcome.requirements,
          ...(outcome.resource ? { resource: outcome.resource } : {}),
        };
      }
      if (outcome.status === "rejected") {
        return {
          kind: "rejected",
          reason: outcome.reason,
          requirements: outcome.requirements,
          ...(outcome.resource ? { resource: outcome.resource } : {}),
        };
      }
      return { kind: "result", content: outcome.result };
    },
  };
}

/** Options for a single paid call. Signing goes through the {@link Wallet} seam. */
export interface PayForCallOptions {
  transport: PaidToolTransport;
  wallet: Wallet;
  nonce: () => Hex;
  now?: () => number;
  /**
   * Optional safety kernel. When set, EVERY payment is authorized here **before**
   * signing; a denial throws {@link GuardDeniedError} and nothing is signed.
   */
  guard?: SpendGuard;
}

/** Outcome of one paid call. */
export interface PaidCallResult {
  paid: boolean;
  amount: string;
  content: unknown;
  payment?: ExactPaymentPayload;
}

function nowSeconds(now?: () => number): number {
  return (now ?? (() => Math.floor(Date.now() / 1000)))();
}

/**
 * Make one paid call: fetch the challenge, sign an EIP-3009 authorization locally
 * (no broadcast), retry with the proof, and return the result. Throws if the
 * seller rejects the payment.
 */
export async function payForCall(options: PayForCallOptions): Promise<PaidCallResult> {
  const first = await options.transport.request();
  if (first.kind === "result") {
    return { paid: false, amount: "0", content: first.content };
  }
  if (first.kind !== "challenge") {
    throw new Error(`expected a challenge, got: ${first.kind}`);
  }

  // SAFETY KERNEL: authorize the real payment params BEFORE signing. No bypass —
  // a denial throws and nothing is signed or sent.
  const intent = intentFromRequirements(first.requirements);
  if (options.guard) {
    const decision = await options.guard.authorize(intent);
    if (!decision.allowed) throw new GuardDeniedError(decision);
  }

  const now = nowSeconds(options.now);
  const payment = await signExactPayment(options.wallet.getAccount(), first.requirements, {
    nonce: options.nonce(),
    now,
    ...(first.resource ? { resource: first.resource } : {}),
  });

  const second = await options.transport.request(payment);
  if (second.kind === "rejected") {
    throw new Error(`payment rejected: ${second.reason}`);
  }
  if (second.kind !== "result") {
    throw new Error(`payment not accepted: ${second.kind}`);
  }
  // Payment executed — advance the guard's counters (budget/rate).
  options.guard?.record(intent);
  return { paid: true, amount: first.requirements.amount, content: second.content, payment };
}

/** Reason a payment loop stopped. */
export type LoopStop =
  | "maxCalls"
  | "maxTotalSpend"
  | "guardDenied"
  | "rejected"
  | "settlementError"
  | "noChallenge";

/** Options for {@link startPaymentLoop}. `maxCalls`/`maxTotalSpend` are HARD caps. */
export interface StartPaymentLoopOptions {
  transport: PaidToolTransport;
  wallet: Wallet;
  nonce: () => Hex;
  now?: () => number;
  /** Hard cap on the number of paid calls. */
  maxCalls: number;
  /** Hard cap on cumulative spend (base units). The loop never exceeds this. */
  maxTotalSpend: bigint;
  /**
   * Optional safety kernel (Stage 6). When set, EVERY iteration's payment is
   * authorized here **before** signing; a denial hard-stops the loop
   * (`stoppedBy: "guardDenied"`) with the guard's reason — no payment is signed.
   */
  guard?: SpendGuard;
  /** Optional batch flush: settle every `flushEvery` calls via `batchSettler`. */
  queue?: SettlementQueue;
  batchSettler?: BatchSettler;
  flushEvery?: number;
}

export interface PaymentLoopResult {
  calls: number;
  totalSpent: bigint;
  stoppedBy: LoopStop;
  reason?: string;
  batches: BatchSettleOutcome[];
}

/**
 * Run the buyer loop: repeated paid calls, stopping at either hard cap. The spend
 * cap is checked **before** paying (from the challenge amount), so it is never
 * exceeded. This is a minimal dev safety rail — the full guard suite is Stage 6.
 */
export async function startPaymentLoop(
  options: StartPaymentLoopOptions,
): Promise<PaymentLoopResult> {
  let calls = 0;
  let totalSpent = 0n;
  const batches: BatchSettleOutcome[] = [];
  let stoppedBy: LoopStop | undefined;
  let reason: string | undefined;

  while (calls < options.maxCalls) {
    const peek = await options.transport.request();
    if (peek.kind === "result") {
      stoppedBy = "noChallenge";
      break;
    }
    if (peek.kind !== "challenge") {
      stoppedBy = "rejected";
      reason = peek.reason;
      break;
    }

    const amount = BigInt(peek.requirements.amount);
    if (totalSpent + amount > options.maxTotalSpend) {
      stoppedBy = "maxTotalSpend";
      break;
    }

    // SAFETY KERNEL: authorize BEFORE signing. A denial hard-stops the loop —
    // there is no path around this, regardless of what the agent/transport says.
    const intent = intentFromRequirements(peek.requirements);
    if (options.guard) {
      const decision = await options.guard.authorize(intent);
      if (!decision.allowed) {
        stoppedBy = "guardDenied";
        reason = `${decision.guard}: ${decision.reason}`;
        break;
      }
    }

    const now = nowSeconds(options.now);
    const payment = await signExactPayment(options.wallet.getAccount(), peek.requirements, {
      nonce: options.nonce(),
      now,
      ...(peek.resource ? { resource: peek.resource } : {}),
    });
    const res = await options.transport.request(payment);
    if (res.kind === "rejected") {
      stoppedBy = "rejected";
      reason = res.reason;
      break;
    }
    if (res.kind !== "result") {
      stoppedBy = "rejected";
      reason = `unexpected response: ${res.kind}`;
      break;
    }

    calls += 1;
    totalSpent += amount;
    // Payment executed — advance the guard's counters (budget/rate).
    options.guard?.record(intent);

    if (
      options.queue &&
      options.batchSettler &&
      options.flushEvery &&
      calls % options.flushEvery === 0
    ) {
      const outcome = await flushBatch(options.queue, options.batchSettler);
      if (outcome) {
        batches.push(outcome);
        if (outcome.failed.length > 0) {
          stoppedBy = "settlementError";
          reason = outcome.failed[0]?.error;
          break;
        }
      }
    }
  }

  // Final flush of anything still pending (unless we stopped on a settlement error).
  if (stoppedBy !== "settlementError" && options.queue && options.batchSettler) {
    const outcome = await flushBatch(options.queue, options.batchSettler);
    if (outcome) {
      batches.push(outcome);
      if (outcome.failed.length > 0 && !stoppedBy) {
        stoppedBy = "settlementError";
        reason = outcome.failed[0]?.error;
      }
    }
  }

  if (!stoppedBy) stoppedBy = "maxCalls";
  return { calls, totalSpent, stoppedBy, ...(reason ? { reason } : {}), batches };
}

/** Result of submitting a batch of records to Gateway in one flush. */
export interface BatchSettleOutcome {
  /**
   * Circle's settlement/transfer id (a UUID) for the batch — NOT an on-chain tx
   * hash. Resolve it to the real hash with `resolveSettlementTxHash`.
   */
  transaction?: string;
  /**
   * Ids Gateway **accepted** for batch settlement (verified + queued off-chain).
   * This is NOT on-chain finality — the on-chain batch settles periodically in the
   * background (track it via `getTransferById` → status `completed`).
   */
  settled: string[];
  /** Ids that failed, with reasons — surfaced, never dropped. */
  failed: { id: string; error: string }[];
}

/** Seam for the batch settlement backend (Circle Gateway in production). */
export interface BatchSettler {
  settleBatch(records: SettlementRecord[]): Promise<BatchSettleOutcome>;
}

/**
 * Flush all pending records through the batch settler in **one** submission.
 *
 * Marks each record settled/failed from the outcome; a record neither settled nor
 * reported failed is marked failed ("not included") — nothing is silently dropped.
 * A throwing settler marks every record failed. Returns null when nothing pending.
 */
export async function flushBatch(
  queue: SettlementQueue,
  settler: BatchSettler,
): Promise<BatchSettleOutcome | null> {
  const pending = queue.pending();
  if (pending.length === 0) return null;

  let outcome: BatchSettleOutcome;
  try {
    outcome = await settler.settleBatch(pending);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    for (const record of pending) {
      record.status = "failed";
      record.error = error;
    }
    return { settled: [], failed: pending.map((r) => ({ id: r.id, error })) };
  }

  const settled = new Set(outcome.settled);
  const failed = new Map(outcome.failed.map((f) => [f.id, f.error]));
  for (const record of pending) {
    const failure = failed.get(record.id);
    if (settled.has(record.id)) {
      record.status = "settled";
      if (outcome.transaction) record.transaction = outcome.transaction;
    } else if (failure !== undefined) {
      record.status = "failed";
      record.error = failure;
    } else {
      // Present in the batch but the settler said nothing about it — never drop it.
      record.status = "failed";
      record.error = "not included in batch settlement response";
    }
  }
  return outcome;
}
