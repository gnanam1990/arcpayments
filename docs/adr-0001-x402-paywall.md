# ADR-0001 — x402 paywall for the metered-mcp tool

- **Status:** Accepted (approved 2026-07-02 — in-band approach + deps + 6-dec path)
- **Date:** 2026-07-02
- **Stage:** 3 (first stage where money moves)
- **Deciders:** repo owner (Gnanam) + Claude

## Context

Stage 3 must gate one metered-mcp tool behind an x402 payment: no valid payment →
a payment challenge; valid payment → run the tool **and queue the payment for
Circle Gateway batch settlement** (never broadcast a tx per call). The reference
(`circlefin/arc-nanopayments`) is HTTP-based (Next.js seller routes + a LangChain
buyer); our seller is an **MCP server over stdio**. Two things had to be resolved
against real sources before writing code.

---

## Finding 1 — Settlement mechanics + amount representation

**How x402 + Circle Gateway works (verified):**

1. Seller returns **PaymentRequirements** (the 402 challenge): `scheme` (`"exact"`),
   `network` (CAIP-2, e.g. `eip155:5042002`), `asset` (USDC ERC-20 address),
   `amount` (string, base units), `payTo` (seller address), `maxTimeoutSeconds`,
   `extra` (EIP-712 domain incl. `verifyingContract`).
2. Buyer signs an **EIP-3009 `transferWithAuthorization`** over those requirements →
   an x402 **PaymentPayload** (signature, no gas, no broadcast).
3. Seller **verifies locally** (exact EVM scheme: signature + amount + asset + payTo +
   validity window — no network needed) and, if valid, hands the authorization to
   **Circle Gateway** which **batches many signed authorizations into a single onchain
   settlement**. Batching is a property of the Gateway facilitator, not of us —
   that is precisely how sub-cent payments become economical.

**Real `@circle-fin/x402-batching` v3.2.0 API surface** (from the published tarball —
not invented):
- `./server`: `BatchFacilitatorClient` implements `FacilitatorClient`
  (`verify(payload, reqs) → {isValid, invalidReason, payer}`,
  `settle(payload, reqs) → {success, transaction, network}`, `getSupported()`);
  talks to Gateway `POST /v1/x402/verify`, `POST /v1/x402/settle`, `GET /v1/x402/supported`.
  Also `GatewayEvmScheme extends ExactEvmScheme` (local verify + `parsePrice` money parser),
  and `createGatewayMiddleware({ sellerAddress, networks, facilitatorUrl })` (Express).
- `./client`: `GatewayClient({ chain: 'arcTestnet', privateKey })` with `deposit()`,
  `pay(url)`, and lifecycle hooks.
- **Peer deps:** `@x402/core ^2.3.0`, `@x402/evm ^2.3.0`, `viem ^2.0.0`.

**Amount representation — RESOLVED: x402 uses the 6-decimal USDC ERC-20 path, NOT the
18-decimal native/gas path.**
- The SDK's `GatewayEvmScheme` doc: it "converts dollar amounts to **USDC atomic units
  (6 decimals)**"; its lifecycle-hook example compares `amount` to `10_000_000n` (= $10).
- Circle/x402 docs: "the amount is in **USDC atomic units (6 decimals)**, so 7000 = $0.007."
- Arc Testnet USDC ERC-20 `0x3600…0000` is documented as **6 decimals**.
- So a **`$0.001`** price serializes on the wire to **`1000`** base units
  (`parseUnits("0.001", 6)`), using our existing `USDC_ERC20_DECIMALS = 6` constant.
  The 18-decimal `ARC_NATIVE_GAS_DECIMALS` is for gas math only and must **not** touch
  x402 amounts.

**Verified Arc Testnet values** (sources below; to be added to `NETWORK.md` + read from
env in Part B, never hardcoded):
- USDC ERC-20 asset: `0x3600000000000000000000000000000000000000` (6 decimals)
- GatewayWallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- Gateway testnet facilitator: `https://gateway-api-testnet.circle.com`
- Network (CAIP-2): `eip155:5042002`

---

## Finding 2 — Mapping a 402 challenge onto an MCP tool call

**Option (a): Streamable-HTTP MCP transport, 402 at the HTTP layer.**
The ecosystem-standard "x402 over MCP" (Vercel `x402-mcp` `server.paidTool(...)`, the
official x402 MCP guide) runs the MCP server over **Streamable HTTP** and returns a real
HTTP 402 on `tools/call`. Closest to the reference; "x402 works as designed."
- **But** `x402-mcp` "settles as **exact, one-time payments** in USDC on Base" and exposes
  **no custom-facilitator hook** — it does **not** do Circle Gateway **batch** settlement.
  Adopting it would violate Stage 3's hard rule ("never broadcast a tx per call") or force
  us to fork its facilitator — i.e. invent an integration the SDK doesn't sanction.
- Also requires rewriting the Stage 1/2 stdio server onto an HTTP transport now — the
  riskiest possible change to make in the *first money-moving stage*.
- The official x402 "MCP server" guide is actually a *buyer* proxying to HTTP sellers via
  `@x402/axios`, not a server gating its own tool — not our topology.

**Option (b): In-band JSON-RPC challenge at the tool layer (recommended).**
The paid tool returns a structured **"payment required"** result carrying the x402-standard
`PaymentRequirements`. The (test) buyer signs EIP-3009 and retries the same tool call with
the `PaymentPayload` in the call arguments/`_meta`. The seller verifies **locally** and, on
success, runs the tool and **enqueues a settlement record** for Gateway batch flush.
- Reuses the confirmed Circle Gateway primitives (`GatewayEvmScheme` local verify +
  `BatchFacilitatorClient` batch settle) — the only path that actually **batches**.
- Keeps the existing **stdio** server (no transport rewrite) and gives **per-tool** gating,
  so the free `echo` tool stays free.
- The **paywall wrapper is transport-agnostic** — the core `arcpayments` value. The same
  wrapper gates a stdio tool now and an HTTP route later.
- **Wire payloads stay 100% x402-standard** (PaymentRequirements / PaymentPayload / EIP-3009 /
  CAIP-2 / 6-dec USDC), so a Streamable-HTTP transport (option a — the natural *production*
  shape) can be layered in a later stage **without changing the payment core**.

**Trade-offs of (b), stated honestly:**
- Not a literal HTTP-402 status; we hand-roll the challenge/retry *envelope* (payloads stay
  standard). MCP tool calls carry no HTTP status anyway.
- A generic MCP client won't auto-pay yet (there is no standard MCP payment negotiation —
  it's an open MCP discussion). Stage 3 ships a **minimal test payer** to exercise the flow;
  the real buyer agent is Stage 4.

---

## Decision (recommended)

**Adopt Option (b): an in-band, transport-agnostic x402 paywall at the MCP tool layer,
built on Circle Gateway's `@circle-fin/x402-batching` primitives.**

**Shape of the implementation (Parts B–D, after approval):**
- `packages/arcpayments` — a reusable, transport-agnostic **`PaywallGuard`** that wraps a
  tool handler:
  - builds x402 `PaymentRequirements` from `{ price, sellerAddress, network, asset }`
    (price → base units via `USDC_ERC20_DECIMALS`, never a hardcoded scale);
  - a **`PaymentVerifier` seam** (mockable): `LocalExactVerifier` checks the EIP-3009
    signature/amount/asset/payTo/expiry with **no network** (satisfies "local verify, no
    network in the happy-path unit test");
  - a **`SettlementQueue` seam**: on valid payment, **enqueue** a record (no per-call
    broadcast); the real Gateway `BatchFacilitatorClient.settle` batch-flush is wired but
    not called per request (buyer loop / flush cadence is Stage 4);
  - plus an **`arcpayments add paywall`** generator scaffolding a gated tool.
- `apps/metered-mcp` — add **one paid tool** (keep free `echo`); gate it with `PaywallGuard`;
  price constant `PAID_TOOL_PRICE = "$0.001"`. **Route signing/identity through the Stage 2
  `Wallet` seam** (`LocalWallet` from `arcpayments`), removing the direct-viem coupling.
- `NETWORK.md` + env — add `ARC_USDC_ADDRESS`, `ARC_GATEWAY_URL` (testnet default), network
  CAIP-2; read from the network module, never inlined.
- New dependencies to add (peer set of the required SDK): **`@circle-fin/x402-batching`,
  `@x402/core`, `@x402/evm`** (viem already present). *Requesting approval to add these.*

**Later (not this stage):** add the Streamable-HTTP transport + Circle `createGatewayMiddleware`
as the production deployment path (Stage 7 scaffolder), reusing this same payment core.

## In-band wire format (normative — keep transport-agnostic)

The payment core is transport-agnostic; this is the exact in-band envelope used over
MCP tool calls today. A Streamable-HTTP transport layers on later by mapping these 1:1
to HTTP (challenge → 402 body; `payment` arg → `X-PAYMENT` header) **without changing the
payment core**.

**Paid tool input** — the tool's normal arguments plus an optional `payment`:
```jsonc
{ "text": "hello", "payment": <ExactPaymentPayload | omitted> }
```

**`ExactPaymentPayload`** (x402 exact-EVM standard; amounts are 6-dec USDC base-unit strings):
```jsonc
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "eip155:5042002",
  "payload": {
    "signature": "0x…",                       // EIP-712 TransferWithAuthorization
    "authorization": {
      "from": "0x…",  "to": "0x…(seller payTo)",
      "value": "1000",                          // $0.001 → 1000 (6 decimals)
      "validAfter": "0", "validBefore": "…",    // unix seconds (expiry window)
      "nonce": "0x…(32 bytes)"                  // single-use (replay protection)
    }
  }
}
```

**Challenge / rejection** — returned as an MCP tool result with `isError: true` and a
single text content whose body is a JSON envelope (mirrors an HTTP-402 body with `accepts`):
```jsonc
{ "x402Version": 1,
  "error": "PAYMENT_REQUIRED",                  // or "PAYMENT_INVALID" (+ "reason")
  "accepts": [ <PaymentRequirements> ] }        // scheme/network/asset/amount/payTo/maxTimeoutSeconds/extra{name,version,verifyingContract}
```

**Success** — a normal (non-error) result: the tool's content, plus a second text content
`{"settlement":{ "id","status","payer","amount" }}` for the queued (batched) settlement.

**Verification rules enforced locally** (so an accepted payment will actually settle at the
Gateway): scheme+network match, `to == payTo`, `value ≥ amount`, `validAfter ≤ now < validBefore`
(**expiry**), nonce is 32-byte and **unused (replay)**, and the EIP-3009 signature recovers to
`authorization.from`. On success the nonce is consumed; settlement failures are surfaced by the
queue, never dropped.

## Consequences

- ✅ Satisfies "verify locally + batch settlement, never broadcast per call" using the real,
  confirmed Gateway SDK surface.
- ✅ Free `echo` unaffected; paywall is reusable and transport-agnostic.
- ✅ Correct decimals (6-dec USDC) enforced via the existing named constant + a test.
- ⚠️ In-band challenge is not the literal HTTP-402 convention; mitigated by standard payloads
  and a planned HTTP transport later.
- ⚠️ Adds 2 new runtime deps (`@circle-fin/x402-batching`, `@x402/core`, `@x402/evm`).

## Sources

- `@circle-fin/x402-batching` v3.2.0 — inspected published tarball (README + `dist/**/*.d.ts`):
  `BatchFacilitatorClient`, `GatewayEvmScheme` ("USDC atomic units (6 decimals)"),
  `createGatewayMiddleware`, `GatewayClient`; testnet facilitator
  `https://gateway-api-testnet.circle.com`; CAIP-2 `eip155:5042002` for Arc Testnet.
- x402 amount = 6-dec USDC atomic units — <https://www.circle.com/blog/turn-your-api-into-a-storefront-for-agents> and the SDK type docs.
- Arc Testnet contract addresses (USDC `0x3600…`, 6 decimals; GatewayWallet `0x0077…`) —
  <https://docs.arc.io/arc/references/contract-addresses>.
- MCP + x402 patterns: official guide <https://docs.x402.org/guides/mcp-server-with-x402>
  (MCP-as-buyer proxy), Vercel `x402-mcp` <https://vercel.com/blog/introducing-x402-mcp-open-protocol-payments-for-mcp-tools>
  (Streamable-HTTP `paidTool`, exact-on-Base, no Gateway batching / no custom facilitator).
- Reference: `circlefin/arc-nanopayments` (Gateway batches signed authorizations into one
  onchain settlement; micro-prices $0.001+).
