# ADR-0002 — Seller cash-out (Gateway withdraw → CCTP cross-chain)

- **Status:** Accepted (2026-07-02 — gate on `available`, bridge-kit, Base Sepolia, deps approved)
- **Date:** 2026-07-02
- **Stage:** 5 (first genuine on-chain `0x` tx hashes; CCTP **burns** USDC — irreversible)
- **Deciders:** repo owner (Gnanam) + Claude

## Context

The seller must realize earnings: Gateway unified balance → the seller's Arc wallet →
CCTP the USDC to another testnet chain. CCTP burns are irreversible, so everything below
was confirmed from the SDK **dist** (not guessed) before proposing code.

---

## Finding 1 — Gateway withdrawal model  ⚠️ contradicts the stage's "gate on withdrawable"

From `@circle-fin/x402-batching/dist/client/index.{d.ts,mjs}`:

- **`withdraw(amount, { chain?, recipient?, maxFee? }) → WithdrawResult`** (the "instant" path).
  `chain` defaults to the **same chain** (Arc), `recipient` defaults to your address, `maxFee`
  defaults to **`2.01` USDC**. `transfer(amount, chain, recipient)` is a **deprecated alias**.
- `WithdrawResult = { mintTxHash: Hex, amount, formattedAmount, sourceChain, destinationChain, recipient }`
  — **`mintTxHash` is the real on-chain hash** (mint on the destination; for same-chain, the mint on Arc).
- The runtime **checks `gateway.available`**, not `withdrawable`:
  ```js
  if (balances.gateway.available < withdrawAmount) throw "Insufficient available balance…"
  ```
  It then builds a **CCTP-style burn intent** (a `TransferSpec`/`BurnIntent` with `sourceDomain`/
  `destinationDomain`), signs it (domain `GatewayWallet`/`1`), and Circle attests + mints.

**⚠️ Correction to the Stage 4 note / the stage prompt.** The instant `withdraw()` draws from
**`available`**. `withdrawable`/`withdrawing` belong to a **different, emergency path** — the
*trustless* withdrawal (`getTrustlessWithdrawalDelay` / `initiateTrustlessWithdrawal` /
`completeTrustlessWithdrawal`), which is on-chain-only with a **~7-day delay**, "for emergency use
only when Circle's API is unavailable" (SDK docs). So gating `gateway:withdraw` on `withdrawable > 0`
would **block it forever** for the normal path (our seller shows `available` 0.003 / `withdrawable` 0).

> **Decision needed (A):** gate `gateway:withdraw` on **`available`** (amount ≤ available), matching the
> SDK — NOT `withdrawable`. This reverses the stage's "gate strictly on withdrawable" instruction; the
> stage note was based on observing `withdrawable = 0`, which is the trustless bucket, not the instant one.

**Fees/cadence:** the instant path settles via Circle's attestation service (fast); `maxFee` default
`2.01` USDC. Our seller balance is **0.003 USDC** → far below the fee/any minimum, so a live run needs a
**top-up** (more buyer-loop calls, or faucet the seller). Same-chain withdraw fee may be lower than
cross-chain; we'll surface `maxFee` and fail cleanly if `amount ≤ fee`.

---

## Finding 2 — CCTP v2 path Arc → destination (bridge-kit)

CCTP **is live for Arc testnet** — confirmed from `@circle-fin/bridge-kit` chain configs (dist):

| Chain | chainId | USDC | CCTP v2 domain | tokenMessenger / messageTransmitter | explorer |
|-------|---------|------|----------------|-------------------------------------|----------|
| **Arc Testnet** | 5042002 | `0x3600…0000` | **26** | `0x8FE6B999…2DAA` / `0xE737e5cE…CE275` | `testnet.arcscan.app/tx/{hash}` |
| **Base Sepolia** (recommended dest) | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | **6** | `0x8fe6b999…` / `0xe737e5ce…` | `sepolia.basescan.org/tx/{hash}` |
| Ethereum Sepolia (fallback) | 11155111 | in kit config | 0 | in kit config | etherscan |

**SDK choice: `@circle-fin/bridge-kit` (higher-level) — recommended.** Circle's README calls it *"the
recommended integration surface for USDC bridging … full CCTPv2 support"*. `bridge-kit` **depends on
`@circle-fin/provider-cctp-v2`** (the underlying CCTP v2 provider). One call does the whole
**burn → wait-for-attestation → mint**, with retries; it resolves USDC addresses / CCTP domains /
contracts / explorer URLs **from the chain name**, so we reference `BridgeChain.Arc_Testnet` /
`Base_Sepolia` and **hardcode nothing**.

```ts
import { BridgeKit, BridgeChain } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
const kit = new BridgeKit();
const adapter = createViemAdapterFromPrivateKey({ privateKey: SELLER_PRIVATE_KEY });
const result = await kit.bridge({
  from: { adapter, chain: BridgeChain.Arc_Testnet },
  to:   { adapter, chain: BridgeChain.Base_Sepolia, recipientAddress },
  amount: "0.01",
});
// BridgeResult { state: 'pending'|'success'|'error', source{…}, destination{…}, steps[] with per-step tx hashes }
```

- **Attestation** (Circle's service) + polling/backoff are handled **inside** `kit.bridge()`; bridge
  **speed** is configurable (FAST = higher fee/faster, SLOW = lower fee), and `kit.estimate()` returns
  fees upfront.
- New deps to add (after approval): **`@circle-fin/bridge-kit`** + **`@circle-fin/adapter-viem-v2`**
  (`provider-cctp-v2` comes transitively). Both verified on npm.
- Env supplies only: `SELLER_PRIVATE_KEY` (never logged) + an optional destination recipient
  (`CCTP_RECIPIENT_ADDRESS`, defaults to the seller's own address).

---

## Decision (recommended)

**Two-step cash-out** (demonstrates both primitives + gives hashes on both explorers):

1. **`arcpayments gateway:withdraw [amount]`** — `GatewayClient.withdraw(amount)` **same-chain** (Arc) →
   seller's Arc wallet. **Gate on `available`** (amount ≤ available, > 0); if 0, report state + the
   ~10.5-min settle cadence and exit cleanly. Prints the real `mintTxHash` + `testnet.arcscan.app/tx/…`.
2. **`arcpayments cctp:transfer <amount> --to <chain>`** — `bridge-kit` `kit.bridge({ from: Arc_Testnet,
   to: <chain>, amount, recipientAddress })` → burn on Arc → attest → mint on dest. Surfaces the burn
   (Arc) + mint (dest) hashes with resolving links; failures surfaced (not swallowed); a failed burn
   never proceeds to mint (bridge-kit's `state`/`steps`).

**Destination:** **Base Sepolia** (confirmed Arc↔Base-Sepolia CCTP v2). Fallback: Ethereum Sepolia.
Chosen via `--to`, defaulting to Base Sepolia — chain specifics resolved by the kit, nothing hardcoded.

*(Alternative, noted not chosen: `GatewayClient.withdraw({ chain: dest })` does Gateway-balance →
dest in one call. The stage wants the explicit CCTP demonstration, so we keep the two steps.)*

## Open questions for approval

- **(A)** Gate `gateway:withdraw` on **`available`** (SDK reality), not `withdrawable` (stage text)? *Recommend yes.*
- **(B)** CCTP provider = **`@circle-fin/bridge-kit`** (+ `adapter-viem-v2`, `provider-cctp-v2` transitive)? *Recommend yes.*
- **(C)** Destination chain = **Base Sepolia** (fallback Ethereum Sepolia)? *Recommend yes.*
- **(D)** Add deps `@circle-fin/bridge-kit`, `@circle-fin/adapter-viem-v2` (per CLAUDE rule 8)?
- **Live run caveat:** 0.003 USDC is below the withdraw fee (`maxFee` 2.01) / CCTP practicality — a live
  cash-out needs a seller **top-up** first (documented in the runbook). Mocked tests + CI need none.

## Sources
- `@circle-fin/x402-batching@3.2.0` `dist/client` — `withdraw()`/`transfer()`/`WithdrawResult`,
  `available`-check, trustless-withdrawal methods.
- `@circle-fin/bridge-kit@1.11.1` `dist` — `BridgeKit`, `BridgeChain` (Arc_Testnet + Base_Sepolia),
  per-chain CCTP v2 domains/contracts/USDC/explorer, `BridgeResult`, README ("recommended … full CCTPv2").
- `@circle-fin/adapter-viem-v2`, `@circle-fin/provider-cctp-v2` — npm (HTTP 200).
- Arc contract addresses — <https://docs.arc.io/arc/references/contract-addresses>.
