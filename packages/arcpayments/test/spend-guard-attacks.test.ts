import type { Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  GuardDeniedError,
  type PaidToolTransport,
  type PaymentIntent,
  type PaymentRequirements,
  SpendGuard,
  buildPaymentRequirements,
  payForCall,
  startPaymentLoop,
} from "../src/index";
import { LocalWallet } from "../src/wallet";

/**
 * Stage 6 adversarial suite — each test is an explicit attack scenario proving the
 * guards are enforced BELOW the agent: a denied payment is never signed nor sent.
 * `paid` records every payment that actually reached the seller transport, so an
 * empty `paid` after a denial proves there was no bypass.
 */

const buyer = LocalWallet.fromPrivateKey(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SELLER = "0x00000000000000000000000000000000dead0001"; // allowlisted
const ATTACKER = "0x00000000000000000000000000000000dead0002"; // NOT allowlisted
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

function requirements(payTo: string, price = "$0.001"): PaymentRequirements {
  return buildPaymentRequirements({
    price,
    payTo: payTo as `0x${string}`,
    caip2: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    verifyingContract: GATEWAY_WALLET,
    usdcDecimals: 6,
    eip712: { name: "GatewayWalletBatched", version: "1" },
    maxTimeoutSeconds: 604800,
  });
}

let nonceSeq = 0;
const nextNonce = (): Hex => {
  nonceSeq += 1;
  return `0x${nonceSeq.toString(16).padStart(64, "0")}` as Hex;
};

/**
 * A seller endpoint that always issues the SAME challenge and records every signed
 * payment it receives. Simulates a (possibly attacker-controlled) tool the agent
 * keeps hitting; `paid` is the ground-truth of what actually executed.
 */
function endpoint(reqs: PaymentRequirements) {
  const paid: { recipient: string; amount: string }[] = [];
  const transport: PaidToolTransport = {
    async request(payment) {
      if (!payment) return { kind: "challenge", requirements: reqs };
      paid.push({ recipient: reqs.payTo, amount: reqs.amount });
      return { kind: "result", content: "SECRET-RESULT" };
    },
  };
  return { transport, paid };
}

describe("attack: prompt injection → unlisted recipient", () => {
  it("denies a fully-valid payment to 0xATTACKER and signs NOTHING (payForCall)", async () => {
    const { transport, paid } = endpoint(requirements(ATTACKER));
    const guard = new SpendGuard({ allowlist: [SELLER] });
    await expect(
      payForCall({ transport, wallet: buyer, nonce: nextNonce, now: () => 1000, guard }),
    ).rejects.toThrowError(GuardDeniedError);
    expect(paid).toHaveLength(0); // never signed, never sent
  });

  it("hard-stops the loop on the unlisted recipient (startPaymentLoop)", async () => {
    const { transport, paid } = endpoint(requirements(ATTACKER));
    const guard = new SpendGuard({ allowlist: [SELLER] });
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 10,
      maxTotalSpend: 10_000_000n,
      guard,
    });
    expect(result.stoppedBy).toBe("guardDenied");
    expect(result.reason).toMatch(/allowlist/);
    expect(result.calls).toBe(0);
    expect(paid).toHaveLength(0);
  });
});

describe("attack: budget exhaustion", () => {
  it("never lets cumulative spend cross the cap across a long loop", async () => {
    const { transport, paid } = endpoint(requirements(SELLER)); // $0.001 = 1000 units each
    const guard = new SpendGuard({ allowlist: [SELLER], budgetCap: 3000n });
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 1000, // agent WANTS a thousand calls
      maxTotalSpend: 10_000_000n, // Stage-4 rail set loose so the GUARD is what bounds it
      guard,
    });
    expect(result.stoppedBy).toBe("guardDenied");
    expect(result.calls).toBe(3); // 3 × 1000 = 3000 exactly
    expect(result.totalSpent).toBeLessThanOrEqual(3000n);
    expect(guard.spent).toBe(3000n);
    expect(paid).toHaveLength(3);
  });
});

describe("attack: rate burst", () => {
  it("denies the N+1th payment inside the window (limiter cannot be flooded)", async () => {
    const { transport, paid } = endpoint(requirements(SELLER));
    const guard = new SpendGuard(
      { allowlist: [SELLER], rate: { max: 3, windowMs: 60_000 } },
      { now: () => 5_000 }, // frozen clock → all in one window
    );
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 50,
      maxTotalSpend: 10_000_000n,
      guard,
    });
    expect(result.stoppedBy).toBe("guardDenied");
    expect(result.reason).toMatch(/rate/);
    expect(paid).toHaveLength(3);
  });
});

describe("attack: oversized payment", () => {
  it("denies a single payment above the per-payment max", async () => {
    const { transport, paid } = endpoint(requirements(SELLER, "$0.01")); // 10000 units
    const guard = new SpendGuard({ allowlist: [SELLER], perPaymentMax: 5000n });
    await expect(
      payForCall({ transport, wallet: buyer, nonce: nextNonce, now: () => 1000, guard }),
    ).rejects.toThrowError(/perPaymentMax/);
    expect(paid).toHaveLength(0);
  });
});

describe("attack: human-gate", () => {
  const overThreshold = () => requirements(SELLER, "$0.01"); // 10000 ≥ threshold

  it("does NOT execute an over-threshold payment without approval", async () => {
    const { transport, paid } = endpoint(overThreshold());
    const approve = vi.fn(async () => false);
    const guard = new SpendGuard({ allowlist: [SELLER], humanGateThreshold: 5000n }, { approve });
    await expect(
      payForCall({ transport, wallet: buyer, nonce: nextNonce, now: () => 1000, guard }),
    ).rejects.toThrowError(GuardDeniedError);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(paid).toHaveLength(0);
  });

  it("executes only after an explicit human approve", async () => {
    const { transport, paid } = endpoint(overThreshold());
    const guard = new SpendGuard(
      { allowlist: [SELLER], humanGateThreshold: 5000n },
      { approve: async () => true },
    );
    const res = await payForCall({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      guard,
    });
    expect(res.paid).toBe(true);
    expect(paid).toHaveLength(1);
  });
});

describe("attack: runaway agent", () => {
  it("bounds spend, recipient set, and call count regardless of agent intent", async () => {
    const { transport, paid } = endpoint(requirements(SELLER));
    const guard = new SpendGuard({
      allowlist: [SELLER],
      budgetCap: 5000n,
      perPaymentMax: 2000n,
    });
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 1_000_000, // "pay forever"
      maxTotalSpend: 10_000_000n,
      guard,
    });
    // bounded by the budget guard, not the agent's ambition
    expect(result.calls).toBe(5);
    expect(result.totalSpent).toBeLessThanOrEqual(5000n);
    // every executed payment went to the allowlisted seller — never the attacker
    expect(paid.every((p) => p.recipient.toLowerCase() === SELLER)).toBe(true);
    expect(paid).toHaveLength(5);
  });
});

describe("attack: config immutability through the loop", () => {
  it("mutating the guard config at runtime does not widen enforcement", async () => {
    const { transport, paid } = endpoint(requirements(SELLER));
    const guard = new SpendGuard({ allowlist: [SELLER], budgetCap: 2000n });
    // agent tries to widen its own budget mid-flight
    try {
      (guard.config as { budgetCap?: bigint }).budgetCap = 10_000_000n;
    } catch {
      /* frozen → throws; fine */
    }
    const result = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      now: () => 1000,
      maxCalls: 1000,
      maxTotalSpend: 10_000_000n,
      guard,
    });
    expect(result.calls).toBe(2); // still bounded by the ORIGINAL 2000 cap
    expect(paid).toHaveLength(2);
  });
});
