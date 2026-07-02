import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { resolveSellerAddress } from "../src/identity";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ADDR = privateKeyToAccount(KEY).address;

describe("resolveSellerAddress", () => {
  it("returns an explicit SELLER_ADDRESS (checksummed)", () => {
    expect(resolveSellerAddress({ SELLER_ADDRESS: ADDR.toLowerCase() })).toBe(ADDR);
  });

  it("derives the address from SELLER_PRIVATE_KEY when SELLER_ADDRESS is absent", () => {
    expect(resolveSellerAddress({ SELLER_PRIVATE_KEY: KEY })).toBe(ADDR);
  });

  it("prefers SELLER_ADDRESS over the derived key when both are set", () => {
    const other = "0x0000000000000000000000000000000000009999";
    expect(resolveSellerAddress({ SELLER_ADDRESS: other, SELLER_PRIVATE_KEY: KEY })).toBe(
      "0x0000000000000000000000000000000000009999",
    );
  });

  it("returns undefined when neither is configured", () => {
    expect(resolveSellerAddress({})).toBeUndefined();
  });

  it("throws on a malformed SELLER_ADDRESS rather than guessing", () => {
    expect(() => resolveSellerAddress({ SELLER_ADDRESS: "not-an-address" })).toThrow(
      /SELLER_ADDRESS/,
    );
  });
});
