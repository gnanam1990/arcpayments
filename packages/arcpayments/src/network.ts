import { http, type Chain, createPublicClient, defineChain } from "viem";

/** Resolved Arc network configuration. The single source of truth for endpoints. */
export interface NetworkConfig {
  /** Human-readable network name, e.g. "arc-testnet". */
  name: string;
  /** JSON-RPC endpoint. */
  rpcUrl: string;
  /** EVM chain ID. */
  chainId: number;
  /** Block explorer base URL. */
  explorerUrl: string;
  /** Testnet faucet URL. */
  faucetUrl: string;
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
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
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

  return { name, rpcUrl, chainId, explorerUrl, faucetUrl };
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
