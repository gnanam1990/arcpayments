import { type Address, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Env = Record<string, string | undefined>;

/**
 * Resolve the server's **seller payout identity**.
 *
 * Prefers an explicit `SELLER_ADDRESS`; otherwise derives it from
 * `SELLER_PRIVATE_KEY`. Returns `undefined` when neither is set. Stage 2 only
 * *holds* this identity — no receiving/settlement until Stage 3, which will route
 * signing through the `arcpayments` Wallet seam.
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
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  }

  return undefined;
}
