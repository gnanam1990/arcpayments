import { http, type Address, type Chain, createPublicClient, defineChain, getAddress } from "viem";

/** EIP-712 domain identity (name/version) for signing/verifying authorizations. */
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
  /** GatewayWallet contract — the EIP-712 `verifyingContract` for batched x402 (NOT USDC). */
  gatewayWallet: Address;
  /**
   * x402 signing domain (name/version) for the Circle Gateway **batched** scheme.
   * Confirmed from the Gateway `/supported` response (NETWORK.md, Stage 4):
   * `GatewayWalletBatched` / `1` — NOT the USDC token's own domain. Env-overridable.
   */
  x402Domain: Eip712TokenDomain;
  /** Minimum authorization validity Gateway requires (seconds). Buyer signs `validBefore ≥ now + this`. */
  x402MinValiditySeconds: number;
  /** x402 protocol version advertised/settled with Circle Gateway. */
  x402Version: number;
  /** Circle Gateway SDK chain identifier (e.g. `arcTestnet`; `arc` for mainnet). */
  gatewayChainName: string;
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
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  x402Domain: { name: "GatewayWalletBatched", version: "1" },
  x402MinValiditySeconds: 604800,
  x402Version: 2,
  gatewayChainName: "arcTestnet",
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
  const gatewayWallet = getAddress(
    env.ARC_GATEWAY_WALLET?.trim() || ARC_TESTNET_DEFAULTS.gatewayWallet,
  );
  const x402Domain: Eip712TokenDomain = {
    name: env.ARC_X402_DOMAIN_NAME?.trim() || ARC_TESTNET_DEFAULTS.x402Domain.name,
    version: env.ARC_X402_DOMAIN_VERSION?.trim() || ARC_TESTNET_DEFAULTS.x402Domain.version,
  };
  const x402MinValiditySeconds = intFromEnv(
    env.ARC_X402_MIN_VALIDITY_SECONDS,
    ARC_TESTNET_DEFAULTS.x402MinValiditySeconds,
    "ARC_X402_MIN_VALIDITY_SECONDS",
  );
  const x402Version = intFromEnv(
    env.ARC_X402_VERSION,
    ARC_TESTNET_DEFAULTS.x402Version,
    "ARC_X402_VERSION",
  );
  const gatewayChainName =
    env.ARC_GATEWAY_CHAIN_NAME?.trim() || ARC_TESTNET_DEFAULTS.gatewayChainName;

  return {
    name,
    rpcUrl,
    chainId,
    caip2: `eip155:${chainId}`,
    explorerUrl,
    faucetUrl,
    usdcAddress,
    gatewayUrl,
    gatewayWallet,
    x402Domain,
    x402MinValiditySeconds,
    x402Version,
    gatewayChainName,
  };
}

/** Parse a positive-integer env var, falling back to a default; throws on invalid. */
function intFromEnv(raw: string | undefined, fallback: number, key: string): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: "${trimmed}" — expected a positive integer.`);
  }
  return parsed;
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
