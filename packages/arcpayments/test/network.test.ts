import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  ARC_NATIVE_GAS_DECIMALS,
  ARC_TESTNET_DEFAULTS,
  USDC_ERC20_DECIMALS,
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
    expect(config.faucetUrl).toBe("https://faucet.circle.com");
  });

  it("reads the faucet URL from env when provided", () => {
    expect(loadNetworkConfig({ ARC_FAUCET_URL: "https://faucet.example.test" }).faucetUrl).toBe(
      "https://faucet.example.test",
    );
  });

  it("provides verified x402/Gateway defaults (USDC ERC-20, Gateway testnet, CAIP-2)", () => {
    const config = loadNetworkConfig({});
    expect(config.usdcAddress).toBe("0x3600000000000000000000000000000000000000");
    expect(config.gatewayUrl).toBe("https://gateway-api-testnet.circle.com");
    expect(config.caip2).toBe("eip155:5042002");
  });

  it("provides the confirmed Gateway-batched x402 signing domain (Part A)", () => {
    const config = loadNetworkConfig({});
    // verifyingContract is the GatewayWallet, NOT the USDC token.
    expect(config.gatewayWallet).toBe("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
    expect(config.x402Domain).toEqual({ name: "GatewayWalletBatched", version: "1" });
    expect(config.x402MinValiditySeconds).toBe(604800);
    expect(config.x402Version).toBe(2);
  });

  it("overrides the x402 domain + validity + version from env", () => {
    const config = loadNetworkConfig({
      ARC_GATEWAY_WALLET: "0x000000000000000000000000000000000000beef",
      ARC_X402_DOMAIN_NAME: "OtherDomain",
      ARC_X402_DOMAIN_VERSION: "2",
      ARC_X402_MIN_VALIDITY_SECONDS: "60",
      ARC_X402_VERSION: "1",
    });
    expect(config.gatewayWallet).toBe(getAddress("0x000000000000000000000000000000000000beef"));
    expect(config.x402Domain).toEqual({ name: "OtherDomain", version: "2" });
    expect(config.x402MinValiditySeconds).toBe(60);
    expect(config.x402Version).toBe(1);
  });

  it("derives the CAIP-2 id from the configured chain ID (env-only switch)", () => {
    expect(loadNetworkConfig({ ARC_CHAIN_ID: "5042" }).caip2).toBe("eip155:5042");
  });

  it("reads USDC address (checksummed) and Gateway URL from env when provided", () => {
    const lower = "0x000000000000000000000000000000000000dead";
    const config = loadNetworkConfig({
      ARC_USDC_ADDRESS: lower,
      ARC_GATEWAY_URL: "https://gateway.example.test",
    });
    expect(config.usdcAddress).toBe(getAddress(lower));
    expect(config.gatewayUrl).toBe("https://gateway.example.test");
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

describe("USDC decimals constants", () => {
  it("keeps native gas (18) and ERC-20 (6) distinct so nothing downstream flips them", () => {
    expect(ARC_NATIVE_GAS_DECIMALS).toBe(18);
    expect(USDC_ERC20_DECIMALS).toBe(6);
    expect(ARC_NATIVE_GAS_DECIMALS).not.toBe(USDC_ERC20_DECIMALS);
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
    const config = loadNetworkConfig({
      ARC_RPC_URL: "https://rpc.example.test",
      ARC_CHAIN_ID: "9999",
    });
    const client = createArcPublicClient(config);
    expect(client).toBeDefined();
    expect(client.chain?.id).toBe(9999);
    expect(typeof client.getChainId).toBe("function");
  });
});
