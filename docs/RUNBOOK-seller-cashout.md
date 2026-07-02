# RUNBOOK — seller cash-out on Arc testnet

How the seller realizes earnings: **earn (x402) → `gateway:withdraw` (Gateway → Arc wallet) →
`cctp:transfer` (Arc → another chain via CCTP v2)**. The last leg **burns USDC** — irreversible —
so it is double opt-in. **Testnet only.** Never commit keys or `.env`. See `docs/adr-0002-seller-cashout.md`
for why each call works the way it does; all endpoints/chains/addresses come from `NETWORK.md` / the
`network` module, never hardcoded.

## 0. Prerequisites

- A gitignored `.env` (create with `arcpayments wallet:new`, or copy `.env.example`).
- `SELLER_PRIVATE_KEY` = the wallet that received x402 payments (the payout identity).
- The seller has a **non-zero Circle Gateway `available` balance** — i.e. buyers have paid and those
  x402 payments have settled. Check with `arcpayments gateway:balance 0xSELLER…`.
- Everything below is **testnet**; all USDC is test-value.

> **Timing gotcha.** x402 payments credit the recipient's unified balance ~instantly, but the
> on-chain batch settles in the background (~10 min in Stage 4 observations). `gateway:withdraw`
> gates on **`available`** — if it says "nothing withdrawable yet", the earnings simply haven't
> reached `available`; wait and re-run. It never fakes a hash.

## 1. Check the seller's Gateway balance

```bash
# SELLER_PRIVATE_KEY must be set (from your .env).
arcpayments gateway:balance 0xSELLER…
# → deposited vs available; you cash out the "available" bucket.
```

## 2. Withdraw Gateway → Arc wallet (`gateway:withdraw`)

Instant, same-chain (Arc). Defaults to the **full available** balance; pass an amount to withdraw less.

```bash
arcpayments gateway:withdraw            # withdraw all available
arcpayments gateway:withdraw 0.25       # or a specific amount
# → gateway:withdraw — moved 0.25 USDC to your Arc wallet (0x…)
#     mint tx: 0x…
#     explorer: https://testnet.arcscan.app/tx/0x…
```

Under the hood this is the SDK `GatewayClient.withdraw(amount)` — same chain, your own address,
`maxFee` default `2.01` USDC. The printed `mintTxHash` is the **real on-chain hash**.

> **Fee floor.** The instant withdraw carries a `maxFee` (default `2.01` USDC). Sub-cent balances
> (e.g. the `0.003` earned by three `$0.001` calls in Stage 4) are **below the fee** and will be
> rejected — top the balance up (more paid calls, or a Gateway deposit) before withdrawing.

## 3. Bridge cross-chain via CCTP v2 (`cctp:transfer`) — burns USDC

Moves Arc USDC to a destination chain: **burn on Arc → Circle attestation → mint on the destination.**
This **burns** the USDC on Arc — irreversible. Destination defaults to `base-sepolia`
(`ethereum-sepolia` is the documented fallback); recipient defaults to the seller's own address
unless `CCTP_RECIPIENT_ADDRESS` is set.

```bash
arcpayments cctp:transfer 0.5 --to base-sepolia
# → cctp:transfer — bridged 0.5 USDC to base-sepolia via CCTP v2
#     burn tx (Arc):          0x…   (USDC burned)
#     mint tx (base-sepolia): 0x…   (USDC minted on the destination)
```

Both hashes are real `0x` hashes; the command polls Circle's attestation with exponential backoff
between burn and mint. If it times out while still pending, it says so and tells you to **re-check
attestation before retrying (do NOT re-burn)** — the burn may already have landed.

## 4. One-shot live smoke (gated)

The end-to-end smoke is **gated** and never runs in CI — only with `LIVE=1` + `SELLER_PRIVATE_KEY`
(and, for the burn leg, an extra `CCTP=1`):

```bash
# Leg 1 only — withdraw all available to the Arc wallet:
LIVE=1 SELLER_PRIVATE_KEY=0x… bun run --filter metered-mcp live:cashout

# Legs 1 + 2 — withdraw, then bridge 0.5 to Base Sepolia (BURNS USDC):
LIVE=1 CCTP=1 CCTP_AMOUNT=0.5 CCTP_TO=base-sepolia \
  SELLER_PRIVATE_KEY=0x… bun run --filter metered-mcp live:cashout
```

Env knobs: `WITHDRAW_AMOUNT` (leg 1 amount; default full available), `CCTP_AMOUNT` (required when
`CCTP=1`), `CCTP_TO` (default `base-sepolia`), `CCTP_RECIPIENT_ADDRESS` (default: seller's address).

## 5. Verify on the explorers

- Withdraw + Arc burn: `https://testnet.arcscan.app/tx/0x…` (printed by the commands).
- Destination mint: the destination chain's explorer (e.g. Base Sepolia `sepolia.basescan.org`).

Record the hashes in your run notes — **do not commit them.**

## Safety notes

- CCTP **burns** USDC — the `cctp:transfer` / leg-2 smoke is irreversible and double opt-in (`CCTP=1`).
- Keys come only from env / a gitignored `.env`; nothing here logs or commits a key.
- CI never runs any of this (no keys, no `LIVE=1`) — these are local, human-run steps.
- Amounts, destinations, and endpoints are validated **before** any burn; a failed burn never mints.
