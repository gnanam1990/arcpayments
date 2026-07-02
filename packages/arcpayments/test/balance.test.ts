import { describe, expect, it } from "vitest";
import { type BalanceReader, getBalance } from "../src/balance";

const ADDR = "0x0000000000000000000000000000000000001234" as const;

/** A mock reader returning a fixed native (18-decimal) balance. */
function reader(raw: bigint): BalanceReader {
  return { getBalance: async () => raw };
}

describe("getBalance", () => {
  it("formats a native (18-decimal) balance of 1 USDC", async () => {
    const bal = await getBalance(ADDR, reader(10n ** 18n));
    expect(bal.formatted).toBe("1");
    expect(bal.decimals).toBe(18);
    expect(bal.raw).toBe(10n ** 18n);
  });

  it("formats half a USDC", async () => {
    const bal = await getBalance(ADDR, reader(5n * 10n ** 17n));
    expect(bal.formatted).toBe("0.5");
  });

  it("formats dust (1 wei of native) without rounding to zero", async () => {
    const bal = await getBalance(ADDR, reader(1n));
    expect(bal.formatted).toBe("0.000000000000000001");
  });

  it("reports zero for an empty account", async () => {
    const bal = await getBalance(ADDR, reader(0n));
    expect(bal.formatted).toBe("0");
    expect(bal.raw).toBe(0n);
  });
});
