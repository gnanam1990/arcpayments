import {
  type GatewayBalanceReader,
  type SettlementQueue,
  SpendGuard,
  createGatewayBalanceReader,
  loadNetworkConfig,
  loadSpendGuardConfig,
} from "arcpayments";
import type { Hex } from "viem";
import { resolveSellerAddress } from "../identity";
import { PAID_TOOL_PRICE } from "../server";
import { SellerState } from "./state";

/**
 * Wire the real seller state for the dashboard from env (Stage 7).
 *
 * - Seller identity + network label + price → the header.
 * - A Stage 6 `SpendGuard` is built ONLY when `ARC_GUARD_*` is configured; its
 *   `onDeny` is routed into the state so denied payments appear in the safety panel.
 * - A **server-side** Gateway balance reader is built only when `SELLER_PRIVATE_KEY`
 *   is present — the key never leaves the server; the browser sees formatted numbers.
 *
 * Everything is read-only. The same `queue` the metered-mcp paid tool writes to is
 * passed in, so the feed reflects REAL payments.
 */
export interface WireOptions {
  env: Record<string, string | undefined>;
  /** The SAME settlement queue the paid tool writes to. */
  queue: SettlementQueue;
  /** Override the balance reader (tests); otherwise derived from the seller key. */
  balanceReader?: GatewayBalanceReader;
}

export interface WiredSeller {
  state: SellerState;
  /** The guard the dashboard surfaces (also usable by a co-located buyer loop). */
  guard?: SpendGuard;
}

export function buildSellerState(options: WireOptions): WiredSeller {
  const { env, queue } = options;
  const address = resolveSellerAddress(env) ?? null;
  const net = loadNetworkConfig(env);
  const network = env.ARC_NETWORK_NAME?.trim() || "Arc testnet";

  const guardConfig = loadSpendGuardConfig(env);
  const hasGuard = Object.keys(guardConfig).length > 0;

  // Resolve the balance reader server-side only (needs a key). Never sent to the browser.
  let balanceReader = options.balanceReader;
  const sellerKey = env.SELLER_PRIVATE_KEY?.trim();
  if (!balanceReader && sellerKey) {
    balanceReader = createGatewayBalanceReader({
      privateKey: sellerKey as Hex,
      chain: net.gatewayChainName,
      rpcUrl: net.rpcUrl,
    });
  }

  // Guard needs the state for onDeny; state needs the guard for snapshot. The onDeny
  // closure captures `state` (declared just below) and only fires later, at runtime.
  const guard = hasGuard
    ? new SpendGuard(guardConfig, {
        onDeny: (d) =>
          state.recordDenial({
            guard: d.guard,
            reason: d.reason,
            recipient: d.recipient,
            amount: d.amount,
          }),
      })
    : undefined;

  const state = new SellerState({
    queue,
    seller: { address, network, price: PAID_TOOL_PRICE },
    ...(guard ? { guard } : {}),
    ...(balanceReader ? { balanceReader } : {}),
  });

  return { state, ...(guard ? { guard } : {}) };
}
