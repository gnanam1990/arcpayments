import { describe, expect, it } from "vitest";
import {
  type GatewayWithdrawer,
  type WithdrawResult,
  formatWithdrawReport,
  runGatewayWithdraw,
} from "../src/withdraw";

const HASH = `0x${"a".repeat(64)}` as const;

function withdrawer(overrides: Partial<GatewayWithdrawer> = {}): GatewayWithdrawer {
  return {
    availableFormatted: async () => "0.5",
    withdraw: async (amount): Promise<WithdrawResult> => ({
      mintTxHash: HASH,
      amount: (Number(amount) * 1_000_000).toString(),
      formattedAmount: amount,
      sourceChain: "arcTestnet",
      destinationChain: "arcTestnet",
      recipient: "0x00000000000000000000000000000000000000A1",
    }),
    ...overrides,
  };
}

describe("runGatewayWithdraw — gate on AVAILABLE (not withdrawable)", () => {
  it("refuses cleanly when available is 0 and reports the settle cadence", async () => {
    let called = false;
    const w = withdrawer({
      availableFormatted: async () => "0",
      withdraw: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    const report = await runGatewayWithdraw(w);
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/nothing withdrawable|available is 0/i);
    expect(report.error?.toLowerCase()).toContain("min"); // mentions the ~10 min cadence
    expect(called).toBe(false);
  });

  it("withdraws the full available balance by default and returns a 0x mintTxHash", async () => {
    const report = await runGatewayWithdraw(withdrawer());
    expect(report.ok).toBe(true);
    expect(report.requested).toBe("0.5"); // defaulted to available
    expect(report.result?.mintTxHash).toBe(HASH);
  });

  it("withdraws an explicit amount and rejects one above available", async () => {
    expect((await runGatewayWithdraw(withdrawer(), "0.25")).requested).toBe("0.25");
    const over = await runGatewayWithdraw(withdrawer(), "9.99");
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/exceeds available/i);
  });

  it("rejects a malformed amount without calling withdraw", async () => {
    let called = false;
    const w = withdrawer({
      withdraw: async () => {
        called = true;
        throw new Error("nope");
      },
    });
    const report = await runGatewayWithdraw(w, "abc");
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/amount/i);
    expect(called).toBe(false);
  });

  it("surfaces a withdraw failure (e.g. below the fee) instead of throwing", async () => {
    const w = withdrawer({
      withdraw: async () => {
        throw new Error("amount below max fee 2.01");
      },
    });
    const report = await runGatewayWithdraw(w, "0.5");
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/fee/i);
  });
});

describe("formatWithdrawReport — link only from a real 0x hash", () => {
  it("prints the mintTxHash + explorer link on success", async () => {
    const report = await runGatewayWithdraw(withdrawer());
    const text = formatWithdrawReport(report, "https://testnet.arcscan.app");
    expect(text).toContain(HASH);
    expect(text).toContain(`https://testnet.arcscan.app/tx/${HASH}`);
  });

  it("renders a failure without any /tx/ link", () => {
    const text = formatWithdrawReport(
      { ok: false, available: "0", error: "nothing withdrawable yet (~10 min)" },
      "https://testnet.arcscan.app",
    );
    expect(text.toLowerCase()).toContain("failed");
    expect(text).not.toContain("/tx/");
  });
});
