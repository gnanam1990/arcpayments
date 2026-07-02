#!/usr/bin/env node
/**
 * LIVE settlement smoke — settles a real batch on Arc testnet. NOT run in CI.
 *
 * Gated: does nothing unless BOTH `LIVE=1` and `BUYER_PRIVATE_KEY` are set. This
 * is a documented local script, never part of the test suite.
 *
 * Prerequisites (see NETWORK.md + `arcpayments faucet`):
 *  - BUYER_PRIVATE_KEY holds a wallet whose USDC is deposited into Circle Gateway
 *    (Gateway settles from the buyer's Gateway balance, not the raw token balance).
 *  - SELLER_ADDRESS (or SELLER_PRIVATE_KEY) is the payout identity.
 *
 * What it does: runs the buyer loop for a small N (buyer signs EIP-3009 locally,
 * seller verifies locally and queues), then flushes ONE batch to Circle Gateway,
 * which settles on-chain. Prints the settlement tx hash + explorer link.
 *
 *   LIVE=1 BUYER_PRIVATE_KEY=0x… SELLER_ADDRESS=0x… bun run apps/metered-mcp/scripts/live-settle.ts
 */
import {
  GatewayBatchSettler,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  LocalWallet,
  PaywallGuard,
  USDC_ERC20_DECIMALS,
  buildPaymentRequirements,
  flushBatch,
  guardTransport,
  loadNetworkConfig,
  startPaymentLoop,
} from "arcpayments";
import type { Hex } from "viem";
import { PAID_TOOL_PRICE } from "../src/server";

async function main(): Promise<void> {
  const live = process.env.LIVE === "1";
  const buyerKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!live || !buyerKey) {
    process.stdout.write(
      "live-settle: skipped (set LIVE=1 and BUYER_PRIVATE_KEY to run a real on-chain settlement).\n",
    );
    return;
  }

  const net = loadNetworkConfig();
  const buyer = LocalWallet.fromPrivateKey(buyerKey as Hex);
  const sellerAddress = (process.env.SELLER_ADDRESS?.trim() ??
    (process.env.SELLER_PRIVATE_KEY
      ? LocalWallet.fromPrivateKey(process.env.SELLER_PRIVATE_KEY as Hex).getAddress()
      : buyer.getAddress())) as `0x${string}`;

  const n = Number(process.env.LIVE_CALLS ?? "3");
  process.stdout.write(
    `live-settle: buyer ${buyer.getAddress()} → seller ${sellerAddress}, ${n} calls @ ${PAID_TOOL_PRICE} on ${net.caip2}\n`,
  );

  // Seller side (in-process): guard with the confirmed Gateway domain + a queue.
  const queue = new InMemorySettlementQueue();
  const guard = new PaywallGuard({
    requirements: buildPaymentRequirements({
      price: PAID_TOOL_PRICE,
      payTo: sellerAddress,
      caip2: net.caip2,
      asset: net.usdcAddress,
      verifyingContract: net.gatewayWallet,
      usdcDecimals: USDC_ERC20_DECIMALS,
      eip712: net.x402Domain,
      maxTimeoutSeconds: net.x402MinValiditySeconds,
    }),
    verifier: new LocalExactVerifier(new InMemoryNonceStore()),
    queue,
  });
  const transport = guardTransport(guard, async () => "PREMIUM-RESULT");

  let nonceSeq = 0;
  const nextNonce = (): Hex => `0x${(++nonceSeq).toString(16).padStart(64, "0")}` as Hex;

  // 1) Buyer loop: sign locally, never broadcast per call.
  const loop = await startPaymentLoop({
    transport,
    wallet: buyer,
    nonce: nextNonce,
    maxCalls: n,
    // hard spend cap: n calls worth of base units, with headroom
    maxTotalSpend: BigInt(n) * 10_000n,
  });
  process.stdout.write(
    `live-settle: loop made ${loop.calls} paid calls (stoppedBy=${loop.stoppedBy})\n`,
  );

  // 2) Settle ONE batch on-chain via Circle Gateway.
  const settler = GatewayBatchSettler.create({ gatewayUrl: net.gatewayUrl });
  const outcome = await flushBatch(queue, settler);

  if (!outcome) {
    process.stdout.write("live-settle: nothing to settle.\n");
    return;
  }
  process.stdout.write(
    `live-settle: settled ${outcome.settled.length}, failed ${outcome.failed.length}\n`,
  );
  if (outcome.failed.length > 0) {
    process.stdout.write(`live-settle: failures: ${JSON.stringify(outcome.failed)}\n`);
  }
  if (outcome.transaction) {
    process.stdout.write(`live-settle: SETTLEMENT TX ${outcome.transaction}\n`);
    process.stdout.write(`live-settle: explorer ${net.explorerUrl}/tx/${outcome.transaction}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`live-settle failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
