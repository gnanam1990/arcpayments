/**
 * `arcpayments gateway:deposit` core (Stage 4 add-on).
 *
 * The x402 buyer pays from its **Circle Gateway balance**, not its raw wallet
 * balance — so testnet USDC must be deposited into Gateway before the live loop
 * can settle. This is the pure orchestration; the real backend (`GatewayClient`
 * from `@circle-fin/x402-batching/client`) is wired in `paywall-gateway.ts` and
 * is never exercised in CI (it signs + broadcasts on-chain).
 */

/** Result of an on-chain deposit into Circle Gateway (mirrors the SDK `DepositResult`). */
export interface DepositResult {
  /** Approval tx hash, if an ERC-20 approve was needed. */
  approvalTxHash?: string;
  /** The deposit transaction hash. */
  depositTxHash: string;
  /** Amount deposited in USDC atomic units (6 decimals), as a string. */
  amount: string;
  /** Human-readable deposited amount, e.g. "10". */
  formattedAmount: string;
  /** Address that now owns the Gateway balance. */
  depositor: string;
}

/** Seam for the deposit backend — mockable in CI, real `GatewayClient` in prod. */
export interface GatewayDepositor {
  /** Deposit `amount` (decimal USDC string) into Gateway; returns tx hashes. */
  deposit(amount: string): Promise<DepositResult>;
  /** Available Gateway balance after the deposit (formatted USDC). */
  availableBalance(): Promise<string>;
}

/** Structured outcome of a deposit run. */
export interface GatewayDepositReport {
  ok: boolean;
  requested: string;
  error?: string;
  result?: DepositResult;
  gatewayBalanceAfter?: string;
}

const AMOUNT_RE = /^\d+(?:\.\d+)?$/;

/**
 * Validate the amount, deposit into Gateway, and report the tx + resulting
 * balance. A malformed/non-positive amount is refused without touching the chain;
 * a failing deposit is surfaced, never thrown.
 */
export async function runGatewayDeposit(
  depositor: GatewayDepositor,
  amount: string,
): Promise<GatewayDepositReport> {
  const trimmed = amount.trim();
  if (!AMOUNT_RE.test(trimmed) || Number(trimmed) <= 0) {
    return {
      ok: false,
      requested: amount,
      error: `invalid amount "${amount}" — expected a positive USDC amount like "10" or "2.5".`,
    };
  }

  try {
    const result = await depositor.deposit(trimmed);
    const gatewayBalanceAfter = await depositor.availableBalance();
    return { ok: true, requested: trimmed, result, gatewayBalanceAfter };
  } catch (err) {
    return {
      ok: false,
      requested: trimmed,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Render a {@link GatewayDepositReport} for the terminal. Contains no key material. */
export function formatGatewayDepositReport(report: GatewayDepositReport): string {
  if (!report.ok) {
    return `gateway:deposit failed (requested ${report.requested}): ${report.error ?? "unknown error"}\n`;
  }
  const r = report.result;
  const lines = [
    `gateway:deposit — deposited ${r?.formattedAmount ?? report.requested} USDC into Circle Gateway`,
    r?.approvalTxHash ? `  approval tx:  ${r.approvalTxHash}` : undefined,
    `  deposit tx:   ${r?.depositTxHash ?? "?"}`,
    `  Gateway balance now: ${report.gatewayBalanceAfter ?? "?"} USDC (available to spend)`,
    "",
    "Next: run the buyer loop / live settlement (arcpayments-driven).",
  ].filter((l): l is string => l !== undefined);
  return `${lines.join("\n")}\n`;
}
