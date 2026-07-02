# NETWORK.md — verified Arc network values

> Filled during **Stage 0** (verified 2026-07-02 against live Arc / Circle docs).
> Every value has a source URL. All code reads these via env / the `network` module —
> never hardcode them elsewhere. Switch testnet→mainnet by changing RPC + chain ID only.

## Docs domain — RESOLVED

**`docs.arc.io` is the real docs domain.** `docs.arc.network` is **not** a docs site —
`arc.network` is only the RPC host (`rpc.testnet.arc.network`). Circle's broader developer
docs live at `developers.circle.com`.
Source: <https://docs.arc.io/arc/references/connect-to-arc>

## Arc Testnet (current target)

| Key | Value | Source | Status |
|-----|-------|--------|--------|
| RPC URL | `https://rpc.testnet.arc.network` | <https://docs.arc.io/arc/references/connect-to-arc> | ✅ verified |
| Chain ID | `5042002` | <https://docs.arc.io/arc/references/connect-to-arc> | ✅ verified |
| Explorer | `https://testnet.arcscan.app` | <https://docs.arc.io/arc/references/connect-to-arc> | ✅ verified |
| Faucet | `https://faucet.circle.com` | <https://docs.arc.io/arc/references/connect-to-arc> | ✅ verified |
| Native gas token | USDC | <https://docs.arc.io/arc/references/connect-to-arc> | ✅ verified |
| Contract addresses (USDC/EURC/CCTP/Gateway) | see docs page | <https://docs.arc.io/arc/references/contract-addresses> | ✅ verified (wire in Stage 1+) |

**Note on decimals:** the `connect-to-arc` page describes USDC as the native gas token with
**18 decimals** (EVM gas-math representation). The USDC **ERC-20** token itself is **6 decimals**.
Don't conflate them when computing gas vs. token amounts in later stages.

Alternate RPC providers listed by the docs (Blockdaemon, dRPC, QuickNode, Alchemy, thirdweb)
exist but are **not** used here — the canonical endpoint above is the single source of truth.

## Circle SDK package names — verified on the npm registry (2026-07-02)

| Purpose | Package | Latest | Status |
|---------|---------|--------|--------|
| x402 batching (Gateway nanopayments) | `@circle-fin/x402-batching` | 3.2.0 | ✅ verified on npm |
| Circle Wallets — developer-controlled | `@circle-fin/developer-controlled-wallets` | 10.8.0 | ✅ verified on npm |
| Circle Wallets — user-controlled | `@circle-fin/user-controlled-wallets` | 10.8.0 | ✅ verified on npm |
| Circle Wallets — modular / smart accounts (ERC-4337) | `@circle-fin/modular-wallets-core` | published | ✅ verified on npm |
| CCTP v2 provider | `@circle-fin/provider-cctp-v2` | 1.8.5 | ✅ verified on npm |
| Cross-chain bridging kit (CCTPv2) | `@circle-fin/bridge-kit` | 1.11.1 | ✅ verified on npm |
| Paymaster | *no dedicated `@circle-fin/paymaster` package* | — | ⚠️ see note |

Verification method: `GET https://registry.npmjs.org/<pkg>` returned HTTP 200 with the `latest`
dist-tag above. `@circle-fin/paymaster` and `@circle-fin/paymaster-utils` both returned **404**.

**Paymaster — clarified, not a standalone SDK.** Circle Paymaster is a *permissionless ERC-4337
paymaster contract*, not an npm package. You consume it via an ERC-4337 smart-account SDK
(`@circle-fin/modular-wallets-core`) pointed at the Circle Paymaster **contract address**, which is
listed on the Arc contract-addresses page. On Arc, USDC is already the *native* gas token, so a
paymaster is secondary here (it matters most on chains where gas ≠ USDC).
Sources: <https://developers.circle.com/paymaster> ·
<https://docs.arc.io/arc/tools/account-abstraction> ·
<https://docs.arc.io/arc/references/contract-addresses>

Package sources: <https://www.npmjs.com/package/@circle-fin/x402-batching> ·
<https://www.npmjs.com/package/@circle-fin/developer-controlled-wallets> ·
<https://www.npmjs.com/package/@circle-fin/provider-cctp-v2> ·
<https://www.npmjs.com/package/@circle-fin/modular-wallets-core>

## x402 / Circle Gateway — verified Stage 3 (2026-07-02)

For the paywall (ADR-0001). All read from env / the `network` module in code — never hardcoded.

| Key | Value | Source | Status |
|-----|-------|--------|--------|
| USDC ERC-20 (x402 asset) | `0x3600000000000000000000000000000000000000` (**6 decimals**) | <https://docs.arc.io/arc/references/contract-addresses> | ✅ verified |
| GatewayWallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | <https://docs.arc.io/arc/references/contract-addresses> | ✅ verified |
| Gateway facilitator (testnet) | `https://gateway-api-testnet.circle.com` | Circle docs + `@circle-fin/x402-batching` | ✅ verified |
| Network id (CAIP-2) | `eip155:5042002` | `@circle-fin/x402-batching` (chain configs) | ✅ verified |
| x402 amount scale | **USDC ERC-20, 6 decimals** (`$0.001` → `1000` base units) | Circle/x402 docs + SDK `GatewayEvmScheme` | ✅ verified |

**x402 uses the 6-decimal ERC-20 USDC path — NOT the 18-decimal native/gas scale.** Use
`USDC_ERC20_DECIMALS` (6) for all x402 amounts; `ARC_NATIVE_GAS_DECIMALS` (18) is gas-only.

## Settlement PROVEN on-chain (read-only verification, 2026-07-02)

A live `live-settle` run of 3 × $0.001 (buyer `0x824c…` → seller `0xdA6b…`) was verified read-only
(`getBalances` / `searchTransfers` / `getTransferById`; script `apps/metered-mcp/scripts/inspect-settlement.ts`):
- **3 real transfers exist, all `status: "completed"`** (on-chain settled), `amount: "1000"` (=$0.001) each,
  from buyer → seller, IDs resolve individually.
- **Buyer debited exactly $0.003:** gateway `available` = `14997000` atomic = **14.997 USDC** = 15.000
  deposited − 0.003 paid (this is the payment debit, NOT deposit rounding).
- **Seller credited exactly $0.003:** gateway `total`/`available` = `3000` atomic = **0.003 USDC**.
- **Async cadence observed:** `createdAt 17:29:33` → `updatedAt`(completed) `17:40:04` ≈ **~10.5 minutes**
  from `received` → `completed`. This is why an immediate balance read right after flush shows 0.
- **`completed` transfers still expose NO tx-hash field** (only id/status/token/networks/addresses/
  amount/timestamps). So `getTransferById` never returns an on-chain hash; on-chain proof = `status:
  completed` + balance delta. (The batch mint tx lives on the GatewayMinter `0x0022222…`, not attached
  per-transfer by Circle's API.)
- **⚠️ Stage 5 caveat:** received funds show `available` = 0.003 but **`withdrawable` = 0**. So a credited
  balance is *spendable within Gateway* immediately, but **not necessarily withdrawable to a wallet** yet —
  Stage 5 must gate `withdraw()` on `withdrawable > 0`, not `available`.

## Gateway settlement: cadence, no manual flush, status→spendable (Stage 4/5)

Investigated for confirming that x402 "settled" actually lands on-chain (sources cited).

**1. Batch-to-chain cadence + manual flush.** Circle Gateway **accepts** a payment instantly
(off-chain ledger) and does the **on-chain batch settlement "periodically in the background"** —
exact cadence is **not published** by Circle. There is **no developer-facing flush/trigger** for
the receive-side x402 batch: the full `GatewayClient` method surface
(`@circle-fin/x402-batching/dist/client`) has `deposit/pay/withdraw/transfer/getBalances/
getTransferById/searchTransfers/…` but **no `flush`/`settle`/`forceSettle`**. The only on-chain
calls a developer makes move funds **out** of Gateway: `withdraw()` / `transfer()` (documented as
an **"instant transfer"**, returns a `mintTxHash`) — that is Stage 5, not the receive batch.
Sources: <https://www.circle.com/blog/circle-nanopayments-launches-on-testnet-as-the-core-primitive-for-agentic-economic-activity>
("adjusts the internal ledger balance, provides instant confirmation to the merchant … the actual
onchain settlement occurs periodically in the background"); Gateway "batch within hundreds of ms"
+ "<500 ms transfers" — <https://www.circle.com/gateway>, <https://www.circle.com/blog/nanopayments-powered-by-circle-gateway-is-now-live-on-mainnet>.

**2. Transfer status lifecycle** (SDK `TransferStatus`): `received → batched → confirmed →
completed` (or `failed`). `received` = signature verified + recipient's **unified balance credited**
(off-chain, instant); `batched` = bundled into a Gateway batch awaiting on-chain settlement;
`completed` = **on-chain batch settlement done**. "settled" from our `flushBatch` means **Gateway
ACCEPTED** (verified + queued) — NOT on-chain finality. Observed live (read-only): fresh transfers sit
at `received`; the transfer object exposes no tx-hash until later.

**3. Spendable/withdrawable → for Stage 5, gate on the BALANCE, not the transfer status.** The SDK
`GatewayBalance` fields are authoritative: `available` = *"can be used"* (spend/pay within Gateway),
`withdrawable` = *"ready to be withdrawn"* to a wallet on-chain, `withdrawing` = in progress. The
recipient's unified balance credits ~instantly on acceptance, so **Stage 5 should read
`getBalances().gateway.available` / `withdrawable` and withdraw when `> 0`** rather than coupling to a
transfer status. Source: `@circle-fin/x402-batching/dist/client/index.d.ts` (`GatewayBalance` field docs).

## x402 signing domain — verified Stage 4 (2026-07-02) ⚠️ CORRECTS Stage 3 defaults

Confirmed from the **live** Gateway `/supported` response and the SDK client
(`@circle-fin/x402-batching/dist/client/index.mjs`, which states *"Uses the GatewayWallet
contract as verifyingContract instead of USDC"*). The Circle Gateway **batched** x402 scheme
signs an EIP-712 `TransferWithAuthorization` against the **GatewayWallet** contract — NOT the
USDC token's own EIP-712 domain. This differs from the Stage 3 `USDC`/`1` placeholder defaults.

| Field | Confirmed value | Source |
|-------|-----------------|--------|
| EIP-712 `name` | `GatewayWalletBatched` | Gateway `/v1/x402/supported` (Arc `eip155:5042002`) + SDK `CIRCLE_BATCHING_NAME` |
| EIP-712 `version` | `1` | same (`CIRCLE_BATCHING_VERSION`) |
| `verifyingContract` | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` (**GatewayWallet**, not USDC) | `/supported` `extra.verifyingContract` |
| `chainId` | `5042002` | CAIP-2 `eip155:5042002` |
| primaryType / types | `TransferWithAuthorization` (from,to,value,validAfter,validBefore,nonce) | SDK `authorizationTypes` (identical to ours) |
| `minValiditySeconds` | `604800` (7 days) — `validBefore ≥ now + 604800` | `/supported` `extra.minValiditySeconds` |
| `x402Version` | `2` | `/supported` `x402Version` |
| USDC asset (unchanged) | `0x3600000000000000000000000000000000000000` (6 dec) | `/supported` `extra.assets[0]` |

Source: `GET https://gateway-api-testnet.circle.com/v1/x402/supported` (2026-07-02) +
`@circle-fin/x402-batching@3.2.0` client dist. **Code reads these from env / the network module —
never hardcoded.** The signing `verifyingContract` is the **GatewayWallet**, and the buyer must
sign with `validBefore ≥ now + minValiditySeconds` for the Gateway to accept.

## Mainnet (later — switch by changing RPC + chain ID only)

| Key | Value | Status |
|-----|-------|--------|
| RPC URL | _TBD_ | not yet available (mainnet beta targeted 2026) |
| Chain ID | _TBD_ | not yet available |

Source (mainnet not yet live): <https://docs.arc.io/arc/references/contract-addresses>
(page states Arc Testnet addresses only; "Mainnet addresses are not yet available").
