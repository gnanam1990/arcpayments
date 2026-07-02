import { describe, expect, it } from "vitest";
import type { ExactPaymentPayload, SettlementRecord } from "../src/paywall";
import {
  InMemorySettlementQueue,
  buildPaymentRequirements,
  flushSettlements,
} from "../src/paywall";
import {
  type FacilitatorLike,
  type FacilitatorResponse,
  GatewayBatchSettler,
  GatewaySettler,
  describeGatewayError,
} from "../src/paywall-gateway";

function record(payer: string): SettlementRecord {
  const requirements = buildPaymentRequirements({
    price: "$0.001",
    payTo: "0x00000000000000000000000000000000dEAD0001",
    caip2: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    usdcDecimals: 6,
    eip712: { name: "GatewayWalletBatched", version: "1" },
  });
  return {
    id: "stl_1",
    payer: payer as `0x${string}`,
    amount: "1000",
    network: "eip155:5042002",
    status: "queued",
    enqueuedAt: 1000,
    payment: {
      x402Version: 2,
      scheme: "exact",
      network: "eip155:5042002",
      payload: {},
    } as ExactPaymentPayload,
    requirements,
  };
}

/** Build a facilitator from a settle fn (+ optional verify), for tests. */
function fac(
  settle: () => Promise<FacilitatorResponse>,
  verify: () => Promise<FacilitatorResponse> = async () => ({ isValid: true }),
): FacilitatorLike {
  return { settle, verify };
}

describe("describeGatewayError — surfaces the full response, never 'settlement failed'", () => {
  it("includes recognizable reason/code fields AND the full body", () => {
    const text = describeGatewayError({
      success: false,
      code: "INSUFFICIENT_BALANCE",
      error: "not enough deposited",
      details: { needed: "1000", have: "0" },
    });
    expect(text).toMatch(/INSUFFICIENT_BALANCE/);
    expect(text).toMatch(/not enough deposited/);
    expect(text).toContain('"needed":"1000"'); // full body preserved
  });

  it("falls back to the full JSON when no known reason field is present", () => {
    expect(describeGatewayError({ success: false, weirdField: "x" })).toContain('"weirdField":"x"');
  });

  it("handles an empty body without inventing a reason", () => {
    expect(describeGatewayError({}).toLowerCase()).toContain("empty response");
  });
});

describe("GatewaySettler — real Gateway error is propagated", () => {
  it("maps a successful settle to a settled outcome", async () => {
    const settler = new GatewaySettler(
      fac(async () => ({ success: true, transaction: "0xabc", network: "eip155:5042002" })),
    );
    const outcome = await settler.settle(record("0x00000000000000000000000000000000000000A1"));
    expect(outcome.success).toBe(true);
    expect(outcome.transaction).toBe("0xabc");
  });

  it("surfaces the FULL rejection body (reason + code), not a generic message", async () => {
    const settler = new GatewaySettler(
      fac(async () => ({
        success: false,
        errorReason: "authorization not valid for this verifyingContract",
        code: "INVALID_DOMAIN",
      })),
    );
    const outcome = await settler.settle(record("0x00000000000000000000000000000000000000A2"));
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/verifyingContract/i);
    expect(outcome.error).toMatch(/INVALID_DOMAIN/);
    expect(outcome.error).not.toBe("settlement failed");
  });

  it("propagates the SDK's thrown error verbatim (status + raw body)", async () => {
    const settler = new GatewaySettler(
      fac(async () => {
        throw new Error(
          'Circle Gateway settle failed (400): {"code":"BAD_REQUEST","message":"nope"}',
        );
      }),
    );
    const outcome = await settler.settle(record("0x00000000000000000000000000000000000000A3"));
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain("Circle Gateway settle failed (400)");
    expect(outcome.error).toContain("BAD_REQUEST");
  });

  it("composes with flushSettlements: the full failure stays visible", async () => {
    const queue = new InMemorySettlementQueue();
    queue.enqueue({ ...record("0x00000000000000000000000000000000000000A4") });
    await flushSettlements(
      queue,
      new GatewaySettler(
        fac(async () => ({ success: false, error: "rejected by gateway", code: "X1" })),
      ),
    );
    expect(queue.failed()).toHaveLength(1);
    expect(queue.failed()[0]?.error).toMatch(/rejected by gateway/);
    expect(queue.failed()[0]?.error).toMatch(/X1/);
  });
});

describe("GatewayBatchSettler", () => {
  it("settles every record and reports the settlement tx", async () => {
    let settleCalls = 0;
    const settler = new GatewayBatchSettler(
      fac(async () => {
        settleCalls += 1;
        return { success: true, transaction: "0xBATCH", network: "eip155:5042002" };
      }),
    );
    const outcome = await settler.settleBatch([
      { ...record("0x00000000000000000000000000000000000000A1"), id: "stl_1" },
      { ...record("0x00000000000000000000000000000000000000A2"), id: "stl_2" },
    ]);
    expect(settleCalls).toBe(2);
    expect(outcome.settled).toEqual(["stl_1", "stl_2"]);
    expect(outcome.transaction).toBe("0xBATCH");
    expect(outcome.failed).toHaveLength(0);
  });

  it("surfaces a per-record failure with the full body, keeping the rest", async () => {
    let n = 0;
    const settler = new GatewayBatchSettler(
      fac(async () => {
        n += 1;
        return n === 1
          ? { success: true, transaction: "0xBATCH", network: "x" }
          : { success: false, errorReason: "insufficient Gateway balance", code: "NO_FUNDS" };
      }),
    );
    const outcome = await settler.settleBatch([
      { ...record("0x00000000000000000000000000000000000000A1"), id: "stl_1" },
      { ...record("0x00000000000000000000000000000000000000A2"), id: "stl_2" },
    ]);
    expect(outcome.settled).toEqual(["stl_1"]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.id).toBe("stl_2");
    expect(outcome.failed[0]?.error).toMatch(/insufficient Gateway balance/);
    expect(outcome.failed[0]?.error).toMatch(/NO_FUNDS/);
  });

  it("verify() returns the raw /verify response (preflight)", async () => {
    const settler = new GatewayBatchSettler(
      fac(
        async () => ({ success: true }),
        async () => ({ isValid: false, invalidReason: "domain mismatch", payer: "0x…" }),
      ),
    );
    const result = await settler.verify(record("0x00000000000000000000000000000000000000A1"));
    expect(result.ok).toBe(false);
    expect(result.raw?.invalidReason).toBe("domain mismatch");
  });

  it("verify() surfaces a thrown /verify error verbatim", async () => {
    const settler = new GatewayBatchSettler({
      settle: async () => ({ success: true }),
      verify: async () => {
        throw new Error('Circle Gateway verify failed (422): {"reason":"bad signature"}');
      },
    });
    const result = await settler.verify(record("0x00000000000000000000000000000000000000A1"));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Circle Gateway verify failed (422)");
    expect(result.error).toContain("bad signature");
  });
});
