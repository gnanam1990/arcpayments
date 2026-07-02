# Stage 4 — Buyer agent + payment loop (first on-chain settlement)

**Goal:** an autonomous buyer agent (MCP client) calls the paid tool in a loop, paying per call via
batched Gateway settlement — signs locally, never broadcasts per call — and a real batch **settles
on-chain** on Arc testnet. Extract the buyer template + loop into `arcpayments`.

Read `CLAUDE.md`, `NETWORK.md`, `docs/adr-0001-x402-paywall.md`, and the Stage 3 code first.
Repo is PUBLIC — secrets rules apply, git-status gate before every commit.

## Part A — CONFIRM before wiring live settlement, then report

The Stage 3 local loop is self-consistent, so tests pass even if the on-chain domain is wrong.
Before any live settlement:

1. **EIP-712 / EIP-3009 domain.** Fetch the Gateway `/supported` response (testnet facilitator
   `gateway-api-testnet.circle.com`) and read the Arc **USDC** contract's actual EIP-712 domain
   (`name`, `version`, `chainId=5042002`, `verifyingContract`). Confirm they match what the signer
   uses. If they differ from the `USDC` / `1` defaults, **stop and report** — do not settle with a
   guessed domain. Record confirmed values in `NETWORK.md` with source.
2. **Buyer funding.** The buyer wallet must hold testnet USDC (Stage 2 `faucet`). If unfunded, the
   loop's mocked tests still run, but the live settlement smoke (Part D) can't — flag it.

Report both before proceeding to live settlement. Mocked implementation (Parts B–C) may proceed.

## Part B — Buyer agent (`apps/metered-mcp` or a sibling `apps/buyer-agent`)

- An MCP **client** that connects to the metered-mcp server, calls `premium_echo`, receives the
  `PAYMENT_REQUIRED` challenge, signs an **EIP-3009** authorization locally for the exact price, and
  retries with the payment proof — getting the result. Signing goes through the **`Wallet` seam**.
- No transaction broadcast per call; the proof is handed to the seller, which queues it for batch settlement.

## Part C — Payment loop + extract into `packages/arcpayments`

- A `startPaymentLoop({ maxCalls, maxTotalSpend, ... })` helper: makes repeated paid calls, tracks
  in-flight requests, and **enforces a hard cap** on both call count and cumulative spend. This cap is
  a minimal dev safety rail — the full guard suite (budget/rate/allowlist/human-gate) is Stage 6.
- Batch **flush trigger** (by count and/or time) that submits queued payments to the Gateway via
  `BatchFacilitatorClient` — one settlement for many calls.
- Extract the buyer template + loop + a `arcpayments` buyer helper into the package (the app consumes it).

## Part D — Live settlement smoke (real testnet, run locally — NOT in CI)

- With a funded buyer wallet, run the loop for a small N; let one batch settle on-chain.
- **Verify the settlement transaction on the explorer** (`testnet.arcscan.app`) and record the tx hash
  in the run output (not committed). This is the proof it actually moves money, not just passes tests.
- CI must stay green WITHOUT real keys or live settlement — the live smoke is a documented local script,
  gated so CI skips it (e.g. skip unless `BUYER_PRIVATE_KEY` + a `LIVE=1` flag are set).

## Tests first (TDD, all mocked — no keys/network in CI)

- [ ] buyer signs a valid EIP-3009 authorization the Stage 3 verifier accepts (round-trip)
- [ ] loop makes exactly N paid calls, then stops
- [ ] loop halts at `maxCalls` and at `maxTotalSpend` (both caps, separately tested)
- [ ] batch flush submits queued payments once threshold is hit; one settlement covers many calls
- [ ] settlement failure from the facilitator is surfaced (not silently dropped) and stops the loop
- [ ] a rejected/expired proof from the buyer is refused by the seller (reuses Stage 3 replay guard)

## Done when

- [ ] Part A confirmed: EIP-712 domain matches (or discrepancy reported + resolved); buyer funding status known
- [ ] buyer agent completes the challenge→sign→retry→result flow over real stdio
- [ ] loop enforces hard caps; batch flush settles many calls in one Gateway submission
- [ ] one batch **settled on-chain**, tx verified on `testnet.arcscan.app` (hash in run output)
- [ ] buyer template + loop extracted into `packages/arcpayments`
- [ ] all mocked tests green; CI green without keys; no secret committed
- [ ] Conventional Commits on branch `stage-04`, PR opened. Tag `v0.4.0` left to me after merge.

## Do NOT

- Do not settle live with an unconfirmed EIP-712 domain — confirm in Part A first.
- Do not broadcast a transaction per call — sign locally, settle in batches.
- Do not put real keys, tx, or the live smoke in CI. Do not log/commit any key.
- Do not build the full safety-guard suite here — only the minimal loop caps. Full guards are Stage 6.
- Do not hardcode endpoints/decimals/domain — all from env / the network module.
