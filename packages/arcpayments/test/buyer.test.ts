import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  type BatchSettler,
  type PaidToolTransport,
  flushBatch,
  guardTransport,
  payForCall,
  startPaymentLoop,
} from "../src/buyer";
import {
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  type PaymentRequirements,
  PaywallGuard,
  type SettlementQueue,
  buildPaymentRequirements,
} from "../src/paywall";
import { LocalWallet } from "../src/wallet";

const buyer = LocalWallet.fromPrivateKey(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SELLER = "0x00000000000000000000000000000000dEAD0001" as const;
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;

function requirements(price = "$0.001"): PaymentRequirements {
  return buildPaymentRequirements({
    price,
    payTo: SELLER,
    caip2: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    verifyingContract: GATEWAY_WALLET,
    usdcDecimals: 6,
    eip712: { name: "GatewayWalletBatched", version: "1" },
    maxTimeoutSeconds: 604800,
  });
}

let nonceSeq = 0;
function nextNonce(): Hex {
  nonceSeq += 1;
  return `0x${nonceSeq.toString(16).padStart(64, "0")}` as Hex;
}

/** A real seller: guard (with the confirmed domain) wrapping an in-memory queue. */
function seller(price = "$0.001") {
  const queue = new InMemorySettlementQueue();
  const guard = new PaywallGuard({
    requirements: requirements(price),
    verifier: new LocalExactVerifier(new InMemoryNonceStore()),
    queue,
    now: () => 1000,
  });
  const transport = guardTransport(guard, async () => "PREMIUM-RESULT");
  return { queue, guard, transport };
}

describe("payForCall (challenge → sign → retry → result)", () => {
  it("signs the challenge via the Wallet seam and gets the result the seller accepts", async () => {
    const { transport, queue } = seller();
    const result = await payForCall({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
    });
    expect(result.paid).toBe(true);
    expect(result.content).toBe("PREMIUM-RESULT");
    expect(result.amount).toBe("1000");
    // the seller enqueued exactly one settlement, proving the buyer's proof verified
    expect(queue.pending()).toHaveLength(1);
    expect(queue.pending()[0]?.payer).toBe(buyer.getAddress());
  });
});

describe("startPaymentLoop — hard caps", () => {
  it("makes exactly N paid calls, then stops (maxCalls)", async () => {
    const { transport, queue } = seller();
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 3,
      maxTotalSpend: 1_000_000n,
    });
    expect(result.calls).toBe(3);
    expect(result.stoppedBy).toBe("maxCalls");
    expect(result.totalSpent).toBe(3000n);
    expect(queue.pending()).toHaveLength(3);
  });

  it("halts at the cumulative spend cap without overspending", async () => {
    const { transport } = seller("$0.001"); // 1000 base units each
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 100,
      maxTotalSpend: 2500n, // room for exactly 2 calls (2000), a 3rd (3000) would exceed
    });
    expect(result.calls).toBe(2);
    expect(result.stoppedBy).toBe("maxTotalSpend");
    expect(result.totalSpent).toBe(2000n);
    expect(result.totalSpent).toBeLessThanOrEqual(2500n);
  });

  it("stops and surfaces the reason when the seller rejects a proof", async () => {
    // A transport that always rejects payment (e.g. expired/replayed proof).
    const rejecting: PaidToolTransport = {
      request: async (payment) =>
        payment
          ? {
              kind: "rejected",
              reason: "payment authorization expired",
              requirements: requirements(),
            }
          : { kind: "challenge", requirements: requirements() },
    };
    const result = await startPaymentLoop({
      transport: rejecting,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 5,
      maxTotalSpend: 1_000_000n,
    });
    expect(result.calls).toBe(0);
    expect(result.stoppedBy).toBe("rejected");
    expect(result.reason).toMatch(/expired/i);
  });
});

describe("seller refuses an expired proof (reuses Stage 3 verifier)", () => {
  it("rejects a proof whose validBefore is in the past", async () => {
    const { guard } = seller();
    const transport = guardTransport(guard, async () => "R");
    // Sign an already-expired authorization directly, bypassing the loop.
    const { signExactPayment } = await import("../src/paywall");
    const expired = await signExactPayment(buyer.getAccount(), guard.requirements, {
      nonce: nextNonce(),
      now: 1000,
      validAfter: 0,
      validBefore: 500,
    });
    const res = await transport.request(expired);
    expect(res.kind).toBe("rejected");
  });
});

describe("flushBatch — one settlement covers many calls; failures surfaced", () => {
  function enqueue(queue: SettlementQueue, n: number) {
    for (let i = 0; i < n; i++) {
      queue.enqueue({
        payer: buyer.getAddress(),
        amount: "1000",
        network: "eip155:5042002",
        payment: {
          x402Version: 2,
          scheme: "exact",
          network: "eip155:5042002",
          payload: {},
        } as never,
        requirements: requirements(),
        enqueuedAt: 1000,
      });
    }
  }

  it("settles all pending in one batch submission returning a single tx", async () => {
    const queue = new InMemorySettlementQueue();
    enqueue(queue, 3);
    let calls = 0;
    const batchSettler: BatchSettler = {
      settleBatch: async (records) => {
        calls += 1;
        return { transaction: "0xBATCHTX", settled: records.map((r) => r.id), failed: [] };
      },
    };
    const outcome = await flushBatch(queue, batchSettler);
    expect(calls).toBe(1); // ONE submission for many calls
    expect(outcome?.transaction).toBe("0xBATCHTX");
    expect(queue.pending()).toHaveLength(0);
    expect(queue.all().every((r) => r.status === "settled" && r.transaction === "0xBATCHTX")).toBe(
      true,
    );
  });

  it("surfaces a per-record settlement failure (not silently dropped)", async () => {
    const queue = new InMemorySettlementQueue();
    enqueue(queue, 2);
    const ids = queue.pending().map((r) => r.id);
    const batchSettler: BatchSettler = {
      settleBatch: async () => ({
        transaction: "0xTX",
        settled: [ids[0] as string],
        failed: [{ id: ids[1] as string, error: "insufficient Gateway balance" }],
      }),
    };
    await flushBatch(queue, batchSettler);
    expect(queue.failed()).toHaveLength(1);
    expect(queue.failed()[0]?.error).toMatch(/insufficient/i);
  });

  it("marks all records failed when the batch submission throws", async () => {
    const queue = new InMemorySettlementQueue();
    enqueue(queue, 2);
    const batchSettler: BatchSettler = {
      settleBatch: async () => {
        throw new Error("gateway unreachable");
      },
    };
    await flushBatch(queue, batchSettler);
    expect(queue.failed()).toHaveLength(2);
    expect(queue.failed()[0]?.error).toMatch(/unreachable/i);
  });
});

describe("loop with batch flush stops on settlement failure", () => {
  it("flushes every N calls and stops when a batch reports a failure", async () => {
    const { transport, queue } = seller();
    const batchSettler: BatchSettler = {
      settleBatch: async (records) => ({
        transaction: "0xTX",
        settled: [],
        failed: records.map((r) => ({ id: r.id, error: "rejected by gateway" })),
      }),
    };
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 10,
      maxTotalSpend: 1_000_000n,
      queue,
      batchSettler,
      flushEvery: 2,
    });
    expect(result.stoppedBy).toBe("settlementError");
    expect(result.calls).toBe(2); // stopped after the first flush failed
  });
});
