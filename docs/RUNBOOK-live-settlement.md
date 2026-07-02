# RUNBOOK — live x402 settlement on Arc testnet

How to actually move money: fund a buyer wallet, deposit into Circle Gateway, run the
capped buyer loop, and settle one batch on-chain. **Testnet only.** Never commit keys or `.env`.

> Why a deposit step? Circle Gateway settles from the buyer's **Gateway balance**, not the
> raw wallet USDC balance. So the flow is **faucet → deposit → settle**. The signing domain
> and all endpoints/addresses come from `NETWORK.md` / the `network` module (see the Stage 4
> Part A confirmation: domain `GatewayWalletBatched`, verifyingContract = GatewayWallet).

## 0. Prerequisites

- A gitignored `.env` (create with `arcpayments wallet:new`, or copy `.env.example`).
- `BUYER_PRIVATE_KEY` = the wallet that pays. `SELLER_ADDRESS` (or `SELLER_PRIVATE_KEY`) = payout.
- Everything below is **testnet**; all USDC is test-value.

## 1. Fund the buyer wallet (faucet)

```bash
arcpayments faucet                          # prints the faucet URL + your addresses
# open https://faucet.circle.com, send testnet USDC to the BUYER address, then:
arcpayments faucet --check 0xBUYER…         # exit 0 once funds land
```

## 2. Deposit USDC into Circle Gateway

Gateway pays from the deposited balance, so deposit before settling:

```bash
# BUYER_PRIVATE_KEY must be set (from your .env). Amount is decimal USDC.
arcpayments gateway:deposit 1
# → approval tx + deposit tx + "Gateway balance now: 1 USDC (available to spend)"
```

Under the hood this uses the SDK `GatewayClient.deposit()` (approve + deposit on the
GatewayWallet contract `0x0077…`). The chain is `gatewayChainName` (`arcTestnet`) from config.

## 3. Run the capped buyer loop + settle one batch on-chain

The live settlement smoke is **gated** — it only runs with `LIVE=1` and `BUYER_PRIVATE_KEY`:

```bash
LIVE=1 BUYER_PRIVATE_KEY=0x… SELLER_ADDRESS=0x… LIVE_CALLS=3 \
  bun run --filter metered-mcp live:settle
```

It runs the buyer loop for `LIVE_CALLS` calls (signs EIP-3009 locally — **no per-call
broadcast**; hard caps on count + spend), then flushes **one batch** to Gateway, which
settles on-chain. Output includes:

```
live-settle: SETTLEMENT TX 0x…
live-settle: explorer https://testnet.arcscan.app/tx/0x…
```

## 4. Verify on the explorer

Open the printed `testnet.arcscan.app/tx/0x…` link and confirm the settlement transaction.
That tx hash is the proof money moved. **Record it in your run notes — do not commit it.**

## Safety notes

- Hard caps (`maxCalls`, `maxTotalSpend`) bound spend; the full guard suite is Stage 6.
- Keys come only from env / a gitignored `.env`; nothing here logs or commits a key.
- CI never runs any of this (no keys, no `LIVE=1`) — these are local, human-run steps.
