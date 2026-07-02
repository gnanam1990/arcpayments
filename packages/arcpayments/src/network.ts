import { type Address, http, type Chain, createPublicClient, defineChain, getAddress } from "viem";

/** EIP-712 domain identity of a token (for signing/verifying EIP-3009 authorizations). */
export interface Eip712TokenDomain {
  name: string;
  version: string;
}

/** Resolved Arc network configuration. The single source of truth for endpoints. */
export interface NetworkConfig {
  /** Human-readable network name, e.g. "arc-testnet". */
  name: string;
  /** JSON-RPC endpoint. */
  rpcUrl: string;
  /** EVM chain ID. */
  chainId: number;
  /** CAIP-2 chain id, e.g. "eip155:5042002" — used by x402 payment requirements. */
  caip2: string;
  /** Block explorer base URL. */
  explorerUrl: string;
  /** Testnet faucet URL. */
  faucetUrl: string;
  /** USDC **ERC-20** token address (x402 payment asset; 6 decimals). */
  usdcAddress: Address;
  /** Circle Gateway facilitator base URL (x402 verify/settle). */
  gatewayUrl: string;
  /**
   * USDC ERC-20 EIP-712 domain (name/version) used when signing/verifying
   * authorizations. Production should confirm these from the Gateway `/supported`
   * response; overridable via env. Defaults are a reasonable Circle-USDC value.
   */
  usdcEip712: Eip712TokenDomain;
}

/**
 * Verified Arc **testnet** values (see repo `NETWORK.md`, confirmed against
 * docs.arc.io/arc/references/connect-to-arc). This module is the ONLY place these
 * defaults live — every other file reads them from here or from env. Switching to
 * mainnet later is env-only (`ARC_RPC_URL` + `ARC_CHAIN_ID`), no code change.
 */
export const ARC_TESTNET_DEFAULTS: NetworkConfig = {
  name: "arc-testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  chainId: 5042002,
  caip2: "eip155:5042002",
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayUrl: "https://gateway-api-testnet.circle.com",
  usdcEip712: { name: "USDC", version: "1" },
};

/**
 * Decimals for USDC **as Arc's native gas token** — 18, for EVM gas math
 * (NETWORK.md). This is deliberately NOT {@link USDC_ERC20_DECIMALS}. Both scales
 * live here as named constants so nothing downstream guesses or flips them.
 */
export const ARC_NATIVE_GAS_DECIMALS = 18;

/**
 * Decimals for the USDC **ERC-20 token** — 6. Used for x402 payment amounts
 * (Stage 3+). Never use this for native/gas balances — see {@link ARC_NATIVE_GAS_DECIMALS}.
 */
export const USDC_ERC20_DECIMALS = 6;

/** Minimal env shape the network module reads. */
export type NetworkEnv = Record<string, string | undefined>;

/**
 * Load the active network config from env, falling back to the verified Arc
 * testnet defaults. Network selection is env-only:
 *   ARC_RPC_URL, ARC_CHAIN_ID, ARC_EXPLORER_URL, ARC_NETWORK_NAME (optional).
 *
 * @throws if ARC_CHAIN_ID is set but is not a positive integer (never guess).
 */
export function loadNetworkConfig(env: NetworkEnv = process.env): NetworkConfig {
  const rpcUrl = env.ARC_RPC_URL?.trim() || ARC_TESTNET_DEFAULTS.rpcUrl;
  const explorerUrl = env.ARC_EXPLORER_URL?.trim() || ARC_TESTNET_DEFAULTS.explorerUrl;
  const faucetUrl = env.ARC_FAUCET_URL?.trim() || ARC_TESTNET_DEFAULTS.faucetUrl;

  let chainId = ARC_TESTNET_DEFAULTS.chainId;
  const rawChainId = env.ARC_CHAIN_ID?.trim();
  if (rawChainId) {
    const parsed = Number(rawChainId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid ARC_CHAIN_ID: "${rawChainId}" — expected a positive integer (e.g. ${ARC_TESTNET_DEFAULTS.chainId}).`,
      );
    }
    chainId = parsed;
  }

  const name =
    env.ARC_NETWORK_NAME?.trim() ||
    (chainId === ARC_TESTNET_DEFAULTS.chainId ? "arc-testnet" : `arc-${chainId}`);

  const usdcAddress = getAddress(env.ARC_USDC_ADDRESS?.trim() || ARC_TESTNET_DEFAULTS.usdcAddress);
  const gatewayUrl = env.ARC_GATEWAY_URL?.trim() || ARC_TESTNET_DEFAULTS.gatewayUrl;
  const usdcEip712: Eip712TokenDomain = {
    name: env.ARC_USDC_EIP712_NAME?.trim() || ARC_TESTNET_DEFAULTS.usdcEip712.name,
    version: env.ARC_USDC_EIP712_VERSION?.trim() || ARC_TESTNET_DEFAULTS.usdcEip712.version,
  };

  return {
    name,
    rpcUrl,
    chainId,
    caip2: `eip155:${chainId}`,
    explorerUrl,
    faucetUrl,
    usdcAddress,
    gatewayUrl,
    usdcEip712,
  };
}

/** Build a viem {@link Chain} from a {@link NetworkConfig}. */
export function defineArcChain(config: NetworkConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: {
      name: "USD Coin",
      symbol: "USDC",
      decimals: ARC_NATIVE_GAS_DECIMALS,
    },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
    blockExplorers: {
      default: { name: "Arcscan", url: config.explorerUrl },
    },
    testnet: config.chainId === ARC_TESTNET_DEFAULTS.chainId,
  });
}

/**
 * Create a read-only viem public client pointed at Arc.
 * Defaults to the env-resolved config so callers switch networks via env alone.
 */
export function createArcPublicClient(config: NetworkConfig = loadNetworkConfig()) {
  return createPublicClient({
    chain: defineArcChain(config),
    transport: http(config.rpcUrl),
  });
}

/** The concrete viem client type returned by {@link createArcPublicClient}. */
export type ArcPublicClient = ReturnType<typeof createArcPublicClient>;
