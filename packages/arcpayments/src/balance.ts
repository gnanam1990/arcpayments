import { type Address, formatUnits } from "viem";
import { ARC_NATIVE_GAS_DECIMALS, createArcPublicClient } from "./network";

/**
 * Minimal seam for reading a native balance — satisfied by the viem public
 * client, and trivially mockable in tests.
 */
export interface BalanceReader {
  getBalance(args: { address: Address }): Promise<bigint>;
}

/** A native (gas) USDC balance, formatted from 18 decimals. */
export interface NativeBalance {
  address: Address;
  /** Raw base units (18-decimal native scale). */
  raw: bigint;
  /** Human-readable amount, formatted from {@link ARC_NATIVE_GAS_DECIMALS}. */
  formatted: string;
  /** Always {@link ARC_NATIVE_GAS_DECIMALS} (18) — the native/gas scale. */
  decimals: number;
  symbol: "USDC";
}

/**
 * Read an account's **native USDC (gas) balance** on Arc.
 *
 * Formats from **18 decimals** (native/gas scale) — deliberately not the
 * 6-decimal USDC ERC-20 scale (that path arrives with x402 amounts in Stage 3).
 */
export async function getBalance(
  address: Address,
  reader: BalanceReader = createArcPublicClient(),
): Promise<NativeBalance> {
  const raw = await reader.getBalance({ address });
  return {
    address,
    raw,
    formatted: formatUnits(raw, ARC_NATIVE_GAS_DECIMALS),
    decimals: ARC_NATIVE_GAS_DECIMALS,
    symbol: "USDC",
  };
}
