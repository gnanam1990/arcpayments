import { isOnChainTxHash } from "./gateway-settlement";

/**
 * `arcpayments gateway:withdraw` core (Stage 5, ADR-0002).
 *
 * Moves the seller's Circle Gateway balance to their **Arc wallet** via the SDK's
 * instant `withdraw()`. **Gates on `available`** (the instant path checks
 * `gateway.available`, not `withdrawable` — `withdrawable`/`withdrawing` are the
 * trustless ~7-day path; see NETWORK.md). Produces a real on-chain `mintTxHash`.
 */

/** Result of a Gateway withdraw (mirrors the SDK `WithdrawResult`). */
export interface WithdrawResult {
  mintTxHash: string;
  amount: string;
  formattedAmount: string;
  sourceChain: string;
  destinationChain: string;
  recipient: string;
}

/** Seam for the withdraw backend — mockable in CI, real `GatewayClient` in prod. */
export interface GatewayWithdrawer {
  /** Formatted `gateway.available` balance (USDC). */
  availableFormatted(): Promise<string>;
  /** Withdraw `amount` (decimal USDC) to the Arc wallet; returns the mint tx. */
  withdraw(amount: string): Promise<WithdrawResult>;
}

export interface WithdrawReport {
  ok: boolean;
  available: string;
  requested?: string;
  error?: string;
  result?: WithdrawResult;
}

const AMOUNT_RE = /^\d+(?:\.\d+)?$/;

/**
 * Withdraw from Gateway to the Arc wallet. Refuses when `available` is 0 (reports
 * the ~10-minute settle cadence and exits clean — never fakes it). Defaults the
 * amount to the full available balance; rejects amounts above available; surfaces
 * withdraw failures (e.g. amount below the fee) instead of throwing.
 */
export async function runGatewayWithdraw(
  withdrawer: GatewayWithdrawer,
  amount?: string,
): Promise<WithdrawReport> {
  const available = await withdrawer.availableFormatted();
  const availableNum = Number(available);
  if (!(availableNum > 0)) {
    return {
      ok: false,
      available,
      error: `nothing withdrawable yet — gateway available is ${available} USDC. x402 payments credit ~instantly but batch-settle on-chain in ~10 min; check back after the transfer reaches "completed".`,
    };
  }

  const requested = amount?.trim() || available;
  if (!AMOUNT_RE.test(requested) || Number(requested) <= 0) {
    return {
      ok: false,
      available,
      requested,
      error: `invalid amount "${requested}" — expected a positive USDC amount.`,
    };
  }
  if (Number(requested) > availableNum) {
    return {
      ok: false,
      available,
      requested,
      error: `amount ${requested} exceeds available ${available} USDC.`,
    };
  }

  try {
    const result = await withdrawer.withdraw(requested);
    return { ok: true, available, requested, result };
  } catch (err) {
    return {
      ok: false,
      available,
      requested,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Render a withdraw report. Builds an explorer link ONLY from a valid `0x` hash. */
export function formatWithdrawReport(report: WithdrawReport, explorerUrl: string): string {
  if (!report.ok || !report.result) {
    return `gateway:withdraw failed (available ${report.available}): ${report.error ?? "unknown error"}\n`;
  }
  const r = report.result;
  const lines = [
    `gateway:withdraw — moved ${r.formattedAmount} USDC to your Arc wallet (${r.recipient})`,
    `  mint tx: ${r.mintTxHash}`,
  ];
  if (isOnChainTxHash(r.mintTxHash)) {
    lines.push(`  explorer: ${explorerUrl}/tx/${r.mintTxHash}`);
  }
  lines.push(
    "",
    "Next: bridge cross-chain with `arcpayments cctp:transfer <amount> --to <chain>`.",
  );
  return `${lines.join("\n")}\n`;
}
