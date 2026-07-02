#!/usr/bin/env node
/**
 * READ-ONLY settlement inspector — proves where paid settlements went. Makes NO
 * settlement and moves NO funds; only `getBalances` / `searchTransfers` /
 * `getTransferById` (all read-only). NOT run in CI.
 *
 * Gated: needs BUYER_PRIVATE_KEY. Optionally set TRANSFER_IDS=<uuid>,<uuid> to
 * resolve specific settlement/transfer IDs from a prior run, and SELLER_ADDRESS.
 *
 *   BUYER_PRIVATE_KEY=0x… [SELLER_ADDRESS=0x…] [TRANSFER_IDS=…] \
 *     bun run apps/metered-mcp/scripts/inspect-settlement.ts
 */
import { LocalWallet, createGatewayInspector, loadNetworkConfig } from "arcpayments";
import { type Hex, formatUnits } from "viem";
import { resolveSellerAddress } from "../src/identity";

/** JSON.stringify that renders bigints verbatim (never loses precision). */
function j(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? `${v.toString()} (bigint)` : v),
    2,
  );
}

/** Exact decimal for a 6-decimal USDC atomic amount (no display rounding). */
function usdc(atomic: unknown): string {
  try {
    return `${formatUnits(BigInt(atomic as string | number | bigint), 6)} USDC (atomic ${String(atomic)})`;
  } catch {
    return String(atomic);
  }
}

async function main(): Promise<void> {
  const buyerKey = process.env.BUYER_PRIVATE_KEY?.trim();
  if (!buyerKey) {
    process.stdout.write("inspect: set BUYER_PRIVATE_KEY (read-only; no funds move).\n");
    return;
  }
  const net = loadNetworkConfig();
  const buyer = LocalWallet.fromPrivateKey(buyerKey as Hex).getAddress();
  const seller = (process.env.SELLER_ADDRESS?.trim() ??
    resolveSellerAddress() ??
    buyer) as `0x${string}`;
  const inspector = createGatewayInspector({
    privateKey: buyerKey as Hex,
    chain: net.gatewayChainName,
    rpcUrl: net.rpcUrl,
  });

  process.stdout.write(`inspect: buyer ${buyer} · seller ${seller} · ${net.caip2}\n\n`);

  // (2) FULL raw balances for buyer AND seller, with exact per-bucket decimals.
  for (const [label, addr] of [
    ["BUYER", buyer],
    ["SELLER", seller],
  ] as const) {
    const b = (await inspector.balances(addr)) as {
      wallet?: { balance?: unknown; formatted?: string };
      gateway?: Record<string, unknown>;
    };
    process.stdout.write(`===== ${label} getBalances(${addr}) RAW =====\n${j(b)}\n`);
    const g = b.gateway ?? {};
    process.stdout.write(
      `----- ${label} exact gateway buckets -----\n` +
        `  total:        ${usdc(g.total)}\n` +
        `  available:    ${usdc(g.available)}\n` +
        `  withdrawing:  ${usdc(g.withdrawing)}\n` +
        `  withdrawable: ${usdc(g.withdrawable)}\n` +
        `  wallet(USDC): ${usdc(b.wallet?.balance)}\n\n`,
    );
  }

  // (1) searchTransfers involving buyer / seller — FULL raw.
  for (const [label, params] of [
    ["from=BUYER", { from: buyer }],
    ["to=SELLER", { to: seller }],
    ["to=BUYER", { to: buyer }],
    ["from=SELLER", { from: seller }],
  ] as const) {
    const res = (await inspector.transfers(params)) as { transfers?: unknown[] };
    const list = Array.isArray(res.transfers) ? res.transfers : [];
    process.stdout.write(
      `===== searchTransfers(${label}) → ${list.length} transfer(s) RAW =====\n${j(res)}\n\n`,
    );
  }

  // (3) Resolve explicit settlement/transfer IDs from the prior run, if provided.
  const ids = (process.env.TRANSFER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    try {
      const t = await inspector.transfer(id);
      process.stdout.write(`===== getTransferById(${id}) RAW =====\n${j(t)}\n\n`);
    } catch (err) {
      process.stdout.write(
        `getTransferById(${id}) error: ${err instanceof Error ? err.message : String(err)}\n\n`,
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`inspect failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
