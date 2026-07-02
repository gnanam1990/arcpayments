import { describe, expect, it } from "vitest";
import {
  ARC_NATIVE_GAS_DECIMALS,
  ARC_TESTNET_DEFAULTS,
  createArcPublicClient,
  defineArcChain,
  loadNetworkConfig,
} from "../src/network";

describe("loadNetworkConfig", () => {
  it("falls back to the verified Arc testnet defaults when env is empty", () => {
    const config = loadNetworkConfig({});
    expect(config).toEqual(ARC_TESTNET_DEFAULTS);
    expect(config.rpcUrl).toBe("https://rpc.testnet.arc.network");
    expect(config.chainId).toBe(5042002);
    expect(config.explorerUrl).toBe("https://testnet.arcscan.app");
  });

  it("returns the values configured via env (network switch is env-only)", () => {
    const config = loadNetworkConfig({
      ARC_RPC_URL: "https://rpc.example.test",
      ARC_CHAIN_ID: "9999",
      ARC_EXPLORER_URL: "https://explorer.example.test",
    });
    expect(config.rpcUrl).toBe("https://rpc.example.test");
    expect(config.chainId).toBe(9999);
    expect(config.explorerUrl).toBe("https://explorer.example.test");
  });

  it("throws on a non-integer ARC_CHAIN_ID rather than guessing", () => {
    expect(() => loadNetworkConfig({ ARC_CHAIN_ID: "not-a-number" })).toThrow(/ARC_CHAIN_ID/);
    expect(() => loadNetworkConfig({ ARC_CHAIN_ID: "-1" })).toThrow(/ARC_CHAIN_ID/);
  });
});

describe("defineArcChain", () => {
  it("models USDC native gas as 18 decimals (gas-math), not the 6-decimal ERC-20", () => {
    const chain = defineArcChain(ARC_TESTNET_DEFAULTS);
    expect(chain.id).toBe(ARC_TESTNET_DEFAULTS.chainId);
    expect(chain.nativeCurrency.symbol).toBe("USDC");
    expect(chain.nativeCurrency.decimals).toBe(ARC_NATIVE_GAS_DECIMALS);
    expect(ARC_NATIVE_GAS_DECIMALS).toBe(18);
  });
});

describe("createArcPublicClient", () => {
  it("builds a viem client without throwing and targets the configured chain", () => {
    const config = loadNetworkConfig({ ARC_RPC_URL: "https://rpc.example.test", ARC_CHAIN_ID: "9999" });
    const client = createArcPublicClient(config);
    expect(client).toBeDefined();
    expect(client.chain?.id).toBe(9999);
    expect(typeof client.getChainId).toBe("function");
  });
});
