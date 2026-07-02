import { type Hex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  type ExactPaymentPayload,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  type PaymentRequirements,
  type PaymentVerifier,
  PaywallGuard,
  type Settler,
  type VerifyResult,
  buildPaymentRequirements,
  flushSettlements,
  priceToBaseUnits,
  signExactPayment,
} from "../src/paywall";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const buyer = privateKeyToAccount(BUYER_KEY);
const SELLER = "0x00000000000000000000000000000000dEAD0001" as const;
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;

function nonce(byte: string): Hex {
  return `0x${byte.repeat(32)}` as Hex;
}

function requirements(price = "$0.001"): PaymentRequirements {
  return buildPaymentRequirements({
    price,
    payTo: SELLER,
    caip2: "eip155:5042002",
    asset: USDC,
    verifyingContract: GATEWAY_WALLET,
    usdcDecimals: 6,
    eip712: { name: "GatewayWalletBatched", version: "1" },
    maxTimeoutSeconds: 60,
  });
}

async function pay(
  reqs: PaymentRequirements,
  opts: { nonce: Hex; now?: number; validAfter?: number; validBefore?: number },
): Promise<ExactPaymentPayload> {
  return signExactPayment(buyer, reqs, opts);
}

describe("signExactPayment — Gateway-required payload fields", () => {
  it("sets `accepted` to exactly the requirements being satisfied", async () => {
    const reqs = requirements();
    const payment = await pay(reqs, { nonce: nonce("a1"), now: 1000 });
    expect(payment.accepted).toEqual(reqs);
  });

  it("echoes the `resource` from the challenge when provided", async () => {
    const reqs = requirements();
    const resource = {
      url: "/premium_echo",
      description: "paid tool",
      mimeType: "application/json",
    };
    const payment = await signExactPayment(buyer, reqs, {
      nonce: nonce("a2"),
      now: 1000,
      resource,
    });
    expect(payment.resource).toEqual(resource);
  });

  it("omits `resource` when the challenge did not carry one", async () => {
    const payment = await pay(requirements(), { nonce: nonce("a3"), now: 1000 });
    expect(payment.resource).toBeUndefined();
  });

  it("signs a validity window Gateway accepts (>= 7d + buffer, backdated validAfter)", async () => {
    const now = 1_000_000;
    const payment = await pay(requirements(), { nonce: nonce("a4"), now });
    const { validAfter, validBefore } = payment.payload.authorization;
    // backdated so the auth is already active when Gateway processes it
    expect(Number(validAfter)).toBe(now - 600);
    // forward window >= 604800 (7d) + 100 buffer
    expect(Number(validBefore) - now).toBeGreaterThanOrEqual(604800 + 100);
  });
});

describe("priceToBaseUnits (6-decimal USDC ERC-20 path)", () => {
  it("serializes $0.001 to 1000 base units", () => {
    expect(priceToBaseUnits("$0.001", 6)).toBe(1000n);
  });
  it("serializes $0.01 and $1 correctly", () => {
    expect(priceToBaseUnits("$0.01", 6)).toBe(10000n);
    expect(priceToBaseUnits("$1", 6)).toBe(1_000_000n);
  });
  it("rejects a malformed price", () => {
    expect(() => priceToBaseUnits("free", 6)).toThrow();
  });
});

describe("buildPaymentRequirements", () => {
  it("builds an x402 exact challenge with amount in base units and the EIP-712 domain", () => {
    const r = requirements("$0.001");
    expect(r.scheme).toBe("exact");
    expect(r.network).toBe("eip155:5042002");
    expect(r.amount).toBe("1000");
    expect(r.payTo).toBe(getAddress(SELLER));
    expect(r.extra.name).toBe("GatewayWalletBatched");
  });

  it("signs against the GatewayWallet as verifyingContract, NOT the USDC asset (Part A)", () => {
    const r = requirements();
    expect(r.extra.verifyingContract).toBe(getAddress(GATEWAY_WALLET));
    expect(r.extra.verifyingContract).not.toBe(r.asset);
  });
});

describe("LocalExactVerifier — authorization rules", () => {
  it("accepts a well-formed, sufficiently-funded, in-window payment", async () => {
    const reqs = requirements();
    const payment = await pay(reqs, { nonce: nonce("11"), now: 1000 });
    const result = await new LocalExactVerifier().verify(payment, reqs, 1000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payer).toBe(buyer.address);
  });

  it("rejects a payment below the required price", async () => {
    const reqs = requirements("$0.001");
    // Sign for a cheaper requirement, then present against the real (higher) price.
    const cheap = requirements("$0.0005");
    const payment = await pay(cheap, { nonce: nonce("22"), now: 1000 });
    payment.network = reqs.network;
    const result = await new LocalExactVerifier().verify(payment, reqs, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/insufficient/i);
  });

  it("rejects a payment to the wrong recipient", async () => {
    const reqs = requirements();
    const payment = await pay(reqs, { nonce: nonce("33"), now: 1000 });
    payment.payload.authorization.to = "0x000000000000000000000000000000000000BEEF";
    const result = await new LocalExactVerifier().verify(payment, reqs, 1000);
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered signature (recovered signer != payer)", async () => {
    const reqs = requirements();
    const payment = await pay(reqs, { nonce: nonce("44"), now: 1000 });
    payment.payload.authorization.value = "999999999";
    const result = await new LocalExactVerifier().verify(payment, reqs, 1000);
    expect(result.ok).toBe(false);
  });
});

describe("LocalExactVerifier — expiry (failing-then-passing behaviour)", () => {
  it("rejects a payment whose validBefore is in the past", async () => {
    const reqs = requirements();
    // Signed to expire at t=1050; verified at t=2000 → expired.
    const payment = await pay(reqs, {
      nonce: nonce("55"),
      now: 1000,
      validAfter: 0,
      validBefore: 1050,
    });
    const result = await new LocalExactVerifier().verify(payment, reqs, 2000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/i);
  });

  it("accepts the same authorization while still inside its window", async () => {
    const reqs = requirements();
    const payment = await pay(reqs, {
      nonce: nonce("55"),
      now: 1000,
      validAfter: 0,
      validBefore: 1050,
    });
    const result = await new LocalExactVerifier().verify(payment, reqs, 1049);
    expect(result.ok).toBe(true);
  });
});

describe("LocalExactVerifier — replay protection (single-use nonce)", () => {
  it("accepts a proof once and rejects the identical proof on replay", async () => {
    const reqs = requirements();
    const store = new InMemoryNonceStore();
    const verifier = new LocalExactVerifier(store);
    const payment = await pay(reqs, { nonce: nonce("66"), now: 1000 });

    const first = await verifier.verify(payment, reqs, 1000);
    expect(first.ok).toBe(true);

    const replay = await verifier.verify(payment, reqs, 1000);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toMatch(/repla/i);
  });

  it("still accepts a fresh nonce from the same payer", async () => {
    const reqs = requirements();
    const store = new InMemoryNonceStore();
    const verifier = new LocalExactVerifier(store);
    await verifier.verify(await pay(reqs, { nonce: nonce("77"), now: 1000 }), reqs, 1000);
    const second = await verifier.verify(
      await pay(reqs, { nonce: nonce("88"), now: 1000 }),
      reqs,
      1000,
    );
    expect(second.ok).toBe(true);
  });
});

// A mock verifier so the guard happy-path needs no network and no signing.
const okVerifier: PaymentVerifier = {
  verify: async (): Promise<VerifyResult> => ({ ok: true, payer: buyer.address }),
};
const rejectVerifier: PaymentVerifier = {
  verify: async (): Promise<VerifyResult> => ({ ok: false, reason: "nope" }),
};

describe("PaywallGuard", () => {
  it("returns the payment challenge (not the tool result) when unpaid", async () => {
    const guard = new PaywallGuard({
      requirements: requirements(),
      verifier: okVerifier,
      queue: new InMemorySettlementQueue(),
      now: () => 1000,
    });
    let ran = false;
    const outcome = await guard.guard(undefined, async () => {
      ran = true;
      return "secret";
    });
    expect(outcome.status).toBe("payment-required");
    expect(ran).toBe(false);
    if (outcome.status === "payment-required") expect(outcome.requirements.amount).toBe("1000");
  });

  it("runs the tool AND enqueues a settlement record on a valid payment", async () => {
    const queue = new InMemorySettlementQueue();
    const guard = new PaywallGuard({
      requirements: requirements(),
      verifier: okVerifier,
      queue,
      now: () => 1000,
    });
    const payment = await pay(requirements(), { nonce: nonce("99"), now: 1000 });
    const outcome = await guard.guard(payment, async () => "premium-result");
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result).toBe("premium-result");
      expect(outcome.settlement.status).toBe("queued");
      expect(outcome.settlement.amount).toBe("1000");
    }
    expect(queue.pending()).toHaveLength(1);
  });

  it("rejects an invalid payment and does NOT run the tool or enqueue", async () => {
    const queue = new InMemorySettlementQueue();
    const guard = new PaywallGuard({
      requirements: requirements(),
      verifier: rejectVerifier,
      queue,
      now: () => 1000,
    });
    let ran = false;
    const outcome = await guard.guard(
      await pay(requirements(), { nonce: nonce("ab"), now: 1000 }),
      async () => {
        ran = true;
        return "x";
      },
    );
    expect(outcome.status).toBe("rejected");
    expect(ran).toBe(false);
    expect(queue.pending()).toHaveLength(0);
  });
});

describe("settlement queue flush — surfaces failures, never drops them", () => {
  function enqueueOne(queue: InMemorySettlementQueue, payer: string) {
    queue.enqueue({
      payer: payer as `0x${string}`,
      amount: "1000",
      network: "eip155:5042002",
      payment: {} as ExactPaymentPayload,
      requirements: requirements(),
      enqueuedAt: 1000,
    });
  }

  it("marks settled on success and keeps failures visible via failed()", async () => {
    const queue = new InMemorySettlementQueue();
    enqueueOne(queue, "0x00000000000000000000000000000000000000A1");
    enqueueOne(queue, "0x00000000000000000000000000000000000000A2");

    const settler: Settler = {
      settle: async (rec) =>
        rec.payer.endsWith("A1")
          ? { success: true, transaction: "0xtx" }
          : { success: false, error: "gateway rejected: insufficient Gateway balance" },
    };

    const result = await flushSettlements(queue, settler);
    expect(result.settled).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(queue.failed()).toHaveLength(1);
    expect(queue.failed()[0]?.error).toMatch(/gateway rejected/i);
    // A settled + a failed record → nothing is left silently pending.
    expect(queue.pending()).toHaveLength(0);
  });

  it("captures a thrown settler error as a surfaced failure (not a drop)", async () => {
    const queue = new InMemorySettlementQueue();
    enqueueOne(queue, "0x00000000000000000000000000000000000000B1");
    const settler: Settler = {
      settle: async () => {
        throw new Error("network down");
      },
    };
    const result = await flushSettlements(queue, settler);
    expect(result.failed).toHaveLength(1);
    expect(queue.failed()[0]?.error).toMatch(/network down/i);
  });
});
