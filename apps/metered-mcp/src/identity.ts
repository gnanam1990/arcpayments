import { LocalWallet } from "arcpayments";
import { type Address, getAddress, isAddress } from "viem";

type Env = Record<string, string | undefined>;

/**
 * Resolve the server's **seller payout identity**.
 *
 * Prefers an explicit `SELLER_ADDRESS`; otherwise derives it from
 * `SELLER_PRIVATE_KEY` **through the arcpayments `Wallet` seam** (`LocalWallet`),
 * not viem directly — so a Circle-wallet backend can swap in without changing
 * callers. Returns `undefined` when neither is set.
 */
export function resolveSellerAddress(env: Env = process.env): Address | undefined {
  const explicit = env.SELLER_ADDRESS?.trim();
  if (explicit) {
    if (!isAddress(explicit)) {
      throw new Error(`SELLER_ADDRESS is not a valid address: "${explicit}"`);
    }
    return getAddress(explicit);
  }

  const privateKey = env.SELLER_PRIVATE_KEY?.trim();
  if (privateKey) {
    return LocalWallet.fromPrivateKey(privateKey as `0x${string}`).getAddress();
  }

  return undefined;
}
