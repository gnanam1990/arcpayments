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
