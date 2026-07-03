import { describe, expect, it } from "vitest";
import { buildSellerPaywall, createServer, resolveSellerAddress } from "../src/server.js";

const SELLER = "0x000000000000000000000000000000000000dEaD"; // valid checksummed test address

describe("metered MCP server", () => {
  it("resolves the seller identity from SELLER_ADDRESS (and none when unset)", () => {
    expect(resolveSellerAddress({ SELLER_ADDRESS: SELLER })).toBeDefined();
    expect(resolveSellerAddress({})).toBeUndefined();
  });

  it("builds no paywall without a seller, and a paid paywall with one", () => {
    expect(buildSellerPaywall({})).toBeUndefined(); // echo-only
    const paywall = buildSellerPaywall({ SELLER_ADDRESS: SELLER });
    expect(paywall?.sellerAddress).toBeDefined();
    expect(paywall?.queue.all()).toEqual([]); // no payments yet
  });

  it("constructs a server (with and without a paywall)", () => {
    const paywall = buildSellerPaywall({ SELLER_ADDRESS: SELLER });
    expect(createServer(paywall ? { paywall } : {})).toBeDefined();
  });
});
