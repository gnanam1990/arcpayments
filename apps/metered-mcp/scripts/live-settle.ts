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
 * seller verifies locally and queues), then submits ONE batch to Circle Gateway.
 * A successful flush = Gateway **ACCEPTED** the authorizations (verified + queued),
 * which is NOT on-chain finality — the on-chain batch settles periodically in the
 * background (no dev-facing flush; cadence not published by Circle). We report the
 * transfer status (received/batched/…/completed) separately, resolve the settlement
 * UUID → the real `0x…` hash via `getTransferById`, and only build the explorer link
 * from an on-chain-`completed` hash. Also prints unified-balance deltas.
 *
 *   LIVE=1 BUYER_PRIVATE_KEY=0x… SELLER_ADDRESS=0x… bun run apps/metered-mcp/scripts/live-settle.ts
 *
 * PREFLIGHT: pass `--verify-only` (or VERIFY_ONLY=1) to sign ONE payment and call
 * Gateway /verify, printing the RAW facilitator response — so you see exactly why a
 * payment is rejected before settling a batch. No settlement is submitted.
 *
 *   LIVE=1 BUYER_PRIVATE_KEY=0x… bun run apps/metered-mcp/scripts/live-settle.ts --verify-only
 */
import {
  GatewayBatchSettler,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  LocalWallet,
  ON_CHAIN_FINAL_STATUS,
  PaywallGuard,
  USDC_ERC20_DECIMALS,
  buildPaymentRequirements,
  createGatewayBalanceReader,
  createSettlementResolver,
  describeTransferStatus,
  flushBatch,
  guardTransport,
  isOnChainSettled,
  loadNetworkConfig,
  resolveSettlementTxHash,
  startPaymentLoop,
} from "arcpayments";
import type { Hex } from "viem";
import { PAID_TOOL_PRICE, PAID_TOOL_RESOURCE } from "../src/server";

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

  const verifyOnly = process.argv.includes("--verify-only") || process.env.VERIFY_ONLY === "1";
  const n = verifyOnly ? 1 : Number(process.env.LIVE_CALLS ?? "3");
  process.stdout.write(
    `live-settle${verifyOnly ? " (verify-only)" : ""}: buyer ${buyer.getAddress()} → seller ${sellerAddress}, ${n} call(s) @ ${PAID_TOOL_PRICE} on ${net.caip2}\n`,
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
    resource: PAID_TOOL_RESOURCE,
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
    `live-settle: loop made ${loop.calls} paid call(s) (stoppedBy=${loop.stoppedBy})\n`,
  );

  const settler = GatewayBatchSettler.create({ gatewayUrl: net.gatewayUrl });

  // PREFLIGHT: verify the first signed payment against Gateway and print the raw response.
  if (verifyOnly) {
    const first = queue.pending()[0];
    if (!first) {
      process.stdout.write("live-settle: nothing to verify.\n");
      return;
    }
    const result = await settler.verify(first);
    process.stdout.write(`live-settle: /verify isValid=${result.ok}\n`);
    process.stdout.write(
      `live-settle: raw /verify response: ${JSON.stringify(result.raw ?? { error: result.error }, null, 2)}\n`,
    );
    return;
  }

  // Independent proof of settlement: Gateway balances before → after.
  const balances = createGatewayBalanceReader({
    privateKey: buyerKey as Hex,
    chain: net.gatewayChainName,
    rpcUrl: net.rpcUrl,
  });
  const buyerBefore = (await balances.getBalances(buyer.getAddress())).gatewayAvailableFormatted;
  const sellerBefore = (await balances.getBalances(sellerAddress)).gatewayTotalFormatted;

  // 2) Submit ONE batch to Circle Gateway. NOTE: a successful flush means Gateway
  //    ACCEPTED the authorizations (verified + queued) — it is NOT on-chain finality.
  //    The on-chain batch settles periodically in the background (no dev-facing flush).
  const outcome = await flushBatch(queue, settler);

  if (!outcome) {
    process.stdout.write("live-settle: nothing to settle.\n");
    return;
  }
  const total = outcome.settled.length + outcome.failed.length;
  process.stdout.write(
    `live-settle: Gateway ACCEPTED ${outcome.settled.length}/${total} authorization(s) ` +
      `(verified + queued for on-chain batch — NOT yet on-chain-confirmed). ${outcome.failed.length} failed.\n`,
  );
  // Print the FULL Gateway error for each failed payment — not a generic message.
  for (const failure of outcome.failed) {
    process.stdout.write(`live-settle: FAILED ${failure.id}: ${failure.error}\n`);
  }

  // 3) Report on-chain settlement state separately, and resolve the UUID → real hash.
  if (outcome.transaction) {
    const settlementId = outcome.transaction;
    process.stdout.write(
      `live-settle: Circle settlement/transfer ID (UUID, not a tx hash): ${settlementId}\n`,
    );
    const resolver = createSettlementResolver({
      privateKey: buyerKey as Hex,
      chain: net.gatewayChainName,
      rpcUrl: net.rpcUrl,
    });
    const info = await resolveSettlementTxHash(resolver, settlementId, {
      attempts: 8,
      delayMs: 3000,
    });
    process.stdout.write(
      `live-settle: on-chain settlement status=${info.status} — ${describeTransferStatus(info.status)}\n`,
    );
    if (isOnChainSettled(info.status) && info.txHash) {
      process.stdout.write(`live-settle: ON-CHAIN CONFIRMED — tx ${info.txHash}\n`);
      process.stdout.write(`live-settle: explorer ${net.explorerUrl}/tx/${info.txHash}\n`);
    } else {
      // Not on-chain yet — do NOT build a fake /tx/<uuid> link.
      process.stdout.write(
        `live-settle: NOT on-chain-confirmed yet — track batch ID ${settlementId} ` +
          `(getTransferById → status "${ON_CHAIN_FINAL_STATUS}"). Raw: ${JSON.stringify(info.raw)}\n`,
      );
    }
  }

  // Unified-balance deltas (independent proof): Circle credits the recipient's
  // unified balance ~instantly on acceptance — this updates before on-chain finality.
  const buyerAfter = (await balances.getBalances(buyer.getAddress())).gatewayAvailableFormatted;
  const sellerAfter = (await balances.getBalances(sellerAddress)).gatewayTotalFormatted;
  process.stdout.write(
    `live-settle: buyer Gateway available (unified): ${buyerBefore} → ${buyerAfter} USDC\n`,
  );
  process.stdout.write(
    `live-settle: seller Gateway total (unified):   ${sellerBefore} → ${sellerAfter} USDC\n`,
  );
  process.stdout.write(
    "live-settle: (unified balance = off-chain ledger; on-chain finality is the transfer status above)\n",
  );
}

main().catch((err) => {
  process.stderr.write(`live-settle failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
