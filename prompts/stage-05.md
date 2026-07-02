# Stage 5 — Seller cash-out (Gateway withdraw → CCTP cross-chain)

**Goal:** the seller realizes earnings end-to-end: Gateway balance → `withdraw()` to the seller's Arc
wallet (gated on `withdrawable`) → **CCTP** the USDC to another chain. This produces the first real
on-chain `0x` tx hashes in the project. CCTP **burns** USDC — irreversible — so verify first.

Read `CLAUDE.md`, `NETWORK.md` (esp. the Stage 4 findings: ~10.5 min settle cadence, no per-transfer
hash, `available` vs `withdrawable`), `docs/adr-0001-x402-paywall.md`, and the current code first.
Repo is PUBLIC — secrets rules apply, git-status gate before every commit.

## Part A — VERIFY & DESIGN, then PAUSE (before any money-moving code)

Confirm from the SDK dist (`@circle-fin/x402-batching`, `@circle-fin/provider-cctp-v2`,
`@circle-fin/bridge-kit`) and `docs.arc.io` / Circle CCTP docs — do not guess:

1. **Gateway withdrawal model.** How does `available` become `withdrawable`? Is there a
   request-withdrawal step (available → withdrawing → withdrawable over a cadence), an instant
   `withdraw()`/`transfer()` with a fee, or both? Which call returns a real on-chain `mintTxHash`?
   Confirm the exact method signatures + any fees + the cadence. Record in `NETWORK.md`.
2. **CCTP v2 path Arc → destination.** Confirm: is CCTP live for Arc testnet? Which SDK is the right
   one here — `@circle-fin/bridge-kit` (higher-level) vs `@circle-fin/provider-cctp-v2`? The
   burn→attestation→mint flow, the Circle attestation service endpoint, the destination chain +
   its USDC address + CCTP domain id. **Recommend a destination testnet chain** (default candidate:
   Base Sepolia — confirm Arc↔Base-Sepolia CCTP support; fall back to Ethereum Sepolia if not).
3. Write findings + recommended approach (SDK choice, destination chain, the withdraw+CCTP sequence,
   fees, cadences, failure/retry points) into `docs/adr-0002-seller-cashout.md`.

**Then STOP.** Show me the ADR before writing implementation. Mocked scaffolding may proceed; no live
burn/withdraw until I approve the destination chain + CCTP provider.

## Part B — Gateway withdraw (`packages/arcpayments`) — after approval

- `arcpayments gateway:withdraw [amount]` — moves the seller's Gateway balance to the seller's **Arc
  wallet**. **Gate on `withdrawable > 0`** (Stage 4 caveat: `available` ≠ `withdrawable`). If funds are
  `available` but not yet `withdrawable`, report the state + cadence and exit cleanly (don't fake it).
- Uses `SELLER_PRIVATE_KEY` (never logged). Prints the real `mintTxHash` + a resolving
  `testnet.arcscan.app/tx/0x…` link — the first genuine on-chain hash in the project.

## Part C — CCTP cross-chain (`packages/arcpayments`)

- `arcpayments cctp:transfer <amount> --to <chain>` — burns USDC on Arc, polls the Circle attestation
  service, mints on the destination chain. Uses the confirmed CCTP SDK + confirmed destination.
- Async (burn → attest → mint): poll the attestation with backoff; surface each step's tx hash;
  surface failures (don't swallow). Report the burn tx (Arc explorer) and the mint tx (destination
  explorer) with resolving links.
- Needs a destination-chain USDC address + a recipient (seller's address on the destination chain);
  read from env / network module, never hardcoded.

## Part D — Extract + seller cash-out flow

- Extract reusable `withdraw` + `cctp` modules into `packages/arcpayments`; the app/seller consumes them.
- A documented end-to-end path: earn (Stage 3–4) → `gateway:withdraw` → `cctp:transfer` → funds on the
  destination chain. Add `docs/RUNBOOK-seller-cashout.md`.

## Part E — Live smoke (gated, local, NOT in CI)

- With the seller holding real Gateway funds, run the full cash-out and verify on BOTH explorers
  (Arc burn + destination mint). Gate behind `LIVE=1` + `SELLER_PRIVATE_KEY`; CI never runs it.
- **Practical note:** 0.003 USDC may be below CCTP minimums / dominated by fees. For a meaningful live
  run, top the seller up (more buyer-loop calls, or faucet the seller's Arc wallet) — flag the minimum
  in the runbook.

## Tests first (TDD, all mocked — no keys/network in CI)

- [ ] `gateway:withdraw` refuses when `withdrawable == 0` (exits clean, reports cadence) — separate test
- [ ] `gateway:withdraw` on `withdrawable > 0` calls the right SDK method and returns a `0x` mintTxHash
- [ ] CCTP flow: burn → attestation poll → mint sequence, in order, on mocks
- [ ] CCTP attestation-pending is polled with backoff, not busy-looped; timeout surfaces cleanly
- [ ] any burn/attest/mint failure is surfaced (not swallowed); a failed burn does not proceed to mint
- [ ] explorer links are built only from real `0x` hashes (reuse the Stage 4 hash-validation)
- [ ] no hardcoded chain/USDC/domain/attestation endpoints — all from env / network module

## Done when

- [ ] `docs/adr-0002-seller-cashout.md` approved (withdraw model + CCTP provider + destination chain)
- [ ] `gateway:withdraw` moves Gateway funds to the seller's Arc wallet, gated on `withdrawable`, prints a real mintTxHash
- [ ] `cctp:transfer` burns on Arc, attests, mints on the destination chain; both tx hashes resolve
- [ ] withdraw + CCTP extracted into `packages/arcpayments`; `RUNBOOK-seller-cashout.md` written
- [ ] all mocked tests green; CI green without keys; no secret committed
- [ ] Conventional Commits on branch `stage-05`, PR opened. Tag `v0.5.0` after merge + a live cash-out confirmed on both explorers.

## Do NOT

- Do not write burn/withdraw code before I approve the Part A ADR (CCTP burns are irreversible).
- Do not withdraw on `available` — gate strictly on `withdrawable`.
- Do not put real keys, live burns, or CCTP execution in CI. Do not log/commit any key.
- Do not hardcode chains, USDC addresses, CCTP domains, or the attestation endpoint.
- Do not build spend guards here — that's Stage 6.
