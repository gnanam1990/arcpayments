import { type CctpBridge, formatCctpReport, runCctpTransfer } from "./cctp";
import { type GatewayWithdrawer, formatWithdrawReport, runGatewayWithdraw } from "./withdraw";

/**
 * Seller cash-out orchestrator (Stage 5): leg 1 `gateway:withdraw` → optional
 * leg 2 `cctp:transfer` (an **irreversible burn**). Pure of process/IO — takes
 * injected seams and output sinks and returns an exit code, so the guards that
 * protect the burn are unit-testable without keys or network. The live script is
 * a thin wrapper that builds real seams and calls this.
 *
 * Two guards protect the burn:
 *  1. If a burn will follow (`cctp`), the withdraw amount MUST be explicit — we
 *     refuse to default to full-available before a burn, so leg 1 is deterministic
 *     and leaves gas headroom.
 *  2. If leg 1 did not succeed, we exit non-zero and NEVER burn.
 */
export interface SellerCashoutOptions {
  withdrawer: GatewayWithdrawer;
  /** WITHDRAW_AMOUNT (decimal USDC); undefined ⇒ full available (withdraw-only). */
  withdrawAmount?: string;
  explorerUrl: string;
  caip2: string;
  /** Is a CCTP burn leg requested (CCTP=1)? */
  cctp: boolean;
  /** CCTP_AMOUNT (decimal USDC) — required when `cctp`. */
  cctpAmount?: string;
  /** Destination chain for the burn; defaults to `base-sepolia`. */
  cctpToChain?: string;
  /** For the log line only; recipient defaults to the seller's own address. */
  cctpRecipient?: string;
  /** Lazily builds the real CCTP bridge — only invoked once leg 2 is reached. */
  makeBridge?: () => CctpBridge;
  write: (msg: string) => void;
  writeErr?: (msg: string) => void;
}

export interface SellerCashoutResult {
  /** Process exit code (0 = success). */
  code: number;
  /** Whether the irreversible CCTP burn was actually attempted. */
  burned: boolean;
}

export async function runSellerCashout(
  options: SellerCashoutOptions,
): Promise<SellerCashoutResult> {
  const writeErr = options.writeErr ?? options.write;

  // Guard 1 — a burn will follow, so refuse an implicit (full-available) withdraw
  // and refuse a missing burn amount, BEFORE moving any funds.
  if (options.cctp) {
    if (!options.withdrawAmount?.trim()) {
      writeErr(
        "live-cashout: CCTP=1 requires an explicit WITHDRAW_AMOUNT — refusing to default to " +
          "full-available before a burn (leg 1 must be deterministic and leave gas headroom).\n",
      );
      return { code: 1, burned: false };
    }
    if (!options.cctpAmount?.trim()) {
      writeErr("live-cashout: CCTP=1 requires CCTP_AMOUNT (USDC to burn/bridge).\n");
      return { code: 1, burned: false };
    }
  }

  // Leg 1 — Gateway → Arc wallet (instant, same-chain).
  options.write(
    `live-cashout: leg 1 — gateway:withdraw ${options.withdrawAmount ?? "(full available)"} on ${options.caip2}\n`,
  );
  const withdraw = await runGatewayWithdraw(options.withdrawer, options.withdrawAmount);
  options.write(formatWithdrawReport(withdraw, options.explorerUrl));

  // Guard 2 — if leg 1 did not succeed, halt non-zero and NEVER burn.
  if (!withdraw.ok) {
    writeErr("live-cashout: leg 1 (gateway:withdraw) did not succeed — halting; NOT burning.\n");
    return { code: 1, burned: false };
  }

  // Leg 2 gate — CCTP cross-chain burn→attest→mint. Extra opt-in (burns USDC).
  if (!options.cctp) {
    options.write(
      "live-cashout: leg 2 (cctp:transfer) skipped — set CCTP=1 (+ CCTP_AMOUNT) to bridge. It BURNS USDC.\n",
    );
    return { code: 0, burned: false };
  }

  const makeBridge = options.makeBridge;
  if (!makeBridge) {
    writeErr("live-cashout: internal error — no CCTP bridge factory provided.\n");
    return { code: 1, burned: false };
  }
  const toChain = options.cctpToChain?.trim() || "base-sepolia";
  options.write(
    `live-cashout: leg 2 — cctp:transfer ${options.cctpAmount} USDC → ${toChain}${options.cctpRecipient ? ` (recipient ${options.cctpRecipient})` : ""}\n`,
  );
  const bridge = makeBridge();
  const cctp = await runCctpTransfer(bridge, {
    amount: options.cctpAmount as string,
    toChain,
  });
  options.write(formatCctpReport(cctp));
  return { code: cctp.ok ? 0 : 1, burned: true };
}
