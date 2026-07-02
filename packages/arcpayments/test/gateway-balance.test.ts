import { describe, expect, it } from "vitest";
import {
  type GatewayBalanceReader,
  type GatewayBalances,
  formatGatewayBalances,
  runGatewayBalance,
} from "../src/gateway-balance";

const SAMPLE: GatewayBalances = {
  address: "0x00000000000000000000000000000000000000A1",
  walletFormatted: "3.5",
  gatewayTotalFormatted: "10",
  gatewayAvailableFormatted: "7.5",
  gatewayWithdrawingFormatted: "2.5",
  gatewayWithdrawableFormatted: "0",
};

function reader(overrides: Partial<GatewayBalanceReader> = {}): GatewayBalanceReader {
  return {
    getBalances: async (address) => ({ ...SAMPLE, ...(address ? { address } : {}) }),
    ...overrides,
  };
}

describe("runGatewayBalance", () => {
  it("reads the balances for the account when no address is given", async () => {
    const report = await runGatewayBalance(reader());
    expect(report.ok).toBe(true);
    expect(report.balances?.gatewayTotalFormatted).toBe("10");
    expect(report.balances?.gatewayAvailableFormatted).toBe("7.5");
  });

  it("reads the balances for a specific (checksummed) address", async () => {
    const lower = "0x000000000000000000000000000000000000dead";
    const report = await runGatewayBalance(reader(), lower);
    expect(report.ok).toBe(true);
    // address is passed through checksummed
    expect(report.balances?.address).toBe("0x000000000000000000000000000000000000dEaD");
  });

  it("rejects a malformed address without calling the reader", async () => {
    let called = false;
    const r = reader({
      getBalances: async () => {
        called = true;
        return SAMPLE;
      },
    });
    const report = await runGatewayBalance(r, "not-an-address");
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/address/i);
    expect(called).toBe(false);
  });

  it("surfaces a reader failure instead of throwing", async () => {
    const r = reader({
      getBalances: async () => {
        throw new Error("gateway API unreachable");
      },
    });
    const report = await runGatewayBalance(r);
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/unreachable/i);
  });
});

describe("formatGatewayBalances", () => {
  it("shows deposited (total) vs available and does not leak a key", async () => {
    const report = await runGatewayBalance(reader());
    const text = formatGatewayBalances(report);
    expect(text.toLowerCase()).toContain("deposited");
    expect(text.toLowerCase()).toContain("available");
    expect(text).toContain("10");
    expect(text).toContain("7.5");
    expect(text).toContain(SAMPLE.address);
  });

  it("renders a failure clearly", () => {
    const text = formatGatewayBalances({ ok: false, error: "boom" });
    expect(text.toLowerCase()).toContain("failed");
    expect(text).toContain("boom");
  });
});
