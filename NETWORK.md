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

## Mainnet (later — switch by changing RPC + chain ID only)

| Key | Value | Status |
|-----|-------|--------|
| RPC URL | _TBD_ | not yet available (mainnet beta targeted 2026) |
| Chain ID | _TBD_ | not yet available |

Source (mainnet not yet live): <https://docs.arc.io/arc/references/contract-addresses>
(page states Arc Testnet addresses only; "Mainnet addresses are not yet available").
