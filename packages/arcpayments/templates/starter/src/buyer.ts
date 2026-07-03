import {
  guardTransport,
  loadSpendGuardConfig,
  LocalWallet,
  SpendGuard,
  startPaymentLoop,
} from "arcpayments";
import type { Hex } from "viem";
import { buildSellerPaywall } from "./server.js";

/**
 * Buyer agent demo — pays the seller per call, with spend guards enforced BELOW the
 * agent. The guard authorizes every payment BEFORE it is signed, so no agent output
 * (even a prompt-injected one) can exceed the budget or pay an unlisted recipient.
 *
 * This wires the buyer to the seller IN-PROCESS for a self-contained demo. Needs
 * BUYER_PRIVATE_KEY (fund it with `npx arcpayments faucet`, deposit into Gateway
 * with `npx arcpayments gateway:deposit <amount>`).
 */
async function main(): Promise<void> {
  const buyerKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!buyerKey) {
    process.stderr.write("Set BUYER_PRIVATE_KEY (run `npx arcpayments wallet:new`).\n");
    process.exit(1);
    return;
  }
  const paywall = buildSellerPaywall();
  if (!paywall) {
    process.stderr.write("Set a seller identity (SELLER_ADDRESS or SELLER_PRIVATE_KEY).\n");
    process.exit(1);
    return;
  }

  const buyer = LocalWallet.fromPrivateKey(buyerKey as Hex);
  const transport = guardTransport(paywall.guard, async () => "PREMIUM-RESULT");

  // Safety kernel: bound the autonomous buyer. Limits come from ARC_GUARD_* env; the
  // recipient allowlist defaults to the seller so nothing else can ever be paid.
  const config = loadSpendGuardConfig(process.env);
  const guard = new SpendGuard({
    allowlist: [paywall.sellerAddress],
    ...config,
  });

  let nonce = 0;
  const nextNonce = (): Hex => `0x${(++nonce).toString(16).padStart(64, "0")}` as Hex;
  const maxCalls = Number(process.env.BUYER_CALLS ?? "3");

  const result = await startPaymentLoop({
    transport,
    wallet: buyer,
    nonce: nextNonce,
    maxCalls,
    maxTotalSpend: BigInt(maxCalls) * 10_000n, // headroom cap; the guard is the real bound
    guard,
  });

  process.stdout.write(
    `buyer: ${result.calls} paid call(s), spent ${result.totalSpent} base units, stopped by ${result.stoppedBy}` +
      `${result.reason ? ` (${result.reason})` : ""}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`buyer failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
