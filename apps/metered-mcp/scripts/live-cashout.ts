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
 * Guards (see `runSellerCashout`): when CCTP=1, WITHDRAW_AMOUNT is REQUIRED (no
 * implicit full-available withdraw before a burn), and if leg 1 fails the script
 * exits non-zero and NEVER burns.
 *
 *   # withdraw only:
 *   LIVE=1 SELLER_PRIVATE_KEY=0x… bun run apps/metered-mcp/scripts/live-cashout.ts
 *   # withdraw a fixed amount then bridge 0.5 to Base Sepolia (WITHDRAW_AMOUNT required):
 *   LIVE=1 CCTP=1 WITHDRAW_AMOUNT=14 CCTP_AMOUNT=0.5 CCTP_TO=base-sepolia \
 *     SELLER_PRIVATE_KEY=0x… bun run apps/metered-mcp/scripts/live-cashout.ts
 */
import {
  createCctpBridge,
  createGatewayWithdrawer,
  loadNetworkConfig,
  runSellerCashout,
} from "arcpayments";
import type { Hex } from "viem";

async function main(): Promise<number> {
  const live = process.env.LIVE === "1";
  const sellerKey = process.env.SELLER_PRIVATE_KEY?.trim();
  if (!live || !sellerKey) {
    process.stdout.write(
      "live-cashout: skipped (set LIVE=1 and SELLER_PRIVATE_KEY to run a real cash-out).\n",
    );
    return 0;
  }

  const net = loadNetworkConfig();
  const withdrawer = createGatewayWithdrawer({
    privateKey: sellerKey as Hex,
    chain: net.gatewayChainName,
    rpcUrl: net.rpcUrl,
  });
  const recipient = process.env.CCTP_RECIPIENT_ADDRESS?.trim();
  const withdrawAmount = process.env.WITHDRAW_AMOUNT?.trim();
  const cctpAmount = process.env.CCTP_AMOUNT?.trim();
  const cctpToChain = process.env.CCTP_TO?.trim();

  // All leg-sequencing + guards live in the (unit-tested) orchestrator; this
  // script only wires real seams and maps the result to an exit code. The bridge
  // is built lazily so it is never constructed when a guard trips before the burn.
  const result = await runSellerCashout({
    withdrawer,
    explorerUrl: net.explorerUrl,
    caip2: net.caip2,
    cctp: process.env.CCTP === "1",
    ...(withdrawAmount ? { withdrawAmount } : {}),
    ...(cctpAmount ? { cctpAmount } : {}),
    ...(cctpToChain ? { cctpToChain } : {}),
    ...(recipient ? { cctpRecipient: recipient } : {}),
    makeBridge: () =>
      createCctpBridge({ privateKey: sellerKey as Hex, ...(recipient ? { recipient } : {}) }),
    write: (msg) => process.stdout.write(msg),
    writeErr: (msg) => process.stderr.write(msg),
  });
  return result.code;
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(
      `live-cashout failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
