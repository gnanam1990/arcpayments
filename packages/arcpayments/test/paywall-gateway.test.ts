import { describe, expect, it } from "vitest";
import type { ExactPaymentPayload, SettlementRecord } from "../src/paywall";
import {
  InMemorySettlementQueue,
  buildPaymentRequirements,
  flushSettlements,
} from "../src/paywall";
import { type FacilitatorLike, GatewaySettler } from "../src/paywall-gateway";

function record(payer: string): SettlementRecord {
  const requirements = buildPaymentRequirements({
    price: "$0.001",
    payTo: "0x00000000000000000000000000000000dEAD0001",
    caip2: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    eip712: { name: "USDC", version: "1" },
  });
  return {
    id: "stl_1",
    payer: payer as `0x${string}`,
    amount: "1000",
    network: "eip155:5042002",
    status: "queued",
    enqueuedAt: 1000,
    payment: {
      x402Version: 1,
      scheme: "exact",
      network: "eip155:5042002",
      payload: {},
    } as ExactPaymentPayload,
    requirements,
  };
}

describe("GatewaySettler (BatchFacilitatorClient adapter)", () => {
  it("maps a successful Gateway settle to a settled outcome", async () => {
    const facilitator: FacilitatorLike = {
      settle: async () => ({ success: true, transaction: "0xabc", network: "eip155:5042002" }),
    };
    const settler = new GatewaySettler(facilitator);
    const outcome = await settler.settle(record("0x00000000000000000000000000000000000000A1"));
    expect(outcome.success).toBe(true);
    expect(outcome.transaction).toBe("0xabc");
  });

  it("maps a Gateway rejection to a surfaced failure (with reason)", async () => {
    const facilitator: FacilitatorLike = {
      settle: async () => ({
        success: false,
        errorReason: "insufficient Gateway balance",
        network: "x",
        transaction: "",
      }),
    };
    const settler = new GatewaySettler(facilitator);
    const outcome = await settler.settle(record("0x00000000000000000000000000000000000000A2"));
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/insufficient/i);
  });

  it("composes with flushSettlements: a Gateway failure stays visible, not dropped", async () => {
    const queue = new InMemorySettlementQueue();
    queue.enqueue({ ...record("0x00000000000000000000000000000000000000A3") });
    const facilitator: FacilitatorLike = {
      settle: async () => ({
        success: false,
        errorReason: "rejected",
        network: "x",
        transaction: "",
      }),
    };
    await flushSettlements(queue, new GatewaySettler(facilitator));
    expect(queue.failed()).toHaveLength(1);
    expect(queue.failed()[0]?.error).toMatch(/rejected/i);
  });
});
