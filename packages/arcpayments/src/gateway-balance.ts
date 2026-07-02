import { getAddress, isAddress } from "viem";

/**
 * `arcpayments gateway:balance` core (Stage 4 add-on).
 *
 * Reads the buyer's **Circle Gateway** balance — deposited (total) vs available to
 * spend — via the same `GatewayClient` that `gateway:deposit` uses. This is the
 * pure orchestration; the real backend (`GatewayClient.getBalances()`) is wired in
 * `paywall-gateway.ts` and is never exercised in CI.
 */

/** A snapshot of an address's balances (formatted USDC strings, from the SDK). */
export interface GatewayBalances {
  /** The address these balances belong to (checksummed). */
  address: string;
  /** Raw wallet USDC balance (NOT in Gateway). */
  walletFormatted: string;
  /** Total deposited into Gateway. */
  gatewayTotalFormatted: string;
  /** Available to spend now. */
  gatewayAvailableFormatted: string;
  /** Currently being withdrawn. */
  gatewayWithdrawingFormatted: string;
  /** Ready to withdraw. */
  gatewayWithdrawableFormatted: string;
}

/** Seam for the balance backend — mockable in CI, real `GatewayClient` in prod. */
export interface GatewayBalanceReader {
  /** Read balances for `address` (defaults to the client's own account). */
  getBalances(address?: string): Promise<GatewayBalances>;
}

/** Structured outcome of a balance read. */
export interface GatewayBalanceReport {
  ok: boolean;
  error?: string;
  balances?: GatewayBalances;
}

/**
 * Validate the optional address, read balances, and report. A malformed address
 * is refused without touching the network; a failing read is surfaced, not thrown.
 */
export async function runGatewayBalance(
  reader: GatewayBalanceReader,
  address?: string,
): Promise<GatewayBalanceReport> {
  let target: string | undefined;
  if (address !== undefined) {
    const trimmed = address.trim();
    if (!isAddress(trimmed)) {
      return { ok: false, error: `invalid address "${address}" — expected a 0x… EVM address.` };
    }
    target = getAddress(trimmed);
  }

  try {
    const balances = await reader.getBalances(target);
    return { ok: true, balances };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Render a {@link GatewayBalanceReport} for the terminal. Contains no key material. */
export function formatGatewayBalances(report: GatewayBalanceReport): string {
  if (!report.ok || !report.balances) {
    return `gateway:balance failed: ${report.error ?? "unknown error"}\n`;
  }
  const b = report.balances;
  return [
    `gateway:balance — ${b.address}`,
    `  deposited (total):   ${b.gatewayTotalFormatted} USDC`,
    `  available to spend:  ${b.gatewayAvailableFormatted} USDC`,
    `  withdrawing:         ${b.gatewayWithdrawingFormatted} USDC`,
    `  withdrawable:        ${b.gatewayWithdrawableFormatted} USDC`,
    `  wallet (not in Gateway): ${b.walletFormatted} USDC`,
    "",
  ].join("\n");
}
