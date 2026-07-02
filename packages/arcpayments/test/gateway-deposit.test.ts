import { describe, expect, it } from "vitest";
import {
  type GatewayDepositor,
  formatGatewayDepositReport,
  runGatewayDeposit,
} from "../src/gateway-deposit";

function depositor(overrides: Partial<GatewayDepositor> = {}): GatewayDepositor {
  return {
    deposit: async (amount) => ({
      depositTxHash: "0xdeposittx",
      approvalTxHash: "0xapprovaltx",
      amount: (Number(amount) * 1_000_000).toString(),
      formattedAmount: amount,
      depositor: "0x00000000000000000000000000000000000000A1",
    }),
    availableBalance: async () => "10",
    ...overrides,
  };
}

describe("runGatewayDeposit", () => {
  it("deposits a valid amount and returns the tx + resulting Gateway balance", async () => {
    const report = await runGatewayDeposit(depositor(), "10");
    expect(report.ok).toBe(true);
    expect(report.result?.depositTxHash).toBe("0xdeposittx");
    expect(report.result?.formattedAmount).toBe("10");
    expect(report.gatewayBalanceAfter).toBe("10");
  });

  it("rejects a non-positive or malformed amount without calling deposit", async () => {
    let called = false;
    const dep = depositor({
      deposit: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    for (const bad of ["0", "-1", "abc", ""]) {
      const report = await runGatewayDeposit(dep, bad);
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/amount/i);
    }
    expect(called).toBe(false);
  });

  it("surfaces a deposit failure instead of throwing", async () => {
    const dep = depositor({
      deposit: async () => {
        throw new Error("insufficient USDC balance");
      },
    });
    const report = await runGatewayDeposit(dep, "5");
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/insufficient/i);
  });
});

describe("formatGatewayDepositReport", () => {
  it("shows the deposit tx and does not leak a private key", async () => {
    const report = await runGatewayDeposit(depositor(), "10");
    const text = formatGatewayDepositReport(report);
    expect(text).toContain("0xdeposittx");
    expect(text).toContain("10");
    expect(text.toLowerCase()).toContain("gateway");
  });

  it("renders a failure clearly", () => {
    const text = formatGatewayDepositReport({ ok: false, error: "boom", requested: "5" });
    expect(text.toLowerCase()).toContain("failed");
    expect(text).toContain("boom");
  });
});
