import type { Hex } from "viem";

/**
 * Resolve a Circle Gateway **settlement/transfer UUID** to the real **on-chain
 * transaction hash** (Stage 4 reporting fix).
 *
 * Circle's `/settle` returns `transaction: <UUID>` — a settlement/transfer id, NOT
 * an on-chain hash. The confirmed way to resolve it is
 * `GatewayClient.getTransferById(id)` (`@circle-fin/x402-batching/dist/client`),
 * whose `TransferResponse` has a typed `status` and untyped extras
 * (`[key: string]: unknown`, "preserve all fields as returned by the API").
 *
 * **Observed live (Arc testnet, read-only):** settlement is **async** — a freshly
 * settled authorization sits at `status: "received"` and the transfer object then
 * exposes only `id/status/token/networks/addresses/amount/timestamps` (no hash).
 * Gateway batches `received` transfers on-chain on its own cycle. So we poll for a
 * hash, extract a validated `0x…`-hash if one appears (defensively, since the field
 * is untyped), and otherwise report the batch id + status — **never a fake link**.
 * The balance delta is the reliable immediate proof that value moved.
 */

/** Transfer lifecycle (from the SDK `TransferStatus` union). */
export type TransferStatus = "received" | "batched" | "confirmed" | "completed" | "failed" | string;

/** A resolved transfer: its status, the on-chain hash (once available), and raw body. */
export interface TransferInfo {
  id: string;
  status: TransferStatus;
  txHash?: Hex;
  raw: Record<string, unknown>;
}

/** Seam for resolving a transfer id → info (real impl wraps `getTransferById`). */
export interface SettlementResolver {
  getTransfer(id: string): Promise<TransferInfo>;
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Known API field names that carry the on-chain transaction hash (checked first). */
const KNOWN_HASH_KEYS = [
  "transactionHash",
  "txHash",
  "transaction_hash",
  "onchainTxHash",
  "onChainTxHash",
  "settlementTxHash",
  "mintTransactionHash",
  "sourceTransactionHash",
  "hash",
] as const;

/** True iff `value` is a 32-byte `0x` transaction hash (not a UUID, not a short id). */
export function isOnChainTxHash(value: unknown): value is Hex {
  return typeof value === "string" && TX_HASH_RE.test(value);
}

function isHashKey(key: string): boolean {
  // Avoid false positives: a blockHash / parentHash is also 32-byte hex.
  const lower = key.toLowerCase();
  return !lower.includes("block") && !lower.includes("parent") && !lower.includes("nonce");
}

/**
 * Extract the on-chain tx hash from a raw transfer response: prefer known
 * transaction-hash keys, then any 32-byte `0x` hash one level deep (skipping
 * block/parent/nonce hashes). Returns undefined if none is present.
 */
export function extractTxHash(raw: Record<string, unknown>): Hex | undefined {
  for (const key of KNOWN_HASH_KEYS) {
    if (isOnChainTxHash(raw[key])) return raw[key] as Hex;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (isHashKey(key) && isOnChainTxHash(value)) return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [nk, nv] of Object.entries(value as Record<string, unknown>)) {
        if (isHashKey(nk) && isOnChainTxHash(nv)) return nv;
      }
    }
  }
  return undefined;
}

/** Options for {@link resolveSettlementTxHash}. */
export interface ResolveSettlementOptions {
  /** Max polls before giving up (default 8). */
  attempts?: number;
  /** Delay between polls in ms (default 3000). */
  delayMs?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * Poll a settlement/transfer id until it carries an on-chain tx hash (or reaches a
 * terminal status / runs out of attempts). Never fabricates a hash — if none is
 * ready, the returned {@link TransferInfo} has `txHash` undefined and the caller
 * reports the batch id + status instead of a link.
 */
export async function resolveSettlementTxHash(
  resolver: SettlementResolver,
  id: string,
  options: ResolveSettlementOptions = {},
): Promise<TransferInfo> {
  const attempts = options.attempts ?? 8;
  const delayMs = options.delayMs ?? 3000;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let info: TransferInfo = { id, status: "unknown", raw: {} };
  for (let i = 0; i < attempts; i++) {
    info = await resolver.getTransfer(id);
    if (info.txHash || TERMINAL_STATUSES.has(info.status)) return info;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return info;
}
