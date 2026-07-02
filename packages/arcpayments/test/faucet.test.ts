import { describe, expect, it } from "vitest";
import type { BalanceReader } from "../src/balance";
import { faucetCheck, formatFaucetInstructions } from "../src/faucet";
import { ARC_TESTNET_DEFAULTS } from "../src/network";

const ADDR = "0x00000000000000000000000000000000dEAD0001" as const;

function reader(raw: bigint): BalanceReader {
  return { getBalance: async () => raw };
}

describe("faucetCheck", () => {
  it("reports funded when the balance is above zero", async () => {
    const result = await faucetCheck(ADDR, reader(10n ** 18n));
    expect(result.funded).toBe(true);
    expect(result.formatted).toBe("1");
  });

  it("reports not funded when the balance is zero", async () => {
    const result = await faucetCheck(ADDR, reader(0n));
    expect(result.funded).toBe(false);
    expect(result.formatted).toBe("0");
  });
});

describe("formatFaucetInstructions", () => {
  it("prints the faucet URL and every address to fund", () => {
    const text = formatFaucetInstructions(ARC_TESTNET_DEFAULTS, [
      { role: "buyer", address: ADDR },
      { role: "seller", address: "0x00000000000000000000000000000000dEAD0002" },
    ]);
    expect(text).toContain(ARC_TESTNET_DEFAULTS.faucetUrl);
    expect(text).toContain(ADDR);
    expect(text).toContain("0x00000000000000000000000000000000dEAD0002");
    expect(text.toLowerCase()).toContain("buyer");
    expect(text.toLowerCase()).toContain("seller");
  });
});
