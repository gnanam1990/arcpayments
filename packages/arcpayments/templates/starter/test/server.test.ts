import { describe, expect, it } from "vitest";
import { buildSellerPaywall, createServer, resolveSellerAddress } from "../src/server.js";

const SELLER = "0x00000000000000000000000000000000dEAD0001";

describe("metered MCP server", () => {
  it("builds an echo-only server when no seller identity is configured", () => {
    const server = createServer({ paywall: undefined });
    expect(server).toBeDefined();
  });

  it("resolves the seller identity from SELLER_ADDRESS", () => {
    expect(resolveSellerAddress({ SELLER_ADDRESS: SELLER })).toBeDefined();
    expect(resolveSellerAddress({})).toBeUndefined();
  });

  it("builds a paid paywall when a seller is configured", () => {
    const paywall = buildSellerPaywall({ SELLER_ADDRESS: SELLER });
    expect(paywall?.sellerAddress).toBeDefined();
    expect(paywall?.queue.all()).toEqual([]); // no payments yet
  });
});
