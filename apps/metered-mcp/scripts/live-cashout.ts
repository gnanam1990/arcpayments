#!/usr/bin/env node
/**
 * LIVE seller cash-out smoke (Stage 5, ADR-0002). NOT run in CI.
 *
 * Gated: does nothing unless BOTH `LIVE=1` and `SELLER_PRIVATE_KEY` are set. This
 * is a documented local script, never part of the test suite. It moves REAL
 * (test-value) USDC and — in the CCTP leg — **BURNS** it, so it is opt-in only.
 *
 * Two legs, each independently gated so you can run them one at a time:
 *
 *  1) gateway:withdraw — cash the seller's Circle Gateway balance out to their Arc
 *     wallet via the SDK's instant same-chain `withdraw()`. Gates on
 *     `gateway.available` (see ADR-0002); prints the real on-chain `mintTxHash`.
 *     Default amount = full available; override with WITHDRAW_AMOUNT.
 *
 *  2) cctp:transfer — bridge Arc USDC to a destination chain via CCTP v2 (burn on
 *     Arc → attestation → mint on the destination). Runs ONLY when CCTP=1 (extra
 *     opt-in, because it BURNS USDC). Destination from CCTP_TO (default
 *     base-sepolia); amount from CCTP_AMOUNT (required when CCTP=1).
 *
 *   # withdraw only:
 *   LIVE=1 SELLER_PRIVATE_KEY=0x… bun run apps/metered-mcp/scripts/live-cashout.ts
 *   # withdraw a fixed amount then bridge 0.5 to Base Sepolia:
 *   LIVE=1 CCTP=1 CCTP_AMOUNT=0.5 CCTP_TO=base-sepolia \
 *     SELLER_PRIVATE_KEY=0x… bun run apps/metered-mcp/scripts/live-cashout.ts
 */
import {
  createCctpBridge,
  createGatewayWithdrawer,
  formatCctpReport,
  formatWithdrawReport,
  loadNetworkConfig,
  runCctpTransfer,
  runGatewayWithdraw,
} from "arcpayments";
import type { Hex } from "viem";

async function main(): Promise<void> {
  const live = process.env.LIVE === "1";
  const sellerKey = process.env.SELLER_PRIVATE_KEY?.trim();
  if (!live || !sellerKey) {
    process.stdout.write(
      "live-cashout: skipped (set LIVE=1 and SELLER_PRIVATE_KEY to run a real cash-out).\n",
    );
    return;
  }

  const net = loadNetworkConfig();

  // Leg 1 — Gateway → Arc wallet (instant, same-chain).
  const withdrawer = createGatewayWithdrawer({
    privateKey: sellerKey as Hex,
    chain: net.gatewayChainName,
    rpcUrl: net.rpcUrl,
  });
  const withdrawAmount = process.env.WITHDRAW_AMOUNT?.trim();
  process.stdout.write(
    `live-cashout: leg 1 — gateway:withdraw ${withdrawAmount ?? "(full available)"} on ${net.caip2}\n`,
  );
  const withdraw = await runGatewayWithdraw(withdrawer, withdrawAmount);
  process.stdout.write(formatWithdrawReport(withdraw, net.explorerUrl));

  // Leg 2 — CCTP cross-chain burn→attest→mint. Extra opt-in (burns USDC).
  if (process.env.CCTP !== "1") {
    process.stdout.write(
      "live-cashout: leg 2 (cctp:transfer) skipped — set CCTP=1 (+ CCTP_AMOUNT) to bridge. It BURNS USDC.\n",
    );
    return;
  }
  const cctpAmount = process.env.CCTP_AMOUNT?.trim();
  if (!cctpAmount) {
    process.stderr.write("live-cashout: CCTP=1 requires CCTP_AMOUNT (USDC to burn/bridge).\n");
    process.exit(1);
    return;
  }
  const toChain = process.env.CCTP_TO?.trim() || "base-sepolia";
  const recipient = process.env.CCTP_RECIPIENT_ADDRESS?.trim();
  process.stdout.write(
    `live-cashout: leg 2 — cctp:transfer ${cctpAmount} USDC → ${toChain}${recipient ? ` (recipient ${recipient})` : ""}\n`,
  );
  const bridge = createCctpBridge({
    privateKey: sellerKey as Hex,
    ...(recipient ? { recipient } : {}),
  });
  const cctp = await runCctpTransfer(bridge, { amount: cctpAmount, toChain });
  process.stdout.write(formatCctpReport(cctp));
  if (!cctp.ok) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `live-cashout failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
