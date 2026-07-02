import type { Address } from "viem";
import { type BalanceReader, getBalance } from "./balance";
import type { NetworkConfig } from "./network";

/** An address to fund, with the role it plays. */
export interface FaucetTarget {
  role: string;
  address: Address;
}

/** Result of checking whether faucet funds have landed. */
export interface FaucetCheckResult {
  address: Address;
  funded: boolean;
  /** Native balance formatted from 18 decimals. */
  formatted: string;
}

/**
 * Check whether an address has any native (gas) USDC yet.
 * Reads via the Stage 1 network client unless a reader is injected (tests).
 */
export async function faucetCheck(
  address: Address,
  reader?: BalanceReader,
): Promise<FaucetCheckResult> {
  const balance = await getBalance(address, reader);
  return { address, funded: balance.raw > 0n, formatted: balance.formatted };
}

/** Human-readable faucet instructions: where to go and which addresses to fund. */
export function formatFaucetInstructions(config: NetworkConfig, targets: FaucetTarget[]): string {
  const header = `Fund your testnet wallets with USDC:\n  ${config.faucetUrl}\n`;
  if (targets.length === 0) {
    return `${header}\nNo wallets found. Run \`arcpayments wallet:new\` first.\n`;
  }
  const lines = targets.map((t) => `  ${t.role.padEnd(6)} ${t.address}`);
  return `${header}\nAddresses to fund:\n${lines.join("\n")}\n\nThen verify: arcpayments faucet --check <address>\n`;
}
