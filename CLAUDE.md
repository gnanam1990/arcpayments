# CLAUDE.md — standing brief for Claude Code

You are building this repo **stage by stage**. Read this file every session. Do not skip ahead.

> **NAME:** `arcpayments` (chosen). Keep it **rename-safe** — the name lives in `package.json`,
> `NETWORK.md`, and the README only, never hardcoded through the codebase. The name reads as official
> Circle/Arc tooling, so be ready for a rename request from the Arc team; if it comes, it must be a
> find-and-replace, not a refactor. Reference Arc in docs; the CLI command is `arcpayments`.

## What this is

Two projects, one story, built **app-first**:

- **`arcpayments`** (`packages/arcpayments`) — the tool. A scaffolder + CLI for building agentic-commerce
  apps on Arc. CLI command `arcpayments` (e.g. `arcpayments doctor`, `arcpayments create <app>`).
  Community project — reference Arc in docs, never impersonate it.
- **`metered-mcp`** (`apps/metered-mcp`) — the showcase app. A metered MCP tool server: an AI agent
  pays sub-cent USDC on Arc for each tool call. It is the tool's "customer zero."

## The method (non-negotiable)

**The app drives the tool.** Build what `metered-mcp` needs; when a piece is generic, extract it
**once, cleanly** into `packages/arcpayments`. Never build a tool feature the app doesn't yet need.

## Stack

TypeScript on **Bun**. viem (EVM client). **vitest** (tests). **biome** (lint/format). **tsup** (build).
Monorepo via Bun workspaces: `packages/arcpayments`, `apps/metered-mcp`.

## Rules

1. **TDD.** Write the failing test first, then implement until green. No implementation without a test.
2. **One stage per session.** Do exactly `prompts/stage-NN.md`. Stop at its "Done when."
3. **Conventional Commits.** feat/fix/test/docs/refactor/chore. Small, frequent, meaningful — never one big dump.
4. **Branch + PR per stage.** Branch `stage-NN`, open PR, CI passes, merge, tag `vNN`.
5. **Never commit secrets.** No private keys, no `.env`. Testnet keys only, ever.
6. **Verify Arc specifics before wiring them (below).** Never hardcode unverified endpoints.
7. **CI must stay green** on every push (typecheck + lint + test + build).
8. Ask before adding any dependency not justified by the current stage.

## Arc facts — verified vs must-verify

**Verified:**
- Arc = Circle's EVM-compatible L1; USDC is native gas; sub-second finality.
- Public testnet is live. Faucet `faucet.circle.com`. Explorer ~ `testnet.arcscan.app`.
- Reference repos: `circlefin/arc-node`, `circlefin/arc-nanopayments`
  (`arc-nanopayments` uses `@circle-fin/x402-batching/client` + a `withGateway()` wrapper).

**MUST VERIFY in Stage 0 (sources disagree — do not assume):**
- Testnet **RPC URL** + **chain ID** (one doc: `rpc.testnet.arc.network` / `5042002` — unconfirmed).
- **Docs domain**: `docs.arc.network` vs `docs.arc.io`.
- Exact npm package names for Circle Wallets, CCTP, Paymaster.

Record verified values in `NETWORK.md` at repo root. All code reads them from a single `network`
module / env — never inline.

## Reference docs in this repo

- `PRD.md` — product requirements (both projects). `BUILD_PLAN.md` — the staged plan.
- `prompts/stage-NN.md` — your exact work order per stage.

## Testnet → mainnet

Testnet-only for now (test-value USDC). The network switch must be **one config change**
(RPC + chain ID). Design so no rewrite is needed when Arc mainnet beta is reachable.
