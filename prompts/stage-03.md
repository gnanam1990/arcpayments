# Stage 3 — x402 paywall (money moves)

**Goal:** the metered-mcp tool responds **only after a valid x402 payment**; verify the payment
locally and queue it for batch settlement. Extract the paywall into `arcpayments`. This is the first
stage where real value moves — do the verification step FIRST and do not guess.

Read `CLAUDE.md`, `NETWORK.md`, and the current code first. Repo is PUBLIC — secrets rules apply,
git-status gate before every commit.

## Part A — VERIFY & DESIGN, then PAUSE (do this before any code)

The reference (`circlefin/arc-nanopayments`) wraps **HTTP** routes with `withGateway()` and
`@circle-fin/x402-batching`. Our seller is an **MCP server over stdio** — JSON-RPC, no HTTP status
codes. Two things must be resolved against real sources before implementing:

1. **Settlement mechanics + amount representation.** From `docs.arc.io` and the arc-nanopayments repo,
   confirm: how an x402 payment is challenged, signed, verified locally, and queued for batch
   settlement via Gateway; and the **exact USDC amount representation** for x402 payments (the
   6-decimal ERC-20 path vs the 18-decimal native/gas path — Stage 0 flagged these are different).
   State which one x402 amounts use, with the source.
2. **MCP paywall mechanism.** Decide how a 402-style payment challenge maps onto an MCP tool call.
   Evaluate at least these two options and recommend one:
   - **(a) Streamable-HTTP MCP transport** — run the MCP server over HTTP so the x402 402 challenge
     lives at the HTTP layer (closest to the reference; x402 works as designed).
   - **(b) In-band JSON-RPC challenge** — the tool returns a structured "payment required" result with
     a challenge; the client pays and retries with a payment proof (works over stdio, but hand-rolls
     the challenge/verify flow).

**Then STOP.** Write findings + your recommended approach into a short `docs/adr-0001-x402-paywall.md`
(architecture decision record) and show me before writing implementation code. Do not proceed until I approve.

## Part B — Seller paywall (`apps/metered-mcp`) — after approval

- Add **one paid tool** (keep the free `echo` for contrast/testing).
- Gate it: no valid payment → the approved challenge response; valid payment → run the tool AND queue
  the payment for batch settlement. Verify the payment **locally** before responding.
- Price it via a constant (e.g. `$0.001`) — not a magic number inline.

## Part C — Extract into the tool (`packages/arcpayments`)

- A reusable paywall wrapper (the generalized `withGateway`-equivalent for the chosen transport) plus
  an `arcpayments add paywall` generator that scaffolds a gated tool/route.
- **Route the app through the `Wallet` seam** for signing/identity now (this resolves the Stage 2
  coupling shortcut — the app must no longer re-derive wallet logic via viem directly).

## Part D — Decimals

- x402 amounts use the representation confirmed in Part A. Reuse the named decimals constants; never
  hardcode a scale. Add a test asserting a `$0.001` price serializes to the correct on-wire amount.

## Tests first (TDD)

- [ ] unpaid tool call → returns the payment challenge, NOT the tool result
- [ ] valid payment → returns the tool result AND enqueues a settlement record
- [ ] invalid / insufficient / malformed payment → rejected, tool does not run
- [ ] price enforcement: a payment below price is rejected
- [ ] amount serialization: `$0.001` → correct on-wire USDC value (right decimals)
- [ ] local verification never requires network for the happy-path unit test (mock the verifier)
- [ ] free `echo` tool still works without payment

## Done when

- [ ] `docs/adr-0001-x402-paywall.md` records the approved approach
- [ ] the paid tool is gated; valid payment runs it + queues settlement; invalid payment is refused
- [ ] paywall wrapper + `add paywall` generator live in `packages/arcpayments`
- [ ] app routes through the `Wallet` seam (Stage 2 coupling resolved)
- [ ] decimals correct and tested; no hardcoded scales or endpoints
- [ ] all tests green; CI green; no secret committed
- [ ] Conventional Commits on branch `stage-03`, PR opened. Tag `v0.3.0` left to me after merge.

## Do NOT

- Do not write implementation code before I approve the Part A ADR.
- Do not broadcast a transaction per call — payments are signed + queued for **batch** settlement.
- Do not invent an SDK API — confirm the real `@circle-fin/x402-batching` surface first.
- No buyer agent / payment loop yet — that's Stage 4. Stage 3 is the seller-side paywall + a minimal
  test payer to exercise it.
- Do not print/log/commit any key. Do not hardcode endpoints or decimals.
